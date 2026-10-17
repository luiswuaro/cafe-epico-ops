import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { OpsPosQaPreview } from "./preview-client";
import "./preview.css";

export const dynamic = "force-dynamic";
export const metadata:Metadata={
  title:"Vista previa local QA · Café Épico OPS",
  robots:{index:false,follow:false},
};

// ÚNICAMENTE QA local sintética: no accesible en el sitio comercial ni Vercel.
// Nunca consulta Auth, ventas, inventario, fidelización o bases de datos.
export default function LocalPosPreviewPage(){
  const allow=process.env.OPS_LOCAL_FIRST==="true" &&
    process.env.OPS_QA_MODE==="true" &&
    process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" &&
    process.env.POS_LIVE_ENABLED!=="true" &&
    process.env.VERCEL!=="1" &&
    !process.env.VERCEL_ENV;
  if(!allow)notFound();
  return <OpsPosQaPreview/>;
}
