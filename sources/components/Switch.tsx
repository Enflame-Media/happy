import { Platform, Switch as RNSwitch, SwitchProps } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Deferred } from './Deferred';

export interface CustomSwitchProps extends SwitchProps {
    accessibilityLabel?: string;
    accessibilityHint?: string;
}

export const Switch = (props: CustomSwitchProps) => {
    const { theme } = useUnistyles();
    const { accessibilityLabel, accessibilityHint, ...switchProps } = props;

    return (
        <Deferred enabled={Platform.OS === 'android'}>
            <RNSwitch
                {...switchProps}
                trackColor={{ false: theme.colors.switch.track.inactive, true: theme.colors.switch.track.active }}
                ios_backgroundColor={theme.colors.switch.track.inactive}
                thumbColor={theme.colors.switch.thumb.active}
                accessibilityRole="switch"
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={accessibilityHint}
                accessibilityState={{
                    checked: switchProps.value,
                    disabled: switchProps.disabled,
                }}
                {...{
                    activeThumbColor: theme.colors.switch.thumb.active,
                }}
            />
        </Deferred>
    );
}