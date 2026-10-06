import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { loyverseCustomers, loyverseInventoryLevels, loyverseItems, loyverseReceiptLines, loyverseReceipts, loyverseStores, loyverseVariants, organizations } from "@/src/infrastructure/db/schema";
import { LoyverseClient } from "@/src/infrastructure/loyverse/client";

const asDate = (value: unknown) => typeof value === "string" && value ? new Date(value) : null;
const asString = (value: unknown) => typeof value === "string" ? value : "";
const asNumber = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);

async function context() {
  const token = process.env.LOYVERSE_ACCESS_TOKEN;
  if (!token) throw new Error("LOYVERSE_ACCESS_TOKEN is not configured");
  const db = getDb();
  const slug = process.env.DEFAULT_ORGANIZATION_SLUG ?? "cafe-epico";
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) throw new Error(`Organization ${slug} not found`);
  return { db, orgId: org.id, client: new LoyverseClient(token) };
}

export async function syncLoyverseStores() {
  const { db, orgId, client } = await context();
  const data = await client.get<{ stores: Record<string, unknown>[] }>("/stores");
  for (const store of data.stores ?? []) {
    const externalId = asString(store.id); if (!externalId) continue;
    await db.insert(loyverseStores).values({ externalId, organizationId: orgId, name: asString(store.name) || "Unnamed", payload: store, externalUpdatedAt: asDate(store.updated_at) })
      .onConflictDoUpdate({ target: [loyverseStores.organizationId, loyverseStores.externalId], set: { name: asString(store.name) || "Unnamed", payload: store, externalUpdatedAt: asDate(store.updated_at), syncedAt: new Date() } });
  }
  return data.stores?.length ?? 0;
}

export async function syncLoyverseItems(updatedAtMin?: string) {
  const { db, orgId, client } = await context(); let count = 0;
  for await (const items of client.paginate<Record<string, unknown>>("/items", "items", { updated_at_min: updatedAtMin })) {
    for (const item of items) {
      const externalId = asString(item.id); if (!externalId) continue;
      await db.insert(loyverseItems).values({ externalId, organizationId: orgId, itemName: asString(item.item_name) || "Unnamed", deletedAt: asDate(item.deleted_at), payload: item, externalUpdatedAt: asDate(item.updated_at) })
        .onConflictDoUpdate({ target: [loyverseItems.organizationId, loyverseItems.externalId], set: { itemName: asString(item.item_name) || "Unnamed", deletedAt: asDate(item.deleted_at), payload: item, externalUpdatedAt: asDate(item.updated_at), syncedAt: new Date() } });
      const variants = Array.isArray(item.variants) ? item.variants as Record<string,unknown>[] : [];
      for (const variant of variants) {
        const variantId = asString(variant.variant_id || variant.id); if (!variantId) continue;
        await db.insert(loyverseVariants).values({ externalId: variantId, organizationId: orgId, loyverseItemExternalId: externalId, variantName: asString(variant.option1_value || variant.name) || null, sku: asString(variant.sku) || null, payload: variant })
          .onConflictDoUpdate({ target: [loyverseVariants.organizationId, loyverseVariants.externalId], set: { loyverseItemExternalId: externalId, variantName: asString(variant.option1_value || variant.name) || null, sku: asString(variant.sku) || null, payload: variant, syncedAt: new Date() } });
      }
      count++;
    }
  }
  return count;
}

export async function syncLoyverseInventory(updatedAtMin?: string) {
  const { db, orgId, client } = await context(); let count = 0;
  for await (const levels of client.paginate<Record<string, unknown>>("/inventory", "inventory_levels", { updated_at_min: updatedAtMin })) {
    for (const level of levels) {
      const variantExternalId = asString(level.variant_id), storeExternalId = asString(level.store_id);
      if (!variantExternalId || !storeExternalId) continue;
      await db.insert(loyverseInventoryLevels).values({ organizationId: orgId, variantExternalId, storeExternalId, inStock: String(asNumber(level.in_stock)), externalUpdatedAt: asDate(level.updated_at) })
        .onConflictDoUpdate({ target: [loyverseInventoryLevels.organizationId, loyverseInventoryLevels.variantExternalId, loyverseInventoryLevels.storeExternalId], set: { inStock: String(asNumber(level.in_stock)), externalUpdatedAt: asDate(level.updated_at), syncedAt: new Date() } });
      count++;
    }
  }
  return count;
}

export async function syncLoyverseCustomers(updatedAtMin?: string) {
  const { db, orgId, client } = await context(); let count = 0;
  for await (const customers of client.paginate<Record<string, unknown>>("/customers", "customers", { updated_at_min: updatedAtMin })) {
    for (const customer of customers) {
      const externalId = asString(customer.id); if (!externalId) continue;
      const name = [asString(customer.name), asString(customer.customer_code)].find(Boolean) ?? null;
      await db.insert(loyverseCustomers).values({ externalId, organizationId: orgId, name, payload: customer, externalUpdatedAt: asDate(customer.updated_at) })
        .onConflictDoUpdate({ target: [loyverseCustomers.organizationId, loyverseCustomers.externalId], set: { name, payload: customer, externalUpdatedAt: asDate(customer.updated_at), syncedAt: new Date() } });
      count++;
    }
  }
  return count;
}

export async function syncLoyverseReceipts(updatedAtMin?: string) {
  const { db, orgId, client } = await context(); let count = 0;
  for await (const receipts of client.paginate<Record<string, unknown>>("/receipts", "receipts", { updated_at_min: updatedAtMin })) {
    for (const receipt of receipts) {
      const externalId = asString(receipt.receipt_number); if (!externalId) continue;
      await db.transaction(async (tx) => {
        await tx.insert(loyverseReceipts).values({ externalId, organizationId: orgId, storeExternalId: asString(receipt.store_id) || null, receiptType: asString(receipt.receipt_type) || null, totalMoney: String(asNumber(receipt.total_money)), receiptDate: asDate(receipt.receipt_date), externalUpdatedAt: asDate(receipt.updated_at), payload: receipt }).onConflictDoUpdate({ target: [loyverseReceipts.organizationId, loyverseReceipts.externalId], set: { storeExternalId: asString(receipt.store_id) || null, receiptType: asString(receipt.receipt_type) || null, totalMoney: String(asNumber(receipt.total_money)), receiptDate: asDate(receipt.receipt_date), externalUpdatedAt: asDate(receipt.updated_at), payload: receipt, syncedAt: new Date() } });
        await tx.delete(loyverseReceiptLines).where(and(eq(loyverseReceiptLines.organizationId, orgId), eq(loyverseReceiptLines.receiptExternalId, externalId)));
        const lines = Array.isArray(receipt.line_items) ? receipt.line_items as Record<string,unknown>[] : [];
        if (lines.length) await tx.insert(loyverseReceiptLines).values(lines.map((line) => ({ organizationId: orgId, receiptExternalId: externalId, lineExternalId: asString(line.id) || null, variantExternalId: asString(line.variant_id) || null, quantity: String(asNumber(line.quantity)), grossTotalMoney: line.gross_total_money == null ? null : String(asNumber(line.gross_total_money)), payload: line })));
      });
      count++;
    }
  }
  return count;
}

export async function initialSyncLoyverse(receiptBackfillDays = 31) {
  const receiptSince = new Date(Date.now() - receiptBackfillDays * 86_400_000).toISOString();
  const stores = await syncLoyverseStores();
  const items = await syncLoyverseItems();
  const inventory = await syncLoyverseInventory();
  const customers = await syncLoyverseCustomers();
  const receipts = await syncLoyverseReceipts(receiptSince);
  return { stores, items, inventory, customers, receipts, receiptSince };
}

export async function reconcileLoyverse(overlapMinutes = 20) {
  const since = new Date(Date.now() - overlapMinutes * 60_000).toISOString();
  const stores = await syncLoyverseStores();
  const items = await syncLoyverseItems(since);
  const inventory = await syncLoyverseInventory(since);
  const customers = await syncLoyverseCustomers(since);
  const receipts = await syncLoyverseReceipts(since);
  return { stores, items, inventory, customers, receipts, since };
}
