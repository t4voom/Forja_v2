/* FORJA — cardio
   · Esteira, bike, corrida, natação... ficam em Store 'cardio', separados dos treinos de musculação:
     volume, recordes, 1RM, equilíbrio muscular e o Coach continuam contando só as séries.
   · Registro: { id, activity, name?, startedAt, durationSec, distanceKm|null, kcal|null, rpe|null, notes, createdAt, updatedAt }
     (name só na atividade "Outro"; distância sempre em km, mesmo quando digitada em metros)
   · Calorias: o valor do aparelho ou do relógio, quando digitado. Sem ele, uma ESTIMATIVA pelo tipo de
     atividade, pelo ritmo (ou pelo esforço) e pelo peso corporal: MET × kg × horas. Estimativa sempre com "≈".
   · Dias de cardio contam na sequência e no calendário.
   Rotas: #/progress/cardio (a tela entra pelo Progress.renderScreen) */
(function (global) {
  'use strict';
  const { U, UI, Store, Statistics } = global;
  const { esc, icon } = U;
  const Router = () => global.App.Router;
  const Kit = () => global.Progress.kit;

  /* ---------- Atividades ----------
     met: [leve, moderado, intenso] — Compendium of Physical Activities. Usado quando não há ritmo.
     speed: tabela por velocidade (quando há distância). input: unidade em que a distância é digitada. */
  const ACTIVITIES = [
    { id: 'esteira', label: 'Esteira', distance: true, pace: 'km', speed: 'foot', met: [3.5, 5, 9] },
    { id: 'corrida', label: 'Corrida', distance: true, pace: 'km', speed: 'run', met: [7, 9.8, 11.8] },
    { id: 'caminhada', label: 'Caminhada', distance: true, pace: 'km', speed: 'walk', met: [2.8, 3.5, 5] },
    { id: 'bike', label: 'Bike ergométrica', distance: true, pace: 'kmh', met: [3.5, 6.8, 8.8] },
    { id: 'pedal', label: 'Pedal', distance: true, pace: 'kmh', speed: 'cycle', met: [4, 6.8, 10] },
    { id: 'eliptico', label: 'Elíptico', distance: true, pace: 'kmh', met: [4, 5, 7] },
    { id: 'escada', label: 'Escada', distance: false, met: [5, 7, 9] },
    { id: 'remo', label: 'Remo', distance: true, pace: '500m', input: 'm', met: [4.8, 7, 8.5] },
    { id: 'natacao', label: 'Natação', distance: true, pace: '100m', input: 'm', met: [5.8, 8.3, 9.8] },
    { id: 'corda', label: 'Pular corda', distance: false, met: [8.8, 11.8, 12.3] },
    { id: 'aula', label: 'Aula', hint: 'Spinning, dança, jump…', distance: false, met: [5, 7.3, 8.5] },
    { id: 'outro', label: 'Outro', distance: true, pace: 'kmh', met: [3.5, 5, 7] }
  ];
  const BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
  const activity = (id) => BY_ID[id] || BY_ID.outro;
  const labelOf = (e) => (e.activity === 'outro' && e.name ? e.name : activity(e.activity).label);

  // Velocidade máxima aceita por tipo (pega erro de digitação: 50 km em vez de 5,0)
  const MAX_KMH = { km: 30, kmh: 80, '500m': 30, '100m': 12 };

  /* ---------- Dados ---------- */
  const byDateDesc = (a, b) => new Date(b.startedAt) - new Date(a.startedAt);
  const all = () => [...Store.get('cardio')].sort(byDateDesc);
  const get = (id) => Store.get('cardio').find((x) => x.id === id) || null;

  /* ---------- Ritmo, distância e calorias ---------- */
  const speedKmh = (e) => (e.distanceKm > 0 && e.durationSec > 0 ? e.distanceKm / (e.durationSec / 3600) : null);
  const mmss = (sec) => { sec = Math.round(sec); return `${Math.floor(sec / 60)}:${U.pad(sec % 60)}`; };
  // Segundos por km (menor é melhor) — base do "melhor ritmo"
  const secPerKm = (e) => (e.distanceKm > 0 && e.durationSec > 0 ? e.durationSec / e.distanceKm : null);

  function paceText(e) {
    const a = activity(e.activity);
    const s = a.distance ? secPerKm(e) : null;
    if (!s) return '';
    if (a.pace === 'km') return `${mmss(s)}/km`;
    if (a.pace === '500m') return `${mmss(s / 2)}/500 m`;
    if (a.pace === '100m') return `${mmss(s / 10)}/100 m`;
    return `${U.fmtNum(speedKmh(e), 1)} km/h`;
  }

  function distanceText(km, act) {
    if (!(km > 0)) return '';
    if (act && activity(act).input === 'm' && km < 10) return `${U.fmtNum(Math.round(km * 1000))} m`;
    return `${U.fmtNum(km, km < 100 ? 2 : 1)} km`;
  }

  // MET por velocidade (km/h → MET), com interpolação entre os pontos do Compendium
  const WALK = [[3.2, 2.0], [4.0, 2.8], [4.8, 3.0], [5.6, 3.5], [6.4, 4.3], [7.2, 5.0], [8.0, 7.0]];
  const RUN = [[6.4, 6.0], [8.0, 8.3], [9.7, 9.8], [11.3, 11.0], [12.9, 11.8], [14.5, 12.8], [16.1, 14.5], [17.7, 16.0], [19.3, 19.0]];
  const CYCLE = [[16, 4.0], [19.2, 6.8], [22.4, 8.0], [25.6, 10.0], [30.6, 12.0], [32.2, 15.8]];
  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      const [x1, y1] = table[i];
      if (x <= x1) { const [x0, y0] = table[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    }
    return table[table.length - 1][1];
  }

  function metFor(e) {
    const a = activity(e.activity);
    const v = a.distance ? speedKmh(e) : null;
    if (v && a.speed === 'foot') return v >= 7.5 ? interp(RUN, v) : interp(WALK, v);
    if (v && a.speed === 'run') return v < 6.4 ? interp(WALK, v) : interp(RUN, v);
    if (v && a.speed === 'walk') return v > 7.5 ? interp(RUN, v) : interp(WALK, v);
    if (v && a.speed === 'cycle') return interp(CYCLE, v);
    const level = e.rpe == null ? 1 : e.rpe <= 4 ? 0 : e.rpe <= 7 ? 1 : 2;
    return a.met[level];
  }

  function estimateKcal(e) {
    const kg = Statistics.bodyweightAt(e.startedAt, Store.get('bodyweight'), Store.get('profile'));
    if (!kg || !(e.durationSec > 0)) return null;
    return Math.max(5, Math.round((metFor(e) * kg * (e.durationSec / 3600)) / 5) * 5);
  }

  // { value, estimated } ou null (sem calorias digitadas e sem peso para estimar)
  function kcalOf(e) {
    if (e.kcal > 0) return { value: e.kcal, estimated: false };
    const v = estimateKcal(e);
    return v ? { value: v, estimated: true } : null;
  }
  const kcalText = (k) => (k ? `${k.estimated ? '≈ ' : ''}${U.fmtNum(k.value)} kcal` : '');

  function metaText(e) {
    return [U.fmtDuration(e.durationSec), distanceText(e.distanceKm, e.activity), paceText(e), kcalText(kcalOf(e))].filter(Boolean).join(' · ');
  }

  function summarize(list) {
    const out = { count: list.length, durationSec: 0, distanceKm: 0, kcal: 0, withKcal: 0, estimated: false };
    list.forEach((e) => {
      out.durationSec += e.durationSec || 0;
      out.distanceKm += e.distanceKm || 0;
      const k = kcalOf(e);
      if (k) { out.kcal += k.value; out.withKcal++; if (k.estimated) out.estimated = true; }
    });
    return out;
  }

  // Semana atual (segunda a domingo)
  function weekSummary(ref = new Date()) {
    const start = U.startOfWeek(ref).getTime();
    return summarize(all().filter((e) => { const t = new Date(e.startedAt).getTime(); return t >= start && t < start + 7 * 86400000; }));
  }

  /* ---------- Melhores marcas (de todo o histórico) ----------
     Por atividade: maior distância, melhor ritmo (a partir de 1 km; natação e remo, de 200 m) e mais tempo. */
  function bests(list = all()) {
    const groups = new Map();
    list.forEach((e) => {
      const key = e.activity === 'outro' ? `outro:${U.normalize(e.name || '')}` : e.activity;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    return [...groups.values()]
      .sort((a, b) => b.length - a.length)
      .map((items) => {
        const a = activity(items[0].activity);
        const marks = [];
        const maxBy = (arr, fn) => arr.reduce((best, x) => (fn(x) > fn(best) ? x : best));
        const withDist = a.distance ? items.filter((e) => e.distanceKm > 0) : [];
        if (withDist.length) {
          const far = maxBy(withDist, (e) => e.distanceKm);
          marks.push({ type: 'distance', label: 'Maior distância', value: distanceText(far.distanceKm, far.activity), entry: far });
          const minKm = a.input === 'm' ? 0.2 : 1;
          const eligible = withDist.filter((e) => e.distanceKm >= minKm);
          if (eligible.length) {
            const fast = maxBy(eligible, (e) => -secPerKm(e));
            marks.push({ type: 'pace', label: a.pace === 'kmh' ? 'Maior velocidade' : 'Melhor ritmo', value: paceText(fast), entry: fast });
          }
        }
        const long = maxBy(items, (e) => e.durationSec || 0);
        marks.push({ type: 'time', label: 'Mais tempo', value: U.fmtDuration(long.durationSec), entry: long });
        return { label: labelOf(items[0]), count: items.length, marks };
      });
  }

  /* ---------- Registrar / editar ---------- */
  const RPE_HINT = 'Opcional. De 1 (muito leve) a 10 (esforço máximo).';
  const timeValue = (d) => `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  const inputNumber = (v, dec = 2) => (v == null ? '' : U.fmtNum(U.round(v, dec), dec).replace(/\./g, ''));

  function lastActivity() {
    const last = all()[0];
    return last ? last.activity : 'esteira';
  }

  function openLog(entry = null) {
    const editing = !!entry;
    const draft = {
      activity: entry ? entry.activity : lastActivity(),
      rpe: entry ? entry.rpe ?? null : null,
      timeTouched: editing
    };
    const start = entry ? new Date(entry.startedAt) : new Date(Date.now() - 30 * 60000);
    const today = U.dayKey(new Date());
    const body = U.h(`
      <form class="form cardio-form" novalidate>
        <p class="form-label">Atividade</p>
        <div class="chips" role="radiogroup" aria-label="Atividade">
          ${ACTIVITIES.map((a) => `<button type="button" class="chip is-choice" role="radio" aria-checked="${a.id === draft.activity}" data-act="${a.id}">${esc(a.label)}</button>`).join('')}
        </div>
        <p class="t-footnote mt-2 mx-1" data-act-hint></p>
        <div data-name-wrap hidden>
          <label class="form-label mt-5" for="cd-name">Qual atividade?</label>
          <input id="cd-name" class="field" autocomplete="off" maxlength="30" placeholder="Ex.: Trilha, futebol, boxe" value="${esc(entry && entry.name ? entry.name : '')}">
        </div>

        <div class="grid grid-cols-2 gap-3 mt-6">
          <div>
            <label class="form-label" for="cd-min">Duração (min)</label>
            <input id="cd-min" class="field num" inputmode="decimal" autocomplete="off" maxlength="5" placeholder="30" value="${entry ? inputNumber(entry.durationSec / 60, 1) : ''}">
          </div>
          <div data-dist-wrap>
            <label class="form-label" for="cd-dist" data-dist-label>Distância (km)</label>
            <input id="cd-dist" class="field num" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="Opcional">
          </div>
        </div>
        <p class="cardio-live num" data-live aria-live="polite"></p>

        <label class="form-label mt-5" for="cd-kcal">Calorias (kcal)</label>
        <input id="cd-kcal" class="field num" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="Opcional" value="${entry && entry.kcal ? entry.kcal : ''}">
        <p class="t-footnote mt-2 mx-1" data-kcal-hint></p>

        <p class="form-label mt-6">Esforço (RPE)</p>
        <div class="rpe-scale" role="radiogroup" aria-label="Esforço de 1 a 10">
          ${Array.from({ length: 10 }, (_, k) => k + 1).map((n) => `<button type="button" role="radio" class="num" aria-checked="${draft.rpe === n}" data-rpe="${n}">${n}</button>`).join('')}
        </div>
        <p class="t-footnote mt-2 mx-1" data-rpe-caption></p>

        <div class="grid grid-cols-2 gap-3 mt-6">
          <div>
            <label class="form-label" for="cd-date">Data</label>
            <input id="cd-date" class="field" type="date" max="${today}" value="${U.dayKey(start)}">
          </div>
          <div>
            <label class="form-label" for="cd-time">Início</label>
            <input id="cd-time" class="field" type="time" value="${timeValue(start)}">
          </div>
        </div>

        <label class="form-label mt-5" for="cd-notes">Observações</label>
        <textarea id="cd-notes" class="field field-area" rows="2" maxlength="300" placeholder="Opcional">${esc(entry ? entry.notes || '' : '')}</textarea>

        <p class="field-error" data-err></p>
        ${editing ? `<div class="group mt-2 has-icons"><button type="button" class="row is-danger" data-del><span class="row-icon">${icon('trash', { size: 20 })}</span><span class="row-main row-title">Excluir registro</span></button></div>` : ''}
      </form>`);
    const footer = U.h('<button type="button" class="btn btn-primary btn-block">Salvar</button>');
    const sheet = UI.openSheet({ title: editing ? 'Editar cardio' : 'Registrar cardio', body, footer, tall: true });
    const $ = (sel) => body.querySelector(sel);
    const err = $('[data-err]');
    const fields = { min: $('#cd-min'), dist: $('#cd-dist'), kcal: $('#cd-kcal'), date: $('#cd-date'), time: $('#cd-time'), name: $('#cd-name'), notes: $('#cd-notes') };
    const act = () => activity(draft.activity);

    // Distância digitada na unidade da atividade (m para natação e remo)
    const distFactor = () => (act().input === 'm' ? 1000 : 1);
    if (entry && entry.distanceKm) fields.dist.value = inputNumber(entry.distanceKm * distFactor(), act().input === 'm' ? 0 : 2);

    function read() {
      const minutes = U.parseDecimal(fields.min.value);
      const distRaw = fields.dist.value.trim();
      const dist = distRaw ? U.parseDecimal(distRaw) : null;
      const kcalRaw = fields.kcal.value.trim();
      return { minutes, dist, distRaw, kcal: kcalRaw ? U.parseDecimal(kcalRaw) : null, kcalRaw };
    }

    // Uma prévia do registro para mostrar ritmo e calorias enquanto você digita
    function previewEntry() {
      const r = read();
      const [y, mo, d] = (fields.date.value || today).split('-').map(Number);
      const [hh, mm] = (fields.time.value || '12:00').split(':').map(Number);
      return {
        activity: draft.activity, rpe: draft.rpe,
        startedAt: new Date(y, mo - 1, d, hh, mm).toISOString(),
        durationSec: Number.isFinite(r.minutes) && r.minutes > 0 ? r.minutes * 60 : 0,
        distanceKm: act().distance && Number.isFinite(r.dist) && r.dist > 0 ? r.dist / distFactor() : null
      };
    }

    function paintLive() {
      const e = previewEntry();
      const pace = paceText(e);
      const est = estimateKcal(e);
      $('[data-live]').textContent = [pace && (act().pace === 'kmh' ? `Velocidade ${pace}` : `Ritmo ${pace}`), pace && act().pace === 'km' ? `${U.fmtNum(speedKmh(e), 1)} km/h` : ''].filter(Boolean).join(' · ');
      fields.kcal.placeholder = est ? `≈ ${U.fmtNum(est)}` : 'Opcional';
      const hasWeight = !!Statistics.bodyweightAt(e.startedAt, Store.get('bodyweight'), Store.get('profile'));
      $('[data-kcal-hint]').textContent = hasWeight
        ? 'Se o aparelho ou o relógio mostrar as calorias, digite o valor dele. Sem isso, o FORJA estima pelo tipo de atividade, pelo ritmo ou esforço e pelo seu peso.'
        : 'Opcional. Registre seu peso no Perfil para o FORJA estimar as calorias.';
    }

    function paintActivity() {
      const a = act();
      body.querySelectorAll('[data-act]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.act === a.id)));
      $('[data-act-hint]').textContent = a.hint || '';
      $('[data-act-hint]').hidden = !a.hint;
      $('[data-name-wrap]').hidden = a.id !== 'outro';
      $('[data-dist-wrap]').hidden = !a.distance;
      $('[data-dist-label]').textContent = a.input === 'm' ? 'Distância (m)' : 'Distância (km)';
      fields.dist.placeholder = a.input === 'm' ? 'Ex.: 1500' : 'Opcional';
      paintLive();
    }

    function paintRpe() {
      body.querySelectorAll('[data-rpe]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.rpe) === draft.rpe)));
      $('[data-rpe-caption]').textContent = draft.rpe ? `${draft.rpe} · ${global.Sessions.RPE_TEXT[draft.rpe]}` : RPE_HINT;
    }

    // Registro feito logo depois do cardio: o início acompanha a duração (até você mexer na hora)
    function syncStart() {
      if (draft.timeTouched || fields.date.value !== today) return;
      const m = U.parseDecimal(fields.min.value);
      if (!Number.isFinite(m) || m <= 0 || m > 600) return;
      const s = new Date(Date.now() - m * 60000);
      if (U.dayKey(s) !== today) return;
      fields.time.value = timeValue(s);
    }

    body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a) {
        const before = distFactor();
        draft.activity = a.dataset.act;
        // Troca entre km e metros: converte o que já foi digitado
        const d = U.parseDecimal(fields.dist.value);
        if (Number.isFinite(d) && before !== distFactor()) fields.dist.value = inputNumber((d / before) * distFactor(), distFactor() === 1000 ? 0 : 2);
        return paintActivity();
      }
      const r = e.target.closest('[data-rpe]');
      if (r) { const n = Number(r.dataset.rpe); draft.rpe = draft.rpe === n ? null : n; paintRpe(); return paintLive(); }
    });
    fields.min.addEventListener('input', () => { syncStart(); paintLive(); });
    fields.dist.addEventListener('input', paintLive);
    fields.date.addEventListener('input', paintLive);
    fields.time.addEventListener('input', () => { draft.timeTouched = true; paintLive(); });
    [fields.min, fields.dist, fields.kcal].forEach((i) => U.submitOnEnter(i, body));
    paintActivity();
    paintRpe();

    const fail = (m, field) => {
      err.textContent = m;
      body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
      if (field) field.focus();
    };

    const save = () => {
      const a = act();
      const r = read();
      if (!Number.isFinite(r.minutes) || r.minutes < 1 || r.minutes > 600) return fail('Informe a duração em minutos, de 1 a 600.', fields.min);
      let distanceKm = null;
      if (a.distance && r.distRaw) {
        const max = a.input === 'm' ? 100000 : 500;
        if (!Number.isFinite(r.dist) || r.dist <= 0 || r.dist > max) return fail(a.input === 'm' ? 'Informe a distância em metros, como 1500.' : 'Informe a distância em km, como 5 ou 5,2.', fields.dist);
        distanceKm = U.round(r.dist / distFactor(), 3);
        const kmh = distanceKm / (r.minutes / 60);
        if (kmh > MAX_KMH[a.pace]) return fail(`Confira a distância e o tempo: ${U.fmtNum(kmh, 1)} km/h é rápido demais para ${a.label.toLowerCase()}.`, fields.dist);
      }
      let kcal = null;
      if (r.kcalRaw) {
        if (!Number.isInteger(r.kcal) || r.kcal < 1 || r.kcal > 5000) return fail('Informe as calorias como número inteiro, de 1 a 5000.', fields.kcal);
        kcal = r.kcal;
      }
      const dv = fields.date.value, tv = fields.time.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dv)) return fail('Escolha a data.', fields.date);
      if (!/^\d{2}:\d{2}$/.test(tv)) return fail('Escolha a hora de início.', fields.time);
      const [y, mo, d] = dv.split('-').map(Number);
      const [hh, mm] = tv.split(':').map(Number);
      const startedAt = new Date(y, mo - 1, d, hh, mm);
      if (Number.isNaN(startedAt.getTime())) return fail('Escolha uma data válida.', fields.date);
      if (startedAt.getTime() > Date.now() + 60000) return fail('O início não pode estar no futuro.', fields.time);

      const stamp = new Date().toISOString();
      const next = {
        id: entry ? entry.id : U.uid('cd_'),
        activity: a.id,
        name: a.id === 'outro' ? String(fields.name.value || '').trim().replace(/\s+/g, ' ').slice(0, 30) : '',
        startedAt: startedAt.toISOString(),
        durationSec: Math.round(r.minutes * 60),
        distanceKm,
        kcal,
        rpe: draft.rpe,
        notes: String(fields.notes.value || '').trim().slice(0, 300),
        createdAt: entry ? entry.createdAt || stamp : stamp,
        updatedAt: stamp
      };
      Store.update('cardio', (list) => {
        const i = list.findIndex((x) => x.id === next.id);
        if (i >= 0) list[i] = next; else list.push(next);
      });
      U.haptic('success');
      sheet.close('save');
      Router().refresh();
      UI.toast(editing ? 'Cardio atualizado' : `Cardio salvo · ${labelOf(next)} · ${U.fmtDuration(next.durationSec)}`, { iconName: 'heartPulse' });
    };
    footer.addEventListener('click', save);
    body.addEventListener('submit', (e) => { e.preventDefault(); save(); });

    $('[data-del]')?.addEventListener('click', () => {
      const removed = get(entry.id);
      Store.update('cardio', (list) => list.filter((x) => x.id !== entry.id));
      sheet.close();
      Router().refresh();
      UI.toast('Cardio excluído', {
        iconName: 'trash', action: 'Desfazer', duration: 6000,
        onAction: () => { if (removed) { Store.update('cardio', (list) => { list.push(removed); }); Router().refresh(); } }
      });
    });
    return sheet;
  }

  /* ---------- Linha do histórico (tela de cardio e histórico geral) ----------
     tag: mostra "Cardio" ao lado do nome (no histórico geral, que mistura com a musculação) */
  function rowHTML(e, { tag = false } = {}) {
    const d = new Date(e.startedAt);
    return `
      <button type="button" class="row hist-row" data-cardio="${esc(e.id)}">
        <span class="hist-date is-cardio">
          <span class="hist-day num">${d.getDate()}</span>
          <span class="hist-wd">${U.WEEKDAYS[d.getDay()]}</span>
        </span>
        <span class="row-main">
          <span class="row-title block truncate">${esc(labelOf(e))}${tag ? `<span class="cardio-kind">${icon('heartPulse', { size: 13, stroke: 2 })}Cardio</span>` : ''}</span>
          <span class="row-sub block num">${esc(metaText(e))}</span>
        </span>
        ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
      </button>`;
  }

  // Qualquer tela com linhas de cardio: tocar abre a edição
  function bindRows(root) {
    root.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-cardio]');
      if (!row) return;
      const e = get(row.dataset.cardio);
      if (e) openLog(e);
    });
  }

  /* ---------- Tela: #/progress/cardio ---------- */
  const state = { period: 'all' };

  function render(root) {
    const K = Kit();
    const list = all();
    const inPeriod = Statistics.filterByPeriod(list, state.period);
    const t = summarize(inPeriod);
    const time = U.durationParts(t.durationSec);
    const marks = bests(list).slice(0, 4);

    // Tempo por atividade no período
    const byAct = new Map();
    inPeriod.forEach((e) => {
      const k = labelOf(e);
      const cur = byAct.get(k) || { label: k, count: 0, durationSec: 0, distanceKm: 0, activity: e.activity };
      cur.count++; cur.durationSec += e.durationSec || 0; cur.distanceKm += e.distanceKm || 0;
      byAct.set(k, cur);
    });
    const acts = [...byAct.values()].sort((a, b) => b.durationSec - a.durationSec);
    const maxDur = Math.max(1, ...acts.map((a) => a.durationSec));

    const groups = [];
    list.forEach((e) => {
      const label = U.fmtMonthYear(e.startedAt);
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
      g.items.push(e);
    });

    let chartHTML = '';
    if (inPeriod.length) {
      const buckets = Statistics.bucketize(inPeriod, state.period);
      const gran = buckets[0].gran;
      const items = buckets.map((b) => ({ value: Math.round(b.durationSec / 60), short: K.bucketLabel(b), tip: K.bucketTip(b) }));
      const fmt = (v) => `${U.fmtNum(v)} min`;
      const cur = items[items.length - 1];
      root.onMount = () => {
        const el = root.querySelector('[data-chart="cardio"]');
        if (el) K.Charts.bars(el, items, { fmt, fmtAxis: (v) => U.fmtNum(v), integer: true, label: `Minutos de cardio ${K.GRAN_TEXT[gran]}` });
      };
      chartHTML = `
        <section class="section">
          <div class="section-head"><p class="t-eyebrow">Tempo</p><span class="t-footnote">minutos ${K.GRAN_TEXT[gran]}</span></div>
          <div class="card chart-card">
            <p class="chart-headline num">${U.fmtNum(cur.value)}<small>min</small><span class="chart-delta">${K.CURRENT_TEXT[gran]}</span></p>
            <div class="chart" data-chart="cardio"></div>
            ${K.Charts.table(buckets.map((b, i) => [K.bucketTip(b), fmt(items[i].value)]), ['Período', 'Minutos'])}
          </div>
        </section>`;
    }

    root.innerHTML = `
      ${UI.navbarHTML('Cardio', 'Evolução', `<button class="icon-btn" data-cardio-new aria-label="Registrar cardio">${icon('plus', { size: 20, stroke: 2 })}</button>`)}
      <section class="page has-navbar">
        <h1 class="t-large-title mt-2" data-large-title>Cardio</h1>
        <p class="t-sub mt-2">${list.length ? U.plural(list.length, 'atividade registrada', 'atividades registradas') : 'Esteira, bike, corrida, natação e mais.'}</p>

        ${list.length ? `
          <button type="button" class="btn btn-primary btn-block mt-8" data-cardio-new>${icon('plus', { size: 18, stroke: 2.2 })} Registrar cardio</button>

          <section class="section">
            <div class="filter-row" data-slot="period"></div>
            <div class="kpi-grid mt-8 ${t.count ? '' : 'metrics-empty'}">
              <div class="kpi"><p class="t-eyebrow">Atividades</p><p class="kpi-value">${U.fmtNum(t.count)}</p></div>
              <div class="kpi"><p class="t-eyebrow">Tempo</p><p class="kpi-value">${time.value}<small>${time.unit}</small></p></div>
              <div class="kpi"><p class="t-eyebrow">Distância</p><p class="kpi-value">${U.fmtNum(t.distanceKm, t.distanceKm < 100 ? 1 : 0)}<small>km</small></p></div>
              <div class="kpi"><p class="t-eyebrow">Calorias</p><p class="kpi-value">${t.withKcal ? `${t.estimated ? '<span class="kpi-approx">≈</span>' : ''}${U.fmtNum(t.kcal)}` : '—'}<small>kcal</small></p></div>
            </div>
            ${!t.count ? `<p class="t-callout mt-4">Nenhum cardio ${K.PERIOD_TEXT[state.period]}.</p>`
              : t.estimated ? '<p class="t-footnote mt-5 mx-1">≈ inclui calorias estimadas pelo tipo de atividade, pelo ritmo ou esforço e pelo seu peso. Não é uma medida exata.</p>' : ''}
          </section>

          ${chartHTML}

          ${acts.length ? `
            <section class="section">
              <div class="section-head"><p class="t-eyebrow">Por atividade</p><span class="t-footnote">${K.PERIOD_TEXT[state.period]}</span></div>
              <div class="group">
                ${acts.map((a) => `
                  <div class="row cardio-act">
                    <span class="row-main">
                      <span class="cardio-act-top"><span class="row-title truncate">${esc(a.label)}</span><span class="row-value num">${U.fmtDuration(a.durationSec)}</span></span>
                      <span class="row-sub block num">${U.plural(a.count, 'vez', 'vezes')}${a.distanceKm > 0 ? ` · ${distanceText(a.distanceKm, a.activity)}` : ''}</span>
                      <span class="meter is-thin mt-2" aria-hidden="true"><span style="width:${Math.max(2, Math.round((a.durationSec / maxDur) * 100))}%"></span></span>
                    </span>
                  </div>`).join('')}
              </div>
            </section>` : ''}

          ${marks.length ? `
            <section class="section">
              <div class="section-head"><p class="t-eyebrow">Melhores marcas</p><span class="t-footnote">desde o início</span></div>
              <div class="cardio-bests">
                ${marks.map((g) => `
                  <article class="card cardio-best">
                    <p class="cardio-best-name">${esc(g.label)} <span class="t-footnote">${U.plural(g.count, 'vez', 'vezes')}</span></p>
                    <dl class="cardio-best-list">
                      ${g.marks.map((m) => `<div><dt>${esc(m.label)}</dt><dd class="num">${esc(m.value)}</dd><dd class="cardio-best-date">${U.fmtDayMonth(m.entry.startedAt)}</dd></div>`).join('')}
                    </dl>
                  </article>`).join('')}
              </div>
            </section>` : ''}

          ${groups.map((g) => `
            <section class="list-section mt-10">
              <p class="t-eyebrow group-label">${g.label}</p>
              <div class="group">${g.items.map((e) => rowHTML(e)).join('')}</div>
            </section>`).join('')}` : `
          <div class="empty mt-8">
            <div class="empty-icon is-cardio">${icon('heartPulse', { size: 26 })}</div>
            <p class="empty-title">Nenhum cardio ainda</p>
            <p class="empty-text">Registre esteira, bike, corrida, natação ou uma aula. O FORJA mostra seu tempo, distância, ritmo e calorias.</p>
            <button type="button" class="btn btn-primary" data-cardio-new>Registrar cardio</button>
          </div>`}
      </section>`;

    const slot = root.querySelector('[data-slot="period"]');
    if (slot) slot.appendChild(UI.segmented(K.PERIODS, state.period, (v) => { state.period = v; setTimeout(() => Router().refresh(), 180); }, { label: 'Período' }));
    root.querySelectorAll('[data-cardio-new]').forEach((b) => b.addEventListener('click', () => openLog()));
    bindRows(root);
  }

  /* ---------- Resumo na Evolução (acompanha o período escolhido lá) ---------- */
  const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function sectionHTML(period) {
    const K = Kit();
    const list = all();
    if (!list.length) {
      return `
        <section class="section">
          <div class="section-head"><p class="t-eyebrow">Cardio</p></div>
          <div class="nudge">
            <span class="nudge-icon is-cardio">${icon('heartPulse', { size: 20, stroke: 1.8 })}</span>
            <span class="min-w-0 flex-1">
              <span class="row-title block">Faz cardio?</span>
              <span class="row-sub block">Registre esteira, bike, corrida, natação ou aulas.</span>
            </span>
            <span class="nudge-actions"><button type="button" class="btn btn-secondary btn-sm" data-cardio-new>Registrar</button></span>
          </div>
        </section>`;
    }
    const t = summarize(Statistics.filterByPeriod(list, period));
    const time = U.durationParts(t.durationSec);
    return `
      <section class="section">
        <div class="section-head">
          <p class="t-eyebrow">Cardio</p>
          <button type="button" class="text-btn" data-go="progress/cardio">Ver tudo</button>
        </div>
        <div class="card cardio-card">
          <button type="button" class="cardio-card-main" data-go="progress/cardio" aria-label="Ver cardio">
            <span class="cardio-card-period">${esc(capitalize(K.PERIOD_TEXT[period]))}</span>
            <span class="chart-headline num">${time.value}<small>${time.unit}</small></span>
            <span class="cardio-card-facts num">${[U.plural(t.count, 'atividade', 'atividades'), t.distanceKm > 0 ? `${U.fmtNum(t.distanceKm, 1)} km` : '', t.withKcal ? `${t.estimated ? '≈ ' : ''}${U.fmtNum(t.kcal)} kcal` : ''].filter(Boolean).join(' · ')}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-cardio-new>${icon('plus', { size: 16, stroke: 2.2 })} Registrar</button>
        </div>
      </section>`;
  }

  /* ---------- Home: cardio da semana ---------- */
  function homeHTML() {
    const w = weekSummary();
    const facts = w.count ? [U.plural(w.count, 'atividade', 'atividades'), U.fmtDuration(w.durationSec), w.distanceKm > 0 ? `${U.fmtNum(w.distanceKm, 1)} km` : ''].filter(Boolean).join(' · ') : 'Esteira, bike, corrida…';
    return `
      <div class="nudge cardio-home mt-6">
        <button type="button" class="cardio-home-main" data-go="progress/cardio" aria-label="Ver cardio">
          <span class="nudge-icon is-cardio">${icon('heartPulse', { size: 20, stroke: 1.8 })}</span>
          <span class="min-w-0 flex-1">
            <span class="row-title block">Cardio${w.count ? ' esta semana' : ''}</span>
            <span class="row-sub block num">${esc(facts)}</span>
          </span>
        </button>
        <span class="nudge-actions"><button type="button" class="btn btn-secondary btn-sm" data-cardio-new>Registrar</button></span>
      </div>`;
  }

  global.Cardio = {
    ACTIVITIES, activity, labelOf,
    all, get, summarize, weekSummary, bests,
    speedKmh, paceText, distanceText, metFor, estimateKcal, kcalOf, kcalText, metaText,
    openLog, rowHTML, bindRows, render, sectionHTML, homeHTML
  };
})(window);
