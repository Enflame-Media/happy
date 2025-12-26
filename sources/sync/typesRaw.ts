import * as z from 'zod';
import { MessageMetaSchema, MessageMeta } from './typesMessageMeta';

//
// Validation Metrics
//
// Lightweight in-memory counters for tracking schema validation failures.
// These help monitor CLI↔App message contract health without impacting performance.
//

interface ValidationStats {
    /** Count of messages that failed initial Zod schema validation */
    schemaFailures: number;
    /** Count of messages with unknown output data types (e.g., new Claude SDK types) */
    unknownTypes: number;
    /** Count of messages that passed loose validation but failed strict validation */
    strictValidationFailures: number;
    /** Map of unknown type names to their occurrence count */
    unknownTypeBreakdown: Record<string, number>;
    /** Timestamp of first validation failure in this session */
    firstFailureAt: number | null;
    /** Timestamp of most recent validation failure */
    lastFailureAt: number | null;
}

const validationStats: ValidationStats = {
    schemaFailures: 0,
    unknownTypes: 0,
    strictValidationFailures: 0,
    unknownTypeBreakdown: {},
    firstFailureAt: null,
    lastFailureAt: null,
};

/**
 * Get current validation statistics for debugging and monitoring.
 * Stats reset when the app restarts (in-memory only).
 *
 * @example
 * // In dev tools or debugging:
 * import { getValidationStats } from './typesRaw';
 * console.log(getValidationStats());
 * // => { schemaFailures: 2, unknownTypes: 5, unknownTypeBreakdown: { 'thinking': 3, 'status': 2 }, ... }
 */
export function getValidationStats(): Readonly<ValidationStats> {
    return { ...validationStats, unknownTypeBreakdown: { ...validationStats.unknownTypeBreakdown } };
}

/**
 * Reset validation statistics. Useful for testing or starting fresh measurements.
 */
export function resetValidationStats(): void {
    validationStats.schemaFailures = 0;
    validationStats.unknownTypes = 0;
    validationStats.strictValidationFailures = 0;
    validationStats.unknownTypeBreakdown = {};
    validationStats.firstFailureAt = null;
    validationStats.lastFailureAt = null;
}

function recordValidationFailure(type: 'schema' | 'unknown' | 'strict', unknownTypeName?: string): void {
    const now = Date.now();
    if (validationStats.firstFailureAt === null) {
        validationStats.firstFailureAt = now;
    }
    validationStats.lastFailureAt = now;

    switch (type) {
        case 'schema':
            validationStats.schemaFailures++;
            break;
        case 'unknown':
            validationStats.unknownTypes++;
            if (unknownTypeName) {
                validationStats.unknownTypeBreakdown[unknownTypeName] =
                    (validationStats.unknownTypeBreakdown[unknownTypeName] || 0) + 1;
            }
            break;
        case 'strict':
            validationStats.strictValidationFailures++;
            break;
    }
}

//
// Raw types
//

// Usage data type from Claude API
const usageDataSchema = z.object({
    input_tokens: z.number(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    output_tokens: z.number(),
    service_tier: z.string().optional(),
});

export type UsageData = z.infer<typeof usageDataSchema>;

const agentEventSchema = z.discriminatedUnion('type', [z.object({
    type: z.literal('switch'),
    mode: z.enum(['local', 'remote'])
}), z.object({
    type: z.literal('message'),
    message: z.string(),
}), z.object({
    type: z.literal('limit-reached'),
    endsAt: z.number(),
}), z.object({
    type: z.literal('ready'),
})]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

const rawTextContentSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});
export type RawTextContent = z.infer<typeof rawTextContentSchema>;

const rawToolUseContentSchema = z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.any(),
});
export type RawToolUseContent = z.infer<typeof rawToolUseContentSchema>;

const rawToolResultContentSchema = z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.union([z.array(z.object({ type: z.literal('text'), text: z.string() })), z.string()]),
    is_error: z.boolean().optional(),
    permissions: z.object({
        date: z.number(),
        result: z.enum(['approved', 'denied']),
        mode: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    }).optional(),
});
export type RawToolResultContent = z.infer<typeof rawToolResultContentSchema>;

const rawAgentContentSchema = z.discriminatedUnion('type', [
    rawTextContentSchema,
    rawToolUseContentSchema,
    rawToolResultContentSchema
]);
export type RawAgentContent = z.infer<typeof rawAgentContentSchema>;

// Strict schema for known output data types - provides full type narrowing
const rawOutputDataSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('system') }),
    z.object({ type: z.literal('result') }),
    z.object({ type: z.literal('summary'), summary: z.string() }),
    z.object({ type: z.literal('assistant'), message: z.object({ role: z.literal('assistant'), model: z.string(), content: z.array(rawAgentContentSchema), usage: usageDataSchema.optional() }), parent_tool_use_id: z.string().nullable().optional() }),
    z.object({ type: z.literal('user'), message: z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(rawAgentContentSchema)]) }), parent_tool_use_id: z.string().nullable().optional(), toolUseResult: z.any().nullable().optional() }),
]);

// Common fields for all output data types
const outputCommonFieldsSchema = z.object({
    isSidechain: z.boolean().nullish(),
    isCompactSummary: z.boolean().nullish(),
    isMeta: z.boolean().nullish(),
    uuid: z.string().nullish(),
    parentUuid: z.string().nullish(),
});

// Loose schema that accepts any output data type (for initial validation)
// This prevents console.error spam when CLI sends new message types
const rawOutputDataLooseSchema = z.object({
    type: z.string(), // Accept any string type
}).passthrough().and(outputCommonFieldsSchema);

const rawAgentRecordSchema = z.discriminatedUnion('type', [z.object({
    type: z.literal('output'),
    // Use loose schema for validation to accept unknown types gracefully
    data: rawOutputDataLooseSchema,
}), z.object({
    type: z.literal('event'),
    id: z.string(),
    data: agentEventSchema
}), z.object({
    type: z.literal('codex'),
    data: z.discriminatedUnion('type', [
        z.object({ type: z.literal('reasoning'), message: z.string() }),
        z.object({ type: z.literal('message'), message: z.string() }),
        z.object({
            type: z.literal('tool-call'),
            callId: z.string(),
            input: z.any(),
            name: z.string(),
            id: z.string()
        }),
        z.object({
            type: z.literal('tool-call-result'),
            callId: z.string(),
            output: z.any(),
            id: z.string()
        })
    ])
})]);

const rawRecordSchema = z.discriminatedUnion('role', [
    z.object({
        role: z.literal('agent'),
        content: rawAgentRecordSchema,
        meta: MessageMetaSchema.optional()
    }),
    z.object({
        role: z.literal('user'),
        content: z.object({
            type: z.literal('text'),
            text: z.string()
        }),
        meta: MessageMetaSchema.optional()
    })
]);

export type RawRecord = z.infer<typeof rawRecordSchema>;

// Export schemas for validation
export const RawRecordSchema = rawRecordSchema;


//
// Normalized types
//

type NormalizedAgentContent =
    {
        type: 'text';
        text: string;
        uuid: string;
        parentUUID: string | null;
    } | {
        type: 'tool-call';
        id: string;
        name: string;
        input: any;
        description: string | null;
        uuid: string;
        parentUUID: string | null;
    } | {
        type: 'tool-result'
        tool_use_id: string;
        content: any;
        is_error: boolean;
        uuid: string;
        parentUUID: string | null;
        permissions?: {
            date: number;
            result: 'approved' | 'denied';
            mode?: string;
            allowedTools?: string[];
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
        };
    } | {
        type: 'summary',
        summary: string;
    } | {
        type: 'sidechain'
        uuid: string;
        prompt: string
    };

export type NormalizedMessage = ({
    role: 'user'
    content: {
        type: 'text';
        text: string;
    }
} | {
    role: 'agent'
    content: NormalizedAgentContent[]
} | {
    role: 'event'
    content: AgentEvent
}) & {
    id: string,
    localId: string | null,
    createdAt: number,
    isSidechain: boolean,
    meta?: MessageMeta,
    usage?: UsageData,
};

// Known output data type literals for type checking
const KNOWN_OUTPUT_TYPES = ['system', 'result', 'summary', 'assistant', 'user'] as const;
type KnownOutputType = typeof KNOWN_OUTPUT_TYPES[number];

function isKnownOutputType(type: string): type is KnownOutputType {
    return KNOWN_OUTPUT_TYPES.includes(type as KnownOutputType);
}

export function normalizeRawMessage(id: string, localId: string | null, createdAt: number, raw: RawRecord): NormalizedMessage | null {
    // First pass: loose validation to accept messages without console spam
    let parsed = rawRecordSchema.safeParse(raw);
    if (!parsed.success) {
        // Track schema validation failures for production monitoring
        recordValidationFailure('schema');

        // Only log validation errors in development mode to avoid console spam in production
        // These failures are expected when CLI sends new message types not yet in the schema
        if (__DEV__) {
            console.debug('[typesRaw] Schema validation failed for raw record:', {
                issues: parsed.error.issues,
                rawType: (raw as { role?: string; content?: { type?: string; data?: { type?: string } } })?.content?.type,
                rawDataType: (raw as { content?: { data?: { type?: string } } })?.content?.data?.type,
            });
        }
        return null;
    }
    raw = parsed.data;
    if (raw.role === 'user') {
        return {
            id,
            localId,
            createdAt,
            role: 'user',
            content: raw.content,
            isSidechain: false,
            meta: raw.meta,
        };
    }
    if (raw.role === 'agent') {
        if (raw.content.type === 'output') {

            // Skip Meta messages
            if (raw.content.data.isMeta) {
                return null;
            }

            // Skip compact summary messages
            if (raw.content.data.isCompactSummary) {
                return null;
            }

            // Check if this is a known output type before processing
            if (!isKnownOutputType(raw.content.data.type)) {
                // Track unknown type encounters with the specific type name for analysis
                recordValidationFailure('unknown', raw.content.data.type);

                // Unknown output data type - gracefully drop with debug logging
                // This handles new message types from Claude SDK that aren't yet in the schema
                if (__DEV__) {
                    console.debug('[typesRaw] Unknown output data type, dropping message:', {
                        type: raw.content.data.type,
                        hasUuid: !!raw.content.data.uuid,
                        isSidechain: raw.content.data.isSidechain,
                    });
                }
                return null;
            }

            // Second pass: strict validation for known types to get proper type narrowing
            const strictParsed = rawOutputDataSchema.and(outputCommonFieldsSchema).safeParse(raw.content.data);
            if (!strictParsed.success) {
                // Track strict validation failures (rare, indicates schema mismatch)
                recordValidationFailure('strict');

                // This shouldn't happen for known types, but log it just in case
                if (__DEV__) {
                    console.debug('[typesRaw] Strict validation failed for known output type:', {
                        type: raw.content.data.type,
                        issues: strictParsed.error.issues,
                    });
                }
                return null;
            }
            const data = strictParsed.data;

            // Handle Assistant messages (including sidechains)
            if (data.type === 'assistant') {
                if (!data.uuid) {
                    return null;
                }
                let content: NormalizedAgentContent[] = [];
                for (let c of data.message.content) {
                    if (c.type === 'text') {
                        content.push({ type: 'text', text: c.text, uuid: data.uuid, parentUUID: data.parentUuid ?? null });
                    } else if (c.type === 'tool_use') {
                        let description: string | null = null;
                        if (typeof c.input === 'object' && c.input !== null && 'description' in c.input && typeof c.input.description === 'string') {
                            description = c.input.description;
                        }
                        content.push({
                            type: 'tool-call',
                            id: c.id,
                            name: c.name,
                            input: c.input,
                            description, uuid: data.uuid,
                            parentUUID: data.parentUuid ?? null
                        });
                    }
                }
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: data.isSidechain ?? false,
                    content,
                    meta: raw.meta,
                    usage: data.message.usage
                };
            } else if (data.type === 'user') {
                if (!data.uuid) {
                    return null;
                }

                // Handle sidechain user messages
                if (data.isSidechain && data.message && typeof data.message.content === 'string') {
                    // Return as a special agent message with sidechain content
                    return {
                        id,
                        localId,
                        createdAt,
                        role: 'agent',
                        isSidechain: true,
                        content: [{
                            type: 'sidechain',
                            uuid: data.uuid,
                            prompt: data.message.content
                        }]
                    };
                }

                // Handle regular user messages
                if (data.message && typeof data.message.content === 'string') {
                    return {
                        id,
                        localId,
                        createdAt,
                        role: 'user',
                        isSidechain: false,
                        content: {
                            type: 'text',
                            text: data.message.content
                        }
                    };
                }

                // Handle tool results
                let content: NormalizedAgentContent[] = [];
                if (typeof data.message.content === 'string') {
                    content.push({
                        type: 'text',
                        text: data.message.content,
                        uuid: data.uuid,
                        parentUUID: data.parentUuid ?? null
                    });
                } else {
                    for (let c of data.message.content) {
                        if (c.type === 'tool_result') {
                            content.push({
                                type: 'tool-result',
                                tool_use_id: c.tool_use_id,
                                content: data.toolUseResult ? data.toolUseResult : (typeof c.content === 'string' ? c.content : c.content[0].text),
                                is_error: c.is_error || false,
                                uuid: data.uuid,
                                parentUUID: data.parentUuid ?? null,
                                permissions: c.permissions ? {
                                    date: c.permissions.date,
                                    result: c.permissions.result,
                                    mode: c.permissions.mode,
                                    allowedTools: c.permissions.allowedTools,
                                    decision: c.permissions.decision
                                } : undefined
                            });
                        }
                    }
                }
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: data.isSidechain ?? false,
                    content,
                    meta: raw.meta
                };
            }
        }
        if (raw.content.type === 'event') {
            return {
                id,
                localId,
                createdAt,
                role: 'event',
                content: raw.content.data,
                isSidechain: false,
            };
        }
        if (raw.content.type === 'codex') {
            if (raw.content.data.type === 'message') {
                // Cast codex messages to agent text messages
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'text',
                        text: raw.content.data.message,
                        uuid: id,
                        parentUUID: null
                    }],
                    meta: raw.meta
                };
            }
            if (raw.content.data.type === 'reasoning') {
                // Cast codex messages to agent text messages
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'text',
                        text: raw.content.data.message,
                        uuid: id,
                        parentUUID: null
                    }],
                    meta: raw.meta
                } satisfies NormalizedMessage;
            }
            if (raw.content.data.type === 'tool-call') {
                // Cast tool calls to agent tool-call messages
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'tool-call',
                        id: raw.content.data.callId,
                        name: raw.content.data.name || 'unknown',
                        input: raw.content.data.input,
                        description: null,
                        uuid: raw.content.data.id,
                        parentUUID: null
                    }],
                    meta: raw.meta
                } satisfies NormalizedMessage;
            }
            if (raw.content.data.type === 'tool-call-result') {
                // Cast tool call results to agent tool-result messages
                return {
                    id,
                    localId,
                    createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'tool-result',
                        tool_use_id: raw.content.data.callId,
                        content: raw.content.data.output,
                        is_error: false,
                        uuid: raw.content.data.id,
                        parentUUID: null
                    }],
                    meta: raw.meta
                } satisfies NormalizedMessage;
            }
        }
    }
    return null;
}