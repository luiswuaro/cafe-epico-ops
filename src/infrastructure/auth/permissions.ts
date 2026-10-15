import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/src/infrastructure/db/client";
import { employeeRoles, employees, permissions, rolePermissions } from "@/src/infrastructure/db/schema";
import { getCurrentEmployee } from "./current-employee";

/**
 * Autoriza varios controles visibles mediante una sola consulta SQL.
 * Se vuelve a ejecutar en cada request: no hay caché entre usuarios ni
 * entre refrescos, y los permisos revocados dejan de mostrarse enseguida.
 * Los server actions siguen validando sus permisos de forma independiente.
 */
export async function getEmployeePermissions(
  employeeId: string,
  permissionCodes: readonly string[],
  storeId?: string,
): Promise<Set<string>> {
  if (permissionCodes.length === 0) return new Set();
  const db = getDb();
  const scope = storeId ? or(isNull(employeeRoles.storeId), eq(employeeRoles.storeId, storeId)) : undefined;
  const rows = await db.select({ code: permissions.code })
    .from(employees)
    .innerJoin(employeeRoles, eq(employeeRoles.employeeId, employees.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, employeeRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(employees.id, employeeId),
      eq(employees.isActive, true),
      inArray(permissions.code, [...permissionCodes]),
      scope,
    ));
  return new Set(rows.map(row => row.code));
}

export async function employeeHasPermission(employeeId: string, permissionCode: string, storeId?: string) {
  const db = getDb();
  const scope = storeId ? or(isNull(employeeRoles.storeId), eq(employeeRoles.storeId, storeId)) : undefined;
  const rows = await db.select({ employeeId: employees.id })
    .from(employees)
    .innerJoin(employeeRoles, eq(employeeRoles.employeeId, employees.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, employeeRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(employees.id, employeeId), eq(employees.isActive, true), eq(permissions.code, permissionCode), scope))
    .limit(1);
  return rows.length > 0;
}

export async function assertEmployeePermission(employeeId: string, permissionCode: string, storeId?: string) {
  if (!(await employeeHasPermission(employeeId, permissionCode, storeId))) throw new Error(`Missing permission: ${permissionCode}`);
}

export async function requirePermission(permissionCode: string, storeId?: string) {
  // Resolver siempre contra DEFAULT_ORGANIZATION_SLUG, igual que el POS.
  // Una cuenta puede tener perfiles en Café Épico y Café Épico QA;
  // nunca tomar el primer perfil arbitrario de la base compartida.
  const {user,employee}=await getCurrentEmployee();
  const scope=storeId ?? employee.homeStoreId ?? undefined;
  if (!(await employeeHasPermission(employee.id,permissionCode,scope)))
    redirect("/today?denied=1");
  return {user,employeeId:employee.id,organizationId:employee.organizationId};
}
