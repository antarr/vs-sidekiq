import assert from 'assert';
import { SidekiqClient } from '../../core/sidekiqClient';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig, ServerEnvironment } from '../../data/models/server';
import { Job } from '../../data/models/sidekiq';

describe('SidekiqClient', () => {
    describe('deleteJob', () => {
        it('should use Lua script for efficient deletion from queue', async () => {
            let lastEvalCall: { script: string, numKeys: number, key: string, arg: string } | undefined;

            // Mock Redis
            const mockEval = (script: string, numKeys: number, key: string, arg: string) => {
                lastEvalCall = { script, numKeys, key, arg };
                return Promise.resolve(1);
            };

            const mockRedis = {
                eval: mockEval,
                lrange: () => Promise.resolve([]),
                lrem: () => Promise.resolve(1)
            };

            // Mock ConnectionManager
            const mockConnectionManager = {
                getConnection: (_server: ServerConfig) => Promise.resolve(mockRedis)
            } as unknown as ConnectionManager;

            const client = new SidekiqClient(mockConnectionManager);

            const server: ServerConfig = {
                id: '1',
                name: 'test-server',
                host: 'localhost',
                port: 6379,
                password: '',
                database: 0,
                environment: ServerEnvironment.Development
            };

            const job: Job = {
                id: 'test-job-id',
                queue: 'test-queue',
                class: 'TestJob',
                args: [],
                createdAt: new Date()
            };

            await client.deleteJob(server, job, 'queue');

            if (!lastEvalCall) {
                assert.fail('redis.eval was not called');
            }

            assert.strictEqual(lastEvalCall.numKeys, 1);
            assert.strictEqual(lastEvalCall.key, 'queue:test-queue');
            assert.strictEqual(lastEvalCall.arg, 'test-job-id');

            // Check if script contains Lua logic
            assert.ok(lastEvalCall.script.includes('local queue = KEYS[1]'));
            assert.ok(lastEvalCall.script.includes('cjson.decode'));
            assert.ok(lastEvalCall.script.includes("redis.call('LRANGE', queue, cursor, cursor + batch_size - 1)"));
            assert.ok(lastEvalCall.script.includes("redis.call('LREM', queue, 1, job)"));
        });
    });
});
