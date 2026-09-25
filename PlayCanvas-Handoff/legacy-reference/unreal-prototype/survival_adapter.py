"""Unreal PIE adapter. Real capsule movement; no traversal teleports.
Temporary engineering characters and a primitive camera, not final cinematic art.
"""
import unreal,math,json,time,traceback
from pathlib import Path
from survival_hunt import Hunt,ROOMS,NAMES,ROSTER
P=Path(r'C:\Users\Shadow\Documents\Unreal Projects\HAUNTEDGALLERY')
OUT=P/'Saved/HauntedGalleryEvidence'
hunt=None;session=None;last_save=0.;last_text=0.;visual_phase='third-person';last_event=0

def input_key(name):
    value=unreal.Key();value.import_text(name);return value

def tagged(w,tag):return unreal.GameplayStatics.get_all_actors_with_tag(w,tag)
def position(a):
    p=a.get_actor_location();return [p.x,p.y,p.z]
def reset(w,pawns,seats,key):
    global hunt,session,last_event
    hunt=Hunt([s['character'] for s in seats],seed=int(key[1])+341);session=key;last_event=0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(w,unreal.StaticMeshActor):
        if 'ceiling' in actor.get_actor_label().lower() and not actor.actor_has_tag('HG_HUNT_CEILING'):actor.tags=list(actor.tags)+['HG_HUNT_CEILING']
    for cid,a in hunt.actors.items():
        pawn=pawns[cid];pawn.set_actor_hidden_in_game(False);pawn.set_actor_enable_collision(True)
        pawn.set_actor_location(unreal.Vector(*hunt.positions[cid]),False,True)
        pawn.character_movement.set_editor_property('gravity_scale',1.75)
        pawn.character_movement.set_editor_property('use_rvo_avoidance',False)
        pawn.capsule_component.set_collision_response_to_channel(unreal.CollisionChannel.ECC_PAWN,unreal.CollisionResponseType.ECR_IGNORE)
        pawn.character_movement.set_editor_property('orient_rotation_to_movement',True)
        pawn.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        if not pawn.get_controller():pawn.spawn_default_controller()
        pawn.character_movement.stop_movement_immediately()
    for s in seats:hunt.actors[s['character']]['seq']=s.get('seq',0)

def update(w,pc,pawns,camera,dt,seats,settings,code,received):
    global hunt,session,last_save,last_text,visual_phase,last_event
    extra=tagged(w,'HG_HUNT_CURATOR')
    if not extra:
        raise RuntimeError('Prepare the hunt map before Play: missing Curator')
    pawns=dict(pawns);pawns['elias']=extra[0]
    props=tagged(w,'HG_HUNT_CAMERA')
    if not props:
        raise RuntimeError('Prepare the hunt map before Play: missing camera prop')
    lens=tagged(w,'HG_HUNT_LENS')[0];prop=props[0]
    playing=settings.get('phase')=='playing' and bool(seats)
    key=(code,settings.get('runId',0))
    if not playing:
        for pawn in pawns.values():pawn.character_movement.stop_movement_immediately()
        return {'mode':'survival-hunt','ready':True,'actors':[],'hunt':{'views':{},'phase':'lobby','actorCount':0}}
    if hunt is None or session!=key:reset(w,pawns,seats,key)
    paused=unreal.GameplayStatics.is_game_paused(w) or time.monotonic()-received>5
    positions={c:position(pawns[c]) for c in hunt.actors}
    hunt.visible_targets={}
    if hunt.camera_owner and hunt.actors[hunt.camera_owner]['role']=='survivor':
        cid=hunt.camera_owner;p=positions[cid];visible=[]
        for z,b in hunt.actors.items():
            if b['role']=='zombie' and b['room']==hunt.actors[cid]['room']:
                q=positions[z]
                hit=unreal.SystemLibrary.line_trace_single(w,unreal.Vector(p[0],p[1],p[2]+40),unreal.Vector(q[0],q[1],q[2]+40),unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,False,list(pawns.values())+[prop,lens],unreal.DrawDebugTrace.NONE,True)
                if hit is None:visible.append(z)
        hunt.visible_targets[cid]=visible
    # Commands are already bound to the signed-in character by the relay; reject old runs again here.
    for s in seats:
        if s.get('runId')==settings.get('runId') and s.get('action') in ('room','photo'):
            hunt.command(s['character'],s['seq'],s['action'],s.get('room'))
    if not paused:hunt.tick(dt,positions)
    for cid,a in hunt.actors.items():
        pawn=pawns[cid];p=positions[cid];target=None;speed=520 if a['role']=='survivor' else 360
        if not paused and hunt.phase!='blocked' and a['role'] in ('survivor','zombie') and a['stunned_until']<=hunt.t:
            if a['path']:
                tx,ty=a['path'][0]
                if math.hypot(tx-p[0],ty-p[1])<65:
                    a['path'].pop(0)
                    if not a['path']:hunt.arrived(cid)
                if a['path']:target=a['path'][0]
            elif hunt.phase=='encounter':
                victim=hunt.target(cid)
                if victim:
                    target=positions[victim][:2]
                    if math.dist(p[:2],target)<130:hunt.bite(cid,victim);target=None
                elif a['role']=='survivor' and hunt.camera_owner is None and hunt.camera_room==a['room']:
                    # Approach the actual prop; pickup requires physical proximity.
                    target=hunt.camera_position[:2];speed=240
        pawn.mesh.set_editor_property('global_anim_rate_scale',0.0 if a['stunned_until']>hunt.t else 1.0)
        pawn.character_movement.set_editor_property('max_walk_speed',speed)
        if target:
            dx,dy=target[0]-p[0],target[1]-p[1];length=max(1,math.hypot(dx,dy))
            if length>30:pawn.add_movement_input(unreal.Vector(dx/length,dy/length,0),1,True)
            else:pawn.character_movement.stop_movement_immediately()
        else:pawn.character_movement.stop_movement_immediately()
    focus=seats[0]['character'];a=hunt.actors[focus];pawn=pawns[focus];p=pawn.get_actor_location()
    visual_phase='overhead-travel' if a['path'] else 'third-person'
    direction=pawn.get_actor_forward_vector()
    target=unreal.Vector(p.x,p.y-200,p.z+1250) if a['path'] else unreal.Vector(p.x-direction.x*380,p.y-direction.y*380,p.z+150)
    old=camera.get_actor_location();alpha=min(1,dt*4)
    cp=unreal.Vector(old.x+(target.x-old.x)*alpha,old.y+(target.y-old.y)*alpha,old.z+(target.z-old.z)*alpha)
    camera.set_actor_location(cp,False,True);camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(cp,unreal.Vector(p.x,p.y,p.z+30)),False)
    pc.set_view_target_with_blend(camera,0)
    for cid,b in hunt.actors.items():
        # This is one private prototype viewport, not a shared all-knowing spectator camera.
        visible=cid==focus or (not a['path'] and not b['path'] and b['room']==a['room'] and not b['hidden'])
        pawns[cid].set_actor_hidden_in_game(not visible)
    for ceiling in tagged(w,'HG_HUNT_CEILING'):ceiling.set_actor_hidden_in_game(bool(a['path']))
    if hunt.camera_owner:
        owner=pawns[hunt.camera_owner];v=owner.get_actor_location();f=owner.get_actor_forward_vector()
        prop_pos=unreal.Vector(v.x+f.x*35,v.y+f.y*35,v.z+25)
    else:prop_pos=unreal.Vector(*hunt.camera_position)
    prop.set_actor_location(prop_pos,False,True);lens.set_actor_location(unreal.Vector(prop_pos.x,prop_pos.y+10,prop_pos.z),False,True)
    prop_room=hunt.actors[hunt.camera_owner]['room'] if hunt.camera_owner else hunt.camera_room
    prop_hidden=hunt.camera_room=='outside' or prop_room!=a['room'] or bool(a['path'])
    prop.set_actor_hidden_in_game(prop_hidden)
    lens.set_actor_hidden_in_game(prop_hidden)
    if hunt.last_flash>=0 and hunt.last_flash!=last_event:
        if hunt.actors[focus]['room']==hunt.flash_room and not hunt.actors[focus]['path']:
            pc.player_camera_manager.start_camera_fade(1.,0.,.25,unreal.LinearColor(1,1,1,1),False,False)
        last_event=hunt.last_flash
    now=time.monotonic()
    actors=[{'character':c,'position':[round(v,2) for v in position(pawns[c])],'seq':b['seq'],'kind':'human' if b['human'] else 'cpu','room':NAMES[b['room']]} for c,b in hunt.actors.items() if c!='elias']
    views={s['character']:hunt.view(s['character']) for s in seats}
    telemetry={'mode':'survival-hunt','ready':not paused,'actors':actors,'hunt':{'views':views,'phase':hunt.phase,'actorCount':14}}
    if now-last_save>.3:
        data={'at':time.strftime('%Y-%m-%d %H:%M:%S'),'code':code,'ready':not paused,'phase':hunt.phase,'time':hunt.t,'round':hunt.round,'visual_phase':visual_phase,'focus':focus,'camera_owner':hunt.camera_owner,'camera_ready':hunt.camera_ready,'camera_position':hunt.camera_position,'actors':{c:{**b,'position':position(pawns[c])} for c,b in hunt.actors.items()},'events':hunt.events,'finished':hunt.finished,'outcome':hunt.outcome,'views':views}
        try:(OUT/'survival_hunt_status.json').write_text(json.dumps(data,indent=2))
        except OSError:pass  # A transient Windows reader lock must not stop gameplay.
        last_save=now
    if now-last_text>1:
        own=views[focus];keys=' | '.join(str(i+1)+': '+o['name'] for i,o in enumerate(own['options']))
        unreal.SystemLibrary.print_string(w,'SURVIVAL HUNT | '+NAMES[a['room']]+' | '+a['role'].upper()+' | '+hunt.phase.upper()+'\n'+a['message']+'\n'+keys+' | P: Photo | R: Restart test',True,False,unreal.LinearColor(.95,.8,.5,1),1.1);last_text=now
    if not paused:
        for i,o in enumerate(hunt.view(focus)['options']):
            if pc.was_input_key_just_pressed(input_key(['One','Two','Three','Four','Five'][i])):hunt.command(focus,a['seq']+1,'room',o['id'])
        if pc.was_input_key_just_pressed(input_key('P')):hunt.command(focus,a['seq']+1,'photo')
        if pc.was_input_key_just_pressed(input_key('R')):hunt=None
    return telemetry
