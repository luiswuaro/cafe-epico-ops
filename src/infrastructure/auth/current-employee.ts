import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/src/infrastructure/db/client";
import { employees, organizations } from "@/src/infrastructure/db/schema";
import { createSupabaseServerClient } from "./server";
import { ensureBootstrapOwnerLink } from "./bootstrap-owner";

export async function getCurrentEmployee() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  if (!employee) {
    const bootstrap = await ensureBootstrapOwnerLink(user.id);
    if (bootstrap.status !== "not-eligible") {
      employee = await findEmployee();
    }
  }

  if (!employee) {
    redirect("/login?error=Cuenta%20autenticada%20sin%20empleado%20vinculado");
  }

  return { user, employee };
}
