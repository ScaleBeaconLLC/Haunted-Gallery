"""Editor-only phone controller. No remotely supplied code is executed.
Unreal objects are tick-local so Stop/Play can safely destroy and rebuild PIE.
"""
import unreal,json,time,threading,traceback,math,http.client,urllib.parse,sys
from pathlib import Path
P=Path(r'C:\Users\Shadow\Documents\Unreal Projects\HAUNTEDGALLERY')
sys.path.insert(0,str(P/'Scripts'))
from phone_cpu_exploration import ExplorationBrain,room_at
import survival_adapter
OUT=P/'Saved/HauntedGalleryEvidence'
CONFIG=P/'Saved/PhoneControl/connection.json'
MAP='/Game/HauntedGallery/MansionPrototype/L_Mansion_PhoneControl'
ROSTER=['julian','anika','marcus','mei','dev','amara','alex','andre','rafael','simone','owen','tessa','nia']
try:
    unreal.get_default_object(unreal.EditorPerformanceSettings).set_editor_property('throttle_cpu_when_not_foreground',False)
except Exception:pass
config=json.loads(CONFIG.read_text(encoding='utf-8-sig'))
lock=threading.Lock();shutdown=threading.Event()
try:resume_code=json.loads((OUT/'phone_session.json').read_text())['code']
except Exception:resume_code=None
shared={'code':resume_code,'seats':[],'cpus':[],'settings':{'phase':'playing','runId':0},'received':0,'error':None,'telemetry':{'ready':False,'actors':[]},'latency':[]}
brains={};active=set();bridge={'phase':'start','last':time.monotonic(),'last_save':0,'last_status':0,'generation':0}
level=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
http_connection=None

def post(body):
    global http_connection
    endpoint=urllib.parse.urlsplit(config['url'])
    if http_connection is None:http_connection=http.client.HTTPSConnection(endpoint.hostname,timeout=3)
    try:
        http_connection.request('POST','/api/control/host',body=json.dumps(body),headers={'Content-Type':'application/json','x-hg-bridge-key':config['bridgeKey'],'OAI-Sites-Authorization':'Bearer '+config['siteAccess']})
        response=http_connection.getresponse();data=response.read()
        if response.status not in (200,201):raise RuntimeError('Relay HTTP '+str(response.status))
        return json.loads(data)
    except Exception:
        http_connection.close();http_connection=None;raise

def network_loop():
    while not shutdown.is_set():
        started=time.monotonic()
        try:
            with lock:code=shared['code'];telemetry=shared['telemetry']
            if not code:
                code=post({'action':'create'})['code']
                with lock:shared['code']=code;shared['seats']=[];shared['received']=0
            response=post({'action':'poll','code':code,'telemetry':telemetry})
            with lock:
                if shared['code']!=code:continue
                shared['seats']=response['seats'];shared['cpus']=response.get('cpus',[]);shared['settings']=response.get('settings',{'phase':'playing','runId':0});shared['received']=time.monotonic();shared['error']=None
                shared['latency']=(shared['latency']+[round((time.monotonic()-started)*1000)])[-100:]
                (OUT/'phone_session.json').write_text(json.dumps({'code':code,'url':config['url']+'/?code='+code,'mode':'editor-proof'},indent=2))
        except Exception as error:
            with lock:
                shared['error']=str(error)
                if str(error)=='Relay HTTP 404':shared['code']=None
        shutdown.wait(max(0.05,0.12-(time.monotonic()-started)))

def pos(actor):
    p=actor.get_actor_location();return [round(p.x,2),round(p.y,2),round(p.z,2)]

def report(ready,actors,paused=False,controllers=None):
    with lock:
        shared['telemetry']={'ready':ready,'actors':actors}
        data={'at':time.strftime('%Y-%m-%d %H:%M:%S'),'mode':'editor-proof','code':shared['code'],'ready':ready,'paused':paused,'phase':bridge['phase'],'generation':bridge['generation'],'actors':actors,'settings':shared['settings'],'cpu_brains':{cid:{'state':b.state,'reached':b.reached,'target':b.target} for cid,b in brains.items()},'actor_controllers':controllers or {},'connection_error':shared['error'],'relay_round_trip_ms':shared['latency'],'map':MAP}
    if time.monotonic()-bridge['last_save']>0.5:
        (OUT/'phone_bridge_status.json').write_text(json.dumps(data,indent=2));bridge['last_save']=time.monotonic()

def game_objects():
    w=unreal.EditorLevelLibrary.get_game_world()
    if not w:return None
    pc=unreal.GameplayStatics.get_player_controller(w,0)
    candidates=unreal.GameplayStatics.get_all_actors_with_tag(w,'HG_PHONE')
    cameras=unreal.GameplayStatics.get_all_actors_with_tag(w,'HG_SHARED_CAMERA')
    if not pc or len(candidates)!=13 or not cameras:return None
    pawns={cid:next(a for a in candidates if a.actor_has_tag('HG_PHONE_'+cid)) for cid in ROSTER}
    return w,pc,pawns,cameras[0]

def tick(dt):
    try:
        now=time.monotonic()
        # Trusted local maintenance only. No remotely supplied script execution.
        command_file=P/'Scripts/phone_control_command.py'
        if command_file.exists():
            source=command_file.read_text();command_file.unlink()
            context=dict(globals());context.update({'game_objects':game_objects})
            exec(compile(source,str(command_file),'exec'),context)
            del context,source
        playing=level.is_in_play_in_editor()
        if bridge['phase']=='start':
            if unreal.AssetRegistryHelpers.get_asset_registry().is_loading_assets():return
            if not playing:
                # The dedicated shortcut already loads this map. Never swap a map from a tick.
                w=unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
                if not w or w.get_name()!=MAP.rsplit('/',1)[-1]:
                    bridge['phase']='wrong-map';report(False,[]);return
                level.editor_request_begin_play()
            bridge['phase']='wait';bridge['last']=now;report(False,[]);return
        if not playing:
            active.clear();brains.clear();bridge['phase']='stopped';report(False,[]);return
        if bridge['phase'] in ('stopped','wrong-map'):
            bridge['phase']='wait';bridge['last']=now
        objects=game_objects()
        if not objects:report(False,[]);return
        w,pc,pawns,camera=objects
        if bridge['phase']=='wait':
            if now-bridge['last']<1:return
            original=unreal.GameplayStatics.get_player_pawn(w,0)
            if original and not original.actor_has_tag('HG_PHONE'):
                pc.un_possess();original.destroy_actor()
            pc.set_view_target_with_blend(camera,0)
            unreal.SystemLibrary.execute_console_command(w,'t.MaxFPS 45')
            bridge['phase']='ready';bridge['generation']+=1;active.clear();brains.clear()
        if bridge['phase']!='ready':return
        paused=unreal.GameplayStatics.is_game_paused(w)
        with lock:seats=list(shared['seats']);cpus=list(shared['cpus']);settings=dict(shared['settings']);received=shared['received'];code=shared['code']
        telemetry=survival_adapter.update(w,pc,pawns,camera,dt,seats,settings,code,received)
        with lock:shared['telemetry']=telemetry
        return
        session_key=(code,settings.get('runId',0))
        reset=bridge.get('session_key')!=session_key
        by_id={s['character']:s for s in seats+cpus if s.get('character') in ROSTER}
        for cid in list(active):
            if reset or cid not in by_id:
                pawn=pawns[cid];pawn.character_movement.stop_movement_immediately()
                pawn.set_actor_hidden_in_game(True);pawn.set_actor_enable_collision(False)
                pawn.character_movement.set_editor_property('gravity_scale',0.0)
                pawn.set_actor_location(unreal.Vector(ROSTER.index(cid)*160,-7000,120),False,True)
                active.discard(cid);brains.pop(cid,None)
        bridge['session_key']=session_key
        human_index=0;cpu_index=0
        for cid,seat in by_id.items():
            is_cpu=seat.get('kind')=='cpu'
            if cid not in active:
                pawn=pawns[cid]
                if is_cpu:
                    brain=ExplorationBrain(cpu_index,now);brains[cid]=brain;x,y=brain.spawn
                else:x,y=(human_index%4-1.5)*160,-1350+(human_index//4)*180
                pawn.set_actor_location(unreal.Vector(x,y,110),False,True)
                pawn.set_actor_hidden_in_game(False);pawn.set_actor_enable_collision(True)
                pawn.character_movement.set_editor_property('gravity_scale',1.75)
                pawn.character_movement.set_editor_property('orient_rotation_to_movement',True)
                pawn.character_movement.set_editor_property('use_rvo_avoidance',True)
                pawn.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
                if not pawn.get_controller():pawn.spawn_default_controller()
                if not pawn.get_controller():raise RuntimeError('Character has no controller: '+cid)
                active.add(cid)
            if is_cpu:cpu_index+=1
            else:human_index+=1
        telemetry=[];controllers={};positions={cid:pos(pawns[cid]) for cid in active}
        for cid in active:
            pawn=pawns[cid];seat=by_id.get(cid,{});is_cpu=seat.get('kind')=='cpu'
            valid=not paused and settings.get('phase')=='playing' and now-received<5
            if is_cpu:
                x,y=brains[cid].step(*positions[cid][:2],now,[p[:2] for k,p in positions.items() if k!=cid]) if valid else (0,0)
                speed=brains[cid].speed
            else:
                valid=valid and now-received<.65 and seat.get('ageMs',9999)+(now-received)*1000<650
                x=float(seat.get('x',0)) if valid else 0;y=float(seat.get('y',0)) if valid else 0
                speed=500 if valid and seat.get('run') else 260
            pawn.character_movement.set_editor_property('max_walk_speed',speed)
            if x or y:
                length=max(1,math.hypot(x,y));pawn.add_movement_input(unreal.Vector(x/length,y/length,0),min(1,math.hypot(x,y)),True)
            else:pawn.character_movement.stop_movement_immediately()
            location=pos(pawn)
            telemetry.append({'character':cid,'position':location,'seq':seat.get('seq',0),'kind':'cpu' if is_cpu else 'human','room':room_at(*location[:2]),'waypoints':brains[cid].reached if is_cpu else 0})
            controllers[cid]=pawn.get_controller().get_class().get_name()
        if telemetry:
            visible=[a for a in telemetry if a['kind']=='human'] or telemetry
            cx=sum(a['position'][0] for a in visible)/len(visible);cy=sum(a['position'][1] for a in visible)/len(visible)
            spread=max(math.hypot(a['position'][0]-cx,a['position'][1]-cy) for a in visible)
            distance=max(650,min(1500,550+spread*1.4))
            target=unreal.Vector(cx,cy-distance,360+spread*.15)
            old=camera.get_actor_location();alpha=min(1,dt*3)
            camera_pos=unreal.Vector(old.x+(target.x-old.x)*alpha,old.y+(target.y-old.y)*alpha,old.z+(target.z-old.z)*alpha)
            camera.set_actor_location(camera_pos,False,True)
            camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera_pos,unreal.Vector(cx,cy,120)),False)
        report(not paused,telemetry,paused,controllers)
        if code and now-bridge['last_status']>2:
            unreal.SystemLibrary.print_string(w,'PHONE PLAY '+('PAUSED' if paused else 'READY')+' | '+code+' | '+str(len(brains))+' CPU survivors | '+settings.get('phase','playing').upper(),True,False,unreal.LinearColor(1,.8,.4,1),2)
            bridge['last_status']=now
    except Exception:
        (OUT/'phone_bridge_error.txt').write_text(traceback.format_exc());bridge['phase']='error';report(False,[])
thread=threading.Thread(target=network_loop,name='HauntedGalleryRelay',daemon=True);thread.start()
phone_tick_handle=unreal.register_slate_post_tick_callback(tick)
