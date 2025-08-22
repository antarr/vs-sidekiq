import * as vscode from 'vscode';
import { ConnectionManager } from './core/connectionManager';
import { ServerRegistry } from './core/serverRegistry';
import { LicenseManager } from './licensing/licenseManager';
import { AnalyticsCollector } from './telemetry/analytics';
import { DashboardProvider } from './ui/views/dashboardProvider';
import { ServerTreeProvider } from './ui/views/serverTreeProvider';
import { QueueTreeProvider } from './ui/views/queueTreeProvider';
import { WorkerTreeProvider } from './ui/views/workerTreeProvider';
import { JobTreeProvider } from './ui/views/jobTreeProvider';
import { registerCommands } from './commands';
import { ServerEnvironment } from './data/models/server';

let connectionManager: ConnectionManager;
let serverRegistry: ServerRegistry;
let licenseManager: LicenseManager;
let analytics: AnalyticsCollector;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Sidekiq Manager is activating...');

  // Initialize core services
  connectionManager = new ConnectionManager(context);
  serverRegistry = new ServerRegistry(context);
  licenseManager = new LicenseManager(context);
  analytics = new AnalyticsCollector(context);

  // Initialize license and analytics
  await licenseManager.initialize();
  analytics.initialize();

  // Track activation
  analytics.track('extension_activated', {
    version: context.extension.packageJSON.version,
    tier: licenseManager.getCurrentTier()
  });

  // Create providers
  const dashboardProvider = new DashboardProvider(context, connectionManager, licenseManager);
  const serverTreeProvider = new ServerTreeProvider(serverRegistry, licenseManager);
  const queueTreeProvider = new QueueTreeProvider(connectionManager, serverRegistry, licenseManager);
  const workerTreeProvider = new WorkerTreeProvider(connectionManager, serverRegistry, licenseManager);
  const jobTreeProvider = new JobTreeProvider(connectionManager, serverRegistry, licenseManager);

  // Register tree data providers
  vscode.window.registerTreeDataProvider('sidekiqServers', serverTreeProvider);
  vscode.window.registerTreeDataProvider('sidekiqQueues', queueTreeProvider);
  vscode.window.registerTreeDataProvider('sidekiqWorkers', workerTreeProvider);
  
  // Register jobs tree view with multi-select support
  const jobsTreeView = vscode.window.createTreeView('sidekiqJobs', {
    treeDataProvider: jobTreeProvider,
    canSelectMany: true
  });
  context.subscriptions.push(jobsTreeView);

  // Register commands
  registerCommands(context, {
    connectionManager,
    serverRegistry,
    licenseManager,
    analytics,
    dashboardProvider,
    serverTreeProvider,
    queueTreeProvider,
    workerTreeProvider,
    jobTreeProvider
  });

  // Initialize status bar
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'sidekiq.switchServer';
  context.subscriptions.push(statusBarItem);
  
  // Update status bar
  const updateStatusBar = () => {
    const activeServer = serverRegistry.getActiveServer();
    if (activeServer) {
      statusBarItem.text = `$(server) Sidekiq: ${activeServer.name}`;
      statusBarItem.tooltip = `Connected to ${activeServer.host}:${activeServer.port}`;
      statusBarItem.show();
    } else {
      statusBarItem.text = '$(server) Sidekiq: Not Connected';
      statusBarItem.tooltip = 'Click to connect to a Sidekiq server';
      statusBarItem.show();
    }
  };

  updateStatusBar();
  serverRegistry.onDidChangeActiveServer(updateStatusBar);

  // Set up auto-refresh
  const refreshInterval = vscode.workspace.getConfiguration('sidekiq').get<number>('refreshInterval', 30) * 1000;
  setInterval(() => {
    if (serverRegistry.getActiveServer() && connectionManager.isConnected(serverRegistry.getActiveServer()!)) {
      serverTreeProvider.refresh();
      queueTreeProvider.refresh();
      workerTreeProvider.refresh();
      jobTreeProvider.refresh();
    }
  }, Math.max(refreshInterval, 5000)); // Minimum 5 seconds

  // Auto-connect to saved servers
  await serverRegistry.loadSavedServers();
  
  // If no servers configured, add a default localhost server
  if (serverRegistry.getServerCount() === 0) {
    console.log('No servers configured, adding default localhost server');
    const defaultServer = await serverRegistry.addServer({
      name: 'Local Redis',
      host: 'localhost',
      port: 6379,
      environment: ServerEnvironment.Development
    });
    
    // Try to connect to the default server
    try {
      await connectionManager.connect(defaultServer);
      console.log('Connected to default localhost server');
    } catch (error) {
      console.log('Could not connect to default localhost server:', error);
      // Not critical if it fails
    }
  }

  console.log('Sidekiq Manager activated successfully');
}

export function deactivate() {
  // Clean up connections
  if (connectionManager) {
    connectionManager.dispose();
  }
  
  // Track deactivation
  if (analytics) {
    analytics.track('extension_deactivated');
    analytics.flush();
  }
}

// Export for testing
export { connectionManager, serverRegistry, licenseManager, analytics };