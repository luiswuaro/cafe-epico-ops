"use server";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getOpsReplenishmentQueue} from "@/src/application/pos/replenishment";
export async function getQuickReplenishment(){
 const {employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sin sucursal.");
 await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
 const queue=await getOpsReplenishmentQueue(employee.organizationId,employee.homeStoreId);
 return {alerts:queue.alerts.slice(0,18),total:queue.alerts.length};
}
