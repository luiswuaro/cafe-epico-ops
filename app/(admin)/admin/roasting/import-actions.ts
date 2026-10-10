"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRoastCurveInput, type RoastCurveImport } from "@/src/domain/roasting/curve";
import { MAX_HIBEAN_JSON_BYTES } from "@/src/domain/roasting/upload-constraints";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  roastBatches,
  roastCoffeeLots,
  roastGreenInventoryConfirmations,
  roastImportDrafts,
  roastProfiles,
  roastSettings,
} from "@/src/infrastructure/db/schema";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function secondsOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return Math.round(minutes * 60 + seconds);
    }
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

function mexicoDate(value: string | undefined | null) {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const hasZone = /(?:Z|[+-]\d\d:\d\d)$/.test(text);
  const parsed = new Date(hasZone ? text : text + "-06:00");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function altitudeFromRange(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/\d{3,4}/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function summaryFromImport(
  parsed: ReturnType<typeof parseRoastCurveInput>,
) {
  const metadata = parsed.metadata ?? {};
  const {
    aiTelemetry: _aiTelemetry,
    phaseList: _phaseList,
    ...metadataSummary
  } = metadata;

  return {
    format: parsed.format,
    curvePoints: parsed.points.length,
    events: parsed.events ?? {},
    metadata: metadataSummary,
  };
}

export async function stageHiBeanRoastImport(formData: FormData): Promise<string> {
  const file = formData.get("roastFile");
  if (!(file instanceof File) || file.size <= 0) {
    return "/admin/roasting?error=hibean-file";
  }
  if (file.size > MAX_HIBEAN_JSON_BYTES) {
    return "/admin/roasting?error=hibean-file-large";
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch {
    return "/admin/roasting?error=hibean-read";
  }
  let parsed: RoastCurveImport;
  try {
    parsed = parseRoastCurveInput(raw);
  } catch (error) {
    console.error("HIBEAN_IMPORT_PARSE_ERROR", {
      fileSize: file.size,
      error: error instanceof Error ? error.message.slice(0, 200) : "unexpected",
    });
    return "/admin/roasting?error=hibean-parse";
  }

  if (
    parsed.format !== "JSON_HIBEAN" ||
    parsed.metadata?.provider !== "HIBEAN"
  ) {
    return "/admin/roasting?error=hibean-format";
  }

  let rawPayload: Record<string, unknown>;
  try {
    const decoded = JSON.parse(raw);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("invalid");
    }
    rawPayload = decoded as Record<string, unknown>;
  } catch {
    return "/admin/roasting?error=hibean-json";
  }

  if(parsed.points.length===0) return "/admin/roasting?error=hibean-no-data";

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();
  const sha = createHash("sha256").update(raw).digest("hex");
  const beanCloudId = parsed.metadata.bean?.cloudId ?? null;
  const beanName = parsed.metadata.bean?.name ?? parsed.metadata.title ?? "";

  const [existing] = await db
    .select()
    .from(roastImportDrafts)
    .where(
      and(
        eq(roastImportDrafts.organizationId, organizationId),
        eq(roastImportDrafts.sourceSha256, sha),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status !== "CONFIRMED") {
      await db
        .update(roastImportDrafts)
        .set({
          sourceFileName: file.name,
          sourceFormat: parsed.format,
          sourceExternalRoastId:
            parsed.metadata.externalRoastId ??
            parsed.metadata.localRoastId ??
            null,
          sourceExternalBeanId: beanCloudId,
          rawPayload,
          parsedPayload: summaryFromImport(parsed),
          updatedAt: new Date(),
        })
        .where(eq(roastImportDrafts.id, existing.id));
    }
    return "/admin/roasting/import/" +
      existing.id +
      (existing.status === "CONFIRMED" ? "?duplicate=1" : "");
  }

  const lots = await db
    .select({
      id: roastCoffeeLots.id,
      name: roastCoffeeLots.name,
      hibeanBeanCloudId: roastCoffeeLots.hibeanBeanCloudId,
    })
    .from(roastCoffeeLots)
    .where(eq(roastCoffeeLots.organizationId, organizationId));

  let matchedCoffeeLotId: string | null = null;

  if (beanCloudId) {
    matchedCoffeeLotId =
      lots.find((lot) => lot.hibeanBeanCloudId === beanCloudId)?.id ?? null;
  }

  if (!matchedCoffeeLotId && beanName) {
    const source = normalize(beanName);
    const candidates = lots.filter((lot) => {
      const target = normalize(lot.name);
      return (
        target === source ||
        (source.length >= 4 &&
          (target.includes(source) || source.includes(target)))
      );
    });
    if (candidates.length === 1) {
      matchedCoffeeLotId = candidates[0].id;
    }
  }

  const [draft] = await db
    .insert(roastImportDrafts)
    .values({
      organizationId,
      createdByEmployeeId: employeeId,
      sourceProvider: "HIBEAN",
      sourceFormat: parsed.format,
      sourceFileName: file.name,
      sourceSha256: sha,
      sourceExternalRoastId:
        parsed.metadata.externalRoastId ??
        parsed.metadata.localRoastId ??
        null,
      sourceExternalBeanId: beanCloudId,
      rawPayload,
      parsedPayload: summaryFromImport(parsed),
      matchedCoffeeLotId,
    })
    .returning({ id: roastImportDrafts.id });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "HIBEAN_ROAST_IMPORT_STAGED",
    entityType: "roast_import_draft",
    entityId: draft.id,
    afterData: {
      sourceFileName: file.name,
      sourceSha256: sha,
      sourceExternalRoastId:
        parsed.metadata.externalRoastId ??
        parsed.metadata.localRoastId ??
        null,
      sourceExternalBeanId: beanCloudId,
      beanName,
      greenWeightG: parsed.metadata.greenWeightG ?? null,
      reportedInventoryG:
        parsed.metadata.bean?.remainingInventoryG ?? null,
      curvePoints: parsed.points.length,
    },
  });

  return "/admin/roasting/import/" + draft.id;
}

export async function confirmHiBeanRoastImport(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "").trim();
  const requestedLotId = String(formData.get("coffeeLotId") ?? "").trim();
  const profileIdRaw = String(formData.get("profileId") ?? "").trim();
  const profileId = profileIdRaw || null;
  const inventoryConfirmed =
    String(formData.get("inventoryConfirmed") ?? "") === "yes";
  const linkBean =
    String(formData.get("linkHibeanBean") ?? "") === "yes";

  if (!draftId || !requestedLotId || !inventoryConfirmed) {
    redirect(
      "/admin/roasting/import/" +
        encodeURIComponent(draftId) +
        "?error=confirm",
    );
  }

  const { user, employeeId, organizationId } =
    await requirePermission("roast.manage");
  const db = getDb();

  const [draft] = await db
    .select()
    .from(roastImportDrafts)
    .where(
      and(
        eq(roastImportDrafts.id, draftId),
        eq(roastImportDrafts.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!draft) redirect("/admin/roasting?error=hibean-draft");
  if (draft.status === "CONFIRMED" && draft.confirmedBatchId) {
    redirect("/admin/roasting?batch=" + draft.confirmedBatchId);
  }

  const raw = JSON.stringify(draft.rawPayload);
  const parsed = parseRoastCurveInput(raw);
  const metadata = parsed.metadata;

  if (
    parsed.format !== "JSON_HIBEAN" ||
    metadata?.provider !== "HIBEAN"
  ) {
    redirect("/admin/roasting/import/" + draftId + "?error=parse");
  }

  const greenWeightG =
    numberOrNull(formData.get("greenWeightG")) ??
    metadata.greenWeightG ??
    null;
  const roastedWeightG =
    numberOrNull(formData.get("roastedWeightG")) ??
    metadata.roastedWeightG ??
    null;
  const confirmedInventoryG = numberOrNull(
    formData.get("confirmedInventoryG"),
  );
  const roastedAt =
    mexicoDate(String(formData.get("roastedAt") ?? "")) ??
    mexicoDate(metadata.roastedAt);

  const chargeTempC =
    numberOrNull(formData.get("chargeTempC")) ??
    parsed.events?.charge?.btC ??
    null;
  const turningPointTimeS =
    secondsOrNull(formData.get("turningPointTimeS")) ??
    parsed.events?.turningPoint?.tS ??
    null;
  const turningPointTempC =
    numberOrNull(formData.get("turningPointTempC")) ??
    parsed.events?.turningPoint?.btC ??
    null;
  const yellowingTimeS =
    secondsOrNull(formData.get("yellowingTimeS")) ??
    parsed.events?.yellowing?.tS ??
    null;
  const yellowingTempC =
    numberOrNull(formData.get("yellowingTempC")) ??
    parsed.events?.yellowing?.btC ??
    null;
  const firstCrackTimeS =
    secondsOrNull(formData.get("firstCrackTimeS")) ??
    parsed.events?.firstCrack?.tS ??
    null;
  const firstCrackTempC =
    numberOrNull(formData.get("firstCrackTempC")) ??
    parsed.events?.firstCrack?.btC ??
    null;
  const dropTimeS =
    secondsOrNull(formData.get("dropTimeS")) ??
    parsed.events?.drop?.tS ??
    null;
  const dropTempC =
    numberOrNull(formData.get("dropTempC")) ??
    parsed.events?.drop?.btC ??
    null;

  const numericValues = [
    greenWeightG,
    roastedWeightG,
    confirmedInventoryG,
    chargeTempC,
    turningPointTimeS,
    turningPointTempC,
    yellowingTimeS,
    yellowingTempC,
    firstCrackTimeS,
    firstCrackTempC,
    dropTimeS,
    dropTempC,
  ].filter((value) => value != null);

  if (
    greenWeightG == null ||
    roastedWeightG == null ||
    confirmedInventoryG == null ||
    !roastedAt ||
    numericValues.some((value) => !Number.isFinite(value)) ||
    greenWeightG <= 0 ||
    roastedWeightG <= 0 ||
    roastedWeightG > greenWeightG ||
    confirmedInventoryG < 0
  ) {
    redirect("/admin/roasting/import/" + draftId + "?error=values");
  }

  if (profileId) {
    const [profile] = await db
      .select({ id: roastProfiles.id })
      .from(roastProfiles)
      .where(
        and(
          eq(roastProfiles.id, profileId),
          eq(roastProfiles.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!profile) {
      redirect("/admin/roasting/import/" + draftId + "?error=profile");
    }
  }

  const beanCloudId = metadata.bean?.cloudId ?? null;
  const beanName = metadata.bean?.name ?? metadata.title ?? "Café HiBean";
  const reportedInventoryG =
    metadata.bean?.remainingInventoryG ?? null;

  let existingLot:
    | typeof roastCoffeeLots.$inferSelect
    | null = null;

  if (requestedLotId !== "__CREATE__") {
    const [lot] = await db
      .select()
      .from(roastCoffeeLots)
      .where(
        and(
          eq(roastCoffeeLots.id, requestedLotId),
          eq(roastCoffeeLots.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!lot) {
      redirect("/admin/roasting/import/" + draftId + "?error=lot");
    }
    existingLot = lot;

    if (
      linkBean &&
      beanCloudId &&
      lot.hibeanBeanCloudId &&
      lot.hibeanBeanCloudId !== beanCloudId
    ) {
      redirect(
        "/admin/roasting/import/" + draftId + "?error=lot-other-bean",
      );
    }
  }

  if (linkBean && beanCloudId) {
    const [mappedElsewhere] = await db
      .select({ id: roastCoffeeLots.id })
      .from(roastCoffeeLots)
      .where(
        and(
          eq(roastCoffeeLots.organizationId, organizationId),
          eq(roastCoffeeLots.hibeanBeanCloudId, beanCloudId),
        ),
      )
      .limit(1);

    if (
      mappedElsewhere &&
      (!existingLot || mappedElsewhere.id !== existingLot.id)
    ) {
      redirect(
        "/admin/roasting/import/" + draftId + "?error=bean-mapped",
      );
    }
  }

  const sourceExternalId =
    metadata.externalRoastId ?? metadata.localRoastId ?? null;

  if (sourceExternalId) {
    const [duplicateBatch] = await db
      .select({ id: roastBatches.id })
      .from(roastBatches)
      .where(
        and(
          eq(roastBatches.organizationId, organizationId),
          eq(roastBatches.sourceProvider, "HIBEAN"),
          eq(roastBatches.sourceExternalId, sourceExternalId),
        ),
      )
      .limit(1);
    if (duplicateBatch) {
      await db
        .update(roastImportDrafts)
        .set({
          status: "CONFIRMED",
          confirmedBatchId: duplicateBatch.id,
          updatedAt: new Date(),
        })
        .where(eq(roastImportDrafts.id, draftId));
      redirect("/admin/roasting?batch=" + duplicateBatch.id);
    }
  }

  const weightLossPct =
    ((greenWeightG - roastedWeightG) / greenWeightG) * 100;
  const developmentTimeS =
    firstCrackTimeS != null && dropTimeS != null
      ? Math.max(0, dropTimeS - firstCrackTimeS)
      : null;
  const dtrPct =
    developmentTimeS != null && dropTimeS != null && dropTimeS > 0
      ? (developmentTimeS / dropTimeS) * 100
      : null;

  const [settings] = await db
    .select()
    .from(roastSettings)
    .where(eq(roastSettings.organizationId, organizationId))
    .limit(1);

  const result = await db.transaction(async (tx) => {
    let lotId: string;
    let lotName: string;

    if (existingLot) {
      lotId = existingLot.id;
      lotName = existingLot.name;

      await tx
        .update(roastCoffeeLots)
        .set({
          ...(linkBean && beanCloudId
            ? {
                hibeanBeanCloudId: beanCloudId,
                hibeanBeanName: beanName,
              }
            : {}),
          hibeanGreenInventoryG: String(confirmedInventoryG),
          hibeanInventoryReportedG:
            reportedInventoryG == null
              ? null
              : String(reportedInventoryG),
          hibeanInventoryConfirmedAt: new Date(),
          hibeanInventoryConfirmedByEmployeeId: employeeId,
          hibeanInventorySourceRoastId: sourceExternalId,
          updatedAt: new Date(),
        })
        .where(eq(roastCoffeeLots.id, existingLot.id));
    } else {
      const requestedName =
        String(formData.get("newLotName") ?? "").trim() || beanName;
      const altitudeMasl = altitudeFromRange(
        metadata.bean?.altitudeRange,
      );

      const [createdLot] = await tx
        .insert(roastCoffeeLots)
        .values({
          organizationId,
          name: requestedName,
          origin:
            metadata.bean?.regionCode ??
            metadata.bean?.origin ??
            null,
          altitudeMasl,
          targetUse: "OMNI",
          hibeanBeanCloudId: linkBean ? beanCloudId : null,
          hibeanBeanName: beanName,
          hibeanGreenInventoryG: String(confirmedInventoryG),
          hibeanInventoryReportedG:
            reportedInventoryG == null
              ? null
              : String(reportedInventoryG),
          hibeanInventoryConfirmedAt: new Date(),
          hibeanInventoryConfirmedByEmployeeId: employeeId,
          hibeanInventorySourceRoastId: sourceExternalId,
        })
        .returning({
          id: roastCoffeeLots.id,
          name: roastCoffeeLots.name,
        });

      lotId = createdLot.id;
      lotName = createdLot.name;
    }

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
      lotName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "")
        .slice(0, 10)
        .toUpperCase();

    const batchCode =
      String(formData.get("batchCode") ?? "").trim() || defaultCode;

    const [createdBatch] = await tx
      .insert(roastBatches)
      .values({
        organizationId,
        coffeeLotId: lotId,
        profileId,
        batchCode,
        roasterName:
          metadata.device?.name ??
          settings?.roasterName ??
          "Skywalker v1",
        roastedAt,
        operatorEmployeeId: employeeId,
        greenWeightG: String(greenWeightG),
        roastedWeightG: String(roastedWeightG),
        weightLossPct: weightLossPct.toFixed(3),
        chargeTempC:
          chargeTempC == null ? null : String(chargeTempC),
        turningPointTimeS,
        turningPointTempC:
          turningPointTempC == null
            ? null
            : String(turningPointTempC),
        yellowingTimeS,
        yellowingTempC:
          yellowingTempC == null ? null : String(yellowingTempC),
        firstCrackTimeS,
        firstCrackTempC:
          firstCrackTempC == null
            ? null
            : String(firstCrackTempC),
        dropTimeS,
        dropTempC:
          dropTempC == null ? null : String(dropTempC),
        developmentTimeS,
        dtrPct: dtrPct == null ? null : dtrPct.toFixed(3),
        curveData: parsed.points,
        inventoryPosted: false,
        notes:
          String(formData.get("notes") ?? "").trim() || null,
        sourceProvider: "HIBEAN",
        sourceExternalId,
        sourceFileName: draft.sourceFileName,
        sourceMetadata: {
          ...summaryFromImport(parsed),
          inventory: {
            reportedG: reportedInventoryG,
            confirmedG: confirmedInventoryG,
            corrected:
              reportedInventoryG == null
                ? true
                : Math.abs(
                    reportedInventoryG - confirmedInventoryG,
                  ) > 0.01,
          },
        },
      })
      .returning({ id: roastBatches.id });

    await tx.insert(roastGreenInventoryConfirmations).values({
      organizationId,
      coffeeLotId: lotId,
      provider: "HIBEAN",
      externalBeanId: beanCloudId,
      externalRoastId: sourceExternalId,
      reportedQuantityG:
        reportedInventoryG == null
          ? null
          : String(reportedInventoryG),
      confirmedQuantityG: String(confirmedInventoryG),
      corrected:
        reportedInventoryG == null ||
        Math.abs(reportedInventoryG - confirmedInventoryG) > 0.01,
      sourceFileName: draft.sourceFileName,
      confirmedByEmployeeId: employeeId,
      note:
        String(formData.get("inventoryNote") ?? "").trim() || null,
    });

    await tx
      .update(roastImportDrafts)
      .set({
        matchedCoffeeLotId: lotId,
        status: "CONFIRMED",
        confirmedBatchId: createdBatch.id,
        updatedAt: new Date(),
      })
      .where(eq(roastImportDrafts.id, draftId));

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "HIBEAN_ROAST_IMPORT_CONFIRMED",
      entityType: "roast_batch",
      entityId: createdBatch.id,
      afterData: {
        draftId,
        coffeeLotId: lotId,
        sourceExternalId,
        sourceFileName: draft.sourceFileName,
        greenWeightG,
        roastedWeightG,
        weightLossPct,
        dtrPct,
        curvePoints: parsed.points.length,
        hibeanBeanCloudId: beanCloudId,
        reportedInventoryG,
        confirmedInventoryG,
        inventoryCorrected:
          reportedInventoryG == null ||
          Math.abs(reportedInventoryG - confirmedInventoryG) > 0.01,
        inventorySource: "HIBEAN_CONFIRMED",
      },
    });

    return {
      batchId: createdBatch.id,
      lotId,
    };
  });

  revalidatePath("/admin/roasting");
  revalidatePath("/admin/decision-center");
  redirect(
    "/admin/roasting?batch=" +
      result.batchId +
      "&saved=hibean-import",
  );
}
