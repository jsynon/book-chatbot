// Regenerate (or check) hosting-poc/pilot-books.mjs from the live
// library-data v49 manifest. The Worker's pilot catalog was a frozen
// hand snapshot until 2026-11-15 (audit finding B9: it had drifted —
// books 1 and 628 missing, book 332 still a placeholder byline).
//
// Usage:
//   node scripts/refresh-pilot-books.mjs           rewrite pilot-books.mjs
//   node scripts/refresh-pilot-books.mjs --check   exit 1 if it would change
//
// The manifest is the single source of truth for book titles; each
// answer page must still match an owner-published v48 or v49
// fingerprint before it reaches the model, so this catalog only
// names books — it never grants a page passage.
import {get} from 'node:https';
import {gunzipSync} from 'node:zlib';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const MANIFEST_URL = 'https://jsynon.github.io/antilogicalism-library-data/data-v49/manifest.json.gz';
const TARGET = fileURLToPath(new URL('../hosting-poc/pilot-books.mjs', import.meta.url));

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error('manifest fetch failed: HTTP ' + response.statusCode));
        response.resume();
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

const manifest = JSON.parse(gunzipSync(await fetchBuffer(MANIFEST_URL)).toString('utf8'));
if (manifest.version !== 49 || typeof manifest.books !== 'object') {
  throw new Error('Incompatible manifest: expected v49 with a books map.');
}
const ids = Object.keys(manifest.books).sort((a, b) => Number(a) - Number(b));
const entries = ids.map(id => {
  const title = manifest.books[id]?.title;
  if (typeof title !== 'string' || !title) throw new Error('Book ' + id + ' has no usable title.');
  return '  ' + JSON.stringify(id) + ': ' + JSON.stringify(title);
});
const generated = `// The pilot catalog, generated from the live library-data v49
// manifest by scripts/refresh-pilot-books.mjs — do not hand-edit.
// Regenerate after any library-data republication; --check exits 1
// on drift. The gateway imports and re-exports this frozen object,
// so every consumer sees the identical catalog.
// Each answer page must still match an owner-published v48 or v49
// fingerprint before it reaches the model.
export const PILOT_BOOKS = Object.freeze({
${entries.join(',\n')}
});
`;
const current = readFileSync(TARGET, 'utf8');
if (process.argv.includes('--check')) {
  if (current !== generated) {
    console.error('pilot-books.mjs has drifted from the live v49 manifest. Run: node scripts/refresh-pilot-books.mjs');
    process.exit(1);
  }
  console.log('pilot-books.mjs matches the live v49 manifest (' + ids.length + ' books).');
} else {
  writeFileSync(TARGET, generated);
  console.log('pilot-books.mjs regenerated: ' + ids.length + ' books from the live v49 manifest.');
}
