import { createAppServer } from './server.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, 'calendar.sqlite');
let configured = false;
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  try { configured = Boolean(db.prepare('SELECT id FROM admins WHERE id=1').get()); } catch { /* Erster Start. */ }
  db.close();
}
const env = { ...process.env, PREVIEW_MODE: '1' };
if (!configured) {
  env.ADMIN_USER = 'admin';
  env.ADMIN_PASSWORD = randomBytes(18).toString('base64url');
  writeFileSync(join(dataDir, 'ADMIN-ZUGANG.txt'), `Lokaler Zugang zum Adventkalender\n\nAdresse: http://127.0.0.1:4173/admin\nBenutzername: ${env.ADMIN_USER}\nPasswort: ${env.ADMIN_PASSWORD}\n\nDiese Datei ist privat und wird niemals von der Webseite ausgeliefert.\nVor öffentlicher Bereitstellung ein eigenes Passwort einrichten (siehe README.md).\n`, { mode: 0o600 });
}
const server = createAppServer({ dataDir, env });
server.listen(4173, '127.0.0.1', () => {
  console.log('Vorschau: http://127.0.0.1:4173/?preview=1');
  console.log('Verwaltung: http://127.0.0.1:4173/admin');
  console.log('Lokale Zugangsdaten: data/ADMIN-ZUGANG.txt (werden nicht öffentlich ausgeliefert).');
});
function shutdown() { server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
