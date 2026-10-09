import { AppNavClient } from "./app-nav-client";
import { and, eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";
import { employeeHasPermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { employees } from "@/src/infrastructure/db/schema";

export async function AppNav() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [employee] = await getDb()
    .select({
      id: employees.id,
      homeStoreId: employees.homeStoreId,
    })
    .from(employees)
    .where(
      and(
        eq(employees.userId, user.id),
        eq(employees.isActive, true),
      ),
    )
    .limit(1);

  if (!employee) return null;

  const [canAdmin, canPos, canCash] = await Promise.all([
    employeeHasPermission(
      employee.id,
      "admin.access",
      employee.homeStoreId ?? undefined,
    ),
    employeeHasPermission(
      employee.id,
      "pos.sell",
      employee.homeStoreId ?? undefined,
    ),
    employeeHasPermission(
      employee.id,
      "pos.cash.manage",
      employee.homeStoreId ?? undefined,
    ),
  ]);

  return <AppNavClient canAdmin={canAdmin} canPos={canPos} canCash={canCash} />;
}
