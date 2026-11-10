/* TW2 War Commander v15 — numeric troop-cell fallback; local planning only */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='15.0')return;
const KEY='tw2Intel.warCommander.v2', READKEY='tw2Intel.wc.visibleUnits.v5';
const TYPES=['Defence','Nuke','Wall breaker','Noble','Trebuchet','Unassigned'];
let state;try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(_){state={}}
state.roles||={};state.settings={rams:2000,nobles:5,escort:100,...state.settings};
let cache;try{cache=JSON.parse(localStorage.getItem(READKEY)||'{}')}catch(_){cache={}}
const $=tag=>document.createElement(tag);
const el=(tag,t)=>{const e=$(tag);if(t!==undefined)e.textContent=t;return e};
const get=k=>{try{return window.tw2UnifiedCollector?.[k]?.()||{}}catch(_){return {}}};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem(READKEY,JSON.stringify(cache))};
const norm=x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' ');
const num=x=>{const s=String(x??'').trim().replace(/[,\s]/g,'');return /^\d+$/.test(s)?Number(s):null};
const n=x=>Number.isFinite(Number(x))?Math.max(0,Number(x)):0;
function villages(){const ids=get('ownedVillages').ids||[],inv=get('inventory');return ids.map(id=>({...inv[id],id:String(id),name:inv[id]?.name||'Village '+id})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))}
function readCell(cell){
 const available=cell.matches('.unit-number-available')?cell:cell.querySelector('.unit-number-available');
 if(available){const v=num(available.textContent);if(v!==null)return v}
 const direct=num(cell.textContent);if(direct!==null)return direct;
 const textNodes=[...cell.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent.trim()).filter(Boolean);
 if(textNodes.length===1){const v=num(textNodes[0]);if(v!==null)return v}
 return null;
}
function readOverview(){
 const byName=new Map(villages().map(v=>[norm(v.name),v]));
 const candidates=[];
 for(const e of document.querySelectorAll('td,div,span,a')){
  if(e.closest('#tw2-wc-panel')||e.children.length>3)continue;
  const v=byName.get(norm(e.textContent));if(v)candidates.push({e,v});
 }
 const rows=new Map();let noRow=0;
 for(const {e,v} of candidates){const row=e.closest('tr');if(row&&!rows.has(row))rows.set(row,v);else if(!row)noRow++}
 let read=0,invalid=0;const reasons=[],examples=[];
 for(const [row,v] of rows){
  const cells=[...row.querySelectorAll('.unit-cell-item')].filter(x=>!x.querySelector('.unit-cell-item'));
  if(cells.length<8){invalid++;if(reasons.length<4)reasons.push(v.name+': '+cells.length+' troop cells');continue}
  const values=cells.map(readCell),missing=values.findIndex(x=>x===null);
  if(missing!==-1){invalid++;if(reasons.length<4)reasons.push(v.name+': cell '+(missing+1)+' unreadable ('+String(cells[missing].textContent||'').trim().slice(0,25)+')');continue}
  cache[v.id]={rawUnitColumns:values,at:new Date().toISOString(),source:'TW2 Units overview / verified row',columns:[],partial:true};
  read++;if(examples.length<3)examples.push(v.name+' ('+values.length+' columns)');
 }
 save();
 return {read,invalid,found:rows.size,matchedText:candidates.length,noRow,examples,reasons,stored:Object.values(cache).filter(x=>x.rawUnitColumns||x.units).length};
}
function role(v){
 if(state.roles[v.id])return state.roles[v.id];
 const t=cache[v.id]?.units;
 if(t){if(n(t.noble))return 'Noble';if(n(t.ram)>=state.settings.rams)return 'Wall breaker';if(n(t.trebuchet))return 'Trebuchet';
 const a=n(t.axe)+n(t.light_cavalry)+n(t.mounted_archer),d=n(t.spear)+n(t.sword)+n(t.archer)+n(t.heavy_cavalry);
 if(a>d&&a)return 'Nuke';if(d)return 'Defence'}
 if(/^A[.\s-]/i.test(v.name))return 'Defence';if(/^H[.\s-]/i.test(v.name))return 'Nuke';return 'Unassigned';
}
function detail(v){
 const r=role(v),t=cache[v.id]?.units,parts=[];
 if(r==='Defence')parts.push('Defensive recruitment: spears, swords, archers, heavy cavalry');
 if(r==='Nuke')parts.push('Offensive recruitment: axes, cavalry, mounted archers');
 if(r==='Wall breaker')parts.push('Rams target '+state.settings.rams);
 if(r==='Noble')parts.push('Target '+state.settings.nobles+' nobles, '+state.settings.escort+' escort units each');
 if(r==='Trebuchet')parts.push('Trebuchet support planning');
 if(r==='Unassigned')parts.push('Insufficient data for role');
 parts.push(t?'Mapped troop values available':cache[v.id]?.rawUnitColumns?'Captured '+cache[v.id].rawUnitColumns.length+' numeric troop columns (unit names not yet mapped)':'Troop numbers unavailable');
 return parts.join(' • ');
}
let panel,body;
function render(message){
 if(!body)return;body.replaceChildren();
 const vs=villages(),stored=vs.filter(v=>cache[v.id]).length;
 body.append(el('p','Owned villages: '+vs.length+' | Villages with captured unit rows: '+stored+' | Remaining: '+(vs.length-stored)));
 const status=el('p',message||'Ready. Planning only; no game commands sent.');
 status.style.cssText='padding:9px;background:#203b55;color:#fff';body.append(status);
 const bar=el('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:12px 0';
 const scan=el('button','Read actual Units rows');scan.onclick=()=>{
  scan.disabled=true;panel.style.display='none';
  setTimeout(()=>{
   let msg;try{const r=readOverview();msg='Scan completed. Captured '+r.read+' owned village rows; '+r.stored+' stored. Candidate rows: '+r.found+'. Matching labels: '+r.matchedText+'. Labels without row: '+r.noRow+'. Invalid: '+r.invalid+'. '+r.examples.join(', ')+'. '+r.reasons.join('; ')}catch(e){msg='Scan error: '+String(e.message||e)}
   panel.style.display='block';scan.disabled=false;render(msg);
  },450);
 };bar.append(scan);
 const assign=el('button','Plan roles');assign.onclick=()=>{let changed=0;for(const v of vs)if(!state.roles[v.id]){const r=role(v);if(r!=='Unassigned'){state.roles[v.id]=r;changed++}}save();render(changed+' new roles saved. Existing assignments preserved.')};bar.append(assign);
 const refresh=el('button','Refresh');refresh.onclick=()=>render('Refreshed saved values.');bar.append(refresh);body.append(bar);
 body.append(el('p','Open TW2 Overview → Units before scanning. Reads only verified owned villages and unambiguous numeric troop cells. Unit names are not mapped yet.'));
 const counts={};for(const r of TYPES)counts[r]=0;for(const v of vs)counts[role(v)]++;
 body.append(el('p',TYPES.map(r=>r+': '+counts[r]).join(' | ')));
 const search=el('input');search.placeholder='Search your villages';search.style.cssText='padding:9px;width:95%';body.append(search);
 const list=el('div');body.append(list);
 function show(){list.replaceChildren();const q=norm(search.value);for(const v of vs.filter(v=>!q||norm(v.name).includes(q)||v.id.includes(q))){
  const row=el('div');row.style.cssText='padding:9px 2px;border-bottom:1px solid #40536b';
  row.append(el('strong',v.name+' ['+v.id+'] '));const sel=el('select');
  for(const r of TYPES){const o=el('option',r);o.value=r;sel.append(o)}
  sel.value=role(v);sel.onchange=()=>{state.roles[v.id]=sel.value;save();render('Role saved for '+v.name)};row.append(sel);
  const d=el('div',detail(v));d.style.cssText='font-size:12px;color:#bdcfe3';row.append(d);list.append(row);
 }}search.oninput=show;show();
}
function mount(){
 document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();
 const b=el('button','⚔ War Commander');b.id='tw2-wc-open';b.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px';
 panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';
 const top=el('div');top.style.cssText='display:flex;justify-content:space-between';top.append(el('h3','War Commander v15 — Numeric Cell Fallback'));
 const close=el('button','Close');close.onclick=()=>panel.style.display='none';top.append(close);panel.append(top);
 body=el('div');panel.append(body);b.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')render()};
 document.body.append(b,panel);
}
window.tw2WarCommander={version:'15.0',getPlan:()=>villages().map(v=>({id:v.id,name:v.name,role:role(v),units:cache[v.id]?.units||null,plan:detail(v)})),readVisibleUnits:readOverview,refresh:()=>render()};
if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
