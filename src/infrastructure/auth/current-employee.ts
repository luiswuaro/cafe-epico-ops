import { and, eq } from "drizzle-orm";
import {cache} from "react";
import {localPrintAgentIdentity} from "./local-print-agent-context";
import { redirect } from "next/navigation";
import { getDb } from "@/src/infrastructure/db/client";
import { employees, organizations } from "@/src/infrastructure/db/schema";
import { createSupabaseServerClient } from "./server";
import { ensureBootstrapOwnerLink } from "./bootstrap-owner";
import { ensureBootstrapBaristaLink } from "./bootstrap-barista";

// Cache exclusivo del request React; jamás comparte permisos entre usuarios ni turnos.
// La autorización continúa validándose en cada solicitud/acción del servidor.
const resolveCurrentEmployeeSession=cache(async function resolveCurrentEmployeeSession() {
  const device=localPrintAgentIdentity();
  if(device)return {status:"active" as const,...device}; // Sólo la ruta local autenticada crea este contexto.
  const supabase = await createSupabaseServerClient();
  // La firma ES256 de Supabase se verifica localmente con JWKS cacheado.
  // Evita una petición /auth/v1/user por cada refresco y acción de impresión.
  // La autorización real sigue consultando employees.is_active y los permisos de DB.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || claims.role !== "authenticated" || typeof claims.sub !== "string") {
    return {status:"unauthenticated" as const};
  }
  const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };

  const orgSlug = process.env.DEFAULT_ORGANIZATION_SLUG ?? "cafe-epico";
  const db = getDb();

  const findEmployee = async () => {
    const [row] = await db.select({ employee: employees })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(employees.userId, user.id),
        eq(organizations.slug, orgSlug),
        eq(employees.isActive, true),
      ))
      .limit(1);
    return row?.employee;
  };

  let employee = await findEmployee();

  // La tabla employees tiene user_id único a nivel de toda la base. Sólo en
  // Preview QA y con opt-in explícito, reutilizar la sesión autenticada de una
  // persona de producción para resolver su empleado SIMULADO en la organización QA.
  // No crea vínculos nuevos ni modifica el empleado o sus permisos de producción.
  if (!employee && orgSlug === "cafe-epico-qa" &&
      process.env.OPS_QA_MODE === "true") {
    const [original] = await db.select({ employee: employees })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(employees.userId, user.id),
        eq(organizations.slug, "cafe-epico"),
        eq(employees.isActive, true),
      ))
      .limit(1);
    if (original) {
      const matches = await db.select({ employee: employees })
        .from(employees)
        .innerJoin(organizations, eq(organizations.id, employees.organizationId))
        .where(and(
          eq(organizations.slug, "cafe-epico-qa"),
          eq(employees.name, "QA · " + original.employee.name),
          eq(employees.isActive, true),
        ))
        .limit(2);
      if (matches.length === 1 && matches[0].employee.userId === null)
        employee = matches[0].employee;
    }
  }

  if (!employee && !(orgSlug === "cafe-epico-qa" && process.env.OPS_QA_MODE === "true")) {
    const ownerBootstrap = await ensureBootstrapOwnerLink(user.id);
    if (ownerBootstrap.status !== "not-eligible") {
      employee = await findEmployee();
    }
  }

  if (!employee && !(orgSlug === "cafe-epico-qa" && process.env.OPS_QA_MODE === "true")) {
    const baristaBootstrap = await ensureBootstrapBaristaLink(user.id);
    if (baristaBootstrap.status !== "not-eligible") {
      employee = await findEmployee();
    }
  }

  if (!employee) {
    // Distinguir cuenta desactivada de usuario sin vínculo Auth.
    const [inactive] = await db.select({ id: employees.id })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(employees.userId, user.id),
        eq(organizations.slug, orgSlug),
        eq(employees.isActive, false),
      ))
      .limit(1);
    return {status:inactive?"inactive" as const:"unlinked" as const};
  }

  return {status:"active" as const, user, employee};
});

// Usar sólo en UI global (ej. menú). No redirige desde /login: si el
// empleado está inactivo, devuelve null y oculta la navegación.
export const getOptionalCurrentEmployee=cache(async function getOptionalCurrentEmployee() {
  const result=await resolveCurrentEmployeeSession();
  return result.status==="active"?{user:result.user,employee:result.employee}:null;
});

// Obliga a que cada página y acción protegida rechace las cuentas inactivas.
export const getCurrentEmployee=cache(async function getCurrentEmployee() {
  const result=await resolveCurrentEmployeeSession();
  if(result.status==="unauthenticated")redirect("/login");
  if(result.status==="inactive")redirect("/login?error=Cuenta%20de%20empleado%20desactivada");
  if(result.status==="unlinked")redirect("/login?error=Cuenta%20autenticada%20sin%20empleado%20vinculado");
  return {user:result.user,employee:result.employee};
});
