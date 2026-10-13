/** Delimita una sesión sin alterar el libro real de batches ni sus movimientos. */
export type RoastSessionWindow = {
  lotId:string;
  startDate:string;
  sessionStartedAt?:string;
  sessionEndedAt?:string;
};
export type RoastSessionBatch = {coffeeLotId:string;roastedAt:string};
const dayInMexico=(iso:string)=>new Intl.DateTimeFormat("sv-SE",{
  timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
}).format(new Date(iso));

export function batchBelongsToRoastSession(batch:RoastSessionBatch,window:RoastSessionWindow){
  const millis=Date.parse(batch.roastedAt);
  if(!Number.isFinite(millis)||batch.coffeeLotId!==window.lotId||
    !window.startDate||dayInMexico(batch.roastedAt)<window.startDate)return false;
  const min=window.sessionStartedAt?Date.parse(window.sessionStartedAt):null;
  const max=window.sessionEndedAt?Date.parse(window.sessionEndedAt):null;
  if(min!==null&&(!Number.isFinite(min)||millis<min))return false;
  if(max!==null&&(!Number.isFinite(max)||millis>=max))return false;
  return true;
}
export function plannedRoastCharges(target:number,charge:number,confirmedGreen:number[]){
  if(!Number.isFinite(target)||target<=0||target>25000||
    !Number.isFinite(charge)||charge<100||charge>500)return [];
  const already=confirmedGreen.reduce((n,g)=>n+g,0);
  const remaining=Math.max(0,target-already);
  const count=Math.ceil(remaining/charge);
  return Array.from({length:count},(_,i)=>Math.min(charge,remaining-i*charge));
}
