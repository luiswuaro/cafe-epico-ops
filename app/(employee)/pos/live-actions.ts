"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkoutLiveOrder } from "@/src/application/pos/live";
import {effectiveOrderServiceMode,validateTicketLabel} from "@/src/application/pos/ticket-names";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission, employeeHasPermission } from "@/src/infrastructure/auth/permissions";

const cartSchema = z.array(z.object({
  externalId:z.string().min(1),
  quantity:z.number().int().min(1).max(20),
  note:z.string().max(180).nullable().optional(),
  serviceMode:z.enum(["DINE_IN","TAKEAWAY"]).optional(),
  customerContainer:z.boolean().optional(),
  extras:z.array(z.object({id:z.string().min(1).max(90),quantity:z.number().int().min(1).max(2)})).max(1).optional(),
})).min(1).max(30);

export async function submitLiveSale(_previous:{error:string|null},formData:FormData):Promise<{error:string|null}> {
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId) throw new Error("No hay sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);

  let savedOrderId:string;
  let newlyPaid=false;
  try {
  const parsed=z.object({
    clientOrderId:z.string().uuid(),
    cart:cartSchema,
    serviceMode:z.enum(["DINE_IN","TAKEAWAY"]),
    paymentMethod:z.enum(["CASH","CARD","TRANSFER"]),
    tenderedAmount:z.string(),
    customerId:z.union([z.string().uuid(),z.literal("")]),
    tableLabel:z.string().max(100),
    note:z.string().max(300),
    allowStockShortage:z.boolean().optional(),
  }).parse({
    clientOrderId:String(formData.get("clientOrderId")??""),
    cart:JSON.parse(String(formData.get("cart")??"[]")),
    serviceMode:String(formData.get("serviceMode")??""),
    paymentMethod:String(formData.get("paymentMethod")??""),
    tenderedAmount:String(formData.get("tenderedAmount")??""),
    customerId:String(formData.get("customerId")??""),
    tableLabel:String(formData.get("tableLabel")??""),
    note:String(formData.get("note")??""),
    allowStockShortage:formData.get("allowStockShortage")==="on",
  });
  const resolvedMode=effectiveOrderServiceMode(parsed.serviceMode,parsed.cart);
  const resolvedLabel=validateTicketLabel(resolvedMode,parsed.tableLabel);
  if(parsed.allowStockShortage){
    const permitted=await employeeHasPermission(employee.id,"inventory.adjust",employee.homeStoreId);
    if(!permitted)throw new Error("Solo el propietario puede autorizar una diferencia de inventario.");
  }
  const result=await checkoutLiveOrder({
    organizationId:employee.organizationId,storeId:employee.homeStoreId,
    actorUserId:user.id,employeeId:employee.id,
    clientOrderId:parsed.clientOrderId,
    cart:parsed.cart.map(line=>({...line,note:line.note??null})),
    serviceMode:resolvedMode,paymentMethod:parsed.paymentMethod,
    tenderedAmount:parsed.paymentMethod==="CASH" && parsed.tenderedAmount.trim()!==""
      ? Number(parsed.tenderedAmount) : null,
    customerId:parsed.customerId||null,tableLabel:resolvedLabel,
    note:parsed.note||null,
    allowStockShortage:parsed.allowStockShortage,
    });
  savedOrderId=result.id;
  newlyPaid=!result.alreadyRecorded;
  }catch(error){
    const message=error instanceof Error?error.message:"No se pudo cobrar. Revisa caja, receta e inventario.";
    return {error:message.slice(0,350)};
  }
  redirect("/pos/receipt/"+savedOrderId+(newlyPaid?"?autoKitchen=paid-direct":""));
}
