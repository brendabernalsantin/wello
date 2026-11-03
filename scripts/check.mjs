import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function files(dir){const entries=await fs.readdir(dir,{withFileTypes:true});const output=[];for(const e of entries){const p=dir+'/'+e.name;if(e.isDirectory())output.push(...await files(p));else if(/\.(js|mjs)$/.test(p))output.push(p);}return output;}
let failed=false;for(const file of [...await files('src'),...await files('scripts'),...await files('tests')]){const p=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(p.status){failed=true;console.error(file,p.stderr);}}
if(failed)process.exit(1);console.log('Sintaxis JavaScript válida en fuente, scripts y pruebas.');
