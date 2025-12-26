/**
 * Message Reducer for Real-time Sync System
 * 
 * This reducer is the core message processing engine that transforms raw messages from
 * the sync system into a structured, deduplicated message history. It handles complex
 * scenarios including tool permissions, sidechains, and message deduplication.
 * 
 * ## Core Responsibilities:
 * 
 * 1. **Message Deduplication**: Prevents duplicate messages using multiple tracking mechanisms:
 *    - localId tracking for user messages
 *    - messageId tracking for all messages
 *    - Permission ID tracking for tool permissions
 * 
 * 2. **Tool Permission Management**: Integrates with AgentState to handle tool permissions:
 *    - Creates placeholder messages for pending permission requests
 *    - Updates permission status (pending → approved/denied/canceled)
 *    - Matches incoming tool calls to approved permissions
 *    - Prioritizes tool calls over permissions when both exist
 * 
 * 3. **Tool Call Lifecycle**: Manages the complete lifecycle of tool calls:
 *    - Creation from permission requests or direct tool calls
 *    - Matching tool calls to existing permission messages
 *    - Processing tool results and updating states
 *    - Handling errors and completion states
 * 
 * 4. **Sidechain Processing**: Handles nested conversation branches (sidechains):
 *    - Identifies sidechain messages using the tracer
 *    - Stores sidechain messages separately
 *    - Links sidechains to their parent tool calls
 * 
 * ## Processing Phases:
 * 
 * The reducer processes messages in a specific order to ensure correct behavior:
 * 
 * **Phase 0: AgentState Permissions**
 *   - Processes pending and completed permission requests
 *   - Creates tool messages for permissions
 *   - Skips completed permissions if matching tool call (same name AND arguments) exists in incoming messages
 *   - Phase 2 will handle matching tool calls to existing permission messages
 * 
 * **Phase 0.5: Message-to-Event Conversion**
 *   - Parses messages to check if they should be converted to events
 *   - Converts matching messages to events immediately
 *   - Converted messages skip all subsequent processing phases
 *   - Supports user commands, tool results, and metadata-driven conversions
 * 
 * **Phase 1: User and Text Messages**
 *   - Processes user messages with deduplication
 *   - Processes agent text messages
 *   - Skips tool calls for later phases
 * 
 * **Phase 2: Tool Calls**
 *   - Processes incoming tool calls from agents
 *   - Matches to existing permission messages when possible
 *   - Creates new tool messages when no match exists
 *   - Prioritizes newest permission when multiple matches
 * 
 * **Phase 3: Tool Results**
 *   - Updates tool messages with results
 *   - Sets completion or error states
 *   - Updates completion timestamps
 * 
 * **Phase 4: Sidechains**
 *   - Processes sidechain messages separately
 *   - Stores in sidechain map linked to parent tool
 *   - Handles nested tool calls within sidechains
 * 
 * **Phase 5: Mode Switch Events**
 *   - Processes agent event messages
 *   - Handles mode changes and other events
 * 
 * ## Key Behaviors:
 *
 * - **Idempotency**: Calling the reducer multiple times with the same data produces no duplicates
 * - **Priority Rules**: When both tool calls and permissions exist, tool calls take priority
 * - **Argument Matching**: Tool calls match to permissions based on both name AND arguments
 * - **Timestamp Preservation**: Original timestamps are preserved when matching tools to permissions
 * - **State Persistence**: The ReducerState maintains all mappings across calls
 * - **Message Immutability**: NEVER modify message timestamps or core properties after creation
 *   Messages can only have their tool state/result updated, never their creation metadata
 * - **Timestamp Preservation**: NEVER change a message's createdAt timestamp. The timestamp
 *   represents when the message was originally created and must be preserved throughout all
 *   processing phases. This is critical for maintaining correct message ordering.
 *
 * ## Immutability Contract (HAP-445):
 *
 * This reducer uses **Immer** for safe, immutable message updates. All message mutations
 * go through Immer's `produce()` function, which:
 *
 * - Creates new object references when properties change (structural sharing)
 * - Enables React's change detection to work correctly
 * - Makes debugging with React DevTools reliable
 * - Prevents accidental mutations from affecting cached state
 *
 * **Internal state tracking** (LRUCache maps for toolIdToMessageId, permissions, etc.)
 * is mutated directly since these are internal indexes not consumed by React components.
 * Only the `ReducerMessage` objects that become `Message` objects for the UI use Immer.
 * 
 * ## Permission Matching Algorithm:
 * 
 * When a tool call arrives, the matching algorithm:
 * 1. Checks if the tool has already been processed (via toolIdToMessageId)
 * 2. Searches for approved permission messages with:
 *    - Same tool name
 *    - Matching arguments (deep equality)
 *    - Not already linked to another tool
 * 3. Prioritizes the newest matching permission
 * 4. Updates the permission message with tool execution details
 * 5. Falls back to creating a new tool message if no match
 * 
 * ## Data Flow:
 * 
 * Raw Messages → Normalizer → Reducer → Structured Messages
 *                              ↑
 *                         AgentState
 * 
 * The reducer receives:
 * - Normalized messages from the sync system
 * - Current AgentState with permission information
 * 
 * And produces:
 * - Structured Message objects for UI rendering
 * - Updated internal state for future processing
 */

import { produce } from "immer";
import { Message, ToolCall } from "../typesMessage";
import { AgentEvent, NormalizedMessage, UsageData } from "../typesRaw";
import { createTracer, traceMessages, TracerState } from "./reducerTracer";
import { AgentState, UsageHistoryEntry, MAX_USAGE_HISTORY_SIZE, MIN_CONTEXT_CHANGE_FOR_HISTORY, REDUCER_MAP_MAX_SIZE } from "../storageTypes";
import { MessageMeta } from "../typesMessageMeta";
import { parseMessageAsEvent } from "./messageToEvent";
import { LRUCache } from "@/utils/LRUCache";

type ReducerMessage = {
    id: string;
    realID: string | null;
    createdAt: number;
    role: 'user' | 'agent';
    text: string | null;
    event: AgentEvent | null;
    tool: ToolCall | null;
    meta?: MessageMeta;
    usage?: UsageData;
}

type StoredPermission = {
    tool: string;
    arguments: any;
    createdAt: number;
    completedAt?: number;
    status: 'pending' | 'approved' | 'denied' | 'canceled';
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
};

/**
 * Reducer state maintains mappings for message deduplication and tracking.
 *
 * HAP-457: All Maps are now bounded using LRU caches to prevent unbounded
 * memory growth in long-running sessions. When the cache exceeds REDUCER_MAP_MAX_SIZE,
 * the least recently used entries are evicted. This is safe because:
 * - Once a message is processed and stored, we rarely need to look it up again
 * - The actual message data lives in the messages Map; tracking Maps are just indexes
 * - Evicted entries will be re-created if the same message is processed again
 */
export type ReducerState = {
    toolIdToMessageId: LRUCache<string, string>; // toolId/permissionId -> messageId (since they're the same now)
    sidechainToolIdToMessageId: LRUCache<string, string>; // toolId -> sidechain messageId (for dual tracking)
    permissions: LRUCache<string, StoredPermission>; // Store permission details by ID for quick lookup
    localIds: LRUCache<string, string>;
    messageIds: LRUCache<string, string>; // originalId -> internalId
    messages: LRUCache<string, ReducerMessage>;
    sidechains: LRUCache<string, ReducerMessage[]>;
    tracerState: TracerState; // Tracer state for sidechain processing
    latestTodos?: {
        todos: Array<{
            content: string;
            status: 'pending' | 'in_progress' | 'completed';
            priority: 'high' | 'medium' | 'low';
            id: string;
        }>;
        timestamp: number;
    };
    latestUsage?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
        timestamp: number;
    };
    // Historical context usage for trend visualization (HAP-344)
    usageHistory: UsageHistoryEntry[];
};

export function createReducer(): ReducerState {
    return {
        toolIdToMessageId: new LRUCache(REDUCER_MAP_MAX_SIZE),
        sidechainToolIdToMessageId: new LRUCache(REDUCER_MAP_MAX_SIZE),
        permissions: new LRUCache(REDUCER_MAP_MAX_SIZE),
        messages: new LRUCache(REDUCER_MAP_MAX_SIZE),
        localIds: new LRUCache(REDUCER_MAP_MAX_SIZE),
        messageIds: new LRUCache(REDUCER_MAP_MAX_SIZE),
        sidechains: new LRUCache(REDUCER_MAP_MAX_SIZE),
        tracerState: createTracer(),
        usageHistory: []
    };
}

const ENABLE_LOGGING = false;

export type ReducerResult = {
    messages: Message[];
    todos?: Array<{
        content: string;
        status: 'pending' | 'in_progress' | 'completed';
        priority: 'high' | 'medium' | 'low';
        id: string;
    }>;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
    };
    hasReadyEvent?: boolean;
};

export function reducer(state: ReducerState, messages: NormalizedMessage[], agentState?: AgentState | null): ReducerResult {
    if (ENABLE_LOGGING) {
        console.log(`[REDUCER] Called with ${messages.length} messages, agentState: ${agentState ? 'YES' : 'NO'}`);
        if (agentState?.requests) {
            console.log(`[REDUCER] AgentState has ${Object.keys(agentState.requests).length} pending requests`);
        }
        if (agentState?.completedRequests) {
            console.log(`[REDUCER] AgentState has ${Object.keys(agentState.completedRequests).length} completed requests`);
        }
    }

    let newMessages: Message[] = [];
    let changed: Set<string> = new Set();
    let hasReadyEvent = false;

    // First, trace all messages to identify sidechains
    const tracedMessages = traceMessages(state.tracerState, messages);

    // Separate sidechain and non-sidechain messages
    let nonSidechainMessages = tracedMessages.filter(msg => !msg.sidechainId);
    const sidechainMessages = tracedMessages.filter(msg => msg.sidechainId);

    //
    // Phase 0.5: Message-to-Event Conversion
    // Convert certain messages to events before normal processing
    //

    if (ENABLE_LOGGING) {
        console.log(`[REDUCER] Phase 0.5: Message-to-Event Conversion`);
    }

    const messagesToProcess: NormalizedMessage[] = [];
    const convertedEvents: { message: NormalizedMessage, event: AgentEvent }[] = [];

    for (const msg of nonSidechainMessages) {
        // Check if we've already processed this message
        if (msg.role === 'user' && msg.localId && state.localIds.has(msg.localId)) {
            continue;
        }
        if (state.messageIds.has(msg.id)) {
            continue;
        }

        // Filter out ready events completely - they should not create any message
        if (msg.role === 'event' && msg.content.type === 'ready') {
            // Mark as processed to prevent duplication but don't add to messages
            state.messageIds.set(msg.id, msg.id);
            hasReadyEvent = true;
            continue;
        }

        // Handle context reset events - reset state and let the message be shown
        if (msg.role === 'event' && msg.content.type === 'message' && msg.content.message === 'Context was reset') {
            // Reset todos to empty array and reset usage to zero
            state.latestTodos = {
                todos: [],
                timestamp: msg.createdAt  // Use message timestamp, not current time
            };
            state.latestUsage = {
                inputTokens: 0,
                outputTokens: 0,
                cacheCreation: 0,
                cacheRead: 0,
                contextSize: 0,
                timestamp: msg.createdAt  // Use message timestamp to avoid blocking older usage data
            };
            // Clear usage history on full reset (HAP-344)
            state.usageHistory = [];
            // Don't continue - let the event be processed normally to create a message
        }

        // Handle compaction completed events - reset context but keep todos
        if (msg.role === 'event' && msg.content.type === 'message' && msg.content.message === 'Compaction completed') {
            // Reset usage/context to zero but keep todos unchanged
            state.latestUsage = {
                inputTokens: 0,
                outputTokens: 0,
                cacheCreation: 0,
                cacheRead: 0,
                contextSize: 0,
                timestamp: msg.createdAt  // Use message timestamp to avoid blocking older usage data
            };
            // Record a zero point in history after compaction to show the drop (HAP-344)
            state.usageHistory.push({
                contextSize: 0,
                timestamp: msg.createdAt
            });
            // Don't continue - let the event be processed normally to create a message
        }

        // Try to parse message as event
        const event = parseMessageAsEvent(msg);
        if (event) {
            if (ENABLE_LOGGING) {
                console.log(`[REDUCER] Converting message ${msg.id} to event:`, event);
            }
            convertedEvents.push({ message: msg, event });
            // Mark as processed to prevent duplication
            state.messageIds.set(msg.id, msg.id);
            if (msg.role === 'user' && msg.localId) {
                state.localIds.set(msg.localId, msg.id);
            }
        } else {
            messagesToProcess.push(msg);
        }
    }

    // Process converted events immediately
    for (const { message, event } of convertedEvents) {
        const mid = allocateId();
        state.messages.set(mid, {
            id: mid,
            realID: message.id,
            role: 'agent',
            createdAt: message.createdAt,
            event: event,
            tool: null,
            text: null,
            meta: message.meta,
        });
        changed.add(mid);
    }

    // Update nonSidechainMessages to only include messages that weren't converted
    nonSidechainMessages = messagesToProcess;

    // Build a set of incoming tool IDs for quick lookup
    const incomingToolIds = new Set<string>();
    for (let msg of nonSidechainMessages) {
        if (msg.role === 'agent') {
            for (let c of msg.content) {
                if (c.type === 'tool-call') {
                    incomingToolIds.add(c.id);
                }
            }
        }
    }

    //
    // Phase 0: Process AgentState permissions
    //

    if (ENABLE_LOGGING) {
        console.log(`[REDUCER] Phase 0: Processing AgentState`);
    }
    if (agentState) {
        // Process pending permission requests
        if (agentState.requests) {
            for (const [permId, request] of Object.entries(agentState.requests)) {
                // Skip if this permission is also in completedRequests (completed takes precedence)
                if (agentState.completedRequests && agentState.completedRequests[permId]) {
                    continue;
                }

                // Check if we already have a message for this permission ID
                const existingMessageId = state.toolIdToMessageId.get(permId);
                if (existingMessageId) {
                    // Update existing tool message with permission info
                    const message = state.messages.get(existingMessageId);
                    if (message?.tool && !message.tool.permission) {
                        if (ENABLE_LOGGING) {
                            console.log(`[REDUCER] Updating existing tool ${permId} with permission`);
                        }
                        // HAP-445: Use Immer for immutable message updates
                        const updated = produce(message, draft => {
                            draft.tool!.permission = {
                                id: permId,
                                status: 'pending'
                            };
                        });
                        state.messages.set(existingMessageId, updated);
                        changed.add(existingMessageId);
                    }
                } else {
                    if (ENABLE_LOGGING) {
                        console.log(`[REDUCER] Creating new message for permission ${permId}`);
                    }

                    // Create a new tool message for the permission request
                    let mid = allocateId();
                    let toolCall: ToolCall = {
                        name: request.tool,
                        state: 'running' as const,
                        input: request.arguments,
                        createdAt: request.createdAt || Date.now(),
                        startedAt: null,
                        completedAt: null,
                        description: null,
                        result: undefined,
                        permission: {
                            id: permId,
                            status: 'pending'
                        }
                    };

                    state.messages.set(mid, {
                        id: mid,
                        realID: null,
                        role: 'agent',
                        createdAt: request.createdAt || Date.now(),
                        text: null,
                        tool: toolCall,
                        event: null,
                    });

                    // Store by permission ID (which will match tool ID)
                    state.toolIdToMessageId.set(permId, mid);

                    changed.add(mid);
                }

                // Store permission details for quick lookup
                state.permissions.set(permId, {
                    tool: request.tool,
                    arguments: request.arguments,
                    createdAt: request.createdAt || Date.now(),
                    status: 'pending'
                });
            }
        }

        // Process completed permission requests
        if (agentState.completedRequests) {
            for (const [permId, completed] of Object.entries(agentState.completedRequests)) {
                // Check if we have a message for this permission ID
                const messageId = state.toolIdToMessageId.get(permId);
                if (messageId) {
                    const message = state.messages.get(messageId);
                    if (message?.tool) {
                        // Skip if tool has already started actual execution with approval
                        if (message.tool.startedAt && message.tool.permission?.status === 'approved') {
                            continue;
                        }

                        // Skip if permission already has date (came from tool result - preferred over agentState)
                        if (message.tool.permission?.date) {
                            continue;
                        }

                        // Check if we need to update ANY field
                        const needsUpdate = 
                            message.tool.permission?.status !== completed.status ||
                            message.tool.permission?.reason !== completed.reason ||
                            message.tool.permission?.mode !== completed.mode ||
                            message.tool.permission?.allowedTools !== completed.allowedTools ||
                            message.tool.permission?.decision !== completed.decision;

                        if (!needsUpdate) {
                            continue;
                        }

                        // HAP-445: Use Immer for immutable message updates
                        const updated = produce(message, draft => {
                            // Update permission status
                            if (!draft.tool!.permission) {
                                draft.tool!.permission = {
                                    id: permId,
                                    status: completed.status,
                                    mode: completed.mode || undefined,
                                    allowedTools: completed.allowedTools || undefined,
                                    decision: completed.decision || undefined,
                                    reason: completed.reason || undefined
                                };
                            } else {
                                // Update all fields
                                draft.tool!.permission.status = completed.status;
                                draft.tool!.permission.mode = completed.mode || undefined;
                                draft.tool!.permission.allowedTools = completed.allowedTools || undefined;
                                draft.tool!.permission.decision = completed.decision || undefined;
                                if (completed.reason) {
                                    draft.tool!.permission.reason = completed.reason;
                                }
                            }

                            // Update tool state based on permission status
                            if (completed.status === 'approved') {
                                if (draft.tool!.state !== 'completed' && draft.tool!.state !== 'error' && draft.tool!.state !== 'running') {
                                    draft.tool!.state = 'running';
                                }
                            } else {
                                // denied or canceled
                                if (draft.tool!.state !== 'error' && draft.tool!.state !== 'completed') {
                                    draft.tool!.state = 'error';
                                    draft.tool!.completedAt = completed.completedAt || Date.now();
                                    if (!draft.tool!.result && completed.reason) {
                                        draft.tool!.result = { error: completed.reason };
                                    }
                                }
                            }
                        });
                        state.messages.set(messageId, updated);
                        changed.add(messageId);

                        // Update stored permission
                        state.permissions.set(permId, {
                            tool: completed.tool,
                            arguments: completed.arguments,
                            createdAt: completed.createdAt || Date.now(),
                            completedAt: completed.completedAt || undefined,
                            status: completed.status,
                            reason: completed.reason || undefined,
                            mode: completed.mode || undefined,
                            allowedTools: completed.allowedTools || undefined,
                            decision: completed.decision || undefined
                        });
                    }
                } else {
                    // No existing message - check if tool ID is in incoming messages
                    if (incomingToolIds.has(permId)) {
                        if (ENABLE_LOGGING) {
                            console.log(`[REDUCER] Storing permission ${permId} for incoming tool`);
                        }
                        // Store permission for when tool arrives in Phase 2
                        state.permissions.set(permId, {
                            tool: completed.tool,
                            arguments: completed.arguments,
                            createdAt: completed.createdAt || Date.now(),
                            completedAt: completed.completedAt || undefined,
                            status: completed.status,
                            reason: completed.reason || undefined
                        });
                        continue;
                    }

                    // Skip if already processed as pending
                    if (agentState.requests && agentState.requests[permId]) {
                        continue;
                    }

                    // Create a new message for completed permission without tool
                    let mid = allocateId();
                    let toolCall: ToolCall = {
                        name: completed.tool,
                        state: completed.status === 'approved' ? 'completed' : 'error',
                        input: completed.arguments,
                        createdAt: completed.createdAt || Date.now(),
                        startedAt: null,
                        completedAt: completed.completedAt || Date.now(),
                        description: null,
                        result: completed.status === 'approved'
                            ? 'Approved'
                            : (completed.reason ? { error: completed.reason } : undefined),
                        permission: {
                            id: permId,
                            status: completed.status,
                            reason: completed.reason || undefined,
                            mode: completed.mode || undefined,
                            allowedTools: completed.allowedTools || undefined,
                            decision: completed.decision || undefined
                        }
                    };

                    state.messages.set(mid, {
                        id: mid,
                        realID: null,
                        role: 'agent',
                        createdAt: completed.createdAt || Date.now(),
                        text: null,
                        tool: toolCall,
                        event: null,
                    });

                    state.toolIdToMessageId.set(permId, mid);

                    // Store permission details
                    state.permissions.set(permId, {
                        tool: completed.tool,
                        arguments: completed.arguments,
                        createdAt: completed.createdAt || Date.now(),
                        completedAt: completed.completedAt || undefined,
                        status: completed.status,
                        reason: completed.reason || undefined,
                        mode: completed.mode || undefined,
                        allowedTools: completed.allowedTools || undefined,
                        decision: completed.decision || undefined
                    });

                    changed.add(mid);
                }
            }
        }
    }

    //
    // Phase 1: Process non-sidechain user messages and text messages
    // 

    for (let msg of nonSidechainMessages) {
        if (msg.role === 'user') {
            // Check if we've seen this localId before
            if (msg.localId && state.localIds.has(msg.localId)) {
                continue;
            }
            // Check if we've seen this message ID before
            if (state.messageIds.has(msg.id)) {
                continue;
            }

            // Create a new message
            let mid = allocateId();
            state.messages.set(mid, {
                id: mid,
                realID: msg.id,
                role: 'user',
                createdAt: msg.createdAt,
                text: msg.content.text,
                tool: null,
                event: null,
                meta: msg.meta,
            });

            // Track both localId and messageId
            if (msg.localId) {
                state.localIds.set(msg.localId, mid);
            }
            state.messageIds.set(msg.id, mid);

            changed.add(mid);
        } else if (msg.role === 'agent') {
            // Check if we've seen this agent message before
            if (state.messageIds.has(msg.id)) {
                continue;
            }

            // Mark this message as seen
            state.messageIds.set(msg.id, msg.id);

            // Process usage data if present
            if (msg.usage) {
                processUsageData(state, msg.usage, msg.createdAt);
            }

            // Process text content only (tool calls handled in Phase 2)
            for (let c of msg.content) {
                if (c.type === 'text') {
                    let mid = allocateId();
                    state.messages.set(mid, {
                        id: mid,
                        realID: msg.id,
                        role: 'agent',
                        createdAt: msg.createdAt,
                        text: c.text,
                        tool: null,
                        event: null,
                        meta: msg.meta,
                        usage: msg.usage,
                    });
                    changed.add(mid);
                }
            }
        }
    }

    //
    // Phase 2: Process non-sidechain tool calls
    //

    if (ENABLE_LOGGING) {
        console.log(`[REDUCER] Phase 2: Processing tool calls`);
    }
    for (let msg of nonSidechainMessages) {
        if (msg.role === 'agent') {
            for (let c of msg.content) {
                if (c.type === 'tool-call') {
                    // Direct lookup by tool ID (since permission ID = tool ID now)
                    const existingMessageId = state.toolIdToMessageId.get(c.id);

                    if (existingMessageId) {
                        if (ENABLE_LOGGING) {
                            console.log(`[REDUCER] Found existing message for tool ${c.id}`);
                        }
                        // Update existing message with tool execution details
                        const message = state.messages.get(existingMessageId);
                        if (message?.tool) {
                            // HAP-445: Use Immer for immutable message updates
                            const updated = produce(message, draft => {
                                draft.realID = msg.id;
                                draft.tool!.description = c.description;
                                draft.tool!.startedAt = msg.createdAt;
                                // If permission was approved and shown as completed (no tool), now it's running
                                if (draft.tool!.permission?.status === 'approved' && draft.tool!.state === 'completed') {
                                    draft.tool!.state = 'running';
                                    draft.tool!.completedAt = null;
                                    draft.tool!.result = undefined;
                                }
                            });
                            state.messages.set(existingMessageId, updated);
                            changed.add(existingMessageId);

                            // Track TodoWrite tool inputs when updating existing messages
                            if (updated.tool!.name === 'TodoWrite' && updated.tool!.state === 'running' && updated.tool!.input?.todos) {
                                // Only update if this is newer than existing todos
                                if (!state.latestTodos || updated.tool!.createdAt > state.latestTodos.timestamp) {
                                    state.latestTodos = {
                                        todos: updated.tool!.input.todos,
                                        timestamp: updated.tool!.createdAt
                                    };
                                }
                            }
                        }
                    } else {
                        if (ENABLE_LOGGING) {
                            console.log(`[REDUCER] Creating new message for tool ${c.id}`);
                        }
                        // Check if there's a stored permission for this tool
                        const permission = state.permissions.get(c.id);

                        let toolCall: ToolCall = {
                            name: c.name,
                            state: 'running' as const,
                            input: permission ? permission.arguments : c.input,  // Use permission args if available
                            createdAt: permission ? permission.createdAt : msg.createdAt,  // Use permission timestamp if available
                            startedAt: msg.createdAt,
                            completedAt: null,
                            description: c.description,
                            result: undefined,
                        };

                        // Add permission info if found
                        if (permission) {
                            if (ENABLE_LOGGING) {
                                console.log(`[REDUCER] Found stored permission for tool ${c.id}`);
                            }
                            toolCall.permission = {
                                id: c.id,
                                status: permission.status,
                                reason: permission.reason,
                                mode: permission.mode,
                                allowedTools: permission.allowedTools,
                                decision: permission.decision
                            };

                            // Update state based on permission status
                            if (permission.status !== 'approved') {
                                toolCall.state = 'error';
                                toolCall.completedAt = permission.completedAt || msg.createdAt;
                                if (permission.reason) {
                                    toolCall.result = { error: permission.reason };
                                }
                            }
                        }

                        let mid = allocateId();
                        state.messages.set(mid, {
                            id: mid,
                            realID: msg.id,
                            role: 'agent',
                            createdAt: msg.createdAt,
                            text: null,
                            tool: toolCall,
                            event: null,
                            meta: msg.meta,
                            usage: msg.usage,
                        });

                        state.toolIdToMessageId.set(c.id, mid);
                        changed.add(mid);

                        // Track TodoWrite tool inputs
                        if (toolCall.name === 'TodoWrite' && toolCall.state === 'running' && toolCall.input?.todos) {
                            // Only update if this is newer than existing todos
                            if (!state.latestTodos || toolCall.createdAt > state.latestTodos.timestamp) {
                                state.latestTodos = {
                                    todos: toolCall.input.todos,
                                    timestamp: toolCall.createdAt
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    //
    // Phase 3: Process non-sidechain tool results
    //

    for (let msg of nonSidechainMessages) {
        if (msg.role === 'agent') {
            for (let c of msg.content) {
                if (c.type === 'tool-result') {
                    // Find the message containing this tool
                    let messageId = state.toolIdToMessageId.get(c.tool_use_id);
                    if (!messageId) {
                        continue;
                    }

                    const message = state.messages.get(messageId);
                    if (!message || !message.tool) {
                        continue;
                    }

                    if (message.tool.state !== 'running') {
                        continue;
                    }

                    // HAP-445: Use Immer for immutable message updates
                    const updated = produce(message, draft => {
                        // Update tool state and result
                        draft.tool!.state = c.is_error ? 'error' : 'completed';
                        draft.tool!.result = c.content;
                        draft.tool!.completedAt = msg.createdAt;

                        // Update permission data if provided by backend
                        if (c.permissions) {
                            // Merge with existing permission to preserve decision field from agentState
                            if (draft.tool!.permission) {
                                // Preserve existing decision if not provided in tool result
                                const existingDecision = draft.tool!.permission.decision;
                                draft.tool!.permission = {
                                    ...draft.tool!.permission,
                                    id: c.tool_use_id,
                                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                    date: c.permissions.date,
                                    mode: c.permissions.mode,
                                    allowedTools: c.permissions.allowedTools,
                                    decision: c.permissions.decision || existingDecision
                                };
                            } else {
                                draft.tool!.permission = {
                                    id: c.tool_use_id,
                                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                    date: c.permissions.date,
                                    mode: c.permissions.mode,
                                    allowedTools: c.permissions.allowedTools,
                                    decision: c.permissions.decision
                                };
                            }
                        }
                    });
                    state.messages.set(messageId, updated);
                    changed.add(messageId);
                }
            }
        }
    }

    //
    // Phase 4: Process sidechains and store them in state
    //

    // For each sidechain message, store it in the state and mark the Task as changed
    for (const msg of sidechainMessages) {
        if (!msg.sidechainId) continue;

        // Skip if we already processed this message
        if (state.messageIds.has(msg.id)) continue;

        // Mark as processed
        state.messageIds.set(msg.id, msg.id);

        // Get or create the sidechain array for this Task
        const existingSidechain = state.sidechains.get(msg.sidechainId) || [];

        // Process and add new sidechain messages
        if (msg.role === 'agent' && msg.content[0]?.type === 'sidechain') {
            // This is the sidechain root - create a user message
            let mid = allocateId();
            let userMsg: ReducerMessage = {
                id: mid,
                realID: msg.id,
                role: 'user',
                createdAt: msg.createdAt,
                text: msg.content[0].prompt,
                tool: null,
                event: null,
                meta: msg.meta,
            };
            state.messages.set(mid, userMsg);
            existingSidechain.push(userMsg);
        } else if (msg.role === 'agent') {
            // Process agent content in sidechain
            for (let c of msg.content) {
                if (c.type === 'text') {
                    let mid = allocateId();
                    let textMsg: ReducerMessage = {
                        id: mid,
                        realID: msg.id,
                        role: 'agent',
                        createdAt: msg.createdAt,
                        text: c.text,
                        tool: null,
                        event: null,
                        meta: msg.meta,
                        usage: msg.usage,
                    };
                    state.messages.set(mid, textMsg);
                    existingSidechain.push(textMsg);
                } else if (c.type === 'tool-call') {
                    // Check if there's already a permission message for this tool
                    const existingPermissionMessageId = state.toolIdToMessageId.get(c.id);

                    let mid = allocateId();
                    let toolCall: ToolCall = {
                        name: c.name,
                        state: 'running' as const,
                        input: c.input,
                        createdAt: msg.createdAt,
                        startedAt: null,
                        completedAt: null,
                        description: c.description,
                        result: undefined
                    };

                    // If there's a permission message, copy its permission info
                    if (existingPermissionMessageId) {
                        const permissionMessage = state.messages.get(existingPermissionMessageId);
                        if (permissionMessage?.tool?.permission) {
                            toolCall.permission = { ...permissionMessage.tool.permission };
                            // Update the permission message to show it's running
                            if (permissionMessage.tool.state !== 'completed' && permissionMessage.tool.state !== 'error') {
                                // HAP-445: Use Immer for immutable message updates
                                const updatedPermission = produce(permissionMessage, draft => {
                                    draft.tool!.state = 'running';
                                    draft.tool!.startedAt = msg.createdAt;
                                    draft.tool!.description = c.description;
                                });
                                state.messages.set(existingPermissionMessageId, updatedPermission);
                                changed.add(existingPermissionMessageId);
                            }
                        }
                    }

                    let toolMsg: ReducerMessage = {
                        id: mid,
                        realID: msg.id,
                        role: 'agent',
                        createdAt: msg.createdAt,
                        text: null,
                        tool: toolCall,
                        event: null,
                        meta: msg.meta,
                        usage: msg.usage,
                    };
                    state.messages.set(mid, toolMsg);
                    existingSidechain.push(toolMsg);

                    // Map sidechain tool separately to avoid overwriting permission mapping
                    state.sidechainToolIdToMessageId.set(c.id, mid);
                } else if (c.type === 'tool-result') {
                    // Process tool result in sidechain - update BOTH messages

                    // Update the sidechain tool message
                    const sidechainMessageId = state.sidechainToolIdToMessageId.get(c.tool_use_id);
                    if (sidechainMessageId) {
                        const sidechainMessage = state.messages.get(sidechainMessageId);
                        if (sidechainMessage && sidechainMessage.tool && sidechainMessage.tool.state === 'running') {
                            // HAP-445: Use Immer for immutable message updates
                            const updatedSidechain = produce(sidechainMessage, draft => {
                                draft.tool!.state = c.is_error ? 'error' : 'completed';
                                draft.tool!.result = c.content;
                                draft.tool!.completedAt = msg.createdAt;

                                // Update permission data if provided by backend
                                if (c.permissions) {
                                    // Merge with existing permission to preserve decision field from agentState
                                    if (draft.tool!.permission) {
                                        const existingDecision = draft.tool!.permission.decision;
                                        draft.tool!.permission = {
                                            ...draft.tool!.permission,
                                            id: c.tool_use_id,
                                            status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                            date: c.permissions.date,
                                            mode: c.permissions.mode,
                                            allowedTools: c.permissions.allowedTools,
                                            decision: c.permissions.decision || existingDecision
                                        };
                                    } else {
                                        draft.tool!.permission = {
                                            id: c.tool_use_id,
                                            status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                            date: c.permissions.date,
                                            mode: c.permissions.mode,
                                            allowedTools: c.permissions.allowedTools,
                                            decision: c.permissions.decision
                                        };
                                    }
                                }
                            });
                            state.messages.set(sidechainMessageId, updatedSidechain);
                        }
                    }

                    // Also update the main permission message if it exists
                    const permissionMessageId = state.toolIdToMessageId.get(c.tool_use_id);
                    if (permissionMessageId) {
                        const permissionMessage = state.messages.get(permissionMessageId);
                        if (permissionMessage && permissionMessage.tool && permissionMessage.tool.state === 'running') {
                            // HAP-445: Use Immer for immutable message updates
                            const updatedPermission = produce(permissionMessage, draft => {
                                draft.tool!.state = c.is_error ? 'error' : 'completed';
                                draft.tool!.result = c.content;
                                draft.tool!.completedAt = msg.createdAt;

                                // Update permission data if provided by backend
                                if (c.permissions) {
                                    // Merge with existing permission to preserve decision field from agentState
                                    if (draft.tool!.permission) {
                                        const existingDecision = draft.tool!.permission.decision;
                                        draft.tool!.permission = {
                                            ...draft.tool!.permission,
                                            id: c.tool_use_id,
                                            status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                            date: c.permissions.date,
                                            mode: c.permissions.mode,
                                            allowedTools: c.permissions.allowedTools,
                                            decision: c.permissions.decision || existingDecision
                                        };
                                    } else {
                                        draft.tool!.permission = {
                                            id: c.tool_use_id,
                                            status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                                            date: c.permissions.date,
                                            mode: c.permissions.mode,
                                            allowedTools: c.permissions.allowedTools,
                                            decision: c.permissions.decision
                                        };
                                    }
                                }
                            });
                            state.messages.set(permissionMessageId, updatedPermission);
                            changed.add(permissionMessageId);
                        }
                    }
                }
            }
        }

        // Update the sidechain in state
        state.sidechains.set(msg.sidechainId, existingSidechain);

        // Find the Task tool message that owns this sidechain and mark it as changed
        // msg.sidechainId is the realID of the Task message
        for (const [internalId, message] of state.messages) {
            if (message.realID === msg.sidechainId && message.tool) {
                changed.add(internalId);
                break;
            }
        }
    }

    //
    // Phase 5: Process mode-switch messages
    //

    for (let msg of nonSidechainMessages) {
        if (msg.role === 'event') {
            let mid = allocateId();
            state.messages.set(mid, {
                id: mid,
                realID: msg.id,
                role: 'agent',
                createdAt: msg.createdAt,
                event: msg.content,
                tool: null,
                text: null,
                meta: msg.meta,
            });
            changed.add(mid);
        }
    }

    //
    // Collect changed messages (only root-level messages)
    //

    for (let id of changed) {
        let existing = state.messages.get(id);
        if (!existing) continue;

        let message = convertReducerMessageToMessage(existing, state);
        if (message) {
            newMessages.push(message);
        }
    }

    //
    // Debug changes
    //

    if (ENABLE_LOGGING) {
        console.log(JSON.stringify(messages, null, 2));
        console.log(`[REDUCER] Changed messages: ${changed.size}`);
    }

    return {
        messages: newMessages,
        todos: state.latestTodos?.todos,
        usage: state.latestUsage ? {
            inputTokens: state.latestUsage.inputTokens,
            outputTokens: state.latestUsage.outputTokens,
            cacheCreation: state.latestUsage.cacheCreation,
            cacheRead: state.latestUsage.cacheRead,
            contextSize: state.latestUsage.contextSize
        } : undefined,
        hasReadyEvent: hasReadyEvent || undefined
    };
}

//
// Helpers
//

function allocateId() {
    return Math.random().toString(36).substring(2, 15);
}

function processUsageData(state: ReducerState, usage: UsageData, timestamp: number) {
    const contextSize = (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + usage.input_tokens;

    // Only update if this is newer than the current latest usage
    if (!state.latestUsage || timestamp > state.latestUsage.timestamp) {
        const previousContextSize = state.latestUsage?.contextSize ?? 0;

        state.latestUsage = {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheCreation: usage.cache_creation_input_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            contextSize,
            timestamp: timestamp
        };

        // Record usage history (HAP-344): Only record if context changed significantly
        // This prevents recording too many small changes while capturing meaningful growth
        const contextChange = Math.abs(contextSize - previousContextSize);
        const isFirstEntry = state.usageHistory.length === 0;
        const shouldRecord = isFirstEntry || contextChange >= MIN_CONTEXT_CHANGE_FOR_HISTORY;

        if (shouldRecord && contextSize > 0) {
            // Add new entry
            state.usageHistory.push({
                contextSize,
                timestamp
            });

            // Limit history size by removing oldest entries
            while (state.usageHistory.length > MAX_USAGE_HISTORY_SIZE) {
                state.usageHistory.shift();
            }
        }
    }
}


function convertReducerMessageToMessage(reducerMsg: ReducerMessage, state: ReducerState): Message | null {
    if (reducerMsg.role === 'user' && reducerMsg.text !== null) {
        return {
            id: reducerMsg.id,
            localId: null,
            createdAt: reducerMsg.createdAt,
            kind: 'user-text',
            text: reducerMsg.text,
            ...(reducerMsg.meta?.displayText && { displayText: reducerMsg.meta.displayText }),
            meta: reducerMsg.meta
        };
    } else if (reducerMsg.role === 'agent' && reducerMsg.text !== null) {
        return {
            id: reducerMsg.id,
            localId: null,
            createdAt: reducerMsg.createdAt,
            kind: 'agent-text',
            text: reducerMsg.text,
            meta: reducerMsg.meta,
            usage: reducerMsg.usage
        };
    } else if (reducerMsg.role === 'agent' && reducerMsg.tool !== null) {
        // Convert children recursively
        let childMessages: Message[] = [];
        let children = reducerMsg.realID ? state.sidechains.get(reducerMsg.realID) || [] : [];
        for (let child of children) {
            let childMessage = convertReducerMessageToMessage(child, state);
            if (childMessage) {
                childMessages.push(childMessage);
            }
        }

        return {
            id: reducerMsg.id,
            localId: null,
            createdAt: reducerMsg.createdAt,
            kind: 'tool-call',
            tool: { ...reducerMsg.tool },
            children: childMessages,
            meta: reducerMsg.meta,
            usage: reducerMsg.usage
        };
    } else if (reducerMsg.role === 'agent' && reducerMsg.event !== null) {
        return {
            id: reducerMsg.id,
            createdAt: reducerMsg.createdAt,
            kind: 'agent-event',
            event: reducerMsg.event,
            meta: reducerMsg.meta
        };
    }

    return null;
}