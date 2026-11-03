# Contrato interno

Archivos JS ES modules. Cada módulo exporta renderName(ctx) -> HTML y registerName(ctx) -> registra acciones. No modificar archivos ajenos.

ctx.state() -> estado. ctx.home() -> hogar activo. Estado {version:3,personal:{sessions:[],habits:[],moods:[],appointments:[]},households:[{id,name,habits:[],pets:[],inventory:[],shopping:[],purchases:[],stores:[]}],activeHousehold:string}. Campos añadidos permitidos. Fechas YYYY-MM-DD locales. ctx.today(), ctx.id(), ctx.esc(x), ctx.prettyDate(date), ctx.money(n), ctx.img(assetName, className='') -> img HTML data URI. ctx.icon(name,size=20) -> svg lucide HTML. Assets: dog,gym,food,cooking,meditation,mood-feliz,mood-calma,mood-neutral,mood-cansada,mood-triste,mood-estresada.

ctx.save() persiste; ctx.render() redibuja; ctx.toast(text) aviso. ctx.navigate(route) rutas inicio/habitos/mascotas/alimentos/calendario/gym/datos/hogares. ctx.action(name,fn) registra handler (dataset,event,element). ctx.change(name,fn) registra handler cambios (dataset,event,element). Botones data-action="nombre" data-id; inputs/selects data-change="nombre". Contexto ctx.view es objeto efímero para pestañas y selecciones.

ctx.modal(title,html,onSubmit?,submitLabel='Guardar') muestra <form> contenido html, botón guardar y cancelar. onSubmit recibe objeto campos de FormData y form; NO guarda ni cierra automáticamente si devuelve false; si no false cierra. Puede ser async. ctx.closeModal(). ctx.confirm(message,callback) pide confirmar en diálogo propio. Elementos con data-action también en modal están delegados. ctx.field(label,name,value='',type='text',extra='') retorna label+input escape. ctx.select(label,name,options,value) options array [{value,label}] o strings. ctx.empty(title,text,buttonHtml='') tarjeta vacía. ctx.btn(label,action,extra='',kind='primary') -> button type button clases btn kind.

Clases CSS compartidas: panel, card, soft, section-head, section-title, muted, small, eyebrow, row, stack, grid-two, grid-three, toolbar, tabs, tab active, btn primary/secondary/ghost, chip, pill, field, form-grid, list-row, empty, metric, progress, exercise-card, series-grid, swatch, note, chart. color por CSS --accent --soft con body[data-page]. No HTML con emojis. Evitar inline SVG ilustraciones nuevas; iconos UI lucide disponibles. Ilustraciones usar assets aportados.

Gym sessions {id,date,routineId,sets:{exerciseId:[{weight:null|number,done:boolean}]},status:'draft'|'finished', observations?:[]} identity date+routine. Estado personal siempre.

Habit {id,name,icon:'leaf' etc,color real hex,startDate,frequency:'daily'|'weekdays'|'interval'|'monthly',weekdays:[0..6],interval:2,monthDay:1,type:'check'|'quantity',target:2,unit:'litros',goalPeriod:'day'|'week',logs:{YYYY-MM-DD:number|boolean}} personal o hogar según colección. Mood {id:'mood:YYYY-MM-DD',date,mood:'feliz'|'calma'|'neutral'|'cansada'|'triste'|'estresada',note}. Appointment {id,title,date,time:'HH:mm'|'',allDay,note} personal.

Pets define activities:[{id,type,title,date,time,note,...}] por mascota y tricks:[{id,name,description}]. Calendar parent derive these. Purchases use {id,date,store,total,lines:[{id,name,quantity,unit,amount,discount}],...}.

Online agent must expose optional window.WelloCloud installed separately after app bundle. Main app exports window.WelloApp {getState,setState,switchNamespace,toast,navigate,openSuper}. Context storage namespace local by default. Cloud should not auto import local.
