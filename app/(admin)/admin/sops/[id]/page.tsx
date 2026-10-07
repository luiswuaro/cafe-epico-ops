import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createSopDraft,
  publishSopDraft,
  updateSopDraft,
} from "../actions";
import { getSopAdminDetail } from "@/src/application/sops/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminSopDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const version =
    typeof query.version === "string" ? query.version : undefined;

  const { organizationId } = await requirePermission("sop.manage");
  const data = await getSopAdminDetail(organizationId, id, version);
  if (!data?.selected) notFound();

  const editable = data.selected.status === "DRAFT";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">
          {data.sop.category} · v{data.selected.majorVersion}.
          {data.selected.minorVersion} · {data.selected.status}
        </p>
        <h1>{data.sop.title}</h1>
      </section>

      {editable ? (
        <form action={updateSopDraft} className="card stack">
          <input type="hidden" name="sopId" value={data.sop.id} />
          <input
            type="hidden"
            name="versionId"
            value={data.selected.id}
          />
          <label>
            Título
            <input name="title" defaultValue={data.sop.title} required />
          </label>
          <label>
            Categoría
            <input
              name="category"
              defaultValue={data.sop.category}
              required
            />
          </label>
          <label>
            Procedimiento
            <textarea
              name="content"
              rows={24}
              defaultValue={data.selected.content}
              required
            />
          </label>
          <button type="submit">Guardar borrador</button>
        </form>
      ) : (
        <article className="card">
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {data.selected.content}
          </p>
          <form action={createSopDraft} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="sopId" value={data.sop.id} />
            <button type="submit">Crear nueva versión editable</button>
          </form>
        </article>
      )}

      {editable && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>Publicar</h2>
          <p className="muted">
            Al publicar, esta versión pasa a ser la que ve el personal y la
            anterior queda archivada.
          </p>
          <form action={publishSopDraft}>
            <input type="hidden" name="sopId" value={data.sop.id} />
            <input
              type="hidden"
              name="versionId"
              value={data.selected.id}
            />
            <button type="submit">Publicar SOP</button>
          </form>
        </section>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/sops">← Todos los SOPs</Link>
      </p>
    </main>
  );
}
