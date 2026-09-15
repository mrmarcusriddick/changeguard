import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/store";
import { ASSETS, collectMock, scoreEvidence, makePlan, type Evidence } from "@/lib/engine";
import { z } from "zod";
export const dynamic = "force-dynamic";
const input = z.discriminatedUnion("action",[
 z.object({action:z.literal("create"),title:z.string().trim().min(3).max(160),description:z.string().trim().min(3).max(4000),assetId:z.enum(["SERVER17","LAB02"])}).strict(),
 z.object({action:z.literal("analyze"),changeId:z.string().uuid()}).strict(),
 z.object({action:z.literal("plan"),changeId:z.string().uuid(),runId:z.string().uuid(),owner:z.string().trim().min(1).max(160),window:z.string().trim().min(1).max(160),constraints:z.string().max(4000)}).strict(),
]);
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request) {
 try {
 const user=await getChatGPTUser(); if(!user)return json({error:"Sign in to access saved changes."},401);
 const db=database(); const id=new URL(request.url).searchParams.get("changeId");
 if(!id) { const rows=await db.prepare("SELECT * FROM changes WHERE owner=? ORDER BY created DESC").bind(user.userId).all();return json({changes:rows.results,assets:ASSETS,user:user.displayName}); }
 const change=await db.prepare("SELECT * FROM changes WHERE id=? AND owner=?").bind(id,user.userId).first();if(!change)return json({error:"Change not found"},404);
 const [runs,plans,audit]=await db.batch([
 db.prepare("SELECT * FROM runs WHERE change_id=? ORDER BY created DESC, id DESC").bind(id),
 db.prepare("SELECT p.* FROM plans p JOIN runs r ON r.id=p.run_id WHERE r.change_id=? ORDER BY p.created DESC").bind(id),
 db.prepare("SELECT * FROM audit WHERE change_id=? ORDER BY created DESC").bind(id)]);
 const runRows=runs.results as {id:string;result:string}[];
 const evidence=runRows.length?await db.prepare("SELECT evidence FROM findings WHERE run_id=? ORDER BY id").bind(runRows[0].id).all<{evidence:string}>():{results:[]};
 return json({change,runs:runRows.map(r=>({...r,result:JSON.parse(r.result)})),findings:evidence.results.map(f=>JSON.parse(f.evidence)),plans:(plans.results as {id:string;run_id:string;created:string;document:string}[]).map(p=>({...p,document:JSON.parse(p.document)})),audit:audit.results});
 }catch(e){ console.error("Workspace read failed",e);return json({error:"Saved changes are unavailable. Please retry."},503); }
}
export async function POST(request:Request) {
 try {
 const user=await getChatGPTUser();if(!user)return json({error:"Sign in to save changes."},401);
 const origin=request.headers.get("origin");if(!origin||origin!==new URL(request.url).origin)return json({error:"Invalid request origin"},403);
 if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"JSON required"},415);
 const body=await request.text();if(body.length>12000)return json({error:"Request too large"},413);
 let parsed;try{parsed=input.safeParse(JSON.parse(body));}catch{return json({error:"Invalid JSON"},400);}
 if(!parsed.success)return json({error:"Check the required fields and try again."},400);
 const data=parsed.data;const db=database();const id=crypto.randomUUID();const created=new Date().toISOString();
 if(data.action==="create") {
 const asset=ASSETS.find(a=>a.id===data.assetId)!;
 await db.batch([db.prepare("INSERT OR IGNORE INTO assets (id,name,detail) VALUES (?,?,?)").bind(asset.id,asset.name,asset.detail),db.prepare("INSERT INTO changes (id,owner,asset_id,title,description,created) VALUES (?,?,?,?,?,?)").bind(id,user.userId,asset.id,data.title,data.description,created),db.prepare("INSERT INTO audit (id,change_id,actor,action,created) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(),id,user.userId,"Change created",created)]);
 return json({id},201);
 }
 const change=await db.prepare("SELECT * FROM changes WHERE id=? AND owner=?").bind(data.changeId,user.userId).first<{id:string;asset_id:string}>();if(!change)return json({error:"Change not found"},404);
 if(data.action==="analyze") {
 const evidence=collectMock(change.asset_id);const result={...scoreEvidence(evidence),mode:"mock",collectedAt:created,assetId:change.asset_id};
 await db.batch([db.prepare("INSERT INTO runs (id,change_id,created,result) VALUES (?,?,?,?)").bind(id,change.id,created,JSON.stringify(result)),...evidence.map(f=>db.prepare("INSERT INTO findings (id,run_id,evidence) VALUES (?,?,?)").bind(`${id}:${f.key}`,id,JSON.stringify(f))),db.prepare("INSERT INTO audit (id,change_id,actor,action,created) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(),change.id,user.userId,`Mock analysis recorded: ${id}`,created)]);
 return json({id},201);
 }
 const run=await db.prepare("SELECT id FROM runs WHERE id=? AND change_id=?").bind(data.runId,change.id).first();if(!run)return json({error:"Analysis run not found"},404);
 const rows=await db.prepare("SELECT evidence FROM findings WHERE run_id=? ORDER BY id").bind(data.runId).all<{evidence:string}>();
 const plan=makePlan(change.asset_id,rows.results.map(r=>JSON.parse(r.evidence) as Evidence),data.owner,data.window,data.constraints);
 await db.batch([db.prepare("INSERT INTO plans (id,run_id,created,document) VALUES (?,?,?,?)").bind(id,data.runId,created,JSON.stringify(plan)),db.prepare("INSERT INTO audit (id,change_id,actor,action,created) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(),change.id,user.userId,`Draft plan generated from run ${data.runId}`,created)]);
 return json({id},201);
 }catch(e){console.error("Workspace write failed",e);return json({error:"Could not save. Your input is retained; check saved history before retrying."},503);}
}
