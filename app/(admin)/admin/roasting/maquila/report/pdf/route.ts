import { NextRequest } from "next/server";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getContractReportData } from "@/src/application/roasting/contracts";
import { createContractPdf } from "@/src/application/roasting/contract-pdf";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  const {organizationId}=await requirePermission("roast.manage");
  const params=request.nextUrl.searchParams;
  const lotId=params.get("lot")??"";
  const ids=[...new Set(params.getAll("batch"))];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(lotId)||ids.length<1||ids.length>60||!ids.every(id=>uuid.test(id))){
    return new Response("Selecciona un lote y entre 1 y 60 batches válidos.",{status:400});
  }
  const data=await getContractReportData(organizationId,lotId,ids);
  if(!data)return new Response("No se encontraron batches autorizados para este lote.",{status:404});
  const pdf=createContractPdf(data);
  const filename="cafe-epico-maquila-"+lotId.slice(0,8)+".pdf";
  return new Response(new Uint8Array(pdf),{
    status:200,headers:{
      "Content-Type":"application/pdf",
      "Content-Disposition":'attachment; filename="'+filename+'"',
      "Content-Length":String(pdf.length),
      "Cache-Control":"private, no-store, max-age=0",
      "X-Content-Type-Options":"nosniff",
    },
  });
}
