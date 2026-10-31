// Legt einen Zugang an: npm run zugang -- Tobi
// Gibt den Zugangscode einmal aus und den Befehl, der ihn (nur als Hash) in die Datenbank schreibt.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

const name = process.argv.slice(2).join(' ').trim();
if (!name || name.length > 40 || /['"\\]/.test(name)) {
  console.error('Aufruf: npm run zugang -- <Name>');
  process.exit(2);
}
const code = `rc-${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(code).digest('hex');
const sql = `INSERT INTO users (id, name, code_hash, created_at) VALUES ('${randomUUID()}', '${name}', '${hash}', '${new Date().toISOString()}');`;

console.log(`\nZugangscode für ${name} (nur jetzt sichtbar, gut aufheben):\n\n  ${code}\n`);
console.log('Diese Zeile in Cloudflare unter D1 → readcast → Console ausführen:\n');
console.log(`  ${sql}\n`);
