import { ConnectionManager } from './connectionManager';
import { ServerConfig } from '../data/models/server';
import { Queue, Job, Worker, SidekiqStats, CronJob } from '../data/models/sidekiq';

const REMOVE_JOB_BY_JID_SCRIPT = `
local key = KEYS[1]
local jid = ARGV[1]
local cursor = "0"

repeat
    local result = redis.call("ZSCAN", key, cursor)
    cursor = result[1]
    local items = result[2]
    for i = 1, #items, 2 do
        local raw_job = items[i]
        local success, job = pcall(cjson.decode, raw_job)
        if success and job['jid'] == jid then
            redis.call("ZREM", key, raw_job)
            return 1
        end
    end
until cursor == "0"
return 0
`;

export class SidekiqClient {
  constructor(private connectionManager: ConnectionManager) {}

  async getStats(server: ServerConfig): Promise<SidekiqStats> {
    const redis = await this.connectionManager.getConnection(server);
    
    const [
      processed,
      failed,
      scheduled_size,
      retry_size,
      dead_size,
      processes_size,
      default_queue_latency,
      workers_size,
      enqueued
    ] = await redis.mget(
      'stat:processed',
      'stat:failed',
      'schedule_size',
      'retry_size',
      'dead_size',
      'processes_size',
      'default_queue_latency',
      'workers_size',
      'enqueued'
    );

    return {
      processed: parseInt(processed || '0'),
      failed: parseInt(failed || '0'),
      scheduled: parseInt(scheduled_size || '0'),
      retries: parseInt(retry_size || '0'),
      dead: parseInt(dead_size || '0'),
      processes: parseInt(processes_size || '0'),
      default_queue_latency: parseFloat(default_queue_latency || '0'),
      workers: parseInt(workers_size || '0'),
      enqueued: parseInt(enqueued || '0')
    };
  }

  async getQueues(server: ServerConfig): Promise<Queue[]> {
    const redis = await this.connectionManager.getConnection(server);
    const queueNames = await redis.smembers('queues');
    
    if (queueNames.length === 0) {
      return [];
    }

    const pipeline = redis.pipeline();
    // Use pipeline to batch all size and latency checks into a single network round-trip.
    // This solves the N+1 query issue where fetching details for N queues would take 2*N round-trips.
    for (const name of queueNames) {
      pipeline.llen(`queue:${name}`);
      pipeline.lindex(`queue:${name}`, -1);
    }

    const results = await pipeline.exec();
    const queues: Queue[] = [];

    if (results) {
      for (let i = 0; i < queueNames.length; i++) {
        const name = queueNames[i];

        // Results are interleaved: llen, lindex, llen, lindex...
        const [sizeErr, sizeRes] = results[i * 2];
        const [jobErr, jobRes] = results[i * 2 + 1];

        if (sizeErr) {
          throw sizeErr;
        }

        if (jobErr) {
          throw jobErr;
        }

        const size = sizeRes as number;
        let latency = 0;

        if (jobRes) {
          try {
            const data = JSON.parse(jobRes as string);
            const enqueuedAt = data.enqueued_at || data.created_at;
            latency = Math.max(0, Date.now() / 1000 - enqueuedAt);
          } catch {
            latency = 0;
          }
        }

        queues.push({
          name,
          size,
          latency,
          paused: false // TODO: Check if queue is paused
        });
      }
    }
    
    return queues.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getQueueJobs(server: ServerConfig, queueName: string, start = 0, stop = 99): Promise<Job[]> {
    const redis = await this.connectionManager.getConnection(server);
    const rawJobs = await redis.lrange(`queue:${queueName}`, start, stop);
    
    return rawJobs.map((raw, index) => {
      try {
        const data = JSON.parse(raw);
        return {
          id: data.jid || `${queueName}-${start + index}`,
          queue: queueName,
          class: data.class,
          args: data.args,
          createdAt: new Date(data.created_at * 1000),
          enqueuedAt: data.enqueued_at ? new Date(data.enqueued_at * 1000) : undefined,
          retry: data.retry,
          retriedAt: data.retried_at ? new Date(data.retried_at * 1000) : undefined,
          failedAt: data.failed_at ? new Date(data.failed_at * 1000) : undefined,
          errorMessage: data.error_message,
          errorClass: data.error_class,
          backtrace: data.backtrace
        };
      } catch (error) {
        console.error('Failed to parse job:', error);
        return null;
      }
    }).filter(job => job !== null) as Job[];
  }

  async getWorkers(server: ServerConfig): Promise<Worker[]> {
    const redis = await this.connectionManager.getConnection(server);

    // Sidekiq 6+ uses 'processes' set to store worker processes
    let processIds = await redis.smembers('processes');
    console.log(`Found ${processIds.length} workers in 'processes' set`);

    // Fallback to older 'workers' set for older Sidekiq versions
    if (processIds.length === 0) {
      processIds = await redis.smembers('workers');
      console.log(`Found ${processIds.length} workers in 'workers' set (legacy)`);
    }

    // Try with namespace prefix
    if (processIds.length === 0) {
      processIds = await redis.smembers('sidekiq:processes');
      console.log(`Found ${processIds.length} workers in 'sidekiq:processes' set`);
    }

    if (processIds.length === 0) {
      console.log('No workers found in Redis. Make sure Sidekiq is running with workers.');
      return [];
    }

    // Use pipeline to batch all hgetall calls
    const pipeline = redis.pipeline();
    for (const processId of processIds) {
      pipeline.hgetall(processId);
    }
    const workerResults = await pipeline.exec();

    // Prepare for second pipeline (getting jobs for busy workers)
    const workersData: any[] = [];
    const busyWorkerIndices: number[] = [];

    if (workerResults) {
      for (let i = 0; i < workerResults.length; i++) {
        const [err, res] = workerResults[i];
        const processId = processIds[i];

        if (err) {
          console.error(`Failed to get info for process ${processId}`, err);
          workersData.push(null);
          continue;
        }

        const processData = res as any;
        if (!processData || !processData.info) {
          console.warn(`No info found for process ${processId}`);
          workersData.push(null);
          continue;
        }

        workersData.push(processData);
        const busy = parseInt(processData.busy || '0', 10);
        if (busy > 0) {
          busyWorkerIndices.push(i);
        }
      }
    }

    // Pipeline 2: Get job info for busy workers
    const jobResultsMap = new Map<string, string>();
    if (busyWorkerIndices.length > 0) {
      const jobPipeline = redis.pipeline();
      for (const index of busyWorkerIndices) {
        const processId = processIds[index];
        jobPipeline.get(`${processId}:work`);
      }

      const jobResults = await jobPipeline.exec();

      if (jobResults) {
        for (let i = 0; i < jobResults.length; i++) {
          const [err, res] = jobResults[i];
          const index = busyWorkerIndices[i];
          const processId = processIds[index];

          if (!err && res) {
            jobResultsMap.set(processId, res as string);
          }
        }
      }
    }

    const workers: Worker[] = [];

    // Process results
    for (let i = 0; i < workersData.length; i++) {
      const processData = workersData[i];
      if (!processData) continue;

      const processId = processIds[i];

      try {
        const info = JSON.parse(processData.info);

        let currentJob: Worker['job'] = undefined;
        const workData = jobResultsMap.get(processId);

        if (workData) {
          try {
            const jobData = JSON.parse(workData);
            currentJob = {
              id: jobData.payload?.jid || '',
              queue: jobData.queue || '',
              class: jobData.payload?.class || '',
              args: jobData.payload?.args || [],
              createdAt: jobData.payload?.created_at ? new Date(jobData.payload.created_at * 1000) : new Date()
            };
          } catch (error) {
            console.error('Failed to parse job data:', error);
          }
        }

        workers.push({
          id: processId,
          hostname: info.hostname || processId.split(':')[0],
          pid: info.pid || parseInt(processId.split(':')[1], 10),
          tag: info.tag,
          started_at: info.started_at ? new Date(info.started_at * 1000) : new Date(),
          job: currentJob,
          queues: info.queues || []
        });
      } catch (error) {
        console.error(`Failed to parse worker ${processId}:`, error);
      }
    }

    console.log(`Returning ${workers.length} workers`);
    return workers;
  }

  async getScheduledJobs(server: ServerConfig, start = 0, stop = 99): Promise<Job[]> {
    const redis = await this.connectionManager.getConnection(server);
    const jobs = await redis.zrange('schedule', start, stop, 'WITHSCORES');
    
    const result: Job[] = [];
    for (let i = 0; i < jobs.length; i += 2) {
      try {
        const data = JSON.parse(jobs[i]);
        const scheduledAt = parseInt(jobs[i + 1]);
        
        result.push({
          id: data.jid,
          queue: data.queue,
          class: data.class,
          args: data.args,
          createdAt: new Date(data.created_at * 1000),
          scheduledAt: new Date(scheduledAt * 1000)
        });
      } catch (error) {
        console.error('Failed to parse scheduled job:', error);
      }
    }
    
    return result;
  }

  async getRetryJobs(server: ServerConfig, start = 0, stop = 99): Promise<Job[]> {
    const redis = await this.connectionManager.getConnection(server);
    const jobs = await redis.zrange('retry', start, stop, 'WITHSCORES');
    
    const result: Job[] = [];
    for (let i = 0; i < jobs.length; i += 2) {
      try {
        const data = JSON.parse(jobs[i]);
        const retryAt = parseInt(jobs[i + 1]);
        
        result.push({
          id: data.jid,
          queue: data.queue,
          class: data.class,
          args: data.args,
          createdAt: new Date(data.created_at * 1000),
          retry: data.retry,
          retryCount: data.retry_count,
          retriedAt: new Date(retryAt * 1000),
          errorMessage: data.error_message,
          errorClass: data.error_class,
          backtrace: data.backtrace
        });
      } catch (error) {
        console.error('Failed to parse retry job:', error);
      }
    }
    
    return result;
  }

  async getDeadJobs(server: ServerConfig, start = 0, stop = 99): Promise<Job[]> {
    const redis = await this.connectionManager.getConnection(server);
    const jobs = await redis.zrange('dead', start, stop, 'WITHSCORES');
    
    const result: Job[] = [];
    for (let i = 0; i < jobs.length; i += 2) {
      try {
        const data = JSON.parse(jobs[i]);
        const diedAt = parseInt(jobs[i + 1]);
        
        result.push({
          id: data.jid,
          queue: data.queue,
          class: data.class,
          args: data.args,
          createdAt: new Date(data.created_at * 1000),
          failedAt: new Date(diedAt * 1000),
          errorMessage: data.error_message,
          errorClass: data.error_class,
          backtrace: data.backtrace
        });
      } catch (error) {
        console.error('Failed to parse dead job:', error);
      }
    }
    
    return result;
  }

  async retryJob(server: ServerConfig, job: Job): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    const jobData = {
      jid: job.id,
      class: job.class,
      args: job.args,
      created_at: Math.floor(job.createdAt.getTime() / 1000),
      enqueued_at: Math.floor(Date.now() / 1000),
      retry: true,
      queue: job.queue
    };
    
    // First, remove the job from retry or dead set using Lua script for atomicity and performance
    await redis.eval(REMOVE_JOB_BY_JID_SCRIPT, 1, 'retry', job.id);
    await redis.eval(REMOVE_JOB_BY_JID_SCRIPT, 1, 'dead', job.id);
    
    // Now add to the queue
    await redis.lpush(`queue:${job.queue}`, JSON.stringify(jobData));
  }

  async deleteJob(server: ServerConfig, job: Job, from: 'queue' | 'retry' | 'dead' | 'scheduled'): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    // We need to find and delete the job by matching its ID
    switch (from) {
      case 'queue':
        // Use Lua script to find and delete the job server-side
        // This avoids transferring the entire queue content over the network
        // We use chunked iteration to avoid loading the entire queue into memory at once
        // This optimization drastically reduces client-side memory usage and network bandwidth
        await redis.eval(
          `
            local queue = KEYS[1]
            local jid = ARGV[1]
            local batch_size = 1000
            local start = 0
            local len = redis.call('LLEN', queue)

            while start < len do
              local end_idx = start + batch_size - 1
              local jobs = redis.call('LRANGE', queue, start, end_idx)

              if #jobs == 0 then
                break
              end

              for i, job in ipairs(jobs) do
                local success, parsed = pcall(cjson.decode, job)
                if success and parsed.jid == jid then
                  redis.call('LREM', queue, 1, job)
                  return 1
                end
              end

              start = start + batch_size
            end
            return 0
          `,
          1,
          `queue:${job.queue}`,
          job.id
        );
        break;
        
      case 'retry':
        await redis.eval(REMOVE_JOB_BY_JID_SCRIPT, 1, 'retry', job.id);
        break;
        
      case 'dead':
        await redis.eval(REMOVE_JOB_BY_JID_SCRIPT, 1, 'dead', job.id);
        break;
        
      case 'scheduled':
        await redis.eval(REMOVE_JOB_BY_JID_SCRIPT, 1, 'schedule', job.id);
        break;
    }
  }

  async clearQueue(server: ServerConfig, queueName: string): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    await redis.del(`queue:${queueName}`);
  }

  async clearRetrySet(server: ServerConfig): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    await redis.del('retry');
  }

  async clearDeadSet(server: ServerConfig): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    await redis.del('dead');
  }

  async getCronJobs(server: ServerConfig): Promise<CronJob[]> {
    const redis = await this.connectionManager.getConnection(server);
    
    console.log('Searching for cron jobs...');
    
    // Sidekiq-cron stores job data in a hash called 'cron_job' (singular)
    // and job names in a set called 'cron_jobs' (plural)
    let cronJobsHash: Record<string, string> = {};
    
    // First get the list of job names from the set
    const cronJobNames = await redis.smembers('cron_jobs');
    console.log('Found cron job names:', cronJobNames);
    
    // Then get the data for each job from the hash
    if (cronJobNames.length > 0) {
      // Get all data from the cron_job hash at once
      const allCronData = await redis.hgetall('cron_job');
      console.log('cron_job hash has', Object.keys(allCronData).length, 'entries');
      
      // Match the job names with their data
      for (const jobName of cronJobNames) {
        if (allCronData[jobName]) {
          cronJobsHash[jobName] = allCronData[jobName];
        }
      }
    }
    
    // Fallback: if no data found, try other patterns
    if (Object.keys(cronJobsHash).length === 0) {
      console.log('No jobs found in standard location, trying fallbacks...');
      
      // Try cron_jobs hash (plural)
      cronJobsHash = await redis.hgetall('cron_jobs');
      console.log('Checking cron_jobs hash:', Object.keys(cronJobsHash).length, 'entries');
      
      // Try with namespace
      if (Object.keys(cronJobsHash).length === 0) {
        cronJobsHash = await redis.hgetall('sidekiq:cron_jobs');
        console.log('Checking sidekiq:cron_jobs:', Object.keys(cronJobsHash).length, 'entries');
      }
    }
    
    const cronJobs: CronJob[] = [];
    
    for (const [name, data] of Object.entries(cronJobsHash)) {
      try {
        // Check if data is PHP serialized (starts with 'i:' for integer)
        if (typeof data === 'string' && data.startsWith('i:')) {
          // This is just a timestamp, not the full job data
          // The actual job data might be stored differently
          console.log(`Job ${name} has PHP serialized timestamp: ${data}`);
          
          // For PHP serialized data, we'll create a basic job entry
          // The timestamp appears to be the last run time
          const timestamp = parseInt(data.substring(2).replace(';', ''));
          
          cronJobs.push({
            name: name,
            cron: '* * * * *', // Default, since we don't have the actual schedule
            class: name, // Use name as class since we don't have the data
            queue: 'default',
            args: [],
            active: true,
            lastEnqueueTime: new Date(timestamp * 1000),
            nextEnqueueTime: undefined,
            description: undefined
          });
        } else {
          // Try parsing as JSON
          const jobData = JSON.parse(data as string);
          console.log('Parsing cron job:', name, jobData);
          
          // Get the last and next enqueue times if available
          const lastEnqueueTime = jobData.last_enqueue_time ? 
            new Date(jobData.last_enqueue_time * 1000) : undefined;
          const nextEnqueueTime = jobData.next_enqueue_time ? 
            new Date(jobData.next_enqueue_time * 1000) : undefined;
          
          cronJobs.push({
            name: name,
            cron: jobData.cron || jobData.schedule,
            class: jobData.klass || jobData.class,
            queue: jobData.queue || 'default',
            args: jobData.args,
            active: jobData.status !== 'disabled',
            lastEnqueueTime,
            nextEnqueueTime,
            description: jobData.description
          });
        }
      } catch (error) {
        console.error(`Failed to parse cron job ${name}:`, error);
        // Even if parsing fails, show the job with minimal info
        cronJobs.push({
          name: name,
          cron: 'Unknown',
          class: name,
          queue: 'default',
          args: [],
          active: true,
          lastEnqueueTime: undefined,
          nextEnqueueTime: undefined,
          description: undefined
        });
      }
    }
    
    console.log('Total cron jobs found:', cronJobs.length);
    return cronJobs.sort((a, b) => a.name.localeCompare(b.name));
  }


  async enableCronJob(server: ServerConfig, jobName: string): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    // Try different key patterns
    let jobData = await redis.hget('cron_jobs', jobName);
    let keyPattern = 'cron_jobs';
    
    if (!jobData) {
      jobData = await redis.hget('sidekiq:cron_jobs', jobName);
      keyPattern = 'sidekiq:cron_jobs';
    }
    
    if (!jobData) {
      jobData = await redis.get(`cron_job:${jobName}`);
      keyPattern = 'cron_job:';
    }
    
    if (jobData) {
      const job = JSON.parse(jobData);
      job.status = 'enabled';
      
      if (keyPattern === 'cron_job:') {
        await redis.set(`cron_job:${jobName}`, JSON.stringify(job));
      } else {
        await redis.hset(keyPattern, jobName, JSON.stringify(job));
      }
    }
  }


  async disableCronJob(server: ServerConfig, jobName: string): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    // Try different key patterns
    let jobData = await redis.hget('cron_jobs', jobName);
    let keyPattern = 'cron_jobs';
    
    if (!jobData) {
      jobData = await redis.hget('sidekiq:cron_jobs', jobName);
      keyPattern = 'sidekiq:cron_jobs';
    }
    
    if (!jobData) {
      jobData = await redis.get(`cron_job:${jobName}`);
      keyPattern = 'cron_job:';
    }
    
    if (jobData) {
      const job = JSON.parse(jobData);
      job.status = 'disabled';
      
      if (keyPattern === 'cron_job:') {
        await redis.set(`cron_job:${jobName}`, JSON.stringify(job));
      } else {
        await redis.hset(keyPattern, jobName, JSON.stringify(job));
      }
    }
  }


  async deleteCronJob(server: ServerConfig, jobName: string): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    // Try different key patterns
    const deleted1 = await redis.hdel('cron_jobs', jobName);
    const deleted2 = await redis.hdel('sidekiq:cron_jobs', jobName);
    const deleted3 = await redis.del(`cron_job:${jobName}`);
    
    // At least one should have been deleted
    if (!deleted1 && !deleted2 && !deleted3) {
      console.warn(`Cron job ${jobName} not found in any known location`);
    }
  }

  async enqueueCronJobNow(server: ServerConfig, cronJob: CronJob): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    // Create a job and enqueue it immediately
    const jobData = {
      jid: this.generateJobId(),
      class: cronJob.class,
      args: cronJob.args || [],
      created_at: Math.floor(Date.now() / 1000),
      enqueued_at: Math.floor(Date.now() / 1000),
      queue: cronJob.queue
    };
    
    await redis.lpush(`queue:${cronJob.queue}`, JSON.stringify(jobData));
  }

  private generateJobId(): string {
    // Generate a unique job ID similar to Sidekiq's format
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}${random}`;
  }
}
