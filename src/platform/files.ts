import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Hand a text file to the person: a download in the browser, the share sheet
 * on a phone (save to Files, AirDrop, mail and so on).
 */
export async function saveTextFile(name: string, contents: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([contents], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name, UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json' });
}

/** Let the person choose a text file and read it. Resolves null if they cancel. */
export async function pickTextFile(types: string[]): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web') {
    const source = result.output?.[0];
    const text = source ? await source.text() : await (await fetch(asset.uri)).text();
    return { name: asset.name, text };
  }
  return { name: asset.name, text: await new File(asset.uri).text() };
}
