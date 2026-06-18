// ─────────────────────────────────────────────────────────────────────────────
// recompress-existing-photos.mjs
//
// One-time script: downloads every photo from Supabase Storage, re-compresses
// it to 1200px / 72% JPEG (avatars: 800px / 75%), re-uploads to the same path,
// and refreshes profiles.avatar_url for any avatar that changed.
//
// Run once from the found-app directory:
//   SUPABASE_SERVICE_ROLE_KEY=<your key> node scripts/recompress-existing-photos.mjs
//
// Safe to re-run — uses upsert, skips files that are already under the size
// threshold (< 400 KB) to avoid re-compressing already-small images.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://cspsglmopchuqkvdfvwc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌  Set SUPABASE_SERVICE_ROLE_KEY before running.');
  console.error('    SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/recompress-existing-photos.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Buckets and their target dimensions
const BUCKETS = [
  { bucket: 'profile-photos',   maxWidth: 1200, quality: 72, skipBelow: 400_000 },
  { bucket: 'avatars',          maxWidth: 800,  quality: 75, skipBelow: 200_000 },
  { bucket: 'group-photos',     maxWidth: 1200, quality: 72, skipBelow: 400_000 },
  { bucket: 'group-post-photos',maxWidth: 1200, quality: 72, skipBelow: 400_000 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function listAll(bucket) {
  // Storage list() is paginated at 100 — recurse through prefixes (user folders)
  const { data: folders, error } = await supabase.storage.from(bucket).list('', { limit: 1000 });
  if (error) throw new Error(`list root ${bucket}: ${error.message}`);

  const files = [];
  for (const folder of folders ?? []) {
    if (folder.id === null) {
      // It's a "folder" prefix — list inside it
      const { data: inner, error: ie } = await supabase.storage
        .from(bucket)
        .list(folder.name, { limit: 1000 });
      if (ie) throw new Error(`list ${bucket}/${folder.name}: ${ie.message}`);
      for (const f of inner ?? []) {
        if (f.metadata) files.push({ path: `${folder.name}/${f.name}`, metadata: f.metadata });
      }
    } else if (folder.metadata) {
      // Top-level file (e.g. avatars/userId/avatar.jpg stored flat)
      files.push({ path: folder.name, metadata: folder.metadata });
    }
  }
  return files;
}

async function downloadBytes(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`download ${bucket}/${path}: ${error.message}`);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function recompress(buf, maxWidth, quality) {
  return sharp(buf)
    .rotate()                         // honour EXIF orientation, then strip EXIF
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: false })
    .toBuffer();
}

async function upload(bucket, path, buf) {
  const { error } = await supabase.storage.from(bucket).upload(path, buf, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
}

async function refreshAvatarUrl(storagePath) {
  // storagePath = "{userId}/avatar.jpg"
  const userId = storagePath.split('/')[0];
  const { data } = supabase.storage.from('avatars').getPublicUrl(storagePath);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId);
  if (error) console.warn(`  ⚠️  Could not refresh avatar_url for ${userId}: ${error.message}`);
  else console.log(`  ↺  Refreshed profiles.avatar_url for ${userId}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

let totalBefore = 0;
let totalAfter  = 0;
let skipped     = 0;
let processed   = 0;
let failed      = 0;

for (const { bucket, maxWidth, quality, skipBelow } of BUCKETS) {
  console.log(`\n📦  ${bucket}`);

  let files;
  try {
    files = await listAll(bucket);
  } catch (e) {
    console.error(`  ❌ Could not list bucket: ${e.message}`);
    continue;
  }

  console.log(`   ${files.length} file(s) found`);

  for (const { path, metadata } of files) {
    const originalSize = Number(metadata?.size ?? 0);

    if (originalSize > 0 && originalSize < skipBelow) {
      console.log(`  ✓  SKIP  ${path}  (${(originalSize / 1024).toFixed(0)} KB — already small)`);
      skipped++;
      continue;
    }

    try {
      const buf = await downloadBytes(bucket, path);
      const compressed = await recompress(buf, maxWidth, quality);

      const before = buf.length;
      const after  = compressed.length;
      const pct    = Math.round((1 - after / before) * 100);

      await upload(bucket, path, compressed);

      totalBefore += before;
      totalAfter  += after;
      processed++;

      console.log(`  ✅  ${path}  ${(before/1024).toFixed(0)} KB → ${(after/1024).toFixed(0)} KB  (-${pct}%)`);

      // Refresh avatar_url in profiles table
      if (bucket === 'avatars') {
        await refreshAvatarUrl(path);
      }
    } catch (e) {
      console.error(`  ❌  ${path}: ${e.message}`);
      failed++;
    }
  }
}

console.log('\n─────────────────────────────────────────');
console.log(`✅  Processed : ${processed}`);
console.log(`⏭️   Skipped   : ${skipped} (already small)`);
console.log(`❌  Failed    : ${failed}`);
if (totalBefore > 0) {
  const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
  const pct     = Math.round((1 - totalAfter / totalBefore) * 100);
  console.log(`📉  Saved     : ${savedMB} MB  (-${pct}%)`);
}
console.log('─────────────────────────────────────────');
