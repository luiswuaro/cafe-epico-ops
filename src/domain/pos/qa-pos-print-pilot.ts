/**
 * Permite varias comandas POS únicamente en la sesión QA seleccionada.
 * Sin límite explícito mantiene el comportamiento anterior (una orden).
 * No habilita LIVE ni ventas reales. Ante configuración inválida bloquea.
 */
export const QA_POS_PILOT_PREFIX="QA-POS-PILOT-";

export function qaPosPrintPilotSessionPrefix(env:NodeJS.ProcessEnv=process.env):string|null{
 const raw=env.OPS_QA_POS_PRINT_PILOT_RUN_ID?.trim()??"";
 if(!raw)return QA_POS_PILOT_PREFIX;
 if(!/^R[0-9]{8}[A-Z0-9]{2}$/.test(raw))return null;
 return QA_POS_PILOT_PREFIX+raw+"-";
}

/** Límite 1 por defecto; 2..10 solo con sesión explícita distinta. */
export function qaPosPrintPilotMaxOrders(env:NodeJS.ProcessEnv=process.env):number|null{
 const raw=env.OPS_QA_POS_PRINT_PILOT_MAX_ORDERS;
 if(raw===undefined||raw==="")return 1;
 if(!/^(?:[1-9]|10)$/.test(raw))return null;
 if(Number(raw)>1 && !env.OPS_QA_POS_PRINT_PILOT_RUN_ID?.trim())return null;
 return Number(raw);
}

export function qaPosPrintPilotEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.OPS_QA_POS_PRINT_PILOT==="true" &&
   env.OPS_LOCAL_FIRST==="true" &&
   env.OPS_QA_MODE==="true" &&
   env.POS_LIVE_ENABLED==="false" &&
   env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" &&
   env.DEFAULT_STORE_CODE==="QA-TEPEXI" &&
   qaPosPrintPilotSessionPrefix(env)!==null &&
   qaPosPrintPilotMaxOrders(env)!==null &&
   !env.VERCEL && !env.VERCEL_ENV;
}
