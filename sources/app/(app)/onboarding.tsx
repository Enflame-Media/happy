import * as React from 'react';
import { useRouter } from 'expo-router';
import { OnboardingCarousel } from '@/components/OnboardingCarousel';
import { storage } from '@/sync/storage';

/**
 * Onboarding screen displayed on first app launch.
 * Shows a carousel explaining key features, then marks onboarding as complete
 * and navigates to the main app.
 */
function OnboardingScreen() {
    const router = useRouter();

    const handleComplete = React.useCallback(() => {
        // Mark onboarding as seen so it won't show again
        storage.getState().applyLocalSettings({ hasSeenOnboarding: true });
        // Navigate back to the main screen
        router.replace('/');
    }, [router]);

    return <OnboardingCarousel onComplete={handleComplete} />;
}

export default React.memo(OnboardingScreen);
