import { eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { financialBudgets } from "@/src/infrastructure/db/schema";
import type { FinancialBudgetSnapshot } from "@/src/domain/finance/budget";

export async function getSavedFinancialBudget(
  organizationId:string,
):Promise<FinancialBudgetSnapshot|null>{
  const db=getDb();
  const [row]=await db.select().from(financialBudgets)
    .where(eq(financialBudgets.organizationId,organizationId)).limit(1);
  return row?{
    expenses:row.expenses,
    variableRatio:Number(row.variableRatio),
    cardRate:Number(row.cardRate),
    revision:row.revision,
    updatedAt:row.updatedAt.toISOString(),
  }:null;
}
