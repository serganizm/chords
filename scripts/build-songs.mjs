import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sourceDir = new URL('../data-src/Top/', import.meta.url);
const publicDir = new URL('../dist/', import.meta.url);
const songsDir = new URL('../dist/songs/', import.meta.url);
fs.rmSync(songsDir, { recursive: true, force: true });
fs.mkdirSync(songsDir, { recursive: true });

const cleanPart = value => value.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
const files = fs.readdirSync(sourceDir).filter(name => name.toLowerCase().endsWith('.txt')).sort(new Intl.Collator('ru').compare);

const songs = files.map((filename, index) => {
  const rawName = filename.replace(/\.txt$/i, '').trim();
  let parts = rawName.split(/\s+[—–-]\s+/);
  if (parts.length === 1 && rawName.includes('-')) parts = rawName.split(/-(.+)/).filter(Boolean);
  const artist = (parts.shift() || 'Без исполнителя').trim();
  const title = (parts.join(' — ') || rawName).replace(/_+$/g, '').trim();
  let text = fs.readFileSync(new URL(filename, sourceDir), 'utf8').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n');
  if (lines[0]?.trim().replace(/_+$/g, '') === rawName.replace(/_+$/g, '')) text = lines.slice(1).join('\n').trim();

  const artistDir = cleanPart(artist);
  const songFile = `${cleanPart(title)}.txt`;
  const relativeFile = `songs/${artistDir}/${songFile}`;
  const targetDir = path.join(new URL(songsDir).pathname, artistDir);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, songFile), text + '\n');
  const version = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  return { id: index + 1, artist, title, file: relativeFile, version };
});

const catalogVersion = crypto.createHash('sha256').update(JSON.stringify(songs)).digest('hex').slice(0, 12);
fs.writeFileSync(new URL('catalog.json', publicDir), JSON.stringify({ version: catalogVersion, updatedAt: new Date().toISOString(), songs }, null, 2) + '\n');
console.log(`Built ${songs.length} separate song files; catalog ${catalogVersion}`);
