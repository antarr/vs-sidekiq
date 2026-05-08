import { SidekiqClient } from '../../core/sidekiqClient';
import { ServerConfig } from '../../data/models/server';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    smembers: 0,
    llen: 0,
    lindex: 0,
    pipeline: 0,
    exec: 0,
    sismember: 0
  };

  private queues: string[];
  private data: Map<string, any>;

  constructor(queueCount: number) {
    this.queues = [];
    this.data = new Map();
    for (let i = 0; i < queueCount; i++) {
      const name = `queue_${i}`;
      this.queues.push(name);
      this.data.set(`queue:${name}:size`, 100 + i);
      this.data.set(`queue:${name}:last_job`, JSON.stringify({
        enqueued_at: Date.now() / 1000 - 60,
        jid: `jid_${i}`
      }));
    }
  }

  async smembers(key: string): Promise<string[]> {
    this.commands.smembers++;
    // 1ms network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    if (key === 'queues') return this.queues;
    if (key === 'paused') return [];
    return [];
  }

  async llen(key: string): Promise<number> {
    this.commands.llen++;
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(`${key}:size`) || 0;
  }

  async lindex(key: string, index: number): Promise<string | null> {
    this.commands.lindex++;
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(`${key}:last_job`) || null;
  }

  pipeline() {
    this.commands.pipeline++;
    const commands: any[] = [];
    const p = {
      llen: (key: string) => {
        commands.push({ name: 'llen', key });
        return p;
      },
      lindex: (key: string, index: number) => {
        commands.push({ name: 'lindex', key, index });
        return p;
      },
      sismember: (key: string, member: string) => {
        commands.push({ name: 'sismember', key, member });
        return p;
      },
      exec: async () => {
        this.commands.exec++;
        // 1ms network latency for the whole batch
        await new Promise(resolve => setTimeout(resolve, 1));
        return Promise.all(commands.map(async cmd => {
          if (cmd.name === 'llen') {
            return [null, this.data.get(`${cmd.key}:size`) || 0];
          } else if (cmd.name === 'lindex') {
            return [null, this.data.get(`${cmd.key}:last_job`) || null];
          } else {
            return [null, 0];
          }
        }));
      }
    };
    return p;
  }
}

async function runBenchmark() {
  const QUEUE_COUNT = 100;
  const targetQueueName = `queue_50`;
  console.log(`Setting up benchmark with ${QUEUE_COUNT} queues...`);

  const mockRedis = new MockRedis(QUEUE_COUNT);
  const mockConnectionManager = {
    getConnection: () => Promise.resolve(mockRedis)
  } as any;

  const client = new SidekiqClient(mockConnectionManager);
  const server = { id: 'test' } as ServerConfig;

  // --- Current Approach ---
  console.log('\n--- Current Approach (getQueues + find) ---');
  const startLegacy = performance.now();

  const queues = await client.getQueues(server);
  const _queue = queues.find(q => q.name === targetQueueName);

  const endLegacy = performance.now();
  console.log(`Time: ${(endLegacy - startLegacy).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  // smembers('queues') + pipeline.exec
  const totalRoundTripsLegacy = mockRedis.commands.smembers + mockRedis.commands.exec;
  console.log(`Total Round Trips: ${totalRoundTripsLegacy}`);

  // Reset counters
  mockRedis.commands = { smembers: 0, llen: 0, lindex: 0, pipeline: 0, exec: 0, sismember: 0 };

  // --- Optimized Approach (getQueue) ---
  console.log('\n--- Optimized Approach (getQueue) ---');

  const startOptimized = performance.now();
  await client.getQueue(server, targetQueueName);
  const endOptimized = performance.now();

  console.log(`Time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  const totalRoundTripsOptimized = mockRedis.commands.exec;
  console.log(`Total Round Trips: ${totalRoundTripsOptimized}`);

  console.log(`\nMeasured Speed Improvement: ${((endLegacy - startLegacy) / (endOptimized - startOptimized)).toFixed(2)}x`);
  console.log(`Measured Round Trip Reduction: ${(totalRoundTripsLegacy / totalRoundTripsOptimized).toFixed(2)}x`);
}

runBenchmark().catch(console.error);
