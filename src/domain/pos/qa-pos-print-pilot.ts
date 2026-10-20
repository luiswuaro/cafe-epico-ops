/**
 * Impresión POS QA: una sola comanda SHADOW autorizada POR SESIÓN.
 * Sin un identificador de sesión conserva el bloqueo piloto original.
 * Identificador inválido: el piloto queda deshabilitado (fail closed).
 */
export const QA_POS_PILOT_PREFIX="QA-POS-PILOT-";

export function qaPosPrintPilotSessionPrefix(env:NodeJS.ProcessEnv=process.env):string|null{
 const raw=env.OPS_QA_POS_PRINT_PILOT_RUN_ID?.trim()??"";
 if(!raw)return QA_POS_PILOT_PREFIX;
 if(!/^R[0-9]{8}[A-Z0-9]{2}$/.test(raw))return null;
 return QA_POS_PILOT_PREFIX+raw+"-";
}

export function qaPosPrintPilotEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.OPS_QA_POS_PRINT_PILOT==="true" &&
   env.OPS_LOCAL_FIRST==="true" &&
   env.OPS_QA_MODE==="true" &&
   env.POS_LIVE_ENABLED==="false" &&
   env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" &&
   env.DEFAULT_STORE_CODE==="QA-TEPEXI" &&
   qaPosPrintPilotSessionPrefix(env)!==null &&
   !env.VERCEL && !env.VERCEL_ENV;
}
