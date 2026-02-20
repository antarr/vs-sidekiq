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

  private workerIds: string[] = [];
  private workerData: Map<string, any> = new Map();
  private workerJobs: Map<string, string> = new Map();

  constructor(workerCount: number) {
    for (let i = 0; i < workerCount; i++) {
      const id = `host:123:${i}`;
      this.workerIds.push(id);

      const isBusy = i % 2 === 0; // Half are busy
      this.workerData.set(id, {
        info: JSON.stringify({
          hostname: 'host',
          pid: 123,
          tag: 'default',
          started_at: Date.now() / 1000,
          queues: ['default']
        }),
        busy: isBusy ? '1' : '0'
      });

      if (isBusy) {
        this.workerJobs.set(`${id}:work`, JSON.stringify({
          payload: {
            jid: `job-${i}`,
            class: 'TestJob',
            args: [],
            created_at: Date.now() / 1000
          },
          queue: 'default'
        }));
      }
    }
  }

  async smembers(key: string): Promise<string[]> {
    this.commands.smembers++;
    await new Promise(resolve => setTimeout(resolve, 1)); // Network latency
    if (key === 'processes') return this.workerIds;
    return [];
  }

  async hgetall(key: string): Promise<any> {
    this.commands.hgetall++;
    await new Promise(resolve => setTimeout(resolve, 1)); // Network latency
    return this.workerData.get(key) || {};
  }

  async get(key: string): Promise<string | null> {
    this.commands.get++;
    await new Promise(resolve => setTimeout(resolve, 1)); // Network latency
    return this.workerJobs.get(key) || null;
  }

  pipeline() {
    this.commands.pipeline++;
    const commands: any[] = [];
    const pipelineObj = {
      hgetall: (key: string) => {
        commands.push(['hgetall', key]);
        return pipelineObj;
      },
      get: (key: string) => {
        commands.push(['get', key]);
        return pipelineObj;
      },
      exec: async () => {
        this.commands.exec++;
        await new Promise(resolve => setTimeout(resolve, 1)); // One round trip for all
        return commands.map(([cmd, key]) => {
            if (cmd === 'hgetall') return [null, this.workerData.get(key) || {}];
            if (cmd === 'get') return [null, this.workerJobs.get(key) || null];
            return [null, null];
        });
      }
    };
    return pipelineObj;
  }
}

// Mock ConnectionManager
const mockRedis = new MockRedis(100); // 100 workers
const mockConnectionManager = {
  getConnection: async (_server: ServerConfig) => mockRedis
} as any;

const client = new SidekiqClient(mockConnectionManager);

async function runBenchmark() {
    console.log('Starting benchmark with 100 workers...');
    const start = performance.now();

    // @ts-ignore
    const workers = await client.getWorkers({} as ServerConfig);

    const end = performance.now();
    console.log(`Time: ${(end - start).toFixed(2)}ms`);
    const totalCommands = Object.values(mockRedis.commands).reduce((a, b) => a + b, 0);
    const totalRoundTrips = mockRedis.commands.smembers + mockRedis.commands.exec;
    console.log('Redis Commands:', mockRedis.commands);
    console.log(`Total Commands: ${totalCommands}`);
    console.log(`Total Round Trips: ${totalRoundTrips}`);
    console.log(`Workers found: ${workers.length}`);
}

runBenchmark().catch(console.error);
