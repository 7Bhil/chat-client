import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Theme } from '../constants/theme';
import { Lock } from 'lucide-react-native';

export const LoadingScreen = ({ onFinish, overlay = false, speed = 150 }: { onFinish?: () => void, overlay?: boolean, speed?: number }) => {
  const fullText = "Bhildiamant";
  const [displayedText, setDisplayedText] = useState("");
  const fadeAnim = new Animated.Value(0);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < fullText.length) {
        setDisplayedText(fullText.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(interval);
        // Garantit que l'animation est vue en entier avant de libérer l'écran
        setTimeout(() => {
          if (onFinish) onFinish();
        }, 500);
      }
    }, speed);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={[styles.container, overlay && styles.overlay]}>
      <Animated.View style={[styles.logoContainer, { opacity: fadeAnim }]}>
        <View style={styles.logoCircle}>
          <Lock size={overlay ? 30 : 40} color={Theme.colors.primary} />
        </View>
      </Animated.View>
      
      <Text style={[styles.text, overlay && { fontSize: 32 }]}>{displayedText}</Text>
      
      {!overlay && (
        <View style={styles.indicatorContainer}>
          <View style={styles.indicator} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 9999,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
  },
  text: {
    fontFamily: 'GreatVibes_400Regular',
    fontSize: 42,
    color: Theme.colors.primary,
    textAlign: 'center',
  },
  indicatorContainer: {
    marginTop: 20,
    height: 2,
    width: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  indicator: {
    height: '100%',
    width: '30%',
    backgroundColor: Theme.colors.primary,
    borderRadius: 1,
  }
});
