import Link from "next/link";
const modules=[
 ["Inicio","/admin"],
 ["Recetas POS","/admin/pos/catalog"],
 ["Bolsas","/admin/pos/packaging"],
 ["Inventario","/inventory/ops"],
 ["Tueste","/admin/roasting"],
 ["Finanzas","/admin/finance"],
 ["Análisis","/admin/analytics"],
 ["Compras","/admin/purchases"],
] as const;
/** Navegación consistente entre áreas, una sola pestaña, sin perder rutas. */
export function OpsWorkspaceNav({active}:{active:string}){
 return <nav className="ops-workspace-nav" aria-label="Áreas de OPS">
  {modules.map(([label,url])=><Link key={url} href={url}
    aria-current={active===url?"page":undefined}
    className={active===url?"active":""}>{label}</Link>)}
 </nav>;
}
