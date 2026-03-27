
import { performance } from 'perf_hooks';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    smembers: 0,
    hgetall: 0,
    pipeline: 0,
    exec: 0
  };

  private data: Map<string, any>;
  private processes: string[];

  constructor(processCount: number) {
    this.data = new Map();
    this.processes = [];
    for (let i = 0; i < processCount; i++) {
      const processId = `process:${i}:pid:${1000 + i}`;
      this.processes.push(processId);
      this.data.set(processId, {
        info: JSON.stringify({
          hostname: `host-${i}`,
          pid: 1000 + i,
          queues: ['default', 'high'],
          tag: 'worker-tag'
        }),
        busy: '5'
      });
    }
  }

  async smembers(key: string): Promise<string[]> {
    this.commands.smembers++;
    // simulate network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    if (key === 'processes') return this.processes;
    return [];
  }

  async hgetall(key: string): Promise<any> {
    this.commands.hgetall++;
    // simulate network latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.data.get(key) || {};
  }

  pipeline() {
    this.commands.pipeline++;
    const self = this;
    const commands: any[] = [];
    const p = {
      hgetall: (key: string) => {
        commands.push({ name: 'hgetall', key });
        return p;
      },
      exec: async () => {
        self.commands.exec++;
        // 1ms network latency for the whole batch
        await new Promise(resolve => setTimeout(resolve, 1));
        return commands.map(cmd => {
          if (cmd.name === 'hgetall') {
            return [null, self.data.get(cmd.key) || {}];
          }
          return [null, null];
        });
      }
    };
    return p;
  }
}

async function runBenchmark() {
  const PROCESS_COUNT = 50;
  console.log(`Setting up benchmark with ${PROCESS_COUNT} processes...`);

  const mockRedis = new MockRedis(PROCESS_COUNT);

  // --- Current Approach (N+1) ---
  console.log('\n--- Current Approach (N+1 hgetall) ---');
  const debugInfoLegacy: string[] = [];
  const startLegacy = performance.now();

  const processes = await mockRedis.smembers('processes');
  if (processes.length > 0) {
    for (const processId of processes) {
      const processData = await mockRedis.hgetall(processId);
      if (processData.info) {
        const info = JSON.parse(processData.info);
        debugInfoLegacy.push(`    - ${processId}`);
        debugInfoLegacy.push(`      Hostname: ${info.hostname}`);
        debugInfoLegacy.push(`      PID: ${info.pid}`);
      }
    }
  }

  const endLegacy = performance.now();
  console.log(`Time: ${(endLegacy - startLegacy).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  const totalRoundTripsLegacy = mockRedis.commands.smembers + mockRedis.commands.hgetall;
  console.log(`Total Round Trips: ${totalRoundTripsLegacy}`);

  // Reset counters
  mockRedis.commands = { smembers: 0, hgetall: 0, pipeline: 0, exec: 0 };

  // --- Optimized Approach (Pipeline) ---
  console.log('\n--- Optimized Approach (Pipeline) ---');
  const debugInfoOptimized: string[] = [];
  const startOptimized = performance.now();

  const processes2 = await mockRedis.smembers('processes');
  if (processes2.length > 0) {
    const pipeline = mockRedis.pipeline();
    for (const processId of processes2) {
      pipeline.hgetall(processId);
    }
    const results = await pipeline.exec();

    for (let i = 0; i < processes2.length; i++) {
      const processId = processes2[i];
      const result = results[i];
      const processData = result[1];

      if (processData && processData.info) {
        const info = JSON.parse(processData.info);
        debugInfoOptimized.push(`    - ${processId}`);
        debugInfoOptimized.push(`      Hostname: ${info.hostname}`);
        debugInfoOptimized.push(`      PID: ${info.pid}`);
      }
    }
  }

  const endOptimized = performance.now();
  console.log(`Time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
  console.log('Redis Commands:', { ...mockRedis.commands });
  const totalRoundTripsOptimized = mockRedis.commands.smembers + mockRedis.commands.exec;
  console.log(`Total Round Trips: ${totalRoundTripsOptimized}`);

  console.log(`\nEstimated Speed Improvement: ${((endLegacy - startLegacy) / (endOptimized - startOptimized)).toFixed(2)}x`);
  console.log(`Estimated Round Trip Reduction: ${(totalRoundTripsLegacy / totalRoundTripsOptimized).toFixed(2)}x`);

  // Verify output
  if (JSON.stringify(debugInfoLegacy) === JSON.stringify(debugInfoOptimized)) {
    console.log('\n✅ Outputs match!');
  } else {
    console.error('\n❌ Outputs do not match!');
    process.exit(1);
  }
}

runBenchmark().catch(console.error);
