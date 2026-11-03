import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const pages=process.argv[2]==='dist';
if(!pages){const p=spawnSync(process.execPath,['scripts/build.mjs','local'],{stdio:'inherit'});if(p.status)process.exit(p.status);}
const root=path.resolve(pages?'dist':'entregables');
const port=Number(process.env.PORT||3000);
http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/manus-routes.json'){res.setHeader('Content-Type','application/json');res.end(await fs.readFile('public/manus-routes.json'));return;}
  const relative=name==='/'||name==='/primera-app/'?(pages?'index.html':'Wello.html'):name.replace(/^\/primera-app\//,'').replace(/^\//,'');
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end('No permitido');return;}
  const data=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data);
}catch{res.writeHead(404);res.end('No encontrado');}}).listen(port,'0.0.0.0',()=>console.log(`Wello disponible en puerto ${port}. ${pages?'Variante Pages':'HTML local'}`));
