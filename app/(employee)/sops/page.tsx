import Link from "next/link";
import { listActiveSops } from "@/src/application/sops/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default async function SopsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();
  const rows = await listActiveSops(employee.organizationId);

  const query =
    typeof params.q === "string" ? normalize(params.q) : "";
  const category =
    typeof params.category === "string" ? params.category : "";

  const categories = Array.from(
    new Set(rows.map((row) => row.category)),
  ).sort((a, b) => a.localeCompare(b, "es"));

  const visible = rows.filter((row) => {
    const matchesQuery =
      !query ||
      normalize(row.title).includes(query) ||
      normalize(row.category).includes(query);
    const matchesCategory =
      !category || row.category === category;
    return matchesQuery && matchesCategory;
  });

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PROCEDIMIENTOS</p>
        <h1>SOPs vigentes</h1>
        <p className="muted">
          Busca el procedimiento desde barra sin recorrer todo el catálogo.
        </p>
      </section>

      <form className="card stack" method="get">
        <div className="grid">
          <label>
            Buscar procedimiento
            <input
              name="q"
              defaultValue={
                typeof params.q === "string" ? params.q : ""
              }
              placeholder="Limpieza, espresso, apertura..."
            />
          </label>
          <label>
            Categoría
            <select name="category" defaultValue={category}>
              <option value="">Todas</option>
              {categories.map((row) => (
                <option key={row} value={row}>
                  {row}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          style={{
            display: "flex",
            gap: ".6rem",
            flexWrap: "wrap",
          }}
        >
          <button type="submit">Buscar</button>
          {(query || category) && (
            <Link className="button" href="/sops">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <section className="grid" style={{ marginTop: "1rem" }}>
        {visible.map((row) => (
          <article className="card" key={row.id}>
            <span className="pill">{row.category}</span>
            <h2>{row.title}</h2>
            <p className="muted">
              v{row.majorVersion}.{row.minorVersion}
            </p>
            <Link href={"/sops/version/" + row.versionId}>
              <button>Cómo hacerlo</button>
            </Link>
          </article>
        ))}
      </section>

      {visible.length === 0 && (
        <p className="card muted" style={{ marginTop: "1rem" }}>
          No encontré un SOP con ese filtro.
        </p>
      )}
    </main>
  );
}
