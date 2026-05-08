import { performance } from 'perf_hooks';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    hgetall: 0,
    pipeline: 0,
    exec: 0
  };

  private data: Map<string, any>;

  constructor(processCount: number) {
    this.data = new Map();
    for (let i = 0; i < processCount; i++) {
      const processId = `process:${i}`;
      this.data.set(processId, {
        info: JSON.stringify({
          hostname: `host-${i}`,
          pid: 1000 + i,
          tag: 'test',
          queues: ['default']
        }),
        busy: '1'
      });
    }
  }

  async hgetall(key: string): Promise<any> {
    this.commands.hgetall++;
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(key) || {};
  }

  pipeline() {
    this.commands.pipeline++;
    const commands: any[] = [];
    const p = {
      hgetall: (key: string) => {
        commands.push({ name: 'hgetall', key });
        return p;
      },
      exec: async () => {
        this.commands.exec++;
        // Simulate network latency for the whole batch
        await new Promise(resolve => setTimeout(resolve, 1));
        return Promise.all(commands.map(async cmd => {
          return [null, this.data.get(cmd.key) || {}];
        }));
      }
    };
    return p;
  }
}

async function legacyApproach(redis: any, processes: string[]) {
  const debugInfo: string[] = [];
  for (const processId of processes) {
    const processData = await redis.hgetall(processId);
    if (processData.info) {
      const info = JSON.parse(processData.info);
      debugInfo.push(`    - ${processId}`);
      debugInfo.push(`      Hostname: ${info.hostname}`);
      debugInfo.push(`      PID: ${info.pid}`);
      debugInfo.push(`      Tag: ${info.tag || 'none'}`);
      debugInfo.push(`      Busy: ${processData.busy || 0}`);
      debugInfo.push(`      Queues: ${info.queues.length} queues`);
    }
  }
  return debugInfo;
}

async function optimizedApproach(redis: any, processes: string[]) {
  const debugInfo: string[] = [];
  const pipeline = redis.pipeline();
  for (const processId of processes) {
    pipeline.hgetall(processId);
  }
  const results = await pipeline.exec();

  for (let i = 0; i < processes.length; i++) {
    const processId = processes[i];
    const [err, processData] = results[i];
    if (err || !processData) continue;

    if (processData.info) {
      const info = JSON.parse(processData.info);
      debugInfo.push(`    - ${processId}`);
      debugInfo.push(`      Hostname: ${info.hostname}`);
      debugInfo.push(`      PID: ${info.pid}`);
      debugInfo.push(`      Tag: ${info.tag || 'none'}`);
      debugInfo.push(`      Busy: ${processData.busy || 0}`);
      debugInfo.push(`      Queues: ${info.queues.length} queues`);
    }
  }
  return debugInfo;
}

async function runBenchmark() {
  const PROCESS_COUNT = 50;
  const processes = Array.from({ length: PROCESS_COUNT }, (_, i) => `process:${i}`);

  console.log(`Benchmark: Fetching data for ${PROCESS_COUNT} processes`);

  // Legacy
  const redisLegacy = new MockRedis(PROCESS_COUNT);
  const startLegacy = performance.now();
  await legacyApproach(redisLegacy, processes);
  const endLegacy = performance.now();
  console.log('\n--- Legacy Approach ---');
  console.log(`Time: ${(endLegacy - startLegacy).toFixed(2)}ms`);
  console.log(`Round Trips: ${redisLegacy.commands.hgetall}`);

  // Optimized
  const redisOptimized = new MockRedis(PROCESS_COUNT);
  const startOptimized = performance.now();
  await optimizedApproach(redisOptimized, processes);
  const endOptimized = performance.now();
  console.log('\n--- Optimized Approach ---');
  console.log(`Time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
  console.log(`Round Trips: ${redisOptimized.commands.exec}`);

  console.log(`\nImprovement: ${((endLegacy - startLegacy) / (endOptimized - startOptimized)).toFixed(2)}x speedup`);
}

runBenchmark().catch(console.error);
