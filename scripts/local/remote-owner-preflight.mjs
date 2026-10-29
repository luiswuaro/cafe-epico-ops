#!/usr/bin/env node
// Solo lectura: valida archivos de configuración sin imprimir claves de .env.
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, isAbsolute } from "node:path";
import { parseDotenv, remoteOwnerReadiness } from "./remote-owner-readiness.mjs";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
if (rootIndex === -1 || !args[rootIndex + 1] || !args.includes("--json")) {
  process.stderr.write("Uso: node remote-owner-preflight.mjs --root RUTA_OPS --json\n");
  process.exit(2);
}

const root = resolve(args[rootIndex + 1]);
const read = (path) => existsSync(path) ? readFileSync(path, "utf8") : null;
const appText = read(join(root, ".env.local"));
const authCandidates = [
  join(root, ".local", "supabase-live", ".env"),
  join(dirname(root), "cafe-epico-ops-qa", ".local", "supabase-live", ".env"),
];
const authText = authCandidates.map(read).find((value) => value !== null) ?? null;
const caddyText = read(join(root, "infra", "local", "Caddyfile.example"));
const app = parseDotenv(appText ?? "");
const caPath = app.OPS_LOCAL_CA_FILE;
const report = remoteOwnerReadiness({
  appText,
  authText,
  caddyText,
  caPresent: Boolean(caPath && isAbsolute(caPath) && existsSync(caPath)),
});
// No contiene contraseñas, tokens, claves o rutas privadas de certificados.
process.stdout.write(JSON.stringify(report) + "\n");
if (!report.ready) process.exitCode = 2;
