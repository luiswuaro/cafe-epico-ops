import { requirePermission } from "@/src/infrastructure/auth/permissions";
import Link from "next/link";
const modules = [
  ["Checklist", "Plantillas, tareas, frecuencias, roles y SOPs", "/admin/checklists"],
  ["Recetas", "Versionado, componentes, presentación, QC y costos", "/recipes"],
  ["SOPs", "Procedimientos versionados", "/sops"],
  ["Inventario", "Teórico, físico, movimientos y desviaciones", "/inventory"],
  ["Loyverse", "Estado de sincronización, espejo y reconciliación", "/admin/integrations"],
  ["Auditoría", "Historial de cambios administrativos", "#"],
];
export default async function AdminPage() { await requirePermission("admin.access"); return <main className="shell"><section className="hero"><p className="eyebrow">ADMINISTRACIÓN</p><h1>Sistema operativo</h1><p className="muted">Pantalla inicial para dueños. RBAC está modelado en base de datos.</p></section><section className="grid">{modules.map(([name,desc,href])=><article className="card" key={name}><h2>{name}</h2><p>{desc}</p><Link href={href}><button>Administrar</button></Link></article>)}</section></main>; }
