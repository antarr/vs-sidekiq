# Screenshot Guide for Sidekiq Manager

This guide will help you capture professional screenshots for the extension's documentation and marketplace listing.

## Prerequisites

1. Run the demo environment:
   ```bash
   chmod +x demo/launch-demo.sh
   ./demo/launch-demo.sh
   ```

2. Connect to the demo server in VS Code (see instructions in the terminal output)

3. Ensure VS Code is in a clean state:
   - Close unnecessary editors
   - Hide minimap if needed (View > Show Minimap)
   - Use a professional theme (Dark+ or Light+ recommended)
   - Set zoom level to 100% (View > Reset Zoom)

## Screenshot Checklist

### 1. Main Sidebar View ⭐ (Hero Screenshot)
**File:** `screenshots/01-sidebar-overview.png`

**What to capture:**
- Click the Sidekiq icon in the Activity Bar
- Show all tree views expanded: Servers, Queues, Workers, Jobs, Cron Jobs
- Make sure demo data is visible in all sections

**Settings:**
- Window size: 1280x800 minimum
- Zoom: 100%
- Theme: Dark+ (or Light+ for marketplace variant)

**Capture:**
- Full window or just the sidebar + editor area
- Highlight: The Sidekiq icon in the Activity Bar

---

### 2. Dashboard View
**File:** `screenshots/02-dashboard.png`

**What to capture:**
- Open the dashboard (Cmd+Shift+P > "Sidekiq: Open Dashboard")
- Show real-time metrics and statistics
- Ensure all metrics are visible (processed, failed, busy, etc.)

**Settings:**
- Full editor area showing the dashboard webview
- Show the metrics updating (if animated)

---

### 3. Queue Management
**File:** `screenshots/03-queue-details.png`

**What to capture:**
- Expand the "Queues" section in sidebar
- Show all demo queues (default, mailers, critical, low_priority, exports)
- Display queue sizes and latencies

**Settings:**
- Focus on the Queues tree view
- Optionally show context menu (right-click on a queue)

---

### 4. Job Details View
**File:** `screenshots/04-job-details.png`

**What to capture:**
- Click on a job in the Jobs section
- Show the job details panel with:
  - Job class name
  - Arguments (formatted JSON)
  - Queue name
  - Created/enqueued timestamps
  - Retry information

**Settings:**
- Split view showing job tree and details panel
- Choose a job with interesting arguments (like PaymentProcessorJob)

---

### 5. Failed Jobs (Retry Queue)
**File:** `screenshots/05-retry-jobs.png`

**What to capture:**
- Expand "Jobs" section
- Show "Retry" category with failed jobs
- Display error messages and retry counts
- Show context menu with "Retry" and "Delete" options

**Settings:**
- Highlight the error message for one job
- Show the retry count badge

---

### 6. Workers Monitoring
**File:** `screenshots/06-workers.png`

**What to capture:**
- Expand "Workers" section
- Show active workers with:
  - Worker names/hostnames
  - Currently processing jobs
  - Queue assignments
  - Busy indicators

**Settings:**
- Show at least 2-3 workers
- Display worker that's currently busy processing a job

---

### 7. Cron Jobs
**File:** `screenshots/07-cron-jobs.png`

**What to capture:**
- Expand "Cron Jobs" section
- Show scheduled jobs with:
  - Cron expressions
  - Next run time
  - Status (enabled/disabled)
  - Job descriptions

**Settings:**
- Show both enabled and disabled jobs
- Highlight the cron expression and next run time

---

### 8. Command Palette
**File:** `screenshots/08-command-palette.png`

**What to capture:**
- Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
- Type "Sidekiq"
- Show all available Sidekiq commands

**Settings:**
- Capture just the command palette dropdown
- Show commands like:
  - Sidekiq: Connect to Server
  - Sidekiq: Open Dashboard
  - Sidekiq: Switch Server
  - Sidekiq: Refresh
  - etc.

---

### 9. Multi-Server Support
**File:** `screenshots/09-server-switching.png`

**What to capture:**
- Add multiple demo servers (repeat connection with different names)
- Show the server selection dropdown (click server in status bar)
- Display multiple environments (Development, Staging, Production)

**Settings:**
- Status bar visible
- Server picker dropdown open

---

### 10. Context Menu Actions
**File:** `screenshots/10-context-menu.png`

**What to capture:**
- Right-click on a failed job
- Show context menu with actions:
  - Retry Job
  - Delete Job
  - View Job Details

**Settings:**
- Clear, centered capture of the context menu
- Choose a visually interesting job (with error info)

---

### 11. Status Bar Integration
**File:** `screenshots/11-status-bar.png`

**What to capture:**
- Bottom status bar showing active Sidekiq connection
- Display server name and connection status
- Show queue/job counts if implemented

**Settings:**
- Zoom in on status bar
- Highlight the Sidekiq status item

---

### 12. Job Selection & Bulk Operations
**File:** `screenshots/12-bulk-operations.png`

**What to capture:**
- Select multiple jobs (Cmd+Click or Shift+Click)
- Show selection indicators
- Display bulk action buttons or context menu

**Settings:**
- At least 3-5 jobs selected
- Show context menu with "Retry Selected" and "Delete Selected"

---

## Screenshot Specifications

### For README.md
- **Format:** PNG
- **Size:** 1280x800 or 1920x1080
- **DPI:** 144 (Retina)
- **Compression:** Optimize with tools like ImageOptim or TinyPNG

### For VS Code Marketplace
- **Hero Image:** 1280x640 (2:1 ratio)
- **Additional Screenshots:** 1280x800 minimum
- **Max File Size:** 1MB per screenshot
- **Format:** PNG or JPEG

## Tools for Screenshots

### macOS
- **Cmd+Shift+4:** Select area to capture
- **Cmd+Shift+4, then Space:** Capture window (includes shadow)
- **Cmd+Shift+5:** Screenshot toolbar with more options

**Tip:** Hold Option while capturing window to exclude shadow

### Windows
- **Win+Shift+S:** Snipping Tool
- **ShareX:** Free advanced screenshot tool

### Linux
- **Spectacle**
- **Flameshot**
- **GNOME Screenshot**

## Post-Processing

1. **Crop & Resize:**
   - Ensure consistent dimensions across screenshots
   - Remove unnecessary UI elements

2. **Annotations (Optional):**
   - Add arrows or highlights for feature callouts
   - Use tools like Skitch, Snagit, or Figma

3. **Optimize:**
   ```bash
   # Using ImageOptim (macOS)
   imageoptim screenshots/*.png

   # Using pngquant (cross-platform)
   pngquant --quality=80-90 screenshots/*.png
   ```

4. **Naming Convention:**
   - Use descriptive names
   - Add numbers for ordering
   - Example: `01-sidebar-overview.png`, `02-dashboard.png`

## Creating an Animated GIF (Optional)

For showcasing dynamic features like real-time updates:

### Using LICEcap (Cross-platform)
1. Download: http://www.cockos.com/licecap/
2. Record the feature in action
3. Keep under 10MB
4. Max 30 seconds duration

### Using ScreenToGif (Windows)
1. Download: https://www.screentogif.com/
2. Record, edit, and optimize
3. Export as GIF

### Example GIF Scenarios:
- **Live metrics updating:** Show numbers changing in dashboard
- **Job retry in action:** Click retry, see job move from failed to queue
- **Real-time queue updates:** Jobs being processed in real-time

## Final Checklist

- [ ] All 12 screenshots captured
- [ ] Consistent theme across screenshots
- [ ] No sensitive data visible
- [ ] Professional appearance (clean, focused)
- [ ] Optimized file sizes (<500KB each)
- [ ] Descriptive file names
- [ ] Organized in `screenshots/` directory
- [ ] Updated README.md with screenshot paths
- [ ] Created hero image for marketplace (if publishing)

## Adding Screenshots to README

Update your README.md:

```markdown
## Screenshots

### Dashboard
![Sidekiq Dashboard](screenshots/02-dashboard.png)

### Queue Management
![Queue Management](screenshots/03-queue-details.png)

### Worker Monitoring
![Worker Monitoring](screenshots/06-workers.png)
```

## Questions?

If you encounter issues with the demo environment or need help capturing specific features, check:
1. Mock server is running: `curl http://localhost:6380/health`
2. Extension is connected to localhost:6380
3. All demo data is loaded (check console output)

Happy screenshotting! 📸
