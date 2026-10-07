"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLoyverseInventoryView } from "@/src/application/loyverse/inventory-view";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { operationalEvents } from "@/src/infrastructure/db/schema";

const eventSchema = z.object({
  eventType: z.enum([
    "WASTE",
    "REMAKE",
    "EQUIPMENT",
    "STOCK",
    "SERVICE",
    "OTHER",
  ]),
  severity: z.enum(["NORMAL", "IMPORTANT", "CRITICAL"]),
  variantExternalId: z.string().trim().optional(),
  quantity: z.preprocess(
    (value) => {
      const text = String(value ?? "").trim();
      return text ? Number(text) : undefined;
    },
    z.number().positive().max(100000).optional(),
  ),
  note: z.string().trim().max(1000).optional(),
});

export async function recordOperationalEvent(formData: FormData) {
  const parsed = eventSchema.safeParse({
    eventType: formData.get("eventType"),
    severity: formData.get("severity"),
    variantExternalId:
      String(formData.get("variantExternalId") ?? "").trim() || undefined,
    quantity: formData.get("quantity"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect("/operations/report?error=invalid");
  }

  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    redirect("/operations/report?error=store");
  }

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    employee.homeStoreId,
  );

  const data = parsed.data;
  let itemNameSnapshot: string | null = null;
  let unitLabel: string | null = null;
  let variantExternalId: string | null =
    data.variantExternalId ?? null;

  if (data.eventType === "WASTE") {
    if (!variantExternalId || data.quantity == null) {
      redirect("/operations/report?error=waste-fields");
    }

    const inventory = await getLoyverseInventoryView(
      employee.organizationId,
    );
    const row = inventory.rows.find(
      (candidate) =>
        candidate.variantExternalId === variantExternalId,
    );
    if (!row) {
      redirect("/operations/report?error=item");
    }

    itemNameSnapshot = row.itemName;
    unitLabel = row.unitLabel;
  } else if (
    ["EQUIPMENT", "STOCK", "SERVICE", "OTHER"].includes(
      data.eventType,
    ) &&
    !data.note
  ) {
    redirect("/operations/report?error=note");
  } else if (variantExternalId) {
    const inventory = await getLoyverseInventoryView(
      employee.organizationId,
    );
    const row = inventory.rows.find(
      (candidate) =>
        candidate.variantExternalId === variantExternalId,
    );
    if (row) {
      itemNameSnapshot = row.itemName;
      unitLabel = row.unitLabel;
    } else {
      variantExternalId = null;
    }
  }

  await getDb().insert(operationalEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    employeeId: employee.id,
    eventType: data.eventType,
    severity: data.severity,
    variantExternalId,
    itemNameSnapshot,
    quantity:
      data.quantity == null ? null : String(data.quantity),
    unitLabel,
    note: data.note ?? null,
  });

  revalidatePath("/today");
  revalidatePath("/inventory");
  revalidatePath("/admin/decision-center");
  revalidatePath("/admin/operations/events");
  redirect("/operations/report?saved=1");
}
