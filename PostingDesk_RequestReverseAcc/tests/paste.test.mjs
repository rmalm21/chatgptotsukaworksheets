import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestPaste, yearSummary } from '../public/domain.js';
const defaults = { operation: 'cancel', entity: 'ODI', fiscalYear: '2026' };
const sample = 'req reverse\n5000043992\n3000035398\n5000044177\n5000044176\n5000041587\naio 2026';

test('user sample routes every number to Reverse AIO 2026 independent of active tab', () => {
  const parsed = parseRequestPaste(sample, defaults);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.operation, 'reverse'); assert.equal(parsed.entity, 'AIO'); assert.equal(parsed.fiscalYear, '2026');
  assert.deepEqual(parsed.documents, ['5000043992', '3000035398', '5000044177', '5000044176', '5000041587']);
  assert.deepEqual(parsed.detected, { operation: true, entity: true, fiscalYear: true });
});

test('space-separated and vertical documents normalize to the same request', () => {
  const inline = sample.replace(/\n(?=\d)/g, ' ');
  assert.equal(parseRequestPaste(inline, defaults).normalized, parseRequestPaste(sample, defaults).normalized);
  const onlyNumbers = parseRequestPaste('0000000001 6300009033\t6300009034', defaults);
  assert.deepEqual(onlyNumbers.documents, ['0000000001', '6300009033', '6300009034']);
  assert.equal(onlyNumbers.normalized, '0000000001\n6300009033\n6300009034');
  assert.deepEqual(onlyNumbers.detected, { operation: false, entity: false, fiscalYear: false });
});

test('reverse synonyms route correctly', () => {
  for (const phrase of ['request reverse', 'REQ REVERSE', 'reverse', 'reversal', 'mohon direverse', 'req rev', 'tolong pembalikan dokumen', 'requestreverse', 'rq rvs', 'req rvs', 'rvs']) {
    const parsed = parseRequestPaste(`${phrase}\n5000043992\naio 2025`, defaults);
    assert.equal(parsed.operation, 'reverse', phrase); assert.deepEqual(parsed.errors, [], phrase);
  }
});

test('cancel park synonyms and compact entity/year route correctly', () => {
  for (const phrase of ['cancel park', 'cancel parked documents', 'cancel parking', 'batal park', 'batalkan park', 'hapus park', 'park cancellation', 'cancelpark', 'request cancel park', 'CP', 'cncl', 'cnle', 'park']) {
    const parsed = parseRequestPaste(`${phrase}\n5000043992 3000035398\nODI2025`, defaults);
    assert.equal(parsed.operation, 'cancel', phrase); assert.equal(parsed.entity, 'ODI', phrase);
    assert.equal(parsed.fiscalYear, '2025', phrase); assert.deepEqual(parsed.errors, [], phrase);
  }
});

test('headers, bullets and repeated numbers are cleaned without losing leading zeros', () => {
  const parsed = parseRequestPaste('Nomor dokumen:\n1. 0000000001\n• 6300009033\n6300009033\nEntitas: AIO\nTahun: 2026', defaults);
  assert.deepEqual(parsed.documents, ['0000000001', '6300009033']);
  assert.deepEqual(parsed.duplicates, ['6300009033']); assert.deepEqual(parsed.errors, []);
  assert.equal(parseRequestPaste(parsed.normalized, defaults).normalized, parsed.normalized);
});

test('conflicting operation, entity and year stop a batch instead of choosing one', () => {
  for (const text of ['reverse cancel park 5000043992 aio 2026', 'reverse 5000043992 aio odi 2026', 'reverse 5000043992 aio 2025 2026']) {
    const parsed = parseRequestPaste(text, defaults);
    assert.equal(parsed.ambiguous, true); assert.ok(parsed.errors.length); assert.equal(parsed.normalized, text);
  }
});

test('invalid/scientific/overlong numbers and unrecognized text never silently disappear', () => {
  for (const token of ['6.3E9', '50000439921', '500004399', 'jangan', '-5000043992']) {
    const parsed = parseRequestPaste(`reverse 6300009033 ${token} aio 2026`, defaults);
    assert.ok(parsed.errors.length, token); assert.ok(parsed.invalid.includes(token), token);
    assert.deepEqual(parsed.documents, ['6300009033']);
  }
});

test('batch limit uses unique numbers and incomplete inputs stay empty', () => {
  const many = Array.from({length: 101}, (_, i) => String(6300009000 + i)).join(' ');
  assert.match(parseRequestPaste(`reverse ${many} aio 2026`, defaults).errors.join(' '), /Maksimal 100/);
  assert.deepEqual(parseRequestPaste('reverse aio 2026', defaults).documents, []);
});

test('year awareness counts previous and future fiscal years separately from request dates', () => {
  assert.deepEqual(yearSummary([{fiscalYear:'2026'}, {fiscalYear:'2025'}, {fiscalYear:'2027'}, {fiscalYear:'2025'}], '2026'), {
    years:['2025', '2026', '2027'], nonCurrent:3, otherYears:['2025', '2027']
  });
});


test('mixed entities route per labelled line, including the same number in two entities', () => {
  const p = parseRequestPaste('rq rvs\n5000043992 aio\n3000035398 odi\n5000043992 odi\n2026', defaults);
  assert.deepEqual(p.errors, []); assert.equal(p.mixedEntities, true);
  assert.deepEqual(p.entries.map(({documentNumber, entity, fiscalYear}) => [documentNumber,entity,fiscalYear]), [
    ['5000043992','AIO','2026'], ['3000035398','ODI','2026'], ['5000043992','ODI','2026']
  ]);
  assert.deepEqual(parseRequestPaste(p.normalized, defaults).entries.map(v=>[v.documentNumber,v.entity,v.fiscalYear]), p.entries.map(v=>[v.documentNumber,v.entity,v.fiscalYear]));
});

test('block headers carry their entity and year to subsequent lines', () => {
  const p = parseRequestPaste('cnle\nAIO 2025\n5000043992 5000044177\nODI 2026\n3000035398', defaults);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.entries.map(v=>[v.entity,v.fiscalYear]), [['AIO','2025'],['AIO','2025'],['ODI','2026']]);
  assert.equal(p.operation, 'cancel');
});

test('ambiguous unlabeled mixed entities require labels rather than silently choosing a destination', () => {
  const p = parseRequestPaste('5000043992\n5000044177 aio\n3000035398 odi', defaults);
  assert.match(p.errors.join(' '), /Baris 1: beri label/);
});

test('plain typed numbers never acquire fallback metadata while formatting', () => {
  const p = parseRequestPaste('6300009033 6300009034', defaults);
  assert.equal(p.normalized, '6300009033\n6300009034');
  assert.equal(p.operation, 'cancel'); assert.equal(p.entity, 'ODI');
  assert.equal(p.normalized.includes('2026'), false);
});
