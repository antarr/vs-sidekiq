import * as vscode from 'vscode';
import { ConnectionManager } from '../core/connectionManager';
import { ServerRegistry } from '../core/serverRegistry';
import { AnalyticsCollector } from '../telemetry/analytics';
import { DashboardProvider } from '../ui/views/dashboardProvider';
import { QueueDetailsProvider } from '../ui/views/queueDetailsProvider';
import { WorkerDetailsProvider } from '../ui/views/workerDetailsProvider';
import { JobDetailsProvider } from '../ui/views/jobDetailsProvider';
import { MetricsProvider } from '../ui/views/metricsProvider';
import { ServerTreeProvider } from '../ui/views/serverTreeProvider';
import { QueueTreeProvider } from '../ui/views/queueTreeProvider';
import { WorkerTreeProvider } from '../ui/views/workerTreeProvider';
import { JobTreeProvider } from '../ui/views/jobTreeProvider';
import { ServerEnvironment } from '../data/models/server';

interface CommandContext {
  connectionManager: ConnectionManager;
  serverRegistry: ServerRegistry;
  analytics: AnalyticsCollector;
  dashboardProvider: DashboardProvider;
  queueDetailsProvider: QueueDetailsProvider;
  workerDetailsProvider: WorkerDetailsProvider;
  jobDetailsProvider: JobDetailsProvider;
  metricsProvider: MetricsProvider;
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
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        ctx.jobTreeProvider.refresh();

        console.log(`Successfully connected to server: ${name}`);
        vscode.window.showInformationMessage(`Connected to ${name}`);
      } catch (error: any) {
        console.error(`Failed to connect to server:`, error);
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

  // View server dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewServerDashboard', async (server: any) => {
      ctx.analytics.trackCommand('sidekiq.viewServerDashboard', true);

      if (!server || !server.id) {
        const activeServer = ctx.serverRegistry.getActiveServer();
        if (!activeServer) {
          vscode.window.showWarningMessage('No server selected. Please select a server first.');
          return;
        }
        server = activeServer;
      }

      // Set as active server
      ctx.serverRegistry.setActiveServer(server.id);

      // Connect if not connected
      if (!ctx.connectionManager.isConnected(server)) {
        try {
          await ctx.connectionManager.connect(server);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to connect to ${server.name}: ${error.message}`);
          return;
        }
      }

      // Show dashboard
      await ctx.dashboardProvider.showDashboard(server);
    })
  );

  // View metrics command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewMetrics', async (server?: any) => {
      ctx.analytics.trackCommand('sidekiq.viewMetrics', true);

      // Use provided server or get active server
      const targetServer = server || ctx.serverRegistry.getActiveServer();
      if (!targetServer) {
        vscode.window.showWarningMessage('No server connected. Please connect to a server first.');
        return;
      }

      // If a server was provided, set as active and connect if needed
      if (server && server.id) {
        ctx.serverRegistry.setActiveServer(server.id);
        if (!ctx.connectionManager.isConnected(server)) {
          try {
            await ctx.connectionManager.connect(server);
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect to ${server.name}: ${error.message}`);
            return;
          }
        }
      }

      // Show metrics view
      await ctx.metricsProvider.showMetrics(targetServer);
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

      // Show detailed queue view
      await ctx.queueDetailsProvider.showQueueDetails(activeServer, queue);
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

      // Show detailed worker view
      await ctx.workerDetailsProvider.showWorkerDetails(activeServer, worker);
    })
  );

  // View job command - now shows full details view
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewJob', async (job: any, category: string) => {
      ctx.analytics.trackCommand('sidekiq.viewJob', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Show detailed job view with backtrace support
      await ctx.jobDetailsProvider.showJobDetails(activeServer, job, category);
    })
  );

  // View job details command - for double-click, now opens the new detailed view
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewJobDetails', async (treeItem: any) => {
      ctx.analytics.trackCommand('sidekiq.viewJobDetails', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Extract job and category from tree item
      const job = treeItem.job || treeItem;
      const category = treeItem.category || 'unknown';

      // Show detailed job view
      await ctx.jobDetailsProvider.showJobDetails(activeServer, job, category);
    })
  );

  // Retry job command - handles both single and multi-select from context menu
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.retryJob', async (...args: any[]) => {
      ctx.analytics.trackCommand('sidekiq.retryJob', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Handle both old single-item and new multi-select formats
      let items: any[] = [];
      if (args.length === 2 && Array.isArray(args[1])) {
        // New format: (item, allSelectedItems)
        items = args[1];
      } else if (args.length === 1) {
        // Old format: single item
        items = [args[0]];
      }

      if (items.length === 0) {
        return;
      }

      const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);

      if (items.length === 1) {
        // Single item
        const job = items[0].job || items[0];
        try {
          await client.retryJob(activeServer, job);
          vscode.window.showInformationMessage('Job retried successfully');
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to retry job: ${error.message}`);
        }
      } else {
        // Multiple items
        const confirm = await vscode.window.showWarningMessage(
          `Retry ${items.length} job(s)?`,
          'Yes',
          'No'
        );

        if (confirm === 'Yes') {
          let successCount = 0;
          let failCount = 0;

          for (const treeItem of items) {
            const job = treeItem.job || treeItem;
            try {
              await client.retryJob(activeServer, job);
              successCount++;
            } catch (error) {
              failCount++;
              console.error(`Failed to retry job ${job.id}:`, error);
            }
          }

          if (failCount === 0) {
            vscode.window.showInformationMessage(`Successfully retried ${successCount} job(s)`);
          } else {
            vscode.window.showWarningMessage(`Retried ${successCount} job(s), ${failCount} failed`);
          }
        }
      }

      // Refresh all relevant views
      ctx.jobTreeProvider.refresh();
      ctx.queueTreeProvider.refresh();
      ctx.workerTreeProvider.refresh();
      vscode.commands.executeCommand('sidekiq.refreshUI');
    })
  );

  // Delete job command - handles both single and multi-select from context menu
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.deleteJob', async (...args: any[]) => {
      ctx.analytics.trackCommand('sidekiq.deleteJob', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Handle both old single-item and new multi-select formats
      let items: any[] = [];
      if (args.length === 2 && Array.isArray(args[1])) {
        // New format: (item, allSelectedItems)
        items = args[1];
      } else if (args.length === 1) {
        // Old format: single item
        items = [args[0]];
      }

      if (items.length === 0) {
        return;
      }

      const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);

      const confirmMessage = items.length === 1
        ? `Delete job ${items[0].job?.id || items[0].id}?`
        : `Delete ${items.length} job(s)?`;

      const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        'Yes',
        'No'
      );

      if (confirm === 'Yes') {
        let successCount = 0;
        let failCount = 0;

        for (const treeItem of items) {
          const job = treeItem.job || treeItem;
          const category = treeItem.category || 'dead';

          try {
            await client.deleteJob(activeServer, job, category as any);
            successCount++;
          } catch (error) {
            failCount++;
            console.error(`Failed to delete job ${job.id}:`, error);
          }
        }

        if (items.length === 1) {
          if (successCount === 1) {
            vscode.window.showInformationMessage('Job deleted successfully');
          } else {
            vscode.window.showErrorMessage('Failed to delete job');
          }
        } else {
          if (failCount === 0) {
            vscode.window.showInformationMessage(`Successfully deleted ${successCount} job(s)`);
          } else {
            vscode.window.showWarningMessage(`Deleted ${successCount} job(s), ${failCount} failed`);
          }
        }
      }

      // Refresh all relevant views
      ctx.jobTreeProvider.refresh();
      ctx.queueTreeProvider.refresh();
      ctx.workerTreeProvider.refresh();
      vscode.commands.executeCommand('sidekiq.refreshUI');
    })
  );

  // Retry selected jobs command - bulk operation
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.retrySelectedJobs', async (item: any, items: any[]) => {
      ctx.analytics.trackCommand('sidekiq.retrySelectedJobs', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Use all selected items or fall back to single item
      const selectedItems = items && items.length > 0 ? items : [item];

      const confirm = await vscode.window.showWarningMessage(
        `Retry ${selectedItems.length} job(s)?`,
        'Yes',
        'No'
      );

      if (confirm === 'Yes') {
        let successCount = 0;
        let failCount = 0;

        const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);

        for (const treeItem of selectedItems) {
          const job = treeItem.job || treeItem;
          try {
            await client.retryJob(activeServer, job);
            successCount++;
          } catch (error) {
            failCount++;
            console.error(`Failed to retry job ${job.id}:`, error);
          }
        }

        if (failCount === 0) {
          vscode.window.showInformationMessage(`Successfully retried ${successCount} job(s)`);
        } else {
          vscode.window.showWarningMessage(`Retried ${successCount} job(s), ${failCount} failed`);
        }

        // Refresh views
        ctx.jobTreeProvider.refresh();
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        vscode.commands.executeCommand('sidekiq.refreshUI');
      }
    })
  );

  // Delete selected jobs command - bulk operation
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.deleteSelectedJobs', async (item: any, items: any[]) => {
      ctx.analytics.trackCommand('sidekiq.deleteSelectedJobs', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      // Use all selected items or fall back to single item
      const selectedItems = items && items.length > 0 ? items : [item];

      const confirm = await vscode.window.showWarningMessage(
        `Delete ${selectedItems.length} job(s)?`,
        'Yes',
        'No'
      );

      if (confirm === 'Yes') {
        let successCount = 0;
        let failCount = 0;

        const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);

        for (const treeItem of selectedItems) {
          const job = treeItem.job || treeItem;
          const category = treeItem.category || 'dead';
          try {
            await client.deleteJob(activeServer, job, category as any);
            successCount++;
          } catch (error) {
            failCount++;
            console.error(`Failed to delete job ${job.id}:`, error);
          }
        }

        if (failCount === 0) {
          vscode.window.showInformationMessage(`Successfully deleted ${successCount} job(s)`);
        } else {
          vscode.window.showWarningMessage(`Deleted ${successCount} job(s), ${failCount} failed`);
        }

        // Refresh views
        ctx.jobTreeProvider.refresh();
        ctx.queueTreeProvider.refresh();
        ctx.workerTreeProvider.refresh();
        vscode.commands.executeCommand('sidekiq.refreshUI');
      }
    })
  );

  // Clear queue command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.clearQueue', async (item: any) => {
      ctx.analytics.trackCommand('sidekiq.clearQueue', true);

      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }

      const queue = item.queue || item;

      const confirm = await vscode.window.showWarningMessage(
        `Clear all jobs from queue "${queue.name}"? This cannot be undone.`,
        'Yes',
        'No'
      );

      if (confirm === 'Yes') {
        try {
          const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
          await client.clearQueue(activeServer, queue.name);
          vscode.window.showInformationMessage(`Queue "${queue.name}" cleared successfully`);

          // Refresh views
          ctx.queueTreeProvider.refresh();
          ctx.jobTreeProvider.refresh();
          vscode.commands.executeCommand('sidekiq.refreshUI');
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to clear queue: ${error.message}`);
        }
      }
    })
  );

  // Pause queue command (placeholder - Sidekiq doesn't natively support this)
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.pauseQueue', async (item: any) => {
      ctx.analytics.trackCommand('sidekiq.pauseQueue', true);

      const queue = item.queue || item;
      vscode.window.showInformationMessage(`Queue pausing is not yet implemented. Queue: ${queue.name}`);
      // TODO: Implement queue pausing if using Sidekiq Pro/Enterprise
    })
  );

  // Debug command for testing
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.debug', async () => {
      const servers = ctx.serverRegistry.getAllServers();
      const activeServer = ctx.serverRegistry.getActiveServer();

      const debugInfo = [
        '=== Sidekiq Manager Debug Info ===',
        `Total Servers Configured: ${servers.length}`,
        `Active Server: ${activeServer ? activeServer.name + ' (' + activeServer.id + ')' : 'None'}`,
        '',
        'Configured Servers:',
        ...servers.map(s => `  - ${s.name} (${s.id}) - ${s.host}:${s.port} [${s.environment}]`),
        ''
      ];

      // Add Redis debug info if server is connected
      if (activeServer && ctx.connectionManager.isConnected(activeServer)) {
        try {
          const redis = await ctx.connectionManager.getConnection(activeServer);
          const processes = await redis.smembers('processes');
          const workers = await redis.smembers('workers');
          const sidekiqWorkers = await redis.smembers('sidekiq:workers');
          const sidekiqProcesses = await redis.smembers('sidekiq:processes');
          const workerKeys = await redis.keys('*worker*');
          const queueKeys = await redis.keys('queue:*');

          debugInfo.push('Redis Keys:');
          debugInfo.push(`  - Workers in 'processes' set (Sidekiq 6+): ${processes.length}`);
          debugInfo.push(`  - Workers in 'workers' set (legacy): ${workers.length}`);
          debugInfo.push(`  - Workers in 'sidekiq:processes' set: ${sidekiqProcesses.length}`);
          debugInfo.push(`  - Workers in 'sidekiq:workers' set: ${sidekiqWorkers.length}`);
          debugInfo.push(`  - Worker keys found: ${workerKeys.length}`);
          debugInfo.push(`  - Queue keys found: ${queueKeys.length}`);

          if (processes.length > 0) {
            debugInfo.push('  - Active processes:');
            for (const processId of processes) {
              const processData = await redis.hgetall(processId);
              if (processData.info) {
                const info = JSON.parse(processData.info);
                debugInfo.push(`    - ${processId}`);
                debugInfo.push(`      Hostname: ${info.hostname}`);
                debugInfo.push(`      PID: ${info.pid}`);
                debugInfo.push(`      Tag: ${info.tag || 'none'}`);
                debugInfo.push(`      Busy: ${processData.busy || 0}`);
                debugInfo.push(`      Queues: ${info.queues.length} queues`);
              }
            }
          }

          if (workerKeys.length > 0) {
            debugInfo.push('  - Sample worker keys:');
            workerKeys.slice(0, 5).forEach(key => debugInfo.push(`    - ${key}`));
          }
        } catch (error: any) {
          debugInfo.push('Redis Error:');
          debugInfo.push(`  ${error.message}`);
        }
      }

      debugInfo.push('================================');

      const output = debugInfo.join('\n');
      console.log(output);

      const outputChannel = vscode.window.createOutputChannel('Sidekiq Debug');
      outputChannel.clear();
      outputChannel.appendLine(output);
      outputChannel.show();
    })
  );

  // Force refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.forceRefresh', () => {
      console.log('Force refreshing all views...');
      ctx.serverTreeProvider.refresh();
      ctx.queueTreeProvider.refresh();
      ctx.workerTreeProvider.refresh();
      ctx.jobTreeProvider.refresh();
      vscode.window.showInformationMessage('Views refreshed');
    })
  );

  /* Cron job commands disabled - focusing on core Sidekiq features
  // Cron job commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.viewCronJob', async (cronJob: any) => {
      ctx.analytics.trackCommand('sidekiq.viewCronJob', true);
      
      const activeStatus = cronJob.active ? 'Active' : 'Inactive';
      
      const lines = [
        '**Name:** ' + cronJob.name,
        '**Schedule:** ' + cronJob.cron,
        '**Class:** ' + cronJob.class,
        '**Queue:** ' + cronJob.queue,
        '**Status:** ' + activeStatus
      ];
      
      if (cronJob.lastEnqueueTime) {
        lines.push('**Last Run:** ' + cronJob.lastEnqueueTime.toLocaleString());
      }
      
      if (cronJob.nextEnqueueTime) {
        lines.push('**Next Run:** ' + cronJob.nextEnqueueTime.toLocaleString());
      }
      
      if (cronJob.description) {
        lines.push('**Description:** ' + cronJob.description);
      }
      
      if (cronJob.args && cronJob.args.length > 0) {
        lines.push('', '**Arguments:**', '```json', JSON.stringify(cronJob.args, null, 2), '```');
      }
      
      const outputChannel = vscode.window.createOutputChannel('Sidekiq Cron Job Details');
      outputChannel.clear();
      outputChannel.appendLine(lines.join('\n'));
      outputChannel.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.enableCronJob', async (item: any) => {
      ctx.analytics.trackCommand('sidekiq.enableCronJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      const cronJob = item.cronJob || item;
      
      try {
        const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
        await client.enableCronJob(activeServer, cronJob.name);
        vscode.window.showInformationMessage('Enabled cron job "' + cronJob.name + '"');
        ctx.cronTreeProvider.refresh();
      } catch (error: any) {
        vscode.window.showErrorMessage('Failed to enable cron job: ' + error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.disableCronJob', async (item: any) => {
      ctx.analytics.trackCommand('sidekiq.disableCronJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      const cronJob = item.cronJob || item;
      
      try {
        const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
        await client.disableCronJob(activeServer, cronJob.name);
        vscode.window.showInformationMessage('Disabled cron job "' + cronJob.name + '"');
        ctx.cronTreeProvider.refresh();
      } catch (error: any) {
        vscode.window.showErrorMessage('Failed to disable cron job: ' + error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidekiq.enqueueCronJob', async (item: any) => {
      ctx.analytics.trackCommand('sidekiq.enqueueCronJob', true);
      
      const activeServer = ctx.serverRegistry.getActiveServer();
      if (!activeServer) {
        vscode.window.showWarningMessage('No server connected');
        return;
      }
      
      const cronJob = item.cronJob || item;
      
      const confirm = await vscode.window.showWarningMessage(
        'Enqueue "' + cronJob.name + '" now?',
        'Yes',
        'No'
      );
      
      if (confirm === 'Yes') {
        try {
          const client = new (await import('../core/sidekiqClient')).SidekiqClient(ctx.connectionManager);
          await client.enqueueCronJobNow(activeServer, cronJob);
          vscode.window.showInformationMessage('Enqueued cron job "' + cronJob.name + '"');
          ctx.cronTreeProvider.refresh();
          ctx.queueTreeProvider.refresh();
        } catch (error: any) {
          vscode.window.showErrorMessage('Failed to enqueue cron job: ' + error.message);
        }
      }
    })
  );
  */
}
