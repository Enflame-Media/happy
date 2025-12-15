import * as React from 'react';
import { PermissionMode, ModelMode } from '../PermissionModeSelector';
import { Metadata } from '@/sync/storageTypes';

/**
 * Props for the main AgentInput component
 */
export interface AgentInputProps {
    value: string;
    placeholder: string;
    onChangeText: (text: string) => void;
    sessionId?: string;
    onSend: () => void;
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    isMicActive?: boolean;
    permissionMode?: PermissionMode;
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode;
    onModelModeChange?: (mode: ModelMode) => void;
    metadata?: Metadata | null;
    onAbort?: () => void | Promise<void>;
    showAbortButton?: boolean;
    connectionStatus?: {
        text: string;
        color: string;
        dotColor: string;
        isPulsing?: boolean;
    };
    autocompletePrefixes: string[];
    autocompleteSuggestions: (query: string) => Promise<{ key: string, text: string, component: React.ElementType }[]>;
    usageData?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
    };
    alwaysShowContextSize?: boolean;
    onFileViewerPress?: () => void;
    agentType?: 'claude' | 'codex';
    onAgentClick?: () => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    isSendDisabled?: boolean;
    isSending?: boolean;
    minHeight?: number;
}

/**
 * Props for the StatusDisplay component
 */
export interface StatusDisplayProps {
    connectionStatus?: AgentInputProps['connectionStatus'];
    contextWarning: { text: string; color: string } | null;
    permissionMode?: PermissionMode;
    isCodex: boolean;
}

/**
 * Props for the SettingsOverlay component
 */
export interface SettingsOverlayProps {
    visible: boolean;
    onClose: () => void;
    isCodex: boolean;
    permissionMode?: PermissionMode;
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode;
    onModelModeChange?: (mode: ModelMode) => void;
    screenWidth: number;
}

/**
 * Props for the ActionButtons component
 */
export interface ActionButtonsProps {
    // Settings
    onSettingsPress?: () => void;

    // Agent selector
    agentType?: 'claude' | 'codex';
    onAgentClick?: () => void;

    // Machine selector
    machineName?: string | null;
    onMachineClick?: () => void;

    // Path selector
    currentPath?: string | null;
    onPathClick?: () => void;

    // Abort
    onAbort?: () => void | Promise<void>;
    isAborting: boolean;
    onAbortPress: () => void;

    // Git status
    sessionId?: string;
    onFileViewerPress?: () => void;

    // Send button
    hasText: boolean;
    isSending?: boolean;
    isSendDisabled?: boolean;
    onSendPress: () => void;
    onMicPress?: () => void;
    isMicActive?: boolean;
}

/**
 * Context warning return type
 */
export interface ContextWarning {
    text: string;
    color: string;
}
