import {env} from 'cloudflare:workers';
export function controllerStore(){
 const db=(env as any).DB.withSession('first-primary');
 return {

  configure:async(code:string,mode:string,count:number)=>(await db.prepare("UPDATE controller_sessions SET mode=?,human_limit=? WHERE code=? AND phase='lobby' AND (SELECT COUNT(*) FROM controller_seats WHERE code=?)<=?").bind(mode,count,code,code,count).run()).meta.changes===1,
  start:async(code:string)=>(await db.prepare("UPDATE controller_sessions SET phase='playing',run_id=run_id+1 WHERE code=? AND phase='lobby' AND human_limit=(SELECT COUNT(*) FROM controller_seats WHERE code=?)").bind(code,code).run()).meta.changes===1,
  lobby:async(code:string)=>db.prepare("UPDATE controller_sessions SET phase='lobby' WHERE code=?").bind(code).run(),
  choose:async(code:string,token:string,character:string)=>(await db.prepare("UPDATE OR IGNORE controller_seats SET character=?,intent='{\"x\":0,\"y\":0,\"run\":false}',input_at=0 WHERE code=? AND token_hash=? AND EXISTS(SELECT 1 FROM controller_sessions WHERE code=? AND phase='lobby')").bind(character,code,token,code).run()).meta.changes===1,
  secret:()=> (env as any).HG_BRIDGE_SECRET,
  get:(code:string)=>db.prepare('SELECT * FROM controller_sessions WHERE code=?').bind(code).first(),
  list:async()=> (await db.prepare('SELECT code,heartbeat FROM controller_sessions WHERE expires_at>? AND heartbeat>? ORDER BY heartbeat DESC LIMIT 1').bind(Date.now(),Date.now()-10000).all()).results,
  create:(s:any)=>db.prepare('INSERT INTO controller_sessions(code,device,created_at,expires_at) VALUES(?,?,?,?)').bind(s.code,s.device,s.createdAt,s.expiresAt).run(),
  seats:async(code:string)=>(await db.prepare('SELECT * FROM controller_seats WHERE code=? ORDER BY rowid').bind(code).all()).results,
  claim:async(s:any)=>(await db.prepare("INSERT OR IGNORE INTO controller_seats(code,character,name,token_hash) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM controller_seats WHERE code=?)<(SELECT human_limit FROM controller_sessions WHERE code=? AND phase='lobby')").bind(s.code,s.character,s.name,s.tokenHash,s.code,s.code).run()).meta.changes===1,
  input:async(code:string,tokenHash:string,seq:number,intent:string,now:number)=>(await db.prepare('UPDATE controller_seats SET seq=?,intent=?,input_at=? WHERE code=? AND token_hash=? AND seq<?').bind(seq,intent,now,code,tokenHash,seq).run()).meta.changes===1,
  heartbeat:(code:string,telemetry:string,now:number)=>db.prepare('UPDATE controller_sessions SET heartbeat=?,telemetry=? WHERE code=?').bind(now,telemetry,code).run(),
  messages:async(code:string,runId:number,character:string,round:number)=>
   (await db.prepare('SELECT id,run_id,round,sender,recipient,preset,room_snapshot,status,created_at FROM controller_messages WHERE code=? AND run_id=? AND round>=? AND (sender=? OR recipient=?) ORDER BY id DESC LIMIT 12')
    .bind(code,runId,Math.max(1,round-1),character,character).all()).results,
  sendMessage:async(message:any)=>{
   try{
    const result=await db.prepare('INSERT INTO controller_messages(code,run_id,round,sender,recipient,preset,room_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?)')
     .bind(message.code,message.runId,message.round,message.sender,message.recipient,message.preset,message.room,message.createdAt).run();
    return Number(result.meta.last_row_id);
   }catch(error){if(String(error).includes('UNIQUE constraint failed'))return null;throw error;}
  },
  replyMessage:async(code:string,runId:number,id:number,recipient:string,status:string,round:number)=>
   (await db.prepare("UPDATE controller_messages SET status=? WHERE code=? AND run_id=? AND id=? AND recipient=? AND status='pending' AND round>=?")
    .bind(status,code,runId,id,recipient,Math.max(1,round-1)).run()).meta.changes===1,
 };
}
