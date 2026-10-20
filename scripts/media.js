const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg', 'video/webm': '.webm', 'video/mp4': '.mp4' };
const managedFile = /^[a-f0-9]{64}\.[a-z0-9]+$/;
const href = name => name.split(path.sep).map(encodeURIComponent).join('/');

/** Stage every referenced byte before publishing; never link to the runner's artifacts. */
async function prepareMedia(tests, { output, projectRoot, staging, signal }) {
  const directory = path.basename(output, path.extname(output)) + '.media';
  const files = new Set();
  const cache = new Map();
  let missing = 0;
  async function copy(media) {
    const { source, body, remote, ...clean } = media;
    const base = { ...clean, originalPath: source ? path.relative(projectRoot, source).split(path.sep).join('/') : '' };
    if (remote) {
      try {
        const url = new URL(remote);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('不支持的录屏链接');
        return { ...base, availability: 'remote', src: url.href };
      } catch { missing++; return { ...base, availability: 'missing', reason: '录屏链接无效' }; }
    }
    const cacheKey = source || `body:${media.mime}:${body || ''}`;
    if (!source && !body) {
      missing++; return { ...base, availability: 'missing', reason: '报告未提供可用媒体文件' };
    }
    try {
      signal?.throwIfAborted();
      let name = cache.get(cacheKey);
      if (!name) {
        const hash = createHash('sha256');
        const temp = path.join(staging, randomUUID());
        if (source) {
          await pipeline(fs.createReadStream(source), new Transform({ transform(chunk, encoding, done) {
            hash.update(chunk); done(null, chunk);
          } }), fs.createWriteStream(temp), { signal });
        } else {
          const bytes = Buffer.from(body, 'base64'); hash.update(bytes); await fsp.writeFile(temp, bytes, { signal });
        }
        const ext = extensions[media.mime] || (Object.values(extensions).includes(path.extname(source || '').toLowerCase())
          ? path.extname(source).toLowerCase() : '.bin');
        name = hash.digest('hex') + ext;
        await fsp.rename(temp, path.join(staging, name));
        cache.set(cacheKey, name);
      }
      files.add(name);
      return { ...base, availability: 'local', src: href(path.join(directory, name)) };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!['ENOENT', 'EACCES', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
      missing++; return { ...base, availability: 'missing', reason: `媒体文件不可用（${error.code}）` };
    }
  }
  const exported = [];
  for (const t of tests) {
    const attempts = [];
    for (const a of t.attempts) {
      const media = [];
      for (const item of a.media) media.push(await copy(item));
      attempts.push({ ...a, media });
    }
    exported.push({ ...t, attempts });
  }
  return { tests: exported, directory, files: [...files], missing };
}
async function publish({ output, staging, media, html, signal }) {
  const destination = path.join(path.dirname(output), media.directory);
  const manifest = path.join(destination, '.e2r-manifest.json');
  let previous = [];
  try {
    const m = JSON.parse(await fsp.readFile(manifest, 'utf8'));
    if (m.owner === 'e2r-media-1' && Array.isArray(m.files)) previous = m.files.filter(f => managedFile.test(f));
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  signal?.throwIfAborted();
  await fsp.mkdir(destination, { recursive: true });
  for (const name of media.files) await fsp.rename(path.join(staging, name), path.join(destination, name));
  const htmlTemp = path.join(staging, 'report.html');
  await fsp.writeFile(htmlTemp, html, { signal });
  signal?.throwIfAborted();
  await fsp.rename(htmlTemp, output);
  // These operations only collect old, explicitly owned media after the new page is visible.
  try {
    const manifestTemp = path.join(staging, 'manifest.json');
    await fsp.writeFile(manifestTemp, JSON.stringify({ owner: 'e2r-media-1', files: media.files }));
    await fsp.rename(manifestTemp, manifest);
    for (const name of previous) if (!media.files.includes(name)) await fsp.rm(path.join(destination, name), { force: true });
  } catch (error) { console.error(`报告已更新，旧媒体清理失败：${error.message}`); }
}
module.exports = { prepareMedia, publish };
