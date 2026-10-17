import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectQaCompose } from "./inspect-qa-compose.mjs";

const loopback = (target) => ({ target, published: String(target), host_ip: "127.0.0.1", protocol: "tcp" });
const valid = () => ({
  services: {
    "api-gw": { ports: [loopback(8000)] },
    supavisor: { ports: [loopback(5432), loopback(6543)] },
    db: {},
    auth: {},
    studio: {},
  },
});

test("acepta sólo gateway y pooler QA por loopback", () => {
  assert.deepEqual(inspectQaCompose(valid()), {ok: true, errors: []});
});
test("acepta sólo loopback incluso cuando el puerto host 16543 difiere de 6543 interno", () => {
  const c=valid();c.services.supavisor.ports[1].published="16543";
  assert.equal(inspectQaCompose(c).ok,true);
  c.services.supavisor.ports[1].host_ip="0.0.0.0";
  assert.equal(inspectQaCompose(c).ok,false);
});
test("rechaza exposición pública de Auth/API", () => {
  const c=valid();c.services["api-gw"].ports[0].host_ip="0.0.0.0";
  assert.equal(inspectQaCompose(c).ok,false);
});
test("rechaza publicación sin host_ip explícito", () => {
  const c=valid();delete c.services.supavisor.ports[0].host_ip;
  assert.equal(inspectQaCompose(c).ok,false);
});
test("rechaza puertos publicados en cualquier servicio", () => {
  const c=valid();c.services.studio.ports=[{target:3000,published:"3000",host_ip:"::"}];
  assert.equal(inspectQaCompose(c).ok,false);
});
test("rechaza host networking", () => {
  const c=valid();c.services.auth.network_mode="host";
  assert.equal(inspectQaCompose(c).ok,false);
});
test("rechaza servicio faltante, puerto omitido y estructura inválida", () => {
  const c=valid();delete c.services.db; c.services.supavisor.ports.pop();
  assert.equal(inspectQaCompose(c).ok,false);
  assert.equal(inspectQaCompose({}).ok,false);
});
test("rechaza entradas no normalizadas", () => {
  const c=valid();c.services["api-gw"].ports=["8000:8000"];
  assert.equal(inspectQaCompose(c).ok,false);
});
