import * as vscode from 'vscode';
import { ConnectionManager } from '../../core/connectionManager';
import { LicenseManager } from '../../licensing/licenseManager';
import { SidekiqClient } from '../../core/sidekiqClient';
import { Queue } from '../../data/models/sidekiq';
import { ServerRegistry } from '../../core/serverRegistry';

type TreeItem = QueueTreeItem | NoServerItem | DisconnectedItem | EmptyItem | ErrorItem;

export class QueueTreeProvider implements vscode.TreeDataProvider<TreeItem> {
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
      const queues = await this.sidekiqClient.getQueues(activeServer);
      
      if (queues.length === 0) {
        return [new EmptyItem('No queues found')];
      }

      return queues.map(queue => new QueueTreeItem(queue, activeServer.name));
    } catch (error) {
      console.error('Failed to fetch queues:', error);
      return [new ErrorItem('Failed to load queues')];
    }
  }
}

class QueueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly queue: Queue,
    public readonly serverName: string
  ) {
    super(queue.name, vscode.TreeItemCollapsibleState.None);
    
    this.description = `${queue.size} jobs`;
    this.tooltip = `Queue: ${queue.name}\nSize: ${queue.size}\nLatency: ${queue.latency.toFixed(2)}s\nServer: ${serverName}`;
    
    // Set icon based on queue status
    if (queue.paused) {
      this.iconPath = new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.orange'));
    } else if (queue.size > 1000) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
    } else if (queue.size > 100) {
      this.iconPath = new vscode.ThemeIcon('list-unordered', new vscode.ThemeColor('charts.yellow'));
    } else {
      this.iconPath = new vscode.ThemeIcon('list-unordered', new vscode.ThemeColor('charts.green'));
    }
    
    this.contextValue = 'queue';
    
    // Add command to view queue details
    this.command = {
      command: 'sidekiq.viewQueue',
      title: 'View Queue',
      arguments: [queue]
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