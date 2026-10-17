import http from "node:http";
import net from "node:net";
import {fileURLToPath} from "node:url";

const DIAGNOSTIC_CLIENT = [
  "(()=>{",
  "const button=document.querySelector('#measure');",
  "const result=document.querySelector('#result');",
  "button?.addEventListener('click',async()=>{",
  "  button.disabled=true;result.textContent='Midiendo LAN...';",
  "  const samples=[];let failures=0;",
  "  for(let i=0;i<12;i++){",
  "    const begin=performance.now();",
  "    try{",
  "      const controller=new AbortController();",
  "      const timer=setTimeout(()=>controller.abort(),2000);",
  "      try{",
  "        const response=await fetch('/health?sample='+i,{cache:'no-store',signal:controller.signal});",
  "        if(!response.ok)throw Error('HTTP error');",
  "        const value=await response.json();",
  "        if(value.service!=='cafe-epico-lan-probe'||value.production!==false)throw Error('Invalid probe');",
  "        samples.push(performance.now()-begin);",
  "      }finally{clearTimeout(timer);}",
  "    }catch{failures++;}",
  "    await new Promise(done=>setTimeout(done,140));",
  "  }",
  "  if(samples.length){",
  "    samples.sort((a,b)=>a-b);",
  "    const med=samples[Math.floor((samples.length-1)/2)];",
  "    const p95=samples[Math.ceil(samples.length*0.95)-1];",
  "    result.textContent='LAN local: '+samples.length+'/12 respuestas, '+failures+' fallos. Mediana '+Math.round(med)+' ms; p95 '+Math.round(p95)+' ms. Repetir con el segundo celular.';",
  "  }else{result.textContent='Ninguna respuesta local. Revisar Wi-Fi, firewall o aislamiento.';}",
  "  button.disabled=false;",
  "});",
  "})();"
].join("\\n");

const DEFAULT_PORT=47835;
const MAX_RUNTIME_MS=15*60*1000;

/**
 * Diagnóstico de conectividad LAN, expresamente separado del OPS.
 * - No abre PostgreSQL ni importa .env, usuarios o cookies.
 * - No ejecuta comandos ni admite escritura de datos.
 * - Sale automáticamente después de 15 minutos.
 * - Solo contesta GET/HEAD /, /health y /client.js. No existe endpoint de escritura.
 * No es una aplicación POS ni un proxy al POS.
 */
export function createLanProbeServer({now=()=>new Date()}={}){
  const boot=Date.now();
  return http.createServer((req,res)=>{
    res.setHeader("Cache-Control","no-store, private");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(req.method!=="GET"&&req.method!=="HEAD"){
      res.writeHead(405,{"Allow":"GET, HEAD","Content-Type":"text/plain; charset=utf-8"});
      return res.end(req.method==="HEAD"?"":"Método no permitido");
    }
    const path=(req.url||"").split("?")[0];
    if(path==="/client.js"){
      res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8"});
      return res.end(req.method==="HEAD"?"":DIAGNOSTIC_CLIENT);
    }
    if(path==="/health"){
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
      return res.end(req.method==="HEAD"?"":JSON.stringify({
        ok:true,service:"cafe-epico-lan-probe",
        serverTime:now().toISOString(),
        uptimeSeconds:Math.floor((Date.now()-boot)/1000),
        production:false,
      }));
    }
    if(path!=="/"){
      res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
      return res.end(req.method==="HEAD"?"":"Ruta inexistente");
    }
    const html=`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Café Épico · Diagnóstico LAN</title>
<style>body{font:16px system-ui,sans-serif;margin:0;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh}
section{border:1px solid #555;border-radius:16px;padding:28px;max-width:490px;margin:20px;background:#1a1a1a}
h1{font-size:24px}p{line-height:1.55}.ok{color:#80d9aa}.muted{color:#aaa;font-size:13px}</style></head>
<body><section><p class="ok">✓ CONEXIÓN LOCAL CONFIRMADA</p><h1>Café Épico · Prueba de red</h1>
<p>Este celular sí puede alcanzar la PC mediante el Wi-Fi. Podemos continuar con la instalación local de OPS.</p>
<p class="muted">Solo es un diagnóstico. Aquí no se registran ventas, no se almacenan datos de clientes ni se conecta a Supabase o Vercel.</p>
<p><button type="button" id="measure">Medir estabilidad LAN</button></p>
<p class="muted" id="result" aria-live="polite">La medición hace 12 solicitudes a esta misma PC; no sale a internet.</p>
<p class="muted">La prueba se apaga automáticamente después de 15 minutos.</p></section>
<script src="/client.js" defer></script></body></html>`;
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
    res.end(req.method==="HEAD"?"":html);
  });
}

export function isPrivateLanIp(host){
 if(net.isIP(host)!==4)return false;
 const [a,b]=host.split(".").map(Number);
 return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
const self=process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1];
if(self){
  const port=Number(process.argv[2]||DEFAULT_PORT);
  if(!Number.isSafeInteger(port)||port<1024||port>65535){
    console.error("Puerto inválido");process.exit(2);
  }
  const bindHost=process.argv[3]||"127.0.0.1";
  if(bindHost!=="127.0.0.1"&&!isPrivateLanIp(bindHost)){
    console.error("IP no privada o no válida; no se abrirá el puerto.");process.exit(2);
  }
  const server=createLanProbeServer();
  const timer=setTimeout(()=>{
    console.log("Prueba LAN finalizada automáticamente (15 minutos).");
    server.close(()=>process.exit(0));
  },MAX_RUNTIME_MS);
  timer.unref();
  server.on("error",error=>{console.error("No se pudo abrir el puerto:",error.message);process.exitCode=1});
  server.listen(port,bindHost,()=>{
    console.log("DIAGNÓSTICO, NO POS. Puerto "+port+" abierto en la PC por máximo 15 minutos.");
    console.log("Desde la PC: http://127.0.0.1:"+port+"/");
    console.log("Desde el celular: http://"+bindHost+":"+port+"/");
    console.log("Ctrl+C para detener inmediatamente.");
  });
}
