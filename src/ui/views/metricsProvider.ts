import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { ServerConfig } from '../../data/models/server';
import { TIER_NAMES } from '../../licensing/features';

interface MetricData {
  key: string;
  value: number;
  timestamp: string;
}

interface JobMetrics {
  jobClass: string;
  namespace: string;
  metrics: {
    duration?: number[];
    success?: number;
    failure?: number;
    total?: number;
  };
}

interface GroupedMetrics {
  [namespace: string]: {
    [jobClass: string]: JobMetrics;
  };
}

export class MetricsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private connectionManager: ConnectionManager;
  private autoRefreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    private licenseManager: LicenseManager
  ) {
    this.connectionManager = connectionManager;
  }

  async showMetrics(server: ServerConfig): Promise<void> {
    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
      this.panel.title = `Custom Metrics - ${server.name}`;
      await this.updateMetricsData(server);
      return;
    }

    // Create new panel
    this.panel = vscode.window.createWebviewPanel(
      'sidekiqMetrics',
      `Custom Metrics - ${server.name}`,
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
    });

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this.updateMetricsData(server);
            break;
          case 'filter':
            await this.updateMetricsData(server, message.searchTerm);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Initial content
    this.panel.webview.html = this.getWebviewHtml(server);

    // Load initial data
    await this.updateMetricsData(server);

    // Start auto-refresh
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
      <title>Custom Metrics</title>
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

        .search-container {
          margin-bottom: 24px;
        }

        .search-input {
          width: 100%;
          max-width: 500px;
          padding: 10px 16px;
          font-size: 14px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 6px;
          outline: none;
        }

        .search-input:focus {
          border-color: var(--vscode-focusBorder);
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
        }

        .stat-card:hover {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }

        .stat-label {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .stat-value {
          font-size: 32px;
          font-weight: 700;
          line-height: 1;
          margin-bottom: 8px;
        }

        .namespace-section {
          margin-bottom: 32px;
        }

        .namespace-title {
          font-size: 20px;
          font-weight: 600;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .job-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 16px;
          transition: all 0.2s;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .job-card:hover {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }

        .job-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .job-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        .success-rate {
          font-size: 14px;
          font-weight: 600;
          padding: 4px 12px;
          border-radius: 4px;
        }

        .rate-excellent {
          background: rgba(75, 192, 192, 0.2);
          color: var(--vscode-testing-iconPassed);
        }

        .rate-good {
          background: rgba(54, 162, 235, 0.2);
          color: #36A2EB;
        }

        .rate-warning {
          background: rgba(255, 206, 86, 0.2);
          color: var(--vscode-warningForeground);
        }

        .rate-critical {
          background: rgba(255, 99, 132, 0.2);
          color: var(--vscode-errorForeground);
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 16px;
        }

        .metric-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .metric-item-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.5px;
        }

        .metric-item-value {
          font-size: 20px;
          font-weight: 700;
        }

        .value-success {
          color: var(--vscode-testing-iconPassed);
        }

        .value-failure {
          color: var(--vscode-errorForeground);
        }

        .value-duration {
          color: var(--vscode-debugIcon-startForeground);
        }

        .value-total {
          color: var(--vscode-foreground);
        }

        .empty-state {
          text-align: center;
          padding: 60px 40px;
          color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .empty-state-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .empty-state-description {
          font-size: 14px;
          opacity: 0.8;
        }

        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 60px;
          color: var(--vscode-descriptionForeground);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <h1 class="header-title">Custom Metrics</h1>
          <div class="last-updated">
            <div class="refresh-indicator"></div>
            <span id="lastUpdated">Just now</span>
          </div>
        </div>
        <div class="header-actions">
          <span class="tier-badge">${tierName}</span>
          <button class="btn" onclick="refresh()">
            <span>&#x1F504;</span> Refresh
          </button>
        </div>
      </div>

      <div class="search-container">
        <input
          type="text"
          class="search-input"
          id="searchInput"
          placeholder="Search metrics by job name or namespace..."
          onkeyup="handleSearch()"
        />
      </div>

      <!-- Summary Stats -->
      <div class="stats-grid" id="summaryStats">
        <div class="stat-card">
          <div class="stat-label">Total Jobs Tracked</div>
          <div class="stat-value" id="total-jobs">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Executions</div>
          <div class="stat-value value-total" id="total-executions">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Successes</div>
          <div class="stat-value value-success" id="total-successes">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Failures</div>
          <div class="stat-value value-failure" id="total-failures">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Overall Success Rate</div>
          <div class="stat-value value-success" id="overall-success-rate">0%</div>
        </div>
      </div>

      <!-- Metrics Content -->
      <div id="metricsContent">
        <div class="loading">Loading metrics...</div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

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

        let searchTimeout;
        function handleSearch() {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            const searchTerm = document.getElementById('searchInput').value;
            vscode.postMessage({ command: 'filter', searchTerm });
          }, 300);
        }

        // Update metrics data
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.command === 'updateData') {
            updateMetrics(message.data);
          }
        });

        function updateMetrics(data) {
          // Update summary stats
          updateElement('total-jobs', data.summary.totalJobs.toLocaleString());
          updateElement('total-executions', data.summary.totalExecutions.toLocaleString());
          updateElement('total-successes', data.summary.totalSuccesses.toLocaleString());
          updateElement('total-failures', data.summary.totalFailures.toLocaleString());
          updateElement('overall-success-rate', data.summary.successRate.toFixed(2) + '%');

          // Update metrics content
          const container = document.getElementById('metricsContent');

          if (data.metrics.length === 0) {
            container.innerHTML = \`
              <div class="empty-state">
                <div class="empty-state-icon">&#x1F4CA;</div>
                <div class="empty-state-title">No Metrics Found</div>
                <div class="empty-state-description">
                  No application metrics matching pattern "metrics:*" were found in Redis.
                  <br>Metrics will appear here once your application starts logging them.
                </div>
              </div>
            \`;
            return;
          }

          // Group metrics by namespace
          const namespaces = {};
          data.metrics.forEach(metric => {
            if (!namespaces[metric.namespace]) {
              namespaces[metric.namespace] = [];
            }
            namespaces[metric.namespace].push(metric);
          });

          let html = '';
          for (const [namespace, jobs] of Object.entries(namespaces)) {
            html += \`
              <div class="namespace-section">
                <h2 class="namespace-title">
                  <span>&#x1F4E6;</span> \${namespace}
                </h2>
                <div class="jobs-list">
                  \${jobs.map(job => renderJobCard(job)).join('')}
                </div>
              </div>
            \`;
          }

          container.innerHTML = html;
        }

        function renderJobCard(job) {
          const successRate = job.metrics.total > 0
            ? (job.metrics.success / job.metrics.total) * 100
            : 0;

          let rateClass = 'rate-excellent';
          if (successRate < 100) rateClass = 'rate-good';
          if (successRate < 95) rateClass = 'rate-warning';
          if (successRate < 80) rateClass = 'rate-critical';

          const avgDuration = job.metrics.avgDuration
            ? job.metrics.avgDuration.toFixed(2) + 's'
            : 'N/A';

          return \`
            <div class="job-card">
              <div class="job-header">
                <div class="job-name">\${job.jobClass}</div>
                <div class="success-rate \${rateClass}">
                  \${successRate.toFixed(1)}% Success
                </div>
              </div>
              <div class="metrics-grid">
                <div class="metric-item">
                  <div class="metric-item-label">Total Runs</div>
                  <div class="metric-item-value value-total">\${job.metrics.total.toLocaleString()}</div>
                </div>
                <div class="metric-item">
                  <div class="metric-item-label">Successes</div>
                  <div class="metric-item-value value-success">\${job.metrics.success.toLocaleString()}</div>
                </div>
                <div class="metric-item">
                  <div class="metric-item-label">Failures</div>
                  <div class="metric-item-value value-failure">\${job.metrics.failure.toLocaleString()}</div>
                </div>
                <div class="metric-item">
                  <div class="metric-item-label">Avg Duration</div>
                  <div class="metric-item-value value-duration">\${avgDuration}</div>
                </div>
              </div>
            </div>
          \`;
        }

        function updateElement(id, value) {
          const element = document.getElementById(id);
          if (element) {
            element.innerHTML = value;
          }
        }
      </script>
    </body>
    </html>`;
  }

  private async updateMetricsData(server: ServerConfig, searchTerm?: string): Promise<void> {
    if (!this.panel) return;

    try {
      const redis = await this.connectionManager.getConnection(server);

      // Fetch all metric keys
      const metricKeys = await redis.keys('metrics:*');

      // Parse and group metrics
      const groupedMetrics: GroupedMetrics = {};
      const metricsData: MetricData[] = [];

      for (const key of metricKeys) {
        const value = await redis.get(key);
        if (value) {
          metricsData.push({
            key,
            value: parseInt(value, 10) || 0,
            timestamp: this.extractTimestamp(key)
          });
        }
      }

      // Group by job class and metric type
      for (const metric of metricsData) {
        const parsed = this.parseMetricKey(metric.key);
        if (!parsed) continue;

        const { namespace, jobClass, metricType } = parsed;

        if (!groupedMetrics[namespace]) {
          groupedMetrics[namespace] = {};
        }

        if (!groupedMetrics[namespace][jobClass]) {
          groupedMetrics[namespace][jobClass] = {
            jobClass,
            namespace,
            metrics: {}
          };
        }

        const jobMetrics = groupedMetrics[namespace][jobClass].metrics;

        if (metricType === 'duration') {
          if (!jobMetrics.duration) {
            jobMetrics.duration = [];
          }
          jobMetrics.duration.push(metric.value);
        } else if (metricType === 'success') {
          jobMetrics.success = (jobMetrics.success || 0) + metric.value;
        } else if (metricType === 'failure') {
          jobMetrics.failure = (jobMetrics.failure || 0) + metric.value;
        }
      }

      // Calculate totals and averages
      const processedMetrics: any[] = [];
      let totalJobs = 0;
      let totalExecutions = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;

      for (const namespace of Object.keys(groupedMetrics)) {
        for (const jobClass of Object.keys(groupedMetrics[namespace])) {
          const jobMetric = groupedMetrics[namespace][jobClass];
          const success = jobMetric.metrics.success || 0;
          const failure = jobMetric.metrics.failure || 0;
          const total = success + failure;

          // Apply search filter if provided
          if (searchTerm && searchTerm.trim() !== '') {
            const search = searchTerm.toLowerCase();
            const matchesJob = jobClass.toLowerCase().includes(search);
            const matchesNamespace = namespace.toLowerCase().includes(search);

            if (!matchesJob && !matchesNamespace) {
              continue;
            }
          }

          const avgDuration = jobMetric.metrics.duration && jobMetric.metrics.duration.length > 0
            ? jobMetric.metrics.duration.reduce((a, b) => a + b, 0) / jobMetric.metrics.duration.length / 1000 // Convert to seconds
            : 0;

          processedMetrics.push({
            namespace,
            jobClass,
            metrics: {
              success,
              failure,
              total,
              avgDuration
            }
          });

          totalJobs++;
          totalExecutions += total;
          totalSuccesses += success;
          totalFailures += failure;
        }
      }

      // Sort by total executions
      processedMetrics.sort((a, b) => b.metrics.total - a.metrics.total);

      const successRate = totalExecutions > 0 ? (totalSuccesses / totalExecutions) * 100 : 0;

      // Send data to webview
      this.panel.webview.postMessage({
        command: 'updateData',
        data: {
          metrics: processedMetrics,
          summary: {
            totalJobs,
            totalExecutions,
            totalSuccesses,
            totalFailures,
            successRate
          }
        }
      });
    } catch (error: any) {
      console.error('Failed to fetch metrics:', error);
      vscode.window.showErrorMessage(`Failed to fetch metrics: ${error.message}`);
    }
  }

  private parseMetricKey(key: string): { namespace: string; jobClass: string; metricType: string } | null {
    // Expected format: metrics:namespace.job_class.metric_type:timestamp
    // Example: metrics:openstates.sync_bill_job.sync_bill.duration:2026013020

    const match = key.match(/^metrics:([^:]+):([^:]+)$/);
    if (!match) return null;

    const [, metricPath, _timestamp] = match;
    const parts = metricPath.split('.');

    if (parts.length < 3) return null;

    // Extract metric type (last part)
    const metricType = parts[parts.length - 1];

    // Extract namespace (first part)
    const namespace = parts[0];

    // Extract job class (everything between namespace and metric type)
    const jobClass = parts.slice(1, -1).join('.');

    return { namespace, jobClass, metricType };
  }

  private extractTimestamp(key: string): string {
    // Extract timestamp from key: metrics:path:timestamp
    const parts = key.split(':');
    return parts[parts.length - 1] || '';
  }

  private startAutoRefresh(server: ServerConfig): void {
    // Clear existing timer if any
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }

    const interval = this.licenseManager.getRefreshInterval();

    this.autoRefreshTimer = setInterval(async () => {
      if (this.panel) {
        await this.updateMetricsData(server);
      } else {
        if (this.autoRefreshTimer) {
          clearInterval(this.autoRefreshTimer);
          this.autoRefreshTimer = undefined;
        }
      }
    }, interval);
  }
}
