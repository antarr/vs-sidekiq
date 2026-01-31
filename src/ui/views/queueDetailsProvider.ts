import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Queue } from '../../data/models/sidekiq';

export class QueueDetailsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidekiqClient: SidekiqClient;

  constructor(
    private context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
  ) {
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  async showQueueDetails(server: ServerConfig, queue: Queue): Promise<void> {
    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'sidekiqQueueDetails',
        `Queue: ${queue.name}`,
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
    this.panel.title = `Queue: ${queue.name}`;
    this.panel.webview.html = await this.getWebviewContent(server, queue);

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this.refreshQueueDetails(server, queue);
            break;
          case 'clearQueue':
            vscode.commands.executeCommand('sidekiq.clearQueue', { queue, name: queue.name });
            // The clearQueue command will trigger a refresh via events or we can manually refresh
            setTimeout(() => this.refreshQueueDetails(server, queue), 1000);
            break;
          case 'copyJobId':
            await vscode.env.clipboard.writeText(message.jobId);
            vscode.window.showInformationMessage('Job ID copied to clipboard');
            break;
          case 'copyArguments':
            await vscode.env.clipboard.writeText(message.args);
            vscode.window.showInformationMessage('Arguments copied to clipboard');
            break;
          case 'deleteJob':
            // Implement delete job functionality
            vscode.window.showInformationMessage(`Delete job ${message.jobId}`);
            break;
          case 'retryJob':
            // Implement retry job functionality
            vscode.window.showInformationMessage(`Retry job ${message.jobId}`);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  private async getWebviewContent(server: ServerConfig, queue: Queue): Promise<string> {
    // Refresh queue data to get latest stats
    const queues = await this.sidekiqClient.getQueues(server);
    const updatedQueue = queues.find(q => q.name === queue.name) || queue;

    // Get jobs
    const jobs = await this.sidekiqClient.getQueueJobs(server, queue.name, 0, 99);

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Queue Details: ${this.escapeHtml(queue.name)}</title>
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
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px;
        }

        /* Header Section */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-title h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }

        .queue-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
        }

        .header-actions {
          display: flex;
          gap: 8px;
        }

        .action-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 14px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: background-color 0.15s ease;
        }

        .action-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }

        .action-btn.secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }

        .action-btn.secondary:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        .action-btn.danger {
          background: var(--vscode-inputValidation-errorBackground);
          color: var(--vscode-errorForeground);
          border: 1px solid var(--vscode-errorForeground);
        }

        .action-btn.danger:hover {
          background: var(--vscode-errorForeground);
          color: var(--vscode-button-foreground);
        }

        /* Stats Grid */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }

        .stat-card {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 20px;
          position: relative;
          overflow: hidden;
          transition: all 0.2s ease;
        }

        .stat-card:hover {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }

        .stat-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: var(--stat-accent-color, var(--vscode-focusBorder));
        }

        .stat-card.primary::before {
          background: #0078d4;
        }

        .stat-card.success::before {
          background: #16a34a;
        }

        .stat-card.warning::before {
          background: #ea580c;
        }

        .stat-label {
          font-size: 11px;
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
          margin-bottom: 4px;
        }

        .stat-subtext {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
        }

        /* Section Header */
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 32px 0 16px;
        }

        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
          color: var(--vscode-foreground);
        }

        .section-meta {
          font-size: 13px;
          color: var(--vscode-descriptionForeground);
        }

        /* Search and Filter Bar */
        .toolbar {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
          padding: 12px;
          background: var(--vscode-sideBar-background);
          border-radius: 6px;
          border: 1px solid var(--vscode-panel-border);
        }

        .search-box {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          padding: 6px 12px;
        }

        .search-box input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--vscode-input-foreground);
          font-size: 13px;
          outline: none;
        }

        .search-box input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }

        /* Jobs Table */
        .table-container {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          overflow: hidden;
        }

        .jobs-table {
          width: 100%;
          border-collapse: collapse;
        }

        .jobs-table thead {
          background: var(--vscode-editor-background);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .jobs-table th {
          padding: 12px 16px;
          text-align: left;
          font-weight: 600;
          font-size: 12px;
          color: var(--vscode-foreground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 2px solid var(--vscode-panel-border);
          white-space: nowrap;
        }

        .jobs-table th.sortable {
          cursor: pointer;
          user-select: none;
        }

        .jobs-table th.sortable:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .jobs-table tbody tr {
          border-bottom: 1px solid var(--vscode-panel-border);
          transition: background-color 0.15s ease;
        }

        .jobs-table tbody tr:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .jobs-table td {
          padding: 16px;
          color: var(--vscode-foreground);
          vertical-align: top;
        }

        .job-class {
          font-weight: 600;
          font-family: var(--vscode-editor-font-family);
          font-size: 13px;
          color: var(--vscode-symbolIcon-classForeground);
        }

        .job-id {
          font-family: var(--vscode-editor-font-family);
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .copy-btn {
          opacity: 0;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          padding: 2px 6px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
          transition: opacity 0.15s ease;
        }

        tr:hover .copy-btn {
          opacity: 1;
        }

        .copy-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Arguments Display - Enhanced */
        .job-args-container {
          position: relative;
        }

        .job-args {
          font-family: var(--vscode-editor-font-family);
          font-size: 12px;
          background: var(--vscode-textBlockQuote-background);
          padding: 8px 10px;
          border-radius: 4px;
          border-left: 3px solid var(--vscode-textBlockQuote-border);
          max-height: 80px;
          overflow-y: auto;
          overflow-x: hidden;
          position: relative;
        }

        .job-args.collapsed {
          max-height: 40px;
          overflow: hidden;
        }

        .job-args-preview {
          color: var(--vscode-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .job-args-full {
          white-space: pre-wrap;
          word-break: break-all;
          color: var(--vscode-foreground);
        }

        .expand-btn {
          display: inline-block;
          margin-top: 4px;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
        }

        .expand-btn:hover {
          color: var(--vscode-textLink-activeForeground);
          text-decoration: underline;
        }

        .job-timestamp {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
        }

        .time-ago {
          display: block;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-top: 2px;
        }

        /* Row Actions */
        .row-actions {
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        tr:hover .row-actions {
          opacity: 1;
        }

        .icon-btn {
          background: transparent;
          border: 1px solid var(--vscode-button-border);
          color: var(--vscode-foreground);
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
          transition: all 0.15s ease;
        }

        .icon-btn:hover {
          background: var(--vscode-button-secondaryBackground);
        }

        .icon-btn.danger:hover {
          background: var(--vscode-inputValidation-errorBackground);
          color: var(--vscode-errorForeground);
          border-color: var(--vscode-errorForeground);
        }

        /* Empty State */
        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .empty-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--vscode-foreground);
        }

        .empty-description {
          font-size: 14px;
          max-width: 400px;
          margin: 0 auto 20px;
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        ::-webkit-scrollbar-track {
          background: var(--vscode-editor-background);
        }

        ::-webkit-scrollbar-thumb {
          background: var(--vscode-scrollbarSlider-background);
          border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: var(--vscode-scrollbarSlider-hoverBackground);
        }

        /* Responsive */
        @media (max-width: 768px) {
          .stats-grid {
            grid-template-columns: 1fr;
          }

          .header {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }

          .jobs-table th:nth-child(2),
          .jobs-table td:nth-child(2) {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="header-title">
            <h1>${this.escapeHtml(updatedQueue.name)}</h1>
            <span class="queue-badge">Queue</span>
          </div>
          <div class="header-actions">
            <button class="action-btn secondary" onclick="refresh()">
              <span>↻</span> Refresh
            </button>
            <button class="action-btn danger" onclick="clearQueue()">
              <span>✕</span> Clear Queue
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card primary">
            <div class="stat-label">Queue Size</div>
            <div class="stat-value">${updatedQueue.size.toLocaleString()}</div>
            <div class="stat-subtext">${updatedQueue.size === 0 ? 'Empty queue' : updatedQueue.size === 1 ? '1 job pending' : `${updatedQueue.size} jobs pending`}</div>
          </div>
          <div class="stat-card success">
            <div class="stat-label">Latency</div>
            <div class="stat-value">${updatedQueue.latency ? updatedQueue.latency.toFixed(2) : '0.00'}s</div>
            <div class="stat-subtext">${updatedQueue.latency > 10 ? 'High latency detected' : 'Processing normally'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Server</div>
            <div class="stat-value" style="font-size: 16px; margin-top: 8px;">${this.escapeHtml(server.name)}</div>
            <div class="stat-subtext">${server.environment || 'Production'} Environment</div>
          </div>
        </div>

        <div class="section-header">
          <h2 class="section-title">Recent Jobs</h2>
          <div class="section-meta">Showing ${Math.min(jobs.length, 100)} of ${updatedQueue.size.toLocaleString()} jobs</div>
        </div>

        <div class="toolbar">
          <div class="search-box">
            <span>🔍</span>
            <input type="text" id="searchInput" placeholder="Search by class name, ID, or arguments..." onkeyup="filterJobs()">
          </div>
        </div>

        <div class="table-container">
          ${jobs.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">📭</div>
              <div class="empty-title">Queue is Empty</div>
              <div class="empty-description">
                There are no jobs currently in this queue. Jobs will appear here when they are enqueued.
              </div>
            </div>
          ` : `
            <table class="jobs-table" id="jobsTable">
              <thead>
                <tr>
                  <th class="sortable" onclick="sortTable(0)">Class</th>
                  <th>Job ID</th>
                  <th>Arguments</th>
                  <th class="sortable" onclick="sortTable(3)">Enqueued At</th>
                  <th style="width: 120px;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${jobs.map((job, index) => {
                  const argsStr = JSON.stringify(job.args, null, 2);
                  const argsPreview = this.formatArgumentsPreview(job.args);
                  const enqueuedAt = job.enqueuedAt ? job.enqueuedAt : (job.createdAt ? job.createdAt : null);
                  const timeAgo = enqueuedAt ? this.getTimeAgo(enqueuedAt) : 'N/A';

                  return `
                    <tr data-class="${this.escapeHtml(job.class)}" data-id="${this.escapeHtml(job.id)}">
                      <td>
                        <div class="job-class">${this.escapeHtml(job.class)}</div>
                      </td>
                      <td>
                        <div class="job-id">
                          <span>${this.escapeHtml(job.id.substring(0, 16))}...</span>
                          <button class="copy-btn" onclick='copyJobId("${this.escapeHtml(job.id)}")'>Copy</button>
                        </div>
                      </td>
                      <td>
                        <div class="job-args-container">
                          <div class="job-args collapsed" id="args-${index}" data-preview="${this.escapeHtml(argsPreview)}" data-index="${index}">
                            <div class="job-args-preview">${this.escapeHtml(argsPreview)}</div>
                          </div>
                          <span class="expand-btn" onclick="toggleArgs(${index})">Show full</span>
                        </div>
                      </td>
                      <td>
                        <div class="job-timestamp">
                          ${enqueuedAt ? enqueuedAt.toLocaleString() : 'N/A'}
                          <span class="time-ago">${timeAgo}</span>
                        </div>
                      </td>
                      <td>
                        <div class="row-actions">
                          <button class="icon-btn" onclick='retryJob("${this.escapeHtml(job.id)}")' title="Retry Job">↻</button>
                          <button class="icon-btn" onclick='copyArgs(${JSON.stringify(argsStr)})' title="Copy Arguments">📋</button>
                          <button class="icon-btn danger" onclick='deleteJob("${this.escapeHtml(job.id)}")' title="Delete Job">✕</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const jobArgs = ${JSON.stringify(jobs.map(job => JSON.stringify(job.args, null, 2)))};
        const expandedRows = new Set();

        function refresh() {
          vscode.postMessage({ command: 'refresh' });
        }

        function clearQueue() {
          if (confirm('Are you sure you want to clear all jobs from this queue? This action cannot be undone.')) {
            vscode.postMessage({ command: 'clearQueue' });
          }
        }

        function copyJobId(jobId) {
          vscode.postMessage({ command: 'copyJobId', jobId: jobId });
        }

        function copyArgs(args) {
          vscode.postMessage({ command: 'copyArguments', args: args });
        }

        function deleteJob(jobId) {
          if (confirm('Are you sure you want to delete this job?')) {
            vscode.postMessage({ command: 'deleteJob', jobId: jobId });
          }
        }

        function retryJob(jobId) {
          vscode.postMessage({ command: 'retryJob', jobId: jobId });
        }

        function toggleArgs(index) {
          const argsDiv = document.getElementById('args-' + index);
          const btn = argsDiv.nextElementSibling;

          if (expandedRows.has(index)) {
            // Collapse - show preview
            argsDiv.classList.add('collapsed');
            const preview = argsDiv.dataset.preview || '';
            argsDiv.innerHTML = '<div class="job-args-preview">' + escapeHtml(preview) + '</div>';
            btn.textContent = 'Show full';
            expandedRows.delete(index);
          } else {
            // Expand - show full JSON
            argsDiv.classList.remove('collapsed');
            argsDiv.innerHTML = '<div class="job-args-full">' + escapeHtml(jobArgs[index]) + '</div>';
            btn.textContent = 'Show less';
            expandedRows.add(index);
          }
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function filterJobs() {
          const searchTerm = document.getElementById('searchInput').value.toLowerCase();
          const table = document.getElementById('jobsTable');
          if (!table) return;

          const rows = table.getElementsByTagName('tr');

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const className = row.dataset.class.toLowerCase();
            const jobId = row.dataset.id.toLowerCase();
            const text = row.textContent.toLowerCase();

            if (className.includes(searchTerm) || jobId.includes(searchTerm) || text.includes(searchTerm)) {
              row.style.display = '';
            } else {
              row.style.display = 'none';
            }
          }
        }

        function sortTable(columnIndex) {
          const table = document.getElementById('jobsTable');
          if (!table) return;

          const tbody = table.getElementsByTagName('tbody')[0];
          const rows = Array.from(tbody.getElementsByTagName('tr'));

          rows.sort((a, b) => {
            const aText = a.getElementsByTagName('td')[columnIndex].textContent;
            const bText = b.getElementsByTagName('td')[columnIndex].textContent;
            return aText.localeCompare(bText);
          });

          rows.forEach(row => tbody.appendChild(row));
        }
      </script>
    </body>
    </html>`;
  }

  private formatArgumentsPreview(args: any[]): string {
    if (!args || args.length === 0) {
      return '[]';
    }

    // Create a concise preview
    const preview = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        if (Array.isArray(arg)) {
          return `[${arg.length} items]`;
        }
        const keys = Object.keys(arg);
        return `{${keys.slice(0, 2).join(', ')}${keys.length > 2 ? '...' : ''}}`;
      }
      return String(arg).substring(0, 30);
    }).join(', ');

    return `[${preview}]`;
  }

  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private async refreshQueueDetails(server: ServerConfig, queue: Queue): Promise<void> {
    if (this.panel) {
      this.panel.webview.html = await this.getWebviewContent(server, queue);
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
