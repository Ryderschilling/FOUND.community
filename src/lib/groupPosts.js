// ─────────────────────────────────────────────────────────────────────────
// groupPosts.js
//
// Group activity feed — posts (text + optional photo) by members/admins.
//   - fetchGroupPosts(groupId)                       → list a group's posts
//   - createGroupPost({ groupId, body, photoUrl })   → add one post
//   - deleteGroupPost(postId, photoUrl)              → remove a post + photo
//   - pickGroupPostImage(source)                     → pick (no upload yet)
//   - uploadGroupPostPhoto(groupId, picked)          → upload, returns URL
//   - purgeGroupPostPhotoStorage(groupId)            → bulk cleanup
//
// Storage layout: bucket `group-post-photos`, key `{group_id}/{photo_id}.jpg`.
// The post row stores the FULL public URL in group_posts.photo_url.
//
// Write access (posts + storage) is gated server-side by is_group_member()
// — any member of a group may post; the author or an admin may delete.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { checkText } from './contentFilter';
import { stripExif } from './imageSanitize';

const BUCKET = 'group-post-photos';
export const MAX_POST_BODY = 3000;

// Preset emoji reactions (iMessage-style). Kept short + tappable — the picker
// is a single row. 👍 and 🔥 requested by Sam; the rest are the common set.
export const POST_REACTIONS = ['👍', '❤️', '🙏', '🔥', '🎉', '😂'];

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
// Returns { uri, base64 } or null if cancelled. Free crop — a post photo can
// be any shape; the feed renders it within a fixed-aspect frame.
async function pickImage(source) {
  const opts = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
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

// Derive the storage object key from a stored public URL.
// `…/object/public/group-post-photos/{group}/{id}.jpg?v=123` → `{group}/{id}.jpg`
function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return url.slice(i + marker.length).split('?')[0];
}

// ── Upload ─────────────────────────────────────────────────────────────────
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

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Pick an image WITHOUT uploading. Lets the composer show a preview before
 * the post is submitted; the upload happens on submit.
 * @returns {Promise<{ picked: {uri,base64}|null, error: Error|null }>}
 *          picked === null with error === null means the user cancelled.
 */
export async function pickGroupPostImage(source = 'library') {
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
 * Upload an already-picked image to the group's post-photo bucket.
 * @returns {Promise<{ url: string|null, error: Error|null }>}
 */
export async function uploadGroupPostPhoto(groupId, picked) {
  if (!groupId) return { url: null, error: new Error('Missing group id') };
  if (!picked)  return { url: null, error: new Error('No image selected') };
  try {
    const url = await uploadOne(groupId, picked);
    return { url, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Fetch a group's activity feed (newest first).
 * Returns rows from the group_posts_feed RPC, each with author info +
 * a can_delete flag.
 * @returns {Promise<{ posts: object[], error: Error|null }>}
 */
export async function fetchGroupPosts(groupId) {
  if (!groupId) return { posts: [], error: null };
  const { data, error } = await supabase.rpc('group_posts_feed', { p_group: groupId });
  if (error) return { posts: [], error };
  return { posts: data ?? [], error: null };
}

/**
 * Create a post. Body and/or photoUrl — at least one is required.
 * Server-side RLS rejects this unless the caller is a group member.
 * @returns {Promise<{ id: string|null, error: Error|null }>}
 */
export async function createGroupPost({ groupId, body = null, photoUrl = null }) {
  if (!groupId) return { id: null, error: new Error('Missing group id') };
  const trimmed = (body ?? '').trim();
  if (!trimmed && !photoUrl) {
    return { id: null, error: new Error('Post must have text or a photo') };
  }
  const violation = checkText(trimmed, 'post');
  if (!violation.ok) {
    return { id: null, error: new Error(violation.message) };
  }
  const { data, error } = await supabase.rpc('create_group_post', {
    p_group:     groupId,
    p_body:      trimmed || null,
    p_photo_url: photoUrl || null,
  });
  if (error) return { id: null, error };
  return { id: data ?? null, error: null };
}

/**
 * Edit the body of a post. Only the original author can do this.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function updateGroupPost(postId, body) {
  if (!postId) return { error: new Error('Missing post id') };
  const trimmed = (body ?? '').trim();
  if (!trimmed) return { error: new Error('Post body cannot be empty') };
  const violation = checkText(trimmed, 'post');
  if (!violation.ok) return { error: new Error(violation.message) };
  const { error } = await supabase.rpc('update_group_post', { p_post: postId, p_body: trimmed });
  return { error: error ?? null };
}

/**
 * Delete a post: removes the DB row (RPC, gated to author/admin) and then
 * best-effort removes the photo storage object.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function deleteGroupPost(postId, photoUrl) {
  if (!postId) return { error: new Error('Missing post id') };
  const { error } = await supabase.rpc('delete_group_post', { p_post: postId });
  if (error) return { error };

  const path = storagePathFromUrl(photoUrl);
  if (path) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
    if (rmErr) console.warn('[groupPosts] storage remove failed', rmErr.message);
  }
  return { error: null };
}

/**
 * Pin a post. Owner-only; server enforces a 3-post max per group.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function pinGroupPost(postId) {
  if (!postId) return { error: new Error('Missing post id') };
  const { error } = await supabase.rpc('pin_group_post', { p_post: postId });
  return { error: error ?? null };
}

/**
 * Unpin a post. Owner-only.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function unpinGroupPost(postId) {
  if (!postId) return { error: new Error('Missing post id') };
  const { error } = await supabase.rpc('unpin_group_post', { p_post: postId });
  return { error: error ?? null };
}

/**
 * Toggle the caller's emoji reaction on a post (one reaction per user per post).
 *   - no reaction yet         → adds it
 *   - same emoji tapped again  → removes it
 *   - different emoji tapped   → switches to it
 * Server enforces group membership.
 * @returns {Promise<{ emoji: string|null|undefined, error: Error|null }>}
 *          emoji === the caller's reaction after the toggle (null = removed).
 */
export async function toggleGroupPostReaction(postId, emoji) {
  if (!postId) return { emoji: undefined, error: new Error('Missing post id') };
  if (!emoji)  return { emoji: undefined, error: new Error('Missing emoji') };
  const { data, error } = await supabase.rpc('toggle_group_post_reaction', {
    p_post:  postId,
    p_emoji: emoji,
  });
  if (error) return { emoji: undefined, error };
  return { emoji: data ?? null, error: null };
}

/**
 * Bulk-delete every post-photo storage object for a group. Call before
 * delete_group so the bucket isn't left with orphaned files (the cascade
 * only clears the group_posts rows, not storage).
 */
export async function purgeGroupPostPhotoStorage(groupId) {
  if (!groupId) return { error: null };
  const { data, error } = await supabase.storage.from(BUCKET).list(groupId);
  if (error) return { error };
  const paths = (data ?? []).map((f) => `${groupId}/${f.name}`);
  if (paths.length === 0) return { error: null };
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
  return { error: rmErr ?? null };
}
