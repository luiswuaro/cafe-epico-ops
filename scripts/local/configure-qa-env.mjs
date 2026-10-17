/**
 * Enlaza Supabase autoalojado QA con la copia local de Café Épico OPS.
 * Sólo toca los DOS .env ignorados por Git; nunca imprime valores secretos.
 * Uso desde la raíz del repositorio QA:
 *   node scripts/local/configure-qa-env.mjs --ip 192.168.0.172
 */
import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import net from "node:net";
import {pathToFileURL} from "node:url";
import {inspectQaSecrets,parseEnv} from "./inspect-qa-secrets.mjs";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const source=join(root,".local","supabase-qa",".env");
const dest=join(root,".env.local");
const example=join(root,".env.local-first.example");
const originPort=8443;
const tenant="cafe-epico-qa";

function isLanIp(ip){
 if(net.isIP(ip)!==4)return false;
 const x=ip.split(".").map(Number);
 return (x[0]===192&&x[1]===168)||(x[0]===10)||
   (x[0]===172&&x[1]>=16&&x[1]<=31);
}
function setEnv(input,key,value){
 const lines=input.replace(/\r\n/g,"\n").split("\n");
 const regex=new RegExp("^\\s*"+key+"=");
 let seen=false;
 const out=lines.map(line=>{
   if(!regex.test(line))return line;
   if(seen)throw Error("Clave duplicada en archivo QA: "+key);
   seen=true;return key+"="+value;
 });
 if(!seen)out.push(key+"="+value);
 return out.join("\n");
}
export function prepareQaEnv({stackText,appTemplate,ip,caPath}){
 if(!isLanIp(ip))throw Error("IP privada inválida: use la IP LAN real de la PC.");
 const current=parseEnv(stackText);
 const important=["POSTGRES_PASSWORD","JWT_SECRET","ANON_KEY","SERVICE_ROLE_KEY",
   "SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","JWT_KEYS","JWT_JWKS"];
 for(const key of important){
   if(!current[key]||/reemplazar|^your-|^fake_|^change.me/i.test(current[key]))
     throw Error("Falta la clave generada de QA: "+key);
 }
 if(!/^[a-f0-9]{32,}$/i.test(current.POSTGRES_PASSWORD))
   throw Error("Contraseña de PostgreSQL QA no parece generada por el instalador.");
 if(!current.SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_"))
   throw Error("Falta la clave publicable oficial de Auth QA.");
 const origin="https://"+ip+":"+originPort;
 let stack=stackText;
 const config={
  COMPOSE_FILE:"docker-compose.yml",POOLER_TENANT_ID:tenant,
  SUPABASE_PUBLIC_URL:origin,API_EXTERNAL_URL:origin+"/auth/v1",
  SITE_URL:origin,ADDITIONAL_REDIRECT_URLS:origin,
  DISABLE_SIGNUP:"true",ENABLE_EMAIL_SIGNUP:"false",
  ENABLE_PHONE_SIGNUP:"false",ENABLE_ANONYMOUS_USERS:"false",
 };
 for(const [key,value] of Object.entries(config))stack=setEnv(stack,key,value);
 let app=appTemplate;
 const ca=caPath??"C:/RUTA-PRIVADA-DEL-EQUIPO/Caddy/root.crt";
 const appConfig={
  OPS_LOCAL_FIRST:"true",OPS_QA_MODE:"true",POS_LIVE_ENABLED:"false",
  DEFAULT_ORGANIZATION_SLUG:tenant,DEFAULT_STORE_CODE:"QA-TEPEXI",
  DATABASE_URL:"postgresql://postgres."+tenant+":"+
    encodeURIComponent(current.POSTGRES_PASSWORD)+"@127.0.0.1:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL:origin,APP_ORIGIN:origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:current.SUPABASE_PUBLISHABLE_KEY,
  OPS_LOCAL_CA_FILE:ca.replaceAll("\\","/"),
 };
 for(const [key,value] of Object.entries(appConfig))app=setEnv(app,key,value);
 const verify=inspectQaSecrets(parseEnv(app),parseEnv(stack));
 if(!verify.ok)throw Error("Validador de secretos QA: "+verify.errors.join("; "));
 const guard=validateLocalQaConfig(parseEnv(app));
 if(!guard.ok)throw Error("Bloqueo local QA: "+guard.errors.join("; "));
 return {stack,app,origin};
}
function main(){
 const argv=process.argv.slice(2);
 if(argv.length!==2||argv[0]!=="--ip")throw Error("Uso: node scripts/local/configure-qa-env.mjs --ip 192.168.0.172");
 const ip=argv[1];
 if(existsSync(dest))throw Error(".env.local ya existe: no sobrescribir claves ni datos existentes.");
 if(!existsSync(source)||!existsSync(example))throw Error("Faltan .env de Supabase QA o plantilla del OPS.");
 if(!existsSync(join(root,".local","supabase-qa",".supabase-version")))
   throw Error("Supabase QA no fue preparado con el bootstrap aislado.");
 const appData=process.env.APPDATA;
 const caPath=appData?
   join(appData,"Caddy","pki","authorities","local","root.crt"):null;
 const prepared=prepareQaEnv({
   stackText:readFileSync(source,"utf8"),
   appTemplate:readFileSync(example,"utf8"),
   ip,caPath,
 });
 // Se escribe primero a archivos exclusivos nuevos. El .env existente sólo
 // se reemplaza después de que ambos pasan el guard. Ningún secreto a stdout.
 const newStack=source+".configure-"+randomUUID()+".tmp";
 let appCreated=false;
 try{
  writeFileSync(dest,prepared.app,{encoding:"utf8",flag:"wx",mode:0o600});
  appCreated=true;
  writeFileSync(newStack,prepared.stack,{encoding:"utf8",flag:"wx",mode:0o600});
  renameSync(newStack,source);
 }catch{
   if(existsSync(newStack))unlinkSync(newStack);
   if(appCreated&&existsSync(dest))unlinkSync(dest);
   throw Error("No se pudieron guardar archivos locales de QA.");
 }
 console.log("PASS: Supabase y OPS QA enlazados a "+prepared.origin);
 console.log("PASS: .env.local creado y claves sincronizadas sin mostrarlas.");
 console.log("PENDIENTE: instalar Caddy, verificar la CA pública, comprobar Docker Compose y crear usuario Auth QA.");
 console.log("NO iniciar todavía el POS ni importar datos comerciales.");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main()}catch(error){
  const safe=String(error?.message??"Error de configuración");
  console.error("BLOQUEADO: "+safe.slice(0,220));process.exitCode=2;
 }
}
