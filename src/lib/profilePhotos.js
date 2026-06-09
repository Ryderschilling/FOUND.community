// ─────────────────────────────────────────────────────────────────────────
// profilePhotos.js
//
// Multi-photo "Highlight Reel" management:
//   - pickAndUploadProfilePhoto({ userId, source })           → upload one photo (camera)
//   - pickAndUploadMultipleProfilePhotos({ userId, maxCount }) → pick many, upload all
//   - fetchProfilePhotos(profileId)                           → list a profile's photos
//   - deleteProfilePhoto(photoId, storagePath)                → remove one
//   - reorderProfilePhotos(ids[])                             → persist a new order
//
// Storage layout: bucket `profile-photos`, key `{user_id}/{uuid}.jpg`
// DB: rows in public.photos with owner_kind='profile', owner_id=user_id.
//
// Public bucket → URLs are constructed via supabase.storage.getPublicUrl,
// with `?v={epoch}` cache-buster appended so RN's image cache doesn't show
// a stale image after re-upload at the same path.
// ─────────────────────────────────────────────────────────────────────────

import { stripExif } from './imageSanitize';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const BUCKET = 'profile-photos';
export const MAX_PHOTOS = 3; // 3-photo cap (reduced from 9 to control storage/data)

// Simple uuid v4 generator — avoids pulling in a dep just for this.
// Good enough for storage path collision avoidance.
function uuid() {
  // RFC4122-ish; not cryptographically rigorous.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Permissions ────────────────────────────────────────────────────────────
async function ensurePermission(source) {
  if (Platform.OS === 'web') return true;
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  }
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

// ── Picker ─────────────────────────────────────────────────────────────────
// Single image (camera, or library fallback). Has crop editor.
// Returns { uri, base64 } or null if cancelled.
async function pickImage(source) {
  const opts = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
    base64: true,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

      if (result.canceled) return null;
      const asset = result.assets?.[0];
      if (!asset) return null;
      const sanitized = await stripExif(asset.uri, { maxWidth: 1200, compress: 0.72 });
      return { uri: sanitized.uri, base64: sanitized.base64 };
    }

// Multi-image library picker. allowsEditing is incompatible with
// allowsMultipleSelection, so no crop editor — user selects and we take as-is.
// Returns array of { uri, base64 }, or null if cancelled.
async function pickMultipleImages(maxCount) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
    quality: 0.8,
    base64: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const picked = [];
  for (const asset of result.assets) {
    const sanitized = await stripExif(asset.uri, { maxWidth: 1200, compress: 0.72 });
    picked.push({ uri: sanitized.uri, base64: sanitized.base64 });
  }
  return picked;
}

// ── Upload + insert ────────────────────────────────────────────────────────
async function uploadOne(userId, picked) {
  let base64 = picked.base64;
  if (!base64) {
    if (Platform.OS === 'web') throw new Error('Could not read image data.');
    base64 = await FileSystem.readAsStringAsync(picked.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const arrayBuffer = decode(base64);

  // Per-photo unique filename so multiple photos coexist
  const photoId = uuid();
  const path = `${userId}/${photoId}.jpg`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '3600',
    });
  if (upErr) throw upErr;

  // Determine next sort_order (append to end). Cheap query — RLS scoped to user's rows.
  const { data: existing, error: cntErr } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: false })
    .eq('owner_kind', 'profile')
    .eq('owner_id', userId);
  if (cntErr) throw cntErr;
  const nextOrder = (existing?.length ?? 0);

  const { data: row, error: insErr } = await supabase
    .from('photos')
    .insert({
      owner_kind: 'profile',
      owner_id: userId,
      storage_path: path,
      sort_order: nextOrder,
    })
    .select('id, storage_path, sort_order, created_at')
    .single();
  if (insErr) {
    // Best-effort cleanup on insert failure so we don't leak storage objects
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw insErr;
  }

  return { ...row, url: publicUrlFor(path) };
}

// Public URL with cache-buster
export function publicUrlFor(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Pick one photo from camera or library and upload to the highlight reel.
 * @returns {Promise<{ photo: object | null, error: Error | null }>}
 */
export async function pickAndUploadProfilePhoto({ userId, source = 'library' }) {
  if (!userId) return { photo: null, error: new Error('Not signed in') };
  try {
    const granted = await ensurePermission(source);
    if (!granted) {
      return {
        photo: null,
        error: new Error(
          source === 'camera'
            ? 'Camera permission denied. Enable it in Settings.'
            : 'Photo library permission denied. Enable it in Settings.'
        ),
      };
    }
    const picked = await pickImage(source);
    if (!picked) return { photo: null, error: null }; // user cancelled

    const photo = await uploadOne(userId, picked);
    return { photo, error: null };
  } catch (e) {
    return { photo: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Pick multiple photos from the library and upload them all to the highlight reel.
 * maxCount caps how many the OS picker will allow the user to select.
 * Uploads sequentially to keep sort_order consistent.
 *
 * @returns {Promise<{ photos: object[], errors: Error[], cancelled: boolean }>}
 *   photos  — successfully uploaded photo rows
 *   errors  — per-photo upload errors (non-fatal; others still upload)
 *   cancelled — true if the user dismissed the picker without selecting
 */
export async function pickAndUploadMultipleProfilePhotos({ userId, maxCount }) {
  if (!userId) return { photos: [], errors: [new Error('Not signed in')], cancelled: false };
  try {
    const granted = await ensurePermission('library');
    if (!granted) {
      return {
        photos: [],
        errors: [new Error('Photo library permission denied. Enable it in Settings.')],
        cancelled: false,
      };
    }
    const pickedList = await pickMultipleImages(maxCount);
    if (!pickedList) return { photos: [], errors: [], cancelled: true };

    const photos = [];
    const errors = [];
    for (const picked of pickedList) {
      try {
        const photo = await uploadOne(userId, picked);
        photos.push(photo);
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return { photos, errors, cancelled: false };
  } catch (e) {
    return { photos: [], errors: [e instanceof Error ? e : new Error(String(e))], cancelled: false };
  }
}

/**
 * Fetch photos for any profile. Returns an array of { id, storage_path, url, sort_order }.
 * Uses a direct select against `photos` (RLS allows public read).
 */
export async function fetchProfilePhotos(profileId) {
  if (!profileId) return { photos: [], error: null };
  const { data, error } = await supabase
    .from('photos')
    .select('id, storage_path, sort_order, created_at')
    .eq('owner_kind', 'profile')
    .eq('owner_id', profileId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { photos: [], error };
  const photos = (data ?? []).map((r) => ({ ...r, url: publicUrlFor(r.storage_path) }));
  return { photos, error: null };
}

/**
 * Delete one photo: remove the storage object + DB row.
 * RLS guarantees only the owner can delete.
 */
export async function deleteProfilePhoto(photoId, storagePath) {
  if (!photoId) return { error: new Error('Missing photo id') };
  // Storage delete first; if DB delete fails we can re-upload, but a phantom
  // DB row pointing at a missing object would render a broken image.
  if (storagePath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (rmErr) {
      // Log but continue — bucket may already be cleared
      console.warn('[profilePhotos] storage remove failed', rmErr.message);
    }
  }
  const { error } = await supabase.from('photos').delete().eq('id', photoId);
  return { error };
}

/**
 * Persist a new order. Pass photo IDs in display order.
 */
export async function reorderProfilePhotos(ids) {
  if (!ids?.length) return { error: null };
  const { error } = await supabase.rpc('reorder_profile_photos', { p_ids: ids });
  return { error };
}
