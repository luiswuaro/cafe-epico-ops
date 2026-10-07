import { asc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { posCustomers } from "@/src/infrastructure/db/schema";

export async function getPosCustomers(organizationId: string) {
  return getDb()
    .select({
      id: posCustomers.id,
      name: posCustomers.name,
      phone: posCustomers.phone,
      email: posCustomers.email,
      pointsBalance: posCustomers.pointsBalance,
    })
    .from(posCustomers)
    .where(eq(posCustomers.organizationId, organizationId))
    .orderBy(asc(posCustomers.name));
}
