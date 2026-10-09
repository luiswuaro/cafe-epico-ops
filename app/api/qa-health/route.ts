import {and,eq,sql} from "drizzle-orm";
import {NextResponse} from "next/server";
import {getDb} from "@/src/infrastructure/db/client";
import {organizations,stores} from "@/src/infrastructure/db/schema";

export const dynamic="force-dynamic";
export async function GET(){
  if(process.env.OPS_QA_MODE!=="true"||process.env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa" ||
     process.env.DEFAULT_STORE_CODE!=="QA-TEPEXI"){
    return new NextResponse(null,{status:404});
  }
  const headers={"Cache-Control":"no-store, max-age=0","X-Robots-Tag":"noindex, nofollow"};
  try{
    const db=getDb();
    const [org]=await db.select({id:organizations.id}).from(organizations)
      .where(eq(organizations.slug,"cafe-epico-qa")).limit(1);
    if(!org)return NextResponse.json({mode:"qa",ready:false,missing:["organization"]},{status:503,headers});
    const [store]=await db.select({id:stores.id}).from(stores).where(and(
      eq(stores.organizationId,org.id),eq(stores.code,"QA-TEPEXI"))).limit(1);
    if(!store)return NextResponse.json({mode:"qa",ready:false,missing:["store"]},{status:503,headers});
    const [stats]=await db.select({
      activeEmployees:sql<number>`(select count(*)::int from employees e where e.organization_id=${org.id} and e.home_store_id=${store.id} and e.is_active)`,
      opening:sql<number>`(select count(*)::int from checklist_templates t where t.organization_id=${org.id} and t.store_id=${store.id} and t.shift_type='MORNING' and t.is_active)`,
      handoff:sql<number>`(select count(*)::int from checklist_templates t where t.organization_id=${org.id} and t.store_id=${store.id} and t.shift_type='HANDOFF' and t.is_active)`,
      items:sql<number>`(select count(*)::int from inventory_balances b where b.organization_id=${org.id} and b.store_id=${store.id})`,
      products:sql<number>`(select count(*)::int from pos_manual_products p where p.organization_id=${org.id} and p.is_active)`,
      cash:sql<number>`(select count(*)::int from pos_cash_sessions c where c.organization_id=${org.id} and c.store_id=${store.id} and c.status='OPEN')`,
    }).from(organizations).where(eq(organizations.id,org.id)).limit(1);
    const missing=[
      ...(stats.activeEmployees>=2?[]:["employees"]),
      ...(stats.opening>=1?[]:["opening_checklist"]),
      ...(stats.handoff>=1?[]:["handoff_checklist"]),
      ...(stats.items>0?[]:["inventory"]),
      ...(stats.products>0?[]:["catalog"]),
      ...(stats.cash===1?[]:["cash_session"]),
    ];
    return NextResponse.json({
      mode:"qa",ready:missing.length===0,checks:{
        employees:stats.activeEmployees>=2,
        opening:stats.opening>=1,handoff:stats.handoff>=1,
        inventory:stats.items>0,catalog:stats.products>0,cash:stats.cash===1,
      },...(missing.length?{missing}:{})
    },{status:missing.length?503:200,headers});
  }catch(error){
    console.error("OPS_QA_PREFLIGHT_FAILED",error);
    return NextResponse.json({mode:"qa",ready:false,missing:["database_preflight"]},{status:503,headers});
  }
}
