"use server";

import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {isPosLiveEnabled} from "@/src/application/pos/live";
import {auditEvents,posCustomers} from "@/src/infrastructure/db/schema";

export type CheckoutCustomerResult={
  error:string|null;
  customer:{id:string;name:string;pointsBalance:number}|null;
};

/** Alta rápida SIN redirect, para conservar los productos en el carrito.
 * Invocar solo desde pago LIVE: en modo espejo el frontend usa alta simulada.
 */
export async function registerCheckoutCustomer(
  _previous:CheckoutCustomerResult,
  formData:FormData,
):Promise<CheckoutCustomerResult>{
  try{
    if(!isPosLiveEnabled())throw new Error("Altas reales deshabilitadas en preview espejo.");
    const {user,employee}=await getCurrentEmployee();
    if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
    await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
    const name=String(formData.get("name")??"").trim();
    const phone=String(formData.get("phone")??"").trim()||null;
    if(name.length<2||name.length>100)throw new Error("Escribe el nombre del cliente (2-100 caracteres).");
    if(phone&&phone.length>30)throw new Error("El teléfono es demasiado largo.");
    const db=getDb();
    const created=await db.transaction(async tx=>{
      const [customer]=await tx.insert(posCustomers).values({
        organizationId:employee.organizationId,name,phone,pointsBalance:"0",
      }).returning({id:posCustomers.id,name:posCustomers.name});
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_CUSTOMER_CREATED_AT_CHECKOUT",entityType:"pos_customer",entityId:customer.id,
        afterData:{name,phone,pointsBalance:0},
      });
      return customer;
    });
    return {error:null,customer:{id:created.id,name:created.name,pointsBalance:0}};
  }catch(error){
    return {error:error instanceof Error?error.message.slice(0,220):"No se pudo registrar al cliente.",
      customer:null};
  }
}
