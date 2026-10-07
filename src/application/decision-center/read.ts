import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getBusinessAnalytics } from "@/src/application/analytics/business";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getProductivityReport } from "@/src/application/reports/productivity";
import { getRoastingDashboard } from "@/src/application/roasting/dashboard";
import { getDb } from "@/src/infrastructure/db/client";
import { operationalEvents } from "@/src/infrastructure/db/schema";

type Decision = {
  level: "ACTION" | "WATCH" | "INFO";
  area:
    | "VENTAS"
    | "INVENTARIO"
    | "COMPRAS"
    | "TUESTE"
    | "OPERACIÓN"
    | "PERSONAL"
    | "DATOS";
  title: string;
  detail: string;
  href: string;
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export async function getDecisionCenter(organizationId: string) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [
    analytics,
    inventory,
    roasting,
    productivity,
    openEvents,
    recentOperationalEvents,
  ] = await Promise.all([
      getBusinessAnalytics(organizationId),
      getInventoryIntelligence(organizationId),
      getRoastingDashboard(organizationId),
      getProductivityReport(organizationId, 14),
      getDb()
        .select({
          id: operationalEvents.id,
          eventType: operationalEvents.eventType,
          severity: operationalEvents.severity,
          itemNameSnapshot: operationalEvents.itemNameSnapshot,
          note: operationalEvents.note,
          occurredAt: operationalEvents.occurredAt,
        })
        .from(operationalEvents)
        .where(
          and(
            eq(operationalEvents.organizationId, organizationId),
            isNull(operationalEvents.resolvedAt),
          ),
        )
        .orderBy(desc(operationalEvents.occurredAt))
        .limit(50),
      getDb()
        .select({
          eventType: operationalEvents.eventType,
          variantExternalId: operationalEvents.variantExternalId,
          quantity: operationalEvents.quantity,
        })
        .from(operationalEvents)
        .where(
          and(
            eq(operationalEvents.organizationId, organizationId),
            gte(operationalEvents.occurredAt, since30),
          ),
        ),
    ]);

  const today = analytics.periods.find((period) => period.key === "today")!;
  const seven = analytics.periods.find((period) => period.key === "7d")!;
  const fifteen = analytics.periods.find((period) => period.key === "15d")!;
  const thirty = analytics.periods.find((period) => period.key === "30d")!;

  const decisions: Decision[] = [];

  const criticalInventory = inventory.smartRows.filter(
    (row) => row.status === "CRITICAL",
  );
  const watchInventory = inventory.smartRows.filter(
    (row) => row.status === "WATCH",
  );

  if (criticalInventory.length > 0) {
    const first = criticalInventory.slice(0, 3);
    decisions.push({
      level: "ACTION",
      area: "INVENTARIO",
      title: criticalInventory.length + " insumo(s) críticos",
      detail: first
        .map((row) =>
          row.itemName +
          (row.daysCover == null
            ? ""
            : " · " + row.daysCover.toFixed(1) + " d"),
        )
        .join(" | "),
      href: "/inventory",
    });
  } else if (watchInventory.length > 0) {
    decisions.push({
      level: "WATCH",
      area: "INVENTARIO",
      title: watchInventory.length + " insumo(s) por revisar",
      detail: watchInventory
        .slice(0, 3)
        .map((row) =>
          row.itemName +
          (row.daysCover == null
            ? ""
            : " · " + row.daysCover.toFixed(1) + " d"),
        )
        .join(" | "),
      href: "/inventory",
    });
  }

  const cashNeeds7 = inventory.smartRows
    .filter(
      (row) =>
        row.suggestedCost != null &&
        row.suggestedPurchase > 0 &&
        (row.orderInDays == null || row.orderInDays <= 7),
    )
    .reduce((sum, row) => sum + (row.suggestedCost ?? 0), 0);
  const cashNeeds14 = inventory.smartRows
    .filter(
      (row) =>
        row.suggestedCost != null &&
        row.suggestedPurchase > 0 &&
        (row.orderInDays == null || row.orderInDays <= 14),
    )
    .reduce((sum, row) => sum + (row.suggestedCost ?? 0), 0);

  if (inventory.summary.suggestedPurchases > 0) {
    decisions.push({
      level: "ACTION",
      area: "COMPRAS",
      title:
        "Preparar " +
        inventory.summary.suggestedPurchases +
        " reposición(es)",
      detail:
        "Caja estimada próximos 7 días: $" +
        cashNeeds7.toFixed(0) +
        " MXN · 14 días: $" +
        cashNeeds14.toFixed(0) +
        " MXN.",
      href: "/admin/purchases",
    });
  }

  const inventoryAnomalies = inventory.anomalies ?? [];
  if (inventoryAnomalies.length > 0) {
    const first = inventoryAnomalies[0];
    decisions.push({
      level: first.severity,
      area: "INVENTARIO",
      title:
        inventoryAnomalies.length +
        " desviación(es) de inventario para auditar",
      detail:
        first.itemName +
        ": caída observada " +
        first.actualConsumption.toFixed(2) +
        " vs consumo teórico " +
        first.expectedConsumption.toFixed(2) +
        " " +
        first.unitLabel +
        ". No implica merma o pérdida hasta conciliar compras y ajustes.",
      href: "/inventory",
    });
  }

  for (const recommendation of roasting.recommendations.slice(0, 4)) {
    decisions.push({
      level:
        recommendation.level === "ACTION"
          ? "ACTION"
          : recommendation.level === "WATCH"
            ? "WATCH"
            : "INFO",
      area: "TUESTE",
      title: recommendation.title,
      detail: recommendation.detail,
      href: "/admin/roasting",
    });
  }

  if (seven.salesChangePct != null && seven.salesChangePct <= -8) {
    decisions.push({
      level: "ACTION",
      area: "VENTAS",
      title: "Venta semanal debajo del periodo previo",
      detail:
        "Ventas " +
        seven.salesChangePct.toFixed(1) +
        "% · tickets " +
        (seven.ticketsChangePct == null
          ? "sin comparación"
          : seven.ticketsChangePct.toFixed(1) + "%") +
        " · ticket promedio " +
        (seven.avgTicketChangePct == null
          ? "sin comparación"
          : seven.avgTicketChangePct.toFixed(1) + "%") +
        ".",
      href: "/admin/analytics",
    });
  }

  if (thirty.captureRate < 45 && thirty.tickets >= 10) {
    decisions.push({
      level: "WATCH",
      area: "VENTAS",
      title: "Oportunidad de lealtad",
      detail:
        thirty.captureRate.toFixed(1) +
        "% de tickets identificados en 30 días. Altas recientes: " +
        analytics.loyalty.new7 +
        " en 7 días.",
      href: "/admin/analytics",
    });
  }

  const actionableEvents = openEvents.filter((event) =>
    ["EQUIPMENT", "STOCK", "SERVICE", "OTHER"].includes(event.eventType),
  );
  if (actionableEvents.length > 0) {
    const first = actionableEvents[0];
    decisions.push({
      level:
        first.severity === "CRITICAL"
          ? "ACTION"
          : first.severity === "IMPORTANT"
            ? "WATCH"
            : "INFO",
      area: "OPERACIÓN",
      title:
        actionableEvents.length +
        " incidencia(s) operativa(s) abiertas",
      detail:
        (first.itemNameSnapshot
          ? first.itemNameSnapshot + " · "
          : "") +
        (first.note ?? first.eventType),
      href: "/admin/operations/events",
    });
  }

  const productivityWatch = productivity.employeeSummaries
    .filter(
      (employee) =>
        employee.measuredTasks >= 3 &&
        (employee.onTargetRate < 75 ||
          employee.avgVariancePercent > 20),
    )
    .slice(0, 2);

  for (const employee of productivityWatch) {
    decisions.push({
      level: "WATCH",
      area: "PERSONAL",
      title: "Revisar tiempos de " + employee.employeeName,
      detail:
        employee.onTargetRate.toFixed(0) +
        "% de tareas dentro del objetivo · desviación media " +
        (employee.avgVariancePercent > 0 ? "+" : "") +
        employee.avgVariancePercent.toFixed(0) +
        "%.",
      href: "/admin/reports/productivity",
    });
  }

  const inventoryCostByVariant = new Map(
    inventory.rows.map((row) => [
      row.variantExternalId,
      row.purchaseCost,
    ]),
  );
  let wasteCost30 = 0;
  let wasteCostedEvents30 = 0;
  let wasteUncostedEvents30 = 0;
  let remakes30 = 0;

  for (const event of recentOperationalEvents) {
    if (event.eventType === "REMAKE") {
      remakes30 += 1;
      continue;
    }
    if (
      event.eventType !== "WASTE" ||
      !event.variantExternalId ||
      event.quantity == null
    ) {
      continue;
    }
    const unitCost = inventoryCostByVariant.get(
      event.variantExternalId,
    );
    if (unitCost == null) {
      wasteUncostedEvents30 += 1;
      continue;
    }
    wasteCost30 += Number(event.quantity) * unitCost;
    wasteCostedEvents30 += 1;
  }

  const itemsWithoutCost = inventory.rows.filter(
    (row) => row.purchaseCost == null,
  ).length;
  const itemsWithoutSupplier = inventory.rows.filter(
    (row) => !row.supplierId,
  ).length;
  const lotsWithoutLoyverse = roasting.lots.filter(
    (lot) => lot.isActive && !lot.loyverseRoastedVariantExternalId,
  ).length;

  if (
    itemsWithoutCost > 0 ||
    itemsWithoutSupplier > 0 ||
    lotsWithoutLoyverse > 0
  ) {
    decisions.push({
      level: "INFO",
      area: "DATOS",
      title: "Completar datos para mejorar los pronósticos",
      detail:
        itemsWithoutCost +
        " insumo(s) sin costo · " +
        itemsWithoutSupplier +
        " sin proveedor · " +
        lotsWithoutLoyverse +
        " lote(s) de tueste sin vínculo a Loyverse.",
      href: "/admin/purchases",
    });
  }

  const products = analytics.topProducts.filter(
    (product) => product.qty > 0 && product.sales > 0,
  );
  const medianQty = median(products.map((product) => product.qty));
  const medianMargin = median(
    products.map((product) => product.effectiveContributionPct),
  );

  const menuEngineering = products.map((product) => {
    const popular = product.qty >= medianQty;
    const profitable =
      product.effectiveContributionPct >= medianMargin;
    const quadrant =
      popular && profitable
        ? ("STAR" as const)
        : popular
          ? ("WORKHORSE" as const)
          : profitable
            ? ("PUZZLE" as const)
            : ("DOG" as const);

    return {
      ...product,
      quadrant,
    };
  });

  const actionRank = { ACTION: 0, WATCH: 1, INFO: 2 } as const;
  const orderedDecisions = decisions
    .sort(
      (a, b) =>
        actionRank[a.level] - actionRank[b.level] ||
        a.area.localeCompare(b.area, "es"),
    )
    .slice(0, 12);

  return {
    snapshot: {
      today,
      seven,
      fifteen,
      thirty,
      peakHour: analytics.peakHour,
      criticalInventory: criticalInventory.length,
      watchInventory: watchInventory.length,
      suggestedPurchases: inventory.summary.suggestedPurchases,
      replenishmentBudget:
        inventory.summary.estimatedReplenishmentCost,
      cashNeeds7,
      cashNeeds14,
      inventoryAnomalies: inventoryAnomalies.length,
      unavailableProducts:
        inventory.summary.unavailableProducts ?? 0,
      batches30: roasting.summary.batches30,
      avgRoastLoss30: roasting.summary.avgLoss30,
      activeRoastAssignments: roasting.summary.activeAssignments,
      measuredTasks14: productivity.measuredTasks,
      openOperationalEvents: actionableEvents.length,
      wasteCost30,
      wasteCostedEvents30,
      wasteUncostedEvents30,
      remakes30,
    },
    decisions: orderedDecisions,
    menuEngineering,
    menuThresholds: {
      medianQty,
      medianMargin,
    },
    dataQuality: {
      itemsWithoutCost,
      itemsWithoutSupplier,
      lotsWithoutLoyverse,
    },
  };
}
