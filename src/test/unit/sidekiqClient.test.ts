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
            assert.ok(lastEvalCall.script.includes("local batch_size = 1000"));
            assert.ok(lastEvalCall.script.includes("redis.call('LRANGE', queue, start, end_idx)"));
            assert.ok(lastEvalCall.script.includes("redis.call('LREM', queue, 1, job)"));
        });
    });

    describe('getQueues', () => {
        it('should use pipeline to fetch queue sizes and latencies', async () => {
            let pipelineCommands: Array<{ cmd: string, args: any[] }> = [];
            let pipelineExecCalled = false;

            const mockPipeline = {
                llen: (key: string) => {
                    pipelineCommands.push({ cmd: 'llen', args: [key] });
                    return mockPipeline;
                },
                lindex: (key: string, index: number) => {
                    pipelineCommands.push({ cmd: 'lindex', args: [key, index] });
                    return mockPipeline;
                },
                exec: () => {
                    pipelineExecCalled = true;
                    // Return mock results: [err, result]
                    // We expect 2 queues * 2 commands = 4 results
                    return Promise.resolve([
                        [null, 10], // size q1
                        [null, JSON.stringify({ enqueued_at: Date.now() / 1000 - 100 })], // job q1 (100s lag)
                        [null, 5], // size q2
                        [null, null] // job q2 (empty or error)
                    ]);
                }
            };

            const mockRedis = {
                smembers: (_key: string) => Promise.resolve(['q1', 'q2']),
                pipeline: () => mockPipeline
            };

            const mockConnectionManager = {
                getConnection: (_server: ServerConfig) => Promise.resolve(mockRedis)
            } as unknown as ConnectionManager;

            const client = new SidekiqClient(mockConnectionManager);
            const server = {} as ServerConfig;

            const queues = await client.getQueues(server);

            assert.strictEqual(pipelineExecCalled, true);
            assert.strictEqual(pipelineCommands.length, 4);
            assert.strictEqual(pipelineCommands[0].cmd, 'llen');
            assert.strictEqual(pipelineCommands[0].args[0], 'queue:q1');
            assert.strictEqual(pipelineCommands[1].cmd, 'lindex');

            assert.strictEqual(queues.length, 2);
            assert.strictEqual(queues[0].name, 'q1');
            assert.strictEqual(queues[0].size, 10);
            assert.ok(queues[0].latency >= 99); // roughly 100s

            assert.strictEqual(queues[1].name, 'q2');
            assert.strictEqual(queues[1].size, 5);
            assert.strictEqual(queues[1].latency, 0); // No job returned
        });
    });

    describe('getWorker', () => {
        it('should fetch single worker details using pipeline', async () => {
            let pipelineCommands: Array<{ cmd: string, args: any[] }> = [];
            const mockWorkerId = 'worker:123';

            const mockPipeline = {
                hgetall: (key: string) => {
                    pipelineCommands.push({ cmd: 'hgetall', args: [key] });
                    return mockPipeline;
                },
                get: (key: string) => {
                    pipelineCommands.push({ cmd: 'get', args: [key] });
                    return mockPipeline;
                },
                exec: () => {
                    return Promise.resolve([
                        [null, {
                            info: JSON.stringify({ hostname: 'h1', pid: 1, queues: ['q1'], started_at: 1000, concurrency: 10 }),
                            busy: '1',
                            beat: '1001',
                            quiet: 'true',
                            rss: '500000'
                        }],
                        [null, JSON.stringify({ payload: { jid: 'j1', class: 'C1', created_at: 1050 } })]
                    ]);
                }
            };

            const mockRedis = {
                pipeline: () => mockPipeline
            };

            const mockConnectionManager = {
                getConnection: () => Promise.resolve(mockRedis)
            } as unknown as ConnectionManager;

            const client = new SidekiqClient(mockConnectionManager);
            const worker = await client.getWorker({} as ServerConfig, mockWorkerId);

            assert.notStrictEqual(worker, null, 'Worker should not be null');
            if (worker) {
                assert.strictEqual(worker.id, mockWorkerId);
                assert.strictEqual(pipelineCommands.length, 2);
                assert.strictEqual(pipelineCommands[0].cmd, 'hgetall');
                assert.strictEqual(pipelineCommands[0].args[0], mockWorkerId);
                assert.strictEqual(pipelineCommands[1].cmd, 'get');
                assert.strictEqual(pipelineCommands[1].args[0], `${mockWorkerId}:work`);

                assert.strictEqual(worker.hostname, 'h1');
                assert.strictEqual(worker.pid, '1');
                assert.strictEqual(worker.concurrency, 10);
                assert.strictEqual(worker.busy, 1);
                assert.strictEqual(worker.beat, 1001);
                assert.strictEqual(worker.quiet, true);
                assert.strictEqual(worker.rss, 500000);
                assert.ok(worker.job, 'Job should be present');
                assert.strictEqual(worker.job?.id, 'j1');
            }
        });

        it('should not return job if worker is not busy', async () => {
            const mockWorkerId = 'worker:456';
            const mockPipeline = {
                hgetall: () => mockPipeline,
                get: () => mockPipeline,
                exec: () => Promise.resolve([
                    [null, {
                        info: JSON.stringify({ hostname: 'h2', pid: 2, queues: ['q2'], started_at: 2000 }),
                        busy: '0'
                    }],
                    [null, JSON.stringify({ payload: { jid: 'j2' } })]
                ])
            };
            const mockRedis = { pipeline: () => mockPipeline };
            const mockConnectionManager = {
                getConnection: () => Promise.resolve(mockRedis)
            } as any;

            const client = new SidekiqClient(mockConnectionManager);
            const worker = await client.getWorker({} as ServerConfig, mockWorkerId);

            assert.ok(worker);
            assert.strictEqual(worker?.busy, 0);
            assert.strictEqual(worker?.job, undefined, 'Job should be undefined when busy is 0');
        });

        it('should return null if worker info is missing', async () => {
            const mockPipeline = {
                hgetall: () => mockPipeline,
                get: () => mockPipeline,
                exec: () => Promise.resolve([
                    [null, {}], // Empty hgetall result
                    [null, null]
                ])
            };
            const mockRedis = { pipeline: () => mockPipeline };
            const mockConnectionManager = {
                getConnection: () => Promise.resolve(mockRedis)
            } as any;

            const client = new SidekiqClient(mockConnectionManager);
            const worker = await client.getWorker({} as ServerConfig, 'missing');
            assert.strictEqual(worker, null);
        });
    });
});
