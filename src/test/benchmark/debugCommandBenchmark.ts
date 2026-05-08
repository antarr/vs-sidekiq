import { Redis } from 'ioredis';

// Mock Redis
class MockRedis {
  public commands: Record<string, number> = {
    keys: 0,
    scan: 0
  };

  private data: Set<string>;

  constructor(itemCount: number, prefix: string) {
    this.data = new Set();
    for (let i = 0; i < itemCount; i++) {
      this.data.add(`${prefix}${i}`);
    }
    // Add some other keys
    for (let i = 0; i < 1000; i++) {
        this.data.add(`other:${i}`);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    this.commands.keys++;
    // Simulate blocking Redis behavior for large datasets
    // In real Redis, KEYS is O(N) and blocks everything.
    // We simulate this with a longer delay proportional to total keys.
    const totalKeys = this.data.size;
    await new Promise(resolve => setTimeout(resolve, totalKeys / 1000));

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.data).filter(key => regex.test(key));
  }

  async scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    this.commands.scan++;
    // Simulate non-blocking behavior
    // Each SCAN call is O(1) or O(count) but doesn't block as long as KEYS.
    await new Promise(resolve => setTimeout(resolve, 1));

    const matchIndex = args.indexOf('MATCH');
    const pattern = matchIndex !== -1 ? (args[matchIndex + 1] as string) : '*';
    const countIndex = args.indexOf('COUNT');
    const count = countIndex !== -1 ? (args[countIndex + 1] as number) : 10;

    const allKeys = Array.from(this.data);
    const cursorNum = parseInt(cursor, 10);

    const nextCursor = cursorNum + count;
    const batch = allKeys.slice(cursorNum, nextCursor);

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const keys = batch.filter(key => regex.test(key));

    const newCursor = nextCursor >= allKeys.length ? '0' : nextCursor.toString();

    return [newCursor, keys];
  }
}

async function scanAll(redis: any, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function runBenchmark() {
  const ITEM_COUNT = 10000;
  console.log(`Setting up benchmark with ${ITEM_COUNT} keys matching pattern...`);

  // --- KEYS benchmark ---
  const redisKeys = new MockRedis(ITEM_COUNT, 'worker:');
  console.log('\n--- Using KEYS ---');
  const startKeys = performance.now();
  const workerKeys1 = await redisKeys.keys('*worker*');
  const queueKeys1 = await redisKeys.keys('queue:*');
  const endKeys = performance.now();
  console.log(`Found ${workerKeys1.length} worker keys and ${queueKeys1.length} queue keys`);
  console.log(`Time: ${(endKeys - startKeys).toFixed(2)}ms`);
  console.log('Redis Commands:', redisKeys.commands);

  // --- SCAN benchmark ---
  const redisScan = new MockRedis(ITEM_COUNT, 'worker:');
  console.log('\n--- Using SCAN ---');
  const startScan = performance.now();
  const workerKeys2 = await scanAll(redisScan, '*worker*');
  const queueKeys2 = await scanAll(redisScan, 'queue:*');
  const endScan = performance.now();
  console.log(`Found ${workerKeys2.length} worker keys and ${queueKeys2.length} queue keys`);
  console.log(`Time: ${(endScan - startScan).toFixed(2)}ms`);
  console.log('Redis Commands:', redisScan.commands);

  const timeDiff = endKeys - startKeys - (endScan - startScan);
  console.log(`\nTime Difference: ${timeDiff.toFixed(2)}ms`);
  if (timeDiff > 0) {
      console.log('SCAN is faster in this simulation (simulating Redis non-blocking benefit)');
  } else {
      console.log('SCAN is slower in this simulation (as expected for total time, but it avoids blocking Redis)');
  }
  console.log('\nNote: In a real Redis environment, SCAN is preferred because it does not block the server, even if the total time to complete the scan is similar to or slightly longer than KEYS.');
}

runBenchmark().catch(console.error);
