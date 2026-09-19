import pg from 'pg';
import {postgresOptions} from '../runtime/store.ts';
import {collectPolicies,CollectionError} from './graph.ts';
import {comparePolicies,type Policy} from './policies.ts';
export const monitoredTenant='a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2';
// Bootstrap operator supplied by the tenant owner. Optional setting replaces this list.
export function canMonitor(userId:string,env:NodeJS.ProcessEnv=process.env) {
  const operators=(env.CG_ENTRA_OPERATOR_IDS??'f749cd19-7e0c-4359-8c31-300ebea9655d').split(',').map(v=>v.trim()).filter(Boolean);
  return env.AZURE_TENANT_ID===monitoredTenant && operators.some(id=>userId===`${monitoredTenant}:${id}`);
}
let pool:pg.Pool;
export function monitorPool(){return pool??=new pg.Pool({...postgresOptions(),max:2});}
export async function history(db:pg.Pool=monitorPool()) {
  const {rows}=await db.query('SELECT id,actor,started,completed,status,error_code,message,baseline_id,jsonb_array_length(policies) AS policy_count,jsonb_array_length(findings) AS change_count FROM entra_scans WHERE tenant=$1 ORDER BY started DESC LIMIT 30',[monitoredTenant]);
  const baseline=await db.query("SELECT id,completed FROM entra_scans WHERE tenant=$1 AND status='succeeded' ORDER BY started LIMIT 1",[monitoredTenant]);
  return {tenant:monitoredTenant,scans:rows,baseline:baseline.rows[0]??null,mode:'manual',permission:'Policy.Read.All'};
}
export async function scan(actor:string,db:pg.Pool=monitorPool(),collect:()=>Promise<Policy[]>=collectPolicies) {
  const client=await db.connect();const id=crypto.randomUUID();let locked=false;
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock(72004202) AS locked')).rows[0].locked;
    if(!locked)throw new CollectionError('SCAN_BUSY','Another scan is running. Wait for it to finish.');
    // A running row can remain after process termination; advisory lock proves its worker is gone.
    await client.query("UPDATE entra_scans SET status='failed',completed=now(),error_code='INTERRUPTED',message='Scan interrupted; previous snapshot preserved.' WHERE tenant=$1 AND status='running'",[monitoredTenant]);
    const recent=await client.query("SELECT id FROM entra_scans WHERE tenant=$1 AND started > now()-interval '60 seconds' LIMIT 1",[monitoredTenant]);
    if(recent.rows.length)throw new CollectionError('SCAN_BUSY','Wait one minute between scans.');
    await client.query("INSERT INTO entra_scans (id,tenant,actor,status) VALUES ($1,$2,$3,'running')",[id,monitoredTenant,actor]);
    try {
      const policies=await collect();
      const previous=await client.query("SELECT id,policies FROM entra_scans WHERE tenant=$1 AND status='succeeded' ORDER BY started DESC LIMIT 1",[monitoredTenant]);
      const baseline=await client.query("SELECT id FROM entra_scans WHERE tenant=$1 AND status='succeeded' ORDER BY started LIMIT 1",[monitoredTenant]);
      const findings=previous.rows.length?comparePolicies(previous.rows[0].policies,policies):[];
      await client.query("UPDATE entra_scans SET status='succeeded',completed=now(),policies=$2,findings=$3,baseline_id=$4,message=$5 WHERE id=$1",[id,JSON.stringify(policies),JSON.stringify(findings),baseline.rows[0]?.id??id,previous.rows.length?'Compared with the previous successful scan.':'Initial baseline captured; no change alerts generated.']);
      return {id};
    }catch(error) {
      const safe=error instanceof CollectionError?error:new CollectionError('SCAN_FAILED','Collection failed or timed out. The previous successful snapshot is preserved.');
      await client.query("UPDATE entra_scans SET status='failed',completed=now(),error_code=$2,message=$3 WHERE id=$1",[id,safe.code,safe.message]);
      throw safe;
    }
  }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(72004202)');}finally{client.release();}}
}
