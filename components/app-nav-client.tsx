"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
type NavEntry={label:string;href:string;symbol:string};
const e=(label:string,href:string,symbol:string):NavEntry=>({label,href,symbol});
export function AppNavClient({canAdmin,canPos,canCash}:{canAdmin:boolean;canPos:boolean;canCash:boolean}){
  const [open,setOpen]=useState(false);
  const path=usePathname();
  useEffect(()=>setOpen(false),[path]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    window.addEventListener("keydown",close);
    return ()=>window.removeEventListener("keydown",close);
  },[]);
  const groups=[
    {title:"Operación",items:[e("Hoy","/today","⌂"),...(canPos?[e("POS","/pos","▣"),e("Comandas y mesas","/pos/orders","☷")]:[]),...(canCash?[e("Caja","/pos/cash","▤")]:[]),e("Checklist","/checklists","✓"),e("Entrega de turno","/handoff","⇄")]},
    {title:"Inventario y auditoría",items:[e("Inventario","/inventory","▥"),...(canPos?[e("Todos los tickets","/pos/tickets","≡"),e("Clientes y puntos","/pos/customers","♙"),e("Visitas y preferencias","/pos/customers/insights","◎"),e("Consumo por venta","/pos/inventory-audit","▧"),e("Historial de cajas","/pos/cash/history","◷")]:[])]},
    {title:"Barra",items:[e("Recetas","/recipes","◈"),e("SOPs","/sops","▤"),e("Espresso QC","/quality/espresso","◉"),e("Reportar incidencia","/operations/report","!")]},
    ...(canAdmin?[{title:"Gestión",items:[e("Catálogo POS","/admin/pos/catalog","▦"),e("Ticket térmico","/admin/pos/ticket","▤"),e("Tareas","/admin/checklists","✓"),e("Turnos","/admin/reports/shifts","◷"),e("Productividad","/admin/reports/productivity","↗"),e("Tueste","/admin/roasting","◉"),e("Administración","/admin","⚙")]}]:[]),
    {title:"Cuenta",items:[e("Mi cuenta","/account/security","◇")]},
  ];
  const active=(href:string)=>href==="/pos"?path===href:path===href||path.startsWith(href+"/");
  const navLink=(item:NavEntry,short=false)=><Link key={item.href} href={item.href}
    className={(short?"ops-shortcut ":"ops-drawer-link ")+(active(item.href)?"is-active":"")}
    aria-current={active(item.href)?"page":undefined} onClick={()=>setOpen(false)}>
    <span className="ops-nav-icon" aria-hidden="true">{item.symbol}</span><span>{item.label}</span></Link>;
  return <>
    <div className="ops-nav-shell">
      <nav className="ops-desktop-shortcuts" aria-label="Accesos rápidos">
        {navLink(e("Hoy","/today","⌂"),true)}
        {canPos&&navLink(e("POS","/pos","▣"),true)}
        {canPos&&navLink(e("Comandas","/pos/orders","☷"),true)}
        {canCash&&navLink(e("Caja","/pos/cash","▤"),true)}
      </nav>
      <button type="button" className="ops-menu-trigger" onClick={()=>setOpen(!open)}
        aria-expanded={open} aria-controls="ops-drawer">☰ <span>Menú</span></button>
    </div>
    {open&&<div className="ops-drawer-root">
      <button type="button" className="ops-drawer-backdrop" onClick={()=>setOpen(false)}
        aria-label="Cerrar menú"/>
      <aside id="ops-drawer" className="ops-drawer" aria-label="Menú principal">
        <div className="ops-drawer-head"><strong>Café Épico Ops</strong>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar menú">×</button></div>
        <nav className="ops-drawer-list">
          {groups.map(group=><section className="ops-drawer-group" key={group.title}>
            <p>{group.title}</p>{group.items.map(item=>navLink(item))}
          </section>)}
          <form className="ops-drawer-signout" action="/auth/signout" method="post">
            <button type="submit">Salir</button>
          </form>
        </nav>
      </aside>
    </div>}
    <nav className="ops-mobile-tabs" aria-label="Accesos principales">
      {navLink(e("Hoy","/today","⌂"),true)}
      {canPos&&navLink(e("POS","/pos","▣"),true)}
      {canPos&&navLink(e("Comandas","/pos/orders","☷"),true)}
      <button type="button" onClick={()=>setOpen(true)}
        aria-label="Abrir todas las secciones"><span className="ops-nav-icon">☰</span><span>Más</span></button>
    </nav>
  </>;
}
