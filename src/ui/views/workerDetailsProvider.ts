import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig } from '../../data/models/server';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Worker } from '../../data/models/sidekiq';

export class WorkerDetailsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidekiqClient: SidekiqClient;

  constructor(
    private context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
  ) {
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  async showWorkerDetails(server: ServerConfig, worker: Worker): Promise<void> {
    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'sidekiqWorkerDetails',
        `Worker: ${worker.hostname}:${worker.pid}`,
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
    this.panel.title = `Worker: ${worker.hostname}:${worker.pid}`;
    this.panel.webview.html = await this.getWebviewContent(server, worker);

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this.refreshWorkerDetails(server, worker);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  private async getWebviewContent(server: ServerConfig, initialWorker: Worker): Promise<string> {
    // Refresh worker data to get latest stats
    const workers = await this.sidekiqClient.getWorkers(server);
    const worker = workers.find(w => w.id === initialWorker.id) || initialWorker;

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Worker Details: ${this.escapeHtml(worker.hostname)}:${this.escapeHtml(worker.pid)}</title>
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
          font-size: 18px;
          font-weight: bold;
          word-break: break-all;
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
        .job-details {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          padding: 20px;
          border-radius: 4px;
        }
        .job-row {
          display: flex;
          margin-bottom: 10px;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 10px;
        }
        .job-row:last-child {
          border-bottom: none;
        }
        .job-label {
          font-weight: bold;
          width: 150px;
          color: var(--vscode-descriptionForeground);
        }
        .job-value {
          flex: 1;
        }
        .job-args {
          font-family: var(--vscode-editor-font-family);
          font-size: 0.9em;
          white-space: pre-wrap;
          max-height: 200px;
          overflow-y: auto;
          background: var(--vscode-textBlockQuote-background);
          padding: 10px;
          border-radius: 2px;
          margin-top: 5px;
        }
        .queues-list {
          margin-top: 10px;
        }
        .queue-tag {
          display: inline-block;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 2px 8px;
          border-radius: 10px;
          margin-right: 5px;
          margin-bottom: 5px;
          font-size: 0.9em;
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-top: 30px;
          margin-bottom: 15px;
          color: var(--vscode-foreground);
        }
        .status-idle {
          color: var(--vscode-charts-green);
        }
        .status-busy {
          color: var(--vscode-charts-orange);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Worker: ${this.escapeHtml(worker.hostname)}:${this.escapeHtml(worker.pid)}</h1>
        <div>
          <button class="action-btn" onclick="refresh()">Refresh</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value ${worker.job ? 'status-busy' : 'status-idle'}">
            ${worker.job ? 'Processing' : 'Idle'}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Started At</div>
          <div class="stat-value">${worker.started_at instanceof Date ? worker.started_at.toLocaleString() : worker.started_at}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tag</div>
          <div class="stat-value">${this.escapeHtml(worker.tag || '-')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Server</div>
          <div class="stat-value" style="font-size: 16px; margin-top: 5px;">${this.escapeHtml(server.name)}</div>
        </div>
      </div>

      <div class="stat-card" style="margin-bottom: 30px;">
        <div class="stat-label">Listening on Queues</div>
        <div class="queues-list">
          ${worker.queues.map(q => `<span class="queue-tag">${this.escapeHtml(q)}</span>`).join('')}
        </div>
      </div>

      <h2 class="section-title">Current Job</h2>
      ${worker.job ? `
        <div class="job-details">
          <div class="job-row">
            <div class="job-label">Class</div>
            <div class="job-value"><strong>${this.escapeHtml(worker.job.class)}</strong></div>
          </div>
          <div class="job-row">
            <div class="job-label">ID</div>
            <div class="job-value">${this.escapeHtml(worker.job.id)}</div>
          </div>
          <div class="job-row">
            <div class="job-label">Queue</div>
            <div class="job-value">${this.escapeHtml(worker.job.queue)}</div>
          </div>
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
          <div class="job-row" style="display: block;">
            <div class="job-label" style="margin-bottom: 5px;">Arguments</div>
            <div class="job-args">${this.escapeHtml(JSON.stringify(worker.job.args, null, 2))}</div>
          </div>
        </div>
      ` : `
        <div class="job-details" style="text-align: center; color: var(--vscode-descriptionForeground);">
          Worker is currently idle.
        </div>
      `}

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function refresh() {
          vscode.postMessage({ command: 'refresh' });
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
