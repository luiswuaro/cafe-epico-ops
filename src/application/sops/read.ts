import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { sops, sopVersions } from "@/src/infrastructure/db/schema";

export async function listActiveSops(organizationId: string) {
  return getDb().select({ id: sops.id, title: sops.title, category: sops.category, versionId: sopVersions.id, majorVersion: sopVersions.majorVersion, minorVersion: sopVersions.minorVersion })
    .from(sops).innerJoin(sopVersions, eq(sopVersions.id, sops.currentVersionId))
    .where(and(eq(sops.organizationId, organizationId), eq(sops.isActive, true)));
}
export async function getSopVersion(organizationId: string, versionId: string) {
  const [row] = await getDb().select({ id: sopVersions.id, title: sops.title, category: sops.category, majorVersion: sopVersions.majorVersion, minorVersion: sopVersions.minorVersion, content: sopVersions.content })
    .from(sopVersions).innerJoin(sops, eq(sops.id, sopVersions.sopId))
    .where(and(eq(sops.organizationId, organizationId), eq(sopVersions.id, versionId))).limit(1);
  return row ?? null;
}
