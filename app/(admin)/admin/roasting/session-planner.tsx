"use client";

import { useMemo, useState } from "react";

type Lot={id:string;name:string;greenStockG:number|null;greenStockSource:string;targetUse:string};

function fmt(v:number,d=0){return new Intl.NumberFormat("es-MX",{maximumFractionDigits:d}).format(v);}
const MIN_CHARGE=100;
const MAX_CHARGE=500;

export function RoastingSessionPlanner({lots}:{lots:Lot[]}){
  const [lotId,setLotId]=useState(lots[0]?.id??"");
  const [target,setTarget]=useState("5000");
  const [charge,setCharge]=useState("500");
  const [loss,setLoss]=useState("16");
  const [destination,setDestination]=useState("ESPRESSO");
  const [realWeights,setRealWeights]=useState<Record<number,string>>({});
  const selected=lots.find(l=>l.id===lotId);
  const grams=Number(target),batch=Number(charge),lossPct=Number(loss);
  const valid=Number.isFinite(grams)&&grams>0&&grams<=25000&&
    Number.isFinite(batch)&&batch>=MIN_CHARGE&&batch<=MAX_CHARGE&&
    Number.isFinite(lossPct)&&lossPct>=0&&lossPct<40;
  const plan=useMemo(()=>{
    if(!valid)return [];
    const count=Math.ceil(grams/batch);
    return Array.from({length:count},(_,i)=>{
      const green=Math.min(batch,grams-i*batch);
      const actualText=realWeights[i];
      const actual=actualText?.trim()?Number(actualText):null;
      const actualValid=actual!==null&&Number.isFinite(actual)&&actual>0&&actual<=green;
      const expected=green*(1-lossPct/100);
      return {
        number:i+1,green,expected,
        actual:actualValid?actual:null,
        actualInvalid:actual!==null&&!actualValid,
        loss:actualValid?100*(green-actual)/green:null,
      };
    });
  },[grams,batch,lossPct,valid,realWeights]);
  const estimatedRoasted=plan.reduce((t,b)=>t+b.expected,0);
  const realRoasted=plan.reduce((t,b)=>t+(b.actual??0),0);
  const registered=plan.filter(b=>b.actual!==null);
  const greenProcessed=registered.reduce((t,b)=>t+b.green,0);
  const remaining=valid?grams-greenProcessed:0;
  const outOfStock=selected?.greenStockG!==null&&selected?.greenStockG!==undefined&&valid
    &&selected.greenStockG<grams;
  const displayStock=selected?.greenStockG==null?"Sin confirmar":fmt(selected.greenStockG)+" g";

  function clearPlan(){
    setRealWeights({});
  }
  return <div className="stack">
    <div className="grid">
      <label>Lote de café verde
        <select value={lotId} onChange={e=>{setLotId(e.target.value);clearPlan();}}>
          {lots.length===0&&<option value="">Sin lotes: registra o importa uno</option>}
          {lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label>Verde a procesar (g)
        <input type="number" min="1" max="25000" step="1" value={target}
          onChange={e=>{setTarget(e.target.value);clearPlan();}}/>
      </label>
      <label>Carga nominal por batch (g)
        <select value={charge} onChange={e=>{setCharge(e.target.value);clearPlan();}}>
          <option value="500">500 g · Skywalker</option>
          <option value="400">400 g · Skywalker</option>
          <option value="333">333 g · Skywalker</option>
          <option value="250">250 g · prueba</option>
        </select>
      </label>
      <label>Merma prevista (%)
        <input type="number" min="0" max="39.9" step="0.1" value={loss}
          onChange={e=>setLoss(e.target.value)}/>
      </label>
      <label>Destino del tueste
        <select value={destination} onChange={e=>setDestination(e.target.value)}>
          <option value="ESPRESSO">Espresso</option>
          <option value="OMNI">Omni</option>
          <option value="FILTER">Filtrado</option>
        </select>
      </label>
      <div className="card">
        <strong>Inventario verde registrado</strong>
        <p>{displayStock}</p>
        <small className="muted">{selected?.greenStockSource==="HIBEAN_CONFIRMED"
          ?"HiBean confirmado en OPS":selected?.greenStockSource==="INTERNAL"
            ?"Inventario interno OPS":"Confirma primero el lote e inventario en OPS"}</small>
      </div>
    </div>
    {!valid&&<p className="alert">Verifica el peso verde, la carga (100 a 500 g) y la merma estimada.</p>}
    {outOfStock&&<p className="alert">El plan supera el inventario verde registrado. Revisa el stock de HiBean y confirma cualquier corrección en OPS antes de registrar batches.</p>}
    {valid&&<div className="grid">
      <div className="card"><p className="eyebrow">PLAN DE PRODUCCIÓN</p><div className="metric">{plan.length} batches</div><p>{fmt(grams)} g verdes</p></div>
      <div className="card"><p className="eyebrow">TOSTADO ESTIMADO</p><div className="metric">{fmt(estimatedRoasted/1000,3)} kg</div><p>Merma prevista {fmt(lossPct,1)}%</p></div>
      <div className="card"><p className="eyebrow">AVANCE MEDIDO</p><div className="metric">{registered.length}/{plan.length}</div><p>{fmt(greenProcessed)} g procesados · {fmt(realRoasted)} g tostados medidos</p></div>
      <div className="card"><p className="eyebrow">VERDE POR TOSTAR</p><div className="metric">{fmt(remaining)} g</div><p>{destination} · estimación local</p></div>
    </div>}
    {valid&&<div className="table-scroll"><table>
      <thead><tr><th>Batch</th><th>Verde (g)</th><th>Previsto tostado (g)</th><th>Real tostado (g)</th><th>Merma real</th></tr></thead>
      <tbody>{plan.map((b,i)=><tr key={b.number}>
        <td>#{b.number}</td><td>{fmt(b.green)}</td><td>{fmt(b.expected,1)}</td>
        <td><input aria-label={"Peso tostado batch "+b.number} style={{maxWidth:120}}
          type="number" min="0.1" max={b.green} step="0.1"
          placeholder="Pesar" value={realWeights[i]??""}
          onChange={e=>setRealWeights(p=>({...p,[i]:e.target.value}))}/></td>
        <td>{b.actualInvalid?"Revisar peso":b.loss==null?"—":fmt(b.loss,2)+"%"}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="muted">Plan y pesos anotados aquí son una simulación local: no se guardan ni descuentan existencias. La confirmación del JSON registra el batch y el saldo verde de HiBean aprobado en OPS. La contabilización del consumo de verde y la entrada de tostado en el inventario interno es un paso separado, y no se ejecuta desde este planificador. Guarda el archivo JSON de cada batch en HiBean. No cierres esta pantalla antes de copiar tus pesos medidos.</p>
    <button type="button" className="button" onClick={()=>{
      const summary=[
        "PLAN TUESTE OPS (no confirmado)",
        "Lote: "+(selected?.name??"sin asignar"),
        "Destino: "+destination,
        "Verde planificado: "+grams+" g",
        "Carga nominal: "+batch+" g",
        "Merma prevista: "+lossPct+"%",
        ...plan.map(b=>"Batch "+b.number+": "+b.green+" g verde · "+(b.actual==null?"pendiente":b.actual+" g tostado")+(b.loss==null?"":" · merma "+b.loss.toFixed(2)+"%")),
        "Totales medidos: "+greenProcessed+" g verde · "+realRoasted+" g tostado",
      ].join("\n");
      void navigator.clipboard.writeText(summary);
    }}>Copiar plan y avance</button>
  </div>;
}
