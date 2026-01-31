export interface Queue {
  name: string;
  size: number;
  latency: number;
  paused: boolean;
  serverId?: string;
}

export interface Job {
  id: string;
  queue: string;
  class: string;
  args: any[];
  createdAt: Date;
  enqueuedAt?: Date;
  scheduledAt?: Date;
  retry?: boolean;
  retryCount?: number;
  retriedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  errorClass?: string;
  backtrace?: string[];
  serverId?: string;
}

export interface Worker {
  id: string;
  hostname: string;
  pid: string;
  tag?: string;
  started_at: Date;
  job?: Job;
  queues: string[];
  serverId?: string;
  // Process details
  concurrency?: number;
  busy?: number;
  beat?: number;
  quiet?: boolean;
  rss?: number;
}

export interface SidekiqStats {
  processed: number;
  failed: number;
  scheduled: number;
  retries: number;
  dead: number;
  processes: number;
  default_queue_latency: number;
  workers: number;
  enqueued: number;
  serverId?: string;
}

export interface Process {
  id: string;
  hostname: string;
  started_at: Date;
  pid: number;
  tag?: string;
  concurrency: number;
  queues: string[];
  busy: number;
  beat?: number;
  quiet?: boolean;
}

export interface HistoricalMetric {
  timestamp: Date;
  processed: number;
  failed: number;
  queues: number;
  workers: number;
  serverId?: string;
}

export interface JobMetrics {
  totalProcessed: number;
  totalFailed: number;
  successRate: number;
  averageProcessingTime: number;
  peakHour: string;
  topQueues: Array<{ name: string; count: number }>;
  topJobClasses: Array<{ name: string; count: number }>;
  errorRate: number;
  serverId?: string;
}

export interface CronJob {
  name: string;
  cron: string;
  class: string;
  queue: string;
  args?: any[];
  active?: boolean;
  lastEnqueueTime?: Date;
  nextEnqueueTime?: Date;
  description?: string;
  serverId?: string;
}
