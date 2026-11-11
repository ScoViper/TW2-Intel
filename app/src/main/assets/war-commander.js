/* TW2 War Commander v16 - partial-cell reader, preserves v15 local data */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='16.0')return;
const KEY='tw2Intel.warCommander.v2',READKEY='tw2Intel.wc.visibleUnits.v5';
const TYPES=['Defence','Nuke','Wall breaker','Noble','Trebuchet','Unassigned'];
const parse=(key)=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch(_){return {}}};
const state=parse(KEY),cache=parse(READKEY);
state.roles ||= {};state.settings={rams:2000,nobles:5,escort:100,...state.settings};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem(READKEY,JSON.stringify(cache))};
const norm=x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' ');
const number=x=>{const s=String(x??'').trim().replace(/[,\s]/g,'');return /^\d+$/.test(s)?Number(s):null};
const get=k=>{try{return window.tw2UnifiedCollector?.[k]?.()||{}}catch(_){return {}}};
const el=(tag,t)=>{const x=document.createElement(tag);if(t!==undefined)x.textContent=t;return x};
function villages(){const ids=get('ownedVillages').ids||[],inv=get('inventory');return ids.map(id=>({...inv[id],id:String(id),name:inv[id]?.name||'Village '+id})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))}
function role(v){if(state.roles[v.id])return state.roles[v.id];if(/^A[.\s-]/i.test(v.name))return 'Defence';if(/^H[.\s-]/i.test(v.name))return 'Nuke';return 'Unassigned'}
function readCell(cell){
 const probes=[cell,...cell.querySelectorAll('.unit-number-available,.unit-number,.unit-count,[data-count],[data-value],span,div')];
 for(const x of probes){
  for(const attr of ['data-count','data-value']){const a=x.getAttribute?.(attr);if(a!=null){const n=number(a);if(n!==null)return n}}
  for(const node of x.childNodes){if(node.nodeType===3){const n=number(node.textContent);if(n!==null)return n}}
  const n=number(x.textContent);if(n!==null)return n;
 }
 return null;
}
let lastScan=null;
function readOverview(){
 const owned=new Map(villages().map(v=>[norm(v.name),v])),rows=new Map();
 let labels=0,unmatched=0;
 for(const e of document.querySelectorAll('td,div,span,a')){
  if(e.closest('#tw2-wc-panel')||e.children.length>3)continue;
  const v=owned.get(norm(e.textContent));if(!v)continue;labels++;
  const row=e.closest('tr');if(row){if(!rows.has(row))rows.set(row,v)}else unmatched++;
 }
 let read=0,partial=0,invalid=0;const samples=[],errors=[];
 for(const [row,v] of rows){
  const cells=[...row.querySelectorAll('.unit-cell-item')].filter(c=>!c.querySelector('.unit-cell-item'));
  const vals=cells.map(readCell),known=vals.filter(x=>x!==null).length;
  if(samples.length<3)samples.push({village:v.name,cells:cells.length,known,first:cells.slice(0,4).map(c=>({text:c.textContent.slice(0,80),html:c.outerHTML.slice(0,350)}))});
  if(cells.length<8||known===0){invalid++;if(errors.length<4)errors.push(v.name+': '+cells.length+' cells, '+known+' readable');continue}
  cache[v.id]={rawUnitColumns:vals,knownCells:known,totalCells:vals.length,partial:known!==vals.length,at:new Date().toISOString(),source:'TW2 overview visible row; columns unmapped'};
  read++;if(known!==vals.length)partial++;
 }
 save();lastScan={rows:rows.size,labels,unmatched,read,partial,invalid,samples,errors};
 return lastScan;
}
let panel,body;
function render(message){
 body.replaceChildren();const vs=villages(),stored=vs.filter(v=>cache[v.id]?.rawUnitColumns).length;
 body.append(el('p',`Owned villages: ${vs.length} | Captured unit rows: ${stored} | Remaining: ${vs.length-stored}`));
 const status=el('p',message||'Ready: open Overview → Units and scan. No game commands are sent.');status.style.cssText='padding:10px;background:#203b55';body.append(status);
 const bar=el('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 const scan=el('button','Read actual Units rows');scan.onclick=()=>{panel.style.display='none';setTimeout(()=>{try{const r=readOverview();render(`Captured ${r.read} rows (${r.partial} partial); candidates ${r.rows}; rejected ${r.invalid}. ${r.errors.join('; ')}`)}catch(e){render('Scan error: '+e.message)}panel.style.display='block'},500)};bar.append(scan);
 const plan=el('button','Plan roles');plan.onclick=()=>{let count=0;for(const v of vs)if(!state.roles[v.id]){const r=role(v);if(r!=='Unassigned'){state.roles[v.id]=r;count++}}save();render(count+' new roles saved; existing roles preserved')};bar.append(plan);
 const diag=el('button','Show scan diagnostics');diag.onclick=()=>{const pre=el('pre',JSON.stringify(lastScan||{message:'Run scan first'},null,2));pre.style.cssText='white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;background:#1a2b3a;padding:10px';body.insertBefore(pre,bar.nextSibling)};bar.append(diag);
 const refresh=el('button','Refresh');refresh.onclick=()=>render();bar.append(refresh);body.append(bar);
 body.append(el('p','Missing cells are unknown, not zero. Captured column positions are provisional until troop icons are mapped. Scan each page of the Units overview to cover more villages.'));
 const counts={};for(const r of TYPES)counts[r]=0;for(const v of vs)counts[role(v)]++;
 body.append(el('p',TYPES.map(r=>r+': '+counts[r]).join(' | ')));
 const search=el('input');search.placeholder='Search villages';search.style.cssText='padding:8px;width:95%';body.append(search);
 const list=el('div');body.append(list);
 function show(){list.replaceChildren();for(const v of vs.filter(v=>!search.value||norm(v.name).includes(norm(search.value))||v.id.includes(search.value))){
  const row=el('div');row.style.cssText='padding:8px 0;border-bottom:1px solid #40536b';
  row.append(el('strong',v.name+' ['+v.id+'] '));
  const select=el('select');for(const t of TYPES){const opt=el('option',t);opt.value=t;select.append(opt)}select.value=role(v);select.onchange=()=>{state.roles[v.id]=select.value;save();render('Saved '+v.name)};row.append(select);
  const c=cache[v.id];row.append(el('div',c?.rawUnitColumns?`Captured ${c.knownCells??c.rawUnitColumns.filter(x=>x!==null).length}/${c.totalCells??c.rawUnitColumns.length} numeric columns; troop names not mapped`:'Troop counts unavailable'));list.append(row)
 }}search.oninput=show;show();
}
function mount(){
 document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();
 const button=el('button','⚔ War Commander');button.id='tw2-wc-open';button.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px';
 panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';
 const head=el('div');head.style.cssText='display:flex;justify-content:space-between';head.append(el('h3','War Commander v16 — Partial Cell Reader'));
 const close=el('button','Close');close.onclick=()=>panel.style.display='none';head.append(close);panel.append(head);
 body=el('div');panel.append(body);button.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')render()};document.body.append(button,panel);
}
window.tw2WarCommander={version:'16.0',getPlan:()=>villages().map(v=>({id:v.id,name:v.name,role:role(v),rawUnitColumns:cache[v.id]?.rawUnitColumns||null})),readVisibleUnits:readOverview,getDiagnostics:()=>lastScan,refresh:()=>render()};
if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
