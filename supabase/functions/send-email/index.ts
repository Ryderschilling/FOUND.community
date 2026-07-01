// send-email — Supabase "Send Email" Auth Hook
// Registered under: Supabase Dashboard → Authentication → Hooks → Send Email
//
// Intercepts ALL Supabase auth emails (confirmation, password reset, magic link).
// Routes to two different Resend templates based on user metadata `source`:
//   source === 'app'  → FOUND welcome email (for app signups)
//   anything else     → Early access email  (for website signups)
//
// Required secret (set once):
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//
// Payload shape: https://supabase.com/docs/guides/auth/auth-hooks#send-email-hook

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS   = "FOUND <hello@found.community>";
const LOGO_URL       = "https://found.community/brand-mark.png";

// How long (seconds) to suppress duplicate sends for the same email+action.
// Prevents retry loops and accidental double-sends.
const DEDUP_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Dedup helpers — read/write email_send_log via Supabase REST API directly
// (no client library needed; service role key bypasses RLS)
// ---------------------------------------------------------------------------
async function wasRecentlySent(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  actionType: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000).toISOString();
  const url =
    `${supabaseUrl}/rest/v1/email_send_log` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&action_type=eq.${encodeURIComponent(actionType)}` +
    `&sent_at=gte.${encodeURIComponent(since)}` +
    `&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return false; // fail open — don't block sends if DB is unreachable
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function recordSend(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  actionType: string,
): Promise<void> {
  await fetch(`${supabaseUrl}/rest/v1/email_send_log`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ email, action_type: actionType }),
  }).catch(() => {/* non-fatal */});
}

// ---------------------------------------------------------------------------
// HTML: App signup — Welcome to FOUND
// ---------------------------------------------------------------------------
function buildAppWelcomeEmail(firstName: string, confirmationUrl: string): string {
  const name = firstName || "friend";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border:1px solid rgba(0,0,0,0.10);border-radius:20px;">

        <!-- Header -->
        <tr>
          <td style="padding:36px 36px 0 36px;">
            <img src="${LOGO_URL}" alt="FOUND" width="44" height="44" style="display:block;border-radius:10px;" />
            <div style="font:600 11px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">Welcome</div>
          </td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td style="padding:10px 36px 0 36px;">
            <h1 style="font:400 30px Georgia,'Times New Roman',serif;color:#111111;letter-spacing:-0.5px;margin:0 0 14px;">
              You're in, ${name}.
            </h1>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 14px;">
              Welcome to FOUND — a community app built for Christians to connect
              with other believers nearby. People who share your faith, your values,
              and want the same kind of real community you do.
            </p>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 20px;">
              Confirm your email to finish setting up your account and start
              discovering people near you.
            </p>
          </td>
        </tr>

        <!-- What you can do cards -->
        <tr>
          <td style="padding:0 36px 0 36px;">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8f6f3;border-radius:12px;margin-bottom:10px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 13px Arial,sans-serif;color:#111111;margin-bottom:4px;">
                    🔍&nbsp; Discover people near you
                  </div>
                  <div style="font:400 13px/1.5 Arial,sans-serif;color:#6b6b6b;">
                    Browse Christians in your area, filter by interests, and see who's nearby.
                  </div>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8f6f3;border-radius:12px;margin-bottom:10px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 13px Arial,sans-serif;color:#111111;margin-bottom:4px;">
                    👋&nbsp; Connect with intention
                  </div>
                  <div style="font:400 13px/1.5 Arial,sans-serif;color:#6b6b6b;">
                    Send a wave to people you want to meet. When they wave back, you can message.
                  </div>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8f6f3;border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 13px Arial,sans-serif;color:#111111;margin-bottom:4px;">
                    🏘️&nbsp; Join local groups
                  </div>
                  <div style="font:400 13px/1.5 Arial,sans-serif;color:#6b6b6b;">
                    Find Bible studies, groups, and gatherings happening near you.
                  </div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" bgcolor="#111111" style="border-radius:9999px;">
                  <a href="${confirmationUrl}"
                     style="display:block;padding:15px 28px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:9999px;">
                    Confirm my email
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sub-copy -->
        <tr>
          <td style="padding:18px 36px 0 36px;">
            <p style="font:400 13px/1.6 Arial,sans-serif;color:#9a9a9a;margin:0;">
              If you didn't create a FOUND account, you can safely ignore this email.
              This link expires in 24 hours.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:26px 36px 36px 36px;">
            <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:0 0 18px;" />
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:0;">
              Questions? Reply to this email — we read every one.
            </p>
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:10px 0 0;">
              FOUND &middot; found.community &middot;
              <a href="mailto:hello@found.community" style="color:#a3a3a3;">hello@found.community</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
`.trim();
}

// ---------------------------------------------------------------------------
// HTML: Website signup — Early access
// ---------------------------------------------------------------------------
function buildEarlyAccessEmail(firstName: string, confirmationUrl: string): string {
  const name = firstName || "friend";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border:1px solid rgba(0,0,0,0.10);border-radius:20px;">

        <!-- Header -->
        <tr>
          <td style="padding:36px 36px 0 36px;">
            <img src="${LOGO_URL}" alt="FOUND" width="44" height="44" style="display:block;border-radius:10px;" />
            <div style="font:600 11px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">Early Access</div>
          </td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td style="padding:10px 36px 0 36px;">
            <h1 style="font:400 30px Georgia,'Times New Roman',serif;color:#111111;letter-spacing:-0.5px;margin:0 0 14px;">
              You're on the list, ${name}.
            </h1>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 14px;">
              Thanks for signing up for early access to FOUND. We're building a
              community app for Christians to connect with other believers nearby —
              and you'll be among the first to get in.
            </p>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 20px;">
              Confirm your email to lock in your spot.
            </p>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" bgcolor="#111111" style="border-radius:9999px;">
                  <a href="${confirmationUrl}"
                     style="display:block;padding:15px 28px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:9999px;">
                    Confirm my email
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sub-copy -->
        <tr>
          <td style="padding:18px 36px 0 36px;">
            <p style="font:400 13px/1.6 Arial,sans-serif;color:#9a9a9a;margin:0;">
              We'll reach out as soon as FOUND is ready for you. In the meantime,
              follow along at <a href="https://found.community" style="color:#6b6b6b;">found.community</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:26px 36px 36px 36px;">
            <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:0 0 18px;" />
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:0;">
              If you didn't sign up for FOUND, you can safely ignore this email.
            </p>
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:10px 0 0;">
              FOUND &middot; found.community &middot;
              <a href="mailto:hello@found.community" style="color:#a3a3a3;">hello@found.community</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
`.trim();
}

// ---------------------------------------------------------------------------
// HTML: Password reset (same for both flows)
// ---------------------------------------------------------------------------
function buildPasswordResetEmail(firstName: string, confirmationUrl: string): string {
  const name = firstName || "friend";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border:1px solid rgba(0,0,0,0.10);border-radius:20px;">

        <tr>
          <td style="padding:36px 36px 0 36px;">
            <img src="${LOGO_URL}" alt="FOUND" width="44" height="44" style="display:block;border-radius:10px;" />
            <div style="font:600 11px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">Password Reset</div>
          </td>
        </tr>

        <tr>
          <td style="padding:10px 36px 0 36px;">
            <h1 style="font:400 30px Georgia,'Times New Roman',serif;color:#111111;letter-spacing:-0.5px;margin:0 0 14px;">
              Reset your password
            </h1>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 20px;">
              We received a request to reset the password for your FOUND account.
              Click below to choose a new one. This link expires in 1 hour.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" bgcolor="#111111" style="border-radius:9999px;">
                  <a href="${confirmationUrl}"
                     style="display:block;padding:15px 28px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:9999px;">
                    Reset my password
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 36px 0 36px;">
            <p style="font:400 13px/1.6 Arial,sans-serif;color:#9a9a9a;margin:0;">
              If you didn't request this, you can safely ignore this email.
              Your password won't change.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 36px 36px 36px;">
            <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:0 0 18px;" />
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:0;">
              FOUND &middot; found.community &middot;
              <a href="mailto:hello@found.community" style="color:#a3a3a3;">hello@found.community</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
`.trim();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // Supabase auth hooks send a POST. Return 200 for anything else (health checks).
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY");
  const SUPABASE_URL      = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY secret is not set");
    return new Response("Missing RESEND_API_KEY", { status: 500 });
  }

  let payload: {
    user: {
      email: string;
      user_metadata: Record<string, string>;
    };
    email_data: {
      token: string;
      token_hash: string;
      redirect_to: string;
      email_action_type: string;
      site_url: string;
    };
  };

  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { user, email_data } = payload;
  const { email_action_type, token_hash, redirect_to, site_url } = email_data;
  const userEmail    = user.email;
  const userMeta     = user.user_metadata ?? {};
  const isAppSignup  = userMeta.source === "app";
  const firstName    = (userMeta.full_name ?? "").split(" ")[0] ?? "";

  // -------------------------------------------------------------------------
  // Dedup check — skip if same email+action was sent within DEDUP_WINDOW_SECONDS
  // This prevents Supabase retry loops from multiplying sends when Resend errors.
  // -------------------------------------------------------------------------
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const alreadySent = await wasRecentlySent(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      userEmail,
      email_action_type,
    );
    if (alreadySent) {
      console.log(`Dedup: skipping ${email_action_type} to ${userEmail} (sent within ${DEDUP_WINDOW_SECONDS}s)`);
      return new Response("ok", { status: 200 });
    }
  }

  // Build the confirmation URL — same format Supabase uses internally
  const confirmationUrl =
    `${site_url}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to ?? site_url)}`;

  let subject: string;
  let html: string;

  if (email_action_type === "signup") {
    if (isAppSignup) {
      subject = "Confirm your email — FOUND";
      html    = buildAppWelcomeEmail(firstName, confirmationUrl);
    } else {
      subject = "Confirm your early access — FOUND";
      html    = buildEarlyAccessEmail(firstName, confirmationUrl);
    }
  } else if (email_action_type === "recovery") {
    subject = "Reset your FOUND password";
    html    = buildPasswordResetEmail(firstName, confirmationUrl);
  } else {
    // magic_link, email_change, etc. — fall back to a simple email
    subject = "Your FOUND sign-in link";
    html    = buildPasswordResetEmail(firstName, confirmationUrl);
  }

  const res = await fetch(RESEND_API_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      [userEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("Resend error:", res.status, errBody);

    if (res.status >= 400 && res.status < 500) {
      // 4xx = client-side problem (quota exceeded, invalid address, etc.)
      // DO NOT return a non-2xx here — that would cause Supabase to retry
      // indefinitely, multiplying sends and burning through quota.
      // Log it and return 200 so the hook is considered handled.
      return new Response("ok", { status: 200 });
    }

    // 5xx = Resend is down — safe to retry
    return new Response(`Resend error: ${errBody}`, { status: 502 });
  }

  // Record successful send for dedup
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    await recordSend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userEmail, email_action_type);
  }

  return new Response("ok", { status: 200 });
});
