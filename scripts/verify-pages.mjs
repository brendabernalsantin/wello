import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const url = 'https://brendabernalsantin.github.io/wello/';
const expected = await fs.readFile('publicacion/index.html');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedHash = hash(expected);
const deadline = Date.now() + 300_000;
let attempts = 0;

while (Date.now() < deadline) {
  attempts += 1;
  try {
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Wello-release-verification' },
      signal: AbortSignal.timeout(20_000),
    });
    const content = Buffer.from(await response.arrayBuffer());
    if (response.status === 200 && hash(content) === expectedHash) {
      if (!content.subarray(0, 160).includes('data-wello-auth="locked"')) {
        throw new Error('La producción no contiene el bloqueo inicial esperado.');
      }
      const result = {
        url,
        status: response.status,
        exactArtifactMatch: true,
        sha256: expectedHash,
        loginRequired: true,
        verifiedAt: new Date().toISOString(),
      };
      await fs.mkdir('artifacts', { recursive: true });
      await fs.writeFile('artifacts/pages-verification.json', JSON.stringify(result, null, 2) + '\n');
      console.log('CONFIRMADO: GitHub Pages HTTP200, compilación exacta y acceso obligatorio.');
      process.exit(0);
    }
    console.log(`Comprobación ${attempts}: HTTP ${response.status}; esperando la nueva compilación de Pages.`);
  } catch (error) {
    console.log(`Comprobación ${attempts}: ${error.name}; esperando Pages.`);
  }
  await new Promise(resolve => setTimeout(resolve, 12_000));
}
throw new Error('La rama está subida, pero la nueva versión en Pages no se pudo confirmar en cinco minutos.');
