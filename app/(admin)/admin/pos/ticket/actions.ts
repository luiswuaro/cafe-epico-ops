"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posPrintSettings,
} from "@/src/infrastructure/db/schema";

const alignSchema = z.enum(["left", "center", "right"]);

function textValue(formData: FormData, name: string, max = 180) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function checked(formData: FormData, name: string) {
  return String(formData.get(name) ?? "") === "on";
}

export async function savePosPrintSettings(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();

  await assertEmployeePermission(
    employee.id,
    "pos.print.manage",
    employee.homeStoreId ?? undefined,
  );

  const businessName = textValue(formData, "businessName", 100);
  const addressLine = textValue(formData, "addressLine", 160);
  const phoneLine = textValue(formData, "phoneLine", 80) || null;
  const socialLine = textValue(formData, "socialLine", 120) || null;
  const headerMessage = textValue(formData, "headerMessage", 160) || null;
  const footerMessage =
    textValue(formData, "footerMessage", 180) || "Gracias por tu visita.";

  if (!businessName) throw new Error("Falta el nombre del negocio");

  const lineWidthChars = z.coerce.number().int().min(24).max(42).parse(
    formData.get("lineWidthChars"),
  );
  const feedLines = z.coerce.number().int().min(1).max(8).parse(
    formData.get("feedLines"),
  );
  const logoAlign = alignSchema.parse(
    String(formData.get("logoAlign") ?? "center"),
  );

  const logoDataUrlRaw = String(formData.get("logoDataUrl") ?? "");
  const logoRasterRaw = String(formData.get("logoRasterBase64") ?? "");
  const logoDataUrl =
    logoDataUrlRaw.startsWith("data:image/png;base64,") &&
    logoDataUrlRaw.length <= 350_000
      ? logoDataUrlRaw
      : null;
  const logoRasterBase64 =
    /^[A-Za-z0-9+/=]*$/.test(logoRasterRaw) &&
    logoRasterRaw.length <= 250_000
      ? logoRasterRaw || null
      : null;

  const logoWidthPxRaw = Number(formData.get("logoWidthPx") ?? 0);
  const logoHeightPxRaw = Number(formData.get("logoHeightPx") ?? 0);
  const logoWidthPx =
    Number.isInteger(logoWidthPxRaw) &&
    logoWidthPxRaw > 0 &&
    logoWidthPxRaw <= 384
      ? logoWidthPxRaw
      : null;
  const logoHeightPx =
    Number.isInteger(logoHeightPxRaw) &&
    logoHeightPxRaw > 0 &&
    logoHeightPxRaw <= 600
      ? logoHeightPxRaw
      : null;

  const showLogo =
    checked(formData, "showLogo") &&
    Boolean(logoRasterBase64 && logoWidthPx && logoHeightPx);

  const values = {
    businessName,
    addressLine,
    phoneLine,
    socialLine,
    headerMessage,
    footerMessage,
    showLogo,
    logoDataUrl,
    logoRasterBase64,
    logoWidthPx,
    logoHeightPx,
    logoAlign,
    showBusinessName: checked(formData, "showBusinessName"),
    showAddress: checked(formData, "showAddress"),
    showPhone: checked(formData, "showPhone"),
    showSocial: checked(formData, "showSocial"),
    showFolio: checked(formData, "showFolio"),
    showDate: checked(formData, "showDate"),
    showEmployee: checked(formData, "showEmployee"),
    showService: checked(formData, "showService"),
    showCustomer: checked(formData, "showCustomer"),
    showPoints: checked(formData, "showPoints"),
    showItemNotes: checked(formData, "showItemNotes"),
    showNoCfdi: checked(formData, "showNoCfdi"),
    lineWidthChars,
    feedLines,
    autoCut: checked(formData, "autoCut"),
    updatedByEmployeeId: employee.id,
    updatedAt: new Date(),
  };

  const db = getDb();

  await db
    .insert(posPrintSettings)
    .values({
      organizationId: employee.organizationId,
      ...values,
    })
    .onConflictDoUpdate({
      target: posPrintSettings.organizationId,
      set: values,
    });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_PRINT_SETTINGS_UPDATED",
    entityType: "pos_print_settings",
    entityId: employee.organizationId,
    afterData: {
      businessName,
      showLogo,
      logoWidthPx,
      logoHeightPx,
      lineWidthChars,
      feedLines,
      autoCut: values.autoCut,
    },
  });

  redirect("/admin/pos/ticket?saved=1");
}
