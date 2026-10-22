
(function(){
"use strict";
const app=document.getElementById('app');
const EMPRESA={nombre:'Ferrodistribuciones',nit:'1234089022',direccion:'Carrera 4 # 29E-288',tel:'320 750 1732',correo:'ferrodistribuciones.ip@gmail.com'};
const LOGO='/logo.png';
const LOGO_IMG=new Image();LOGO_IMG.src='/logo-pdf.jpg';
const LISTS={cf:'Precio contado ferretería',cr:'Precio crédito ferretería',m1:'Precio 1 mostrador',m2:'Precio 2 mostrador',crm:'Precio crédito ferreterías municipal',esp:'Especial contado Sincelejo (columna retirada)'};
const LIST_ORDER=['cf','cr','m1','m2'];
const CAT_KEYS=['cf','cr','crm','m1','m2'];
const ECO_LISTS={cf:'Precio contado solo ferreterías en Sincelejo',cr:'Precio crédito Sincelejo y precio contado municipal',crm:'Precio crédito ferreterías municipal'};
function isEco(p){return !!p&&((p.prices&&p.prices.crm!=null)||/sanitario ecologico/.test(norm(p.section||'')))}
function LN(k,p){return (isEco(p)&&ECO_LISTS[k])||LISTS[k]}
function keysFor(p){return isEco(p)?['cf','cr','crm','m1','m2']:LIST_ORDER}
const FALLBACK={crm:'cr',esp:'cf'};
const DEFAULT_LIST='m1';
const STOCK_MIN=2;
const ROLES={ventas:'Ventas',bodega:'Bodega',verificacion:'Verificación',despacho:'Despacho',contabilidad:'Contabilidad',gerencia:'Gerencia'};
const STATUS={esperando_precio:['Esperando precio','warn'],por_preparar:['Por preparar','acc'],en_preparacion:['En preparación','acc'],por_verificar:['Por verificar','acc'],por_despachar:['Por despachar','acc'],despachado:['Despachado','ok'],remisionado:['Remisionado','ok'],anulado:['Anulado','bad']};
const ACTIVE=['esperando_precio','por_preparar','en_preparacion','por_verificar','por_despachar','despachado'];
const LIMIT_H={esperando_precio:2,por_preparar:2,en_preparacion:3,por_verificar:1,por_despachar:4,despachado:24};
const PRIO={urgente:['Urgente',0],alta:['Alta',1],normal:['Normal',2]};
const PAY={contado:'Contado',credito:'Crédito'};
const PACK={sin_empacar:['Sin empacar',''],empacado:['Empacado','ok'],agotado:['Agotado','bad'],cantidad:['Cantidad modificada','warn'],pendiente:['Pendiente por empacar','bad'],trasladar:['Se traslada a pedido nuevo','warn'],trasladado:['Trasladado','warn']};
const NAV={
  ventas:[['nuevo','Nuevo pedido'],['mis','Mis pedidos'],['clientes','Clientes'],['catalogo','Precios']],
  bodega:[['bodega','Cola de bodega'],['catalogo','Productos']],
  verificacion:[['verificacion','Por verificar']],
  despacho:[['despacho','Por despachar']],
  contabilidad:[['contabilidad','Remisiones']],
  gerencia:[['tablero','Tablero'],['aprobaciones','Aprobaciones'],['pedidos','Pedidos'],['catalogo','Precios'],['clientes','Clientes'],['equipo','Equipo'],['auditoria','Auditoría']]
};
const S={state:'loading',me:null,setupConfigured:true,err:'',
  products:[],P:{},PH:{},customers:[],C:{},orders:[],O:{},requests:[],R:{},remisiones:[],REM:{},notes:[],N:{},reads:new Set(),audit:[],AU:{},users:{},lastSeen:0,rev:0,
  view:null,role:null,sel:null,back:null,f:{},draft:null,names:{},timeline:{},ui:{},busy:false,dl:true};
try{S.role=localStorage.getItem('ferro-role')}catch(e){}

/* ---------- utilidades ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n==null||isNaN(n)?'—':'$'+Math.round(n).toLocaleString('es-CO');
const pad=(n,w)=>String(n).padStart(w||5,'0');
const now=()=>Date.now();
const clone=o=>JSON.parse(JSON.stringify(o));
const rid=()=>Math.random().toString(36).slice(2,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmtDT=t=>t?new Date(t).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const ago=t=>{if(!t)return '—';const m=Math.max(0,Math.round((now()-t)/60000));if(m<60)return m+' min';const h=Math.floor(m/60);if(h<48)return h+' h '+(m%60)+' min';return Math.floor(h/24)+' días'};
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const pill=(t,c)=>`<span class="pill ${c||''}">${esc(t)}</span>`;
const stPill=s=>pill((STATUS[s]||[s])[0],(STATUS[s]||[])[1]);
const nm=id=>id?(S.names[id]||'Usuario'):'—';
function toast(msg,err){const t=document.getElementById('toast');t.textContent=msg;t.className='toast'+(err?' err':'');t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,err?7000:3500)}

function myRoles(){if(!S.me)return [];if(S.me.roles.includes('gerencia'))return Object.keys(ROLES);return Object.keys(ROLES).filter(k=>S.me.roles.includes(k))}
function priceFor(p,list){if(!p)return {key:null,price:null};const pr=p.prices||{};if(pr[list]!=null)return {key:list,price:pr[list]};const fb=FALLBACK[list];if(fb&&pr[fb]!=null)return {key:fb,price:pr[fb],fallback:true};return {key:null,price:null}}
function stockOf(p){return p&&typeof p.stock==='number'?p.stock:null}
function stockPill(p){const q=stockOf(p);if(q==null)return pill('Sin existencias registradas');if(q<=0)return pill('Agotado en bodega','bad');if(q<=STOCK_MIN)return pill('Quedan '+q,'bad');return pill(q+' en bodega')}
function lowStock(){return S.products.filter(p=>{if(p.inactive)return false;const q=stockOf(p);return q!=null&&q<=STOCK_MIN})}
function custList(cid){const c=S.C[cid];const l=(c&&c.list)||DEFAULT_LIST;return LIST_ORDER.includes(l)?l:(FALLBACK[l]||DEFAULT_LIST)}
function clistOf(id){const c=S.C[id];return c&&c.list?{list:c.list}:null}
function voidOf(id){const o=S.O[id];return o&&o.voided?o.voided:null}
let dupSet=new Set();
function shipQty(l){const s=l.pack&&l.pack.state;if(s==='agotado'||s==='trasladado'||s==='trasladar')return 0;if(s==='cantidad')return Number(l.pack.qty)||0;return Number(l.qty)||0}
function orderTotal(o){return (o.lines||[]).reduce((a,l)=>a+shipQty(l)*(l.price||0),0)}
function priceOk(l){return l.priceSource==='especial'?!!(l.req&&l.req.status==='aprobado'):l.price!=null}
function delayed(o){const h=LIMIT_H[o.status];return h&&o.statusAt&&(now()-o.statusAt)>h*3600000}
function packBlockers(o){const b=[];(o.lines||[]).forEach(l=>{const s=l.pack.state;if(s==='sin_empacar')b.push(`${l.code}: sin marcar como empacado`);if(s==='pendiente')b.push(`${l.code}: pendiente por empacar`)});return b}
function dispatchBlockers(o){const b=[];(o.lines||[]).forEach(l=>{const s=l.pack.state;if(s==='sin_empacar'||s==='pendiente'||s==='trasladar')b.push(`${l.code}: ${PACK[s][0].toLowerCase()}`);if(shipQty(l)>0&&!l.verified)b.push(`${l.code}: sin verificar`);if(shipQty(l)>0&&!priceOk(l))b.push(`${l.code}: precio sin autorización`)});if(!b.length&&!(o.lines||[]).some(l=>shipQty(l)>0))b.push('El pedido no tiene productos para entregar');return b}

/* ---------- datos (servidor) ---------- */
async function api(path,opts){
  opts=opts||{};
  let r;
  try{r=await fetch(path,{method:opts.method||'GET',headers:{'content-type':'application/json','x-ferro':'1','x-role':S.role||''},body:opts.body?JSON.stringify(opts.body):undefined,credentials:'same-origin'})}
  catch(e){const er=new Error('No hay conexión con el servidor. Revisa el internet e intenta de nuevo.');er.status=0;throw er}
  let j={};try{j=await r.json()}catch(e){}
  if(r.status===401&&!opts.auth){S.me=null;S.uid=null;S.state='login';S.err=j.error||'';render();const er=new Error(j.error||'Tu sesión terminó. Vuelve a entrar.');er.status=401;throw er}
  if(!r.ok){const er=new Error(j.error||'No se pudo completar la acción.');er.status=r.status;throw er}
  return j;
}
async function act(type,payload){
  try{const j=await api('/api/action',{method:'POST',body:Object.assign({},payload||{},{type})});await syncNow();return j}
  catch(e){if(e.status===409)await syncNow().catch(()=>{});throw e}
}
function resetData(){S.products=[];S.P={};S.PH={};S.customers=[];S.C={};S.orders=[];S.O={};S.requests=[];S.R={};S.remisiones=[];S.REM={};S.notes=[];S.N={};S.reads=new Set();S.audit=[];S.AU={};S.users={};S.names={};S.rev=0}
function applySync(d){
  if(d.full)resetData();
  d.products.forEach(p=>{p.noCredit=!!p.no_credit;p.inactive=!!p.inactive;S.P[p.id]=p});
  d.priceHistory.forEach(h=>{(S.PH[h.product_id]=S.PH[h.product_id]||[]);if(!S.PH[h.product_id].some(x=>x.id===h.id))S.PH[h.product_id].push({id:h.id,list:h.list,from:h.from_price,to:h.to_price,at:h.at,by:h.by,reason:h.reason})});
  if(d.products.length||d.priceHistory.length){
    S.products=Object.values(S.P).sort((a,b)=>(a.row||1e9)-(b.row||1e9)||a.code.localeCompare(b.code));
    S.products.forEach(p=>{p.priceHistory=(S.PH[p.id]||[]).slice().sort((a,b)=>a.at-b.at)});
    const cnt={};S.products.forEach(p=>cnt[p.code]=(cnt[p.code]||0)+1);dupSet=new Set(Object.keys(cnt).filter(k=>cnt[k]>1));
  }
  d.customers.forEach(c=>S.C[c.id]=c);if(d.customers.length)S.customers=Object.values(S.C).sort((a,b)=>norm(a.name).localeCompare(norm(b.name)));
  d.orders.forEach(o=>S.O[o.id]=o);if(d.orders.length)S.orders=Object.values(S.O).sort((a,b)=>b.createdAt-a.createdAt);
  d.requests.forEach(r=>S.R[r.id]=r);if(d.requests.length)S.requests=Object.values(S.R).sort((a,b)=>b.at-a.at);
  d.remisiones.forEach(r=>S.REM[r.id]=r);if(d.remisiones.length)S.remisiones=Object.values(S.REM).sort((a,b)=>b.at-a.at);
  d.users.forEach(u=>{S.users[u.id]=u;S.names[u.id]=u.name});
  d.notifications.forEach(n=>S.N[n.id]=n);if(d.notifications.length)S.notes=Object.values(S.N).sort((a,b)=>b.id-a.id).slice(0,300);
  d.reads.forEach(id=>S.reads.add(id));
  d.audit.forEach(a=>S.AU[a.id]=a);if(d.audit.length)S.audit=Object.values(S.AU).sort((a,b)=>b.id-a.id).slice(0,1000);
  S.lastSeen=Math.max(S.lastSeen||0,d.auditSeen||0);
  if(d.mailConfigured!==undefined)S.mailConfigured=d.mailConfigured;
  S.rev=d.rev;
}
let syncing=null,syncAgain=false;
async function syncNow(){
  if(syncing){syncAgain=true;return syncing}
  syncing=(async()=>{try{do{syncAgain=false;const d=await api('/api/sync?since='+S.rev);applySync(d)}while(syncAgain)}finally{syncing=null}requestRender()})();
  return syncing;
}
async function poll(){
  if(document.hidden||S.state!=='ready')return;
  try{const r=await api('/api/rev');if(r.rev!==S.rev)await syncNow();setOnline(true)}catch(e){if(e.status===0)setOnline(false)}
}
function setOnline(on){if(S.offline===!on)return;S.offline=!on;requestRender()}
setInterval(poll,12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});

async function init(){
  try{const st=await api('/api/status',{auth:true});if(st.needsSetup){S.state='setup';S.setupConfigured=st.setupConfigured;render();return}}
  catch(e){S.state='error';S.err=e.message;render();return}
  try{const m=await api('/api/me',{auth:true});S.me=m.user}
  catch(e){S.state='login';render();return}
  await afterLogin();
}
async function afterLogin(){
  S.uid=S.me.id;
  if(S.me.mustChange){S.state='password';S.ui={};render();return}
  S.state='loading';render();
  resetData();
  try{await syncNow();S.state='ready'}catch(e){if(e.status!==401){S.state='error';S.err=e.message}}
  render();
  if(S.state==='ready'){const h=decodeURIComponent(location.hash.slice(1));if(h&&S.O[h]){openOrder(h);history.replaceState(null,'','/')}refreshPush().then(()=>requestRender())}
}

/* ---------- render ---------- */
let pending=false;
function typing(){const a=document.activeElement;return a&&app.contains(a)&&(a.tagName==='TEXTAREA'||a.tagName==='SELECT'||(a.tagName==='INPUT'&&!['checkbox','radio','button'].includes(a.type)))}
function requestRender(){if(typing()){pending=true;return}render()}
app.addEventListener('focusout',()=>setTimeout(()=>{if(pending&&!typing()){pending=false;render()}},0));

function myNotes(){return S.notes}
function unread(){return S.notes.filter(n=>!S.reads.has(n.id)).length}

function authScreen(){
  const err=S.err?`<div class="note bad">${esc(S.err)}</div>`:'';
  if(S.state==='loading')return `<div class="auth"><p class="muted">Cargando pedidos, catálogo y avisos…</p></div>`;
  if(S.state==='error')return `<div class="auth panel stack"><h1>No se pudo conectar</h1><p>${esc(S.err||'Revisa tu conexión a internet.')}</p><button class="btn primary" data-a="reload">Intentar de nuevo</button></div>`;
  if(S.state==='setup')return `<form class="auth panel stack" data-form="setup" autocomplete="off"><h1>Instalar la aplicación</h1><p class="sub" style="margin:0">Crea el primer usuario de gerencia. Necesitas el código de instalación que configuraste en Cloudflare.</p>${S.setupConfigured?'':'<div class="note bad">Aún no está configurado el código de instalación (SETUP_CODE) en Cloudflare. Agrégalo y recarga esta página.</div>'}${err}
    <div class="field"><label class="lbl" for="su-code">Código de instalación</label><input id="su-code" name="code" type="password" required></div>
    <div class="field"><label class="lbl" for="su-name">Tu nombre</label><input id="su-name" name="name" required autocomplete="name"></div>
    <div class="field"><label class="lbl" for="su-user">Usuario para entrar</label><input id="su-user" name="username" required autocomplete="username" placeholder="Ej. gerencia"></div>
    <div class="field"><label class="lbl" for="su-pw">Clave (mínimo 8 caracteres)</label><input id="su-pw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="field"><label class="lbl" for="su-pw2">Repite la clave</label><input id="su-pw2" name="password2" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn primary" type="submit" ${S.busy?'disabled':''}>Crear usuario de gerencia</button></form>`;
  if(S.state==='password')return `<form class="auth panel stack" data-form="password"><h1>${S.me&&S.me.mustChange?'Crea tu clave personal':'Cambiar clave'}</h1><p class="sub" style="margin:0">${S.me&&S.me.mustChange?'Tu clave actual es temporal. Escribe una nueva que solo tú conozcas.':'Escribe tu clave actual y la nueva.'}</p>${err}
    <div class="field"><label class="lbl" for="pw-cur">Clave actual</label><input id="pw-cur" name="current" type="password" required autocomplete="current-password"></div>
    <div class="field"><label class="lbl" for="pw-new">Clave nueva (mínimo 8 caracteres)</label><input id="pw-new" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="field"><label class="lbl" for="pw-new2">Repite la clave nueva</label><input id="pw-new2" name="password2" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="actions"><button class="btn primary" type="submit" ${S.busy?'disabled':''}>Guardar clave</button>${S.me&&!S.me.mustChange?'<button class="btn" type="button" data-a="pw-cancel">Cancelar</button>':'<button class="btn" type="button" data-a="logout">Salir</button>'}</div></form>`;
  return `<form class="auth panel stack" data-form="login"><h1>Entrar</h1><p class="sub" style="margin:0">Usa el usuario y la clave que te dio gerencia.</p>${err}
    <div class="field"><label class="lbl" for="li-user">Usuario</label><input id="li-user" name="username" required autocomplete="username" autocapitalize="none"></div>
    <div class="field"><label class="lbl" for="li-pw">Clave</label><input id="li-pw" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn primary" type="submit" ${S.busy?'disabled':''}>Entrar</button><p class="muted" style="margin:0;font-size:.85rem">¿Olvidaste tu clave? Pide a gerencia que la restablezca.</p></form>`;
}
function render(){
  pending=false;
  const sy=window.scrollY;
  if(S.state!=='ready'){app.innerHTML=shell('',authScreen()+`<p class="muted" style="text-align:center;font-size:.8rem;margin-top:18px">${EMPRESA.nombre} · NIT ${EMPRESA.nit}<br>${EMPRESA.direccion} · ${EMPRESA.tel} · ${EMPRESA.correo}</p>`);const f=app.querySelector('form input');if(f&&!typing())f.focus();return}
  const roles=myRoles();
  if(!S.role||!roles.includes(S.role)){S.role=roles.includes('gerencia')?'gerencia':(roles[0]||null)}
  const nav=(S.role?NAV[S.role]:[]).concat([['avisos','Avisos'],['reglas','Reglas']]);
  if(!S.view||(!nav.some(n=>n[0]===S.view)&&S.view!=='pedido'))S.view=nav[0][0];
  let body='';
  try{body=VIEWS[S.view]?VIEWS[S.view]():''}catch(e){console.error(e);body=`<div class="note bad">No se pudo mostrar esta vista: ${esc(e.message)}</div>`}
  const head=`<header class="top"><div class="wrap row"><div class="brand"><img src="${LOGO}" alt="Ferrodistribuciones" width="212" height="42"><small>Pedidos</small></div>
   ${roles.length>1?`<label class="role-pick" for="rolesel">Trabajando como <select id="rolesel" data-a="role">${roles.map(r=>`<option value="${r}" ${r===S.role?'selected':''}>${ROLES[r]}</option>`).join('')}</select></label>`:(roles.length?`<span class="role-pick">${ROLES[roles[0]]}</span>`:'')}
   <button class="bell" data-a="go" data-v="avisos">Avisos${unread()?`<b>${unread()}</b>`:''}</button>
   <details class="usermenu"><summary class="bell">${esc(S.me.name.split(' ')[0])}</summary><div class="menu"><div class="muted" style="font-size:.85rem">${esc(S.me.name)} · ${esc(S.me.username)}</div><button class="btn sm" data-a="pw-open">Cambiar clave</button><button class="btn sm" data-a="logout">Salir</button></div></details></div>
   <nav class="tabs" aria-label="Secciones"><div class="wrap">${nav.map(n=>{const c=n[0]==='auditoria'?unseenChanges().length:n[0]==='aprobaciones'?S.requests.filter(r=>r.status==='pendiente').length:0;return `<button data-a="go" data-v="${n[0]}" ${S.view===n[0]?'aria-current="page"':''}>${esc(n[1])}${c?` <span class="pill bad">${c}</span>`:''}</button>`}).join('')}</div></nav></header>`;
  const warn=(S.offline?`<div class="note bad" style="margin-bottom:14px">Sin conexión con el servidor. Lo que ves puede no estar al día; los cambios no se guardan hasta que vuelva la conexión.</div>`:'')+(!roles.length?`<div class="note" style="margin-bottom:14px">Todavía no tienes un rol asignado. Pide a gerencia que te lo asigne en <b>Equipo</b>.</div>`:'');
  app.innerHTML=head+`<main class="wrap">${warn}${pushBanner()}${body}</main>`;
  window.scrollTo(0,sy);
}

function shell(nav,body){return `<header class="top"><div class="wrap row"><div class="brand"><img src="${LOGO}" alt="Ferrodistribuciones" width="212" height="42"><small>Pedidos</small></div></div></header><main class="wrap">${body}</main>`}

function orderTable(list,opts){
  opts=opts||{};
  if(!list.length)return `<div class="empty">${esc(opts.empty||'No hay pedidos aquí.')}</div>`;
  return `<div class="scroll"><table class="tbl"><thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Prioridad</th><th>Estado</th><th>En este estado</th><th class="r">Líneas</th><th class="r">Valor</th></tr></thead><tbody>
  ${list.map(o=>{const d=delayed(o);const bl=(o.lines||[]).some(l=>l.pack.state==='pendiente');return `<tr class="click" data-a="open" data-id="${esc(o.id)}"><td class="code">${esc(o.id)}${o.origin?`<div class="muted" style="font-size:.78rem">viene de ${esc(o.origin)}</div>`:''}</td><td>${esc(o.customer&&o.customer.name)}</td><td>${esc(nm(o.seller))}</td><td class="prio-${o.priority}">${esc(PRIO[o.priority][0])}</td><td>${stPill(o.status)} ${bl?pill('Pendientes','bad'):''}</td><td class="num">${d?`<span class="pill bad">${ago(o.statusAt)}</span>`:ago(o.statusAt)}</td><td class="r num">${(o.lines||[]).length}</td><td class="r num">${money(orderTotal(o))}</td></tr>`}).join('')}
  </tbody></table></div>`;
}
const byQueue=(a,b)=>(PRIO[a.priority][1]-PRIO[b.priority][1])||(a.createdAt-b.createdAt);

/* ---------- vistas ---------- */
const VIEWS={};

VIEWS.nuevo=function(){
  const d=S.draft||(S.draft={customerId:null,address:'',payment:'contado',priority:'normal',notes:'',lines:[]});
  const c=d.customerId&&S.C[d.customerId];const list=c?custList(c.id):null;
  let custBlock;
  if(c){custBlock=`<div class="head-row"><div><h3>${esc(c.name)}</h3><div class="muted">${esc(c.doc||'Sin documento')} · ${esc(c.city||'')} · ${esc(c.phone||'')}</div><div style="margin-top:4px">${pill('Lista: '+LISTS[list],'acc')} ${clistOf(c.id)?'':pill('Lista por defecto, sin asignar por gerencia','warn')}</div></div><button class="btn sm" data-a="d-cust-clear">Cambiar cliente</button></div>`}
  else custBlock=`<div class="field"><label class="lbl" for="cust-q">Buscar cliente por nombre, NIT o teléfono</label><input id="cust-q" data-k="cust-q" value="${esc(S.f['cust-q']||'')}" autocomplete="off" placeholder="Ej. Ferretería El Tornillo"></div><div id="cust-res">${custResults()}</div><button class="btn sm" data-a="go" data-v="clientes" style="align-self:flex-start">Registrar cliente nuevo</button>`;
  const addrs=c?(c.addresses||[]):[];
  const lines=d.lines.map((l,i)=>{const p=S.P[l.pid];const pf=priceFor(p,list);const credBlk=p&&p.noCredit&&d.payment==='credito';
    const price=draftPrice(l);const opts=keysFor(p).filter(k=>p.prices&&p.prices[k]!=null);
    return `<tr><td class="code">${esc(p.code)}${dupSet.has(p.code)?`<div>${pill('Código repetido','warn')}</div>`:''}</td><td>${esc(p.name)}${credBlk?`<div>${pill('No se vende a crédito','bad')}</div>`:''}<div id="stk-${i}">${stockWarn(p,l.qty)}</div></td>
    <td><div class="qtybox"><button class="btn sm" data-a="d-inc" data-i="${i}" data-d="-1" aria-label="Restar uno">−</button><input class="qty num" type="number" inputmode="numeric" min="1" step="1" id="qty-${i}" data-a="d-qty" data-i="${i}" value="${l.qty}" aria-label="Cantidad de ${esc(p.code)}"><button class="btn sm" data-a="d-inc" data-i="${i}" data-d="1" aria-label="Sumar uno">+</button></div></td>
    <td style="min-width:220px"><select class="in" id="pick-${i}" data-a="d-pick" data-i="${i}" aria-label="Precio de ${esc(p.code)}">${opts.map(k=>`<option value="${k}" ${l.pick===k?'selected':''}>${money(p.prices[k])} · ${esc(LN(k,p))}${k===pf.key?' (lista del cliente)':''}</option>`).join('')}<option value="nuevo" ${l.pick==='nuevo'?'selected':''}>Precio nuevo · lo aprueba gerencia</option></select>
    ${l.pick==='nuevo'?`<div class="stack" style="margin-top:6px;gap:6px"><input class="in num" type="number" inputmode="numeric" min="1" id="sp-price-${i}" data-a="d-sp" data-f="price" data-i="${i}" value="${esc(l.special&&l.special.price||'')}" placeholder="Precio unitario" aria-label="Precio nuevo"><input class="in" id="sp-reason-${i}" data-a="d-sp" data-f="reason" data-i="${i}" value="${esc(l.special&&l.special.reason||'')}" placeholder="Motivo, ej. compra 200 unidades" aria-label="Motivo del precio nuevo"><div>${pill('Requiere aprobación de gerencia','warn')}</div></div>`:(pf.key&&l.pick!==pf.key?`<div style="margin-top:4px">${pill('Distinto a la lista del cliente','acc')}</div>`:'')}</td>
    <td class="r num" id="sub-${i}">${money(price!=null?price*l.qty:null)}</td>
    <td><button class="btn sm danger" data-a="d-del" data-i="${i}" aria-label="Quitar línea">Quitar</button></td></tr>`}).join('');
  const total=draftTotal();
  return `<h1>Nuevo pedido</h1><p class="sub">Cada producto propone el precio de la lista del cliente. Puedes elegir cualquiera de los otros precios de la lista o escribir un precio nuevo; el precio nuevo debe aprobarlo gerencia antes de que el pedido pase a bodega.</p>
  <div class="stack">
  <section class="panel stack"><span class="lbl">1 · Cliente</span>${custBlock}</section>
  ${c?`<section class="panel stack"><span class="lbl">2 · Entrega y pago</span><div class="grid2">
    <div class="field"><label class="lbl" for="d-address">Dirección de entrega</label><select id="d-address" data-a="d-field" data-k2="address"><option value="">Elige una dirección</option>${addrs.map(a=>`<option ${d.address===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="d-payment">Forma de pago</label><select id="d-payment" data-a="d-field" data-k2="payment">${Object.keys(PAY).map(k=>`<option value="${k}" ${d.payment===k?'selected':''}>${PAY[k]}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="d-priority">Prioridad</label><select id="d-priority" data-a="d-field" data-k2="priority">${Object.keys(PRIO).map(k=>`<option value="${k}" ${d.priority===k?'selected':''}>${PRIO[k][0]}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="d-notes">Observaciones</label><input id="d-notes" data-a="d-field" data-k2="notes" value="${esc(d.notes)}" placeholder="Ej. recibir antes de las 4 p. m."></div>
  </div>${!addrs.length?'<div class="note">Este cliente no tiene direcciones. Agrégalas en Clientes.</div>':''}</section>
  <section class="panel stack"><span class="lbl">3 · Productos</span>
    <div class="addrow"><div class="field"><label class="lbl" for="prod-q">Buscar por código o descripción</label><input id="prod-q" data-k="prod-q" value="${esc(S.f['prod-q']||'')}" autocomplete="off" placeholder="Ej. FD-02TSL o codo 1/2"></div><div class="field"><label class="lbl" for="add-qty">Cantidad</label><input id="add-qty" data-k="add-qty" type="number" inputmode="numeric" min="1" step="1" value="${esc(S.f['add-qty']||'1')}"></div></div>
    <div id="prod-res">${prodResults()}</div>
    ${d.lines.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Código</th><th>Descripción</th><th>Cantidad</th><th class="r">Precio</th><th class="r">Subtotal</th><th></th></tr></thead><tbody>${lines}</tbody></table></div>
    <div class="head-row"><span class="muted">${d.lines.length} líneas</span><strong class="num" style="font-size:1.2rem" id="d-total">Total ${money(total)}</strong></div>`:'<div class="empty">Busca un producto y agrégalo.</div>'}
  </section>
  <div class="actions"><button class="btn primary" data-a="d-save" ${S.busy?'disabled':''}>Guardar pedido</button><button class="btn" data-a="d-reset">Descartar</button></div>`:''}
  </div>`;
};
function draftPrice(l){const p=S.P[l.pid];if(l.pick==='nuevo')return Number(l.special&&l.special.price)||null;return p&&p.prices&&p.prices[l.pick]!=null?p.prices[l.pick]:null}
function defaultPick(pid){const d=S.draft;const c=d&&S.C[d.customerId];const pf=priceFor(S.P[pid],c?custList(c.id):DEFAULT_LIST);return pf.key||'nuevo'}
function stockWarn(p,qty){const q=stockOf(p);if(q!=null&&qty>q)return pill(q<=0?'Agotado en bodega':'Pides '+qty+', hay '+q,'bad');return ''}
function draftTotal(){return S.draft?S.draft.lines.reduce((a,l)=>a+(draftPrice(l)||0)*l.qty,0):0}
function updDraftTotals(){if(!S.draft)return;S.draft.lines.forEach((l,i)=>{const w=document.getElementById('stk-'+i);if(w)w.innerHTML=stockWarn(S.P[l.pid],l.qty);const n=document.getElementById('sub-'+i);const pr=draftPrice(l);if(n)n.textContent=money(pr!=null?pr*l.qty:null)});const t=document.getElementById('d-total');if(t)t.textContent='Total '+money(draftTotal())}
function custResults(){
  const q=norm(S.f['cust-q']);if(!q)return '';
  const r=S.customers.filter(c=>norm(c.name+' '+(c.doc||'')+' '+(c.phone||'')).includes(q)).slice(0,12);
  if(!r.length)return `<div class="empty">Ningún cliente coincide. Regístralo en Clientes.</div>`;
  return `<div class="results">${r.map(c=>`<button data-a="d-cust" data-id="${esc(c.id)}"><span class="main"><b>${esc(c.name)}</b> <span class="muted">${esc(c.doc||'')} · ${esc(c.city||'')}</span></span><span class="pill">${esc(LISTS[custList(c.id)])}</span></button>`).join('')}</div>`;
}
function prodSearch(q,limit){q=norm(q);if(!q)return [];const parts=q.split(/\s+/);return S.products.filter(p=>{const h=norm(p.code+' '+p.name+' '+p.section);return parts.every(x=>h.includes(x))}).slice(0,limit||25)}
function prodResults(){
  const d=S.draft;const c=d&&S.C[d.customerId];const list=c?custList(c.id):DEFAULT_LIST;
  const r=prodSearch(S.f['prod-q'],60).filter(p=>!p.inactive).slice(0,25);if(!S.f['prod-q'])return '';
  if(!r.length)return `<div class="empty">Ningún producto coincide.</div>`;
  return `<div class="results">${r.map(p=>{const pf=priceFor(p,list);return `<button data-a="d-add" data-id="${p.id}"><span class="main"><span class="code">${esc(p.code)}</span> ${esc(p.name)} <span class="muted">· ${esc(p.section)}</span> ${dupSet.has(p.code)?pill('Código repetido','warn'):''} ${p.noCredit?pill('No crédito','bad'):''} ${stockPill(p)}</span><span class="num">${pf.price==null?pill('Sin precio','bad'):money(pf.price)}</span></button>`}).join('')}</div>`;
}

VIEWS.mis=function(){
  const mine=S.orders.filter(o=>o.seller===S.uid);
  const act=mine.filter(o=>ACTIVE.includes(o.status)),rest=mine.filter(o=>!ACTIVE.includes(o.status));
  return `<h1>Mis pedidos</h1><p class="sub">Pedidos que registraste con tu usuario. Los que esperan tu acción aparecen marcados.</p>
  ${mine.some(o=>o.status==='esperando_precio'&&(o.lines||[]).some(l=>l.req&&l.req.status==='rechazado'))?`<div class="note bad" style="margin-bottom:12px">Tienes precios especiales rechazados. Abre el pedido para quitar la línea o usar el precio de lista.</div>`:''}
  <h2>En curso</h2>${orderTable(act,{empty:'No tienes pedidos en curso.'})}<h2>Cerrados y anulados</h2>${orderTable(rest,{empty:'Todavía no hay pedidos cerrados.'})}`;
};

VIEWS.clientes=function(){
  const e=S.ui.editCust;const isG=S.role==='gerencia';
  const ed=e?(e==='new'?{name:'',doc:'',phone:'',city:'',addresses:[],payment:'contado',requestedList:DEFAULT_LIST}:S.C[e]):null;
  const q=norm(S.f['cl-q']);const list=S.customers.filter(c=>!q||norm(c.name+' '+(c.doc||'')+' '+(c.city||'')).includes(q));
  const form=ed?`<section class="panel stack"><h2 style="margin-top:0">${e==='new'?'Cliente nuevo':'Editar '+esc(ed.name)}</h2><div class="grid2">
   <div class="field"><label class="lbl" for="c-name">Nombre o razón social</label><input id="c-name" data-k="c-name" value="${esc(S.f['c-name']??ed.name)}"></div>
   <div class="field"><label class="lbl" for="c-doc">NIT o cédula</label><input id="c-doc" data-k="c-doc" value="${esc(S.f['c-doc']??ed.doc)}"></div>
   <div class="field"><label class="lbl" for="c-phone">Teléfono</label><input id="c-phone" data-k="c-phone" value="${esc(S.f['c-phone']??ed.phone)}"></div>
   <div class="field"><label class="lbl" for="c-city">Municipio</label><input id="c-city" data-k="c-city" value="${esc(S.f['c-city']??ed.city)}" placeholder="Ej. Sincelejo"></div>
   <div class="field"><label class="lbl" for="c-pay">Forma de pago habitual</label><select id="c-pay" data-k="c-pay">${Object.keys(PAY).map(k=>`<option value="${k}" ${(S.f['c-pay']??ed.payment)===k?'selected':''}>${PAY[k]}</option>`).join('')}</select></div>
   <div class="field"><label class="lbl" for="c-list">${isG?'Lista de precios asignada':'Lista de precios sugerida (la aprueba gerencia)'}</label><select id="c-list" data-k="c-list">${LIST_ORDER.map(k=>`<option value="${k}" ${(S.f['c-list']??(isG&&e!=='new'?custList(e):ed.requestedList||DEFAULT_LIST))===k?'selected':''}>${LISTS[k]}</option>`).join('')}</select></div>
  </div><div class="field"><label class="lbl" for="c-addr">Direcciones de entrega, una por línea</label><textarea id="c-addr" data-k="c-addr">${esc(S.f['c-addr']??(ed.addresses||[]).join('\n'))}</textarea></div>
  <div class="actions"><button class="btn primary" data-a="c-save">Guardar cliente</button><button class="btn" data-a="c-cancel">Cancelar</button></div></section>`:'';
  return `<div class="head-row"><div><h1>Clientes</h1><p class="sub">Mientras gerencia no asigne una lista, el cliente compra con ${LISTS[DEFAULT_LIST]}.</p></div><button class="btn primary" data-a="c-new">Registrar cliente</button></div>
  <div class="stack">${form}
  <div class="field"><label class="lbl" for="cl-q">Filtrar</label><input id="cl-q" data-k="cl-q" value="${esc(S.f['cl-q']||'')}" placeholder="Nombre, NIT o municipio"></div>
  <div id="cl-res">${custTable(list)}</div></div>`;
};
function custTable(list){
  if(!S.customers.length)return `<div class="empty">Todavía no hay clientes. Registra el primero con el botón de arriba.</div>`;
  if(!list.length)return `<div class="empty">Ningún cliente coincide.</div>`;
  return `<div class="scroll"><table class="tbl"><thead><tr><th>Cliente</th><th>Documento</th><th>Municipio</th><th>Lista de precios</th><th class="r">Direcciones</th><th></th></tr></thead><tbody>${list.map(c=>{const asg=clistOf(c.id);const req=c.requestedList&&(!asg||asg.list!==c.requestedList);return `<tr><td><b>${esc(c.name)}</b><div class="muted">${esc(c.phone||'')}</div></td><td>${esc(c.doc||'—')}</td><td>${esc(c.city||'—')}</td><td>${esc(LISTS[custList(c.id)])}${asg?'':' '+pill('Por defecto','warn')}${req?`<div class="muted" style="font-size:.8rem">Solicitada: ${esc(LISTS[c.requestedList])}</div>`:''}</td><td class="r num">${(c.addresses||[]).length}</td><td><button class="btn sm" data-a="c-edit" data-id="${esc(c.id)}">Editar</button></td></tr>`}).join('')}</tbody></table></div>`;
}

VIEWS.catalogo=function(){
  const secs=[...new Set(S.products.map(p=>p.section))];
  if(!S.products.length)return `<h1>Lista de precios</h1>${S.role==='gerencia'?(S.imp?importPanel():`<section class="panel stack"><h2 style="margin-top:0">Carga la lista de precios</h2><p class="muted" style="margin:0">Sube el Excel de la lista de precios (mismo formato de LISTA DE PRECIOS). Verás un resumen antes de guardar.</p><input type="file" id="imp-file" accept=".xlsx,.xls" data-a="imp-file"></section>`):'<div class="empty">El catálogo aún no está cargado. Gerencia debe importar la lista de precios.</div>'}`;
  return `<h1>Lista de precios</h1><p class="sub">${S.products.length} productos de la lista del 14-10-2026. ${S.role==='gerencia'?'Cada cambio de precio exige un motivo y queda en el historial del producto.':'Solo gerencia puede cambiar precios.'}</p>
  <div class="grid2" style="margin-bottom:12px"><div class="field"><label class="lbl" for="cat-q">Buscar</label><input id="cat-q" data-k="cat-q" value="${esc(S.f['cat-q']||'')}" placeholder="Código o descripción"></div>
  <div class="field"><label class="lbl" for="cat-sec">Sección</label><select id="cat-sec" data-k="cat-sec" data-a="rerender"><option value="">Todas</option>${secs.map(s=>`<option ${S.f['cat-sec']===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
  <div class="field"><label class="lbl" for="cat-flag">Mostrar</label><select id="cat-flag" data-k="cat-flag" data-a="rerender"><option value="">Todos</option><option value="noprice" ${S.f['cat-flag']==='noprice'?'selected':''}>Sin ningún precio</option><option value="dup" ${S.f['cat-flag']==='dup'?'selected':''}>Códigos repetidos</option><option value="lowstock" ${S.f['cat-flag']==='lowstock'?'selected':''}>Existencias de ${STOCK_MIN} o menos</option><option value="nocred" ${S.f['cat-flag']==='nocred'?'selected':''}>No se venden a crédito</option></select></div></div>
  ${S.role==='gerencia'?importPanel():''}
  <div id="cat-res">${catTable()}</div>`;
};
function importPanel(){
  const im=S.imp;
  if(!im)return `<details class="panel" style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600">Actualizar precios desde un Excel nuevo</summary><div class="stack" style="margin-top:10px"><p class="muted" style="margin:0">Sube la lista con el mismo formato de LISTA DE PRECIOS. Antes de guardar verás qué productos cambian, cuáles son nuevos y cuáles ya no aparecen. Cada cambio de precio queda en el historial del producto.</p><input type="file" id="imp-file" accept=".xlsx,.xls" data-a="imp-file"></div></details>`;
  if(im.error)return `<div class="note bad" style="margin-bottom:14px">${esc(im.error)} <button class="btn sm" data-a="imp-x">Cerrar</button></div>`;
  const pl=im.plan;const pc=pl.changed.filter(c=>c.diffs.length).length;
  return `<section class="panel stack" style="margin-bottom:14px"><div class="head-row"><div><h2 style="margin:0">Revisión de ${esc(im.file)}</h2><p class="muted" style="margin:4px 0 0">${pl.items} productos leídos del archivo.</p></div><button class="btn" data-a="imp-x">Cancelar</button></div>
  <div class="stats"><div class="stat" style="cursor:default"><div class="v">${pc}</div><div class="lbl">Con cambio de precio</div></div><div class="stat" style="cursor:default"><div class="v">${pl.changed.length-pc}</div><div class="lbl">Otros cambios</div></div><div class="stat" style="cursor:default"><div class="v">${pl.added.length}</div><div class="lbl">Productos nuevos</div></div><div class="stat" style="cursor:default"><div class="v">${pl.missing.length}</div><div class="lbl">Ya no aparecen</div></div><div class="stat" style="cursor:default"><div class="v">${pl.same}</div><div class="lbl">Sin cambios</div></div></div>
  ${pl.changed.length?`<div class="scroll" style="max-height:320px"><table class="tbl"><thead><tr><th>Código</th><th>Descripción</th><th>Cambios</th></tr></thead><tbody>${pl.changed.slice(0,200).map(c=>`<tr><td class="code">${esc(c.it.code)}</td><td>${esc(c.it.name)}</td><td>${c.diffs.map(d=>`${esc(LN(d.list,c.p))}: ${money(d.from)} → ${money(d.to)}`).join('<br>')}${c.other.length?`<div class="muted">${esc(c.other.join(', '))}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`:''}
  ${pl.added.length?`<div><span class="lbl">Nuevos</span><div class="muted">${pl.added.slice(0,40).map(a=>esc(a.code+' '+a.name)).join(' · ')}${pl.added.length>40?' …':''}</div></div>`:''}
  ${pl.missing.length?`<div><span class="lbl">No están en el archivo</span><div class="muted">${pl.missing.slice(0,40).map(a=>esc(a.code+' '+a.name)).join(' · ')}${pl.missing.length>40?' …':''}</div><label class="check" style="margin-top:6px"><input type="checkbox" id="imp-retire" data-a="imp-retire" ${im.retire?'checked':''}> Retirarlos del buscador de pedidos (se conservan con su historial)</label></div>`:''}
  ${pl.stockDiff.length?`<label class="check"><input type="checkbox" id="imp-stock" data-a="imp-stock" ${im.stock?'checked':''}> Actualizar existencias con la columna U/E del archivo (${pl.stockDiff.length} productos con cantidad distinta)</label>`:''}
  <div class="field"><label class="lbl" for="imp-reason">Motivo del cambio</label><input id="imp-reason" data-k="imp-reason" value="${esc(S.f['imp-reason']||'Nueva lista de precios '+im.file)}"></div>
  <div class="actions"><button class="btn primary" data-a="imp-go" ${im.running||!(pl.changed.length||pl.added.length||(im.retire&&pl.missing.length)||(im.stock&&pl.stockDiff.length))?'disabled':''}>Aplicar cambios</button><span id="imp-prog" class="muted">${im.running?esc(im.progress||''):''}</span></div></section>`;
}
function colKey(h){h=norm(h).toUpperCase().replace(/\s+/g,' ').trim();if(h.includes('ESPECIAL'))return 'esp';if(h.includes('CREDITO FERRETERIAS MUNICIPAL'))return 'crm';if(h.includes('CREDITO'))return 'cr';if(h.includes('CONTADO'))return 'cf';if(h.includes('1 MOSTRADOR'))return 'm1';if(h.includes('2 MOSTRADOR'))return 'm2';if(h==='U/E')return 'ue';return null}
function parseList(rows){
  let section=null,cols={};const out=[];
  rows.forEach((r,i)=>{r=r||[];const b=r[1];if(b==null||String(b).trim()==='')return;const bs=String(b).trim();
    if(norm(bs)==='codigo'){cols={};for(let j=3;j<r.length;j++){const k=colKey(r[j]);if(k)cols[j]=k}return}
    if(r[2]==null||String(r[2]).trim()===''){if(i>1)section=bs;return}
    const p={code:bs,name:String(r[2]).replace(/\s+/g,' ').trim(),section,row:i+1,prices:{},ue:null,noCredit:false};
    for(const j in cols){const v=r[j];if(v==null||v==='')continue;if(typeof v==='string'&&norm(v).includes('no credito')){p.noCredit=true;continue}if(cols[j]==='ue'){p.ue=v;continue}const n=Number(v);if(!isNaN(n))p.prices[cols[j]]=Math.round(n)}
    out.push(p)});
  return out;
}
function planImport(items){
  const byCode={};S.products.forEach(p=>(byCode[p.code]=byCode[p.code]||[]).push(p));const used=new Set();
  const plan={changed:[],added:[],same:0,missing:[],items:items.length,stockDiff:[]};
  items.forEach(it=>{const c=(byCode[it.code]||[]).filter(p=>!used.has(p.id));let m=null;if(c.length===1)m=c[0];else if(c.length>1)m=c.find(p=>norm(p.name)===norm(it.name))||null;
    if(!m){plan.added.push(it);return}used.add(m.id);
    const diffs=[];CAT_KEYS.forEach(k=>{const a=(m.prices||{})[k]??null,b=it.prices[k]??null;if(a!==b)diffs.push({list:k,from:a,to:b})});
    const other=[];if(m.name!==it.name)other.push('nombre');if(m.section!==it.section)other.push('sección');if(!!m.noCredit!==it.noCredit)other.push('venta a crédito');if(typeof it.ue==='number'&&it.ue!==stockOf(m))plan.stockDiff.push({p:m,qty:it.ue});if(m.inactive)other.push('vuelve a la lista');
    if(diffs.length||other.length)plan.changed.push({p:m,it,diffs,other});else plan.same++});
  plan.missing=S.products.filter(p=>!used.has(p.id)&&!p.inactive);return plan;
}
function catTable(){
  const q=S.f['cat-q'],sec=S.f['cat-sec'],fl=S.f['cat-flag'];
  let r=q?prodSearch(q,400):S.products;
  if(sec)r=r.filter(p=>p.section===sec);
  if(fl==='noprice')r=r.filter(p=>!Object.keys(p.prices||{}).length);if(fl==='lowstock'){const ls=new Set(lowStock().map(p=>p.id));r=r.filter(p=>ls.has(p.id))}if(fl==='dup')r=r.filter(p=>dupSet.has(p.code));if(fl==='nocred')r=r.filter(p=>p.noCredit);
  const shown=r.slice(0,150);const isG=S.role==='gerencia';
  if(!r.length)return `<div class="empty">Ningún producto coincide.</div>`;
  return `<div class="scroll"><table class="tbl"><thead><tr><th>Código</th><th>Descripción</th>${CAT_KEYS.map(k=>`<th class="r">${k==='crm'?'Crédito ferreterías municipal (solo ecológica)':esc(LISTS[k])}</th>`).join('')}<th class="r">Existencias (U/E)</th>${isG?'<th></th>':''}</tr></thead><tbody>
  ${shown.map(p=>{const ed=S.ui.editProd===p.id;return `<tr><td class="code">${esc(p.code)}</td><td>${esc(p.name)}<div class="muted" style="font-size:.8rem">${esc(p.section)} ${p.inactive?pill('Retirado','bad'):''} ${dupSet.has(p.code)?pill('Código repetido','warn'):''} ${p.noCredit?pill('No crédito','bad'):''} ${(p.priceHistory||[]).length?pill((p.priceHistory.length)+' cambios','acc'):''}</div></td>
   ${CAT_KEYS.map(k=>`<td class="r num" title="${esc(LN(k,p))}">${ed?`<input class="qty num" type="number" min="0" id="pp-${k}" data-k="pp-${k}" value="${esc(S.f['pp-'+k]??(p.prices[k]??''))}" aria-label="${esc(LN(k,p))}">`:(p.prices[k]!=null?money(p.prices[k]):'<span class="muted">—</span>')}</td>`).join('')}
   <td class="r num">${ed?`<input class="qty num" type="number" id="pp-stock" data-k="pp-stock" value="${esc(S.f['pp-stock']??(stockOf(p)??''))}" aria-label="Existencias">`:(stockOf(p)==null?'<span class="muted">—</span>':`${stockOf(p)}${stockOf(p)<=STOCK_MIN?'<div>'+pill(stockOf(p)<=0?'Agotado':'Bajo','bad')+'</div>':''}`)}</td>${isG?`<td>${ed?'':`<button class="btn sm" data-a="p-edit" data-id="${p.id}">Editar</button>`}</td>`:''}</tr>
   ${ed?`<tr><td colspan="${CAT_KEYS.length+4}"><div class="actions"><div class="field" style="flex:1 1 260px"><label class="lbl" for="pp-reason">Motivo del cambio (precio o existencias)</label><input id="pp-reason" data-k="pp-reason" value="${esc(S.f['pp-reason']||'')}" placeholder="Ej. nueva lista del proveedor"></div><button class="btn primary" data-a="p-save" data-id="${p.id}">Guardar precios</button><button class="btn" data-a="p-cancel">Cancelar</button></div>
   ${(p.priceHistory||[]).length?`<div style="margin-top:10px"><span class="lbl">Historial</span><ul class="timeline" style="margin-top:6px">${p.priceHistory.slice().reverse().map(h=>`<li><span class="muted num">${fmtDT(h.at)}</span><span>${esc(LN(h.list,p))}: ${money(h.from)} → ${money(h.to)} · ${esc(nm(h.by))} · ${esc(h.reason)}</span></li>`).join('')}</ul></div>`:''}</td></tr>`:''}`}).join('')}
  </tbody></table></div>${r.length>shown.length?`<p class="muted">Se muestran 150 de ${r.length}. Escribe en el buscador para acotar.</p>`:''}`;
}

VIEWS.bodega=function(){
  const q=S.orders.filter(o=>o.status==='por_preparar').sort(byQueue);
  const w=S.orders.filter(o=>o.status==='en_preparacion').sort((a,b)=>(a.picker===S.uid?0:1)-(b.picker===S.uid?0:1)||byQueue(a,b));
  return `<h1>Cola de bodega</h1><p class="sub">Ordenada por prioridad y luego por antigüedad. Toma un pedido para quedar como responsable de prepararlo.</p>
  <h2>En preparación</h2>${orderTable(w,{empty:'Nadie está preparando pedidos ahora.'})}
  <h2>Por preparar</h2>${orderTable(q,{empty:'No hay pedidos esperando bodega.'})}`;
};
VIEWS.verificacion=function(){
  return `<h1>Por verificar</h1><p class="sub">Revisa productos y cantidades. Si algo no coincide, devuelve el pedido a preparación con el motivo.</p>${orderTable(S.orders.filter(o=>o.status==='por_verificar').sort(byQueue),{empty:'No hay pedidos por verificar.'})}`;
};
VIEWS.despacho=function(){
  return `<h1>Por despachar</h1><p class="sub">Un pedido sale solo si no tiene bloqueos. Registra conductor y vehículo al despachar.</p>${orderTable(S.orders.filter(o=>o.status==='por_despachar').sort(byQueue),{empty:'No hay pedidos listos para despacho.'})}
  <h2>Despachados hoy</h2>${orderTable(S.orders.filter(o=>o.dispatch&&new Date(o.dispatch.at).toDateString()===new Date().toDateString()),{empty:'Todavía no sale ningún pedido hoy.'})}`;
};
VIEWS.contabilidad=function(){
  const q=norm(S.f['rem-q']);
  const rems=S.remisiones.filter(r=>!q||norm(r.id+' '+r.orderId+' '+r.customer.name+' '+(r.customer.doc||'')).includes(q));
  return `<h1>Remisiones</h1><p class="sub">La remisión guarda una copia fija del pedido despachado: si el pedido cambia después, la remisión no cambia. No es una factura electrónica.</p>
  <h2>Despachados sin remisión</h2>${orderTable(S.orders.filter(o=>o.status==='despachado').sort((a,b)=>a.dispatch.at-b.dispatch.at),{empty:'No hay pedidos pendientes de remisión.'})}
  <h2>Remisiones generadas</h2><div class="field" style="margin-bottom:10px"><label class="lbl" for="rem-q">Buscar</label><input id="rem-q" data-k="rem-q" value="${esc(S.f['rem-q']||'')}" placeholder="Número, pedido o cliente"></div>
  <div id="rem-res">${remTable(rems)}</div>`;
};
function remTable(rems){
  if(!rems.length)return `<div class="empty">No hay remisiones${S.f['rem-q']?' que coincidan':' todavía'}.</div>`;
  return `<div class="scroll"><table class="tbl"><thead><tr><th>Remisión</th><th>Pedido</th><th>Cliente</th><th>Fecha</th><th class="r">Valor</th><th></th></tr></thead><tbody>${rems.map(r=>`<tr><td class="code">${esc(r.id)}</td><td class="code"><button class="back" style="margin:0" data-a="open" data-id="${esc(r.orderId)}">${esc(r.orderId)}</button></td><td>${esc(r.customer.name)}</td><td class="num">${fmtDT(r.at)}</td><td class="r num">${money(r.total)}</td><td>${S.dl?`<button class="btn sm" data-a="pdf-rem" data-id="${esc(r.id)}">PDF</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}

VIEWS.tablero=function(){
  const cnt={};S.orders.forEach(o=>cnt[o.status]=(cnt[o.status]||0)+1);
  const late=S.orders.filter(o=>ACTIVE.includes(o.status)&&delayed(o)).sort((a,b)=>a.statusAt-b.statusAt);
  const blocked=S.orders.filter(o=>ACTIVE.includes(o.status)&&((o.lines||[]).some(l=>l.pack.state==='pendiente')||(o.returns||[]).length&&o.status==='en_preparacion'||(o.lines||[]).some(l=>l.req&&l.req.status==='rechazado')));
  const pend=S.requests.filter(r=>r.status==='pendiente').length;
  const today=new Date().toDateString();
  const remToday=S.remisiones.filter(r=>new Date(r.at).toDateString()===today);
  const lists=S.customers.filter(c=>c.requestedList&&(!clistOf(c.id)||clistOf(c.id).list!==c.requestedList)).length;
  const unauth=S.orders.filter(o=>(o.status==='anulado'&&!voidOf(o.id))||(ACTIVE.includes(o.status)&&o.status!=='esperando_precio'&&(o.lines||[]).some(l=>shipQty(l)>0&&!priceOk(l))));
  return `<h1>Tablero de gerencia</h1><p class="sub">Estado de la operación en este momento. Los tiempos límite por etapa están en Reglas.</p>
  <div class="stats">
   <button class="stat ${pend?'hot':''}" data-a="go" data-v="aprobaciones"><div class="v">${pend+lists}</div><div class="lbl">Aprobaciones pendientes</div></button>
   <button class="stat ${late.length?'hot':''}" data-a="scroll" data-t="late"><div class="v">${late.length}</div><div class="lbl">Pedidos retrasados</div></button>
   <button class="stat ${blocked.length?'hot':''}" data-a="scroll" data-t="blocked"><div class="v">${blocked.length}</div><div class="lbl">Con bloqueos</div></button>
   <button class="stat ${unseenChanges().length?'hot':''}" data-a="go" data-v="auditoria"><div class="v">${unseenChanges().length}</div><div class="lbl">Cambios sin revisar</div></button>
   <button class="stat" data-a="go" data-v="avisos"><div class="v">${unread()}</div><div class="lbl">Avisos sin leer</div></button>
   <button class="stat ${lowStock().length?'hot':''}" data-a="lowstock"><div class="v">${lowStock().length}</div><div class="lbl">Productos con ${STOCK_MIN} o menos</div></button>
   <div class="stat" style="cursor:default"><div class="v">${remToday.length}</div><div class="lbl">Remisiones hoy · ${money(remToday.reduce((a,r)=>a+r.total,0))}</div></div>
  </div>
  ${unauth.length?`<div class="note bad" style="margin-top:14px"><b>Revisar:</b> ${unauth.map(o=>esc(o.id)).join(', ')} tienen un precio especial o una anulación sin autorización registrada.</div>`:''}
  <h2>Pedidos por etapa</h2><div class="stats">${Object.keys(STATUS).map(s=>`<button class="stat" data-a="filter" data-s="${s}"><div class="v">${cnt[s]||0}</div><div class="lbl">${STATUS[s][0]}</div></button>`).join('')}</div>
  <h2 id="late">Retrasados</h2>${orderTable(late,{empty:'Ningún pedido supera el tiempo límite de su etapa.'})}
  <h2 id="blocked">Con bloqueos o devueltos</h2>${orderTable(blocked,{empty:'No hay pedidos bloqueados.'})}`;
};
VIEWS.aprobaciones=function(){
  const pend=S.requests.filter(r=>r.status==='pendiente').sort((a,b)=>a.at-b.at);
  const done=S.requests.filter(r=>r.status!=='pendiente').slice(0,30);
  const lists=S.customers.filter(c=>c.requestedList&&(!clistOf(c.id)||clistOf(c.id).list!==c.requestedList));
  return `<h1>Aprobaciones</h1><p class="sub">Ningún precio especial se aplica hasta que lo apruebes. Puedes aprobar un valor distinto al solicitado.</p>
  <h2>Precios especiales por decidir</h2>${pend.length?`<div class="stack">${pend.map(r=>{const p=S.P[r.pid];const o=S.O[r.orderId];return `<div class="panel stack"><div class="head-row"><div><span class="code">${esc(r.code)}</span> ${esc(r.name)}<div class="muted">${esc(r.customerName)} · pedido <button class="back" style="margin:0" data-a="open" data-id="${esc(r.orderId)}">${esc(r.orderId)}</button> · ${r.qty} unidades · pidió ${esc(nm(r.by))} hace ${ago(r.at)}</div></div><div class="num" style="text-align:right"><div class="lbl">Solicitado</div><b style="font-size:1.2rem">${money(r.price)}</b><div class="muted">Lista ${esc(r.list?LISTS[r.list]:'')}: ${money(r.listPrice)}</div></div></div>
      <div class="muted">Motivo: ${esc(r.reason)}</div>${o&&o.status==='anulado'?'<div class="note">El pedido fue anulado.</div>':''}
      <div class="actions"><div class="field" style="flex:0 1 160px"><label class="lbl" for="ap-${r.id}">Precio aprobado</label><input id="ap-${r.id}" data-k="ap-${r.id}" type="number" min="0" value="${esc(S.f['ap-'+r.id]??r.price)}"></div><div class="field" style="flex:1 1 220px"><label class="lbl" for="an-${r.id}">Nota (obligatoria para rechazar)</label><input id="an-${r.id}" data-k="an-${r.id}" value="${esc(S.f['an-'+r.id]||'')}"></div><button class="btn ok" data-a="req-ok" data-id="${r.id}">Aprobar</button><button class="btn danger" data-a="req-no" data-id="${r.id}">Rechazar</button></div></div>`}).join('')}</div>`:'<div class="empty">No hay solicitudes de precio pendientes.</div>'}
  <h2>Listas de precios solicitadas para clientes</h2>${lists.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Cliente</th><th>Lista actual</th><th>Solicitada</th><th></th></tr></thead><tbody>${lists.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(LISTS[custList(c.id)])}</td><td>${esc(LISTS[c.requestedList])}</td><td><div class="actions"><button class="btn sm ok" data-a="list-ok" data-id="${esc(c.id)}">Asignar</button><button class="btn sm" data-a="list-no" data-id="${esc(c.id)}">Mantener actual</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay solicitudes de lista.</div>'}
  <h2>Decididas recientemente</h2>${done.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Producto</th><th>Cliente</th><th class="r">Solicitado</th><th>Decisión</th><th>Nota</th></tr></thead><tbody>${done.map(r=>`<tr><td><span class="code">${esc(r.code)}</span> ${esc(r.name)}</td><td>${esc(r.customerName)}</td><td class="r num">${money(r.price)}</td><td>${r.status==='aprobado'?pill('Aprobado '+money(r.approvedPrice),'ok'):pill('Rechazado','bad')}</td><td>${esc(r.note||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aún no hay decisiones.</div>'}`;
};
VIEWS.pedidos=function(){
  const st=S.f['ord-st']||'',q=norm(S.f['ord-q']);
  const r=S.orders.filter(o=>(!st||o.status===st)&&(!q||norm(o.id+' '+(o.customer&&o.customer.name)+' '+nm(o.seller)).includes(q)));
  return `<div class="head-row"><h1>Todos los pedidos</h1>${S.dl&&S.orders.length?'<button class="btn" data-a="csv">Exportar a Excel (CSV)</button>':''}</div><div class="grid2" style="margin:12px 0"><div class="field"><label class="lbl" for="ord-q">Buscar</label><input id="ord-q" data-k="ord-q" value="${esc(S.f['ord-q']||'')}" placeholder="Número, cliente o vendedor"></div><div class="field"><label class="lbl" for="ord-st">Estado</label><select id="ord-st" data-k="ord-st" data-a="rerender"><option value="">Todos</option>${Object.keys(STATUS).map(s=>`<option value="${s}" ${st===s?'selected':''}>${STATUS[s][0]}</option>`).join('')}</select></div></div><div id="ord-res">${orderTable(r)}</div>`;
};
function tempPassword(){const c='abcdefghjkmnpqrstuvwxyz23456789';let s='';const r=crypto.getRandomValues(new Uint8Array(10));for(const x of r)s+=c[x%c.length];return s.slice(0,4)+'-'+s.slice(4,8)+s.slice(8)}
VIEWS.equipo=function(){
  const us=Object.values(S.users).sort((a,b)=>(b.active-a.active)||norm(a.name).localeCompare(norm(b.name)));
  const nr=S.ui.newRoles||[];
  const reset=S.ui.reset;
  return `<h1>Equipo y claves</h1><p class="sub">Solo gerencia crea usuarios, asigna roles, restablece claves y bloquea accesos. Cada persona cambia su clave temporal la primera vez que entra.</p>
  <section class="panel stack"><h2 style="margin-top:0">Nuevo usuario</h2><div class="grid2">
    <div class="field"><label class="lbl" for="nu-name">Nombre completo</label><input id="nu-name" data-k="nu-name" value="${esc(S.f['nu-name']||'')}" placeholder="Ej. Carlos Pérez"></div>
    <div class="field"><label class="lbl" for="nu-user">Usuario para entrar</label><input id="nu-user" data-k="nu-user" value="${esc(S.f['nu-user']||'')}" placeholder="Ej. carlos.perez" autocapitalize="none"></div>
    <div class="field"><label class="lbl" for="nu-email">Correo (opcional, para avisos)</label><input id="nu-email" data-k="nu-email" type="email" value="${esc(S.f['nu-email']||'')}" placeholder="nombre@gmail.com" autocapitalize="none"></div>
    <div class="field"><label class="lbl" for="nu-pw">Clave temporal</label><div class="actions" style="flex-wrap:nowrap"><input class="in" id="nu-pw" data-k="nu-pw" value="${esc(S.f['nu-pw']||'')}" autocomplete="off"><button class="btn sm" data-a="u-gen" data-k="nu-pw" type="button">Generar</button></div></div></div>
    <div><span class="lbl">Roles</span><div class="actions" style="margin-top:6px">${Object.keys(ROLES).map(r=>`<label class="check" style="font-weight:500"><input type="checkbox" data-a="nu-role" data-r="${r}" ${nr.includes(r)?'checked':''}> ${ROLES[r]}</label>`).join('')}</div></div>
    <div class="actions"><button class="btn primary" data-a="u-create">Crear usuario</button><span class="muted" style="font-size:.85rem">Entrégale el usuario y la clave temporal en persona o por un medio privado.</span></div></section>
  <h2>Personas</h2>${us.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Persona</th><th>Usuario</th>${Object.keys(ROLES).map(r=>`<th>${ROLES[r]}</th>`).join('')}<th>Avisos por correo</th><th>Estado</th><th></th></tr></thead><tbody>${us.map(u=>`<tr${u.active?'':' style="opacity:.6"'}><td><b>${esc(u.name)}</b>${u.id===S.uid?' '+pill('Tú','acc'):''}</td><td class="code">${esc(u.username||'')}</td>${Object.keys(ROLES).map(r=>`<td><input type="checkbox" data-a="u-role" data-id="${esc(u.id)}" data-r="${r}" ${u.roles.includes(r)?'checked':''} aria-label="${ROLES[r]} para ${esc(u.name)}"></td>`).join('')}<td style="min-width:230px"><div class="stack" style="gap:6px"><div class="actions" style="flex-wrap:nowrap"><input class="in" type="email" id="ue-${esc(u.id)}" data-k="ue-${esc(u.id)}" value="${esc(S.f['ue-'+u.id]??(u.email||''))}" placeholder="Sin correo" aria-label="Correo de ${esc(u.name)}" autocapitalize="none"><button class="btn sm" data-a="u-email" data-id="${esc(u.id)}">Guardar</button></div><div class="actions"><label class="check" style="font-weight:500"><input type="checkbox" data-a="u-mailon" data-id="${esc(u.id)}" ${u.emailOn?'checked':''} ${u.email?'':'disabled'}> Recibir avisos</label>${u.email&&S.mailConfigured?`<button class="btn sm" data-a="u-mailtest" data-id="${esc(u.id)}">Enviar prueba</button>`:''}</div></div></td><td>${u.active?pill('Activo','ok'):pill('Bloqueado','bad')}</td><td><div class="actions">${u.id!==S.uid?`<button class="btn sm ${u.active?'danger':'ok'}" data-a="u-active" data-id="${esc(u.id)}" data-v="${u.active?'0':'1'}">${u.active?'Bloquear':'Desbloquear'}</button>`:''}<button class="btn sm" data-a="u-reset-open" data-id="${esc(u.id)}">Restablecer clave</button></div>
   ${reset===u.id?`<div class="stack" style="margin-top:8px;min-width:240px"><div class="field"><label class="lbl" for="rp-pw">Clave temporal nueva</label><div class="actions" style="flex-wrap:nowrap"><input class="in" id="rp-pw" data-k="rp-pw" value="${esc(S.f['rp-pw']||'')}" autocomplete="off"><button class="btn sm" data-a="u-gen" data-k="rp-pw" type="button">Generar</button></div></div><div class="actions"><button class="btn sm primary" data-a="u-reset" data-id="${esc(u.id)}">Guardar clave temporal</button><button class="btn sm" data-a="ui" data-k="reset" data-v="">Cancelar</button></div></div>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aún no hay usuarios.</div>'}
  ${S.mailConfigured?'':'<div class="note" style="margin-top:14px"><b>El envío de correos aún no está configurado.</b> Puedes anotar los correos desde ya; los avisos empezarán a llegar cuando se configure Brevo en Cloudflare (ver la guía).</div>'}
  <div class="note info" style="margin-top:14px">Los avisos por correo llegan solo a quien tenga correo y la casilla "Recibir avisos" marcada. Quien hace una acción no recibe su propio aviso. Hay un límite de 280 correos al día para no pasar del plan gratuito.</div>
  <div class="note info" style="margin-top:14px">Al bloquear a alguien se cierra su sesión de inmediato. Al restablecer una clave, la persona debe crear una nueva al entrar. Todo queda en Auditoría.</div>`;
};

function unseenChanges(){return S.audit.filter(a=>a.by!==S.uid&&a.at>(S.lastSeen||0))}
VIEWS.auditoria=function(){
  const q=norm(S.f['au-q']),who=S.f['au-who']||'',rg=S.f['au-range']||'';
  const from=rg==='hoy'?new Date().setHours(0,0,0,0):rg==='7'?now()-7*864e5:rg==='nuevos'?(S.lastSeen||0):0;
  const r=S.audit.filter(a=>(!q||norm(a.action+' '+a.ref+' '+a.detail+' '+a.reason).includes(q))&&(!who||a.by===who)&&a.at>=from&&(rg!=='nuevos'||a.by!==S.uid));
  const people=[...new Set(S.audit.map(a=>a.by).filter(Boolean))];const un=unseenChanges().length;
  return `<div class="head-row"><div><h1>Auditoría</h1><p class="sub">Cada cambio que hace cualquier persona queda aquí con su nombre, fecha, detalle y motivo. Se muestran los ${S.audit.length} movimientos más recientes.</p></div><div class="actions"><button class="btn" data-a="backup">Descargar respaldo completo</button>${un?`<button class="btn primary" data-a="au-seen">Marcar ${un} cambio(s) como revisados</button>`:''}</div></div>
  ${un?`<div class="note" style="margin-bottom:12px">Hay <b>${un}</b> cambio(s) de otras personas desde tu última revisión${S.lastSeen?' ('+fmtDT(S.lastSeen)+')':''}.</div>`:''}
  <div class="grid2" style="margin-bottom:10px"><div class="field"><label class="lbl" for="au-q">Buscar</label><input id="au-q" data-k="au-q" value="${esc(S.f['au-q']||'')}" placeholder="Pedido, producto, acción o motivo"></div>
  <div class="field"><label class="lbl" for="au-who">Persona</label><select id="au-who" data-k="au-who" data-a="rerender"><option value="">Todas</option>${people.map(p=>`<option value="${esc(p)}" ${who===p?'selected':''}>${esc(nm(p))}</option>`).join('')}</select></div>
  <div class="field"><label class="lbl" for="au-range">Periodo</label><select id="au-range" data-k="au-range" data-a="rerender"><option value="">Todo</option><option value="nuevos" ${rg==='nuevos'?'selected':''}>Sin revisar</option><option value="hoy" ${rg==='hoy'?'selected':''}>Hoy</option><option value="7" ${rg==='7'?'selected':''}>Últimos 7 días</option></select></div></div>
  <div id="au-res">${r.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Persona</th><th>Rol</th><th>Acción</th><th>Referencia</th><th>Detalle y motivo</th></tr></thead><tbody>${r.map(a=>{const nw=a.by!==S.uid&&a.at>(S.lastSeen||0);return `<tr class="${S.O[a.ref]?'click':''}" ${S.O[a.ref]?`data-a="open" data-id="${esc(a.ref)}"`:''}><td class="num">${fmtDT(a.at)} ${nw?pill('Nuevo','warn'):''}</td><td>${nw?'<b>'+esc(nm(a.by))+'</b>':esc(nm(a.by))}</td><td>${esc(ROLES[a.role]||'')}</td><td>${esc(a.action)}</td><td class="code">${esc(a.ref)}</td><td>${esc(a.detail)}${a.reason?`<div class="muted">Motivo: ${esc(a.reason)}</div>`:''}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No hay movimientos con estos filtros.</div>'}</div>`;
};
VIEWS.avisos=function(){
  const n=myNotes();
  return `<div class="head-row"><div><h1>Avisos</h1><p class="sub">Cambios de estado, incidencias y solicitudes que te tocan según tus roles.</p></div>${unread()?'<button class="btn" data-a="n-all">Marcar todos como leídos</button>':''}</div>
  ${n.length?`<div class="scroll"><table class="tbl"><tbody>${n.map(x=>{const r=S.reads.has(x.id);return `<tr class="${x.ref?'click':''}" data-a="n-open" data-id="${x.id}" data-ref="${esc(x.ref)}"><td style="width:12px">${r?'':'<span class="pill bad" aria-label="Sin leer">•</span>'}</td><td>${r?esc(x.text):'<b>'+esc(x.text)+'</b>'}</td><td class="num muted" style="white-space:nowrap">${fmtDT(x.at)}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No tienes avisos.</div>'}`;
};

VIEWS.pedido=function(){
  const o=S.O[S.sel];if(!o)return `<button class="back" data-a="back">← Volver</button><div class="empty">No se encontró el pedido.</div>`;
  const r=S.role;const isSeller=o.seller===S.uid;
  const bl=dispatchBlockers(o);const pb=packBlockers(o);
  let actions='';
  if(canEditQty(o))actions+=`<button class="btn primary" data-a="o-qty">Guardar cantidades</button>`;
  if(r==='bodega'&&o.status==='por_preparar')actions+=`<button class="btn primary" data-a="o-take">Tomar pedido</button>`;
  if(r==='bodega'&&o.status==='en_preparacion')actions+=`<button class="btn primary" data-a="o-toverify" ${pb.length?'disabled':''}>Enviar a verificación</button>`;
  if(r==='verificacion'&&o.status==='por_verificar')actions+=`<button class="btn primary" data-a="o-verified" ${(o.lines||[]).some(l=>shipQty(l)>0&&!l.verified)||!(o.photos||[]).length?'disabled':''}>Aprobar verificación</button><button class="btn danger" data-a="ui" data-k="ret" data-v="1">Devolver a preparación</button>`;
  if(['por_despachar','despachado','remisionado'].includes(o.status)&&S.dl&&['despacho','gerencia','contabilidad','verificacion'].includes(r))actions+=`<button class="btn" data-a="pdf-del">Orden de entrega (PDF)</button>`;
  if(r==='contabilidad'&&o.status==='despachado')actions+=`<button class="btn primary" data-a="o-rem">Generar remisión</button>`;
  if(o.remisionId&&S.dl&&['contabilidad','gerencia'].includes(r))actions+=`<button class="btn" data-a="pdf-rem" data-id="${esc(o.remisionId)}">Remisión ${esc(o.remisionId)} (PDF)</button>`;
  if(r==='gerencia'&&!['remisionado','anulado'].includes(o.status))actions+=`<button class="btn danger" data-a="ui" data-k="void" data-v="1">Anular pedido</button>`;
  const forms=[];
  if(S.ui.ret)forms.push(`<div class="panel stack"><div class="field"><label class="lbl" for="ret-reason">¿Qué está mal? (se envía a bodega)</label><textarea id="ret-reason" data-k="ret-reason">${esc(S.f['ret-reason']||'')}</textarea></div><div class="actions"><button class="btn danger" data-a="o-return">Devolver a preparación</button><button class="btn" data-a="ui" data-k="ret" data-v="">Cancelar</button></div></div>`);
  if(S.ui.void)forms.push(`<div class="panel stack"><div class="field"><label class="lbl" for="void-reason">Motivo de la anulación (obligatorio)</label><textarea id="void-reason" data-k="void-reason">${esc(S.f['void-reason']||'')}</textarea></div><div class="actions"><button class="btn danger" data-a="o-void">Confirmar anulación</button><button class="btn" data-a="ui" data-k="void" data-v="">Cancelar</button></div></div>`);
  if(r==='despacho'&&o.status==='por_despachar')forms.push(`<div class="panel stack"><span class="lbl">Registrar salida</span>${bl.length?`<div class="note bad"><b>No se puede despachar:</b><ul style="margin:4px 0 0">${bl.map(b=>`<li>${esc(b)}</li>`).join('')}</ul></div>`:''}<div class="grid2"><div class="field"><label class="lbl" for="d-driver">Conductor</label><input id="d-driver" data-k="d-driver" value="${esc(S.f['d-driver']||'')}"></div><div class="field"><label class="lbl" for="d-vehicle">Vehículo (placa)</label><input id="d-vehicle" data-k="d-vehicle" value="${esc(S.f['d-vehicle']||'')}" placeholder="Ej. SXT 482"></div></div><div class="actions"><button class="btn primary" data-a="o-dispatch" ${bl.length?'disabled':''}>Registrar salida</button></div></div>`);
  if(r==='verificacion'&&o.status==='por_verificar')forms.push(photoPanel(o));
  if(r==='bodega'&&o.status==='en_preparacion'&&pb.length)forms.push(`<div class="note">Para enviar a verificación, resuelve: ${pb.map(esc).join('; ')}.</div>`);
  const vd=voidOf(o.id);
  const tl=S.timeline[o.id];
  return `<button class="back" data-a="back">← Volver</button>
  <div class="head-row"><div><h1><span class="code">${esc(o.id)}</span> · ${esc(o.customer.name)}</h1><div class="actions">${stPill(o.status)} <span class="prio-${o.priority}">${PRIO[o.priority][0]}</span> ${o.origin?pill('Pendientes de '+o.origin,'warn'):''} ${delayed(o)?pill('Retrasado '+ago(o.statusAt),'bad'):''}</div></div><strong class="num" style="font-size:1.4rem">${money(orderTotal(o))}</strong></div>
  ${o.status==='anulado'?`<div class="note bad" style="margin-top:12px">Anulado${vd?` por ${esc(nm(vd.by))} el ${fmtDT(vd.at)}. Motivo: ${esc(vd.reason)}`:'. No hay una anulación autorizada por gerencia registrada.'}</div>`:''}
  ${(o.returns||[]).length&&o.status==='en_preparacion'?`<div class="note bad" style="margin-top:12px">Devuelto por verificación: ${esc(o.returns[o.returns.length-1].reason)}</div>`:''}
  <div class="grid2" style="margin-top:14px"><div class="panel kv"><span class="lbl">Cliente</span><span>${esc(o.customer.name)} · ${esc(o.customer.doc||'')}</span><span class="lbl">Dirección</span><span>${esc(o.address)}</span><span class="lbl">Teléfono</span><span>${esc(o.customer.phone||'—')}</span><span class="lbl">Pago</span><span>${PAY[o.payment]} · ${esc(LISTS[o.list]||'')}</span>${o.notes?`<span class="lbl">Notas</span><span>${esc(o.notes)}</span>`:''}</div>
  <div class="panel kv"><span class="lbl">Vendedor</span><span>${esc(nm(o.seller))} · ${fmtDT(o.createdAt)}</span><span class="lbl">Bodega</span><span>${o.picker?esc(nm(o.picker))+' · '+fmtDT(o.takenAt):'—'}</span><span class="lbl">Verificó</span><span>${o.verifier?esc(nm(o.verifier))+' · '+fmtDT(o.verifiedAt):'—'}</span><span class="lbl">Despacho</span><span>${o.dispatch?`${esc(o.dispatch.driver)} · ${esc(o.dispatch.vehicle)} · ${fmtDT(o.dispatch.at)}`:'—'}</span><span class="lbl">Remisión</span><span>${o.remisionId?esc(o.remisionId):'—'}</span></div></div>
  ${actions?`<div class="actions" style="margin-top:14px">${actions}</div>`:''}
  ${forms.length?`<div class="stack" style="margin-top:12px">${forms.join('')}</div>`:''}
  ${(o.photos||[]).length&&!(r==='verificacion'&&o.status==='por_verificar')?`<h2>Fotos de verificación</h2>${photoGrid(o,false)}`:''}
  <h2>Productos</h2><div class="stack">${(o.lines||[]).map(l=>lineCard(o,l)).join('')}</div>
  <h2>Historial</h2>${tl?(tl.length?`<ul class="timeline">${tl.map(a=>`<li><span class="muted num">${fmtDT(a.at)}</span><span><b>${esc(a.action)}</b> · ${esc(nm(a.by))}${a.role?' ('+esc(ROLES[a.role]||a.role)+')':''}${a.detail?' · '+esc(a.detail):''}${a.reason?`<div class="muted">Motivo: ${esc(a.reason)}</div>`:''}</span></li>`).join('')}</ul>`:'<div class="empty">Sin movimientos.</div>'):'<p class="muted">Cargando historial…</p>'}`;
};
function photoGrid(o,canDel){return `<div class="photos">${(o.photos||[]).map(x=>`<figure><a href="/api/photo?id=${esc(x.id)}" target="_blank" rel="noopener"><img src="/api/photo?id=${esc(x.id)}" alt="Foto del pedido ${esc(o.id)}" loading="lazy"></a><figcaption class="muted">${esc(nm(x.by))} · ${fmtDT(x.at)}</figcaption>${canDel?`<button class="btn sm danger" data-a="ph-del" data-id="${esc(x.id)}">Quitar foto</button>`:''}</figure>`).join('')}</div>`}
function photoPanel(o){
  const ph=o.photos||[];const allVer=!(o.lines||[]).some(l=>shipQty(l)>0&&!l.verified);
  return `<div class="panel stack"><span class="lbl">Foto del pedido (obligatoria)</span>
  <p class="muted" style="margin:0">${!allVer?'Primero marca cada producto como verificado. Después toma la foto del pedido.':ph.length?'Listo. Ya puedes aprobar la verificación, o agregar otra foto.':'Todo verificado. Ahora toma una foto del pedido completo, con los productos a la vista. Sin la foto no se puede aprobar.'}</p>
  ${ph.length?photoGrid(o,true):''}
  ${S.ui.phBusy?'<p style="margin:0"><b>Subiendo foto…</b></p>':allVer&&ph.length<4?`<label class="btn ${ph.length?'':'primary'}" style="align-self:flex-start">${ph.length?'Agregar otra foto':'Tomar foto del pedido'}<input type="file" accept="image/*" capture="environment" data-a="ph-file" hidden></label>`:''}</div>`;
}
function canEditQty(o){return ['esperando_precio','por_preparar'].includes(o.status)&&((S.role==='ventas'&&o.seller===S.uid)||S.role==='gerencia')}
function lineCard(o,l){
  const r=S.role;const st=l.pack.state;const p=PACK[st];
  const canPack=r==='bodega'&&o.status==='en_preparacion';
  const canVer=r==='verificacion'&&o.status==='por_verificar'&&shipQty(l)>0;
  const sellerFix=o.seller===S.uid&&r==='ventas'&&o.status==='esperando_precio'&&l.req&&l.req.status==='rechazado';
  const qtyEdit=canEditQty(o);
  const blk=st==='pendiente'||(l.req&&l.req.status!=='aprobado')||(shipQty(l)>0&&!priceOk(l)&&o.status!=='esperando_precio');
  const done=st==='empacado'&&(o.status!=='por_verificar'||l.verified);
  let priceTag='';
  if(l.priceSource==='lista'&&l.listKey)priceTag=pill(LN(l.listKey,S.P[l.pid]),l.custListKey&&l.listKey!==l.custListKey?'acc':'')+(l.custListKey&&l.listKey!==l.custListKey?' '+pill('Distinto a la lista del cliente','acc'):'');
  if(l.priceSource==='especial'){const s=l.req.status;priceTag=s==='aprobado'?(priceOk(l)?pill('Precio especial aprobado','ok'):pill('Precio especial sin autorización','bad')):s==='rechazado'?pill('Precio especial rechazado','bad'):pill('Precio especial por aprobar','warn')}
  const f=S.ui.inc&&S.ui.inc.l===l.id?S.ui.inc.t:null;
  return `<div class="line-card ${done?'done':''} ${blk?'blk':''}"><div class="line-top">
  ${canPack?`<label class="check"><input type="checkbox" data-a="l-pack" data-l="${l.id}" ${st==='empacado'?'checked':''} ${['agotado','trasladar','trasladado'].includes(st)?'disabled':''}><span>Empacado</span></label>`:''}
  ${canVer?`<label class="check"><input type="checkbox" data-a="l-ver" data-l="${l.id}" ${l.verified?'checked':''}><span>Verificado</span></label>`:''}
  <div class="main"><span class="code">${esc(l.code)}</span> ${esc(l.name)}<div class="actions" style="margin-top:4px">${p[0]!=='Sin empacar'||canPack?pill(p[0],p[1]):''} ${priceTag} ${l.verified?pill('Verificado','ok'):''}</div>${l.pack.note?`<div class="muted" style="margin-top:4px">Nota de bodega: ${esc(l.pack.note)}</div>`:''}${l.req&&l.req.note?`<div class="muted">Gerencia: ${esc(l.req.note)}</div>`:''}</div>
  <div class="num" style="text-align:right"><div><b>${st==='cantidad'?`${l.pack.qty} <span class="muted" style="text-decoration:line-through">${l.qty}</span>`:l.qty}</b> und.</div><div class="muted">${money(l.price)} c/u</div><div>${money(shipQty(l)*(l.price||0))}</div></div></div>
  ${canPack?`<div class="actions"><button class="btn sm" data-a="l-inc" data-l="${l.id}" data-t="agotado">Agotado</button><button class="btn sm" data-a="l-inc" data-l="${l.id}" data-t="cantidad">Cambiar cantidad</button><button class="btn sm" data-a="l-inc" data-l="${l.id}" data-t="pendiente">Pendiente por empacar</button><button class="btn sm" data-a="l-inc" data-l="${l.id}" data-t="trasladar">Trasladar a pedido nuevo</button>${st!=='sin_empacar'&&st!=='empacado'?`<button class="btn sm" data-a="l-reset" data-l="${l.id}">Deshacer incidencia</button>`:''}</div>`:''}
  ${f?`<div class="stack">${f==='cantidad'?`<div class="field" style="max-width:200px"><label class="lbl" for="inc-qty">Cantidad que sí se empaca</label><input id="inc-qty" data-k="inc-qty" type="number" min="0" max="${l.qty}" value="${esc(S.f['inc-qty']??'')}"></div>`:''}<div class="field"><label class="lbl" for="inc-note">Nota para el vendedor${f==='pendiente'?' (qué falta y cuándo)':''}</label><input id="inc-note" data-k="inc-note" value="${esc(S.f['inc-note']||'')}"></div><div class="actions"><button class="btn sm primary" data-a="l-inc-ok" data-l="${l.id}">Registrar: ${esc(PACK[f][0])}</button><button class="btn sm" data-a="l-inc-x">Cancelar</button></div></div>`:''}
  ${qtyEdit?`<div class="actions"><label class="lbl" for="oq-${l.id}">Cantidad</label><input class="qty num in" style="width:96px" type="number" inputmode="numeric" min="1" step="1" id="oq-${l.id}" data-k="oq-${l.id}" value="${esc(S.f['oq-'+l.id]??l.qty)}"></div>`:''}
  ${sellerFix?`<div class="actions">${l.listPrice!=null?`<button class="btn sm" data-a="l-uselist" data-l="${l.id}">Usar precio de lista (${money(l.listPrice)})</button>`:''}<button class="btn sm danger" data-a="l-remove" data-l="${l.id}">Quitar línea</button></div>`:''}
  </div>`;
}

VIEWS.reglas=function(){
  const P=S.products;const np=P.filter(p=>!Object.keys(p.prices||{}).length).length;const nc=P.filter(p=>p.noCredit).length;
  const dups=[...dupSet].map(c=>`${c} (${P.filter(p=>p.code===c).map(p=>p.name.toLowerCase()).join(' / ')})`);
  const cnt=k=>P.filter(p=>p.prices&&p.prices[k]!=null).length;
  return `<div class="doc"><h1>Reglas del negocio</h1><p class="sub">Fase 1. Esto es lo que el prototipo aplica hoy. Lo marcado “por aprobar” es una propuesta que gerencia debe confirmar o cambiar.</p>
  <h2>Etapas del pedido y responsables</h2><div class="scroll"><table class="tbl"><thead><tr><th>Etapa</th><th>Responsable</th><th>Sale de la etapa cuando…</th><th class="r">Límite</th></tr></thead><tbody>
  <tr><td>${stPill('esperando_precio')}</td><td>Gerencia</td><td>Todos los precios especiales del pedido están aprobados</td><td class="r">${LIMIT_H.esperando_precio} h</td></tr>
  <tr><td>${stPill('por_preparar')}</td><td>Bodega</td><td>Alguien toma el pedido</td><td class="r">${LIMIT_H.por_preparar} h</td></tr>
  <tr><td>${stPill('en_preparacion')}</td><td>Bodega</td><td>Cada línea está empacada, agotada, con cantidad ajustada o trasladada</td><td class="r">${LIMIT_H.en_preparacion} h</td></tr>
  <tr><td>${stPill('por_verificar')}</td><td>Verificación</td><td>Cada línea a entregar está verificada, o se devuelve a bodega con motivo</td><td class="r">${LIMIT_H.por_verificar} h</td></tr>
  <tr><td>${stPill('por_despachar')}</td><td>Despacho</td><td>Se registra conductor, vehículo y hora, sin bloqueos</td><td class="r">${LIMIT_H.por_despachar} h</td></tr>
  <tr><td>${stPill('despachado')}</td><td>Contabilidad</td><td>Se genera la remisión</td><td class="r">${LIMIT_H.despachado} h</td></tr>
  <tr><td>${stPill('remisionado')}</td><td>—</td><td>Cerrado. La remisión no cambia aunque el pedido cambie.</td><td class="r">—</td></tr>
  <tr><td>${stPill('anulado')}</td><td>Gerencia</td><td>Solo gerencia anula, con motivo. Un pedido remisionado no se anula aquí.</td><td class="r">—</td></tr></tbody></table></div>
  <h2>Qué puede hacer cada rol</h2><ul>
  <li><b>Ventas:</b> registrar clientes y sugerir su lista, crear pedidos, pedir precios especiales, ver “Mis pedidos”, corregir líneas con precio rechazado.</li>
  <li><b>Bodega:</b> tomar pedidos, marcar lo empacado, registrar agotados, cantidades modificadas, pendientes y traslados.</li>
  <li><b>Verificación:</b> verificar línea por línea y devolver a bodega con motivo.</li>
  <li><b>Despacho:</b> descargar la orden de entrega y registrar la salida.</li>
  <li><b>Contabilidad:</b> generar remisiones y descargar sus PDF.</li>
  <li><b>Gerencia:</b> todo lo anterior, más aprobar precios, asignar listas a clientes, cambiar precios, anular pedidos, asignar roles y ver la auditoría.</li></ul>
  <h2>Precios</h2><ul>
  <li>Hay cuatro precios: ${LIST_ORDER.map(k=>`${LISTS[k]} (${cnt(k)} productos)`).join(', ')}.</li>
  <li>Cada cliente tiene una lista asignada por gerencia. <b>Por aprobar:</b> mientras no se asigne, se usa ${LISTS[DEFAULT_LIST]}.</li>
  <li>Los ${S.products.filter(isEco).length} productos de tubería sanitaria ecológica (FD-…TSL, FD-…TSMP, FD-…TSP) tienen sus propios cinco precios: ${['cf','cr','crm','m1','m2'].map(k=>ECO_LISTS[k]||LISTS[k]).join(', ')}.</li>
  <li>En tubería ecológica, al cliente con ${LISTS.cf} se le propone el precio contado solo ferreterías en Sincelejo, y al cliente con ${LISTS.cr} el precio crédito Sincelejo y contado municipal. El precio crédito ferreterías municipal se elige en la línea del pedido.</li>
  <li>La columna “Precio especial contado solo Sincelejo” de la tubería de presión no se usa; si un cliente necesita ese valor, se pide como precio nuevo.</li>
  <li>Al tomar el pedido, el vendedor puede elegir cualquiera de los precios de lista del producto sin aprobación; queda registrado cuál eligió y gerencia ve cuándo es distinto a la lista del cliente.</li>
  <li>Un precio nuevo, que no esté en la lista, siempre requiere aprobación de gerencia. Un producto sin ningún precio solo se vende con precio nuevo aprobado.</li>
  <li>Los productos marcados “NO CRÉDITO” no se pueden incluir en pedidos a crédito.</li>
  <li>Ningún pedido llega a bodega con un precio especial sin aprobar. Cada cambio de precio en el catálogo exige motivo y conserva el valor anterior.</li>
  <li><b>Por confirmar:</b> si los precios de la lista incluyen IVA.</li></ul>
  <h2>Pendientes e incidencias</h2><ul>
  <li><b>Agotado:</b> la línea sale en cero y se avisa al vendedor.</li>
  <li><b>Cantidad modificada:</b> se entrega la cantidad que bodega registra y se avisa al vendedor.</li>
  <li><b>Pendiente por empacar:</b> bloquea el envío a verificación hasta que se empaque o se traslade.</li>
  <li><b>Trasladar:</b> al enviar a verificación, esas líneas pasan a un pedido nuevo vinculado al original, que entra a la cola de bodega.</li>
  <li>Despacho queda bloqueado si alguna línea está sin empacar, pendiente, sin verificar o con precio sin autorización.</li></ul>
  <h2>Existencias</h2><ul><li>La columna U/E del Excel es la cantidad en bodega de cada producto.</li><li>Al registrar la salida de un pedido se descuenta lo entregado. Si gerencia anula un pedido ya despachado, la cantidad vuelve a bodega.</li><li>Cuando un producto queda con ${STOCK_MIN} o menos, y cuando se agota, gerencia y bodega reciben un aviso.</li><li>Gerencia ajusta existencias desde Precios (Editar) con un motivo, o carga las cantidades reales con un Excel nuevo marcando “Actualizar existencias”.</li><li>Ventas ve las existencias al buscar productos y un aviso si pide más de lo que hay; el pedido igual se puede guardar.</li></ul>
  <h2>Consecutivos</h2><ul><li>Pedidos: P-00001 en adelante. Remisiones: R-00001 en adelante. Nunca se reutilizan, ni siquiera si el pedido se anula.</li></ul>
  <h2>Lo que encontramos en el Excel</h2><ul>
  <li>${P.length} productos en ${new Set(P.map(p=>p.section)).size} secciones.</li>
  <li>${dups.length} códigos repetidos que describen productos distintos; se conservan como productos separados: ${esc(dups.join('; '))}.</li>
  <li>El código AB-14 aparece en “Alambre #12 blanco”; parece que debería ser AB-12. <b>Por confirmar.</b></li>
  <li>${np} productos no tienen ningún precio.</li>
  <li>${nc} alambres están marcados “NO CRÉDITO”.</li>
  <li>Las secciones no traen las mismas columnas: la tubería ecológica trae cinco precios propios y la tubería de presión un precio especial de contado para Sincelejo que no se usa.</li></ul>
  <h2>Acceso y seguridad</h2><ul>
  <li>Cada persona entra con su usuario y su clave. Gerencia crea los usuarios, asigna los roles, restablece claves y bloquea a quien ya no trabaje en la empresa.</li>
  <li>La primera vez, y cada vez que gerencia restablece una clave, la persona debe cambiarla antes de trabajar.</li>
  <li>Tras 5 intentos fallidos, el usuario queda bloqueado 15 minutos.</li>
  <li>El servidor valida cada permiso: aunque alguien intente saltarse la pantalla, no puede hacer acciones de otro rol.</li>
  <li>La auditoría no se puede modificar ni borrar desde la aplicación.</li>
  <li>La remisión no reemplaza la factura electrónica ante la DIAN.</li></ul></div>`;
};

/* ---------- acciones ---------- */
async function run(fn){if(S.busy)return;S.busy=true;try{await fn()}catch(e){console.error(e);if(e.status!==401)toast(e.message||String(e),true)}finally{S.busy=false;render()}}
async function loadTimeline(id){try{const r=await api('/api/timeline?ref='+encodeURIComponent(id));S.timeline[id]=r.items;requestRender()}catch(e){S.timeline[id]=[]}}
function openOrder(id){S.back=S.view==='pedido'?S.back:S.view;S.sel=id;S.view='pedido';S.ui={};delete S.timeline[id];loadTimeline(id);render();window.scrollTo(0,0)}
function needText(k,msg){const v=(S.f[k]||'').trim();if(!v)throw new Error(msg);return v}
function patchLine(o,lid,fn){const lines=clone(o.lines);const l=lines.find(x=>x.id===lid);fn(l);return lines}
const A={};
A.go=el=>{S.view=el.dataset.v;S.ui={};render();window.scrollTo(0,0)};
A.back=()=>{S.view=S.back||null;S.ui={};render()};
A.open=el=>openOrder(el.dataset.id);
A.filter=el=>{S.f['ord-st']=el.dataset.s;S.view='pedidos';render()};
A.lowstock=()=>{S.f['cat-flag']='lowstock';S.view='catalogo';render()};
A.scroll=el=>{const t=document.getElementById(el.dataset.t);if(t)t.scrollIntoView({behavior:'smooth'})};
A.ui=el=>{S.ui[el.dataset.k]=el.dataset.v||null;render()};
A['d-cust']=el=>{const c=S.C[el.dataset.id];S.draft.customerId=c.id;S.draft.payment=c.payment||'contado';S.draft.address=(c.addresses||[])[0]||'';S.f['cust-q']='';render()};
A['d-cust-clear']=()=>{S.draft.customerId=null;render()};
A['d-add']=el=>{const d=S.draft;const n=Math.max(1,Math.round(Number(S.f['add-qty'])||1));const ex=d.lines.find(l=>l.pid===el.dataset.id);if(ex)ex.qty+=n;else d.lines.push({pid:el.dataset.id,qty:n,special:null,pick:defaultPick(el.dataset.id)});S.f['prod-q']='';S.f['add-qty']='1';render();const q=document.getElementById('prod-q');if(q)q.focus()};
A['d-inc']=el=>{const l=S.draft.lines[+el.dataset.i];l.qty=Math.max(1,l.qty+Number(el.dataset.d));const inp=document.getElementById('qty-'+el.dataset.i);if(inp)inp.value=l.qty;updDraftTotals()};
A['d-del']=el=>{S.draft.lines.splice(+el.dataset.i,1);S.ui.special=null;render()};
A['d-reset']=()=>{S.draft=null;S.ui={};render()};
A['c-new']=()=>{S.ui.editCust='new';['c-name','c-doc','c-phone','c-city','c-pay','c-list','c-addr'].forEach(k=>delete S.f[k]);render()};
A['c-edit']=el=>{S.ui.editCust=el.dataset.id;['c-name','c-doc','c-phone','c-city','c-pay','c-list','c-addr'].forEach(k=>delete S.f[k]);render();window.scrollTo(0,0)};
A['c-cancel']=()=>{S.ui.editCust=null;render()};
A['p-edit']=el=>{S.ui.editProd=el.dataset.id;delete S.f['pp-stock'];CAT_KEYS.forEach(k=>delete S.f['pp-'+k]);delete S.f['pp-reason'];render()};
A['p-cancel']=()=>{S.ui.editProd=null;render()};
A['imp-x']=()=>{S.imp=null;delete S.f['imp-reason'];render()};
A['imp-file']=async el=>{
  const f=el.files&&el.files[0];if(!f)return;
  try{
    if(!window.XLSX)throw new Error('No se pudo cargar el lector de Excel. Recarga la página.');
    const wb=window.XLSX.read(await f.arrayBuffer(),{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];
    const rg=window.XLSX.utils.decode_range(ws['!ref']);rg.s.c=0;rg.s.r=0;
    const items=parseList(window.XLSX.utils.sheet_to_json(ws,{header:1,defval:null,blankrows:true,range:rg}));
    if(!items.length)throw new Error('El archivo no tiene filas con el formato de la lista de precios (columna CÓDIGO en B y descripción en C).');
    S.imp={file:f.name,plan:planImport(items),retire:false};
  }catch(e){S.imp={error:'No se pudo leer el archivo: '+e.message}}
  render();
};
A['l-inc']=el=>{S.ui.inc={l:el.dataset.l,t:el.dataset.t};delete S.f['inc-qty'];delete S.f['inc-note'];render()};
A['l-inc-x']=()=>{S.ui.inc=null;render()};
A.reload=()=>location.reload();
A.logout=()=>run(async()=>{await pushUnsubscribe();await api('/api/logout',{method:'POST',auth:true}).catch(()=>{});S.me=null;S.uid=null;S.role=null;S.view=null;S.draft=null;S.err='';resetData();S.state='login'});
A['pw-open']=()=>{S.state='password';S.err='';render()};
A['pw-cancel']=()=>{S.state='ready';S.err='';render()};
A['d-save']=()=>run(async()=>{
  const d=S.draft;if(!d.customerId)throw new Error('Elige un cliente.');
  if(!d.address)throw new Error('Elige la dirección de entrega.');
  if(!d.lines.length)throw new Error('Agrega al menos un producto.');
  for(const l of d.lines){const p=S.P[l.pid];if(l.pick==='nuevo'){if(!(Number(l.special&&l.special.price)>0))throw new Error(`Escribe el precio nuevo de ${p.code}.`);if(!(l.special.reason||'').trim())throw new Error(`Escribe el motivo del precio nuevo de ${p.code}.`)}}
  const r=await act('order-create',{customerId:d.customerId,address:d.address,payment:d.payment,priority:d.priority,notes:d.notes,lines:d.lines.map(l=>({pid:l.pid,qty:l.qty,pick:l.pick,special:l.pick==='nuevo'?{price:Number(l.special.price),reason:l.special.reason}:null}))});
  S.draft=null;toast(`Pedido ${r.id} guardado${r.status==='esperando_precio'?'. Espera la aprobación de precios.':' y enviado a bodega.'}`);openOrder(r.id);
});
A['c-save']=()=>run(async()=>{
  const e=S.ui.editCust;const old=e==='new'?{}:S.C[e];const g=k=>(S.f[k]??null);
  const addresses=(g('c-addr')??(old.addresses||[]).join('\n')).split('\n').map(s=>s.trim()).filter(Boolean);
  const isG=S.role==='gerencia';
  const r=await act('customer-save',{id:e==='new'?null:e,name:g('c-name')??old.name??'',doc:g('c-doc')??old.doc??'',phone:g('c-phone')??old.phone??'',city:g('c-city')??old.city??'',payment:g('c-pay')??old.payment??'contado',addresses,requestedList:g('c-list')??(e==='new'?DEFAULT_LIST:(isG?custList(e):(old.requestedList||custList(e))))});
  S.ui.editCust=null;toast('Cliente guardado.');
  if(S.draft&&!S.draft.customerId&&e==='new'){const c=S.C[r.id];if(c){S.draft.customerId=c.id;S.draft.address=(c.addresses||[])[0]||'';S.draft.payment=c.payment;S.view='nuevo'}}
});
A['list-ok']=el=>run(async()=>{await act('customer-list',{id:el.dataset.id});toast('Lista asignada.')});
A['list-no']=el=>run(async()=>{await act('customer-list',{id:el.dataset.id,keep:true});toast('Se mantiene la lista actual.')});
A['p-save']=el=>run(async()=>{
  const p=S.P[el.dataset.id];const reason=needText('pp-reason','Escribe el motivo del cambio.');
  const prices={};CAT_KEYS.forEach(k=>{if('pp-'+k in S.f)prices[k]=String(S.f['pp-'+k]).trim()});
  await act('product-save',{id:p.id,prices,stock:'pp-stock' in S.f?String(S.f['pp-stock']).trim():undefined,reason});
  S.ui.editProd=null;delete S.f['pp-stock'];toast('Cambios guardados.');
});
A['req-ok']=el=>run(()=>decide(el.dataset.id,true));
A['req-no']=el=>run(()=>decide(el.dataset.id,false));
async function decide(id,ok){
  const r=S.R[id];const price=Math.round(Number(S.f['ap-'+id]??r.price));const note=(S.f['an-'+id]||'').trim();
  if(!ok&&!note)throw new Error('Escribe una nota para explicar el rechazo.');
  await act('req-decide',{id,ok,price,note});
  delete S.f['ap-'+id];delete S.f['an-'+id];toast(ok?'Precio aprobado.':'Precio rechazado.');
}
A['imp-go']=()=>run(async()=>{
  const im=S.imp;const pl=im.plan;const reason=String(S.f['imp-reason']??('Nueva lista de precios '+im.file)).trim();if(!reason)throw new Error('Escribe el motivo del cambio.');
  const toItem=(it,id)=>({id:id||null,code:it.code,name:it.name,section:it.section,row:it.row,prices:it.prices,ue:it.ue,noCredit:it.noCredit});
  const byId={};pl.changed.forEach(c=>byId[c.p.id]=toItem(c.it,c.p.id));
  if(im.stock)pl.stockDiff.forEach(sd=>{if(!byId[sd.p.id])byId[sd.p.id]=toItem(sd.it||Object.assign({},sd.p,{ue:sd.qty}),sd.p.id);byId[sd.p.id].ue=sd.qty});
  const items=Object.values(byId).concat(pl.added.map(it=>toItem(it,null)));
  const retire=im.retire?pl.missing.map(p=>p.id):[];
  const chunks=[];for(let i=0;i<items.length;i+=100)chunks.push(items.slice(i,i+100));if(!chunks.length)chunks.push([]);
  im.running=true;
  for(let i=0;i<chunks.length;i++){im.progress=`Guardando parte ${i+1} de ${chunks.length}…`;const e=document.getElementById('imp-prog');if(e)e.textContent=im.progress;
    await api('/api/action',{method:'POST',body:{type:'import-apply',items:chunks[i],retire:i===chunks.length-1?retire:[],stock:!!im.stock,file:im.file,reason,part:chunks.length>1?`${i+1} de ${chunks.length}`:''}})}
  await syncNow();S.imp=null;delete S.f['imp-reason'];toast('Lista de precios actualizada.');
});
A['csv']=()=>run(async()=>{
  const cell=v=>{const s=String(v??'');return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const rows=[['Pedido','Fecha','Estado','Cliente','NIT/CC','Municipio','Vendedor','Pago','Prioridad','Código','Descripción','Cant. pedida','Cant. entregada','Precio','Total línea','Tipo de precio','Remisión']];
  S.orders.forEach(o=>(o.lines||[]).forEach(l=>rows.push([o.id,new Date(o.createdAt).toLocaleString('es-CO'),STATUS[o.status][0],o.customer.name,o.customer.doc,o.customer.city,nm(o.seller),PAY[o.payment],PRIO[o.priority][0],l.code,l.name,l.qty,shipQty(l),l.price,shipQty(l)*(l.price||0),l.priceSource==='especial'?'Nuevo aprobado':(l.listName||'Lista'),o.remisionId||''])));
  downloadBlob(new Blob(['﻿'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv'}),'Pedidos Ferrodistribuciones '+new Date().toISOString().slice(0,10)+'.csv');toast('Archivo descargado.');
});
A['backup']=()=>{location.href='/api/export'};
A['o-qty']=()=>run(async()=>{
  const o=S.O[S.sel];const qtys={};o.lines.forEach(l=>{const k='oq-'+l.id;if(k in S.f)qtys[l.id]=Math.round(Number(S.f[k]))});
  await act('order-qty',{id:o.id,qtys});o.lines.forEach(l=>delete S.f['oq-'+l.id]);toast('Cantidades guardadas.');loadTimeline(o.id);
});
const orderAct=(type,extra,msg)=>run(async()=>{await act(type,Object.assign({id:S.sel},extra||{}));if(msg)toast(msg);loadTimeline(S.sel)});
A['o-take']=()=>orderAct('order-take',{},'Pedido tomado.');
A['l-pack']=el=>orderAct('line-pack',{lineId:el.dataset.l,packed:el.checked});
A['l-ver']=el=>orderAct('line-verify',{lineId:el.dataset.l,verified:el.checked});
A['l-reset']=el=>orderAct('line-reset',{lineId:el.dataset.l});
A['l-inc-ok']=el=>run(async()=>{await act('line-inc',{id:S.sel,lineId:el.dataset.l,kind:S.ui.inc.t,qty:S.f['inc-qty'],note:S.f['inc-note']||''});S.ui.inc=null;loadTimeline(S.sel)});
A['o-toverify']=()=>run(async()=>{const r=await act('order-toverify',{id:S.sel});toast('Enviado a verificación'+(r.newId?`. Las líneas trasladadas quedaron en ${r.newId}.`:'.'));loadTimeline(S.sel)});
A['o-verified']=()=>orderAct('order-verified',{},'Verificación aprobada.');
async function shrinkPhoto(f){
  let img;
  try{img=await createImageBitmap(f,{imageOrientation:'from-image'})}
  catch(e){img=await new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ko(new Error('No se pudo leer la foto. Intenta tomarla de nuevo.'));i.src=URL.createObjectURL(f)})}
  const k=Math.min(1,1280/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
  for(const q of [0.72,0.6,0.5,0.4]){const b=await new Promise(r=>c.toBlob(r,'image/jpeg',q));if(b&&b.size<=850000)return b}
  throw new Error('La foto es demasiado pesada. Intenta tomarla de nuevo.');
}
A['ph-file']=el=>{const f=el.files&&el.files[0];el.value='';if(!f)return;const id=S.sel;
  run(async()=>{S.ui.phBusy=true;render();try{
    const blob=await shrinkPhoto(f);let r;
    try{r=await fetch('/api/photo?order='+encodeURIComponent(id),{method:'POST',headers:{'content-type':'image/jpeg','x-ferro':'1','x-role':S.role||''},body:blob,credentials:'same-origin'})}
    catch(e){throw new Error('No hay conexión con el servidor. Revisa el internet e intenta de nuevo.')}
    let j={};try{j=await r.json()}catch(e){}
    if(!r.ok){if(r.status===409)await syncNow().catch(()=>{});throw new Error(j.error||'No se pudo subir la foto.')}
    await syncNow();toast('Foto subida.');loadTimeline(id);
  }finally{S.ui.phBusy=false}})};
A['ph-del']=el=>orderAct('photo-delete',{photoId:el.dataset.id},'Foto quitada.');
A['o-return']=()=>run(async()=>{const reason=needText('ret-reason','Escribe qué está mal para que bodega lo corrija.');await act('order-return',{id:S.sel,reason});S.ui.ret=null;delete S.f['ret-reason'];loadTimeline(S.sel)});
A['o-dispatch']=()=>run(async()=>{const driver=needText('d-driver','Escribe el nombre del conductor.');const vehicle=needText('d-vehicle','Escribe la placa del vehículo.');await act('order-dispatch',{id:S.sel,driver,vehicle});delete S.f['d-driver'];delete S.f['d-vehicle'];toast('Salida registrada.');loadTimeline(S.sel)});
A['o-rem']=()=>run(async()=>{const r=await act('order-remision',{id:S.sel});toast(`Remisión ${r.id} generada.`);loadTimeline(S.sel)});
A['o-void']=()=>run(async()=>{const reason=needText('void-reason','La anulación necesita un motivo.');await act('order-void',{id:S.sel,reason});S.ui.void=null;delete S.f['void-reason'];loadTimeline(S.sel)});
A['l-uselist']=el=>orderAct('line-fix',{lineId:el.dataset.l,mode:'list'});
A['l-remove']=el=>orderAct('line-fix',{lineId:el.dataset.l,mode:'remove'});
A['n-open']=el=>{const id=Number(el.dataset.id);if(!S.reads.has(id)){S.reads.add(id);api('/api/action',{method:'POST',body:{type:'notif-read',ids:[id]}}).catch(()=>{})}if(el.dataset.ref&&S.O[el.dataset.ref])openOrder(el.dataset.ref);else render()};
A['n-all']=()=>run(async()=>{const ids=S.notes.filter(n=>!S.reads.has(n.id)).map(n=>n.id);ids.forEach(i=>S.reads.add(i));await api('/api/action',{method:'POST',body:{type:'notif-read',ids}})});
A['au-seen']=()=>run(async()=>{const t=Math.max(Date.now(),...S.audit.map(a=>a.at));await api('/api/action',{method:'POST',body:{type:'audit-seen',at:t}});S.lastSeen=t;toast('Cambios marcados como revisados.')});
A['pdf-del']=()=>run(async()=>{const o=S.O[S.sel];await savePdf(buildPdf('ORDEN DE ENTREGA',o.id,{customer:o.customer,address:o.address,payment:o.payment,seller:o.seller,dispatch:o.dispatch,lines:o.lines.filter(l=>shipQty(l)>0).map(l=>({code:l.code,name:l.name,qty:shipQty(l)})),date:o.dispatch?o.dispatch.at:now(),ref:'Pedido '+o.id},false),`Orden de entrega ${o.id}.pdf`)});
A['pdf-rem']=el=>run(async()=>{const r=S.REM[el.dataset.id];if(!r)throw new Error('No se encontró la remisión.');await savePdf(buildPdf('REMISIÓN',r.id,{customer:r.customer,address:r.address,payment:r.payment,seller:r.seller,dispatch:r.dispatch,lines:r.lines,total:r.total,date:r.at,ref:'Pedido '+r.orderId},true),`Remisión ${r.id}.pdf`)});
A['u-gen']=el=>{S.f[el.dataset.k]=tempPassword();render()};
A['nu-role']=el=>{const r=S.ui.newRoles||[];S.ui.newRoles=el.checked?r.concat(el.dataset.r):r.filter(x=>x!==el.dataset.r)};
A['u-create']=()=>run(async()=>{
  const name=needText('nu-name','Escribe el nombre de la persona.');const username=needText('nu-user','Escribe el usuario para entrar.');const password=needText('nu-pw','Escribe o genera una clave temporal.');
  if(!(S.ui.newRoles||[]).length)throw new Error('Marca al menos un rol.');
  const email=(S.f['nu-email']||'').trim();
  await act('user-create',{name,username,password,roles:S.ui.newRoles,email,emailOn:!!email});
  toast(`Usuario creado. Entrégale: usuario ${username.toLowerCase()} · clave ${password}`);['nu-name','nu-user','nu-pw','nu-email'].forEach(k=>delete S.f[k]);S.ui.newRoles=[];
});
A['u-role']=el=>run(async()=>{const u=S.users[el.dataset.id];const roles=el.checked?u.roles.concat(el.dataset.r):u.roles.filter(r=>r!==el.dataset.r);await act('user-update',{id:u.id,roles});toast('Roles actualizados.')});
A['u-active']=el=>run(async()=>{await act('user-update',{id:el.dataset.id,active:el.dataset.v==='1'});toast(el.dataset.v==='1'?'Usuario desbloqueado.':'Usuario bloqueado; su sesión se cerró.')});
A['u-reset-open']=el=>{S.ui.reset=el.dataset.id;S.f['rp-pw']=tempPassword();render()};
A['u-reset']=el=>run(async()=>{const password=needText('rp-pw','Escribe o genera una clave temporal.');await act('user-reset',{id:el.dataset.id,password});S.ui.reset=null;toast(`Clave restablecida. Entrégale la clave temporal: ${password}`)});
/* ---------- avisos en el dispositivo ---------- */
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=()=>window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function b64ToBytes(s){const p='='.repeat((4-s.length%4)%4);const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0))}
async function refreshPush(){
  S.push={status:'unsupported'};
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){S.push.status=isIOS&&!standalone()?'ios':'unsupported';return}
  if(Notification.permission==='denied'){S.push.status='denied';return}
  try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();S.push.status=sub&&Notification.permission==='granted'?'on':'off';if(sub&&S.push.status==='on')api('/api/push/subscribe',{method:'POST',body:sub.toJSON()}).catch(()=>{})}catch(e){S.push.status='off'}
}
async function pushUnsubscribe(){try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint},auth:true}).catch(()=>{});await sub.unsubscribe()}}catch(e){}}
A['push-on']=()=>run(async()=>{
  const perm=await Notification.requestPermission();
  if(perm!=='granted'){S.push.status=perm==='denied'?'denied':'off';throw new Error('No se dio el permiso de notificaciones en este dispositivo.')}
  const reg=await navigator.serviceWorker.ready;const {key}=await api('/api/push/key');
  const sub=(await reg.pushManager.getSubscription())||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(key)});
  await api('/api/push/subscribe',{method:'POST',body:sub.toJSON()});S.push.status='on';toast('Listo: los avisos llegarán a este dispositivo.');
});
A['push-off']=()=>run(async()=>{await pushUnsubscribe();S.push.status='off';toast('Este dispositivo ya no recibirá avisos.')});
A['push-later']=()=>{try{localStorage.setItem('ferro-push-later',String(Date.now()))}catch(e){}S.ui.pushLater=true;render()};
function pushPanel(){
  const st=S.push&&S.push.status;
  if(st==='on')return `<div class="note ok" style="margin-bottom:14px"><div class="head-row"><span>Los avisos llegan a este dispositivo aunque la aplicación esté cerrada.</span><button class="btn sm" data-a="push-off">Desactivar en este dispositivo</button></div></div>`;
  if(st==='off')return `<div class="note info" style="margin-bottom:14px"><div class="head-row"><span>Activa los avisos para recibirlos en este dispositivo aunque la aplicación esté cerrada.</span><button class="btn sm primary" data-a="push-on">Activar avisos</button></div></div>`;
  if(st==='denied')return `<div class="note" style="margin-bottom:14px">Los avisos están bloqueados en este dispositivo. Actívalos en los ajustes del navegador o del teléfono, en los permisos de notificaciones de esta aplicación.</div>`;
  if(st==='ios')return `<div class="note" style="margin-bottom:14px">En iPhone, para recibir avisos primero agrega la aplicación a la pantalla de inicio: botón Compartir → <b>Agregar a inicio</b>. Luego ábrela desde ese ícono y vuelve aquí.</div>`;
  return '';
}
function pushBanner(){
  if(!S.push||S.push.status!=='off'||S.view==='avisos'||S.ui.pushLater)return '';
  try{const t=Number(localStorage.getItem('ferro-push-later')||0);if(Date.now()-t<3*864e5)return ''}catch(e){}
  return `<div class="note info" style="margin-bottom:14px"><div class="head-row"><span><b>Recibe los avisos en este dispositivo</b> aunque la aplicación esté cerrada: pedidos nuevos, precios aprobados, existencias bajas.</span><div class="actions"><button class="btn sm primary" data-a="push-on">Activar avisos</button><button class="btn sm" data-a="push-later">Ahora no</button></div></div></div>`;
}
{const _av=VIEWS.avisos;VIEWS.avisos=function(){return pushPanel()+_av()}}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{const r=e.data&&e.data.open;if(r&&S.O[r])openOrder(r)});
A['u-email']=el=>run(async()=>{const id=el.dataset.id;const email=(S.f['ue-'+id]??'').trim();await act('user-update',{id,email,emailOn:email?S.users[id].emailOn||!S.users[id].email:false});delete S.f['ue-'+id];toast(email?'Correo guardado.':'Correo quitado.')});
A['u-mailon']=el=>run(async()=>{await act('user-update',{id:el.dataset.id,emailOn:el.checked});toast(el.checked?'Avisos por correo activados.':'Avisos por correo desactivados.')});
A['u-mailtest']=el=>run(async()=>{const r=await act('mail-test',{id:el.dataset.id});toast('Correo de prueba enviado a '+r.to+'. Si no llega en unos minutos, revisa la carpeta de spam.')});

/* ---------- PDF ---------- */
function buildPdf(title,num,d,withPrices){
  if(!window.jspdf)throw new Error('No se pudo cargar el generador de PDF. Recarga la página.');
  const doc=new window.jspdf.jsPDF({unit:'mm',format:'letter'});const W=216,M=14;let y=16;
  try{doc.addImage(LOGO_IMG,'JPEG',M,8,70,18.1)}catch(e){doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('FERRODISTRIBUCIONES',M,y)}
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(20,20,20);doc.text(title,W-M,y,{align:'right'});
  doc.setFontSize(11);doc.setTextColor(236,50,55);doc.text('N.º '+num,W-M,y+6,{align:'right'});doc.setTextColor(20,20,20);
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(d.ref+' · '+fmtDT(d.date),W-M,y+11,{align:'right'});doc.setFontSize(8);doc.setTextColor(90,90,90);doc.text(`NIT ${EMPRESA.nit} · ${EMPRESA.direccion}`,M,30);doc.text(`Tel. ${EMPRESA.tel} · ${EMPRESA.correo}`,M,34);doc.setTextColor(20,20,20);y=38;
  doc.setDrawColor(236,50,55);doc.setLineWidth(0.8);doc.line(M,y,W-M,y);doc.setLineWidth(0.2);y+=7;doc.setFontSize(10);doc.setFont('helvetica','normal');
  const kv=[['Cliente',`${d.customer.name}${d.customer.doc?' · '+d.customer.doc:''}`],['Dirección',d.address],['Teléfono',d.customer.phone||'—'],['Pago',PAY[d.payment]],['Vendedor',nm(d.seller)]];
  if(d.dispatch)kv.push(['Despacho',`${d.dispatch.driver} · ${d.dispatch.vehicle} · ${fmtDT(d.dispatch.at)}`]);
  kv.forEach(([k,v])=>{doc.setFont('helvetica','bold');doc.text(k+':',M,y);doc.setFont('helvetica','normal');const t=doc.splitTextToSize(String(v||''),W-2*M-28);doc.text(t,M+28,y);y+=5*t.length});
  y+=3;const cols=withPrices?[[M,'Código'],[M+30,'Descripción'],[W-M-62,'Cant.'],[W-M-38,'Precio'],[W-M,'Total']]:[[M,'Código'],[M+32,'Descripción'],[W-M-30,'Cant.'],[W-M,'Recibido']];
  const head=()=>{doc.setFillColor(251,203,43);doc.rect(M,y-4,W-2*M,6,'F');doc.setFont('helvetica','bold');cols.forEach(([x,t],i)=>doc.text(t,x+(i>=2?0:1),y,{align:i>=2?'right':'left'}));doc.setFont('helvetica','normal');y+=6};
  head();
  d.lines.forEach(l=>{const dw=withPrices?(W-M-62-(M+30)-14):(W-M-30-(M+32)-14);const t=doc.splitTextToSize(l.name,dw);if(y+5*t.length>262){doc.addPage();y=18;head()}
    doc.text(l.code,M+1,y);doc.text(t,M+(withPrices?31:33),y);
    if(withPrices){doc.text(String(l.qty),W-M-62,y,{align:'right'});doc.text(money(l.price),W-M-38,y,{align:'right'});doc.text(money(l.total),W-M,y,{align:'right'})}
    else{doc.text(String(l.qty),W-M-30,y,{align:'right'});doc.rect(W-M-12,y-3.5,4,4)}
    y+=5*t.length+1;doc.setDrawColor(220);doc.line(M,y-3.5,W-M,y-3.5)});
  if(withPrices){y+=3;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('TOTAL '+money(d.total),W-M,y,{align:'right'});doc.setFontSize(10);doc.setFont('helvetica','normal');y+=8}
  if(y>235){doc.addPage();y=30}
  y=Math.max(y+18,230);doc.setDrawColor(120);doc.line(M,y,M+70,y);doc.line(W-M-70,y,W-M,y);
  doc.text(withPrices?'Elaboró':'Entregó',M,y+5);doc.text('Recibí conforme (nombre, firma y fecha)',W-M-70,y+5);
  doc.setFontSize(8);doc.setTextColor(110);doc.text(withPrices?'Documento comercial de entrega. No es una factura electrónica.':'Marque cada producto recibido.',M,272);
  return doc.output('blob');
}
async function savePdf(blob,filename){downloadBlob(blob,filename);toast('PDF descargado.')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)}

/* ---------- eventos ---------- */
app.addEventListener('click',e=>{const el=e.target.closest('[data-a]');if(!el||!app.contains(el))return;const a=el.dataset.a;if(['role','d-field','rerender','l-pack','l-ver','st-role','d-qty','imp-file','imp-retire','imp-stock','d-pick','d-sp','u-role','u-mailon','ph-file'].includes(a))return;if(A[a]){e.preventDefault();A[a](el)}});
app.addEventListener('change',e=>{const el=e.target;const a=el.dataset.a;
  if(el.dataset.k)S.f[el.dataset.k]=el.value;
  if(a==='role'){S.role=el.value;try{localStorage.setItem('ferro-role',S.role)}catch(x){}S.view=null;S.ui={};render();return}
  if(a==='d-field'){S.draft[el.dataset.k2]=el.value;if(el.dataset.k2!=='notes')render();return}
  if(a==='d-pick'){const l=S.draft.lines[+el.dataset.i];l.pick=el.value;if(l.pick==='nuevo'&&!l.special)l.special={price:'',reason:''};render();if(l.pick==='nuevo'){const n=document.getElementById('sp-price-'+el.dataset.i);if(n)n.focus()}return}
  if(a==='d-qty'){const v=Math.max(1,Math.round(Number(el.value)||1));S.draft.lines[+el.dataset.i].qty=v;el.value=v;updDraftTotals();return}
  if(a==='rerender'){render();return}
  if(a==='imp-file'){A['imp-file'](el);return}
  if(a==='ph-file'){A['ph-file'](el);return}
  if(a==='imp-retire'){S.imp.retire=el.checked;render();return}
  if(a==='imp-stock'){S.imp.stock=el.checked;render();return}
  if(a==='l-pack'||a==='l-ver'||a==='u-role'||a==='u-mailon'){A[a](el);return}
});
app.addEventListener('input',e=>{const el=e.target;if(el.dataset.k)S.f[el.dataset.k]=el.value;if(el.dataset.a==='d-field')S.draft[el.dataset.k2]=el.value;
  if(el.dataset.a==='d-sp'){const l=S.draft.lines[+el.dataset.i];l.special=l.special||{price:'',reason:''};l.special[el.dataset.f]=el.value;updDraftTotals();return}
  if(el.dataset.a==='d-qty'){const v=Math.round(Number(el.value));if(v>0){S.draft.lines[+el.dataset.i].qty=v;updDraftTotals()}return}
  const k=el.dataset.k;const set=(id,h)=>{const n=document.getElementById(id);if(n)n.innerHTML=h};
  if(k==='cust-q')set('cust-res',custResults());
  else if(k==='prod-q')set('prod-res',prodResults());
  else if(k==='cat-q')set('cat-res',catTable());
  else if(k==='cl-q'){const q=norm(el.value);set('cl-res',custTable(S.customers.filter(c=>!q||norm(c.name+' '+(c.doc||'')+' '+(c.city||'')).includes(q))))}
  else if(k==='rem-q'){const q=norm(el.value);set('rem-res',remTable(S.remisiones.filter(r=>!q||norm(r.id+' '+r.orderId+' '+r.customer.name+' '+(r.customer.doc||'')).includes(q))))}
  else if(k==='ord-q'){const st=S.f['ord-st']||'',q=norm(el.value);set('ord-res',orderTable(S.orders.filter(o=>(!st||o.status===st)&&(!q||norm(o.id+' '+(o.customer&&o.customer.name)+' '+nm(o.seller)).includes(q)))))}
  else if(k==='au-q'){render();const n=document.getElementById('au-q');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}}
});
app.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='prod-q'){const b=document.querySelector('#prod-res [data-a="d-add"]');if(b){e.preventDefault();b.click()}}});

app.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();
  const v=Object.fromEntries(new FormData(f).entries());const kind=f.dataset.form;
  if(S.busy)return;S.busy=true;S.err='';
  (async()=>{
    try{
      if(kind==='login'){const r=await api('/api/login',{method:'POST',body:{username:v.username,password:v.password},auth:true});S.me=r.user;await afterLogin()}
      else if(kind==='setup'){if(v.password!==v.password2)throw new Error('Las dos claves no coinciden.');await api('/api/setup',{method:'POST',body:v,auth:true});const r=await api('/api/login',{method:'POST',body:{username:v.username,password:v.password},auth:true});S.me=r.user;await afterLogin()}
      else if(kind==='password'){if(v.password!==v.password2)throw new Error('Las dos claves nuevas no coinciden.');await api('/api/password',{method:'POST',body:{current:v.current,password:v.password},auth:true});const was=S.me.mustChange;S.me.mustChange=false;toast('Clave guardada.');if(was)await afterLogin();else{S.state='ready'}}
    }catch(er){S.err=er.message}
    finally{S.busy=false;render()}
  })();
});
render();init();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}

})();
