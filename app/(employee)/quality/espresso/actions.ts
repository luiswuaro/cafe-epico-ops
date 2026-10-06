"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  auditEvents,
  espressoQualityChecks,
  recipeVersions,
} from "@/src/infrastructure/db/schema";
import { getDb } from "@/src/infrastructure/db/client";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import {
  evaluateExtraction,
  parseExtractionQualitySpec,
} from "@/src/domain/quality/espresso";

const espressoQcSchema = z.object({
  recipeVersionId: z.string().uuid(),
  doseG: z.coerce.number().positive().max(30),
  yieldG: z.coerce.number().positive().max(100),
  brewTimeS: z.coerce.number().positive().max(120),
  sensoryRating: z.enum([
    "CORRECTO",
    "ACIDO",
    "AMARGO",
    "ASTRINGENTE",
    "OTRO",
  ]),
  sensoryNotes: z.string().trim().max(1000).optional(),
});

export async function recordEspressoQualityCheck(formData: FormData) {
  const parsed = espressoQcSchema.safeParse({
    recipeVersionId: String(formData.get("recipeVersionId") ?? ""),
    doseG: formData.get("doseG"),
    yieldG: formData.get("yieldG"),
    brewTimeS: formData.get("brewTimeS"),
    sensoryRating: formData.get("sensoryRating"),
    sensoryNotes:
      String(formData.get("sensoryNotes") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect("/quality/espresso?error=invalid");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    redirect("/quality/espresso?error=no-store");
  }

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    employee.homeStoreId,
  );

  const db = getDb();

  const [recipeVersion] = await db
    .select({
      id: recipeVersions.id,
      qualitySpec: recipeVersions.qualitySpec,
    })
    .from(recipeVersions)
    .where(
      and(
        eq(recipeVersions.id, parsed.data.recipeVersionId),
        eq(recipeVersions.organizationId, employee.organizationId),
        eq(recipeVersions.status, "ACTIVE"),
      ),
    )
    .limit(1);

  if (!recipeVersion) {
    redirect("/quality/espresso?error=recipe");
  }

  let evaluation;
  try {
    const spec = parseExtractionQualitySpec(recipeVersion.qualitySpec);
    evaluation = evaluateExtraction(
      parsed.data.doseG,
      parsed.data.yieldG,
      parsed.data.brewTimeS,
      spec,
    );
  } catch {
    redirect("/quality/espresso?error=spec");
  }

  const [created] = await db
    .insert(espressoQualityChecks)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      recipeVersionId: recipeVersion.id,
      doseG: parsed.data.doseG.toFixed(3),
      yieldG: parsed.data.yieldG.toFixed(3),
      brewTimeS: parsed.data.brewTimeS.toFixed(2),
      sensoryRating: parsed.data.sensoryRating,
      sensoryNotes: parsed.data.sensoryNotes ?? null,
      withinTimeSpec: evaluation.withinTimeSpec,
      withinYieldSpec: evaluation.withinYieldSpec,
    })
    .returning({ id: espressoQualityChecks.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "ESPRESSO_QC_RECORDED",
    entityType: "espresso_quality_check",
    entityId: created.id,
    afterData: {
      doseG: parsed.data.doseG,
      yieldG: parsed.data.yieldG,
      brewTimeS: parsed.data.brewTimeS,
      ratio: evaluation.ratio,
      sensoryRating: parsed.data.sensoryRating,
      withinTimeSpec: evaluation.withinTimeSpec,
      withinYieldSpec: evaluation.withinYieldSpec,
      withinSpec: evaluation.withinSpec,
      yieldMinG: evaluation.yieldMinG,
      yieldMaxG: evaluation.yieldMaxG,
      timeMinS: evaluation.timeMinS,
      timeMaxS: evaluation.timeMaxS,
      recipeVersionId: recipeVersion.id,
    },
  });

  redirect(
    `/quality/espresso?saved=1&overall=${evaluation.withinSpec ? "1" : "0"}&time=${evaluation.withinTimeSpec ? "1" : "0"}&yield=${evaluation.withinYieldSpec ? "1" : "0"}&ratio=${evaluation.ratio.toFixed(3)}`,
  );
}
