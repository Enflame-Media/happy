import * as React from 'react';

export function useAsyncCommand(command: () => Promise<void>) {
    const [state, setState] = React.useState(false);
    const stateRef = React.useRef(state);
    const execute = React.useCallback(async () => {

        // Guard
        if (stateRef.current) {
            return;
        }
        stateRef.current = true;
        setState(true);

        // Execution
        try {
            await command();
        } finally {
            stateRef.current = false;
            setState(false);
        }
    }, [command]);

    return [state, execute] as const;
}