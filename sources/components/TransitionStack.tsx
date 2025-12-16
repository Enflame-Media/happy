import "react-native-reanimated";
import { createNativeStackNavigator } from "react-native-screen-transitions/native-stack";
import type { ParamListBase, StackNavigationState } from "@react-navigation/native";
import type { NativeStackNavigationEventMap, NativeStackNavigationOptions } from "react-native-screen-transitions/native-stack";
import { withLayoutContext } from "expo-router";

const TransitionableStack = createNativeStackNavigator();

export const Stack = withLayoutContext<
	NativeStackNavigationOptions,
	typeof TransitionableStack.Navigator,
	StackNavigationState<ParamListBase>,
	NativeStackNavigationEventMap
>(TransitionableStack.Navigator);