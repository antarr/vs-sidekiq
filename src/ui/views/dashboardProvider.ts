import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Feature, FeatureTier } from '../../licensing/features';

export class DashboardProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidekiqClient: SidekiqClient;

  constructor(
    private context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    private licenseManager: LicenseManager
  ) {
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  async showDashboard(server: ServerConfig): Promise<void> {
    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'sidekiqDashboard',
        `Sidekiq Dashboard - ${server.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    // Update panel content
    this.panel.title = `Sidekiq Dashboard - ${server.name}`;
    this.panel.webview.html = await this.getWebviewContent(server);

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this.refreshDashboard(server);
            break;
          case 'upgrade':
            vscode.commands.executeCommand('sidekiq.upgrade');
            break;
          case 'retryJob':
            await this.handleRetryJob(server, message.job);
            break;
          case 'deleteJob':
            await this.handleDeleteJob(server, message.job, message.from);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Start auto-refresh
    this.startAutoRefresh(server);
  }

  private async getWebviewContent(server: ServerConfig): Promise<string> {
    const stats = await this.sidekiqClient.getStats(server);
    const tier = this.licenseManager.getCurrentTier();
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sidekiq Dashboard</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 20px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tier-badge {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 15px;
        }
        .stat-label {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        .stat-value {
          font-size: 24px;
          font-weight: bold;
        }
        .refresh-btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
        }
        .refresh-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .upgrade-banner {
          background: var(--vscode-inputValidation-infoBackground);
          border: 1px solid var(--vscode-inputValidation-infoBorder);
          padding: 10px;
          border-radius: 4px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chart-container {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 20px;
          margin-bottom: 20px;
          height: 300px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--vscode-descriptionForeground);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Sidekiq Dashboard - ${server.name}</h1>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="tier-badge">${tierName} Tier</span>
          <button class="refresh-btn" onclick="refresh()">Refresh</button>
        </div>
      </div>

      ${tier === FeatureTier.FREE ? `
      <div class="upgrade-banner">
        <span>🚀 Upgrade to Pro for real-time updates, advanced analytics, and more!</span>
        <button class="refresh-btn" onclick="upgrade()">Upgrade Now</button>
      </div>
      ` : ''}

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Processed</div>
          <div class="stat-value">${stats.processed.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed</div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);">${stats.failed.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Scheduled</div>
          <div class="stat-value">${stats.scheduled.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Retries</div>
          <div class="stat-value" style="color: var(--vscode-warningForeground);">${stats.retries.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Dead</div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);">${stats.dead.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Workers</div>
          <div class="stat-value">${stats.workers.toLocaleString()}</div>
        </div>
      </div>

      ${this.licenseManager.canUseFeature(Feature.ADVANCED_ANALYTICS) ? `
      <div class="chart-container">
        <canvas id="performanceChart"></canvas>
      </div>
      ` : `
      <div class="chart-container">
        <span>📊 Performance charts available in Team tier</span>
      </div>
      `}

      <script>
        const vscode = acquireVsCodeApi();
        
        function refresh() {
          vscode.postMessage({ command: 'refresh' });
        }
        
        function upgrade() {
          vscode.postMessage({ command: 'upgrade' });
        }
      </script>
    </body>
    </html>`;
  }

  private async refreshDashboard(server: ServerConfig): Promise<void> {
    if (this.panel) {
      this.panel.webview.html = await this.getWebviewContent(server);
    }
  }

  private startAutoRefresh(server: ServerConfig): void {
    const interval = this.licenseManager.getRefreshInterval();
    
    const refreshTimer = setInterval(async () => {
      if (this.panel) {
        await this.refreshDashboard(server);
      } else {
        clearInterval(refreshTimer);
      }
    }, interval);
  }

  private async handleRetryJob(server: ServerConfig, job: any): Promise<void> {
    try {
      await this.sidekiqClient.retryJob(server, job);
      vscode.window.showInformationMessage('Job retried successfully');
      await this.refreshDashboard(server);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to retry job: ${error.message}`);
    }
  }

  private async handleDeleteJob(server: ServerConfig, job: any, from: string): Promise<void> {
    try {
      await this.sidekiqClient.deleteJob(server, job, from as any);
      vscode.window.showInformationMessage('Job deleted successfully');
      await this.refreshDashboard(server);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete job: ${error.message}`);
    }
  }
}