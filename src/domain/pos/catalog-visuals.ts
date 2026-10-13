/** Catálogo visual del POS.
 * Sólo clasifica y ordena los productos en pantalla; no toca precios, recetas ni inventario.
 */
export type VisualCategory = "CALIENTES" | "FRÍAS" | "ALIMENTOS";
export type VisualProduct = {name:string;category:VisualCategory};
export type VisualFamily =
  | "espresso" | "milk" | "chocolate" | "tea" | "botanical" | "signature"
  | "coffee" | "tonic" | "frappe" | "refresh"
  | "bread" | "dessert" | "savory" | "combo";

export const POS_VISUAL_CATEGORIES = [
  {key:"CALIENTES",label:"Calientes",symbol:"♨"},
  {key:"FRÍAS",label:"Frías",symbol:"❄"},
  {key:"ALIMENTOS",label:"Alimentos",symbol:"◈"},
] as const;

export const POS_VISUAL_FAMILIES: Record<VisualFamily,{label:string;symbol:string}> = {
  espresso:{label:"ESPRESSO",symbol:"☕"},
  milk:{label:"LECHE",symbol:"🥛"},
  chocolate:{label:"CHOCOLATE",symbol:"🍫"},
  tea:{label:"TÉ",symbol:"🍵"},
  botanical:{label:"BOTÁNICO",symbol:"🍃"},
  signature:{label:"FIRMA",symbol:"★"},
  coffee:{label:"CAFÉ FRÍO",symbol:"🧊"},
  tonic:{label:"TÓNICO",symbol:"✦"},
  frappe:{label:"FRAPPÉ",symbol:"❄"},
  refresh:{label:"SODA / ICEE",symbol:"🥤"},
  bread:{label:"PAN",symbol:"🥐"},
  dessert:{label:"POSTRE",symbol:"🍰"},
  savory:{label:"SALADO",symbol:"🥪"},
  combo:{label:"COMBO",symbol:"◈"},
};

export const POS_VISUAL_FAMILY_ORDER: Record<VisualCategory, readonly VisualFamily[]> = {
  CALIENTES:["espresso","milk","chocolate","tea","botanical","signature"],
  FRÍAS:["coffee","tonic","frappe","tea","chocolate","refresh","signature"],
  ALIMENTOS:["bread","dessert","savory","combo"],
};

export const normalizeVisualName = (value:string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s+/g," ").trim().toUpperCase();

export function posVisualFamily(product:VisualProduct):VisualFamily {
  const name=normalizeVisualName(product.name);
  if(product.category==="CALIENTES"){
    if(/^(ESPRESSO|AMERICANO|ESPRESSO CORTADO)$/.test(name))return "espresso";
    if(/CHOCOLATE/.test(name))return "chocolate";
    if(/CHAI|\bTE\b/.test(name))return "tea";
    if(/MATCHA|TARO/.test(name))return "botanical";
    if(/PUMPKIN|DIRTY HORCHATA|TEMPORADA|ESPECIAL/.test(name))return "signature";
    return "milk";
  }
  if(product.category==="FRÍAS"){
    if(/TONIC|TONICO/.test(name))return "tonic";
    if(/FRAPPE|FRAPPU/.test(name))return "frappe";
    if(/SODA|ICEE|SLUSH|REFRESHER/.test(name))return "refresh";
    if(/CHAI|MATCHA|TARO|\bTE\b/.test(name))return "tea";
    if(/CHOCOLATE/.test(name))return "chocolate";
    if(/DIRTY HORCHATA|PUMPKIN|ESPECIAL/.test(name))return "signature";
    return "coffee";
  }
  if(/PAN CON BEBIDA|COMBO|PAQUETE/.test(name))return "combo";
  if(/JAMON|SANDWICH|SALADO|BAGEL/.test(name))return "savory";
  if(/FLAN|CARLOTA|TARTA|CHEESECAKE|PASTEL|POSTRE/.test(name))return "dessert";
  return "bread";
}

const HOT_POSITION = [
  "AMERICANO","ESPRESSO","ESPRESSO CORTADO",
  "CAPUCCINO","LATTE","LATTE ESPANOL","FLAT WHITE","MOKA",
  "CHOCOLATE CALIENTE","CHAI MASALA","DIRTY CHAI CALIENTE",
  "MATCHA LATTE","TARO LATTE",
  "DIRTY HORCHATA","PUMPKIN SPICE LATTE CALIENTE",
] as const;
const hotPriority=new Map<string,number>(HOT_POSITION.map((name,index)=>[name,index]));
const categoryPriority:Record<VisualCategory,number>={CALIENTES:0,"FRÍAS":1,ALIMENTOS:2};

export function comparePosVisualProducts(a:VisualProduct,b:VisualProduct):number{
  const byCategory=categoryPriority[a.category]-categoryPriority[b.category];
  if(byCategory!==0)return byCategory;
  const familyOrder=POS_VISUAL_FAMILY_ORDER[a.category];
  const byFamily=familyOrder.indexOf(posVisualFamily(a))-familyOrder.indexOf(posVisualFamily(b));
  if(byFamily!==0)return byFamily;
  if(a.category==="CALIENTES"){
    const aRank=hotPriority.get(normalizeVisualName(a.name))??999;
    const bRank=hotPriority.get(normalizeVisualName(b.name))??999;
    if(aRank!==bRank)return aRank-bRank;
  }
  return a.name.localeCompare(b.name,"es",{sensitivity:"base"});
}
