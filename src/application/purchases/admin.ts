import { asc, desc, eq } from "drizzle-orm";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  purchasePlanLines,
  purchasePlans,
  suppliers,
} from "@/src/infrastructure/db/schema";

export async function getPurchasingAdminData(organizationId: string) {
  const db = getDb();
  const [inventory, supplierRows, plans, lines] = await Promise.all([
    getInventoryIntelligence(organizationId),
    db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        city: suppliers.city,
        contact: suppliers.contact,
        notes: suppliers.notes,
        isActive: suppliers.isActive,
      })
      .from(suppliers)
      .where(eq(suppliers.organizationId, organizationId))
      .orderBy(asc(suppliers.name)),
    db
      .select()
      .from(purchasePlans)
      .where(eq(purchasePlans.organizationId, organizationId))
      .orderBy(desc(purchasePlans.plannedFor), desc(purchasePlans.createdAt))
      .limit(20),
    db
      .select({
        id: purchasePlanLines.id,
        purchasePlanId: purchasePlanLines.purchasePlanId,
        variantExternalId: purchasePlanLines.variantExternalId,
        itemNameSnapshot: purchasePlanLines.itemNameSnapshot,
        supplierId: purchasePlanLines.supplierId,
        supplierName: suppliers.name,
        requestedNativeQuantity: purchasePlanLines.requestedNativeQuantity,
        packageCount: purchasePlanLines.packageCount,
        packageNameSnapshot: purchasePlanLines.packageNameSnapshot,
        packageQuantitySnapshot: purchasePlanLines.packageQuantitySnapshot,
        unitCostSnapshot: purchasePlanLines.unitCostSnapshot,
        packagePriceSnapshot: purchasePlanLines.packagePriceSnapshot,
        estimatedTotal: purchasePlanLines.estimatedTotal,
        actualTotal: purchasePlanLines.actualTotal,
        status: purchasePlanLines.status,
        note: purchasePlanLines.note,
      })
      .from(purchasePlanLines)
      .leftJoin(suppliers, eq(suppliers.id, purchasePlanLines.supplierId))
      .where(eq(purchasePlanLines.organizationId, organizationId)),
  ]);

  const linesByPlan = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByPlan.get(line.purchasePlanId) ?? [];
    list.push(line);
    linesByPlan.set(line.purchasePlanId, list);
  }

  return {
    inventory,
    suppliers: supplierRows,
    plans: plans.map((plan) => ({
      ...plan,
      lines: linesByPlan.get(plan.id) ?? [],
    })),
  };
}
