import { SidekiqClient } from '../../core/sidekiqClient';
import { ServerConfig } from '../../data/models/server';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    smembers: 0,
    hgetall: 0,
    get: 0,
    pipeline: 0,
    exec: 0
  };

  private data: Map<string, any>;
  private workers: string[];

  constructor(workerCount: number) {
    this.data = new Map();
    this.workers = [];
    for (let i = 0; i < workerCount; i++) {
      const workerId = `worker:${i}:pid:${1000 + i}`;
      this.workers.push(workerId);
      this.data.set(workerId, {
        info: JSON.stringify({
          hostname: `host-${i}`,
          pid: 1000 + i,
          queues: ['default'],
          started_at: Date.now() / 1000 - 3600
        }),
        busy: i % 2 === 0 ? '1' : '0'
      });
      if (i % 2 === 0) {
        this.data.set(`${workerId}:work`, JSON.stringify({
          queue: 'default',
          payload: {
            jid: `jid-${i}`,
            class: 'TestJob',
            args: [],
            created_at: Date.now() / 1000 - 60
          }
        }));
      }
    }
  }

  async smembers(key: string): Promise<string[]> {
    this.commands.smembers++;
    // 1ms network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    if (key === 'processes') return this.workers;
    return [];
  }

  async hgetall(key: string): Promise<any> {
    this.commands.hgetall++;
    // 1ms network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(key) || {};
  }

  async get(key: string): Promise<string | null> {
    this.commands.get++;
    // 1ms network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(key) || null;
  }

  pipeline() {
    this.commands.pipeline++;
    const commands: any[] = [];
    const p = {
      hgetall: (key: string) => {
        commands.push({ name: 'hgetall', key });
        return p;
      },
      get: (key: string) => {
        commands.push({ name: 'get', key });
        return p;
      },
      exec: async () => {
        this.commands.exec++;
        // 1ms network latency for the whole batch
        await new Promise(resolve => setTimeout(resolve, 1));
        return Promise.all(commands.map(async cmd => {
          if (cmd.name === 'hgetall') {
            return [null, this.data.get(cmd.key) || {}];
          } else {
            return [null, this.data.get(cmd.key) || null];
          }
        }));
      }
    };
    return p;
  }
}

async function runBenchmark() {
  const WORKER_COUNT = 100;
  const targetWorkerId = `worker:50:pid:1050`;
  console.log(`Setting up benchmark with ${WORKER_COUNT} workers...`);

  const mockRedis = new MockRedis(WORKER_COUNT);
  const mockConnectionManager = {
    getConnection: () => Promise.resolve(mockRedis)
  } as any;

  const client = new SidekiqClient(mockConnectionManager);
  const server = { id: 'test' } as ServerConfig;

  // --- Current Approach ---
  console.log('\n--- Current Approach (getWorkers + find) ---');
  const startLegacy = performance.now();

  const workers = await client.getWorkers(server);
  const worker = workers.find(w => w.id === targetWorkerId);

  const endLegacy = performance.now();
  console.log(`Time: ${(endLegacy - startLegacy).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  const totalRoundTripsLegacy = mockRedis.commands.smembers + mockRedis.commands.hgetall + mockRedis.commands.get;
  console.log(`Total Round Trips: ${totalRoundTripsLegacy}`);

  // Reset counters
  mockRedis.commands = { smembers: 0, hgetall: 0, get: 0, pipeline: 0, exec: 0 };

  // --- Optimized Approach (getWorker) ---
  console.log('\n--- Optimized Approach (getWorker) ---');
  const startOptimized = performance.now();

  await client.getWorker(server, targetWorkerId);

  const endOptimized = performance.now();
  console.log(`Time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  const totalRoundTripsOptimized = mockRedis.commands.exec;
  console.log(`Total Round Trips: ${totalRoundTripsOptimized}`);

  console.log(`\nEstimated Speed Improvement: ${((endLegacy - startLegacy) / (endOptimized - startOptimized)).toFixed(2)}x`);
  console.log(`Estimated Round Trip Reduction: ${(totalRoundTripsLegacy / totalRoundTripsOptimized).toFixed(2)}x`);
}

runBenchmark().catch(console.error);
