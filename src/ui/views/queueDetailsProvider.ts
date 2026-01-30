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
        .action-btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          margin-left: 10px;
        }
        .action-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .action-btn.danger {
          background: var(--vscode-errorForeground);
        }
        .jobs-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        .jobs-table th {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          padding: 10px;
          text-align: left;
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        .jobs-table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 10px;
          color: var(--vscode-foreground);
          vertical-align: top;
        }
        .jobs-table tr:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .job-args {
          font-family: var(--vscode-editor-font-family);
          font-size: 0.9em;
          white-space: pre-wrap;
          max-height: 100px;
          overflow-y: auto;
          background: var(--vscode-textBlockQuote-background);
          padding: 5px;
          border-radius: 2px;
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-top: 30px;
          margin-bottom: 15px;
          color: var(--vscode-foreground);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Queue: ${this.escapeHtml(updatedQueue.name)}</h1>
        <div>
          <button class="action-btn" onclick="refresh()">Refresh</button>
          <button class="action-btn danger" onclick="clearQueue()">Clear Queue</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Size</div>
          <div class="stat-value">${updatedQueue.size.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Latency</div>
          <div class="stat-value">${updatedQueue.latency ? updatedQueue.latency.toFixed(2) + 's' : '0.00s'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Server</div>
          <div class="stat-value" style="font-size: 16px; margin-top: 5px;">${this.escapeHtml(server.name)}</div>
        </div>
      </div>

      <h2 class="section-title">Recent Jobs (Top 100)</h2>
      <table class="jobs-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>ID</th>
            <th>Arguments</th>
            <th>Enqueued At</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.map(job => `
            <tr>
              <td><strong>${this.escapeHtml(job.class)}</strong></td>
              <td>${this.escapeHtml(job.id)}</td>
              <td><div class="job-args">${this.escapeHtml(JSON.stringify(job.args, null, 2))}</div></td>
              <td>${job.enqueuedAt ? job.enqueuedAt.toLocaleString() : (job.createdAt ? job.createdAt.toLocaleString() : 'N/A')}</td>
            </tr>
          `).join('')}
          ${jobs.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--vscode-descriptionForeground);">Queue is empty</td></tr>' : ''}
        </tbody>
      </table>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function refresh() {
          vscode.postMessage({ command: 'refresh' });
        }

        function clearQueue() {
          vscode.postMessage({ command: 'clearQueue' });
        }
      </script>
    </body>
    </html>`;
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
