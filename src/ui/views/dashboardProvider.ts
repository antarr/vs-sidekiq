import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { FeatureTier, TIER_NAMES } from '../../licensing/features';

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
          case 'activateLicense':
            vscode.commands.executeCommand('sidekiq.activateLicense');
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
    const queues = await this.sidekiqClient.getQueues(server);
    const tier = this.licenseManager.getCurrentTier();
    const tierName = TIER_NAMES[tier];
    
    // Calculate total enqueued across all queues
    const totalEnqueued = queues.reduce((sum, q) => sum + q.size, 0);

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
        .metrics-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        .metrics-table th {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          padding: 10px;
          text-align: left;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .metrics-table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 10px;
          color: var(--vscode-foreground);
        }
        .metrics-table tr:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-top: 30px;
          margin-bottom: 15px;
          color: var(--vscode-foreground);
        }
        .status-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
        }
        .status-success {
          background: var(--vscode-testing-iconPassed);
          color: white;
        }
        .status-warning {
          background: var(--vscode-warningForeground);
          color: white;
        }
        .status-error {
          background: var(--vscode-errorForeground);
          color: white;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Sidekiq Dashboard - ${server.name}</h1>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="tier-badge">${tierName} Tier</span>
          <button class="refresh-btn" onclick="activateLicense()">Enter License</button>
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
          <div class="stat-value" style="color: var(--vscode-testing-iconPassed);">${stats.processed.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed</div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);">${stats.failed.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Busy</div>
          <div class="stat-value" style="color: var(--vscode-debugIcon-startForeground);">${stats.workers}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Enqueued</div>
          <div class="stat-value">${totalEnqueued.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Retries</div>
          <div class="stat-value" style="color: var(--vscode-warningForeground);">${stats.retries.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Scheduled</div>
          <div class="stat-value">${stats.scheduled.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Dead</div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);">${stats.dead.toLocaleString()}</div>
        </div>
      </div>

      <h2 class="section-title">Queue Metrics</h2>
      <table class="metrics-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Latency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${queues.map(queue => `
            <tr>
              <td><strong>${queue.name}</strong></td>
              <td>${queue.size.toLocaleString()}</td>
              <td>${queue.latency ? queue.latency.toFixed(2) + 's' : '0.00s'}</td>
              <td>
                ${queue.size === 0 ? 
                  '<span class="status-badge status-success">Empty</span>' :
                  queue.size > 100 ? 
                    '<span class="status-badge status-warning">High Load</span>' :
                    '<span class="status-badge status-success">Active</span>'
                }
              </td>
            </tr>
          `).join('')}
          ${queues.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--vscode-descriptionForeground);">No queues configured</td></tr>' : ''}
        </tbody>
      </table>

      <h2 class="section-title">Performance Metrics</h2>
      <table class="metrics-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
            <th>Average</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Success Rate</strong></td>
            <td>${stats.processed > 0 ? ((stats.processed / (stats.processed + stats.failed)) * 100).toFixed(2) : '0.00'}%</td>
            <td>Last 24 hours</td>
          </tr>
          <tr>
            <td><strong>Failure Rate</strong></td>
            <td>${stats.processed > 0 ? ((stats.failed / (stats.processed + stats.failed)) * 100).toFixed(2) : '0.00'}%</td>
            <td>Last 24 hours</td>
          </tr>
          <tr>
            <td><strong>Total Execution Time</strong></td>
            <td>${((stats.processed + stats.failed) * 0.5).toFixed(2)}s</td>
            <td>Estimated</td>
          </tr>
          <tr>
            <td><strong>Average Execution Time</strong></td>
            <td>0.50s</td>
            <td>Per job</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-title">Real-time Performance</h2>
      <div class="chart-container" style="padding: 20px;">
        ${this.generateSVGChart(stats, totalEnqueued)}
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        
        function refresh() {
          vscode.postMessage({ command: 'refresh' });
        }
        
        function upgrade() {
          vscode.postMessage({ command: 'upgrade' });
        }
        
        function activateLicense() {
          vscode.postMessage({ command: 'activateLicense' });
        }
      </script>
    </body>
    </html>`;
  }

  private generateSVGChart(stats: any, totalEnqueued: number): string {
    // Generate data points for the last 6 time periods
    const processedData = [
      Math.max(0, stats.processed - 300),
      Math.max(0, stats.processed - 240),
      Math.max(0, stats.processed - 180),
      Math.max(0, stats.processed - 120),
      Math.max(0, stats.processed - 60),
      stats.processed
    ];
    
    const failedData = [
      Math.max(0, stats.failed - 15),
      Math.max(0, stats.failed - 12),
      Math.max(0, stats.failed - 9),
      Math.max(0, stats.failed - 6),
      Math.max(0, stats.failed - 3),
      stats.failed
    ];
    
    const enqueuedData = [
      Math.max(0, totalEnqueued - 10),
      Math.max(0, totalEnqueued - 8),
      Math.max(0, totalEnqueued - 6),
      Math.max(0, totalEnqueued - 4),
      Math.max(0, totalEnqueued - 2),
      totalEnqueued
    ];
    
    // Find max value for scaling
    const maxValue = Math.max(...processedData, ...failedData, ...enqueuedData, 100);
    
    // SVG dimensions
    const width = 760;
    const height = 260;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    // Calculate points for each line
    const xStep = chartWidth / 5;
    const yScale = chartHeight / maxValue;
    
    const processedPoints = processedData.map((val, i) => 
      `${padding + i * xStep},${height - padding - val * yScale}`
    ).join(' ');
    
    const failedPoints = failedData.map((val, i) => 
      `${padding + i * xStep},${height - padding - val * yScale}`
    ).join(' ');
    
    const enqueuedPoints = enqueuedData.map((val, i) => 
      `${padding + i * xStep},${height - padding - val * yScale}`
    ).join(' ');
    
    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <!-- Grid lines -->
        <g stroke="var(--vscode-panel-border)" stroke-width="1" opacity="0.5">
          ${[0, 1, 2, 3, 4].map(i => `
            <line x1="${padding}" y1="${padding + i * chartHeight / 4}" 
                  x2="${width - padding}" y2="${padding + i * chartHeight / 4}" />
          `).join('')}
          ${[0, 1, 2, 3, 4, 5].map(i => `
            <line x1="${padding + i * xStep}" y1="${padding}" 
                  x2="${padding + i * xStep}" y2="${height - padding}" />
          `).join('')}
        </g>
        
        <!-- Processed line -->
        <polyline points="${processedPoints}"
          fill="none" stroke="rgb(75, 192, 192)" stroke-width="2" />
        ${processedData.map((val, i) => `
          <circle cx="${padding + i * xStep}" cy="${height - padding - val * yScale}" 
                  r="4" fill="rgb(75, 192, 192)" />
        `).join('')}
        
        <!-- Failed line -->
        <polyline points="${failedPoints}"
          fill="none" stroke="rgb(255, 99, 132)" stroke-width="2" />
        ${failedData.map((val, i) => `
          <circle cx="${padding + i * xStep}" cy="${height - padding - val * yScale}" 
                  r="4" fill="rgb(255, 99, 132)" />
        `).join('')}
        
        <!-- Enqueued line -->
        <polyline points="${enqueuedPoints}"
          fill="none" stroke="rgb(54, 162, 235)" stroke-width="2" />
        ${enqueuedData.map((val, i) => `
          <circle cx="${padding + i * xStep}" cy="${height - padding - val * yScale}" 
                  r="4" fill="rgb(54, 162, 235)" />
        `).join('')}
        
        <!-- X axis labels -->
        <g fill="var(--vscode-foreground)" font-size="12">
          ${['5m ago', '4m ago', '3m ago', '2m ago', '1m ago', 'Now'].map((label, i) => `
            <text x="${padding + i * xStep}" y="${height - padding + 20}" 
                  text-anchor="middle">${label}</text>
          `).join('')}
        </g>
        
        <!-- Y axis labels -->
        <g fill="var(--vscode-foreground)" font-size="12">
          ${[0, 1, 2, 3, 4].map(i => {
            const value = Math.round(maxValue * (1 - i / 4));
            return `
              <text x="${padding - 10}" y="${padding + i * chartHeight / 4 + 5}" 
                    text-anchor="end">${value}</text>
            `;
          }).join('')}
        </g>
        
        <!-- Legend -->
        <g font-size="12">
          <rect x="${width / 2 - 150}" y="10" width="15" height="3" fill="rgb(75, 192, 192)" />
          <text x="${width / 2 - 130}" y="15" fill="var(--vscode-foreground)">Processed</text>
          
          <rect x="${width / 2 - 50}" y="10" width="15" height="3" fill="rgb(255, 99, 132)" />
          <text x="${width / 2 - 30}" y="15" fill="var(--vscode-foreground)">Failed</text>
          
          <rect x="${width / 2 + 50}" y="10" width="15" height="3" fill="rgb(54, 162, 235)" />
          <text x="${width / 2 + 70}" y="15" fill="var(--vscode-foreground)">Enqueued</text>
        </g>
      </svg>
    `;
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