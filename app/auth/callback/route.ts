import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";
import {
  issueRecoveryProof,
  recoveryCookie,
  recoveryMaxAge,
} from "@/src/infrastructure/auth/recovery-proof";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const kind = url.searchParams.get("type");
  const recovery = url.searchParams.get("flow") === "recovery" || kind === "recovery";

  if (!recovery) {
    return NextResponse.redirect(new URL("/login?error=enlace", request.url));
  }

  const supabase = await createSupabaseServerClient();
  let userId: string | undefined;
  let accessToken: string | undefined;

  if (code) {
    const {data,error} = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      userId = data.user?.id;
      accessToken = data.session?.access_token;
    }
  } else if (tokenHash && kind === "recovery") {
    const {data,error} = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (!error) {
      userId = data.user?.id;
      accessToken = data.session?.access_token;
    }
  }

  if (!userId || !accessToken) {
    return NextResponse.redirect(new URL("/auth/recovery?error=expired", request.url));
  }
  const proof = issueRecoveryProof(userId, accessToken);
  if (!proof) {
    return NextResponse.redirect(new URL("/auth/recovery?error=config", request.url));
  }
  const response = NextResponse.redirect(new URL("/auth/recovery?ready=1", request.url));
  response.cookies.set(recoveryCookie, proof, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/auth/recovery",
    maxAge: recoveryMaxAge,
  });
  return response;
}
