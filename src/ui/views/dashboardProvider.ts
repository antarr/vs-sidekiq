import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { FeatureTier, TIER_NAMES } from '../../licensing/features';
import { SidekiqStats } from '../../data/models/sidekiq';

interface HistoricalDataPoint {
  timestamp: number;
  processed: number;
  failed: number;
  enqueued: number;
  busy: number;
  retries: number;
}

export class DashboardProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidekiqClient: SidekiqClient;
  private historicalData: HistoricalDataPoint[] = [];
  private previousStats: SidekiqStats | null = null;
  private autoRefreshTimer: NodeJS.Timeout | undefined;

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
      // Panel already exists, just reveal and update content
      this.panel.reveal();
      this.panel.title = `Sidekiq Dashboard - ${server.name}`;
      await this.updateDashboardData(server);
      return;
    }

    // Create new panel
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
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = undefined;
      }
      // Clear historical data on close
      this.historicalData = [];
      this.previousStats = null;
    });

    // Set up message handling (only once when panel is created)
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this.updateDashboardData(server);
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
          case 'exportData':
            await this.handleExportData(server);
            break;
          case 'expandHistorical':
            await this.handleExpandHistorical(server, message.days);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Initial content - render HTML structure once
    this.panel.webview.html = this.getWebviewHtml(server);

    // Load initial data
    await this.updateDashboardData(server);

    // Start auto-refresh (only once when panel is created)
    this.startAutoRefresh(server);
  }

  private getWebviewHtml(_server: ServerConfig): string {
    const tier = this.licenseManager.getCurrentTier();
    const tierName = TIER_NAMES[tier];

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
      <title>Sidekiq Dashboard</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 24px;
          line-height: 1.5;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-title {
          font-size: 24px;
          font-weight: 600;
          margin: 0;
        }

        .last-updated {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .refresh-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--vscode-testing-iconPassed);
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tier-badge {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn:hover {
          background: var(--vscode-button-hoverBackground);
          transform: translateY(-1px);
        }

        .btn-secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-link {
          background: transparent;
          color: var(--vscode-textLink-foreground);
          padding: 4px 8px;
          font-size: 12px;
        }

        .btn-link:hover {
          background: transparent;
          color: var(--vscode-textLink-activeForeground);
          transform: none;
          text-decoration: underline;
        }

        .upgrade-banner {
          background: linear-gradient(135deg, var(--vscode-inputValidation-infoBackground) 0%, var(--vscode-inputValidation-infoBackground) 100%);
          border: 1px solid var(--vscode-inputValidation-infoBorder);
          padding: 16px 20px;
          border-radius: 8px;
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 20px;
          transition: all 0.2s;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          position: relative;
          overflow: hidden;
        }

        .stat-card:hover {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }

        .stat-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }

        .stat-label {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.5px;
        }

        .stat-trend {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .trend-up {
          color: var(--vscode-testing-iconPassed);
          background: rgba(75, 192, 192, 0.1);
        }

        .trend-down {
          color: var(--vscode-errorForeground);
          background: rgba(255, 99, 132, 0.1);
        }

        .trend-neutral {
          color: var(--vscode-descriptionForeground);
          background: rgba(128, 128, 128, 0.1);
        }

        .stat-value {
          font-size: 32px;
          font-weight: 700;
          line-height: 1;
          margin-bottom: 8px;
          transition: color 0.3s ease;
        }

        .stat-subtitle {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .chart-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .chart-card-full {
          grid-column: span 12;
        }

        .chart-card-half {
          grid-column: span 12;
        }

        .chart-card-third {
          grid-column: span 12;
        }

        @media (min-width: 768px) {
          .chart-card-half {
            grid-column: span 6;
          }
        }

        @media (min-width: 1200px) {
          .chart-card-third {
            grid-column: span 4;
          }
        }

        .chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .chart-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        .metrics-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }

        .metrics-table th {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          padding: 12px;
          text-align: left;
          font-weight: 600;
          font-size: 12px;
          color: var(--vscode-foreground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .metrics-table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 12px;
          color: var(--vscode-foreground);
          font-size: 13px;
        }

        .metrics-table tr:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-top: 32px;
          margin-bottom: 16px;
          color: var(--vscode-foreground);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .status-healthy {
          background: rgba(75, 192, 192, 0.2);
          color: var(--vscode-testing-iconPassed);
        }

        .status-warning {
          background: rgba(255, 206, 86, 0.2);
          color: var(--vscode-warningForeground);
        }

        .status-critical {
          background: rgba(255, 99, 132, 0.2);
          color: var(--vscode-errorForeground);
        }

        .status-indicator {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        .metric-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .metric-row:last-child {
          border-bottom: none;
        }

        .metric-label {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
          font-weight: 500;
        }

        .metric-value {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: var(--vscode-panel-border);
          border-radius: 4px;
          overflow: hidden;
          margin-top: 8px;
        }

        .progress-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.6s ease;
        }

        .queue-list {
          max-height: 400px;
          overflow-y: auto;
        }

        .queue-item {
          padding: 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
          transition: background 0.2s;
        }

        .queue-item:last-child {
          border-bottom: none;
        }

        .queue-item:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .queue-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        .queue-name {
          font-weight: 600;
          font-size: 14px;
        }

        .queue-stats {
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }

        .empty-state {
          text-align: center;
          padding: 40px;
          color: var(--vscode-descriptionForeground);
        }

        .trend-arrow {
          font-size: 14px;
          font-weight: bold;
        }

        /* Simple bar chart using CSS */
        .bar-chart {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 20px 0;
        }

        .bar-chart-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .bar-chart-label {
          min-width: 100px;
          font-size: 12px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
        }

        .bar-chart-bar {
          flex: 1;
          height: 24px;
          background: var(--vscode-panel-border);
          border-radius: 4px;
          position: relative;
          overflow: hidden;
        }

        .bar-chart-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.6s ease;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 8px;
          font-size: 11px;
          font-weight: 600;
          color: white;
        }

        .bar-processed {
          background: linear-gradient(90deg, rgb(75, 192, 192), rgba(75, 192, 192, 0.8));
        }

        .bar-failed {
          background: linear-gradient(90deg, rgb(255, 99, 132), rgba(255, 99, 132, 0.8));
        }

        .bar-enqueued {
          background: linear-gradient(90deg, rgb(54, 162, 235), rgba(54, 162, 235, 0.8));
        }

        .bar-warning {
          background: linear-gradient(90deg, rgb(255, 206, 86), rgba(255, 206, 86, 0.8));
        }

        .bar-success {
          background: linear-gradient(90deg, rgb(75, 192, 192), rgba(75, 192, 192, 0.8));
        }

        /* Historical trends styles */
        .historical-chart {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 0;
        }

        .historical-chart-item {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: 12px;
          align-items: center;
        }

        .historical-date {
          font-size: 11px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          text-align: right;
        }

        .historical-bars {
          display: flex;
          gap: 4px;
          align-items: center;
          position: relative;
          height: 28px;
        }

        .historical-bar {
          height: 100%;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          color: white;
          transition: all 0.3s ease;
          position: relative;
        }

        .historical-bar:hover {
          opacity: 0.8;
          transform: scaleY(1.05);
        }

        .historical-bar-processed {
          background: linear-gradient(135deg, rgb(75, 192, 192), rgba(75, 192, 192, 0.9));
        }

        .historical-bar-failed {
          background: linear-gradient(135deg, rgb(255, 99, 132), rgba(255, 99, 132, 0.9));
        }

        .historical-legend {
          display: flex;
          gap: 20px;
          justify-content: center;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--vscode-panel-border);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }

        .legend-color {
          width: 16px;
          height: 16px;
          border-radius: 3px;
        }

        .trend-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding: 8px 12px;
          background: var(--vscode-list-hoverBackground);
          border-radius: 6px;
        }

        .trend-indicator-label {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }

        .trend-indicator-value {
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .expand-section {
          display: none;
        }

        .expand-section.visible {
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <h1 class="header-title">Sidekiq Dashboard</h1>
          <div class="last-updated">
            <div class="refresh-indicator"></div>
            <span id="lastUpdated">Just now</span>
          </div>
        </div>
        <div class="header-actions">
          <span class="tier-badge">${tierName}</span>
          <button class="btn btn-secondary" onclick="activateLicense()">
            <span>&#x1F511;</span> License
          </button>
          <button class="btn btn-secondary" onclick="exportData()">
            <span>&#x1F4BE;</span> Export
          </button>
          <button class="btn" onclick="refresh()">
            <span>&#x1F504;</span> Refresh
          </button>
        </div>
      </div>

      ${tier === FeatureTier.FREE ? `
      <div class="upgrade-banner">
        <div>
          <strong>Unlock Premium Features</strong>
          <div style="font-size: 12px; margin-top: 4px; opacity: 0.9;">
            Get real-time updates, advanced analytics, custom alerts, and more!
          </div>
        </div>
        <button class="btn" onclick="upgrade()">
          <span>&#x1F680;</span> Upgrade Now
        </button>
      </div>
      ` : ''}

      <!-- Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Processed</div>
            <div class="stat-trend trend-neutral" id="trend-processed"></div>
          </div>
          <div class="stat-value" style="color: var(--vscode-testing-iconPassed);" id="stat-processed">0</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Failed</div>
            <div class="stat-trend trend-neutral" id="trend-failed"></div>
          </div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);" id="stat-failed">0</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Busy Workers</div>
          </div>
          <div class="stat-value" style="color: var(--vscode-debugIcon-startForeground);" id="stat-workers">0</div>
          <div class="stat-subtitle" id="stat-workers-sub">of 0 processes</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Enqueued</div>
            <div class="stat-trend trend-neutral" id="trend-enqueued"></div>
          </div>
          <div class="stat-value" id="stat-enqueued">0</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Retries</div>
          </div>
          <div class="stat-value" style="color: var(--vscode-warningForeground);" id="stat-retries">0</div>
          <div class="stat-subtitle">Awaiting retry</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Scheduled</div>
          </div>
          <div class="stat-value" id="stat-scheduled">0</div>
          <div class="stat-subtitle">Future jobs</div>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <div class="stat-label">Dead</div>
          </div>
          <div class="stat-value" style="color: var(--vscode-errorForeground);" id="stat-dead">0</div>
          <div class="stat-subtitle" id="stat-dead-sub">Permanently failed</div>
        </div>
      </div>

      <!-- Performance Metrics -->
      <div class="dashboard-grid">
        <div class="chart-card chart-card-half">
          <div class="chart-header">
            <h3 class="chart-title">Job Processing Overview</h3>
          </div>
          <div class="bar-chart">
            <div class="bar-chart-item">
              <div class="bar-chart-label">Processed</div>
              <div class="bar-chart-bar">
                <div class="bar-chart-fill bar-processed" id="bar-processed" style="width: 0%;">
                  <span id="bar-processed-text">0</span>
                </div>
              </div>
            </div>
            <div class="bar-chart-item">
              <div class="bar-chart-label">Failed</div>
              <div class="bar-chart-bar">
                <div class="bar-chart-fill bar-failed" id="bar-failed" style="width: 0%;">
                  <span id="bar-failed-text">0</span>
                </div>
              </div>
            </div>
            <div class="bar-chart-item">
              <div class="bar-chart-label">Enqueued</div>
              <div class="bar-chart-bar">
                <div class="bar-chart-fill bar-enqueued" id="bar-enqueued" style="width: 0%;">
                  <span id="bar-enqueued-text">0</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="chart-card chart-card-half">
          <div class="chart-header">
            <h3 class="chart-title">Processing Metrics</h3>
          </div>
          <div style="padding: 20px 0;">
            <div class="metric-row">
              <span class="metric-label">Jobs per Minute</span>
              <span class="metric-value" id="metric-per-minute">0.0</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Jobs per Hour</span>
              <span class="metric-value" id="metric-per-hour">0</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Error Rate</span>
              <span class="metric-value" id="metric-error-rate">0.00%</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Success Rate</span>
              <span class="metric-value" style="color: var(--vscode-testing-iconPassed);" id="metric-success-rate">100.00%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Historical Trends Section -->
      <h2 class="section-title">
        <span>&#x1F4C8;</span> Historical Performance (Last 7 Days)
      </h2>
      <div class="chart-card">
        <div id="historical-trends">
          <div class="empty-state">Loading historical data...</div>
        </div>
        <div id="trend-summary" style="display: none;"></div>
        <div style="text-align: center; margin-top: 16px;">
          <button class="btn-link" id="expand-btn" onclick="expandHistorical()">
            <span id="expand-text">View 14 Days</span>
          </button>
        </div>
      </div>

      <!-- Queue Health -->
      <h2 class="section-title">
        <span>&#x1F4CA;</span> Queue Health Overview
      </h2>
      <div class="chart-card">
        <table class="metrics-table">
          <thead>
            <tr>
              <th>Queue Name</th>
              <th>Size</th>
              <th>Latency</th>
              <th>Health Status</th>
              <th>Load</th>
            </tr>
          </thead>
          <tbody id="queue-health-table">
            <tr><td colspan="5" class="empty-state">Loading...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- System Health Metrics -->
      <h2 class="section-title">
        <span>&#x2764;&#xFE0F;</span> System Health
      </h2>
      <div class="dashboard-grid">
        <div class="chart-card chart-card-third">
          <h3 class="chart-title">Overall Health</h3>
          <div style="padding: 20px 0;" id="system-health">
            <div class="empty-state">Loading...</div>
          </div>
        </div>

        <div class="chart-card chart-card-third">
          <h3 class="chart-title">Top Queues by Size</h3>
          <div class="queue-list" id="top-queues-size">
            <div class="empty-state">Loading...</div>
          </div>
        </div>

        <div class="chart-card chart-card-third">
          <h3 class="chart-title">Top Queues by Latency</h3>
          <div class="queue-list" id="top-queues-latency">
            <div class="empty-state">Loading...</div>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let currentHistoricalDays = 7;
        let maxHistoricalDays = 14;

        // Update last updated time
        let lastUpdateTime = Date.now();
        function updateLastUpdatedTime() {
          const now = Date.now();
          const diff = Math.floor((now - lastUpdateTime) / 1000);
          let text = 'Just now';
          if (diff >= 60) {
            const minutes = Math.floor(diff / 60);
            text = minutes + 'm ago';
          } else if (diff > 0) {
            text = diff + 's ago';
          }
          document.getElementById('lastUpdated').textContent = text;
        }
        setInterval(updateLastUpdatedTime, 1000);

        function refresh() {
          lastUpdateTime = Date.now();
          vscode.postMessage({ command: 'refresh' });
        }

        function upgrade() {
          vscode.postMessage({ command: 'upgrade' });
        }

        function activateLicense() {
          vscode.postMessage({ command: 'activateLicense' });
        }

        function exportData() {
          vscode.postMessage({ command: 'exportData' });
        }

        function expandHistorical() {
          if (currentHistoricalDays === 7) {
            currentHistoricalDays = 14;
            document.getElementById('expand-text').textContent = 'View 30 Days';
            maxHistoricalDays = 30;
          } else if (currentHistoricalDays === 14) {
            currentHistoricalDays = 30;
            document.getElementById('expand-text').textContent = 'View Less';
          } else {
            currentHistoricalDays = 7;
            document.getElementById('expand-text').textContent = 'View 14 Days';
            maxHistoricalDays = 14;
          }
          vscode.postMessage({ command: 'expandHistorical', days: currentHistoricalDays });
        }

        // Update dashboard data without re-rendering HTML structure
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.command === 'updateData') {
            updateDashboard(message.data);
          }
        });

        function updateDashboard(data) {
          // Update stat cards
          updateElement('stat-processed', data.stats.processed.toLocaleString());
          updateElement('stat-failed', data.stats.failed.toLocaleString());
          updateElement('stat-workers', data.stats.workers.toLocaleString());
          updateElement('stat-workers-sub', 'of ' + data.stats.processes + ' processes');
          updateElement('stat-enqueued', data.totalEnqueued.toLocaleString());
          updateElement('stat-retries', data.stats.retries.toLocaleString());
          updateElement('stat-scheduled', data.stats.scheduled.toLocaleString());
          updateElement('stat-dead', data.stats.dead.toLocaleString());

          // Update dead jobs warning
          if (data.stats.dead > 1000) {
            updateElement('stat-dead-sub', '<strong>⚠ High count!</strong>');
          } else {
            updateElement('stat-dead-sub', 'Permanently failed');
          }

          // Update trends
          updateTrend('trend-processed', data.trends.processed);
          updateTrend('trend-failed', data.trends.failed);
          updateTrend('trend-enqueued', data.trends.enqueued);

          // Update bar chart
          const maxValue = Math.max(data.stats.processed, data.stats.failed, data.totalEnqueued, 1);
          updateBar('bar-processed', data.stats.processed, maxValue);
          updateBar('bar-failed', data.stats.failed, maxValue);
          updateBar('bar-enqueued', data.totalEnqueued, maxValue);

          // Update processing metrics
          updateElement('metric-per-minute', data.processingRate.perMinute.toFixed(1));
          updateElement('metric-per-hour', data.processingRate.perHour.toFixed(0));

          const errorRate = data.errorRate;
          const errorRateElement = document.getElementById('metric-error-rate');
          errorRateElement.textContent = errorRate.toFixed(2) + '%';
          errorRateElement.style.color = errorRate > 5 ? 'var(--vscode-errorForeground)' : 'var(--vscode-testing-iconPassed)';

          updateElement('metric-success-rate', (100 - errorRate).toFixed(2) + '%');

          // Update historical trends
          if (data.historicalStats) {
            updateHistoricalTrends(data.historicalStats);
          }

          // Update queue health table
          updateQueueHealthTable(data.queues);

          // Update system health
          updateSystemHealth(data.systemHealth);

          // Update top queues
          updateTopQueues(data.queues);
        }

        function updateElement(id, value) {
          const element = document.getElementById(id);
          if (element) {
            element.innerHTML = value;
          }
        }

        function updateTrend(id, value) {
          const element = document.getElementById(id);
          if (!element || value === 0) {
            if (element) {
              element.style.display = 'none';
            }
            return;
          }

          element.style.display = 'flex';
          element.className = 'stat-trend ' + (value > 0 ? 'trend-up' : 'trend-down');
          element.innerHTML = '<span class="trend-arrow">' + (value > 0 ? '↑' : '↓') + '</span> ' + Math.abs(value).toFixed(1) + '%';
        }

        function updateBar(id, value, maxValue) {
          const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
          const fillElement = document.getElementById(id);
          const textElement = document.getElementById(id + '-text');

          if (fillElement) {
            fillElement.style.width = Math.max(percentage, 5) + '%';
          }
          if (textElement) {
            textElement.textContent = value.toLocaleString();
          }
        }

        function updateHistoricalTrends(historicalStats) {
          const container = document.getElementById('historical-trends');
          const summaryContainer = document.getElementById('trend-summary');

          if (!historicalStats || historicalStats.length === 0) {
            container.innerHTML = '<div class="empty-state">No historical data available</div>';
            summaryContainer.style.display = 'none';
            return;
          }

          // Calculate max values for scaling
          const maxProcessed = Math.max(...historicalStats.map(d => d.processed), 1);
          const maxFailed = Math.max(...historicalStats.map(d => d.failed), 1);
          const maxTotal = maxProcessed + maxFailed;

          // Format date for display
          function formatDate(dateStr) {
            const date = new Date(dateStr);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            return month + '/' + day;
          }

          // Build chart HTML
          let html = '<div class="historical-chart">';

          historicalStats.forEach(stat => {
            const processedWidth = maxTotal > 0 ? (stat.processed / maxTotal) * 100 : 0;
            const failedWidth = maxTotal > 0 ? (stat.failed / maxTotal) * 100 : 0;
            const total = stat.processed + stat.failed;

            html += \`
              <div class="historical-chart-item">
                <div class="historical-date">\${formatDate(stat.date)}</div>
                <div class="historical-bars">
                  \${stat.processed > 0 ? \`
                    <div class="historical-bar historical-bar-processed"
                         style="width: \${processedWidth}%;"
                         title="Processed: \${stat.processed.toLocaleString()}">
                      \${stat.processed > 0 ? stat.processed.toLocaleString() : ''}
                    </div>
                  \` : ''}
                  \${stat.failed > 0 ? \`
                    <div class="historical-bar historical-bar-failed"
                         style="width: \${failedWidth}%;"
                         title="Failed: \${stat.failed.toLocaleString()}">
                      \${stat.failed > 0 ? stat.failed.toLocaleString() : ''}
                    </div>
                  \` : ''}
                  \${total === 0 ? '<div style="font-size: 11px; color: var(--vscode-descriptionForeground);">No data</div>' : ''}
                </div>
              </div>
            \`;
          });

          html += '</div>';

          // Add legend
          html += \`
            <div class="historical-legend">
              <div class="legend-item">
                <div class="legend-color historical-bar-processed"></div>
                <span>Processed Jobs</span>
              </div>
              <div class="legend-item">
                <div class="legend-color historical-bar-failed"></div>
                <span>Failed Jobs</span>
              </div>
            </div>
          \`;

          container.innerHTML = html;

          // Calculate and display trend
          if (historicalStats.length >= 2) {
            const latest = historicalStats[historicalStats.length - 1];
            const previous = historicalStats[historicalStats.length - 2];

            const processedChange = previous.processed > 0
              ? ((latest.processed - previous.processed) / previous.processed) * 100
              : 0;

            const failedChange = previous.failed > 0
              ? ((latest.failed - previous.failed) / previous.failed) * 100
              : 0;

            let trendHtml = '<div class="trend-indicator">';

            if (Math.abs(processedChange) > 1) {
              const arrow = processedChange > 0 ? '↑' : '↓';
              const color = processedChange > 0 ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)';
              trendHtml += \`
                <div class="trend-indicator-label">Processing Trend:</div>
                <div class="trend-indicator-value" style="color: \${color};">
                  <span>\${arrow}</span>
                  <span>\${Math.abs(processedChange).toFixed(1)}%</span>
                </div>
              \`;
            }

            if (Math.abs(failedChange) > 1) {
              const arrow = failedChange > 0 ? '↑' : '↓';
              const color = failedChange > 0 ? 'var(--vscode-errorForeground)' : 'var(--vscode-testing-iconPassed)';
              trendHtml += \`
                <div class="trend-indicator-label" style="margin-left: 16px;">Failure Trend:</div>
                <div class="trend-indicator-value" style="color: \${color};">
                  <span>\${arrow}</span>
                  <span>\${Math.abs(failedChange).toFixed(1)}%</span>
                </div>
              \`;
            }

            trendHtml += '</div>';
            summaryContainer.innerHTML = trendHtml;
            summaryContainer.style.display = 'block';
          }
        }

        function updateQueueHealthTable(queues) {
          const tbody = document.getElementById('queue-health-table');
          if (!tbody) return;

          if (queues.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No queues configured</td></tr>';
            return;
          }

          tbody.innerHTML = queues.map(queue => {
            const percentage = Math.min((queue.size / 100) * 100, 100);
            return \`
              <tr>
                <td><strong>\${queue.name}</strong></td>
                <td>\${queue.size.toLocaleString()}</td>
                <td>\${queue.latency ? queue.latency.toFixed(2) + 's' : '0.00s'}</td>
                <td>
                  <span class="status-badge status-\${queue.healthStatus.level}">
                    <span class="status-indicator"></span>
                    \${queue.healthStatus.label}
                  </span>
                </td>
                <td>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: \${percentage}%; background: \${queue.healthStatus.color};"></div>
                  </div>
                </td>
              </tr>
            \`;
          }).join('');
        }

        function updateSystemHealth(healthMetrics) {
          const container = document.getElementById('system-health');
          if (!container) return;

          container.innerHTML = healthMetrics.join('');
        }

        function updateTopQueues(queues) {
          // Top queues by size
          const topBySize = [...queues].sort((a, b) => b.size - a.size).slice(0, 5);
          const maxSize = topBySize.length > 0 ? topBySize[0].size : 1;

          const sizeContainer = document.getElementById('top-queues-size');
          if (sizeContainer) {
            if (topBySize.length === 0) {
              sizeContainer.innerHTML = '<div class="empty-state">No queue data</div>';
            } else {
              sizeContainer.innerHTML = topBySize.map((queue, index) => \`
                <div class="queue-item">
                  <div class="queue-header">
                    <span class="queue-name">#\${index + 1} \${queue.name}</span>
                    <strong>\${queue.size.toLocaleString()}</strong>
                  </div>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: \${(queue.size / maxSize) * 100}%; background: var(--vscode-testing-iconPassed);"></div>
                  </div>
                </div>
              \`).join('');
            }
          }

          // Top queues by latency
          const topByLatency = [...queues].sort((a, b) => b.latency - a.latency).slice(0, 5);

          const latencyContainer = document.getElementById('top-queues-latency');
          if (latencyContainer) {
            if (topByLatency.length === 0) {
              latencyContainer.innerHTML = '<div class="empty-state">No queue data</div>';
            } else {
              latencyContainer.innerHTML = topByLatency.map((queue, index) => \`
                <div class="queue-item">
                  <div class="queue-header">
                    <span class="queue-name">#\${index + 1} \${queue.name}</span>
                    <strong>\${queue.latency.toFixed(2)}s</strong>
                  </div>
                  <div class="queue-stats">
                    <span>Size: \${queue.size.toLocaleString()}</span>
                  </div>
                </div>
              \`).join('');
            }
          }
        }
      </script>
    </body>
    </html>`;
  }

  private async updateDashboardData(server: ServerConfig): Promise<void> {
    if (!this.panel) return;

    const stats = await this.sidekiqClient.getStats(server);
    const queues = await this.sidekiqClient.getQueues(server);

    // Fetch historical stats (default to 7 days)
    const historicalStats: any[] = []; // await this.sidekiqClient.getHistoricalStats(server, 7);

    // Calculate total enqueued across all queues
    const totalEnqueued = queues.reduce((sum, q) => sum + q.size, 0);

    // Update historical data
    this.updateHistoricalData(stats, totalEnqueued);

    // Calculate trends
    const trends = this.calculateTrends(stats);

    // Calculate processing metrics
    const processingRate = this.calculateProcessingRate();
    const errorRate = this.calculateErrorRate();

    // Prepare queue data with health status
    const queuesWithHealth = queues.map(queue => ({
      ...queue,
      healthStatus: this.getQueueHealthStatus(queue)
    }));

    // Get system health metrics
    const systemHealth = this.getSystemHealthMetrics(stats, queues, errorRate);

    // Send data update to webview
    this.panel.webview.postMessage({
      command: 'updateData',
      data: {
        stats,
        totalEnqueued,
        trends,
        processingRate,
        errorRate,
        queues: queuesWithHealth,
        systemHealth,
        historicalStats
      }
    });
  }

  private async handleExpandHistorical(_server: ServerConfig, _days: number): Promise<void> {
    if (!this.panel) return;

    // Fetch expanded historical stats
    const historicalStats: any[] = []; // await this.sidekiqClient.getHistoricalStats(server, days);

    // Send update with just historical data
    this.panel.webview.postMessage({
      command: 'updateData',
      data: {
        historicalStats
      }
    });
  }

  private getQueueHealthStatus(queue: any): { level: string; label: string; color: string } {
    if (queue.size === 0) {
      return { level: 'healthy', label: 'Healthy', color: 'var(--vscode-testing-iconPassed)' };
    }

    if (queue.size > 1000 || queue.latency > 60) {
      return { level: 'critical', label: 'Critical', color: 'var(--vscode-errorForeground)' };
    }

    if (queue.size > 100 || queue.latency > 30) {
      return { level: 'warning', label: 'Warning', color: 'var(--vscode-warningForeground)' };
    }

    return { level: 'healthy', label: 'Healthy', color: 'var(--vscode-testing-iconPassed)' };
  }

  private getSystemHealthMetrics(stats: SidekiqStats, queues: any[], errorRate: number): string[] {
    const metrics = [];

    // Worker health
    const workerUtilization = stats.processes > 0 ? (stats.workers / stats.processes) * 100 : 0;
    const workerStatus = workerUtilization > 80 ? 'critical' : workerUtilization > 50 ? 'warning' : 'healthy';
    metrics.push(`
      <div class="metric-row">
        <span class="metric-label">Worker Health</span>
        <span class="status-badge status-${workerStatus}">
          <span class="status-indicator"></span>
          ${workerUtilization.toFixed(0)}% Utilized
        </span>
      </div>
    `);

    // Queue health
    const highLoadQueues = queues.filter(q => q.size > 100).length;
    const queueStatus = highLoadQueues > 5 ? 'critical' : highLoadQueues > 2 ? 'warning' : 'healthy';
    metrics.push(`
      <div class="metric-row">
        <span class="metric-label">Queue Health</span>
        <span class="status-badge status-${queueStatus}">
          <span class="status-indicator"></span>
          ${highLoadQueues > 0 ? highLoadQueues + ' High Load' : 'All Healthy'}
        </span>
      </div>
    `);

    // Error rate health
    const errorStatus = errorRate > 5 ? 'critical' : errorRate > 2 ? 'warning' : 'healthy';
    metrics.push(`
      <div class="metric-row">
        <span class="metric-label">Error Rate</span>
        <span class="status-badge status-${errorStatus}">
          <span class="status-indicator"></span>
          ${errorRate.toFixed(2)}%
        </span>
      </div>
    `);

    // Retry queue health
    const retryStatus = stats.retries > 1000 ? 'critical' : stats.retries > 100 ? 'warning' : 'healthy';
    metrics.push(`
      <div class="metric-row">
        <span class="metric-label">Retry Queue</span>
        <span class="status-badge status-${retryStatus}">
          <span class="status-indicator"></span>
          ${stats.retries.toLocaleString()} Jobs
        </span>
      </div>
    `);

    // Dead queue health
    const deadStatus = stats.dead > 500 ? 'critical' : stats.dead > 100 ? 'warning' : 'healthy';
    metrics.push(`
      <div class="metric-row">
        <span class="metric-label">Dead Queue</span>
        <span class="status-badge status-${deadStatus}">
          <span class="status-indicator"></span>
          ${stats.dead.toLocaleString()} Jobs
        </span>
      </div>
    `);

    return metrics;
  }

  private updateHistoricalData(stats: SidekiqStats, totalEnqueued: number): void {
    const dataPoint: HistoricalDataPoint = {
      timestamp: Date.now(),
      processed: stats.processed,
      failed: stats.failed,
      enqueued: totalEnqueued,
      busy: stats.workers,
      retries: stats.retries
    };

    this.historicalData.push(dataPoint);

    // Keep only last 20 data points (enough for trending)
    if (this.historicalData.length > 20) {
      this.historicalData.shift();
    }
  }

  private calculateTrends(stats: SidekiqStats): { processed: number; failed: number; enqueued: number } {
    if (!this.previousStats) {
      this.previousStats = stats;
      return { processed: 0, failed: 0, enqueued: 0 };
    }

    const processedChange = this.previousStats.processed > 0
      ? ((stats.processed - this.previousStats.processed) / this.previousStats.processed) * 100
      : 0;

    const failedChange = this.previousStats.failed > 0
      ? ((stats.failed - this.previousStats.failed) / this.previousStats.failed) * 100
      : 0;

    const enqueuedChange = this.previousStats.enqueued > 0
      ? ((stats.enqueued - this.previousStats.enqueued) / this.previousStats.enqueued) * 100
      : 0;

    this.previousStats = stats;

    return {
      processed: processedChange,
      failed: failedChange,
      enqueued: enqueuedChange
    };
  }

  private calculateProcessingRate(): { perMinute: number; perHour: number } {
    if (this.historicalData.length < 2) {
      return { perMinute: 0, perHour: 0 };
    }

    const latest = this.historicalData[this.historicalData.length - 1];
    const oldest = this.historicalData[0];

    const timeDiffMinutes = (latest.timestamp - oldest.timestamp) / (1000 * 60);
    const processedDiff = latest.processed - oldest.processed;

    if (timeDiffMinutes === 0) {
      return { perMinute: 0, perHour: 0 };
    }

    const perMinute = processedDiff / timeDiffMinutes;
    const perHour = perMinute * 60;

    return { perMinute, perHour };
  }

  private calculateErrorRate(): number {
    if (this.historicalData.length < 2) {
      return 0;
    }

    const latest = this.historicalData[this.historicalData.length - 1];
    const oldest = this.historicalData[0];

    const processedDiff = latest.processed - oldest.processed;
    const failedDiff = latest.failed - oldest.failed;
    const total = processedDiff + failedDiff;

    if (total === 0) {
      return 0;
    }

    return (failedDiff / total) * 100;
  }

  private startAutoRefresh(server: ServerConfig): void {
    // Clear existing timer if any
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }

    const interval = this.licenseManager.getRefreshInterval();

    this.autoRefreshTimer = setInterval(async () => {
      if (this.panel) {
        await this.updateDashboardData(server);
      } else {
        if (this.autoRefreshTimer) {
          clearInterval(this.autoRefreshTimer);
          this.autoRefreshTimer = undefined;
        }
      }
    }, interval);
  }

  private async handleRetryJob(server: ServerConfig, job: any): Promise<void> {
    try {
      await this.sidekiqClient.retryJob(server, job);
      vscode.window.showInformationMessage('Job retried successfully');
      await this.updateDashboardData(server);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to retry job: ${error.message}`);
    }
  }

  private async handleDeleteJob(server: ServerConfig, job: any, from: string): Promise<void> {
    try {
      await this.sidekiqClient.deleteJob(server, job, from as any);
      vscode.window.showInformationMessage('Job deleted successfully');
      await this.updateDashboardData(server);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete job: ${error.message}`);
    }
  }

  private async handleExportData(server: ServerConfig): Promise<void> {
    try {
      const stats = await this.sidekiqClient.getStats(server);
      const queues = await this.sidekiqClient.getQueues(server);

      const exportData = {
        timestamp: new Date().toISOString(),
        server: server.name,
        stats,
        queues,
        historicalData: this.historicalData
      };

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`sidekiq-dashboard-${Date.now()}.json`),
        filters: {
          'JSON': ['json']
        }
      });

      if (uri) {
        const fs = require('fs');
        fs.writeFileSync(uri.fsPath, JSON.stringify(exportData, null, 2));
        vscode.window.showInformationMessage('Dashboard data exported successfully');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to export data: ${error.message}`);
    }
  }
}
