/* TW2 War Commander v5 — direct visible Units overview reader, planning only */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='10.0')return;
const KEY='tw2Intel.warCommander.v2', READKEY='tw2Intel.wc.visibleUnits.v5';
const TYPES=['Defence','Nuke','Wall breaker','Noble','Trebuchet','Unassigned'];
const U=['spear','sword','archer','axe','light_cavalry','mounted_archer','heavy_cavalry','ram','trebuchet','noble'];
const LABELS={spear:['spear','spearmen'],sword:['sword','swordsmen'],archer:['archer'],axe:['axe','axemen'],light_cavalry:['light cavalry','lc'],mounted_archer:['mounted archer','ma'],heavy_cavalry:['heavy cavalry','hc'],ram:['ram'],trebuchet:['trebuchet','treb'],noble:['noble']};
const n=x=>Number.isFinite(+x)?Math.max(0,Math.floor(+x)):0;
let state;try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(_){state={}}state.roles||={};state.settings={rams:2000,nobles:5,escort:100,...state.settings};
let cache={};try{cache=JSON.parse(localStorage.getItem(READKEY)||'{}')}catch(_){}
const $=x=>document.createElement(x),collector=()=>window.tw2UnifiedCollector;
const get=k=>{try{return collector()?.[k]?.()||{}}catch(_){return {}}};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem(READKEY,JSON.stringify(cache))}catch(_){}};
function villages(){const owned=get('ownedVillages').ids||[], inv=get('inventory');return owned.map(id=>({...inv[id],id:String(id),name:inv[id]?.name||'Village '+id})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))}
function norm(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ')}
function number(s){const v=String(s||'').trim().replace(/[,\s]/g,'');return /^\d+$/.test(v)?+v:null}
function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('#tw2-wc-panel')}
function readOverview(){
 const vs=villages();
 const byName=new Map(vs.map(v=>[norm(v.name),v]));
 const byId=new Map(vs.map(v=>[String(v.id),v]));
 // TW2 rows can have zero layout bounds in Android WebView despite their
 // descendants being rendered. Do not filter TRs by getBoundingClientRect.
 // The name can be a nested DIV inside the village TD, not a TD itself.
 // Identify each name node, then climb to its actual TR. Avoid treating
 // unrelated game tables as unit rows.
 const rows=[...new Set([...document.querySelectorAll('.column-village-name')].map(e=>e.closest('tr')).filter(Boolean))];
 let read=0,unmatched=0,invalid=0;const examples=[],reasons=[];
 for(const row of rows){
  const nameCell=row.querySelector('.column-village-name');
  if(!nameCell)continue;
  const nameNode=nameCell.querySelector('.name')||nameCell.querySelector('a')||nameCell;
  const raw=[nameNode.textContent,nameCell.textContent,nameNode.getAttribute('title'),nameCell.getAttribute('title')].filter(Boolean);
  let v=null;
  for(const candidate of raw){
   const text=norm(candidate);
   if(byName.has(text)){v=byName.get(text);break}
   // Coordinates and UI controls may be appended to the village label.
   const prefix=text.replace(/\s*\(\s*\d{2,4}\s*[|,:]\s*\d{2,4}\s*\).*$/,'').trim();
   if(byName.has(prefix)){v=byName.get(prefix);break}
  }
  if(!v){
   // TW2 name cell includes an optional village ID; accept it only if it
   // uniquely identifies one of the verified 129 owned village IDs.
   const attrs=[...nameCell.querySelectorAll('[data-id],[data-village-id],[data-village_id]'),nameCell];
   for(const el of attrs){for(const key of ['data-village-id','data-village_id','data-id']){const id=el.getAttribute(key);if(id&&byId.has(id)){v=byId.get(id);break}}if(v)break}
  }
  if(!v){unmatched++;if(reasons.length<3)reasons.push('unmatched name: '+raw[0]);continue}
  const cells=[...row.querySelectorAll('.unit-cell-item')].filter(e=>
    !e.querySelector('.unit-cell-item') && !e.closest('#tw2-wc-panel'));
  // Unit columns may be wrapped; do not mistake their wrapper for a value.
  if(cells.length<8){invalid++;if(reasons.length<3)reasons.push('only '+cells.length+' unit cells: '+v.name);continue}
  const values=[];let valid=true;
  for(const cell of cells){
   const value=number(cell.textContent);
   if(value===null){valid=false;if(reasons.length<3)reasons.push('non-numeric cell '+JSON.stringify(cell.textContent.trim().slice(0,30))+' in '+v.name);break}
   values.push(value);
  }
  if(!valid){invalid++;continue}
  cache[v.id]={rawUnitColumns:values,at:new Date().toISOString(),source:'TW2 Overview Units / .unit-cell-item',columns:[],partial:true};
  read++;if(examples.length<3)examples.push(v.name+' ('+values.length+' columns)');
 }
 save();return {read,unmatched,invalid,found:rows.length,examples,reasons,stored:Object.values(cache).filter(x=>x.rawUnitColumns||x.units).length};
}

function role(v){if(state.roles[v.id])return state.roles[v.id];const t=cache[v.id]?.units;if(t){if(n(t.noble))return 'Noble';if(n(t.ram)>=state.settings.rams)return 'Wall breaker';if(n(t.trebuchet))return 'Trebuchet';const a=n(t.axe)+n(t.light_cavalry)+n(t.mounted_archer),d=n(t.spear)+n(t.sword)+n(t.archer)+n(t.heavy_cavalry);if(a>d&&a)return 'Nuke';if(d)return 'Defence'}
 if(/^A[.\s-]/i.test(v.name))return 'Defence';if(/^H[.\s-]/i.test(v.name))return 'Nuke';return 'Unassigned'}
function detail(v){const t=cache[v.id]?.units,r=role(v),p=[];
 if(r==='Defence')p.push('Defensive recruitment: spears, swords, archers, heavy cavalry');
 if(r==='Nuke')p.push('Offensive recruitment: axes, cavalry, mounted archers');
 if(r==='Wall breaker')p.push(t?.ram!==undefined?`Rams ${t.ram}/${state.settings.rams}; shortage ${Math.max(0,state.settings.rams-t.ram)}`:`Rams target ${state.settings.rams}; current unknown`);
 if(r==='Noble')p.push(`Target ${state.settings.nobles} nobles, ${state.settings.escort} escort units each`);
 if(r==='Trebuchet')p.push('Trebuchet support planning');
 if(r==='Unassigned')p.push('Insufficient data for role');
 p.push(!t&&cache[v.id]?.rawUnitColumns?'Captured '+cache[v.id].rawUnitColumns.length+' numeric troop columns (unit names not yet mapped)':t?'Visible unit values: '+Object.entries(t).map(([k,x])=>k+': '+x).join(', ')+(cache[v.id].partial?' (partial columns)':''):'Troop numbers unavailable');
 return p.join(' • ');
}
let panel,body,status;
function el(tag,text){const e=$(tag);if(text!==undefined)e.textContent=text;return e}
function render(message){if(!body)return;body.replaceChildren();const vs=villages(),dataCount=vs.filter(v=>cache[v.id]).length;
 body.append(el('p',`Owned villages: ${vs.length} | Villages with captured unit rows: ${dataCount} | Remaining: ${vs.length-dataCount}`));
 status=el('p',message||'Ready. Direct reader only reads visible Units tables and does not send commands.');status.style.cssText='padding:9px;background:#203b55;color:#fff';body.append(status);
 const bar=el('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:12px 0';
 const scan=el('button','Read actual Units rows');scan.onclick=()=>{panel.style.display='none';const result=readOverview();panel.style.display='block';render(`Captured ${result.read} owned village rows; ${result.stored} stored. Visible village rows: ${result.found}. Unmatched: ${result.unmatched}. Invalid: ${result.invalid}. ${result.examples.join(', ')}. ${result.reasons.join('; ')}. Values are saved by column position until troop icons are mapped.`)};bar.append(scan);
 const inspect=el('button','Inspect Units layout');
 inspect.onclick=()=>{panel.style.display='none';const report=inspectUnitsLayout();panel.style.display='block';render('Layout inspected. See compact report below.');const pre=el('pre',report);pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#172b3c;color:#e5f1ff;padding:10px;font-size:12px';body.insertBefore(pre,body.children[3]||null)};
 bar.append(inspect);
 const assign=el('button','Plan roles');assign.onclick=()=>{let changed=0;for(const v of vs)if(!state.roles[v.id]){const r=role(v);if(r!=='Unassigned'){state.roles[v.id]=r;changed++}}save();render(`${changed} new roles saved. Existing assignments preserved.`)};bar.append(assign);
 const refresh=el('button','Refresh');refresh.onclick=()=>render('Refreshed stored values; no new game data requested.');bar.append(refresh);body.append(bar);
 body.append(el('p','To read the overview: close this panel, open TW2 Overview → Units, then reopen War Commander and press “Read actual Units rows”. The reader hides this panel during scanning. It reads TW2 column-village-name and unit-cell-item elements, matching verified village names. Numeric columns are not yet assigned troop names.'));
 const counts={};for(const r of TYPES)counts[r]=0;for(const v of vs)counts[role(v)]++;body.append(el('p',TYPES.map(x=>x+': '+counts[x]).join(' | ')));
 const search=el('input');search.placeholder='Search your villages';search.style.cssText='padding:9px;width:95%';body.append(search);const list=el('div');body.append(list);
 function show(){list.replaceChildren();const q=norm(search.value);for(const v of vs.filter(v=>!q||norm(v.name).includes(q)||v.id.includes(q))){const row=el('div');row.style.cssText='padding:9px 2px;border-bottom:1px solid #40536b';row.append(el('strong',v.name+' ['+v.id+'] '));const sel=el('select');for(const r of TYPES){const o=el('option',r);o.value=r;sel.append(o)}sel.value=role(v);sel.onchange=()=>{state.roles[v.id]=sel.value;save();render('Role saved for '+v.name)};row.append(sel);const d=el('div',detail(v));d.style.cssText='font-size:12px;color:#bdcfe3';row.append(d);list.append(row)}}search.oninput=show;show();
}
function mount(){document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();const b=el('button','⚔ War Commander');b.id='tw2-wc-open';b.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px';panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';const top=el('div');top.style.cssText='display:flex;justify-content:space-between';top.append(el('h3','War Commander v10 — Village Row Fix'));const close=el('button','Close');close.onclick=()=>panel.style.display='none';top.append(close);panel.append(top);body=el('div');panel.append(body);b.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')render()};document.body.append(b,panel)}
window.tw2WarCommander={version:'10.0',getPlan:()=>villages().map(v=>({id:v.id,name:v.name,role:role(v),units:cache[v.id]?.units||null,plan:detail(v)})),readVisibleUnits:readOverview,refresh:()=>render()};if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});

function inspectUnitsLayout(){
 const owned=villages(), names=new Set(owned.map(v=>v.name.trim().toLowerCase()));
 const isOurs=t=>names.has(String(t||'').trim().toLowerCase());
 const visibleNode=e=>{try{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('#tw2-wc-panel')}catch(_){return false}};
 const short=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,100);
 const desc=e=>e?{tag:e.tagName,cls:short(typeof e.className==='string'?e.className:''),role:e.getAttribute('role')||'',children:e.children.length,txt:short(e.textContent)}:null;
 const matches=[];
 for(const e of document.querySelectorAll('td,div,span,a')){
  if(matches.length>=5)break;
  if(e.children.length>3||!visibleNode(e))continue;
  if(isOurs(e.textContent))matches.push(e);
 }
 const lines=['TW2 UNITS LAYOUT INSPECTION','Owned villages: '+owned.length,'Visible exact village matches: '+matches.length];
 for(const [i,e] of matches.entries()){
  lines.push('VILLAGE '+(i+1)+': '+short(e.textContent));
  let cur=e;
  for(let depth=0;depth<5&&cur;depth++,cur=cur.parentElement){
   const d=desc(cur);lines.push('  level '+depth+': '+d.tag+' .'+d.cls+' children='+d.children+' text='+d.txt);
   if(depth>=1){const children=[...cur.children].slice(0,20).map(c=>{const im=c.querySelector('img,[style*="background"],[class*="unit"]');return {tag:c.tagName,cls:short(c.className),text:short(c.textContent).slice(0,28),icon:im?short(im.getAttribute('src')||im.getAttribute('title')||im.getAttribute('class')||im.getAttribute('style')):''}});lines.push('  cells '+JSON.stringify(children).slice(0,1300))}
  }
 }
 const imageNodes=[...document.querySelectorAll('img,[title],[data-unit],[class*="unit"]')].filter(visibleNode).slice(0,80);
 lines.push('VISIBLE ICON ELEMENTS (first 12):');
 for(const e of imageNodes.slice(0,12))lines.push('  '+e.tagName+' .'+short(e.className)+' title='+short(e.getAttribute('title'))+' src='+short((e.getAttribute('src')||'').split('?')[0])+' data-unit='+short(e.getAttribute('data-unit')));
 if(!matches.length)lines.push('No exact village text nodes matched. Need inspect rendered village label structure.');
 const report=lines.join('\n').slice(0,13000);
 try{localStorage.setItem('tw2Intel.unitsLayout.v7',report)}catch(_){}
 return report;
}

})();
