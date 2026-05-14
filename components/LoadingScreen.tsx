import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Theme } from '../constants/theme';
import { Lock } from 'lucide-react-native';

export const LoadingScreen = ({ onFinish }: { onFinish: () => void }) => {
  const fullText = "Bhildiamant";
  const [displayedText, setDisplayedText] = useState("");
  const fadeAnim = new Animated.Value(0);

  useEffect(() => {
    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    // Typing effect
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < fullText.length) {
        setDisplayedText(fullText.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(interval);
        setTimeout(onFinish, 1500); // Wait a bit after typing is done
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoContainer, { opacity: fadeAnim }]}>
        <View style={styles.logoCircle}>
          <Lock size={40} color={Theme.colors.primary} />
        </View>
      </Animated.View>
      
      <Text style={styles.text}>{displayedText}</Text>
      
      <View style={styles.indicatorContainer}>
        <View style={styles.indicator} />
      </View>
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
  logoContainer: {
    marginBottom: 30,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
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
