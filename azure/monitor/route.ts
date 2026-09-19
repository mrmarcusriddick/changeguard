import {getChatGPTUser} from '@/app/chatgpt-auth';
import {canMonitor,history,scan,monitorPool,monitoredTenant} from './service.ts';
import {CollectionError} from './graph.ts';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Sign in to access Entra monitoring.'},401);
  if(!canMonitor(user.userId))return json({error:'Your account is not an Entra monitoring operator.'},403);
  try {
    const id=new URL(request.url).searchParams.get('scanId');
    if(!id)return json(await history());
    if(!/^[a-f0-9-]{36}$/i.test(id))return json({error:'Invalid scan ID.'},400);
    const result=await monitorPool().query('SELECT * FROM entra_scans WHERE tenant=$1 AND id=$2',[monitoredTenant,id]);
    return result.rows.length?json(result.rows[0]):json({error:'Scan not found.'},404);
  }catch{return json({error:'Monitoring history is unavailable. Retry shortly.'},503);}
}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Sign in to scan.'},401);
  if(!canMonitor(user.userId))return json({error:'Your account is not an Entra monitoring operator.'},403);
  if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return json({error:'Invalid request origin.'},403);
  if(request.headers.get('content-type')!=='application/json')return json({error:'JSON required.'},415);
  const body=await request.text();if(body.length>100)return json({error:'Request too large.'},413);
  try{if(JSON.stringify(JSON.parse(body))!=='{"action":"scan"}')return json({error:'Invalid action.'},400);}catch{return json({error:'Invalid JSON.'},400);}
  try{return json(await scan(user.userId),201);}catch(error){
    if(error instanceof CollectionError)return json({error:error.message,code:error.code},error.code==='SCAN_BUSY'?409:503);
    return json({error:'Scan could not complete. Check history before retrying.'},503);
  }
}
