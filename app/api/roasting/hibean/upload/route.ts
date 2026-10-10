import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { stageHiBeanRoastImport } from "@/app/(admin)/admin/roasting/import-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST convencional: evita el transporte y la redirección de Server Actions
 * para archivos HiBean. Los errores se devuelven a Tueste con un código de
 * diagnóstico; jamás responde con una página genérica de fallo del POS.
 */
export async function POST(request:NextRequest) {
  const startedAt=Date.now();
  try {
    const contentType=request.headers.get("content-type")??"";
    if(!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return NextResponse.redirect(
        new URL("/admin/roasting?error=hibean-file",request.url),303);
    }
    const body=await request.formData();
    const file=body.get("roastFile");
    const bytes=file instanceof File?file.size:0;
    const path=await stageHiBeanRoastImport(body);
    if(!path.startsWith("/admin/roasting")) {
      throw new Error("Import returned an unexpected route");
    }
    console.info("HIBEAN_STAGE_RESULT",{
      result:path.includes("/import/")?"STAGED":"REJECTED",
      bytes,elapsedMs:Date.now()-startedAt,
    });
    return NextResponse.redirect(new URL(path,request.url),303);
  } catch(error) {
    const reference=randomUUID().slice(0,8).toUpperCase();
    // No registrar contenido ni nombre del archivo: los JSON pueden incluir
    // datos del proveedor, geolocalización o metadatos de un lote privado.
    console.error("HIBEAN_UPLOAD_FAILURE",{
      reference,elapsedMs:Date.now()-startedAt,
      type:error instanceof Error?error.name:"UnknownError",
      message:error instanceof Error?error.message.slice(0,300):"Unexpected error",
    });
    return NextResponse.redirect(
      new URL("/admin/roasting?error=hibean-server&ref="+reference,request.url),303);
  }
}
