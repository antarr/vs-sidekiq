import { Redis } from 'ioredis';

export interface MetricData {
  key: string;
  value: number;
  timestamp: string;
}

export class MetricsService {
  async getMetrics(redis: Redis, pattern = 'metrics:*'): Promise<MetricData[]> {
    const keys: string[] = [];
    let cursor = '0';

    // Use SCAN to avoid blocking Redis
    do {
      // scan returns [cursor, keys[]]
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = result[0];
      const batchKeys = result[1];
      if (batchKeys.length > 0) {
        keys.push(...batchKeys);
      }
    } while (cursor !== '0');

    if (keys.length === 0) {
      return [];
    }

    const metricsData: MetricData[] = [];
    const CHUNK_SIZE = 1000;

    // Process keys in chunks to avoid large payloads
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunkKeys = keys.slice(i, i + CHUNK_SIZE);

      // Use MGET to fetch values in batch
      const values = await redis.mget(...chunkKeys);

      for (let j = 0; j < chunkKeys.length; j++) {
        const key = chunkKeys[j];
        const value = values[j];

        if (value !== null) {
          metricsData.push({
            key,
            value: parseInt(value, 10) || 0,
            timestamp: this.extractTimestamp(key)
          });
        }
      }
    }

    return metricsData;
  }

  private extractTimestamp(key: string): string {
    // Extract timestamp from key: metrics:path:timestamp
    const parts = key.split(':');
    return parts[parts.length - 1] || '';
  }
}
