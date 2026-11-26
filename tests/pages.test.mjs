import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPages } from '../scripts/build-pages.mjs';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'advent-pages-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const content = join(folder, 'private');
  const out = join(folder, 'pages');
  await mkdir(join(content, 'tueren'), { recursive: true });
  await mkdir(join(content, 'bilder'));
  const door = async (day, fields) => {
    await writeFile(join(content, 'tueren', `${day}.json`), JSON.stringify({
      titel: `Gruß ${day}`, text: `Text ${day}`, freigeben: true, ...fields,
    }));
  };
  const build = async (timestamp) => {
    await buildPages({ contentDir: content, contentRepository: 'example/privat', out, now: new Date(timestamp) });
    return JSON.parse(await readFile(join(out, 'calendar.json'), 'utf8'));
  };
  return { content, out, door, build };
}

test('veröffentlicht Text, Links und Bilder erst ab Mitternacht in Europe/Berlin', async t => {
  const { content, out, door, build } = await fixture(t);
  const firstImage = await readFile(new URL('../public/assets/campus-advent-2026.webp', import.meta.url));
  await writeFile(join(content, 'bilder', '1.webp'), firstImage);
  await writeFile(join(content, 'bilder', '2.webp'), firstImage);
  await door('01', { bild: '1.webp', bildbeschreibung: 'Schneebedeckter Hof', links: [{ titel: 'Unser Link', url: 'https://example.com/infos' }] });
  await door('02', { bild: '2.webp', text: 'Ein späteres Geheimnis' });
  await door('03', { freigeben: false, text: 'Ein Entwurf' });
  await door('24', {});

  const before = await build('2026-11-30T22:59:59Z');
  assert.equal(before.doors.length, 24);
  assert.equal(before.doors.filter(door => door.available).length, 0);
  assert.deepEqual((await readdir(out)).sort(), ['assets', 'calendar.css', 'calendar.js', 'calendar.json', 'index.html']);
  assert.equal(before.preview, false);

  const published = await build('2026-11-30T23:00:00Z');
  const [first, second] = published.doors;
  assert.equal(first.content.title, 'Gruß 01');
  assert.equal(first.content.imageAlt, 'Schneebedeckter Hof');
  assert.deepEqual(first.content.links, [{ label: 'Unser Link', url: 'https://example.com/infos' }]);
  assert.match(first.content.imageUrl, /^\.\/media\/01-/);
  assert.deepEqual(await readFile(join(out, first.content.imageUrl)), firstImage);
  assert.deepEqual(second, { day: 2, available: false });
  assert.equal((await readdir(join(out, 'media'))).length, 1);
  assert.doesNotMatch(JSON.stringify(published), /späteres Geheimnis|Ein Entwurf/);
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /data-calendar-mode="pages"/);
  assert.match(html, /src="\.\/assets\/campus-advent-2026.webp"/);
  assert.match(html, /href="https:\/\/github\.com\/example\/privat"/);

  const after = await build('2027-01-01T00:00:00Z');
  assert.deepEqual(after.doors.filter(door => door.available).map(door => door.day), [1, 2, 24]);
  assert.equal(after.doors[1].content.text, 'Ein späteres Geheimnis');

  await build('2026-11-30T22:59:59Z');
  assert.ok(!(await readdir(out)).includes('media'));
});

test('verhindert das Kopieren von Bildpfaden außerhalb des privaten Bilderordners', async t => {
  const { content, door, build } = await fixture(t);
  await writeFile(join(content, 'geheim.png'), 'nicht veröffentlichen');
  await door('01', { bild: '../geheim.png' });
  await assert.rejects(build('2026-12-01T08:00:00Z'), /Türchen 01.*Dateinamen/);
  await symlink(join(content, 'geheim.png'), join(content, 'bilder', 'link.png'));
  await door('01', { bild: 'link.png' });
  await assert.rejects(build('2026-12-01T08:00:00Z'), /Türchen 01.*reguläre Datei/);
  await writeFile(join(content, 'bilder', 'falsch.png'), 'falsche Bildsignatur');
  await door('01', { bild: 'falsch.png' });
  await assert.rejects(build('2026-12-01T08:00:00Z'), /Türchen 01.*Bildformat/);
});

test('verwirft nicht sichere Linkprotokolle und hält Entwürfe zurück', async t => {
  const { door, build } = await fixture(t);
  const links = [{ titel: 'Link', url: 'javascript:alert(1)' }];
  await door('01', { links });
  await assert.rejects(build('2026-12-01T08:00:00Z'), /Türchen 01.*HTTP/);
  await door('01', { links, freigeben: false });
  const data = await build('2026-12-01T08:00:00Z');
  assert.deepEqual(data.doors[0], { day: 1, available: false });
});
