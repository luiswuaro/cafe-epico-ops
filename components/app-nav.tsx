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

  return (
    <nav className="nav" aria-label="Navegación principal">
      <Link href="/today">Hoy</Link>
      {canPos && <Link href="/pos">POS</Link>}
      {canPos && <Link href="/pos/orders">Comandas</Link>}
      {canPos && (
        <details className="nav-menu">
          <summary>Auditoría POS</summary>
          <div className="nav-popover">
            <Link href="/pos/tickets">Todos los tickets</Link>
            <Link href="/pos/customers">Clientes y puntos</Link>
            <Link href="/pos/customers/insights">Visitas y preferencias</Link>
            <Link href="/pos/inventory-audit">Inventario por venta</Link>
            <Link href="/pos/cash/history">Historial de cajas</Link>
          </div>
        </details>
      )}
      {canCash && <Link href="/pos/cash">Caja</Link>}
      <Link href="/checklists">Checklist</Link>
      <Link href="/handoff">Entrega</Link>
      <Link href="/inventory">Inventario</Link>

      <details className="nav-menu">
        <summary>Barra</summary>
        <div className="nav-popover">
          <Link href="/recipes">Recetas</Link>
          <Link href="/sops">SOPs</Link>
          <Link href="/quality/espresso">Espresso QC</Link>
          <Link href="/operations/report">Reportar</Link>
        </div>
      </details>

      {canAdmin && (
        <details className="nav-menu">
          <summary>Gestión</summary>
          <div className="nav-popover">
            <Link href="/admin/pos/catalog">Catálogo POS</Link>
            <Link href="/admin/pos/ticket">Ticket térmico</Link>
            <Link href="/admin/checklists">Tareas</Link>
            <Link href="/admin/reports/shifts">Turnos</Link>
            <Link href="/admin/reports/productivity">Productividad</Link>
            <Link href="/admin/roasting">Tueste</Link>
            <Link href="/admin">Admin</Link>
          </div>
        </details>
      )}

      <Link href="/account/security">Mi cuenta</Link>

      <form className="nav-signout" action="/auth/signout" method="post">
        <button type="submit">Salir</button>
      </form>
    </nav>
  );
}
