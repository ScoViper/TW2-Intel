/* TW2 Intel Unified Collector v2 — passive, persistent, value-aware */
(()=>{'use strict';
if(window.tw2UnifiedCollector?.version==='4.0')return;
const KEY='tw2Intel.unified.v2', OLD='tw2Intel.unified.v1', LIMIT=6000, MAX_TYPES=300;
const deny=/(token|cookie|session|auth|password|email|chat|secret|credential|bearer|csrf|jwt|signature|authorization|useragent|private|api.?key|access.?key)/i;
const relevant=/village|unit|troop|army|command|provision|recruit|queue|overview|resource|building|research|academy|noble|support|world|config|character|player|group|map|farm|stable|barrack/i;
const useful=/(unit|troop|army|recruit|queue|provision|population|farm|resource|storage|production|wood|clay|iron|noble|academy|building|research|level|speed|cost|capacity|home|away|support|incoming|outgoing|return|command|arrival|duration|time|village|owner|character|player|group|province|coordinates|^x$|^y$|^id$|^name$|^count$|^amount$|^total$|^available$|^used$|^max$|^current$)/i;
const now=()=>new Date().toISOString();
let db={version:'2.0',events:0,updatedAt:null,types:{},villages:{},samples:{},storageError:null};
try{const old=JSON.parse(localStorage.getItem(KEY)||'null');if(old?.version==='2.0')db=old;else{const prev=JSON.parse(localStorage.getItem(OLD)||'null');if(prev){db.villages=prev.villages||{};db.types=prev.types||{};db.events=prev.events||0;db.updatedAt=prev.updatedAt||null}}}catch(_){}
let connected=false,panel=null,pending=false;const attached=new WeakSet();
// Owned-village IDs are captured from the full live player list BEFORE sample truncation.
// Never infer ownership from map data or from village names.
const OWN_KEY='tw2Intel.ownedVillages.v3';
const SNAP_KEY='tw2Intel.snapshots.v4';
let snaps={};try{snaps=JSON.parse(localStorage.getItem(SNAP_KEY)||'{}')||{}}catch(_){}
let own={ids:[],at:null,source:null,complete:false};
try{const v=JSON.parse(localStorage.getItem(OWN_KEY)||'null');if(v&&Array.isArray(v.ids))own=v}catch(_){}
function captureOwnership(type,data){
 if(!/^(Character\/info|Character\/villages|Player\/villages|Character\/villageList)$/.test(type))return;
 const roots=[data,data?.character,data?.player,data?.info].filter(x=>x&&typeof x==='object');
 let list=null;
 for(const root of roots){
  for(const key of ['villages','owned_villages','ownedVillages','village_ids','villageIds']){
   if(Array.isArray(root[key])){list=root[key];break}
  }
  if(list)break;
 }
 if(!list||!list.length)return;
 const ids=[];
 for(const item of list){
  const id=typeof item==='object'?(item?.id??item?.village_id??item?.villageId):item;
  if(/^\d+$/.test(String(id??'')))ids.push(String(id));
 }
 if(!ids.length)return;
 // Character/info is a player-specific message, not a map response.
 // Preserve all IDs even if the existing samples truncate at 120.
 own={ids:[...new Set(ids)],at:now(),source:type,complete:true};
 try{localStorage.setItem(OWN_KEY,JSON.stringify(own))}catch(_){}
}

function captureVillageValues(type,data){
 if(!/unit|troop|farm|provision|recruit|queue|resource|building|academy|barrack|stable/i.test(type))return;
 const owned=new Set(own.ids), seen=new Set();
 function scan(v,depth=0,hint=null){
  if(depth>7||!v||typeof v!=='object'||seen.has(v))return;
  seen.add(v);
  if(Array.isArray(v)){for(const item of v.slice(0,6000))scan(item,depth+1,hint);return}
  const id=v.village_id??v.villageId??v.village?.id??hint;
  if(id!=null&&owned.has(String(id))){
   const rec=snaps[String(id)]||{};
   const cleanValue=clean(v);
   if(cleanValue&&typeof cleanValue==='object'&&Object.keys(cleanValue).length){rec[type]={at:now(),data:cleanValue};snaps[String(id)]=rec}
  }
  for(const [k,x] of Object.entries(v).slice(0,6000))if(x&&typeof x==='object'&&!deny.test(k))scan(x,depth+1,/^\d+$/.test(k)?k:hint);
 }
 scan(data);
 try{localStorage.setItem(SNAP_KEY,JSON.stringify(snaps))}catch(e){/* retain in memory */}
}
function shape(v,d=0){if(d>5)return 'depth';if(v===null)return 'null';if(Array.isArray(v))return {array:v.length,first:v.length?shape(v[0],d+1):null};if(typeof v==='object'){const out={};for(const [k,x] of Object.entries(v).slice(0,90))if(!deny.test(k))out[k]=shape(x,d+1);return out}return typeof v}
function merge(a,b,d=0){if(d>7)return a??b;if(a===undefined)return b;if(typeof a==='string'||typeof b==='string')return a===b?a:'mixed';if(!a||!b||typeof a!=='object'||typeof b!=='object')return a;const o={...a};for(const [k,v] of Object.entries(b))o[k]=k==='array'?Math.max(Number(o[k])||0,Number(v)||0):merge(o[k],v,d+1);return o}
function clean(v,d=0,budget={n:0}){if(budget.n++>1800||d>8)return undefined;if(v===null||typeof v==='boolean'||typeof v==='number')return v;if(typeof v==='string')return v.slice(0,140);if(Array.isArray(v))return v.slice(0,120).map(x=>clean(x,d+1,budget)).filter(x=>x!==undefined);if(typeof v==='object'){const out={};for(const [k,x] of Object.entries(v).slice(0,300)){if(deny.test(k))continue;if(!useful.test(k)&&!/^\d+$/.test(k))continue;const val=clean(x,d+1,budget);if(val!==undefined)out[k]=val}return out}return undefined}
function id(v,hint){const x=v?.village_id??v?.villageId??v?.id??hint;return /^\d+$/.test(String(x??''))?String(x):null}
function walk(v,type,d=0,hint){if(d>6||!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v.slice(0,LIMIT))walk(x,type,d+1);return}const vid=id(v,hint);const name=v.name??v.village_name;const hasCoordinates=v.x!==undefined&&v.y!==undefined;if(vid&&(typeof name==='string'||hasCoordinates||db.villages[vid])){const rec=db.villages[vid]||{id:vid};if(typeof name==='string')rec.name=name.slice(0,120);for(const k of ['x','y','province','province_id','owner_id','player_id','character_id','group_id'])if(['string','number','boolean'].includes(typeof v[k]))rec[k]=v[k];rec.updatedAt=now();rec.source=type;db.villages[vid]=rec}for(const [k,x] of Object.entries(v).slice(0,LIMIT))if(!deny.test(k)&&x&&typeof x==='object')walk(x,type,d+1,/^\d+$/.test(k)?k:undefined)}
function save(){pending=false;try{localStorage.setItem(KEY,JSON.stringify(db));db.storageError=null}catch(e){db.storageError='Local storage full; oldest samples removed';const keys=Object.keys(db.samples);for(const k of keys.slice(0,Math.ceil(keys.length/2)))delete db.samples[k];try{localStorage.setItem(KEY,JSON.stringify(db))}catch(_){}}}
function schedule(){if(!pending){pending=true;setTimeout(save,1200)}}
function observe(m){if(!m||typeof m!=='object')return;const type=String(m.type||'unknown').slice(0,120);if(!relevant.test(type))return;const data=m.data??m.payload??{};captureOwnership(type,data);captureVillageValues(type,data);let entry=db.types[type]||{count:0};entry.count++;entry.lastSeen=now();if(!entry.firstSeen)entry.firstSeen=entry.lastSeen;entry.schema=merge(entry.schema,shape(data));db.types[type]=entry;
// Retain bounded, filtered game values for offline parsers. No authentication data or raw messages.
if(/unit|troop|army|provision|recruit|queue|resource|building|research|academy|noble|support|command|overview|village/i.test(type)){const filtered=clean(data);if(filtered&&Object.keys(filtered).length)db.samples[type]={at:now(),data:filtered}}
if(/village|map/i.test(type))walk(data,type);db.events++;db.updatedAt=now();if(Object.keys(db.types).length>MAX_TYPES){const oldest=Object.keys(db.types).sort((a,b)=>(db.types[a].lastSeen||'').localeCompare(db.types[b].lastSeen||''))[0];delete db.types[oldest];delete db.samples[oldest]}schedule();render()}
function attach(){const w=window.tw2Intel?.worker;if(!w||typeof w.addEventListener!=='function')return;connected=true;if(attached.has(w))return;w.addEventListener('message',e=>{try{observe(e.data)}catch(_){}});attached.add(w);render()}
function report(){const names=Object.keys(db.types);const groups={Villages:/village|map|group/i,Troops:/unit|troop|army|battle/i,Recruitment:/recruit|queue|barrack|stable|academy/i,Provisions:/provision|population|farm/i,Resources:/resource|storage|production/i,Commands:/command|incoming|support|attack/i,Buildings:/building|research/i};const lines=['TW2 UNIFIED COLLECTOR v4','Worker connected: '+connected,'Messages observed: '+db.events,'Message types: '+names.length,'Village records seen: '+Object.keys(db.villages).length+' (not owned villages)','Value samples saved: '+Object.keys(db.samples).length,'Owned villages verified from player list: '+own.ids.length,'Villages with captured data: '+Object.keys(snaps).length,'Last update: '+(db.updatedAt||'none'),''];for(const [label,regex] of Object.entries(groups)){const hits=names.filter(x=>regex.test(x));lines.push(label+': '+(hits.length?hits.join(', '):'NOT OBSERVED'))}lines.push('','Still requires validation: owned villages, full troop totals, provisions, recruitment.');if(db.storageError)lines.push('WARNING: '+db.storageError);return lines.join('\n')}
function render(){if(panel&&panel.style.display!=='none'){const p=panel.querySelector('pre');if(p)p.textContent=report()}}
function mount(){if(document.getElementById('tw2-unified-collector'))return;const btn=document.createElement('button');btn.id='tw2-unified-collector';btn.textContent='Data Collector';btn.style.cssText='position:fixed;bottom:220px;right:12px;z-index:2147483646;background:#34506c;color:white;padding:8px;border-radius:8px';panel=document.createElement('section');panel.style.cssText='display:none;position:fixed;inset:7%;overflow:auto;z-index:2147483647;background:#101923;color:white;padding:15px;border:2px solid #7ac';const h=document.createElement('h3');h.textContent='TW2 Data Collector v4';const note=document.createElement('p');note.textContent='Saves filtered game values locally. Readable summary below; no downloads required. Does not send game commands.';const close=document.createElement('button');close.textContent='Close';close.onclick=()=>panel.style.display='none';const refresh=document.createElement('button');refresh.textContent='Refresh summary';refresh.onclick=()=>{attach();render()};const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px';panel.append(h,note,close,document.createTextNode(' '),refresh,pre);btn.onclick=()=>{attach();panel.style.display='block';render()};document.body.append(btn,panel);render()}
window.tw2UnifiedCollector={version:'4.0',villageSnapshots:()=>JSON.parse(JSON.stringify(snaps)),ownedVillages:()=>JSON.parse(JSON.stringify(own)),summary:report,coverage:()=>({types:db.types,events:db.events,updatedAt:db.updatedAt}),inventory:()=>JSON.parse(JSON.stringify(db.villages)),samples:()=>JSON.parse(JSON.stringify(db.samples))};if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});attach();setInterval(attach,1500);
})();
