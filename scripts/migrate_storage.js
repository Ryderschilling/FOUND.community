#!/usr/bin/env node
/**
 * FOUND App — Storage bucket migration
 * Copies all files from old Supabase project to new project.
 * Buckets: profile-photos, group-post-photos
 *
 * Usage:
 *   OLD_SERVICE_ROLE_KEY=xxx NEW_SERVICE_ROLE_KEY=xxx node scripts/migrate_storage.js
 *
 * Both keys required as env vars. Never hardcode service role keys.
 */

const { createClient } = require('@supabase/supabase-js');

const OLD_URL = 'https://froqanfagdkjmfrmpfye.supabase.co';
const OLD_KEY = process.env.OLD_SERVICE_ROLE_KEY;

const NEW_URL = 'https://cspsglmopchuqkvdfvwc.supabase.co';
const NEW_KEY = process.env.NEW_SERVICE_ROLE_KEY;

const BUCKETS = ['profile-photos', 'group-post-photos', 'avatars', 'group-photos'];

if (!OLD_KEY) {
  console.error('ERROR: Set OLD_SERVICE_ROLE_KEY env var before running.');
  console.error('Find it in: old Supabase project → Project Settings → API → service_role key');
  process.exit(1);
}

if (!NEW_KEY) {
  console.error('ERROR: Set NEW_SERVICE_ROLE_KEY env var before running.');
  console.error('Find it in: new Supabase project → Project Settings → API → service_role key');
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_KEY, {
  auth: { persistSession: false },
});
const newClient = createClient(NEW_URL, NEW_KEY, {
  auth: { persistSession: false },
});

async function listAllFiles(client, bucket, prefix = '') {
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000,
    offset: 0,
  });
  if (error) throw new Error(`list failed for ${bucket}/${prefix}: ${error.message}`);

  let files = [];
  for (const item of data || []) {
    if (item.id === null) {
      // It's a folder — recurse
      const nested = await listAllFiles(client, bucket, prefix ? `${prefix}/${item.name}` : item.name);
      files = files.concat(nested);
    } else {
      files.push(prefix ? `${prefix}/${item.name}` : item.name);
    }
  }
  return files;
}

async function ensureBucketExists(client, bucket) {
  const { data: buckets } = await client.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === bucket);
  if (!exists) {
    const { error } = await client.storage.createBucket(bucket, { public: true });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`createBucket failed for ${bucket}: ${error.message}`);
    }
    console.log(`  ✓ Created bucket: ${bucket}`);
  } else {
    console.log(`  ✓ Bucket already exists: ${bucket}`);
  }
}

async function migrateBucket(bucket) {
  console.log(`\n=== Migrating bucket: ${bucket} ===`);

  // Ensure destination bucket exists
  await ensureBucketExists(newClient, bucket);

  // List source files
  const files = await listAllFiles(oldClient, bucket);
  console.log(`  Found ${files.length} files in source`);

  if (files.length === 0) {
    console.log('  Nothing to migrate.');
    return { bucket, total: 0, copied: 0, failed: 0 };
  }

  let copied = 0;
  let failed = 0;
  const errors = [];

  for (const filePath of files) {
    try {
      // Download from old
      const { data: fileData, error: dlErr } = await oldClient.storage
        .from(bucket)
        .download(filePath);
      if (dlErr) throw new Error(`download: ${dlErr.message}`);

      // Convert Blob to ArrayBuffer
      const buffer = await fileData.arrayBuffer();

      // Upload to new
      const { error: ulErr } = await newClient.storage
        .from(bucket)
        .upload(filePath, buffer, {
          upsert: true,
          contentType: fileData.type || 'application/octet-stream',
        });
      if (ulErr) throw new Error(`upload: ${ulErr.message}`);

      copied++;
      if (copied % 10 === 0) {
        console.log(`  Progress: ${copied}/${files.length}`);
      }
    } catch (err) {
      failed++;
      errors.push({ file: filePath, error: err.message });
      console.error(`  ✗ Failed: ${filePath} — ${err.message}`);
    }
  }

  // Verify count on new side
  const newFiles = await listAllFiles(newClient, bucket);
  console.log(`\n  Source count : ${files.length}`);
  console.log(`  Dest count   : ${newFiles.length}`);
  console.log(`  Copied       : ${copied}`);
  console.log(`  Failed       : ${failed}`);

  if (errors.length > 0) {
    console.log('\n  Failed files:');
    errors.forEach((e) => console.log(`    - ${e.file}: ${e.error}`));
  }

  return { bucket, total: files.length, copied, failed };
}

async function main() {
  console.log('FOUND Storage Migration');
  console.log(`Old project: ${OLD_URL}`);
  console.log(`New project: ${NEW_URL}`);

  const results = [];
  for (const bucket of BUCKETS) {
    const result = await migrateBucket(bucket);
    results.push(result);
  }

  console.log('\n=== SUMMARY ===');
  let allGood = true;
  for (const r of results) {
    const status = r.failed === 0 ? '✓' : '✗';
    console.log(`${status} ${r.bucket}: ${r.copied}/${r.total} copied, ${r.failed} failed`);
    if (r.failed > 0) allGood = false;
  }

  if (allGood) {
    console.log('\n✓ All storage files migrated successfully.');
  } else {
    console.log('\n✗ Some files failed. Re-run the script — it uses upsert so duplicates are safe.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
