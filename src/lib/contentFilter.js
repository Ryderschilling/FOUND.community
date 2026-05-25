// ─────────────────────────────────────────────────────────────────
// contentFilter.js
// Lightweight client-side objectionable-language filter for user-
// generated content. Satisfies App Store Review Guideline 1.2, which
// requires UGC apps to include "a method for filtering objectionable
// material from being posted to the app."
//
// This is a FIRST-PASS guard, not the whole moderation story — the
// report + block + admin-panel pipeline (migrations 0036/0038) is what
// actually handles a determined bad actor. A wordlist can always be
// evaded; the point here is to stop casual abuse at the input.
//
// Design choice: the list is deliberately conservative. A false
// positive (blocking a real word an honest user typed) is worse than a
// missed evasion that report/block will catch anyway. Mild profanity
// (damn, hell, crap) is intentionally NOT blocked.
// ─────────────────────────────────────────────────────────────────

// Slurs, explicit sexual language, and strong profanity. Kept focused
// to minimise false positives.
const BLOCKED = [
  // racial / ethnic slurs
  'nigger', 'nigga', 'chink', 'spic', 'wetback', 'kike', 'gook', 'coon',
  'beaner',
  // homophobic / transphobic slurs
  'faggot', 'fag', 'dyke', 'tranny',
  // ableist slurs
  'retard', 'retarded',
  // explicit sexual terms
  'cunt', 'whore', 'slut', 'porn', 'rape', 'rapist', 'blowjob', 'handjob',
  'dildo', 'pedophile', 'pedo', 'molest', 'bestiality', 'incest', 'jizz',
  // strong profanity
  'fuck', 'motherfucker', 'asshole', 'bullshit', 'bastard', 'bitch',
];

// Leet / obfuscation normalisation, so "f4ggot" or "n1gger" are still
// caught. Characters are mapped but word boundaries are preserved — this
// is what keeps us safe from the Scunthorpe problem ("class", "pass",
// "assassin", "cumin", "scum" all stay clean).
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[7]/g, 't');
}

// \b...\b anchors to word boundaries; (?:es|s)? catches simple plurals.
const BLOCK_RE = new RegExp(`\\b(?:${BLOCKED.join('|')})(?:es|s)?\\b`, 'i');

/**
 * Check a single string for objectionable language.
 * @param {string} text   the user input
 * @param {string} label  field name, used in the error ("bio", "message")
 * @returns {{ ok: boolean, message?: string }}
 */
export function checkText(text, label = 'text') {
  if (!text) return { ok: true };
  if (BLOCK_RE.test(normalize(text))) {
    return {
      ok: false,
      message: `Your ${label} contains language that isn't allowed on FOUND. Please edit it and try again.`,
    };
  }
  return { ok: true };
}

/**
 * Check several fields at once; returns the first violation found, or
 * { ok: true } if all fields are clean.
 * @param {Array<{ text: string, label: string }>} fields
 * @returns {{ ok: boolean, message?: string }}
 */
export function firstViolation(fields) {
  for (const f of fields) {
    const r = checkText(f.text, f.label);
    if (!r.ok) return r;
  }
  return { ok: true };
}
