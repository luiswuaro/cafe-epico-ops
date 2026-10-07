"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCashState } from "@/src/application/pos/cash";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCashMovements,
  posCashSessions,
} from "@/src/infrastructure/db/schema";

const moneySchema = z.coerce.number().min(0).max(1_000_000);
const movementTypeSchema = z.enum(["CASH_IN", "CASH_OUT"]);

export async function openCashSession(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.cash.manage",
    employee.homeStoreId,
  );

  const openingCash = moneySchema.parse(formData.get("openingCash"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const db = getDb();

  const [existing] = await db
    .select({ id: posCashSessions.id })
    .from(posCashSessions)
    .where(
      and(
        eq(posCashSessions.organizationId, employee.organizationId),
        eq(posCashSessions.storeId, employee.homeStoreId),
        eq(posCashSessions.status, "OPEN"),
      ),
    )
    .limit(1);

  if (existing) redirect("/pos/cash?alreadyOpen=1");

  const [session] = await db
    .insert(posCashSessions)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      openingCash: openingCash.toFixed(2),
      openedByEmployeeId: employee.id,
    })
    .returning();

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_CASH_SESSION_OPENED",
    entityType: "pos_cash_session",
    entityId: session.id,
    afterData: { openingCash, note },
  });

  redirect("/pos/cash?opened=1");
}

export async function recordCashMovement(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.cash.manage",
    employee.homeStoreId,
  );

  const type = movementTypeSchema.parse(
    String(formData.get("movementType") ?? ""),
  );
  const rawAmount = moneySchema.parse(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim();

  if (rawAmount <= 0) throw new Error("El monto debe ser mayor que cero");
  if (note.length < 3) throw new Error("Describe el movimiento de caja");

  const state = await getCashState(
    employee.organizationId,
    employee.homeStoreId,
  );
  if (!state.session) throw new Error("No hay una caja abierta");

  const signedAmount = type === "CASH_OUT" ? -rawAmount : rawAmount;
  const db = getDb();

  const [movement] = await db
    .insert(posCashMovements)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      sessionId: state.session.id,
      employeeId: employee.id,
      movementType: type,
      amount: signedAmount.toFixed(2),
      note,
    })
    .returning();

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_CASH_MOVEMENT_RECORDED",
    entityType: "pos_cash_movement",
    entityId: movement.id,
    afterData: { type, amount: signedAmount, note },
  });

  redirect("/pos/cash?movement=1");
}

export async function closeCashSession(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.cash.manage",
    employee.homeStoreId,
  );

  const countedCash = moneySchema.parse(formData.get("countedCash"));
  const closingNote =
    String(formData.get("closingNote") ?? "").trim() || null;

  const state = await getCashState(
    employee.organizationId,
    employee.homeStoreId,
  );
  if (!state.session) throw new Error("No hay una caja abierta");

  const expectedCash = Math.round(state.expectedCash * 100) / 100;
  const difference =
    Math.round((countedCash - expectedCash) * 100) / 100;
  const now = new Date();
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(posCashSessions)
      .set({
        status: "CLOSED",
        countedCash: countedCash.toFixed(2),
        expectedCashSnapshot: expectedCash.toFixed(2),
        difference: difference.toFixed(2),
        closedByEmployeeId: employee.id,
        closedAt: now,
        closingNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(posCashSessions.id, state.session!.id),
          eq(posCashSessions.status, "OPEN"),
        ),
      );

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_CASH_SESSION_CLOSED",
      entityType: "pos_cash_session",
      entityId: state.session!.id,
      afterData: {
        openingCash: Number(state.session!.openingCash),
        expectedCash,
        countedCash,
        difference,
        closingNote,
      },
    });
  });

  redirect("/pos/cash?closed=1");
}
