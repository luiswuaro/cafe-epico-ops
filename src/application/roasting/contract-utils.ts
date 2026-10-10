/** Shared, browser-safe contract roasting unit calculations. No DB imports. */
export type ContractDefect = {
  type:string;severity:"PRIMARY"|"SECONDARY"|"OTHER";count:number;grams:number;
};
export const defectTypes = [
  "Negro completo","Negro parcial","Agrio completo","Agrio parcial",
  "Inmaduro","Brocado severo","Brocado leve","Concha","Quebrado",
  "Cáscara/pergamino","Materia extraña","Quaker (post-tueste)","Otro",
] as const;
export const mass = (value:string|number|null|undefined):number =>
  value==null?0:Number(value);
export const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function inspectDefects(sampleG:number|null,defects:ContractDefect[]){
  const totalG=round2(defects.reduce((sum,d)=>sum+d.grams,0));
  const counts=defects.reduce((sum,d)=>sum+d.count,0);
  return {measured:sampleG!=null&&sampleG>0,totalG,counts,
    percentage:sampleG&&sampleG>0?round2(totalG/sampleG*100):null};
}
