/* oxlint-disable no-console */
/**
 * Simple remote logger for React Native
 * Patches console to send logs to remote server
 *
 * ONLY ENABLE IN LOCAL BUILD
 * PRIMARILY FOR AI AUTO DEBUGGING
 *
 * PRODUCTION GUARDRAILS (HAP-836):
 * - Remote logging is ONLY allowed in development builds (__DEV__ === true)
 * - Remote logging is ONLY allowed to local/dev server URLs
 * - Any violation results in a clear console warning
 */

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { config } from '@/config';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import { redactArgs } from '@/utils/logger';

/**
 * Allowlist of URL patterns for remote logging.
 * Only these patterns are allowed to receive remote logs.
 */
const ALLOWED_DEV_URL_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?/i,
  /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?/i,        // Private 10.x.x.x
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?/i,       // Private 192.168.x.x
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?/i, // Private 172.16-31.x.x
  /^https?:\/\/\[::1\](:\d+)?/i,                  // IPv6 localhost
];

/**
 * Checks if a URL is allowed for remote logging.
 * Only local/dev URLs are permitted to prevent accidental production logging.
 */
function isAllowedDevUrl(url: string): boolean {
  return ALLOWED_DEV_URL_PATTERNS.some(pattern => pattern.test(url));
}

let logBuffer: any[] = []
let currentBufferBytes = 0
const MAX_BUFFER_SIZE = 1000
const MAX_BUFFER_BYTES = 5 * 1024 * 1024 // 5MB - prevent memory bloat from large log entries

// Idempotency guard: ensure console is only patched once per app lifecycle
// This prevents duplicate logs and nested patches during HMR or re-mounts
let isPatched = false

function estimateEntrySize(entry: any): number {
  try {
    return JSON.stringify(entry).length
  } catch {
    return 1000 // fallback estimate for circular references
  }
}

export function monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds() {
  // NEVER ENABLE REMOTE LOGGING IN PRODUCTION
  // This is for local debugging with AI only
  // So AI will have all the logs easily accessible in one file for analysis
  if (!process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    return
  }

  // HAP-836: Production guardrail - only allow remote logging in development builds
  if (!__DEV__) {
    console.warn(
      '[RemoteLogger] BLOCKED: Remote logging is only allowed in development builds (__DEV__ must be true). ' +
      'This is a safety guardrail to prevent accidental production logging. ' +
      'Remove EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING from your production environment.'
    );
    return;
  }

  // Idempotency: skip if already patched (prevents duplicate logs during HMR/re-mounts)
  if (isPatched) {
    return
  }
  isPatched = true

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }

  const url = config.serverUrl

  if (!url) {
    console.log('[RemoteLogger] No server URL provided, remote logging disabled')
    return
  }

  // HAP-836: Production guardrail - only allow local/dev server URLs
  if (!isAllowedDevUrl(url)) {
    console.warn(
      `[RemoteLogger] BLOCKED: Server URL "${url}" is not a local/dev URL. ` +
      'Remote logging is only allowed to localhost, 127.0.0.1, or private network addresses (10.x.x.x, 192.168.x.x, 172.16-31.x.x). ' +
      'This is a safety guardrail to prevent accidental logging to production servers.'
    );
    return;
  }

  const sendLog = async (level: string, args: any[]) => {
    try {
      // HAP-838: Redact sensitive data before sending to remote server
      // This prevents tokens, keys, and credentials from being logged remotely
      const redactedArgs = redactArgs(args);

      await fetchWithTimeout(url + '/logs-combined-from-cli-and-mobile-for-simple-ai-debugging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message: redactedArgs.map(a =>
            typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
          ).join('\n'),
          messageRawObject: redactedArgs,
          source: 'mobile',
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version ?? null,
          buildNumber: Application.nativeBuildVersion ?? null,
        }),
        timeoutMs: 5000, // 5s - logger should not block app
      })
    } catch {
      // Remote logging is optional - silently ignore failures
    }
  }

  // Patch console methods
  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    console[level] = (...args: any[]) => {
      // Always call original
      originalConsole[level](...args)
      
      // Buffer for developer settings
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message: args
      }
      const entrySize = estimateEntrySize(entry)

      // Evict oldest entries until we're under the byte limit
      while (currentBufferBytes + entrySize > MAX_BUFFER_BYTES && logBuffer.length > 0) {
        const removed = logBuffer.shift()
        if (removed) {
          currentBufferBytes -= estimateEntrySize(removed)
        }
      }

      logBuffer.push(entry)
      currentBufferBytes += entrySize

      // Secondary count-based safety limit
      if (logBuffer.length > MAX_BUFFER_SIZE) {
        const removed = logBuffer.shift()
        if (removed) {
          currentBufferBytes -= estimateEntrySize(removed)
        }
      }

      // Send to remote
      sendLog(level, args)
    }
  })

  console.log('[RemoteLogger] Initialized with server:', url)
}

// For developer settings UI
export function getLogBuffer() {
  return [...logBuffer]
}

export function clearLogBuffer() {
  logBuffer = []
  currentBufferBytes = 0
}