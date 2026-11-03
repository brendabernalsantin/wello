import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, COLORS, validateState, saveState, loadState, importBackup, validPetPhoto } from '../src/core.js';
import { deriveEvents, eventColors, CALENDAR_PALETTE, createICS } from '../src/modules/calendar.js';

function fixture() {
 const state=initialState();
 state.personal.habits.push({id:'habit-v2',name:'Leer',icon:'book-open',color:COLORS[1],startDate:'2026-11-01',frequency:'daily',type:'check',logs:{}});
 state.personal.sessions.push({id:'2026-11-03:d1',date:'2026-11-03',routineId:'d1',sets:{},status:'finished'});
 state.personal.appointments.push({id:'appointment-v2',title:'Cita',date:'2026-11-03',allDay:true});
 state.households[0].pets.push({id:'pet-v2',name:'Luna',type:'Perro',sex:'female',activities:[{id:'walk-v2',type:'walk',title:'Paseo',date:'2026-11-03',note:''},{id:'heat-v2',type:'heat',date:'2026-11-02',endDate:'2026-11-04',note:'Registro observado'}],tricks:[]});
 return state;
}
test('cada evento conserva color del módulo; hábitos usan muestra exacta e icono propio',()=>{
 const events=deriveEvents(fixture(),'2026-11-03','2026-11-03');
 const habit=events.find(e=>e.source==='habit');assert.equal(habit.icon,'book-open');assert.equal(eventColors(habit).color,COLORS[1]);
 for(const type of ['gym','mascotas','citas'])assert.equal(eventColors(events.find(e=>e.type===type)).color,CALENDAR_PALETTE[type].color);
 assert.equal(new Set(Object.values(CALENDAR_PALETTE).map(p=>p.color)).size,4);
});
test('exportar sólo mascotas o sólo hábitos no contiene otras categorías',()=>{
 const events=deriveEvents(fixture(),'2026-11-01','2026-11-30');
 const pets=createICS(events,{filter:'mascotas'});assert.match(pets,/Luna/);assert.doesNotMatch(pets,/SUMMARY:Leer/);assert.doesNotMatch(pets,/SUMMARY:Gym/);assert.doesNotMatch(pets,/SUMMARY:Cita/);
 const habits=createICS(events,{filter:'habitos'});assert.match(habits,/SUMMARY:Leer/);assert.doesNotMatch(habits,/Luna/);
 const gym=createICS(events,{filter:'gym'});assert.match(gym,/SUMMARY:Gym/);assert.doesNotMatch(gym,/Luna/);
});
test('celo se ve durante días observados y se exporta como un solo intervalo editable',()=>{
 const state=fixture();const heat=deriveEvents(state,'2026-11-01','2026-11-30').filter(e=>e.rangeId);
 assert.deepEqual(heat.map(e=>e.date),['2026-11-02','2026-11-03','2026-11-04']);assert.equal(new Set(heat.map(e=>e.id)).size,3);assert(heat.every(e=>e.activityId==='heat-v2'));
 const ics=createICS(heat,{filter:'mascotas'});assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,1);assert.match(ics,/DTSTART;VALUE=DATE:20261102/);assert.match(ics,/DTEND;VALUE=DATE:20261105/);
});
test('fotos raster locales se guardan y migran sin cambiar sexo o celo; se rechazan URL/SVG/tamaño',()=>{
 const state=fixture();state.households[0].pets[0].photo='data:image/jpeg;base64,/9j/2Q==';
 const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};saveState(storage,state);const loaded=loadState(storage);assert.equal(loaded.households[0].pets[0].photo,state.households[0].pets[0].photo);assert.equal(loaded.households[0].pets[0].sex,'female');
 const imported=importBackup(initialState(),{format:'wello-backup-v3',data:state});assert.equal(imported.state.households.find(h=>h.id===state.activeHousehold).pets[0].activities[1].endDate,'2026-11-04');
 for(const invalid of ['https://example.test/pet.jpg','data:image/svg+xml;base64,AAAA','data:image/png;base64,'+'A'.repeat(350000)])assert.equal(validPetPhoto(invalid),false);
 const old=fixture();delete old.households[0].pets[0].sex;assert.doesNotThrow(()=>validateState(old));
 state.households[0].pets[0].activities[1].endDate='2026-11-01';assert.throws(()=>validateState(state),/final del celo/);
});

test('celo sin final observado sólo muestra el inicio, sin duración inferida',()=>{
 const state=fixture();const activity=state.households[0].pets[0].activities.find(a=>a.type==='heat');delete activity.endDate;
 const events=deriveEvents(state,'2026-11-01','2026-11-30').filter(e=>e.activityId==='heat-v2');assert.equal(events.length,1);assert.equal(events[0].date,'2026-11-02');assert.equal(events[0].rangeId,undefined);
 const ics=createICS(events,{filter:'mascotas'});assert.match(ics,/DTEND;VALUE=DATE:20261103/);
});

test('cita no cambia ni se borra si el guardado falla',async()=>{
 const {openAppointment,registerCalendar}=await import('../src/modules/calendar.js');const state=fixture();const before=JSON.stringify(state.personal.appointments);const actions=new Map();let submit;let rendered=0;const ctx={state:()=>state,view:{},today:()=> '2026-11-03',id:()=> 'new-cita',esc:String,field:()=>'',select:()=>'',btn:()=>'',modal:(_t,_h,fn)=>{submit=fn;},save:()=>false,render:()=>rendered++,toast:()=>{},confirm:(_m,fn)=>fn(),closeModal:()=>{},action:(n,fn)=>actions.set(n,fn),change:()=>{}};
 openAppointment(ctx,'appointment-v2');assert.equal(submit({title:'Cambio',date:'2026-11-03',allDay:'true',note:''}),false);assert.equal(JSON.stringify(state.personal.appointments),before);
 registerCalendar(ctx);actions.get('calendar-delete')({id:'appointment-v2'});assert.equal(JSON.stringify(state.personal.appointments),before);assert.equal(rendered,0);
});
