import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connectionManager';
import { ServerRegistry } from '../core/serverRegistry';
import { LicenseManager } from '../licensing/licenseManager';
import { AnalyticsCollector } from '../telemetry/analytics';
import { DashboardProvider } from '../ui/views/dashboardProvider';
import { ServerTreeProvider } from '../ui/views/serverTreeProvider';
import { QueueTreeProvider } from '../ui/views/queueTreeProvider';
import { WorkerTreeProvider } from '../ui/views/workerTreeProvider';
import { JobTreeProvider } from '../ui/views/jobTreeProvider';
import { ServerEnvironment } from '../data/models/server';

interface CommandContext {
  connectionManager: ConnectionManager;
  serverRegistry: ServerRegistry;
  licenseManager: LicenseManager;
  analytics: AnalyticsCollector;
  dashboardProvider: DashboardProvider;
  serverTreeProvider: ServerTreeProvider;
  queueTreeProvider: QueueTreeProvider;
  workerTreeProvider: WorkerTreeProvider;
  jobTreeProvider: JobTreeProvider;
}

export function registerCommands(context: vscode.ExtensionContext, ctx: CommandContext) {
  // Connect to server command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.connect', async () => {
      ctx.analytics.trackCommand('sidekiq.connect', true);
      
      // Check server limit
      const maxServers = ctx.licenseManager.getMaxServerConnections();
      const currentServers = ctx.serverRegistry.getServerCount();
      
      if (currentServers >= maxServers) {
        const upgrade = await vscode.window.showWarningMessage(
          `You've reached the maximum of ${maxServers} server connections for your plan.`,
          'Upgrade Plan',
          'Remove Server'
        );
        
        if (upgrade === 'Upgrade Plan') {
          vscode.commands.executeCommand('sidekiq.upgrade');
        } else if (upgrade === 'Remove Server') {
          vscode.commands.executeCommand('sidekiq.removeServer');
        }
        return;
      }

      // Get server details
      const name = await vscode.window.showInputBox({
        prompt: 'Server name',
        placeHolder: 'e.g., Production Redis'
      });
      if (!name) return;

      const host = await vscode.window.showInputBox({
        prompt: 'Redis host',
        placeHolder: 'localhost',
        value: 'localhost'
      });
      if (!host) return;

      const portStr = await vscode.window.showInputBox({
        prompt: 'Redis port',
        placeHolder: '6379',
        value: '6379'
      });
      if (!portStr) return;
      const port = parseInt(portStr);

      const password = await vscode.window.showInputBox({
        prompt: 'Redis password (optional)',
        password: true
      });

      const envOptions = ['Development', 'Staging', 'Production', 'Custom'];
      const env = await vscode.window.showQuickPick(envOptions, {
        placeHolder: 'Select environment'
      });
      if (!env) return;

      // Add server
      try {
        const server = await ctx.serverRegistry.addServer({
          name,
          host,
          port,
          password,
          environment: env.toLowerCase() as ServerEnvironment
        });

        // Connect to server
        await ctx.connectionManager.connect(server);
        
        // Refresh views
        ctx.serverTreeProvider.refresh();
        
        vscode.window.showInformationMessage(`Connected to ${name}`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
        ctx.analytics.trackError(error, 'connect_server');
      }
    })
  );

  // Open dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.dashboard', async () => {
      ctx.analytics.trackCommand('sidekiq.dashboard', true);
      ctx.analytics.trackViewOpened('dashboard');
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected. Please connect to a server first.');
        return;
      }

      await ctx.dashboardProvider.showDashboard(activeServer);
    })
  );

  // Switch server command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.switchServer', async () => {
      ctx.analytics.trackCommand('sidekiq.switchServer', true);
      
      const servers = ctx.serverRegistry.getAllServers();
      if (servers.length === 0) {
        vscode.window.showInformationMessage('No servers configured. Add a server first.');
        vscode.commands.executeCommand('sidekiq.connect');
        return;
      }

      const items = servers.map(s => ({
        label: s.name,
        description: `${s.host}:${s.port} (${s.environment})`,
        server: s
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select server to switch to'
      });

      if (selected) {
        ctx.serverRegistry.setActiveServer(selected.server.id);
        
        // Refresh all views
        ctx.serverTreeProvider.refresh();
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        ctx.jobTreeProvider.refresh();
        
        vscode.window.showInformationMessage(`Switched to ${selected.server.name}`);
      }
    })
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.refresh', () => {
      ctx.analytics.trackCommand('sidekiq.refresh', true);
      
      ctx.serverTreeProvider.refresh();
      ctx.queueTreeProvider.refresh();
      ctx.workerTreeProvider.refresh();
      ctx.jobTreeProvider.refresh();
    })
  );

  // Remove server command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.removeServer', async () => {
      ctx.analytics.trackCommand('sidekiq.removeServer', true);
      
      const servers = ctx.serverRegistry.getAllServers();
      if (servers.length === 0) {
        vscode.window.showInformationMessage('No servers to remove.');
        return;
      }

      const items = servers.map(s => ({
        label: s.name,
        description: `${s.host}:${s.port}`,
        server: s
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select server to remove'
      });

      if (selected) {
        const confirm = await vscode.window.showWarningMessage(
          `Remove server "${selected.server.name}"?`,
          'Yes',
          'No'
        );
        
        if (confirm === 'Yes') {
          await ctx.connectionManager.disconnect(selected.server);
          await ctx.serverRegistry.removeServer(selected.server.id);
          ctx.serverTreeProvider.refresh();
          vscode.window.showInformationMessage(`Removed ${selected.server.name}`);
        }
      }
    })
  );

  // Upgrade command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.upgrade', async () => {
      ctx.analytics.trackCommand('sidekiq.upgrade', true);
      ctx.analytics.trackUpgradeTrigger('manual', ctx.licenseManager.getCurrentTier(), 'pro' as any);
      
      const url = 'https://sidekiq-manager.com/pricing';
      vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // License activation command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.activateLicense', async () => {
      ctx.analytics.trackCommand('sidekiq.activateLicense', true);
      
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your license key',
        placeHolder: 'XXXX-XXXX-XXXX-XXXX',
        password: true
      });

      if (key) {
        try {
          await ctx.licenseManager.activateLicense(key);
          vscode.window.showInformationMessage('License activated successfully!');
          
          // Refresh all views to show new features
          vscode.commands.executeCommand('sidekiq.refresh');
        } catch (error: any) {
          vscode.window.showErrorMessage(`License activation failed: ${error.message}`);
        }
      }
    })
  );

  // Refresh UI command (internal)
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.refreshUI', () => {
      ctx.serverTreeProvider.refresh();
      ctx.queueTreeProvider.refresh();
      ctx.workerTreeProvider.refresh();
      ctx.jobTreeProvider.refresh();
    })
  );

  // Select server command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.selectServer', async (server: any) => {
      if (server && server.id) {
        ctx.serverRegistry.setActiveServer(server.id);
        
        // Connect if not connected
        if (!ctx.connectionManager.isConnected(server)) {
          try {
            await ctx.connectionManager.connect(server);
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect to ${server.name}: ${error.message}`);
          }
        }
        
        // Refresh all views
        ctx.serverTreeProvider.refresh();
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        ctx.jobTreeProvider.refresh();
        
        vscode.window.showInformationMessage(`Selected server: ${server.name}`);
      }
    })
  );

  // View queue command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewQueue', async (queue: any) => {
      ctx.analytics.trackCommand('sidekiq.viewQueue', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      // Show queue details in dashboard or panel
      vscode.window.showInformationMessage(`Queue: ${queue.name} - ${queue.size} jobs`);
      // TODO: Implement detailed queue view
    })
  );

  // View worker command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewWorker', async (worker: any) => {
      ctx.analytics.trackCommand('sidekiq.viewWorker', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      // Show worker details
      const status = worker.job ? `Processing: ${worker.job.class}` : 'Idle';
      vscode.window.showInformationMessage(`Worker ${worker.hostname}:${worker.pid} - ${status}`);
      // TODO: Implement detailed worker view
    })
  );

  // View job command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewJob', async (job: any, category: string) => {
      ctx.analytics.trackCommand('sidekiq.viewJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      // Show job details
      const message = `Job: ${job.class}\nQueue: ${job.queue}\nID: ${job.id}`;
      const action = await vscode.window.showInformationMessage(
        message,
        'Retry',
        'Delete',
        'Close'
      );
      
      if (action === 'Retry') {
        vscode.commands.executeCommand('sidekiq.retryJob', job, category);
      } else if (action === 'Delete') {
        vscode.commands.executeCommand('sidekiq.deleteJob', job, category);
      }
    })
  );

  // Retry job command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.retryJob', async (job: any, _category: string) => {
      ctx.analytics.trackCommand('sidekiq.retryJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      try {
        const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
        await client.retryJob(activeServer, job);
        vscode.window.showInformationMessage('Job retried successfully');
        
        // Refresh all relevant views
        ctx.jobTreeProvider.refresh();
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        
        // Also refresh dashboard if open
        vscode.commands.executeCommand('sidekiq.refreshUI');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to retry job: ${error.message}`);
      }
    })
  );

  // Delete job command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.deleteJob', async (job: any, category: string) => {
      ctx.analytics.trackCommand('sidekiq.deleteJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      const confirm = await vscode.window.showWarningMessage(
        `Delete job ${job.id}?`,
        'Yes',
        'No'
      );
      
      if (confirm === 'Yes') {
        try {
          const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
          await client.deleteJob(activeServer, job, category as any);
          vscode.window.showInformationMessage('Job deleted successfully');
          
          // Refresh all relevant views
          ctx.jobTreeProvider.refresh();
          ctx.queueTreeProvider.refresh();
          ctx.workerTreeProvider.refresh();
          
          // Also refresh dashboard if open
          vscode.commands.executeCommand('sidekiq.refreshUI');
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to delete job: ${error.message}`);
        }
      }
    })
  );
}