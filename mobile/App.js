import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/context/AuthContext';
import { SyncProvider } from './src/context/SyncContext';
import AppNavigator from './src/navigation/AppNavigator';
import DeviceWrapper from './src/components/DeviceWrapper';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SyncProvider>
          <DeviceWrapper>
            <NavigationContainer>
              <StatusBar style="dark" />
              <AppNavigator />
            </NavigationContainer>
          </DeviceWrapper>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

