import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useRouter } from 'expo-router';
import { t } from '@/text';
import { OnboardingIllustration } from '@/components/OnboardingIllustration';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 48,
    },
    illustrationContainer: {
        marginBottom: 24,
    },
    iconContainer: {
        marginBottom: 24,
    },
    titleText: {
        fontSize: 22,
        color: theme.colors.text,
        textAlign: 'center',
        marginBottom: 8,
        ...Typography.default('semiBold'),
    },
    descriptionText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 24,
        maxWidth: 320,
        ...Typography.default(),
    },
    button: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    buttonDisabled: {
        backgroundColor: theme.colors.textSecondary,
        opacity: 0.6,
    },
    buttonIcon: {
        marginRight: 8,
    },
    buttonText: {
        fontSize: 16,
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    featuresRow: {
        flexDirection: 'row',
        marginTop: 32,
        gap: 24,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    featureIcon: {
        marginRight: 8,
    },
    featureText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));

export function EmptySessionsTablet() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const machines = useAllMachines();

    const hasOnlineMachines = React.useMemo(() => {
        return machines.some(machine => isMachineOnline(machine));
    }, [machines]);

    const hasMachines = machines.length > 0;

    const handleStartNewSession = () => {
        router.push('/new');
    };

    // Show onboarding-style view if no machines connected yet
    if (!hasMachines) {
        return (
            <View style={styles.container}>
                <View style={styles.illustrationContainer}>
                    <OnboardingIllustration size={140} />
                </View>

                <Text style={styles.titleText}>
                    {t('components.emptySessionsTablet.welcomeTitle')}
                </Text>

                <Text style={styles.descriptionText}>
                    {t('components.emptySessionsTablet.welcomeDescription')}
                </Text>

                <View style={styles.featuresRow}>
                    <View style={styles.featureItem}>
                        <Ionicons
                            name="lock-closed"
                            size={14}
                            color={theme.colors.status.connected}
                            style={styles.featureIcon}
                        />
                        <Text style={styles.featureText}>
                            {t('components.emptySessionsTablet.featureEncrypted')}
                        </Text>
                    </View>
                    <View style={styles.featureItem}>
                        <Ionicons
                            name="sync"
                            size={14}
                            color={theme.colors.status.connected}
                            style={styles.featureIcon}
                        />
                        <Text style={styles.featureText}>
                            {t('components.emptySessionsTablet.featureRealtime')}
                        </Text>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Ionicons
                name="terminal-outline"
                size={64}
                color={theme.colors.textSecondary}
                style={styles.iconContainer}
            />

            <Text style={styles.titleText}>
                {t('components.emptySessionsTablet.noActiveSessions')}
            </Text>

            {hasOnlineMachines ? (
                <>
                    <Text style={styles.descriptionText}>
                        {t('components.emptySessionsTablet.startSessionOnMachine')}
                    </Text>
                    <Pressable
                        style={styles.button}
                        onPress={handleStartNewSession}
                    >
                        <Ionicons
                            name="add"
                            size={20}
                            color={theme.colors.button.primary.tint}
                            style={styles.buttonIcon}
                        />
                        <Text style={styles.buttonText}>
                            {t('components.emptySessionsTablet.startNewSession')}
                        </Text>
                    </Pressable>
                </>
            ) : (
                <Text style={styles.descriptionText}>
                    {t('components.emptySessionsTablet.openTerminalToStart')}
                </Text>
            )}
        </View>
    );
}