/* TW2 War Commander v5 — direct visible Units overview reader, planning only */
(()=>{'use strict';
if(window.tw2WarCommander?.version==='7.0')return;
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
 const vs=villages(), byName=new Map(), duplicates=new Set();
 for(const v of vs){const k=norm(v.name);if(byName.has(k))duplicates.add(k);else byName.set(k,v)}
 for(const k of duplicates)byName.delete(k);
 const aliases={spear:['spear','spear_fighter'],sword:['sword','swordsman'],archer:['archer'],axe:['axe'],light_cavalry:['light_cavalry','lightcavalry','light-cavalry'],mounted_archer:['mounted_archer','mountedarcher','mounted-archer'],heavy_cavalry:['heavy_cavalry','heavycavalry','heavy-cavalry'],ram:['ram'],trebuchet:['trebuchet','treb'],noble:['noble','snob']};
 function unitFrom(node){
  const attrs=[];const targets=[node,...node.querySelectorAll('img,[title],[data-unit],[class],[style]')].slice(0,20);
  for(const el of targets)for(const k of ['title','alt','src','class','data-unit','data-unit-type','style','aria-label']){const x=el.getAttribute?.(k);if(x)attrs.push(x)}
  const raw=attrs.join(' ').toLowerCase();
  const hits=Object.entries(aliases).filter(([u,names])=>names.some(name=>new RegExp('(^|[^a-z])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z]|$)').test(raw)));
  return hits.length===1?hits[0][0]:null;
 }
 function cells(row){return [...row.children].filter(c=>visible(c)&&!['SCRIPT','STYLE'].includes(c.tagName))}
 const roots=[...document.querySelectorAll('table,[role="table"],.table,.overview-table,.units-table')].filter(visible);
 let read=0,ambiguous=0,headersFound=0,examples=[],iconColumns=0,rowsExamined=0;
 const inspected=[];
 for(const root of roots){
  const rows=[...root.querySelectorAll('tr,[role="row"]')].filter(visible);
  if(rows.length<2)continue;
  let best=null;
  for(const candidate of rows.slice(0,5)){
   const cs=cells(candidate),mapping={};for(let i=0;i<cs.length;i++){const u=unitFrom(cs[i]);if(u&&!Object.values(mapping).includes(u))mapping[i]=u}
   if(!best||Object.keys(mapping).length>Object.keys(best.mapping).length)best={row:candidate,mapping};
  }
  const mapping=best?.mapping||{};
  inspected.push({rows:rows.length,columns:cells(rows[0]).length,recognised:Object.values(mapping)});
  if(Object.keys(mapping).length<2)continue;
  headersFound++;iconColumns=Math.max(iconColumns,Object.keys(mapping).length);
  for(const row of rows){
   if(row===best.row)continue;rowsExamined++;
   const cs=cells(row);if(cs.length<=Math.max(...Object.keys(mapping).map(Number)))continue;
   const matches=[];
   for(const c of cs.slice(0,3)){
    const texts=[c.textContent,...c.querySelectorAll('[title],[aria-label]')].slice(0,8).map(e=>typeof e==='string'?e:e.getAttribute('title')||e.getAttribute('aria-label'));
    for(const t of texts){const k=norm(t);if(byName.has(k))matches.push(byName.get(k));}
   }
   const unique=[...new Map(matches.map(v=>[v.id,v])).values()];if(unique.length!==1){ambiguous++;continue}
   const units={};let ok=true;
   for(const [i,unit] of Object.entries(mapping)){const value=number(cs[+i]?.textContent);if(value===null){ok=false;break}units[unit]=value}
   if(!ok)continue;
   const v=unique[0];cache[v.id]={units,at:new Date().toISOString(),source:'visible Units overview icons',columns:Object.keys(units),partial:Object.keys(units).length<U.length};read++;if(examples.length<3)examples.push(v.name);
  }
 }
 save();return {read,ambiguous,headersFound,examples,stored:Object.keys(cache).length,iconColumns,rowsExamined,inspected};
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
 p.push(t?'Visible unit values: '+Object.entries(t).map(([k,x])=>k+': '+x).join(', ')+(cache[v.id].partial?' (partial columns)':''):'Troop numbers unavailable');
 return p.join(' • ');
}
let panel,body,status;
function el(tag,text){const e=$(tag);if(text!==undefined)e.textContent=text;return e}
function render(message){if(!body)return;body.replaceChildren();const vs=villages(),dataCount=vs.filter(v=>cache[v.id]).length;
 body.append(el('p',`Owned villages: ${vs.length} | Villages with visible unit readings: ${dataCount} | Remaining: ${vs.length-dataCount}`));
 status=el('p',message||'Ready. Direct reader only reads visible Units tables and does not send commands.');status.style.cssText='padding:9px;background:#203b55;color:#fff';body.append(status);
 const bar=el('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:12px 0';
 const scan=el('button','Read icon-based Units');scan.onclick=()=>{panel.style.display='none';const result=readOverview();panel.style.display='block';render(`Read ${result.read} village rows; ${result.stored} stored in total. Recognised icon columns: ${result.iconColumns}. Unmatched rows: ${result.ambiguous}. ${result.headersFound?'Only current page read; change pages in TW2 and repeat.':'No matching icon headers found; no figures were guessed. Layouts: '+JSON.stringify(result.inspected).slice(0,350)}`)};bar.append(scan);
 const inspect=el('button','Inspect Units layout');
 inspect.onclick=()=>{panel.style.display='none';const report=inspectUnitsLayout();panel.style.display='block';render('Layout inspected. See compact report below.');const pre=el('pre',report);pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#172b3c;color:#e5f1ff;padding:10px;font-size:12px';body.insertBefore(pre,body.children[3]||null)};
 bar.append(inspect);
 const assign=el('button','Plan roles');assign.onclick=()=>{let changed=0;for(const v of vs)if(!state.roles[v.id]){const r=role(v);if(r!=='Unassigned'){state.roles[v.id]=r;changed++}}save();render(`${changed} new roles saved. Existing assignments preserved.`)};bar.append(assign);
 const refresh=el('button','Refresh');refresh.onclick=()=>render('Refreshed stored values; no new game data requested.');bar.append(refresh);body.append(bar);
 body.append(el('p','To read the overview: close this panel, open TW2 Overview → Units, then reopen War Commander and press “Read icon-based Units”. The reader hides this panel during scanning. It only accepts rows with matching owned village names and numeric unit columns.'));
 const counts={};for(const r of TYPES)counts[r]=0;for(const v of vs)counts[role(v)]++;body.append(el('p',TYPES.map(x=>x+': '+counts[x]).join(' | ')));
 const search=el('input');search.placeholder='Search your villages';search.style.cssText='padding:9px;width:95%';body.append(search);const list=el('div');body.append(list);
 function show(){list.replaceChildren();const q=norm(search.value);for(const v of vs.filter(v=>!q||norm(v.name).includes(q)||v.id.includes(q))){const row=el('div');row.style.cssText='padding:9px 2px;border-bottom:1px solid #40536b';row.append(el('strong',v.name+' ['+v.id+'] '));const sel=el('select');for(const r of TYPES){const o=el('option',r);o.value=r;sel.append(o)}sel.value=role(v);sel.onchange=()=>{state.roles[v.id]=sel.value;save();render('Role saved for '+v.name)};row.append(sel);const d=el('div',detail(v));d.style.cssText='font-size:12px;color:#bdcfe3';row.append(d);list.append(row)}}search.oninput=show;show();
}
function mount(){document.getElementById('tw2-wc-open')?.remove();document.getElementById('tw2-wc-panel')?.remove();const b=el('button','⚔ War Commander');b.id='tw2-wc-open';b.style.cssText='position:fixed;right:12px;bottom:90px;z-index:2147483646;background:#173d64;color:white;padding:12px';panel=el('section');panel.id='tw2-wc-panel';panel.style.cssText='display:none;position:fixed;inset:4% 3%;z-index:2147483647;overflow:auto;background:#101923;color:white;padding:15px;border:2px solid #6da6d8;font:14px Arial';const top=el('div');top.style.cssText='display:flex;justify-content:space-between';top.append(el('h3','War Commander v7 — Units Layout Inspector'));const close=el('button','Close');close.onclick=()=>panel.style.display='none';top.append(close);panel.append(top);body=el('div');panel.append(body);b.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')render()};document.body.append(b,panel)}
window.tw2WarCommander={version:'7.0',getPlan:()=>villages().map(v=>({id:v.id,name:v.name,role:role(v),units:cache[v.id]?.units||null,plan:detail(v)})),readVisibleUnits:readOverview,refresh:()=>render()};if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});

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
