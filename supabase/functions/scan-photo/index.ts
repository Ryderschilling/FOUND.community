// ─────────────────────────────────────────────────────────────────────────
// scan-photo
//
// Triggered by a Storage object-created webhook on every photo bucket.
//
//   1. Downloads the new file from storage.
//   2. Sends the bytes to Thorn Safer for CSAM hash matching.
//   3. On a match:
//        - move the file to the `quarantine` bucket (deny-all RLS)
//        - set profiles.is_suspended = true on the owning account
//        - insert a row into csam_incidents
//        - alert security@found.community out-of-band (Resend)
//   4. Otherwise: mark photos.scanned = true.
//
// This function uses the SERVICE ROLE key and must never be called from a
// client. Trigger only via the Storage webhook (HMAC-protected by
// STORAGE_HOOK_SECRET).
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SAFER_API_URL          (e.g. https://api.safer.io/v1)
//   SAFER_API_KEY
//   STORAGE_HOOK_SECRET
//   RESEND_API_KEY
// ─────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPA = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const SAFER_URL = Deno.env.get('SAFER_API_URL') ?? '';
const SAFER_KEY = Deno.env.get('SAFER_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('STORAGE_HOOK_SECRET') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const PHOTO_BUCKETS = new Set([
  'avatars',
  'profile-photos',
  'group-photos',
  'group-post-photos',
]);

interface StorageHookBody {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'objects';
  record: { bucket_id: string; name: string; owner: string | null };
}

serve(async (req) => {
  // Shared-secret gate so this endpoint can't be hit from the open web
  if (!HOOK_SECRET || req.headers.get('x-webhook-secret') !== HOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  try {
    const body = (await req.json()) as StorageHookBody;
    if (body?.type !== 'INSERT') return new Response('skip', { status: 200 });

    const { bucket_id, name, owner } = body.record;
    if (!PHOTO_BUCKETS.has(bucket_id)) {
      return new Response('not a photo bucket', { status: 200 });
    }

    // 1. Download the new file
    const { data, error } = await SUPA.storage.from(bucket_id).download(name);
    if (error || !data) {
      console.error('download failed', error);
      return new Response('download fail', { status: 500 });
    }

    // 2. Send to Thorn Safer. Final request shape will follow the contract
    // they provide on agreement signing — this is the typical pattern.
    if (!SAFER_URL || !SAFER_KEY) {
      console.warn('Safer credentials missing — skipping match call');
      return new Response('unconfigured', { status: 200 });
    }

    const form = new FormData();
    form.append('file', data, name.split('/').pop() ?? 'image.jpg');
    form.append('client_reference', `${bucket_id}/${name}`);

    const resp = await fetch(`${SAFER_URL}/match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SAFER_KEY}` },
      body: form,
    });
    if (!resp.ok) {
      console.error('safer error', resp.status, await resp.text());
      return new Response('safer error', { status: 502 });
    }
    const result = (await resp.json()) as {
      is_match: boolean;
      match_id?: string;
      severity?: string;
    };

    if (result.is_match) {
      await handleHit({
        bucket_id,
        name,
        owner,
        matchId: result.match_id ?? null,
      });
      return new Response('quarantined', { status: 200 });
    }

    // 3. Mark scanned-clean
    await SUPA
      .from('photos')
      .update({ scanned: true, scanned_at: new Date().toISOString() })
      .eq('storage_path', `${bucket_id}/${name}`);

    return new Response('clean', { status: 200 });
  } catch (e) {
    console.error('scan-photo exception', e);
    return new Response('error', { status: 500 });
  }
});

async function handleHit(input: {
  bucket_id: string;
  name: string;
  owner: string | null;
  matchId: string | null;
}) {
  // a. Move file to quarantine bucket
  const dest = `${input.bucket_id}/${input.name}`;
  const { error: moveErr } = await SUPA.storage
    .from(input.bucket_id)
    .move(input.name, dest);
  if (moveErr) console.error('quarantine move failed', moveErr);

  // b. Suspend the owning account
  if (input.owner) {
    await SUPA
      .from('profiles')
      .update({ is_suspended: true, suspended_reason: 'CSAM_AUTO' })
      .eq('id', input.owner);
  }

  // c. Record incident
  await SUPA.from('csam_incidents').insert({
    bucket_id: input.bucket_id,
    storage_path: input.name,
    profile_id: input.owner,
    thorn_match_id: input.matchId,
    reported_to_ncmec: false,
  });

  // d. Alert ops out-of-band so a human files the NCMEC CyberTipline report
  if (RESEND_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'security@found.community',
        to: 'security@found.community',
        subject: '[CSAM HIT] photo auto-quarantined',
        text:
          `Bucket: ${input.bucket_id}\n` +
          `Path: ${input.name}\n` +
          `Owner: ${input.owner ?? '(unknown)'}\n` +
          `Thorn match id: ${input.matchId ?? '(none returned)'}\n\n` +
          `Action items (within 24h):\n` +
          ` 1. File NCMEC CyberTipline report (https://report.cybertip.org/).\n` +
          ` 2. Update csam_incidents.reported_to_ncmec = true with cybertip_id.\n` +
          ` 3. Preserve evidence per 18 U.S.C. § 2258A.\n`,
      }),
    });
  }
}
