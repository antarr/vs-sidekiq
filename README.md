# Sidekiq Manager for VS Code

A comprehensive Visual Studio Code extension for monitoring and managing Sidekiq queues, jobs, and workers directly from your IDE. No more switching to a web browser for Sidekiq administration!

## Features

### 🚀 Multi-Server Support
- Connect to multiple Redis/Sidekiq servers simultaneously
- Quick server switching via status bar
- Environment-based organization (Development, Staging, Production)
- Secure credential storage

### 📊 Real-time Dashboard
- Live metrics and statistics
- Job processing rates
- Queue depths and latencies
- Worker status monitoring
- Failed job tracking

### 💼 Queue Management
- View all active queues
- Clear queues
- Pause/unpause processing
- Move jobs between queues
- Bulk operations support

### 🔧 Job Operations
- Inspect job details and arguments
- Retry failed jobs
- Delete jobs
- Schedule job execution
- View error messages and stack traces

### 👷 Worker Monitoring
- List active workers
- View current job processing
- Worker process information
- Graceful worker termination

### 💰 Freemium Model
- **Free Tier**: Single server connection, basic features
- **Pro Tier ($9/mo)**: 5 servers, bulk operations, advanced metrics
- **Team Tier ($29/mo)**: Unlimited servers, team collaboration, analytics
- **Enterprise**: Custom pricing, SSO, compliance, white-label

## Installation

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install sidekiq-manager`
4. Press Enter

## Quick Start

1. **Connect to a Server**
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P`
   - Type "Sidekiq: Connect to Server"
   - Enter your Redis connection details

2. **Open Dashboard**
   - Click the Sidekiq icon in the Activity Bar
   - Or press `Ctrl+Shift+S` / `Cmd+Shift+S`

3. **Switch Between Servers**
   - Click the server name in the status bar
   - Or use `Ctrl+Alt+S` / `Cmd+Alt+S`

## Configuration

```json
{
  "sidekiq.servers": [],
  "sidekiq.refreshInterval": 30,
  "sidekiq.theme": "auto"
}
```

## Commands

- `Sidekiq: Connect to Server` - Add a new server connection
- `Sidekiq: Open Dashboard` - Open the Sidekiq dashboard
- `Sidekiq: Switch Server` - Switch between connected servers
- `Sidekiq: Refresh` - Refresh all views
- `Sidekiq: Remove Server` - Remove a server connection
- `Sidekiq: Activate License` - Activate a pro/team license

## Keyboard Shortcuts

- `Ctrl+Shift+S` - Open Sidekiq dashboard
- `Ctrl+Alt+S` - Switch server
- `Ctrl+R` - Retry selected job
- `Ctrl+D` - Delete selected job
- `F5` - Refresh current view
- `Ctrl+1-9` - Quick switch to server 1-9

## Requirements

- VS Code 1.74.0 or higher
- Redis server with Sidekiq
- Network access to Redis server

## License Tiers

### Community (Free)
- 1 server connection
- Basic dashboard
- Queue and job viewing
- Worker monitoring
- Community support

### Professional ($9/month)
- 5 server connections
- Bulk operations
- Advanced metrics
- Custom refresh rates
- Email support

### Business ($29/month)
- Unlimited servers
- Team collaboration
- Historical analytics
- Webhook integrations
- Priority support

### Enterprise (Custom)
- SSO integration
- Compliance reporting
- Custom features
- 24/7 support
- SLA guarantee

## Support

- GitHub Issues: [github.com/antarr/vs-sidekiq/issues](https://github.com/antarr/vs-sidekiq/issues)
- Documentation: [sidekiq-manager.com/docs](https://sidekiq-manager.com/docs)
- Email: support@sidekiq-manager.com

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

Made with ❤️ for the Ruby/Rails community