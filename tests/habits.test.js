import test from 'node:test';
import assert from 'node:assert/strict';
import {COLORS,initialState} from '../src/core.js';
import {nextMonthlyOccurrence,openHabit,openHabitDetails,registerHabits,renderHabits} from '../src/modules/habits.js';

function escape(value='') {
  return String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function context(state,today='2026-11-03') {
  const actions=new Map();
  const changes=new Map();
  const modalCalls=[];
  const messages=[];
  const ctx={
    state:()=>state,
    home:()=>state.households[0],
    view:{},
    today:()=>today,
    id:()=>`habit-${state.personal.habits.length+1}`,
    esc:escape,
    icon:(name,size=20)=>`<i data-icon="${name}" data-size="${size}"></i>`,
    img:name=>`<img data-asset="${name}" alt="">`,
    field:(label,name,value='',type='text',extra='')=>`<label class="field">${escape(label)}<input type="${type}" name="${name}" value="${escape(value)}" ${extra}></label>`,
    select:(label,name,options,value)=>`<label class="field">${escape(label)}<select name="${name}">${options.map(option=>`<option value="${escape(option.value)}" ${String(option.value)===String(value)?'selected':''}>${escape(option.label)}</option>`).join('')}</select></label>`,
    btn:(label,action,extra='',kind='primary')=>`<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${label}</button>`,
    empty:(title,text,button='')=>`<div class="empty"><h3>${escape(title)}</h3><p>${escape(text)}</p>${button}</div>`,
    prettyDate:date=>date,
    save:()=>true,
    render:()=>{ctx.renderCount=(ctx.renderCount||0)+1;},
    toast:message=>messages.push(message),
    closeModal:()=>{ctx.closed=(ctx.closed||0)+1;},
    confirm:(message,callback)=>callback(),
    modal:(title,html,onSubmit)=>modalCalls.push({title,html,onSubmit}),
    action:(name,handler)=>actions.set(name,handler),
    change:(name,handler)=>changes.set(name,handler)
  };
  ctx.actions=actions;
  ctx.changes=changes;
  ctx.modalCalls=modalCalls;
  ctx.messages=messages;
  return ctx;
}

function habit(overrides={}) {
  return {
    id:'habit-a',
    name:'Agua',
    icon:'droplets',
    color:COLORS[0],
    startDate:'2026-10-01',
    frequency:'daily',
    weekdays:[1,2,3,4,5],
    interval:2,
    monthDay:1,
    type:'check',
    target:1,
    unit:'veces',
    goalPeriod:'day',
    logs:{},
    ...overrides
  };
}

test('renderiza una lista compacta con icono visual, nombre y check, sin metas ni semana en la fila',()=>{
  const state=initialState();
  state.personal.habits.push(habit({logs:{'2026-11-03':true}}));
  const ctx=context(state);
  const html=renderHabits(ctx);
  assert.match(html,/class="habit-list"/);
  assert.match(html,/class="habit-row"/);
  assert.match(html,/data-icon="droplets"/);
  assert.match(html,/habit-row-check/);
  assert.doesNotMatch(html,/habit-row-goal/);
  assert.doesNotMatch(html,/habit-row-week/);
  assert.doesNotMatch(html,/habit-card/);
});

test('el formulario usa seis radios de iconos, conserva colores y sólo muestra el grupo diario inicialmente',()=>{
  const state=initialState();
  const ctx=context(state);
  openHabit(ctx);
  const html=ctx.modalCalls[0].html;
  assert.equal((html.match(/class="habit-icon-radio sr-only"/g)||[]).length,6);
  assert.equal((html.match(/type="radio" name="icon"/g)||[]).length,6);
  assert.doesNotMatch(html,/select name="icon"/);
  for(const color of COLORS)assert.match(html,new RegExp(`value="${color}"`));
  assert.match(html,/data-frequency-group="daily"/);
  assert.doesNotMatch(html,/data-frequency-group="daily" hidden/);
  assert.match(html,/data-frequency-group="weekdays" hidden/);
  assert.match(html,/data-frequency-group="interval" hidden/);
  assert.match(html,/data-frequency-group="monthly" hidden/);
  assert.match(html,/data-type-group="quantity" hidden/);
  assert.match(html,/data-change="habit-frequency"/);
  assert.match(html,/data-change="habit-type"/);
});

test('los cambios data-change sólo alternan grupos y no rerenderizan ni pierden controles',()=>{
  const state=initialState();
  const ctx=context(state);
  registerHabits(ctx);
  const controls=()=>[{disabled:false},{disabled:false}];
  const groups=['daily','weekdays','interval','monthly'].map(name=>({dataset:{frequencyGroup:name},hidden:false,controls:controls(),querySelectorAll:()=>groups.find(group=>group.dataset.frequencyGroup===name).controls}));
  const typeGroups=['check','quantity'].map(name=>({dataset:{typeGroup:name},hidden:false,controls:controls(),querySelectorAll:()=>typeGroups.find(group=>group.dataset.typeGroup===name).controls}));
  const frequency={value:'daily'};
  const type={value:'check'};
  const form={
    querySelectorAll:selector=>selector==='[data-frequency-group]'?groups:selector==='[data-type-group]'?typeGroups:[], 
    querySelector:selector=>selector==='[name="frequency"]'?frequency:selector==='[name="type"]'?type:null
  };
  ctx.changes.get('habit-frequency')({}, {}, {form});
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='daily').hidden,false);
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='weekdays').hidden,true);
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='daily').controls[0].disabled,false);
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='weekdays').controls[0].disabled,true);
  frequency.value='weekdays';
  ctx.changes.get('habit-frequency')({}, {}, {form});
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='daily').hidden,true);
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='weekdays').hidden,false);
  assert.equal(groups.find(group=>group.dataset.frequencyGroup==='weekdays').controls[0].disabled,false);
  assert.equal(ctx.renderCount||0,0);
});

test('editar actualiza en el mismo índice y conserva id, scope y logs',()=>{
  const state=initialState();
  const original=habit({logs:{'2026-11-01':true,'2026-11-03':true}});
  const second=habit({id:'habit-b',name:'Caminar'});
  state.personal.habits.push(original,second);
  const ctx=context(state);
  openHabit(ctx,'habit-a');
  const result=ctx.modalCalls[0].onSubmit({
    name:'Agua con calma',
    scope:'personal',
    icon:'droplets',
    color:COLORS[1],
    frequency:'daily',
    type:'check',
    startDate:'2026-10-01'
  },null);
  assert.notEqual(result,false);
  assert.deepEqual(state.personal.habits.map(item=>item.id),['habit-a','habit-b']);
  assert.equal(state.personal.habits[0].name,'Agua con calma');
  assert.equal(state.personal.habits[0].logs['2026-11-03'],true);
  assert.equal(state.personal.habits[0].color,COLORS[1]);
});

test('la validación devuelve false para días, fechas, intervalos y metas inválidos',()=>{
  const state=initialState();
  const ctx=context(state);
  openHabit(ctx);
  const submit=ctx.modalCalls[0].onSubmit;
  assert.equal(submit({name:'Sin días',frequency:'weekdays',type:'check',startDate:'2026-11-03',weekday:[]},null),false);
  assert.equal(submit({name:'Sin fecha',frequency:'daily',type:'check',startDate:''},null),false);
  assert.equal(submit({name:'Intervalo cero',frequency:'interval',type:'check',startDate:'2026-11-03',interval:'0'},null),false);
  assert.equal(submit({name:'Meta cero',frequency:'daily',type:'quantity',startDate:'2026-11-03',target:'0',unit:''},null),false);
  assert.equal(state.personal.habits.length,0);
  assert.equal(ctx.messages.length,4);
});

test('la fecha mensual determina startDate y monthDay, y la próxima ocurrencia no está hardcodeada',()=>{
  const state=initialState();
  const ctx=context(state,'2026-11-03');
  openHabit(ctx);
  const result=ctx.modalCalls[0].onSubmit({
    name:'Revisión mensual',
    scope:'personal',
    icon:'calendar',
    color:COLORS[0],
    frequency:'monthly',
    type:'check',
    monthlyDate:'2026-11-03'
  },null);
  assert.notEqual(result,false);
  const saved=state.personal.habits[0];
  assert.equal(saved.startDate,'2026-11-03');
  assert.equal(saved.monthDay,3);
  assert.equal(nextMonthlyOccurrence(saved,'2026-11-03'),'2026-12-03');
  assert.equal(nextMonthlyOccurrence({startDate:'2026-01-01',monthDay:31},'2026-01-31'),'2026-02-28');
  assert.equal(nextMonthlyOccurrence({startDate:'2026-01-01',monthDay:31},'2026-02-28'),'2026-03-31');
});

test('el detalle expone fecha marcada, semana, cantidad/historial y botón de editar',()=>{
  const state=initialState();
  state.personal.habits.push(habit({type:'quantity',target:2,unit:'litros',goalPeriod:'week',logs:{'2026-11-02':1.5,'2026-11-03':.5}}));
  const ctx=context(state);
  openHabitDetails(ctx,'habit-a','2026-11-03');
  const html=ctx.modalCalls[0].html;
  assert.match(html,/Registro del día/);
  assert.match(html,/Esta semana/);
  assert.match(html,/Historial/);
  assert.match(html,/1\.5 litros/);
  assert.match(html,/habit-detail-edit/);
});

test('editar un hábito mensual anterior alinea el calendario con monthDay y no cambia el día al guardar',()=>{
  const state=initialState();state.personal.habits.push(habit({frequency:'monthly',startDate:'2026-11-01',monthDay:3}));
  const ctx=context(state);openHabit(ctx,'habit-a');const modal=ctx.modalCalls[0];
  assert.match(modal.html,/name="monthlyDate" value="2026-11-03"/);
  modal.onSubmit({name:'Agua',frequency:'monthly',type:'check',monthlyDate:'2026-11-03'},null);
  assert.equal(state.personal.habits[0].monthDay,3);
});

test('fallo al guardar hábito, moverlo o borrarlo restaura ambos ámbitos',()=>{
 const state=initialState();state.personal.habits.push(habit());const before=JSON.stringify(state);const ctx=context(state);ctx.save=()=>false;
 openHabit(ctx,'habit-a');assert.equal(ctx.modalCalls[0].onSubmit({name:'Cambio',scope:'home',frequency:'daily',type:'check',startDate:'2026-11-03'}),false);assert.equal(JSON.stringify(state),before);
 registerHabits(ctx);ctx.actions.get('habit-delete')({id:'habit-a'});assert.equal(JSON.stringify(state),before);assert.equal(ctx.renderCount||0,0);
});
test('un fallo al guardar cantidad, check o mood no altera los registros',()=>{
 const state=initialState();state.personal.habits.push(habit({type:'quantity',target:2,unit:'litros'}),habit({id:'habit-check'}));const ctx=context(state);ctx.save=()=>false;registerHabits(ctx);
 ctx.actions.get('habit-toggle')({id:'habit-a',date:'2026-11-03'});assert.equal(ctx.modalCalls.at(-1).onSubmit({quantity:'1',date:'2026-11-03'}),false);assert.deepEqual(state.personal.habits[0].logs,{});
 ctx.actions.get('habit-toggle')({id:'habit-check',date:'2026-11-03'});assert.deepEqual(state.personal.habits[1].logs,{});
 ctx.actions.get('mood-open')({date:'2026-11-03'});assert.equal(ctx.modalCalls.at(-1).onSubmit({date:'2026-11-03',mood:'calma',note:'No guardada'}),false);assert.equal(state.personal.moods.length,0);
});
test('no crea registros nuevos en días no programados, pero permite corregir registros antiguos',()=>{
 const state=initialState();state.personal.habits.push(habit({frequency:'monthly',startDate:'2026-11-01',monthDay:3}));const ctx=context(state);registerHabits(ctx);
 ctx.actions.get('habit-toggle')({id:'habit-a',date:'2026-11-04'});assert.deepEqual(state.personal.habits[0].logs,{});assert.match(renderHabits({...ctx,view:{habitDate:'2026-11-04'}}),/disabled title="No programado/);
 state.personal.habits[0].logs['2026-11-04']=true;ctx.actions.get('habit-toggle')({id:'habit-a',date:'2026-11-04'});assert.equal(state.personal.habits[0].logs['2026-11-04'],false);
});
