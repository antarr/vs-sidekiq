import * as vscode from 'vscode';
import Redis from 'ioredis';
import { ServerConfig, ConnectionStatus } from '../data/models/server';
import { EventEmitter } from 'events';

export class ConnectionManager extends EventEmitter {
  private connections: Map<string, Redis> = new Map();
  private connectionStatus: Map<string, ConnectionStatus> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(context: vscode.ExtensionContext) {
    super();
    // Context might be used in future for storing connection state
    void context;
  }

  async connect(server: ServerConfig): Promise<void> {
    const key = this.getServerKey(server);
    
    // Close existing connection if any
    if (this.connections.has(key)) {
      await this.disconnect(server);
    }

    try {
      // Create Redis connection
      const redis = new Redis({
        host: server.host,
        port: server.port,
        password: server.password,
        db: server.database || 0,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        lazyConnect: false
      });

      // Set up event handlers
      redis.on('connect', () => {
        this.updateStatus(server, ConnectionStatus.Connected);
        this.emit('connected', server);
        vscode.window.showInformationMessage(`Connected to Sidekiq server: ${server.name}`);
      });

      redis.on('error', (error) => {
        console.error(`Redis error for ${server.name}:`, error);
        this.updateStatus(server, ConnectionStatus.Error);
        this.emit('error', { server, error });
      });

      redis.on('close', () => {
        this.updateStatus(server, ConnectionStatus.Disconnected);
        this.emit('disconnected', server);
        this.scheduleReconnect(server);
      });

      redis.on('ready', () => {
        this.updateStatus(server, ConnectionStatus.Connected);
        this.emit('ready', server);
      });

      // Store connection
      this.connections.set(key, redis);
      this.updateStatus(server, ConnectionStatus.Connecting);

      // Wait for connection
      await redis.ping();
      
    } catch (error) {
      this.updateStatus(server, ConnectionStatus.Error);
      throw new Error(`Failed to connect to ${server.name}: ${error}`);
    }
  }

  async disconnect(server: ServerConfig): Promise<void> {
    const key = this.getServerKey(server);
    const connection = this.connections.get(key);
    
    if (connection) {
      // Cancel any reconnect timer
      const timer = this.reconnectTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(key);
      }

      // Close connection
      connection.removeAllListeners();
      await connection.quit();
      this.connections.delete(key);
      this.updateStatus(server, ConnectionStatus.Disconnected);
      this.emit('disconnected', server);
    }
  }

  async getConnection(server: ServerConfig): Promise<Redis> {
    const key = this.getServerKey(server);
    const connection = this.connections.get(key);
    
    if (!connection) {
      throw new Error(`No connection for server: ${server.name}`);
    }

    if (connection.status !== 'ready') {
      throw new Error(`Connection not ready for server: ${server.name}`);
    }

    return connection;
  }

  getStatus(server: ServerConfig): ConnectionStatus {
    const key = this.getServerKey(server);
    return this.connectionStatus.get(key) || ConnectionStatus.Disconnected;
  }

  isConnected(server: ServerConfig): boolean {
    return this.getStatus(server) === ConnectionStatus.Connected;
  }

  getAllConnections(): Map<string, Redis> {
    return new Map(this.connections);
  }

  private updateStatus(server: ServerConfig, status: ConnectionStatus): void {
    const key = this.getServerKey(server);
    this.connectionStatus.set(key, status);
    this.emit('statusChanged', { server, status });
  }

  private scheduleReconnect(server: ServerConfig): void {
    const key = this.getServerKey(server);
    
    // Clear existing timer
    const existingTimer = this.reconnectTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule reconnect
    const timer = setTimeout(async () => {
      if (this.getStatus(server) !== ConnectionStatus.Connected) {
        console.log(`Attempting to reconnect to ${server.name}...`);
        try {
          await this.connect(server);
        } catch (error) {
          console.error(`Reconnect failed for ${server.name}:`, error);
        }
      }
    }, 5000);

    this.reconnectTimers.set(key, timer);
  }

  private getServerKey(server: ServerConfig): string {
    return `${server.host}:${server.port}:${server.database || 0}`;
  }

  dispose(): void {
    // Close all connections
    for (const [_, connection] of this.connections) {
      connection.removeAllListeners();
      connection.disconnect();
    }
    
    // Clear all timers
    for (const [_, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    
    this.connections.clear();
    this.connectionStatus.clear();
    this.reconnectTimers.clear();
    this.removeAllListeners();
  }
}