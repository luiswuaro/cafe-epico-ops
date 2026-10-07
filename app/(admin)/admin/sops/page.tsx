import Link from "next/link";
import { createSop, createSopDraft } from "./actions";
import { listSopsForAdmin } from "@/src/application/sops/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminSopsPage() {
  const { organizationId } = await requirePermission("sop.manage");
  const rows = await listSopsForAdmin(organizationId);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · SOPs</p>
        <h1>Procedimientos de operación</h1>
        <p className="muted">
          Publica una sola versión vigente para el equipo. Los cambios se
          preparan en borrador y el histórico permanece disponible.
        </p>
      </section>

      <section className="grid">
        <form action={createSop} className="card stack">
          <h2>Nuevo SOP</h2>
          <label>
            Título
            <input
              name="title"
              required
              placeholder="Ej. Limpieza de máquina espresso"
            />
          </label>
          <label>
            Categoría
            <select name="category" defaultValue="BARRA">
              <option value="BARRA">Barra</option>
              <option value="APERTURA">Apertura</option>
              <option value="CIERRE">Cierre</option>
              <option value="LIMPIEZA">Limpieza</option>
              <option value="COCINA">Cocina</option>
              <option value="INVENTARIO">Inventario</option>
              <option value="SEGURIDAD">Seguridad</option>
              <option value="CALIDAD">Calidad</option>
            </select>
          </label>
          <label>
            Procedimiento
            <textarea
              name="content"
              rows={12}
              required
              placeholder={"Objetivo:\n\nFrecuencia:\n\nHerramientas:\n\nPasos:\n1. ...\n2. ...\n\nCriterio de aceptación:\n\nQué hacer si falla:"}
            />
          </label>
          <button type="submit">Crear borrador</button>
        </form>

        <article className="card">
          <h2>Cómo redactarlos</h2>
          <p>
            Mantén cada SOP corto, observable y repetible. Indica frecuencia,
            herramientas, pasos y criterio de aceptación.
          </p>
          <p className="muted">
            Los empleados consultan únicamente la versión ACTIVE desde el menú
            SOPs.
          </p>
        </article>
      </section>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {rows.map((row) => (
          <article className="card" key={row.id}>
            <p className="eyebrow">{row.category}</p>
            <h2>{row.title}</h2>
            <p className="muted">
              {row.currentVersionId
                ? `Activa v${row.majorVersion}.${row.minorVersion}`
                : "Sin publicar"}
              {row.draft
                ? ` · borrador v${row.draft.majorVersion}.${row.draft.minorVersion}`
                : ""}
            </p>
            <div
              style={{
                display: "flex",
                gap: ".5rem",
                flexWrap: "wrap",
              }}
            >
              <Link
                className="button"
                href={
                  row.draft
                    ? `/admin/sops/${row.id}?version=${row.draft.id}`
                    : `/admin/sops/${row.id}`
                }
              >
                {row.draft ? "Editar borrador" : "Ver"}
              </Link>
              {!row.draft && row.currentVersionId && (
                <form action={createSopDraft}>
                  <input type="hidden" name="sopId" value={row.id} />
                  <button type="submit">Nueva versión</button>
                </form>
              )}
            </div>
          </article>
        ))}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
