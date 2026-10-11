import Link from "next/link";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

type Module = { label: string; description: string; href: string };

const direct: Module[] = [
  { label: "Cobrar", description: "Abrir punto de venta", href: "/pos" },
  { label: "Mesas y comandas", description: "Pedidos en curso", href: "/pos/orders" },
  { label: "Caja", description: "Apertura, cobros y corte", href: "/pos/cash" },
  { label: "Inventario OPS", description: "Existencias, entradas y salidas", href: "/inventory/ops" },
];

const daily: Module[] = [
  { label: "Centro de decisiones", description: "Qué atender primero hoy", href: "/admin/decision-center" },
  { label: "Ventas y analítica", description: "Ingresos reales desde OPS", href: "/admin/analytics" },
  { label: "Finanzas", description: "Costos, gastos y utilidad", href: "/admin/finance" },
  { label: "Compras", description: "Insumos, proveedores y reposición", href: "/admin/purchases" },
];

const production: Module[] = [
  { label: "Catálogo y recetas", description: "Precios, gramajes y empaques", href: "/admin/pos/catalog" },
  { label: "Tueste", description: "HiBean, batches y café tostado en inventario", href: "/admin/roasting" },
  { label: "Calidad de espresso", description: "Registrar extracción y revisar tolerancias", href: "/quality/espresso" },
];

const personnel: Module[] = [
  { label: "Tareas del equipo", description: "Checklists y asignaciones", href: "/admin/checklists" },
  { label: "Entrega y reportes de turno", description: "Notas, horarios e incidencias", href: "/admin/reports/shifts" },
  { label: "Mensajes al equipo", description: "Instrucciones para el turno", href: "/admin/messages" },
];

const advanced: Module[] = [
  { label: "Configurar ticket térmico", description: "Impresión de recibos", href: "/admin/pos/ticket" },
  { label: "Recetas técnicas", description: "Parámetros para control QC", href: "/admin/recipes" },
  { label: "Roast Engineer", description: "Análisis avanzado de curvas HiBean", href: "/admin/roasting/lab" },
  { label: "SOPs", description: "Procedimientos de trabajo", href: "/admin/sops" },
  { label: "Productividad", description: "Tiempo real de cada tarea", href: "/admin/reports/productivity" },
  { label: "Mermas e incidencias", description: "Análisis de fallas y retrabajos", href: "/admin/operations/events" },
  { label: "Auditar recetas POS", description: "Vinculación de insumos a inventario", href: "/pos/inventory-audit" },
];

function ModuleGrid({ title, subtitle, items }: { title: string; subtitle: string; items: Module[] }) {
  return (
    <section className="stack" style={{ marginTop: "1.2rem" }}>
      <div>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="grid">
        {items.map((item) => (
          <article className="card stack" key={item.href}>
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>
            <Link className="button" href={item.href}>Abrir</Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export default async function AdminPage() {
  await requirePermission("admin.access");
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CAFÉ ÉPICO · ADMINISTRACIÓN</p>
        <h1>Panel de control</h1>
        <p className="muted">
          Primero lo que necesita el equipo para vender. Después, el control
          de la operación. Las herramientas técnicas quedan agrupadas al final.
        </p>
      </section>

      <ModuleGrid
        title="Accesos rápidos"
        subtitle="Las cuatro operaciones más frecuentes durante el servicio."
        items={direct}
      />
      <ModuleGrid
        title="Control del negocio"
        subtitle="Ventas, rentabilidad y reposición desde datos de OPS."
        items={daily}
      />
      <ModuleGrid
        title="Café y productos"
        subtitle="Recetas, calidad e inventario de café tostado."
        items={production}
      />
      <ModuleGrid
        title="Personal y turnos"
        subtitle="Lo que necesita el equipo para abrir, atender y entregar la barra."
        items={personnel}
      />

      <details className="card stack" style={{ marginTop: "1.2rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          Herramientas avanzadas y configuración
        </summary>
        <p className="muted" style={{ marginTop: ".8rem" }}>
          Opciones ocasionales para mantenimiento, auditoría y mejora de procesos.
        </p>
        <div className="grid" style={{ marginTop: ".8rem" }}>
          {advanced.map((item) => (
            <article className="card stack" key={item.href}>
              <h3>{item.label}</h3>
              <p className="muted">{item.description}</p>
              <Link className="button" href={item.href}>Abrir</Link>
            </article>
          ))}
        </div>
      </details>
    </main>
  );
}
