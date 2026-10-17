import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page=readFileSync("app/qa/pos-preview/page.tsx","utf8");
const client=readFileSync("app/qa/pos-preview/preview-client.tsx","utf8");
const css=readFileSync("app/qa/pos-preview/preview.css","utf8");

test("QA preview is completely unavailable in commercial or cloud deployment",()=>{
 for(const guard of [
  'process.env.OPS_LOCAL_FIRST==="true"',
  'process.env.OPS_QA_MODE==="true"',
  'process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa"',
  'process.env.POS_LIVE_ENABLED!=="true"',
  'process.env.VERCEL!=="1"',
  '!process.env.VERCEL_ENV',
  'if(!allow)notFound()',
 ])assert.ok(page.includes(guard),"Falta guard obligatorio: "+guard);
 assert.match(page,/dynamic\s*=\s*"force-dynamic"/);
 assert.match(page,/robots:\s*\{index:false,follow:false\}/);
});

test("browser mock is local-only: no networking, persistence, server actions or financial mutations",()=>{
 assert.match(client,/"use client"/);
 assert.match(client,/SIMULACIÓN LOCAL QA/);
 for(const forbidden of [
   /from\s+["'][^"']*\/infrastructure\/(?:db|auth)/,
   /from\s+["'][^"']*\/application\/pos\/live/,
   /from\s+["'][^"']*\/pos\/actions/,
   /(?:window\.)?fetch\s*\(/,
   /(?:localStorage|sessionStorage|indexedDB|navigator\.sendBeacon)/,
   /\b(?:axios|XMLHttpRequest|WebSocket|EventSource)\b/,
   /use server/,
   /form\s+action=/,
   /\bprocess\.env\./,
 ])assert.doesNotMatch(client,forbidden,"Vista QA no debe contactar API ni persistir ventas");
 assert.match(client,/setSettlements/);
 assert.match(client,/customerPoints/);
 assert.match(client,/Math\.round\(paid\*5\)\/100/);
});

test("UI is responsive and has no external CSS, image or font fetch",()=>{
 assert.match(css,/@media\(max-width:850px\)/);
 assert.match(css,/@media\(max-width:620px\)/);
 assert.doesNotMatch(css,/@import|url\s*\(/i);
 assert.match(client,/aria-label="Buscar producto"/);
 assert.match(client,/Guardar comanda de prueba/);
 assert.match(client,/Simular cobro/);
});
