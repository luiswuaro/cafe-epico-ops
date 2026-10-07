import { and, asc, desc, eq } from "drizzle-orm";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import {
  analyzeRoastCurve,
  estimateRoastEnergyKwh,
  type RoastCurvePoint,
} from "@/src/domain/roasting/curve";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  inventoryBalances,
  inventoryItems,
  inventoryLocations,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
  roastProfiles,
  roastSensoryEvaluations,
  roastSettings,
  stores,
} from "@/src/infrastructure/db/schema";

function n(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetween(from: Date, to = new Date()) {
  return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
}

function restState(
  ageDays: number,
  minRestDays: number,
  peakRestDays: number,
  maxRestDays: number,
) {
  if (ageDays < minRestDays) return "RESTING" as const;
  if (ageDays < peakRestDays) return "READY" as const;
  if (ageDays <= maxRestDays) return "PRIME" as const;
  return "AGING" as const;
}

function within(
  actual: number | null,
  target: number | null,
  tolerance: number | null,
) {
  if (actual == null || target == null || tolerance == null) return null;
  return Math.abs(actual - target) <= tolerance;
}

export async function getRoastingDashboard(organizationId: string) {
  const db = getDb();

  const [
    settingsRows,
    lots,
    profiles,
    batches,
    sensory,
    assignments,
    qcRows,
    itemRows,
    balances,
    storeRows,
    locationRows,
    loyverse,
  ] = await Promise.all([
    db
      .select()
      .from(roastSettings)
      .where(eq(roastSettings.organizationId, organizationId))
      .limit(1),
    db
      .select()
      .from(roastCoffeeLots)
      .where(eq(roastCoffeeLots.organizationId, organizationId))
      .orderBy(desc(roastCoffeeLots.isActive), asc(roastCoffeeLots.name)),
    db
      .select()
      .from(roastProfiles)
      .where(eq(roastProfiles.organizationId, organizationId))
      .orderBy(desc(roastProfiles.isActive), asc(roastProfiles.name)),
    db
      .select()
      .from(roastBatches)
      .where(eq(roastBatches.organizationId, organizationId))
      .orderBy(desc(roastBatches.roastedAt))
      .limit(150),
    db
      .select()
      .from(roastSensoryEvaluations)
      .where(eq(roastSensoryEvaluations.organizationId, organizationId))
      .orderBy(desc(roastSensoryEvaluations.evaluatedAt))
      .limit(300),
    db
      .select()
      .from(roastBarAssignments)
      .where(
        and(
          eq(roastBarAssignments.organizationId, organizationId),
          eq(roastBarAssignments.isActive, true),
        ),
      )
      .orderBy(desc(roastBarAssignments.startedAt)),
    db
      .select({
        roastBatchId: espressoQualityChecks.roastBatchId,
        withinTimeSpec: espressoQualityChecks.withinTimeSpec,
        withinYieldSpec: espressoQualityChecks.withinYieldSpec,
        sensoryRating: espressoQualityChecks.sensoryRating,
        brewTimeS: espressoQualityChecks.brewTimeS,
        createdAt: espressoQualityChecks.createdAt,
      })
      .from(espressoQualityChecks)
      .where(eq(espressoQualityChecks.organizationId, organizationId)),
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        category: inventoryItems.category,
        canonicalUnit: inventoryItems.canonicalUnit,
        isActive: inventoryItems.isActive,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.organizationId, organizationId))
      .orderBy(asc(inventoryItems.category), asc(inventoryItems.name)),
    db
      .select({
        inventoryItemId: inventoryBalances.inventoryItemId,
        quantity: inventoryBalances.theoreticalQuantity,
      })
      .from(inventoryBalances)
      .where(eq(inventoryBalances.organizationId, organizationId)),
    db
      .select({
        id: stores.id,
        name: stores.name,
        code: stores.code,
        isActive: stores.isActive,
      })
      .from(stores)
      .where(eq(stores.organizationId, organizationId))
      .orderBy(asc(stores.name)),
    db
      .select({
        id: inventoryLocations.id,
        storeId: inventoryLocations.storeId,
        name: inventoryLocations.name,
        type: inventoryLocations.locationType,
        isActive: inventoryLocations.isActive,
      })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.organizationId, organizationId))
      .orderBy(asc(inventoryLocations.name)),
    getInventoryIntelligence(organizationId),
  ]);

  const settings = settingsRows[0] ?? null;
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const storeById = new Map(storeRows.map((store) => [store.id, store]));

  const sensoryByBatch = new Map<string, typeof sensory>();
  for (const row of sensory) {
    const list = sensoryByBatch.get(row.roastBatchId) ?? [];
    list.push(row);
    sensoryByBatch.set(row.roastBatchId, list);
  }

  const qcByBatch = new Map<string, typeof qcRows>();
  for (const row of qcRows) {
    if (!row.roastBatchId) continue;
    const list = qcByBatch.get(row.roastBatchId) ?? [];
    list.push(row);
    qcByBatch.set(row.roastBatchId, list);
  }

  const balanceByItem = new Map<string, number>();
  for (const row of balances) {
    balanceByItem.set(
      row.inventoryItemId,
      (balanceByItem.get(row.inventoryItemId) ?? 0) + Number(row.quantity),
    );
  }

  const smartByVariant = new Map(
    loyverse.smartRows.map((row) => [row.variantExternalId, row]),
  );

  const enrichedLots = lots.map((lot) => {
    const lotProfiles = profiles.filter(
      (profile) => profile.coffeeLotId === lot.id && profile.isActive,
    );
    const latestProfile = lotProfiles[0] ?? null;
    const recentLotBatches = batches.filter(
      (batch) => batch.coffeeLotId === lot.id,
    );
    const recentLosses = recentLotBatches
      .slice(0, 8)
      .map((batch) => n(batch.weightLossPct))
      .filter((value): value is number => value != null);
    const averageLossPct =
      recentLosses.length > 0
        ? recentLosses.reduce((sum, value) => sum + value, 0) /
          recentLosses.length
        : null;

    const smart = lot.loyverseRoastedVariantExternalId
      ? smartByVariant.get(lot.loyverseRoastedVariantExternalId)
      : null;
    const factor = Number(lot.loyverseUnitToG || 1000);
    const averageDailyUseG = smart
      ? smart.avgDailyUsage14 * factor
      : null;
    const loyverseStockG = smart ? smart.inStock * factor : null;
    const daysCover =
      averageDailyUseG != null &&
      averageDailyUseG > 0 &&
      loyverseStockG != null
        ? Math.max(0, loyverseStockG) / averageDailyUseG
        : null;

    const greenStockG = lot.greenInventoryItemId
      ? balanceByItem.get(lot.greenInventoryItemId) ?? 0
      : null;
    const internalRoastedStockG = lot.roastedInventoryItemId
      ? balanceByItem.get(lot.roastedInventoryItemId) ?? 0
      : null;

    const restLeadDays = Math.max(0, lot.minRestDays);
    const roastInDays =
      daysCover == null
        ? null
        : Math.max(0, Math.floor(daysCover - restLeadDays - 1));
    const recommendedRoastDate =
      roastInDays == null
        ? null
        : new Date(Date.now() + roastInDays * 86_400_000)
            .toISOString()
            .slice(0, 10);

    const targetLossPct =
      n(latestProfile?.targetWeightLossPct) ?? averageLossPct;
    const projectedYield =
      targetLossPct == null ? null : 1 - targetLossPct / 100;
    const desiredRoasted7dG =
      averageDailyUseG == null ? null : averageDailyUseG * 7;
    const batchSizeG = n(latestProfile?.batchSizeG);
    const projectedRoastedPerBatchG =
      batchSizeG != null && projectedYield != null && projectedYield > 0
        ? batchSizeG * projectedYield
        : null;
    const batchesFor7d =
      desiredRoasted7dG != null &&
      projectedRoastedPerBatchG != null &&
      projectedRoastedPerBatchG > 0
        ? Math.ceil(desiredRoasted7dG / projectedRoastedPerBatchG)
        : null;

    return {
      ...lot,
      greenStockG,
      internalRoastedStockG,
      loyverseStockG,
      averageDailyUseG,
      daysCover,
      roastInDays,
      recommendedRoastDate,
      averageLossPct,
      profileCount: lotProfiles.length,
      latestProfile,
      desiredRoasted7dG,
      batchesFor7d,
      projectedRoastedPerBatchG,
    };
  });

  const enrichedBatches = batches.map((batch) => {
    const lot = lotById.get(batch.coffeeLotId) ?? null;
    const profile = batch.profileId
      ? profileById.get(batch.profileId) ?? null
      : null;
    const ageDays = daysBetween(batch.roastedAt);
    const state = lot
      ? restState(
          ageDays,
          lot.minRestDays,
          lot.peakRestDays,
          lot.maxRestDays,
        )
      : ("UNKNOWN" as const);
    const curve = Array.isArray(batch.curveData)
      ? (batch.curveData as RoastCurvePoint[])
      : [];
    const diagnostics = analyzeRoastCurve(
      curve,
      batch.firstCrackTimeS,
      batch.yellowingTimeS,
    );

    const dtrOk = within(
      n(batch.dtrPct),
      n(profile?.targetDtrPct),
      n(profile?.dtrTolerancePct),
    );
    const lossOk = within(
      n(batch.weightLossPct),
      n(profile?.targetWeightLossPct),
      n(profile?.weightLossTolerancePct),
    );
    const fcTimeOk = within(
      batch.firstCrackTimeS,
      profile?.targetFirstCrackS ?? null,
      profile?.timeToleranceS ?? null,
    );
    const dropTimeOk = within(
      batch.dropTimeS,
      profile?.targetDropS ?? null,
      profile?.timeToleranceS ?? null,
    );
    const checks = [
      { key: "DTR", ok: dtrOk },
      { key: "MERMA", ok: lossOk },
      { key: "FC", ok: fcTimeOk },
      { key: "DROP", ok: dropTimeOk },
    ].filter((row) => row.ok != null);
    const passedChecks = checks.filter((row) => row.ok).length;

    const totalTimeS = batch.dropTimeS ?? null;
    const energyKwh = estimateRoastEnergyKwh(
      curve,
      totalTimeS,
      settings?.nominalPowerW ?? 1000,
    );
    const greenCost =
      lot?.greenCostPerKg != null
        ? (Number(batch.greenWeightG) / 1000) *
          Number(lot.greenCostPerKg)
        : null;
    const energyCost =
      energyKwh != null && settings?.electricityRatePerKwh != null
        ? energyKwh * Number(settings.electricityRatePerKwh)
        : null;
    const laborCost =
      totalTimeS != null && settings?.laborCostPerHour != null
        ? (totalTimeS / 3600) * Number(settings.laborCostPerHour)
        : null;
    const knownCosts = [greenCost, energyCost, laborCost].filter(
      (value): value is number => value != null,
    );
    const estimatedBatchCost =
      knownCosts.length > 0
        ? knownCosts.reduce((sum, value) => sum + value, 0)
        : null;
    const roastedCostPerKg =
      estimatedBatchCost != null && Number(batch.roastedWeightG) > 0
        ? estimatedBatchCost / (Number(batch.roastedWeightG) / 1000)
        : null;

    const batchSensory = sensoryByBatch.get(batch.id) ?? [];
    const latestSensory = batchSensory[0] ?? null;
    const batchQc = qcByBatch.get(batch.id) ?? [];
    const qcPass = batchQc.filter(
      (row) => row.withinTimeSpec && row.withinYieldSpec === true,
    ).length;
    const qcPassRate =
      batchQc.length > 0 ? (qcPass / batchQc.length) * 100 : null;

    return {
      ...batch,
      lot,
      profile,
      ageDays,
      restState: state,
      diagnostics,
      profileChecks: checks,
      profilePassCount: passedChecks,
      profileCheckCount: checks.length,
      energyKwh,
      greenCost,
      energyCost,
      laborCost,
      estimatedBatchCost,
      roastedCostPerKg,
      latestSensory,
      sensoryCount: batchSensory.length,
      espressoQcCount: batchQc.length,
      espressoQcPassRate: qcPassRate,
    };
  });

  const activeAssignments = assignments.flatMap((assignment) => {
    const batch = batchById.get(assignment.roastBatchId);
    if (!batch) return [];
    const enrichedBatch = enrichedBatches.find(
      (row) => row.id === batch.id,
    );
    return [{
      ...assignment,
      storeName: storeById.get(assignment.storeId)?.name ?? "Sucursal",
      batch: enrichedBatch ?? null,
    }];
  });

  const recommendations: Array<{
    level: "ACTION" | "WATCH" | "INFO";
    title: string;
    detail: string;
  }> = [];

  for (const lot of enrichedLots.filter((row) => row.isActive)) {
    if (
      lot.daysCover != null &&
      lot.roastInDays != null &&
      lot.roastInDays <= 1
    ) {
      recommendations.push({
        level: "ACTION",
        title: "Programar tueste: " + lot.name,
        detail:
          lot.batchesFor7d != null && lot.latestProfile?.batchSizeG != null
            ? "Cobertura estimada " +
              lot.daysCover.toFixed(1) +
              " d. Para 7 días de demanda: " +
              lot.batchesFor7d +
              " batch(es) de " +
              Number(lot.latestProfile.batchSizeG).toFixed(0) +
              " g verdes."
            : "Cobertura estimada " +
              lot.daysCover.toFixed(1) +
              " d. El siguiente lote necesita " +
              lot.minRestDays +
              " d mínimos de reposo configurado.",
      });
    }

    if (
      lot.greenStockG != null &&
      lot.batchesFor7d != null &&
      lot.latestProfile?.batchSizeG != null
    ) {
      const greenNeeded =
        lot.batchesFor7d * Number(lot.latestProfile.batchSizeG);
      if (lot.greenStockG < greenNeeded) {
        recommendations.push({
          level: "ACTION",
          title: "Café verde insuficiente: " + lot.name,
          detail:
            "Stock interno " +
            lot.greenStockG.toFixed(0) +
            " g vs " +
            greenNeeded.toFixed(0) +
            " g verdes estimados para cubrir 7 días.",
        });
      }
    }
  }

  for (const batch of enrichedBatches.slice(0, 12)) {
    if (
      batch.profileCheckCount > 0 &&
      batch.profilePassCount < batch.profileCheckCount
    ) {
      const failed = batch.profileChecks
        .filter((row) => row.ok === false)
        .map((row) => row.key)
        .join(", ");
      recommendations.push({
        level: "WATCH",
        title: "Batch " + batch.batchCode + " fuera de perfil",
        detail: "Variables fuera de tolerancia: " + failed + ".",
      });
    }
    if (
      batch.diagnostics.crashFlag ||
      batch.diagnostics.flickFlag ||
      batch.diagnostics.stallFlag
    ) {
      const flags = [
        batch.diagnostics.crashFlag ? "crash RoR" : null,
        batch.diagnostics.flickFlag ? "flick RoR" : null,
        batch.diagnostics.stallFlag ? "stall" : null,
      ]
        .filter(Boolean)
        .join(", ");
      recommendations.push({
        level: "WATCH",
        title: "Revisar curva " + batch.batchCode,
        detail:
          "Heurística de curva detectó: " +
          flags +
          ". Validar contra la gráfica y la cata.",
      });
    }
  }

  for (const assignment of activeAssignments) {
    if (
      assignment.barRole === "ESPRESSO" &&
      assignment.batch?.restState === "RESTING"
    ) {
      recommendations.push({
        level: "WATCH",
        title: "Espresso todavía en reposo",
        detail:
          (assignment.batch.lot?.name ?? assignment.batch.batchCode) +
          ": " +
          assignment.batch.ageDays.toFixed(1) +
          " d post-tueste; mínimo configurado " +
          (assignment.batch.lot?.minRestDays ?? "—") +
          " d.",
      });
    }
  }

  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const recentBatches = enrichedBatches.filter(
    (batch) => batch.roastedAt.getTime() >= thirtyDaysAgo,
  );
  const green30 = recentBatches.reduce(
    (sum, batch) => sum + Number(batch.greenWeightG),
    0,
  );
  const roasted30 = recentBatches.reduce(
    (sum, batch) => sum + Number(batch.roastedWeightG),
    0,
  );
  const avgLoss30 =
    green30 > 0 ? ((green30 - roasted30) / green30) * 100 : null;

  return {
    settings,
    lots: enrichedLots,
    profiles,
    batches: enrichedBatches,
    assignments: activeAssignments,
    inventoryItems: itemRows.filter((row) => row.isActive),
    stores: storeRows.filter((row) => row.isActive),
    locations: locationRows.filter((row) => row.isActive),
    loyverseVariants: loyverse.smartRows.map((row) => ({
      variantExternalId: row.variantExternalId,
      itemName: row.itemName,
      unitLabel: row.unitLabel,
      inStock: row.inStock,
      avgDailyUsage14: row.avgDailyUsage14,
    })),
    recommendations: recommendations.slice(0, 12),
    summary: {
      batches30: recentBatches.length,
      green30,
      roasted30,
      avgLoss30,
      activeLots: enrichedLots.filter((row) => row.isActive).length,
      activeAssignments: activeAssignments.length,
    },
  };
}
