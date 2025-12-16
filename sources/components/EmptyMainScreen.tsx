import React from 'react';
import { View, Text, Platform, ScrollView } from 'react-native';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { OnboardingIllustration } from '@/components/OnboardingIllustration';
import Ionicons from '@expo/vector-icons/Ionicons';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 32,
        paddingHorizontal: 24,
    },
    illustrationContainer: {
        marginBottom: 24,
    },
    welcomeTitle: {
        marginBottom: 8,
        textAlign: 'center',
        fontSize: 28,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    welcomeSubtitle: {
        marginBottom: 32,
        textAlign: 'center',
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.textSecondary,
        maxWidth: 320,
        ...Typography.default(),
    },
    terminalBlock: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        width: '100%',
        maxWidth: 300,
    },
    terminalText: {
        ...Typography.mono(),
        fontSize: 14,
        color: theme.colors.status.connected,
    },
    terminalTextFirst: {
        marginBottom: 6,
    },
    stepsContainer: {
        marginBottom: 32,
        width: '100%',
        maxWidth: 280,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    stepRowLast: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stepNumber: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    stepNumberText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    stepText: {
        flex: 1,
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    buttonsContainer: {
        alignItems: 'center',
        width: '100%',
    },
    buttonWrapper: {
        width: 260,
        marginBottom: 12,
    },
    buttonWrapperSecondary: {
        width: 260,
    },
    featuresContainer: {
        marginTop: 32,
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        width: '100%',
        maxWidth: 320,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    featureIcon: {
        marginRight: 12,
    },
    featureText: {
        flex: 1,
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
}));

export function EmptyMainScreen() {
    const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
    const { theme } = useUnistyles();
    const styles = stylesheet;

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
        >
            {/* Illustration */}
            <View style={styles.illustrationContainer}>
                <OnboardingIllustration size={160} />
            </View>

            {/* Welcome text */}
            <Text style={styles.welcomeTitle}>
                {t('components.emptyMainScreen.welcomeTitle')}
            </Text>
            <Text style={styles.welcomeSubtitle}>
                {t('components.emptyMainScreen.welcomeSubtitle')}
            </Text>

            {/* Terminal-style code block */}
            <View style={styles.terminalBlock}>
                <Text style={[styles.terminalText, styles.terminalTextFirst]}>
                    $ npm i -g happy-coder
                </Text>
                <Text style={styles.terminalText}>
                    $ happy
                </Text>
            </View>

            {Platform.OS !== 'web' && (
                <>
                    <View style={styles.stepsContainer}>
                        <View style={styles.stepRow}>
                            <View style={styles.stepNumber}>
                                <Text style={styles.stepNumberText}>1</Text>
                            </View>
                            <Text style={styles.stepText}>
                                {t('components.emptyMainScreen.installCli')}
                            </Text>
                        </View>
                        <View style={styles.stepRow}>
                            <View style={styles.stepNumber}>
                                <Text style={styles.stepNumberText}>2</Text>
                            </View>
                            <Text style={styles.stepText}>
                                {t('components.emptyMainScreen.runIt')}
                            </Text>
                        </View>
                        <View style={styles.stepRowLast}>
                            <View style={styles.stepNumber}>
                                <Text style={styles.stepNumberText}>3</Text>
                            </View>
                            <Text style={styles.stepText}>
                                {t('components.emptyMainScreen.scanQrCode')}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.buttonsContainer}>
                        <View style={styles.buttonWrapper}>
                            <RoundButton
                                title={t('components.emptyMainScreen.scanQrToConnect')}
                                size="large"
                                loading={isLoading}
                                onPress={connectTerminal}
                            />
                        </View>
                        <View style={styles.buttonWrapperSecondary}>
                            <RoundButton
                                title={t('connect.enterUrlManually')}
                                size="normal"
                                display="inverted"
                                onPress={async () => {
                                    const url = await Modal.prompt(
                                        t('modals.authenticateTerminal'),
                                        t('modals.pasteUrlFromTerminal'),
                                        {
                                            placeholder: 'happy://terminal?...',
                                            cancelText: t('common.cancel'),
                                            confirmText: t('common.authenticate')
                                        }
                                    );

                                    if (url?.trim()) {
                                        connectWithUrl(url.trim());
                                    }
                                }}
                            />
                        </View>
                    </View>

                    {/* Feature highlights */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.featureRow}>
                            <Ionicons
                                name="lock-closed"
                                size={18}
                                color={theme.colors.status.connected}
                                style={styles.featureIcon}
                            />
                            <Text style={styles.featureText}>
                                {t('components.emptyMainScreen.featureEncryption')}
                            </Text>
                        </View>
                        <View style={styles.featureRow}>
                            <Ionicons
                                name="phone-portrait"
                                size={18}
                                color={theme.colors.status.connected}
                                style={styles.featureIcon}
                            />
                            <Text style={styles.featureText}>
                                {t('components.emptyMainScreen.featureRemoteControl')}
                            </Text>
                        </View>
                        <View style={styles.featureRow}>
                            <Ionicons
                                name="sync"
                                size={18}
                                color={theme.colors.status.connected}
                                style={styles.featureIcon}
                            />
                            <Text style={styles.featureText}>
                                {t('components.emptyMainScreen.featureRealtime')}
                            </Text>
                        </View>
                    </View>
                </>
            )}
        </ScrollView>
    );
}
