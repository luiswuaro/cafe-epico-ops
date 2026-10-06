import Link from "next/link";
import { listActiveSops } from "@/src/application/sops/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
export const dynamic = "force-dynamic";
export default async function SopsPage() { const { employee }=await getCurrentEmployee(); const rows=await listActiveSops(employee.organizationId); return <main className="shell"><section className="hero"><p className="eyebrow">PROCEDIMIENTOS</p><h1>SOPs vigentes</h1></section><section className="grid">{rows.map(r=><article className="card" key={r.id}><span className="pill">{r.category}</span><h2>{r.title}</h2><p className="muted">v{r.majorVersion}.{r.minorVersion}</p><Link href={`/sops/version/${r.versionId}`}><button>Cómo hacerlo</button></Link></article>)}</section></main>; }
