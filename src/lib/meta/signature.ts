// ============================================
// Meta Webhook Signature Verification
// Verifies the X-Hub-Signature-256 header using HMAC-SHA256
// signed with the app secret. This stops anyone who knows the
// webhook URL from sending fake events.
// ============================================

import crypto from "crypto";

export interface SignatureVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body.
 *
 * Meta signs every webhook POST body with HMAC-SHA256 using the app secret,
 * and sends the result in the `x-hub-signature-256` header as `sha256=...`.
 * We recompute the HMAC over the exact raw body and do a constant-time compare.
 *
 * @param rawBody - the exact request body bytes (MUST be the raw string, not
 *                  a re-serialized JSON — whitespace matters)
 * @param header  - the `x-hub-signature-256` header value, e.g. `sha256=abcd...`
 * @param appSecret - your Meta app secret
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined
): SignatureVerificationResult {
  if (!appSecret) {
    return { valid: false, reason: "APP_SECRET_NOT_CONFIGURED" };
  }

  if (!header) {
    return { valid: false, reason: "SIGNATURE_HEADER_MISSING" };
  }

  const [algo, signature] = header.split("=");
  if (algo !== "sha256" || !signature) {
    return { valid: false, reason: "SIGNATURE_FORMAT_INVALID" };
  }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) {
      return { valid: false, reason: "SIGNATURE_LENGTH_MISMATCH" };
    }
    const match = crypto.timingSafeEqual(a, b);
    return match
      ? { valid: true }
      : { valid: false, reason: "SIGNATURE_MISMATCH" };
  } catch {
    return { valid: false, reason: "SIGNATURE_COMPARE_FAILED" };
  }
}

/**
 * Allow-bypass helper for tests / local dev where APP_SECRET isn't set.
 * Returns true only when explicitly enabled via env.
 */
export function signatureVerificationBypassed(): boolean {
  return process.env.META_SKIP_SIGNATURE_CHECK === "true";
}
