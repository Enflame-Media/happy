import React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { t } from '@/text';
import { getSupportId } from '@/utils/errors';

/**
 * Props for the ErrorBoundary component.
 */
interface ErrorBoundaryProps {
    /** Child components to render within the boundary */
    children: React.ReactNode;
    /** Optional name for logging/identification purposes */
    name?: string;
    /** Optional custom fallback UI component */
    fallback?: React.ReactNode;
}

/**
 * State for the ErrorBoundary component.
 */
interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * ErrorBoundary - A React class component that catches JavaScript errors in child components.
 *
 * Error boundaries are class components because React only supports getDerivedStateFromError
 * and componentDidCatch lifecycle methods in class components (not hooks).
 *
 * Features:
 * - Catches errors in child component tree
 * - Displays a user-friendly error message with retry option
 * - Logs errors to console for debugging
 * - Prevents entire app from crashing when a section fails
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary name="Settings">
 *     <SettingsComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    /**
     * Static lifecycle method called when an error is thrown.
     * Updates state to trigger fallback UI rendering.
     */
    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    /**
     * Lifecycle method called after an error has been thrown.
     * Used for logging errors.
     */
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        const boundaryName = this.props.name || 'Unknown';
        console.error(`[ErrorBoundary:${boundaryName}] Error caught:`, error);
        console.error(`[ErrorBoundary:${boundaryName}] Component stack:`, errorInfo.componentStack);
    }

    /**
     * Resets the error state to allow retry.
     */
    handleRetry = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): React.ReactNode {
        if (this.state.hasError) {
            // Custom fallback provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default fallback UI with retry option
            // HAP-525: Include Support ID for error tracing
            const supportId = getSupportId();

            return (
                <View style={styles.container}>
                    <Text style={styles.title}>{t('components.errorBoundary.title')}</Text>
                    <Text style={styles.message}>{t('components.errorBoundary.message')}</Text>
                    <Text style={styles.supportId}>
                        {t('components.errorBoundary.supportId', { id: supportId })}
                    </Text>
                    <View style={styles.buttonContainer}>
                        <RoundButton
                            title={t('common.retry')}
                            size="normal"
                            onPress={this.handleRetry}
                        />
                    </View>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: theme.colors.groupped.background,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 12,
        maxWidth: 300,
    },
    supportId: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
        opacity: 0.7,
    },
    buttonContainer: {
        width: 160,
    },
}));
