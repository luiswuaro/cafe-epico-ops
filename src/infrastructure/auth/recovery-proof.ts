import { createHmac, timingSafeEqual } from "node:crypto";

const maxAgeSeconds = 15 * 60;

function signature(userId: string, accessToken: string, issuedAt: number) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 20) return null;
  return createHmac("sha256", secret)
    .update(userId + ":" + accessToken + ":" + issuedAt)
    .digest("hex");
}

export function issueRecoveryProof(userId: string, accessToken: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const hash = signature(userId, accessToken, issuedAt);
  if (!hash) return null;
  return issuedAt + "." + hash;
}

export function verifyRecoveryProof(
  value: string | undefined,
  userId: string,
  accessToken: string,
) {
  if (!value) return false;
  const [time, digest, extra] = value.split(".");
  if (extra || !/^\d{10}$/.test(time ?? "") || !/^[0-9a-f]{64}$/.test(digest ?? "")) {
    return false;
  }
  const issuedAt = Number(time);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 30 || now - issuedAt > maxAgeSeconds) return false;
  const expected = signature(userId, accessToken, issuedAt);
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(digest,"hex"), Buffer.from(expected,"hex"));
}

export const recoveryCookie = "ops-recovery-proof";
export const recoveryMaxAge = maxAgeSeconds;
