/* FORJA — equilíbrio muscular
   · Conta séries de trabalho por grupo muscular a partir do histórico (nada é digitado).
   · Músculos que ajudam no movimento contam meia série (ex.: supino → tríceps e ombros 0,5).
   · Compara com faixas semanais de referência e entre pares opostos (peito × costas,
     quadríceps × posterior, bíceps × tríceps, empurrar × puxar, superior × inferior).
   Rotas: seção na Evolução · #/progress/balance (detalhe) */
(function (global) {
  'use strict';
  const { U, UI, Store, Statistics } = global;
  const { esc, icon } = U;
  const DAY = 86400000;
  const Router = () => global.App.Router;

  const MUSCLES = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Quadríceps', 'Posterior', 'Glúteos', 'Panturrilha', 'Abdômen'];

  // Faixa de séries semanais que costuma dar resultado para quem treina hipertrofia
  const TARGETS = {
    'Peito': [10, 20], 'Costas': [10, 20], 'Ombros': [8, 16], 'Bíceps': [6, 14], 'Tríceps': [6, 14],
    'Quadríceps': [10, 18], 'Posterior': [6, 14], 'Glúteos': [6, 14], 'Panturrilha': [6, 12], 'Abdômen': [4, 12]
  };

  // Músculos secundários por padrão de movimento (meia série cada)
  const SECONDARY = {
    'press-horizontal': ['Tríceps', 'Ombros'], 'press-inclinado': ['Ombros', 'Tríceps'], 'press-declinado': ['Tríceps'],
    'press-vertical': ['Tríceps'], 'close-press': ['Peito'], 'dip': ['Peito'],
    'pulldown': ['Bíceps'], 'row': ['Bíceps', 'Ombros'],
    'squat': ['Glúteos'], 'leg-press': ['Glúteos'], 'lunge': ['Glúteos'],
    'hinge': ['Posterior', 'Glúteos'], 'hip-thrust': ['Posterior']
  };

  // Pares opostos. A comparação é relativa à faixa de cada lado: posterior precisa de menos séries que quadríceps.
  const PAIRS = [
    { a: ['Peito'], b: ['Costas'], name: ['Peito', 'Costas'] },
    { a: ['Quadríceps'], b: ['Posterior'], name: ['Quadríceps', 'Posterior'] },
    { a: ['Bíceps'], b: ['Tríceps'], name: ['Bíceps', 'Tríceps'] },
    { a: ['Peito', 'Ombros', 'Tríceps'], b: ['Costas', 'Bíceps'], name: ['Empurrar', 'Puxar'], group: true },
    { a: ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps'], b: ['Quadríceps', 'Posterior', 'Glúteos', 'Panturrilha'], name: ['Superiores', 'Pernas'], group: true }
  ];
  const SUBJECT = {
    'Peito': 'Peito está', 'Costas': 'Costas estão', 'Quadríceps': 'Quadríceps está', 'Posterior': 'Posterior está',
    'Bíceps': 'Bíceps está', 'Tríceps': 'Tríceps está', 'Empurrar': 'Exercícios de empurrar estão', 'Puxar': 'Exercícios de puxar estão',
    'Superiores': 'Membros superiores estão', 'Pernas': 'Pernas estão'
  };
  const OBJECT = {
    'Peito': 'do peito', 'Costas': 'das costas', 'Quadríceps': 'do quadríceps', 'Posterior': 'do posterior',
    'Bíceps': 'do bíceps', 'Tríceps': 'do tríceps', 'Empurrar': 'dos de empurrar', 'Puxar': 'dos de puxar',
    'Superiores': 'dos membros superiores', 'Pernas': 'das pernas'
  };

  const PERIODS = [{ value: '7d', label: 'Últimos 7 dias' }, { value: '4w', label: 'Média de 4 semanas' }];
  const state = { period: '7d', focus: null };

  /* ==========================================================================
     Cálculo
     ========================================================================== */
  function patternOf(exerciseId) {
    const ex = global.Exercises && global.Exercises.get(exerciseId);
    return ex ? ex.pattern : null;
  }

  // { Peito: 12, Costas: 9.5, ... } — séries por semana no período
  function weeklySets(sessions = global.Sessions.all(), period = state.period, ref = new Date()) {
    const days = period === '4w' ? 28 : 7;
    const from = ref.getTime() - days * DAY;
    const out = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
    sessions.forEach((s) => {
      const t = new Date(s.startedAt).getTime();
      if (t < from || t > ref.getTime()) return;
      (s.exercises || []).forEach((ex) => {
        const n = (ex.sets || []).filter(Statistics.isWorkingSet).length;
        if (!n) return;
        const info = global.Exercises ? global.Exercises.resolve(ex) : ex;
        const muscle = info.muscle || ex.muscle;
        if (muscle in out) out[muscle] += n;
        (SECONDARY[patternOf(ex.exerciseId)] || []).forEach((m) => { if (m !== muscle && m in out) out[m] += n * 0.5; });
      });
    });
    const weeks = days / 7;
    MUSCLES.forEach((m) => { out[m] = Math.round((out[m] / weeks) * 2) / 2; });
    return out;
  }

  // 'none' · 'low' · 'ok' · 'high'
  function status(m, sets) {
    const [lo, hi] = TARGETS[m];
    if (!sets) return 'none';
    if (sets < lo) return 'low';
    if (sets > hi) return 'high';
    return 'ok';
  }
  // Intensidade 0–4 para colorir o mapa
  function level(m, sets) {
    const [lo, hi] = TARGETS[m];
    if (!sets) return 0;
    if (sets < lo / 2) return 1;
    if (sets < lo) return 2;
    if (sets <= hi) return 3;
    return 4;
  }

  const sum = (sets, list) => list.reduce((n, m) => n + (sets[m] || 0), 0);
  const fmtSets = (n) => U.fmtNum(n, 1);
  const setsText = (n) => `${fmtSets(n)} ${n === 1 ? 'série' : 'séries'}`;

  // Sugestões: exercícios que você já fez desse grupo primeiro, depois os mais comuns da biblioteca
  function suggestions(muscle, n = 2) {
    const used = new Map();
    global.Sessions.all().forEach((s) => (s.exercises || []).forEach((e) => {
      const info = global.Exercises.resolve(e);
      if (info.muscle === muscle) used.set(e.exerciseId, (used.get(e.exerciseId) || 0) + 1);
    }));
    const lib = global.Exercises.all().filter((e) => e.muscle === muscle);
    const ranked = [...lib].sort((a, b) => (used.get(b.id) || 0) - (used.get(a.id) || 0) || a.rank - b.rank);
    return ranked.slice(0, n).map((e) => e.name);
  }

  const joinNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} ou ${list[list.length - 1]}` : list[0] || '');

  // Alertas em ordem de importância
  function alerts(sets) {
    const total = sum(sets, MUSCLES);
    if (total < 6) return [];
    const out = [];

    PAIRS.forEach((p) => {
      const ref = (list) => list.reduce((n, m) => n + TARGETS[m][0], 0);
      const rawA = sum(sets, p.a), rawB = sum(sets, p.b);
      const na = rawA / ref(p.a), nb = rawB / ref(p.b);
      const hi = Math.max(na, nb), lo = Math.min(na, nb);
      if (Math.max(rawA, rawB) < 4 || lo >= hi * 0.6) return;
      // Lado fraco já dentro da faixa recomendada: diferença sem importância prática
      if (lo >= 1) return;
      const lowIsA = na < nb;
      const lowName = p.name[lowIsA ? 0 : 1], highName = p.name[lowIsA ? 1 : 0];
      const lowMuscles = lowIsA ? p.a : p.b;
      const rawLo = lowIsA ? rawA : rawB, rawHi = lowIsA ? rawB : rawA;
      const pct = Math.round((1 - lo / hi) * 100);
      // Músculo que mais precisa, dentro do lado fraco
      const target = lowMuscles.reduce((w, m) => (sets[m] / TARGETS[m][0] < sets[w] / TARGETS[w][0] ? m : w), lowMuscles[0]);
      // Séries que faltam para o lado fraco chegar a ~80% do forte (proporcional à faixa)
      const gap = Math.max(2, Math.ceil(hi * 0.8 * ref(lowMuscles) - rawLo));
      out.push({
        kind: 'pair', severity: pct + (p.group ? 0 : 15), muscle: target,
        title: rawLo === 0 ? `${lowName} sem séries, ${highName.toLowerCase()} com ${setsText(rawHi)}` : `${SUBJECT[lowName]} ${pct}% abaixo ${OBJECT[highName]}`,
        text: `${lowName}: ${setsText(rawLo)} · ${highName}: ${setsText(rawHi)}${state.period === '4w' ? ' por semana' : ''}. Acrescente cerca de ${gap} séries de ${target.toLowerCase()} (${joinNames(suggestions(target))}).`
      });
    });

    MUSCLES.forEach((m) => {
      const v = sets[m], [lo, hi] = TARGETS[m];
      if (v === 0 && total >= 20) {
        out.push({ kind: 'none', severity: 40, muscle: m, title: `${m} sem séries ${state.period === '4w' ? 'nas últimas 4 semanas' : 'nos últimos 7 dias'}`, text: `A faixa recomendada é de ${lo} a ${hi} séries por semana. Experimente ${joinNames(suggestions(m))}.` });
      } else if (v > hi * 1.15) {
        out.push({ kind: 'high', severity: 20, muscle: m, title: `${m} passou de ${hi} séries por semana`, text: `Acima disso o ganho extra costuma ser pequeno e a recuperação sofre. Se sentir o grupo cansado, corte algumas séries.` });
      }
    });

    // Um aviso por músculo, o mais grave
    const seen = new Set();
    return out.sort((a, b) => b.severity - a.severity).filter((a) => (seen.has(a.muscle) ? false : seen.add(a.muscle)));
  }

  // Para a Home: só o alerta mais importante dos últimos 7 dias
  function topAlert(sessions) {
    const prev = state.period;
    state.period = '7d';
    const a = alerts(weeklySets(sessions, '7d'))[0] || null;
    state.period = prev;
    return a && a.kind !== 'high' ? a : null;
  }

  /* ==========================================================================
     Mapa do corpo (SVG desenhado à mão; frente e costas)
     ========================================================================== */
  // Cada região: [músculo | null (neutra), forma SVG]
  const FRONT = [
    [null, '<circle cx="60" cy="20" r="12"/>'],
    [null, '<path d="M53 30h14v9H53z"/>'],
    [null, '<path d="M38 50c4-8 14-11 22-11s18 3 22 11l-2 38c-1 10-5 17-7 26H47c-2-9-6-16-7-26z"/>'],
    ['Ombros', '<path d="M40 45c-9 1-15 8-15 17 0 3 1 5 3 6 3-6 8-10 14-12z"/><path d="M80 45c9 1 15 8 15 17 0 3-1 5-3 6-3-6-8-10-14-12z"/>'],
    ['Peito', '<path d="M59 49c-8-3-15-1-18 4-2 5-1 12 3 16 5 4 12 4 15 0z"/><path d="M61 49c8-3 15-1 18 4 2 5 1 12-3 16-5 4-12 4-15 0z"/>'],
    ['Abdômen', '<rect x="50" y="74" width="20" height="40" rx="7"/>'],
    ['Bíceps', '<path d="M28 70c-3 7-4 15-2 22 3 3 7 2 9-1 2-7 2-15 0-22-2-2-5-2-7 1z"/><path d="M92 70c3 7 4 15 2 22-3 3-7 2-9-1-2-7-2-15 0-22 2-2 5-2 7 1z"/>'],
    [null, '<path d="M25 97c-2 9-4 18-4 26 2 3 6 3 7 0 2-8 5-16 6-25-3-3-6-3-9-1z"/><path d="M95 97c2 9 4 18 4 26-2 3-6 3-7 0-2-8-5-16-6-25 3-3 6-3 9-1z"/>'],
    [null, '<path d="M46 114h28l2 12H44z"/>'],
    ['Quadríceps', '<path d="M44 124c-3 14-4 30-2 46 2 5 10 5 14 1 3-15 3-31 1-45-4-4-9-5-13-2z"/><path d="M76 124c3 14 4 30 2 46-2 5-10 5-14 1-3-15-3-31-1-45 4-4 9-5 13-2z"/>'],
    [null, '<path d="M44 178c-2 12-2 26 0 38 2 3 7 3 9 0 2-12 2-26 0-38-3-2-6-2-9 0z"/><path d="M76 178c2 12 2 26 0 38-2 3-7 3-9 0-2-12-2-26 0-38 3-2 6-2 9 0z"/>'],
    [null, '<path d="M42 219h12v6H40z"/><path d="M78 219H66v6h14z"/>']
  ];
  const BACK = [
    [null, '<circle cx="60" cy="20" r="12"/>'],
    [null, '<path d="M53 30h14v9H53z"/>'],
    [null, '<path d="M38 50c4-8 14-11 22-11s18 3 22 11l-2 38c-1 10-5 17-7 26H47c-2-9-6-16-7-26z"/>'],
    ['Ombros', '<path d="M40 45c-9 1-15 8-15 17 0 3 1 5 3 6 3-6 8-10 14-12z"/><path d="M80 45c9 1 15 8 15 17 0 3-1 5-3 6-3-6-8-10-14-12z"/>'],
    ['Costas', '<path d="M60 40c-6 0-13 3-17 8l3 8c5 1 10 4 14 9 4-5 9-8 14-9l3-8c-4-5-11-8-17-8z"/><path d="M44 58c-2 12 0 24 6 33 4 3 8 3 10 1V68c-4-5-10-9-16-10z"/><path d="M76 58c2 12 0 24-6 33-4 3-8 3-10 1V68c4-5 10-9 16-10z"/><path d="M52 96c2 5 5 12 8 18 3-6 6-13 8-18-5 2-11 2-16 0z"/>'],
    ['Tríceps', '<path d="M28 70c-3 7-4 15-2 22 3 3 7 2 9-1 2-7 2-15 0-22-2-2-5-2-7 1z"/><path d="M92 70c3 7 4 15 2 22-3 3-7 2-9-1-2-7-2-15 0-22 2-2 5-2 7 1z"/>'],
    [null, '<path d="M25 97c-2 9-4 18-4 26 2 3 6 3 7 0 2-8 5-16 6-25-3-3-6-3-9-1z"/><path d="M95 97c2 9 4 18 4 26-2 3-6 3-7 0-2-8-5-16-6-25 3-3 6-3 9-1z"/>'],
    ['Glúteos', '<path d="M59 114c-6-2-13-1-16 4-2 6-1 13 4 16 5 2 10 1 12-3z"/><path d="M61 114c6-2 13-1 16 4 2 6 1 13-4 16-5 2-10 1-12-3z"/>'],
    ['Posterior', '<path d="M44 136c-2 11-2 23 0 34 2 5 10 5 13 1 2-11 2-23 0-33-4-4-9-5-13-2z"/><path d="M76 136c2 11 2 23 0 34-2 5-10 5-13 1-2-11-2-23 0-33 4-4 9-5 13-2z"/>'],
    ['Panturrilha', '<path d="M43 178c-3 9-3 20 0 30 3 4 8 4 10 0 2-10 2-21 0-30-3-3-7-3-10 0z"/><path d="M77 178c3 9 3 20 0 30-3 4-8 4-10 0-2-10-2-21 0-30 3-3 7-3 10 0z"/>'],
    [null, '<path d="M45 210c-1 3-1 6 0 9h8c1-3 1-6 0-9z"/><path d="M75 210c1 3 1 6 0 9h-8c-1-3-1-6 0-9z"/>'],
    [null, '<path d="M42 219h12v6H40z"/><path d="M78 219H66v6h14z"/>']
  ];

  function figure(parts, sets, label) {
    return `
      <figure class="bm-fig">
        <svg viewBox="16 4 88 226" role="img" aria-label="${esc(label)}">
          ${parts.map(([m, shape]) => (m
            ? `<g class="bm-m" data-muscle="${esc(m)}" data-level="${level(m, sets[m])}" ${state.focus === m ? 'data-focus' : ''} tabindex="0" role="button" aria-label="${esc(m)}: ${setsText(sets[m])}">${shape}</g>`
            : `<g class="bm-n">${shape}</g>`)).join('')}
        </svg>
        <figcaption>${esc(label)}</figcaption>
      </figure>`;
  }

  function mapHTML(sets) {
    return `
      <div class="bm-map">
        ${figure(FRONT, sets, 'Frente')}
        ${figure(BACK, sets, 'Costas')}
      </div>
      <div class="bm-legend" aria-hidden="true">
        <span><i data-level="0"></i>Sem séries</span>
        <span><i data-level="2"></i>Abaixo</span>
        <span><i data-level="3"></i>Na faixa</span>
        <span><i data-level="4"></i>Acima</span>
      </div>`;
  }

  const STATUS_TEXT = { none: 'Sem séries', low: 'Abaixo', ok: 'Na faixa', high: 'Acima' };

  function focusHTML(sets) {
    const m = state.focus;
    if (!m) return '<p class="bm-focus t-footnote">Toque em um músculo para ver os detalhes.</p>';
    const [lo, hi] = TARGETS[m];
    return `
      <p class="bm-focus"><strong>${esc(m)}</strong> · ${setsText(sets[m])}${state.period === '4w' ? ' por semana' : ''}
        <span class="bm-pill" data-status="${status(m, sets[m])}">${STATUS_TEXT[status(m, sets[m])]}</span>
        <span class="t-footnote block mt-1">Faixa recomendada: ${lo} a ${hi} séries por semana</span></p>`;
  }

  // Linha por músculo: barra com a faixa ideal marcada
  function rowsHTML(sets) {
    const scale = Math.max(22, ...MUSCLES.map((m) => sets[m]));
    return `
      <ul class="bm-rows">
        ${MUSCLES.map((m) => {
          const [lo, hi] = TARGETS[m];
          const st = status(m, sets[m]);
          return `
          <li class="bm-row" data-muscle-row="${esc(m)}">
            <span class="bm-row-head">
              <span class="row-title">${esc(m)}</span>
              <span class="bm-row-val num"><strong>${fmtSets(sets[m])}</strong> <span class="t-faint">/ ${lo}–${hi}</span></span>
            </span>
            <span class="bm-bar" data-status="${st}">
              <span class="bm-band" style="left:${(lo / scale) * 100}%;width:${((hi - lo) / scale) * 100}%"></span>
              <span class="bm-fill" style="width:${Math.min(100, (sets[m] / scale) * 100)}%"></span>
            </span>
          </li>`;
        }).join('')}
      </ul>`;
  }

  function alertHTML(a) {
    return `
      <li class="bm-alert" data-kind="${a.kind}">
        <span class="bm-alert-icon">${icon(a.kind === 'high' ? 'info' : 'balance', { size: 18, stroke: 1.8 })}</span>
        <span class="min-w-0">
          <span class="bm-alert-title block">${esc(a.title)}</span>
          <span class="row-sub block mt-1">${esc(a.text)}</span>
        </span>
      </li>`;
  }

  /* ==========================================================================
     Telas
     ========================================================================== */
  // Seção compacta na Evolução
  function sectionHTML(sessions) {
    if (!sessions.length) return '';
    const sets = weeklySets(sessions);
    const list = alerts(sets);
    const ok = MUSCLES.filter((m) => status(m, sets[m]) === 'ok').length;
    return `
      <section class="section" data-balance>
        <div class="section-head">
          <p class="t-eyebrow">Equilíbrio muscular</p>
          <button type="button" class="text-btn" data-go="progress/balance">Detalhes</button>
        </div>
        <div class="card bm-card">
          <div class="bm-period" data-slot="bm-period"></div>
          <p class="chart-headline num mt-6">${ok}<small>de ${MUSCLES.length}</small><span class="chart-delta">grupos na faixa ideal</span></p>
          ${mapHTML(sets)}
          <div data-bm-focus>${focusHTML(sets)}</div>
          ${list.length ? `<ul class="bm-alerts mt-6">${list.slice(0, 2).map(alertHTML).join('')}</ul>` : '<p class="t-callout mt-6">Tudo equilibrado. Continue assim.</p>'}
        </div>
      </section>`;
  }

  function bind(root, sessions) {
    const sec = root.querySelector('[data-balance]') || root;
    const slot = sec.querySelector('[data-slot="bm-period"]');
    if (slot) slot.appendChild(UI.segmented(PERIODS, state.period, (v) => { state.period = v; setTimeout(() => Router().refresh(), 180); }, { label: 'Período' }));
    const pick = (g) => {
      state.focus = state.focus === g.dataset.muscle ? null : g.dataset.muscle;
      const sets = weeklySets(sessions);
      sec.querySelectorAll('.bm-m').forEach((x) => x.toggleAttribute('data-focus', x.dataset.muscle === state.focus));
      const f = sec.querySelector('[data-bm-focus]');
      if (f) f.innerHTML = focusHTML(sets);
      sec.querySelectorAll('[data-muscle-row]').forEach((r) => r.classList.toggle('is-focus', r.dataset.muscleRow === state.focus));
      U.haptic('tap');
    };
    sec.querySelectorAll('.bm-m').forEach((g) => {
      g.addEventListener('click', () => pick(g));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g); } });
    });
  }

  function render(root) {
    const sessions = global.Sessions.all();
    const sets = weeklySets(sessions);
    const list = alerts(sets);
    root.innerHTML = `
      ${UI.navbarHTML('Equilíbrio', 'Evolução')}
      <section class="page has-navbar" data-balance>
        <header>
          <h1 class="t-large-title" data-large-title>Equilíbrio muscular</h1>
          <p class="t-sub mt-2">Séries por grupo muscular, comparadas com a faixa que costuma dar resultado.</p>
        </header>
        ${sessions.length ? `
          <div class="bm-period mt-8" data-slot="bm-period"></div>
          <div class="card bm-card mt-6">
            ${mapHTML(sets)}
            <div data-bm-focus>${focusHTML(sets)}</div>
          </div>

          <section class="section">
            <p class="t-eyebrow group-label">${list.length ? 'O que ajustar' : 'Tudo certo'}</p>
            ${list.length ? `<ul class="bm-alerts">${list.map(alertHTML).join('')}</ul>` : '<p class="t-callout mx-1">Nenhum desequilíbrio relevante neste período.</p>'}
          </section>

          <section class="section">
            <p class="t-eyebrow group-label">Séries por semana</p>
            <div class="card">${rowsHTML(sets)}</div>
            <p class="t-footnote group-note">Contam as séries concluídas, sem aquecimento. Músculos que ajudam no movimento contam meia série: no supino, por exemplo, tríceps e ombros recebem 0,5 cada. A faixa marcada é uma referência para hipertrofia; iniciantes crescem bem perto do mínimo.</p>
          </section>` : `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('balance', { size: 24 })}</div>
            <p class="empty-title">Ainda sem dados</p>
            <p class="empty-text">Depois do primeiro treino, o mapa mostra quais músculos você está treinando mais e menos.</p>
          </div>`}
      </section>`;
    bind(root, sessions);
  }

  global.Balance = { MUSCLES, TARGETS, weeklySets, alerts, topAlert, status, sectionHTML, bind, render };
})(window);
