import Link from "next/link";
import { getTodayOperationalSummary } from "@/src/application/dashboard/today";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { employee } = await getCurrentEmployee();
  const summary = await getTodayOperationalSummary(employee);

  const openingDone =
    summary.opening.total > 0 &&
    summary.opening.completed === summary.opening.total;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OPERACIÓN · TEPEXI · {summary.businessDate}</p>
        <h1>Hoy en Café Épico</h1>
        <p className="muted">
          Apertura y control de espresso conectados a datos reales.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">APERTURA</span>
          <div className="metric">
            {summary.opening.completed} / {summary.opening.total}
          </div>
          <p>
            {openingDone
              ? "Apertura completada."
              : "Completa primero las tareas críticas para estar operativos a las 7:30."}
          </p>
          <Link href="/checklists" className="button">
            {openingDone ? "Ver apertura" : "Continuar apertura"}
          </Link>
        </article>

        <article className="card">
          <span className="pill">ESPRESSO QC</span>
          <div className="metric">
            {summary.espresso ? `${summary.espresso.brewTimeS} s` : "22–35 s"}
          </div>
          {summary.espresso ? (
            <>
              <p>Último control de espresso registrado hoy.</p>
              <p className={summary.espresso.withinTimeSpec ? "status-ok" : "status-warn"}>
                {summary.espresso.withinTimeSpec
                  ? "Tiempo dentro de especificación"
                  : "Tiempo fuera de especificación"}
              </p>
            </>
          ) : (
            <>
              <p>Registra dosis, yield, tiempo y evaluación sensorial.</p>
              <p className="status-warn">Pendiente de control de apertura</p>
            </>
          )}
          <Link href="/quality/espresso">Abrir Espresso QC →</Link>
        </article>

        <article className="card">
          <span className="pill">INVENTARIO</span>
          <div className="metric">{summary.inventory.openShortages}</div>
          <p>
            {summary.inventory.openShortages === 0
              ? "Sin faltantes abiertos."
              : summary.inventory.openShortages === 1
                ? "1 faltante abierto requiere seguimiento."
                : `${summary.inventory.openShortages} faltantes abiertos requieren seguimiento.`}
          </p>
          <Link href="/inventory">Abrir inventario →</Link>
        </article>

        <article className="card">
          <span className="pill">ENTREGA</span>
          <div className="metric">16:00</div>
          <p>Barra abastecida, limpia, incidencias, faltantes y corte de turno.</p>
        </article>
      </section>
    </main>
  );
}
