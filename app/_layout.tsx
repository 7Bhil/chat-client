import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-get-random-values';
import 'text-encoding-polyfill';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '../utils/AuthContext';
import { registerForPushNotificationsAsync } from '../utils/notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, GreatVibes_400Regular } from '@expo-google-fonts/great-vibes';
import { LoadingScreen } from '../components/LoadingScreen';
import { useState } from 'react';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { isAuthenticated, isLoading, session } = useAuth();
  const [isAnimationDone, setIsAnimationDone] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    GreatVibes_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded && !isLoading && isAnimationDone) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoading, isAnimationDone]);

  useEffect(() => {
    if (isLoading || !isAnimationDone) return;

    const isAuthRoute = segments[0] === '(tabs)' || segments[0] === 'chat';
    const isPublicRoute = segments[0] === 'login' || segments[0] === 'signup';

    if (!isAuthenticated && isAuthRoute) {
      // Redirige vers login si non connecté mais essaie d'accéder à (tabs) ou chat
      router.replace('/login');
    } else if (isAuthenticated && isPublicRoute) {
      // Redirige vers l'accueil si connecté mais essaie d'accéder aux pages publiques
      router.replace('/(tabs)');
    }

    if (isAuthenticated && session?.user) {
      registerForPushNotificationsAsync(session.user.id);
    }
  }, [isAuthenticated, segments, isLoading, session]);

  if (!fontsLoaded || !isAnimationDone) {
    return <LoadingScreen onFinish={() => setIsAnimationDone(true)} />;
  }

  if (isLoading) return <LoadingScreen onFinish={() => setIsAnimationDone(true)} />;

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

