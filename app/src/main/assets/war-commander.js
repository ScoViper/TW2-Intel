/* TW2 War Commander v17 — mapped troop columns and village planning. No game commands. */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='17.0')return;
const KEY='tw2Intel.warCommander.v2', READKEY='tw2Intel.wc.visibleUnits.v5', MAPKEY='tw2Intel.wc.columnMap.v17';
const TYPES=['Defence','Nuke','Wall breaker','Noble','Trebuchet','Unassigned'];
const UNITS=['Unmapped','Spearman','Swordsman','Axeman','Archer','Light cavalry','Mounted archer','Heavy cavalry','Ram','Catapult','Berserker','Trebuchet','Noble','Spy','Paladin'];
const parse=k=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch{return {}}};
const state=parse(KEY),cache=parse(READKEY),mapping=parse(MAPKEY);
state.roles ||= {};state.settings={rams:2000,nobles:5,escort:100,...state.settings};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem(READKEY,JSON.stringify(cache));localStorage.setItem(MAPKEY,JSON.stringify(mapping))};
const norm=x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' ');
const number=x=>{const s=String(x??'').trim().replace(/[,\s]/g,'');return /^\d+$/.test(s)?Number(s):null};
const get=k=>{try{return window.tw2UnifiedCollector?.[k]?.()||{}}catch{return {}}};
const el=(tag,t)=>{const x=document.createElement(tag);if(t!==undefined)x.textContent=t;return x};
const owned=()=>{const ids=get('ownedVillages').ids||[],inv=get('inventory');return ids.map(id=>({...inv[id],id:String(id),name:inv[id]?.name||'Village '+id})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))};
const role=v=>state.roles[v.id]||(/^A[.\s-]/i.test(v.name)?'Defence':/^H[.\s-]/i.test(v.name)?'Nuke':'Unassigned');
const raw=v=>cache[v.id]?.rawUnitColumns||null;
const mapped=v=>{const r=raw(v)||[],out={};r.forEach((n,i)=>{const type=mapping[i];if(type&&type!=='Unmapped'&&Number.isFinite(n))out[type]=(out[type]||0)+n});return out};
function readCell(cell){const probes=[cell,...cell.querySelectorAll('.unit-number-available,.unit-number,.unit-count,[data-count],[data-value],span,div')];for(const x of probes){for(const attr of ['data-count','data-value']){const a=x.getAttribute?.(attr);if(a!=null){const n=number(a);if(n!==null)return n}}for(const node of x.childNodes){if(node.nodeType===3){const n=number(node.textContent);if(n!==null)return n}}const n=number(x.textContent);if(n!==null)return n}return null}
let lastScan=null,panel,body;
function scanOverview(){const names=new Map(owned().map(v=>[norm(v.name),v])),rows=new Map();let labels=0,unmatched=0;
for(const e of document.querySelectorAll('td,div,span,a')){if(e.closest('#tw2-wc-panel')||e.children.length>3)continue;const v=names.get(norm(e.textContent));if(!v)continue;labels++;const row=e.closest('tr');if(row){if(!rows.has(row))rows.set(row,v)}else unmatched++}
let read=0,partial=0,invalid=0;const errors=[];
for(const [row,v] of rows){const cells=[...row.querySelectorAll('.unit-cell-item')].filter(c=>!c.querySelector('.unit-cell-item'));const vals=cells.map(readCell),known=vals.filter(x=>x!==null).length;
if(cells.length<8||known===0){invalid++;if(errors.length<4)errors.push(v.name+': '+cells.length+' cells, '+known+' readable');continue}
const previous=raw(v);if(previous&&previous.length===vals.length)for(let i=0;i<vals.length;i++)if(vals[i]===null)vals[i]=previous[i]??null;
cache[v.id]={rawUnitColumns:vals,knownCells:vals.filter(x=>x!==null).length,totalCells:vals.length,partial:vals.some(x=>x===null),at:new Date().toISOString(),source:'TW2 overview visible row; mapped manually'};read++;if(vals.some(x=>x===null))partial++}
save();return lastScan={rows:rows.size,labels,unmatched,read,partial,invalid,errors}}
function button(t,fn){const b=el('button',t);b.onclick=fn;b.style.cssText='padding:6px;margin:3px';return b}
function p(t){return el('p',t)}
function render(message){body.replaceChildren();const vs=owned(),stored=vs.filter(v=>raw(v)).length;
body.append(p(`Owned villages: ${vs.length} | Captured unit rows: ${stored} | Remaining: ${vs.length-stored}`));const notice=p(message||'Existing captured data is preserved. No game commands are sent.');notice.style.cssText='background:#203b55;padding:10px';body.append(notice);
const bar=el('div');bar.append(button('Read visible Units rows',()=>{panel.style.display='none';setTimeout(()=>{try{const r=scanOverview();render(`Captured ${r.read} rows (${r.partial} partial). ${r.errors.join('; ')}`)}catch(e){render('Scan error: '+e.message)}panel.style.display='block'},500)}));
bar.append(button('Map troop columns',()=>showMapping()));bar.append(button('Plan village roles',()=>{let count=0;for(const v of vs){if(!state.roles[v.id]&&role(v)!=='Unassigned'){state.roles[v.id]=role(v);count++}}save();render(`${count} additional roles saved. Existing assignments preserved.`)}));bar.append(button('Refresh',()=>render()));body.append(bar);
body.append(p('Column names must be confirmed against the unit icons in Overview → Units. Missing cells remain unknown, not zero.'));
const counts=Object.fromEntries(TYPES.map(t=>[t,0]));for(const v of vs)counts[role(v)]++;body.append(p(TYPES.map(t=>`${t}: ${counts[t]}`).join(' | ')));
const search=el('input');search.placeholder='Search villages';search.style.cssText='padding:8px;width:95%';body.append(search);const list=el('div');body.append(list);
function show(){list.replaceChildren();for(const v of vs.filter(v=>!search.value||norm(v.name).includes(norm(search.value))||v.id.includes(search.value))){const line=el('div');line.style.cssText='padding:7px 0;border-bottom:1px solid #40536b';line.append(el('strong',`${v.name} [${v.id}] `));const select=el('select');for(const t of TYPES){const o=el('option',t);o.value=t;select.append(o)}select.value=role(v);select.onchange=()=>{state.roles[v.id]=select.value;save();render(`Saved ${v.name}`)};line.append(select);
const r=raw(v),parts=Object.entries(mapped(v)).map(([k,n])=>`${k}: ${n.toLocaleString()}`);line.append(el('div',r?`Captured ${r.filter(x=>x!==null).length}/${r.length} cells${parts.length?' | '+parts.join(' · '):' | troop columns not mapped'}`:'Troop counts unavailable'));list.append(line)}}search.oninput=show;show()}
function showMapping(){body.replaceChildren();body.append(p('Map the columns from LEFT TO RIGHT, using the troop icons shown above the TW2 Units table. Select Unmapped for anything uncertain. Changes are saved on this device.'));
body.append(button('Back to villages',()=>render()));const sample=owned().find(v=>raw(v)),length=Math.max(14,...owned().map(v=>raw(v)?.length||0));
for(let i=0;i<length;i++){const line=el('div');line.style.cssText='padding:7px;border-bottom:1px solid #40536b;display:flex;gap:12px;align-items:center;flex-wrap:wrap';line.append(el('strong',`Column ${i+1}`));const sel=el('select');for(const unit of UNITS){const o=el('option',unit);o.value=unit;sel.append(o)}sel.value=mapping[i]||'Unmapped';sel.onchange=()=>{mapping[i]=sel.value;save()};line.append(sel);line.append(el('span',sample?`Example ${sample.name}: ${raw(sample)[i]??'unknown'}`:'No captured example'));body.append(line)}
body.append(p('Mapping is provisional until you verify each icon. The game is not modified.'));body.append(button('Save and view village plan',()=>{save();render('Column mapping saved locally.')}))}
function mount(){document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();const opener=button('⚔ War Commander',()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')render()});opener.id='tw2-wc-open';opener.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px';panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';const head=el('div');head.style.cssText='display:flex;justify-content:space-between';head.append(el('h3','War Commander v17 — Troop Column Mapping'));head.append(button('Close',()=>panel.style.display='none'));panel.append(head);body=el('div');panel.append(body);document.body.append(opener,panel)}
window.tw2WarCommander={version:'17.0',getPlan:()=>owned().map(v=>({id:v.id,name:v.name,role:role(v),rawUnitColumns:raw(v),mappedTroops:mapped(v)})),readVisibleUnits:scanOverview,getDiagnostics:()=>lastScan,refresh:()=>render()};
if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
