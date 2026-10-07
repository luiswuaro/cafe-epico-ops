"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, sops, sopVersions } from "@/src/infrastructure/db/schema";

async function getDraft(
  organizationId: string,
  sopId: string,
  versionId: string,
) {
  const [draft] = await getDb()
    .select()
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.id, versionId),
        eq(sopVersions.sopId, sopId),
        eq(sopVersions.organizationId, organizationId),
        eq(sopVersions.status, "DRAFT"),
      ),
    )
    .limit(1);
  return draft ?? null;
}

export async function createSop(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!title || !category || !content) {
    redirect("/admin/sops?error=required");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("sop.manage");
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [sop] = await tx
      .insert(sops)
      .values({
        organizationId,
        title,
        category,
        isActive: true,
      })
      .returning({ id: sops.id });

    const [version] = await tx
      .insert(sopVersions)
      .values({
        organizationId,
        sopId: sop.id,
        majorVersion: 1,
        minorVersion: 0,
        status: "DRAFT",
        content,
        createdBy: user.id,
      })
      .returning({ id: sopVersions.id });

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "SOP_CREATED",
      entityType: "sop",
      entityId: sop.id,
      afterData: { title, category, versionId: version.id },
    });

    return { sopId: sop.id, versionId: version.id };
  });

  redirect(
    `/admin/sops/${created.sopId}?version=${created.versionId}`,
  );
}

export async function createSopDraft(formData: FormData) {
  const sopId = String(formData.get("sopId") ?? "");
  const { user, employeeId, organizationId } =
    await requirePermission("sop.manage");
  const db = getDb();

  const [existingDraft] = await db
    .select({ id: sopVersions.id })
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.sopId, sopId),
        eq(sopVersions.organizationId, organizationId),
        eq(sopVersions.status, "DRAFT"),
      ),
    )
    .orderBy(desc(sopVersions.updatedAt))
    .limit(1);

  if (existingDraft) {
    redirect(`/admin/sops/${sopId}?version=${existingDraft.id}`);
  }

  const [sop] = await db
    .select()
    .from(sops)
    .where(
      and(eq(sops.id, sopId), eq(sops.organizationId, organizationId)),
    )
    .limit(1);

  if (!sop?.currentVersionId) {
    redirect("/admin/sops?error=no-active");
  }

  const [current] = await db
    .select()
    .from(sopVersions)
    .where(eq(sopVersions.id, sop.currentVersionId))
    .limit(1);
  if (!current) redirect("/admin/sops?error=no-active");

  const allVersions = await db
    .select({
      majorVersion: sopVersions.majorVersion,
      minorVersion: sopVersions.minorVersion,
    })
    .from(sopVersions)
    .where(eq(sopVersions.sopId, sopId));

  const nextMinor =
    Math.max(
      ...allVersions
        .filter((row) => row.majorVersion === current.majorVersion)
        .map((row) => row.minorVersion),
      current.minorVersion,
    ) + 1;

  const [draft] = await db
    .insert(sopVersions)
    .values({
      organizationId,
      sopId,
      majorVersion: current.majorVersion,
      minorVersion: nextMinor,
      status: "DRAFT",
      content: current.content,
      createdBy: user.id,
    })
    .returning({ id: sopVersions.id });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "SOP_DRAFT_CREATED",
    entityType: "sop_version",
    entityId: draft.id,
    afterData: { sopId, sourceVersionId: current.id },
  });

  redirect(`/admin/sops/${sopId}?version=${draft.id}`);
}

export async function updateSopDraft(formData: FormData) {
  const sopId = String(formData.get("sopId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!title || !category || !content) {
    redirect(`/admin/sops/${sopId}?version=${versionId}&error=required`);
  }

  const { user, employeeId, organizationId } =
    await requirePermission("sop.manage");
  const draft = await getDraft(organizationId, sopId, versionId);
  if (!draft) throw new Error("Solo se editan borradores");

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(sops)
      .set({ title, category, updatedAt: new Date() })
      .where(eq(sops.id, sopId));
    await tx
      .update(sopVersions)
      .set({ content, updatedAt: new Date() })
      .where(eq(sopVersions.id, versionId));
    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "SOP_DRAFT_UPDATED",
      entityType: "sop_version",
      entityId: versionId,
      afterData: { title, category },
    });
  });

  revalidatePath("/sops");
  revalidatePath("/admin/sops");
  revalidatePath(`/admin/sops/${sopId}`);
}

export async function publishSopDraft(formData: FormData) {
  const sopId = String(formData.get("sopId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const { user, employeeId, organizationId } =
    await requirePermission("sop.manage");
  const db = getDb();
  const draft = await getDraft(organizationId, sopId, versionId);
  if (!draft) throw new Error("Solo se publica un borrador");

  const [sop] = await db
    .select()
    .from(sops)
    .where(
      and(eq(sops.id, sopId), eq(sops.organizationId, organizationId)),
    )
    .limit(1);
  if (!sop) throw new Error("SOP no encontrado");

  const now = new Date();
  await db.transaction(async (tx) => {
    if (sop.currentVersionId) {
      await tx
        .update(sopVersions)
        .set({
          status: "ARCHIVED",
          effectiveUntil: now,
          updatedAt: now,
        })
        .where(eq(sopVersions.id, sop.currentVersionId));
    }

    await tx
      .update(sopVersions)
      .set({
        status: "ACTIVE",
        effectiveFrom: now,
        approvedBy: user.id,
        updatedAt: now,
      })
      .where(eq(sopVersions.id, versionId));

    await tx
      .update(sops)
      .set({
        currentVersionId: versionId,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(sops.id, sopId));

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "SOP_VERSION_PUBLISHED",
      entityType: "sop_version",
      entityId: versionId,
      afterData: {
        sopId,
        majorVersion: draft.majorVersion,
        minorVersion: draft.minorVersion,
      },
    });
  });

  revalidatePath("/sops");
  revalidatePath("/admin/sops");
  revalidatePath(`/admin/sops/${sopId}`);
  redirect(`/admin/sops/${sopId}`);
}
