import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCategories,
  loyverseCustomers,
  loyverseItemSettings,
  loyverseItems,
  loyverseReceiptLines,
  loyverseReceipts,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

type LineRollup = {
  units: number;
  beverageUnits: number;
  gross: number;
  net: number;
  cogs: number;
  discounts: number;
};

type PeriodMetrics = {
  key: "today" | "7d" | "15d" | "30d";
  label: string;
  days: number;
  sales: number;
  grossSales: number;
  discounts: number;
  discountRate: number;
  cogs: number;
  contribution: number;
  contributionPct: number;
  tickets: number;
  avgTicket: number;
  units: number;
  itemsPerTicket: number;
  tax: number;
  tips: number;
  identifiedTickets: number;
  captureRate: number;
  morningSales: number;
  afternoonSales: number;
  morningTickets: number;
  afternoonTickets: number;
  morningBeverageUnits: number;
  afternoonBeverageUnits: number;
  previousSales: number | null;
  previousTickets: number | null;
  salesChangePct: number | null;
  ticketsChangePct: number | null;
  avgTicketChangePct: number | null;
};

const FOOD_NAMES = new Set([
  "CROISSANT JAMÓN",
  "Cuernitos jamon y queso",
  "FLAN",
  "Muffins",
  "Pan SOLO",
  "Rebanada de panqué de zanahoria",
]);

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown) {
  return value === true || value === "true";
}

function rec(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((row) => row.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    weekday: part("weekday"),
  };
}

function dateKeys(count: number, offset = 0) {
  const set = new Set<string>();
  for (let i = offset; i < offset + count; i++) {
    set.add(localParts(new Date(Date.now() - i * 86_400_000)).date);
  }
  return set;
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function isFood(name: string) {
  return FOOD_NAMES.has(name);
}

export async function getBusinessAnalytics(organizationId: string) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [receipts, lines, customers, items, variants, categories, settings] =
    await Promise.all([
      db
        .select({
          externalId: loyverseReceipts.externalId,
          receiptDate: loyverseReceipts.receiptDate,
          totalMoney: loyverseReceipts.totalMoney,
          payload: loyverseReceipts.payload,
        })
        .from(loyverseReceipts)
        .where(
          and(
            eq(loyverseReceipts.organizationId, organizationId),
            eq(loyverseReceipts.receiptType, "SALE"),
            gte(loyverseReceipts.receiptDate, since),
          ),
        ),
      db
        .select({
          receiptExternalId: loyverseReceiptLines.receiptExternalId,
          variantExternalId: loyverseReceiptLines.variantExternalId,
          quantity: loyverseReceiptLines.quantity,
          grossTotalMoney: loyverseReceiptLines.grossTotalMoney,
          payload: loyverseReceiptLines.payload,
        })
        .from(loyverseReceiptLines)
        .where(eq(loyverseReceiptLines.organizationId, organizationId)),
      db
        .select({ payload: loyverseCustomers.payload })
        .from(loyverseCustomers)
        .where(eq(loyverseCustomers.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseItems.externalId,
          itemName: loyverseItems.itemName,
          payload: loyverseItems.payload,
        })
        .from(loyverseItems)
        .where(eq(loyverseItems.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseVariants.externalId,
          itemExternalId: loyverseVariants.loyverseItemExternalId,
          payload: loyverseVariants.payload,
        })
        .from(loyverseVariants)
        .where(eq(loyverseVariants.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseCategories.externalId,
          name: loyverseCategories.name,
        })
        .from(loyverseCategories)
        .where(eq(loyverseCategories.organizationId, organizationId)),
      db
        .select({
          variantExternalId: loyverseItemSettings.variantExternalId,
          unitCostOverride: loyverseItemSettings.unitCostOverride,
          packageQuantityNative: loyverseItemSettings.packageQuantityNative,
          packagePrice: loyverseItemSettings.packagePrice,
        })
        .from(loyverseItemSettings)
        .where(eq(loyverseItemSettings.organizationId, organizationId)),
    ]);

  const receiptById = new Map(
    receipts.map((receipt) => [receipt.externalId, receipt]),
  );
  const itemById = new Map(items.map((item) => [item.externalId, item]));
  const variantById = new Map(
    variants.map((variant) => [variant.externalId, variant]),
  );
  const categoryById = new Map(
    categories.map((category) => [category.externalId, category.name]),
  );
  const settingByVariant = new Map(
    settings.map((setting) => [setting.variantExternalId, setting]),
  );

  function components(payload: Record<string, unknown>) {
    const raw = payload.components;
    if (!Array.isArray(raw)) {
      return [] as Array<{ variantId: string; quantity: number }>;
    }
    return raw.flatMap((value) => {
      const row = rec(value);
      const variantId =
        typeof row.variant_id === "string" ? row.variant_id : "";
      const quantity = Number(row.quantity);
      if (!variantId || !Number.isFinite(quantity)) return [];
      return [{ variantId, quantity }];
    });
  }

  const unitCostMemo = new Map<string, number | null>();
  function currentUnitCost(
    variantId: string,
    path = new Set<string>(),
  ): number | null {
    if (unitCostMemo.has(variantId)) {
      return unitCostMemo.get(variantId) ?? null;
    }
    if (path.has(variantId)) return null;

    const variant = variantById.get(variantId);
    const item = variant?.itemExternalId
      ? itemById.get(variant.itemExternalId)
      : null;
    if (!variant || !item) return null;

    const children = components(item.payload);
    if (bool(item.payload.is_composite) && children.length > 0) {
      const next = new Set(path);
      next.add(variantId);
      let total = 0;
      for (const child of children) {
        const childCost = currentUnitCost(child.variantId, next);
        if (childCost == null) {
          unitCostMemo.set(variantId, null);
          return null;
        }
        total += childCost * child.quantity;
      }
      unitCostMemo.set(variantId, total);
      return total;
    }

    const setting = settingByVariant.get(variantId);
    const override = nullableNum(setting?.unitCostOverride);
    const packagePrice = nullableNum(setting?.packagePrice);
    const packageQty = nullableNum(setting?.packageQuantityNative);
    const packageUnitCost =
      packagePrice != null && packageQty != null && packageQty > 0
        ? packagePrice / packageQty
        : null;
    const variantPayload = variant.payload;
    const loyverseCost =
      nullableNum(variantPayload.cost) ??
      nullableNum(variantPayload.purchase_cost);
    const resolved = override ?? packageUnitCost ?? loyverseCost;
    unitCostMemo.set(variantId, resolved);
    return resolved;
  }

  const lineByReceipt = new Map<string, LineRollup>();
  const product30 = new Map<
    string,
    {
      qty: number;
      sales: number;
      cogs: number;
      discounts: number;
      configuredCogs: number;
      configuredSales: number;
      configuredQty: number;
    }
  >();
  const category30 = new Map<
    string,
    { qty: number; sales: number; cogs: number }
  >();

  for (const line of lines) {
    const receipt = receiptById.get(line.receiptExternalId);
    if (!receipt?.receiptDate) continue;

    const payload = line.payload;
    const qty = num(line.quantity);
    const gross = num(payload.gross_total_money ?? line.grossTotalMoney);
    const net = num(payload.total_money ?? line.grossTotalMoney);
    const cogs = num(payload.cost_total ?? num(payload.cost) * qty);
    const discounts = num(payload.total_discount);
    const name =
      typeof payload.item_name === "string"
        ? payload.item_name
        : "Sin nombre";
    const current = lineByReceipt.get(line.receiptExternalId) ?? {
      units: 0,
      beverageUnits: 0,
      gross: 0,
      net: 0,
      cogs: 0,
      discounts: 0,
    };
    current.units += qty;
    if (!isFood(name)) current.beverageUnits += qty;
    current.gross += gross;
    current.net += net;
    current.cogs += cogs;
    current.discounts += discounts;
    lineByReceipt.set(line.receiptExternalId, current);
    const product = product30.get(name) ?? {
      qty: 0,
      sales: 0,
      cogs: 0,
      discounts: 0,
      configuredCogs: 0,
      configuredSales: 0,
      configuredQty: 0,
    };
    product.qty += qty;
    product.sales += net;
    product.cogs += cogs;
    product.discounts += discounts;
    if (line.variantExternalId) {
      const configuredUnitCost = currentUnitCost(line.variantExternalId);
      if (configuredUnitCost != null) {
        product.configuredCogs += configuredUnitCost * qty;
        product.configuredSales += net;
        product.configuredQty += qty;
      }
    }
    product30.set(name, product);

    const variant = line.variantExternalId
      ? variantById.get(line.variantExternalId)
      : null;
    const item = variant?.itemExternalId
      ? itemById.get(variant.itemExternalId)
      : null;
    const categoryId =
      typeof item?.payload.category_id === "string"
        ? item.payload.category_id
        : "";
    const category =
      categoryById.get(categoryId) ??
      (isFood(name) ? "ALIMENTOS" : "SIN CATEGORÍA");
    const cat = category30.get(category) ?? {
      qty: 0,
      sales: 0,
      cogs: 0,
    };
    cat.qty += qty;
    cat.sales += net;
    cat.cogs += cogs;
    category30.set(category, cat);
  }

  function aggregate(keys: Set<string>) {
    let sales = 0;
    let grossSales = 0;
    let discounts = 0;
    let cogs = 0;
    let tickets = 0;
    let units = 0;
    let tax = 0;
    let tips = 0;
    let identifiedTickets = 0;
    let morningSales = 0;
    let afternoonSales = 0;
    let morningTickets = 0;
    let afternoonTickets = 0;
    let morningBeverageUnits = 0;
    let afternoonBeverageUnits = 0;

    for (const receipt of receipts) {
      if (!receipt.receiptDate) continue;
      const local = localParts(receipt.receiptDate);
      if (!keys.has(local.date)) continue;

      const payload = receipt.payload;
      const lineRollup = lineByReceipt.get(receipt.externalId);
      const receiptSales = num(receipt.totalMoney);
      tickets += 1;
      sales += receiptSales;
      grossSales += lineRollup?.gross ?? receiptSales + num(payload.total_discount);
      discounts +=
        lineRollup?.discounts ?? num(payload.total_discount);
      cogs += lineRollup?.cogs ?? 0;
      units += lineRollup?.units ?? 0;
      tax += num(payload.total_tax);
      tips += num(payload.tip);
      if (
        typeof payload.customer_id === "string" &&
        payload.customer_id
      ) {
        identifiedTickets += 1;
      }
      if (local.hour < 16) {
        morningSales += receiptSales;
        morningTickets += 1;
        morningBeverageUnits += lineRollup?.beverageUnits ?? 0;
      } else {
        afternoonSales += receiptSales;
        afternoonTickets += 1;
        afternoonBeverageUnits += lineRollup?.beverageUnits ?? 0;
      }
    }

    const contribution = sales - cogs;
    return {
      sales,
      grossSales,
      discounts,
      discountRate:
        grossSales > 0 ? (discounts / grossSales) * 100 : 0,
      cogs,
      contribution,
      contributionPct:
        sales > 0 ? (contribution / sales) * 100 : 0,
      tickets,
      avgTicket: tickets > 0 ? sales / tickets : 0,
      units,
      itemsPerTicket: tickets > 0 ? units / tickets : 0,
      tax,
      tips,
      identifiedTickets,
      captureRate:
        tickets > 0 ? (identifiedTickets / tickets) * 100 : 0,
      morningSales,
      afternoonSales,
      morningTickets,
      afternoonTickets,
      morningBeverageUnits,
      afternoonBeverageUnits,
    };
  }

  const periodDefs = [
    { key: "today" as const, label: "Hoy", days: 1 },
    { key: "7d" as const, label: "7 días", days: 7 },
    { key: "15d" as const, label: "15 días", days: 15 },
    { key: "30d" as const, label: "30 días", days: 30 },
  ];

  const periods: PeriodMetrics[] = periodDefs.map((definition) => {
    const current = aggregate(dateKeys(definition.days));
    const canCompare = definition.days < 30;
    const previous = canCompare
      ? aggregate(dateKeys(definition.days, definition.days))
      : null;
    return {
      ...definition,
      ...current,
      previousSales: previous?.sales ?? null,
      previousTickets: previous?.tickets ?? null,
      salesChangePct: previous
        ? pctChange(current.sales, previous.sales)
        : null,
      ticketsChangePct: previous
        ? pctChange(current.tickets, previous.tickets)
        : null,
      avgTicketChangePct: previous
        ? pctChange(current.avgTicket, previous.avgTicket)
        : null,
    };
  });

  const daily = [...dateKeys(30)]
    .map((date) => {
      const metrics = aggregate(new Set([date]));
      return { date, ...metrics };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tickets: 0,
    sales: 0,
  }));
  const payments = new Map<string, number>();
  const dining = new Map<string, { tickets: number; sales: number }>();

  for (const receipt of receipts) {
    if (!receipt.receiptDate) continue;
    const local = localParts(receipt.receiptDate);
    const sales = num(receipt.totalMoney);
    hourly[local.hour].tickets += 1;
    hourly[local.hour].sales += sales;

    const payload = receipt.payload;
    const paymentRows = Array.isArray(payload.payments)
      ? payload.payments
      : [];
    for (const raw of paymentRows) {
      const payment = rec(raw);
      const name =
        typeof payment.name === "string"
          ? payment.name
          : typeof payment.type === "string"
            ? payment.type
            : "Otro";
      payments.set(
        name,
        (payments.get(name) ?? 0) + num(payment.money_amount),
      );
    }

    const diningOption =
      typeof payload.dining_option === "string" && payload.dining_option
        ? payload.dining_option
        : "Sin opción";
    const diningRow = dining.get(diningOption) ?? {
      tickets: 0,
      sales: 0,
    };
    diningRow.tickets += 1;
    diningRow.sales += sales;
    dining.set(diningOption, diningRow);
  }

  const topProducts = [...product30.entries()]
    .map(([name, values]) => {
      const configuredCoveragePct =
        values.qty > 0
          ? Math.min(100, (values.configuredQty / values.qty) * 100)
          : 0;
      const configuredContribution =
        values.configuredSales - values.configuredCogs;
      const configuredContributionPct =
        values.configuredSales > 0
          ? (configuredContribution / values.configuredSales) * 100
          : null;

      return {
        name,
        ...values,
        contribution: values.sales - values.cogs,
        contributionPct:
          values.sales > 0
            ? ((values.sales - values.cogs) / values.sales) * 100
            : 0,
        configuredCoveragePct,
        configuredContribution,
        configuredContributionPct,
        effectiveContributionPct:
          configuredCoveragePct >= 80 &&
          configuredContributionPct != null
            ? configuredContributionPct
            : values.sales > 0
              ? ((values.sales - values.cogs) / values.sales) * 100
              : 0,
        costBasis:
          configuredCoveragePct >= 80
            ? ("CONFIGURED" as const)
            : ("LOYVERSE" as const),
      };
    })
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 15);

  const categories30 = [...category30.entries()]
    .map(([name, values]) => ({
      name,
      ...values,
      contribution: values.sales - values.cogs,
      contributionPct:
        values.sales > 0
          ? ((values.sales - values.cogs) / values.sales) * 100
          : 0,
    }))
    .sort((a, b) => b.sales - a.sales);

  const activeCustomers = customers.filter(
    (customer) => customer.payload.deleted_at == null,
  );
  const customerStats = activeCustomers.map((customer) => ({
    createdAt:
      typeof customer.payload.created_at === "string"
        ? new Date(customer.payload.created_at)
        : null,
    visits: num(customer.payload.total_visits),
    spent: num(customer.payload.total_spent),
  }));
  const now = Date.now();
  const loyalty = {
    customers: activeCustomers.length,
    new7: customerStats.filter(
      (customer) =>
        customer.createdAt &&
        now - customer.createdAt.getTime() <= 7 * 86_400_000,
    ).length,
    new15: customerStats.filter(
      (customer) =>
        customer.createdAt &&
        now - customer.createdAt.getTime() <= 15 * 86_400_000,
    ).length,
    new30: customerStats.filter(
      (customer) =>
        customer.createdAt &&
        now - customer.createdAt.getTime() <= 30 * 86_400_000,
    ).length,
    activated: customerStats.filter((customer) => customer.visits >= 1)
      .length,
    repeat: customerStats.filter((customer) => customer.visits >= 2)
      .length,
    averageVisits:
      customerStats.length > 0
        ? customerStats.reduce((sum, row) => sum + row.visits, 0) /
          customerStats.length
        : 0,
    averageSpent:
      customerStats.length > 0
        ? customerStats.reduce((sum, row) => sum + row.spent, 0) /
          customerStats.length
        : 0,
  };

  const period30 = periods.find((period) => period.key === "30d")!;
  const peakHour = hourly
    .filter((row) => row.tickets > 0)
    .sort((a, b) => b.sales - a.sales)[0] ?? null;

  const suggestions: Array<{
    level: "INFO" | "ACTION";
    title: string;
    detail: string;
  }> = [];

  const seven = periods.find((period) => period.key === "7d")!;
  if (
    seven.salesChangePct != null &&
    seven.salesChangePct <= -8 &&
    seven.ticketsChangePct != null &&
    seven.ticketsChangePct <= -8 &&
    seven.avgTicketChangePct != null &&
    Math.abs(seven.avgTicketChangePct) < 5
  ) {
    suggestions.push({
      level: "ACTION",
      title: "La caída viene de tráfico",
      detail: `Ventas 7d ${seven.salesChangePct.toFixed(
        1,
      )}% y tickets ${seven.ticketsChangePct.toFixed(
        1,
      )}%, con ticket promedio relativamente estable.`,
    });
  }

  if (period30.captureRate < 40) {
    suggestions.push({
      level: "ACTION",
      title: "Subir captura de lealtad",
      detail: `Solo ${period30.captureRate.toFixed(
        1,
      )}% de los tickets de 30 días están asociados a cliente.`,
    });
  }

  if (period30.discountRate > 5) {
    suggestions.push({
      level: "INFO",
      title: "Descuentos relevantes",
      detail: `Los descuentos equivalen a ${period30.discountRate.toFixed(
        1,
      )}% de la venta bruta de 30 días.`,
    });
  }

  return {
    periods,
    daily,
    hourly: hourly.filter((row) => row.tickets > 0),
    payments: [...payments.entries()]
      .map(([name, sales]) => ({ name, sales }))
      .sort((a, b) => b.sales - a.sales),
    dining: [...dining.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.sales - a.sales),
    topProducts,
    categories30,
    loyalty,
    peakHour,
    suggestions,
  };
}
