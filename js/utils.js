/* FORJA — utilitários: DOM, formatação, datas, unidades, ícones e haptics */
(function (global) {
  'use strict';

  /* ---------- DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n, dec = 0) => { const f = 10 ** dec; return Math.round(n * f) / f; };
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // Move um item de posição e devolve um novo array
  function moveItem(list, from, to) {
    const out = [...list];
    const [item] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
    return out;
  }

  function debounce(fn, ms = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Enter (ou "Próximo"/"OK" do teclado virtual) sempre envia o formulário
  function submitOnEnter(input, form) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }

  /* ---------- Números ---------- */
  const nfCache = {};
  function fmtNum(n, dec = 0) {
    if (!Number.isFinite(n)) return '0';
    const key = String(dec);
    if (!nfCache[key]) nfCache[key] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
    return nfCache[key].format(n);
  }

  // Aceita "72,5", "72.5" e "72" — retorna NaN para qualquer outra coisa
  function parseDecimal(input) {
    if (typeof input === 'number') return input;
    const s = String(input == null ? '' : input).trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /* ---------- Unidades (tudo é salvo em kg) ---------- */
  const LB_PER_KG = 2.2046226218;
  const currentUnit = () => {
    try { return global.Store ? global.Store.get('settings').unit : 'kg'; } catch (e) { return 'kg'; }
  };
  const toUnit = (kg, unit = currentUnit()) => (unit === 'lb' ? kg * LB_PER_KG : kg);
  const fromUnit = (value, unit = currentUnit()) => (unit === 'lb' ? value / LB_PER_KG : value);

  function fmtWeight(kg, { dec = 1, unit = currentUnit(), withUnit = true } = {}) {
    const v = fmtNum(round(toUnit(kg, unit), dec), dec);
    return withUnit ? `${v} ${unit}` : v;
  }

  function fmtVolume(kg, { unit = currentUnit(), withUnit = true } = {}) {
    const v = fmtNum(Math.round(toUnit(kg, unit)));
    return withUnit ? `${v} ${unit}` : v;
  }

  /* ---------- Tempo ---------- */
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDuration(sec) {
    const total = Math.max(0, Math.round((sec || 0) / 60));
    if (total < 60) return `${total} min`;
    const hrs = Math.floor(total / 60);
    const min = total % 60;
    return min ? `${hrs}h ${pad(min)}min` : `${hrs}h`;
  }

  // Duração dividida em valor + sufixo, para números grandes na interface
  function durationParts(sec) {
    const total = Math.max(0, Math.round((sec || 0) / 60));
    if (total < 60) return { value: String(total), unit: 'min' };
    const hrs = Math.floor(total / 60);
    const min = total % 60;
    return { value: min ? `${hrs}h ${pad(min)}` : `${hrs}`, unit: min ? 'min' : 'h' };
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const hrs = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return hrs ? `${hrs}:${pad(min)}:${pad(s)}` : `${pad(min)}:${pad(s)}`;
  }

  /* ---------- Datas ---------- */
  const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  const dayKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const startOfDay = (d) => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };
  // Semana começa na segunda-feira
  const startOfWeek = (d) => { d = startOfDay(d); const wd = (d.getDay() + 6) % 7; return addDays(d, -wd); };
  const fmtDayMonth = (d) => { d = new Date(d); return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`; };
  const fmtWeekdayDate = (d) => { d = new Date(d); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

  const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const fmtMonthYear = (d) => { d = new Date(d); const m = MONTHS_LONG[d.getMonth()]; return `${m[0].toUpperCase()}${m.slice(1)} ${d.getFullYear()}`; };
  // "Sexta, 18 de setembro · 18:32"
  const fmtLongDate = (d) => { d = new Date(d); return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function greeting(d = new Date()) {
    const hr = d.getHours();
    if (hr >= 5 && hr < 12) return 'Bom dia';
    if (hr >= 12 && hr < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Busca sem acento e sem caixa: "Tríceps" encontra "triceps"
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
  const initial = (name) => (String(name || '').trim()[0] || 'F').toUpperCase();

  /* ---------- Haptics (opcional, desligável) ---------- */
  const HAPTICS = { tap: 6, success: [10, 40, 16], record: [12, 60, 12, 60, 28], finish: [24, 70, 36] };
  function haptic(kind = 'tap') {
    try {
      if (!navigator.vibrate) return;
      if (global.Store && global.Store.get('settings').haptics === false) return;
      navigator.vibrate(HAPTICS[kind] || kind);
    } catch (e) { /* sem suporte — silencioso */ }
  }

  /* ---------- Ícones (SVG de traço fino, 24×24) ---------- */
  const ICONS = {
    home: '<path d="M3.75 10.5 12 3.75l8.25 6.75"/><path d="M5.75 9v11.25h12.5V9"/><path d="M10 20.25v-5.5h4v5.5"/>',
    dumbbell: '<path d="M6.5 6.75v10.5M17.5 6.75v10.5M3.5 9.25v5.5M20.5 9.25v5.5M6.5 12h11"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.75" cy="6.5" r=".6" fill="currentColor"/><circle cx="4.75" cy="12" r=".6" fill="currentColor"/><circle cx="4.75" cy="17.5" r=".6" fill="currentColor"/>',
    chart: '<path d="M3.75 20.25h16.5"/><path d="m4.75 15.5 4.75-4.75 3.5 3.25 6.25-6.5"/><path d="M15 7.5h4.25v4.25"/>',
    user: '<circle cx="12" cy="8.25" r="3.75"/><path d="M4.75 20.25c1.1-3.6 3.9-5.5 7.25-5.5s6.15 1.9 7.25 5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.75 4.5 4.5L19 7.75"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.75"/><path d="m20.25 20.25-4.5-4.5"/>',
    star: '<path d="m12 3.75 2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.77l-5.1 2.68.98-5.68-4.13-4.02 5.7-.83z"/>',
    calendar: '<rect x="3.75" y="5.25" width="16.5" height="15" rx="3"/><path d="M3.75 10h16.5M8 3.25v4M16 3.25v4"/>',
    trophy: '<path d="M7.5 4.25h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6.25H4.25v1.5a3 3 0 0 0 3.25 3M16.5 6.25h3.25v1.5a3 3 0 0 1-3.25 3M12 13.75v3.5M8.5 20.25h7M9.5 17.25h5"/>',
    flame: '<path d="M12 20.75c-3.6 0-6.25-2.5-6.25-6 0-3.9 3.4-5.9 3.9-10 2.4 1.4 3.9 3.4 4.3 5.9.9-.6 1.5-1.6 1.7-2.8 1.7 1.5 2.6 3.9 2.6 6.9 0 3.5-2.65 6-6.25 6z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.55-2-3.45-2.4.95a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.45a7.4 7.4 0 0 0-2.6 1.5L4.6 5.5l-2 3.45 2 1.55a7.6 7.6 0 0 0 0 3l-2 1.55 2 3.45 2.4-.95a7.4 7.4 0 0 0 2.6 1.5l.4 2.45h4l.4-2.45a7.4 7.4 0 0 0 2.6-1.5l2.4.95 2-3.45z"/>',
    trash: '<path d="M4.75 6.75h14.5M9.75 6.75V4.75h4.5v2M6.75 6.75l.8 12.5h8.9l.8-12.5"/>',
    bolt: '<path d="M13 3.25 5.75 13.5H12l-1 7.25 7.25-10.25H12z"/>',
    scale: '<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4.5"/><path d="M7.75 10.5a5 5 0 0 1 8.5 0"/><path d="m12 12.75 1.75-2.75"/><circle cx="12" cy="12.9" r=".9" fill="currentColor" stroke="none"/>',
    ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
    target: '<circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".75" fill="currentColor"/>',
    sparkle: '<path d="M12 3.75c.6 4.1 2.15 5.65 6.25 6.25-4.1.6-5.65 2.15-6.25 6.25-.6-4.1-2.15-5.65-6.25-6.25 4.1-.6 5.65-2.15 6.25-6.25z"/><path d="M18.5 16.25c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5z"/>',
    info: '<circle cx="12" cy="12" r="8.25"/><path d="M12 11v5.25M12 7.75v.01"/>',
    minus: '<path d="M5 12h14"/>',
    more: '<circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
    grip: '<path d="M5 9h14M5 15h14"/>',
    copy: '<rect x="8.25" y="8.25" width="12" height="12" rx="3"/><path d="M15.75 8.25V6.75a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h1.5"/>',
    edit: '<path d="M4.75 19.25h4l10-10a2.83 2.83 0 0 0-4-4l-10 10z"/><path d="m13.25 6.75 4 4"/>',
    arrowUp: '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
    arrowDown: '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
    play: '<path d="M7.75 5.5v13l10.5-6.5z" fill="currentColor"/>',
    barbell: '<path d="M2.75 12h18.5"/><rect x="5" y="7.25" width="3" height="9.5" rx="1"/><rect x="16" y="7.25" width="3" height="9.5" rx="1"/>',
    gift: '<rect x="4" y="9.5" width="16" height="10.75" rx="2"/><path d="M3.25 9.5h17.5V7.25a1 1 0 0 0-1-1H4.25a1 1 0 0 0-1 1zM12 6.25v14M12 6.25C10.5 3 7 3.25 7.25 5c.2 1.25 2.5 1.25 4.75 1.25zM12 6.25C13.5 3 17 3.25 16.75 5c-.2 1.25-2.5 1.25-4.75 1.25z"/>',
    swap: '<path d="M4.75 8.25h13.5M15 4.5l3.75 3.75L15 12M19.25 15.75H5.75M9 12l-3.75 3.75L9 19.5"/>',
    image: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3"/><circle cx="9" cy="9.75" r="1.5"/><path d="m4.5 17.5 4.75-4.75 3.5 3.5 2.5-2.5 4.25 4.25"/>',
    share: '<path d="M12 3.75v11M7.75 8 12 3.75 16.25 8"/><path d="M7.25 11.25h-1.5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1.5"/>',
    download: '<path d="M12 3.75v11M7.75 10.5 12 14.75l4.25-4.25M4.75 16.75v1.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-1.5"/>',
    layers: '<path d="m12 3.75 8.25 4.5-8.25 4.5-8.25-4.5z"/><path d="m3.75 12.25 8.25 4.5 8.25-4.5"/><path d="m3.75 16.25 8.25 4.5 8.25-4.5"/>',
    bell: '<path d="M6.25 16.25V11a5.75 5.75 0 0 1 11.5 0v5.25l1.5 2H4.75z"/><path d="M10 20.25a2.1 2.1 0 0 0 4 0"/>',
    lock: '<rect x="5.25" y="10.75" width="13.5" height="9.5" rx="2.5"/><path d="M8.25 10.75V8a3.75 3.75 0 0 1 7.5 0v2.75"/>',
    eye: '<path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.9 5.97A9.7 9.7 0 0 1 12 5.75c6 0 9.25 6.25 9.25 6.25a16 16 0 0 1-2.4 3.2M6.6 6.9C4.1 8.6 2.75 12 2.75 12S6 18.25 12 18.25c1.9 0 3.5-.6 4.9-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.75 3.75l16.5 16.5"/>',
    logout: '<path d="M14.25 4.75h3a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2h-3"/><path d="M10 16.25 5.75 12 10 7.75M5.75 12H15.5"/>',
    crown: '<path d="m3.75 8.25 4.5 3.75L12 5.75l3.75 6.25 4.5-3.75-1.75 9.5H5.5z"/><path d="M5.5 20.25h13"/>',
    balance: '<path d="M12 4.25v15.5M7.5 19.75h9M5 7.25h14"/><path d="m6.5 7.25-2.75 6h5.5zM17.5 7.25l-2.75 6h5.5z"/><path d="M3.75 13.25a2.75 2.75 0 0 0 5.5 0M14.75 13.25a2.75 2.75 0 0 0 5.5 0"/>'
  };

  function icon(name, { size = 24, stroke = 1.6, cls = '' } = {}) {
    const body = ICONS[name] || '';
    return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  global.U = {
    $, $$, h, esc, uid, clamp, round, clone, moveItem, debounce, submitOnEnter,
    fmtNum, parseDecimal,
    LB_PER_KG, currentUnit, toUnit, fromUnit, fmtWeight, fmtVolume,
    pad, fmtDuration, durationParts, fmtClock,
    MONTHS, WEEKDAYS, dayKey, startOfDay, addDays, startOfWeek, fmtDayMonth, fmtWeekdayDate, fmtMonthYear, fmtLongDate, greeting,
    normalize, plural, firstName, initial,
    haptic, icon, ICONS
  };
})(window);

/* FORJA — componentes de interface: bottom sheet, toast, segmentado, toggle */
(function (global) {
  'use strict';
  const { h, esc, icon } = global.U;

  /* ---------- Bottom sheet ---------- */
  const stack = [];

  function openSheet({ title = '', subtitle = '', body = '', footer = null, onClose, closeButton = true, focus = null, tall = false, headerAction = '' } = {}) {
    const backdrop = h('<div class="sheet-backdrop"></div>');
    const sheet = h(`
      <section class="sheet${tall ? ' is-tall' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grab">
          <div class="sheet-handle"></div>
          ${title || closeButton ? `
          <div class="sheet-header">
            <div class="min-w-0">
              ${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}
              ${subtitle ? `<p class="sheet-subtitle">${esc(subtitle)}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 flex-none">
              ${headerAction}
              ${closeButton ? `<button class="icon-btn" data-sheet-close aria-label="Fechar">${icon('close', { size: 18, stroke: 2 })}</button>` : ''}
            </div>
          </div>` : ''}
        </div>
        <div class="sheet-body"></div>
        ${footer ? '<div class="sheet-footer"></div>' : ''}
      </section>`);

    const bodyEl = sheet.querySelector('.sheet-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const footerEl = sheet.querySelector('.sheet-footer');
    if (footerEl) {
      if (typeof footer === 'string') footerEl.innerHTML = footer;
      else footerEl.appendChild(footer);
    }

    document.body.append(backdrop, sheet);
    document.documentElement.classList.add('lock-scroll');

    let closed = false;
    const api = {
      el: sheet,
      body: bodyEl,
      footer: footerEl,
      close(reason) {
        if (closed) return;
        closed = true;
        const i = stack.indexOf(api);
        if (i > -1) stack.splice(i, 1);
        sheet.classList.remove('is-open', 'is-dragging');
        sheet.style.transform = '';
        backdrop.classList.remove('is-open');
        const done = () => { backdrop.remove(); sheet.remove(); };
        sheet.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 400);
        if (!stack.length) document.documentElement.classList.remove('lock-scroll');
        if (onClose) onClose(reason);
      }
    };
    stack.push(api);

    backdrop.addEventListener('click', () => api.close('backdrop'));
    sheet.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', () => api.close('button')));

    // Foco imediato: no iOS o teclado só abre se o foco acontecer no mesmo gesto
    if (focus) {
      const target = typeof focus === 'string' ? sheet.querySelector(focus) : focus;
      if (target) target.focus({ preventScroll: true });
    }

    // Força reflow e anima
    void sheet.offsetHeight;
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');

    enableDrag(sheet, api);
    return api;
  }

  // Arrastar para baixo para fechar
  function enableDrag(sheet, api) {
    const grab = sheet.querySelector('.sheet-grab');
    let startY = 0, dy = 0, startT = 0, dragging = false;

    grab.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; startY = e.clientY; dy = 0; startT = performance.now();
      sheet.classList.add('is-dragging');
      try { grab.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
    });
    grab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      const eased = dy < 0 ? 0 : dy;
      sheet.style.transform = `translate(-50%, ${eased}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('is-dragging');
      const velocity = dy / Math.max(1, performance.now() - startT);
      if (dy > 110 || (dy > 30 && velocity > 0.6)) api.close('drag');
      else sheet.style.transform = '';
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close('escape');
  });

  const closeAllSheets = () => [...stack].forEach((s) => s.close('program'));

  /* ---------- Toast ---------- */
  function toast(message, { action, onAction, duration = 2800, iconName = 'check' } = {}) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const el = h(`
      <div class="toast" role="status">
        ${iconName ? `<span class="toast-icon">${icon(iconName, { size: 18, stroke: 2 })}</span>` : ''}
        <span>${esc(message)}</span>
        ${action ? `<button class="toast-action">${esc(action)}</button>` : ''}
      </div>`);
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 320);
    };
    if (action) {
      el.querySelector('.toast-action').addEventListener('click', () => { dismiss(); if (onAction) onAction(); });
    }
    timer = setTimeout(dismiss, duration);
    return dismiss;
  }

  /* ---------- Controle segmentado ---------- */
  function segmented(options, value, onChange, { label = '' } = {}) {
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    const el = h(`
      <div class="segmented" role="radiogroup" aria-label="${esc(label)}" style="--count:${options.length};--index:${idx}">
        <span class="segmented-thumb"></span>
        ${options.map((o, i) => `<button type="button" role="radio" aria-checked="${i === idx}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
      </div>`);
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.getAttribute('aria-checked') === 'true') return;
      const buttons = [...el.querySelectorAll('button')];
      const i = buttons.indexOf(btn);
      buttons.forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
      el.style.setProperty('--index', i);
      onChange(options[i].value);
    });
    return el;
  }

  /* ---------- Toggle ---------- */
  function toggle(checked, onChange, { label = '' } = {}) {
    const el = h(`<button type="button" class="toggle" role="switch" aria-checked="${!!checked}" aria-label="${esc(label)}"></button>`);
    el.addEventListener('click', () => {
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return el;
  }

  /* ---------- Stepper (− valor +) ---------- */
  function stepper({ value, min = 0, max = 99, step = 1, format = (v) => String(v), onChange, label = '' }) {
    const el = h(`
      <div class="stepper" role="group" aria-label="${esc(label)}">
        <button type="button" class="stepper-btn" data-d="-1" aria-label="Diminuir ${esc(label)}">${icon('minus', { size: 18, stroke: 2 })}</button>
        <output class="stepper-value num" aria-live="polite"></output>
        <button type="button" class="stepper-btn" data-d="1" aria-label="Aumentar ${esc(label)}">${icon('plus', { size: 18, stroke: 2 })}</button>
      </div>`);
    let v = value;
    const out = el.querySelector('output');
    const [dec, inc] = el.querySelectorAll('button');
    const paint = () => { out.textContent = format(v); dec.disabled = v <= min; inc.disabled = v >= max; };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const next = Math.min(max, Math.max(min, v + Number(b.dataset.d) * step));
      if (next === v) return;
      v = next;
      paint();
      out.classList.remove('tick'); void out.offsetWidth; out.classList.add('tick');
      onChange(v);
    });
    paint();
    el.setLimits = (mn, mx) => { min = mn; max = mx; v = Math.min(max, Math.max(min, v)); paint(); return v; };
    el.getValue = () => v;
    return el;
  }

  /* ---------- Reordenar arrastando (alternativa aos botões ↑ ↓) ---------- */
  function sortable(container, { item = '[data-sort-item]', handle = '[data-sort-handle]', onReorder }) {
    container.addEventListener('pointerdown', (e) => {
      const hd = e.target.closest(handle);
      if (!hd || !container.contains(hd) || e.button > 0) return;
      const el = hd.closest(item);
      if (!el) return;
      e.preventDefault();

      const items = [...container.querySelectorAll(item)];
      const from = items.indexOf(el);
      const rects = items.map((i) => i.getBoundingClientRect());
      const gap = items.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
      const size = rects[from].height + gap;
      const startY = e.clientY;
      let to = from;

      container.classList.add('is-sorting');
      el.classList.add('is-dragging');
      try { hd.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro já liberado */ }

      const move = (ev) => {
        const dy = ev.clientY - startY;
        el.style.transform = `translateY(${dy}px)`;
        const center = rects[from].top + rects[from].height / 2 + dy;
        to = from;
        items.forEach((_, i) => {
          const mid = rects[i].top + rects[i].height / 2;
          if (i < from && center < mid) to = Math.min(to, i);
          if (i > from && center > mid) to = Math.max(to, i);
        });
        items.forEach((it, i) => {
          if (i === from) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -size;
          if (from > to && i >= to && i < from) shift = size;
          it.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        hd.removeEventListener('pointermove', move);
        hd.removeEventListener('pointerup', up);
        hd.removeEventListener('pointercancel', up);
        items.forEach((it) => { it.style.transform = ''; });
        el.classList.remove('is-dragging');
        container.classList.remove('is-sorting');
        if (to !== from) onReorder(from, to);
      };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
    });
  }

  /* ---------- Menu de ações (substitui o menu de contexto) ---------- */
  function actionSheet({ title = '', subtitle = '', actions }) {
    const body = h(`
      <div class="group">
        ${actions.map((a, i) => `
          <button type="button" class="row${a.danger ? ' is-danger' : ''}" data-i="${i}">
            ${a.icon ? `<span class="row-icon">${icon(a.icon, { size: 20 })}</span>` : ''}
            <span class="row-main row-title">${esc(a.label)}</span>
          </button>`).join('')}
      </div>`);
    if (actions.some((a) => a.icon)) body.classList.add('has-icons');
    const sheet = openSheet({ title, subtitle, body });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      sheet.close('action');
      actions[Number(b.dataset.i)].onSelect();
    });
    return sheet;
  }

  /* ---------- Navbar das telas internas (voltar + título compacto + ações) ---------- */
  function navbarHTML(title, backLabel, actions = '') {
    return `
      <nav class="navbar">
        <button type="button" class="nav-back" data-back aria-label="Voltar para ${esc(backLabel)}">
          ${icon('chevronLeft', { size: 24, stroke: 2 })}<span>${esc(backLabel)}</span>
        </button>
        <span class="navbar-title">${esc(title)}</span>
        <div class="navbar-actions">${actions}</div>
      </nav>`;
  }

  /* ---------- Sheets prontos ---------- */

  // Campo único (texto ou número) com validação
  function inputSheet({ title, subtitle = '', value = '', placeholder = '', suffix = '', inputmode = 'text', maxlength = 60, validate, onSave, saveLabel = 'Salvar' }) {
    const body = h(`
      <form novalidate>
        <div class="field-wrap">
          <input class="field" name="value" value="${esc(value)}" placeholder="${esc(placeholder)}"
                 inputmode="${inputmode}" maxlength="${maxlength}" autocomplete="off" enterkeyhint="done"
                 style="${suffix ? 'padding-right:64px' : ''}">
          ${suffix ? `<span class="field-suffix">${esc(suffix)}</span>` : ''}
        </div>
        <p class="field-error" aria-live="polite"></p>
        <div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">${esc(saveLabel)}</button></div>
      </form>`);
    const input = body.querySelector('input');
    const error = body.querySelector('.field-error');
    const sheet = openSheet({ title, subtitle, body, focus: input });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* tipo sem seleção */ }
    global.U.submitOnEnter(input, body);
    input.addEventListener('input', () => { input.classList.remove('is-invalid'); error.textContent = ''; });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      const result = validate ? validate(input.value) : { ok: true, value: input.value };
      if (!result.ok) {
        input.classList.add('is-invalid');
        error.textContent = result.error || 'Valor inválido.';
        body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
        return;
      }
      onSave(result.value);
      sheet.close('save');
    });
    return sheet;
  }

  // Lista de opções — seleciona e fecha
  function choiceSheet({ title, subtitle = '', options, value, onSelect }) {
    const body = h(`
      <div role="radiogroup">
        ${options.map((o) => `
          <button type="button" class="option" role="radio" aria-checked="${o.value === value}" data-value="${esc(o.value)}">
            <span>${esc(o.label)}</span>
            <span class="option-check">${icon('check', { size: 14, stroke: 2.6 })}</span>
          </button>`).join('')}
      </div>`);
    const sheet = openSheet({ title, subtitle, body });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('.option');
      if (!btn) return;
      body.querySelectorAll('.option').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      setTimeout(() => { onSelect(btn.dataset.value); sheet.close('select'); }, 180);
    });
    return sheet;
  }

  // Confirmação — usada apenas quando a ação é destrutiva
  // onCancel só roda no botão "cancelar" (fechar pelo fundo ou Esc não conta como escolha)
  function confirmSheet({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', destructive = false, onConfirm, onCancel }) {
    const body = h(`
      <div>
        ${message ? `<p class="t-callout">${esc(message)}</p>` : ''}
        <div class="sheet-actions">
          <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-primary'} btn-block" data-confirm>${esc(confirmLabel)}</button>
          <button type="button" class="btn btn-ghost is-muted btn-block" data-sheet-close>${esc(cancelLabel)}</button>
        </div>
      </div>`);
    const sheet = openSheet({ title, body, closeButton: false });
    body.querySelector('[data-sheet-close]').addEventListener('click', () => { sheet.close('cancel'); if (onCancel) onCancel(); });
    body.querySelector('[data-confirm]').addEventListener('click', () => { sheet.close('confirm'); onConfirm(); });
    return sheet;
  }

  global.UI = { openSheet, closeAllSheets, toast, segmented, toggle, stepper, sortable, actionSheet, navbarHTML, inputSheet, choiceSheet, confirmSheet };
})(window);
