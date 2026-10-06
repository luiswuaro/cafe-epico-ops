import { notFound } from "next/navigation";
import { getSopVersion } from "@/src/application/sops/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
export const dynamic = "force-dynamic";
export default async function SopDetail({params}:{params:Promise<{id:string}>}) { const {id}=await params; const { employee }=await getCurrentEmployee(); const sop=await getSopVersion(employee.organizationId, id); if(!sop) notFound(); return <main className="shell"><section className="hero"><p className="eyebrow">{sop.category} · v{sop.majorVersion}.{sop.minorVersion}</p><h1>{sop.title}</h1></section><article className="card"><p style={{whiteSpace:'pre-wrap',lineHeight:1.7}}>{sop.content}</p></article></main>; }
