"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCatalogOverrides,
  posManualProducts,
} from "@/src/infrastructure/db/schema";

const categorySchema = z.enum(["CALIENTES", "FRÍAS", "ALIMENTOS"]);

function parseRecipe(text: string) {
  const components = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(
        /^([0-9]+(?:[.,][0-9]+)?)\s+([^|\s]+)\s*\|\s*(.+)$/,
      );
      if (!match) {
        throw new Error(
          "Línea " +
            (index + 1) +
            ' inválida. Usa: "18 g | Café en grano"',
        );
      }
      const quantity = Number(match[1].replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Cantidad inválida en línea " + (index + 1));
      }
      return {
        variantExternalId: null,
        itemExternalId: null,
        name: match[3].trim(),
        quantity,
        unitLabel: match[2].trim(),
        category: null,
      };
    });

  return { components };
}

export async function togglePosCatalogItem(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const db = getDb();

  if (catalogId.startsWith("manual:")) {
    const id = catalogId.slice("manual:".length);
    await db
      .update(posManualProducts)
      .set({ isActive: enabled, updatedAt: new Date() })
      .where(
        and(
          eq(posManualProducts.id, id),
          eq(posManualProducts.organizationId, employee.organizationId),
        ),
      );
  } else {
    await db
      .insert(posCatalogOverrides)
      .values({
        organizationId: employee.organizationId,
        sourceExternalId: catalogId,
        isEnabled: enabled,
        updatedByEmployeeId: employee.id,
      })
      .onConflictDoUpdate({
        target: [
          posCatalogOverrides.organizationId,
          posCatalogOverrides.sourceExternalId,
        ],
        set: {
          isEnabled: enabled,
          updatedByEmployeeId: employee.id,
          updatedAt: new Date(),
        },
      });
  }

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: enabled ? "POS_CATALOG_ITEM_ENABLED" : "POS_CATALOG_ITEM_DISABLED",
    entityType: "pos_catalog_item",
    entityId: catalogId,
    afterData: { enabled },
  });

  redirect("/admin/pos/catalog");
}

export async function savePosRecipe(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const dineInText = String(formData.get("dineInRecipe") ?? "");
  const takeawayText = String(formData.get("takeawayRecipe") ?? "");
  const dineIn = parseRecipe(dineInText);
  const takeaway = takeawayText.trim()
    ? parseRecipe(takeawayText)
    : dineIn;
  const db = getDb();

  if (catalogId.startsWith("manual:")) {
    const id = catalogId.slice("manual:".length);
    await db
      .update(posManualProducts)
      .set({
        recipeDineIn: dineIn,
        recipeTakeaway: takeaway,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posManualProducts.id, id),
          eq(posManualProducts.organizationId, employee.organizationId),
        ),
      );
  } else {
    await db
      .insert(posCatalogOverrides)
      .values({
        organizationId: employee.organizationId,
        sourceExternalId: catalogId,
        recipeDineIn: dineIn,
        recipeTakeaway: takeaway,
        updatedByEmployeeId: employee.id,
      })
      .onConflictDoUpdate({
        target: [
          posCatalogOverrides.organizationId,
          posCatalogOverrides.sourceExternalId,
        ],
        set: {
          recipeDineIn: dineIn,
          recipeTakeaway: takeaway,
          updatedByEmployeeId: employee.id,
          updatedAt: new Date(),
        },
      });
  }

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_RECIPE_UPDATED",
    entityType: "pos_catalog_item",
    entityId: catalogId,
    afterData: {
      dineInComponents: dineIn.components.length,
      takeawayComponents: takeaway.components.length,
    },
  });

  redirect("/admin/pos/catalog?saved=" + encodeURIComponent(catalogId));
}

export async function createManualPosProduct(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const name = String(formData.get("name") ?? "").trim();
  const category = categorySchema.parse(
    String(formData.get("category") ?? ""),
  );
  const price = Number(formData.get("price"));
  const dineIn = parseRecipe(String(formData.get("dineInRecipe") ?? ""));
  const takeawayText = String(formData.get("takeawayRecipe") ?? "");
  const takeaway = takeawayText.trim()
    ? parseRecipe(takeawayText)
    : dineIn;

  if (!name) throw new Error("Falta el nombre del producto");
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Precio inválido");
  }

  const db = getDb();
  const [created] = await db
    .insert(posManualProducts)
    .values({
      organizationId: employee.organizationId,
      name,
      category,
      price: price.toFixed(2),
      recipeDineIn: dineIn,
      recipeTakeaway: takeaway,
      createdByEmployeeId: employee.id,
    })
    .returning({ id: posManualProducts.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_MANUAL_PRODUCT_CREATED",
    entityType: "pos_manual_product",
    entityId: created.id,
    afterData: { name, category, price },
  });

  redirect("/admin/pos/catalog?saved=manual:" + created.id);
}
