/* TW2 War Commander v2.0 — owned-village-first planning, no game commands */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='4.0')return;
const KEY='tw2Intel.warCommander.v2';
const roles=['Defence','Nuke','Wall breaker','Noble','Trebuchet','Unassigned'];
const unitNames=['spear','sword','archer','axe','light_cavalry','mounted_archer','heavy_cavalry','ram','trebuchet','noble'];
const num=x=>Number.isFinite(Number(x))?Math.max(0,Math.floor(Number(x))):0;
const state=(()=>{try{return {...{roles:{},settings:{rams:2000,nobles:5,escort:100},target:''},...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){return {roles:{},settings:{rams:2000,nobles:5,escort:100},target:''}}})();
state.roles||={};state.settings={rams:2000,nobles:5,escort:100,...state.settings};
const collector=()=>window.tw2UnifiedCollector;
const get=(method)=>{try{return collector()?.[method]?.()||{}}catch(_){return {}}};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch(_){}};
function ownedIds(){
 const direct=get('ownedVillages');
 if(Array.isArray(direct.ids)&&direct.ids.length)return {ids:new Set(direct.ids.map(String)),source:direct.source||'live player list',partial:!direct.complete};
 const samples=get('samples');const ids=new Set();const entry=samples['Character/info'];
 const list=entry?.data?.villages;
 if(Array.isArray(list))for(const v of list){const id=typeof v==='object'?(v?.id??v?.village_id??v?.villageId):v;if(/^\d+$/.test(String(id??'')))ids.add(String(id))}
 return {ids,source:ids.size?'partial Character/info sample':'player list not observed',partial:true};
}
function troopSnapshots(){const result=new Map();const samples=get('samples');for(const type of ['Village/unitInfo','UnitScreen/data']){
 const entry=samples[type];if(!entry?.data)continue;
 function scan(x,d=0,hint){if(d>7||!x||typeof x!=='object')return;if(Array.isArray(x)){for(const v of x.slice(0,120))scan(v,d+1,hint);return}
 const id=x.village_id??x.villageId??hint;const units=x.units??x.unitInfo??x.troops??x.home_units??x.homeUnits;
 if(/^\d+$/.test(String(id??''))&&units&&typeof units==='object'&&!Array.isArray(units)){
  const vals={};let found=0;for(const name of unitNames){const raw=units[name];const value=raw&&typeof raw==='object'?(raw.count??raw.amount??raw.available):raw;if(value!==undefined&&Number.isFinite(Number(value))){vals[name]=num(value);found++}}
  if(found)result.set(String(id),{units:vals,at:entry.at,type,complete:false});
 }
 for(const [k,v] of Object.entries(x).slice(0,250))if(v&&typeof v==='object')scan(v,d+1,/^\d+$/.test(k)?k:hint)
 }scan(entry.data)
 }
 const byVillage=get('villageSnapshots');for(const [id,entries] of Object.entries(byVillage)){for(const [type,entry] of Object.entries(entries)){if(!/Village\/unitInfo|UnitScreen\/data/i.test(type))continue;const x=entry.data||{};const units=x.units??x.unitInfo??x.troops??x.home_units??x.homeUnits;if(!units||typeof units!=='object')continue;const vals={};for(const name of unitNames){const raw=units[name];const value=raw&&typeof raw==='object'?(raw.count??raw.amount??raw.available):raw;if(value!==undefined&&Number.isFinite(Number(value)))vals[name]=num(value)}if(Object.keys(vals).length)result.set(id,{units:vals,at:entry.at,type,complete:false})}}
 return result}
function villageData(){const ownership=ownedIds(),all=get('inventory'),troops=troopSnapshots();const villages=[...ownership.ids].map(id=>{const v=all[id]||{id,name:'Village '+id};return {...v,id,name:v.name||'Village '+id,troops:troops.get(id)||null}}).sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{numeric:true}));return {ownership,villages}}
function roleFor(v){const t=v.troops?.units;if(!t)return 'Unassigned';const offensive=num(t.axe)+num(t.light_cavalry)+num(t.mounted_archer);const defensive=num(t.spear)+num(t.sword)+num(t.archer)+num(t.heavy_cavalry);if(num(t.noble)>0)return 'Noble';if(num(t.ram)>=state.settings.rams)return 'Wall breaker';if(num(t.trebuchet)>0)return 'Trebuchet';if(offensive>defensive&&offensive>0)return 'Nuke';if(defensive>0)return 'Defence';return 'Unassigned'}
function suggested(v){const id=v.id;if(state.roles[id])return state.roles[id];const troopRole=roleFor(v);if(troopRole!=='Unassigned')return troopRole;
 // H/A province hints are recommendations only, never ownership evidence.
 const name=String(v.name||'');if(/^(H[.\- ]|H\s*province)/i.test(name))return 'Nuke';if(/^(A[.\- ]|A\s*province)/i.test(name))return 'Defence';return 'Unassigned'}
function plan(v){const role=suggested(v),t=v.troops?.units;const pieces=[];if(role==='Wall breaker')pieces.push(t?.ram!==undefined?`Rams ${num(t.ram)}/${state.settings.rams}; need ${Math.max(0,state.settings.rams-num(t.ram))}`:`Target ${state.settings.rams} rams; count unknown`);
 if(role==='Noble')pieces.push(`Target ${state.settings.nobles} nobles per conquest, ${state.settings.escort} escort troops each`);
 if(role==='Defence')pieces.push('Prioritise spears, swords, archers and heavy cavalry; provision budget pending');
 if(role==='Nuke')pieces.push('Prioritise offensive units; composition and provision budget pending');
 if(role==='Trebuchet')pieces.push('Reserve trebuchets for slow-speed coordinated attacks');
 if(role==='Unassigned')pieces.push('Needs a verified troop snapshot or manual role preference');
 if(!t)pieces.push('Troop numbers unavailable');else pieces.push('Troop snapshot provisional');return pieces.join(' · ')}
const el=(tag,txt)=>{const n=document.createElement(tag);if(txt!==undefined)n.textContent=txt;return n};
let panel,content;
function render(){if(!content)return;content.replaceChildren();const {ownership,villages}=villageData();const intro=el('div',`Owned villages identified from ${ownership.source}: ${villages.length}${ownership.partial?' (PARTIAL — game collector truncates the list)':''}`);intro.style.cssText='padding:12px;background:#20344c;border-radius:6px';content.append(intro);
 const warning=el('p','Only villages from your player village list are shown. No map villages are included. Recruitment and attack execution are disabled. Troop snapshots are not yet verified as complete.');warning.style.color='#ffdb9a';content.append(warning);
 if(!villages.length){content.append(el('p','No verified owned-village list received yet. Reload the game once so Character/info can be observed from the start. Map villages are excluded.'));return}
 const feedback=el('p','Ready. Planning uses available data; missing troop counts are not guessed.');feedback.dataset.wcFeedback='1';feedback.style.cssText='padding:8px;background:#233b50;color:#e7f2ff';content.append(feedback);const bar=el('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:10px 0';const suggest=el('button','Automatically plan roles');suggest.onclick=()=>{let changed=0;for(const v of villages)if(!state.roles[v.id]){const role=suggested(v);if(role!=='Unassigned'){state.roles[v.id]=role;changed++}}save();render();const f=content.querySelector('[data-wc-feedback]');if(f)f.textContent=changed+' village assignments saved. '+(changed?'Review roles below.':'No additional assignments possible without verified troop data or a village role preference.')};bar.append(suggest);const refresh=el('button','Refresh from game');refresh.onclick=()=>{render();const f=content.querySelector('[data-wc-feedback]');if(f)f.textContent='Refreshed local collector data. This does not request a new game snapshot. Owned villages: '+villageData().villages.length+'; villages with troop snapshots: '+villageData().villages.filter(v=>v.troops).length};bar.append(refresh);content.append(bar);
 const counts={};for(const role of roles)counts[role]=0;for(const v of villages)counts[suggested(v)]++;content.append(el('p',roles.map(x=>x+': '+counts[x]).join(' | ')));
 const search=el('input');search.placeholder='Search your villages';search.style.cssText='padding:9px;width:95%;margin-bottom:10px';content.append(search);
 const list=el('div');content.append(list);
 function show(){list.replaceChildren();const q=search.value.toLowerCase();for(const v of villages.filter(x=>[x.name,x.id,x.province].some(z=>String(z||'').toLowerCase().includes(q))).slice(0,250)){
 const row=el('div');row.style.cssText='border-top:1px solid #46576b;padding:9px 3px';const head=el('div');head.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap';head.append(el('strong',`${v.name} [${v.id}] ${v.x!=null&&v.y!=null?'('+v.x+'|'+v.y+')':''}`));const sel=el('select');for(const role of roles){const opt=el('option',role);opt.value=role;sel.append(opt)}sel.value=suggested(v);sel.onchange=()=>{state.roles[v.id]=sel.value;save();render()};head.append(sel);row.append(head);const detail=el('div',plan(v));detail.style.cssText='font-size:12px;color:#bfcfe0;margin-top:4px';row.append(detail);list.append(row)} }search.oninput=show;show();
}
function mount(){document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();const button=el('button','⚔ War Commander');button.id='tw2-wc-open';button.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px;border-radius:20px';panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';const heading=el('div');heading.style.cssText='display:flex;justify-content:space-between';heading.append(el('h3','War Commander v4 — Village Planning'));const close=el('button','Close');close.onclick=()=>panel.style.display='none';heading.append(close);panel.append(heading);content=el('div');panel.append(content);button.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display!=='none')render()};document.body.append(button,panel)}
window.tw2WarCommander={version:'4.0',getPlan:()=>villageData().villages.map(v=>({id:v.id,name:v.name,role:suggested(v),plan:plan(v)})),refresh:render};if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
