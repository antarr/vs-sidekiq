import Redis from 'ioredis';
import { ConnectionManager } from './connectionManager';
import { ServerConfig } from '../data/models/server';
import { Queue, Job, Worker, SidekiqStats } from '../data/models/sidekiq';

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
    
    const queues: Queue[] = [];
    for (const name of queueNames) {
      const size = await redis.llen(`queue:${name}`);
      const latency = await this.getQueueLatency(redis, name);
      
      queues.push({
        name,
        size,
        latency,
        paused: false // TODO: Check if queue is paused
      });
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

  private async getQueueLatency(redis: Redis, queueName: string): Promise<number> {
    const job = await redis.lindex(`queue:${queueName}`, -1);
    if (!job) return 0;
    
    try {
      const data = JSON.parse(job);
      const enqueuedAt = data.enqueued_at || data.created_at;
      return Math.max(0, Date.now() / 1000 - enqueuedAt);
    } catch {
      return 0;
    }
  }
}