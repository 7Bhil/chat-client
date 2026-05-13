import { Platform } from 'react-native';

export const Fonts = {
  rounded: Platform.OS === 'ios' ? 'System' : 'sans-serif-rounded',
  mono: Platform.OS === 'ios' ? 'Courier' : 'monospace',
};

export const Theme = {
  colors: {
    background: '#0B0E11',
    surface: '#15191C',
    primary: '#00E5FF', // Neon Cyan
    secondary: '#7000FF', // Vivid Purple
    text: '#FFFFFF',
    textSecondary: '#94A3B8',
    border: '#1E293B',
    success: '#10B981',
    error: '#EF4444',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 16,
    xl: 24,
    full: 9999,
  }
};

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: Theme.colors.primary,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: Theme.colors.primary,
  },
  dark: {
    text: '#ECEDEE',
    background: Theme.colors.background,
    tint: Theme.colors.primary,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: Theme.colors.primary,
  },
};


