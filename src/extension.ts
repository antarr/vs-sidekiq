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
// import { CronTreeProvider } from './ui/views/cronTreeProvider'; // Disabled - focusing on core Sidekiq
import { registerCommands } from './commands';
import { ServerEnvironment } from './data/models/server';
import { FeatureTier } from './licensing/features';

let connectionManager: ConnectionManager;
let serverRegistry: ServerRegistry;
let licenseManager: LicenseManager;
let analytics: AnalyticsCollector;

export async function activate(context: vscode.ExtensionContext) {
  console.log('=== Sidekiq Manager is activating... ===');
  console.log('Version with license fixes loaded');

  // Initialize core services
  connectionManager = new ConnectionManager(context);
  serverRegistry = new ServerRegistry(context);
  licenseManager = new LicenseManager(context);
  analytics = new AnalyticsCollector(context);

  // Initialize license and analytics
  await licenseManager.initialize();
  analytics.initialize();
  
  // Auto-activate hardcoded enterprise license for testing
  const ENTERPRISE_KEY = '11e2461b60dc5a8c2b88f97f4e46a4e166b2009e3982fc47c30e1c457ef370b14cef47622e2a71436d98f177bd4362543d7138f565a225e7264c8c0f02f9f351';
  
  // Check for license key in settings first
  const config = vscode.workspace.getConfiguration('sidekiq');
  const licenseKey = config.get<string>('licenseKey');
  
  let licenseActivated = false;
  
  if (licenseKey && licenseKey !== ENTERPRISE_KEY) {
    try {
      await licenseManager.activateLicense(licenseKey);
      console.log('License activated from settings');
      licenseActivated = true;
    } catch (error) {
      console.log('License activation from settings failed:', error);
    }
  }
  
  // Always try to activate enterprise license if no other license is active
  if (!licenseActivated || licenseManager.getCurrentTier() === FeatureTier.FREE) {
    try {
      console.log('Attempting to activate enterprise license...');
      await licenseManager.activateLicense(ENTERPRISE_KEY);
      console.log('Enterprise license activated successfully');
      console.log('Current tier after activation:', licenseManager.getCurrentTier());
      console.log('Max server connections:', licenseManager.getMaxServerConnections());
      console.log('Can use unlimited servers:', licenseManager.canUseFeature(require('./licensing/features').Feature.UNLIMITED_SERVERS));
    } catch (error) {
      console.error('Enterprise license activation failed:', error);
    }
  }
  
  // Debug license status
  console.log('=== License Status Debug ===');
  console.log('Current tier:', licenseManager.getCurrentTier());
  console.log('Is licensed:', licenseManager.isLicensed());
  console.log('Max server connections:', licenseManager.getMaxServerConnections());
  console.log('License object:', licenseManager.getCurrentLicense());
  console.log('===========================');

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
  // const cronTreeProvider = new CronTreeProvider(connectionManager, serverRegistry); // Disabled

  // Register tree data providers
  vscode.window.registerTreeDataProvider('sidekiqServers', serverTreeProvider);
  vscode.window.registerTreeDataProvider('sidekiqQueues', queueTreeProvider);
  vscode.window.registerTreeDataProvider('sidekiqWorkers', workerTreeProvider);
  // vscode.window.registerTreeDataProvider('sidekiqCron', cronTreeProvider); // Disabled
  
  console.log('Tree data providers registered successfully');
  
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
    // cronTreeProvider // Disabled
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
  
  // Listen for server registry changes and refresh tree view
  serverRegistry.on('serversLoaded', () => {
    console.log('Servers loaded, refreshing server tree view');
    serverTreeProvider.refresh();
  });
  serverRegistry.on('serverAdded', () => {
    console.log('Server added, refreshing server tree view');
    serverTreeProvider.refresh();
  });
  serverRegistry.on('serverRemoved', () => {
    console.log('Server removed, refreshing server tree view');
    serverTreeProvider.refresh();
  });
  serverRegistry.on('activeServerChanged', () => {
    console.log('Active server changed, refreshing server tree view');
    serverTreeProvider.refresh();
  });

  // Set up auto-refresh
  const refreshInterval = vscode.workspace.getConfiguration('sidekiq').get<number>('refreshInterval', 30) * 1000;
  setInterval(() => {
    if (serverRegistry.getActiveServer() && connectionManager.isConnected(serverRegistry.getActiveServer()!)) {
      serverTreeProvider.refresh();
      queueTreeProvider.refresh();
      workerTreeProvider.refresh();
      jobTreeProvider.refresh();
      // cronTreeProvider.refresh(); // Disabled
    }
  }, Math.max(refreshInterval, 5000)); // Minimum 5 seconds

  // Auto-connect to saved servers
  await serverRegistry.loadSavedServers();
  
  // Refresh tree view after loading servers
  serverTreeProvider.refresh();
  
  // If no servers configured, add a default localhost server
  if (serverRegistry.getServerCount() === 0) {
    console.log('No servers configured, adding default localhost server');
    const defaultServer = await serverRegistry.addServer({
      name: 'Local Redis',
      host: 'localhost',
      port: 6379,
      environment: ServerEnvironment.Development
    });
    
    // Refresh tree view after adding default server
    serverTreeProvider.refresh();
    
    // Try to connect to the default server
    try {
      await connectionManager.connect(defaultServer);
      console.log('Connected to default localhost server');
    } catch (error) {
      console.log('Could not connect to default localhost server:', error);
      // Not critical if it fails
    }
  } else {
    // If servers exist, try to connect to the active server
    const activeServer = serverRegistry.getActiveServer();
    if (activeServer) {
      try {
        await connectionManager.connect(activeServer);
        console.log(`Connected to active server: ${activeServer.name}`);
      } catch (error) {
        console.log(`Could not connect to active server ${activeServer.name}:`, error);
      }
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