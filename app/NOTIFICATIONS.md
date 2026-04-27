# KopiaUI Notification System

## Overview

KopiaUI now includes a comprehensive notification system that alerts users when critical processes (like snapshots) fail or encounter issues. Notifications are displayed through multiple channels:

1. **Toast Notifications** (Primary) - Desktop popups visible to the user immediately
2. **Tray Tooltip** (Secondary) - Status updates in the system tray tooltip
3. **Log Messages** (Audit) - Detailed logs for troubleshooting

## Notification Levels

Users can configure notification verbosity through three levels:

- **Disabled (0)**: No notifications shown
- **Warnings & Errors (1)** *(Default)*: Only show warnings and errors
- **All (2)**: Show all notifications including informational messages

Configuration is stored in `~/.config/kopia/notifications.json`.

## Notification Cooldown (Spam Prevention)

To prevent notification fatigue during extended outages, error notifications are subject to a **30-minute cooldown** per source:

- **First failure** → Notification shown immediately
- **Subsequent failures (same source)** → Toast suppressed, but tray tooltip updated
- **After 30 minutes** → Next failure shows notification again

**Example:** If a snapshot fails, the user sees a notification. If retries continue to fail over the next 30 minutes, the user won't see additional toasts, but the tray will remain updated with the latest error. After 30 minutes, if it fails again, a fresh notification appears.

This prevents:
- ❌ One notification per 5-minute retry cycle (6+ per hour)
- ✅ One notification per ~30 minute window, even with continuous failures
- ✅ Maximum one notification per day if network is down 24 hours

## Notification Types

Notifications are categorized by severity:

### Error (Critical)
- Snapshot failures
- Connection/network errors
- Repository access issues
- **Displayed as**: Toast with "critical" urgency, red emphasis
- **Tray tooltip**: Shows error message for 15 seconds

### Warning
- Retrying failed operations
- Slow/degraded performance
- Configuration issues
- **Displayed as**: Toast with "normal" urgency
- **Tray tooltip**: Shows warning for 7 seconds

### Info
- Snapshot completed
- Connection established
- Status updates
- **Displayed as**: Toast with "low" urgency
- **Tray tooltip**: Only if updating status

## Implementation Architecture

### Server Side (Go)
The Kopia server sends notifications as JSON via stderr when started with `--kopiaui-notifications` flag:

```
NOTIFICATION: {"type":"error","title":"Snapshot Failed","description":"Failed to backup Documents: Connection lost after wake"}
```

### Client Side (Electron)

#### 1. **server.js** - Receives notifications from Go backend
- Parses notification JSON from server stderr
- Emits `repo-notification-event` IPC event

#### 2. **notifications.js** - Manages notification display
- `showNotification(notification, options)` - Displays toast and updates tray
- `initializeNotifications(tray, icons)` - Initialize with tray reference
- `resetTrayStatusAfterDelay(ms)` - Reset tray tooltip after timeout
- Respects user's notification level settings

#### 3. **electron.js** - Main process integration
- Initializes notification system after tray creation
- Listens for `repo-notification-event` from repository servers
- Displays toast and updates tray tooltip

## Usage Example

When a snapshot fails during system sleep/wake reconnection:

1. **Server detects failure** → Sends notification JSON
2. **server.js parses** → Emits IPC event  
3. **electron.js listener** → Calls `showNotification()`
4. **Tray tooltip updated** → Shows "Snapshot failed: Connection lost"
5. **Toast appears** → User sees notification immediately
6. **Buttons available** → "View Details" / "Dismiss" actions

## Cross-Platform Behavior

### Windows
- Toast notifications use Windows 10/11 notification center
- Tray in notification area (bottom-right)
- Icon changes/tooltips work seamlessly

### macOS
- Toast notifications use native macOS notifications
- Tray (menu bar) on top-right
- Subtle presentation (macOS design convention)

### Linux
- Toast notifications use D-Bus (freedesktop standard)
- Tray in system tray (varies by desktop environment)
- Support depends on notification daemon availability

## Future Enhancements

### Optional: Colored Tray Icons
To add colored error/warning icons in the tray, create:

```
resources/win/icons/kopia-tray-error.ico
resources/win/icons/kopia-tray-warning.ico
resources/linux/icons/kopia-tray-error.png
resources/linux/icons/kopia-tray-warning.png
```

Then update `electron.js` to use the actual icon paths instead of fallback.

### How Cooldown Works

**notifications.js exports:**
- `clearNotificationCooldown(sourceKey)` - Reset cooldown for a source (use when network recovers)
- `getNotificationCooldownStatus()` - Debug helper to see current cooldown states

**electron.js can call these when:**
- Network connection is successfully re-established
- User manually retries a failed operation
- System wakes from sleep (with wake detection)

Example:
```javascript
// When connection is restored
clearNotificationCooldown('Snapshot-Documents');

// Or clear all
clearNotificationCooldown();

// Debug: check current cooldowns
const status = getNotificationCooldownStatus();
// Returns: {
//   "Snapshot-Documents": {
//     lastNotificationTime: "2026-04-27T13:45:00.000Z",
//     minutesRemaining: 22
//   }
// }
```

### Optional: Notification Actions
The current implementation supports button actions in toast notifications:

```javascript
actions: [
  { type: 'button', text: 'View Details' },
  { type: 'button', text: 'Retry' }
]
```

These can be expanded with custom handlers in electron.js to trigger manual retries or clear cooldowns.

### Optional: Persistent Failure Tracking
Add a failure log UI that shows:
- Recent failures with timestamps
- Retry status and counts
- Manual retry buttons

## Testing

### Manual Testing

1. **Trigger a notification from server:**
   ```bash
   # In server code, emit a notification JSON to stderr
   ```

2. **Verify toast appears** with correct severity level
3. **Check tray tooltip** updates correctly
4. **Verify timeout** resets tooltip after appropriate delay
5. **Test all levels** by changing `notifications.json` level

### Automated Testing

Test infrastructure exists in `tests/main.spec.js`:
- Mock server notifications
- Verify `repo-notification-event` emission
- Validate notification display logic

## Configuration

**File:** `~/.config/kopia/notifications.json`

```json
{
  "level": 1
}
```

**Levels:**
- `0` = Disabled
- `1` = Warnings & Errors (default)
- `2` = All

Can be changed through KopiaUI settings (when implemented).
