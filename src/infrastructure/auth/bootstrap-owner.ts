import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  employeeRoles,
  employees,
  organizations,
  roles,
  userProfiles,
} from "@/src/infrastructure/db/schema";

export type BootstrapOwnerResult =
  | { status: "already-linked"; employeeId: string }
  | { status: "claimed-owner"; employeeId: string }
  | { status: "not-eligible" };

export async function ensureBootstrapOwnerLink(userId: string): Promise<BootstrapOwnerResult> {
  const db = getDb();
  const orgSlug = process.env.DEFAULT_ORGANIZATION_SLUG ?? "cafe-epico";

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ employeeId: employees.id })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(employees.userId, userId),
        eq(employees.isActive, true),
        eq(organizations.slug, orgSlug),
      ))
      .limit(1);

    if (existing) return { status: "already-linked" as const, employeeId: existing.employeeId };

    const [linkedOwner] = await tx
      .select({ employeeId: employees.id })
      .from(employees)
      .innerJoin(employeeRoles, eq(employeeRoles.employeeId, employees.id))
      .innerJoin(roles, eq(roles.id, employeeRoles.roleId))
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(organizations.slug, orgSlug),
        eq(roles.code, "OWNER"),
        eq(employees.isActive, true),
        isNotNull(employees.userId),
      ))
      .limit(1);

    if (linkedOwner) return { status: "not-eligible" as const };

    const candidates = await tx
      .select({
        employeeId: employees.id,
        organizationId: employees.organizationId,
        storeId: employees.homeStoreId,
        name: employees.name,
      })
      .from(employees)
      .innerJoin(employeeRoles, eq(employeeRoles.employeeId, employees.id))
      .innerJoin(roles, eq(roles.id, employeeRoles.roleId))
      .innerJoin(organizations, eq(organizations.id, employees.organizationId))
      .where(and(
        eq(organizations.slug, orgSlug),
        eq(roles.code, "OWNER"),
        eq(employees.isActive, true),
        isNull(employees.userId),
      ))
      .limit(2);

    if (candidates.length !== 1) return { status: "not-eligible" as const };

    const candidate = candidates[0];

    await tx.insert(userProfiles).values({
      id: userId,
      displayName: candidate.name,
    }).onConflictDoNothing();

    const [linked] = await tx
      .update(employees)
      .set({ userId, updatedAt: new Date() })
      .where(and(
        eq(employees.id, candidate.employeeId),
        isNull(employees.userId),
      ))
      .returning({ employeeId: employees.id });

    if (!linked) throw new Error("Owner bootstrap link lost a concurrent race");

    await tx.insert(auditEvents).values({
      organizationId: candidate.organizationId,
      storeId: candidate.storeId,
      actorUserId: userId,
      actorEmployeeId: linked.employeeId,
      action: "OWNER_BOOTSTRAP_LINKED",
      entityType: "employee",
      entityId: linked.employeeId,
      afterData: { role: "OWNER", bootstrap: true },
    });

    return { status: "claimed-owner" as const, employeeId: linked.employeeId };
  });
}
