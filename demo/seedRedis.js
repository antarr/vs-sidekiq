"use strict";
/**
 * Seed Redis with demo Sidekiq data for screenshots
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = __importDefault(require("ioredis"));
const demoData_1 = require("./demoData");
const REDIS_HOST = 'localhost';
const REDIS_PORT = 6380;
async function seedRedis() {
    console.log('🌱 Seeding Redis with demo data (correct dates)...');
    const redis = new ioredis_1.default({
        host: REDIS_HOST,
        port: REDIS_PORT,
        retryStrategy: (times) => {
            if (times > 3) {
                console.error('❌ Could not connect to Redis');
                process.exit(1);
            }
            return Math.min(times * 100, 2000);
        }
    });
    try {
        await redis.ping();
        console.log('✅ Connected to Redis');
        // Clear existing data
        await redis.flushdb();
        console.log('🧹 Cleared existing data');
        // Set up queues
        await redis.sadd('queues', ...demoData_1.demoQueues);
        for (const queue of demoData_1.demoQueues) {
            const queueJobs = demoData_1.demoJobs.filter(j => j.queue === queue);
            if (queueJobs.length > 0) {
                const serializedJobs = queueJobs.map(j => JSON.stringify(j));
                await redis.lpush(`queue:${queue}`, ...serializedJobs);
            }
        }
        console.log(`📋 Added ${demoData_1.demoJobs.length} queued jobs`);
        // Set up scheduled jobs
        for (const job of demoData_1.demoScheduledJobs) {
            await redis.zadd('schedule', job.at, JSON.stringify(job));
        }
        console.log(`⏰ Added ${demoData_1.demoScheduledJobs.length} scheduled jobs`);
        // Set up retry jobs
        for (const job of demoData_1.demoRetryJobs) {
            const score = job.failed_at + (Math.pow(job.retry_count + 1, 4) + 15);
            await redis.zadd('retry', score, JSON.stringify(job));
        }
        console.log(`🔄 Added ${demoData_1.demoRetryJobs.length} retry jobs`);
        // Set up dead jobs
        for (const job of demoData_1.demoDeadJobs) {
            await redis.zadd('dead', job.failed_at, JSON.stringify(job));
        }
        console.log(`💀 Added ${demoData_1.demoDeadJobs.length} dead jobs`);
        // Set up workers
        for (const worker of demoData_1.demoWorkers) {
            const workerData = {
                hostname: worker.name.split(':')[0],
                pid: parseInt(worker.name.split(':')[1]),
                started_at: worker.started_at,
                queues: worker.queues,
                concurrency: worker.concurrency,
                labels: [],
                identity: worker.name
            };
            await redis.sadd('processes', worker.name);
            await redis.set(worker.name, JSON.stringify(workerData));
            await redis.expire(worker.name, 60);
        }
        console.log(`👷 Added ${demoData_1.demoWorkers.length} workers`);
        console.log('');
        console.log('✅ Demo data seeded successfully!');
        console.log('');
        console.log('🔌 Connect to: localhost:6380');
        console.log('');
        console.log('Ready to take screenshots!');
    }
    catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
    finally {
        await redis.quit();
    }
}
seedRedis();
//# sourceMappingURL=seedRedis.js.map