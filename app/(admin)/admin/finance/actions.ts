"use server";

import { and,eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { financialBudgets,auditEvents } from "@/src/infrastructure/db/schema";
import {normalizeBudget,type FinancialBudgetPayload} from "@/src/domain/finance/budget";

type SaveResult={ok:true;revision:number;updatedAt:string}|
  {ok:false;message:string};

export async function saveSharedFinancialBudget(
  payload:FinancialBudgetPayload,expectedRevision:number,
):Promise<SaveResult>{
  const {organizationId,employeeId,user}=await requirePermission("admin.access");
  const normalized=normalizeBudget(payload);
  if(!normalized)return {ok:false,message:"Revisa los gastos. No deben quedar conceptos vacíos, montos inválidos ni más de 100 partidas."};
  if(!Number.isInteger(expectedRevision)||expectedRevision<0)
    return {ok:false,message:"Versión del presupuesto inválida. Vuelve a abrir Finanzas."};
  const db=getDb();
  return db.transaction(async tx=>{
    const savedData={
      expenses:normalized.expenses,
      variableRatio:String(normalized.variableRatio),
      cardRate:String(normalized.cardRate),
      updatedByEmployeeId:employeeId,
      updatedAt:new Date(),
    };
    let revision:number,created=false;
    if(expectedRevision===0){
      const [inserted]=await tx.insert(financialBudgets).values({
        organizationId,...savedData,revision:1,
      }).onConflictDoNothing({target:financialBudgets.organizationId}).returning();
      if(!inserted)return {ok:false,message:"Otro dispositivo ya creó un presupuesto compartido. Recarga Finanzas antes de sobrescribirlo."};
      revision=1;created=true;
    }else{
      const [updated]=await tx.update(financialBudgets).set({
        ...savedData,revision:expectedRevision+1,
      }).where(and(eq(financialBudgets.organizationId,organizationId),
        eq(financialBudgets.revision,expectedRevision))).returning();
      if(!updated)return {ok:false,message:"Otro dispositivo modificó este presupuesto. Tus cambios siguen en este navegador; recarga la página para revisar las diferencias antes de guardar."};
      revision=updated.revision;
    }
    await tx.insert(auditEvents).values({
      organizationId,actorEmployeeId:employeeId,
      actorUserId:user.id,action:created?"FINANCE_BUDGET_CREATED":"FINANCE_BUDGET_UPDATED",
      entityType:"financial_budget",entityId:organizationId,
      afterData:{revision,expenseCount:normalized.expenses.length,
        fixedMonthly:normalized.expenses.filter(e=>e.classification==="FIXED"&&e.recurrence==="MONTHLY")
          .reduce((sum,e)=>sum+Number(e.amount),0),
        variableRatio:normalized.variableRatio,cardRate:normalized.cardRate},
    });
    revalidatePath("/admin/finance");
    return {ok:true,revision,updatedAt:savedData.updatedAt.toISOString()};
  });
}
