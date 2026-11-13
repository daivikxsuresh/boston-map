'use strict';
(()=>{
const M=window.BostonModel,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modeName={walk:'Walk',uber:'Uber',transit:'Train + bus',inside:'Inside Encore'};
const colors={walk:'#187970',uber:'#007aff',transit:'#b76819',inside:'#8099a7'};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const state={meta:null,cache:{},events:[],plan:null,day:'2026-11-13',selected:null,live:true,preview:0,playing:false,choices:{},modes:{},lastSync:null,stale:false,map:null,mapReady:false,markers:[],tilt:true,desk:false,wake:null,lastFollow:null,crowd:null,crowdModel:null,crowdLayer:null,crowdOn:true,crowdKey:''};
try{const saved=JSON.parse(localStorage.getItem('boston-map-preferences')||'{}');state.choices=saved.choices||{};state.modes=saved.modes||{};state.crowdOn=saved.crowds!==false;}catch{}
function savePrefs(){try{localStorage.setItem('boston-map-preferences',JSON.stringify({choices:state.choices,modes:state.modes,crowds:state.crowdOn}));}catch{}}
function toast(msg){$('toast').textContent=msg;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').textContent='',4500);}
const day=()=>state.plan?.days.find(d=>d.date===state.day);
const selected=()=>state.plan?.stops.find(s=>s.id===state.selected);
const now=()=>state.live?Date.now():state.preview;
function formatDuration(ms){if(ms<0)return 'Now';const n=Math.ceil(ms/M.MIN);if(n>=1440)return Math.floor(n/1440)+'d '+Math.floor((n%1440)/60)+'h';if(n>=60)return Math.floor(n/60)+'h '+String(n%60).padStart(2,'0')+'m';return n+' min';}
function rebuild(){state.plan=M.build(state.meta,state.events,state.choices,state.modes);if(!selected())state.selected=day()?.stops[0]?.id;renderDay();renderDetail();drawRoutes();tick();}
async function sync(){
 $('refresh').disabled=true;
 try{const r=await fetch('schedule.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.events))throw Error('Invalid schedule');
 state.events=data.events.filter(e=>e.tripIds?.includes('boston-2026-11'));state.lastSync=Date.now();state.stale=false;
 try{localStorage.setItem('boston-map-last-plan',JSON.stringify({events:state.events,at:state.lastSync}));}catch{}
 rebuild();
 }catch(e){state.stale=true;if(!state.events.length){try{const cached=JSON.parse(localStorage.getItem('boston-map-last-plan')||'null');if(cached?.events){state.events=cached.events;state.lastSync=cached.at;rebuild();}}catch{}}
 if(!state.plan)rebuild();
 }finally{$('refresh').disabled=false;syncLabel();}
}
function syncLabel(){let text=state.lastSync?(state.stale?'Offline · saved itinerary from ':'Board updated ')+M.clock(state.lastSync):'Schedule unavailable. Open Huncho HQ, then refresh.';if(state.plan?.missing.length)text+=' · '+state.plan.missing.length+' mapped stop(s) unavailable';$('sync').textContent=text;$('sync').classList.toggle('stale',state.stale);}
function renderDay(){
 const d=day();document.querySelectorAll('[data-day]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.day===state.day)));
 const names={'2026-11-13':['Back Bay to Encore','An easy arrival, then a resort evening.'],'2026-11-14':['Boston, block by block','North End, Mariel at 9:30, then Howl at the Moon.'],'2026-11-15':['A slow Sunday','Resort brunch, then straight to the train.']};
 $('day-title').textContent=names[state.day][0];$('day-subtitle').textContent=names[state.day][1];$('map-day').textContent=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:M.TZ}).format(new Date(state.day+'T12:00:00-05:00'))+' in Boston';
 $('scrub').min=state.day==='2026-11-13'?'660':'480';$('scrub').max=state.day==='2026-11-14'?'1500':state.day==='2026-11-15'?'1290':'1440';
 $('timeline').innerHTML=d?.stops.length?d.stops.map(s=>{
 const r=s.incoming,connector=r&&!r.samePlace?`<div class="connection"><i class="mode-dot ${r.mode}"></i><span>${modeName[r.mode]} · allow ${r.minutes} min · leave ${M.clock(r.depart)}</span></div>`:'';
 return connector+`<button class="stop ${s.id===state.selected?'active':''}" data-stop="${esc(s.id)}" aria-current="${s.id===state.selected?'step':'false'}"><span class="number">${s.number}</span><span><time>${M.clock(s.at)}${s.proposed?' · suggested':''}</time><b>${esc(s.title)}</b>${s.optional?'<small>Optional</small>':''}</span></button>`;
 }).join(''):'<p>No active mapped stops for this day.</p>';
 $('timeline').querySelectorAll('[data-stop]').forEach(b=>b.onclick=()=>select(b.dataset.stop,true));
}
function select(id,fly=false){state.selected=id;if(fly)document.body.classList.add('detail-open');renderDay();renderDetail();updateMarkers();if(fly)focusMap();}
function setDay(date,preview=true){document.body.classList.remove('detail-open');state.day=date;state.selected=day()?.stops[0]?.id;if(preview){state.live=false;state.playing=false;state.preview=day()?.stops[0]?.at||M.epoch(date,'12:00');}renderDay();renderDetail();drawRoutes();tick();fitRoute();}
function renderDetail(){
 const s=selected();if(!s){$('stop-title').textContent='No stop selected';$('stop-time').textContent='—';$('stop-address').textContent='';$('stop-description').textContent='Refresh the itinerary or choose another day.';$('journey').innerHTML='';$('stop-actions').innerHTML='';return;}
 $('stop-number').textContent='Stop '+s.number+' · '+(s.proposed?'Proposed return':s.fixed?'Timing to protect':s.optional?'Optional':'Your route');
 $('stop-time').textContent=M.clock(s.at);$('stop-title').textContent=s.title;$('stop-address').textContent=s.venue.name+' · '+s.venue.address;
 $('stop-description').textContent=s.detail||s.notes;
 $('choices').innerHTML=s.choice?`<p class="choice-label">Map preview choice · does not reserve</p><div class="modes">${s.options.map(p=>`<button data-place="${p}" aria-pressed="${s.place===p}">${esc(state.meta.places[p].name)}</button>`).join('')}</div>`:'';
 if(s.choice)$('choices').querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{state.choices[s.choice]=b.dataset.place;savePrefs();rebuild();focusMap();});
 const r=s.incoming;
 if(r&&!r.samePlace){
 const overlap=(r.from.end||r.from.at)>r.depart;
 $('journey').innerHTML=`<h3>Getting here</h3><div class="modes">${r.available.map(m=>`<button data-mode="${m}" aria-pressed="${r.mode===m}">${modeName[m]}</button>`).join('')}</div><p class="route-times">Leave ${M.clock(r.depart)} · allow ${r.minutes} min${r.buffer?' + '+r.buffer+' min early':''}</p><p>${esc(r.steps)}</p>${overlap?'<p class="warning">This departure overlaps the previous planned activity. Leave that activity early or choose a quicker route.</p>':''}<p>Planning allowance including pickup/wait time. Check live directions before you leave.</p>`;
 $('journey').querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.modes[r.key]=b.dataset.mode;savePrefs();rebuild();});
 const dest=s.venue.coordinates,uber='https://m.uber.com/ul/?'+new URLSearchParams({action:'setPickup',pickup:'my_location','dropoff[latitude]':dest[1],'dropoff[longitude]':dest[0],'dropoff[nickname]':s.venue.name});
 $('stop-actions').innerHTML=`<a href="${esc(M.directions(r))}" target="_blank" rel="noopener noreferrer">Open current ${r.mode==='transit'?'transit':'route'} directions ↗</a>${r.mode==='uber'?`<a href="${esc(uber)}" target="_blank" rel="noopener noreferrer">Open Uber to ${esc(s.venue.name)} ↗</a>`:''}`;
 }else{$('journey').innerHTML=r?(s.place==='encore'?'<h3>Already at the resort</h3><p>Allow a few minutes indoors. No Uber or train needed.</p>':'<h3>Already at the station</h3><p>Check the departure board and be ready to board your train.</p>'):'<h3>Your Boston arrival</h3><p>Exit the station toward Dartmouth Street. The first city leg is a short walk to luggage storage.</p>';$('stop-actions').innerHTML=`<a href="https://www.google.com/maps/search/?${esc(new URLSearchParams({api:'1',query:s.venue.address+', Boston MA'}))}" target="_blank" rel="noopener noreferrer">Open venue map ↗</a>`;}
 const crowdQuery=new URLSearchParams({api:'1',query:s.venue.name+', '+s.venue.address});
 $('stop-actions').insertAdjacentHTML('beforeend',`<a href="https://www.google.com/maps/search/?${esc(crowdQuery)}" target="_blank" rel="noopener noreferrer">Check popular times on Google Maps ↗</a><p class="crowd-note">Google may show live or usual busyness when data is available.</p>`);
 renderCrowdHere(s);
}
// ── Crowds: typical-day averages of real counts (assets/boston/crowd.json via tools/trip_crowd.py) ──
const weekdayOf=date=>['sun','mon','tue','wed','thu','fri','sat'][new Date(date+'T12:00:00-05:00').getUTCDay()];
const num=v=>Math.round(v).toLocaleString('en-US');
function renderCrowdHere(s){
 const el=$('crowd-here'),C=window.TripCrowd,data=state.crowd;if(!el)return;if(!data||!C||!s){el.innerHTML='';return;}
 const a=C.at(data,s.at,weekdayOf(s.day)),n=state.crowdModel.near(s.venue.coordinates,a,{radius:500,bikeRadius:400}),when=esc(C.label(data,a)),sample=data.days[a.wd];
 const avgNote=`Average of ${sample.n} real ${C.NAMES[a.wd]}s in November 2024 and 2025.`;
 if(!n.station){el.innerHTML=`<h3>Crowd when you arrive</h3><p class="crowd-when">${when}</p><p>No T station within a 6-minute walk, so there is no street-level count for this spot.${n.docks?` About ${num(n.bike)} bike rides start or end within 400 m in that half hour.`:''}</p><p class="crowd-fine">${avgNote}</p>`;return;}
 const st=n.station,caption=`Half-hourly T entries at ${esc(st.name)}, 6am–2am. Hover a bar for its time.`;
 el.innerHTML=`<h3>Crowd when you arrive</h3><p class="crowd-when">${when}</p><p class="crowd-big"><b>${num(st.v)}</b> people entering ${esc(st.name)} station per half hour</p><p class="crowd-meta">${st.metres} m from the entrance · #${st.rank} of ${st.of} T stations then · busiest here ${esc(C.clock(st.peak.slot))} (${num(st.peak.v)})</p><div class="crowd-chart" aria-label="${esc(`${st.name}: ${num(st.v)} entries per half hour at arrival; peak ${num(st.peak.v)} at ${C.clock(st.peak.slot)}`)}">${C.sparkline(st.series,a)}</div><p class="crowd-caption" id="crowd-caption">${caption}</p>${n.docks?`<p>About ${num(n.bike)} bike rides start or end within 400 m in that half hour.</p>`:''}<p class="crowd-fine">${avgNote} Not live and not sidewalk counters; late at night it undercounts people taking Ubers.</p>`;
 const svg=el.querySelector('svg'),cap=$('crowd-caption');
 svg.addEventListener('mousemove',e=>{const r=svg.getBoundingClientRect(),i=Math.max(0,Math.min(st.series.length-1,Math.floor((e.clientX-r.left)/r.width*st.series.length))),x=st.series[i];cap.textContent=`${C.range(x.slot)} · ${num(x.v)} entering ${st.name}`;svg.querySelectorAll('rect').forEach((b,j)=>b.classList.toggle('hover',j===i));});
 svg.addEventListener('mouseleave',()=>{cap.innerHTML=caption;svg.querySelectorAll('rect.hover').forEach(b=>b.classList.remove('hover'));});
}
function renderCrowdKey(a){
 const key=$('crowd-key'),data=state.crowd;if(!key)return;key.hidden=!(data&&state.crowdOn&&state.mapReady);if(!data||!a)return;
 $('crowd-when').textContent=TripCrowd.label(data,a)+(a.standIn?' · preview':'');
 const top=state.crowdModel.busiest(a,3);$('crowd-top').textContent=top.length?'Busiest: '+top.map(x=>x.name).join(' · '):'Quiet everywhere: the T is closed';
}
function updateCrowd(t,force=false){
 const data=state.crowd;if(!data||!window.TripCrowd)return;const a=TripCrowd.at(data,t,weekdayOf(state.day));
 if(!force&&a.key===state.crowdKey)return;state.crowdKey=a.key;state.crowdNow=a;state.crowdLayer?.show(a);renderCrowdKey(a);
}
function attachCrowd(before){
 if(!state.crowd||!window.TripCrowd||state.crowdLayer)return;
 try{state.crowdLayer=TripCrowd.attach(state.map,state.crowd,{before,maplibregl:window.maplibregl,reduced});state.crowdLayer.setVisible(state.crowdOn);updateCrowd(now(),true);}catch(e){state.crowdLayer=null;$('crowd').hidden=true;}
}
function setCrowds(on){state.crowdOn=on;savePrefs();$('crowd').setAttribute('aria-pressed',String(on));state.crowdLayer?.setVisible(on);renderCrowdKey(state.crowdNow);}
function tick(){
 $('clock').textContent=new Intl.DateTimeFormat('en-US',{timeZone:M.TZ,hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date());
 if(!state.plan)return;
 const t=now(),status=M.live(state.plan,t);
 if(state.live){const relevant=status.current||status.next;if(relevant&&relevant.day!==state.day){state.day=relevant.day;state.selected=relevant.id;renderDay();renderDetail();drawRoutes();}}
 $('mode-label').textContent=state.live?'Live schedule':'Preview · '+M.clock(t);document.body.classList.toggle('preview',!state.live);$('live').setAttribute('aria-pressed',String(state.live));$('play').textContent=state.playing?'Ⅱ':'▶';$('play').setAttribute('aria-pressed',String(state.playing));
 $('live-context').textContent=status.phase==='before'?'Before the trip':status.phase==='travel'?'Planned travel window':status.phase==='complete'?'Boston, until next time':status.phase==='train'?'Sunday evening':'According to your plan';
 $('live-title').textContent=status.title;$('live-detail').textContent=status.detail;
 $('countdown').textContent=Number.isFinite(status.countdown)?formatDuration(status.countdown):'✓';$('countdown-label').textContent=status.phase==='travel'?(status.countdown<0?'arrival target passed':'to arrival target'):status.phase==='before'?'until Boston':status.phase==='train'?'until scheduled arrival':status.phase==='complete'?'All planned stops finished':status.route&&!status.route.samePlace?'until leave-by time':'until next stop';
 const mins=Math.round((t-M.epoch(state.day,'00:00'))/M.MIN);$('scrub').value=Math.max(Number($('scrub').min),Math.min(Number($('scrub').max),mins));$('preview-time').textContent=M.clock(t);
 updateCrowd(t);
 const focus=status.phase==='travel'?status.next:status.current||status.next;
 if(state.desk&&state.live&&focus&&focus.id!==state.lastFollow){state.lastFollow=focus.id;state.selected=focus.id;renderDay();renderDetail();updateMarkers();focusMap();}
 if(state.playing){state.preview+=5*M.MIN;const end=M.epoch(state.day,'00:00')+Number($('scrub').max)*M.MIN;if(state.preview>end){state.preview=end;state.playing=false;}}
}
function buildFeatures(){const features=[];for(const r of day()?.legs||[]){if(r.samePlace)continue;const g=M.geometry(state.meta,r,state.cache);features.push({type:'Feature',properties:{mode:r.mode,color:colors[r.mode],schematic:g.schematic?1:0},geometry:{type:g.type,coordinates:g.coordinates}});}return {type:'FeatureCollection',features};}
function drawRoutes(){
 if(!state.mapReady){if(!$('fallback').hidden)drawFallback();return;}
 const data=buildFeatures(),map=state.map;if(map.getSource('trip-routes'))map.getSource('trip-routes').setData(data);else{
 map.addSource('trip-routes',{type:'geojson',data});
 map.addLayer({id:'route-halo',type:'line',source:'trip-routes',paint:{'line-color':'#fff','line-width':9,'line-opacity':.85}});
 map.addLayer({id:'route-solid',type:'line',source:'trip-routes',filter:['==',['get','schematic'],0],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['get','color'],'line-width':5,'line-opacity':.9}});
 map.addLayer({id:'route-schematic',type:'line',source:'trip-routes',filter:['==',['get','schematic'],1],paint:{'line-color':['get','color'],'line-width':3,'line-dasharray':[2,2]}});
 }
 updateMarkers();
}
function updateMarkers(){
 if(!state.mapReady)return;state.markers.forEach(m=>m.remove());state.markers=[];
 const groups=new Map();for(const s of day()?.stops||[]){if(!groups.has(s.place))groups.set(s.place,[]);groups.get(s.place).push(s);}
 for(const [place,stops] of groups){const s=stops.find(s=>s.id===state.selected)||stops[0],b=document.createElement('button');b.className='marker'+(s.id===state.selected?' selected':'')+(place==='encore'?' hotel':'');b.textContent=place==='encore'?'H':s.number;b.title=stops.map(x=>M.clock(x.at)+' '+x.title).join('\n');b.setAttribute('aria-label',b.title);b.onclick=()=>select(s.id,true);state.markers.push(new maplibregl.Marker({element:b}).setLngLat(s.venue.coordinates).addTo(state.map));}
}
function focusMap(){const s=selected();if(!s)return;if(state.mapReady){const detailRoom=document.body.classList.contains('detail-open')&&innerWidth>1150?360:60;state.map.flyTo({center:s.venue.coordinates,zoom:16.5,pitch:state.tilt?60:0,bearing:state.tilt?-22:0,padding:{top:90,bottom:240,left:60,right:detailRoom},duration:reduced.matches?0:850,essential:false});}else drawFallback();}
function fitRoute(){if(!state.mapReady){drawFallback();return;}const stops=day()?.stops||[];if(!stops.length)return;const bounds=new maplibregl.LngLatBounds();stops.forEach(s=>bounds.extend(s.venue.coordinates));const height=$('map').clientHeight;state.map.fitBounds(bounds,{padding:{top:90,bottom:Math.min(260,Math.round(height*.32)),left:65,right:65},pitch:state.tilt?25:0,bearing:0,maxZoom:15,duration:reduced.matches?0:650});}
function fallback(reason){$('crowd-key').hidden=true;$('map-status').textContent=reason;$('fallback').hidden=false;$('map').style.visibility='hidden';state.mapReady=false;drawFallback();}
function drawFallback(){const d=day();if(!d)return;const xy=coord=>[80+(coord[0]+71.105)*13000,620-(coord[1]-42.33)*7500];let svg='<text x="45" y="45" fill="#14334a" font-size="20">Boston · route overview</text><text x="45" y="70" fill="#526a7b" font-size="12">Schematic fallback · detailed city tiles unavailable</text>';
 for(const r of d.legs){if(r.samePlace)continue;const g=M.geometry(state.meta,r,state.cache);const pts=g.coordinates.map(c=>xy(c).join(',')).join(' ');svg+=`<polyline points="${pts}" fill="none" stroke="${colors[r.mode]}" stroke-width="3" ${g.schematic?'stroke-dasharray="7 5"':''}/>`;}
 const seen=new Set();for(const s of d.stops){if(seen.has(s.place))continue;seen.add(s.place);const [x,y]=xy(s.venue.coordinates);svg+=`<circle cx="${x}" cy="${y}" r="12" fill="${s.id===state.selected?'#236489':'#fff'}" stroke="#236489" stroke-width="2"/><text x="${x}" y="${y+4}" text-anchor="middle" font-size="10" fill="${s.id===state.selected?'white':'#14334a'}">${s.number}</text><text x="${x+18}" y="${y+4}" font-size="11" fill="#14334a">${esc(s.venue.name)}</text>`;}$('fallback-svg').innerHTML=svg;
}
function initMap(){
 if(!window.maplibregl){fallback('3-D renderer unavailable · itinerary still works');return;}
 try{
 state.map=new maplibregl.Map({container:'map',style:'style.json',center:[-71.077,42.351],zoom:15.1,pitch:55,bearing:-25,attributionControl:true,antialias:true});
 state.map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:false}),'bottom-right');
 const timer=setTimeout(()=>{if(!state.mapReady)fallback('City tiles unavailable · showing route overview');},18000);
 state.map.on('load',()=>{clearTimeout(timer);state.mapReady=true;$('fallback').hidden=true;$('map').style.visibility='visible';$('map-status').textContent='';
 const layers=state.map.getStyle().layers,label=layers.find(l=>l.type==='symbol'&&l.layout?.['text-field']);
 state.map.setLight({anchor:'viewport',color:'#fff8ef',intensity:.32,position:[1.5,210,45]});
 state.map.addLayer({id:'boston-buildings-3d',source:'openmaptiles','source-layer':'building',type:'fill-extrusion',minzoom:13,paint:{'fill-extrusion-color':'#deded8','fill-extrusion-height':['interpolate',['linear'],['zoom'],13,0,14,['max',8,['coalesce',['get','render_height'],['get','height'],8]]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.96}},label?.id);
 attachCrowd(label?.id);renderCrowdKey(state.crowdNow);
 drawRoutes();fitRoute();});
 state.map.on('error',()=>{if(state.mapReady)$('map-status').textContent='Some map tiles unavailable';});
 state.map.getCanvas().addEventListener('webglcontextlost',()=>fallback('3-D paused by the browser · route overview available'));
 }catch(e){fallback('3-D unavailable on this device · route overview');}
}
async function wake(){if(!navigator.wakeLock){$('wake-status').textContent='Wake lock is unavailable. Disable screen sleep in your Mac settings.';return;}try{state.wake=await navigator.wakeLock.request('screen');$('wake-status').textContent='Keeping this screen awake while the tab is visible.';state.wake.addEventListener('release',()=>{$('wake-status').textContent='Screen wake lock released; tap to keep awake again.';state.wake=null;});}catch{$('wake-status').textContent='Could not keep the screen awake. Check power and browser settings.';}}
function desk(on){state.desk=on;document.body.classList.toggle('desk-mode',on);$('desk').setAttribute('aria-pressed',String(on));$('desk-bar').hidden=!on;setTimeout(()=>{state.map?.resize();if(on)focusMap();},60);if(on){if(!state.live)toast('Desk display is previewing. Tap Return to live for the actual clock.');wake();}else{state.wake?.release();}}
$('close-detail').onclick=()=>document.body.classList.remove('detail-open');
$('rail-route').onclick=()=>{document.querySelector('.itinerary').scrollIntoView({block:'start',behavior:reduced.matches?'auto':'smooth'});};
$('rail-live').onclick=()=>$('live').click();$('rail-desk').onclick=()=>desk(!state.desk);
$('desk').onclick=()=>desk(!state.desk);$('exit-desk').onclick=()=>desk(false);$('wake').onclick=wake;
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable; use the browser’s fullscreen control.');}};
$('fit').onclick=fitRoute;$('focus-map').onclick=focusMap;$('explore').onclick=focusMap;$('tilt').onclick=()=>{state.tilt=!state.tilt;$('tilt').textContent=state.tilt?'3-D on':'2-D view';$('tilt').setAttribute('aria-pressed',String(state.tilt));state.map?.easeTo({pitch:state.tilt?55:0,bearing:state.tilt?-25:0,duration:reduced.matches?0:500});};
$('crowd').setAttribute('aria-pressed',String(state.crowdOn));$('crowd').onclick=()=>setCrowds(!state.crowdOn);
$('zoom-in').onclick=()=>state.map?.zoomIn();$('zoom-out').onclick=()=>state.map?.zoomOut();$('refresh').onclick=sync;
$('live').onclick=()=>{state.live=true;state.playing=false;state.lastFollow=null;tick();};
$('scrub').oninput=()=>{state.live=false;state.playing=false;state.preview=M.epoch(state.day,'00:00')+Number($('scrub').value)*M.MIN;tick();};
$('play').onclick=()=>{if(state.live){state.live=false;state.preview=day()?.stops[0]?.at||M.epoch(state.day,'12:00');}state.playing=!state.playing;tick();};
document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>setDay(b.dataset.day));
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();sync();if(state.desk)wake();}});
window.addEventListener('online',sync);window.addEventListener('resize',()=>state.map?.resize());
async function boot(){try{const [meta,routes,crowd]=await Promise.all([fetch('places.json').then(r=>{if(!r.ok)throw Error();return r.json();}),fetch('routes.json').then(r=>r.ok?r.json():{}).catch(()=>({})),fetch('crowd.json').then(r=>r.ok?r.json():null).catch(()=>null)]);state.meta=meta;state.cache=routes;$('warnings').innerHTML=meta.warnings.map(w=>'<p>'+esc(w)+'</p>').join('');
 if(crowd?.points&&window.TripCrowd){state.crowd=crowd;state.crowdModel=TripCrowd.model(crowd);}else $('crowd').hidden=true;
 const crowdSources=state.crowd?(state.crowd.sources||[]).map(s=>({...s,title:'Crowds · '+s.title})):[];
 $('sources').innerHTML=[...meta.sources,...crowdSources].map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join('')+(state.crowd?`<p>Crowds are averages of real counts, not live: people entering T stations plus Bluebikes rides starting or ending, per half hour, across ${esc(Object.values(state.crowd.days).map(d=>d.n).join('/'))} Fridays/Saturdays/Sundays in November 2024 and 2025 (Thanksgiving weekends left out). No sidewalk counters exist for these streets at night.</p>`:'');await sync();initMap();setInterval(tick,1000);setInterval(()=>{if(!document.hidden)sync();},60000);}catch{$('live-title').textContent='Could not load the route';$('live-detail').textContent='Reload this page while Huncho HQ is running.';$('map-status').textContent='Route data unavailable';}}
window.BostonTrip={state,refresh:sync,select,setDay};boot();
})();
