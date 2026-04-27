package wakeevents

import (
	"context"
	"testing"
	"time"
)

func TestWakeDetection(t *testing.T) {
	mgr := newPlatformManager().(*windowsManager)
	mgr.checkInterval = 10 * time.Millisecond
	mgr.gapThreshold = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	callCount := 0
	mgr.OnWake(func() {
		callCount++
	})

	mgr.Start(ctx)

	// Simulate a gap by manually advancing lastCheck backward
	time.Sleep(50 * time.Millisecond)
	mgr.lastCheck = time.Now().Add(-100 * time.Millisecond)

	// Wait for the next check to detect the gap
	time.Sleep(50 * time.Millisecond)

	if callCount == 0 {
		t.Error("expected wake callback to be called")
	}
}

func TestMultipleCallbacks(t *testing.T) {
	mgr := newPlatformManager().(*windowsManager)
	mgr.checkInterval = 10 * time.Millisecond
	mgr.gapThreshold = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	callCount := 0
	cb1 := func() { callCount++ }
	cb2 := func() { callCount++ }

	mgr.OnWake(cb1)
	mgr.OnWake(cb2)

	mgr.Start(ctx)

	// Simulate a gap
	time.Sleep(50 * time.Millisecond)
	mgr.lastCheck = time.Now().Add(-100 * time.Millisecond)

	// Wait for detection
	time.Sleep(50 * time.Millisecond)

	if callCount != 2 {
		t.Errorf("expected 2 callbacks, got %d", callCount)
	}
}
