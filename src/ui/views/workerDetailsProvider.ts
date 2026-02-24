import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Worker } from '../../data/models/sidekiq';

export class WorkerDetailsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidekiqClient: SidekiqClient;
  private currentServer: ServerConfig | undefined;
  private currentWorker: Worker | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
  ) {
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  async showWorkerDetails(server: ServerConfig, worker: Worker): Promise<void> {
    this.currentServer = server;
    this.currentWorker = worker;

    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'sidekiqWorkerDetails',
        `Worker: ${this.getShortHostname(worker.hostname)}:${worker.pid}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentServer = undefined;
        this.currentWorker = undefined;
      });

      // Set up message handling only once when panel is created
      this.panel.webview.onDidReceiveMessage(
        async message => {
          if (!this.currentServer || !this.currentWorker) {
            return;
          }

          switch (message.command) {
            case 'refresh':
              await this.refreshWorkerDetails(this.currentServer, this.currentWorker);
              break;
            case 'toggleQueues':
              // Handle queue expansion toggle
              break;
            case 'toggleProcessDetails':
              // Handle process details expansion toggle
              break;
          }
        },
        undefined,
        this.context.subscriptions
      );
    }

    // Update panel content
    this.panel.title = `Worker: ${this.getShortHostname(worker.hostname)}:${worker.pid}`;
    this.panel.webview.html = await this.getWebviewContent(server, worker);
  }

  private getShortHostname(hostname: string): string {
    // Extract a shorter version of hostname (remove .local, take first part)
    return hostname.split('.')[0];
  }

  private getUptime(startedAt: Date): string {
    const now = new Date();
    const diff = now.getTime() - startedAt.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  private getTimeAgo(timestamp: number): string {
    const now = Date.now() / 1000;
    const diff = Math.floor(now - timestamp);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  private getJobDuration(job: any): string {
    if (!job.enqueuedAt) return '-';
    const now = new Date();
    const diff = now.getTime() - new Date(job.enqueuedAt).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatMemory(bytes: number): string {
    const mb = bytes / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  private async getWebviewContent(server: ServerConfig, initialWorker: Worker): Promise<string> {
    // Refresh worker data to get latest stats
    const worker = await this.sidekiqClient.getWorker(server, initialWorker.id) || initialWorker;

    const nonce = this.getNonce();
    const shortHostname = this.getShortHostname(worker.hostname);
    const uptime = this.getUptime(worker.started_at);
    const jobDuration = worker.job ? this.getJobDuration(worker.job) : null;

    // Process details
    const hasProcessDetails = worker.concurrency !== undefined || worker.beat !== undefined;
    const concurrency = worker.concurrency || 0;
    const busy = worker.busy || 0;
    const idleThreads = concurrency - busy;
    const utilization = concurrency > 0 ? (busy / concurrency) * 100 : 0;
    const beatAgo = worker.beat ? this.getTimeAgo(worker.beat) : 'Unknown';
    const isQuiet = worker.quiet || false;
    const rss = worker.rss || 0;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Worker Details: ${this.escapeHtml(shortHostname)}:${this.escapeHtml(worker.pid)}</title>
      <style>
        * {
          box-sizing: border-box;
        }
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 0;
          margin: 0;
          line-height: 1.5;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }

        /* Header Section */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header-left {
          flex: 1;
        }
        .header-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 4px 0;
          color: var(--vscode-foreground);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .status-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
          animation: pulse 2s ease-in-out infinite;
        }
        .status-indicator.idle {
          background-color: var(--vscode-charts-green);
        }
        .status-indicator.busy {
          background-color: var(--vscode-charts-orange);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .header-subtitle {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          margin: 0;
          font-family: var(--vscode-editor-font-family);
        }
        .header-actions {
          display: flex;
          gap: 8px;
        }
        .action-btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 14px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 13px;
          font-family: var(--vscode-font-family);
          transition: background-color 0.15s ease;
        }
        .action-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .action-btn:active {
          transform: translateY(1px);
        }

        /* Stats Grid */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }
        .stat-card {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 14px 16px;
          position: relative;
          overflow: hidden;
          transition: border-color 0.15s ease;
        }
        .stat-card:hover {
          border-color: var(--vscode-focusBorder);
        }
        .stat-card.highlight {
          border-left: 3px solid var(--vscode-charts-blue);
        }
        .stat-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
          font-weight: 500;
        }
        .stat-value {
          font-size: 18px;
          font-weight: 600;
          color: var(--vscode-foreground);
          word-break: break-word;
        }
        .stat-value.small {
          font-size: 15px;
        }
        .stat-value.large {
          font-size: 24px;
        }
        .stat-subtext {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
        }

        /* Status specific colors */
        .status-value.idle {
          color: var(--vscode-charts-green);
        }
        .status-value.busy {
          color: var(--vscode-charts-orange);
        }

        /* Process Details Section */
        .process-section {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          margin-bottom: 24px;
        }
        .process-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          cursor: pointer;
          user-select: none;
        }
        .process-header:hover .process-title {
          color: var(--vscode-foreground);
        }
        .process-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          transition: color 0.15s ease;
        }
        .process-toggle {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .process-toggle::after {
          content: '▼';
          font-size: 9px;
          transition: transform 0.2s ease;
        }
        .process-toggle.collapsed::after {
          transform: rotate(-90deg);
        }
        .process-content {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          padding: 4px 0;
        }
        .process-content.collapsed {
          display: none;
        }

        /* Metric Card */
        .metric-card {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 12px;
        }
        .metric-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          font-weight: 500;
        }
        .metric-value {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
          margin-bottom: 8px;
        }
        .metric-value.large {
          font-size: 20px;
        }
        .metric-subtext {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }

        /* Progress Bar */
        .progress-bar-container {
          margin-top: 8px;
        }
        .progress-bar {
          width: 100%;
          height: 8px;
          background: var(--vscode-input-background);
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }
        .progress-bar-fill {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 4px;
        }
        .progress-bar-fill.green {
          background: var(--vscode-charts-green);
        }
        .progress-bar-fill.yellow {
          background: var(--vscode-charts-yellow);
        }
        .progress-bar-fill.orange {
          background: var(--vscode-charts-orange);
        }
        .progress-bar-fill.red {
          background: var(--vscode-charts-red);
        }

        /* Badges */
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge.warning {
          background: var(--vscode-charts-orange);
          color: var(--vscode-editor-background);
        }
        .badge.success {
          background: var(--vscode-charts-green);
          color: var(--vscode-editor-background);
        }

        /* Queues Section */
        .queues-section {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          margin-bottom: 24px;
        }
        .queues-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          cursor: pointer;
          user-select: none;
        }
        .queues-header:hover .queues-title {
          color: var(--vscode-foreground);
        }
        .queues-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          transition: color 0.15s ease;
        }
        .queues-badge {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 8px;
        }
        .queues-toggle {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .queues-toggle::after {
          content: '▼';
          font-size: 9px;
          transition: transform 0.2s ease;
        }
        .queues-toggle.collapsed::after {
          transform: rotate(-90deg);
        }
        .queues-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 200px;
          overflow-y: auto;
          padding: 4px 0;
        }
        .queues-list.collapsed {
          display: none;
        }
        .queue-tag {
          display: inline-flex;
          align-items: center;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-family: var(--vscode-editor-font-family);
          transition: all 0.15s ease;
        }
        .queue-tag:hover {
          background: var(--vscode-list-hoverBackground);
          transform: translateY(-1px);
        }

        /* Section Title */
        .section-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-icon {
          width: 20px;
          height: 20px;
          opacity: 0.7;
        }

        /* Current Job Section */
        .job-section {
          margin-bottom: 24px;
        }
        .job-details {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          overflow: hidden;
        }
        .job-header {
          background: var(--vscode-editor-background);
          padding: 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .job-class {
          font-size: 16px;
          font-weight: 600;
          font-family: var(--vscode-editor-font-family);
          color: var(--vscode-charts-blue);
          margin-bottom: 6px;
        }
        .job-meta {
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          flex-wrap: wrap;
        }
        .job-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .job-meta-label {
          opacity: 0.8;
        }
        .job-meta-value {
          font-family: var(--vscode-editor-font-family);
          font-weight: 500;
        }
        .job-body {
          padding: 16px;
        }
        .job-row {
          margin-bottom: 16px;
        }
        .job-row:last-child {
          margin-bottom: 0;
        }
        .job-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 6px;
        }
        .job-value {
          font-family: var(--vscode-editor-font-family);
          font-size: 13px;
          color: var(--vscode-foreground);
        }
        .job-args {
          font-family: var(--vscode-editor-font-family);
          font-size: 12px;
          white-space: pre-wrap;
          max-height: 300px;
          overflow-y: auto;
          background: var(--vscode-editor-background);
          padding: 12px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border);
          line-height: 1.6;
        }

        /* Empty State */
        .empty-state {
          background: var(--vscode-sideBar-background);
          border: 1px dashed var(--vscode-panel-border);
          border-radius: 6px;
          padding: 48px 24px;
          text-align: center;
        }
        .empty-icon {
          font-size: 48px;
          opacity: 0.3;
          margin-bottom: 16px;
        }
        .empty-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
          margin-bottom: 8px;
        }
        .empty-message {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
          line-height: 1.6;
        }

        /* Duration badge */
        .duration-badge {
          display: inline-flex;
          align-items: center;
          background: var(--vscode-charts-yellow);
          color: var(--vscode-editor-background);
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 8px;
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--vscode-scrollbarSlider-background);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--vscode-scrollbarSlider-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="header-left">
            <h1 class="header-title">
              <span class="status-indicator ${worker.job ? 'busy' : 'idle'}"></span>
              Worker: ${this.escapeHtml(shortHostname)}:${this.escapeHtml(worker.pid)}
            </h1>
            <p class="header-subtitle">Full hostname: ${this.escapeHtml(worker.hostname)}</p>
          </div>
          <div class="header-actions">
            <button class="action-btn" onclick="refresh()">
              <span>↻</span> Refresh
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card highlight">
            <div class="stat-label">Status</div>
            <div class="stat-value large status-value ${worker.job ? 'busy' : 'idle'}">
              ${worker.job ? 'Processing' : 'Idle'}
            </div>
            ${worker.job && jobDuration ? `<div class="stat-subtext">Running for ${jobDuration}</div>` : ''}
          </div>

          <div class="stat-card">
            <div class="stat-label">Uptime</div>
            <div class="stat-value">${uptime}</div>
            <div class="stat-subtext">${worker.started_at instanceof Date ? worker.started_at.toLocaleString() : worker.started_at}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Environment</div>
            <div class="stat-value small">${this.escapeHtml(server.name)}</div>
            ${worker.tag ? `<div class="stat-subtext">Tag: ${this.escapeHtml(worker.tag)}</div>` : ''}
          </div>

          <div class="stat-card">
            <div class="stat-label">Process ID</div>
            <div class="stat-value small">${this.escapeHtml(worker.pid)}</div>
            <div class="stat-subtext">Thread: ${this.escapeHtml(worker.id.split(':').pop() || '-')}</div>
          </div>
        </div>

        ${hasProcessDetails ? `
        <div class="process-section">
          <div class="process-header" onclick="toggleProcessDetails()">
            <div class="process-title">Process Details</div>
            <div class="process-toggle" id="process-toggle">Expand</div>
          </div>
          <div class="process-content collapsed" id="process-content">
            <div class="metric-card">
              <div class="metric-label">Concurrency</div>
              <div class="metric-value large">${concurrency}</div>
              <div class="metric-subtext">Total threads available</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">Busy Threads</div>
              <div class="metric-value large">${busy} / ${concurrency}</div>
              <div class="metric-subtext">${idleThreads} idle threads</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">Thread Utilization</div>
              <div class="metric-value">${utilization.toFixed(1)}%</div>
              <div class="progress-bar-container">
                <div class="progress-bar">
                  <div class="progress-bar-fill ${utilization < 50 ? 'green' : utilization < 75 ? 'yellow' : utilization < 90 ? 'orange' : 'red'}" style="width: ${utilization}%"></div>
                </div>
              </div>
              <div class="metric-subtext">${busy} of ${concurrency} threads in use</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">Last Heartbeat</div>
              <div class="metric-value">${beatAgo}</div>
              <div class="metric-subtext">Process health check</div>
            </div>

            ${isQuiet ? `
            <div class="metric-card">
              <div class="metric-label">Quiet Mode</div>
              <div class="metric-value">
                <span class="badge warning">SHUTTING DOWN</span>
              </div>
              <div class="metric-subtext">Worker is gracefully stopping</div>
            </div>
            ` : `
            <div class="metric-card">
              <div class="metric-label">Quiet Mode</div>
              <div class="metric-value">
                <span class="badge success">ACTIVE</span>
              </div>
              <div class="metric-subtext">Worker is accepting jobs</div>
            </div>
            `}

            ${rss > 0 ? `
            <div class="metric-card">
              <div class="metric-label">Memory Usage (RSS)</div>
              <div class="metric-value">${this.formatMemory(rss)}</div>
              <div class="metric-subtext">Resident set size</div>
            </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <div class="queues-section">
          <div class="queues-header" onclick="toggleQueues()">
            <div>
              <span class="queues-title">Listening on Queues</span>
              <span class="queues-badge">${worker.queues.length}</span>
            </div>
            <div class="queues-toggle" id="queues-toggle">
              ${worker.queues.length > 10 ? 'Click to expand' : 'View all'}
            </div>
          </div>
          <div class="queues-list ${worker.queues.length > 10 ? 'collapsed' : ''}" id="queues-list">
            ${worker.queues.map(q => `<span class="queue-tag">${this.escapeHtml(q)}</span>`).join('')}
          </div>
        </div>

        <div class="job-section">
          <h2 class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 11a5 5 0 110-10 5 5 0 010 10z"/>
              <path d="M8 4.5a.5.5 0 01.5.5v3.5a.5.5 0 01-1 0V5a.5.5 0 01.5-.5z"/>
              <path d="M8 10a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
            </svg>
            Current Job
          </h2>
          ${worker.job ? `
            <div class="job-details">
              <div class="job-header">
                <div class="job-class">${this.escapeHtml(worker.job.class)}</div>
                <div class="job-meta">
                  <div class="job-meta-item">
                    <span class="job-meta-label">Queue:</span>
                    <span class="job-meta-value">${this.escapeHtml(worker.job.queue)}</span>
                  </div>
                  <div class="job-meta-item">
                    <span class="job-meta-label">Job ID:</span>
                    <span class="job-meta-value">${this.escapeHtml(worker.job.id.substring(0, 12))}...</span>
                  </div>
                  ${jobDuration ? `
                  <div class="job-meta-item">
                    <span class="job-meta-label">Duration:</span>
                    <span class="job-meta-value">${jobDuration}</span>
                  </div>
                  ` : ''}
                </div>
              </div>
              <div class="job-body">
                <div class="job-row">
                  <div class="job-label">Created At</div>
                  <div class="job-value">${worker.job.createdAt instanceof Date ? worker.job.createdAt.toLocaleString() : worker.job.createdAt}</div>
                </div>
                ${worker.job.enqueuedAt ? `
                <div class="job-row">
                  <div class="job-label">Enqueued At</div>
                  <div class="job-value">${worker.job.enqueuedAt instanceof Date ? worker.job.enqueuedAt.toLocaleString() : worker.job.enqueuedAt}</div>
                </div>
                ` : ''}
                ${worker.job.retryCount !== undefined && worker.job.retryCount > 0 ? `
                <div class="job-row">
                  <div class="job-label">Retry Count</div>
                  <div class="job-value">${worker.job.retryCount}</div>
                </div>
                ` : ''}
                <div class="job-row">
                  <div class="job-label">Arguments</div>
                  <div class="job-args">${this.escapeHtml(JSON.stringify(worker.job.args, null, 2))}</div>
                </div>
              </div>
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">💤</div>
              <div class="empty-title">Worker is Idle</div>
              <div class="empty-message">
                This worker is currently not processing any jobs.<br>
                It's listening to ${worker.queues.length} queue${worker.queues.length !== 1 ? 's' : ''} and ready to process work.
              </div>
            </div>
          `}
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function refresh() {
          vscode.postMessage({ command: 'refresh' });
        }

        function toggleQueues() {
          const list = document.getElementById('queues-list');
          const toggle = document.getElementById('queues-toggle');

          if (list.classList.contains('collapsed')) {
            list.classList.remove('collapsed');
            toggle.classList.remove('collapsed');
            toggle.textContent = 'Click to collapse';
          } else {
            list.classList.add('collapsed');
            toggle.classList.add('collapsed');
            toggle.textContent = 'Click to expand';
          }
        }

        function toggleProcessDetails() {
          const content = document.getElementById('process-content');
          const toggle = document.getElementById('process-toggle');

          if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            toggle.classList.remove('collapsed');
            toggle.textContent = 'Collapse';
          } else {
            content.classList.add('collapsed');
            toggle.classList.add('collapsed');
            toggle.textContent = 'Expand';
          }
        }
      </script>
    </body>
    </html>`;
  }

  private async refreshWorkerDetails(server: ServerConfig, worker: Worker): Promise<void> {
    if (this.panel) {
      this.panel.webview.html = await this.getWebviewContent(server, worker);
    }
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private escapeHtml(unsafe: string | number | undefined | null): string {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
