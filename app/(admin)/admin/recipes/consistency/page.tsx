import Link from "next/link";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {getEmployeeRecipeBook} from "@/src/application/loyverse/recipe-book";
import {getEmployeePosRecipeBook} from "@/src/application/recipes/pos-bar-book";
import {compareHistoricalToOps} from "@/src/domain/recipes/consistency-audit";

export const dynamic="force-dynamic";
const number=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});

export default async function RecipeConsistencyPage(){
  const {organizationId}=await requirePermission("pos.catalog.manage");
  const [legacy,live]=await Promise.all([
    getEmployeeRecipeBook(organizationId),
    getEmployeePosRecipeBook(organizationId),
  ]);
  const report=compareHistoricalToOps(legacy,live);
  return <main className="shell pos-shell">
    <header className="hero">
      <p className="eyebrow">CALIDAD DE DATOS · SOLO CONSULTA</p>
      <h1>Auditoría de recetas</h1>
      <p className="muted">Compara gramajes históricos usados anteriormente en barra con
        las recetas actuales del POS. Azucena ahora consulta la receta POS, no esta versión antigua.</p>
      <p><Link className="button" href="/admin/pos/catalog">Catálogo POS · corregir receta</Link></p>
    </header>
    <section className="grid recipe-consistency-kpis">
      <div className="card"><p className="eyebrow">Productos comparables</p><strong className="metric">{report.productsMatched}</strong></div>
      <div className="card"><p className="eyebrow">Cantidades comparadas</p><strong className="metric">{report.compared}</strong></div>
      <div className="card"><p className="eyebrow">Discrepancias detectadas</p><strong className="metric">{report.differences.length}</strong></div>
    </section>
    <p className="muted">La comparación es conservadora: solo compara mismo producto,
      mismo insumo y misma unidad. {report.notComparable} componentes omitidos
      por denominación, unidad o composición distintas no implican que estén correctos.</p>
    {report.differences.length===0?<section className="card">
      No se detectaron discrepancias numéricas entre los pares comparables.
      Las recetas no comparables necesitan auditoría física independiente.
    </section>:<div className="recipe-consistency-scroll">
      <table className="recipe-consistency-table"><thead><tr>
        <th>Bebida</th><th>Ingrediente</th><th>Servicio</th>
        <th>Recetario anterior</th><th>POS vigente</th><th>Diferencia</th>
      </tr></thead><tbody>
        {report.differences.map((d,i)=><tr key={i}>
          <td><strong>{d.product}</strong></td><td>{d.ingredient}</td>
          <td>{d.serviceMode==="DINE_IN"?"Aquí":"Para llevar"}</td>
          <td>{number.format(d.historical)} {d.unit}</td>
          <td><strong>{number.format(d.live)} {d.unit}</strong></td>
          <td>{number.format(d.historical-d.live)} {d.unit}</td>
        </tr>)}
      </tbody></table>
    </div>}
    <p className="muted">Ningún escandallo ni ticket histórico se modifica al consultar esta auditoría.
      La corrección definitiva debe hacerse en Catálogo POS, previa validación del gramaje real.</p>
  </main>;
}
