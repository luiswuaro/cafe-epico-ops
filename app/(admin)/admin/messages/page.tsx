import Link from "next/link";
import { sendEmployeeMessage } from "./actions";
import { getMessageAdminData } from "@/src/application/messages/read";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminMessagesPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("admin.access");
  const data = await getMessageAdminData(organizationId);
  const sent = params.sent === "1";
  const error =
    typeof params.error === "string" ? params.error : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · COMUNICACIÓN</p>
        <h1>Notas a colaboradores</h1>
        <p className="muted">
          La nota aparece en la pantalla principal del colaborador hasta que la
          marque como leída.
        </p>
      </section>

      {sent && (
        <p className="card status-ok">Nota enviada correctamente.</p>
      )}
      {error && (
        <p className="alert">
          No se pudo enviar la nota. Revisa destinatario y contenido.
        </p>
      )}

      <section className="grid">
        <form action={sendEmployeeMessage} className="card stack">
          <h2>Nueva nota</h2>

          <label>
            Para
            <select name="recipientEmployeeId" required defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {data.employeeOptions.map((employee) => (
                <option value={employee.id} key={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Prioridad
            <select name="priority" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Importante</option>
            </select>
          </label>

          <label>
            Título
            <input
              name="title"
              maxLength={120}
              placeholder="Ej. Antes de terminar el turno"
            />
          </label>

          <label>
            Nota
            <textarea
              name="body"
              rows={5}
              maxLength={2000}
              required
              placeholder="Escribe la instrucción o información para Azucena."
            />
          </label>

          <button type="submit">Enviar nota</button>
        </form>

        <article className="card">
          <h2>Historial reciente</h2>
          {data.recentMessages.length === 0 ? (
            <p className="muted">Todavía no hay notas enviadas.</p>
          ) : (
            <div className="stack">
              {data.recentMessages.map((message) => (
                <div className="task" key={message.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{message.title}</strong>
                    <div className="muted">
                      Para {message.recipientName} ·{" "}
                      {message.createdAt.toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                    <p>{message.body}</p>
                    <div
                      className={
                        message.readAt ? "status-ok" : "status-warn"
                      }
                    >
                      {message.readAt
                        ? `Leída ${message.readAt.toLocaleString("es-MX", {
                            timeZone: "America/Mexico_City",
                            dateStyle: "short",
                            timeStyle: "short",
                          })}`
                        : "Pendiente de lectura"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
