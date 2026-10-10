"use client";

import { useMemo, useState } from "react";
import { inspectAdvancedRoast } from "@/src/domain/roasting/roast-intelligence";
import { parseRoastCurveInput, type RoastCurvePoint, type RoastCurveImport } from "@/src/domain/roasting/curve";

type HistoryBatch={
 id:string; name:string; lot:string;greenG:number;roastedG:number;
 greenPriceKg:number|null;charge:number|null;yellow:number|null;
 fc:number|null;drop:number|null;points:RoastCurvePoint[];
};
const format=(n:number|null,d=1)=>n===null||!Number.isFinite(n)?"—":n.toFixed(d);
function plot(points:RoastCurvePoint[],mode:"BT"|"ROR"){
  const pairs=points.filter(p=>mode==="BT"?p.btC!=null:p.rorCMin!=null)
    .map(p=>({x:p.tS,y:mode==="BT"?p.btC!:p.rorCMin!}));
  if(pairs.length<2)return null;
  const xmax=Math.max(1,...pairs.map(p=>p.x));
  const ymin=Math.min(...pairs.map(p=>p.y));
  const ymax=Math.max(...pairs.map(p=>p.y));
  const range=Math.max(1,ymax-ymin);
  const stride=Math.max(1,Math.ceil(pairs.length/300));
  const down=pairs.filter((_,i)=>i%stride===0||i===pairs.length-1);
  const poly=down.map(p=>(44+p.x/xmax*716).toFixed(2)+","+
    (250-(p.y-ymin)/range*225).toFixed(2)).join(" ");
  return <svg viewBox="0 0 800 290" role="img" aria-label={"Curva "+mode} style={{width:"100%",maxWidth:"100%",background:"rgba(128,128,128,.04)",borderRadius:12}}>
    {[0,1,2,3,4].map(n=><g key={n}>
      <line x1="44" x2="760" y1={25+225*n/4} y2={25+225*n/4} stroke="currentColor" opacity=".15"/>
      <text x="7" y={29+225*n/4} fontSize="11" fill="currentColor">{format(ymax-range*n/4,0)}</text>
    </g>)}
    <polyline points={poly} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
    <text x="45" y="275" fill="currentColor" fontSize="12">0 s</text>
    <text x="698" y="275" fill="currentColor" fontSize="12">{Math.round(xmax)} s</text>
  </svg>;
}
export function RoastIntelligenceLab({batches}:{batches:HistoryBatch[]}){
  const [id,setId]=useState(batches[0]?.id??"");
  const [file,setFile]=useState<{name:string; parsed:RoastCurveImport}|null>(null);
  const [fileError,setFileError]=useState("");
  const [green,setGreen]=useState("");
  const [roasted,setRoasted]=useState("");
  const [power,setPower]=useState("1000");
  const [rate,setRate]=useState("");
  const [greenPrice,setGreenPrice]=useState("");
  const [showRor,setShowRor]=useState(false);
  const selected=batches.find(b=>b.id===id);
  const events:RoastCurveImport["events"]=file?.parsed.events??(
    selected?{
      ...(selected.charge!==null?{charge:{tS:selected.charge}}:{}),
      ...(selected.yellow!==null?{yellowing:{tS:selected.yellow}}:{}),
      ...(selected.fc!==null?{firstCrack:{tS:selected.fc}}:{}),
      ...(selected.drop!==null?{drop:{tS:selected.drop}}:{}),
    }:{}
  );
  const points=file?.parsed.points??selected?.points??[];
  const lotPrice=Number(greenPrice)||(!file?selected?.greenPriceKg??0:0);
  const greenG=green.trim()!==""?Number(green):(file?.parsed.metadata?.greenWeightG??selected?.greenG??null);
  const roastedG=roasted.trim()!==""?Number(roasted):(file?.parsed.metadata?.roastedWeightG??selected?.roastedG??null);
  const input=useMemo(()=>inspectAdvancedRoast({
    points,events,greenG,roastedG,wattNominal:Number(power)||1000,
    electricityRate:rate.trim()?Number(rate):null,
    greenPriceKg:greenPrice.trim()?Number(greenPrice):
      lotPrice>0?lotPrice:null,
  }),[points,events,greenG,roastedG,power,rate,greenPrice,lotPrice]);
  async function loadFile(f:File|null){
    setFileError("");if(!f)return;
    if(f.size>6_000_000){setFileError("Archivo demasiado grande (máximo 6 MB).");return;}
    try{
      const parsed=parseRoastCurveInput(await f.text());
      if(!f.name.toLowerCase().endsWith(".json") || parsed.points.length===0){
        throw new Error("Se requiere JSON HiBean o Artisan con curva reconocible.");
      }
      setFile({name:f.name,parsed});setGreen("");setRoasted("");
    }catch(e){setFileError(e instanceof Error?e.message:"No se pudo abrir el JSON.");}
  }
  return <div className="stack">
    <section className="card stack">
      <h2>Laboratorio de curvas y telemetría</h2>
      <p className="muted">Analiza un batch ya guardado o abre un archivo JSON de HiBean/Artisan sin modificar inventario. El registro y confirmación de café verde siguen en el importador original.</p>
      <div className="grid">
        <label>Batch histórico
          <select value={id} onChange={e=>{setId(e.target.value);setFile(null);setGreen("");setRoasted("");setGreenPrice("");}}>
            {batches.length===0&&<option value="">Sin batches registrados</option>}
            {batches.map(b=><option key={b.id} value={b.id}>{b.name} · {b.lot}</option>)}
          </select></label>
        <label>Archivo HiBean JSON (análisis local)
          <input type="file" accept=".json,application/json" onChange={e=>{void loadFile(e.target.files?.[0]??null);}}/>
        </label>
      </div>
      {file&&<div className="task"><div><strong>{file.name}</strong><p className="muted">{file.parsed.format} · {file.parsed.points.length} muestras · {file.parsed.metadata?.bean?.name??"café sin identificar"}</p>
        <p className="muted">Alcance de la lectura: curvas/eventos, masa y telemetría disponible. La existencia HiBean exige confirmación en el importador de OPS.</p></div>
        <button type="button" className="button" onClick={()=>{setFile(null);setGreen("");setRoasted("");}}>Volver a batch guardado</button></div>}
      {fileError&&<p className="alert">{fileError}</p>}
      <div className="grid">
        <label>Verde cargado (g) <input type="number" min="0" step=".1" value={green}
          placeholder={greenG===null?"Sin dato":String(greenG)} onChange={e=>setGreen(e.target.value)}/></label>
        <label>Peso tostado (g) <input type="number" min="0" step=".1" value={roasted}
          placeholder={roastedG===null?"Sin dato":String(roastedG)} onChange={e=>setRoasted(e.target.value)}/></label>
        <label>Potencia nominal del tostador (W) <input type="number" min="1" value={power} onChange={e=>setPower(e.target.value)}/></label>
        <label>Tarifa eléctrica ($/kWh) <input type="number" min="0" step=".001" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Configura valor verificado"/></label>
        <label>Costo verde ($/kg) <input type="number" min="0" step=".01" value={greenPrice} onChange={e=>setGreenPrice(e.target.value)}
          placeholder={lotPrice>0?String(lotPrice):"Sin costo confirmado"}/></label>
      </div>
      {file?.parsed.warnings.map((w,i)=><p className="status-warn" key={i}>{w}</p>)}
    </section>
    <section className="grid">
      <article className="card"><p className="eyebrow">TIEMPO DE TUESTE</p><div className="metric">{input.drop===null?"—":format(input.drop,0)+" s"}</div></article>
      <article className="card"><p className="eyebrow">DTR CALCULADO</p><div className="metric">{format(input.dtr)}%</div></article>
      <article className="card"><p className="eyebrow">MERMA POR PESO</p><div className="metric">{format(input.merma)}%</div></article>
      <article className="card"><p className="eyebrow">ENERGÍA ESTIMADA</p><div className="metric">{format(input.kwh,3)} kWh</div><small className="muted">{input.hasMeasuredPower?"Potencia de telemetría integrada":"Cota teórica a plena potencia"}</small></article>
    </section>
    <section className="card stack">
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <h2>Firma térmica · {showRor?"RoR":"BT"}</h2>
        <button type="button" className="button" onClick={()=>setShowRor(v=>!v)}>{showRor?"Ver BT":"Ver RoR"}</button>
      </div>
      {plot(points,showRor?"ROR":"BT")??<p className="muted">No hay suficientes puntos para dibujar curva.</p>}
      <p className="muted">El RoR puede haber sido calculado desde BT; no confundir una lectura filtrada con transferencia real de calor del grano. No controlamos automáticamente potencia ni ventilador.</p>
    </section>
    <section className="card stack">
      <h2>Las 12 lentes del ingeniero de tueste</h2>
      {input.warnings.map((w,i)=><p className="status-warn" key={i}>{w}</p>)}
      <div className="grid">
        {input.lenses.map(l=><article key={l.key} className="card">
          <p className="eyebrow">{l.key} · {l.level==="OK"?"CON DATO":l.level==="WATCH"?"REVISAR":"SIN DATO"}</p>
          <h3>{l.heading}</h3><strong>{l.value}</strong><p className="muted">{l.interpretation}</p>
        </article>)}
      </div>
    </section>
    <section className="card">
      <h2>Fases observables</h2>
      <div className="table-scroll"><table><thead><tr><th>Fase</th><th>Tiempo</th><th>% total</th><th>ΔBT/min aprox.</th></tr></thead>
      <tbody>{input.phases.map(p=><tr key={p.name}>
        <td>{p.name}</td><td>{format(p.durationS,0)} s</td><td>{format(p.sharePct)}%</td>
        <td>{format(p.slopeCMin)} °C/min</td></tr>)}</tbody></table></div>
      <p className="muted">La fase Maillard se aproxima como intervalo entre amarilleo y FC. La química real y el progreso de reacción no se miden con esta división temporal.</p>
    </section>
    <section className="card stack">
      <h2>Protocolo de la siguiente prueba</h2>
      <p>Conservar peso verde, origen, humedad y precalentamiento; modificar sólo un mando térmico por prueba; registrar hora exacta de amarilleo y FC; pesar el producto frío y evaluar a ciegas en varios días de reposo. Comparar por lote y replicar antes de atribuir diferencias a la curva.</p>
      <p className="muted">Criterio de repetibilidad: mismo equipo Skywalker v1, carga, condiciones de inicio y calibración BT/ET. Las sugerencias automáticas no reemplazan la evaluación sensorial.</p>
    </section>
  </div>;
}
