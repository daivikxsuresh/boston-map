(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BostonModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const TZ='America/New_York',MIN=60000;
const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(t)).replace(/[\u202f\u00a0]/g,' ');
const dayKey=t=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
function epoch(date,time){if(!/^2026-11-\d\d$/.test(date||'')||!/^\d\d:\d\d$/.test(time||''))return NaN;return Date.parse(date+'T'+time+':00-05:00');}
function leg(meta,a,b,modes){
 if(a.place===b.place)return {key:a.place+':'+b.place,mode:'inside',minutes:5,buffer:0,steps:a.place==='encore'?'Stay within Encore; allow a few minutes to reach the next part of the resort.':'Stay at the same location; check the station departure board.',from:a,to:b,depart:b.at-5*MIN,samePlace:true};
 const key=a.place+':'+b.place,rule=meta.legs[key]||{},available=['walk','uber','transit'].filter(x=>Number.isFinite(rule[x]));
 const defaultMode=rule.defaultMode||(rule.walk<=18?'walk':'uber');
 const mode=available.includes(modes?.[key])?modes[key]:(available.includes(defaultMode)?defaultMode:available[0]||'uber');
 const minutes=rule[mode]||30,buffer=b.arrivalBuffer??rule.arrivalBuffer??(b.fixed?10:0);
 const via=mode==='transit'?rule.transitVia||[]:(mode==='walk'?rule.via||[]:[]);
 return {key,mode,minutes,buffer,available,via,steps:mode==='transit'?rule.transitSteps:mode==='walk'&&rule.defaultMode==='uber'?'Walk via Congress / Cambridge toward Charles Street. Allow 30 minutes.':rule.steps||'Check current directions before leaving.',from:a,to:b,depart:b.at-(minutes+buffer)*MIN,estimated:true};
}
function build(meta,events,choices={},modes={}){
 const rows=new Map(events.map(r=>[r.id,r])),missing=[],stops=[];
 for(const spec of meta.stops){
  const row=rows.get(spec.board);if(!row){missing.push(spec.board);continue;}if(['done','cancelled'].includes(row.status))continue;
  const choice=spec.options?.includes(choices[spec.choice])?choices[spec.choice]:spec.place;
  const at=epoch(row.date,spec.useEnd?row.end:row.start)+(spec.offsetMinutes||0)*MIN;
  if(!Number.isFinite(at)||!meta.places[choice]){missing.push(spec.board);continue;}
  const end=epoch(row.date,row.end);
  stops.push({...spec,id:spec.board,title:spec.title||row.title,boardTitle:row.title,day:row.date,at,end:Number.isFinite(end)&&end>at?end:null,place:choice,venue:meta.places[choice],notes:row.notes||'',row});
 }
 stops.sort((a,b)=>a.at-b.at);
 const night=stops.find(s=>s.id==='e-boston-nightlife-1110');
 if(night){const at=epoch('2026-11-15','00:50');stops.push({id:'planned-return',title:'Uber back to Encore',day:night.day,at,place:'encore',venue:meta.places.encore,optional:true,proposed:true,detail:'Proposed late-night return: request Uber around 12:10am after music, aim for the hotel around 12:50am. Leave sooner whenever you are ready; this is not a booked ride.'});}
 stops.sort((a,b)=>a.at-b.at);
 const days=['2026-11-13','2026-11-14','2026-11-15'].map(date=>{
  const list=stops.filter(s=>s.day===date);
  list.forEach((s,i)=>{s.number=i+1;if(i)s.incoming=leg(meta,list[i-1],s,modes);});
  return {date,stops:list,legs:list.slice(1).map(s=>s.incoming)};
 });
 return {days,stops,missing};
}
function live(plan,now){
 const list=plan.stops;if(!list.length)return {phase:'empty',title:'No mapped stops',detail:'Load the Boston schedule to begin.'};
 const first=list[0],last=list.at(-1);
 if(now<first.at)return {phase:'before',current:null,next:first,target:first.at,title:'Boston is next',detail:'Your arrival at Back Bay',countdown:first.at-now};
 if(now>=last.at){const end=last.end||last.at;if(now<end)return {phase:'train',current:last,title:'On the train home',detail:'Scheduled Newark Penn arrival '+clock(end),target:end,countdown:end-now};return {phase:'complete',current:last,title:'Weekend complete',detail:'The scheduled trip has ended.'};}
 const next=list.find(s=>s.at>now),index=list.indexOf(next),current=list[index-1];
 // A new morning is a hotel stay, not a journey beginning the previous evening.
 const route=next.incoming;
 if(route&&!route.samePlace&&now>=route.depart)return {phase:'travel',current,next,route,target:next.at-route.buffer*MIN,countdown:next.at-route.buffer*MIN-now,title:(route.mode==='uber'?'Uber to ':route.mode==='walk'?'Walk to ':'Transit to ')+next.venue.name,detail:'Planned departure '+clock(route.depart)+' · '+current.venue.name+' → '+next.venue.name};
 return {phase:'stay',current,next,route,target:route&&!route.samePlace?route.depart:next.at,countdown:(route&&!route.samePlace?route.depart:next.at)-now,title:current.end&&now>=current.end?'Free time at '+current.venue.name:current.title,detail:route&&!route.samePlace?'Leave by '+clock(route.depart)+' for '+next.venue.name:'Next: '+next.title+' at '+clock(next.at)};
}
function geometry(meta,route,cache){
 const cached=cache?.[route.key+':'+route.mode];if(cached)return {...cached.geometry,schematic:false};
 const ids=[route.from.place,...(route.via||[]),route.to.place];
 return {type:'LineString',coordinates:ids.map(id=>meta.places[id]?.coordinates).filter(Boolean),schematic:true};
}
function directions(route){const a=route.from.venue.coordinates,b=route.to.venue.coordinates;const q=new URLSearchParams({api:'1',origin:a[1]+','+a[0],destination:b[1]+','+b[0],travelmode:route.mode==='walk'?'walking':route.mode==='transit'?'transit':'driving'});return 'https://www.google.com/maps/dir/?'+q;}
return {TZ,MIN,clock,dayKey,epoch,build,live,geometry,directions,leg};
});
