import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/src/infrastructure/db/client";
import { employees, organizations } from "@/src/infrastructure/db/schema";
import { createSupabaseServerClient } from "./server";

export async function getCurrentEmployee() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const orgSlug = process.env.DEFAULT_ORGANIZATION_SLUG ?? "cafe-epico";
  const [employee] = await getDb().select({ employee: employees })
    .from(employees).innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(and(eq(employees.userId, user.id), eq(organizations.slug, orgSlug), eq(employees.isActive, true))).limit(1);
  if (!employee) throw new Error("Authenticated user is not linked to an employee record in the active organization");
  return { user, employee: employee.employee };
}
