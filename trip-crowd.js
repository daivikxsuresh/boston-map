// Typical-day crowd layer for any Huncho HQ trip map (MapLibre).
// Data: assets/<trip>/crowd.json, built by tools/trip_crowd.py from public counts
// (transit gate entries + bikeshare trips), averaged per weekday and half hour.
// Nothing here is live or modelled: no count, no glow. Playbook for a new city:
// ~/.claude/automations/trip_crowd_layer.md
(function(root){
'use strict';
const ORDER=['sun','mon','tue','wed','thu','fri','sat'];
const NAMES={sun:'Sunday',mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday'};
// One-hue sequential ramp (orange: blue belongs to the planned route). Quiet recedes to the map.
const RAMP=[[0,'rgba(253,227,207,0)'],[.06,'rgba(253,227,207,.38)'],[.2,'rgba(249,185,138,.55)'],[.4,'rgba(235,104,52,.62)'],[.65,'rgba(194,69,26,.72)'],[1,'rgba(138,45,14,.82)']];
const fmts=new Map();
function parts(tz,t){let f=fmts.get(tz);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});fmts.set(tz,f);}const p=Object.fromEntries(f.formatToParts(new Date(t)).map(x=>[x.type,x.value]));return {wd:p.weekday.toLowerCase().slice(0,3),h:Number(p.hour)%24,m:Number(p.minute)};}
// Calendar weekday + half hour in the city's zone. A weekday the data lacks (e.g. before the
// trip) borrows the fallback weekday at the same clock time; the label always names which.
function at(data,t,fallbackWd){const p=parts(data.tz,t),slot=p.h*2+(p.m>=30?1:0);let wd=p.wd,standIn=false;if(!data.days[wd]){standIn=true;wd=data.days[fallbackWd]?fallbackWd:Object.keys(data.days)[0];}return {wd,slot,standIn,key:wd+':'+slot};}
const prevDay=wd=>ORDER[(ORDER.indexOf(wd)+6)%7],nextDay=wd=>ORDER[(ORDER.indexOf(wd)+1)%7];
function clock(slot){const h=Math.floor(slot/2)%24,m=slot%2?'30':'00';return (h%12||12)+':'+m+(h<12?' AM':' PM');}
function range(slot){return clock(slot)+'–'+clock(slot+1);}
// Before 4am counts as the previous night: 12:30am Sunday is "Saturday night".
function dayName(a){return a.slot<8?NAMES[prevDay(a.wd)]+' night':NAMES[a.wd];}
function label(data,a){return data.label+' '+dayName(a)+' · '+clock(a.slot);}
function metres(a,b){const k=Math.cos((a[1]+b[1])/2*Math.PI/180);return Math.hypot((a[0]-b[0])*111320*k,(a[1]-b[1])*110540);}
function model(data){
 const P=data.points,cache=new Map(),transit=P.map((p,i)=>p[2]===0?i:-1).filter(i=>i>=0);
 const row=(wd,slot)=>{const key=wd+':'+slot;let m=cache.get(key);if(!m){m=new Map(data.slots[wd]?.[slot]||[]);cache.set(key,m);}return m;};
 // 6:00am through 1:30am the next morning, so a night out reads as one evening.
 function series(i,wd){const out=[];for(let s=12;s<48;s++)out.push({wd,slot:s,v:row(wd,s).get(i)||0});const n=nextDay(wd);if(data.days[n])for(let s=0;s<4;s++)out.push({wd:n,slot:s,v:row(n,s).get(i)||0});return out;}
 function busiest(a,n=3){return [...row(a.wd,a.slot)].filter(([i])=>P[i][2]===0).sort((x,y)=>y[1]-x[1]).slice(0,n).map(([i,v])=>({name:P[i][3],v}));}
 function station(i,a){const day=a.slot<8?prevDay(a.wd):a.wd,s=series(i,data.days[day]?day:a.wd),peak=s.reduce((m,x)=>x.v>m.v?x:m,s[0]);const r=row(a.wd,a.slot),v=r.get(i)||0,ranked=transit.map(j=>r.get(j)||0).sort((x,y)=>y-x);return {i,name:P[i][3],v,series:s,peak,rank:ranked.indexOf(v)+1,of:transit.length};}
 function near(coord,a,{radius=800,bikeRadius=400}={}){
  let best=null;for(const i of transit){const d=metres(coord,P[i]);if(d<=radius&&(!best||d<best.d))best={i,d};}
  const r=row(a.wd,a.slot);let bike=0,docks=0;for(const [i,v] of r)if(P[i][2]===1&&metres(coord,P[i])<=bikeRadius){bike+=v;docks++;}
  return {station:best?{...station(best.i,a),metres:Math.round(best.d/10)*10}:null,bike,docks};
 }
 return {row,series,busiest,station,near};
}
function attach(map,data,{before,maplibregl=root.maplibregl,reduced=root.matchMedia?.('(prefers-reduced-motion: reduce)')}={}){
 const P=data.points,M=model(data),ref=Math.max(1,data.max),lat=(P.reduce((t,p)=>t+p[1],0)/Math.max(1,P.length))*Math.PI/180;
 // Kernel radius in pixels that stays ~450 m on the ground (about a five-minute walk) at any zoom.
 const radiusPx=z=>Math.round(450*512*2**z/(40075016.7*Math.cos(lat)));let visible=true,current=null,flows=[];
 map.addSource('crowd',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'crowd-heat',type:'heatmap',source:'crowd',paint:{'heatmap-weight':['get','w'],'heatmap-intensity':['interpolate',['linear'],['zoom'],11,2.2,14,2.8,17,3.2],'heatmap-radius':['interpolate',['exponential',2],['zoom'],11,radiusPx(11),16,radiusPx(16)],'heatmap-color':['interpolate',['linear'],['heatmap-density'],...RAMP.flat()],'heatmap-opacity':['interpolate',['linear'],['zoom'],13,.9,16,.55]}},before);
 map.addLayer({id:'crowd-stations',type:'circle',source:'crowd',minzoom:12,filter:['==',['get','k'],0],paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,['+',3,['*',6,['sqrt',['get','w']]]],16,['+',4.5,['*',10,['sqrt',['get','w']]]]],'circle-color':'#a63c12','circle-opacity':.9,'circle-stroke-color':'#fff','circle-stroke-width':1.4,'circle-pitch-alignment':'viewport'}},before);
 const popup=maplibregl?new maplibregl.Popup({closeButton:true,closeOnClick:true,maxWidth:'250px',className:'crowd-popup'}):null;
 map.on('click','crowd-stations',e=>{const f=e.features?.[0];if(!f||!current||!popup)return;const s=M.station(f.properties.i,current),el=document.createElement('div');
  const line=(tag,text,cls)=>{const x=document.createElement(tag);x.textContent=text;if(cls)x.className=cls;el.appendChild(x);};
  line('strong',s.name);line('p',data.label+' '+dayName(current)+' · '+range(current.slot),'muted');line('p','About '+Math.round(s.v).toLocaleString()+' people entered the T here per half hour');line('p','#'+s.rank+' of '+s.of+' stations then · busiest here '+clock(s.peak.slot)+' ('+Math.round(s.peak.v).toLocaleString()+')','muted');line('p','Average of '+data.days[current.wd].n+' real '+NAMES[current.wd]+'s, '+data.days[current.wd].dates[0].slice(0,7).replace('-','/')+'–'+data.days[current.wd].dates.at(-1).slice(0,7).replace('-','/')+'.','muted');
  popup.setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);});
 map.on('mouseenter','crowd-stations',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','crowd-stations',()=>map.getCanvas().style.cursor='');
 // Moving dots: real bikeshare rides that started in this half hour (average across sample days).
 const cv=document.createElement('canvas');cv.className='crowd-flow';cv.setAttribute('aria-hidden','true');map.getCanvasContainer().appendChild(cv);
 let raf=0,lastFrame=0,start=performance.now();
 function draw(ts){
  const box=map.getContainer(),w=box.clientWidth,h=box.clientHeight,dpr=Math.min(2,root.devicePixelRatio||1);
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.width=w+'px';cv.style.height=h+'px';}
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);if(!visible||!flows.length)return;
  const still=!!reduced?.matches,secs=(ts-start)/1000;
  for(let k=0;k<flows.length;k++){const [ai,bi,n]=flows[k],a=map.project([P[ai][0],P[ai][1]]),b=map.project([P[bi][0],P[bi][1]]);
   if((a.x<-80&&b.x<-80)||(a.x>w+80&&b.x>w+80)||(a.y<-80&&b.y<-80)||(a.y>h+80&&b.y>h+80))continue;
   const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<6)continue;
   const c={x:(a.x+b.x)/2-dy*.18,y:(a.y+b.y)/2+dx*.18},pt=t=>({x:(1-t)*(1-t)*a.x+2*(1-t)*t*c.x+t*t*b.x,y:(1-t)*(1-t)*a.y+2*(1-t)*t*c.y+t*t*b.y});
   ctx.strokeStyle='rgba(32,38,45,'+(.035+.08*Math.min(1,n))+')';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(c.x,c.y,b.x,b.y);ctx.stroke();
   const dots=Math.max(1,Math.min(5,Math.round(n*4))),seed=(ai*7919+bi*104729)%997/997;
   for(let d=0;d<dots;d++){const t=still?.72:((seed+d/dots+secs*42/Math.max(60,len))%1),p=pt(t);if(!still&&t>.08){const q=pt(t-.08),g=ctx.createLinearGradient(q.x,q.y,p.x,p.y);g.addColorStop(0,'rgba(32,38,45,0)');g.addColorStop(1,'rgba(32,38,45,.5)');ctx.strokeStyle=g;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.quadraticCurveTo((q.x+p.x)/2,(q.y+p.y)/2,p.x,p.y);ctx.stroke();}ctx.beginPath();ctx.arc(p.x,p.y,2.3,0,Math.PI*2);ctx.fillStyle='rgba(32,38,45,.82)';ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.stroke();}
  }
 }
 const running=()=>visible&&flows.length&&!document.hidden&&!reduced?.matches;
 function loop(ts){raf=0;if(!running()){draw(ts);return;}if(ts-lastFrame>=33){lastFrame=ts;draw(ts);}raf=requestAnimationFrame(loop);}
 function kick(){if(!raf)raf=requestAnimationFrame(loop);}
 map.on('move',()=>{if(!running())draw(performance.now());});map.on('resize',()=>draw(performance.now()));document.addEventListener('visibilitychange',kick);reduced?.addEventListener?.('change',kick);
 function show(a){
  current=a;const r=M.row(a.wd,a.slot),features=[];
  for(const [i,v] of r)features.push({type:'Feature',properties:{i,k:P[i][2],v,w:Math.min(1,v/ref)},geometry:{type:'Point',coordinates:[P[i][0],P[i][1]]}});
  map.getSource('crowd').setData({type:'FeatureCollection',features});flows=data.flows?.[a.wd]?.[a.slot]||[];kick();
 }
 function setVisible(on){visible=!!on;for(const id of ['crowd-heat','crowd-stations'])map.setLayoutProperty(id,'visibility',on?'visible':'none');if(!on)popup?.remove();draw(performance.now());kick();}
 return {show,setVisible,model:M,get flows(){return flows;},get visible(){return visible;}};
}
// Small bar chart of one place's half hours; the marked bar is the time that matters.
function sparkline(series,mark,{width=258,height=54}={}){
 const n=series.length,gap=2,bw=(width-gap*(n-1))/n,max=Math.max(1,...series.map(x=>x.v)),y=v=>height-2-(height-6)*v/max;
 const bars=series.map((x,i)=>{const top=y(x.v),hh=Math.max(1,height-2-top),isMark=mark&&x.wd===mark.wd&&x.slot===mark.slot;return `<rect x="${(i*(bw+gap)).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" class="${isMark?'mark':''}"/>`;}).join('');
 return `<svg viewBox="0 0 ${width} ${height+14}" width="100%" role="img" class="crowd-spark">${bars}<line x1="0" x2="${width}" y1="${height-1}" y2="${height-1}" class="base"/>${[[0,'6a'],[12,'noon'],[24,'6p'],[36,'12a']].filter(([i])=>i<n).map(([i,t])=>`<text x="${(i*(bw+gap)).toFixed(1)}" y="${height+12}">${t}</text>`).join('')}</svg>`;
}
root.TripCrowd={at,label,clock,range,dayName,model,attach,sparkline,NAMES,RAMP};
})(typeof globalThis!=='undefined'?globalThis:this);
