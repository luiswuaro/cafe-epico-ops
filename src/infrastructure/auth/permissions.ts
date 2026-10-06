import { and, eq, isNull, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/src/infrastructure/db/client";
import { employeeRoles, employees, permissions, rolePermissions } from "@/src/infrastructure/db/schema";
import { createSupabaseServerClient } from "./server";

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
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = getDb();
  const [employee] = await db.select({ id: employees.id, organizationId: employees.organizationId }).from(employees)
    .where(and(eq(employees.userId, user.id), eq(employees.isActive, true))).limit(1);
  if (!employee || !(await employeeHasPermission(employee.id, permissionCode, storeId))) redirect("/today?denied=1");
  return { user, employeeId: employee.id, organizationId: employee.organizationId };
}
