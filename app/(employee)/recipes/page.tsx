import Link from "next/link";
import { listActiveRecipes } from "@/src/application/recipes/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
export const dynamic = "force-dynamic";
export default async function RecipesPage() {
  const { employee } = await getCurrentEmployee();
  const recipes = await listActiveRecipes(employee.organizationId);
  return <main className="shell"><section className="hero"><p className="eyebrow">RECETAS VIGENTES</p><h1>Barra</h1><p className="muted">Solo se muestra la versión ACTIVE. El historial queda preservado.</p></section><section className="grid">{recipes.map((r)=><article className="card" key={r.id}><h2>{r.name}</h2><p className="muted">v{r.majorVersion}.{r.minorVersion}{r.yieldQuantity ? ` · ${r.yieldQuantity} ${r.yieldUnit}` : ""}</p><Link href={`/recipes/${r.id}`}><button>Ver receta</button></Link></article>)}</section></main>;
}
