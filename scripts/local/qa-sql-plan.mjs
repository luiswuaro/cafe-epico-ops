import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";

export function migrationPlan(directory){
  return readdirSync(directory).filter(name=>/^\d{4}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort().map(name=>{
      const content=readFileSync(join(directory,name),"utf8");
      return {name,content,sha256:createHash("sha256").update(content).digest("hex")};
    });
}
export function qaSeed(source) {
  if (!source.includes("'cafe-epico'") || !source.includes("'TEPEXI'"))
    throw new Error("El seed cambió; se requiere revisar su estructura antes de crear QA.");
  const content=source
    .replaceAll("'cafe-epico'","'cafe-epico-qa'")
    .replaceAll("'TEPEXI'","'QA-TEPEXI'")
    .replaceAll("'Café Épico Tepexi'","'Café Épico QA Tepexi'")
    .replaceAll("'Café Épico'","'Café Épico QA'");
  if (content.includes("'cafe-epico'") || content.includes("'TEPEXI'"))
    throw new Error("Quedaron referencias a la organización comercial en el seed QA.");
  return content;
}
export function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}
