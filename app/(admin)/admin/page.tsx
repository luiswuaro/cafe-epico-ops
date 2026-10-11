import { requirePermission } from "@/src/infrastructure/auth/permissions";
import {OpsWorkspaceNav} from "@/components/ops-workspace-nav";
import Link from "next/link";
const modules = [
  ["Centro de decisiones", "Prioridades de ventas, inventario, compras, tueste y personal", "/admin/decision-center"],
  ["Checklist", "Plantillas, tareas, frecuencias, roles y SOPs", "/admin/checklists"],
  ["Catálogo y recetas OPS", "Editar bebidas, insumos físicos y empaques por tipo de servicio", "/admin/pos/catalog"],
  ["Recetas técnicas QC", "Parámetros de extracción y control técnico", "/admin/recipes"],
  ["Tueste", "Lotes, perfiles, batches, reposo, curvas, cata y producción", "/admin/roasting"],
  ["Roast Engineer · laboratorio", "Analizar HiBean JSON, RoR, fases y costos por batch", "/admin/roasting/lab"],
  ["Centro financiero · preview", "Utilidad estimada, costos y descuentos por tipo de servicio", "/admin/finance"],
  ["SOPs", "Crear, versionar y publicar procedimientos", "/admin/sops"],
  ["Inventario OPS", "Existencias físicas, movimientos, auditoría y edición de insumos", "/inventory/ops"],
  ["Compras", "Proveedores, costos, empaques, requisiciones y viajes", "/admin/purchases"],
  ["Analítica OPS", "Ventas LIVE, tickets, productos, turnos y costos pendientes", "/admin/analytics"],

  ["Notas a colaboradores", "Enviar instrucciones visibles en la pantalla principal", "/admin/messages"],
  ["Reportes de turno", "Apertura, entrega, notas, horas y duración de tareas", "/admin/reports/shifts"],
  ["Productividad", "Objetivo vs tiempo real y eficiencia por colaborador", "/admin/reports/productivity"],
  ["Mermas e incidencias", "Eventos de barra, retrabajos, fallas y seguimiento", "/admin/operations/events"],
  ["Auditoría", "Historial de cambios administrativos", "#"],
];
export default async function AdminPage() { await requirePermission("admin.access"); return <main className="shell ops-admin-workspace"><OpsWorkspaceNav active="/admin"/><section className="hero"><p className="eyebrow">ADMINISTRACIÓN</p><h1>Sistema operativo</h1><p className="muted">Pantalla inicial para dueños. RBAC está modelado en base de datos.</p></section><section className="grid">{modules.map(([name,desc,href])=><article className="card" key={name}><h2>{name}</h2><p>{desc}</p><Link href={href}><button>Administrar</button></Link></article>)}</section></main>; }
