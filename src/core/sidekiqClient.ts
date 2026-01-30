import { ConnectionManager } from './connectionManager';
import { ServerConfig } from '../data/models/server';
import { Queue, Job, Worker, SidekiqStats /* , CronJob */ } from '../data/models/sidekiq';

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
    const workerIds = await redis.smembers('workers');
    
    const workers: Worker[] = [];
    for (const id of workerIds) {
      const [info, startedAt] = await redis.mget(
        `worker:${id}`,
        `worker:${id}:started`
      );
      
      if (info) {
        try {
          const data = JSON.parse(info);
          workers.push({
            id,
            hostname: data.hostname || id.split(':')[0],
            pid: data.pid || id.split(':')[1],
            tag: data.tag,
            started_at: startedAt ? new Date(parseInt(startedAt) * 1000) : new Date(),
            job: data.payload ? {
              id: data.payload.jid,
              queue: data.queue,
              class: data.payload.class,
              args: data.payload.args,
              createdAt: new Date(data.payload.created_at * 1000)
            } : undefined,
            queues: data.queues || []
          });
        } catch (error) {
          console.error('Failed to parse worker:', error);
        }
      }
    }
    
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
    
    // First, remove the job from retry or dead set
    // We need to find the exact JSON string
    const retryJobs = await redis.zrange('retry', 0, -1);
    for (const rawJob of retryJobs) {
      try {
        const parsedJob = JSON.parse(rawJob);
        if (parsedJob.jid === job.id) {
          await redis.zrem('retry', rawJob);
          break;
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
    
    const deadJobs = await redis.zrange('dead', 0, -1);
    for (const rawJob of deadJobs) {
      try {
        const parsedJob = JSON.parse(rawJob);
        if (parsedJob.jid === job.id) {
          await redis.zrem('dead', rawJob);
          break;
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
    
    // Now add to the queue
    await redis.lpush(`queue:${job.queue}`, JSON.stringify(jobData));
  }

  async deleteJob(server: ServerConfig, job: Job, from: 'queue' | 'retry' | 'dead' | 'scheduled'): Promise<void> {
    const redis = await this.connectionManager.getConnection(server);
    
    // We need to find and delete the job by matching its ID
    switch (from) {
      case 'queue':
        // For queues, we need to get all jobs and filter
        const queueJobs = await redis.lrange(`queue:${job.queue}`, 0, -1);
        for (const rawJob of queueJobs) {
          try {
            const parsedJob = JSON.parse(rawJob);
            if (parsedJob.jid === job.id) {
              await redis.lrem(`queue:${job.queue}`, 1, rawJob);
              break;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
        break;
        
      case 'retry':
        // For sorted sets, we need to get all members and find the matching one
        const retryJobs = await redis.zrange('retry', 0, -1);
        for (const rawJob of retryJobs) {
          try {
            const parsedJob = JSON.parse(rawJob);
            if (parsedJob.jid === job.id) {
              await redis.zrem('retry', rawJob);
              break;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
        break;
        
      case 'dead':
        const deadJobs = await redis.zrange('dead', 0, -1);
        for (const rawJob of deadJobs) {
          try {
            const parsedJob = JSON.parse(rawJob);
            if (parsedJob.jid === job.id) {
              await redis.zrem('dead', rawJob);
              break;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
        break;
        
      case 'scheduled':
        const scheduledJobs = await redis.zrange('schedule', 0, -1);
        for (const rawJob of scheduledJobs) {
          try {
            const parsedJob = JSON.parse(rawJob);
            if (parsedJob.jid === job.id) {
              await redis.zrem('schedule', rawJob);
              break;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
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

  /* Disabled - focusing on core Sidekiq features
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

  */

  /* Disabled - focusing on core Sidekiq features
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

  */

  /* Disabled - focusing on core Sidekiq features
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

  */

  /* Disabled - focusing on core Sidekiq features
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

  */

  /* Disabled - focusing on core Sidekiq features
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
  */

  /* Disabled - only used by cron features
  private generateJobId(): string {
    // Generate a unique job ID similar to Sidekiq's format
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}${random}`;
  }
  */
}