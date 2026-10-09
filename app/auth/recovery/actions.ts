"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";
import { recoveryCookie, verifyRecoveryProof } from "@/src/infrastructure/auth/recovery-proof";

function passwordValid(value: string) {
  return value.length >= 12 && value.length <= 128;
}

async function callbackOrigin() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").toLowerCase();
  const protocol = host.startsWith("localhost:") ? "http" : "https";
  if (/^cafe-epico-[a-z0-9-]+\.vercel\.app$/.test(host) || /^localhost:\d{2,5}$/.test(host)) {
    return protocol + "://" + host;
  }
  const configured = process.env.APP_ORIGIN;
  if (configured) return new URL(configured).origin;
  throw new Error("Origen de recuperación no configurado");
}

export async function requestPasswordRecovery(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@") || email.length > 254) {
    redirect("/auth/recovery?error=email");
  }
  const supabase = await createSupabaseServerClient();
  const redirectTo = (await callbackOrigin()) + "/auth/callback?flow=recovery";
  const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo});
  if (error) {
    redirect("/auth/recovery?error=send");
  }
  // Misma respuesta aun si el email no está registrado.
  redirect("/auth/recovery?sent=1");
}

export async function completePasswordRecovery(formData: FormData) {
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmation") ?? "");
  if (!passwordValid(next) || next !== confirm) {
    redirect("/auth/recovery?error=validation");
  }
  const supabase = await createSupabaseServerClient();
  const [userResult, sessionResult, cookieStore] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
    cookies(),
  ]);
  const userId = userResult.data.user?.id;
  const accessToken = sessionResult.data.session?.access_token;
  const proof = cookieStore.get(recoveryCookie)?.value;
  if (!userId || !accessToken || !verifyRecoveryProof(proof,userId,accessToken)) {
    redirect("/auth/recovery?error=expired");
  }
  const {error} = await supabase.auth.updateUser({password:next});
  if (error) redirect("/auth/recovery?error=provider");
  cookieStore.delete(recoveryCookie);
  await supabase.auth.signOut();
  redirect("/login?reset=success");
}
