import assert from "node:assert/strict";
import {test} from "node:test";
import {once} from "node:events";
import {Script} from "node:vm";
import {createLanProbeServer,isPrivateLanIp} from "./lan-probe.mjs";

test("LAN probe serves public health without credentials or POS data",async()=>{
  const server=createLanProbeServer();
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=="string");
    const root="http://127.0.0.1:"+address.port;
    const html=await fetch(root+"/");
    assert.equal(html.status,200);
    assert.equal(html.headers.get("cache-control"),"no-store, private");
    assert.equal(html.headers.get("x-frame-options"),"DENY");
    const htmlPage=await html.text();
    assert.match(htmlPage,/CONEXIÓN LOCAL CONFIRMADA/);
    assert.match(htmlPage,/Medir estabilidad LAN/);
    assert.match(htmlPage,/src="\/client.js"/);
    assert.match(html.headers.get("content-security-policy"),/script-src 'self'/);
    const script=await fetch(root+"/client.js");
    assert.equal(script.status,200);
    assert.match(script.headers.get("content-type"),/application\/javascript/);
    const javascript=await script.text();
    assert.doesNotThrow(()=>new Script(javascript));
    assert.match(javascript,/12 respuestas/);
    assert.doesNotMatch(javascript,/https?:\/\/|supabase|vercel|DATABASE_URL/i);

    const health=await fetch(root+"/health");
    assert.equal(health.status,200);
    const body=await health.json();
    assert.equal(body.production,false);
    assert.equal(body.service,"cafe-epico-lan-probe");
    assert.equal(body.ok,true);
    assert.deepEqual(Object.keys(body).sort(),["ok","production","serverTime","service","uptimeSeconds"].sort());

    for(const route of ["/api/orders","/api/auth","/.env","/pos","/admin","/secret"]){
      const denied=await fetch(root+route);
      assert.equal(denied.status,404,route);
      assert.doesNotMatch(await denied.text(),/postgres|cookie|password|DATABASE_URL/i);
    }

    const post=await fetch(root+"/health",{method:"POST"});
    assert.equal(post.status,405);
    assert.equal(post.headers.get("allow"),"GET, HEAD");
    const head=await fetch(root+"/health",{method:"HEAD"});
    assert.equal(head.status,200);
    assert.equal(await head.text(),"");
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});

test("LAN probe does not read .env files, auth tokens or database libraries",async()=>{
  const fs=await import("node:fs");
  const js=fs.readFileSync("scripts/local/lan-probe.mjs","utf8");
  const ps=fs.readFileSync("scripts/local/test-lan.ps1","utf8");
  assert.doesNotMatch(js,/getDb\(|process\.env|DATABASE_URL|SUPABASE_|\bfs\.readFile|\bexec\(|\bspawn\(/);
  assert.match(js,/MAX_RUNTIME_MS=15\*60\*1000/);
  assert.match(js,/server\.listen\(port,bindHost/);
  assert.match(ps,/LocalAddress=\$ip/);
  assert.match(ps,/InterfaceAlias/);
  assert.match(ps,/RemoteAddress='LocalSubnet'/);
  assert.match(ps,/Remove-NetFirewallRule/);
  assert.match(ps,/\$ruleCreated/);
});

test("LAN probe only accepts private IPs and loopback default",()=>{
 for(const ip of ["192.168.1.5","10.0.4.6","172.16.3.8","172.31.255.254"])
   assert.equal(isPrivateLanIp(ip),true,ip);
 for(const ip of ["0.0.0.0","8.8.8.8","1.1.1.1","127.0.0.1",
   "169.254.1.1","172.32.0.1","192.0.2.3","::","hotel-wifi"])
   assert.equal(isPrivateLanIp(ip),false,ip);
});
