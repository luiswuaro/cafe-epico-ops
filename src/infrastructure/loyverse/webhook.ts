import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type LoyverseWebhookPayload = {
  merchant_id?: string;
  type: string;
  created_at?: string;
  [key: string]: unknown;
};

export function sha256(rawBody: string) { return createHash("sha256").update(rawBody, "utf8").digest("hex"); }

export function verifyLoyverseSignature(rawBody: string, signature: string | null, clientSecret?: string) {
  // PAT-created webhooks are intentionally unsigned. OAuth-owned webhooks MUST be verified when a secret is configured.
  if (!clientSecret) return { valid: true, signed: false };
  if (!signature) return { valid: false, signed: false };
  const expected = createHmac("sha1", clientSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  return { valid: a.length === b.length && timingSafeEqual(a, b), signed: true };
}

export function webhookEventKey(payload: LoyverseWebhookPayload, bodyHash: string) {
  return [payload.merchant_id ?? "unknown", payload.type, payload.created_at ?? "unknown", bodyHash].join(":");
}
