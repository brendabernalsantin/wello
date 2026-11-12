import {COLORS,MOODS,visibleHabits,scheduled,habitProgress,upsertMood,weekStart,addDays,esc as coreEsc} from '../core.js';

const days=['D','L','M','M','J','V','S'];
const dayNames=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const iconOptions=[
  {value:'leaf',label:'Planta'},
  {value:'book-open',label:'Lectura'},
  {value:'droplets',label:'Agua'},
  {value:'footprints',label:'Paseo'},
  {value:'heart',label:'Cuidado'},
  {value:'dumbbell',label:'Movimiento'}
];
const frequencyValues=new Set(['daily','weekdays','interval','monthly']);
const typeValues=new Set(['check','quantity']);
const goalPeriods=new Set(['day','week']);

function escape(ctx,value='') { return typeof ctx?.esc==='function'?ctx.esc(value):coreEsc(value); }
function icon(ctx,name,size=20) { return typeof ctx?.icon==='function'?ctx.icon(name,size):''; }
function todayOf(ctx) { return typeof ctx?.today==='function'?ctx.today():'1970-01-01'; }
function safeDate(ctx,value) {
  const today=todayOf(ctx);
  return validDate(value)?value:(validDate(today)?today:'1970-01-01');
}
function selectedHabitDate(ctx) { return safeDate(ctx,ctx?.view?.habitDate); }
function moodActionDate(ctx,data={}) {
  if(validDate(data.date))return data.date;
  return data.moodContext==='habits'?selectedHabitDate(ctx):safeDate(ctx,todayOf(ctx));
}
function moodSprite(ctx,id,imgClass='') {
  return typeof ctx?.img==='function'?`<span class="mood-sprite">${ctx.img(`mood-${id}`,imgClass)}</span>`:'';
}
function toast(ctx,message) { if(typeof ctx?.toast==='function')ctx.toast(message); }
function persist(ctx,rollback=()=>{}) {
  try { if(typeof ctx?.save!=='function'||ctx.save()!==false)return true; } catch(error) { toast(ctx,error.message||'No se pudo guardar.'); }
  rollback();return false;
}
function validDate(value) {
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00`);
  if(Number.isNaN(date.getTime()))return false;
  const normalized=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return normalized===value;
}
function finiteNumber(value,fallback) {
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}
function positiveNumber(value,fallback) {
  const number=finiteNumber(value,fallback);
  return number>0?number:fallback;
}
function integerInRange(value,fallback,min=1,max=365) {
  const number=Math.round(finiteNumber(value,fallback));
  return Math.min(max,Math.max(min,number));
}
function source(ctx,id) {
  const state=typeof ctx?.state==='function'?ctx.state():{};
  const personal=state?.personal?.habits||[];
  const home=typeof ctx?.home==='function'?(ctx.home()?.habits||[]):[];
  const personalHabit=personal.find(h=>h.id===id);
  if(personalHabit)return {habit:personalHabit,list:personal,scope:'personal'};
  const homeHabit=home.find(h=>h.id===id);
  return homeHabit?{habit:homeHabit,list:home,scope:'home'}:null;
}
function defaultHabit(ctx) {
  return {
    name:'',
    icon:'leaf',
    color:COLORS[0],
    startDate:todayOf(ctx),
    frequency:'daily',
    weekdays:[1,2,3,4,5],
    interval:2,
    monthDay:1,
    type:'check',
    target:1,
    unit:'veces',
    goalPeriod:'day',
    logs:{}
  };
}
function inputField(ctx,label,name,value='',type='text',extra='',disabled=false) {
  const attributes=[extra,disabled?'disabled':''].filter(Boolean).join(' ');
  if(!disabled&&typeof ctx?.field==='function')return ctx.field(label,name,value??'',type,attributes);
  return `<label class="field">${escape(ctx,label)}<input type="${escape(ctx,type)}" name="${escape(ctx,name)}" value="${escape(ctx,value??'')}" ${attributes}></label>`;
}
function selectField(ctx,label,name,options,value,disabled=false,extra='') {
  if(!disabled&&typeof ctx?.select==='function') {
    const rendered=ctx.select(label,name,options,value);
    return rendered.replace(`<select name="${name}"`,`<select name="${name}" ${extra}`);
  }
  const attributes=[extra,disabled?'disabled':''].filter(Boolean).join(' ');
  return `<label class="field">${escape(ctx,label)}<select name="${escape(ctx,name)}" ${attributes}>${options.map(option=>{
    const optionValue=typeof option==='string'?option:option.value;
    const optionLabel=typeof option==='string'?option:option.label;
    return `<option value="${escape(ctx,optionValue)}" ${String(optionValue)===String(value)?'selected':''}>${escape(ctx,optionLabel)}</option>`;
  }).join('')}</select></label>`;
}
function checkedValue(form,name) {
  const nodes=form?.querySelectorAll?.(`[name="${name}"]`)||[];
  return [...nodes].find(node=>node.checked)?.value;
}
function selectedWeekdays(form,data,h) {
  const nodes=form?.querySelectorAll?.('[name="weekday"]')||[];
  if(nodes.length)return [...nodes].filter(node=>node.checked).map(node=>integerInRange(node.value,0,0,6));
  const raw=data?.weekday;
  if(Array.isArray(raw))return raw.map(day=>integerInRange(day,0,0,6));
  if(raw!==undefined&&raw!=='')return [integerInRange(raw,0,0,6)];
  return Array.isArray(h?.weekdays)?h.weekdays.slice():[];
}
function formValue(data,form,name,fallback='') {
  if(data&&data[name]!==undefined)return data[name];
  const element=form?.querySelector?.(`[name="${name}"]`);
  return element?.value??fallback;
}
function formFrequency(form) { return form?.querySelector?.('[name="frequency"]')?.value||'daily'; }
function formType(form) { return form?.querySelector?.('[name="type"]')?.value||'check'; }
function monthlyPreview(ctx,date) {
  if(!validDate(date))return 'Elige una fecha para calcular la próxima ocurrencia.';
  const next=nextMonthlyOccurrence({startDate:date,monthDay:Number(date.slice(8,10))},todayOf(ctx));
  const pretty=typeof ctx?.prettyDate==='function'?ctx.prettyDate(next):next;
  return `Próxima ocurrencia: ${pretty}`;
}
function syncHabitForm(ctx,form) {
  if(!form)return;
  const frequency=formFrequency(form);
  const type=formType(form);
  const frequencyGroups=form.querySelectorAll?.('[data-frequency-group]')||[];
  [...frequencyGroups].forEach(group=>{
    const active=group.dataset.frequencyGroup===frequency;
    group.hidden=!active;
    [...(group.querySelectorAll?.('input,select,textarea')||[])].forEach(field=>{field.disabled=!active;});
  });
  const typeGroups=form.querySelectorAll?.('[data-type-group]')||[];
  [...typeGroups].forEach(group=>{
    const active=group.dataset.typeGroup===type;
    group.hidden=!active;
    [...(group.querySelectorAll?.('input,select,textarea')||[])].forEach(field=>{field.disabled=!active;});
  });
  const date=form.querySelector?.('[name="monthlyDate"]');
  const preview=form.querySelector?.('[data-monthly-preview]');
  if(preview)preview.textContent=monthlyPreview(ctx,date?.value||'');
}
function frequencyLabel(ctx,habit) {
  switch(habit.frequency) {
    case 'weekdays': {
      const selected=(habit.weekdays||[]).slice().sort((a,b)=>a-b).map(day=>dayNames[day]?.slice(0,3)).join(', ');
      return selected?`Días: ${selected}`:'Días elegidos';
    }
    case 'interval':return `Cada ${integerInRange(habit.interval,1)} días`;
    case 'monthly':return `Día ${integerInRange(habit.monthDay,1,1,31)} de cada mes`;
    default:return 'Todos los días';
  }
}
function goalLabel(ctx,habit,progress) {
  if(habit.type!=='quantity')return progress.done?'Hecho hoy':'Pendiente hoy';
  const target=positiveNumber(habit.target,1);
  const unit=habit.unit?.trim()||'veces';
  const period=habit.goalPeriod==='week'?'esta semana':'hoy';
  return `Meta ${progress.value}/${target} ${escape(ctx,unit)} · ${period}`;
}
function prettyDate(ctx,date) {
  return typeof ctx?.prettyDate==='function'?ctx.prettyDate(date):date;
}
function dayMark(ctx,habit,day,current=false) {
  const marked=habit.type==='quantity'?finiteNumber(habit.logs?.[day],0)>0:habit.logs?.[day]===true;
  const className=`habit-detail-day ${marked?'is-done':''} ${current?'is-current':''}`;
  const dayName=days[new Date(`${day}T12:00:00`).getDay()];
  return `<span class="${className}" title="${escape(ctx,prettyDate(ctx,day))}"><b>${dayName}</b><small>${marked?'✓':'·'}</small></span>`;
}
function weeklyMarks(ctx,habit,date) {
  const start=weekStart(date);
  const marks=Array.from({length:7},(_,index)=>{
    const day=addDays(start,index);
    const marked=habit.type==='quantity'?finiteNumber(habit.logs?.[day],0)>0:habit.logs?.[day]===true;
    const scheduledDay=scheduled(habit,day);
    const className=`habit-week-mark ${marked?'is-done':''} ${scheduledDay?'is-scheduled':''}`;
    const dayName=days[new Date(`${day}T12:00:00`).getDay()];
    return `<span class="${className}" title="${escape(ctx,prettyDate(ctx,day))}">${dayName}</span>`;
  }).join('');
  return `<span class="habit-row-week" aria-label="Semana de ${escape(ctx,prettyDate(ctx,start))}">${marks}</span>`;
}
function renderHabitRow(ctx,habit,date) {
  const progress=habitProgress(habit,date);
  const active=scheduled(habit,date);
  const color=COLORS.includes(habit.color)?habit.color:COLORS[0];
  const scope=habit.scope==='home'?'Mi hogar':'Para mí';
  const checkLabel=habit.type==='quantity'?`Registrar cantidad de ${escape(ctx,habit.name)}`:`Marcar ${escape(ctx,habit.name)} como ${progress.done?'pendiente':'hecho'}`;
  const row=`<button type="button" class="habit-row" data-action="habit-detail" data-id="${escape(ctx,habit.id)}" data-date="${escape(ctx,date)}" aria-label="Abrir detalles de ${escape(ctx,habit.name)}"><span class="habit-row-icon">${icon(ctx,habit.icon||'leaf',22)}</span><span class="habit-row-main"><strong>${escape(ctx,habit.name)}</strong></span><span class="habit-row-arrow">${icon(ctx,'chevron-right',17)}</span></button>`;
  const check=`<button type="button" class="habit-row-check ${progress.done?'is-done':''}" data-action="habit-toggle" data-id="${escape(ctx,habit.id)}" data-date="${escape(ctx,date)}" aria-label="${checkLabel}" ${!active&&habit.logs?.[date]===undefined?'disabled title="No programado para este día"':''} aria-pressed="${progress.done?'true':'false'}">${icon(ctx,habit.type==='quantity'?'plus':'check',19)}</button>`;
  return `<div class="habit-row-shell" style="--habit-color:${color}">${row}${check}</div>`;
}
function detailHistory(ctx,habit) {
  const entries=Object.entries(habit.logs||{}).filter(([date,value])=>validDate(date)&&(habit.type==='quantity'?Number.isFinite(Number(value)):value===true)).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
  if(!entries.length)return '<p class="muted small">Todavía no hay registros guardados.</p>';
  const rows=entries.map(([date,value])=>{
    const amount=habit.type==='quantity'?`${escape(ctx,positiveNumber(value,0))} ${escape(ctx,habit.unit?.trim()||'veces')}`:'Marcado como hecho';
    return `<div class="list-row"><span><strong>${escape(ctx,prettyDate(ctx,date))}</strong><span class="small muted">${amount}</span></span>${icon(ctx,'check',17)}</div>`;
  }).join('');
  return `<div class="habit-detail-history">${rows}</div>`;
}
function detailWeek(ctx,habit,date) {
  const start=weekStart(date);
  const marks=Array.from({length:7},(_,index)=>dayMark(ctx,habit,addDays(start,index),addDays(start,index)===date)).join('');
  return `<div class="habit-detail-week">${marks}</div>`;
}
function habitDetailMarkup(ctx,habit,found,id,date) {
  const progress=habitProgress(habit,date);
  const active=scheduled(habit,date);
  const unit=habit.unit?.trim()||'veces';
  const quantity=habit.type==='quantity';
  const value=quantity?finiteNumber(progress.value,0):progress.done?1:0;
  const markText=quantity?`${value} ${escape(ctx,unit)} registrados`:(progress.done?'Marcado como hecho':'Aún no marcado');
  const identity=`<div class="habit-detail-identity"><span class="habit-detail-icon" style="--habit-color:${COLORS.includes(habit.color)?habit.color:COLORS[0]}">${icon(ctx,habit.icon||'leaf',28)}</span><div><span class="eyebrow">${escape(ctx,found.scope==='home'?'MI HOGAR':'PARA MÍ')}</span><h3>${escape(ctx,habit.name)}</h3><p class="small muted">${escape(ctx,frequencyLabel(ctx,habit))}</p></div></div>`;
  const dayRecord=`<section class="habit-detail-section"><h3>Registro del día</h3><div class="habit-detail-stat"><span>${escape(ctx,prettyDate(ctx,date))}</span><strong class="${active?'':'is-muted'}">${escape(ctx,active?markText:'No programado')}</strong></div>${quantity?`<p class="small muted">Meta: ${escape(ctx,positiveNumber(habit.target,1))} ${escape(ctx,unit)} · ${habit.goalPeriod==='week'?'esta semana':'hoy'} · Faltan ${escape(ctx,Number(progress.remaining.toFixed(3)))} ${escape(ctx,unit)}</p>`:''}</section>`;
  const weekRecord=`<section class="habit-detail-section"><h3>Esta semana</h3>${detailWeek(ctx,habit,date)}</section>`;
  const history=`<section class="habit-detail-section"><div class="section-head"><h3>Historial</h3><span class="small muted">Últimos 12 registros</span></div>${detailHistory(ctx,habit)}</section>`;
  const editButton=ctx.btn('Editar hábito','habit-detail-edit',`data-id="${escape(ctx,id)}"`,'secondary');
  return `<div class="habit-detail">${identity}${dayRecord}${weekRecord}${history}${editButton}</div>`;
}
function quantityMarkup(ctx,habit,date,progress) {
  const unit=habit.unit?.trim()||'veces';
  const target=positiveNumber(habit.target,1);
  const summary=`<p class="muted">Meta: ${escape(ctx,target)} ${escape(ctx,unit)} ${habit.goalPeriod==='week'?'esta semana':'al día'}. Llevas ${escape(ctx,finiteNumber(progress.value,0))}; faltan ${escape(ctx,finiteNumber(progress.remaining,target))}.</p>`;
  const dateField=inputField(ctx,'Fecha','date',date,'date','required');
  const amountField=inputField(ctx,`Cantidad total de ese día (${unit})`,'quantity',habit.logs?.[date]??'','number','required min="0" step="any"');
  const note='<p class="small muted">Se reemplaza la cantidad de este día. No se inventan cantidades al marcar desde Inicio.</p>';
  return `${summary}${dateField}${amountField}${note}`;
}

export function nextMonthlyOccurrence(habitOrStartDate,fromDate) {
  const habit=typeof habitOrStartDate==='string'?{startDate:habitOrStartDate,monthDay:Number(habitOrStartDate.slice(8,10))}:habitOrStartDate||{};
  const startDate=validDate(habit.startDate)?habit.startDate:null;
  const referenceDate=validDate(fromDate)?fromDate:(startDate||'1970-01-01');
  const reference=new Date(`${referenceDate}T12:00:00`);
  const day=integerInRange(habit.monthDay,startDate?Number(startDate.slice(8,10)):1,1,31);
  const minimum=startDate||'0000-01-01';
  let cursor=new Date(reference.getFullYear(),reference.getMonth(),1,12);
  for(let attempt=0;attempt<240;attempt+=1) {
    const lastDay=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate();
    const candidateDate=new Date(cursor.getFullYear(),cursor.getMonth(),Math.min(day,lastDay),12);
    const candidate=`${candidateDate.getFullYear()}-${String(candidateDate.getMonth()+1).padStart(2,'0')}-${String(candidateDate.getDate()).padStart(2,'0')}`;
    if(candidate>referenceDate&&candidate>=minimum)return candidate;
    cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1,12);
  }
  return referenceDate;
}

function frequencyGroup(name,content,active) {
  return `<div class="habit-frequency-group" data-frequency-group="${name}" ${active?'':'hidden'}>${content}</div>`;
}
function typeGroup(name,content,active) {
  return `<div class="habit-type-group" data-type-group="${name}" ${active?'':'hidden'}>${content}</div>`;
}
function colorPicker(ctx,color) {
  const swatches=COLORS.map((option,index)=>`<label class="swatch" style="--swatch:${option}" title="Tono ${index+1}"><input type="radio" name="color" value="${option}" aria-label="Tono ${index+1}" ${color===option?'checked':''}><span aria-hidden="true">${icon(ctx,'check',16)}</span></label>`).join('');
  return `<fieldset class="color-picker"><legend>El color de tu tarjeta</legend><div class="swatches">${swatches}</div></fieldset>`;
}
function iconPicker(ctx,selected) {
  const choices=iconOptions.map(option=>`<label class="habit-icon-option" title="${escape(ctx,option.label)}"><input class="habit-icon-radio sr-only" type="radio" name="icon" value="${option.value}" aria-label="Icono ${escape(ctx,option.label)}" ${selected===option.value?'checked':''}><span class="habit-icon-visual" aria-hidden="true">${icon(ctx,option.value,24)}</span></label>`).join('');
  return `<fieldset class="habit-icon-picker"><legend>Elige un icono</legend><div class="habit-icon-options">${choices}</div></fieldset>`;
}
function weekdayPicker(ctx,frequency,selectedDays) {
  const choices=days.map((day,index)=>`<label title="${dayNames[index]}"><input type="checkbox" name="weekday" value="${index}" ${selectedDays.includes(index)?'checked':''} ${frequency==='weekdays'?'':'disabled'} aria-label="${dayNames[index]}"><span>${day}</span></label>`).join('');
  return `<fieldset class="habit-weekday-field"><legend>¿Qué días?</legend><div class="week-pick habit-week-pick">${choices}</div></fieldset>`;
}
function frequencyFields(ctx,h,frequency) {
  const selectedDays=Array.isArray(h.weekdays)?h.weekdays:[1,2,3,4,5];
  const startDateField=disabled=>inputField(ctx,'Empieza el','startDate',h.startDate,'date','required',disabled);
  let monthlyDate=h.startDate;
  if(frequency==='monthly'&&h.monthDay!==Number(h.startDate.slice(-2))){
    const prior=addDays(h.startDate,-1);monthlyDate=nextMonthlyOccurrence(h,prior);
  }
  const monthlyText=monthlyPreview(ctx,monthlyDate);
  const groups=[
    frequencyGroup('daily',startDateField(frequency!=='daily'),frequency==='daily'),
    frequencyGroup('weekdays',`${startDateField(frequency!=='weekdays')}${weekdayPicker(ctx,frequency,selectedDays)}`,frequency==='weekdays'),
    frequencyGroup('interval',`${startDateField(frequency!=='interval')}${inputField(ctx,'Cada cuántos días (N)','interval',integerInRange(h.interval,2),'number','required min="1" max="365"',frequency!=='interval')}`,frequency==='interval'),
    frequencyGroup('monthly',`${inputField(ctx,'Fecha mensual','monthlyDate',monthlyDate,'date','required data-change="habit-monthly-date"',frequency!=='monthly')}<p class="small muted habit-monthly-preview" data-monthly-preview>${escape(ctx,monthlyText)}</p><p class="small muted">Si un mes no tiene ese día, se usa su último día.</p>`,frequency==='monthly')
  ];
  return `<section class="habit-frequency-fields" aria-label="Configuración de frecuencia">${groups.join('')}</section>`;
}
function typeFields(ctx,h,type) {
  const quantityFields=`<div class="form-grid habit-quantity-fields">${inputField(ctx,'Cantidad objetivo','target',positiveNumber(h.target,1),'number','required min="0.01" step="any"',type!=='quantity')}${inputField(ctx,'Unidad','unit',h.unit?.trim()||'veces','text','required maxlength="30" placeholder="litros, paseos…"',type!=='quantity')}${selectField(ctx,'La meta se cumple','goalPeriod',[{value:'day',label:'Por día'},{value:'week',label:'Por semana (lunes a domingo)'}],goalPeriods.has(h.goalPeriod)?h.goalPeriod:'day',type!=='quantity')}</div>`;
  const groups=[
    typeGroup('check','<p class="small muted habit-check-help">Marca el hábito cuando lo completes.</p>',type==='check'),
    typeGroup('quantity',`${quantityFields}<p class="small muted">Las metas semanales suman cantidades registradas de lunes a domingo.</p>`,type==='quantity')
  ];
  return `<section class="habit-type-fields" aria-label="Configuración de meta">${groups.join('')}</section>`;
}
function habitForm(ctx,h,frequency,type) {
  const frequencyOptions=[
    {value:'daily',label:'Todos los días'},
    {value:'weekdays',label:'Días de la semana'},
    {value:'interval',label:'Cada cierto número de días'},
    {value:'monthly',label:'Una vez al mes'}
  ];
  const typeOptions=[
    {value:'check',label:'Marcar como hecho'},
    {value:'quantity',label:'Registrar una cantidad'}
  ];
  const mainFields=[
    inputField(ctx,'Nombre del hábito','name',h.name,'text','required maxlength="100" placeholder="Leer un rato"'),
    selectField(ctx,'¿Para quién?','scope',[{value:'personal',label:'Para mí'},{value:'home',label:'Para mi hogar'}],h.scope||'personal'),
    selectField(ctx,'Frecuencia','frequency',frequencyOptions,frequency,false,'data-change="habit-frequency"'),
    selectField(ctx,'Tipo de meta','type',typeOptions,type,false,'data-change="habit-type"')
  ].join('');
  return `<div class="form-grid habit-main-fields">${mainFields}</div>${colorPicker(ctx,h.color)}${iconPicker(ctx,h.icon)}${frequencyFields(ctx,h,frequency)}${typeFields(ctx,h,type)}`;
}

export function openHabit(ctx,id) {
  const found=id!==undefined&&id!==null?source(ctx,id):null;
  const base=found?.habit||defaultHabit(ctx);
  const h={...defaultHabit(ctx),...base};
  const frequency=frequencyValues.has(h.frequency)?h.frequency:'daily';
  const type=typeValues.has(h.type)?h.type:'check';
  h.frequency=frequency;
  h.type=type;
  h.weekdays=Array.isArray(h.weekdays)?h.weekdays:[1,2,3,4,5];
  h.startDate=validDate(h.startDate)?h.startDate:todayOf(ctx);
  h.color=COLORS.includes(h.color)?h.color:COLORS[0];
  h.icon=iconOptions.some(option=>option.value===h.icon)?h.icon:'leaf';
  const html=habitForm(ctx,{...h,scope:found?.scope||'personal'},frequency,type);
  ctx.modal(id!==undefined&&id!==null?'Editar hábito':'Un pequeño paso nuevo',html+(id!==undefined&&id!==null?ctx.btn('Eliminar hábito','habit-delete',`data-id="${escape(ctx,id)}"`,'danger'):''),(data={},form)=>{
    const rawFrequency=String(formValue(data,form,'frequency',frequency));
    const nextFrequency=frequencyValues.has(rawFrequency)?rawFrequency:frequency;
    const rawType=String(formValue(data,form,'type',type));
    const nextType=typeValues.has(rawType)?rawType:type;
    const selectedIcon=String(data.icon??checkedValue(form,'icon')??h.icon);
    const nextIcon=iconOptions.some(option=>option.value===selectedIcon)?selectedIcon:h.icon;
    const selectedColor=String(data.color??checkedValue(form,'color')??h.color);
    const nextColor=COLORS.includes(selectedColor)?selectedColor:COLORS[0];
    const weekdays=selectedWeekdays(form,data,h);
    if(nextFrequency==='weekdays'&&!weekdays.length) {
      toast(ctx,'Elige al menos un día.');
      return false;
    }
    const monthlyInput=form?.querySelector?.('[name="monthlyDate"]');
    const startInput=form?.querySelector?.('[name="startDate"]');
    const monthlyProvided=Object.prototype.hasOwnProperty.call(data,'monthlyDate')||Boolean(monthlyInput&&!monthlyInput.disabled);
    const startProvided=Object.prototype.hasOwnProperty.call(data,'startDate')||Boolean(startInput&&!startInput.disabled);
    const monthlyDate=String(formValue(data,form,'monthlyDate',''));
    const requestedStart=nextFrequency==='monthly'?monthlyDate:String(formValue(data,form,'startDate',''));
    if((nextFrequency==='monthly'&&monthlyProvided&&!validDate(requestedStart))||(nextFrequency!=='monthly'&&startProvided&&!validDate(requestedStart))) {
      toast(ctx,'Elige una fecha de inicio.');
      return false;
    }
    const startDate=validDate(requestedStart)?requestedStart:(validDate(h.startDate)?h.startDate:'');
    if(!validDate(startDate)) {
      toast(ctx,'Elige una fecha de inicio.');
      return false;
    }
    const intervalInput=form?.querySelector?.('[name="interval"]');
    const intervalProvided=Object.prototype.hasOwnProperty.call(data,'interval')||Boolean(intervalInput&&!intervalInput.disabled);
    const intervalRaw=intervalProvided?formValue(data,form,'interval',''):undefined;
    const intervalNumber=intervalRaw===undefined?integerInRange(h.interval,2):Number(intervalRaw);
    if(nextFrequency==='interval'&&(!Number.isFinite(intervalNumber)||intervalNumber<1)) {
      toast(ctx,'Indica cada cuántos días.');
      return false;
    }
    const nextInterval=integerInRange(intervalNumber,integerInRange(h.interval,2));
    const targetInput=form?.querySelector?.('[name="target"]');
    const unitInput=form?.querySelector?.('[name="unit"]');
    const targetProvided=Object.prototype.hasOwnProperty.call(data,'target')||Boolean(targetInput&&!targetInput.disabled);
    const unitProvided=Object.prototype.hasOwnProperty.call(data,'unit')||Boolean(unitInput&&!unitInput.disabled);
    const targetRaw=targetProvided?formValue(data,form,'target',''):undefined;
    const unitRaw=unitProvided?formValue(data,form,'unit',''):undefined;
    const targetNumber=targetRaw===undefined?positiveNumber(h.target,1):Number(targetRaw);
    const nextTarget=Number.isFinite(targetNumber)&&targetNumber>0?targetNumber:positiveNumber(h.target,1);
    const nextUnit=unitRaw===undefined?String(h.unit||'veces').trim()||'veces':String(unitRaw).trim();
    if(nextType==='quantity'&&((targetRaw!==undefined&&(!Number.isFinite(targetNumber)||targetNumber<=0))||(unitRaw!==undefined&&!nextUnit))) {
      toast(ctx,'Escribe una meta mayor que cero y su unidad.');
      return false;
    }
    const requestedGoal=String(formValue(data,form,'goalPeriod',h.goalPeriod||'day'));
    const nextGoal=goalPeriods.has(requestedGoal)?requestedGoal:(goalPeriods.has(h.goalPeriod)?h.goalPeriod:'day');
    const monthDay=nextFrequency==='monthly'?integerInRange(startDate.slice(8,10),1,1,31):integerInRange(h.monthDay,1,1,31);
    const record={...h,id:id!==undefined&&id!==null?id:(typeof ctx?.id==='function'?ctx.id() : `habit-${Date.now()}`),name:String(formValue(data,form,'name',h.name)).trim(),icon:nextIcon,color:nextColor,startDate,frequency:nextFrequency,weekdays,interval:nextInterval,monthDay,type:nextType,target:nextTarget,unit:nextUnit,goalPeriod:nextGoal,logs:h.logs&&typeof h.logs==='object'?h.logs:{}};
    if(!record.name) {
      toast(ctx,'Escribe el nombre.');
      return false;
    }
    const scopeValue=String(formValue(data,form,'scope',found?.scope||'personal'));
    const scope=scopeValue==='home'?'home':'personal';
    const beforePersonal=structuredClone(ctx.state().personal.habits);
    const beforeHome=structuredClone(ctx.home().habits);
    const targetList=scope==='personal'?(ctx.state().personal.habits):(ctx.home().habits);
    if(found) {
      const index=found.list.findIndex(item=>item.id===id);
      if(found.scope===scope&&index>=0)found.list[index]=record;
      else {
        if(index>=0)found.list.splice(index,1);
        targetList.push(record);
      }
    } else targetList.push(record);
    if(!persist(ctx,()=>{ctx.state().personal.habits=beforePersonal;ctx.home().habits=beforeHome;}))return false;
    if(typeof ctx?.render==='function')ctx.render();
  });
}

export function openHabitDetails(ctx,id,date=todayOf(ctx)) {
  const found=source(ctx,id);
  if(!found?.habit)return;
  const habit=found.habit;
  const selectedDate=validDate(date)?date:todayOf(ctx);
  ctx.modal(habit.name,habitDetailMarkup(ctx,habit,found,id,selectedDate));
}

export function openQuantity(ctx,id,date=todayOf(ctx)) {
  const found=source(ctx,id);
  const habit=found?.habit;
  if(!habit)return;
  const selectedDate=validDate(date)?date:todayOf(ctx);
  if(!scheduled(habit,selectedDate)&&habit.logs?.[selectedDate]===undefined){toast(ctx,'Este hábito no está programado para ese día.');return;}
  const progress=habitProgress(habit,selectedDate);
  ctx.modal(habit.name,quantityMarkup(ctx,habit,selectedDate,progress),data=>{
    const value=Number(data.quantity);
    if(!Number.isFinite(value)||value<0)return false;
    if(!validDate(data.date))return false;
    if(!scheduled(habit,data.date)&&habit.logs?.[data.date]===undefined){toast(ctx,'Elige un día programado para este hábito.');return false;}
    const beforeLogs=structuredClone(habit.logs||{});
    habit.logs||={};
    habit.logs[data.date]=value;
    if(!persist(ctx,()=>{habit.logs=beforeLogs;}))return false;
    if(typeof ctx?.render==='function')ctx.render();
  });
}

export function toggleHabit(ctx,id,date=todayOf(ctx)) {
  const found=source(ctx,id);
  const habit=found?.habit;
  if(!habit)return;
  const selectedDate=validDate(date)?date:todayOf(ctx);
  if(habit.type==='quantity') {
    openQuantity(ctx,id,selectedDate);
    return;
  }
  if(!scheduled(habit,selectedDate)&&habit.logs?.[selectedDate]===undefined){toast(ctx,'Este hábito no está programado para ese día.');return;}
  const beforeLogs=structuredClone(habit.logs||{});
  habit.logs||={};
  habit.logs[selectedDate]=!habit.logs[selectedDate];
  if(!persist(ctx,()=>{habit.logs=beforeLogs;}))return false;
  if(typeof ctx?.render==='function')ctx.render();
}

export function openMood(ctx,date) {
  const selectedDate=safeDate(ctx,date);
  const moods=ctx.state().personal.moods||[];
  const mood=moods.find(item=>item.date===selectedDate);
  ctx.modal('Mi estado de ánimo',`${inputField(ctx,'Fecha','date',selectedDate,'date','required aria-label="Fecha del estado de ánimo"')}<fieldset class="mood-choices"><legend>¿Cómo te sientes?</legend><div class="mood-grid">${MOODS.map(item=>`<label class="mood-option"><input type="radio" name="mood" value="${item.id}" ${mood?.mood===item.id?'checked':''} required>${typeof ctx?.img==='function'?ctx.img('mood-'+item.id,'mood-optionimg-animation'):''}<span>${item.name}</span></label>`).join('')}</div></fieldset><label class="field">Una nota para ti <span class="muted">(opcional)</span><textarea name="note" maxlength="1000" rows="3" placeholder="¿Qué quieres recordar de este día?">${escape(ctx,mood?.note||'')}</textarea><span class="small muted">Hasta 1000 caracteres. Solo para ti.</span></label>`,data=>{
    try {
      const beforeMoods=structuredClone(ctx.state().personal.moods);
      upsertMood(ctx.state(),data.date,data.mood,data.note);
      if(!persist(ctx,()=>{ctx.state().personal.moods=beforeMoods;}))return false;
      ctx.view.habitDate=data.date;
      if(typeof ctx?.render==='function')ctx.render();
    } catch(error) {
      toast(ctx,error.message);
      return false;
    }
  });
}

export function renderHabits(ctx) {
  const date=selectedHabitDate(ctx);
  const list=visibleHabits(ctx.state());
  const mood=(ctx.state().personal.moods||[]).find(item=>item.date===date);
  const week=weekStart(date);
  const moodName=MOODS.find(item=>item.id===mood?.mood)?.name?.toLowerCase()||'';
  const today=safeDate(ctx,todayOf(ctx));
  const moodTitle=mood?(date===today?`Hoy estoy ${escape(ctx,moodName)}`:date<today?`Ese día me sentí ${escape(ctx,moodName)}`:`Estado registrado: ${escape(ctx,moodName)}`):'Estado de ánimo';
  const moodNote=mood?.note?`<p class="mood-note">${escape(ctx,mood.note)}</p>`:'';
  const moodVisual=mood?`<div class="mood-selected-face" aria-label="Estado de ánimo registrado: ${escape(ctx,moodName)}">${moodSprite(ctx,mood.mood)}</div>`:`<div class="mood-banner-faces">${['feliz','calma','neutral'].map(id=>moodSprite(ctx,id)).join('')}</div>`;
  const moodInvitation=mood?'':`<p>No todos los días se sienten igual. ¿Cómo va el tuyo?</p>`;
  const dateControl=`<label class="inline-date habit-date-control"><span class="habit-date-label small">Fecha · Hábitos y estado de ánimo</span>${icon(ctx,'calendar-days')}<input aria-label="Fecha de hábitos y estado de ánimo" type="date" value="${escape(ctx,date)}" data-change="habit-date"></label>`;
  return `<div class="page-heading habit-page-heading"><div><span class="eyebrow">PEQUEÑOS PASOS, A TU RITMO</span><h1>Mis hábitos</h1></div>${dateControl}</div><section class="mood-banner"><div class="mood-banner-copy"><span class="eyebrow">ESTADO DE ÁNIMO</span><h2>${moodTitle}</h2>${moodNote}${moodInvitation}${ctx.btn(mood?'Editar estado de ánimo':'Registrar estado de ánimo','mood-open',`data-date="${escape(ctx,date)}" data-mood-context="habits"`,'secondary')}</div>${moodVisual}</section><div class="section-head habit-section-head"><div class="habit-section-title"><h2>Lo que cuido de mí</h2>${ctx.btn('Crear hábito','habit-new','','primary')}</div></div>${list.length?`<div class="habit-list" data-week-start="${escape(ctx,week)}">${list.map(habit=>renderHabitRow(ctx,habit,date)).join('')}</div>`:ctx.empty('Tu primer hábito empieza aquí.','Leer un rato, tomar agua o salir a caminar. Elige algo para ti y cuándo quieres hacerlo.',ctx.btn('Crear mi primer hábito','habit-new'))}`;
}

export function registerHabits(ctx) {
  ctx.action('habit-delete',data=>ctx.confirm('¿Eliminar este hábito y sus registros? No afecta a otros hábitos.',()=>{
    const found=source(ctx,data.id);
    const before=found?.list.slice();
    if(found?.habit) {
      const index=found.list.findIndex(habit=>habit.id===data.id);
      if(index>=0)found.list.splice(index,1);
    }
    if(!persist(ctx,()=>{if(found)found.list.splice(0,found.list.length,...before);} ))return false;
    ctx.closeModal();
    ctx.render();
  }));
  ctx.action('habit-new',()=>openHabit(ctx));
  ctx.action('habit-edit',data=>openHabit(ctx,data.id));
  ctx.action('habit-detail',data=>openHabitDetails(ctx,data.id,data.date||ctx.view.habitDate||todayOf(ctx)));
  ctx.action('habit-detail-edit',data=>openHabit(ctx,data.id));
  ctx.action('habit-toggle',data=>toggleHabit(ctx,data.id,data.date));
  ctx.action('habit-day',data=>{if(validDate(data.date))ctx.view.habitDate=data.date;else ctx.view.habitDate=selectedHabitDate(ctx);ctx.render();});
  ctx.change('habit-date',(data,event,element)=>{ctx.view.habitDate=validDate(element?.value)?element.value:selectedHabitDate(ctx);ctx.render();});
  ctx.change('habit-frequency',(data,event,element)=>syncHabitForm(ctx,element.form));
  ctx.change('habit-type',(data,event,element)=>syncHabitForm(ctx,element.form));
  ctx.change('habit-monthly-date',(data,event,element)=>syncHabitForm(ctx,element.form));
  ctx.action('mood-open',data=>openMood(ctx,moodActionDate(ctx,data)));
}
