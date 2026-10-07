import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { sops, sopVersions } from "@/src/infrastructure/db/schema";

export async function listSopsForAdmin(organizationId: string) {
  const db = getDb();

  const rows = await db
    .select({
      id: sops.id,
      title: sops.title,
      category: sops.category,
      isActive: sops.isActive,
      currentVersionId: sops.currentVersionId,
      majorVersion: sopVersions.majorVersion,
      minorVersion: sopVersions.minorVersion,
      status: sopVersions.status,
    })
    .from(sops)
    .leftJoin(sopVersions, eq(sopVersions.id, sops.currentVersionId))
    .where(eq(sops.organizationId, organizationId))
    .orderBy(asc(sops.category), asc(sops.title));

  const drafts = await db
    .select({
      id: sopVersions.id,
      sopId: sopVersions.sopId,
      majorVersion: sopVersions.majorVersion,
      minorVersion: sopVersions.minorVersion,
      updatedAt: sopVersions.updatedAt,
    })
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.organizationId, organizationId),
        eq(sopVersions.status, "DRAFT"),
      ),
    )
    .orderBy(desc(sopVersions.updatedAt));

  const draftBySop = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (!draftBySop.has(draft.sopId)) draftBySop.set(draft.sopId, draft);
  }

  return rows.map((row) => ({
    ...row,
    draft: draftBySop.get(row.id) ?? null,
  }));
}

export async function getSopAdminDetail(
  organizationId: string,
  sopId: string,
  versionId?: string,
) {
  const db = getDb();
  const [sop] = await db
    .select()
    .from(sops)
    .where(
      and(eq(sops.id, sopId), eq(sops.organizationId, organizationId)),
    )
    .limit(1);
  if (!sop) return null;

  const versions = await db
    .select()
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.sopId, sopId),
        eq(sopVersions.organizationId, organizationId),
      ),
    )
    .orderBy(desc(sopVersions.majorVersion), desc(sopVersions.minorVersion));

  const selected =
    versions.find((row) => row.id === versionId) ??
    versions.find((row) => row.status === "DRAFT") ??
    versions.find((row) => row.id === sop.currentVersionId) ??
    versions[0] ??
    null;

  return { sop, versions, selected };
}
