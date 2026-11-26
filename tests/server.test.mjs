import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const USER = 'kalender-admin';
const PASSWORD = 'Test-Passwort-mit-24-Zeichen!';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=';

async function setup(t, options = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'advent-server-test-'));
  const publicDir = join(tempRoot, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, 'index.html'), '<h1>Kalender</h1>');
  writeFileSync(join(publicDir, 'admin.html'), '<h1>Verwaltung</h1>');
  const dataDir = join(tempRoot, 'data');
  options.prepareDataDir?.(dataDir);
  let date = options.date ?? '2026-12-01T11:00:00Z';
  const config = { publicDir, dataDir, clock: () => new Date(date), env: { ADMIN_USER: USER, ADMIN_PASSWORD: PASSWORD, ...options.env } };
  let server = createAppServer(config);
  await listen(server);
  let origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let csrf = '';
  const api = async (path, { method = 'GET', data, authenticated = false, token = csrf, headers = {} } = {}) => {
    const response = await new Promise((resolve, reject) => {
      const req = request(origin + path, {
        method,
        headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(authenticated ? { Cookie: cookie, 'X-CSRF-Token': token } : {}), ...headers }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: { get(name) { const value = res.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(', ') : value ?? null; } } }));
      });
      req.on('error', reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
    const contentType = response.headers.get('content-type') ?? '';
    const result = contentType.includes('json') ? JSON.parse(response.body) : response.body;
    return { response, status: response.status, data: result };
  };
  const login = async () => {
    const result = await api('/api/admin/login', { method: 'POST', data: { username: USER, password: PASSWORD } });
    assert.equal(result.status, 200);
    cookie = result.response.headers.get('set-cookie').split(';')[0];
    csrf = result.data.csrfToken;
    return result;
  };
  const close = async () => { const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done; };
  t.after(async () => {
    if (server.listening) await close();
    assert.ok(resolve(tempRoot).startsWith(resolve(tmpdir()) + '\\') || resolve(tempRoot).startsWith(resolve(tmpdir()) + '/'));
    rmSync(tempRoot, { recursive: true, force: true });
  });
  return {
    api, login, advance(value) { date = value; },
    async restart() { await close(); server = createAppServer(config); await listen(server); origin = `http://127.0.0.1:${server.address().port}`; }
  };
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
const edited = (extra = {}) => ({ title: 'Ein eigener Gruß', text: 'Danke für das Miteinander.', type: 'content', published: true, links: [{ label: 'Beispiellink', url: 'https://example.org/advent' }], ...extra });

test('Öffentliche Metadaten enthalten keine zukünftigen Inhalte; Datum folgt Europe/Berlin', async t => {
  const app = await setup(t, { date: '2026-11-30T22:59:59Z' });
  const calendar = await app.api('/api/calendar');
  assert.equal(calendar.status, 200);
  assert.equal(calendar.data.timeZone, 'Europe/Berlin');
  assert.equal(calendar.data.doors.length, 24);
  assert.deepEqual(Object.keys(calendar.data.doors[0]).sort(), ['available', 'day', 'published']);
  assert.equal(calendar.data.doors[0].available, false);
  assert.equal((await app.api('/api/doors/1')).status, 404);
  app.advance('2026-11-30T23:00:00Z');
  assert.equal((await app.api('/api/doors/1')).status, 200);
  assert.equal((await app.api('/api/doors/2')).status, 404);
  app.advance('2027-01-02T10:00:00Z');
  assert.equal((await app.api('/api/doors/24')).status, 200);
});

test('Adminzugang verlangt Passwort; Änderungen verlangen Sitzung, Origin und CSRF', async t => {
  const app = await setup(t);
  assert.equal((await app.api('/api/admin/calendar')).status, 401);
  assert.equal((await app.api('/api/admin/session')).data.configured, true);
  const wrong = await app.api('/api/admin/login', { method: 'POST', data: { username: USER, password: 'falsch' } });
  assert.equal(wrong.status, 401);
  const crossSite = await app.api('/api/admin/login', { method: 'POST', data: { username: USER, password: PASSWORD }, headers: { Origin: 'https://fremd.example' } });
  assert.equal(crossSite.status, 403);
  const login = await app.login();
  assert.match(login.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await app.api('/api/admin/calendar', { authenticated: true })).data.doors.length, 24);
  assert.equal((await app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, token: 'falsch', data: edited() })).status, 403);
  assert.equal((await app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, headers: { Origin: 'https://fremd.example' }, data: edited() })).status, 403);
  assert.equal((await app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, data: edited() })).status, 200);
  assert.equal((await app.api('/api/admin/logout', { method: 'POST', authenticated: true })).status, 200);
  assert.equal((await app.api('/api/admin/calendar', { authenticated: true })).status, 401);
});

test('Eigene Inhalte und Bildzuordnung überleben einen Serverneustart, Zukunftsbilder bleiben geschützt', async t => {
  const app = await setup(t);
  await app.login();
  const image = await app.api('/api/admin/upload', { method: 'POST', authenticated: true, data: { name: 'winter.png', dataUrl: PNG } });
  assert.equal(image.status, 201);
  const imageAlt = 'Der verschneite Innenhof mit einem beleuchteten Weihnachtsbaum.';
  const save = await app.api('/api/admin/doors/24', { method: 'PUT', authenticated: true, data: edited({ imageId: image.data.imageId, imageAlt }) });
  assert.equal(save.status, 200);
  assert.equal(save.data.imageAlt, imageAlt);
  assert.equal((await app.api(image.data.imageUrl)).status, 404);
  assert.equal((await app.api(image.data.imageUrl, { authenticated: true })).status, 200);
  assert.equal((await app.api('/api/doors/24')).status, 404);
  await app.restart();
  const admin = await app.api('/api/admin/calendar', { authenticated: true });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.doors[23].title, 'Ein eigener Gruß');
  assert.equal(admin.data.doors[23].imageId, image.data.imageId);
  assert.equal(admin.data.doors[23].imageAlt, imageAlt);
  assert.equal((await app.api(image.data.imageUrl)).status, 404);
  app.advance('2026-12-23T23:00:00Z');
  const publicDoor = await app.api('/api/doors/24');
  assert.equal(publicDoor.data.title, 'Ein eigener Gruß');
  assert.equal(publicDoor.data.imageAlt, imageAlt);
  assert.equal((await app.api(image.data.imageUrl)).status, 200);
});

test('Alternativtexte bleiben beim Bearbeiten erhalten und werden bei Bildwechsel oder Entfernung geleert', async t => {
  const app = await setup(t);
  await app.login();
  const upload = name => app.api('/api/admin/upload', { method: 'POST', authenticated: true, data: { name, dataUrl: PNG } });
  const save = extra => app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, data: edited(extra) });
  const first = await upload('winter.png');
  const second = await upload('advent.png');
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const imageAlt = 'Ein leuchtender Stern im Fenster.';
  assert.equal((await save({ imageId: first.data.imageId, imageAlt })).data.imageAlt, imageAlt);
  assert.equal((await save({ title: 'Ein neuer Titel' })).data.imageAlt, imageAlt);
  assert.equal((await save({ imageId: first.data.imageId })).data.imageAlt, imageAlt);
  assert.equal((await save({ imageAlt: 'x'.repeat(301) })).status, 400);
  assert.equal((await save({ imageAlt: null })).status, 400);
  const replaced = await save({ imageId: second.data.imageId });
  assert.equal(replaced.data.imageId, second.data.imageId);
  assert.equal(replaced.data.imageAlt, '');
  const longAlt = 'x'.repeat(300);
  assert.equal((await save({ imageAlt: longAlt })).data.imageAlt, longAlt);
  const removed = await save({ imageId: null, imageAlt });
  assert.equal(removed.data.imageId, null);
  assert.equal(removed.data.imageAlt, '');
});

test('Migration ergänzt leere Alternativtexte und erhält vorhandene Türcheninhalte', async t => {
  const imageId = 'a'.repeat(40);
  const oldDoor = edited({ title: 'Vorhandenes Türchen', text: 'Dieser Text bleibt erhalten.' });
  const app = await setup(t, { prepareDataDir(dataDir) {
    const uploadDir = join(dataDir, 'uploads');
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, imageId), Buffer.from(PNG.split(',')[1], 'base64'));
    const db = new DatabaseSync(join(dataDir, 'calendar.sqlite'));
    try {
      db.exec(`CREATE TABLE images(id TEXT PRIMARY KEY,mime TEXT NOT NULL,name TEXT NOT NULL);
        CREATE TABLE doors(day INTEGER PRIMARY KEY CHECK(day BETWEEN 1 AND 24),title TEXT NOT NULL,text TEXT NOT NULL,type TEXT NOT NULL,links TEXT NOT NULL,published INTEGER NOT NULL,image_id TEXT REFERENCES images(id));`);
      db.prepare('INSERT INTO images VALUES(?,?,?)').run(imageId, 'image/png', 'winter.png');
      db.prepare('INSERT INTO doors VALUES(?,?,?,?,?,?,?)').run(1, oldDoor.title, oldDoor.text, oldDoor.type, JSON.stringify(oldDoor.links), 1, imageId);
    } finally { db.close(); }
  } });
  await app.login();
  const admin = await app.api('/api/admin/calendar', { authenticated: true });
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.data.doors[0], { day: 1, ...oldDoor, imageId, imageUrl: `/media/${imageId}`, imageAlt: '' });
  assert.equal((await app.api(`/media/${imageId}`)).status, 200);
});

test('Offene Vorschau ist nur explizit lokal möglich und im Produktionsmodus deaktiviert', async t => {
  const app = await setup(t, { env: { PREVIEW_MODE: '1' }, date: '2026-10-20T11:00:00Z' });
  assert.equal((await app.api('/api/calendar')).data.preview, false);
  assert.equal((await app.api('/api/calendar?preview=1')).data.preview, true);
  assert.equal((await app.api('/api/doors/24?preview=1')).status, 200);
  assert.equal((await app.api('/api/calendar?preview=1', { headers: { Host: 'calendar.example' } })).data.preview, false);
  const prod = await setup(t, { env: { PREVIEW_MODE: '1', NODE_ENV: 'production' }, date: '2026-10-20T11:00:00Z' });
  assert.equal((await prod.api('/api/calendar?preview=1')).data.preview, false);
  assert.equal((await prod.api('/api/doors/24?preview=1')).status, 404);
  await prod.login();
  assert.equal((await prod.api('/api/calendar?preview=1', { authenticated: true })).data.preview, true);
  assert.equal((await prod.api('/api/doors/24?preview=1', { authenticated: true })).status, 200);
});

test('Entwürfe und ihre Bilder sind auch nach dem Tag nicht öffentlich', async t => {
  const app = await setup(t, { date: '2026-12-24T12:00:00Z' });
  await app.login();
  const image = await app.api('/api/admin/upload', { method: 'POST', authenticated: true, data: { name: 'entwurf.png', dataUrl: PNG } });
  const result = await app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, data: edited({ published: false, imageId: image.data.imageId }) });
  assert.equal(result.status, 200);
  assert.equal((await app.api('/api/calendar')).data.doors[0].available, false);
  assert.equal((await app.api('/api/doors/1')).status, 404);
  assert.equal((await app.api(image.data.imageUrl)).status, 404);
});

test('Unsichere Links, falsche Bildsignaturen und Datenpfade werden abgewiesen', async t => {
  const app = await setup(t);
  await app.login();
  assert.equal((await app.api('/api/admin/doors/1', { method: 'PUT', authenticated: true, data: edited({ links: [{ label: 'Unsicher', url: 'javascript:alert(1)' }] }) })).status, 400);
  assert.equal((await app.api('/api/admin/upload', { method: 'POST', authenticated: true, data: { name: 'falsch.png', dataUrl: 'data:image/png;base64,SGVsbG8=' } })).status, 400);
  assert.equal((await app.api('/data/calendar.sqlite')).status, 404);
  assert.equal((await app.api('/%2e%2e%5cdata/calendar.sqlite')).status, 404);
  assert.equal((await app.api('/server.mjs')).status, 404);
});

test('Anmeldeversuche werden nach acht falschen Passwörtern gebremst', async t => {
  const app = await setup(t);
  for (let n = 0; n < 8; n++) assert.equal((await app.api('/api/admin/login', { method: 'POST', data: { username: USER, password: 'falsch' } })).status, 401);
  const blocked = await app.api('/api/admin/login', { method: 'POST', data: { username: USER, password: PASSWORD } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
});

test('Ohne Einrichtung existiert kein Standardpasswort', async t => {
  const app = await setup(t, { env: { ADMIN_USER: undefined, ADMIN_PASSWORD: undefined } });
  assert.equal((await app.api('/api/admin/session')).data.configured, false);
  assert.equal((await app.api('/api/admin/login', { method: 'POST', data: { username: 'admin', password: 'admin' } })).status, 503);
});
