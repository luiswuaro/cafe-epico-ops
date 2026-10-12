/** Datos de fidelización del comprobante, derivados SOLO del libro de movimientos.
 * Las cuentas divididas utilizan su etiqueta en la nota de acreditación.
 * Un cliente asociado no implica automáticamente puntos ganados.
 */
export type ReceiptEarnRow={
  customerId:string;name:string;balance:string|number|null;
  points:string|number;note:string|null;
};
export function receiptLoyaltyView(input:{
 entries:readonly ReceiptEarnRow[];
 splitLabel?:string|null;
 fallbackCustomer?:string|null;
 fallbackBalance?:number|string|null;
 cancelled?:boolean;
}){
 const rows=input.splitLabel
  ?input.entries.filter(row=>row.note?.startsWith(input.splitLabel+" · "))
  :[...input.entries];
 const recipients=new Set(rows.map(row=>row.customerId));
 const sole=recipients.size===1?rows[0]:null;
 const earned=rows.reduce((sum,row)=>sum+Number(row.points),0);
 const customer=sole?.name??(recipients.size>1?"Varios clientes":
   input.splitLabel?null:input.fallbackCustomer??null);
 const balance=sole?.balance??(!input.splitLabel?input.fallbackBalance:null);
 return {
  customer,
  pointsEarned:!input.cancelled&&rows.length&&Number.isFinite(earned)?
    earned.toFixed(2):null,
  pointsBalance:!input.cancelled&&balance!==null&&balance!==undefined&&
    Number.isFinite(Number(balance))?Number(balance).toFixed(2):null,
 };
}
