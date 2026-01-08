/* oxlint-disable no-console */
/**
 * Simple remote logger for React Native
 * Patches console to send logs to remote server
 *
 * ONLY ENABLE IN LOCAL BUILD
 * PRIMARILY FOR AI AUTO DEBUGGING
 */

import { config } from '@/config';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';


let logBuffer: any[] = []
let currentBufferBytes = 0
const MAX_BUFFER_SIZE = 1000
const MAX_BUFFER_BYTES = 5 * 1024 * 1024 // 5MB - prevent memory bloat from large log entries

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

  const sendLog = async (level: string, args: any[]) => {
    try {
      await fetchWithTimeout(url + '/logs-combined-from-cli-and-mobile-for-simple-ai-debugging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message: args.map(a =>
            typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
          ).join('\n'),
          messageRawObject: args,
          source: 'mobile',
          platform: 'ios', // or android
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