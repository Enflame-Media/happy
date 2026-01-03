import * as React from 'react';
import { Modal } from '@/modal';
import { t } from '@/text';
import { AppError } from '@/utils/errors';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useSessionRevival } from '@/hooks/useSessionRevival';

export function useHappyAction(action: () => Promise<void>) {
    const { showError, getErrorMessage } = useErrorHandler();
    const { handleRpcError } = useSessionRevival();
    const [loading, setLoading] = React.useState(false);
    const loadingRef = React.useRef(false);
    const doAction = React.useCallback(() => {
        if (loadingRef.current) {
            return;
        }
        loadingRef.current = true;
        setLoading(true);
        (async () => {
            try {
                while (true) {
                    try {
                        await action();
                        break;
                    } catch (e) {
                        if (AppError.isAppError(e) && e.canTryAgain) {
                            // Retryable errors: Ask user if they want to retry
                            // Use getErrorMessage for the confirm dialog (keeps retry UX)
                            const errorMessage = getErrorMessage(e);
                            const shouldRetry = await Modal.confirm(t('common.error'), errorMessage, {
                                cancelText: t('common.cancel'),
                                confirmText: t('common.retry'),
                            });
                            if (!shouldRetry) {
                                break;
                            }
                            // User chose to retry - continue the while loop
                        } else {
                            // HAP-743: Check for SESSION_REVIVAL_FAILED before showing generic error
                            // If handleRpcError returns true, the revival dialog was shown
                            if (handleRpcError(e)) {
                                break;
                            }
                            // HAP-544: Non-retryable errors use showError for "Copy ID" button
                            showError(e);
                            break;
                        }
                    }
                }
            } finally {
                loadingRef.current = false;
                setLoading(false);
            }
        })();
    }, [action, showError, getErrorMessage, handleRpcError]);
    return [loading, doAction] as const;
}