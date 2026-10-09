"use client";

import { useMemo, useState, type ReactNode } from "react";

export type SearchableEntry = {
  id: string;
  name: string;
  category?: string;
  status?: string;
  searchText?: string;
  content: ReactNode;
};

type Props = {
  entries: SearchableEntry[];
  label: string;
  placeholder?: string;
  listClassName?: string;
  categoryLabel?: string;
  statusLabel?: string;
  defaultStatus?: string;
  emptyText?: string;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}

/**
 * Filtrado 100% local. Nunca consulta ni modifica existencias/recetas.
 * Los renglones ocultos siguen montados: no pierde formularios abiertos ni
 * cambios sin guardar al cambiar de filtro.
 */
export function SearchableCollection({
  entries, label, placeholder="Buscar por nombre, ingrediente o código...",
  listClassName, categoryLabel="Categoría", statusLabel="Estado",
  defaultStatus="", emptyText="No hay coincidencias con esos filtros.",
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(() => defaultStatus && entries.some(item=>item.status===defaultStatus) ? defaultStatus : "");
  const categories = useMemo(
    () => [...new Set(entries.map(item => item.category).filter((x):x is string=>Boolean(x)))].sort((a,b)=>a.localeCompare(b,"es-MX")),
    [entries],
  );
  const statuses = useMemo(
    () => [...new Set(entries.map(item => item.status).filter((x):x is string=>Boolean(x)))],
    [entries],
  );
  const visible = useMemo(()=>{
    const words=normalize(query).split(" ").filter(Boolean);
    return new Set(entries.filter(item=>{
      if(category && item.category!==category)return false;
      if(status && item.status!==status)return false;
      if(!words.length)return true;
      const text=normalize([item.name,item.category,item.status,item.searchText].filter(Boolean).join(" "));
      return words.every(word=>text.includes(word));
    }).map(item=>item.id));
  },[entries,query,category,status]);
  const reset=()=>{setQuery("");setCategory("");setStatus("");};
  return (
    <div className="stack">
      <div className="card stack" style={{gap:12}}>
        <label htmlFor={"search-"+label.replace(/[^a-zA-Z0-9]/g,"-")}>
          <strong>Buscar {label}</strong>
        </label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <input
            id={"search-"+label.replace(/[^a-zA-Z0-9]/g,"-")}
            type="search" value={query}
            onChange={event=>setQuery(event.target.value)}
            placeholder={placeholder} autoComplete="off"
            aria-label={"Buscar "+label}
            style={{flex:"2 1 230px",minWidth:160}}
          />
          {categories.length>1 && <label style={{flex:"1 1 155px",minWidth:130}}>
            {categoryLabel}
            <select aria-label={categoryLabel} value={category} onChange={event=>setCategory(event.target.value)}>
              <option value="">Todas</option>
              {categories.map(value=><option key={value} value={value}>{value}</option>)}
            </select>
          </label>}
          {statuses.length>1 && <label style={{flex:"1 1 155px",minWidth:130}}>
            {statusLabel}
            <select aria-label={statusLabel} value={status} onChange={event=>setStatus(event.target.value)}>
              <option value="">Todos</option>
              {statuses.map(value=><option key={value} value={value}>{value}</option>)}
            </select>
          </label>}
          {(query||category||status) && <button type="button" className="button" onClick={reset}>Limpiar filtros</button>}
        </div>
        <p className="muted" aria-live="polite" style={{margin:0}}>
          Mostrando <strong>{visible.size}</strong> de <strong>{entries.length}</strong> {label}.
          {" "}Búsqueda inmediata, sin cambiar existencias.
        </p>
      </div>
      {visible.size===0 && <p className="card muted" role="status">{emptyText}</p>}
      <div className={listClassName ?? "stack"}>
        {entries.map(item=>(
          <div key={item.id} style={{display:visible.has(item.id)?"contents":"none"}}>
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
