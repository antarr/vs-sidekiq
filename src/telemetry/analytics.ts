import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

interface AnalyticsEvent {
  event: string;
  properties: Record<string, any>;
  timestamp: number;
  sessionId: string;
  userId?: string;
}

export class AnalyticsCollector {
  private queue: AnalyticsEvent[] = [];
  private flushInterval = 60000; // 1 minute
  private flushTimer?: NodeJS.Timeout;
  private sessionId: string;
  private context: vscode.ExtensionContext;
  private enabled: boolean = true;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.sessionId = uuidv4();
  }

  initialize(): void {
    // Check if telemetry is enabled
    const config = vscode.workspace.getConfiguration('telemetry');
    this.enabled = config.get('enableTelemetry', true);

    if (this.enabled) {
      this.startFlushTimer();
    }
  }

  track(event: string, properties?: Record<string, any>): void {
    if (!this.enabled) return;

    this.queue.push({
      event,
      properties: {
        ...properties,
        version: this.getExtensionVersion(),
        platform: process.platform,
        vscodeVersion: vscode.version,
        timestamp: Date.now()
      },
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId: this.getUserId()
    });

    if (this.queue.length >= 100) {
      this.flush();
    }
  }

  trackFeatureUsage(feature: string, allowed: boolean): void {
    this.track('feature_used', {
      feature,
      allowed
    });
  }

  trackCommand(command: string, success: boolean, duration?: number): void {
    this.track('command_executed', {
      command,
      success,
      duration
    });
  }

  trackError(error: Error, context?: string): void {
    this.track('error_occurred', {
      error_message: error.message,
      error_stack: error.stack,
      context
    });
  }

  trackServerConnection(serverId: string, success: boolean, duration?: number): void {
    this.track('server_connection', {
      server_id: serverId,
      success,
      duration
    });
  }

  trackViewOpened(view: string): void {
    this.track('view_opened', {
      view
    });
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || !this.enabled) return;

    const events = [...this.queue];
    this.queue = [];

    try {
      await this.sendToAnalyticsServer(events);
    } catch (error) {
      // Re-queue events on failure, but limit size
      if (this.queue.length < 500) {
        this.queue.unshift(...events);
      }
      console.error('Failed to send analytics:', error);
    }
  }

  private async sendToAnalyticsServer(events: AnalyticsEvent[]): Promise<void> {
    // TODO: Implement actual analytics server endpoint
    // For now, just log to console in development
    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      console.log('Analytics events:', events);
    }

    // Mock implementation - would send to real analytics service
    // await fetch('https://analytics.sidekiq-manager.com/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ events })
    // });
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  private getExtensionVersion(): string {
    return this.context.extension.packageJSON.version || '0.0.0';
  }


  private getUserId(): string | undefined {
    // Generate or retrieve a persistent anonymous user ID
    const key = 'sidekiq.userId';
    let userId = this.context.globalState.get<string>(key);
    
    if (!userId) {
      userId = uuidv4();
      this.context.globalState.update(key, userId);
    }
    
    return userId;
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}