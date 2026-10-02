import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { todayJakarta } from '../public/domain.js';

test('controller: mixed-year copy/bulk/archive and smart paste routing with automatic requester', async () => {
  class Element {
    constructor(id = '', tag = 'div') {
      this.id = id; this.tag = tag; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.checked = false;
      this.dataset = {}; this.handlers = {}; this.attributes = {}; this.classes = new Set(); this.selectionStart = 0; this.selectionEnd = 0;
      this.classList = { add: v => this.classes.add(v), remove: v => this.classes.delete(v), toggle: (v, on) => on ? this.classes.add(v) : this.classes.delete(v) };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    showModal() { this.open = true; } close() { this.open = false; } focus() {} select() {} scrollIntoView() {}
    requestSubmit() { this.submitCount = (this.submitCount || 0) + 1; this.lastSubmit = this.handlers.submit({preventDefault(){}}); }
    reset() { for (const [id, e] of Object.entries(ids)) if (id.startsWith('form-')) e.value = ''; }
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); }
    closest(selector) { const match = selector.match(/^\[data-([^\]]+)\]$/); return match && Object.hasOwn(this.dataset, match[1]) ? this : null; }
  }
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = Object.fromEntries([...html.matchAll(/<([a-z]+)[^>]*id="([^"]+)"[^>]*>/g)].map(match => [match[2], new Element(match[2], match[1])]));
  const controls = {};
  for (const kind of ['room', 'entity', 'view', 'audience', 'density']) {
    controls[kind] = [...html.matchAll(new RegExp(`data-${kind}="([^"]+)"`, 'g'))].map(match => { const e = new Element(); e.dataset[kind] = match[1]; return e; });
  }
  const handlers = {};
  globalThis.document = {
    title: '', getElementById: id => ids[id], querySelector: () => null,
    querySelectorAll: selector => {
      const match = selector.match(/^\[data-(room|entity|view|audience|density)\]$/);
      if (match) return controls[match[1]];
      if (selector === 'dialog') return Object.values(ids).filter(e => e.tag === 'dialog');
      if (selector === 'dialog[open]') return Object.values(ids).filter(e => e.tag === 'dialog' && e.open);
      return [];
    }, addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  globalThis.location = { search: '?demo=1', href: 'http://localhost:8080/?demo=1', origin: 'http://localhost:8080', protocol: 'http:' };
  globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
  let copied = '';
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, clipboard: { writeText: async text => { copied = text; } } } });
  const realTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};
  try {
    await import('../public/app.js');
    for (let i = 0; i < 200 && !ids['list-summary'].textContent; i++) await new Promise(resolve => setImmediate(resolve));
    assert.match(ids['list-summary'].textContent, /^6 dokumen/);
    assert.equal(ids['list-summary'].textContent.includes('Oktober 2026'), false);
    assert.equal(ids['period-filter'].hidden, true);
    assert.equal(ids['requester-name'].textContent, 'Nisa');
    ids['date-preset'].value = 'all'; ids['date-preset'].handlers.change();
    assert.match(ids['list-summary'].textContent, /^6 dokumen/);
    assert.equal(ids['year-awareness'].hidden, false); assert.match(ids['request-rows'].innerHTML, /tahun lain/);
    assert.equal(ids['reverse-open-count'].textContent,8); assert.equal(ids['cancel-open-count'].textContent,3);
    const mine=controls.audience.find(e=>e.dataset.audience==='mine'), team=controls.audience.find(e=>e.dataset.audience==='team');
    handlers.click({target:mine}); await new Promise(resolve => setImmediate(resolve)); assert.match(ids['list-summary'].textContent,/^2 dokumen/);
    assert.equal(ids['reverse-open-count'].textContent,2); assert.equal(ids['cancel-open-count'].textContent,1);
    assert.equal(ids['request-rows'].innerHTML.includes('Bing'),false);
    handlers.click({target:team}); await new Promise(resolve => setImmediate(resolve)); assert.match(ids['list-summary'].textContent,/^6 dokumen/);
    const compact=controls.density.find(e=>e.dataset.density==='compact'); handlers.click({target:compact});
    assert.equal(ids['request-board'].classes.has('is-compact'),true); assert.match(memory.get('posting-desk-ui-v1'),/\"density\":\"compact\"/);
    ids['copy-filter'].handlers.click(); await Promise.resolve();
    assert.equal(copied.split('\n').length, 6); assert.match(ids['list-summary'].textContent, /^6 dokumen/);
    assert.equal(ids['copy-year-hint'].hidden, false); ids['copy-dialog'].close();
    ids['select-all'].checked = true; ids['select-all'].handlers.change({target:ids['select-all']}); ids['bulk-done'].handlers.click();
    assert.match(ids['confirm-title'].textContent, /6 dokumen/); await ids['confirm-action'].handlers.click();
    assert.match(ids['list-summary'].textContent, /^0 dokumen/);
    const done = controls.view.find(e => e.dataset.view === 'done'); handlers.click({target:done});
    assert.equal(ids['period-filter'].hidden, false);
    assert.match(ids['list-summary'].textContent, /^8 dokumen/); assert.match(ids['request-rows'].innerHTML,/data-archive=/); assert.equal(ids['bulk-archive'].hidden,false);
    ids['select-all'].checked = true; ids['select-all'].handlers.change({target:ids['select-all']}); ids['bulk-archive'].handlers.click(); await ids['confirm-action'].handlers.click();
    assert.match(ids['list-summary'].textContent, /^0 dokumen/);
    const archive = controls.view.find(e => e.dataset.view === 'archive'); handlers.click({target:archive}); assert.equal(ids['period-filter'].hidden, false); assert.match(ids['list-summary'].textContent, /^9 dokumen/);
    ids['select-all'].checked = true; ids['select-all'].handlers.change({target:ids['select-all']}); ids['bulk-restore'].handlers.click(); await ids['confirm-action'].handlers.click();
    assert.match(ids['list-summary'].textContent, /^0 dokumen/); handlers.click({target:done}); assert.match(ids['list-summary'].textContent, /^9 dokumen/);
    const previousYear = String(Number(todayJakarta().slice(0,4)) - 1);
    let prevented = false;
    ids['form-documents'].handlers.paste({clipboardData:{getData:()=>`cancel parked documents\n5000009988 5000009989\nODI${previousYear}`}, preventDefault(){prevented=true;}});
    assert.equal(prevented, true);
    assert.equal(ids['form-documents'].value, `cancel park\n5000009988\n5000009989\nodi ${previousYear}`);
    assert.equal(ids['paste-destination'].textContent, `Cancel Park · ODI · ${previousYear}`);
    assert.equal(ids['save-request'].disabled, false);
    assert.equal(ids['form-operation'].value, 'cancel'); assert.equal(ids['form-entity'].value, 'ODI'); assert.equal(ids['form-year'].value,previousYear);
    await ids['request-form'].handlers.submit({preventDefault(){}});
    assert.equal(ids['page-title'].textContent, 'Cancel Park'); assert.match(ids['list-summary'].textContent, /^3 dokumen/);
    assert.match(ids['request-rows'].innerHTML, /Nisa/); assert.match(ids['request-rows'].innerHTML, /5000009988/);
    assert.equal(ids['form-documents'].value, ''); assert.equal(ids['form-year'].value, todayJakarta().slice(0,4));
    ids['copy-filter'].handlers.click(); await Promise.resolve(); assert.equal(copied.split('\n').length, 3); ids['copy-dialog'].close();
    ids['form-documents'].value = 'reverse 5000009990 aio odi 2026'; ids['form-documents'].handlers.input();
    assert.equal(ids['save-request'].disabled, true); assert.equal(ids['paste-destination'].textContent, 'Periksa input dulu');
    await ids['request-form'].handlers.submit({preventDefault(){}}); assert.equal(ids['form-error'].hidden, false);
    assert.match(ids['list-summary'].textContent, /^3 dokumen/);
    ids['form-documents'].value='5000009980'; ids['form-documents'].handlers.input();
    assert.equal(ids['form-documents'].value,'5000009980'); assert.equal(ids['form-documents'].handlers.blur,undefined);
    let submitPrevented=false;
    ids['form-documents'].handlers.keydown({key:'Enter',shiftKey:true,preventDefault(){submitPrevented=true;}});
    assert.equal(submitPrevented,false); assert.equal(ids['request-form'].submitCount,undefined);
    ids['form-documents'].handlers.keydown({key:'Enter',shiftKey:false,preventDefault(){submitPrevented=true;}});
    assert.equal(submitPrevented,true); await ids['request-form'].lastSubmit;
    assert.match(ids['list-summary'].textContent,/^4 dokumen/);
    const ownId=`cancel_ODI_${todayJakarta().slice(0,4)}_5000009980`, target=new Element(); target.dataset.detail=ownId;
    handlers.click({target}); assert.equal(ids['detail-edit'].hidden,false); assert.equal(ids['detail-delete'].hidden,false);
    ids['detail-edit'].handlers.click(); ids['edit-note'].value='Perbaikan dari user';
    await ids['edit-form'].handlers.submit({preventDefault(){}});
    assert.match(ids['request-rows'].innerHTML,/Diedit/);
    handlers.click({target}); assert.match(ids['detail-facts'].innerHTML,/Terakhir diedit/); assert.equal(ids['detail-note'].textContent,'Perbaikan dari user');
    ids['detail-delete'].handlers.click(); await ids['confirm-action'].handlers.click();
    assert.match(ids['list-summary'].textContent,/^3 dokumen/); assert.equal(ids['odi-open-count'].textContent,3);
    const trash=controls.view.find(e=>e.dataset.view==='trash'); handlers.click({target:trash});
    assert.match(ids['list-summary'].textContent,/^1 dokumen/); handlers.click({target});
    ids['detail-action'].handlers.click(); await ids['confirm-action'].handlers.click();
    assert.match(ids['list-summary'].textContent,/^0 dokumen/);
    handlers.click({target:controls.view.find(e=>e.dataset.view==='pending')}); assert.match(ids['list-summary'].textContent,/^4 dokumen/);
    ids['select-all'].checked = true; ids['select-all'].handlers.change({target:ids['select-all']});
    assert.equal(ids['bulk-delete'].hidden, false); assert.equal(ids['bulk-delete'].disabled, false);
    ids['bulk-delete'].handlers.click(); assert.match(ids['confirm-title'].textContent,/Hapus 4 dokumen/);
    await ids['confirm-action'].handlers.click(); assert.match(ids['list-summary'].textContent,/^0 dokumen/);
    handlers.click({target:trash}); assert.match(ids['list-summary'].textContent,/^4 dokumen/);
  } finally { globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClear; }
});
