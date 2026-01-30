import { SidekiqClient } from '../core/sidekiqClient';
import { ConnectionManager } from '../core/connectionManager';
import { ServerConfig, ServerEnvironment } from '../data/models/server';

// Mock delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const LATENCY_MS = 5;

// Mock Redis
class MockRedis {
  private data: Map<string, string>;

  constructor() {
    this.data = new Map();
  }

  setData(key: string, value: string) {
    this.data.set(key, value);
  }

  async smembers(key: string): Promise<string[]> {
    await delay(LATENCY_MS);
    if (key === 'workers') {
      // Return 50 worker IDs
      return Array.from({ length: 50 }, (_, i) => `${i}`);
    }
    return [];
  }

  async get(key: string): Promise<string | null> {
    await delay(LATENCY_MS);
    return this.data.get(key) || null;
  }

  async mget(...args: any[]): Promise<(string | null)[]> {
    await delay(LATENCY_MS);
    let keys: string[] = [];
    if (Array.isArray(args[0])) {
        keys = args[0];
    } else {
        keys = args as string[];
    }
    return keys.map(key => this.data.get(key) || null);
  }

  pipeline() {
      return {
          exec: async () => []
      }
  }
}

// Mock ConnectionManager
const mockRedis = new MockRedis();
const mockConnectionManager = {
  getConnection: async (_server: ServerConfig) => mockRedis
} as unknown as ConnectionManager;

// Setup data
for (let i = 0; i < 50; i++) {
  mockRedis.setData(`worker:${i}`, JSON.stringify({
    hostname: `host-${i}`,
    pid: 1000 + i,
    tag: `default`,
    queues: ['default'],
    payload: {
      jid: `job-${i}`,
      class: 'TestJob',
      args: [],
      created_at: Date.now() / 1000
    }
  }));
  mockRedis.setData(`worker:${i}:started`, (Date.now() / 1000).toString());
}

async function runBenchmark() {
  console.log('Starting benchmark with simulated latency:', LATENCY_MS, 'ms');
  console.log('Number of workers:', 50);

  // 1. Unoptimized (N+1)
  console.log('\n--- Unoptimized (N+1) ---');
  const startUnopt = Date.now();

  const workerIds = await mockRedis.smembers('workers');
  const workersUnopt = [];
  for (const id of workerIds) {
    // Simulate the unoptimized code: await redis.mget(`worker:${id}`, `worker:${id}:started`)
    const [info, startedAt] = await mockRedis.mget(
      `worker:${id}`,
      `worker:${id}:started`
    );

    if (info) {
        workersUnopt.push({ id, info, startedAt });
    }
  }

  const durationUnopt = Date.now() - startUnopt;
  console.log(`Time taken: ${durationUnopt}ms`);


  // 2. Optimized (mget) via SidekiqClient
  console.log('\n--- Optimized (SidekiqClient) ---');
  const client = new SidekiqClient(mockConnectionManager);
  const server: ServerConfig = {
    id: '1',
    name: 'test',
    host: 'localhost',
    port: 6379,
    password: '',
    database: 0,
    environment: ServerEnvironment.Development
  };

  const startOpt = Date.now();
  const workersOpt = await client.getWorkers(server);
  const durationOpt = Date.now() - startOpt;
  console.log(`Time taken: ${durationOpt}ms`);
  console.log(`Fetched ${workersOpt.length} workers.`);

  console.log('\n--- Results ---');
  console.log(`Improvement: ${(durationUnopt / durationOpt).toFixed(2)}x faster`);

  if (durationOpt > durationUnopt) {
      console.error('FAIL: Optimized version is slower!');
      process.exit(1);
  }
}

runBenchmark().catch(console.error);
