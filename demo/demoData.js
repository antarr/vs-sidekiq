"use strict";
/**
 * Demo data for Sidekiq screenshots with correct dates
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoWorkers = exports.demoDeadJobs = exports.demoRetryJobs = exports.demoScheduledJobs = exports.demoJobs = exports.demoQueues = void 0;
const now = Math.floor(Date.now() / 1000);
exports.demoQueues = ['default', 'mailers', 'critical', 'exports'];
exports.demoJobs = [
    {
        queue: 'default',
        class: 'UserNotificationJob',
        args: [12345, { notification_type: 'welcome_email', locale: 'en' }],
        jid: 'f8e9a0b1c2d3e4f5',
        created_at: now - 120,
        enqueued_at: now - 120,
        retry: true,
        retry_count: 0
    },
    {
        queue: 'mailers',
        class: 'WeeklyDigestMailer',
        args: [{ user_ids: [101, 102, 103, 104, 105] }],
        jid: 'a1b2c3d4e5f6g7h8',
        created_at: now - 300,
        enqueued_at: now - 300,
        retry: true,
        retry_count: 0
    }
];
exports.demoScheduledJobs = [
    {
        class: 'HotnessJob',
        args: [{ content_type: 'Article', content_id: 'abc-123' }],
        jid: '03e3d02e7d59f20ab8639ca2',
        queue: 'hotness',
        at: now + 3600, // 1 hour from now
        retry: true,
        created_at: now - 1800 // 30 min ago
    }
];
exports.demoRetryJobs = [
    {
        queue: 'default',
        class: 'ApiSyncJob',
        args: [{ endpoint: '/api/v2/sync', method: 'POST' }],
        jid: 'r1e2t3r4y5_6j7o8b9',
        created_at: now - 3600,
        failed_at: now - 300,
        retry_count: 2,
        error_message: 'Connection timeout after 30s',
        error_class: 'Net::ReadTimeout',
        retry: true,
        retried_at: now - 150
    }
];
exports.demoDeadJobs = [
    {
        queue: 'open_states_sync',
        class: 'OpenStates::SyncJurisdictionJob',
        args: ['ocd-jurisdiction/country:us/state:ar/place:bellefonte/government'],
        jid: '58a5dfb57e3d26cdbea9b783',
        created_at: now - 86400 * 2, // 2 days ago
        failed_at: now - 3600,
        retry_count: 25,
        error_message: 'Failed to fetch jurisdiction data: 429 - Too Many Requests',
        error_class: 'RuntimeError',
        error_backtrace: [
            '/app/workers/open_states/sync_jurisdiction_job.rb:42:in `perform`',
            '/gems/sidekiq-7.0.0/lib/sidekiq/processor.rb:202:in `execute_job`',
            '/gems/sidekiq-7.0.0/lib/sidekiq/processor.rb:178:in `process`'
        ]
    }
];
exports.demoWorkers = [
    {
        name: 'app-worker-1.local:12345:default,critical',
        started_at: now - 7200,
        queues: ['default', 'critical'],
        concurrency: 5,
        busy: 2,
        beat: now - 5
    }
];
//# sourceMappingURL=demoData.js.map