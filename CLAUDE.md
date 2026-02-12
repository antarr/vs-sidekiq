# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension for monitoring and managing Sidekiq (Ruby background job processor) instances. The extension connects to Redis servers where Sidekiq stores its data and provides real-time monitoring, job management, and worker inspection directly in the VS Code IDE.

## Development Commands

### Build & Compile
```bash
npm run compile          # TypeScript compilation + esbuild bundling
npm run watch            # Watch mode for development
npm run vscode:prepublish # Pre-publish build (runs compile)
```

### Packaging & Publishing
```bash
vsce package            # Create .vsix extension package
vsce publish            # Publish to VS Code Marketplace
```

### Testing
```bash
npm run test            # Run test suite
```

### Linting
```bash
npm run lint            # Run ESLint on src/**/*.ts
```

## Architecture Overview

### Core Layer (`src/core/`)
- **ConnectionManager**: Manages Redis connections with auto-reconnect, event emission, and connection pooling. Uses ioredis client. Maintains a Map of connections keyed by server ID.
- **ServerRegistry**: Manages server configurations, active server selection, and persistence to VS Code settings. Emits events for server lifecycle changes.
- **SidekiqClient**: Business logic layer that queries Sidekiq data from Redis. Uses Lua scripts for atomic operations and Redis pipelining to avoid N+1 queries.

### Data Models (`src/data/models/`)
- **server.ts**: ServerConfig interface, ConnectionStatus and ServerEnvironment enums
- **sidekiq.ts**: Domain models (Queue, Job, Worker, SidekiqStats, Process, HistoricalMetric, CronJob)

### UI Layer (`src/ui/views/`)
Two types of providers:
1. **TreeDataProviders**: For sidebar tree views (ServerTreeProvider, QueueTreeProvider, WorkerTreeProvider, JobTreeProvider, CronTreeProvider)
2. **WebviewProviders**: For rich HTML panels (DashboardProvider, QueueDetailsProvider, WorkerDetailsProvider, JobDetailsProvider, MetricsProvider)

All tree providers refresh on a timer (configurable via `sidekiq.refreshInterval`, minimum 5 seconds).

### Commands (`src/commands/`)
Command registration happens in `registerCommands()` which wires up all VS Code commands to their handlers. Commands receive injected dependencies (connectionManager, serverRegistry, providers, etc.).

### Extension Lifecycle (`src/extension.ts`)
1. Initialize core services (ConnectionManager, ServerRegistry, AnalyticsCollector)
2. Create all providers (tree + webview)
3. Register providers with VS Code
4. Register commands
5. Set up auto-refresh timer
6. Load saved servers and auto-connect to active server or create default localhost:6379

### Telemetry (`src/telemetry/`)
- **AnalyticsCollector**: Tracks extension usage events (activation, connections, operations). Currently privacy-focused with no external transmission.

## Key Patterns

### Server Selection
- Users can have multiple servers configured
- ServerRegistry maintains an "active server" concept
- All data operations are scoped to the active server
- Status bar shows current active server and allows quick switching

### Redis Data Access
- **Pipelining**: Use Redis pipelines for batching operations (see `getQueues()` in SidekiqClient)
- **Lua Scripts**: Atomic operations use Lua scripts (see `REMOVE_JOB_BY_JID_SCRIPT`)
- **Sidekiq Redis Keys**: Follows Sidekiq conventions:
  - `stat:processed`, `stat:failed` - global counters
  - `queues` - SET of queue names
  - `queue:{name}` - LIST of jobs
  - `schedule`, `retry`, `dead` - ZSETs with scores as timestamps
  - `processes` - SET of process identifiers
  - `workers` - various keys for worker state

### Error Handling
- ConnectionManager emits events for connection state changes
- Redis errors are logged and surfaces in VS Code UI via status messages
- Connection status tracked via ConnectionStatus enum

### Multi-select Jobs
- JobTreeProvider supports multi-select via `canSelectMany: true` on tree view
- Bulk operations (retry/delete) operate on selections

## Build & Distribution

### TypeScript Configuration
- Source files: `src/**/*.ts`
- Output: `dist/` directory
- `rootDir` is `src/` - files outside must be excluded in `tsconfig.json`
- The `demo/` directory contains demo data generators and is excluded from compilation

### Extension Package
- Entry point: `dist/extension.js` (bundled via esbuild)
- Icon: `resources/icon.png`
- Bundled dependencies: ioredis, chart.js, date-fns, uuid
- `.vscodeignore` excludes source files, only `dist/` is packaged

### Versioning
- Version managed in `package.json`
- Follows semantic versioning
- CHANGELOG.md documents releases

## Testing Against Demo Data

The `demo/` directory contains:
- `demoData.ts`: Sample Sidekiq data (queues, jobs, workers)
- `seedRedis.ts`: Script to populate Redis with demo data for consistent screenshots/testing

To use demo data:
```bash
# Ensure you have a test Redis instance (e.g., localhost:6380)
ts-node demo/seedRedis.ts
```

## Extension Points

### Adding New Views
1. Create provider in `src/ui/views/`
2. Register in `extension.ts` activate()
3. Add to `package.json` contributes.views
4. Add refresh logic to auto-refresh timer if needed

### Adding New Commands
1. Add command definition to `package.json` contributes.commands
2. Implement handler in `src/commands/`
3. Register in `registerCommands()`
4. Optionally add keybinding in `package.json` keybindings

### Adding New Sidekiq Operations
1. Add method to `SidekiqClient` in `src/core/sidekiqClient.ts`
2. Follow pattern: accept ServerConfig, get connection via ConnectionManager
3. Use Redis pipelining for batch operations
4. Consider Lua scripts for atomic multi-step operations
