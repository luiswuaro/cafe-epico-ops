import Link from "next/link";
import {notFound} from "next/navigation";
import {getEmployeePosRecipe} from "@/src/application/recipes/pos-bar-book";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";

export const dynamic="force-dynamic";
const number=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});

export default async function RecipeDetail({params,searchParams}:{
  params:Promise<{id:string}>,
  searchParams:Promise<Record<string,string|string[]|undefined>>,
}){
  const {id}=await params;
  const query=await searchParams;
  const {employee}=await getCurrentEmployee();
  const recipe=await getEmployeePosRecipe(employee.organizationId,id);
  if(!recipe)notFound();
  const mode=query.servicio==="llevar"?"TAKEAWAY":"DINE_IN";
  const current=recipe.serviceRecipes[mode];
  return <main className="shell recipe-ops-shell">
    <section className="hero">
      <p className="eyebrow">BARRA · RECETA VIGENTE OPS · {recipe.category}</p>
      <h1>{recipe.name}</h1>
      <p className="muted">
        Estos gramajes provienen de la misma receta que descuenta el inventario al cobrar.
        Si detectas una cantidad incorrecta, repórtala antes de cambiar la preparación.
      </p>
    </section>
    <nav className="recipe-ops-modes" aria-label="Modalidad de servicio">
      <Link href={"/recipes/"+encodeURIComponent(id)}
        className={mode==="DINE_IN"?"active":""}
        aria-current={mode==="DINE_IN"?"page":undefined}>Aquí</Link>
      <Link href={"/recipes/"+encodeURIComponent(id)+"?servicio=llevar"}
        className={mode==="TAKEAWAY"?"active":""}
        aria-current={mode==="TAKEAWAY"?"page":undefined}>Para llevar</Link>
    </nav>
    {!current.configured?<section className="card status-warn" role="alert">
      Esta modalidad aún no tiene una receta OPS configurada. No uses un gramaje histórico.
      Solicita que el administrador la configure en Catálogo POS.
    </section>:<>
      <section className="card recipe-ops-list">
        <p className="eyebrow">PREPARACIÓN · MEDIDAS EXACTAS</p>
        <h2>Ingredientes</h2>
        {current.ingredients.length?
          current.ingredients.map((component,i)=><div className="recipe-ops-line" key={i}>
            <span><strong>{component.name}</strong>
              {component.isCostOnly&&<small className="muted">Costo calculado · sin control de existencia</small>}
            </span>
            <strong className="recipe-ops-amount">{number.format(component.quantity)} {component.unit}</strong>
          </div>):
          <p className="muted">Sin ingredientes de preparación registrados en esta modalidad.</p>}
      </section>
      {current.service.length>0&&<section className="card recipe-ops-list">
        <p className="eyebrow">SERVICIO · EMPAQUES Y UTENSILIOS</p>
        <h2>{mode==="DINE_IN"?"Servicio en mesa":"Para llevar"}</h2>
        {current.service.map((component,i)=><div className="recipe-ops-line" key={i}>
          <strong>{component.name}</strong>
          <strong className="recipe-ops-amount">{number.format(component.quantity)} {component.unit}</strong>
        </div>)}
      </section>}
      {current.costOnly.length>0&&<details className="card recipe-ops-calculations">
        <summary>Agua y otros insumos de costo · no se descuentan del stock</summary>
        <p className="muted">Valores contables de la receta POS. No interpretarlos como instrucciones adicionales de vertido.</p>
        {current.costOnly.map((component,i)=><div className="recipe-ops-line" key={i}>
          <strong>{component.name}</strong><strong>{number.format(component.quantity)} {component.unit}</strong>
        </div>)}
      </details>}
    </>}
    <p className="muted recipe-ops-source">Fuente única: receta vigente de Catálogo POS · {recipe.sourceType==="MANUAL"?"producto propio OPS":"producto migrado con edición OPS"}. Las ventas conservan sus consumos históricos.</p>
    <p><Link href="/recipes">← Volver al recetario</Link></p>
  </main>;
}
