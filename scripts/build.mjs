import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const mode=process.argv[2]||'local';
const local=mode==='local';
let config={mode:local?'local':'preview',url:'',key:''};
if(mode==='pages'){
  const url=process.env.WELLO_SUPABASE_URL||'';const key=process.env.WELLO_SUPABASE_PUBLISHABLE_KEY||'';
  if(!/^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/.test(url)||!key)throw Error('Producción requiere WELLO_SUPABASE_URL HTTPS y WELLO_SUPABASE_PUBLISHABLE_KEY. Usa npm run build:preview sin servicios.');
  if(key.startsWith('sb_secret_')||(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ')))throw Error('Solo se acepta una clave pública de Supabase.');
  if(key.startsWith('eyJ')){try{const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(payload.role!=='anon')throw Error('La clave JWT no es anon.');}catch{throw Error('Clave privilegiada o JWT inválida rechazada.');}}
  config={mode:'production',url,key};
}
const names={dog:'dog.png',gym:'gym.png',food:'icons8-comida-sana-96.png',cooking:'icons8-freír-96.png',meditation:'meditation.jpg',fitness:'fitness.jpg',seed:'seed.png'};
for(const m of ['feliz','calma','neutral','cansada','triste','estresada'])names['mood-'+m]='mood-'+m+'.png';
const assets={};for(const [name,file] of Object.entries(names)){const bytes=await fs.readFile('assets/'+file);assets[name]=`data:image/${file.endsWith('.jpg')?'jpeg':'png'};base64,${bytes.toString('base64')}`;}
const app=await build({entryPoints:['src/app.js'],bundle:true,format:'iife',write:false,minify:false,target:['es2022'],logLevel:'warning'});
const css=await fs.readFile('src/styles.css','utf8');
let scripts=`<script>window.WELLO_ASSETS=${JSON.stringify(assets)};${local?'':`window.WELLO_CONFIG=${JSON.stringify(config)};`}</script><script>${app.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`;
if(!local){const cloud=await build({entryPoints:['src/cloud.js'],bundle:true,format:'iife',write:false,minify:true,target:['es2022'],logLevel:'warning'});scripts+=`<script>${cloud.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`;}
let html=await fs.readFile('src/template.html','utf8');html=html.replace('/* WELLO_CSS */',css).replace('<!-- WELLO_SCRIPTS -->',scripts).replace('<!-- WELLO_FAVICON -->',`<link rel="icon" href="${assets.seed}">`);
const directory=local?'entregables':'dist';await fs.mkdir(directory,{recursive:true});const file=local?'Wello.html':'index.html';await fs.writeFile(path.join(directory,file),html);
if(!local){await fs.copyFile('public/manus-routes.json','dist/manus-routes.json');await fs.writeFile('dist/.nojekyll','');}
console.log(`${directory}/${file} creado. Modo ${config.mode}. Sin cargas privadas precargadas.`);
