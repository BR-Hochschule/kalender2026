import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPages, pagesMode } from '../scripts/build-pages.mjs';

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
    await buildPages({ contentDir: content, out, now: new Date(timestamp) });
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

  const before = await build('2026-10-31T22:59:59Z');
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

  const after = await build('2027-01-01T00:00:00Z');
  assert.deepEqual(after.doors.filter(door => door.available).map(door => door.day), [1, 2, 24]);
  assert.equal(after.doors[1].content.text, 'Ein späteres Geheimnis');

  await build('2026-10-31T22:59:59Z');
  assert.ok(!(await readdir(out)).includes('media'));
});

test('schaltet im November alle Beispiele frei und wechselt am 1. Dezember zurück', async t => {
  const { build, content, door, out } = await fixture(t);
  await door('01', { text: 'Privater Dezembergruß' });
  await writeFile(join(content, 'tueren', '24.json'), 'noch in Arbeit');

  assert.equal(pagesMode(new Date('2026-10-31T22:59:59Z')), 'waiting');
  assert.equal(pagesMode(new Date('2026-10-31T23:00:00Z')), 'november');
  assert.equal(pagesMode(new Date('2026-11-30T23:00:00Z')), 'advent');

  const november = await build('2026-11-30T22:59:59Z');
  assert.equal(november.novemberTest, true);
  assert.equal(november.doors.filter(door => door.available && door.content.title).length, 24);
  assert.ok(november.doors[9].content.links.length);
  assert.equal(november.doors[10].content.imageUrl, './assets/campus-advent-2026.webp');
  assert.doesNotMatch(JSON.stringify(november), /Privater Dezembergruß|noch in Arbeit/);
  assert.ok(!(await readdir(out)).includes('media'));

  const december = await build('2026-11-30T23:00:00Z');
  assert.equal(december.novemberTest, false);
  assert.equal(december.doors.filter(door => door.available).length, 1);
  assert.equal(december.doors[0].content.text, 'Privater Dezembergruß');
  assert.deepEqual(december.doors[23], { day: 24, available: false });
});

test('veröffentlicht Texte, Links und nummerierte Bilder aus der gemeinsamen JSON-Datei nach Datum', async t => {
  const { build, content, door, out } = await fixture(t);
  const photo = await readFile(new URL('../public/assets/campus-advent-2026.webp', import.meta.url));
  await writeFile(join(content, 'bilder', '1.webp'), photo);
  await writeFile(join(content, 'bilder', '2.webp'), photo);
  await door('01', { text: 'Frühere Fassung' });
  await door('04', { text: 'Alt-Eintrag für Tag 4' });
  const links = [{ titel: 'Intranet-Link', url: 'https://example.com/advent?tag=1&modus=lesen' }];
  await writeFile(join(content, 'tuerchen.json'), JSON.stringify({
    1: { titel: 'Willkommen', text: 'Erster Adventsgruß', links, bildbeschreibung: 'Verschneiter Campus', freigeben: true },
    2: { titel: 'Zweiter Tag', text: 'Geheimer zweiter Gruß', freigeben: true },
    3: { titel: 'Entwurf', text: 'Privater Entwurf', freigeben: false },
  }));

  const preview = await build('2026-11-30T22:59:59Z');
  assert.doesNotMatch(JSON.stringify(preview), /Erster Adventsgruß|modus=lesen/);
  assert.ok(!(await readdir(out)).includes('media'));

  const first = await build('2026-11-30T23:00:00Z');
  assert.equal(first.doors[0].content.text, 'Erster Adventsgruß');
  assert.equal(first.doors[0].content.imageAlt, 'Verschneiter Campus');
  assert.deepEqual(first.doors[0].content.links, [{ label: 'Intranet-Link', url: links[0].url }]);
  assert.match(first.doors[0].content.imageUrl, /^\.\/media\/01-/);
  assert.equal((await readdir(join(out, 'media'))).length, 1);
  assert.deepEqual(first.doors[1], { day: 2, available: false });
  assert.doesNotMatch(JSON.stringify(first), /Geheimer zweiter Gruß/);

  const fourth = await build('2026-12-04T12:00:00Z');
  assert.deepEqual(fourth.doors.filter(item => item.available).map(item => item.day), [1, 2]);
  assert.doesNotMatch(JSON.stringify(fourth), /Privater Entwurf|Alt-Eintrag für Tag 4/);
});

test('meldet ungültige gemeinsame JSON-Dateien ohne private Inhalte auszugeben', async t => {
  const { build, content } = await fixture(t);
  await writeFile(join(content, 'tuerchen.json'), 'ungültig mit privaten Angaben');
  const preview = await build('2026-11-30T22:59:59Z');
  assert.equal(preview.novemberTest, true);
  await assert.rejects(build('2026-12-01T08:00:00Z'), /tuerchen\.json\. Die JSON-Datei konnte nicht gelesen werden/);
  await writeFile(join(content, 'tuerchen.json'), '{"25":{}}');
  await assert.rejects(build('2026-12-01T08:00:00Z'), /tuerchen\.json.*Türchennummern von 1 bis 24/);
});

test('zeigt echte Türchen vor ihrem Datum nur in der lokalen Inhaltsvorschau', async t => {
  const { build, content, out } = await fixture(t);
  const photo = await readFile(new URL('../public/assets/campus-advent-2026.webp', import.meta.url));
  await writeFile(join(content, 'bilder', '1.webp'), photo);
  const url = 'https://example.com/echter-advent?tag=1';
  await writeFile(join(content, 'tuerchen.json'), JSON.stringify({
    1: { titel: 'Willkommen', text: 'Echter Adventsgruß', links: [{ titel: 'Weitere Infos', url }], freigeben: true },
    2: { titel: 'Entwurf', freigeben: false },
  }));

  const date = '2026-11-27T12:00:00Z';
  await buildPages({ contentDir: content, out, now: new Date(date), previewContent: true });
  const privatePreview = JSON.parse(await readFile(join(out, 'calendar.json'), 'utf8'));
  assert.equal(privatePreview.preview, true);
  assert.equal(privatePreview.novemberTest, false);
  assert.deepEqual(privatePreview.doors.filter(item => item.available).map(item => item.day), [1]);
  assert.equal(privatePreview.doors[0].content.text, 'Echter Adventsgruß');
  assert.equal(privatePreview.doors[0].content.links[0].url, url);
  assert.match(privatePreview.doors[0].content.imageUrl, /^\.\/media\/01-/);
  assert.ok(!(await readdir(out)).includes('tuerchen.json'));

  const publicPreview = await build(date);
  assert.equal(publicPreview.preview, false);
  assert.equal(publicPreview.novemberTest, true);
  assert.doesNotMatch(JSON.stringify(publicPreview), /Echter Adventsgruß|echter-advent/);
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

test('ordnet nummerierte Bilder automatisch zu und übernimmt sie erst am Veröffentlichungstag', async t => {
  const { content, out, door, build } = await fixture(t);
  const webp = await readFile(new URL('../public/assets/campus-advent-2026.webp', import.meta.url));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dJcAAAAASUVORK5CYII=', 'base64');
  await door('01', { bildbeschreibung: 'Bild für den ersten Dezember' });
  await door('02', { bild: '' });
  await door('03', { bild: 'fest.png' });
  await writeFile(join(content, 'bilder', '01.png'), png);
  await writeFile(join(content, 'bilder', '02.webp'), webp);
  await writeFile(join(content, 'bilder', '3.webp'), webp);
  await writeFile(join(content, 'bilder', 'fest.png'), png);

  const preview = await build('2026-11-30T22:59:59Z');
  assert.equal(preview.doors[0].content.imageUrl, '');
  assert.ok(!(await readdir(out)).includes('media'));

  const first = await build('2026-11-30T23:00:00Z');
  assert.equal(first.doors[0].content.imageAlt, 'Bild für den ersten Dezember');
  assert.match(first.doors[0].content.imageUrl, /\.png$/);
  assert.deepEqual(await readdir(join(out, 'media')), [first.doors[0].content.imageUrl.split('/').pop()]);

  await writeFile(join(content, 'bilder', '1.WEBP'), webp);
  const second = await build('2026-12-02T12:00:00Z');
  assert.match(second.doors[0].content.imageUrl, /\.webp$/);
  assert.match(second.doors[1].content.imageUrl, /\.webp$/);
  assert.deepEqual(await readFile(join(out, second.doors[1].content.imageUrl)), webp);
  assert.deepEqual(second.doors[2], { day: 3, available: false });

  const third = await build('2026-12-03T12:00:00Z');
  assert.match(third.doors[2].content.imageUrl, /\.png$/);
  assert.deepEqual(await readFile(join(out, third.doors[2].content.imageUrl)), png);
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
