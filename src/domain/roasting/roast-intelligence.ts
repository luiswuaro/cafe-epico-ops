import {
  analyzeRoastCurve, estimateRoastEnergyKwh, type RoastCurveImport,
  type RoastCurvePoint,
} from "@/src/domain/roasting/curve";

export type Phase = { name:string; fromS:number; toS:number; durationS:number;
  sharePct:number; startC:number|null; endC:number|null; slopeCMin:number|null; };
export type RoastLens = { key:string; heading:string; level:"OK"|"WATCH"|"UNKNOWN";
  value:string; interpretation:string; };
const fmt=(n:number|null,unit="")=>n==null||!Number.isFinite(n)?"Sin lectura":n.toFixed(1)+unit;
const numeric=(v:unknown):number|null=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);

export function inspectAdvancedRoast(input:{
  points:RoastCurvePoint[];
  events?:RoastCurveImport["events"];
  greenG?:number|null;
  roastedG?:number|null;
  wattNominal?:number;
  electricityRate?:number|null;
  greenPriceKg?:number|null;
}) {
  const points=input.points.filter(p=>Number.isFinite(p.tS)&&p.tS>=0)
    .sort((a,b)=>a.tS-b.tS);
  const ev=input.events??{};
  const last=points.at(-1);
  const charge=ev.charge?.tS??0;
  const drop=ev.drop?.tS??last?.tS??null;
  const yellow=ev.yellowing?.tS??null;
  const fc=ev.firstCrack?.tS??null;
  const roastSeconds=drop===null?null:drop-charge;
  const dtr=drop!==null && roastSeconds!==null && roastSeconds>0 && fc!==null && fc>=charge && fc<=drop
    ?100*(drop-fc)/roastSeconds:null;
  function temp(time:number|null){
    if(time===null)return null;
    const nearest=points.filter(p=>p.btC!=null)
      .reduce<RoastCurvePoint|null>((a,p)=>a===null||
        Math.abs(p.tS-time)<Math.abs(a.tS-time)?p:a,null);
    return nearest && Math.abs(nearest.tS-time)<=20?nearest.btC??null:null;
  }
  const phases:Phase[]=[];
  function push(name:string,a:number|null,b:number|null){
    if(a===null||b===null||b<=a || roastSeconds===null||roastSeconds<=0)return;
    const startC=temp(a),endC=temp(b), durationS=b-a;
    phases.push({name,fromS:a,toS:b,durationS,sharePct:100*durationS/roastSeconds,
      startC,endC,slopeCMin:startC===null||endC===null?null:60*(endC-startC)/durationS});
  }
  push("Secado / amarilleo",charge,yellow);
  push("Maillard aproximado",yellow,fc);
  push("Desarrollo posterior a FC",fc,drop);
  const roR=analyzeRoastCurve(points,fc,yellow);
  const rors=points.filter(p=>p.rorCMin!=null&&Number.isFinite(p.rorCMin));
  const actualBTRange=points.filter(p=>p.btC!=null).map(p=>p.btC!);
  const negative=rors.filter(p=>(p.rorCMin??0)<0).length;
  const green=numeric(input.greenG),roasted=numeric(input.roastedG);
  const merma=green!==null && roasted!==null && green>0 && roasted<=green
    ?100*(green-roasted)/green:null;
  const power=points.filter(p=>p.powerPct!=null && p.powerPct>=0 && p.powerPct<=100);
  const fan=points.filter(p=>p.fanPct!=null && p.fanPct>=0 && p.fanPct<=100);
  const avg=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const meanPower=avg(power.map(p=>p.powerPct!));
  const meanFan=avg(fan.map(p=>p.fanPct!));
  const kwh=drop===null?null:estimateRoastEnergyKwh(points,drop,input.wattNominal??1000);
  const greenPrice=input.greenPriceKg??null, rate=input.electricityRate??null;
  const energyCost=kwh!==null&&rate!==null?kwh*rate:null;
  const greenCost=green!==null&&greenPrice!==null?green*greenPrice/1000:null;
  const knownCost=(energyCost??0)+(greenCost??0);
  const fullCost=energyCost!==null&&greenCost!==null;
  const costKg=roasted && fullCost?knownCost*1000/roasted:null;
  const gaps:number[]=[];
  for(let i=1;i<points.length;i++) if(points[i].tS-points[i-1].tS>20)gaps.push(points[i].tS-points[i-1].tS);
  const lenses:RoastLens[]=[
    {key:"01",heading:"Integridad de telemetría",
      level:points.length>=30&&gaps.length===0&&actualBTRange.length>=30?"OK":"WATCH",
      value:points.length+" muestras · "+gaps.length+" interrupciones >20 s",
      interpretation:"Examinar ausencia de BT, intervalos grandes y muestras anómalas antes de comparar perfiles."},
    {key:"02",heading:"Cronología de eventos",
      level:yellow!==null && fc!==null && drop!==null && yellow<fc && fc<drop?"OK":"WATCH",
      value:"Amarilleo "+fmt(yellow," s")+" · FC "+fmt(fc," s")+" · drop "+fmt(drop," s"),
      interpretation:"Verificar marcas reales en HiBean. Eventos desplazados alteran DTR y todos los cálculos de fase."},
    {key:"03",heading:"Distribución de fases",
      level:phases.length===3?"OK":"UNKNOWN",
      value:phases.map(p=>p.name.split(" ")[0]+": "+p.sharePct.toFixed(1)+"%").join(" · ")||"Sin eventos completos",
      interpretation:"Porcentajes descriptivos, no metas universales; comparar con el mismo café, carga y tostador."},
    {key:"04",heading:"Desarrollo y DTR",
      level:dtr!==null?"OK":"UNKNOWN",value:fmt(dtr,"%"),
      interpretation:"DTR es una relación de tiempos; no es por sí sola indicador de grado de tueste ni sabor."},
    {key:"05",heading:"RoR alrededor del primer crack",
      level:fc===null?"UNKNOWN":roR.crashFlag||roR.flickFlag?"WATCH":"OK",
      value:"Crash "+fmt(roR.crashMagnitude," °C/min")+" · flick "+fmt(roR.flickMagnitude," °C/min"),
      interpretation:"Alertas heurísticas; dependen del alisado, latencia y posición de la sonda BT, no prueban un defecto sensorial."},
    {key:"06",heading:"Estancamiento y RoR negativo",
      level:roR.stallFlag||negative>0?"WATCH":rors.length?"OK":"UNKNOWN",
      value:fmt(roR.stallSeconds," s")+" en stall · "+negative+" puntos negativos",
      interpretation:"Corroborar con BT sin filtrar y el registro del ventilador antes de atribuir falla de transferencia de calor."},
    {key:"07",heading:"Potencia eléctrica del calentador",
      level:power.length>=2?"OK":"UNKNOWN",value:"Media muestral "+fmt(meanPower,"%"),
      interpretation:"La media simple orienta, pero la energía se integra según tiempo. El 100% nominal no mide consumo real."},
    {key:"08",heading:"Aire y convección",
      level:fan.length?"OK":"UNKNOWN",value:"Ventilador medio "+fmt(meanFan,"%"),
      interpretation:"Correlacionar cambios de aire con ET/BT y RoR; sin sensores de flujo no conocemos convección real."},
    {key:"09",heading:"Pérdida de masa",
      level:merma!==null?"OK":"UNKNOWN",value:fmt(merma,"%"),
      interpretation:"Comparar con pesos medidos en báscula, mismo criterio de enfriamiento y humedad inicial."},
    {key:"10",heading:"Electricidad por batch",
      level:power.length>=2?"OK":"WATCH",value:kwh===null?"No estimable":kwh.toFixed(3)+" kWh",
      interpretation:power.length>=2?
        "Integración estimada de potencia nominal y % declarado. No incluye necesariamente motor/ventilador/pérdidas.":
        "Sin registro de potencia: máximo teórico aproximado con calentador al 100%, no medición."},
    {key:"11",heading:"Costo por kg tostado",
      level:fullCost?"OK":"UNKNOWN",value:costKg===null?"Costo incompleto":fmt(costKg," MXN/kg"),
      interpretation:"Sólo verde y electricidad del calentador. Añadir mano de obra, limpieza, consumo auxiliar y mantenimiento."},
    {key:"12",heading:"Control de repetibilidad",
      level:points.length>=20&&phases.length===3?"OK":"WATCH",
      value:fmt(temp(fc)," °C BT en FC")+" · "+fmt(temp(drop)," °C BT en drop"),
      interpretation:"Comparar curvas con carga, ambiente, humedad y masa consistentes. Los datos no justifican ajuste automático del calentador."},
  ];
  return {
    lenses,phases,points,charge,drop,yellow,fc,dtr,merma,
    kwh,greenCost,energyCost,costKg,roR,
    hasMeasuredPower:power.length>=2,
    warnings:[
      ...(points.length<30?["Pocas muestras BT válidas."]:[]),
      ...(gaps.length?["Se encontraron cortes mayores a 20 segundos."]:[]),
      ...(yellow===null||fc===null?["Eventos críticos incompletos."]:[]),
      ...(!fullCost?["Costos incompletos: falta costo de verde o tarifa eléctrica."]:[]),
    ],
  };
}
