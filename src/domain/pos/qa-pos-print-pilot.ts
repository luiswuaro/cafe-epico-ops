/**
 * Opt-in de impresión desde el POS en QA: solo la primera orden SHADOW
 * emitida tras la activación. La autorización no existe en producción.
 */
export const QA_POS_PILOT_PREFIX="QA-POS-PILOT-";

export function qaPosPrintPilotEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.OPS_QA_POS_PRINT_PILOT==="true" &&
   env.OPS_LOCAL_FIRST==="true" &&
   env.OPS_QA_MODE==="true" &&
   env.POS_LIVE_ENABLED==="false" &&
   env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" &&
   env.DEFAULT_STORE_CODE==="QA-TEPEXI" &&
   !env.VERCEL && !env.VERCEL_ENV;
}
