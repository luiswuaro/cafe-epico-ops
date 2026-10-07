import Link from "next/link";
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

  const canAdmin = await employeeHasPermission(
    employee.id,
    "admin.access",
    employee.homeStoreId ?? undefined,
  );

  return (
    <nav className="nav">
      <Link href="/today">Hoy</Link>
      <Link href="/checklists">Checklist</Link>
      <Link href="/handoff">Entrega</Link>
      <Link href="/inventory">Inventario</Link>
      <Link href="/recipes">Recetas</Link>
      <Link href="/sops">SOPs</Link>
      <Link href="/quality/espresso">Espresso QC</Link>
      {canAdmin && <Link href="/admin/roasting">Tueste</Link>}
      {canAdmin && <Link href="/admin">Admin</Link>}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          style={{
            border: 0,
            background: "transparent",
            padding: 0,
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Salir
        </button>
      </form>
    </nav>
  );
}
