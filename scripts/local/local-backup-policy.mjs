import {resolve,sep} from "node:path";

/** Prevents accidental cloud dumps, plaintext repository artifacts or demo keys. */
export function assessLocalBackup(env,repoRoot){
  const errors=[];
  if(env.OPS_LOCAL_FIRST!=="true"||env.VERCEL||env.VERCEL_ENV)
    errors.push("El respaldo sólo funciona en el servidor local de OPS.");
  const source=env.OPS_BACKUP_DATABASE_URL??env.DATABASE_URL;
  let db=null;
  try{db=new URL(source)}catch{errors.push("Falta URL PostgreSQL local válida.");}
  if(db){
    if(!["postgres:","postgresql:"].includes(db.protocol)||
       !["localhost","127.0.0.1","::1"].includes(db.hostname))
      errors.push("Solo se permite PostgreSQL en loopback.");
    if(db.pathname!=="/postgres")errors.push("La base debe ser postgres local.");
  }
  if(!/^age1[a-z0-9]{30,}$/.test(env.OPS_BACKUP_AGE_RECIPIENT??""))
    errors.push("Falta destinatario de cifrado age público válido.");
  let target="";
  if(typeof env.OPS_BACKUP_DESTINATION!=="string" || !env.OPS_BACKUP_DESTINATION.trim()){
    errors.push("Falta carpeta de respaldo privada.");
  }else{
    target=resolve(env.OPS_BACKUP_DESTINATION);
    const root=resolve(repoRoot);
    if(target===root||target.startsWith(root+sep))
      errors.push("El respaldo no debe guardarse dentro del repositorio.");
  }
  return {ok:errors.length===0,errors,target,db};
}
