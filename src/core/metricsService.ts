import { Redis } from 'ioredis';

export interface MetricData {
  key: string;
  value: number;
  timestamp: string;
}

export class MetricsService {
  async getMetrics(redis: Redis, pattern = 'metrics:*'): Promise<MetricData[]> {
    const metricsData: MetricData[] = [];
    let cursor = '0';

    // Use SCAN to avoid blocking Redis, and process results in batches
    // to reduce client-side memory pressure (by not holding all keys at once)
    do {
      // scan returns [cursor, keys[]]
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = result[0];
      const batchKeys = result[1];

      if (batchKeys.length > 0) {
        // Use MGET to fetch values in batch for the current scan results
        const values = await redis.mget(...batchKeys);

        for (let i = 0; i < batchKeys.length; i++) {
          const key = batchKeys[i];
          const value = values[i];

          if (value !== null) {
            metricsData.push({
              key,
              value: parseInt(value, 10) || 0,
              timestamp: this.extractTimestamp(key)
            });
          }
        }
      }
    } while (cursor !== '0');

    return metricsData;
  }

  private extractTimestamp(key: string): string {
    // Extract timestamp from key: metrics:path:timestamp
    const parts = key.split(':');
    return parts[parts.length - 1] || '';
  }
}
