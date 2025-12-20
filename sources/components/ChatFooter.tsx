import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import Ionicons from '@expo/vector-icons/Ionicons';

interface ChatFooterProps {
    controlledByUser?: boolean;
}

export const ChatFooter = React.memo((props: ChatFooterProps) => {
    return (
        <View style={styles.container}>
            {props.controlledByUser && (
                <View style={styles.warningContainer}>
                    <Ionicons
                        name="information-circle"
                        size={16}
                        color={styles.warningText.color}
                    />
                    <Text style={styles.warningText}>
                        Permissions shown in terminal only. Reset or send a message to control from app.
                    </Text>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        paddingTop: 4,
        paddingBottom: 2,
    },
    warningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 4,
        backgroundColor: theme.colors.box.warning.background,
        borderRadius: 8,
        marginHorizontal: 32,
        marginTop: 4,
    },
    warningText: {
        fontSize: 12,
        color: theme.colors.box.warning.text,
        marginLeft: 6,
        ...Typography.default()
    },
}));
