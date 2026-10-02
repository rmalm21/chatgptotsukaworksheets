import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, shouldSubmitPaste } from '../public/controls.js';

test('calendar includes leap day and adjacent months in a Monday-first grid', () => {
  const days=calendarDays('2024-02');
  assert.equal(days.length,42); assert.equal(days[0],'2024-01-29'); assert.ok(days.includes('2024-02-29'));
  assert.equal(calendarDays('2026-10')[0],'2026-09-28');
});

test('Enter submits while Shift Enter and IME composition stay in the paste box', () => {
  assert.equal(shouldSubmitPaste({key:'Enter'}),true);
  assert.equal(shouldSubmitPaste({key:'Enter',shiftKey:true}),false);
  assert.equal(shouldSubmitPaste({key:'Enter',isComposing:true}),false);
  assert.equal(shouldSubmitPaste({key:'Enter',keyCode:229}),false);
  assert.equal(shouldSubmitPaste({key:'a'}),false);
});
