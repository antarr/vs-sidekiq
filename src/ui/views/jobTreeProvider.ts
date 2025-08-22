import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Job } from '../../data/models/sidekiq';
import { ServerRegistry } from '../../core/serverRegistry';
import { Feature } from '../../licensing/features';

type TreeItem = JobTreeItem | JobCategoryItem | NoServerItem | DisconnectedItem | EmptyItem | ErrorItem | UpgradeItem;

export class JobTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private sidekiqClient: SidekiqClient;

  constructor(
    private connectionManager: ConnectionManager,
    private serverRegistry: ServerRegistry,
    private licenseManager: LicenseManager
  ) {
    this.sidekiqClient = new SidekiqClient(connectionManager);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const activeServer = this.serverRegistry.getActiveServer();
    if (!activeServer) {
      return [new NoServerItem()];
    }

    if (!this.connectionManager.isConnected(activeServer)) {
      return [new DisconnectedItem()];
    }

    if (!element) {
      // Root level - show job categories
      return [
        new JobCategoryItem('Scheduled', 'scheduled', activeServer.name),
        new JobCategoryItem('Retries', 'retry', activeServer.name),
        new JobCategoryItem('Dead', 'dead', activeServer.name)
      ];
    } else if (element instanceof JobCategoryItem) {
      // Load jobs for category
      try {
        const maxJobs = this.licenseManager.getMaxJobHistory();
        let jobs: Job[] = [];
        
        switch (element.category) {
          case 'scheduled':
            jobs = await this.sidekiqClient.getScheduledJobs(activeServer, 0, maxJobs - 1);
            break;
          case 'retry':
            jobs = await this.sidekiqClient.getRetryJobs(activeServer, 0, maxJobs - 1);
            break;
          case 'dead':
            jobs = await this.sidekiqClient.getDeadJobs(activeServer, 0, maxJobs - 1);
            break;
        }
        
        if (jobs.length === 0) {
          return [new EmptyItem(`No ${element.label.toLowerCase()}`)];
        }
        
        const items: TreeItem[] = jobs.map(job => new JobTreeItem(job, element.category, activeServer.name));
        
        // Add upgrade prompt if at limit
        if (jobs.length >= maxJobs && !this.licenseManager.canUseFeature(Feature.UNLIMITED_SERVERS)) {
          items.push(new UpgradeItem(`Showing first ${maxJobs} jobs. Upgrade for more.`));
        }
        
        return items;
      } catch (error) {
        console.error(`Failed to fetch ${element.category} jobs:`, error);
        return [new ErrorItem(`Failed to load ${element.label.toLowerCase()}`)];
      }
    }
    
    return [];
  }
}

class JobCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly category: string,
    public readonly serverName: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    
    switch (category) {
      case 'scheduled':
        this.iconPath = new vscode.ThemeIcon('clock');
        break;
      case 'retry':
        this.iconPath = new vscode.ThemeIcon('sync');
        break;
      case 'dead':
        this.iconPath = new vscode.ThemeIcon('trash');
        break;
    }
    
    this.contextValue = `jobCategory-${category}`;
  }
}

class JobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly job: Job,
    public readonly category: string,
    public readonly serverName: string
  ) {
    super(job.class, vscode.TreeItemCollapsibleState.None);
    
    this.description = this.getDescription();
    this.tooltip = this.getTooltip();
    this.contextValue = `job-${category}`;
    
    // Set icon based on job status
    if (job.errorMessage) {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-filled');
    }
    
    // Remove command to avoid interfering with selection
    // Users can double-click or use context menu for actions
  }

  private getDescription(): string {
    if (this.job.scheduledAt) {
      return `Scheduled: ${this.job.scheduledAt.toLocaleString()}`;
    } else if (this.job.retriedAt) {
      return `Retry at: ${this.job.retriedAt.toLocaleString()}`;
    } else if (this.job.failedAt) {
      return `Failed: ${this.job.failedAt.toLocaleString()}`;
    }
    return this.job.queue;
  }

  private getTooltip(): string {
    let tooltip = `Job: ${this.job.class}\n`;
    tooltip += `Queue: ${this.job.queue}\n`;
    tooltip += `ID: ${this.job.id}\n`;
    tooltip += `Server: ${this.serverName}\n`;
    
    if (this.job.errorMessage) {
      tooltip += `\nError: ${this.job.errorMessage}`;
    }
    
    return tooltip;
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

class UpgradeItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('star');
    this.command = {
      command: 'sidekiq.upgrade',
      title: 'Upgrade'
    };
    this.tooltip = 'Upgrade to see more job history';
  }
}