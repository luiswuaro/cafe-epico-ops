import { requirePermission } from "@/src/infrastructure/auth/permissions";
import Link from "next/link";
const modules = [
  ["Checklist", "Plantillas, tareas, frecuencias, roles y SOPs", "/admin/checklists"],
  ["Recetas Loyverse", "Recetas madre, componentes y consumo real expandido", "/admin/loyverse/recipes"],
  ["Recetas técnicas QC", "Parámetros de extracción y control técnico", "/admin/recipes"],
  ["Tueste", "Lotes, perfiles, batches, reposo, curvas, cata y producción", "/admin/roasting"],
  ["SOPs", "Crear, versionar y publicar procedimientos", "/admin/sops"],
  ["Inventario", "Existencias, cobertura y reposición desde Loyverse", "/inventory"],
  ["Compras", "Proveedores, costos, empaques, requisiciones y viajes", "/admin/purchases"],
  ["Analítica", "Dashboard por día, 7, 15 y 30 días con COGS y margen", "/admin/analytics"],
  ["Loyverse", "Estado de sincronización, webhooks y reconciliación", "/admin/loyverse"],

  ["Notas a colaboradores", "Enviar instrucciones visibles en la pantalla principal", "/admin/messages"],
  ["Reportes de turno", "Apertura, entrega, notas, horas y duración de tareas", "/admin/reports/shifts"],
  ["Productividad", "Objetivo vs tiempo real y eficiencia por colaborador", "/admin/reports/productivity"],
  ["Auditoría", "Historial de cambios administrativos", "#"],
];
export default async function AdminPage() { await requirePermission("admin.access"); return <main className="shell"><section className="hero"><p className="eyebrow">ADMINISTRACIÓN</p><h1>Sistema operativo</h1><p className="muted">Pantalla inicial para dueños. RBAC está modelado en base de datos.</p></section><section className="grid">{modules.map(([name,desc,href])=><article className="card" key={name}><h2>{name}</h2><p>{desc}</p><Link href={href}><button>Administrar</button></Link></article>)}</section></main>; }
