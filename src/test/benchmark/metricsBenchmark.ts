import { MetricsService } from '../../core/metricsService';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    keys: 0,
    scan: 0,
    get: 0,
    mget: 0
  };

  private data: Map<string, string>;

  constructor(itemCount: number) {
    this.data = new Map();
    for (let i = 0; i < itemCount; i++) {
      const key = `metrics:test.job.metric:${Date.now() + i}`;
      this.data.set(key, Math.floor(Math.random() * 100).toString());
    }
  }

  async keys(_pattern: string): Promise<string[]> {
    this.commands.keys++;
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return Array.from(this.data.keys());
  }

  async get(key: string): Promise<string | null> {
    this.commands.get++;
    // Simulate network latency (0.1ms which is very optimistic for local, 1ms+ for remote)
    await new Promise(resolve => setTimeout(resolve, 0.1));
    return this.data.get(key) || null;
  }

  async scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    this.commands.scan++;
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 1));

    const countIndex = args.indexOf('COUNT');
    const count = countIndex !== -1 ? (args[countIndex + 1] as number) : 10;

    const allKeys = Array.from(this.data.keys());
    const cursorNum = parseInt(cursor, 10);

    const nextCursor = cursorNum + count;
    const keys = allKeys.slice(cursorNum, nextCursor);

    const newCursor = nextCursor >= allKeys.length ? '0' : nextCursor.toString();

    return [newCursor, keys];
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    this.commands.mget++;
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 1));
    return keys.map(key => this.data.get(key) || null);
  }
}

// Legacy implementation for comparison
async function legacyGetMetrics(redis: any): Promise<any[]> {
  const metricKeys = await redis.keys('metrics:*');
  const metricsData = [];

  for (const key of metricKeys) {
    const value = await redis.get(key);
    if (value) {
      metricsData.push({
        key,
        value: parseInt(value, 10) || 0,
        timestamp: key.split(':').pop() || ''
      });
    }
  }
  return metricsData;
}

async function runBenchmark() {
  const ITEM_COUNT = 5000;
  console.log(`Setting up benchmark with ${ITEM_COUNT} metrics...`);

  // --- Run Legacy ---
  const redisLegacy = new MockRedis(ITEM_COUNT);
  console.log('\n--- Legacy Implementation ---');
  const startLegacy = performance.now();

  await legacyGetMetrics(redisLegacy);

  const endLegacy = performance.now();
  console.log(`Time: ${(endLegacy - startLegacy).toFixed(2)}ms`);
  console.log('Redis Commands:', redisLegacy.commands);
  console.log(`Total Round Trips: ${Object.values(redisLegacy.commands).reduce((a, b) => a + b, 0)}`);


  // --- Run Optimized ---
  const redisOptimized = new MockRedis(ITEM_COUNT);
  const service = new MetricsService();

  console.log('\n--- Optimized Implementation ---');
  const startOptimized = performance.now();

  // @ts-ignore - MockRedis is not fully compatible with IORedis types but sufficient for this test
  await service.getMetrics(redisOptimized as any);

  const endOptimized = performance.now();
  console.log(`Time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
  console.log('Redis Commands:', redisOptimized.commands);
  console.log(`Total Round Trips: ${Object.values(redisOptimized.commands).reduce((a, b) => a + b, 0)}`);

  // Validation
  const improvement = (endLegacy - startLegacy) / (endOptimized - startOptimized);
  console.log(`\nSpeed Improvement: ${improvement.toFixed(2)}x`);

  const roundTripReduction =
    Object.values(redisLegacy.commands).reduce((a, b) => a + b, 0) /
    Object.values(redisOptimized.commands).reduce((a, b) => a + b, 0);
  console.log(`Round Trip Reduction: ${roundTripReduction.toFixed(2)}x`);
}

runBenchmark().catch(console.error);
