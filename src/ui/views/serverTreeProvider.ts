import * as vscode from 'vscode';
import { ServerRegistry } from '../../core/serverRegistry';
import { ServerConfig } from '../../data/models/server';

type TreeItem = ServerTreeItem | AddServerItem;

export class ServerTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private serverRegistry: ServerRegistry
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    if (!element) {
      // Root level - show servers
      const servers = this.serverRegistry.getAllServers();
      const activeServer = this.serverRegistry.getActiveServer();

      console.log(`ServerTreeProvider.getChildren: Found ${servers.length} servers`);
      console.log(`Active server: ${activeServer?.name || 'none'}`);

      const items: TreeItem[] = servers.map(server => {
        console.log(`Creating tree item for server: ${server.name} (${server.id})`);
        return new ServerTreeItem(
          server,
          server.id === activeServer?.id,
          vscode.TreeItemCollapsibleState.None
        );
      });

      // Add "Add Server" item
      items.push(new AddServerItem());

      console.log(`ServerTreeProvider returning ${items.length} items`);
      return Promise.resolve(items);
    }
    
    return Promise.resolve([]);
  }
}

class ServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly server: ServerConfig,
    public readonly isActive: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(server.name, collapsibleState);
    
    this.tooltip = `${server.host}:${server.port} (${server.environment})`;
    this.description = `${server.host}:${server.port}`;
    
    if (isActive) {
      this.iconPath = new vscode.ThemeIcon('server', new vscode.ThemeColor('charts.green'));
      this.description += ' (active)';
    } else {
      this.iconPath = new vscode.ThemeIcon('server');
    }
    
    this.contextValue = 'server';

    // Add command - clicking server opens dashboard
    this.command = {
      command: 'sidekiq.viewServerDashboard',
      title: 'View Dashboard',
      arguments: [server]
    };
  }
}

class AddServerItem extends vscode.TreeItem {
  constructor() {
    super('Add Server', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'sidekiq.connect',
      title: 'Add Server'
    };
    this.contextValue = 'addServer';
  }
}

