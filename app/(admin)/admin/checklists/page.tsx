import { getChecklistAdminData } from "@/src/application/checklists/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import {
  createChecklistTask,
  toggleChecklistTask,
} from "./actions";

export const dynamic = "force-dynamic";

function scheduleLabel(rrule: string | null) {
  if (!rrule) return "Siempre que se ejecute el checklist";
  if (rrule === "FREQ=DAILY") return "Diario";
  if (rrule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") {
    return "Lunes a viernes";
  }
  const weekly = rrule.match(/^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/);
  if (weekly) {
    const labels: Record<string, string> = {
      MO: "Lunes",
      TU: "Martes",
      WE: "Miércoles",
      TH: "Jueves",
      FR: "Viernes",
      SA: "Sábado",
      SU: "Domingo",
    };
    return `Cada ${labels[weekly[1]]}`;
  }
  const interval = rrule.match(/^FREQ=DAILY;INTERVAL=(\d+)$/);
  if (interval) return `Cada ${interval[1]} días`;
  return rrule;
}

export default async function AdminChecklistsPage() {
  const { organizationId } = await requirePermission("checklist.manage");
  const data = await getChecklistAdminData(
    organizationId,
    process.env.DEFAULT_STORE_CODE ?? "TEPEXI",
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · CHECKLISTS</p>
        <h1>Tareas operativas</h1>
        <p className="muted">
          Las tareas nuevas aparecen en futuras corridas. El histórico conserva
          exactamente lo que se ejecutó ese día.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Nueva tarea</h2>
          <p className="muted">
            Para agregar trabajo a Azucena, normalmente elige Apertura o Entrega
            de turno y la frecuencia correspondiente.
          </p>

          <form action={createChecklistTask} className="stack">
            <label>
              Checklist
              <select name="templateId" required>
                {data.templates.map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.name} · {template.shiftType}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Tarea
              <input
                name="title"
                placeholder="Ej. Revisar caducidad de leche"
                required
              />
            </label>

            <label>
              Instrucción corta
              <input
                name="description"
                placeholder="Ej. Revisar fecha y aplicar FIFO"
              />
            </label>

            <label>
              Área
              <input
                name="area"
                defaultValue="Operación"
                placeholder="Barra, limpieza, inventario…"
              />
            </label>

            <label>
              Prioridad
              <select name="priority" defaultValue="NORMAL">
                <option value="OPENING_CRITICAL">
                  Crítica para apertura
                </option>
                <option value="NORMAL">Normal</option>
              </select>
            </label>

            <label>
              Qué debe registrar
              <select name="inputType" defaultValue="BOOLEAN">
                <option value="BOOLEAN">Solo confirmar</option>
                <option value="TEXT">Texto / nota</option>
                <option value="NUMBER">Número</option>
                <option value="TEMPERATURE">Temperatura</option>
                <option value="WEIGHT">Peso</option>
                <option value="TIME">Tiempo</option>
              </select>
            </label>

            <label>
              Frecuencia
              <select name="frequency" defaultValue="ALWAYS">
                <option value="ALWAYS">
                  Siempre que se ejecute este checklist
                </option>
                <option value="DAILY">Diario</option>
                <option value="WEEKDAYS">Lunes a viernes</option>
                <option value="WEEKLY">Un día específico cada semana</option>
                <option value="INTERVAL_DAYS">Cada N días</option>
              </select>
            </label>

            <label>
              Día semanal
              <select name="weekday" defaultValue="FR">
                <option value="MO">Lunes</option>
                <option value="TU">Martes</option>
                <option value="WE">Miércoles</option>
                <option value="TH">Jueves</option>
                <option value="FR">Viernes</option>
                <option value="SA">Sábado</option>
                <option value="SU">Domingo</option>
              </select>
              <span className="muted">
                Solo se usa si elegiste “Un día específico”.
              </span>
            </label>

            <label>
              Cada cuántos días
              <input
                name="intervalDays"
                type="number"
                min="2"
                max="365"
                defaultValue="3"
              />
              <span className="muted">
                Solo se usa si elegiste “Cada N días”.
              </span>
            </label>

            <div className="grid">
              <label>
                Mínimo permitido
                <input
                  name="minValue"
                  type="number"
                  step="0.001"
                  placeholder="Opcional"
                />
              </label>
              <label>
                Máximo permitido
                <input
                  name="maxValue"
                  type="number"
                  step="0.001"
                  placeholder="Opcional"
                />
              </label>
            </div>

            <label>
              SOP relacionado
              <select name="sopId" defaultValue="">
                <option value="">Sin SOP</option>
                {data.sopOptions.map((sop) => (
                  <option value={sop.id} key={sop.id}>
                    {sop.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Orden
              <input name="sortOrder" type="number" defaultValue="1000" />
            </label>

            <label>
              <input
                name="required"
                type="checkbox"
                defaultChecked
                style={{ width: "auto" }}
              />{" "}
              Obligatoria
            </label>

            <button type="submit">Crear tarea</button>
          </form>
        </article>

        <article className="card">
          <h2>Tareas actuales</h2>
          <div className="stack">
            {data.tasks.map((task) => (
              <div className="task" key={task.id}>
                <div style={{ flex: 1 }}>
                  <strong>{task.title}</strong>
                  <div className="muted">
                    {task.area} · {task.inputType}
                  </div>
                  <div className="muted">
                    {scheduleLabel(task.rrule ?? null)}
                  </div>
                  <div
                    className={task.active ? "status-ok" : "status-warn"}
                  >
                    {task.active ? "Activa" : "Desactivada"}
                  </div>
                </div>

                <form action={toggleChecklistTask}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={String(!task.active)}
                  />
                  <button type="submit">
                    {task.active ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
