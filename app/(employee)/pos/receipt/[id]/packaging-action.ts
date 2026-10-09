"use server";
import {redirect} from "next/navigation";
import {recordExtraPackaging} from "@/src/application/pos/extra-packaging";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";

export async function deliverExtraPackaging(data:FormData){
  const orderId=String(data.get("orderId")??"").trim();
  let issue:string|null=null;
  try{
    const {user,employee}=await getCurrentEmployee();
    if(!employee.homeStoreId)throw new Error("Sucursal no asignada.");
    await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
    const lineId=String(data.get("lineId")??"");
    const requestId=String(data.get("requestId")??"");
    const quantity=Number(data.get("quantity"));
    if(![orderId,lineId,requestId].every(v=>/^[0-9a-f-]{36}$/i.test(v)))
      throw new Error("Identificador inválido.");
    await recordExtraPackaging({
      organizationId:employee.organizationId,storeId:employee.homeStoreId,
      orderId,lineId,requestId,quantity,actorUserId:user.id,employeeId:employee.id,
    });
  }catch(error){
    console.error("POS_EXTRA_PACKAGING_FAILED",{orderId,error});
    const raw=error instanceof Error?error.message:"";
    issue=/^(El ticket |La bebida |Se agotaron |Producto |Falta |Sin mapeo |Cantidad |No alcanza |Identificador )/.test(raw)
      ?raw.slice(0,220):"No se pudo registrar el empaque extra. Revisa existencia y permisos.";
  }
  const url=/^[0-9a-f-]{36}$/i.test(orderId)?"/pos/receipt/"+orderId:"/pos";
  redirect(url+(issue?"?packagingError="+encodeURIComponent(issue):"?packaged=1"));
}
