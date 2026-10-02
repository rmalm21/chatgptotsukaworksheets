import { formatDate, shiftDate, todayJakarta, validDate } from './domain.js';
import { icon } from './icons.js';

export function calendarDays(month) {
  const first = `${month}-01`, date = new Date(`${first}T00:00:00Z`);
  const start = shiftDate(first, -((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
}

export function shouldSubmitPaste(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

export function mountControls(root = document) {
  const controls = [];
  let opened = null;
  const disabled = input => input.disabled || Boolean(input.closest('fieldset')?.disabled);
  function close(restoreFocus = false) {
    if (!opened) return;
    const { panel, trigger } = opened;
    if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    opened = null;
    if (restoreFocus) trigger.focus();
  }
  function show(panel, trigger) {
    close(); panel.hidden = false;
    if (panel.showPopover) panel.showPopover();
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, panel.classList.contains('calendar-panel') ? 300 : 185), window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    const height = panel.getBoundingClientRect().height;
    panel.style.top = `${Math.max(12, rect.bottom + height + 10 < window.innerHeight ? rect.bottom + 7 : rect.top - height - 7)}px`;
    trigger.setAttribute('aria-expanded', 'true'); opened = { panel, trigger };
  }
  function portal(panel, wrap) {
    panel.setAttribute('popover', 'manual'); (wrap.closest('dialog') || document.body).append(panel);
  }
  root.querySelectorAll('[data-dropdown]').forEach(wrap => {
    const input = wrap.querySelector('input'), trigger = wrap.querySelector('.dropdown-trigger');
    const panel = wrap.querySelector('.dropdown-options'), options = [...panel.querySelectorAll('[role="option"]')];
    panel.id = `${input.id}-list`; trigger.setAttribute('aria-controls', panel.id); portal(panel, wrap);
    function sync() {
      const selected = options.find(option => option.dataset.value === input.value) || options[0];
      trigger.querySelector('.dropdown-value').textContent = selected.textContent;
      trigger.disabled = disabled(input);
      options.forEach(option => option.setAttribute('aria-selected', String(option === selected)));
    }
    const open = () => { if (disabled(input)) return; sync(); show(panel, trigger); (options.find(option => option.dataset.value === input.value) || options[0]).focus(); };
    trigger.addEventListener('click', () => opened?.panel === panel ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
    });
    options.forEach((option, i) => {
      option.addEventListener('click', () => { input.value = option.dataset.value; sync(); close(true); input.dispatchEvent(new Event('change', { bubbles: true })); });
      option.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowDown') next = (i + 1) % options.length;
        if (event.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = options.length - 1;
        if (next !== undefined) { event.preventDefault(); options[next].focus(); }
      });
    });
    input.addEventListener('change', sync); controls.push(sync); sync();
  });
  root.querySelectorAll('[data-date]').forEach(wrap => {
    const input = wrap.querySelector('input'), trigger = wrap.querySelector('.date-trigger');
    const panel = document.createElement('div');
    panel.className = 'calendar-panel'; panel.hidden = true; panel.id = `${input.id}-calendar`;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', `Pilih ${trigger.getAttribute('aria-label').toLowerCase()}`);
    trigger.setAttribute('aria-controls', panel.id); portal(panel, wrap);
    let month = todayJakarta().slice(0, 7);
    const choose = value => { input.value = value; sync(); close(true); input.dispatchEvent(new Event('change', { bubbles: true })); };
    function sync() { trigger.querySelector('.date-value').textContent = validDate(input.value) ? formatDate(input.value, true) : 'Pilih tanggal'; trigger.disabled = disabled(input); }
    function draw(focusDate = '') {
      const title = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
      panel.innerHTML = `<div class="calendar-heading"><button type="button" class="button-icon" data-month="-1" aria-label="Bulan sebelumnya">${icon('chevron-left')}</button><strong>${title}</strong><button type="button" class="button-icon" data-month="1" aria-label="Bulan berikutnya">${icon('chevron-right')}</button></div><div class="calendar-weekdays">${['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(v => `<span>${v}</span>`).join('')}</div><div class="calendar-days">${calendarDays(month).map(day => `<button type="button" data-day="${day}" aria-label="${formatDate(day)}" aria-pressed="${day === input.value}" class="${day.slice(0,7) !== month ? 'is-muted' : ''} ${day === todayJakarta() ? 'is-today' : ''}" ${day < '2000-01-01' || day > '2099-12-31' ? 'disabled' : ''}>${Number(day.slice(-2))}</button>`).join('')}</div><button type="button" class="calendar-today" data-today>Hari ini</button>`;
      panel.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
        const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + Number(button.dataset.month));
        const candidate = date.toISOString().slice(0,7); if (candidate < '2000-01' || candidate > '2099-12') return;
        month = candidate; draw(); panel.querySelector(`[data-month="${button.dataset.month}"]`).focus();
      }));
      panel.querySelectorAll('[data-day]').forEach(button => {
        button.addEventListener('click', () => choose(button.dataset.day));
        button.addEventListener('keydown', event => {
          const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
          if (movement === undefined) return;
          event.preventDefault(); const next = shiftDate(button.dataset.day, movement);
          if (next < '2000-01-01' || next > '2099-12-31') return;
          month = next.slice(0,7); draw(next);
        });
      });
      panel.querySelector('[data-today]').addEventListener('click', () => choose(todayJakarta()));
      if (focusDate) panel.querySelector(`[data-day="${focusDate}"]`)?.focus();
    }
    trigger.addEventListener('click', () => {
      if (opened?.panel === panel) { close(); return; }
      if (disabled(input)) return;
      const current = validDate(input.value) ? input.value : todayJakarta(); month = current.slice(0,7); draw(); show(panel, trigger); panel.querySelector(`[data-day="${current}"]`)?.focus();
    });
    input.addEventListener('change', sync); controls.push(sync); sync();
  });
  document.addEventListener('pointerdown', event => { if (opened && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Tab') close(true);
  });
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', event => { if (opened && !opened.panel.contains(event.target)) close(); }, true);
  root.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => close()));
  return { sync: () => controls.forEach(fn => fn()), close: () => close() };
}
