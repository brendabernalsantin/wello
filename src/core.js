export const VERSION = 3;
export const COLORS = ['#F7DCEB','#EBE4FA','#FFF0BE','#DEF4EE','#DDF1FA','#E8F1DC'];
export const MOODS = [{id:'feliz',name:'Feliz'},{id:'calma',name:'En calma'},{id:'neutral',name:'Neutral'},{id:'cansada',name:'Cansada'},{id:'triste',name:'Triste'},{id:'estresada',name:'Estresada'}];
export function today(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function dateObject(date) { return new Date(`${date}T12:00:00`); }
export function addDays(date,n) { const d=dateObject(date); d.setDate(d.getDate()+n); return today(d); }
export function validDate(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dateObject(value).getTime()) && today(dateObject(value))===value; }
export function validTime(value) { return typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function weekStart(date) { const d=dateObject(date); return addDays(date,-((d.getDay()+6)%7)); }
export function uid() { return globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export function esc(value='') { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function newHome(name='Mi hogar',id=uid()) { return {id,name,habits:[],pets:[],inventory:[],shopping:[],purchases:[],stores:[]}; }
export function initialState() { const h=newHome(); return {version:VERSION,personal:{sessions:[],habits:[],moods:[],appointments:[]},households:[h],activeHousehold:h.id}; }
export function visibleHabits(state) { return [...state.personal.habits.map(h=>({...h,scope:'personal'})),...(state.households.find(h=>h.id===state.activeHousehold)?.habits||[]).map(h=>({...h,scope:'home'}))]; }
export function scheduled(h,date) {
  if (!validDate(date) || date<(h.startDate||'1970-01-01')) return false;
  const d=dateObject(date);
  switch(h.frequency) {
    case 'weekdays': return (h.weekdays||[]).includes(d.getDay());
    case 'interval': return Math.round((dateObject(date)-dateObject(h.startDate||date))/86400000)%Math.max(1,Number(h.interval)||1)===0;
    case 'monthly': return d.getDate()===Math.min(Number(h.monthDay)||1,new Date(d.getFullYear(),d.getMonth()+1,0).getDate());
    default:return true;
  }
}
export function habitProgress(h,date) {
  const logs=h.logs||{};
  if(h.type!=='quantity') return {value:logs[date]===true?1:0,target:1,done:logs[date]===true,remaining:logs[date]===true?0:1};
  const start=h.goalPeriod==='week'?weekStart(date):date;
  const end=h.goalPeriod==='week'?addDays(start,6):date;
  const value=Object.entries(logs).filter(([d])=>d>=start&&d<=end).reduce((a,[,v])=>a+(typeof v==='number'&&Number.isFinite(v)?v:0),0);
  const target=Number(h.target)||1;
  return {value,target,done:value>=target,remaining:Math.max(0,target-value)};
}
export function upsertMood(state,date,mood,note='') {
  if (!validDate(date)||!MOODS.some(m=>m.id===mood)||note.length>1000) throw Error('Revisa la fecha, la carita y la nota.');
  const record={id:`mood:${date}`,date,mood,note};
  state.personal.moods=state.personal.moods.filter(m=>m.date!==date); state.personal.moods.push(record); return record;
}
export function validateState(data) {
  if(!data||typeof data!=='object'||Array.isArray(data)) throw Error('La copia no contiene un objeto válido.');
  if(!data.personal||!Array.isArray(data.households)||!data.households.length) throw Error('Faltan las colecciones de Wello.');
  const names=['sessions','habits','moods','appointments'];
  for(const k of names) if(!Array.isArray(data.personal[k])) throw Error(`La colección ${k} no es válida.`);
  const idLists=[...names.map(k=>data.personal[k])];
  for(const h of data.households) {
    if(!h||typeof h.id!=='string'||typeof h.name!=='string') throw Error('Un hogar no tiene identificador o nombre.');
    for(const k of ['habits','pets','inventory','shopping','purchases','stores']) { if(!Array.isArray(h[k]))throw Error(`La colección ${k} no es válida.`); idLists.push(h[k]); }
  }
  for(const records of idLists) for(const r of records) { if(!r||typeof r!=='object'||typeof r.id!=='string'||!r.id||r.id.length>200||!/^[-A-Za-z0-9._:]+$/.test(r.id))throw Error('Un registro no tiene un identificador estable.'); }
  const unique = (records,label) => { if(new Set(records.map(r=>r.id)).size!==records.length)throw Error(`Hay identificadores repetidos en ${label}; revisa la copia sin sobrescribirlos.`); };
  for(const records of idLists)unique(records,'una colección');
  unique(data.households,'hogares');
  for(const home of data.households)unique([...data.personal.habits,...home.habits],'hábitos personales y del hogar');
  if(new Set(data.personal.sessions.map(s=>`${s.date}:${s.routineId}`)).size!==data.personal.sessions.length)throw Error('Hay sesiones repetidas por fecha y rutina.');
  if(new Set(data.personal.moods.map(m=>m.date)).size!==data.personal.moods.length)throw Error('Hay moods repetidos por fecha.');
  for(const home of data.households){
    for(const pet of home.pets){
      if(typeof pet.name!=='string'||typeof pet.type!=='string'||(pet.birthday&&!validDate(pet.birthday)))throw Error('Un perfil de mascota no es válido.');
      if(pet.activities&&!Array.isArray(pet.activities))throw Error('El historial de mascota no es válido.');
      for(const a of pet.activities||[]){
        if(typeof a.id!=='string'||!validDate(a.date)||(a.time&&!validTime(a.time))||(a.nextDate&&!validDate(a.nextDate)))throw Error('Una actividad de mascota tiene fecha, hora o identificador inválidos.');
      }
    }
    for(const item of home.inventory)if(typeof item.name!=='string'||!Number.isFinite(Number(item.quantity??item.stock))||Number(item.quantity??item.stock)<0||(item.expiration&&!validDate(item.expiration)))throw Error('Un alimento del inventario no es válido.');
    for(const item of home.shopping)if(typeof item.name!=='string'||!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0)throw Error('Un renglón del súper no es válido.');
    for(const purchase of home.purchases)if(!validDate(purchase.date)||(purchase.total!=null&&(!Number.isFinite(purchase.total)||purchase.total<0))||(purchase.lines&&!Array.isArray(purchase.lines)))throw Error('Una compra tiene formato inválido.');
  }
  for(const s of data.personal.sessions) {
    if(!validDate(s.date)||!s.routineId||!s.sets||typeof s.sets!=='object')throw Error('Una sesión tiene formato inválido.');
    for(const sets of Object.values(s.sets)) { if(!Array.isArray(sets))throw Error('Series inválidas.'); for(const x of sets) if(x.weight!==null&&x.weight!==undefined&&(!Number.isFinite(x.weight)||x.weight<0))throw Error('Una carga no es válida.'); }
    if(s.observations&&!Array.isArray(s.observations))throw Error('Las observaciones históricas no son válidas.');
    for(const o of s.observations||[]){if(!o||typeof o.exerciseId!=='string'||!Number.isFinite(o.weight)||o.weight<0||(o.date&&!validDate(o.date))||(o.note&&typeof o.note!=='string')||String(o.note||'').length>4000)throw Error('Una observación histórica tiene formato inválido.');}
  }
  for(const h of [...data.personal.habits,...data.households.flatMap(h=>h.habits)]) {
    if(typeof h.name!=='string'||!validDate(h.startDate))throw Error('Un hábito tiene nombre o fecha inválidos.');
    if(h.type==='quantity'&&(!Number.isFinite(Number(h.target))||Number(h.target)<=0))throw Error('Una meta no es válida.');
    for(const [d,v] of Object.entries(h.logs||{}))if(!validDate(d)||(typeof v!=='boolean'&&(!Number.isFinite(v)||v<0)))throw Error('Un registro de hábito no es válido.');
  }
  for(const m of data.personal.moods)if(!validDate(m.date)||!MOODS.some(x=>x.id===m.mood)||String(m.note||'').length>1000)throw Error('Un mood no es válido.');
  for(const a of data.personal.appointments)if(!validDate(a.date)||typeof a.title!=='string'||(a.time&&!validTime(a.time)))throw Error('Una cita no es válida.');
  return data;
}
function normalizeSession(s) {
  const routineId=s.routineId||s.routine||s.day;
  const date=s.date||s.localDate;
  const sets={};
  for(const [key,list] of Object.entries(s.sets||s.exercises||{})) {
    const values=Array.isArray(list)?list:Array.isArray(list.sets)?list.sets:[];
    sets[key]=values.map(x=>({ ...x,weight:x.weight===null||x.weight===undefined||x.weight===''?null:Number(x.weight),done:x.done===true||x.completed===true }));
  }
  return {...s,id:s.id||`${date}:${routineId}`,date,routineId,sets};
}
export function migrateBackup(input,targetHomeId) {
  const raw=JSON.parse(JSON.stringify(input));
  const format=raw.format||raw.schema||raw.type;
  if(format==='wello-private-gym-observations-v1') {
    const out=initialState();out.personal.sessions=(raw.sessions||[]).map(normalizeSession);out.households=[]; return {data:out,partial:'gym',warnings:[]};
  }
  if(format==='forma-gym-v1'||format==='wello-gym-v1') {
    const payload=raw.data||raw;
    const out=initialState();out.personal.sessions=(payload.sessions||[]).map(normalizeSession);out.households=[];
    if(!Array.isArray(payload.sessions))throw Error('Este respaldo Gym necesita revisión: no se encontró sessions.');
    return {data:out,partial:'gym',warnings:['Compatibilidad estructural; no se dispone de una copia original para verificar todos los formatos antiguos.']};
  }
  if(format==='forma-home-v1'||format==='wello-home-v1') {
    const payload=raw.data||raw.home||raw;
    const home={...newHome(payload.name||'Hogar importado',targetHomeId||payload.id||uid()),...payload};
    home.id=targetHomeId||payload.id||home.id;
    for(const k of ['habits','pets','inventory','shopping','purchases','stores'])home[k]=home[k]||[];
    if(home.habits.some(h=>!h.startDate))throw Error('Este archivo antiguo contiene hábitos sin fecha de inicio: revisa antes de importar.');
    const out=initialState();out.households=[home];return {data:out,partial:'home',warnings:['El hogar de destino se elige explícitamente; no concede acceso en la nube.']};
  }
  const out=raw.data||raw;
  if(!out.personal||!Array.isArray(out.households))throw Error('Formato no reconocido. Usa un respaldo Wello o forma-gym-v1/forma-home-v1.');
  out.personal={sessions:[],habits:[],moods:[],appointments:[],...out.personal};
  out.personal.sessions=out.personal.sessions.map(normalizeSession);
  out.personal.moods=out.personal.moods.map(m=>({...m,id:`mood:${m.date}`,note:m.note||''}));
  for(const h of out.households)for(const k of ['habits','pets','inventory','shopping','purchases','stores'])h[k]=h[k]||[];
  out.version=VERSION;return {data:out,partial:null,warnings:[]};
}
export function importBackup(current,input,options={}) {
  const {data,partial,warnings}=migrateBackup(input,options.targetHomeId);
  const validatable=JSON.parse(JSON.stringify(data));
  if(!validatable.households.length){const h=newHome();validatable.households=[h];validatable.activeHousehold=h.id;}
  validateState(validatable);
  const next=JSON.parse(JSON.stringify(current)); const report={added:0,existing:0,rejected:0,warnings};
  const merge=(dest,source,key=r=>r.id)=>{for(const r of source){if(dest.some(x=>key(x)===key(r)))report.existing++;else{dest.push(r);report.added++;}}};
  if(partial!=='home')for(const k of ['sessions','habits','moods','appointments'])merge(next.personal[k],data.personal[k],k==='sessions'?r=>`${r.date}:${r.routineId}`:k==='moods'?r=>r.date:r=>r.id);
  if(partial!=='gym')for(const h of data.households){
    let dest=next.households.find(x=>x.id===h.id);
    if(!dest){dest=newHome(h.name,h.id);next.households.push(dest);report.added++;}
    for(const k of ['habits','pets','inventory','shopping','purchases','stores'])merge(dest[k],h[k]);
  }
  validateState(next);return {state:next,report};
}
export function storageKey(namespace='local') { return `wello-v3:${namespace}`; }
export function loadState(storage,namespace='local') {
  const raw=storage.getItem(storageKey(namespace));
  if(!raw)return initialState();
  return validateState(migrateBackup(JSON.parse(raw)).data);
}
export function saveState(storage,state,namespace='local') { validateState(state); storage.setItem(storageKey(namespace),JSON.stringify(state)); }
