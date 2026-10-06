"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auditEvents, espressoQualityChecks, recipeVersions } from "@/src/infrastructure/db/schema";
import { getDb } from "@/src/infrastructure/db/client";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { evaluateEspressoTime } from "@/src/domain/quality/espresso";

const espressoQcSchema = z.object({
  recipeVersionId: z.string().trim().optional(),
  doseG: z.coerce.number().positive().max(30),
  yieldG: z.coerce.number().positive().max(100),
  brewTimeS: z.coerce.number().positive().max(120),
  sensoryRating: z.enum(["CORRECTO", "ACIDO", "AMARGO", "ASTRINGENTE", "OTRO"]),
  sensoryNotes: z.string().trim().max(1000).optional(),
});

export async function recordEspressoQualityCheck(formData: FormData) {
  const parsed = espressoQcSchema.safeParse({
    recipeVersionId: String(formData.get("recipeVersionId") ?? "").trim() || undefined,
    doseG: formData.get("doseG"),
    yieldG: formData.get("yieldG"),
    brewTimeS: formData.get("brewTimeS"),
    sensoryRating: formData.get("sensoryRating"),
    sensoryNotes: String(formData.get("sensoryNotes") ?? "").trim() || undefined,
  });

  if (!parsed.success) redirect("/quality/espresso?error=invalid");

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/quality/espresso?error=no-store");
  await assertEmployeePermission(employee.id, "checklist.execute", employee.homeStoreId);

  const db = getDb();
  let recipeVersionId: string | null = null;

  if (parsed.data.recipeVersionId) {
    const [recipeVersion] = await db
      .select({ id: recipeVersions.id })
      .from(recipeVersions)
      .where(and(
        eq(recipeVersions.id, parsed.data.recipeVersionId),
        eq(recipeVersions.organizationId, employee.organizationId),
        eq(recipeVersions.status, "ACTIVE"),
      ))
      .limit(1);
    if (!recipeVersion) redirect("/quality/espresso?error=recipe");
    recipeVersionId = recipeVersion.id;
  }

  const timeEvaluation = evaluateEspressoTime(parsed.data.brewTimeS);
  const [created] = await db
    .insert(espressoQualityChecks)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      recipeVersionId,
      doseG: parsed.data.doseG.toFixed(3),
      yieldG: parsed.data.yieldG.toFixed(3),
      brewTimeS: parsed.data.brewTimeS.toFixed(2),
      sensoryRating: parsed.data.sensoryRating,
      sensoryNotes: parsed.data.sensoryNotes ?? null,
      withinTimeSpec: timeEvaluation.withinSpec,
      withinYieldSpec: null,
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
      sensoryRating: parsed.data.sensoryRating,
      withinTimeSpec: timeEvaluation.withinSpec,
      recipeVersionId,
    },
  });

  redirect(`/quality/espresso?saved=1&within=${timeEvaluation.withinSpec ? "1" : "0"}`);
}
