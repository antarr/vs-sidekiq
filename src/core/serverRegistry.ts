import * as vscode from 'vscode';
import { ServerConfig, ServerEnvironment } from '../data/models/server';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export class ServerRegistry extends EventEmitter {
  private servers: Map<string, ServerConfig> = new Map();
  private activeServerId: string | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    super();
    this.context = context; // Will be used for globalState storage
  }

  async loadSavedServers(): Promise<void> {
    const config = vscode.workspace.getConfiguration('sidekiq');
    const savedServers = config.get<ServerConfig[]>('servers', []);
    
    for (const server of savedServers) {
      if (!server.id) {
        server.id = uuidv4();
      }
      this.servers.set(server.id, server);
    }

    // Set first server as active if none selected
    if (this.servers.size > 0 && !this.activeServerId) {
      this.activeServerId = Array.from(this.servers.keys())[0];
    }

    this.emit('serversLoaded', Array.from(this.servers.values()));
  }

  async saveServers(): Promise<void> {
    const config = vscode.workspace.getConfiguration('sidekiq');
    const servers = Array.from(this.servers.values());
    await config.update('servers', servers, vscode.ConfigurationTarget.Global);
  }

  async addServer(config: Omit<ServerConfig, 'id'>): Promise<ServerConfig> {
    const server: ServerConfig = {
      ...config,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.servers.set(server.id, server);
    await this.saveServers();
    
    // Set as active if it's the first server
    if (this.servers.size === 1) {
      this.setActiveServer(server.id);
    }

    this.emit('serverAdded', server);
    return server;
  }

  async updateServer(id: string, updates: Partial<ServerConfig>): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`Server not found: ${id}`);
    }

    const updated = {
      ...server,
      ...updates,
      id: server.id, // Ensure ID doesn't change
      updatedAt: new Date()
    };

    this.servers.set(id, updated);
    await this.saveServers();
    this.emit('serverUpdated', updated);
  }

  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`Server not found: ${id}`);
    }

    this.servers.delete(id);
    await this.saveServers();

    // Update active server if needed
    if (this.activeServerId === id) {
      const remaining = Array.from(this.servers.keys());
      this.activeServerId = remaining.length > 0 ? remaining[0] : null;
      this.emit('activeServerChanged', this.getActiveServer());
    }

    this.emit('serverRemoved', server);
  }

  getServer(id: string): ServerConfig | undefined {
    return this.servers.get(id);
  }

  getAllServers(): ServerConfig[] {
    return Array.from(this.servers.values());
  }

  getServersByEnvironment(env: ServerEnvironment): ServerConfig[] {
    return this.getAllServers().filter(s => s.environment === env);
  }

  getActiveServer(): ServerConfig | null {
    return this.activeServerId ? this.servers.get(this.activeServerId) || null : null;
  }

  setActiveServer(id: string): void {
    if (!this.servers.has(id)) {
      throw new Error(`Server not found: ${id}`);
    }

    const previousId = this.activeServerId;
    this.activeServerId = id;
    
    if (previousId !== id) {
      this.saveActiveServerId(); // Save to persistent storage
      this.emit('activeServerChanged', this.getActiveServer());
    }
  }

  getServerCount(): number {
    return this.servers.size;
  }

  findServerByHost(host: string, port: number): ServerConfig | undefined {
    return this.getAllServers().find(s => s.host === host && s.port === port);
  }

  async importServers(servers: ServerConfig[]): Promise<void> {
    for (const server of servers) {
      if (!server.id) {
        server.id = uuidv4();
      }
      this.servers.set(server.id, server);
    }
    
    await this.saveServers();
    this.emit('serversImported', servers);
  }

  exportServers(): ServerConfig[] {
    return this.getAllServers().map(server => {
      // Remove sensitive data for export
      const { password, ...exportable } = server;
      return exportable as ServerConfig;
    });
  }

  onDidChangeActiveServer(listener: (server: ServerConfig | null) => void): vscode.Disposable {
    this.on('activeServerChanged', listener);
    return new vscode.Disposable(() => {
      this.off('activeServerChanged', listener);
    });
  }

  private async saveActiveServerId(): Promise<void> {
    await this.context.globalState.update('activeServerId', this.activeServerId);
  }
  
  dispose(): void {
    this.removeAllListeners();
    this.servers.clear();
    this.activeServerId = null;
  }
}