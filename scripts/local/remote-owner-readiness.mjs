import { isIP } from "node:net";

export function parseDotenv(text) {
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    const quoted = value.match(/^(["'])(.*?)\1(?:\s+#.*)?$/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    entries[match[1]] = value;
  }
  return entries;
}

export function privateIpv4(host) {
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function exactOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port !== "8443" ||
        !privateIpv4(url.hostname) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

/** Read-only static checks. These do not assert that Cloudflare policies exist. */
export function remoteOwnerReadiness({ appText, authText, caddyText, caPresent }) {
  const app = parseDotenv(appText ?? "");
  const auth = parseDotenv(authText ?? "");
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  const origin = exactOrigin(app.APP_ORIGIN);

  check("app-origin", origin, "APP_ORIGIN debe usar HTTPS, IP privada y puerto 8443.");
  check("same-origin-auth", origin && exactOrigin(app.NEXT_PUBLIC_SUPABASE_URL) === origin,
    "Next.js y Supabase deben usar el mismo origen privado HTTPS.");
  check("local-ca", caPresent === true,
    "La CA pública de Caddy indicada por OPS_LOCAL_CA_FILE debe existir.");
  check("auth-env", Boolean(authText),
    "Se requiere el .env del Auth local para cotejar las redirecciones.");
  check("auth-redirects", origin && auth.SITE_URL === origin &&
    auth.API_EXTERNAL_URL === `${origin}/auth/v1` &&
    auth.SUPABASE_PUBLIC_URL === origin,
    "Auth debe redirigir al mismo origen; no se cambian sus variables.");

  const caddy = caddyText ?? "";
  check("caddy-bound", /bind\s+\{\$OPS_LAN_HOST\}/.test(caddy) &&
    /tls\s+internal/.test(caddy) && /auto_https\s+disable_redirects/.test(caddy),
    "La plantilla Caddy debe escuchar sólo en IP LAN, con HTTPS y sin puerto 80.");
  check("caddy-auth-route", /@supabase\s+path\s+[^\n]*\/auth\/v1\/\*/.test(caddy) &&
    /reverse_proxy\s+127\.0\.0\.1:8000/.test(caddy),
    "Las rutas Auth deben pasar por el mismo origen y un backend loopback.");
  check("caddy-app-route", /reverse_proxy\s+127\.0\.0\.1:3000/.test(caddy),
    "Next.js debe permanecer en loopback.");
  check("caddy-print-guard", /handle\s+\/api\/local-print-agent\*/.test(caddy) &&
    /respond\s+["']?Forbidden["']?\s+403/.test(caddy),
    "El endpoint del agente de impresión debe estar bloqueado en Caddy.");

  return {
    ready: checks.every((item) => item.ok),
    origin: origin ?? null,
    ip: origin ? new URL(origin).hostname : null,
    cidr: origin ? `${new URL(origin).hostname}/32` : null,
    port: 8443,
    checks,
    caveat: "Las políticas Cloudflare Access/Gateway y el certificado en el móvil exigen validación externa.",
  };
}
