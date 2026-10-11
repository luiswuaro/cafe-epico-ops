/** Tiempos de barra basados en eventos de auditoría persistentes.
 * PRINT_ACK significa respuesta OK del puente ESC/POS, no una lectura de papel.
 * En nuevas rondas se muestran únicamente los eventos de la ronda vigente.
 */
export type CommandTimingEvent={
  action:string;createdAt:Date;afterData:Record<string,unknown>|null;
};
export type CommandTimingLine={
  createdAt:Date;expectedConsumption:Record<string,unknown>;
};
export function deriveCommandTimeline(
  createdAt:Date,lines:CommandTimingLine[],events:CommandTimingEvent[],
){
  const last=lines.at(-1);
  const roundId=typeof last?.expectedConsumption?.roundId==="string"
    ?last.expectedConsumption.roundId:"INITIAL";
  const current=lines.filter(line=>(typeof line.expectedConsumption?.roundId==="string"
    ?line.expectedConsumption.roundId:"INITIAL")===roundId);
  const roundStartedAt=current.length
    ?new Date(Math.min(...current.map(l=>l.createdAt.getTime())))
    :createdAt;
  const sorted=[...events].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
  const matching=sorted.filter(e=>e.createdAt.getTime()>=roundStartedAt.getTime()-1000);
  const printed=matching.find(e=>e.action==="POS_COMMAND_PRINT_ACKNOWLEDGED" &&
    e.afterData?.roundId===roundId);
  const preparing=matching.find(e=>e.action==="POS_COMMAND_STATUS_CHANGED"&&
    e.afterData?.status==="PREPARING");
  const ready=matching.find(e=>e.action==="POS_COMMAND_STATUS_CHANGED"&&
    e.afterData?.status==="READY");
  return {roundId,roundStartedAt,printAckAt:printed?.createdAt??null,
    preparingAt:preparing?.createdAt??null,readyAt:ready?.createdAt??null};
}
export function durationSeconds(from:Date,to:Date){
  return Math.max(0,Math.floor((to.getTime()-from.getTime())/1000));
}
export function durationText(totalSeconds:number){
  const sec=Math.max(0,Math.floor(totalSeconds));
  const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
  return h>0?`${h} h ${String(m).padStart(2,"0")} min`
    :`${m}:${String(s).padStart(2,"0")}`;
}
