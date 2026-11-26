import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_BODY = Math.ceil(MAX_IMAGE * 4 / 3) + 4096;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const digest = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('hex');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function matchesPassword(password, saved) {
  const [salt, hash] = saved.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function json(res, status, value, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) fail(413, 'Die Datei ist zu groß. Maximal 8 MiB sind erlaubt.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Ungültige JSON-Daten.');
    return parsed;
  }
  catch { fail(400, 'Ungültige JSON-Daten.'); }
}
function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function string(value, max, label) {
  if (typeof value !== 'string' || value.length > max) fail(400, `${label} ist ungültig oder zu lang.`);
  return value.trim();
}
function checkCredentials(username, password) {
  if (typeof username !== 'string' || !username.trim() || username.length > 80) throw new Error('ADMIN_USER muss 1 bis 80 Zeichen enthalten.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('ADMIN_PASSWORD muss 12 bis 256 Zeichen enthalten.');
}
function seedDoors(db) {
  const examples = [
    ['Willkommen im Advent', 'Schön, dass du da bist! Hinter jedem Türchen wartet eine kleine Adventüberraschung.\n\nDies ist ein Beispielinhalt. In der Verwaltung kannst du hier euren persönlichen Weihnachtsgruß, Bilder und Links eintragen.'],
    ['Ein warmer Gedanke', 'Beispiel: Schreibe einer Kollegin oder einem Kollegen heute ein kleines Dankeschön. Ein freundlicher Satz kann den ganzen Tag heller machen.'],
    ['Winter vor der Tür', 'Beispiel: Nimm dir bei deinem nächsten Weg einen Moment Zeit und schau dich um. Was ist heute besonders winterlich?'],
    ['Zeit für einen Tee', 'Beispiel: Eine Tasse Tee, warme Hände und fünf Minuten Ruhe. So darf die Adventzeit beginnen.'],
    ['Ein kleines Adventrätsel', 'Beispielrätsel: Was wird beim Trocknen nass?\n\nDie Antwort: ein Handtuch.'],
    ['Ein Gruß zum Nikolaus', 'Beispiel: Heute ist Nikolaustag! Wir wünschen dir einen schönen Tag und eine kleine süße Überraschung.'],
    ['Dein Lieblingsrezept', 'Beispiel: Hier ist Platz für ein gemeinsames Keksrezept. Ergänze Zutaten, Zubereitung und ein eigenes Bild in der Verwaltung.'],
    ['Ein Licht im Winter', 'Beispiel: Zünde zuhause ein Licht an und genieße einen ruhigen Moment in der Adventzeit.'],
    ['Ein freundliches Wort', 'Beispiel: Wem möchtest du heute sagen, dass du die Zusammenarbeit schätzt?'],
    ['Weihnachtliche Klänge', 'Beispiel: Hinterlege hier einen Link zu einem passenden Weihnachtslied oder einer gemeinsamen Playlist.'],
    ['Ein Blick zurück', 'Beispiel: Welcher gemeinsame Moment aus diesem Jahr bringt dich zum Lächeln? Hier passt ein Foto mit einer kurzen Geschichte.'],
    ['Eine kleine Pause', 'Die Hälfte ist geschafft!\n\nBeispiel: Lass für einen Moment die Schultern sinken, atme ruhig durch und gönn deinen Augen eine Bildschirmpause.'],
    ['Gemeinsam wird es gemütlich', 'Beispiel: Ein kurzer Austausch bei Tee oder Kaffee macht auch einen grauen Wintertag wärmer.'],
    ['Ein Winterspaziergang', 'Beispiel: Wenn es dir möglich ist, genieße heute einen kurzen Spaziergang an der frischen Luft.'],
    ['Platz für eure Nachricht', 'Beispiel: Hier könnte eine Nachricht des Betriebsrats oder ein Gruß aus dem Team stehen.'],
    ['Ein Lächeln verschenken', 'Beispiel: Eine kleine freundliche Geste kostet wenig und kann viel bewirken.'],
    ['Noch eine kleine Überraschung', 'Beispiel: Hier ist Platz für ein winterliches Bild, ein Gedicht oder einen interessanten Link.'],
    ['Dein schönster Adventmoment', 'Beispiel: Was hat dir in dieser Adventzeit besonders Freude gemacht? Nimm den Gedanken mit in deinen Tag.'],
    ['Ein Rezept für Gemütlichkeit', 'Beispiel: Warme Socken, ein Lieblingsgetränk und ein gutes Buch. Was gehört für dich dazu?'],
    ['Danke für das Miteinander', 'Beispiel: Gute Zusammenarbeit lebt von vielen kleinen Beiträgen. Danke an alle, die jeden Tag dazu beitragen.'],
    ['Ein Wunsch für das neue Jahr', 'Beispiel: Welchen guten Wunsch möchtest du deinen Kolleginnen und Kollegen für das kommende Jahr mitgeben?'],
    ['Fast ist Weihnachten', 'Beispiel: Noch zwei Türchen bis Weihnachten. Heute ist ein guter Tag, um kurz innezuhalten.'],
    ['Vorfreude teilen', 'Beispiel: Wir wünschen dir einen ruhigen Tag und viel Vorfreude auf Weihnachten.'],
    ['Frohe Weihnachten', 'Frohe Weihnachten und eine erholsame Zeit!\n\nBeispielgruß: Danke für das gemeinsame Jahr, die Unterstützung und das gute Miteinander. Wir wünschen dir und deinen Liebsten schöne Feiertage.']
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO doors(day,title,text,type,links,published) VALUES(?,?,?,\'content\',\'[]\',1)');
  examples.forEach(([title, text], i) => insert.run(i + 1, title, text));
}

export function createAppServer(options = {}) {
  const env = options.env ?? process.env;
  const dataDir = resolve(options.dataDir ?? join(ROOT, 'data'));
  const publicDir = resolve(options.publicDir ?? join(ROOT, 'public'));
  const clock = options.clock ?? (() => new Date());
  const uploads = join(dataDir, 'uploads');
  mkdirSync(uploads, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'calendar.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),year INTEGER NOT NULL,time_zone TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES(1,2026,'Europe/Berlin');
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,mime TEXT NOT NULL,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS doors(day INTEGER PRIMARY KEY CHECK(day BETWEEN 1 AND 24),title TEXT NOT NULL,text TEXT NOT NULL,type TEXT NOT NULL,links TEXT NOT NULL,published INTEGER NOT NULL,image_id TEXT REFERENCES images(id),image_alt TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
  `);
  if (!db.prepare('PRAGMA table_info(doors)').all().some(column => column.name === 'image_alt')) {
    db.exec("ALTER TABLE doors ADD COLUMN image_alt TEXT NOT NULL DEFAULT ''");
  }
  seedDoors(db);
  if (env.ADMIN_USER || env.ADMIN_PASSWORD) {
    if (!db.prepare('SELECT id FROM admins WHERE id=1').get()) {
      checkCredentials(env.ADMIN_USER, env.ADMIN_PASSWORD);
      db.prepare('INSERT INTO admins VALUES(1,?,?)').run(env.ADMIN_USER.trim(), hashPassword(env.ADMIN_PASSWORD));
    }
  }
  const dummyHash = hashPassword(randomToken());
  const attempts = new Map();
  const settings = () => {
    const row = db.prepare('SELECT year,time_zone FROM settings WHERE id=1').get();
    return { year: row.year, timeZone: row.time_zone };
  };
  const door = day => db.prepare('SELECT * FROM doors WHERE day=?').get(day);
  const available = (row, config) => Boolean(row?.published) && dateKey(clock(), config.timeZone) >= `${config.year}-12-${String(row.day).padStart(2, '0')}`;
  const fullDoor = row => ({ day: row.day, title: row.title, text: row.text, type: row.type, links: JSON.parse(row.links), published: Boolean(row.published), imageId: row.image_id ?? null, imageUrl: row.image_id ? `/media/${row.image_id}` : '', imageAlt: row.image_alt });
  const getSession = req => {
    const cookie = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('advent_session='));
    const token = cookie?.slice('advent_session='.length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires>?').get(digest(token), clock().getTime()) ?? null;
  };
  const requireSession = req => { const session = getSession(req); if (!session) fail(401, 'Bitte melde dich in der Verwaltung an.'); return session; };
  const sameOrigin = req => {
    const scheme = req.socket.encrypted || (env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http';
    if (!req.headers.origin || req.headers.origin !== `${scheme}://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Diese Anfrage stammt nicht von dieser Webseite.');
  };
  const requireCsrf = req => {
    sameOrigin(req);
    const session = requireSession(req);
    if (typeof req.headers['x-csrf-token'] !== 'string' || req.headers['x-csrf-token'] !== session.csrf) fail(403, 'Die Sitzung muss neu geladen werden.');
    return session;
  };
  const preview = (req, url) => {
    if (env.PREVIEW_MODE !== '1' || env.NODE_ENV === 'production' || url.searchParams.get('preview') !== '1') return false;
    const host = url.hostname;
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
    const remote = req.socket.remoteAddress;
    return local && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  };
  const cookieHeader = (req, token, clear = false) => {
    const secure = Boolean(req.socket.encrypted) || (env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') || env.SECURE_COOKIE === '1';
    return `advent_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method;
      if (path.startsWith('/api/') || path.startsWith('/media/')) res.setHeader('Cache-Control', 'no-store');
      if (path === '/api/calendar' && method === 'GET') {
        const config = settings();
        const isPreview = preview(req, url) || (url.searchParams.get('preview') === '1' && Boolean(getSession(req)));
        return json(res, 200, { ...config, serverNow: clock().toISOString(), preview: isPreview, doors: db.prepare('SELECT * FROM doors ORDER BY day').all().map(row => ({ day: row.day, available: isPreview || available(row, config), published: Boolean(row.published) })) });
      }
      const publicDoor = path.match(/^\/api\/doors\/(\d{1,2})$/);
      if (publicDoor && method === 'GET') {
        const row = door(Number(publicDoor[1]));
        const isAdminPreview = url.searchParams.get('preview') === '1' && getSession(req);
        if (!row || (!available(row, settings()) && !preview(req, url) && !isAdminPreview)) fail(404, 'Dieses Türchen ist noch nicht geöffnet.');
        const { published, imageId, ...content } = fullDoor(row);
        if ((preview(req, url) || isAdminPreview) && content.imageUrl) content.imageUrl += '?preview=1';
        return json(res, 200, content);
      }
      if (path === '/api/admin/session' && method === 'GET') {
        const admin = db.prepare('SELECT username FROM admins WHERE id=1').get();
        const session = getSession(req);
        return json(res, 200, { authenticated: Boolean(session), configured: Boolean(admin), username: session ? admin.username : null, csrfToken: session?.csrf ?? null });
      }
      if (path === '/api/admin/login' && method === 'POST') {
        sameOrigin(req);
        const key = req.socket.remoteAddress;
        const now = clock().getTime();
        let attempt = attempts.get(key);
        if (attempt && attempt.reset <= now) { attempts.delete(key); attempt = null; }
        if (attempt?.count >= 8) return json(res, 429, { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' }, { 'Retry-After': String(Math.ceil((attempt.reset - now) / 1000)) });
        const data = await body(req);
        const username = string(data.username, 80, 'Benutzername');
        if (typeof data.password !== 'string' || data.password.length > 256) fail(400, 'Passwort ist ungültig oder zu lang.');
        const password = data.password;
        const admin = db.prepare('SELECT * FROM admins WHERE id=1').get();
        if (!admin) fail(503, 'Es wurde noch kein Adminzugang eingerichtet.');
        const validPassword = matchesPassword(password, username === admin.username ? admin.password_hash : dummyHash);
        if (username !== admin.username || !validPassword) {
          attempts.set(key, { count: (attempt?.count ?? 0) + 1, reset: attempt?.reset ?? now + 15 * 60 * 1000 });
          if (attempts.size > 10000) for (const [address, record] of attempts) if (record.reset <= now) attempts.delete(address);
          fail(401, 'Benutzername oder Passwort ist falsch.');
        }
        attempts.delete(key);
        const token = randomToken();
        const csrfToken = randomToken();
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), csrfToken, now + SESSION_MS);
        return json(res, 200, { username: admin.username, csrfToken }, { 'Set-Cookie': cookieHeader(req, token) });
      }
      if (path === '/api/admin/logout' && method === 'POST') {
        const session = requireCsrf(req);
        db.prepare('DELETE FROM sessions WHERE id_hash=?').run(session.id_hash);
        return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', true) });
      }
      if (path === '/api/admin/calendar' && method === 'GET') {
        requireSession(req);
        return json(res, 200, { ...settings(), doors: db.prepare('SELECT * FROM doors ORDER BY day').all().map(fullDoor) });
      }
      const adminDoor = path.match(/^\/api\/admin\/doors\/(\d{1,2})$/);
      if (adminDoor && method === 'PUT') {
        requireCsrf(req);
        const day = Number(adminDoor[1]);
        const data = await body(req);
        const previousDoor = door(day);
        if (!previousDoor) fail(404, 'Türchen nicht gefunden.');
        const title = string(data.title, 160, 'Titel');
        const text = string(data.text, 20000, 'Text');
        if (!title || !['content', 'link'].includes(data.type) || typeof data.published !== 'boolean' || !Array.isArray(data.links) || data.links.length > 10) fail(400, 'Bitte überprüfe die Angaben für dieses Türchen.');
        const links = data.links.map(link => {
          const label = string(link.label, 160, 'Linktext');
          const url = string(link.url, 2048, 'Link');
          let parsed;
          try { parsed = new URL(url); } catch { fail(400, 'Bitte verwende einen vollständigen Link mit https:// oder http://.'); }
          if (!label || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(400, 'Dieser Link ist nicht zulässig.');
          return { label, url: parsed.href };
        });
        if (data.type === 'link' && data.published && !links.length) fail(400, 'Für ein freigegebenes Link-Türchen ist mindestens ein Link erforderlich.');
        const imageId = data.imageId === undefined ? previousDoor.image_id : data.imageId;
        if (imageId !== null && (typeof imageId !== 'string' || !db.prepare('SELECT id FROM images WHERE id=?').get(imageId))) fail(400, 'Das ausgewählte Bild wurde nicht gefunden.');
        const suppliedAlt = data.imageAlt === undefined ? undefined : string(data.imageAlt, 300, 'Alternativtext');
        const imageAlt = imageId === null ? '' : suppliedAlt ?? (imageId === previousDoor.image_id ? previousDoor.image_alt : '');
        db.prepare('UPDATE doors SET title=?,text=?,type=?,links=?,published=?,image_id=?,image_alt=? WHERE day=?').run(title, text, data.type, JSON.stringify(links), Number(data.published), imageId, imageAlt, day);
        return json(res, 200, fullDoor(door(day)));
      }
      if (path === '/api/admin/settings' && method === 'PUT') {
        requireCsrf(req);
        const data = await body(req);
        if (!Number.isInteger(data.year) || data.year < 2020 || data.year > 2100 || data.timeZone !== 'Europe/Berlin') fail(400, 'Bitte wähle ein Jahr von 2020 bis 2100 und die Zeitzone Europe/Berlin.');
        db.prepare('UPDATE settings SET year=?,time_zone=? WHERE id=1').run(data.year, data.timeZone);
        return json(res, 200, settings());
      }
      if (path === '/api/admin/upload' && method === 'POST') {
        requireCsrf(req);
        const data = await body(req);
        const name = string(data.name, 255, 'Dateiname');
        if (typeof data.dataUrl !== 'string') fail(400, 'Bitte wähle ein Bild aus.');
        const match = data.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
        if (!match || match[2].length % 4 !== 0) fail(400, 'Erlaubt sind JPEG, PNG und WebP.');
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGE) fail(413, 'Das Bild darf maximal 8 MiB groß sein.');
        let mime;
        if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
        else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
        else if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
        if (!mime || mime !== match[1]) fail(400, 'Die Datei ist kein gültiges JPEG-, PNG- oder WebP-Bild.');
        const imageId = randomBytes(20).toString('hex');
        const imagePath = join(uploads, imageId);
        writeFileSync(imagePath, bytes, { flag: 'wx' });
        try { db.prepare('INSERT INTO images VALUES(?,?,?)').run(imageId, mime, name); }
        catch (error) { unlinkSync(imagePath); throw error; }
        return json(res, 201, { imageId, imageUrl: `/media/${imageId}` });
      }
      const media = path.match(/^\/media\/([a-f0-9]{40})$/);
      if (media && ['GET', 'HEAD'].includes(method)) {
        const row = db.prepare('SELECT * FROM images WHERE id=?').get(media[1]);
        const publicRows = db.prepare('SELECT * FROM doors WHERE image_id=?').all(media[1]);
        if (!row || (!getSession(req) && !publicRows.some(d => available(d, settings()) || preview(req, url)))) fail(404, 'Bild nicht gefunden.');
        const file = join(uploads, row.id);
        if (!existsSync(file)) fail(404, 'Bild nicht gefunden.');
        res.writeHead(200, { 'Content-Type': row.mime, 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline' });
        return res.end(method === 'HEAD' ? undefined : readFileSync(file));
      }
      if (path.startsWith('/api/') || path.startsWith('/media/')) fail(404, 'Nicht gefunden.');
      if (!['GET', 'HEAD'].includes(method)) fail(405, 'Methode nicht erlaubt.');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { fail(400, 'Ungültige Adresse.'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p.startsWith('.'))) fail(404, 'Nicht gefunden.');
      const route = decoded === '/' ? '/index.html' : ['/admin', '/admin/'].includes(decoded) ? '/admin.html' : decoded;
      const extension = extname(route).toLowerCase();
      const file = resolve(publicDir, `.${route}`);
      if (!file.startsWith(publicDir + sep) || !TYPES[extension] || !existsSync(file) || !statSync(file).isFile()) fail(404, 'Nicht gefunden.');
      res.writeHead(200, { 'Content-Type': TYPES[extension], 'Content-Length': statSync(file).size, 'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600' });
      return res.end(method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status ?? 500;
      if (status === 500) console.error('Serverfehler:', error.message);
      json(res, status, { error: status === 500 ? 'Ein Serverfehler ist aufgetreten.' : error.message });
    }
  });
  server.headersTimeout = 30000;
  server.requestTimeout = 30000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--set-password')) {
    checkCredentials(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
    const dataDir = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, 'calendar.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);');
    db.prepare('INSERT INTO admins VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash').run(process.env.ADMIN_USER.trim(), hashPassword(process.env.ADMIN_PASSWORD));
    db.exec('DELETE FROM sessions');
    db.close();
    console.log('Adminzugang gespeichert. Bestehende Sitzungen wurden abgemeldet.');
  } else {
    if (process.argv.includes('--preview')) process.env.PREVIEW_MODE = '1';
    const server = createAppServer({ dataDir: process.env.DATA_DIR });
    const port = Number(process.env.PORT ?? 4173);
    const bind = process.env.BIND ?? '127.0.0.1';
    server.listen(port, bind, () => {
      console.log(`Adventkalender: http://${bind}:${port}${process.env.PREVIEW_MODE === '1' ? '/?preview=1' : '/'}`);
      console.log(`Verwaltung: http://${bind}:${port}/admin`);
      if (process.env.PREVIEW_MODE === '1' && process.env.NODE_ENV !== 'production') console.log('Lokale Vorschau: Alle Türchen sind mit ?preview=1 zugänglich.');
      console.log('Adminzugang bei Bedarf über ADMIN_USER und ADMIN_PASSWORD mit --set-password einrichten.');
    });
  }
}
