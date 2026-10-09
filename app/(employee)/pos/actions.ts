"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import { cancelLiveOrder } from "@/src/application/pos/live-cancellation";
import { checkoutLiveOrder, isPosLiveEnabled } from "@/src/application/pos/live";
import { getPosReadiness } from "@/src/application/pos/readiness";
import { getOpenCashSession } from "@/src/application/pos/cash";
import { syncLoyverseReceipts } from "@/src/application/loyverse/sync";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission, employeeHasPermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCashMovements,
  posCashSessions,
  posCustomers,
  posOrderLines,
  posOrderSplits,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

const cartSchema = z
  .array(
    z.object({
      externalId: z.string().min(1),
      quantity: z.number().int().min(1).max(20),
      note: z.string().trim().max(180).nullable().optional(),
      serviceMode: z.enum(["DINE_IN","TAKEAWAY"]).optional(),
    }),
  )
  .min(1)
  .max(30);

const serviceModeSchema = z.enum(["DINE_IN", "TAKEAWAY"]);
const paymentSchema = z.enum(["CASH", "CARD", "TRANSFER"]);
const commandStatusSchema = z.enum(["SENT", "PREPARING", "READY"]);

function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function folio(date: Date, clientOrderId: string) {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\D/g, "");
  return "SH-" + stamp + "-" + clientOrderId.slice(-4).toUpperCase();
}

async function buildOrderInput(
  formData: FormData,
  organizationId: string,
  mode:"SHADOW"|"LIVE"="SHADOW",
) {
  const rawCart = String(formData.get("cart") ?? "[]");
  const serviceMode = serviceModeSchema.parse(
    String(formData.get("serviceMode") ?? ""),
  );
  const tableLabel = String(formData.get("tableLabel") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const customerId = String(formData.get("customerId") ?? "").trim() || null;

  const parsedCart = cartSchema.parse(JSON.parse(rawCart));
  const catalog = await getPosCatalog(organizationId);
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  const lines = parsedCart.map((line) => {
    const item = catalogById.get(line.externalId);
    if (!item) throw new Error("Producto no disponible en el catálogo POS");

    const lineTotal = item.price * line.quantity;
    const lineMode = line.serviceMode ?? serviceMode;
    const serviceRecipe = item.serviceRecipes[lineMode as PosServiceMode];

    return {
      item,
      quantity: line.quantity,
      note: line.note?.trim() || null,
      lineMode,
      lineTotal,
      expectedConsumption: {
        mode,
        serviceMode: lineMode,
        sourceRecipeExternalId: serviceRecipe.externalId,
        sourceCategory: serviceRecipe.sourceCategory,
        components: serviceRecipe.components.map((component) => ({
          variantExternalId: component.variantExternalId,
          itemExternalId: component.itemExternalId,
          name: component.name,
          quantity: component.quantity * line.quantity,
          unitLabel: component.unitLabel,
          category: component.category,
        })),
      },
    };
  });

  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  if (customerId) {
    const [customer] = await getDb()
      .select({ id: posCustomers.id })
      .from(posCustomers)
      .where(
        and(
          eq(posCustomers.id, customerId),
          eq(posCustomers.organizationId, organizationId),
          eq(posCustomers.isActive, true),
        ),
      )
      .limit(1);

    if (!customer) throw new Error("Cliente no válido");
  }

  return {
    serviceMode:lines.some(line=>line.lineMode==="DINE_IN")?"DINE_IN" as const:"TAKEAWAY" as const,
    tableLabel,
    note,
    customerId,
    lines,
    total,
    loyaltyPointsPreview: customerId
      ? Math.round(total * 0.05 * 100) / 100
      : 0,
  };
}

async function createShadowOrder(
  formData: FormData,
  status: "PAID" | "SENT",
  paymentMethod?: "CASH" | "CARD" | "TRANSFER",
  orderMode:"SHADOW"|"LIVE"="SHADOW",
) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  if(orderMode==="LIVE" && !isPosLiveEnabled()) {
    throw new Error("Comandas LIVE deshabilitadas.");
  }
  const input = await buildOrderInput(formData, employee.organizationId, orderMode);
  if(orderMode==="LIVE"){
    if(!input.tableLabel){
      throw new Error("Ponle un nombre al ticket guardado (por ejemplo Mesa 1 o Balcón 2).");
    }
    const pilot=process.env.POS_LIVE_PILOT_ITEM?.trim().toLocaleUpperCase("es-MX");
    if(pilot && input.lines.some(line=>line.item.name.toLocaleUpperCase("es-MX")!==pilot)){
      throw new Error("Piloto limitado a "+pilot);
    }
    // No enviar comandas que sabemos que no podrán cobrarse.
    const readiness=await getPosReadiness(employee.organizationId,employee.homeStoreId);
    const byId=new Map(readiness.products.map(p=>[p.id,p]));
    for(const line of input.lines){
      const state=byId.get(line.item.id)?.recipes.find(r=>r.mode===line.lineMode);
      if(!state?.ready) throw new Error("Comanda bloqueada: "+line.item.name+" — "+
        (state?.errors.join("; ")||"receta incompleta"));
    }
  }
  const rawClientOrderId = String(formData.get("clientOrderId") ?? "").trim();
  const clientOrderId = rawClientOrderId || randomUUID();
  const now = new Date();
  const db = getDb();

  const [existing] = await db
    .select({ id: posOrders.id })
    .from(posOrders)
    .where(
      and(
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.clientOrderId, clientOrderId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const cashSession =
    status === "PAID" && paymentMethod === "CASH"
      ? await getOpenCashSession(
          employee.organizationId,
          employee.homeStoreId,
        )
      : null;

  if (status === "PAID" && paymentMethod === "CASH" && !cashSession) {
    throw new Error("Abre la caja antes de cobrar en efectivo");
  }

  const order = await db.transaction(async (tx) => {
    if(orderMode==="LIVE"&&status==="SENT"){
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
      const [duplicateTable]=await tx.select({id:posOrders.id})
        .from(posOrders).where(and(
          eq(posOrders.organizationId,employee.organizationId),
          eq(posOrders.storeId,employee.homeStoreId!),
          eq(posOrders.mode,"LIVE"),
          sql`${posOrders.status} in ('SENT','PREPARING','READY','PARTIALLY_PAID')`,
          sql`lower(trim(${posOrders.tableLabel})) = lower(trim(${input.tableLabel}))`
        )).limit(1);
      if(duplicateTable)throw new Error("Ya existe un ticket guardado con ese nombre. Reabre esa mesa desde Tickets guardados.");
    }
    const [created] = await tx
      .insert(posOrders)
      .values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId!,
        clientOrderId,
        folio: folio(now, clientOrderId),
        mode: orderMode,
        status,
        serviceMode: input.serviceMode,
        tableLabel: input.tableLabel,
        employeeId: employee.id,
        customerId: input.customerId,
        businessDate: businessDate(now),
        subtotal: input.total.toFixed(2),
        total: input.total.toFixed(2),
        note: input.note,
        loyaltyPointsPreview: input.loyaltyPointsPreview.toFixed(2),
        loyaltyEffectApplied: false,
        inventoryEffectApplied: false,
        paidAt: status === "PAID" ? now : null,
      })
      .returning();

    await tx.insert(posOrderLines).values(
      input.lines.map((line) => ({
        organizationId: employee.organizationId,
        orderId: created.id,
        catalogExternalId: line.item.id,
        variantExternalId: line.item.variantExternalId,
        nameSnapshot: line.item.name,
        categorySnapshot: line.item.category,
        unitPrice: line.item.price.toFixed(2),
        quantity: String(line.quantity),
        lineTotal: line.lineTotal.toFixed(2),
        note: line.note,
        expectedConsumption: line.expectedConsumption,
      })),
    );

    if (status === "PAID" && paymentMethod) {
      await tx.insert(posPayments).values({
        organizationId: employee.organizationId,
        orderId: created.id,
        method: paymentMethod,
        amount: input.total.toFixed(2),
      });

      if (paymentMethod === "CASH" && cashSession) {
        await tx.insert(posCashMovements).values({
          organizationId: employee.organizationId,
          storeId: employee.homeStoreId!,
          sessionId: cashSession.id,
          orderId: created.id,
          employeeId: employee.id,
          movementType: "SALE",
          amount: input.total.toFixed(2),
          note: created.folio,
        });
      }
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action:
        status === "PAID"
          ? "POS_SHADOW_SALE_RECORDED"
          : orderMode==="LIVE" ? "POS_LIVE_COMMAND_SENT" : "POS_SHADOW_COMMAND_SENT",
      entityType: "pos_order",
      entityId: created.id,
      afterData: {
        folio: created.folio,
        total: input.total,
        serviceMode: input.serviceMode,
        customerId: input.customerId,
        loyaltyPointsPreview: input.loyaltyPointsPreview,
        status,
        inventoryEffectApplied: false,
        loyaltyEffectApplied: false,
      },
    });

    return created;
  });

  return order.id;
}

export async function createShadowSale(formData: FormData) {
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const orderId = await createShadowOrder(
    formData,
    "PAID",
    paymentMethod,
  );
  redirect("/pos?saved=" + orderId);
}

export async function createShadowCommand(formData: FormData) {
  const orderId = await createShadowOrder(formData, "SENT");
  redirect("/pos/orders?created=" + orderId);
}

export async function createLiveCommand(formData:FormData) {
  let orderId:string;
  try{
    orderId=await createShadowOrder(formData,"SENT",undefined,"LIVE");
  }catch(error){
    const message=error instanceof Error?error.message:"No se pudo registrar la comanda.";
    redirect("/pos?error="+encodeURIComponent(message.slice(0,260)));
  }
  redirect("/pos/orders?created="+orderId);
}

export async function payLiveCommand(formData:FormData) {
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  if(!isPosLiveEnabled())throw new Error("POS LIVE deshabilitado.");
  const orderId=z.string().uuid().parse(String(formData.get("orderId")??""));
  const paymentMethod=paymentSchema.parse(String(formData.get("paymentMethod")??""));
  const tenderedRaw=String(formData.get("tenderedAmount")??"").trim();
  const tenderedAmount=paymentMethod==="CASH" && tenderedRaw!==""?Number(tenderedRaw):null;
  const db=getDb();
  const [order,lines]=await Promise.all([
    db.select().from(posOrders).where(and(
      eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,employee.homeStoreId))).limit(1).then(rows=>rows[0]),
    db.select().from(posOrderLines).where(eq(posOrderLines.orderId,orderId)),
  ]);
  if(!order || order.mode!=="LIVE")throw new Error("Comanda LIVE no encontrada.");
  if(order.status==="PAID")redirect("/pos/receipt/"+order.id);
  if(!["SENT","PREPARING","READY"].includes(order.status))
    throw new Error("Comanda ya no disponible para cobro.");
  if(!lines.length)throw new Error("Comanda sin productos.");
  let result:{id:string;alreadyRecorded:boolean};
  try{
    const allowStockShortage=formData.get("allowStockShortage")==="on";
    if(allowStockShortage){
      const allowed=await employeeHasPermission(employee.id,"inventory.adjust",employee.homeStoreId);
      if(!allowed)throw new Error("Sólo el propietario puede autorizar cobro con diferencia de inventario.");
    }
    result=await checkoutLiveOrder({
    organizationId:employee.organizationId,storeId:employee.homeStoreId,
    actorUserId:user.id,employeeId:employee.id,
    existingOrderId:order.id,clientOrderId:order.clientOrderId,
    cart:lines.map(line=>({
      externalId:line.catalogExternalId,
      quantity:Number(line.quantity),note:line.note,
      serviceMode:line.expectedConsumption?.serviceMode==="TAKEAWAY"?"TAKEAWAY":"DINE_IN",
    })),
    customerId:order.customerId,
    serviceMode:order.serviceMode as PosServiceMode,
    paymentMethod,tenderedAmount,
    tableLabel:order.tableLabel,note:order.note,
    allowStockShortage,
    });
  }catch(error){
    const message=error instanceof Error?error.message:"No se pudo cobrar la comanda.";
    redirect("/pos/checkout?ticket="+orderId+"&error="+encodeURIComponent(message.slice(0,330)));
  }
  redirect("/pos/receipt/"+result.id);
}

export async function updateCommandStatus(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const status = commandStatusSchema.parse(
    String(formData.get("status") ?? ""),
  );
  const db = getDb();

  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Comanda no encontrada");
  if (!["SENT", "PREPARING", "READY"].includes(order.status)) {
    throw new Error("La comanda ya no está abierta");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [current]=await tx.select().from(posOrders).where(and(
      eq(posOrders.id,order.id),eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,employee.homeStoreId!),
    )).for("update").limit(1);
    if(!current || !["SENT","PREPARING","READY"].includes(current.status))
      throw new Error("La comanda cambió y ya no admite cambios de preparación.");
    if(current.status===status)return;
    await tx.update(posOrders)
      .set({status,updatedAt:new Date()})
      .where(and(eq(posOrders.id,current.id),eq(posOrders.status,current.status)));
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_COMMAND_STATUS_CHANGED",entityType:"pos_order",entityId:current.id,
      beforeData:{status:current.status},afterData:{status},
    });
  });

  revalidatePath("/pos/orders");
}

export async function payShadowCommand(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const db = getDb();

  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Comanda no encontrada");
  if(order.mode!=="SHADOW")throw new Error("Usa Cobrar LIVE para esta comanda.");
  if (!["SENT", "PREPARING", "READY"].includes(order.status)) {
    redirect("/pos?saved=" + order.id);
  }

  const [existingSplit] = await db
    .select({ id: posOrderSplits.id })
    .from(posOrderSplits)
    .where(eq(posOrderSplits.orderId, order.id))
    .limit(1);

  if (existingSplit) {
    redirect("/pos/orders/" + order.id + "/split");
  }

  const cashSession =
    paymentMethod === "CASH"
      ? await getOpenCashSession(
          employee.organizationId,
          employee.homeStoreId,
        )
      : null;

  if (paymentMethod === "CASH" && !cashSession) {
    throw new Error("Abre la caja antes de cobrar en efectivo");
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(posOrders)
      .set({
        status: "PAID",
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(posOrders.id, order.id));

    await tx.insert(posPayments).values({
      organizationId: employee.organizationId,
      orderId: order.id,
      method: paymentMethod,
      amount: order.total,
    });

    if (paymentMethod === "CASH" && cashSession) {
      await tx.insert(posCashMovements).values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId!,
        sessionId: cashSession.id,
        orderId: order.id,
        employeeId: employee.id,
        movementType: "SALE",
        amount: order.total,
        note: order.folio,
      });
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_SHADOW_COMMAND_PAID",
      entityType: "pos_order",
      entityId: order.id,
      beforeData: { status: order.status },
      afterData: {
        status: "PAID",
        paymentMethod,
        loyaltyPointsPreview: order.loyaltyPointsPreview,
        loyaltyEffectApplied: false,
      },
    });
  });

  redirect("/pos?saved=" + order.id);
}

export async function createPosCustomer(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  if (name.length < 2) throw new Error("Escribe el nombre del cliente");

  const db = getDb();
  const [customer] = await db
    .insert(posCustomers)
    .values({
      organizationId: employee.organizationId,
      name,
      phone,
      email,
      pointsBalance: "0",
    })
    .returning({ id: posCustomers.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_CUSTOMER_CREATED",
    entityType: "pos_customer",
    entityId: customer.id,
    afterData: { name, phone, email, pointsBalance: 0 },
  });

  redirect("/pos?customer=" + customer.id);
}

export async function cancelPosOrder(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.cancel",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!orderId) throw new Error("Falta la orden a cancelar");
  if (reason.length < 3) throw new Error("Escribe el motivo de cancelación");

  const db = getDb();
  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Orden no encontrada");
  if (order.mode === "LIVE" && order.status !== "CANCELLED") {
    if(order.status==="PAID" || order.status==="PARTIALLY_PAID"){
      await cancelLiveOrder({
        organizationId:employee.organizationId,
        storeId:employee.homeStoreId,orderId:order.id,
        employeeId:employee.id,actorUserId:user.id,reason,
      });
      redirect("/pos/receipt/" + order.id);
    }
    if(!["SENT","PREPARING","READY"].includes(order.status))
      throw new Error("No se puede cancelar esta comanda en su estado actual.");
    await db.transaction(async tx=>{
      const [updated]=await tx.update(posOrders).set({
        status:"CANCELLED",cancelledAt:new Date(),
        cancelledByEmployeeId:employee.id,cancelReason:reason,updatedAt:new Date(),
      }).where(and(eq(posOrders.id,order.id),eq(posOrders.status,order.status)))
        .returning({id:posOrders.id});
      if(!updated)throw new Error("La comanda cambió de estado. Recarga y revisa.");
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_LIVE_OPEN_COMMAND_CANCELLED",
        entityType:"pos_order",entityId:order.id,
        beforeData:{status:order.status},
        afterData:{status:"CANCELLED",reason,hadPayment:false,inventoryApplied:false},
      });
    });
    redirect("/pos/receipt/"+order.id);
  }
  if (order.status === "CANCELLED") {
    redirect("/pos?saved=" + order.id);
  }
  if (order.inventoryEffectApplied || order.loyaltyEffectApplied) {
    throw new Error(
      "Esta venta ya tiene efectos aplicados y requiere una reversa administrativa.",
    );
  }

  const [paidSplit] = await db
    .select({ id: posOrderSplits.id })
    .from(posOrderSplits)
    .where(
      and(
        eq(posOrderSplits.orderId, order.id),
        eq(posOrderSplits.status, "PAID"),
      ),
    )
    .limit(1);

  if (paidSplit) {
    throw new Error(
      "Esta orden tiene cuentas divididas ya pagadas. La reversa parcial requiere flujo administrativo.",
    );
  }

  const cashSales = await db
    .select()
    .from(posCashMovements)
    .where(
      and(
        eq(posCashMovements.orderId, order.id),
        eq(posCashMovements.movementType, "SALE"),
      ),
    );

  if (cashSales.length > 0) {
    const [cashSession] = await db
      .select()
      .from(posCashSessions)
      .where(eq(posCashSessions.id, cashSales[0].sessionId))
      .limit(1);

    if (!cashSession || cashSession.status !== "OPEN") {
      throw new Error(
        "Este cobro en efectivo pertenece a una caja ya cerrada. No se puede cancelar sin una reversa administrativa.",
      );
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(posOrders)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByEmployeeId: employee.id,
        cancelReason: reason,
        updatedAt: now,
      })
      .where(eq(posOrders.id, order.id));

    if (cashSales.length > 0) {
      await tx.insert(posCashMovements).values(
        cashSales.map((movement) => ({
          organizationId: employee.organizationId,
          storeId: employee.homeStoreId!,
          sessionId: movement.sessionId,
          orderId: order.id,
          employeeId: employee.id,
          movementType: "REFUND",
          amount: (-Number(movement.amount)).toFixed(2),
          note: "Cancelación · " + order.folio,
        })),
      );
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_ORDER_CANCELLED",
      entityType: "pos_order",
      entityId: order.id,
      beforeData: { status: order.status },
      afterData: {
        status: "CANCELLED",
        reason,
        inventoryEffectApplied: order.inventoryEffectApplied,
        loyaltyEffectApplied: order.loyaltyEffectApplied,
      },
    });
  });

  redirect("/pos?saved=" + order.id + "&cancelled=1");
}

export async function refreshShadowMirror(formData: FormData) {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.mirror.read",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) throw new Error("Falta la orden a comparar");

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await syncLoyverseReceipts(since);

  redirect("/pos?saved=" + orderId + "&synced=1");
}
