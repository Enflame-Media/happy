import * as React from 'react';
import { View, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type LottieViewType from 'lottie-react-native';
import type { AnimationObject } from 'lottie-react-native';

/**
 * Available Lottie animations for lazy loading.
 * Each animation is loaded on-demand to reduce initial bundle parse time.
 */
export type AnimationName = 'game' | 'owl' | 'popcorn' | 'robot' | 'sparkles' | 'stone';

/**
 * Animation JSON import loaders - dynamic imports ensure code splitting.
 * These are only evaluated when the animation is actually rendered.
 */
const animationLoaders: Record<AnimationName, () => Promise<{ default: AnimationObject }>> = {
    game: () => import('@/assets/animations/game.json'),
    owl: () => import('@/assets/animations/owl.json'),
    popcorn: () => import('@/assets/animations/popcorn.json'),
    robot: () => import('@/assets/animations/robot.json'),
    sparkles: () => import('@/assets/animations/sparkles.json'),
    stone: () => import('@/assets/animations/stone.json'),
};

interface LazyLottieProps {
    /** Name of the animation to load */
    name: AnimationName;
    /** Width and height of the animation container */
    size?: number;
    /** Style for the container view */
    style?: StyleProp<ViewStyle>;
    /** Whether the animation should loop (default: true) */
    loop?: boolean;
    /** Whether to auto-play the animation (default: true) */
    autoPlay?: boolean;
    /** Animation speed multiplier (default: 1) */
    speed?: number;
    /** Custom fallback component while loading */
    fallback?: React.ReactNode;
}

/**
 * LazyLottie - A wrapper component for lazy-loading Lottie animations.
 *
 * This component ensures that:
 * 1. LottieView library is loaded only when needed
 * 2. Animation JSON files are loaded only when the component renders
 * 3. A fallback is shown while both the library and animation load
 *
 * Usage:
 * ```tsx
 * <LazyLottie name="robot" size={100} />
 * <LazyLottie name="sparkles" size={64} loop={false} />
 * ```
 */
export const LazyLottie = React.memo<LazyLottieProps>(({
    name,
    size = 100,
    style,
    loop = true,
    autoPlay = true,
    speed = 1,
    fallback,
}) => {
    const { theme } = useUnistyles();
    const [LottieView, setLottieView] = React.useState<typeof LottieViewType | null>(null);
    const [animationData, setAnimationData] = React.useState<AnimationObject | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<Error | null>(null);

    React.useEffect(() => {
        let isMounted = true;

        const loadAnimation = async () => {
            try {
                // Load LottieView component and animation data in parallel
                const [lottieModule, animationModule] = await Promise.all([
                    import('lottie-react-native'),
                    animationLoaders[name](),
                ]);

                if (!isMounted) return;

                setLottieView(() => lottieModule.default);
                setAnimationData(animationModule.default);
                setIsLoading(false);
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err : new Error('Failed to load animation'));
                setIsLoading(false);
            }
        };

        loadAnimation();

        return () => {
            isMounted = false;
        };
    }, [name]);

    const containerStyle = React.useMemo(() => [
        stylesheet.container,
        { width: size, height: size },
        style,
    ], [size, style]);

    // Loading state - show fallback or default loading indicator
    if (isLoading) {
        return (
            <View style={containerStyle}>
                {fallback ?? (
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.textSecondary}
                    />
                )}
            </View>
        );
    }

    // Error state - silently render empty view
    if (error || !LottieView || !animationData) {
        return <View style={containerStyle} />;
    }

    // Render the loaded animation
    return (
        <View style={containerStyle}>
            <LottieView
                source={animationData}
                style={stylesheet.lottie}
                autoPlay={autoPlay}
                loop={loop}
                speed={speed}
            />
        </View>
    );
});

LazyLottie.displayName = 'LazyLottie';

const stylesheet = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    lottie: {
        width: '100%',
        height: '100%',
    },
});
