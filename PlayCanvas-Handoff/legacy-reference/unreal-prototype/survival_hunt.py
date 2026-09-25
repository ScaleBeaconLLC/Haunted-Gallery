"""Authoritative editor-prototype hunt. Unreal supplies positions and movement.
No renderer objects, networking, private snapshots or wall-clock timers are shared.
"""
import math, random

ROOMS={'entrance':(0,-1000),'hall':(0,500),'gallery':(-1750,1000),'library':(1900,1000),'exit':(0,2000)}
NAMES={'entrance':'Entrance Hall','hall':'Connecting Hall','gallery':'Painting Gallery','library':'Library','exit':'Rear Service Exit'}
EDGES={('entrance','hall'):[(0,-600),(0,500)],('hall','gallery'):[(-1750,500),(-1750,1000)],('hall','library'):[(1900,500),(1900,1000)],('gallery','exit'):[(-1750,1600),(-1100,1600),(-1100,2000),(0,2000)],('library','exit'):[(1900,500),(500,500),(500,1300),(500,1600),(1100,1600),(1100,2000),(0,2000)]}
ROSTER=['julian','anika','marcus','mei','dev','amara','alex','andre','rafael','simone','owen','tessa','nia']
def neighbours(room):
    return [b if a==room else a for a,b in EDGES if room in (a,b)]
def route(a,b):
    if a==b:return []
    if (a,b) in EDGES:return list(EDGES[a,b])
    if (b,a) in EDGES:return list(reversed([ROOMS[b]]+EDGES[b,a]))[1:]
    raise ValueError('Room is not adjacent')
def toward(start,goal):
    queue=[(start,[])];seen={start}
    for room,path in queue:
        if room==goal:return path[0] if path else start
        for n in neighbours(room):
            if n not in seen:seen.add(n);queue.append((n,path+[n]))
    return start

class Hunt:
    def __init__(self,humans,seed=1):
        self.rng=random.Random(seed);self.t=0.;self.phase='choice';self.until=10.;self.round=1
        self.encounter_started=0.
        self.events=[];self.outcome=None;self.exit_open=False;self.camera_owner=None;self.camera_room='gallery'
        self.camera_position=(*ROOMS['gallery'],100);self.camera_ready=0.;self.last_flash=-100.;self.last_targets=[]
        self.actors={};self.humans=list(humans);self.positions={};self.finished=False;self.visible_targets=None
        room_counts={}
        active=list(humans)+[c for c in ROSTER if c not in humans][:12-len(humans)]
        spare=next(c for c in ROSTER if c not in active);self.birthday=spare
        for i,c in enumerate(active+[spare,'elias']):
            room='entrance' if c in humans else ['hall','gallery','library'][i%3]
            if c==spare:room='entrance'
            if c=='elias':room='exit'
            role='zombie' if c in (spare,'elias') else 'survivor'
            self.actors[c]={'id':c,'room':room,'role':role,'human':c in humans,'choice':room,'path':[],
                'destination':room,'hidden':False,'seq':0,'message':'Choose a room or stay hidden.',
                'stunned_until':0.,'attack_after':0.,'hunt_room':None,'search_count':0,'born_round':0,'arrived_at':0.}
            slot=room_counts.get(room,0);room_counts[room]=slot+1
            x,y=ROOMS[room];self.positions[c]=(x+(slot%3-1)*150,y+(slot//3-1)*150,100)
        self.emit('start',None)
    def emit(self,event,cid,**data):
        self.events.append({'time':round(self.t,3),'event':event,'character':cid,**data});self.events=self.events[-300:]
    def live(self,cid):return self.actors[cid]['role'] in ('survivor','zombie')
    def options(self,cid):
        a=self.actors[cid]
        if not self.live(cid) or a['path'] or self.finished:return []
        if self.phase=='choice' or (self.phase=='encounter' and a['role']=='survivor' and self.t-self.last_flash<5 and a['room']==self.flash_room):
            return [a['room']]+neighbours(a['room'])
        return []
    def command(self,cid,seq,action,room=None):
        if cid not in self.actors:return False
        a=self.actors[cid]
        if not isinstance(seq,int) or seq<=a['seq']:return False
        a['seq']=seq
        if action=='room':
            if room not in self.options(cid):a['message']='That route is not available now.';return False
            if self.phase=='choice':a['choice']=room;a['message']='Your choice is private.'
            else:self.depart(cid,room);a['message']='Get out before they recover.'
            return True
        if action=='photo':return self.photo(cid)
        return False
    def depart(self,cid,room):
        a=self.actors[cid];a['destination']=room;a['hidden']=room==a['room'] and a['role']=='survivor'
        a['path']=route(a['room'],room)
        if a['path']:
            # Approach the known doorway from the centre of the current room.
            a['path'].insert(0,ROOMS[a['room']]);a['hidden']=False
            a['message']='Moving to '+NAMES[room];self.emit('depart',cid,source=a['room'],destination=room)
    def arrived(self,cid):
        a=self.actors[cid];a['path']=[];a['room']=a['destination'];a['arrived_at']=self.t
        a['message']='Listen. Decide who to trust.';self.emit('arrive',cid,room=a['room'])
    def photo(self,cid,visible=None):
        a=self.actors[cid]
        if visible is None and self.visible_targets is not None:visible=self.visible_targets.get(cid,[])
        if self.finished or self.phase!='encounter' or a['path'] or a['role']!='survivor' or self.camera_owner!=cid or self.t<self.camera_ready:
            a['message']='The camera is not ready for you to use.';return False
        candidates=[c for c,b in self.actors.items() if b['role']=='zombie' and not b['path'] and b['room']==a['room'] and math.dist(self.positions[c][:2],self.positions[cid][:2])<=1600]
        if visible is not None:candidates=[c for c in candidates if c in visible]
        if not candidates:a['message']='No visible threat in the shot.';return False
        # Renderer frames the nearest eligible target. Same shot catches others in its 110-degree cone.
        origin=self.positions[cid];nearest=min(candidates,key=lambda c:math.dist(origin,self.positions[c]))
        p=self.positions[nearest];dx,dy=p[0]-origin[0],p[1]-origin[1];length=max(.01,math.hypot(dx,dy));targets=[]
        for c in candidates:
            p=self.positions[c];ex,ey=p[0]-origin[0],p[1]-origin[1]
            if (dx*ex+dy*ey)/(length*max(.01,math.hypot(ex,ey)))>=math.cos(math.radians(55)):targets.append(c)
        for c in targets:self.actors[c]['stunned_until']=self.t+5
        self.camera_ready=self.t+7;self.last_flash=self.t;self.flash_room=a['room'];self.last_targets=targets
        a['message']='They are frozen. Choose your escape room!';self.emit('photo',cid,targets=targets)
        return True
    def bite(self,hunter,victim):
        z,a=self.actors[hunter],self.actors[victim]
        if z['role']!='zombie' or a['role']!='survivor' or z['stunned_until']>self.t:return False
        if z['path'] or a['path'] or z['room']!=a['room'] or math.dist(self.positions[hunter][:2],self.positions[victim][:2])>140:return False
        a['role']='zombie';a['hidden']=False;a['born_round']=self.round;a['message']='You have turned. Hunt without revealing yourself.'
        if self.camera_owner==victim:
            self.camera_owner=None;self.camera_room=a['room'];self.camera_position=self.positions[victim]
            self.emit('camera_drop',victim,position=list(self.camera_position))
        z['attack_after']=self.t+20;self.emit('bite',hunter,victim=victim);return True
    def pickup(self,cid):
        a=self.actors[cid]
        if a['role']=='survivor' and not a['path'] and self.camera_owner is None and a['room']==self.camera_room and math.dist(self.positions[cid][:2],self.camera_position[:2])<150:
            self.camera_owner=cid;self.camera_room=None;a['message']='Camera recovered. Take a photo when a threat appears.';self.emit('camera_pickup',cid);return True
        return False
    def exposed(self,a,z):return not a['hidden'] or z['search_count']>=2
    def target(self,cid):
        z=self.actors[cid]
        if self.phase!='encounter' or z['role']!='zombie' or z['path'] or z['stunned_until']>self.t or z['attack_after']>self.t or z['born_round']==self.round:return None
        victims=[c for c,a in self.actors.items() if a['role']=='survivor' and not a['path'] and a['room']==z['room'] and self.exposed(a,z)]
        return min(victims,key=lambda c:math.dist(self.positions[c],self.positions[cid])) if victims else None
    def cpu_choices(self):
        for cid,a in self.actors.items():
            if a['human'] or not self.live(cid):continue
            ns=neighbours(a['room'])
            if a['role']=='zombie':
                # Only current local observations, never pending survivor destinations.
                local=any(b['role']=='survivor' and b['room']==a['room'] and not b['hidden'] for b in self.actors.values())
                a['choice']=a['room'] if local and self.rng.random()<.6 else self.rng.choice(ns+[a['room']])
            else:
                a['choice']=toward(a['room'],'exit') if self.rng.random()<.65 else self.rng.choice(ns+[a['room']])
    def tick(self,dt,positions):
        if self.finished:return
        self.t+=max(0.,min(float(dt),.15));self.positions.update(positions)
        if self.phase=='choice' and self.t>=self.until:
            self.cpu_choices()
            for cid,a in self.actors.items():
                if self.live(cid):self.depart(cid,a['choice'])
            self.phase='travel';self.until=self.t+24
        elif self.phase=='travel':
            if not any(a['path'] for a in self.actors.values()):
                self.phase='encounter';self.until=self.t+10;self.encounter_started=self.t
                for a in self.actors.values():
                    if a['role']=='zombie':
                        a['search_count']=a['search_count']+1 if a['hunt_room']==a['room'] else 1
                        a['hunt_room']=a['room'];a['attack_after']=self.t+2.5
                self.emit('encounter',None,round=self.round)
            elif self.t>=self.until:
                self.phase='blocked';self.emit('blocked_path',None);return
        elif self.phase=='encounter':
            for cid,a in self.actors.items():
                if a['role']=='survivor' and not a['path']:
                    self.pickup(cid)
                    if not a['human'] and self.camera_owner==cid:
                        if self.photo(cid):
                            destination=toward(a['room'],'exit')
                            if destination==a['room']:destination=neighbours(a['room'])[0]
                            self.depart(cid,destination)
                    if a['room']=='exit' and self.t-max(a['arrived_at'],self.encounter_started)>=3 and not any(self.target(z)==cid for z in self.actors):
                        self.exit_open=True;a['role']='escaped';a['message']='You escaped alive.';self.emit('escape',cid)
                        if self.camera_owner==cid:self.camera_room='outside'
            if self.t>=self.until and not any(a['path'] for a in self.actors.values()):
                self.round+=1
                if self.round>12:
                    for a in self.actors.values():
                        if a['role']=='survivor':a['role']='trapped';a['message']='The hunt is over. You did not escape.'
                else:
                    self.phase='choice';self.until=self.t+10
                    for a in self.actors.values():a['choice']=a['room']
        if self.phase not in ('blocked','travel') and not any(a['role']=='survivor' for a in self.actors.values()):
            self.finished=True;self.phase='finished';self.outcome={c:a['role'] for c,a in self.actors.items() if c not in (self.birthday,'elias')};self.emit('finished',None)
    def view(self,cid):
        a=self.actors[cid];own=self.camera_owner==cid
        return {'phase':self.phase,'round':self.round,'time':round(self.t,2),'remaining':round(max(0,self.until-self.t),1),'room':a['room'],'roomName':NAMES[a['room']],
            'role':a['role'],'choice':a['choice'],'moving':bool(a['path']),'destination':a['destination'],'options':[{'id':r,'name':NAMES[r]} for r in self.options(cid)],
            'camera':own,'recharge':round(max(0,self.camera_ready-self.t),1) if own else None,'canPhoto':own and a['role']=='survivor' and self.phase=='encounter' and not a['path'] and self.t>=self.camera_ready,
            'message':a['message'],'seq':a['seq'],'finished':self.finished,'result':a['role'] if a['role'] in ('escaped','trapped') else None,'videoReady':False}
