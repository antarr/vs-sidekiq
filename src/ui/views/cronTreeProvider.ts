import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { SidekiqClient } from '../../core/sidekiqClient';
import { CronJob } from '../../data/models/sidekiq';
import { ServerRegistry } from '../../core/serverRegistry';

type TreeItem = CronJobTreeItem | NoServerItem | DisconnectedItem | EmptyItem | ErrorItem;

export class CronTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private sidekiqClient: SidekiqClient;

  constructor(
    private connectionManager: ConnectionManager,
    private serverRegistry: ServerRegistry,
    licenseManager: LicenseManager
  ) {
    void licenseManager; // For future use
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: TreeItem): Promise<TreeItem[]> {
    const activeServer = this.serverRegistry.getActiveServer();
    if (!activeServer) {
      return [new NoServerItem()];
    }

    if (!this.connectionManager.isConnected(activeServer)) {
      return [new DisconnectedItem()];
    }

    try {
      const cronJobs = await this.sidekiqClient.getCronJobs(activeServer);

      if (cronJobs.length === 0) {
        return [new EmptyItem('No cron jobs found')];
      }

      return cronJobs.map(cronJob => new CronJobTreeItem(cronJob, activeServer.name));
    } catch (error) {
      console.error('Failed to fetch cron jobs:', error);
      return [new ErrorItem('Failed to load cron jobs')];
    }
  }
}

class CronJobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly cronJob: CronJob,
    public readonly serverName: string
  ) {
    super(cronJob.name, vscode.TreeItemCollapsibleState.None);

    // Build description showing next run time
    const parts = [];
    if (cronJob.nextEnqueueTime) {
      const now = new Date();
      const diff = cronJob.nextEnqueueTime.getTime() - now.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        parts.push(`in ${days}d ${hours % 24}h`);
      } else if (hours > 0) {
        parts.push(`in ${hours}h ${minutes % 60}m`);
      } else if (minutes > 0) {
        parts.push(`in ${minutes}m`);
      } else {
        parts.push('soon');
      }
    } else {
      parts.push(cronJob.cron);
    }

    this.description = parts.join(' ');

    // Build tooltip
    const tooltipLines = [
      `Name: ${cronJob.name}`,
      `Schedule: ${cronJob.cron}`,
      `Class: ${cronJob.class}`,
      `Queue: ${cronJob.queue}`,
      `Status: ${cronJob.active ? 'Active' : 'Inactive'}`
    ];

    if (cronJob.lastEnqueueTime) {
      tooltipLines.push(`Last run: ${cronJob.lastEnqueueTime.toLocaleString()}`);
    }

    if (cronJob.nextEnqueueTime) {
      tooltipLines.push(`Next run: ${cronJob.nextEnqueueTime.toLocaleString()}`);
    }

    if (cronJob.description) {
      tooltipLines.push(`Description: ${cronJob.description}`);
    }

    tooltipLines.push(`Server: ${serverName}`);

    this.tooltip = tooltipLines.join('\n');

    // Set icon based on status
    if (cronJob.active) {
      this.iconPath = new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('descriptionForeground'));
    }

    // Set context value for menu actions
    this.contextValue = cronJob.active ? 'cronJob-active' : 'cronJob-inactive';

    // Add command to view cron job details
    this.command = {
      command: 'sidekiq.viewCronJob',
      title: 'View Cron Job',
      arguments: [cronJob]
    };
  }
}

class NoServerItem extends vscode.TreeItem {
  constructor() {
    super('No server selected', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('warning');
    this.command = {
      command: 'sidekiq.connect',
      title: 'Connect to Server'
    };
  }
}

class DisconnectedItem extends vscode.TreeItem {
  constructor() {
    super('Server disconnected', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('plug');
    this.command = {
      command: 'sidekiq.connect',
      title: 'Reconnect'
    };
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class ErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error');
  }
}
