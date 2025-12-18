/**
 * Performance Monitoring Utilities
 *
 * Lightweight performance tracking for startup time, screen renders, and slow operations.
 * Designed to have minimal overhead (<1ms) by using idle callbacks for reporting.
 *
 * Key metrics tracked:
 * - App startup time (JS bundle to first render)
 * - Screen render times
 * - Slow renders (>16ms, which miss 60fps)
 *
 * HAP-336: Observability - Add performance monitoring and metrics
 */

import * as React from 'react';
import { Platform, InteractionManager } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { tracking } from '@/track/tracking';

// Performance thresholds (ms)
const SLOW_RENDER_THRESHOLD = 16; // 60fps = ~16ms per frame
const VERY_SLOW_RENDER_THRESHOLD = 100;
const STARTUP_THRESHOLD_WARN = 3000;

// Module-level state for startup tracking
let appStartTime: number | null = null;
let firstRenderTime: number | null = null;
let startupTracked = false;

// Store recent render metrics for baselines
interface RenderMetric {
    screen: string;
    duration: number;
    timestamp: number;
}

const renderMetrics: RenderMetric[] = [];
const MAX_METRICS_STORED = 100;

/**
 * Mark the start of app initialization.
 * Call this as early as possible in the app lifecycle.
 */
export function markAppStart(): void {
    if (appStartTime === null) {
        appStartTime = performance.now();
    }
}

/**
 * Mark the first meaningful render.
 * Call this when the main UI is visible.
 */
export function markFirstRender(): void {
    if (firstRenderTime === null && appStartTime !== null) {
        firstRenderTime = performance.now();
        trackStartupTime();
    }
}

/**
 * Track startup time to analytics
 */
function trackStartupTime(): void {
    if (startupTracked || appStartTime === null || firstRenderTime === null) {
        return;
    }

    startupTracked = true;
    const startupDuration = firstRenderTime - appStartTime;

    // Report via idle callback to avoid blocking
    scheduleIdleReport(() => {
        const properties = {
            duration_ms: Math.round(startupDuration),
            platform: Platform.OS,
            is_slow: startupDuration > STARTUP_THRESHOLD_WARN,
        };

        tracking?.capture('perf_startup', properties);

        // Also log for debugging
        const status = startupDuration > STARTUP_THRESHOLD_WARN ? 'SLOW' : 'OK';
        console.log(`[Performance] Startup: ${Math.round(startupDuration)}ms (${status})`);
    });
}

/**
 * Get the current startup duration (for display purposes)
 */
export function getStartupDuration(): number | null {
    if (appStartTime === null || firstRenderTime === null) {
        return null;
    }
    return Math.round(firstRenderTime - appStartTime);
}

/**
 * Track a screen render time
 */
export function trackScreenRender(screen: string, duration: number): void {
    // Store for baseline calculations
    const metric: RenderMetric = {
        screen,
        duration,
        timestamp: Date.now(),
    };
    renderMetrics.push(metric);

    // Keep only recent metrics
    if (renderMetrics.length > MAX_METRICS_STORED) {
        renderMetrics.shift();
    }

    // Report slow renders immediately, others via idle callback
    if (duration > SLOW_RENDER_THRESHOLD) {
        reportSlowRender(screen, duration);
    }
}

/**
 * Report a slow render to analytics
 */
function reportSlowRender(screen: string, duration: number): void {
    const severity = duration > VERY_SLOW_RENDER_THRESHOLD ? 'critical' : 'warning';

    scheduleIdleReport(() => {
        tracking?.capture('perf_slow_render', {
            screen,
            duration_ms: Math.round(duration),
            severity,
            platform: Platform.OS,
        });

        console.warn(`[Performance] Slow render on ${screen}: ${Math.round(duration)}ms (${severity})`);
    });
}

/**
 * Get baseline metrics for a specific screen
 */
export function getScreenBaseline(screen: string): {
    avgDuration: number;
    maxDuration: number;
    sampleCount: number;
} | null {
    const screenMetrics = renderMetrics.filter(m => m.screen === screen);

    if (screenMetrics.length === 0) {
        return null;
    }

    const durations = screenMetrics.map(m => m.duration);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const max = Math.max(...durations);

    return {
        avgDuration: Math.round(avg),
        maxDuration: Math.round(max),
        sampleCount: screenMetrics.length,
    };
}

/**
 * Get all screen baselines for dashboard display
 */
export function getAllScreenBaselines(): Map<string, ReturnType<typeof getScreenBaseline>> {
    const screens = new Set(renderMetrics.map(m => m.screen));
    const baselines = new Map<string, ReturnType<typeof getScreenBaseline>>();

    for (const screen of screens) {
        baselines.set(screen, getScreenBaseline(screen));
    }

    return baselines;
}

/**
 * Log current baselines to console (for debugging)
 */
export function logBaselines(): void {
    const baselines = getAllScreenBaselines();

    console.log('[Performance] Screen Baselines:');
    baselines.forEach((baseline, screen) => {
        if (baseline) {
            console.log(`  ${screen}: avg=${baseline.avgDuration}ms, max=${baseline.maxDuration}ms (n=${baseline.sampleCount})`);
        }
    });
}

/**
 * Create a timer for measuring operations
 */
export function createTimer(label: string): {
    stop: () => number;
    elapsed: () => number;
} {
    const start = performance.now();

    return {
        stop: () => {
            const duration = performance.now() - start;
            console.log(`[Performance] ${label}: ${Math.round(duration)}ms`);
            return duration;
        },
        elapsed: () => performance.now() - start,
    };
}

/**
 * Schedule a callback to run during idle time
 * Falls back to setTimeout on platforms without requestIdleCallback
 */
function scheduleIdleReport(callback: () => void): void {
    // Use InteractionManager on native for better performance
    if (Platform.OS !== 'web') {
        InteractionManager.runAfterInteractions(callback);
        return;
    }

    // Use requestIdleCallback on web if available
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 1000 });
    } else {
        setTimeout(callback, 0);
    }
}

/**
 * Report all current baselines to analytics (call periodically or on app background)
 */
export function reportBaselines(): void {
    const baselines = getAllScreenBaselines();

    if (baselines.size === 0) {
        return;
    }

    scheduleIdleReport(() => {
        const report: Record<string, number> = {};
        baselines.forEach((baseline, screen) => {
            if (baseline) {
                report[`${screen}_avg_ms`] = baseline.avgDuration;
                report[`${screen}_max_ms`] = baseline.maxDuration;
            }
        });

        tracking?.capture('perf_baselines', {
            ...report,
            screens_tracked: baselines.size,
            platform: Platform.OS,
        });

        console.log('[Performance] Baselines reported to analytics');
    });
}

// ============================================================================
// Scroll Performance Monitoring (HAP-380)
// ============================================================================

// Scroll performance thresholds
const SCROLL_FRAME_THRESHOLD = 16; // 60fps target - 16.67ms per frame
const SCROLL_JANK_THRESHOLD = 32; // 2+ dropped frames = jank
const SCROLL_REPORT_INTERVAL = 5000; // Report every 5 seconds of scrolling
const MIN_SCROLL_SAMPLES = 10; // Minimum samples before reporting

/**
 * Scroll metrics for a single scroll session
 */
interface ScrollMetrics {
    listId: string;
    startTime: number;
    lastEventTime: number;
    frameTimes: number[];
    droppedFrames: number;
    jankEvents: number;
    totalScrollDistance: number;
    lastContentOffset: number;
    reportedAt: number;
}

// Active scroll sessions by list ID
const activeScrollSessions = new Map<string, ScrollMetrics>();

/**
 * Create a scroll performance tracker for a specific list.
 * Returns an onScroll handler to attach to FlatList.
 *
 * @param listId - Unique identifier for the list (e.g., 'SessionsList', 'ChatList')
 * @returns Object with onScroll handler and cleanup function
 *
 * @example
 * const scrollTracker = createScrollTracker('SessionsList');
 * <FlatList onScroll={scrollTracker.onScroll} />
 * // On unmount: scrollTracker.cleanup();
 */
export function createScrollTracker(listId: string): {
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    cleanup: () => void;
} {
    const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const now = performance.now();
        const { contentOffset } = event.nativeEvent;
        const currentOffset = contentOffset.y;

        let metrics = activeScrollSessions.get(listId);

        if (!metrics) {
            // Start new scroll session
            metrics = {
                listId,
                startTime: now,
                lastEventTime: now,
                frameTimes: [],
                droppedFrames: 0,
                jankEvents: 0,
                totalScrollDistance: 0,
                lastContentOffset: currentOffset,
                reportedAt: now,
            };
            activeScrollSessions.set(listId, metrics);
            return;
        }

        // Calculate frame time since last scroll event
        const frameTime = now - metrics.lastEventTime;
        metrics.lastEventTime = now;

        // Only track frame times during active scrolling (not when momentum settles)
        if (frameTime < 200) {
            metrics.frameTimes.push(frameTime);

            // Detect dropped frames
            if (frameTime > SCROLL_FRAME_THRESHOLD) {
                metrics.droppedFrames++;

                // Detect significant jank (2+ dropped frames)
                if (frameTime > SCROLL_JANK_THRESHOLD) {
                    metrics.jankEvents++;
                }
            }
        }

        // Track scroll distance
        const scrollDelta = Math.abs(currentOffset - metrics.lastContentOffset);
        metrics.totalScrollDistance += scrollDelta;
        metrics.lastContentOffset = currentOffset;

        // Report periodically during active scroll
        if (now - metrics.reportedAt > SCROLL_REPORT_INTERVAL) {
            reportScrollMetrics(metrics, false);
            metrics.reportedAt = now;
        }
    };

    const cleanup = () => {
        const metrics = activeScrollSessions.get(listId);
        if (metrics && metrics.frameTimes.length >= MIN_SCROLL_SAMPLES) {
            reportScrollMetrics(metrics, true);
        }
        activeScrollSessions.delete(listId);
    };

    return { onScroll, cleanup };
}

/**
 * Report scroll performance metrics to analytics
 */
function reportScrollMetrics(metrics: ScrollMetrics, isFinal: boolean): void {
    if (metrics.frameTimes.length < MIN_SCROLL_SAMPLES) {
        return;
    }

    const avgFrameTime = metrics.frameTimes.reduce((a, b) => a + b, 0) / metrics.frameTimes.length;
    const maxFrameTime = Math.max(...metrics.frameTimes);
    const scrollDuration = metrics.lastEventTime - metrics.startTime;
    const droppedFrameRate = metrics.droppedFrames / metrics.frameTimes.length;

    // Calculate velocity (pixels per second)
    const avgVelocity = scrollDuration > 0
        ? (metrics.totalScrollDistance / scrollDuration) * 1000
        : 0;

    scheduleIdleReport(() => {
        const properties = {
            list_id: metrics.listId,
            avg_frame_time_ms: Math.round(avgFrameTime * 10) / 10,
            max_frame_time_ms: Math.round(maxFrameTime),
            dropped_frames: metrics.droppedFrames,
            dropped_frame_rate: Math.round(droppedFrameRate * 100) / 100,
            jank_events: metrics.jankEvents,
            scroll_distance_px: Math.round(metrics.totalScrollDistance),
            scroll_duration_ms: Math.round(scrollDuration),
            avg_velocity_px_s: Math.round(avgVelocity),
            sample_count: metrics.frameTimes.length,
            is_final: isFinal,
            platform: Platform.OS,
        };

        tracking?.capture('perf_scroll', properties);

        // Log jank for debugging
        if (metrics.jankEvents > 0 || droppedFrameRate > 0.1) {
            console.warn(
                `[Performance] Scroll jank on ${metrics.listId}: ` +
                `${metrics.jankEvents} jank events, ` +
                `${Math.round(droppedFrameRate * 100)}% frames dropped, ` +
                `avg ${Math.round(avgFrameTime)}ms/frame`
            );
        }
    });

    // Reset frame times for next reporting period (but keep session alive)
    if (!isFinal) {
        metrics.frameTimes = [];
        metrics.droppedFrames = 0;
        metrics.jankEvents = 0;
    }
}

/**
 * React hook for scroll performance monitoring.
 * Automatically cleans up on unmount.
 *
 * @param listId - Unique identifier for the list
 * @returns onScroll handler to attach to FlatList
 *
 * @example
 * const onScroll = useScrollPerformance('SessionsList');
 * <FlatList onScroll={onScroll} />
 */
export function useScrollPerformance(
    listId: string
): (event: NativeSyntheticEvent<NativeScrollEvent>) => void {
    const trackerRef = React.useRef<ReturnType<typeof createScrollTracker> | null>(null);

    if (!trackerRef.current) {
        trackerRef.current = createScrollTracker(listId);
    }

    React.useEffect(() => {
        return () => {
            trackerRef.current?.cleanup();
        };
    }, [listId]);

    return trackerRef.current.onScroll;
}
