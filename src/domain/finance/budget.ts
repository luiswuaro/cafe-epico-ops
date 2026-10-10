/** Editable operating scenario. This is not the accounting ledger or a tax return. */
export type FinancialExpense = {
  id:string;
  name:string;
  amount:string;
  recurrence:"MONTHLY"|"ONE_OFF";
  classification:"FIXED"|"VARIABLE";
  month:string;
  status:"ESTIMATED"|"PAID";
};
export type FinancialBudgetPayload={
  expenses:FinancialExpense[];
  variableRatio:number;
  cardRate:number;
};
export type FinancialBudgetSnapshot=FinancialBudgetPayload&{
  revision:number;
  updatedAt:string;
};

export const defaultExpenses:FinancialExpense[]=[
  {id:"nomina",name:"Nómina estructural",amount:"8000",recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"renta",name:"Renta del local",amount:"4000",recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"electricidad",name:"Electricidad",amount:"700",recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"internet",name:"Internet",amount:"500",recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"contadora",name:"Honorarios contables",amount:"1000",recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
];

const money=(value:unknown)=>{
  if(typeof value!=="string" && typeof value!=="number")return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=100_000_000
    ?Math.round((n+Number.EPSILON)*100)/100 : null;
};
export function normalizeBudget(input:unknown):FinancialBudgetPayload|null {
  if(!input||typeof input!=="object"||Array.isArray(input))return null;
  const src=input as Record<string,unknown>;
  if(!Array.isArray(src.expenses)||src.expenses.length>100||
    !Number.isFinite(src.variableRatio)||Number(src.variableRatio)<10||Number(src.variableRatio)>75||
    !Number.isFinite(src.cardRate)||Number(src.cardRate)<0||Number(src.cardRate)>30)return null;
  const expenses:FinancialExpense[]=[];
  const ids=new Set<string>();
  for(const candidate of src.expenses){
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return null;
    const v=candidate as Record<string,unknown>;
    const id=typeof v.id==="string"?v.id.trim():"";
    const name=typeof v.name==="string"?v.name.trim():"";
    const amount=money(v.amount);
    const rec=v.recurrence,classification=v.classification,status=v.status;
    const month=v.month;
    if(!id||id.length>110||ids.has(id)||!name||name.length>100||
      amount===null||!["MONTHLY","ONE_OFF"].includes(String(rec))||
      !["FIXED","VARIABLE"].includes(String(classification))||
      !["ESTIMATED","PAID"].includes(String(status))||
      typeof month!=="string"||!(month===""||/^\d{4}-(0[1-9]|1[0-2])$/.test(month))||
      (rec==="ONE_OFF"&&!month))return null;
    ids.add(id);
    expenses.push({id,name,amount:amount.toFixed(2),
      recurrence:rec as FinancialExpense["recurrence"],
      classification:classification as FinancialExpense["classification"],
      month,status:status as FinancialExpense["status"]});
  }
  return {expenses,variableRatio:Number(src.variableRatio),cardRate:Number(src.cardRate)};
}
