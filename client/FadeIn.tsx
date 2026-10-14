import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Platform } from "react-native";

/** Fades its children in while sliding them up a few pixels, once, when mounted. */
export function FadeIn({ children, gap }: { children: ReactNode; gap?: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  }, [progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={{ gap, opacity: progress, transform: [{ translateY }] }}>{children}</Animated.View>;
}
