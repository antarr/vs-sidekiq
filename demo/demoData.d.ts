/**
 * Demo data for Sidekiq screenshots with correct dates
 */
export declare const demoQueues: string[];
export declare const demoJobs: ({
    queue: string;
    class: string;
    args: (number | {
        notification_type: string;
        locale: string;
    })[];
    jid: string;
    created_at: number;
    enqueued_at: number;
    retry: boolean;
    retry_count: number;
} | {
    queue: string;
    class: string;
    args: {
        user_ids: number[];
    }[];
    jid: string;
    created_at: number;
    enqueued_at: number;
    retry: boolean;
    retry_count: number;
})[];
export declare const demoScheduledJobs: {
    class: string;
    args: {
        content_type: string;
        content_id: string;
    }[];
    jid: string;
    queue: string;
    at: number;
    retry: boolean;
    created_at: number;
}[];
export declare const demoRetryJobs: {
    queue: string;
    class: string;
    args: {
        endpoint: string;
        method: string;
    }[];
    jid: string;
    created_at: number;
    failed_at: number;
    retry_count: number;
    error_message: string;
    error_class: string;
    retry: boolean;
    retried_at: number;
}[];
export declare const demoDeadJobs: {
    queue: string;
    class: string;
    args: string[];
    jid: string;
    created_at: number;
    failed_at: number;
    retry_count: number;
    error_message: string;
    error_class: string;
    error_backtrace: string[];
}[];
export declare const demoWorkers: {
    name: string;
    started_at: number;
    queues: string[];
    concurrency: number;
    busy: number;
    beat: number;
}[];
//# sourceMappingURL=demoData.d.ts.map