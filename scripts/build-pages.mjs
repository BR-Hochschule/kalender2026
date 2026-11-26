import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageMime } from '../image-type.mjs';
import { calendarExamples } from '../calendar-examples.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const year = 2026;
const timeZone = 'Europe/Berlin';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const publicFiles = ['calendar.css', 'calendar.js', 'assets/campus-advent-2026.webp', 'assets/stern.svg'];
const repoPattern = /^[a-z0-9-]+\/[a-z0-9_.-]+$/i;
const maxImageSize = 8 * 1024 * 1024;
const imageTypes = new Map([['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']]);

function dateKey(date) {
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function pagesMode(now = new Date()) {
  const today = dateKey(now);
  if (today >= `${year}-12-01`) return 'advent';
  return today.startsWith(`${year}-11-`) ? 'november' : 'waiting';
}

function exampleDoor(day) {
  const [title, text] = calendarExamples[day - 1];
  return {
    day,
    title,
    text,
    imageUrl: day === 11 ? './assets/campus-advent-2026.webp' : '',
    imageAlt: day === 11 ? 'Die verschneite Hochschule Campus Wien' : '',
    links: day === 10 ? [
      { label: 'Beispiellink öffnen', url: 'https://github.com/BR-Hochschule/kalender2026' },
    ] : [],
  };
}

async function regularFile(directory, name) {
  try {
    // A Git symlink in the editorial repository must never enter the public output.
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory()) throw new Error('Der Inhaltsordner muss ein Verzeichnis sein.');
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('Erwartet wird eine reguläre Datei.');
    return { path, size: info.size };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function cleanText(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} ist ungültig oder zu lang.`);
  return value.trim();
}

function readLinks(links = []) {
  if (!Array.isArray(links) || links.length > 10) throw new Error('Maximal zehn Links sind möglich.');
  return links.map(link => {
    const label = cleanText(link?.titel, 160, 'Linktitel');
    const url = URL.parse(cleanText(link?.url, 2048, 'Linkadresse'));
    if (!label || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Jeder Link braucht einen Titel und eine HTTP- oder HTTPS-Adresse.');
    }
    return { label, url: url.href };
  });
}

async function readImage(contentDir, day, value = '') {
  const name = cleanText(value, 180, 'Bilddatei');
  if (!name) return null;
  const extension = extname(name).toLowerCase();
  const mime = imageTypes.get(extension);
  if (name !== basename(name) || /[\\\x00-\x1f]/.test(name) || !mime) {
    throw new Error('Als Bild bitte einen Dateinamen mit JPG, PNG oder WebP angeben.');
  }
  const file = await regularFile(join(contentDir, 'bilder'), name);
  if (!file || !file.size || file.size > maxImageSize) {
    throw new Error('Das Bild fehlt oder liegt außerhalb der erlaubten Größe von 8 MiB.');
  }
  const bytes = await readFile(file.path);
  if (imageMime(bytes) !== mime) throw new Error('Das Bildformat passt nicht zur Dateiendung.');
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return { path: `media/${day}-${digest}${extension}`, bytes };
}

async function readDoor(contentDir, day, number) {
  try {
    const file = await regularFile(join(contentDir, 'tueren'), `${number}.json`);
    if (!file) return null;
    if (file.size > 128 * 1024) throw new Error('Die JSON-Datei ist zu groß.');
    let entry;
    try { entry = JSON.parse(await readFile(file.path, 'utf8')); }
    catch { throw new Error('Die JSON-Datei konnte nicht gelesen werden.'); }
    if (!entry || typeof entry.freigeben !== 'boolean') throw new Error('Das Feld „freigeben“ muss true oder false sein.');
    if (!entry.freigeben) return null;
    const title = cleanText(entry.titel, 160, 'Titel');
    if (!title) throw new Error('Bitte einen Titel eintragen.');
    const text = cleanText(entry.text ?? '', 20_000, 'Text');
    const links = readLinks(entry.links);
    const image = await readImage(contentDir, number, entry.bild);
    const imageAlt = image ? cleanText(entry.bildbeschreibung ?? '', 300, 'Bildbeschreibung') : '';
    return { content: { day, title, text, links, imageAlt, imageUrl: image ? `./${image.path}` : '' }, image };
  } catch (error) {
    // The public Actions log needs the door number and the problem, not its content.
    const message = error.code ? 'Eine Datei konnte nicht gelesen werden.' : error.message;
    throw new Error(`Türchen ${number}. ${message}`);
  }
}

export async function buildPages({ contentDir, contentRepository, out = join(root, 'dist'), now = new Date() } = {}) {
  if (contentRepository && !repoPattern.test(contentRepository)) throw new Error('Ungültiges Inhaltsrepository.');
  const today = dateKey(now);
  const novemberTest = pagesMode(now) === 'november';
  const doors = [];
  const images = [];
  for (let day = 1; day <= 24; day++) {
    if (novemberTest) {
      doors.push({ day, available: true, content: exampleDoor(day) });
      continue;
    }
    const number = String(day).padStart(2, '0');
    const released = contentDir && today >= `${year}-12-${number}` ? await readDoor(contentDir, day, number) : null;
    if (released?.image) images.push(released.image);
    doors.push(released ? { day, available: true, content: released.content } : { day, available: false });
  }

  const source = join(root, 'public');
  const html = (await readFile(join(source, 'index.html'), 'utf8'))
    .replace('<body>', '<body data-calendar-mode="pages">')
    .replace('id="manage-calendar" href="/admin"', contentRepository
      ? `id="manage-calendar" href="https://github.com/${contentRepository}"`
      : 'id="manage-calendar" hidden');

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'assets'), { recursive: true });
  await Promise.all(publicFiles.map(name => copyFile(join(source, name), join(out, name))));
  await writeFile(join(out, 'index.html'), html);
  await writeFile(join(out, 'calendar.json'), JSON.stringify({ year, timeZone, preview: false, novemberTest, doors }));
  if (images.length) await mkdir(join(out, 'media'));
  await Promise.all(images.map(image => writeFile(join(out, image.path), image.bytes)));
  return doors.filter(door => door.available).length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = await buildPages({
      contentDir: process.env.ADVENT_CONTENT_DIR,
      contentRepository: process.env.ADVENT_CONTENT_REPO,
    });
    console.log(`GitHub Pages liegt in dist/. ${count} Türchen sind veröffentlicht.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
