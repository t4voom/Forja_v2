/* FORJA — evolução
   Tudo aqui é calculado a partir do histórico salvo — nada é digitado à mão nem inventado.
   Rotas: #/progress · history · session/<id> · records · body · goals · achievements · balance · cardio (cardio.js)
   Gráficos: SVG feito à mão (sem bibliotecas). Uma série por gráfico → uma cor (--chart), sem legenda;
   linha 2px, área 10%, ponto final com anel; barras ≤ 24px com topo arredondado; grade em linha fina.
   Todo gráfico tem tooltip (toque/mouse/teclado) e uma tabela "Ver dados". */
(function (global) {
  'use strict';
  const { U, UI, Store, Statistics } = global;
  const { esc, icon } = U;
  const DAY = 86400000;

  const PERIODS = [
    { value: '7d', label: '7 dias' },
    { value: '30d', label: '30 dias' },
    { value: '90d', label: '90 dias' },
    { value: '1y', label: '1 ano' },
    { value: 'all', label: 'Tudo' }
  ];
  const PERIOD_TEXT = { '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias', '90d': 'nos últimos 90 dias', '1y': 'no último ano', all: 'desde o início' };
  const GRAN_TEXT = { day: 'por dia', week: 'por semana', month: 'por mês' };

  // Estado da tela (lembrado enquanto o app está aberto)
  const state = { period: 'all', exercise: null, month: null, pick: null };

  const Sessions = () => global.Sessions;
  const Router = () => global.App.Router;
  const unit = () => U.currentUnit();
  const kg = (v, dec = 2) => U.fmtWeight(v, { dec });
  const num = (v, dec = 1) => U.fmtNum(U.round(U.toUnit(v), dec), dec);
  const setText = (s) => `${U.fmtWeight(s.weightKg, { dec: 2, withUnit: false })} × ${s.reps}`;

  function recordValue(e) {
    if (e.type === 'reps') return `${e.reps} reps · ${kg(e.weightKg)}`;
    if (e.type === 'volume') return U.fmtVolume(e.value);
    return kg(U.round(e.value, 1));
  }

  function renderScreen(root, params = []) {
    const [a, b] = params;
    const P = global.Plans;
    // Telas Premium: no Free mostram o que existe ali e o caminho para assinar
    if (!P.isPremium() && ['records', 'goals', 'achievements'].includes(a)) return P.renderLocked(root, 'analytics', 'Evolução');
    if (!P.isPremium() && a === 'balance') return P.renderLocked(root, 'balance', 'Evolução');
    if (a === 'history') return renderHistory(root);
    if (a === 'session' && b) return renderSession(root, b);
    if (a === 'records') return renderRecords(root);
    if (a === 'body') return renderBody(root);
    if (a === 'goals') return renderGoals(root);
    if (a === 'achievements') return renderAchievements(root);
    if (a === 'balance') return global.Balance.render(root);
    if (a === 'cardio') return global.Cardio.render(root);
    return renderOverview(root);
  }

  /* ==========================================================================
     Gráficos
     ========================================================================== */
  const Charts = (() => {
    function niceStep(range, n) {
      const raw = (range || 1) / n;
      const exp = Math.pow(10, Math.floor(Math.log10(raw)));
      const f = raw / exp;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    }
    // Barras sempre começam do zero
    function scaleZero(max, n = 3, integer = false) {
      const step = integer ? Math.max(1, Math.round(niceStep(max || 1, n))) : niceStep(max || 1, n);
      const hi = Math.max(step, Math.ceil((max || 1) / step) * step);
      const ticks = [];
      for (let v = 0; v <= hi + 1e-9; v += step) ticks.push(v);
      return { lo: 0, hi, ticks };
    }
    // Linhas (carga, peso) usam a faixa dos dados
    function scaleRange(min, max, n = 3) {
      if (max - min < 1e-9) { min -= 1; max += 1; }
      const step = niceStep(max - min, n);
      const lo = Math.floor(min / step) * step;
      const hi = Math.ceil(max / step) * step;
      const ticks = [];
      for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
      return { lo, hi, ticks };
    }

    function tipFor(el) {
      let tip = el.querySelector('.ch-tip');
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'ch-tip';
        tip.hidden = true;
        el.appendChild(tip);
      }
      return tip;
    }
    // Valor em destaque, rótulo depois (textContent: nada de HTML vindo dos dados)
    function showTip(el, tip, x, value, label) {
      const v = document.createElement('strong');
      v.textContent = value;
      const l = document.createElement('span');
      l.textContent = label;
      tip.replaceChildren(v, l);
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(el.clientWidth - w, x - w / 2))}px`;
    }

    // Toque mantém o tooltip um instante; mouse some ao sair
    function wire(el, svg, count, show, hide, pickIndex) {
      let cur = null;
      let timer = null;
      const at = (e) => { clearTimeout(timer); cur = pickIndex(e.clientX); show(cur); };
      svg.addEventListener('pointermove', at);
      svg.addEventListener('pointerdown', at);
      svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      svg.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') timer = setTimeout(hide, 1800); });
      el.tabIndex = 0;
      el.addEventListener('focus', () => { cur = cur ?? count - 1; show(cur); });
      el.addEventListener('blur', hide);
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        cur = U.clamp((cur ?? count - 1) + (e.key === 'ArrowRight' ? 1 : -1), 0, count - 1);
        show(cur);
      });
    }

    function line(el, points, { fmt, fmtAxis = fmt, height = 196, label = '' }) {
      const W = el.clientWidth || 320, H = height;
      const pl = 4, pr = 48, pt = 34, pb = 26;
      const xs = points.map((p) => +p.x);
      let x0 = Math.min(...xs), x1 = Math.max(...xs);
      if (x0 === x1) { x0 -= DAY; x1 += DAY; }
      const sc = scaleRange(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)));
      const X = (t) => pl + ((t - x0) / (x1 - x0)) * (W - pl - pr);
      const Y = (v) => pt + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - pt - pb);
      const P = points.map((p) => [X(+p.x), Y(p.y)]);
      const base = H - pb;
      const d = P.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
      const area = `${d} L${P[P.length - 1][0].toFixed(1)},${base} L${P[0][0].toFixed(1)},${base} Z`;
      const last = P[P.length - 1];
      const xl = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
      el.innerHTML = `
        <svg class="ch-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
          ${sc.ticks.map((t) => `<line class="ch-grid" x1="${pl}" x2="${W - pr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="ch-tick" x="${W - pr + 8}" y="${(Y(t) + 4).toFixed(1)}">${esc(fmtAxis(t))}</text>`).join('')}
          <path class="ch-area" d="${area}"/>
          <path class="ch-line" d="${d}"/>
          ${[...new Set(xl)].map((i, k, arr) => `<text class="ch-tick" x="${P[i][0].toFixed(1)}" y="${H - 6}" text-anchor="${arr.length > 1 && k === 0 ? 'start' : k === arr.length - 1 && arr.length > 1 ? 'end' : 'middle'}">${esc(points[i].short)}</text>`).join('')}
          <circle class="ch-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4"/>
          <line class="ch-cross" x1="0" x2="0" y1="${pt - 8}" y2="${base}" visibility="hidden"/>
          <circle class="ch-dot ch-hot" r="4" visibility="hidden"/>
        </svg>`;
      const svg = el.querySelector('svg');
      const cross = svg.querySelector('.ch-cross');
      const hot = svg.querySelector('.ch-hot');
      const tip = tipFor(el);
      const pick = (cx) => {
        const r = svg.getBoundingClientRect();
        const x = (cx - r.left) * (W / r.width);
        let bi = 0;
        P.forEach((q, i) => { if (Math.abs(q[0] - x) < Math.abs(P[bi][0] - x)) bi = i; });
        return bi;
      };
      const show = (i) => {
        const [x, y] = P[i];
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
        hot.setAttribute('cx', x); hot.setAttribute('cy', y); hot.setAttribute('visibility', 'visible');
        showTip(el, tip, x, fmt(points[i].y), points[i].tip || points[i].short);
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); hot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      wire(el, svg, P.length, show, hide, pick);
    }

    const roundedTop = (x, y, w, h) => {
      const r = Math.min(4, w / 2, h);
      const b = y + h;
      return `M${x},${b} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${b} Z`;
    };

    function bars(el, items, { fmt, fmtAxis = fmt, height = 176, label = '', integer = false }) {
      const W = el.clientWidth || 320, H = height;
      const pl = 4, pr = 48, pt = 26, pb = 26;
      const n = items.length;
      const sc = scaleZero(Math.max(0, ...items.map((b) => b.value)), 3, integer);
      const band = (W - pl - pr) / n;
      const bw = Math.max(3, Math.min(24, band * 0.62));
      const Y = (v) => pt + (1 - v / sc.hi) * (H - pt - pb);
      const base = H - pb;
      const step = Math.max(1, Math.ceil(n / 6));
      const cx = (i) => pl + i * band + band / 2;
      const lastI = n - 1;
      el.innerHTML = `
        <svg class="ch-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
          ${sc.ticks.map((t) => `<line class="ch-grid" x1="${pl}" x2="${W - pr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="ch-tick" x="${W - pr + 8}" y="${(Y(t) + 4).toFixed(1)}">${esc(fmtAxis(t))}</text>`).join('')}
          ${items.map((b, i) => {
            const h = base - Y(b.value);
            return h > 0.5 ? `<path class="ch-bar" data-i="${i}" d="${roundedTop(cx(i) - bw / 2, base - h, bw, h)}"/>` : '';
          }).join('')}
          ${items.map((b, i) => ((lastI - i) % step === 0 ? `<text class="ch-tick" x="${cx(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(b.short)}</text>` : '')).join('')}
        </svg>`;
      const svg = el.querySelector('svg');
      const tip = tipFor(el);
      const pick = (clientX) => {
        const r = svg.getBoundingClientRect();
        const x = (clientX - r.left) * (W / r.width);
        return U.clamp(Math.floor((x - pl) / band), 0, n - 1);
      };
      const show = (i) => {
        svg.querySelectorAll('.ch-bar').forEach((p) => p.classList.toggle('is-dim', Number(p.dataset.i) !== i));
        showTip(el, tip, cx(i), fmt(items[i].value), items[i].tip || items[i].short);
      };
      const hide = () => { svg.querySelectorAll('.ch-bar').forEach((p) => p.classList.remove('is-dim')); tip.hidden = true; };
      wire(el, svg, n, show, hide, pick);
    }

    // Tabela equivalente ao gráfico (acessível e sem depender do tooltip)
    const table = (rows, head) => `
      <details class="ch-table">
        <summary>Ver dados</summary>
        <table>
          <thead><tr><th>${esc(head[0])}</th><th>${esc(head[1])}</th></tr></thead>
          <tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td></tr>`).join('')}</tbody>
        </table>
      </details>`;

    return { line, bars, table };
  })();

  // Gráficos são desenhados depois que o HTML existe (precisam da largura real)
  const pendingCharts = [];
  function mountCharts(root) {
    pendingCharts.splice(0).forEach(({ slot, draw }) => {
      const el = root.querySelector(`[data-chart="${slot}"]`);
      if (el) draw(el);
    });
  }

  let resizeBound = false;
  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    let w = global.innerWidth;
    global.addEventListener('resize', U.debounce(() => {
      if (global.innerWidth === w) return;
      w = global.innerWidth;
      const cur = Router().current();
      if (cur && cur.route === 'progress') Router().refresh();
    }, 200));
  }

  /* ==========================================================================
     Visão geral
     ========================================================================== */
  const bucketLabel = (b) => (b.gran === 'day' ? U.WEEKDAYS[b.start.getDay()] : b.gran === 'week' ? U.fmtDayMonth(b.start) : U.MONTHS[b.start.getMonth()]);
  const bucketTip = (b) => (b.gran === 'day' ? U.fmtWeekdayDate(b.start)
    : b.gran === 'week' ? `Semana de ${U.fmtDayMonth(b.start)}`
    : `${U.fmtMonthYear(b.start)}`);

  function renderOverview(root) {
    bindResize();
    const all = Sessions().all();
    const period = state.period;
    const inPeriod = Statistics.filterByPeriod(all, period);
    const t = Statistics.calculateTotals(inPeriod);
    const allRecords = Statistics.groupRecords(Statistics.calculatePersonalRecords(all));
    const records = Statistics.filterByPeriod(allRecords, period, new Date(), 'date');
    const time = U.durationParts(t.durationSec);
    const bodyweight = Store.get('bodyweight');
    const cardio = global.Cardio.all();
    const streak = Statistics.streakInfo(all.concat(cardio));
    const insights = Statistics.generateInsights(all, bodyweight, new Date(), { cardio });
    const empty = all.length === 0;
    const premium = global.Plans.isPremium();

    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <h1 class="t-large-title" data-large-title>Sua evolução.</h1>
        </header>

        ${empty ? `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('chart', { size: 24 })}</div>
            <p class="empty-title">Sua evolução começa aqui</p>
            <p class="empty-text">Gráficos, recordes, sequência e conquistas aparecem depois do primeiro treino concluído.</p>
          </div>` : `

        ${streakHTML(streak)}

        ${insights.length ? `
          <section class="section">
            <p class="t-eyebrow mb-4">Insights</p>
            <ul class="insights">${insights.slice(0, 5).map(insightHTML).join('')}</ul>
          </section>` : ''}

        ${premium ? global.Balance.sectionHTML(all) : global.Plans.lockedHTML('balance')}

        <section class="section">
          <div class="filter-row" data-slot="period"></div>

          <div class="kpi-grid mt-8 ${t.count ? '' : 'metrics-empty'}">
            <div class="kpi"><p class="t-eyebrow">Treinos</p><p class="kpi-value">${U.fmtNum(t.count)}</p></div>
            <div class="kpi"><p class="t-eyebrow">Volume</p><p class="kpi-value">${U.fmtVolume(t.volume, { withUnit: false })}<small>${unit()}</small></p></div>
            <div class="kpi"><p class="t-eyebrow">Tempo</p><p class="kpi-value">${time.value}<small>${time.unit}</small></p></div>
            <div class="kpi"><p class="t-eyebrow">Recordes</p><p class="kpi-value">${U.fmtNum(records.length)}</p></div>
            <div class="kpi"><p class="t-eyebrow">Séries</p><p class="kpi-value is-small">${U.fmtNum(t.sets)}</p></div>
            <div class="kpi"><p class="t-eyebrow">Repetições</p><p class="kpi-value is-small">${U.fmtNum(t.reps)}</p></div>
          </div>
          ${!t.count ? `<p class="t-callout mt-4">Nenhum treino ${PERIOD_TEXT[period]}.</p>` : ''}
        </section>

        ${volumeSection(inPeriod, period)}
        ${frequencySection(inPeriod, period)}
        ${global.Cardio.sectionHTML(period)}
        ${premium ? loadSection(all, period) : ''}
        ${bodySection(bodyweight, period)}

        ${premium && records.length ? `
          <section class="section">
            <div class="section-head">
              <p class="t-eyebrow">Recordes recentes</p>
              <button type="button" class="text-btn" data-go="progress/records">Ver todos</button>
            </div>
            <div class="group">
              ${records.slice(0, 3).map((e) => `
                <button type="button" class="row" data-go="progress/session/${esc(e.sessionId)}">
                  <span class="record-icon">${icon('trophy', { size: 18, stroke: 1.8 })}</span>
                  <span class="row-main">
                    <span class="row-title block truncate">${esc(e.name)}</span>
                    <span class="row-sub block truncate">${U.fmtDayMonth(e.date)} · ${e.types.map((x) => Statistics.RECORD_LABEL[x]).join(' · ')}</span>
                  </span>
                  <span class="row-value num">${recordValue(e.primary)}</span>
                </button>`).join('')}
            </div>
          </section>` : ''}

        <div class="section-divider"></div>

        ${premium ? `
          ${consistencySection(all)}
          ${calendarSection()}
          ${goalsSection(all, bodyweight)}
          ${achievementsSection(all)}` : global.Plans.lockedHTML('analytics', {
            title: 'Veja sua evolução completa',
            text: 'Carga de cada exercício ao longo do tempo, recordes, calendário de consistência, metas e conquistas.'
          })}

        <section class="section">
          <div class="group has-icons">
            <button type="button" class="row" data-go="progress/history">
              <span class="row-icon">${icon('calendar', { size: 20 })}</span>
              <span class="row-main row-title">Histórico</span>
              <span class="row-value">${U.plural(all.length, 'treino', 'treinos')}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>
            <button type="button" class="row" data-go="progress/cardio">
              <span class="row-icon">${icon('heartPulse', { size: 20 })}</span>
              <span class="row-main row-title">Cardio</span>
              <span class="row-value">${U.plural(cardio.length, 'atividade', 'atividades')}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>
            <button type="button" class="row" data-go="progress/records">
              <span class="row-icon">${icon('trophy', { size: 20 })}</span>
              <span class="row-main row-title">Recordes por exercício</span>
              <span class="row-value">${premium ? U.fmtNum(allRecords.length) : global.Plans.pill()}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>
          </div>
        </section>`}
      </section>`;

    if (empty) {
      // Mesmo sem treinos, cardio, peso corporal e metas já podem ser usados
      root.querySelector('.page').insertAdjacentHTML('beforeend', `${global.Cardio.sectionHTML('all')}${bodySection(bodyweight, 'all')}${premium ? goalsSection(all, bodyweight) : ''}`);
    }

    const slot = root.querySelector('[data-slot="period"]');
    if (slot) slot.appendChild(UI.segmented(PERIODS, period, (v) => { state.period = v; setTimeout(() => Router().refresh(), 180); }, { label: 'Período' }));
    bindCalendar(root, all);
    if (!empty && premium) global.Balance.bind(root, all);
    bindCommon(root);
    bindBadges(root);
    // Largura real só existe depois que a tela entra no documento
    root.onMount = () => { mountCharts(root); bindHeatmap(root); };
  }

  function bindCommon(root) {
    root.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) return Router().go(go.dataset.go);
      if (e.target.closest('[data-pick-exercise]')) return pickExercise();
      if (e.target.closest('[data-add-weight]')) return openWeightSheet();
      if (e.target.closest('[data-new-goal]')) return openGoalForm();
      if (e.target.closest('[data-cardio-new]')) return global.Cardio.openLog();
      const goal = e.target.closest('[data-goal]');
      if (goal) return openGoalMenu(goal.dataset.goal);
    });
  }

  /* ---------- Sequência e insights ---------- */
  function streakHTML(s) {
    return `
      <section class="streak-card mt-8 ${s.days ? '' : 'is-off'}">
        <span class="streak-icon">${icon('flame', { size: 26, stroke: 1.7 })}</span>
        <span class="min-w-0">
          <span class="streak-value">${s.days}</span>
          <span class="streak-label">${s.days === 1 ? 'dia de sequência' : 'dias de sequência'}</span>
        </span>
        <span class="streak-meta">
          <span>Recorde ${U.plural(s.best, 'dia', 'dias')}</span>
          <span>${s.days ? (s.daysLeft < 2 ? `Treine ${s.daysLeft === 0 ? 'hoje' : 'até amanhã'} para manter` : `${U.plural(s.workouts, 'treino', 'treinos')} nela`) : 'Treine para começar'}</span>
        </span>
      </section>
      <p class="t-footnote mt-3 mx-1">A sequência continua enquanto você não passa mais de ${Statistics.STREAK_MAX_GAP} dias seguidos sem treinar.</p>`;
  }

  const insightHTML = (i) => `
    <li class="insight">
      <span class="insight-icon">${icon(i.icon, { size: 18, stroke: 1.8 })}</span>
      <span>${esc(i.text)}</span>
    </li>`;

  /* ---------- Volume e frequência ---------- */
  // "esta semana", "este mês", "hoje" — rótulo da barra atual
  const CURRENT_TEXT = { day: 'hoje', week: 'esta semana', month: 'este mês' };

  function volumeSection(sessions, period) {
    const buckets = Statistics.bucketize(sessions, period);
    const items = buckets.map((b) => ({ value: U.toUnit(b.volume), short: bucketLabel(b), tip: bucketTip(b) }));
    const fmt = (v) => `${U.fmtNum(Math.round(v))} ${unit()}`;
    // Um formato só para o eixo inteiro: tudo em "mil" quando a escala passa de 10 mil
    const useK = Math.max(0, ...items.map((i) => i.value)) >= 7500;
    const fmtAxis = (v) => (useK && v ? `${U.fmtNum(v / 1000, 1)} mil` : U.fmtNum(v));
    const cur = items[items.length - 1];
    const gran = buckets[0].gran;
    pendingCharts.push({ slot: 'volume', draw: (el) => Charts.bars(el, items, { fmt, fmtAxis, label: `Volume ${GRAN_TEXT[gran]}` }) });
    return `
      <section class="section">
        <div class="section-head"><p class="t-eyebrow">Volume</p><span class="t-footnote">${unit()} ${GRAN_TEXT[gran]}</span></div>
        <div class="card chart-card">
          <p class="chart-headline num">${U.fmtNum(Math.round(cur.value))}<small>${unit()}</small><span class="chart-delta">${CURRENT_TEXT[gran]}</span></p>
          <div class="chart" data-chart="volume"></div>
          ${Charts.table(buckets.map((b, i) => [bucketTip(b), fmt(items[i].value)]), ['Período', 'Volume'])}
        </div>
      </section>`;
  }

  function frequencySection(sessions, period) {
    const buckets = Statistics.bucketize(sessions, period);
    const items = buckets.map((b) => ({ value: b.count, short: bucketLabel(b), tip: bucketTip(b) }));
    const fmt = (v) => U.plural(v, 'treino', 'treinos');
    pendingCharts.push({ slot: 'freq', draw: (el) => Charts.bars(el, items, { fmt, fmtAxis: (v) => U.fmtNum(v), integer: true, label: `Treinos ${GRAN_TEXT[buckets[0].gran]}` }) });
    return `
      <section class="section">
        <div class="section-head"><p class="t-eyebrow">Frequência</p><span class="t-footnote">treinos ${GRAN_TEXT[buckets[0].gran]}</span></div>
        <div class="card chart-card">
          <p class="chart-headline num">${items[items.length - 1].value}<small>${items[items.length - 1].value === 1 ? 'treino' : 'treinos'}</small><span class="chart-delta">${CURRENT_TEXT[buckets[0].gran]}</span></p>
          <div class="chart" data-chart="freq"></div>
          ${Charts.table(buckets.map((b) => [bucketTip(b), String(b.count)]), ['Período', 'Treinos'])}
        </div>
      </section>`;
  }

  /* ---------- Carga por exercício ---------- */
  function exerciseChoices(all) {
    const count = new Map();
    all.forEach((s) => (s.exercises || []).forEach((e) => {
      if ((e.sets || []).some(Statistics.isWorkingSet)) count.set(e.exerciseId, { n: (count.get(e.exerciseId)?.n || 0) + 1, name: e.name });
    }));
    return [...count.entries()]
      .map(([id, c]) => ({ id, n: c.n, name: (global.Exercises.get(id) || {}).name || c.name }))
      .sort((a, b) => b.n - a.n);
  }

  function loadSection(all, period) {
    const choices = exerciseChoices(all);
    if (!choices.length) return '';
    if (!choices.some((c) => c.id === state.exercise)) state.exercise = choices[0].id;
    const cur = choices.find((c) => c.id === state.exercise);
    const series = Statistics.filterByPeriod(Statistics.exerciseSeries(all, state.exercise), period, new Date(), 'date');
    const fmt = (v) => `${U.fmtNum(U.round(v, 2), 2)} ${unit()}`;
    let body;
    if (series.length >= 2) {
      const points = series.map((e) => ({
        x: new Date(e.date), y: U.toUnit(e.topWeight), short: U.fmtDayMonth(e.date),
        tip: `${U.fmtDayMonth(e.date)}${e.best1RM ? ` · 1RM est. ${num(e.best1RM)} ${unit()}` : ''}`
      }));
      const first = series[0], last = series[series.length - 1];
      const delta = last.topWeight - first.topWeight;
      pendingCharts.push({ slot: 'load', draw: (el) => Charts.line(el, points, { fmt, fmtAxis: (v) => U.fmtNum(v, 1), label: `Carga máxima em ${cur.name}` }) });
      body = `
        <p class="chart-headline num">${num(last.topWeight, 2)}<small>${unit()}</small>
          ${Math.abs(delta) > 0.001 ? `<span class="chart-delta">${delta > 0 ? '+' : '−'}${num(Math.abs(delta), 2)} ${unit()} ${PERIOD_TEXT[period]}</span>` : ''}</p>
        <div class="chart" data-chart="load"></div>
        ${Charts.table(series.map((e) => [U.fmtDayMonth(e.date), `${num(e.topWeight, 2)} ${unit()}`]), ['Sessão', 'Carga máxima'])}`;
    } else {
      body = `<p class="t-callout py-6">${series.length ? 'Só uma sessão neste período.' : 'Nenhuma sessão neste período.'} O gráfico aparece a partir de 2 treinos com este exercício.</p>`;
    }
    return `
      <section class="section">
        <div class="section-head">
          <p class="t-eyebrow">Carga máxima</p>
          <button type="button" class="select-btn" data-pick-exercise>${esc(cur.name)} ${icon('chevronDown', { size: 14, stroke: 2.2 })}</button>
        </div>
        <div class="card chart-card">${body}</div>
      </section>`;
  }

  function pickExercise() {
    const choices = exerciseChoices(Sessions().all());
    UI.choiceSheet({
      title: 'Exercício',
      subtitle: 'Mostrando os que você já treinou.',
      options: choices.map((c) => ({ value: c.id, label: `${c.name}` })),
      value: state.exercise,
      onSelect: (id) => { state.exercise = id; Router().refresh(); }
    });
  }

  /* ---------- Peso corporal ---------- */
  function bodySection(bodyweight, period) {
    const list = [...(bodyweight || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const inPeriod = Statistics.filterByPeriod(list, period, new Date(), 'date');
    const last = list[list.length - 1];
    const fmt = (v) => `${U.fmtNum(U.round(v, 1), 1)} ${unit()}`;
    let chart = '';
    if (inPeriod.length >= 2) {
      const points = inPeriod.map((e) => ({ x: new Date(e.date), y: U.toUnit(e.kg), short: U.fmtDayMonth(e.date), tip: U.fmtDayMonth(e.date) }));
      pendingCharts.push({ slot: 'body', draw: (el) => Charts.line(el, points, { fmt, fmtAxis: (v) => U.fmtNum(v, 1), label: 'Peso corporal' }) });
      const delta = inPeriod[inPeriod.length - 1].kg - inPeriod[0].kg;
      chart = `
        ${Math.abs(delta) >= 0.05 ? `<p class="chart-delta mb-1">${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} ${unit()} ${PERIOD_TEXT[period]}</p>` : ''}
        <div class="chart" data-chart="body"></div>
        ${Charts.table([...inPeriod].reverse().map((e) => [U.fmtDayMonth(e.date), fmt(U.toUnit(e.kg))]), ['Data', 'Peso'])}`;
    } else if (last) {
      chart = '<p class="t-callout py-4">Registre o peso mais vezes para ver o gráfico.</p>';
    }
    return `
      <section class="section">
        <div class="section-head">
          <p class="t-eyebrow">Peso corporal</p>
          ${list.length ? `<button type="button" class="text-btn" data-go="progress/body">Histórico</button>` : ''}
        </div>
        <div class="card chart-card">
          ${last ? `<p class="chart-headline num">${num(last.kg)}<small>${unit()}</small><span class="chart-delta">em ${U.fmtDayMonth(last.date)}</span></p>` : '<p class="t-callout">Acompanhe seu peso ao longo do tempo.</p>'}
          ${chart}
          <button type="button" class="btn btn-secondary btn-sm mt-4" data-add-weight>${icon('plus', { size: 16, stroke: 2 })} Adicionar peso</button>
        </div>
      </section>`;
  }

  /* ---------- Consistência: mapa dos últimos 12 meses ---------- */
  // Cardio por dia: { 'AAAA-MM-DD': [registros] }
  function cardioByDay() {
    const map = new Map();
    global.Cardio.all().forEach((c) => { const k = U.dayKey(c.startedAt); if (!map.has(k)) map.set(k, []); map.get(k).push(c); });
    return map;
  }

  function consistencySection(all) {
    const activity = Statistics.dailyActivity(all);
    const cardio = cardioByDay();
    const end = U.startOfDay(new Date());
    const start = U.startOfWeek(U.addDays(end, -364));
    const vols = [...activity.values()].map((d) => d.volume).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p) => (vols.length ? vols[Math.min(vols.length - 1, Math.floor(p * vols.length))] : 0);
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
    const level = (d) => (!d ? 0 : d.volume <= t1 ? 1 : d.volume <= t2 ? 2 : d.volume <= t3 ? 3 : 4);
    const cols = [];
    for (let d = start; d <= end; d = U.addDays(d, 7)) cols.push(d);
    const trainedDays = [...new Set([...activity.keys(), ...cardio.keys()])].filter((k) => new Date(`${k}T12:00:00`) >= U.addDays(end, -364)).length;

    let prevMonth = -1;
    const months = cols.map((c, i) => {
      const m = U.addDays(c, 6).getMonth();
      const show = m !== prevMonth;
      prevMonth = m;
      return show && i < cols.length - 1 ? `<span style="grid-column:${i + 1}">${U.MONTHS[m]}</span>` : '';
    }).join('');

    const cells = cols.map((c) => Array.from({ length: 7 }, (_, r) => {
      const day = U.addDays(c, r);
      if (day > end) return '<span class="hm-cell is-future"></span>';
      const key = U.dayKey(day);
      const a = activity.get(key);
      const cd = cardio.get(key);
      if (!a && !cd) return '<span class="hm-cell" data-level="0"></span>';
      const parts = [U.fmtDayMonth(day)];
      if (a) parts.push(a.sessions.map((s) => s.name).join(', '), U.fmtVolume(a.volume));
      if (cd) parts.push(`${cd.map((x) => global.Cardio.labelOf(x)).join(', ')} ${U.fmtDuration(cd.reduce((n, x) => n + (x.durationSec || 0), 0))}`);
      const label = parts.join(' · ');
      return `<button type="button" class="hm-cell" data-level="${a ? level(a) : 1}" data-day="${key}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
    }).join('')).join('');

    return `
      <section class="section">
        <div class="section-head"><p class="t-eyebrow">Consistência</p><span class="t-footnote">últimos 12 meses</span></div>
        <div class="card hm-card">
          <p class="chart-headline num">${trainedDays}<small>${trainedDays === 1 ? 'dia treinado' : 'dias treinados'}</small></p>
          <div class="hm-wrap">
            <div class="hm-days" aria-hidden="true"><span>S</span><span></span><span>Q</span><span></span><span>S</span><span></span><span></span></div>
            <div class="hm-scroll" data-hm>
              <div class="hm" style="--cols:${cols.length}">
                <div class="hm-months" aria-hidden="true">${months}</div>
                <div class="hm-grid">${cells}</div>
              </div>
            </div>
          </div>
          <div class="hm-legend" aria-hidden="true">
            <span>Menos</span>${[0, 1, 2, 3, 4].map((l) => `<i class="hm-cell" data-level="${l}"></i>`).join('')}<span>Mais</span>
          </div>
          <p class="t-footnote mt-2">A cor mais forte indica mais volume no dia. Dias só de cardio ficam no tom mais claro. Toque em um dia para ver o treino.</p>
        </div>
      </section>`;
  }

  function bindHeatmap(root) {
    const scroller = root.querySelector('[data-hm]');
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;   // mais recente à direita, já visível
    scroller.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-day]');
      if (!cell) return;
      const d = new Date(`${cell.dataset.day}T12:00:00`);
      state.month = new Date(d.getFullYear(), d.getMonth(), 1);
      state.pick = cell.dataset.day;
      paintCalendar(root, Sessions().all());
      root.querySelector('[data-cal]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* ---------- Calendário ---------- */
  function calendarSection() {
    return `
      <section class="section">
        <div class="section-head"><p class="t-eyebrow">Calendário</p></div>
        <div class="card cal-card" data-cal></div>
      </section>`;
  }

  function bindCalendar(root, all) {
    const el = root.querySelector('[data-cal]');
    if (!el) return;
    paintCalendar(root, all);
    el.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-cal-nav]');
      if (nav) {
        const m = state.month;
        state.month = new Date(m.getFullYear(), m.getMonth() + Number(nav.dataset.calNav), 1);
        state.pick = null;
        return paintCalendar(root, Sessions().all());
      }
      const day = e.target.closest('[data-cal-day]');
      if (day) { state.pick = day.dataset.calDay; return paintCalendar(root, Sessions().all()); }
      const s = e.target.closest('[data-session]');
      if (s) return Router().go(`progress/session/${s.dataset.session}`);
      const c = e.target.closest('[data-cal-cardio]');
      if (c) { const entry = global.Cardio.get(c.dataset.calCardio); if (entry) global.Cardio.openLog(entry); }
    });
  }

  function paintCalendar(root, all) {
    const el = root.querySelector('[data-cal]');
    if (!el) return;
    const activity = Statistics.dailyActivity(all);
    const cardio = cardioByDay();
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (!state.month) state.month = thisMonth;
    const m = state.month;
    const lead = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7;
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const todayKey = U.dayKey(today);
    const trained = [];
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-day is-blank"></span>');
    for (let d = 1; d <= daysIn; d++) {
      const key = U.dayKey(new Date(m.getFullYear(), m.getMonth(), d));
      const a = activity.get(key);
      const c = cardio.get(key);
      if (a || c) trained.push(key);
      const names = (a ? a.sessions.map((s) => s.name) : []).concat(c ? c.map((x) => global.Cardio.labelOf(x)) : []);
      const cls = `cal-day${a || c ? ' has' : ''}${!a && c ? ' is-cardio' : ''}${key === todayKey ? ' is-today' : ''}${key === state.pick ? ' is-picked' : ''}`;
      cells.push(a || c
        ? `<button type="button" class="${cls}" data-cal-day="${key}" aria-label="${d}: ${esc(names.join(', '))}"><span class="num">${d}</span><i></i></button>`
        : `<span class="${cls}"><span class="num">${d}</span></span>`);
    }
    const picked = state.pick && (activity.get(state.pick) || cardio.get(state.pick)) ? { sessions: (activity.get(state.pick) || { sessions: [] }).sessions, cardio: cardio.get(state.pick) || [] } : null;
    el.innerHTML = `
      <div class="cal-head">
        <button type="button" class="icon-btn is-plain" data-cal-nav="-1" aria-label="Mês anterior">${icon('chevronLeft', { size: 20, stroke: 2 })}</button>
        <p class="t-headline">${U.fmtMonthYear(m)}</p>
        <button type="button" class="icon-btn is-plain" data-cal-nav="1" aria-label="Próximo mês" ${m >= thisMonth ? 'disabled' : ''}>${icon('chevronRight', { size: 20, stroke: 2 })}</button>
      </div>
      <div class="cal-grid cal-week" aria-hidden="true">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <p class="t-footnote mt-3 text-center">${U.plural(trained.length, 'dia treinado', 'dias treinados')} neste mês</p>
      ${picked ? `
        <div class="cal-detail">
          ${picked.sessions.map((s) => `
            <button type="button" class="cal-session" data-session="${esc(s.id)}" style="--tint:${esc(s.color || 'var(--accent)')}">
              <span class="t-eyebrow">${U.fmtDayMonth(s.startedAt)}</span>
              <span class="cal-session-name">${esc(s.name)}</span>
              <span class="cal-session-meta num">${U.fmtDuration(s.durationSec)} · ${U.fmtVolume(Statistics.sessionVolume(s))} · ${U.plural((s.exercises || []).length, 'exercício', 'exercícios')}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>`).join('')}
          ${picked.cardio.map((c) => `
            <button type="button" class="cal-session is-cardio" data-cal-cardio="${esc(c.id)}">
              <span class="t-eyebrow">${U.fmtDayMonth(c.startedAt)} · Cardio</span>
              <span class="cal-session-name">${esc(global.Cardio.labelOf(c))}</span>
              <span class="cal-session-meta num">${esc(global.Cardio.metaText(c))}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>`).join('')}
        </div>` : ''}`;
  }

  /* ---------- Metas ---------- */
  const GOAL_TYPES = [
    { value: 'exercise', label: 'Carga' },
    { value: 'workouts', label: 'Treinos' },
    { value: 'bodyweight', label: 'Peso' }
  ];

  function goalTitle(g) {
    if (g.type === 'exercise') return (global.Exercises.get(g.exerciseId) || {}).name || 'Exercício';
    if (g.type === 'workouts') return 'Treinos';
    return 'Peso corporal';
  }
  const goalValue = (g, v) => (g.type === 'workouts' ? U.fmtNum(v) : num(v));
  const goalUnit = (g) => (g.type === 'workouts' ? 'treinos' : unit());

  function goalCardHTML(g, ctx) {
    const st = Statistics.goalStatus(g, ctx);
    const pct = Math.round(st.pct * 100);
    return `
      <button type="button" class="card goal-card ${st.done ? 'is-done' : ''}" data-goal="${esc(g.id)}">
        <span class="goal-head">
          <span class="t-eyebrow truncate">${esc(goalTitle(g))}</span>
          ${st.done ? `<span class="goal-done">${icon('check', { size: 14, stroke: 2.6 })} Concluída</span>` : ''}
        </span>
        <span class="goal-target num">${goalValue(g, g.target)}<small>${goalUnit(g)}</small></span>
        <span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>
        <span class="goal-foot num">
          <span>${st.current == null ? '—' : goalValue(g, st.current)} / ${goalValue(g, g.target)} ${goalUnit(g)}</span>
          <span>${pct}%</span>
        </span>
      </button>`;
  }

  function goalsSection(all, bodyweight) {
    const goals = Store.get('goals');
    const ctx = { sessions: all, bodyweight };
    const open = goals.filter((g) => !Statistics.goalStatus(g, ctx).done);
    const shown = (open.length ? open : goals).slice(0, 3);
    return `
      <section class="section">
        <div class="section-head">
          <p class="t-eyebrow">Metas</p>
          ${goals.length ? `<button type="button" class="text-btn" data-go="progress/goals">${goals.length > shown.length ? 'Ver todas' : 'Gerenciar'}</button>` : ''}
        </div>
        ${goals.length ? `<div class="grid gap-3">${shown.map((g) => goalCardHTML(g, ctx)).join('')}</div>` : `
          <div class="card">
            <p class="t-callout">Defina um alvo — uma carga, um número de treinos ou um peso — e acompanhe o progresso aqui.</p>
          </div>`}
        <button type="button" class="btn btn-secondary btn-block mt-3" data-new-goal>${icon('plus', { size: 18, stroke: 2 })} Nova meta</button>
      </section>`;
  }

  function goalCurrent(type, exerciseId) {
    const ctx = { sessions: Sessions().all(), bodyweight: Store.get('bodyweight') };
    return Statistics.goalStatus({ type, exerciseId, target: 1 }, ctx).current;
  }

  function openGoalForm(goal = null) {
    const editing = !!goal;
    const draft = { type: goal ? goal.type : 'exercise', exerciseId: goal ? goal.exerciseId : null };
    const all = Sessions().all();
    const used = exerciseChoices(all);
    // Também vale para exercícios que estão em treinos, mesmo sem histórico
    global.Workouts.all().forEach((w) => w.exercises.forEach((x) => {
      if (!used.some((u) => u.id === x.exerciseId)) used.push({ id: x.exerciseId, n: 0, name: global.Exercises.resolve(x).name });
    }));
    if (!draft.exerciseId && used.length) draft.exerciseId = used[0].id;

    const body = U.h(`
      <form class="form" novalidate>
        ${editing ? '' : '<div data-slot="type"></div>'}
        <div class="mt-6" data-fields></div>
        <p class="field-error" data-err></p>
      </form>`);
    const footer = U.h(`<button type="button" class="btn btn-primary btn-block">${editing ? 'Salvar' : 'Criar meta'}</button>`);
    const sheet = UI.openSheet({ title: editing ? 'Editar meta' : 'Nova meta', body, footer });
    const err = body.querySelector('[data-err]');

    const paint = () => {
      const f = body.querySelector('[data-fields]');
      const cur = draft.type === 'exercise' ? (draft.exerciseId ? goalCurrent('exercise', draft.exerciseId) : null) : goalCurrent(draft.type);
      err.textContent = '';
      if (draft.type === 'exercise') {
        const name = draft.exerciseId ? (used.find((u) => u.id === draft.exerciseId) || { name: goalTitle({ type: 'exercise', exerciseId: draft.exerciseId }) }).name : null;
        f.innerHTML = used.length ? `
          <p class="form-label">Exercício</p>
          <button type="button" class="field select-field" data-choose ${editing ? 'disabled' : ''}>${esc(name)} ${editing ? '' : icon('chevronDown', { size: 16, stroke: 2 })}</button>
          <label class="form-label mt-5" for="goal-target">Carga alvo (${unit()})</label>
          <input id="goal-target" class="field num" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="0" value="${goal ? esc(num(goal.target, 2).replace(/\./g, '')) : ''}">
          <p class="t-footnote mt-2 mx-1">${cur ? `Sua melhor carga hoje: ${num(cur, 2)} ${unit()}.` : 'Ainda sem registros deste exercício.'}</p>`
          : '<p class="t-callout">Adicione exercícios a um treino para criar uma meta de carga.</p>';
      } else if (draft.type === 'workouts') {
        f.innerHTML = `
          <label class="form-label" for="goal-target">Total de treinos</label>
          <input id="goal-target" class="field num" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="${cur + 10}" value="${goal ? goal.target : ''}">
          <p class="t-footnote mt-2 mx-1">Você já concluiu ${U.plural(cur, 'treino', 'treinos')}.</p>`;
      } else {
        f.innerHTML = cur ? `
          <label class="form-label" for="goal-target">Peso alvo (${unit()})</label>
          <input id="goal-target" class="field num" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="0,0" value="${goal ? esc(num(goal.target).replace(/\./g, '')) : ''}">
          <p class="t-footnote mt-2 mx-1">Seu peso atual: ${num(cur)} ${unit()}.</p>`
          : `<p class="t-callout">Registre seu peso primeiro.</p>
             <button type="button" class="btn btn-secondary btn-sm mt-4" data-weight-first>${icon('plus', { size: 16, stroke: 2 })} Adicionar peso</button>`;
      }
      const input = f.querySelector('#goal-target');
      if (input) U.submitOnEnter(input, body);
      f.querySelector('[data-choose]')?.addEventListener('click', () => UI.choiceSheet({
        title: 'Exercício', options: used.map((u) => ({ value: u.id, label: u.name })), value: draft.exerciseId,
        onSelect: (id) => { draft.exerciseId = id; paint(); }
      }));
      f.querySelector('[data-weight-first]')?.addEventListener('click', () => { sheet.close(); openWeightSheet(); });
    };

    if (!editing) {
      body.querySelector('[data-slot="type"]').appendChild(UI.segmented(GOAL_TYPES, draft.type, (v) => { draft.type = v; paint(); }, { label: 'Tipo de meta' }));
    }
    paint();

    const submit = () => {
      const input = body.querySelector('#goal-target');
      if (!input) return;
      const n = U.parseDecimal(input.value);
      const fail = (m) => { err.textContent = m; body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake'); };
      const current = draft.type === 'exercise' ? goalCurrent('exercise', draft.exerciseId) : goalCurrent(draft.type);
      let target;
      if (draft.type === 'workouts') {
        if (!Number.isInteger(n) || n < 1 || n > 5000) return fail('Use um número inteiro de treinos.');
        if (!editing && n <= current) return fail(`Escolha mais do que os ${current} treinos que você já tem.`);
        target = n;
      } else if (draft.type === 'exercise') {
        if (!draft.exerciseId) return fail('Escolha um exercício.');
        if (!Number.isFinite(n) || n <= 0 || U.fromUnit(n) > 1000) return fail('Informe uma carga válida.');
        target = U.round(U.fromUnit(n), 3);
        if (!editing && current && target <= current) return fail(`Escolha uma carga acima da sua melhor (${num(current, 2)} ${unit()}).`);
      } else {
        const r = global.App.Validate.weight(input.value, unit());
        if (!r.ok) return fail(r.error);
        target = r.value;
        if (!editing && Math.abs(target - current) < 0.05) return fail('O alvo precisa ser diferente do peso atual.');
      }
      if (editing) {
        Store.update('goals', (list) => { const g = list.find((x) => x.id === goal.id); if (g) g.target = target; });
      } else {
        Store.update('goals', (list) => {
          list.push({ id: U.uid('g_'), type: draft.type, exerciseId: draft.type === 'exercise' ? draft.exerciseId : null, target, start: current || 0, createdAt: new Date().toISOString() });
        });
      }
      sheet.close('save');
      Router().refresh();
      UI.toast(editing ? 'Meta atualizada' : 'Meta criada', { iconName: 'target' });
    };
    footer.addEventListener('click', submit);
    body.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  }

  function openGoalMenu(id) {
    const g = Store.get('goals').find((x) => x.id === id);
    if (!g) return;
    UI.actionSheet({
      title: goalTitle(g),
      subtitle: `Meta: ${goalValue(g, g.target)} ${goalUnit(g)}`,
      actions: [
        { label: 'Editar alvo', icon: 'edit', onSelect: () => openGoalForm(g) },
        {
          label: 'Excluir meta', icon: 'trash', danger: true,
          onSelect: () => {
            const idx = Store.get('goals').findIndex((x) => x.id === id);
            Store.update('goals', (list) => list.filter((x) => x.id !== id));
            Router().refresh();
            UI.toast('Meta excluída', {
              iconName: 'trash', action: 'Desfazer', duration: 5000,
              onAction: () => { Store.update('goals', (list) => { list.splice(idx, 0, g); }); Router().refresh(); }
            });
          }
        }
      ]
    });
  }

  function renderGoals(root) {
    const goals = Store.get('goals');
    const ctx = { sessions: Sessions().all(), bodyweight: Store.get('bodyweight') };
    const open = goals.filter((g) => !Statistics.goalStatus(g, ctx).done);
    const done = goals.filter((g) => Statistics.goalStatus(g, ctx).done);
    root.innerHTML = `
      ${UI.navbarHTML('Metas', 'Evolução', `<button class="icon-btn" data-new-goal aria-label="Nova meta">${icon('plus', { size: 20, stroke: 2 })}</button>`)}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Metas</h1>
        ${goals.length ? `
          ${open.length ? `<p class="t-eyebrow mt-8 mb-4">Em andamento</p><div class="grid gap-3">${open.map((g) => goalCardHTML(g, ctx)).join('')}</div>` : ''}
          ${done.length ? `<p class="t-eyebrow mt-10 mb-4">Concluídas</p><div class="grid gap-3">${done.map((g) => goalCardHTML(g, ctx)).join('')}</div>` : ''}` : `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('target', { size: 24 })}</div>
            <p class="empty-title">Nenhuma meta ainda</p>
            <p class="empty-text">Uma carga, um número de treinos ou um peso. O progresso é calculado sozinho.</p>
            <button class="btn btn-primary" data-new-goal>Criar meta</button>
          </div>`}
      </section>`;
    bindCommon(root);
  }

  /* ---------- Conquistas ---------- */
  function achievements(sessions = Sessions().all()) {
    return Statistics.evaluateAchievements(sessions, { bodyweight: Store.get('bodyweight'), profile: Store.get('profile'), cardio: global.Cardio.all() });
  }

  function badgeSub(a) {
    if (a.unlocked) return U.fmtDayMonth(a.date);
    if (a.kind === 'lift') return `${num(a.current, 1)} / ${num(a.target, 0)} ${unit()}`;
    if (a.kind === 'bench-bw') return a.needsWeight ? 'Registre seu peso' : `${Math.round(a.current * 100)}% do seu peso`;
    if (a.kind === 'week') return `${a.current} / ${a.target} dias`;
    if (a.kind === 'birthday') return a.needsBirthDate ? 'Adicione no Perfil' : 'No seu aniversário';
    if (a.metric === 'volume') return `${Math.round(a.progress * 100)}%`;
    return `${U.fmtNum(Math.floor(a.current))} / ${U.fmtNum(a.target)}`;
  }

  // Conquistas que dependem de um dado ausente viram um atalho para preenchê-lo
  const badgeAction = (a) => (!a.unlocked && a.needsBirthDate ? 'birthday' : !a.unlocked && a.needsWeight ? 'weight' : '');

  function badgeHTML(a) {
    const title = a.metric === 'volume' ? U.fmtVolume(a.target) : a.title;
    const action = badgeAction(a);
    const tag = action ? 'button' : 'div';
    return `
      <${tag} ${action ? `type="button" data-ach="${action}"` : ''} class="badge-tile ${a.unlocked ? 'is-on' : ''}" title="${esc(a.desc)}" aria-label="${esc(`${title}: ${a.desc}`)}">
        <span class="badge-medal">${icon(a.icon, { size: 24, stroke: 1.7 })}</span>
        <span class="badge-title">${esc(title)}</span>
        <span class="badge-sub num">${esc(badgeSub(a))}</span>
        ${a.unlocked || action ? '' : `<span class="meter is-thin"><span style="width:${Math.round(a.progress * 100)}%"></span></span>`}
      </${tag}>`;
  }

  function bindBadges(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ach]');
      if (!b) return;
      if (b.dataset.ach === 'birthday') global.App.Profile.edit('birthDate');
      if (b.dataset.ach === 'weight') openWeightSheet();
    });
  }

  function achievementsSection(all) {
    const list = achievements(all);
    const on = list.filter((a) => a.unlocked).sort((a, b) => new Date(b.date) - new Date(a.date));
    const next = list.filter((a) => !a.unlocked).sort((a, b) => b.progress - a.progress);
    const shown = on.slice(0, 3).concat(next.slice(0, Math.max(1, 3 - Math.min(3, on.length)))).slice(0, 3);
    return `
      <section class="section">
        <div class="section-head">
          <p class="t-eyebrow">Conquistas</p>
          <button type="button" class="text-btn" data-go="progress/achievements">${on.length} de ${list.length}</button>
        </div>
        <div class="badge-grid">${shown.map(badgeHTML).join('')}</div>
      </section>`;
  }

  function renderAchievements(root) {
    const list = achievements();
    const on = list.filter((a) => a.unlocked);
    root.innerHTML = `
      ${UI.navbarHTML('Conquistas', 'Evolução')}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Conquistas</h1>
        <p class="t-sub mt-2">${on.length} de ${list.length} desbloqueadas</p>
        <div class="meter mt-4"><span style="width:${Math.round((on.length / list.length) * 100)}%"></span></div>
        ${Statistics.ACHIEVEMENT_CATEGORIES.map((c) => {
          const items = list.filter((a) => a.category === c.id);
          if (!items.length) return '';
          return `
            <p class="t-eyebrow mt-10 mb-4">${c.label} <span class="t-faint">· ${items.filter((a) => a.unlocked).length}/${items.length}</span></p>
            <div class="badge-grid">${items.map(badgeHTML).join('')}</div>`;
        }).join('')}
      </section>`;
    bindBadges(root);
  }

  // Comemoração ao salvar um treino que desbloqueou conquistas
  function celebrate(list) {
    if (!list || !list.length) return;
    const a = list[0];
    const title = a.metric === 'volume' ? U.fmtVolume(a.target) : a.title;
    const el = U.h(`
      <div class="pr-overlay is-fixed" role="alert" aria-live="assertive">
        <div class="pr-card">
          <div class="pr-icon">${icon(a.icon, { size: 34, stroke: 1.6 })}</div>
          <p class="t-eyebrow t-accent">Conquista desbloqueada</p>
          <p class="pr-title">${esc(title)}</p>
          <p class="pr-sub">${esc(a.desc)}</p>
          ${list.length > 1 ? `<p class="pr-extra">E mais ${list.length - 1}: ${list.slice(1).map((x) => esc(x.metric === 'volume' ? U.fmtVolume(x.target) : x.title)).join(' · ')}</p>` : ''}
        </div>
      </div>`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    let closed = false;
    const close = () => { if (closed) return; closed = true; el.classList.remove('is-in'); el.classList.add('is-out'); setTimeout(() => el.remove(), 320); };
    el.addEventListener('click', close);
    setTimeout(close, 3400);
  }

  /* ---------- Peso corporal: registrar, editar, histórico ---------- */
  function syncProfileWeight() {
    const latest = Statistics.latestBodyweight(Store.get('bodyweight'));
    Store.update('profile', (p) => {
      const x = p || {};
      if (latest) x.weightKg = latest.kg; else delete x.weightKg;
      return x;
    });
  }

  function openWeightSheet(entry = null) {
    const today = U.dayKey(new Date());
    const body = U.h(`
      <form class="form" novalidate>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label" for="bw-kg">Peso (${unit()})</label>
            <input id="bw-kg" class="field num" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="0,0" value="${entry ? esc(num(entry.kg).replace(/\./g, '')) : ''}">
          </div>
          <div>
            <label class="form-label" for="bw-date">Data</label>
            <input id="bw-date" class="field" type="date" max="${today}" value="${entry ? U.dayKey(entry.date) : today}">
          </div>
        </div>
        <p class="field-error" data-err></p>
        ${entry ? `<div class="group mt-2 has-icons"><button type="button" class="row is-danger" data-del><span class="row-icon">${icon('trash', { size: 20 })}</span><span class="row-main row-title">Excluir registro</span></button></div>` : ''}
      </form>`);
    const footer = U.h('<button type="button" class="btn btn-primary btn-block">Salvar</button>');
    const sheet = UI.openSheet({ title: entry ? 'Editar peso' : 'Adicionar peso', body, footer, focus: '#bw-kg' });
    const err = body.querySelector('[data-err]');
    U.submitOnEnter(body.querySelector('#bw-kg'), body);

    const save = () => {
      const r = global.App.Validate.weight(body.querySelector('#bw-kg').value, unit());
      const dv = body.querySelector('#bw-date').value;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dv) ? new Date(`${dv}T12:00:00`) : null;
      const fail = (m) => { err.textContent = m; body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake'); };
      if (!r.ok) return fail(r.error);
      if (!date || Number.isNaN(date.getTime())) return fail('Escolha uma data válida.');
      if (date > new Date()) return fail('A data não pode estar no futuro.');
      if (entry) Store.update('bodyweight', (list) => list.filter((x) => x.id !== entry.id));
      global.App.logBodyweight(r.value, date);
      syncProfileWeight();
      sheet.close('save');
      Router().refresh();
      UI.toast('Peso salvo', { iconName: 'scale' });
    };
    footer.addEventListener('click', save);
    body.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    body.querySelector('[data-del]')?.addEventListener('click', () => {
      Store.update('bodyweight', (list) => list.filter((x) => x.id !== entry.id));
      syncProfileWeight();
      sheet.close();
      Router().refresh();
      UI.toast('Registro excluído', {
        iconName: 'trash', action: 'Desfazer', duration: 5000,
        onAction: () => {
          Store.update('bodyweight', (list) => { list.push(entry); list.sort((a, b) => new Date(a.date) - new Date(b.date)); });
          syncProfileWeight();
          Router().refresh();
        }
      });
    });
  }

  function renderBody(root) {
    const list = [...Store.get('bodyweight')].sort((a, b) => new Date(b.date) - new Date(a.date));
    root.innerHTML = `
      ${UI.navbarHTML('Peso corporal', 'Evolução', `<button class="icon-btn" data-add-weight aria-label="Adicionar peso">${icon('plus', { size: 20, stroke: 2 })}</button>`)}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Peso corporal</h1>
        ${list.length ? `
          <p class="t-sub mt-2">${U.plural(list.length, 'registro', 'registros')}</p>
          <div class="group mt-8">
            ${list.map((e, i) => {
              const prev = list[i + 1];
              const d = prev ? e.kg - prev.kg : 0;
              return `
                <button type="button" class="row" data-entry="${esc(e.id)}">
                  <span class="row-main">
                    <span class="row-title block num">${num(e.kg)} ${unit()}</span>
                    <span class="row-sub block">${U.fmtWeekdayDate(e.date)}</span>
                  </span>
                  ${prev && Math.abs(d) >= 0.05 ? `<span class="row-value num">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>` : ''}
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>`;
            }).join('')}
          </div>` : `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('scale', { size: 24 })}</div>
            <p class="empty-title">Nenhum registro</p>
            <p class="empty-text">Registre seu peso para acompanhar a evolução ao longo do tempo.</p>
            <button class="btn btn-primary" data-add-weight>Adicionar peso</button>
          </div>`}
      </section>`;
    bindCommon(root);
    root.addEventListener('click', (e) => {
      const row = e.target.closest('[data-entry]');
      if (row) openWeightSheet(Store.get('bodyweight').find((x) => x.id === row.dataset.entry));
    });
  }

  /* ==========================================================================
     Histórico
     ========================================================================== */
  function renderHistory(root) {
    const all = Sessions().all();
    const cardio = global.Cardio.all();
    const prBySession = new Map();
    Statistics.groupRecords(Statistics.calculatePersonalRecords(all)).forEach((g) => prBySession.set(g.sessionId, (prBySession.get(g.sessionId) || 0) + 1));

    // Treinos e cardio na mesma linha do tempo
    const timeline = all.map((s) => ({ kind: 'session', at: s.startedAt, item: s }))
      .concat(cardio.map((c) => ({ kind: 'cardio', at: c.startedAt, item: c })))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const groups = [];
    timeline.forEach((x) => {
      const label = U.fmtMonthYear(x.at);
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
      g.items.push(x);
    });

    root.innerHTML = `
      ${UI.navbarHTML('Histórico', 'Evolução')}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Histórico</h1>
        <p class="t-sub mt-2">${U.plural(all.length, 'treino concluído', 'treinos concluídos')}${cardio.length ? ` · ${U.plural(cardio.length, 'cardio', 'cardios')}` : ''}</p>

        ${timeline.length ? groups.map((g) => `
          <section class="list-section mt-8">
            <p class="t-eyebrow group-label">${g.label}</p>
            <div class="group">
              ${g.items.map((x) => {
                if (x.kind === 'cardio') return global.Cardio.rowHTML(x.item, { tag: true });
                const s = x.item;
                const d = new Date(s.startedAt);
                const vol = Statistics.sessionVolume(s);
                const sets = Statistics.workingSets(s).length;
                const prs = prBySession.get(s.id) || 0;
                return `
                  <button type="button" class="row hist-row" data-go="progress/session/${esc(s.id)}">
                    <span class="hist-date" style="--tint:${esc(s.color || 'var(--accent)')}">
                      <span class="hist-day num">${d.getDate()}</span>
                      <span class="hist-wd">${U.WEEKDAYS[d.getDay()]}</span>
                    </span>
                    <span class="row-main">
                      <span class="row-title block truncate">${esc(s.name)}</span>
                      <span class="row-sub block num">${U.fmtDuration(s.durationSec)} · ${U.fmtVolume(vol)} · ${U.plural(sets, 'série', 'séries')}</span>
                    </span>
                    ${prs ? `<span class="pr-pill num">${icon('trophy', { size: 13, stroke: 2 })}${prs}</span>` : ''}
                    ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                  </button>`;
              }).join('')}
            </div>
          </section>`).join('') : `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('calendar', { size: 24 })}</div>
            <p class="empty-title">Nenhum treino ainda</p>
            <p class="empty-text">Cada treino concluído aparece aqui, com duração, volume e recordes.</p>
          </div>`}
      </section>`;
    bindCommon(root);
    global.Cardio.bindRows(root);
  }

  /* ==========================================================================
     Detalhe de uma sessão
     ========================================================================== */
  function renderSession(root, id) {
    const s = Sessions().get(id);
    if (!s) {
      root.innerHTML = `
        ${UI.navbarHTML('', 'Histórico')}
        <section class="page has-navbar">
          <div class="empty mt-6">
            <div class="empty-icon">${icon('calendar', { size: 24 })}</div>
            <p class="empty-title">Treino não encontrado</p>
            <p class="empty-text">Ele pode ter sido removido do histórico.</p>
            <button class="btn btn-secondary" data-back>Voltar</button>
          </div>
        </section>`;
      return;
    }

    const records = Statistics.calculatePersonalRecords(Sessions().all()).filter((e) => e.sessionId === id);
    const recByEx = new Map();
    records.forEach((e) => { if (!recByEx.has(e.exerciseId)) recByEx.set(e.exerciseId, []); recByEx.get(e.exerciseId).push(e); });
    const working = Statistics.workingSets(s);
    const t = U.durationParts(s.durationSec);
    const mood = (Sessions().MOODS.find((m) => m[0] === s.mood) || null);

    root.innerHTML = `
      ${UI.navbarHTML(s.name, 'Histórico', `
        <button class="icon-btn" data-share aria-label="Compartilhar treino">${icon('share', { size: 19, stroke: 1.9 })}</button>
        <button class="icon-btn" data-menu aria-label="Mais opções">${icon('more', { size: 20 })}</button>`)}
      <section class="page has-navbar">
        <header class="detail-head" style="--tint:${esc(s.color || 'var(--accent)')}">
          <span class="workout-swatch"></span>
          <h1 class="t-large-title mt-4" data-large-title>${esc(s.name)}</h1>
          <p class="t-sub mt-2">${U.fmtLongDate(s.startedAt)}</p>
        </header>

        <div class="summary-grid">
          <div class="summary-stat"><span class="summary-value num">${t.value}<small>${t.unit}</small></span><span class="stat-label">Duração</span></div>
          <div class="summary-stat"><span class="summary-value num">${U.fmtVolume(Statistics.sessionVolume(s), { withUnit: false })}<small>${unit()}</small></span><span class="stat-label">Volume</span></div>
          <div class="summary-stat"><span class="summary-value num">${working.length}</span><span class="stat-label">Séries</span></div>
          <div class="summary-stat"><span class="summary-value num">${working.reduce((n, x) => n + (x.reps || 0), 0)}</span><span class="stat-label">Repetições</span></div>
        </div>

        ${s.rpe || mood || s.notes ? `
          <section class="section">
            <p class="t-eyebrow mb-4">Como foi</p>
            <div class="card feel-card">
              ${s.rpe || mood ? `
                <div class="flex items-center gap-4">
                  ${mood ? `<span class="feel-mood" title="${mood[2]}">${mood[1]}</span>` : ''}
                  ${s.rpe ? `<span><span class="t-headline num">RPE ${s.rpe}</span><span class="t-callout block">${Sessions().RPE_TEXT[s.rpe]}</span></span>` : ''}
                </div>` : ''}
              ${s.notes ? `<p class="t-body ${s.rpe || mood ? 'mt-4' : ''} whitespace-pre-line">${esc(s.notes)}</p>` : ''}
            </div>
          </section>` : ''}

        <section class="section">
          <p class="t-eyebrow mb-4">Exercícios</p>
          <div class="grid gap-3">
            ${(s.exercises || []).map((ex) => {
              const ws = (ex.sets || []).filter(Statistics.isWorkingSet);
              const e1 = Math.max(0, ...ws.map(Statistics.estimated1RMForSet));
              const recs = recByEx.get(ex.exerciseId) || [];
              return `
                <article class="card sess-ex">
                  <button type="button" class="sess-ex-head" data-ex="${esc(ex.exerciseId)}">
                    <span class="min-w-0">
                      <span class="t-headline block truncate">${esc(ex.name)}</span>
                      <span class="t-footnote block">${esc(ex.muscle || '')}${ex.target ? ` · meta ${ex.target.sets} × ${ex.target.repMin === ex.target.repMax ? ex.target.repMin : `${ex.target.repMin}–${ex.target.repMax}`}` : ''}</span>
                    </span>
                    <span class="sess-ex-vol num">${U.fmtVolume(Statistics.setsVolume(ws))}</span>
                  </button>
                  <ol class="sess-sets">
                    ${(ex.sets || []).map((set, i) => {
                      const isRec = recs.some((r) => r.type !== 'volume' && r.weightKg === set.weightKg && r.reps === set.reps);
                      return `
                        <li>
                          <span class="sess-set-n num">${i + 1}</span>
                          <span class="sess-set-v num">${setText(set)}${isRec ? `<span class="pr-badge">${icon('trophy', { size: 13, stroke: 2 })}</span>` : ''}</span>
                          <span class="sess-set-vol num">${U.fmtVolume(Statistics.calculateVolume(set.weightKg, set.reps))}</span>
                        </li>`;
                    }).join('')}
                  </ol>
                  <div class="sess-ex-foot">
                    ${e1 ? `<span>1RM estimado <span class="t-body num">${kg(U.round(e1, 1), 1)}</span></span>` : '<span></span>'}
                    ${recs.length ? `<span class="t-accent">${icon('trophy', { size: 13, stroke: 2 })} ${recs.map((r) => Statistics.RECORD_LABEL[r.type]).join(' · ')}</span>` : ''}
                  </div>
                </article>`;
            }).join('')}
          </div>
        </section>
      </section>`;

    root.querySelector('[data-share]').addEventListener('click', () => global.Share.open(s));
    root.querySelector('[data-menu]').addEventListener('click', () => {
      UI.actionSheet({
        title: s.name,
        subtitle: U.fmtLongDate(s.startedAt),
        actions: [{ label: 'Compartilhar treino', icon: 'share', onSelect: () => global.Share.open(s) }, {
          label: 'Remover do histórico', icon: 'trash', danger: true,
          onSelect: () => UI.confirmSheet({
            title: 'Remover este treino?',
            message: 'Volume, recordes e estatísticas serão recalculados sem ele.',
            confirmLabel: 'Remover do histórico', destructive: true,
            onConfirm: () => Sessions().removeSession(id, () => Router().back('progress'))
          })
        }]
      });
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ex]');
      if (b) global.Exercises.openDetail(b.dataset.ex);
    });
  }

  /* ==========================================================================
     Recordes por exercício
     ========================================================================== */
  function renderRecords(root) {
    const all = Sessions().all();
    const ids = [];
    all.forEach((s) => (s.exercises || []).forEach((ex) => { if (!ids.includes(ex.exerciseId)) ids.push(ex.exerciseId); }));
    const stats = ids.map((id) => ({ id, st: Statistics.exerciseStats(all, id) })).filter((x) => x.st);
    const lastRecord = new Map();
    Statistics.calculatePersonalRecords(all).forEach((e) => { if (!lastRecord.has(e.exerciseId)) lastRecord.set(e.exerciseId, e); });

    root.innerHTML = `
      ${UI.navbarHTML('Recordes', 'Evolução')}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Recordes</h1>
        <p class="t-sub mt-2">Seus melhores números em cada exercício.</p>

        ${stats.length ? `
          <div class="grid gap-3 mt-8">
            ${stats.map(({ id, st }) => {
              // Nome atual da biblioteca; se o exercício foi excluído, o nome salvo no treino
              const saved = () => {
                const ss = all.find((x) => x.id === st.last.sessionId);
                const e = ss && ss.exercises.find((x) => x.exerciseId === id);
                return e ? e.name : 'Exercício';
              };
              const name = (global.Exercises.get(id) || {}).name || saved();
              const rec = lastRecord.get(id);
              return `
                <button type="button" class="card record-card" data-ex="${esc(id)}">
                  <span class="flex items-start justify-between gap-3">
                    <span class="min-w-0">
                      <span class="t-headline block truncate">${esc(name)}</span>
                      <span class="t-footnote block">${U.plural(st.sessions, 'sessão', 'sessões')}${rec ? ` · último recorde ${U.fmtDayMonth(rec.date)}` : ''}</span>
                    </span>
                    ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron mt-1' })}
                  </span>
                  <span class="stat-label mt-5 block">Maior carga</span>
                  <span class="record-main num">${kg(st.heaviest.weightKg)}<small>× ${st.heaviest.reps}</small></span>
                  <span class="record-grid">
                    <span><span class="stat-label">1RM estimado</span><span class="num">${st.best1RM ? kg(U.round(st.best1RM.value, 1), 1) : '—'}</span></span>
                    <span><span class="stat-label">Melhor série</span><span class="num">${setText(st.bestSet)}</span></span>
                    <span><span class="stat-label">Maior volume</span><span class="num">${U.fmtVolume(st.maxVolume.volume)}</span></span>
                  </span>
                </button>`;
            }).join('')}
          </div>` : `
          <div class="empty mt-8">
            <div class="empty-icon">${icon('trophy', { size: 24 })}</div>
            <p class="empty-title">Nenhum recorde ainda</p>
            <p class="empty-text">Recordes aparecem quando você supera um treino anterior do mesmo exercício.</p>
          </div>`}
      </section>`;

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ex]');
      if (b) global.Exercises.openDetail(b.dataset.ex);
    });
  }

  // Peças dos gráficos, reaproveitadas pela tela de cardio
  const kit = { Charts, PERIODS, PERIOD_TEXT, GRAN_TEXT, CURRENT_TEXT, bucketLabel, bucketTip };

  global.Progress = { renderScreen, celebrate, achievements, openWeightSheet, openGoalForm, kit };
})(window);
