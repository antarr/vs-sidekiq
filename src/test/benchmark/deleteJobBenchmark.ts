import { SidekiqClient } from '../../core/sidekiqClient';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig, ServerEnvironment } from '../../data/models/server';
import { Job } from '../../data/models/sidekiq';

// Mock Redis
class MockRedis {
    private data: string[];

    constructor(size: number, targetId: string) {
        this.data = [];
        for (let i = 0; i < size; i++) {
            const id = i === size / 2 ? targetId : `job-${i}`; // Put target in middle
            const job = {
                jid: id,
                class: 'TestJob',
                args: [],
                created_at: Date.now() / 1000
            };
            this.data.push(JSON.stringify(job));
        }
    }

    async lrange(_key: string, start: number, stop: number) {
        // Simulate network delay slightly per call to make it realistic?
        // Or just let CPU parsing be the bottleneck.
        if (stop === -1) {
             // Return copy to simulate deserialization from network buffer
             return [...this.data];
        }
        // Slice
        // stop is inclusive in Redis
        const end = stop === -1 ? undefined : stop + 1;
        return this.data.slice(start, end);
    }

    async lrem(_key: string, _count: number, _val: string) {
        return 1;
    }

    async eval(_script: string, _numKeys: number, _key: string, _arg: string) {
         return 1;
    }

    pipeline() { return { exec: async () => [] }; }
}

async function runBenchmark() {
    const JOB_COUNT = 50000; // Increase count to make it noticeable
    const TARGET_ID = 'target-job-id';

    const mockRedis = new MockRedis(JOB_COUNT, TARGET_ID);

    const mockConnectionManager = {
        getConnection: () => Promise.resolve(mockRedis)
    } as unknown as ConnectionManager;

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

    const job: Job = {
        id: TARGET_ID,
        queue: 'default',
        class: 'TestJob',
        args: [],
        createdAt: new Date()
    };

    global.gc && global.gc();
    const startHeap = process.memoryUsage().heapUsed;
    const startTime = process.hrtime();

    await client.deleteJob(server, job, 'queue');

    const endTime = process.hrtime(startTime);
    const endHeap = process.memoryUsage().heapUsed;

    const timeInMs = (endTime[0] * 1000 + endTime[1] / 1e6).toFixed(2);
    const heapDiff = ((endHeap - startHeap) / 1024 / 1024).toFixed(2);

    console.log(`Jobs: ${JOB_COUNT}`);
    console.log(`Time: ${timeInMs}ms`);
    console.log(`Heap Diff: ${heapDiff}MB`);
}

runBenchmark();
