import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

// HAP-851: Zen is experimental - lazy load component
const ZenHome = React.lazy(() => import('@/trash/experimental/-zen/ZenHome').then(m => ({ default: m.ZenHome })));

function ZenScreen() {
    const { theme } = useUnistyles();
    return (
        <React.Suspense fallback={<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={theme.colors.textSecondary} /></View>}>
            <ZenHome />
        </React.Suspense>
    );
}

export default React.memo(ZenScreen);