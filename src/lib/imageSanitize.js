// ─────────────────────────────────────────────────────────────────────────
// imageSanitize.js
//
// Strips EXIF metadata (GPS, device model, capture timestamp) from a picked
// image by re-encoding it through expo-image-manipulator. The manipulator
// does not preserve EXIF on output, so any compress/format pass effectively
// strips it as a side effect.
//
// Use this in every upload path BEFORE handing bytes to Supabase Storage.
// ─────────────────────────────────────────────────────────────────────────

import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Re-encode a picked image so EXIF metadata is removed.
 *
 * @param {string} uri - local file URI from expo-image-picker
 * @param {object} [opts]
 * @param {number} [opts.maxWidth=2048] - downscale max width
 * @param {number} [opts.compress=0.85] - JPEG quality 0..1
 * @returns {Promise<{uri:string, base64:string|null, width:number, height:number}>}
 */
export async function stripExif(uri, opts = {}) {
  const { maxWidth = 2048, compress = 0.85 } = opts;
  const actions = maxWidth ? [{ resize: { width: maxWidth } }] : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return {
    uri: result.uri,
    base64: result.base64 ?? null,
    width: result.width,
    height: result.height,
  };
}
