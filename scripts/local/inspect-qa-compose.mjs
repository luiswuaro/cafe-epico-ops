import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Un compose normalizado se obtiene con docker compose config --format json.
 * Nunca imprimir el JSON recibido: contiene secretos interpolados.
 */
export function inspectQaCompose(config) {
  const errors = [];
  const services = config?.services;
  if (!services || typeof services !== "object") {
    return { ok: false, errors: ["Falta services en el compose resuelto."] };
  }
  for (const required of ["api-gw", "supavisor", "db", "auth"]) {
    if (!services[required]) errors.push("Falta servicio requerido: " + required);
  }
  for (const [name, service] of Object.entries(services)) {
    if (service?.network_mode === "host") {
      errors.push(name + ": network_mode host está prohibido.");
    }
    const ports = service?.ports ?? [];
    if (!Array.isArray(ports)) {
      errors.push(name + ": ports inválidos.");
      continue;
    }
    for (const port of ports) {
      if (!port || typeof port !== "object") {
        errors.push(name + ": puerto no normalizado; usar docker compose config --format json.");
        continue;
      }
      if (!["127.0.0.1", "::1"].includes(port.host_ip)) {
        errors.push(name + ": puerto " + (port.target ?? "?") + " expuesto fuera de loopback.");
      }
    }
  }
  for (const [name, target] of [["api-gw", 8000], ["supavisor", 5432], ["supavisor", 6543]]) {
    const ports = services[name]?.ports;
    if (!Array.isArray(ports) ||
        !ports.some(p => p && typeof p === "object" &&
          Number(p.target) === target && p.host_ip === "127.0.0.1")) {
      errors.push(name + ": falta mapeo 127.0.0.1 para " + target + ".");
    }
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(readFileSync(0, "utf8"));
    const result = inspectQaCompose(config);
    if (!result.ok) {
      for (const error of result.errors) console.error("BLOQUEADO: " + error);
      process.exitCode = 2;
    } else {
      console.log("PASS: gateway, Auth y PostgreSQL QA con puertos publicados sólo en loopback.");
    }
  } catch {
    console.error("BLOQUEADO: compose inválido o no generado con formato JSON.");
    process.exitCode = 2;
  }
}
