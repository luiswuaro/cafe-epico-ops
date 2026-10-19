import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {createHash,timingSafeEqual} from "node:crypto";

// Test del contrato exacto del comparador sin cargar TypeScript en Node puro.
const file=readFileSync("src/domain/pos/local-print-agent-auth.ts","utf8");
test("el token está limitado, verificado con timingSafeEqual y SHA-256",()=>{
 assert.match(file,/secret\.length<32/);
 assert.match(file,/provided\?\.startsWith\("Bearer "\)/);
 assert.match(file,/timingSafeEqual\(a,b\)/);
 assert.match(file,/createHash\("sha256"\)/);
 const digest=v=>createHash("sha256").update(v).digest();
 const token="f".repeat(64),provided="f".repeat(64);
 assert.equal(timingSafeEqual(digest(token),digest(provided)),true);
 assert.equal(timingSafeEqual(digest(token),digest("x".repeat(64))),false);
});
