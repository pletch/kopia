import { ipcMain, Notification } from "electron";
import { configDir } from "./config.js";
import log from "electron-log";

const path = await import("path");
const fs = await import("fs");

export const LevelDisabled = 0;
export const LevelWarningsAndErrors = 1;
export const LevelAll = 2;

let level = -1;
let tray = null;
let trayIcons = null;

// Track recent failure notifications to prevent spam
// Maps: "sourceKey" -> timestamp of last notification
let lastFailureNotification = {};

// Cooldown period before showing the same error again (30 minutes)
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Initialize notification system with tray reference and icon paths
 * @param {Tray} trayInstance - Electron Tray instance
 * @param {Object} icons - Object with icon paths: { normal: '...', error: '...', warning: '...' }
 */
export function initializeNotifications(trayInstance, icons) {
  tray = trayInstance;
  trayIcons = icons;
}

export function getNotificationLevel() {
  if (level === -1) {
    try {
      const cfg = fs.readFileSync(path.join(configDir(), "notifications.json"));
      return JSON.parse(cfg).level;
    } catch (e) {
      level = LevelWarningsAndErrors;
    }
  }

  return level;
}

export function setNotificationLevel(l) {
  level = l;
  if (level < LevelDisabled || level > LevelAll) {
    level = LevelWarningsAndErrors;
  }

  fs.writeFileSync(
    path.join(configDir(), "notifications.json"),
    JSON.stringify({ level: l }),
  );

  ipcMain.emit("notification-config-updated");
}

/**
 * Determines if a notification should be shown based on type and level
 * @param {string} type - Notification type (e.g., 'error', 'warning', 'info')
 * @returns {boolean} - Whether to show the notification
 */
function shouldShowNotification(type) {
  const currentLevel = getNotificationLevel();

  if (currentLevel === LevelDisabled) {
    return false;
  }

  if (currentLevel === LevelAll) {
    return true;
  }

  // LevelWarningsAndErrors
  return type === "error" || type === "warning";
}

/**
 * Map notification types to severity levels for Electron
 * @param {string} type - Notification type
 * @returns {string} - Electron urgency level
 */
function getUrgencyLevel(type) {
  switch (type) {
    case "error":
      return "critical";
    case "warning":
      return "normal";
    default:
      return "low";
  }
}

/**
 * Update tray icon based on status
 * @param {string} status - Status: 'normal', 'warning', 'error'
 * @param {string} tooltip - Tooltip text
 */
function updateTrayStatus(status, tooltip) {
  if (!tray) {
    return;
  }

  try {
    // Only update tooltip; icon changes are minimal so we keep the normal icon
    // This avoids needing separate error/warning icon files
    tray.setToolTip(tooltip || "KopiaUI - Click to manage backups");
  } catch (e) {
    log.warn("Failed to update tray status:", e);
  }
}

/**
 * Check if enough time has passed since last failure notification for this source
 * @param {string} sourceKey - Unique identifier for the notification source (e.g., repository name)
 * @returns {boolean} - True if cooldown has expired and we should show the notification
 */
function isNotificationCooldownExpired(sourceKey) {
  if (!sourceKey) {
    return true; // No source key, always show
  }

  const lastTime = lastFailureNotification[sourceKey] || 0;
  const now = Date.now();
  const timeSinceLastNotification = now - lastTime;

  return timeSinceLastNotification >= NOTIFICATION_COOLDOWN_MS;
}

/**
 * Record that we showed a notification for this source
 * @param {string} sourceKey - Unique identifier for the notification source
 */
function recordNotificationShown(sourceKey) {
  if (sourceKey) {
    lastFailureNotification[sourceKey] = Date.now();
  }
}

/**
 * Show a desktop notification and optionally update tray
 * @param {Object} notification - Notification object from server
 *   { type: 'error'|'warning'|'info', title: string, description?: string, source?: string }
 * @param {Object} options - Additional options
 *   { updateTray?: boolean }
 */
export function showNotification(notification, options = {}) {
  if (!shouldShowNotification(notification.type)) {
    return;
  }

  // For errors, check cooldown to prevent spam on repeated failures
  if (notification.type === "error") {
    const sourceKey = notification.source || notification.title || "unknown";

    if (!isNotificationCooldownExpired(sourceKey)) {
      const timeSinceLastNotification =
        Date.now() - (lastFailureNotification[sourceKey] || 0);
      const minutesUntilNextNotification = Math.ceil(
        (NOTIFICATION_COOLDOWN_MS - timeSinceLastNotification) / 60000,
      );

      log.info(
        `Suppressing duplicate error notification for "${sourceKey}" (${minutesUntilNextNotification} min cooldown remaining): ${notification.title}`,
      );

      // Still update tray with the latest error, but don't show toast
      if (options.updateTray) {
        const body =
          notification.description ||
          notification.message ||
          "An event occurred in your backup";
        updateTrayStatus(
          notification.type,
          `${notification.title}: ${body.substring(0, 50)}...`,
        );
      }

      return;
    }

    recordNotificationShown(sourceKey);
  }

  const title = notification.title || "KopiaUI Notification";
  const body =
    notification.description ||
    notification.message ||
    "An event occurred in your backup";
  const urgency = getUrgencyLevel(notification.type);

  try {
    const notif = new Notification({
      title: title,
      body: body,
      icon:
        notification.type === "error"
          ? trayIcons?.error
          : notification.type === "warning"
            ? trayIcons?.warning
            : undefined,
      urgency: urgency,
      silent: false,
      actions:
        notification.type === "error"
          ? [
              { type: "button", text: "View Details" },
              { type: "button", text: "Dismiss" },
            ]
          : undefined,
    });

    // Track action responses if applicable
    notif.on("action", (action) => {
      log.info(`Notification action: ${action}`);
      ipcMain.emit("notification-action", {
        notificationId: notification.id || Date.now(),
        action: action,
      });
    });

    notif.show();

    // Update tray if requested or if it's an error
    if (options.updateTray || notification.type === "error") {
      updateTrayStatus(
        notification.type,
        `${title}: ${body.substring(0, 50)}...`,
      );
    }

    log.info(
      `Notification shown: ${notification.type} - ${title}`,
      notification,
    );
  } catch (e) {
    log.warn("Failed to show notification:", e);
  }
}

/**
 * Reset tray icon to normal state after a timeout
 * @param {number} delayMs - Delay in milliseconds before reset
 */
export function resetTrayStatusAfterDelay(delayMs = 5000) {
  setTimeout(() => {
    if (tray && trayIcons) {
      tray.setImage(trayIcons.normal);
      tray.setToolTip("KopiaUI - Click to manage backups");
    }
  }, delayMs);
}

/**
 * Clear notification cooldown for a specific source (e.g., when network recovers)
 * This allows the next failure for that source to show a notification immediately
 * @param {string} sourceKey - Source to clear cooldown for, or undefined to clear all
 */
export function clearNotificationCooldown(sourceKey) {
  if (sourceKey) {
    delete lastFailureNotification[sourceKey];
    log.info(`Cleared notification cooldown for: ${sourceKey}`);
  } else {
    lastFailureNotification = {};
    log.info("Cleared all notification cooldowns");
  }
}

/**
 * Get information about current notification cooldowns (for debugging)
 * @returns {Object} - Map of source keys to time remaining in cooldown (ms)
 */
export function getNotificationCooldownStatus() {
  const status = {};
  const now = Date.now();

  for (const [source, lastTime] of Object.entries(lastFailureNotification)) {
    const timeRemaining = NOTIFICATION_COOLDOWN_MS - (now - lastTime);
    status[source] = {
      lastNotificationTime: new Date(lastTime).toISOString(),
      minutesRemaining: Math.ceil(Math.max(0, timeRemaining) / 60000),
    };
  }

  return status;
}
