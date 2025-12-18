import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { useRealtimeStatus } from '@/sync/storage';
import { StatusDot } from './StatusDot';
import { Typography } from '@/constants/Typography';
import Ionicons from '@expo/vector-icons/Ionicons';
import { stopRealtimeSession } from '@/realtime/RealtimeSession';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface VoiceAssistantStatusBarProps {
    /**
     * Display variant:
     * - 'full': Full-width status bar (legacy mobile)
     * - 'sidebar': Compact bar for sidebar
     * - 'floating': Minimal floating pill indicator (default)
     */
    variant?: 'full' | 'sidebar' | 'floating';
    style?: any;
}

interface StatusInfo {
    color: string;
    backgroundColor: string;
    isPulsing: boolean;
    text: string;
    shortText: string;
    textColor: string;
    iconName: 'mic' | 'mic-outline' | 'alert-circle';
}

/**
 * VoiceAssistantStatusBar - A minimal floating indicator for voice assistant status.
 *
 * HAP-313: Redesigned as a floating pill that:
 * - Takes minimal vertical space
 * - Shows voice state (active, listening, speaking)
 * - Tappable to expand/show controls
 * - Smooth transitions when voice starts/stops
 *
 * Supports three variants:
 * - 'floating' (default): Minimal pill that expands on tap
 * - 'full': Legacy full-width bar
 * - 'sidebar': Compact sidebar version
 */
export const VoiceAssistantStatusBar = React.memo(({ variant = 'floating', style }: VoiceAssistantStatusBarProps) => {
    const { theme } = useUnistyles();
    const realtimeStatus = useRealtimeStatus();
    const [isExpanded, setIsExpanded] = React.useState(false);

    // Animation values for floating variant
    const expandedWidth = useSharedValue(0);
    const contentOpacity = useSharedValue(0);

    // Don't render if disconnected
    if (realtimeStatus === 'disconnected') {
        return null;
    }

    const getStatusInfo = (): StatusInfo => {
        switch (realtimeStatus) {
            case 'connecting':
                return {
                    color: theme.colors.status.connecting,
                    backgroundColor: theme.colors.surfaceHighest,
                    isPulsing: true,
                    text: t('voiceStatus.connecting'),
                    shortText: '',
                    textColor: theme.colors.text,
                    iconName: 'mic-outline',
                };
            case 'connected':
                return {
                    color: theme.colors.status.connected,
                    backgroundColor: theme.colors.surfaceHighest,
                    isPulsing: false,
                    text: t('voiceStatus.active'),
                    shortText: t('voiceStatus.activeShort'),
                    textColor: theme.colors.text,
                    iconName: 'mic',
                };
            case 'error':
                return {
                    color: theme.colors.status.error,
                    backgroundColor: theme.colors.surfaceHighest,
                    isPulsing: false,
                    text: t('voiceStatus.connectionError'),
                    shortText: t('voiceStatus.errorShort'),
                    textColor: theme.colors.text,
                    iconName: 'alert-circle',
                };
            default:
                return {
                    color: theme.colors.status.default,
                    backgroundColor: theme.colors.surfaceHighest,
                    isPulsing: false,
                    text: t('voiceStatus.default'),
                    shortText: '',
                    textColor: theme.colors.text,
                    iconName: 'mic',
                };
        }
    };

    const statusInfo = getStatusInfo();

    const handleStopVoice = async () => {
        if (realtimeStatus === 'connected' || realtimeStatus === 'connecting') {
            try {
                await stopRealtimeSession();
            } catch (error) {
                console.error('Error stopping voice session:', error);
            }
        }
    };

    const handleToggleExpand = () => {
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);

        if (newExpanded) {
            expandedWidth.value = withSpring(120, { damping: 15, stiffness: 150 });
            contentOpacity.value = withTiming(1, { duration: 150 });
        } else {
            expandedWidth.value = withSpring(0, { damping: 15, stiffness: 150 });
            contentOpacity.value = withTiming(0, { duration: 100 });
        }
    };

    const handleFloatingPress = () => {
        handleToggleExpand();
    };

    const handleFloatingLongPress = () => {
        handleStopVoice();
    };

    // Animated styles for floating variant
    const animatedExpandStyle = useAnimatedStyle(() => ({
        width: expandedWidth.value,
        opacity: contentOpacity.value,
    }));

    // Floating variant - minimal pill indicator
    if (variant === 'floating') {
        return (
            <View style={[styles.floatingContainer, style]}>
                <Pressable
                    onPress={handleFloatingPress}
                    onLongPress={handleFloatingLongPress}
                    delayLongPress={500}
                    style={({ pressed }) => [
                        styles.floatingPill,
                        { backgroundColor: statusInfo.backgroundColor },
                        pressed && styles.floatingPillPressed,
                    ]}
                    hitSlop={8}
                >
                    <StatusDot
                        color={statusInfo.color}
                        isPulsing={statusInfo.isPulsing}
                        size={10}
                        showGlow
                    />
                    <Ionicons
                        name={statusInfo.iconName}
                        size={16}
                        color={statusInfo.textColor}
                        style={styles.floatingMicIcon}
                    />

                    {/* Expandable content */}
                    <Animated.View style={[styles.floatingExpandedContent, animatedExpandStyle]}>
                        <Text
                            style={[styles.floatingStatusText, { color: statusInfo.textColor }]}
                            numberOfLines={1}
                        >
                            {statusInfo.shortText || statusInfo.text}
                        </Text>
                        <Pressable
                            onPress={handleStopVoice}
                            style={styles.floatingCloseButton}
                            hitSlop={8}
                        >
                            <Ionicons
                                name="close-circle"
                                size={18}
                                color={statusInfo.textColor}
                            />
                        </Pressable>
                    </Animated.View>
                </Pressable>
            </View>
        );
    }

    // Full variant - Legacy full-width version
    if (variant === 'full') {
        return (
            <View style={{
                backgroundColor: statusInfo.backgroundColor,
                height: 32,
                width: '100%',
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 16,
            }}>
                <Pressable
                    onPress={handleStopVoice}
                    style={{
                        height: 32,
                        width: '100%',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                    hitSlop={10}
                >
                    <View style={styles.content}>
                        <View style={styles.leftSection}>
                            <StatusDot
                                color={statusInfo.color}
                                isPulsing={statusInfo.isPulsing}
                                size={8}
                                style={styles.statusDot}
                            />
                            <Ionicons
                                name="mic"
                                size={16}
                                color={statusInfo.textColor}
                                style={styles.micIcon}
                            />
                            <Text style={[
                                styles.statusText,
                                { color: statusInfo.textColor }
                            ]}>
                                {statusInfo.text}
                            </Text>
                        </View>

                        <View style={styles.rightSection}>
                            <Text style={[styles.tapToEndText, { color: statusInfo.textColor }]}>
                                {t('voiceStatus.tapToEnd')}
                            </Text>
                        </View>
                    </View>
                </Pressable>
            </View>
        );
    }

    // Sidebar variant
    const containerStyle = [
        styles.container,
        styles.sidebarContainer,
        {
            backgroundColor: statusInfo.backgroundColor,
        },
        style
    ];

    return (
        <View style={containerStyle}>
            <Pressable
                onPress={handleStopVoice}
                style={styles.pressable}
                hitSlop={5}
            >
                <View style={styles.content}>
                    <View style={styles.leftSection}>
                        <StatusDot
                            color={statusInfo.color}
                            isPulsing={statusInfo.isPulsing}
                            size={8}
                            style={styles.statusDot}
                        />
                        <Ionicons
                            name="mic"
                            size={16}
                            color={statusInfo.textColor}
                            style={styles.micIcon}
                        />
                        <Text style={[
                            styles.statusText,
                            styles.sidebarStatusText,
                            { color: statusInfo.textColor }
                        ]}>
                            {statusInfo.text}
                        </Text>
                    </View>

                    <Ionicons
                        name="close"
                        size={14}
                        color={statusInfo.textColor}
                        style={styles.closeIcon}
                    />
                </View>
            </Pressable>
        </View>
    );
});

const styles = StyleSheet.create({
    // Floating variant styles
    floatingContainer: {
        position: 'absolute',
        top: 8,
        right: 12,
        zIndex: 1000,
    },
    floatingPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    floatingPillPressed: {
        opacity: 0.8,
    },
    floatingMicIcon: {
        marginLeft: 6,
    },
    floatingExpandedContent: {
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    floatingStatusText: {
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 8,
        ...Typography.default(),
    },
    floatingCloseButton: {
        marginLeft: 8,
    },
    // Legacy full/sidebar styles
    container: {
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        borderRadius: 0,
        marginHorizontal: 0,
        marginVertical: 0,
    },
    fullContainer: {
        justifyContent: 'flex-end',
    },
    sidebarContainer: {
    },
    pressable: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        paddingHorizontal: 12,
    },
    leftSection: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    rightSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        marginRight: 6,
    },
    micIcon: {
        marginRight: 6,
    },
    closeIcon: {
        marginLeft: 8,
    },
    statusText: {
        fontSize: 14,
        fontWeight: '500',
        ...Typography.default(),
    },
    sidebarStatusText: {
        fontSize: 12,
    },
    tapToEndText: {
        fontSize: 12,
        fontWeight: '400',
        opacity: 0.8,
        ...Typography.default(),
    },
});
