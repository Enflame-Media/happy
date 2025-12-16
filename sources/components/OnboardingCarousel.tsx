import * as React from 'react';
import { View, Text, ScrollView, Dimensions, Pressable, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t, type TranslationKey } from '@/text';
import { OnboardingIllustration } from '@/components/OnboardingIllustration';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate } from 'react-native-reanimated';

interface OnboardingSlide {
    id: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: TranslationKey;
    description: TranslationKey;
    illustration?: boolean;
}

interface OnboardingCarouselProps {
    onComplete: () => void;
}

const SLIDES: OnboardingSlide[] = [
    {
        id: 'welcome',
        icon: 'sparkles',
        title: 'onboarding.welcomeTitle',
        description: 'onboarding.welcomeDescription',
        illustration: true,
    },
    {
        id: 'scan',
        icon: 'qr-code',
        title: 'onboarding.scanTitle',
        description: 'onboarding.scanDescription',
    },
    {
        id: 'control',
        icon: 'terminal',
        title: 'onboarding.controlTitle',
        description: 'onboarding.controlDescription',
    },
    {
        id: 'voice',
        icon: 'mic',
        title: 'onboarding.voiceTitle',
        description: 'onboarding.voiceDescription',
    },
    {
        id: 'start',
        icon: 'rocket',
        title: 'onboarding.startTitle',
        description: 'onboarding.startDescription',
    },
];

/**
 * Animated dot indicator for the carousel pagination.
 * Scales and changes opacity based on whether it's the active slide.
 */
const PaginationDot = React.memo(({ isActive }: { isActive: boolean }) => {
    const { theme } = useUnistyles();
    const scale = useSharedValue(isActive ? 1 : 0.7);
    const opacity = useSharedValue(isActive ? 1 : 0.4);

    React.useEffect(() => {
        scale.value = withTiming(isActive ? 1 : 0.7, { duration: 200 });
        opacity.value = withTiming(isActive ? 1 : 0.4, { duration: 200 });
    }, [isActive, scale, opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
        opacity: opacity.value,
        backgroundColor: theme.colors.button.primary.background,
    }));

    return <Animated.View style={[styles.dot, animatedStyle]} />;
});

PaginationDot.displayName = 'PaginationDot';

/**
 * Single slide component rendering icon/illustration, title, and description.
 */
const Slide = React.memo(({ slide, width }: { slide: OnboardingSlide; width: number }) => {
    const { theme } = useUnistyles();

    return (
        <View style={[styles.slide, { width }]}>
            <View style={styles.slideContent}>
                {slide.illustration ? (
                    <OnboardingIllustration size={180} />
                ) : (
                    <View style={[styles.iconContainer, { backgroundColor: theme.colors.button.primary.background + '20' }]}>
                        <Ionicons
                            name={slide.icon}
                            size={64}
                            color={theme.colors.button.primary.background}
                        />
                    </View>
                )}
                <Text style={styles.slideTitle}>
                    {t(slide.title)}
                </Text>
                <Text style={styles.slideDescription}>
                    {t(slide.description)}
                </Text>
            </View>
        </View>
    );
});

Slide.displayName = 'Slide';

/**
 * Onboarding carousel component shown on first app launch.
 * Features swipeable slides with pagination dots, skip button, and next/get started button.
 */
export const OnboardingCarousel = React.memo(({ onComplete }: OnboardingCarouselProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const scrollViewRef = React.useRef<ScrollView>(null);
    const { width: screenWidth } = Dimensions.get('window');

    const handleScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / screenWidth);
        setCurrentIndex(index);
    }, [screenWidth]);

    const handleNext = React.useCallback(() => {
        if (currentIndex < SLIDES.length - 1) {
            scrollViewRef.current?.scrollTo({
                x: (currentIndex + 1) * screenWidth,
                animated: true,
            });
        } else {
            onComplete();
        }
    }, [currentIndex, screenWidth, onComplete]);

    const isLastSlide = currentIndex === SLIDES.length - 1;

    return (
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {/* Skip button */}
            <View style={styles.header}>
                <Pressable onPress={onComplete} style={styles.skipButton}>
                    <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
                </Pressable>
            </View>

            {/* Carousel */}
            <ScrollView
                ref={scrollViewRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={handleScroll}
                decelerationRate="fast"
                bounces={false}
                style={styles.scrollView}
            >
                {SLIDES.map((slide) => (
                    <Slide key={slide.id} slide={slide} width={screenWidth} />
                ))}
            </ScrollView>

            {/* Bottom section: pagination and button */}
            <View style={styles.footer}>
                {/* Pagination dots */}
                <View style={styles.pagination}>
                    {SLIDES.map((slide, index) => (
                        <PaginationDot key={slide.id} isActive={index === currentIndex} />
                    ))}
                </View>

                {/* Next / Get Started button */}
                <Pressable
                    onPress={handleNext}
                    style={[styles.button, { backgroundColor: theme.colors.button.primary.background }]}
                >
                    <Text style={[styles.buttonText, { color: theme.colors.button.primary.tint }]}>
                        {isLastSlide ? t('onboarding.getStarted') : t('onboarding.next')}
                    </Text>
                    {!isLastSlide && (
                        <Ionicons
                            name="arrow-forward"
                            size={20}
                            color={theme.colors.button.primary.tint}
                            style={styles.buttonIcon}
                        />
                    )}
                </Pressable>
            </View>
        </View>
    );
});

OnboardingCarousel.displayName = 'OnboardingCarousel';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    skipButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    skipText: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    scrollView: {
        flex: 1,
    },
    slide: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    slideContent: {
        alignItems: 'center',
        maxWidth: 320,
    },
    iconContainer: {
        width: 120,
        height: 120,
        borderRadius: 60,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 32,
    },
    slideTitle: {
        ...Typography.default('semiBold'),
        fontSize: 24,
        color: theme.colors.text,
        textAlign: 'center',
        marginTop: 24,
        marginBottom: 16,
    },
    slideDescription: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
    },
    footer: {
        paddingHorizontal: 32,
        paddingVertical: 24,
        alignItems: 'center',
    },
    pagination: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 24,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginHorizontal: 4,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 12,
        minWidth: 200,
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 18,
    },
    buttonIcon: {
        marginLeft: 8,
    },
}));
