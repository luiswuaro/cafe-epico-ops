import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {test} from "node:test";

test("los archivos copiados por el ZIP bastan para ejecutar el validador", () => {
  const repo = resolve(import.meta.dirname, "../..");
  const boot = readFileSync(join(repo, "scripts/local/Aplicar-Guardian-DesdeZIP.ps1"), "utf8");
  const files = [...boot.matchAll(/^\s*'((?:scripts|docs)\/[^']+)'[,]?\s*$/gm)].map(match => match[1]);
  assert.ok(files.includes("scripts/local/validate-live-guardian.mjs"));
  assert.ok(files.includes("scripts/local/Corregir-Inicio-OPS-LIVE.ps1"));
  assert.ok(files.includes("scripts/local/print-guardian-task-policy.ps1"));
  assert.ok(files.includes("scripts/local/print-guardian-task-policy.windows.test.ps1"));
  assert.equal(files.length, 9, "el manifiesto de copiado debe listar los 9 archivos del instalador");
  const minimal = mkdtempSync(join(tmpdir(), "epico-guardian-minimal-"));
  try {
    for (const path of files) {
      const source = join(repo, path);
      assert.ok(existsSync(source), `No existe el archivo incluido ${path}`);
      const target = join(minimal, path);
      mkdirSync(dirname(target), {recursive: true});
      copyFileSync(source, target);
    }
    const cleanEnv = {...process.env};
    delete cleanEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["scripts/local/validate-live-guardian.mjs"], {
      cwd: minimal, encoding: "utf8", timeout: 15000, env: cleanEnv,
    });
    assert.equal(result.status, 0,
      `Validación sobre un repositorio con solo archivos del ZIP falló:\n${result.stderr}`);
  } finally {
    rmSync(minimal, {recursive: true, force: true});
  }
});
