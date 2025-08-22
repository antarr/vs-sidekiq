# VS Code Sidekiq Manager Extension Specification

## Overview
A Visual Studio Code extension that provides a comprehensive interface for monitoring and managing Sidekiq queues, jobs, and workers across multiple Redis/Sidekiq servers directly from the IDE, eliminating the need to switch to a web browser for Sidekiq administration. The extension supports managing multiple environments (development, staging, production) and multiple applications simultaneously.

## Core Features

### 1. Multi-Server Management
- **Server Connection Management**
  - Add/remove multiple Sidekiq servers
  - Configure connection profiles (name, host, port, auth, SSL)
  - Environment labeling (dev, staging, production)
  - Connection health monitoring
  - Auto-reconnection with backoff
  - Server grouping by project/application
  
- **Server Switching**
  - Quick server switcher in status bar
  - Dropdown server selector in views
  - Keyboard shortcuts for server switching
  - Recently used servers list
  - Favorite servers pinning
  
- **Aggregated Views**
  - Combined dashboard across all servers
  - Cross-server job search
  - Unified metrics and statistics
  - Server comparison views
  - Global operations across servers

### 2. Dashboard View
- **Real-time Metrics Display**
  - Per-server and aggregated metrics
  - Processed jobs count (per server/total)
  - Failed jobs count (per server/total)
  - Scheduled jobs count (per server/total)
  - Retry queue size (per server/total)
  - Dead jobs count (per server/total)
  - Queue latency metrics (per server)
  - Worker count and status (per server)
  - Memory usage statistics (per server)
  - Server-specific health indicators
  
- **Performance Graphs**
  - Jobs processed per minute/hour (per server/combined)
  - Queue depth over time (per server/combined)
  - Worker utilization charts (per server/combined)
  - Error rate trends (per server/combined)
  - Server comparison charts
  - Cross-server performance analysis

### 3. Queue Management
- **Queue List View**
  - Display all active queues per server
  - Server indicator for each queue
  - Show queue sizes and latency
  - Priority/weight configuration
  - Queue pause/unpause functionality
  - Cross-server queue comparison
  
- **Queue Operations**
  - Clear queue (per server or across servers)
  - Move jobs between queues (same or different servers)
  - Delete specific jobs
  - Bulk job operations across servers
  - Queue filtering and search (per server or global)
  - Queue synchronization between servers

### 4. Job Management
- **Job Inspection**
  - View job arguments and metadata
  - Display job class and queue
  - Show source server information
  - Show enqueued/retry timestamps
  - Error messages and stack traces
  - Cross-server job tracking
  
- **Job Actions**
  - Retry failed jobs (individual or bulk)
  - Delete jobs (per server or across servers)
  - Move jobs to different queues/servers
  - Kill running jobs
  - Schedule job execution
  - Copy jobs between servers
  - Job migration tools

### 5. Worker Monitoring
- **Worker Status**
  - List active workers per server
  - Display current job processing
  - Show worker process info (PID, hostname, server)
  - Worker uptime and statistics
  - Cross-server worker distribution
  
- **Worker Control**
  - Quiet workers (per server or all)
  - Terminate workers gracefully
  - Force kill stuck workers
  - Worker load balancing insights

### 6. Scheduled Jobs
- **Scheduled Job View**
  - List all scheduled jobs per server
  - Group by scheduled time and server
  - Search and filter capabilities (per server/global)
  - Cross-server schedule coordination
  
- **Scheduled Job Actions**
  - Reschedule jobs
  - Execute immediately
  - Delete scheduled jobs
  - Edit job parameters
  - Move scheduled jobs between servers

### 7. Failed/Dead Jobs
- **Failed Job Management**
  - Browse failed jobs with pagination (per server)
  - Filter by error type, job class, or server
  - View detailed error information
  - Retry mechanisms with configurable delays
  - Cross-server failure analysis
  
- **Dead Job Queue**
  - List jobs exceeding retry limits (per server)
  - Resurrect dead jobs
  - Permanent deletion options
  - Export job data for debugging
  - Bulk operations across servers

## Technical Architecture

### Extension Components

#### 1. Core Module (`src/core/`)
- **Connection Manager** (`connectionManager.ts`)
  - Multi-server connection handling
  - Connection pooling per server
  - Retry logic and error handling
  - Connection profile management
  - SSL/TLS configuration
  - Authentication management
  
- **Server Registry** (`serverRegistry.ts`)
  - Server configuration storage
  - Server discovery and auto-detection
  - Connection status tracking
  - Server health monitoring
  - Failover management
  
- **Sidekiq Client** (`sidekiqClient.ts`)
  - API wrapper for Sidekiq operations
  - Multi-server operation coordination
  - Data transformation and normalization
  - Per-server caching layer
  - Cross-server operation support

#### 2. Data Layer (`src/data/`)
- **Models** (`models/`)
  - Job model with server context
  - Queue model with server association
  - Worker status models with server info
  - Metrics data structures (per-server/aggregated)
  - Server configuration models
  
- **Repositories** (`repositories/`)
  - Job repository with multi-server support
  - Queue repository with server filtering
  - Worker repository with server context
  - Metrics repository with aggregation
  - Server configuration repository

#### 3. UI Components (`src/ui/`)
- **Views** (`views/`)
  - Multi-server dashboard webview
  - Server-aware queue tree view
  - Job detail panels with server context
  - Worker status sidebar per server
  - Server management view
  - Connection status panel
  
- **Components** (`components/`)
  - Server selector dropdown
  - Server status indicators
  - Multi-server charts and graphs
  - Data tables with server filtering
  - Action buttons with server context
  - Server connection wizard

#### 4. Commands (`src/commands/`)
- Server-specific command palette
- Multi-server context menu actions
- Server switching shortcuts
- Quick picks with server selection
- Bulk commands across servers

#### 5. Configuration (`src/config/`)
- Extension settings management
- Multi-server connection profiles
- Per-server UI preferences
- Global and per-server settings
- Connection profile import/export
- Secure credential storage

### Data Flow Architecture

```
VS Code Extension
    ├── Server Selection Layer
    │   ├── Server Registry
    │   ├── Active Server Manager
    │   └── Server Health Monitor
    ├── Command Handler
    │   └── Multi-Server Command Router
    ├── View Provider
    │   ├── Multi-Server Tree Provider
    │   ├── Server-Aware Webview Provider
    │   └── Aggregated View Provider
    ├── Sidekiq Service Layer
    │   ├── Multi-Server Queue Manager
    │   ├── Cross-Server Job Manager
    │   ├── Server Worker Manager
    │   └── Aggregated Metrics Collector
    └── Connection Pool Layer
        ├── Server Connection Pool
        ├── Connection Health Monitor
        └── Per-Server Redis Clients
```

## Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup and structure
- [ ] Multi-server connection manager
- [ ] Server registry implementation
- [ ] Basic Sidekiq client with multi-server support
- [ ] Core data models with server context
- [ ] Extension activation and server configuration UI

### Phase 2: Core Views (Week 3-4)
- [ ] Multi-server dashboard webview
- [ ] Server-aware queue tree view
- [ ] Job list view with server filtering
- [ ] Per-server worker status sidebar
- [ ] Server switcher UI component
- [ ] Command palette with server selection

### Phase 3: Job Operations (Week 5-6)
- [ ] Cross-server job retry functionality
- [ ] Job migration between servers
- [ ] Multi-server failed job management
- [ ] Cross-server scheduled job handling
- [ ] Bulk operations across servers
- [ ] Job copying and synchronization

### Phase 4: Advanced Features (Week 7-8)
- [ ] Real-time updates for all servers
- [ ] Multi-server performance graphs
- [ ] Cross-server queue operations
- [ ] Global worker control features
- [ ] Advanced search across servers
- [ ] Server comparison analytics

### Phase 5: Polish & Testing (Week 9-10)
- [ ] Comprehensive error handling
- [ ] Performance optimization
- [ ] Unit and integration tests
- [ ] Documentation
- [ ] Extension marketplace preparation

## Technical Requirements

### Dependencies
- **Core**
  - `vscode`: VS Code Extension API
  - `ioredis`: Redis client for Node.js
  - `node-sidekiq`: Sidekiq API wrapper (if available)
  
- **UI**
  - `chart.js`: For metrics visualization
  - `ag-grid-community`: For data tables
  - `date-fns`: Date formatting and manipulation
  
- **Development**
  - `typescript`: Type safety
  - `webpack`: Bundle optimization
  - `eslint`: Code quality
  - `jest`: Testing framework

### Performance Considerations
- Implement data pagination for large job lists
- Per-server caching strategies
- Connection pooling for multiple servers
- Parallel data fetching from servers
- Use virtual scrolling for long lists
- Debounce real-time updates per server
- Lazy load detailed job information
- Optimize Redis queries with proper indexing
- Implement server request batching
- Smart polling intervals based on server load

### Security Considerations
- Secure storage of multiple server credentials
- Per-server SSL/TLS configuration
- Encrypted credential storage using VS Code Secret Storage API
- Sanitize job data display to prevent XSS
- Server-level access controls
- Audit log for destructive operations per server
- Connection profile encryption
- Secure credential sharing between team members

## User Experience Design

### Navigation Structure
```
SIDEKIQ MANAGER
├── Servers
│   ├── [Production]
│   │   ├── Dashboard
│   │   ├── Queues
│   │   ├── Workers
│   │   ├── Scheduled
│   │   ├── Failed
│   │   └── Dead
│   ├── [Staging]
│   │   └── [Same structure]
│   └── [Development]
│       └── [Same structure]
├── All Servers (Aggregated View)
│   ├── Combined Dashboard
│   ├── All Queues
│   ├── All Workers
│   └── Global Search
└── Server Management
    ├── Add Server
    ├── Import Profiles
    └── Connection Status
```

### Key Interactions
- **Double-click**: Open detailed view
- **Right-click**: Context menu with server-specific actions
- **Drag & Drop**: Move jobs between queues/servers
- **Keyboard Shortcuts**:
  - `Ctrl+Shift+S`: Open Sidekiq dashboard
  - `Ctrl+Alt+S`: Switch server
  - `Ctrl+R`: Retry selected job
  - `Ctrl+D`: Delete selected job
  - `F5`: Refresh current view
  - `Ctrl+1-9`: Quick switch to server 1-9

### Status Bar Integration
- Current active server indicator
- Server connection status icons
- Aggregated job processing rate
- Quick server switcher dropdown
- Failed job count per server
- Total worker count across servers

## Testing Strategy

### Unit Tests
- Multi-server connection manager logic
- Server registry operations
- Data transformation functions
- Command handlers with server context
- Repository methods with server filtering

### Integration Tests
- Multi-server Redis connection scenarios
- Cross-server Sidekiq API interactions
- Server failover handling
- View rendering with server switching
- Command execution across servers

### E2E Tests
- Complete multi-server workflows
- Server switching scenarios
- Cross-server job operations
- Error handling with server failures
- Performance with multiple active servers
- Server profile import/export

## Success Metrics
- Extension activation time < 2 seconds
- Dashboard load time < 1 second per server
- Support for 10+ simultaneous server connections
- Support for 10,000+ jobs per server without degradation
- 99.9% uptime for individual server connections
- Server switch time < 500ms
- User satisfaction rating > 4.5 stars

## Future Enhancements
- Sidekiq Pro/Enterprise feature support
- Server auto-discovery via configuration files
- Job performance profiling across servers
- Custom job action plugins
- Integration with debugging tools
- Server cluster management
- Automated server failover
- Cross-server job load balancing
- Slack/email notifications per server
- Dark/light theme support
- Internationalization support
- Server group templates
- Kubernetes/Docker integration
- Server migration tools

## Risks and Mitigation
- **Risk**: Multiple Redis connection failures
  - **Mitigation**: Per-server retry logic, connection pooling, and offline mode
  
- **Risk**: Large dataset performance across servers
  - **Mitigation**: Server-specific pagination, lazy loading, and caching
  
- **Risk**: Server credential security
  - **Mitigation**: VS Code Secret Storage API and encrypted profiles
  
- **Risk**: Network latency with remote servers
  - **Mitigation**: Asynchronous operations and request batching
  
- **Risk**: Sidekiq API version differences
  - **Mitigation**: Version detection and compatibility layer
  
- **Risk**: VS Code API limitations for multi-server UI
  - **Mitigation**: Advanced webviews and custom UI components

## Delivery Timeline
- **Total Duration**: 10 weeks
- **MVP Release**: Week 6 (basic functionality)
- **Beta Release**: Week 8 (feature complete)
- **Production Release**: Week 10 (polished and tested)