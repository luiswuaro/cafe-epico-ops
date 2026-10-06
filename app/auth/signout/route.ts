import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
