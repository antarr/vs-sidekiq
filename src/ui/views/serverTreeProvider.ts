import * as vscode from 'vscode';
import { ServerRegistry } from '../../core/serverRegistry';
import { LicenseManager } from '../../licensing/licenseManager';
import { ServerConfig } from '../../data/models/server';
import { Feature } from '../../licensing/features';

type TreeItem = ServerTreeItem | AddServerItem | UpgradeItem;

export class ServerTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private serverRegistry: ServerRegistry,
    private licenseManager: LicenseManager
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
      const maxServers = this.licenseManager.getMaxServerConnections();
      
      const items: TreeItem[] = servers.map(server => 
        new ServerTreeItem(
          server,
          server.id === activeServer?.id,
          vscode.TreeItemCollapsibleState.None
        )
      );

      // Add "Add Server" item if under limit
      if (servers.length < maxServers) {
        items.push(new AddServerItem());
      } else if (!this.licenseManager.canUseFeature(Feature.UNLIMITED_SERVERS)) {
        items.push(new UpgradeItem());
      }

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
    
    // Add commands
    this.command = {
      command: 'sidekiq.selectServer',
      title: 'Select Server',
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

class UpgradeItem extends vscode.TreeItem {
  constructor() {
    super('Upgrade for more servers', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('star');
    this.command = {
      command: 'sidekiq.upgrade',
      title: 'Upgrade'
    };
    this.contextValue = 'upgrade';
    this.tooltip = 'Upgrade to Pro or Team plan for more server connections';
  }
}