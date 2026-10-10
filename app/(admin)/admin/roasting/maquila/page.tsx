import Link from "next/link";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getContractDashboard,mass,round2 } from "@/src/application/roasting/contracts";
import { ContractBatchForm } from "./quality-form";
import {
  createContractClient,createContractLot,createContractDelivery,setContractLotStatus,
} from "./actions";

export const dynamic="force-dynamic";
const number=new Intl.NumberFormat("es-MX",{maximumFractionDigits:2});
const mxn=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
const fmt=(n:number)=>number.format(n);
const mxTime=(d:Date)=>new Intl.DateTimeFormat("es-MX",{
  dateStyle:"medium",timeStyle:"short",timeZone:"America/Mexico_City",
}).format(d);

const alerts:Record<string,string>={
  "cliente-invalido":"Revisa el nombre y los datos del cliente.",
  "lote-invalido":"Revisa el café, el peso verde recibido y la tarifa por kilogramo.",
  "cliente-inexistente":"Selecciona un cliente registrado.",
  "batch-invalido":"El batch contiene pesos o datos QC inválidos. Comprueba gramos y muestras.",
  "verde-insuficiente":"El café verde del cliente es insuficiente para esa carga.",
  "lote-cerrado":"Este lote está cerrado. Reábrelo para agregar batches.",
  "batch-duplicado":"Ya existe un batch con ese código dentro del lote.",
  "entrega-invalida":"Indica la cantidad entregada en gramos.",
  "batch-inexistente":"El batch no pertenece a tu organización.",
  "entrega-supera-tostado":"La entrega supera el café tostado disponible de ese batch.",
  "lote-inexistente":"El lote no existe o pertenece a otra organización.",
  "estado-invalido":"Estado de lote no reconocido.",
};
const success:Record<string,string>={
  cliente:"Cliente guardado.",lote:"Lote recibido: inventario ajeno registrado.",
  batch:"Batch registrado. El saldo verde de maquila se actualizó.",
  entrega:"Entrega documentada correctamente.",
  estado:"Estado del lote actualizado.",
};

export default async function MaquilaPage({
  searchParams,
}:{
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const {organizationId}=await requirePermission("roast.manage");
  const params=await searchParams;
  const data=await getContractDashboard(organizationId);
  const selectedClient=typeof params.client==="string"?params.client:"";
  const selectedLot=typeof params.lot==="string"?params.lot:"";
  const visibleGroups=data.groups.filter(g=>
    (!selectedClient||g.clientId===selectedClient) &&
    (!selectedLot||g.id===selectedLot));
  const error=typeof params.error==="string"?params.error:"";
  const ok=typeof params.ok==="string"?params.ok:"";
  const allGreen=data.groups.reduce((s,g)=>s+g.remainingGreenG,0);
  const allFinished=data.groups.reduce((s,g)=>s+g.readyRoastedG,0);
  const allBatchCount=data.groups.reduce((s,g)=>s+g.batches.length,0);
  const allFees=data.groups.reduce((s,g)=>s+g.feeAccrued,0);

  return <main className="shell ops-contract-page">
    <section className="hero ops-contract-hero">
      <p className="eyebrow">INGENIERÍA DEL CAFÉ · SERVICIOS A TERCEROS</p>
      <h1>Maquila de tueste</h1>
      <p>
        Custodia trazable del café del cliente, producción por batch,
        control de defectos, entregas y reportes técnicos en PDF.
      </p>
      <Link href="/admin/roasting">← Volver a Tueste</Link>
    </section>

    {!!error&&<p className="ops-inline-notice is-warning" role="alert">
      {alerts[error]??"No se pudo completar la operación. Ningún registro se confirmó."}
    </p>}
    {!!ok&&<p className="ops-inline-notice" role="status">
      {success[ok]??"Operación guardada."}
    </p>}

    <section className="ops-contract-metrics">
      <article><span>Verde de clientes en custodia</span><strong>{fmt(allGreen)} g</strong><small>Separado de inventario propio</small></article>
      <article><span>Tostado por entregar</span><strong>{fmt(allFinished)} g</strong><small>Producido menos entregas</small></article>
      <article><span>Batches registrados</span><strong>{fmt(allBatchCount)}</strong><small>Con pesos y merma medidos</small></article>
      <article><span>Servicios acumulados</span><strong>{mxn.format(allFees)}</strong><small>Facturación estimada, no cobro confirmado</small></article>
    </section>

    <div className="ops-contract-setup">
      <details className="card ops-contract-panel">
        <summary><strong>01 · Alta de cliente</strong><small>Persona o empresa propietaria del café</small></summary>
        <form action={createContractClient} className="stack">
          <label>Cliente / empresa <input name="name" required maxLength={120}
            placeholder="Ej. Tostaduría Los Pinos"/></label>
          <div className="ops-contract-fields">
            <label>Contacto <input name="contact" maxLength={140}/></label>
            <label>Teléfono <input name="phone" type="tel" maxLength={50}/></label>
            <label>Correo <input name="email" type="email" maxLength={160}/></label>
          </div>
          <label>Notas <textarea name="notes" rows={2} maxLength={1200}/></label>
          <button type="submit">Guardar cliente</button>
        </form>
      </details>
      <details className="card ops-contract-panel" open={!data.groups.length}>
        <summary><strong>02 · Recepción de café verde</strong>
          <small>Inventario ajeno, no mezclado con OPS ni Loyverse</small></summary>
        <form action={createContractLot} className="stack">
          <label>Cliente
            <select name="clientId" required defaultValue={selectedClient}>
              <option value="" disabled>Selecciona al propietario…</option>
              {data.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="ops-contract-fields">
            <label>Nombre del café <input name="coffeeName" required maxLength={140}
              placeholder="Ej. Bourbon rojo natural"/></label>
            <label>Café verde recibido (g) <input name="greenReceivedG"
              type="number" required min=".01" max="1000000" step=".01"
              placeholder="Ej. 5000"/></label>
            <label>Tarifa de servicio ($ MXN/kg verde)
              <input name="feePerKgGreen" type="number" required min="0"
                step=".01" placeholder="Ej. 120"/>
            </label>
            <label>Origen <input name="origin" placeholder="Estado, región…"/></label>
            <label>Productor <input name="producer"/></label>
            <label>Variedad <input name="variety"/></label>
            <label>Proceso <input name="process"/></label>
          </div>
          <label>Condición al recibir y observaciones
            <textarea name="notes" rows={2} maxLength={1200}
              placeholder="Humedad, empaque, sello, folio de ingreso…"/>
          </label>
          <p className="muted">La tarifa se calcula sobre gramos verdes efectivamente procesados.
            No se registra una venta ni se agrega inventario propio al crear el lote.</p>
          <button type="submit" disabled={data.clients.length===0}>Registrar recepción</button>
        </form>
      </details>
    </div>

    <section className="card stack ops-contract-filter">
      <div className="section-heading"><div>
        <p className="eyebrow">03 · CLIENTE / CAFÉ / BATCHES</p>
        <h2>Expedientes de maquila</h2>
      </div></div>
      <form action="/admin/roasting/maquila" method="get" className="ops-contract-fields">
        <label>Cliente
          <select name="client" defaultValue={selectedClient}>
            <option value="">Todos los clientes</option>
            {data.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Lote de café
          <select name="lot" defaultValue={selectedLot}>
            <option value="">Todos los lotes</option>
            {data.groups.filter(g=>!selectedClient||g.clientId===selectedClient).map(g=>
              <option key={g.id} value={g.id}>{g.coffeeName}</option>)}
          </select>
        </label>
        <button type="submit">Filtrar expedientes</button>
        <Link href="/admin/roasting/maquila" className="button">Limpiar filtros</Link>
      </form>
    </section>

    {visibleGroups.length===0&&<section className="card">
      <h2>Sin lotes para mostrar</h2>
      <p className="muted">Da de alta a un cliente y registra el peso del café verde que te entregó.</p>
    </section>}

    {visibleGroups.map(group=><section className="card stack ops-contract-lot" key={group.id}>
      <div className="ops-contract-lot-heading">
        <div>
          <p className="eyebrow">LOTE DE TERCERO · {group.status==="OPEN"?"ABIERTO":"CERRADO"}</p>
          <h2>{group.coffeeName}</h2>
          <p>{group.client?.name??"Cliente"} · {group.origin??"Origen no informado"}
            {group.process?" · "+group.process:""}</p>
        </div>
        <form action={setContractLotStatus}>
          <input type="hidden" name="lotId" value={group.id}/>
          <input type="hidden" name="status" value={group.status==="OPEN"?"CLOSED":"OPEN"}/>
          <button type="submit" className="ops-action-soft">
            {group.status==="OPEN"?"Cerrar lote":"Reabrir lote"}
          </button>
        </form>
      </div>
      <div className="ops-contract-balance">
        <div><span>Verde recibido</span><strong>{fmt(mass(group.greenReceivedG))} g</strong></div>
        <div><span>Verde procesado</span><strong>{fmt(group.usedGreenG)} g</strong></div>
        <div><span>Verde disponible</span><strong>{fmt(group.remainingGreenG)} g</strong></div>
        <div><span>Tostado por entregar</span><strong>{fmt(group.readyRoastedG)} g</strong></div>
      </div>
      <p className="ops-contract-meta">
        Producción {fmt(group.roastedG)} g · Merma {group.lossPct==null?"Sin datos":fmt(group.lossPct)+"%"} ·
        Entregado {fmt(group.deliveredG)} g · Servicio devengado {mxn.format(group.feeAccrued)}
      </p>
      <details className="ops-contract-panel ops-contract-batch-panel">
        <summary><strong>+ Registrar nuevo batch</strong><small>Pesos, curva resumida, defectos y cata</small></summary>
        {group.status==="OPEN"&&group.remainingGreenG>0
          ? <ContractBatchForm lotId={group.id} remainingGreenG={group.remainingGreenG}
              sequence={group.batches.length+1}/>
          : <p className="muted">No es posible añadir batches a un lote cerrado o sin café verde.</p>}
      </details>

      <div className="ops-contract-batch-list">
        {group.batches.length===0&&<p className="muted">Aún no hay batches registrados.</p>}
        {group.batches.map(batch=>{
          const green=mass(batch.greenG),roasted=mass(batch.roastedG);
          const available=round2(roasted-batch.deliveredG);
          const loss=round2((green-roasted)/green*100);
          return <details className="ops-contract-batch-entry" key={batch.id}>
            <summary><span className="ops-contract-code">{batch.batchCode}</span>
              <span>{fmt(green)} → {fmt(roasted)} g</span>
              <span className="ops-contract-pill">Merma {fmt(loss)}%</span>
            </summary>
            <div className="stack">
              <small className="muted">{mxTime(batch.roastedAt)} · {batch.profile??"Sin perfil documentado"}</small>
              <div className="ops-contract-batch-kpis">
                <div><span>Verde usado</span><strong>{fmt(green)} g</strong></div>
                <div><span>Tostado</span><strong>{fmt(roasted)} g</strong></div>
                <div><span>Defectos en muestra</span>
                  <strong>{batch.quality.percentage==null?"No evaluado":fmt(batch.quality.percentage)+"%"}</strong>
                </div>
                <div><span>Por entregar</span><strong>{fmt(available)} g</strong></div>
              </div>
              {batch.defects.length>0&&<div className="ops-contract-defect-summary">
                <strong>Detalle de defectos ({fmt(mass(batch.greenDefectSampleG))} g de muestra)</strong>
                {batch.defects.map((defect,i)=><p key={i}>
                  {defect.type} · {defect.severity==="PRIMARY"?"Primario":defect.severity==="SECONDARY"?"Secundario":"Otro"} ·
                  {defect.count} pz · {fmt(defect.grams)} g
                </p>)}
              </div>}
              {batch.qualityNotes&&<p>QC: {batch.qualityNotes}</p>}
              {batch.sensoryNotes&&<p>Sensorial: {batch.sensoryNotes}</p>}
              {available>0&&<form action={createContractDelivery} className="ops-contract-deliver-form">
                <input type="hidden" name="batchId" value={batch.id}/>
                <label>Entregar tostado (g) <input name="grams" type="number" required
                  min=".01" max={available} step=".01"
                  placeholder={String(available)}/></label>
                <label>Recibe <input name="recipient" maxLength={160} placeholder="Nombre"/></label>
                <button type="submit">Registrar entrega</button>
              </form>}
            </div>
          </details>;
        })}
      </div>

      {group.batches.length>0&&<div className="ops-contract-report">
        <h3>Reporte técnico para el cliente</h3>
        <p className="muted">Selecciona sólo los batches que quieres incluir. El PDF documenta
          peso, merma, inspecciones, tipos de defectos, eventos de tueste y trazabilidad.
          Los campos sin medir aparecen como «No evaluado».</p>
        <form action="/admin/roasting/maquila/report/pdf" method="get" target="_blank"
          className="stack">
          <input name="lot" type="hidden" value={group.id}/>
          <div className="ops-contract-report-select">
            {group.batches.map(batch=><label key={batch.id}>
              <input type="checkbox" name="batch" value={batch.id} defaultChecked/>
              <span>{batch.batchCode} · {fmt(mass(batch.greenG))} g verdes ·
                {mxTime(batch.roastedAt)}</span>
            </label>)}
          </div>
          <button type="submit">Generar reporte PDF de batches seleccionados ↗</button>
        </form>
      </div>}
    </section>)}
  </main>;
}
