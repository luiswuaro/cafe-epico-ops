import { notFound } from "next/navigation";
import { getActiveRecipe } from "@/src/application/recipes/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
export const dynamic = "force-dynamic";
export default async function RecipeDetail({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params; const { employee } = await getCurrentEmployee(); const recipe = await getActiveRecipe(employee.organizationId, id); if (!recipe) notFound();
  return <main className="shell"><section className="hero"><p className="eyebrow">RECETA ACTIVA · v{recipe.majorVersion}.{recipe.minorVersion}</p><h1>{recipe.name}</h1></section><section className="grid"><article className="card"><h2>Ingredientes</h2>{recipe.components.map((c,i)=><div className="task" key={`${c.itemName}-${i}`}><div><strong>{c.itemName}</strong><div className="muted">{c.quantity} {c.unit}{Number(c.wasteFactor)>0 ? ` + ${Number(c.wasteFactor)*100}% merma` : ""}</div>{c.notes&&<small className="muted">{c.notes}</small>}</div></div>)}</article><article className="card"><h2>Procedimiento</h2><p style={{whiteSpace:'pre-wrap'}}>{recipe.instructions}</p><h3>Control de calidad</h3><pre style={{whiteSpace:'pre-wrap',overflow:'auto'}}>{JSON.stringify(recipe.qualitySpec,null,2)}</pre></article></section></main>;
}
