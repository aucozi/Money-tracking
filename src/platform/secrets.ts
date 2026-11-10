import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Where bank credentials are kept: the device keychain on a phone. They are
 * never written into the app's dataset, so they are not in backups or exports.
 * A browser has no keychain, so the web build falls back to its own storage.
 */
const key = (name: string) => `waypoint.secret.${name.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function saveSecret(name: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key(name), value);
    return;
  }
  await SecureStore.setItemAsync(key(name), value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function readSecret(name: string): Promise<string | null> {
  if (Platform.OS === 'web') return window.localStorage.getItem(key(name));
  return SecureStore.getItemAsync(key(name));
}

export async function deleteSecret(name: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key(name));
    return;
  }
  await SecureStore.deleteItemAsync(key(name));
}
