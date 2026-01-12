import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

// HAP-851: Zen is experimental - lazy load component
const ZenAdd = React.lazy(() => import('@/trash/experimental/-zen/ZenAdd').then(m => ({ default: m.ZenAdd })));

function NewZenTodoScreen() {
    const { theme } = useUnistyles();
    return (
        <React.Suspense fallback={<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={theme.colors.textSecondary} /></View>}>
            <ZenAdd />
        </React.Suspense>
    );
}

export default React.memo(NewZenTodoScreen);
