import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Worker } from '../../data/models/sidekiq';
import { ServerRegistry } from '../../core/serverRegistry';

type TreeItem = WorkerTreeItem | NoServerItem | DisconnectedItem | EmptyItem | ErrorItem;

export class WorkerTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private sidekiqClient: SidekiqClient;

  constructor(
    private connectionManager: ConnectionManager,
    private serverRegistry: ServerRegistry
  ) {
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
      console.log(`Fetching workers for server: ${activeServer.name}`);
      const workers = await this.sidekiqClient.getWorkers(activeServer);
      console.log(`Found ${workers.length} workers`);

      if (workers.length === 0) {
        return [new EmptyItem('No workers running - Start Sidekiq workers to see them here')];
      }

      return workers.map(worker => new WorkerTreeItem(worker, activeServer.name));
    } catch (error) {
      console.error('Failed to fetch workers:', error);
      return [new ErrorItem(`Failed to load workers: ${error instanceof Error ? error.message : String(error)}`)];
    }
  }
}

class WorkerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly worker: Worker,
    public readonly serverName: string
  ) {
    super(`${worker.hostname}:${worker.pid}`, vscode.TreeItemCollapsibleState.None);
    
    if (worker.job) {
      this.description = `Processing: ${worker.job.class}`;
      this.iconPath = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.green'));
    } else {
      this.description = 'Idle';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }
    
    this.tooltip = this.getTooltip();
    this.contextValue = 'worker';
    
    // Add command to view worker details
    this.command = {
      command: 'sidekiq.viewWorker',
      title: 'View Worker',
      arguments: [worker]
    };
  }

  private getTooltip(): string {
    let tooltip = `Worker: ${this.worker.hostname}:${this.worker.pid}\n`;
    tooltip += `Started: ${this.worker.started_at.toLocaleString()}\n`;
    tooltip += `Queues: ${this.worker.queues.join(', ')}\n`;
    
    if (this.worker.job) {
      tooltip += `\nCurrent Job:\n`;
      tooltip += `  Class: ${this.worker.job.class}\n`;
      tooltip += `  Queue: ${this.worker.job.queue}\n`;
      tooltip += `  Started: ${this.worker.job.createdAt.toLocaleString()}`;
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