// ─────────────────────────────────────────────────────────────────────────
// groupPhotos.js
//
// Group photo gallery management. Mirrors profilePhotos.js.
//   - pickAndUploadGroupPhoto({ groupId, source })          → upload one photo
//   - pickAndUploadMultipleGroupPhotos({ groupId, maxCount }) → pick many, upload all
//   - fetchGroupPhotos(groupId)                             → list a group's photos
//   - deleteGroupPhoto(photoId, storagePath)                → remove one
//
// Storage layout: bucket `group-photos`, key `{group_id}/{photo_id}.jpg`
// DB: rows in public.photos with owner_kind='group', owner_id=group_id.
//
// Write access (storage + photos row) is gated server-side by is_group_admin()
// — only the owner/admins of a group can add or remove its photos.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { stripExif } from './imageSanitize';

const BUCKET = 'group-photos';
export const MAX_GROUP_PHOTOS = 12;

// Simple uuid v4 generator — avoids pulling in a dep just for this.
function uuid() {
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
// Single image (camera or library with crop editor).
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
      const sanitized = await stripExif(asset.uri, { maxWidth: 2048, compress: 0.85 });
      return { uri: sanitized.uri, base64: sanitized.base64 };
}

// Multi-image library picker. allowsEditing is incompatible with
// allowsMultipleSelection, so no crop editor.
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
    const sanitized = await stripExif(asset.uri, { maxWidth: 2048, compress: 0.85 });
    picked.push({ uri: sanitized.uri, base64: sanitized.base64 });
  }
  return picked;
}

// Public URL with cache-buster (RN image cache otherwise shows stale images).
export function publicUrlForGroupPhoto(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ── Upload + insert ────────────────────────────────────────────────────────
async function uploadOne(groupId, picked) {
  let base64 = picked.base64;
  if (!base64) {
    if (Platform.OS === 'web') throw new Error('Could not read image data.');
    base64 = await FileSystem.readAsStringAsync(picked.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const arrayBuffer = decode(base64);

  const photoId = uuid();
  const path = `${groupId}/${photoId}.jpg`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '3600',
    });
  if (upErr) throw upErr;

  // Next sort_order = append to end.
  const { data: existing, error: cntErr } = await supabase
    .from('photos')
    .select('id')
    .eq('owner_kind', 'group')
    .eq('owner_id', groupId);
  if (cntErr) {
    // Roll back the orphaned storage object.
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw cntErr;
  }
  const nextOrder = existing?.length ?? 0;

  const { data: row, error: insErr } = await supabase
    .from('photos')
    .insert({
      owner_kind: 'group',
      owner_id: groupId,
      storage_path: path,
      sort_order: nextOrder,
    })
    .select('id, storage_path, sort_order, created_at')
    .single();
  if (insErr) {
    // Best-effort cleanup so we don't leak storage objects.
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw insErr;
  }

  return { ...row, url: publicUrlForGroupPhoto(path) };
}

/**
 * Pick one photo from camera or library and add it to a group's gallery.
 * Server-side RLS rejects the upload unless the caller is the group owner/admin.
 * @returns {Promise<{ photo: object | null, error: Error | null }>}
 */
export async function pickAndUploadGroupPhoto({ groupId, source = 'library' }) {
  if (!groupId) return { photo: null, error: new Error('Missing group id') };
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

    const photo = await uploadOne(groupId, picked);
    return { photo, error: null };
  } catch (e) {
    return { photo: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Pick multiple photos from the library and upload them all to a group's gallery.
 * maxCount caps how many the OS picker allows the user to select.
 * Uploads sequentially to keep sort_order consistent.
 * Server-side RLS rejects if caller is not the group owner/admin.
 *
 * @returns {Promise<{ photos: object[], errors: Error[], cancelled: boolean }>}
 */
export async function pickAndUploadMultipleGroupPhotos({ groupId, maxCount }) {
  if (!groupId) return { photos: [], errors: [new Error('Missing group id')], cancelled: false };
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
        const photo = await uploadOne(groupId, picked);
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
 * Pick an image WITHOUT uploading it. Used by the Create Group flow, where the
 * group (and therefore its id / storage path) doesn't exist yet — the picked
 * image is held in memory and uploaded with uploadGroupPhoto() once the group
 * has been created.
 * @returns {Promise<{ picked: {uri,base64}|null, error: Error|null }>}
 *          picked === null with error === null means the user cancelled.
 */
export async function pickGroupImage(source = 'library') {
  try {
    const granted = await ensurePermission(source);
    if (!granted) {
      return {
        picked: null,
        error: new Error(
          source === 'camera'
            ? 'Camera permission denied. Enable it in Settings.'
            : 'Photo library permission denied. Enable it in Settings.'
        ),
      };
    }
    const picked = await pickImage(source);
    return { picked, error: null };
  } catch (e) {
    return { picked: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Upload an already-picked image (from pickGroupImage) to a group's gallery.
 * Server-side RLS rejects the upload unless the caller is the group owner/admin.
 * @returns {Promise<{ photo: object|null, error: Error|null }>}
 */
export async function uploadGroupPhoto(groupId, picked) {
  if (!groupId) return { photo: null, error: new Error('Missing group id') };
  if (!picked)  return { photo: null, error: new Error('No image selected') };
  try {
    const photo = await uploadOne(groupId, picked);
    return { photo, error: null };
  } catch (e) {
    return { photo: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Fetch a group's photos, ordered. Returns [{ id, storage_path, url, sort_order }].
 * RLS allows public read on the photos table.
 */
export async function fetchGroupPhotos(groupId) {
  if (!groupId) return { photos: [], error: null };
  const { data, error } = await supabase
    .from('photos')
    .select('id, storage_path, sort_order, created_at')
    .eq('owner_kind', 'group')
    .eq('owner_id', groupId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { photos: [], error };
  const photos = (data ?? []).map((r) => ({
    ...r,
    url: publicUrlForGroupPhoto(r.storage_path),
  }));
  return { photos, error: null };
}

/**
 * Delete one group photo: remove the storage object + DB row.
 * RLS (photos table + storage) guarantees only owner/admins can delete.
 */
export async function deleteGroupPhoto(photoId, storagePath) {
  if (!photoId) return { error: new Error('Missing photo id') };
  if (storagePath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (rmErr) {
      console.warn('[groupPhotos] storage remove failed', rmErr.message);
    }
  }
  const { error } = await supabase.from('photos').delete().eq('id', photoId);
  return { error };
}

/**
 * Bulk-delete every storage object for a group. Used right before delete_group
 * so we don't leave orphaned files in the bucket (the RPC only clears DB rows).
 */
export async function purgeGroupPhotoStorage(groupId) {
  if (!groupId) return { error: null };
  const { photos, error } = await fetchGroupPhotos(groupId);
  if (error) return { error };
  const paths = (photos ?? []).map((p) => p.storage_path).filter(Boolean);
  if (paths.length === 0) return { error: null };
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
  return { error: rmErr ?? null };
}
