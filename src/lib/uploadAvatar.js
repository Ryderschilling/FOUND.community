// ─────────────────────────────────────────────────────────────────────────
// uploadAvatar.js
//
// Picks a photo (camera or library), uploads it to the Supabase `avatars`
// storage bucket at {userId}/avatar.jpg, and writes the public URL onto
// profiles.avatar_url for the signed-in user.
//
// Returns { url, error }.
//   url   — cache-busted public URL on success (null on failure)
//   error — Error|null
//
// Cache-busting: Supabase serves the same path with `upsert:true`, so without
// a query string React Native's image cache will keep showing the old photo.
// We append `?v={epoch_ms}` to the returned URL.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { stripExif } from './imageSanitize';

const BUCKET = 'avatars';
const FILE_NAME = 'avatar.jpg';

// Ask for permission to use camera or library. Returns true if granted.
// On web, the file input doesn't require runtime permission — return true.
async function ensurePermission(source) {
  if (Platform.OS === 'web') return true;
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  }
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

// Launch the picker. Returns { uri, base64 } or null if cancelled.
// We always request base64 so we have a single cross-platform code path for
// upload (no need to read from disk via expo-file-system on web).
async function pickImage(source) {
  const opts = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],          // square crop for avatars
    quality: 0.8,            // ~80% JPEG quality
    base64: true,            // <-- key: works on both web and native
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

      if (result.canceled) return null;
      const asset = result.assets?.[0];
      if (!asset) return null;
      const sanitized = await stripExif(asset.uri, { maxWidth: 1024, compress: 0.8 });
      return { uri: sanitized.uri, base64: sanitized.base64 };
    }

// Upload picked image to Supabase Storage and update the profile row.
async function uploadToSupabase(userId, picked) {
  // Prefer the base64 from the picker (cross-platform). On native, fall back
  // to reading from disk if the picker didn't include base64 for any reason.
  let base64 = picked.base64;
  if (!base64) {
    if (Platform.OS === 'web') {
      throw new Error('Could not read image data.');
    }
    base64 = await FileSystem.readAsStringAsync(picked.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const arrayBuffer = decode(base64);

  const path = `${userId}/${FILE_NAME}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    });
  if (uploadErr) throw uploadErr;

  // Build public URL + cache-buster
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;

  // Persist to profiles.avatar_url
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId);
  if (updateErr) throw updateErr;

  return url;
}

/**
 * Full flow: permission → pick → upload → DB update.
 * @param {{ userId: string, source: 'camera' | 'library' }} args
 * @returns {Promise<{ url: string | null, error: Error | null }>}
 */
export async function pickAndUploadAvatar({ userId, source = 'library' }) {
  if (!userId) return { url: null, error: new Error('Not signed in') };

  try {
    const granted = await ensurePermission(source);
    if (!granted) {
      return {
        url: null,
        error: new Error(
          source === 'camera'
            ? 'Camera permission denied. Enable it in Settings.'
            : 'Photo library permission denied. Enable it in Settings.'
        ),
      };
    }

    const picked = await pickImage(source);
    if (!picked) return { url: null, error: null }; // user cancelled — not an error

    const url = await uploadToSupabase(userId, picked);
    return { url, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
