import {normalizeOperationalRecipeName} from "@/src/domain/recipes/operational";

type Historical={name:string;category:string;components:Array<{
  sourceName:string;displayQuantity:number;displayUnit:string;isComposite:boolean;isDisposable:boolean;
}>};
type Current={name:string;category:string;serviceRecipes:Record<"DINE_IN"|"TAKEAWAY",{
  ingredients:Array<{name:string;quantity:number;unit:string}>;
}>};
const unit=(s:string)=>{
  const v=normalizeOperationalRecipeName(s);
  if(["GRAMOS","GRAMO","GR","G"].includes(v))return "g";
  if(["ML","MILILITROS","MILILITRO"].includes(v))return "ml";
  if(["PZ","PIEZAS","PIEZA","U.","UNIDAD"].includes(v))return "pz";
  return v;
};
export type RecipeDifference={
  product:string;ingredient:string;historical:number;live:number;unit:string;
  serviceMode:"DINE_IN"|"TAKEAWAY";
};
export function compareHistoricalToOps(historical:Historical[],current:Current[]){
  const currentByKey=new Map(current.map(row=>[
    row.category+"|"+normalizeOperationalRecipeName(row.name),row,
  ]));
  const differences:RecipeDifference[]=[];
  let compared=0,productsMatched=0,notComparable=0;
  for(const old of historical){
    const key=old.category+"|"+normalizeOperationalRecipeName(old.name);
    const now=currentByKey.get(key);
    if(!now)continue;
    productsMatched++;
    for(const oldPart of old.components){
      if(oldPart.isComposite||oldPart.isDisposable)continue;
      if(!Number.isFinite(oldPart.displayQuantity)||oldPart.displayQuantity<=0)continue;
      for(const mode of ["DINE_IN","TAKEAWAY"] as const){
        const matches=now.serviceRecipes[mode].ingredients.filter(part=>
          normalizeOperationalRecipeName(part.name)===
          normalizeOperationalRecipeName(oldPart.sourceName));
        if(matches.length!==1||unit(matches[0].unit)!==unit(oldPart.displayUnit)){
          notComparable++;
          continue;
        }
        compared++;
        if(Math.abs(matches[0].quantity-oldPart.displayQuantity)>0.001)
          differences.push({product:now.name,ingredient:matches[0].name,
            historical:oldPart.displayQuantity,live:matches[0].quantity,
            unit:unit(matches[0].unit),serviceMode:mode});
      }
    }
  }
  return {differences,compared,productsMatched,notComparable};
}
