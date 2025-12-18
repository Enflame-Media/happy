/**
 * API Types - Re-exports from @happy/protocol
 *
 * This file re-exports shared protocol types from @happy/protocol.
 * It serves as the single import point for protocol types in happy-app.
 *
 * Note: App-specific types (Profile, friendTypes, feedTypes) remain local
 * and are NOT re-exported here. Only protocol update/ephemeral schemas are shared.
 *
 * @see https://linear.app/enflame-media/issue/HAP-385
 */

import { z } from 'zod';
import { GitHubProfileSchema as LocalGitHubProfileSchema, ImageRefSchema as LocalImageRefSchema } from './profile';
import { RelationshipStatusSchema as LocalRelationshipStatusSchema, UserProfileSchema as LocalUserProfileSchema } from './friendTypes';
import { FeedBodySchema as LocalFeedBodySchema } from './feedTypes';

// ============================================================================
// Re-export protocol schemas from @happy/protocol
// ============================================================================

export {
    // Message schemas and types
    ApiMessageSchema,
    type ApiMessage,
    ApiUpdateNewMessageSchema,
    type ApiUpdateNewMessage,
    ApiDeleteSessionSchema,
    type ApiDeleteSession,

    // Session schemas and types
    ApiUpdateNewSessionSchema,
    type ApiUpdateNewSession,
    ApiUpdateSessionStateSchema,
    type ApiUpdateSessionState,

    // Machine schemas and types
    ApiNewMachineSchema,
    type ApiNewMachine,
    ApiUpdateMachineStateSchema,
    type ApiUpdateMachineState,

    // Artifact schemas and types
    ApiNewArtifactSchema,
    type ApiNewArtifact,
    ApiUpdateArtifactSchema,
    type ApiUpdateArtifact,
    ApiDeleteArtifactSchema,
    type ApiDeleteArtifact,

    // Account schemas and types
    ApiUpdateAccountSchema,
    type ApiUpdateAccount,

    // Misc schemas and types
    ApiRelationshipUpdatedSchema,
    type ApiRelationshipUpdated,
    ApiNewFeedPostSchema,
    type ApiNewFeedPost,
    ApiKvBatchUpdateSchema,
    type ApiKvBatchUpdate,

    // Main update union
    ApiUpdateSchema,
    type ApiUpdate,
    type ApiUpdateType,

    // Ephemeral events
    ApiEphemeralActivityUpdateSchema,
    type ApiEphemeralActivityUpdate,
    ApiEphemeralUsageUpdateSchema,
    type ApiEphemeralUsageUpdate,
    ApiEphemeralMachineActivityUpdateSchema,
    type ApiEphemeralMachineActivityUpdate,
    ApiEphemeralMachineStatusUpdateSchema,
    type ApiEphemeralMachineStatusUpdate,
    ApiEphemeralUpdateSchema,
    type ApiEphemeralUpdate,
    type ApiEphemeralUpdateType,

    // Payload wrappers
    ApiUpdateContainerSchema,
    type ApiUpdateContainer,
    UpdatePayloadSchema,
    type UpdatePayload,
    EphemeralPayloadSchema,
    type EphemeralPayload,

    // Common types from protocol (for protocol-level validation)
    EncryptedContentSchema,
    type EncryptedContent,
    VersionedValueSchema,
    type VersionedValue,
    NullableVersionedValueSchema,
    type NullableVersionedValue,
} from '@happy/protocol';

// ============================================================================
// App-specific type aliases (for backward compatibility)
//
// These use the app's local definitions which have stricter requirements
// than the protocol-level schemas. The local schemas are used for
// UI rendering and storage, while protocol schemas are used for validation.
// ============================================================================

export const GitHubProfileSchema = LocalGitHubProfileSchema;
export type GitHubProfile = z.infer<typeof LocalGitHubProfileSchema>;

export const ImageRefSchema = LocalImageRefSchema;
export type ImageRef = z.infer<typeof LocalImageRefSchema>;

export const RelationshipStatusSchema = LocalRelationshipStatusSchema;
export type RelationshipStatus = z.infer<typeof LocalRelationshipStatusSchema>;

export const UserProfileSchema = LocalUserProfileSchema;
export type UserProfile = z.infer<typeof LocalUserProfileSchema>;

export const FeedBodySchema = LocalFeedBodySchema;
export type FeedBody = z.infer<typeof LocalFeedBodySchema>;
