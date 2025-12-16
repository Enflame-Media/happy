import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect, Circle, Line, G } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

interface OnboardingIllustrationProps {
    size?: number;
}

/**
 * Illustration showing a terminal window connected to a mobile phone via encrypted connection.
 * Used in the empty state screens to guide new users through the onboarding process.
 * Adapts to light/dark themes automatically.
 */
export const OnboardingIllustration: React.FC<OnboardingIllustrationProps> = React.memo(({
    size = 200,
}) => {
    const { theme } = useUnistyles();

    // Colors that adapt to theme
    const colors = {
        terminal: {
            frame: theme.dark ? '#2C2C2E' : '#1E1E1E',
            screen: theme.dark ? '#1C1C1E' : '#282A36',
            titleBar: theme.dark ? '#3A3A3C' : '#21222C',
            button: {
                red: '#FF5F56',
                yellow: '#FFBD2E',
                green: '#27CA40',
            },
            text: theme.colors.status.connected,
            cursor: theme.colors.status.connected,
        },
        phone: {
            frame: theme.dark ? '#48484A' : '#333333',
            screen: theme.colors.surface,
            notch: theme.dark ? '#2C2C2E' : '#1E1E1E',
        },
        connection: {
            line: theme.colors.status.connected,
            dot: theme.colors.status.connected,
        },
        lock: {
            body: theme.colors.status.connected,
        },
    };

    const aspectRatio = 1.2; // width/height
    const width = size * aspectRatio;
    const height = size;

    return (
        <View style={{ width, height }}>
            <Svg width={width} height={height} viewBox="0 0 240 200">
                {/* Terminal Window (left side) */}
                <G transform="translate(10, 30)">
                    {/* Terminal frame */}
                    <Rect
                        x="0"
                        y="0"
                        width="100"
                        height="80"
                        rx="6"
                        fill={colors.terminal.frame}
                    />
                    {/* Title bar */}
                    <Rect
                        x="0"
                        y="0"
                        width="100"
                        height="16"
                        rx="6"
                        fill={colors.terminal.titleBar}
                    />
                    <Rect
                        x="0"
                        y="10"
                        width="100"
                        height="6"
                        fill={colors.terminal.titleBar}
                    />
                    {/* Traffic light buttons */}
                    <Circle cx="10" cy="8" r="3" fill={colors.terminal.button.red} />
                    <Circle cx="20" cy="8" r="3" fill={colors.terminal.button.yellow} />
                    <Circle cx="30" cy="8" r="3" fill={colors.terminal.button.green} />
                    {/* Terminal screen */}
                    <Rect
                        x="4"
                        y="20"
                        width="92"
                        height="56"
                        rx="2"
                        fill={colors.terminal.screen}
                    />
                    {/* Terminal text lines (simulated commands) */}
                    <Rect x="8" y="26" width="6" height="3" rx="1" fill={colors.terminal.text} />
                    <Rect x="16" y="26" width="35" height="3" rx="1" fill={colors.terminal.text} opacity={0.7} />
                    <Rect x="8" y="34" width="6" height="3" rx="1" fill={colors.terminal.text} />
                    <Rect x="16" y="34" width="20" height="3" rx="1" fill={colors.terminal.text} opacity={0.7} />
                    {/* Blinking cursor */}
                    <Rect x="8" y="42" width="6" height="3" rx="1" fill={colors.terminal.text} />
                    <Rect x="16" y="42" width="4" height="8" fill={colors.terminal.cursor} opacity={0.8} />
                </G>

                {/* Connection line with dots (encrypted) */}
                <G transform="translate(110, 60)">
                    {/* Dashed line */}
                    <Line
                        x1="10"
                        y1="25"
                        x2="60"
                        y2="25"
                        stroke={colors.connection.line}
                        strokeWidth="2"
                        strokeDasharray="4,4"
                        opacity={0.6}
                    />
                    {/* Small lock icon in the middle */}
                    <G transform="translate(28, 15)">
                        {/* Lock body */}
                        <Rect
                            x="0"
                            y="8"
                            width="14"
                            height="12"
                            rx="2"
                            fill={colors.lock.body}
                        />
                        {/* Lock shackle */}
                        <Path
                            d="M3 8 V5 C3 2 4 0 7 0 C10 0 11 2 11 5 V8"
                            stroke={colors.lock.body}
                            strokeWidth="2.5"
                            fill="none"
                        />
                        {/* Keyhole */}
                        <Circle cx="7" cy="14" r="2" fill={colors.terminal.screen} />
                    </G>
                </G>

                {/* Mobile Phone (right side) */}
                <G transform="translate(170, 25)">
                    {/* Phone frame */}
                    <Rect
                        x="0"
                        y="0"
                        width="50"
                        height="90"
                        rx="8"
                        fill={colors.phone.frame}
                    />
                    {/* Phone screen */}
                    <Rect
                        x="3"
                        y="10"
                        width="44"
                        height="70"
                        rx="2"
                        fill={colors.phone.screen}
                    />
                    {/* Notch/Dynamic Island */}
                    <Rect
                        x="15"
                        y="3"
                        width="20"
                        height="5"
                        rx="2.5"
                        fill={colors.phone.notch}
                    />
                    {/* Home indicator */}
                    <Rect
                        x="17"
                        y="84"
                        width="16"
                        height="3"
                        rx="1.5"
                        fill={colors.phone.notch}
                    />
                    {/* Content on phone screen - session preview */}
                    <G transform="translate(7, 18)">
                        {/* Chat bubbles / content indicators */}
                        <Rect x="0" y="0" width="28" height="6" rx="3" fill={colors.connection.line} opacity={0.3} />
                        <Rect x="8" y="10" width="28" height="6" rx="3" fill={colors.connection.line} opacity={0.5} />
                        <Rect x="0" y="20" width="20" height="6" rx="3" fill={colors.connection.line} opacity={0.3} />
                        <Rect x="4" y="30" width="32" height="6" rx="3" fill={colors.connection.line} opacity={0.5} />
                        {/* QR scan icon hint */}
                        <G transform="translate(10, 42)">
                            <Rect x="0" y="0" width="16" height="16" rx="2" fill="none" stroke={colors.connection.line} strokeWidth="1.5" />
                            <Rect x="3" y="3" width="4" height="4" fill={colors.connection.line} opacity={0.6} />
                            <Rect x="9" y="3" width="4" height="4" fill={colors.connection.line} opacity={0.6} />
                            <Rect x="3" y="9" width="4" height="4" fill={colors.connection.line} opacity={0.6} />
                            <Rect x="9" y="9" width="4" height="4" fill={colors.connection.line} opacity={0.6} />
                        </G>
                    </G>
                </G>

                {/* Small decorative dots around the illustration */}
                <Circle cx="130" cy="150" r="3" fill={colors.connection.dot} opacity={0.3} />
                <Circle cx="145" cy="160" r="2" fill={colors.connection.dot} opacity={0.2} />
                <Circle cx="115" cy="155" r="2" fill={colors.connection.dot} opacity={0.2} />
            </Svg>
        </View>
    );
});

OnboardingIllustration.displayName = 'OnboardingIllustration';
