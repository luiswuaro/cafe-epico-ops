/** Packaging grouped per takeaway ORDER, not each product recipe.
 * Hojaldra capacity: 3 / bag. Jamón/queso croissant: 1 / bag.
 */
export type PackagingLine={name:string;category:string;serviceMode:string;quantity:number};
const norm=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/\s+/g," ").trim();
/** Accepts the inventory label used in Café Épico and the longer label,
 * but not unrelated bags, ensuring there is exactly one match per organization.
 */
export function isPaperBagInventoryItem(item:{
 name:string;unit:string;trackingType:string;
}){
 const label=norm(item.name);
 return (label==="BOLSA PAPEL"||label==="BOLSA DE PAPEL")&&
   item.unit==="pz"&&item.trackingType==="QUANTITY";
}
export function classifyPaperBagProduct(line:PackagingLine){
  if(line.serviceMode!=="TAKEAWAY"||norm(line.category)!=="ALIMENTOS")return null;
  const name=norm(line.name);
  if(name.includes("HOJALDRA")||name==="PAN SOLO")return "HOJALDRA" as const;
  if(name.includes("CROISSANT")&&
    (name.includes("JAMON")||name.includes("QUESO")))return "CROISSANT_JAMON" as const;
  return null;
}
/** Cortesía entregada manualmente: la cantidad no se deduce automáticamente
 * de la cantidad de bebidas ni se cobra. Se contabiliza en piezas enteras.
 */
export function validateFreeCupCarriers(value:number,hasTakeawayDrink:boolean){
 if(!Number.isInteger(value)||value<0||value>10)
   throw new Error("Portavasos de cuatro espacios: selecciona de 0 a 10 piezas.");
 if(value>0&&!hasTakeawayDrink)
   throw new Error("Solo se pueden entregar portavasos con bebidas para llevar.");
 return value;
}
export function isFourCupCarrierInventoryItem(item:{
 name:string;unit:string;trackingType:string;
}){
 const name=norm(item.name);
 return ["PORTAVASOS 4","PORTAVASOS 4 VASOS","PORTAVASOS 4 ESPACIOS",
   "CHAROLA PORTAVASOS 4","CHAROLA DE 4","CHAROLA DE 4 VASOS","PORTAVASOS DE 4"].includes(name)&&
   item.unit==="pz"&&item.trackingType==="QUANTITY";
}
export function calculatePaperBagPlan(lines:PackagingLine[]){
 let hojaldras=0,croissants=0;
 for(const line of lines){
  if(!Number.isInteger(line.quantity)||line.quantity<0)throw new Error("Cantidad de alimento inválida.");
  const group=classifyPaperBagProduct(line);
  if(group==="HOJALDRA")hojaldras+=line.quantity;
  if(group==="CROISSANT_JAMON")croissants+=line.quantity;
 }
 const hojaldraBags=Math.ceil(hojaldras/3);
 const bags=hojaldraBags+croissants;
 return {hojaldras,croissants,hojaldraBags,croissantBags:croissants,bags};
}
/** Repartir cuentas divididas nunca vuelve a descontar bolsas ya calculadas. */
export function incrementalPaperBags(previous:PackagingLine[],paidNow:PackagingLine[]){
 const before=calculatePaperBagPlan(previous).bags;
 const after=calculatePaperBagPlan([...previous,...paidNow]).bags;
 return Math.max(0,after-before);
}
