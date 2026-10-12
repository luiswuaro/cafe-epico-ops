import Link from "next/link";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {OwnerHistoryCodeForm} from "./owner-code-form";

export const dynamic="force-dynamic";
export default async function HistoryAccessAdmin(){
 await requirePermission("admin.access");
 return <main className="shell">
  <section className="hero">
   <p className="eyebrow">ADMINISTRACIÓN · SEGURIDAD</p>
   <h1>Acceso a historiales</h1>
   <p className="muted">El propietario consulta libremente. Los trabajadores necesitan
    una autorización temporal para revisar cortes de caja o tickets antiguos.
    Cada solicitud, intento fallido y autorización queda registrada en auditoría.</p>
   <Link href="/admin" className="button">← Administración</Link>
  </section>
  <OwnerHistoryCodeForm/>
 </main>;
}