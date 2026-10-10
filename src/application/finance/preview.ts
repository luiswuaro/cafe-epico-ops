import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { loyverseItemSettings, loyverseVariants, posOrderLines, posOrders, posPayments } from "@/src/infrastructure/db/schema";

type Component = {
  name: string; quantity: number; variantExternalId: string | null;
  inventoryPolicy?: string;
  costOnlyMeasure?: { estimatedCostMxn?: number | null } | null;
};

export type CostBreakdown = {
  known: number; packaging: number; unpriced: string[]; components: number; priced: number;
};
export type SalesLine = {
  name: string; category: string; service: "DINE_IN" | "TAKEAWAY"; units: number;
  revenue: number; cost: CostBreakdown;
};
export type MenuPreview = {
  id: string; name: string; category: string; price: number;
  dineIn: CostBreakdown; takeaway: CostBreakdown; thermos: CostBreakdown;
};

const round = (x: number) => Math.round(x * 10000) / 10000;
const number = (x: unknown) => x === null || x === undefined || x === "" ? null :
  Number.isFinite(Number(x)) ? Number(x) : null;
const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
export const isPackaging = (name: string) =>
  /VASO|TAPA|MANGA|FAJILLA|POPOTE|PAJILLA|SERVILLETA|BOLSA|AGITADOR|PORTAVASO/i.test(name);
const short = (s: string) => s.trim().toUpperCase();

export async function getFinancialPreview(organizationId: string) {
  const db = getDb();
  const localMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit",
  }).format(new Date());
  const [year, month] = localMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 6));
  const [orders, settings, variants, catalog] = await Promise.all([
    db.select({
      id: posOrders.id, total: posOrders.total, paidAt: posOrders.paidAt,
    }).from(posOrders).where(and(
      eq(posOrders.organizationId, organizationId),
      eq(posOrders.mode, "LIVE"), eq(posOrders.status, "PAID"),
      gte(posOrders.paidAt, start),
    )),
    db.select({
      variantId: loyverseItemSettings.variantExternalId,
      unitCost: loyverseItemSettings.unitCostOverride,
      packageQuantity: loyverseItemSettings.packageQuantityNative,
      packagePrice: loyverseItemSettings.packagePrice,
    }).from(loyverseItemSettings).where(eq(loyverseItemSettings.organizationId, organizationId)),
    db.select({
      externalId: loyverseVariants.externalId, payload: loyverseVariants.payload,
    }).from(loyverseVariants).where(eq(loyverseVariants.organizationId, organizationId)),
    getPosCatalog(organizationId),
  ]);
  const idList = orders.map(o => o.id);
  const [lines, payments] = idList.length ? await Promise.all([
    db.select({
      name: posOrderLines.nameSnapshot, category: posOrderLines.categorySnapshot,
      quantity: posOrderLines.quantity, revenue: posOrderLines.lineTotal,
      expected: posOrderLines.expectedConsumption,
    }).from(posOrderLines).where(inArray(posOrderLines.orderId, idList)),
    db.select({ method: posPayments.method, amount: posPayments.amount })
      .from(posPayments).where(inArray(posPayments.orderId, idList)),
  ]) : [[], []];
  const priceById = new Map<string, number>();
  const priceSource = new Map<string, string>();
  for (const v of variants) {
    const p = object(v.payload);
    const price = number(p.cost) ?? number(p.purchase_cost);
    if (price !== null && price >= 0) { priceById.set(v.externalId, price); priceSource.set(v.externalId, "LOYVERSE"); }
  }
  for (const setting of settings) {
    const direct = number(setting.unitCost);
    const qty = number(setting.packageQuantity);
    const total = number(setting.packagePrice);
    const price = direct ?? (qty !== null && qty > 0 && total !== null ? total / qty : null);
    if (price !== null && price >= 0) {
      priceById.set(setting.variantId, price); priceSource.set(setting.variantId, "CONFIGURED");
    }
  }

  function estimate(components: Component[], skipPackaging = false): CostBreakdown {
    let known = 0, packaging = 0, priced = 0;
    const unpriced: string[] = [];
    for (const comp of components) {
      if (skipPackaging && isPackaging(comp.name)) continue;
      const explicit = comp.costOnlyMeasure?.estimatedCostMxn;
      const calculated = explicit === null || explicit === undefined
        ? comp.variantExternalId ? priceById.get(comp.variantExternalId) : undefined
        : explicit;
      const cost = explicit === null || explicit === undefined
        ? calculated === undefined ? null : calculated * comp.quantity
        : explicit;
      if (cost === null || !Number.isFinite(cost) || cost < 0) {
        unpriced.push(comp.name); continue;
      }
      known += cost;
      if (isPackaging(comp.name)) packaging += cost;
      priced++;
    }
    return { known: round(known), packaging: round(packaging), unpriced: [...new Set(unpriced)], priced,
      components: components.filter(c => !skipPackaging || !isPackaging(c.name)).length };
  }
  const asComponents = (raw: unknown): Component[] => {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(value => {
      const c = object(value), qty = number(c.quantity);
      if (typeof c.name !== "string" || qty === null || qty < 0) return [];
      return [{
        name: c.name, quantity: qty,
        variantExternalId: typeof c.variantExternalId === "string" ? c.variantExternalId : null,
        inventoryPolicy: typeof c.inventoryPolicy === "string" ? c.inventoryPolicy : undefined,
        costOnlyMeasure: c.costOnlyMeasure && typeof c.costOnlyMeasure === "object"
          ? object(c.costOnlyMeasure) as Component["costOnlyMeasure"] : null,
      }];
    });
  };

  const observed: SalesLine[] = lines.map(l => {
    const snapshot = object(l.expected);
    const mode = snapshot.serviceMode === "DINE_IN" ? "DINE_IN" : "TAKEAWAY";
    return {
      name: l.name, category: l.category,
      service: mode, units: Number(l.quantity), revenue: Number(l.revenue),
      cost: estimate(asComponents(snapshot.components)),
    };
  });
  const menu: MenuPreview[] = catalog.filter(item => item.active).map(item => ({
    id: item.id, name: item.name, category: item.category, price: item.price,
    dineIn: estimate(item.serviceRecipes.DINE_IN.components),
    takeaway: estimate(item.serviceRecipes.TAKEAWAY.components),
    thermos: estimate(item.serviceRecipes.TAKEAWAY.components, true),
  }));
  const sumRevenue = orders.reduce((a, o) => a + Number(o.total), 0);
  const paid = payments.reduce<Record<string, number>>((a, p) => {
    const key = short(p.method);
    a[key] = (a[key] ?? 0) + Number(p.amount);
    return a;
  }, {});
  const dates = orders.map(o => o.paidAt).filter((d): d is Date => d !== null);
  const warnings = [
    "Sólo ventas pagadas en OPS LIVE. Tickets antiguos Loyverse y SHADOW no se vuelven a sumar.",
    "COGS de receta: costos actualmente configurados, no necesariamente costo histórico de compra.",
    "Agua con tarifa estimada si viene del snapshot; hielo y otros insumos sin precio reducen la cobertura.",
    "IVA 16% sin acreditamiento e ISR RESICO 2% se calculan en el simulador sobre ventas OPS con IVA incluido; no incluyen otros giros, retenciones ni declaración SAT.",
  ];
  return {
    month: localMonth, saleStart: dates.length ? new Date(Math.min(...dates.map(x => x.valueOf()))).toISOString() : null,
    orders: orders.length, sales: round(sumRevenue), payments: paid,
    lines: observed, menu, warnings, costSources: {
      configured: [...priceSource.values()].filter(x => x === "CONFIGURED").length,
      loyverse: [...priceSource.values()].filter(x => x === "LOYVERSE").length,
    },
  };
}
