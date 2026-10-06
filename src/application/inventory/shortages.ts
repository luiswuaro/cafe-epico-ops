import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { shortageReports } from "@/src/infrastructure/db/schema";

export async function listOpenShortages(
  organizationId: string,
  storeId: string,
) {
  return getDb()
    .select({
      id: shortageReports.id,
      itemName: shortageReports.itemName,
      quantityNeeded: shortageReports.quantityNeeded,
      unit: shortageReports.unit,
      priority: shortageReports.priority,
      note: shortageReports.note,
      reportedBy: shortageReports.reportedBy,
      createdAt: shortageReports.createdAt,
    })
    .from(shortageReports)
    .where(
      and(
        eq(shortageReports.organizationId, organizationId),
        eq(shortageReports.storeId, storeId),
        eq(shortageReports.status, "OPEN"),
      ),
    )
    .orderBy(
      sql`case when ${shortageReports.priority} = 'URGENT' then 0 else 1 end`,
      desc(shortageReports.createdAt),
    );
}

export async function countOpenShortages(
  organizationId: string,
  storeId: string,
) {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(shortageReports)
    .where(
      and(
        eq(shortageReports.organizationId, organizationId),
        eq(shortageReports.storeId, storeId),
        eq(shortageReports.status, "OPEN"),
      ),
    );

  return row?.count ?? 0;
}
