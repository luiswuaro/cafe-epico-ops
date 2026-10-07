"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseRoastCurveInput } from "@/src/domain/roasting/curve";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  inventoryBalances,
  inventoryMovements,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
  roastProfiles,
  roastSensoryEvaluations,
  roastSettings,
} from "@/src/infrastructure/db/schema";

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalInt(value: FormDataEntryValue | null) {
  const parsed = optionalNumber(value);
  return parsed == null ? null : Math.round(parsed);
}

function parseSeconds(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) {
    const parts = text.split(":").map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return Math.round(parts[0] * 60 + parts[1]);
    }
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

function nullableString(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function finiteOrNull(value: number | null) {
  return value == null || Number.isFinite(value);
}

function validTargetUse(value: string) {
  return ["ESPRESSO", "FILTER", "OMNI"].includes(value);
}

async function readCurveSource(formData: FormData) {
  const fileEntry = formData.get("curveFile");
  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (fileEntry.size > 5_000_000) {
      throw new Error("ROAST_CURVE_FILE_TOO_LARGE");
    }
    return {
      raw: await fileEntry.text(),
      sourceName: fileEntry.name,
    };
  }

  const pasted = String(formData.get("curveRaw") ?? "").trim();
  return {
    raw: pasted,
    sourceName: pasted ? "texto pegado" : null,
  };
}

export async function saveRoastSettings(formData: FormData) {
  const roasterName =
    String(formData.get("roasterName") ?? "").trim() || "Skywalker v1";
  const nominalPowerW = optionalInt(formData.get("nominalPowerW"));
  const electricityRate = optionalNumber(
    formData.get("electricityRatePerKwh"),
  );
  const laborCost = optionalNumber(formData.get("laborCostPerHour"));
  const defaultStoreId = nullableString(formData.get("defaultStoreId"));
  const defaultLocationId = nullableString(
    formData.get("defaultLocationId"),
  );

  if (
    nominalPowerW == null ||
    nominalPowerW <= 0 ||
    !finiteOrNull(electricityRate) ||
    !finiteOrNull(laborCost)
  ) {
    redirect("/admin/roasting?error=settings");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();

  await db
    .insert(roastSettings)
    .values({
      organizationId,
      roasterName,
      nominalPowerW,
      electricityRatePerKwh:
        electricityRate == null ? null : String(electricityRate),
      laborCostPerHour:
        laborCost == null ? null : String(laborCost),
      defaultStoreId,
      defaultLocationId,
    })
    .onConflictDoUpdate({
      target: roastSettings.organizationId,
      set: {
        roasterName,
        nominalPowerW,
        electricityRatePerKwh:
          electricityRate == null ? null : String(electricityRate),
        laborCostPerHour:
          laborCost == null ? null : String(laborCost),
        defaultStoreId,
        defaultLocationId,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "ROAST_SETTINGS_SAVED",
    entityType: "roast_settings",
    entityId: organizationId,
    afterData: {
      roasterName,
      nominalPowerW,
      electricityRate,
      laborCost,
      defaultStoreId,
      defaultLocationId,
    },
  });

  revalidatePath("/admin/roasting");
  redirect("/admin/roasting?saved=settings");
}

export async function saveCoffeeLot(formData: FormData) {
  const lotId = nullableString(formData.get("lotId"));
  const name = String(formData.get("name") ?? "").trim();
  const targetUse = String(formData.get("targetUse") ?? "OMNI");
  const altitudeMasl = optionalInt(formData.get("altitudeMasl"));
  const greenCostPerKg = optionalNumber(formData.get("greenCostPerKg"));
  const densityGPerL = optionalNumber(formData.get("densityGPerL"));
  const moisturePct = optionalNumber(formData.get("moisturePct"));
  const loyverseUnitToG =
    optionalNumber(formData.get("loyverseUnitToG")) ?? 1000;
  const minRestDays = optionalInt(formData.get("minRestDays")) ?? 4;
  const peakRestDays = optionalInt(formData.get("peakRestDays")) ?? 10;
  const maxRestDays = optionalInt(formData.get("maxRestDays")) ?? 30;

  if (
    !name ||
    !validTargetUse(targetUse) ||
    loyverseUnitToG <= 0 ||
    minRestDays < 0 ||
    peakRestDays < minRestDays ||
    maxRestDays < peakRestDays ||
    ![
      altitudeMasl,
      greenCostPerKg,
      densityGPerL,
      moisturePct,
    ].every(finiteOrNull)
  ) {
    redirect("/admin/roasting?error=lot");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();
  const values = {
    name,
    origin: nullableString(formData.get("origin")),
    farm: nullableString(formData.get("farm")),
    producer: nullableString(formData.get("producer")),
    variety: nullableString(formData.get("variety")),
    process: nullableString(formData.get("process")),
    altitudeMasl,
    targetUse,
    greenInventoryItemId: nullableString(
      formData.get("greenInventoryItemId"),
    ),
    roastedInventoryItemId: nullableString(
      formData.get("roastedInventoryItemId"),
    ),
    loyverseRoastedVariantExternalId: nullableString(
      formData.get("loyverseRoastedVariantExternalId"),
    ),
    loyverseUnitToG: String(loyverseUnitToG),
    greenCostPerKg:
      greenCostPerKg == null ? null : String(greenCostPerKg),
    densityGPerL: densityGPerL == null ? null : String(densityGPerL),
    moisturePct: moisturePct == null ? null : String(moisturePct),
    minRestDays,
    peakRestDays,
    maxRestDays,
    notes: nullableString(formData.get("notes")),
    updatedAt: new Date(),
  };

  let entityId = lotId;
  if (lotId) {
    await db
      .update(roastCoffeeLots)
      .set(values)
      .where(
        and(
          eq(roastCoffeeLots.id, lotId),
          eq(roastCoffeeLots.organizationId, organizationId),
        ),
      );
  } else {
    const [created] = await db
      .insert(roastCoffeeLots)
      .values({
        organizationId,
        ...values,
      })
      .returning({ id: roastCoffeeLots.id });
    entityId = created.id;
  }

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: lotId ? "ROAST_LOT_UPDATED" : "ROAST_LOT_CREATED",
    entityType: "roast_coffee_lot",
    entityId: entityId!,
    afterData: values,
  });

  revalidatePath("/admin/roasting");
  redirect("/admin/roasting?saved=lot");
}

export async function saveRoastProfile(formData: FormData) {
  const profileId = nullableString(formData.get("profileId"));
  const coffeeLotId = nullableString(formData.get("coffeeLotId"));
  const name = String(formData.get("name") ?? "").trim();
  const targetUse = String(formData.get("targetUse") ?? "OMNI");

  const numeric = {
    batchSizeG: optionalNumber(formData.get("batchSizeG")),
    chargeTempC: optionalNumber(formData.get("chargeTempC")),
    targetFirstCrackTempC: optionalNumber(
      formData.get("targetFirstCrackTempC"),
    ),
    targetDropTempC: optionalNumber(formData.get("targetDropTempC")),
    targetDtrPct: optionalNumber(formData.get("targetDtrPct")),
    dtrTolerancePct:
      optionalNumber(formData.get("dtrTolerancePct")) ?? 2,
    targetWeightLossPct: optionalNumber(
      formData.get("targetWeightLossPct"),
    ),
    weightLossTolerancePct:
      optionalNumber(formData.get("weightLossTolerancePct")) ?? 2,
  };
  const targetYellowingS = parseSeconds(formData.get("targetYellowingS"));
  const targetFirstCrackS = parseSeconds(
    formData.get("targetFirstCrackS"),
  );
  const targetDropS = parseSeconds(formData.get("targetDropS"));
  const timeToleranceS =
    optionalInt(formData.get("timeToleranceS")) ?? 20;

  if (
    !name ||
    !validTargetUse(targetUse) ||
    !Object.values(numeric).every(finiteOrNull) ||
    ![targetYellowingS, targetFirstCrackS, targetDropS].every(
      finiteOrNull,
    ) ||
    timeToleranceS < 0
  ) {
    redirect("/admin/roasting?error=profile");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();

  const values = {
    coffeeLotId,
    name,
    roasterName:
      String(formData.get("roasterName") ?? "").trim() || "Skywalker v1",
    targetUse,
    batchSizeG:
      numeric.batchSizeG == null ? null : String(numeric.batchSizeG),
    chargeTempC:
      numeric.chargeTempC == null ? null : String(numeric.chargeTempC),
    targetYellowingS,
    targetFirstCrackS,
    targetDropS,
    targetFirstCrackTempC:
      numeric.targetFirstCrackTempC == null
        ? null
        : String(numeric.targetFirstCrackTempC),
    targetDropTempC:
      numeric.targetDropTempC == null
        ? null
        : String(numeric.targetDropTempC),
    targetDtrPct:
      numeric.targetDtrPct == null
        ? null
        : String(numeric.targetDtrPct),
    dtrTolerancePct: String(numeric.dtrTolerancePct),
    targetWeightLossPct:
      numeric.targetWeightLossPct == null
        ? null
        : String(numeric.targetWeightLossPct),
    weightLossTolerancePct: String(numeric.weightLossTolerancePct),
    timeToleranceS,
    notes: nullableString(formData.get("notes")),
    updatedAt: new Date(),
  };

  let entityId = profileId;
  if (profileId) {
    await db
      .update(roastProfiles)
      .set(values)
      .where(
        and(
          eq(roastProfiles.id, profileId),
          eq(roastProfiles.organizationId, organizationId),
        ),
      );
  } else {
    const [created] = await db
      .insert(roastProfiles)
      .values({ organizationId, ...values })
      .returning({ id: roastProfiles.id });
    entityId = created.id;
  }

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: profileId ? "ROAST_PROFILE_UPDATED" : "ROAST_PROFILE_CREATED",
    entityType: "roast_profile",
    entityId: entityId!,
    afterData: values,
  });

  revalidatePath("/admin/roasting");
  redirect("/admin/roasting?saved=profile");
}

export async function recordRoastBatch(formData: FormData) {
  const coffeeLotId = String(formData.get("coffeeLotId") ?? "");
  const profileId = nullableString(formData.get("profileId"));
  const greenWeightG = optionalNumber(formData.get("greenWeightG"));
  const roastedWeightG = optionalNumber(formData.get("roastedWeightG"));
  const roastedAtRaw = String(formData.get("roastedAt") ?? "").trim();
  const chargeTempC = optionalNumber(formData.get("chargeTempC"));
  const turningPointTimeS = parseSeconds(
    formData.get("turningPointTimeS"),
  );
  const turningPointTempC = optionalNumber(
    formData.get("turningPointTempC"),
  );
  const yellowingTimeS = parseSeconds(formData.get("yellowingTimeS"));
  const yellowingTempC = optionalNumber(formData.get("yellowingTempC"));
  const firstCrackTimeS = parseSeconds(
    formData.get("firstCrackTimeS"),
  );
  const firstCrackTempC = optionalNumber(
    formData.get("firstCrackTempC"),
  );
  const dropTimeS = parseSeconds(formData.get("dropTimeS"));
  const dropTempC = optionalNumber(formData.get("dropTempC"));
  let curveImport: ReturnType<typeof parseRoastCurveInput> = {
    points: [],
    format: "CSV",
    warnings: [],
  };
  let curveSourceName: string | null = null;

  try {
    const source = await readCurveSource(formData);
    curveSourceName = source.sourceName;
    if (source.raw) {
      const parsed = parseRoastCurveInput(source.raw);
      curveImport = parsed;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ROAST_CURVE_FILE_TOO_LARGE"
    ) {
      redirect("/admin/roasting?error=curve-too-large");
    }
    throw error;
  }

  const resolvedChargeTempC =
    chargeTempC ?? curveImport.events?.charge?.btC ?? null;
  const resolvedYellowingTimeS =
    yellowingTimeS ?? curveImport.events?.yellowing?.tS ?? null;
  const resolvedYellowingTempC =
    yellowingTempC ?? curveImport.events?.yellowing?.btC ?? null;
  const resolvedFirstCrackTimeS =
    firstCrackTimeS ?? curveImport.events?.firstCrack?.tS ?? null;
  const resolvedFirstCrackTempC =
    firstCrackTempC ?? curveImport.events?.firstCrack?.btC ?? null;
  const resolvedDropTimeS =
    dropTimeS ?? curveImport.events?.drop?.tS ?? null;
  const resolvedDropTempC =
    dropTempC ?? curveImport.events?.drop?.btC ?? null;

  if (
    !coffeeLotId ||
    greenWeightG == null ||
    roastedWeightG == null ||
    !Number.isFinite(greenWeightG) ||
    !Number.isFinite(roastedWeightG) ||
    greenWeightG <= 0 ||
    roastedWeightG <= 0 ||
    roastedWeightG > greenWeightG ||
    !roastedAtRaw ||
    ![
      resolvedChargeTempC,
      turningPointTimeS,
      turningPointTempC,
      resolvedYellowingTimeS,
      resolvedYellowingTempC,
      resolvedFirstCrackTimeS,
      resolvedFirstCrackTempC,
      resolvedDropTimeS,
      resolvedDropTempC,
    ].every(finiteOrNull)
  ) {
    redirect("/admin/roasting?error=batch");
  }

  const roastedAt = new Date(roastedAtRaw);
  if (Number.isNaN(roastedAt.getTime())) {
    redirect("/admin/roasting?error=batch-date");
  }

  const weightLossPct =
    ((greenWeightG - roastedWeightG) / greenWeightG) * 100;
  const developmentTimeS =
    resolvedFirstCrackTimeS != null && resolvedDropTimeS != null
      ? Math.max(0, resolvedDropTimeS - resolvedFirstCrackTimeS)
      : null;
  const dtrPct =
    developmentTimeS != null &&
    resolvedDropTimeS != null &&
    resolvedDropTimeS > 0
      ? (developmentTimeS / resolvedDropTimeS) * 100
      : null;
  const curveData = curveImport.points;
  if (curveSourceName && curveData.length === 0) {
    redirect("/admin/roasting?error=curve-format");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();

  const [[lot], [settings]] = await Promise.all([
    db
      .select()
      .from(roastCoffeeLots)
      .where(
        and(
          eq(roastCoffeeLots.id, coffeeLotId),
          eq(roastCoffeeLots.organizationId, organizationId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(roastSettings)
      .where(eq(roastSettings.organizationId, organizationId))
      .limit(1),
  ]);

  if (!lot) redirect("/admin/roasting?error=lot-not-found");

  const defaultCode =
    roastedAt
      .toLocaleString("sv-SE", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(/[-: ]/g, "") +
    "-" +
    lot.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "")
      .slice(0, 10)
      .toUpperCase();

  const batchCode =
    String(formData.get("batchCode") ?? "").trim() || defaultCode;

  try {
    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(roastBatches)
        .values({
          organizationId,
          coffeeLotId,
          profileId,
          batchCode,
          roasterName: settings?.roasterName ?? "Skywalker v1",
          roastedAt,
          operatorEmployeeId: employeeId,
          greenWeightG: String(greenWeightG),
          roastedWeightG: String(roastedWeightG),
          weightLossPct: weightLossPct.toFixed(3),
          chargeTempC:
            resolvedChargeTempC == null
              ? null
              : String(resolvedChargeTempC),
          turningPointTimeS,
          turningPointTempC:
            turningPointTempC == null
              ? null
              : String(turningPointTempC),
          yellowingTimeS: resolvedYellowingTimeS,
          yellowingTempC:
            resolvedYellowingTempC == null
              ? null
              : String(resolvedYellowingTempC),
          firstCrackTimeS: resolvedFirstCrackTimeS,
          firstCrackTempC:
            resolvedFirstCrackTempC == null
              ? null
              : String(resolvedFirstCrackTempC),
          dropTimeS: resolvedDropTimeS,
          dropTempC:
            resolvedDropTempC == null
              ? null
              : String(resolvedDropTempC),
          developmentTimeS,
          dtrPct: dtrPct == null ? null : dtrPct.toFixed(3),
          curveData,
          notes: nullableString(formData.get("notes")),
        })
        .returning({ id: roastBatches.id });

      let posted = false;
      if (
        settings?.defaultStoreId &&
        settings.defaultLocationId &&
        lot.greenInventoryItemId &&
        lot.roastedInventoryItemId
      ) {
        const movementRows = [
          {
            inventoryItemId: lot.greenInventoryItemId,
            movementType: "PRODUCTION_CONSUMPTION" as const,
            quantityDelta: -greenWeightG,
            suffix: "GREEN",
            note:
              "Consumo café verde para batch " + batchCode,
          },
          {
            inventoryItemId: lot.roastedInventoryItemId,
            movementType: "PRODUCTION_OUTPUT" as const,
            quantityDelta: roastedWeightG,
            suffix: "ROASTED",
            note:
              "Salida café tostado de batch " + batchCode,
          },
        ];

        for (const movement of movementRows) {
          await tx.insert(inventoryMovements).values({
            organizationId,
            storeId: settings.defaultStoreId,
            locationId: settings.defaultLocationId,
            inventoryItemId: movement.inventoryItemId,
            movementType: movement.movementType,
            quantityDelta: String(movement.quantityDelta),
            sourceType: "ROAST_BATCH",
            sourceId: created.id,
            occurredAt: roastedAt,
            employeeId,
            note: movement.note,
            externalProvider: "ROASTING",
            externalId: created.id + ":" + movement.suffix,
          });

          await tx
            .insert(inventoryBalances)
            .values({
              organizationId,
              storeId: settings.defaultStoreId,
              locationId: settings.defaultLocationId,
              inventoryItemId: movement.inventoryItemId,
              theoreticalQuantity: String(movement.quantityDelta),
            })
            .onConflictDoUpdate({
              target: [
                inventoryBalances.storeId,
                inventoryBalances.locationId,
                inventoryBalances.inventoryItemId,
              ],
              set: {
                theoreticalQuantity: sql`${inventoryBalances.theoreticalQuantity} + ${movement.quantityDelta}`,
                updatedAt: new Date(),
              },
            });
        }
        posted = true;
        await tx
          .update(roastBatches)
          .set({ inventoryPosted: true, updatedAt: new Date() })
          .where(eq(roastBatches.id, created.id));
      }

      await tx.insert(auditEvents).values({
        organizationId,
        actorUserId: user.id,
        actorEmployeeId: employeeId,
        action: "ROAST_BATCH_RECORDED",
        entityType: "roast_batch",
        entityId: created.id,
        afterData: {
          coffeeLotId,
          profileId,
          batchCode,
          greenWeightG,
          roastedWeightG,
          weightLossPct,
          firstCrackTimeS: resolvedFirstCrackTimeS,
          dropTimeS: resolvedDropTimeS,
          developmentTimeS,
          dtrPct,
          curvePoints: curveData.length,
          curveFormat: curveImport.format,
          curveSourceName,
          curveWarnings: curveImport.warnings,
          curveMetadata: curveImport.metadata ?? null,
          curveEvents: curveImport.events ?? null,
          inventoryPosted: posted,
        },
      });

      return created.id;
    });

    revalidatePath("/admin/roasting");
    revalidatePath("/inventory");
    redirect("/admin/roasting?batch=" + createdId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      redirect("/admin/roasting?error=batch-code");
    }
    throw error;
  }
}

const sensoryScore = z.preprocess(
  (value) => {
    const text = String(value ?? "").trim();
    return text ? Number(text) : undefined;
  },
  z.number().min(0).max(10).optional(),
);

const sensorySchema = z.object({
  roastBatchId: z.string().uuid(),
  brewMethod: z.string().trim().min(1).max(40),
  aroma: sensoryScore,
  acidity: sensoryScore,
  sweetness: sensoryScore,
  body: sensoryScore,
  bitterness: sensoryScore,
  aftertaste: sensoryScore,
  balance: sensoryScore,
  overallScore: z.preprocess(
    (value) => {
      const text = String(value ?? "").trim();
      return text ? Number(text) : undefined;
    },
    z.number().min(0).max(100).optional(),
  ),
  descriptors: z.string().trim().max(1000).optional(),
  defects: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function recordRoastSensory(formData: FormData) {
  const parsed = sensorySchema.safeParse({
    roastBatchId: formData.get("roastBatchId"),
    brewMethod: formData.get("brewMethod"),
    aroma: formData.get("aroma"),
    acidity: formData.get("acidity"),
    sweetness: formData.get("sweetness"),
    body: formData.get("body"),
    bitterness: formData.get("bitterness"),
    aftertaste: formData.get("aftertaste"),
    balance: formData.get("balance"),
    overallScore: formData.get("overallScore"),
    descriptors:
      String(formData.get("descriptors") ?? "").trim() || undefined,
    defects: String(formData.get("defects") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect("/admin/roasting?error=sensory");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();
  const data = parsed.data;

  const [created] = await db
    .insert(roastSensoryEvaluations)
    .values({
      organizationId,
      roastBatchId: data.roastBatchId,
      evaluatorEmployeeId: employeeId,
      brewMethod: data.brewMethod,
      aroma: data.aroma == null ? null : String(data.aroma),
      acidity: data.acidity == null ? null : String(data.acidity),
      sweetness:
        data.sweetness == null ? null : String(data.sweetness),
      body: data.body == null ? null : String(data.body),
      bitterness:
        data.bitterness == null ? null : String(data.bitterness),
      aftertaste:
        data.aftertaste == null ? null : String(data.aftertaste),
      balance: data.balance == null ? null : String(data.balance),
      overallScore:
        data.overallScore == null ? null : String(data.overallScore),
      descriptors: data.descriptors ?? null,
      defects: data.defects ?? null,
      notes: data.notes ?? null,
    })
    .returning({ id: roastSensoryEvaluations.id });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "ROAST_SENSORY_RECORDED",
    entityType: "roast_sensory_evaluation",
    entityId: created.id,
    afterData: data,
  });

  revalidatePath("/admin/roasting");
  redirect(
    "/admin/roasting?batch=" +
      data.roastBatchId +
      "&saved=sensory",
  );
}

export async function assignRoastBatchToBar(formData: FormData) {
  const roastBatchId = String(formData.get("roastBatchId") ?? "");
  const storeId = String(formData.get("storeId") ?? "");
  const barRole = String(formData.get("barRole") ?? "ESPRESSO").trim();

  if (!roastBatchId || !storeId || !barRole) {
    redirect("/admin/roasting?error=assignment");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(roastBarAssignments)
      .set({
        isActive: false,
        endedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(roastBarAssignments.organizationId, organizationId),
          eq(roastBarAssignments.storeId, storeId),
          eq(roastBarAssignments.barRole, barRole),
          eq(roastBarAssignments.isActive, true),
        ),
      );

    const [assignment] = await tx
      .insert(roastBarAssignments)
      .values({
        organizationId,
        storeId,
        roastBatchId,
        barRole,
        assignedByEmployeeId: employeeId,
        note: nullableString(formData.get("note")),
      })
      .returning({ id: roastBarAssignments.id });

    await tx
      .update(roastBatches)
      .set({ status: "RELEASED", updatedAt: now })
      .where(eq(roastBatches.id, roastBatchId));

    await tx.insert(auditEvents).values({
      organizationId,
      storeId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "ROAST_BATCH_ASSIGNED_TO_BAR",
      entityType: "roast_bar_assignment",
      entityId: assignment.id,
      afterData: { roastBatchId, storeId, barRole },
    });
  });

  revalidatePath("/admin/roasting");
  revalidatePath("/quality/espresso");
  redirect("/admin/roasting?batch=" + roastBatchId + "&saved=assignment");
}
