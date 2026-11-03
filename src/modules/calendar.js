import {visibleHabits,scheduled,habitProgress,MOODS,addDays,today,dateObject,uid,validDate,validTime} from '../core.js';
import {openMood,openHabit,openQuantity} from './habits.js';
import {openPetActivity} from './pets.js';
export function deriveEvents(state,start,end) {
  const events=[];const home=state.households.find(h=>h.id===state.activeHousehold);
  const habits=visibleHabits(state);
  for(let date=start;date<=end;date=addDays(date,1))for(const h of habits){
    if(scheduled(h,date)||h.logs?.[date]!==undefined){const p=habitProgress(h,date);events.push({id:`habit:${h.id}:${date}`,type:'habitos',source:'habit',sourceId:h.id,date,title:h.name,note:h.type==='quantity'?`${p.value} / ${p.target} ${h.unit}${h.goalPeriod==='week'?' esta semana':''}`:p.done?'Realizado':'Programado',done:p.done,allDay:true});}
  }
  for(const m of state.personal.moods)if(m.date>=start&&m.date<=end)events.push({id:`mood:${m.date}`,type:'habitos',source:'mood',sourceId:m.id,date:m.date,title:`Mi mood: ${MOODS.find(x=>x.id===m.mood)?.name||m.mood}`,note:m.note||'',mood:m.mood,allDay:true});
  for(const s of state.personal.sessions)if(s.date>=start&&s.date<=end)events.push({id:`gym:${s.date}:${s.routineId}`,type:'gym',source:'gym',sourceId:s.id,date:s.date,title:`Gym · ${String(s.routineId).replace(/^d/,'Día ')}`,routineId:s.routineId,note:s.status==='finished'?'Entrenamiento guardado. Puede incluir ejercicios pendientes.':'Entrenamiento en curso',allDay:true});
  for(const pet of home?.pets||[]){
    for(const a of pet.activities||[]){
      if(a.date>=start&&a.date<=end)events.push({id:`pet:${pet.id}:${a.id}`,type:'mascotas',source:'pet',sourceId:pet.id,activityId:a.id,date:a.date,time:a.time||'',allDay:!a.time,title:`${pet.name} · ${a.title||a.type}`,note:a.note||'',done:a.done||a.status==='done'||a.status==='completed'});
      if(a.nextDate>=start&&a.nextDate<=end)events.push({id:`pet-next:${pet.id}:${a.id}`,type:'mascotas',source:'pet',sourceId:pet.id,activityId:a.id,date:a.nextDate,allDay:true,title:`${pet.name} · Próxima ${a.title||a.type}`,note:a.note||''});
    }
    if(pet.birthday){const md=pet.birthday.slice(5);for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){let date=`${year}-${md}`;if(md==='02-29'&&new Date(year,1,29).getMonth()!==1)date=`${year}-02-28`;if(date>=start&&date<=end)events.push({id:`birthday:${pet.id}:${year}`,type:'mascotas',source:'pet',sourceId:pet.id,date,title:`Cumpleaños de ${pet.name}`,allDay:true,note:'Un día para celebrar.'});}}
  }
  for(const a of state.personal.appointments)if(a.date>=start&&a.date<=end)events.push({...a,type:'citas',source:'appointment',sourceId:a.id});
  return events.sort((a,b)=>`${a.date}${a.time||'00:00'}`.localeCompare(`${b.date}${b.time||'00:00'}`)||a.id.localeCompare(b.id));
}
export function filterEvents(events,type='all') { return type==='all'?events:events.filter(e=>e.type===type); }
function icsEscape(s='') { return String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
function fold(line) {
  const parts=[];let part='';let size=0;
  for(const c of line){const n=new TextEncoder().encode(c).length;if(size+n>73){parts.push(part);part=' '+c;size=1+n;}else{part+=c;size+=n;}}
  parts.push(part);return parts.join('\r\n');
}
export function createICS(events,{includeMoods=false,includeMoodNotes=false,timezone='America/Mexico_City',stamp=new Date()}={}) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wello//Bienestar//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VTIMEZONE',`TZID:${timezone}`,'BEGIN:STANDARD','DTSTART:20230101T000000','TZOFFSETFROM:-0600','TZOFFSETTO:-0600','TZNAME:CST','END:STANDARD','END:VTIMEZONE'];
  const dtstamp=stamp.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  for(const e of events){if(!validDate(e.date)||(e.time&&!validTime(e.time)))continue;if(e.source==='mood'&&!includeMoods)continue;lines.push('BEGIN:VEVENT',`UID:${icsEscape(e.id)}@wello.local`,`DTSTAMP:${dtstamp}`);
    if(e.allDay||!e.time)lines.push(`DTSTART;VALUE=DATE:${e.date.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(e.date,1).replaceAll('-','')}`);
    else lines.push(`DTSTART;TZID=${timezone}:${e.date.replaceAll('-','')}T${e.time.replace(':','')}00`);
    lines.push(`SUMMARY:${icsEscape(e.title)}`);if(e.note&&(e.source!=='mood'||includeMoodNotes))lines.push(`DESCRIPTION:${icsEscape(e.note)}`);lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
export function downloadFile(name,content,type='application/json') { const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000); }
export function openAppointment(ctx,id,date=ctx.view.calendarDate||ctx.today()) {
  const a=ctx.state().personal.appointments.find(x=>x.id===id)||{title:'',date,time:'',note:'',allDay:true};
  ctx.modal(id?'Editar cita':'Una cita para ti',`${ctx.field('Título','title',a.title,'text','required maxlength="150"')}${ctx.field('Fecha','date',a.date,'date','required')}<div class="form-grid">${ctx.select('Horario','allDay',[{value:'true',label:'Todo el día'},{value:'false',label:'A una hora'}],String(a.allDay))}${ctx.field('Hora local (Ciudad de México)','time',a.time,'time')}</div><label class="field">Nota<textarea name="note" maxlength="2000" rows="3">${ctx.esc(a.note)}</textarea></label><p class="small muted">Es una cita personal. No cambia al elegir otro hogar.</p>${id?ctx.btn('Eliminar cita','calendar-delete',`data-id="${id}"`,'danger'):''}`,d=>{if(d.allDay==='false'&&!d.time){ctx.toast('Indica una hora.');return false;}const value={...a,id:id||ctx.id(),title:d.title.trim(),date:d.date,time:d.allDay==='true'?'':d.time,allDay:d.allDay==='true',note:d.note};if(!value.title)return false;const list=ctx.state().personal.appointments;const index=list.findIndex(x=>x.id===value.id);if(index>=0)list[index]=value;else list.push(value);ctx.save();ctx.view.calendarDate=d.date;ctx.view.calendarMonth=d.date.slice(0,7);ctx.render();});
}
const typeLabels={all:'Todas',habitos:'Hábitos',gym:'Gym',mascotas:'Mascotas',citas:'Citas personales'};
function eventRow(ctx,e) { return `<button class="list-row calendar-event type-${e.type}" data-action="calendar-event" data-id="${ctx.esc(e.id)}"><span class="event-symbol">${e.mood?ctx.img('mood-'+e.mood):ctx.icon(e.type==='gym'?'dumbbell':e.type==='mascotas'?'paw-print':e.type==='citas'?'calendar-check':'leaf',22)}</span><span><strong>${ctx.esc(e.title)}</strong><span class="small muted">${ctx.esc(e.time||'Todo el día')}${e.note?' · '+ctx.esc(e.note):''}</span></span>${ctx.icon('chevron-right',18)}</button>`; }
export function renderCalendar(ctx) {
  const month=ctx.view.calendarMonth||ctx.today().slice(0,7);const date=ctx.view.calendarDate||ctx.today();const mode=ctx.view.calendarMode||'month';const filter=ctx.view.calendarFilter||'all';
  const first=month+'-01';const d=dateObject(first);const last=today(new Date(d.getFullYear(),d.getMonth()+1,0));const start=addDays(first,-((d.getDay()+6)%7));
  const all=deriveEvents(ctx.state(),start,addDays(last,7));ctx.view.calendarEvents=all;const list=filterEvents(all,filter);const selected=list.filter(e=>e.date===date);
  return `<div class="page-heading"><div><span class="eyebrow">UN POCO DE ORDEN, MÁS TRANQUILIDAD</span><h1>Mi calendario</h1><p>Tus cuidados y tus planes, en el mismo lugar.</p></div>${ctx.btn('Crear cita','calendar-new')}</div><div class="toolbar calendar-toolbar"><div class="tabs"><button class="tab ${mode==='month'?'active':''}" data-action="calendar-mode" data-mode="month">Mes</button><button class="tab ${mode==='agenda'?'active':''}" data-action="calendar-mode" data-mode="agenda">Agenda</button></div>${ctx.btn(ctx.icon('download',17)+' Exportar al iPhone','calendar-export','','secondary')}</div><div class="filter-pills">${Object.entries(typeLabels).map(([v,label])=>`<button class="filter-pill ${filter===v?'active':''}" data-action="calendar-filter" data-filter="${v}">${label}</button>`).join('')}</div><section class="panel"><div class="section-head calendar-month-head"><div class="row">${ctx.btn(ctx.icon('chevron-left',20),'calendar-month','data-step="-1" aria-label="Mes anterior"','icon-button')}<h2>${d.toLocaleDateString('es-MX',{month:'long',year:'numeric'})}</h2>${ctx.btn(ctx.icon('chevron-right',20),'calendar-month','data-step="1" aria-label="Mes siguiente"','icon-button')}</div>${ctx.btn('Hoy','calendar-today','','secondary')}</div>${mode==='month'?`<div class="month-grid">${['L','M','M','J','V','S','D'].map(x=>`<div class="weekday-label">${x}</div>`).join('')}${Array.from({length:42},(_,i)=>{const day=addDays(start,i);const items=list.filter(e=>e.date===day);return `<button class="month-day ${day.slice(0,7)!==month?'outside':''} ${day===date?'selected':''} ${day===ctx.today()?'today':''}" data-action="calendar-day" data-date="${day}" aria-label="${ctx.prettyDate(day)}, ${items.length} actividades"><span>${Number(day.slice(-2))}</span><div class="event-dots">${[...new Set(items.map(e=>e.type))].map(t=>`<i class="dot type-${t}"></i>`).join('')}${items.some(e=>e.mood)?'<i class="mood-dot">•</i>':''}</div></button>`;}).join('')}</div><div class="day-detail"><div class="section-head"><h3>${ctx.prettyDate(date)}</h3>${ctx.btn(ctx.icon('plus',17),'calendar-new',`data-date="${date}" aria-label="Crear cita este día"`,'icon-button')}</div>${selected.length?selected.map(e=>eventRow(ctx,e)).join(''):'<p class="muted">Nada programado para este día con este filtro.</p>'}</div>`:`<div class="agenda-list">${list.filter(e=>e.date>=first&&e.date<=last).length?Array.from(new Set(list.filter(e=>e.date>=first&&e.date<=last).map(e=>e.date))).map(day=>`<section class="agenda-day"><h3>${ctx.prettyDate(day)}</h3>${list.filter(e=>e.date===day).map(e=>eventRow(ctx,e)).join('')}</section>`).join(''):ctx.empty('Este mes está en calma.','Crea una cita o registra un hábito, mood, entrenamiento o cuidado.')}</div>`}</section>`;
}
export function registerCalendar(ctx) {
  ctx.action('calendar-mode',d=>{ctx.view.calendarMode=d.mode;ctx.render();});ctx.action('calendar-filter',d=>{ctx.view.calendarFilter=d.filter;ctx.render();});
  ctx.action('calendar-day',d=>{ctx.view.calendarDate=d.date;ctx.render();});
  ctx.action('calendar-month',d=>{const date=dateObject((ctx.view.calendarMonth||ctx.today().slice(0,7))+'-01');date.setMonth(date.getMonth()+Number(d.step));ctx.view.calendarMonth=today(date).slice(0,7);ctx.render();});
  ctx.action('calendar-today',()=>{ctx.view.calendarMonth=ctx.today().slice(0,7);ctx.view.calendarDate=ctx.today();ctx.render();});
  ctx.action('calendar-new',d=>openAppointment(ctx,null,d.date));
  ctx.action('calendar-delete',d=>ctx.confirm('¿Eliminar esta cita? No se eliminará ningún otro registro.',()=>{ctx.state().personal.appointments=ctx.state().personal.appointments.filter(a=>a.id!==d.id);ctx.save();ctx.closeModal();ctx.render();}));
  ctx.action('calendar-event',d=>{const e=ctx.view.calendarEvents.find(x=>x.id===d.id);if(!e)return;
    if(e.source==='mood'){openMood(ctx,e.date);return;}if(e.source==='appointment'){openAppointment(ctx,e.sourceId);return;}
    ctx.modal(e.title,`<p>${ctx.prettyDate(e.date)}${e.time?' · '+ctx.esc(e.time):''}</p><p class="note">${ctx.esc(e.note)}</p>${ctx.btn('Abrir registro para editar','calendar-source',`data-id="${ctx.esc(e.id)}"`)}`);
  });
  ctx.action('calendar-source',d=>{const e=ctx.view.calendarEvents.find(x=>x.id===d.id);ctx.closeModal();if(e.source==='habit'){ctx.view.habitDate=e.date;ctx.navigate('habitos');openHabit(ctx,e.sourceId);}else if(e.source==='gym'){ctx.view.gymDate=e.date;ctx.view.gymRoutine=e.routineId;ctx.navigate('gym');}else if(e.source==='pet'){ctx.view.petId=e.sourceId;ctx.navigate('mascotas');openPetActivity(ctx,e.sourceId,e.activityId);}});
  ctx.action('calendar-export',()=>ctx.modal('Llévalo a Calendario de iPhone',`<p>Exporta las actividades del mes y filtro visibles. El archivo no activa una sincronización continua.</p><label class="check-label"><input type="checkbox" name="moods"> Incluir mis moods (personal)</label><label class="check-label"><input type="checkbox" name="notes"> Incluir también el texto de mis notas de mood</label><p class="small muted">Los eventos con hora usan America/Mexico_City. Abre el archivo .ics en el iPhone y elige agregarlo a Calendario. Si Safari solo lo descarga, ábrelo desde Archivos o envíalo a tu correo.</p>`,d=>{const month=ctx.view.calendarMonth||ctx.today().slice(0,7);const events=filterEvents(ctx.view.calendarEvents||[],ctx.view.calendarFilter||'all').filter(e=>e.date.startsWith(month));downloadFile(`Wello-${month}.ics`,createICS(events,{includeMoods:!!d.moods,includeMoodNotes:!!d.notes}),'text/calendar;charset=utf-8');ctx.toast('Archivo de calendario creado.');},'Descargar .ics'));
}
