import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Publicación explícita por rama. No cambia visibilidad, plan ni ajustes Pages.
// Ejecutar sólo para el repositorio confirmado y con autorización de publicación.
const expectedRepo = 'brendabernalsantin/wello';
const repo = process.argv.find(argument => argument.startsWith('--repo='))?.slice(7);
if (repo !== expectedRepo) throw new Error('Requiere --repo=brendabernalsantin/wello como confirmación del destino.');
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
const remote = git(['remote', 'get-url', 'origin']);
if (!remote.endsWith(`github.com/${expectedRepo}.git`) && !remote.endsWith(`github.com/${expectedRepo}`)) {
  throw new Error('El remoto origin no coincide con el repositorio confirmado.');
}
await import('./prepare-pages.mjs');
const destination = path.resolve('publicacion');
const names = ['index.html', 'manus-routes.json', '.nojekyll'];
const listed = (await fs.readdir(destination)).sort();
if (JSON.stringify(listed) !== JSON.stringify([...names].sort())) throw new Error('La carpeta contiene archivos no autorizados para publicar.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wello-pages-'));
const indexFile = path.join(temporary, 'index');
const env = { ...process.env, GIT_INDEX_FILE: indexFile };
try {
  const heads = git(['ls-remote', '--heads', 'origin', 'gh-pages']);
  let parent = '';
  if (heads) {
    git(['fetch', 'origin', 'gh-pages']);
    parent = git(['rev-parse', 'FETCH_HEAD']);
    // No se eliminan archivos agregados por la propietaria en una rama existente.
    git(['read-tree', parent], { env });
  } else {
    git(['read-tree', '--empty'], { env });
  }
  for (const name of names) {
    const blob = git(['hash-object', '-w', path.join(destination, name)]);
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { env });
  }
  const tree = git(['write-tree'], { env });
  if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) {
    console.log(`gh-pages ya contiene esta versión (${parent}). Sin cambios.`);
  } else {
    const sourceSha = git(['rev-parse', 'HEAD']);
    const sha = git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], {
      input: `Publish Wello static app from ${sourceSha}\n`,
    });
    // Push fast-forward normal. Nunca force-push ni reescritura de main.
    git(['push', 'origin', `${sha}:refs/heads/gh-pages`], { stdio: ['pipe', 'pipe', 'inherit'] });
    console.log(`Compilación enviada a gh-pages: ${sha}.`);
  }
  console.log('Para habilitar el sitio: GitHub Settings → Pages → Deploy from a branch → gh-pages / (root).');
  console.log('La publicación sólo se confirma después de verificar HTTP y el contenido servido.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
