# Performance Monitoring

This document describes the performance monitoring infrastructure in the Happy app, including all tracked metrics, PostHog events, and dashboard setup guidance.

## Overview

Happy uses PostHog for performance monitoring and analytics. The system tracks:

- **App Startup Time** - Time from JS bundle load to first meaningful render
- **Screen Render Times** - Initial mount and re-render times for each screen
- **Scroll Performance** - Frame times, dropped frames, and jank detection
- **API Latencies** - HTTP request durations with endpoint normalization
- **Resource Usage** - Memory (web only) and JS thread blocking

All metrics are collected with minimal overhead (<1ms) using idle callbacks.

## PostHog Events Reference

### Startup Events

#### `perf_startup`
Fired once when the app completes initial render.

| Property | Type | Description |
|----------|------|-------------|
| `duration_ms` | number | Startup duration in milliseconds |
| `platform` | string | `ios`, `android`, or `web` |
| `is_slow` | boolean | True if duration > 3000ms |

**Dashboard Query Example:**
```sql
SELECT
  avg(properties.$duration_ms) as avg_startup,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY properties.$duration_ms) as p95_startup
FROM events
WHERE event = 'perf_startup'
  AND timestamp > now() - interval '7 days'
GROUP BY date_trunc('day', timestamp)
```

### Screen Render Events

#### `perf_slow_render`
Fired when a screen render exceeds 16ms (60fps threshold).

| Property | Type | Description |
|----------|------|-------------|
| `screen` | string | Screen name (e.g., `SessionView`) |
| `duration_ms` | number | Render duration in milliseconds |
| `severity` | string | `warning` (16-100ms) or `critical` (>100ms) |
| `platform` | string | Platform identifier |

#### `perf_baselines`
Aggregate screen performance, fired periodically or on app background.

| Property | Type | Description |
|----------|------|-------------|
| `{screen}_avg_ms` | number | Average render time per screen |
| `{screen}_max_ms` | number | Maximum render time per screen |
| `screens_tracked` | number | Count of unique screens tracked |
| `platform` | string | Platform identifier |

### Scroll Performance Events

#### `perf_scroll`
Fired during and after scroll sessions on lists.

| Property | Type | Description |
|----------|------|-------------|
| `list_id` | string | List identifier (e.g., `SessionsList`) |
| `avg_frame_time_ms` | number | Average time between scroll frames |
| `max_frame_time_ms` | number | Maximum frame time (jank indicator) |
| `dropped_frames` | number | Count of frames >16ms |
| `dropped_frame_rate` | number | Ratio of dropped frames (0-1) |
| `jank_events` | number | Count of severe jank (>32ms frames) |
| `scroll_distance_px` | number | Total pixels scrolled |
| `scroll_duration_ms` | number | Total scroll session duration |
| `avg_velocity_px_s` | number | Average scroll velocity |
| `sample_count` | number | Number of frame samples |
| `is_final` | boolean | True if this is the session end report |

### API Performance Events (HAP-483)

#### `perf_api_call`
Fired for slow (>1s) or error API requests.

| Property | Type | Description |
|----------|------|-------------|
| `endpoint` | string | Normalized endpoint path (e.g., `/v1/sessions/:id`) |
| `method` | string | HTTP method (`GET`, `POST`, etc.) |
| `duration_ms` | number | Request duration in milliseconds |
| `status` | number | HTTP status code |
| `is_slow` | boolean | True if duration > 1000ms |
| `is_very_slow` | boolean | True if duration > 3000ms |
| `is_error` | boolean | True if status >= 400 |
| `platform` | string | Platform identifier |

#### `perf_api_health`
Aggregate API performance, call `reportApiHealth()` periodically.

| Property | Type | Description |
|----------|------|-------------|
| `avg_duration_ms` | number | Average request duration |
| `max_duration_ms` | number | Maximum request duration |
| `min_duration_ms` | number | Minimum request duration |
| `error_rate` | number | Error rate (0-1) |
| `sample_count` | number | Number of tracked requests |
| `slowest_endpoints` | string[] | Top 5 slowest endpoints with avg times |
| `platform` | string | Platform identifier |

### Resource Monitoring Events

#### `perf_js_blocking`
Fired when the JS thread is blocked for >50ms.

| Property | Type | Description |
|----------|------|-------------|
| `duration_ms` | number | Blocking duration |
| `severity` | string | `warning` (50-200ms) or `critical` (>200ms) |
| `dropped_frames` | number | Estimated dropped frames |
| `platform` | string | Platform identifier |

#### `perf_resource_sample`
Periodic resource usage snapshot (every 30s, web only for memory).

| Property | Type | Description |
|----------|------|-------------|
| `js_heap_used_mb` | number/null | JS heap used (web only) |
| `js_heap_total_mb` | number/null | JS heap total (web only) |
| `memory_growth_percent` | number/null | Memory growth since last sample |
| `sample_count` | number | Total samples collected |
| `platform` | string | Platform identifier |

#### `perf_resource_health`
Summary of resource health, fired on app background.

| Property | Type | Description |
|----------|------|-------------|
| `blocking_events_total` | number | Total blocking events |
| `blocking_events_critical` | number | Critical blocking events |
| `blocking_avg_duration_ms` | number | Average blocking duration |
| `js_heap_used_mb` | number/null | Current heap usage (web) |
| `samples_collected` | number | Total resource samples |

## Usage in Code

### Tracking Screen Renders

```typescript
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

function MyScreen() {
  usePerformanceMonitor('MyScreen');
  return <View>...</View>;
}
```

### Tracking Scroll Performance

```typescript
import { useScrollPerformance } from '@/utils/performance';

function MyList() {
  const onScroll = useScrollPerformance('MyList');
  return <FlatList onScroll={onScroll} />;
}
```

### Tracking API Calls

API calls through `authenticatedFetch` are automatically tracked. For manual tracking:

```typescript
import { trackApiLatency, createApiTimer } from '@/track';

// Option 1: Manual timing
const start = performance.now();
const response = await fetch(url);
trackApiLatency(url, 'GET', performance.now() - start, response.status);

// Option 2: Timer helper
const timer = createApiTimer(url, 'POST');
const response = await fetch(url, { method: 'POST', body });
timer.stop(response.status);
```

### Resource Monitoring

Resource monitoring is initialized automatically in `_layout.tsx`:

```typescript
import { useResourceMonitoring } from '@/utils/performance';

function RootLayout() {
  useResourceMonitoring();
  return <Slot />;
}
```

## PostHog Dashboard Setup

### Recommended Dashboards

#### 1. App Performance Overview
- **Startup P95**: `perf_startup` → P95 of `duration_ms`
- **Slow Render Rate**: `perf_slow_render` count / total sessions
- **API Error Rate**: `perf_api_call` where `is_error = true` / total API calls

#### 2. API Latency Dashboard
- **Latency by Endpoint**: `perf_api_call` grouped by `endpoint`, avg `duration_ms`
- **Slow API Trend**: `perf_api_call` where `is_slow = true`, count over time
- **Error Endpoints**: `perf_api_call` where `is_error = true`, grouped by `endpoint`

#### 3. Scroll Performance Dashboard
- **Jank Rate by List**: `perf_scroll` → `jank_events` / `sample_count` by `list_id`
- **Dropped Frame Distribution**: `perf_scroll` → histogram of `dropped_frame_rate`
- **Worst Performing Lists**: `perf_scroll` → top 5 by `avg_frame_time_ms`

#### 4. Platform Comparison
- All metrics grouped by `platform` to compare iOS/Android/Web performance

### Alert Recommendations

| Alert | Condition | Action |
|-------|-----------|--------|
| High Startup Time | P95 > 5000ms | Investigate bundle size, lazy loading |
| API Error Spike | Error rate > 5% over 5 min | Check backend health |
| Severe Jank | `jank_events` > 10 per session | Profile list rendering |
| Memory Growth | `memory_growth_percent` > 50% | Check for memory leaks |

## Performance Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Startup time | > 3000ms | > 5000ms |
| Screen render | > 16ms | > 100ms |
| Scroll frame time | > 16ms | > 32ms |
| API latency | > 1000ms | > 3000ms |
| JS blocking | > 50ms | > 200ms |

## Related Issues

- HAP-336: Observability - Add performance monitoring and metrics
- HAP-380: Scroll performance monitoring
- HAP-381: JS thread and memory monitoring
- HAP-483: App performance monitoring integration (API latency)
