import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const protectedPath = ["/today", "/checklists", "/recipes", "/sops", "/quality", "/admin"].some((p) => request.nextUrl.pathname.startsWith(p));
  if (!protectedPath) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.redirect(new URL("/login?config=missing", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims verifica firma/expiración del JWT localmente (ES256 + JWKS cacheado).
  // getUser consultaba el servidor Auth en cada petición protegida.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || claims.role !== "authenticated" || typeof claims.sub !== "string")
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  return response;
}

export const config = { matcher: ["/today/:path*", "/checklists/:path*", "/recipes/:path*", "/sops/:path*", "/quality/:path*", "/admin/:path*"] };
