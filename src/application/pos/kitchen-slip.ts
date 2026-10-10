/** Comanda de preparación; deliberadamente NO contiene dinero, pagos ni puntos. */
export type KitchenLine = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  note: string | null;
  serviceMode: string | null;
  roundId: string | null;
};

export type KitchenSlip = {
  folio: string;
  table: string;
  customerName?: string | null;
  orderNote: string | null;
  lines: KitchenLine[];
};

/**
 * Entrega de pedidos: la etiqueta escrita en el ticket manda sobre
 * la cuenta de puntos. Si no hay ninguna, el folio corto identifica
 * el pedido sin inventar un nombre ni imprimir datos personales.
 */
export function kitchenOrderIdentity(input:{
  ticketLabel:string|null|undefined;
  customerName:string|null|undefined;
  folio:string;
}):{table:string;customerName:string|null}{
  const label=input.ticketLabel?.trim()||"";
  const customer=input.customerName?.trim()||"";
  const table=label||customer||"PEDIDO "+input.folio.slice(-6);
  const extraCustomer=customer&&label&&
    customer.toLocaleLowerCase("es")!==label.toLocaleLowerCase("es")
    ?customer:null;
  return {table,customerName:extraCustomer};
}

export const kitchenCategoryLabel=(category:string)=>category==="CALIENTES"
  ?"CALIENTES":category==="FRÍAS"||category==="FRIAS"?"FRÍAS":"ALIMENTOS";

export function kitchenRounds(lines:KitchenLine[]) {
  const ids=[...new Set(lines.map(line=>line.roundId||"INITIAL"))];
  return ids.map((id,index)=>({id,label:index===0?"PRIMER PEDIDO":"RONDA "+(index+1)}));
}

export function selectedKitchenSlip(slip:KitchenSlip,selection:"latest"|"all") {
  const rounds=kitchenRounds(slip.lines);
  const last=rounds[rounds.length-1];
  const filtered=selection==="latest"&&last
    ?slip.lines.filter(line=>(line.roundId||"INITIAL")===last.id)
    :slip.lines;
  // Agrupar solamente cantidades con idéntica receta/temperatura/nota.
  // No agrupar bebidas con notas diferentes.
  const grouped=new Map<string,KitchenLine>();
  for(const line of filtered){
    const key=JSON.stringify([line.category,line.name,line.note||"",line.serviceMode||""]);
    const previous=grouped.get(key);
    if(previous)previous.quantity+=line.quantity;
    else grouped.set(key,{...line});
  }
  const rows=[...grouped.values()].sort((a,b)=>{
    const priority=(value:string)=>value==="CALIENTES"?0:value==="FRÍAS"||value==="FRIAS"?1:2;
    return priority(a.category)-priority(b.category);
  });
  return {
    ...slip,
    lines:rows,
    roundLabel:selection==="all"?"COMANDA COMPLETA":last?.label??"PRIMER PEDIDO",
    roundsCount:rounds.length,
  };
}
