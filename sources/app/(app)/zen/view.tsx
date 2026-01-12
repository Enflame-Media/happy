import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

// HAP-851: Zen is experimental - lazy load component
const ZenView = React.lazy(() => import('@/trash/experimental/-zen/ZenView').then(m => ({ default: m.ZenView })));

function ZenViewScreen() {
    const { theme } = useUnistyles();
    return (
        <React.Suspense fallback={<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={theme.colors.textSecondary} /></View>}>
            <ZenView />
        </React.Suspense>
    );
}

export default React.memo(ZenViewScreen);
