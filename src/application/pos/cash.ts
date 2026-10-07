import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  employees,
  posCashMovements,
  posCashSessions,
} from "@/src/infrastructure/db/schema";

export async function getOpenCashSession(
  organizationId: string,
  storeId: string,
) {
  const [session] = await getDb()
    .select()
    .from(posCashSessions)
    .where(
      and(
        eq(posCashSessions.organizationId, organizationId),
        eq(posCashSessions.storeId, storeId),
        eq(posCashSessions.status, "OPEN"),
      ),
    )
    .limit(1);

  return session ?? null;
}

export async function getCashState(
  organizationId: string,
  storeId: string,
) {
  const db = getDb();
  const session = await getOpenCashSession(organizationId, storeId);

  if (!session) {
    const [lastClosed] = await db
      .select()
      .from(posCashSessions)
      .where(
        and(
          eq(posCashSessions.organizationId, organizationId),
          eq(posCashSessions.storeId, storeId),
          eq(posCashSessions.status, "CLOSED"),
        ),
      )
      .orderBy(desc(posCashSessions.closedAt))
      .limit(1);

    return {
      session: null,
      movements: [],
      expectedCash: 0,
      cashSales: 0,
      cashIn: 0,
      cashOut: 0,
      lastClosed: lastClosed ?? null,
    };
  }

  const movements = await db
    .select({
      id: posCashMovements.id,
      movementType: posCashMovements.movementType,
      amount: posCashMovements.amount,
      note: posCashMovements.note,
      orderId: posCashMovements.orderId,
      splitId: posCashMovements.splitId,
      createdAt: posCashMovements.createdAt,
      employeeName: employees.name,
    })
    .from(posCashMovements)
    .leftJoin(employees, eq(employees.id, posCashMovements.employeeId))
    .where(eq(posCashMovements.sessionId, session.id))
    .orderBy(desc(posCashMovements.createdAt));

  const amount = (type: string) =>
    movements
      .filter((movement) => movement.movementType === type)
      .reduce((sum, movement) => sum + Number(movement.amount), 0);

  const expectedCash =
    Number(session.openingCash) +
    movements.reduce(
      (sum, movement) => sum + Number(movement.amount),
      0,
    );

  return {
    session,
    movements,
    expectedCash,
    cashSales: amount("SALE"),
    cashIn: amount("CASH_IN"),
    cashOut: Math.abs(amount("CASH_OUT")),
    lastClosed: null,
  };
}
