import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CONFIG } from '../public/firebase-config.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('deploy selector resolves the requested site in the correct Firebase project', () => {
  const config = JSON.parse(read('firebase.json'));
  const rc = JSON.parse(read('.firebaserc'));
  assert.equal(APP_CONFIG.firebaseConfig.projectId, 'request-reverse-app');
  assert.equal(rc.projects.default, APP_CONFIG.firebaseConfig.projectId);
  assert.equal(APP_CONFIG.firebaseConfig.authDomain, 'request-reverse-app.firebaseapp.com');
  assert.equal(config.hosting.target, 'requestreverseacc');
  assert.deepEqual(rc.targets[rc.projects.default].hosting[config.hosting.target], ['requestreverseacc']);
  assert.equal(config.hosting.public, 'public');
  for (const file of [config.firestore.rules, config.firestore.indexes]) assert.equal(fs.existsSync(path.join(root, file)), true);
  const guide = read('README.md');
  assert.ok(guide.includes('firebase deploy --only hosting:requestreverseacc'));
  assert.ok(guide.includes('firebase deploy --only firestore'));
});

test('every app DOM id exists and hosting permits Teams framing', () => {
  const html = read('public/index.html');
  const app = read('public/app.js');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.equal(ids.includes('scope-year'), false);
  assert.equal(ids.includes('form-requester'), false);
  assert.ok(html.includes('class="entity-column"'));
  assert.ok(html.includes('class="year-column"'));
  assert.ok(html.includes('id="period-filter"'));
  const productionGuide = read('public/setup.html');
  assert.match(productionGuide, /Panduan penggunaan/);
  assert.doesNotMatch(productionGuide, /firebase deploy|Cloud Shell|Aktifkan layanan/);
  const indexes = JSON.parse(read('firestore.indexes.json'));
  assert.ok(indexes.indexes.some(index => index.fields.every(field => field.fieldPath !== 'fiscalYear')));
  for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `Missing id: ${match[1]}`);
  const config = JSON.parse(read('firebase.json'));
  const headers = config.hosting.headers.flatMap(rule => rule.headers);
  const csp = headers.find(header => header.key === 'Content-Security-Policy').value;
  assert.match(csp, /frame-ancestors[^;]*https:\/\/teams\.microsoft\.com/);
  assert.match(csp, /frame-ancestors[^;]*https:\/\/\*\.cloud\.microsoft/);
  assert.equal(headers.some(header => header.key === 'X-Frame-Options'), false);
});

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(full) : [full];
  });
}

test('shipped web links and local module dependencies exist after removing custom Teams package', () => {
  const publicRoot = path.join(root, 'public');
  const files = filesIn(publicRoot);
  assert.equal(files.some(file => /teams-(package|config|manifest)/.test(file)), false);
  const scan = [...files, path.join(root, 'BACA-DULU.html')];
  for (const file of scan) {
    const extension = path.extname(file);
    if (!['.html', '.js'].includes(extension)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const references = extension === '.html'
      ? [...content.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1])
      : [...content.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*)'([^']+)'/g)].map(match => match[1]);
    for (const reference of references) {
      if (/^(https?:|data:|mailto:)/.test(reference)) continue;
      const pathname = reference.split(/[?#]/)[0];
      const target = pathname.startsWith('/') ? path.join(publicRoot, pathname) : path.resolve(path.dirname(file), pathname);
      assert.equal(fs.existsSync(target), true, `${path.relative(root, file)} references missing ${reference}`);
    }
  }
});
