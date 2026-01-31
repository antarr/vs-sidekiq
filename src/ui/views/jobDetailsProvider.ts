import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { ServerConfig } from '../../data/models/server';
import { Job } from '../../data/models/sidekiq';

export class JobDetailsProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    _connectionManager: ConnectionManager
  ) {}

  async showJobDetails(server: ServerConfig, job: Job, category: string): Promise<void> {
    // Create or show panel
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'sidekiqJobDetails',
        `Job: ${job.class}`,
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
    this.panel.title = `Job: ${job.class}`;
    this.panel.webview.html = this.getWebviewContent(server, job, category);

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'copyText':
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('Copied to clipboard');
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  private getWebviewContent(server: ServerConfig, job: Job, category: string): string {
    const nonce = this.getNonce();
    const hasError = !!(job.errorMessage || job.errorClass);
    const hasBacktrace = job.backtrace && job.backtrace.length > 0;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Job Details: ${this.escapeHtml(job.class)}</title>
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
          line-height: 1.6;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
        }

        /* Header */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header-info {
          flex: 1;
        }

        .header h1 {
          margin: 0 0 12px 0;
          font-size: 28px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        .header-meta {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .badge.category {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
        }

        .badge.queue {
          background: rgba(14, 165, 233, 0.2);
          color: #0ea5e9;
        }

        .badge.error {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        /* Card */
        .card {
          background: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 20px;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .card-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .copy-btn {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background-color 0.15s ease;
        }

        .copy-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Info Grid */
        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }

        .info-item {
          display: flex;
          flex-direction: column;
        }

        .info-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }

        .info-value {
          font-size: 14px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-editor-font-family);
        }

        .info-value.mono {
          font-family: var(--vscode-editor-font-family);
          font-size: 13px;
        }

        /* Error Section */
        .error-section {
          background: var(--vscode-inputValidation-errorBackground);
          border: 1px solid var(--vscode-inputValidation-errorBorder);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .error-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .error-icon {
          font-size: 20px;
          color: var(--vscode-errorForeground);
        }

        .error-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-errorForeground);
          margin: 0;
        }

        .error-class {
          font-family: var(--vscode-editor-font-family);
          font-size: 14px;
          color: var(--vscode-errorForeground);
          margin-bottom: 8px;
          font-weight: 600;
        }

        .error-message {
          font-family: var(--vscode-editor-font-family);
          font-size: 13px;
          color: var(--vscode-foreground);
          background: var(--vscode-textCodeBlock-background);
          padding: 12px;
          border-radius: 4px;
          border-left: 3px solid var(--vscode-errorForeground);
          word-wrap: break-word;
        }

        /* Backtrace */
        .backtrace-container {
          margin-top: 16px;
        }

        .backtrace-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .backtrace-toggle {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 14px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background-color 0.15s ease;
        }

        .backtrace-toggle:hover {
          background: var(--vscode-button-hoverBackground);
        }

        .backtrace-content {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          max-height: 500px;
          overflow-y: auto;
          font-family: var(--vscode-editor-font-family);
          font-size: 12px;
          line-height: 1.8;
        }

        .backtrace-content.collapsed {
          display: none;
        }

        .backtrace-line {
          padding: 4px 0;
          white-space: pre-wrap;
          word-break: break-all;
          color: var(--vscode-foreground);
        }

        .backtrace-line:hover {
          background: var(--vscode-list-hoverBackground);
        }

        /* Arguments */
        .arguments-content {
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          font-family: var(--vscode-editor-font-family);
          font-size: 13px;
          line-height: 1.6;
          overflow-x: auto;
        }

        .arguments-content pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
        }

        /* Scrollbar */
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

        /* Empty State */
        .empty-state {
          padding: 40px 20px;
          text-align: center;
          color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
          font-size: 36px;
          margin-bottom: 12px;
          opacity: 0.5;
        }

        .empty-text {
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="header-info">
            <h1>${this.escapeHtml(job.class)}</h1>
            <div class="header-meta">
              <span class="badge category">${this.escapeHtml(category)}</span>
              <span class="badge queue">Queue: ${this.escapeHtml(job.queue)}</span>
              ${hasError ? '<span class="badge error">Failed</span>' : ''}
            </div>
          </div>
        </div>

        <!-- Job Information -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Job Information</h2>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Job ID</div>
              <div class="info-value mono">${this.escapeHtml(job.id)}</div>
            </div>

            <div class="info-item">
              <div class="info-label">Queue</div>
              <div class="info-value">${this.escapeHtml(job.queue)}</div>
            </div>

            <div class="info-item">
              <div class="info-label">Created At</div>
              <div class="info-value">${job.createdAt ? job.createdAt.toLocaleString() : 'N/A'}</div>
            </div>

            ${job.scheduledAt ? `
              <div class="info-item">
                <div class="info-label">Scheduled At</div>
                <div class="info-value">${job.scheduledAt.toLocaleString()}</div>
              </div>
            ` : ''}

            ${job.retriedAt ? `
              <div class="info-item">
                <div class="info-label">Retry At</div>
                <div class="info-value">${job.retriedAt.toLocaleString()}</div>
              </div>
            ` : ''}

            ${job.failedAt ? `
              <div class="info-item">
                <div class="info-label">Failed At</div>
                <div class="info-value">${job.failedAt.toLocaleString()}</div>
              </div>
            ` : ''}

            ${job.retryCount !== undefined ? `
              <div class="info-item">
                <div class="info-label">Retry Count</div>
                <div class="info-value">${job.retryCount}</div>
              </div>
            ` : ''}

            <div class="info-item">
              <div class="info-label">Server</div>
              <div class="info-value">${this.escapeHtml(server.name)}</div>
            </div>
          </div>
        </div>

        <!-- Error Section (if applicable) -->
        ${hasError ? `
          <div class="error-section">
            <div class="error-header">
              <span class="error-icon">⚠</span>
              <h2 class="error-title">Error Details</h2>
            </div>

            ${job.errorClass ? `
              <div class="error-class">${this.escapeHtml(job.errorClass)}</div>
            ` : ''}

            ${job.errorMessage ? `
              <div class="error-message">${this.escapeHtml(job.errorMessage)}</div>
            ` : ''}

            ${hasBacktrace ? `
              <div class="backtrace-container">
                <div class="backtrace-header">
                  <h3 class="card-title">Stack Trace</h3>
                  <div>
                    <button class="copy-btn" onclick="copyBacktrace()">Copy Backtrace</button>
                    <button class="backtrace-toggle" onclick="toggleBacktrace()">Show Backtrace</button>
                  </div>
                </div>
                <div class="backtrace-content collapsed" id="backtraceContent">
                  ${(job.backtrace || []).map((line, index) => `
                    <div class="backtrace-line">${index + 1}. ${this.escapeHtml(line)}</div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Arguments -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Arguments</h2>
            <button class="copy-btn" onclick="copyArguments()">Copy Arguments</button>
          </div>

          ${job.args && job.args.length > 0 ? `
            <div class="arguments-content">
              <pre>${this.escapeHtml(JSON.stringify(job.args, null, 2))}</pre>
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <div class="empty-text">No arguments</div>
            </div>
          `}
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function toggleBacktrace() {
          const content = document.getElementById('backtraceContent');
          const btn = document.querySelector('.backtrace-toggle');

          if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            btn.textContent = 'Hide Backtrace';
          } else {
            content.classList.add('collapsed');
            btn.textContent = 'Show Backtrace';
          }
        }

        function copyBacktrace() {
          const backtrace = ${JSON.stringify(job.backtrace || [])};
          const text = backtrace.join('\\n');
          vscode.postMessage({ command: 'copyText', text: text });
        }

        function copyArguments() {
          const args = ${JSON.stringify(JSON.stringify(job.args, null, 2))};
          vscode.postMessage({ command: 'copyText', text: args });
        }
      </script>
    </body>
    </html>`;
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
