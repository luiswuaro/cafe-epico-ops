import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const tokens=read("src/application/pos/history-access.ts");
const actions=read("src/application/pos/history-access-actions.ts");
const tickets=read("app/(employee)/pos/tickets/page.tsx");
const cash=read("app/(employee)/pos/cash/history/page.tsx");
const receipt=read("app/(employee)/pos/receipt/[id]/page.tsx");
const owner=read("app/(admin)/admin/history-access/page.tsx");
const cashCurrent=read("app/(employee)/pos/cash/page.tsx");
const gate=read("app/(employee)/pos/history-lock.tsx");

for(const source of [tickets,cash,receipt]){
 assert.match(source,/await hasPosHistoryAccess\(employee\)/);
 assert.match(source,/HistoryLock/);
}
assert.ok(tickets.indexOf("await hasPosHistoryAccess(employee)")<tickets.indexOf("await getTicketHistory("),
 "La autorización debe ocurrir ANTES de leer el historial de tickets");
assert.ok(cash.indexOf("await hasPosHistoryAccess(employee)")<cash.indexOf("const sessions ="),
 "La autorización debe ocurrir ANTES de consultar las cajas");
assert.ok(receipt.includes("isHistoricalReceipt("));
assert.ok(tokens.includes("isHistoricalReceipt("));
assert.ok(cashCurrent.includes("state.lastClosed && canSeeHistory"));
assert.ok(owner.includes('requirePermission("admin.access")'));
assert.ok(tokens.includes('employeeHasPermission(employee.id,"admin.access"'));
assert.ok(tokens.includes('eq(auditEvents.actorEmployeeId,employee.id)'));
assert.ok(tokens.includes('eq(auditEvents.storeId,employee.homeStoreId)'));
assert.ok(tokens.includes("constantHexMatch"));
assert.ok(tokens.includes("http")===false||tokens.includes("HISTORY_COOKIE"));
assert.ok(actions.includes("randomInt(0,100_000_000)"));
assert.ok(actions.includes("scryptSync(code,salt,32)"));
assert.ok(actions.includes("POS_HISTORY_CODE_USED"));
assert.ok(actions.includes("POS_HISTORY_CODE_REJECTED"));
assert.ok(actions.includes("recentAttempts.length>=5"));
assert.ok(actions.includes('httpOnly:true'));
assert.ok(actions.includes('sameSite:"lax"'));
assert.ok(actions.includes('path:"/pos"'));
assert.ok(actions.includes("pg_advisory_xact_lock"));
assert.ok(gate.includes("unlockPosHistory"));
console.log("POS histories RBAC and temporary access: gate, audit, rate-limit, owner only, direct-link protection PASS");
