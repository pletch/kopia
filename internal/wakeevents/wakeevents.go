// Package wakeevents detects when the system wakes from sleep and notifies registered callbacks.
//
// The detection uses gap-based analysis: by checking elapsed time between periodic checks,
// it can detect when execution was paused (suspended/hibernated). This approach works
// universally across Windows, macOS, and Linux without requiring OS-specific APIs or permissions.
//
// Detection latency: ~15 seconds (the check interval). When a gap > 20 seconds is detected,
// all registered listeners are invoked in separate goroutines.
package wakeevents

import "context"

// Listener is a callback invoked when the system wakes from sleep.
type Listener func()

// Manager manages system sleep/wake event detection.
type Manager interface {
	// Start begins monitoring for wake events. Must be called before callbacks will fire.
	Start(ctx context.Context)
	// OnWake registers a callback to be called when the system wakes from sleep.
	OnWake(callback Listener)
	// Stop terminates monitoring.
	Stop()
}

// New creates a new Manager for the current platform.
func New() Manager {
	return newPlatformManager()
}
