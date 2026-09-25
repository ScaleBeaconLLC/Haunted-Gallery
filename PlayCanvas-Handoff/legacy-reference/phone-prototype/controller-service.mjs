import {HttpError,hash,randomToken} from './event-service.mjs';
import {CONTROLLER_ROSTER} from './controller-roster.mjs';
const fail=(s,c)=>{throw new HttpError(s,c)};
const settings=s=>({mode:s.mode||'multiplayer',humanCount:s.human_limit||12,phase:s.phase||'lobby',runId:s.run_id||0});
const SOS_PRESETS=new Set(['come_get_me','found_camera','exit_blocked']);
const KNOWN_ROOMS=new Set(['entrance','hall','gallery','library','exit','portrait','sculpture','archive','conservation','study','sealed','mirrors']);
export class ControllerService{
 constructor(store,clock=Date.now){this.store=store;this.clock=clock;}
 async session(code){if(!/^[A-Z2-9]{8}$/.test(code||''))fail(404,'SESSION_NOT_FOUND');const s=await this.store.get(code);if(!s||s.expires_at<=this.clock())fail(404,'SESSION_NOT_FOUND');return s;}
 async device(key){const expected=this.store.secret();if(!key||!expected||await hash(key)!==await hash(expected))fail(403,'BRIDGE_REQUIRED');return hash(key);}
 async create(key){const device=await this.device(key),createdAt=this.clock(),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b%alphabet.length]).join('');await this.store.create({code,device,createdAt,expiresAt:createdAt+86400000});return {code};}
 async identity(code,token,host=false){const session=await this.session(code),seats=await this.store.seats(code),tokenHash=token?await hash(token):null,self=seats.find(s=>s.token_hash===tokenHash);if(!self)fail(403,'PLAYER_REQUIRED');if(host&&seats[0]?.token_hash!==tokenHash)fail(403,'HOST_REQUIRED');return {session,seats,self,tokenHash};}
 bots(session,seats){return settings(session).phase==='playing'?CONTROLLER_ROSTER.filter(c=>!seats.some(s=>s.character===c.id)).slice(0,12-seats.length).map(c=>({character:c.id,name:c.name,index:c.index,kind:'cpu'})):[];}
 async read(code,token){const session=await this.session(code),seats=await this.store.seats(code),tokenHash=token?await hash(token):null,self=seats.find(s=>s.token_hash===tokenHash),now=this.clock();let telemetry={};try{telemetry=JSON.parse(session.telemetry);}catch{}
  const living=telemetry.mode==='survival-hunt'?CONTROLLER_ROSTER.filter(c=>telemetry.hunt?.views?.[c.id]?.role==='survivor').map(c=>c.id):[];
  if(telemetry.mode==='survival-hunt')telemetry={mode:telemetry.mode,ready:telemetry.ready,actors:self?telemetry.actors.filter(a=>a.character===self.character):[],hunt:self?telemetry.hunt?.views?.[self.character]||null:null};
  const privateView=self&&settings(session).phase==='playing'&&telemetry.hunt?.role==='survivor';
  const messages=privateView?(await this.store.messages(code,settings(session).runId,self.character,telemetry.hunt.round)).filter(m=>living.includes(m.sender)):[];
  return {code,serverNow:now,hostOnline:now-session.heartbeat<5000,hostLastSeen:session.heartbeat,settings:settings(session),hostName:seats[0]?.name||null,roster:CONTROLLER_ROSTER.map(c=>({...c,taken:seats.some(s=>s.character===c.id)})),self:self?{character:self.character,name:self.name,seq:self.seq,isHost:seats[0]?.token_hash===tokenHash}:null,unreal:telemetry,playerCount:seats.length,players:seats.map(s=>({character:s.character,name:s.name})),cpus:this.bots(session,seats),living,messages};
 }
 async claim(code,input,token){const session=await this.session(code),tokenHash=token?await hash(token):null,seats=await this.store.seats(code);if(tokenHash&&seats.some(s=>s.token_hash===tokenHash))return {token:null,snapshot:await this.read(code,token)};
  if(settings(session).phase!=='lobby')fail(409,'MATCH_STARTED');if(seats.length>=settings(session).humanCount)fail(409,'LOBBY_FULL');
  if(!CONTROLLER_ROSTER.some(c=>c.id===input.character))fail(400,'CHOOSE_CHARACTER');
  const name=typeof input.name==='string'?input.name.trim().slice(0,32):'';if(name.length<2)fail(400,'NAME_REQUIRED');
  const fresh=token||randomToken();if(!await this.store.claim({code,character:input.character,name,tokenHash:await hash(fresh)}))fail(409,'CHARACTER_TAKEN');
  return {token:fresh,snapshot:await this.read(code,fresh)};
 }
 async choose(code,token,input){const {session,tokenHash}=await this.identity(code,token);if(settings(session).phase!=='lobby')fail(409,'MATCH_STARTED');if(!CONTROLLER_ROSTER.some(c=>c.id===input.character))fail(400,'CHOOSE_CHARACTER');if(!await this.store.choose(code,tokenHash,input.character))fail(409,'CHARACTER_TAKEN');return this.read(code,token);}
 async configure(code,token,input){const {session}=await this.identity(code,token,true);if(settings(session).phase!=='lobby')fail(409,'MATCH_STARTED');if(!['solo','multiplayer'].includes(input.mode)||!Number.isInteger(input.humanCount)||input.humanCount<1||input.humanCount>12||(input.mode==='solo'&&input.humanCount!==1)||(input.mode==='multiplayer'&&input.humanCount<2))fail(400,'INVALID_MODE');if(!await this.store.configure(code,input.mode,input.humanCount))fail(409,'TOO_MANY_PLAYERS');return this.read(code,token);}
 async start(code,token){const {session}=await this.identity(code,token,true);if(settings(session).phase==='playing')return this.read(code,token);if(this.clock()-session.heartbeat>5000)fail(409,'UNREAL_OFFLINE');let telemetry={};try{telemetry=JSON.parse(session.telemetry)}catch{}if(!telemetry.ready)fail(409,'UNREAL_NOT_READY');if(!await this.store.start(code))fail(409,'WAITING_FOR_PLAYERS');return this.read(code,token);}
 async lobby(code,token){await this.identity(code,token,true);await this.store.lobby(code);return this.read(code,token);}
 async input(code,token,body){const {session,tokenHash}=await this.identity(code,token);
  if(JSON.parse(session.telemetry||'{}').mode==='survival-hunt')fail(409,'USE_ROOM_CHOICES');
  if(Object.keys(body).some(k=>!['seq','x','y','run'].includes(k))||!Number.isSafeInteger(body.seq)||body.seq<1||!Number.isFinite(body.x)||!Number.isFinite(body.y)||Math.abs(body.x)>1||Math.abs(body.y)>1||typeof body.run!=='boolean')fail(400,'INVALID_INPUT');
  const length=Math.hypot(body.x,body.y),scale=Math.max(1,length),intent=settings(session).phase==='playing'?{x:body.x/scale,y:body.y/scale,run:body.run}:{x:0,y:0,run:false};
  const accepted=await this.store.input(code,tokenHash,body.seq,JSON.stringify(intent),this.clock());return {accepted,seq:body.seq};
 }
 async decision(code,token,body){const {session,tokenHash}=await this.identity(code,token);
  if(Object.keys(body).some(k=>!['seq','runId','action','room'].includes(k))||!Number.isSafeInteger(body.seq)||body.seq<1||body.runId!==settings(session).runId||!['room','photo'].includes(body.action)||(body.action==='room'&&!KNOWN_ROOMS.has(body.room)))fail(400,'INVALID_DECISION');
  if(settings(session).phase!=='playing')fail(409,'MATCH_NOT_STARTED');
  const state=JSON.parse(session.telemetry||'{}');if(state.mode!=='survival-hunt'||!state.ready||this.clock()-session.heartbeat>5000)fail(409,'UNREAL_NOT_READY');
  return {accepted:await this.store.input(code,tokenHash,body.seq,JSON.stringify({action:body.action,room:body.action==='room'?body.room:null,runId:body.runId}),this.clock()),seq:body.seq};
 }
 async help(code,token,body){
  const {session,self,seats}=await this.identity(code,token),current=settings(session),now=this.clock();
  if(Object.keys(body).some(k=>!['recipient','preset','runId'].includes(k))||body.runId!==current.runId||!SOS_PRESETS.has(body.preset)||typeof body.recipient!=='string'||body.recipient===self.character)fail(400,'INVALID_SOS');
  if(current.phase!=='playing'||now-session.heartbeat>5000)fail(409,'UNREAL_NOT_READY');
  let state;try{state=JSON.parse(session.telemetry)}catch{fail(409,'UNREAL_NOT_READY')}
  const sender=state.mode==='survival-hunt'&&state.hunt?.views?.[self.character];
  const recipient=state.hunt?.views?.[body.recipient];
  if(!sender||sender.role!=='survivor'||sender.phase!=='choice'||!Number.isSafeInteger(sender.round)||sender.round<1||!KNOWN_ROOMS.has(sender.room))fail(409,'SOS_NOT_AVAILABLE');
  if(!seats.some(s=>s.character===body.recipient)||recipient?.role!=='survivor')fail(409,'RECIPIENT_UNAVAILABLE');
  const id=await this.store.sendMessage({code,runId:current.runId,round:sender.round,sender:self.character,recipient:body.recipient,preset:body.preset,room:sender.room,createdAt:now});
  if(id===null)fail(409,'SOS_ALREADY_SENT');
  return {accepted:true,id};
 }
 async answerHelp(code,token,body){
  const {session,self}=await this.identity(code,token),current=settings(session),now=this.clock();
  if(Object.keys(body).some(k=>!['id','accept','runId'].includes(k))||body.runId!==current.runId||!Number.isSafeInteger(body.id)||body.id<1||typeof body.accept!=='boolean')fail(400,'INVALID_SOS_REPLY');
  if(current.phase!=='playing'||now-session.heartbeat>5000)fail(409,'UNREAL_NOT_READY');
  let state;try{state=JSON.parse(session.telemetry)}catch{fail(409,'UNREAL_NOT_READY')}
  const view=state.mode==='survival-hunt'&&state.hunt?.views?.[self.character];
  if(!view||view.role!=='survivor'||!Number.isSafeInteger(view.round)||view.round<1)fail(409,'SOS_NOT_AVAILABLE');
  const incoming=(await this.store.messages(code,current.runId,self.character,view.round)).find(m=>m.id===body.id&&m.recipient===self.character);
  if(!incoming||state.hunt?.views?.[incoming.sender]?.role!=='survivor')fail(409,'SOS_EXPIRED');
  if(!await this.store.replyMessage(code,current.runId,body.id,self.character,body.accept?'accepted':'ignored',view.round))fail(409,'SOS_EXPIRED');
  return {accepted:true};
 }
 async poll(key,code,telemetry){const device=await this.device(key),session=await this.session(code);if(session.device!==device)fail(403,'BRIDGE_REQUIRED');const now=this.clock();
  const safe={mode:'editor-proof',ready:telemetry?.ready===true,actors:Array.isArray(telemetry?.actors)?telemetry.actors.filter(a=>CONTROLLER_ROSTER.some(c=>c.id===a.character)&&Array.isArray(a.position)&&a.position.length===3&&a.position.every(Number.isFinite)).slice(0,12).map(a=>({character:a.character,position:a.position,seq:Number.isSafeInteger(a.seq)?a.seq:0,kind:a.kind==='cpu'?'cpu':'human',room:['Entrance Hall','Connecting Hall','Painting Gallery','Library','Rear Hall'].includes(a.room)?a.room:undefined,waypoints:Number.isSafeInteger(a.waypoints)?a.waypoints:0})):[]};
  if(telemetry?.mode==='survival-hunt'){
   safe.mode='survival-hunt';safe.hunt={views:{}};
   for(const c of CONTROLLER_ROSTER){const v=telemetry.hunt?.views?.[c.id];if(!v||typeof v!=='object')continue;
    safe.hunt.views[c.id]={phase:String(v.phase||'').slice(0,24),round:Number(v.round)||0,remaining:Number(v.remaining)||0,room:KNOWN_ROOMS.has(v.room)?v.room:'',roomName:String(v.roomName||'').slice(0,40),role:['survivor','zombie','escaped','trapped'].includes(v.role)?v.role:'survivor',choice:String(v.choice||'').slice(0,24),moving:v.moving===true,destination:String(v.destination||'').slice(0,24),options:Array.isArray(v.options)?v.options.slice(0,8).filter(o=>KNOWN_ROOMS.has(o.id)).map(o=>({id:o.id,name:String(o.name).slice(0,40)})):[],camera:v.camera===true,recharge:v.recharge===null?null:Number(v.recharge)||0,canPhoto:v.canPhoto===true,message:String(v.message||'').slice(0,160),seq:Number.isSafeInteger(v.seq)?v.seq:0,finished:v.finished===true,result:['escaped','trapped','zombie'].includes(v.result)?v.result:null,videoReady:false};
   }
  }
  await this.store.heartbeat(code,JSON.stringify(safe),now);
  const seats=await this.store.seats(code);return {code,serverNow:now,settings:settings(session),cpus:this.bots(session,seats),seats:seats.map(s=>{const age=Math.max(0,now-s.input_at),stored=JSON.parse(s.intent),validHunt=safe.mode==='survival-hunt'&&stored.runId===settings(session).runId&&['room','photo'].includes(stored.action),intent=settings(session).phase==='playing'&&(validHunt||age<=650)?stored:{x:0,y:0,run:false};return {character:s.character,name:s.name,index:CONTROLLER_ROSTER.find(c=>c.id===s.character).index,seq:s.seq,ageMs:age,kind:'human',...intent};})};
 }
}
