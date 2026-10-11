/** Packaging grouped per takeaway ORDER, not each product recipe.
 * Hojaldra capacity: 3 / bag. Jamón/queso croissant: 1 / bag.
 */
export type PackagingLine={name:string;category:string;serviceMode:string;quantity:number};
const norm=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/\s+/g," ").trim();
export function classifyPaperBagProduct(line:PackagingLine){
  if(line.serviceMode!=="TAKEAWAY"||norm(line.category)!=="ALIMENTOS")return null;
  const name=norm(line.name);
  if(name.includes("HOJALDRA"))return "HOJALDRA" as const;
  if(name.includes("CROISSANT")&&
    (name.includes("JAMON")||name.includes("QUESO")))return "CROISSANT_JAMON" as const;
  return null;
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
