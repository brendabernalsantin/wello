import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Sólo genera el artefacto estático. Publicar/cambiar visibilidad es una acción
// separada que requiere un repositorio confirmado y permisos de su propietaria.
execFileSync(process.execPath, ['scripts/build.mjs', 'pages'], { stdio: 'inherit' });
const dest = path.resolve('publicacion');
await fs.mkdir(dest, { recursive: true });
for (const name of ['index.html', 'manus-routes.json', '.nojekyll']) {
  await fs.copyFile(path.join('dist', name), path.join(dest, name));
}
const html = await fs.readFile(path.join(dest, 'index.html'), 'utf8');
if (!html.trimEnd().endsWith('</html>')) throw new Error('La compilación está incompleta.');
const match = html.match(/window\.WELLO_CONFIG=(\{[^;]+\});/);
if (!match) throw new Error('Falta la configuración pública.');
const config = JSON.parse(match[1]);
if (config.mode !== 'production' || !config.url.startsWith('https://')) throw new Error('La publicación necesita configuración real de producción.');
if (Object.keys(config).some(key => !['mode', 'url', 'key'].includes(key))) throw new Error('Hay campos no permitidos en la configuración.');
if (/service_role|sb_secret_/.test(config.key)) throw new Error('No se permite una credencial privilegiada en Pages.');
console.log('Artefacto estático verificado en publicacion/. No se ha publicado ni cambiado permisos.');
