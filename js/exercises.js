/* FORJA — biblioteca de exercícios
   · Biblioteca base (fixa, ids estáveis para o histórico) + exercícios personalizados (Store 'exercises').
   · Personalizados excluídos viram "deleted": saem da biblioteca, mas treinos e histórico continuam resolvendo o nome.
   · Favoritos: Store 'favorites' (lista de ids). */
(function (global) {
  'use strict';
  const { U, UI, Store } = global;
  const { esc, icon } = U;

  const MUSCLES = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Quadríceps', 'Posterior', 'Glúteos', 'Panturrilha', 'Abdômen'];
  const EQUIPMENT = ['Barra', 'Halteres', 'Máquina', 'Cabo', 'Smith', 'Peso corporal', 'Kettlebell', 'Outro'];

  /* ---------- Biblioteca base ----------
     [nome, equipamento, padrão de movimento]. O id vem do nome e nunca muda (o histórico depende dele).
     O padrão de movimento é o que permite sugerir substitutos: mesmo movimento > movimento parecido > mesmo músculo. */
  const BASE = {
    'Peito': [
      ['Supino reto', 'Barra', 'press-horizontal'], ['Supino inclinado', 'Barra', 'press-inclinado'], ['Supino declinado', 'Barra', 'press-declinado'],
      ['Supino reto com halteres', 'Halteres', 'press-horizontal'], ['Supino inclinado com halteres', 'Halteres', 'press-inclinado'],
      ['Supino na máquina', 'Máquina', 'press-horizontal'], ['Supino inclinado na máquina', 'Máquina', 'press-inclinado'],
      ['Supino inclinado no Smith', 'Smith', 'press-inclinado'],
      ['Crucifixo com halteres', 'Halteres', 'fly'], ['Crucifixo inclinado', 'Halteres', 'fly-inclinado'], ['Crossover', 'Cabo', 'fly'],
      ['Crossover polia baixa', 'Cabo', 'fly-inclinado'], ['Peck deck', 'Máquina', 'fly'], ['Flexão de braço', 'Peso corporal', 'press-horizontal']
    ],
    'Costas': [
      ['Barra fixa', 'Peso corporal', 'pulldown'], ['Puxada frontal', 'Cabo', 'pulldown'], ['Puxada supinada', 'Cabo', 'pulldown'],
      ['Puxada com triângulo', 'Cabo', 'pulldown'], ['Puxada na máquina', 'Máquina', 'pulldown'],
      ['Remada curvada', 'Barra', 'row'], ['Remada unilateral', 'Halteres', 'row'], ['Remada baixa', 'Cabo', 'row'], ['Remada cavalinho', 'Barra', 'row'],
      ['Remada na máquina', 'Máquina', 'row'], ['Pulldown com braços estendidos', 'Cabo', 'pullover'], ['Levantamento terra', 'Barra', 'hinge'],
      ['Hiperextensão lombar', 'Peso corporal', 'back-extension']
    ],
    'Ombros': [
      ['Desenvolvimento com barra', 'Barra', 'press-vertical'], ['Desenvolvimento com halteres', 'Halteres', 'press-vertical'],
      ['Desenvolvimento na máquina', 'Máquina', 'press-vertical'], ['Desenvolvimento Arnold', 'Halteres', 'press-vertical'],
      ['Elevação lateral', 'Halteres', 'lateral-raise'], ['Elevação lateral no cabo', 'Cabo', 'lateral-raise'],
      ['Elevação lateral na máquina', 'Máquina', 'lateral-raise'], ['Elevação frontal', 'Halteres', 'front-raise'],
      ['Crucifixo inverso', 'Halteres', 'rear-delt'], ['Face pull', 'Cabo', 'rear-delt'], ['Encolhimento', 'Halteres', 'shrug'],
      ['Remada alta', 'Barra', 'upright-row']
    ],
    'Bíceps': [
      ['Rosca direta', 'Barra', 'curl'], ['Rosca direta com barra W', 'Barra', 'curl'], ['Rosca alternada', 'Halteres', 'curl'],
      ['Rosca martelo', 'Halteres', 'curl'], ['Rosca concentrada', 'Halteres', 'curl'], ['Rosca Scott', 'Barra', 'curl'],
      ['Rosca no cabo', 'Cabo', 'curl'], ['Rosca inclinada', 'Halteres', 'curl']
    ],
    'Tríceps': [
      ['Tríceps pulley', 'Cabo', 'pushdown'], ['Tríceps corda', 'Cabo', 'pushdown'], ['Tríceps testa', 'Barra', 'overhead-ext'],
      ['Tríceps francês', 'Halteres', 'overhead-ext'], ['Tríceps coice', 'Halteres', 'kickback'], ['Mergulho nas paralelas', 'Peso corporal', 'dip'],
      ['Supino fechado', 'Barra', 'close-press'], ['Tríceps no banco', 'Peso corporal', 'dip']
    ],
    'Quadríceps': [
      ['Agachamento livre', 'Barra', 'squat'], ['Agachamento frontal', 'Barra', 'squat'], ['Agachamento no Smith', 'Smith', 'squat'],
      ['Agachamento goblet', 'Halteres', 'squat'], ['Agachamento búlgaro', 'Halteres', 'lunge'], ['Leg press 45°', 'Máquina', 'leg-press'],
      ['Hack squat', 'Máquina', 'squat'], ['Cadeira extensora', 'Máquina', 'leg-extension'], ['Afundo', 'Halteres', 'lunge'], ['Passada', 'Halteres', 'lunge']
    ],
    'Posterior': [
      ['Stiff', 'Barra', 'hinge'], ['Stiff com halteres', 'Halteres', 'hinge'], ['Levantamento terra romeno', 'Barra', 'hinge'],
      ['Mesa flexora', 'Máquina', 'leg-curl'], ['Cadeira flexora', 'Máquina', 'leg-curl'], ['Flexora em pé', 'Máquina', 'leg-curl'],
      ['Good morning', 'Barra', 'hinge']
    ],
    'Glúteos': [
      ['Elevação pélvica', 'Barra', 'hip-thrust'], ['Ponte de glúteo', 'Peso corporal', 'hip-thrust'],
      ['Abdução de quadril na máquina', 'Máquina', 'abduction'], ['Glúteo no cabo', 'Cabo', 'glute-kickback'],
      ['Glúteo na máquina', 'Máquina', 'glute-kickback'], ['Step-up', 'Halteres', 'lunge'], ['Agachamento sumô', 'Halteres', 'squat']
    ],
    'Panturrilha': [
      ['Panturrilha em pé', 'Máquina', 'calf'], ['Panturrilha sentado', 'Máquina', 'calf'], ['Panturrilha no leg press', 'Máquina', 'calf'],
      ['Panturrilha unilateral', 'Halteres', 'calf'], ['Panturrilha no Smith', 'Smith', 'calf']
    ],
    'Abdômen': [
      ['Abdominal crunch', 'Peso corporal', 'crunch'], ['Abdominal infra', 'Peso corporal', 'leg-raise'],
      ['Elevação de pernas', 'Peso corporal', 'leg-raise'], ['Abdominal na polia', 'Cabo', 'crunch'], ['Abdominal na máquina', 'Máquina', 'crunch'],
      ['Abdominal oblíquo', 'Peso corporal', 'oblique'], ['Roda abdominal', 'Outro', 'anti-extension']
    ]
  };

  // Movimentos que trabalham parecido (segunda opção quando não há o mesmo movimento livre)
  const RELATED = {
    'press-inclinado': ['fly-inclinado', 'press-horizontal'],
    'press-horizontal': ['press-inclinado', 'press-declinado', 'fly'],
    'press-declinado': ['press-horizontal', 'fly'],
    'fly': ['fly-inclinado', 'press-horizontal'],
    'fly-inclinado': ['press-inclinado', 'fly'],
    'pulldown': ['pullover', 'row'],
    'pullover': ['pulldown'],
    'row': ['pulldown', 'rear-delt'],
    'press-vertical': ['lateral-raise', 'front-raise'],
    'lateral-raise': ['upright-row', 'press-vertical'],
    'upright-row': ['lateral-raise', 'shrug'],
    'rear-delt': ['row'],
    'pushdown': ['overhead-ext', 'kickback'],
    'overhead-ext': ['pushdown', 'kickback'],
    'kickback': ['pushdown', 'overhead-ext'],
    'dip': ['close-press', 'pushdown'],
    'close-press': ['dip', 'pushdown'],
    'squat': ['leg-press', 'lunge'],
    'leg-press': ['squat', 'lunge'],
    'lunge': ['squat', 'leg-press'],
    'leg-extension': ['leg-press', 'squat'],
    'hinge': ['leg-curl', 'hip-thrust'],
    'leg-curl': ['hinge'],
    'hip-thrust': ['glute-kickback', 'hinge'],
    'glute-kickback': ['hip-thrust', 'abduction'],
    'abduction': ['glute-kickback'],
    'crunch': ['leg-raise'],
    'leg-raise': ['crunch'],
    'oblique': ['crunch'],
    'anti-extension': ['crunch', 'leg-raise']
  };

  const slug = (s) => U.normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // A ordem de BASE é curada: os movimentos mais comuns de cada grupo vêm primeiro
  const LIBRARY = [];
  MUSCLES.forEach((muscle) => (BASE[muscle] || []).forEach(([name, equipment, pattern]) => {
    LIBRARY.push(Object.freeze({ id: slug(name), name, muscle, equipment, pattern, custom: false, rank: LIBRARY.length }));
  }));
  const LIBRARY_BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));

  /* ---------- Dados ---------- */
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  // Biblioteca na ordem curada; personalizados no fim, em ordem alfabética
  const byRank = (a, b) => (a.custom === b.custom ? (a.custom ? byName(a, b) : a.rank - b.rank) : a.custom ? 1 : -1);

  function customs({ includeDeleted = false } = {}) {
    return Store.get('exercises').filter((e) => includeDeleted || !e.deleted).map((e) => Object.assign({ custom: true }, e));
  }

  // Tudo o que aparece na biblioteca (sem excluídos)
  function all() { return LIBRARY.concat(customs()).sort(byRank); }

  // Resolve qualquer id, inclusive personalizados excluídos (treinos e histórico dependem disso)
  function get(id) {
    if (LIBRARY_BY_ID.has(id)) return LIBRARY_BY_ID.get(id);
    const c = Store.get('exercises').find((e) => e.id === id);
    return c ? Object.assign({ custom: true }, c) : null;
  }

  // Nome/grupo de um item de treino, com o que foi salvo nele como reserva
  function resolve(item) {
    const e = get(item.exerciseId);
    return { name: e ? e.name : item.name, muscle: e ? e.muscle : item.muscle, equipment: e ? e.equipment : '' };
  }

  const favoriteSet = () => new Set(Store.get('favorites'));
  const isFavorite = (id) => Store.get('favorites').includes(id);

  function toggleFavorite(id) {
    let on = false;
    Store.update('favorites', (list) => {
      const i = list.indexOf(id);
      if (i > -1) list.splice(i, 1);
      else { list.push(id); on = true; }
    });
    return on;
  }

  function usage(id) {
    return global.Workouts.all().filter((w) => (w.exercises || []).some((x) => x.exerciseId === id));
  }

  // Busca instantânea: todos os termos precisam aparecer (nome, grupo ou equipamento);
  // nomes que começam com a busca vêm primeiro
  function search(query, { filter = 'all' } = {}) {
    let list = all();
    if (filter === 'favorites') { const favs = favoriteSet(); list = list.filter((e) => favs.has(e.id)); }
    else if (filter !== 'all') list = list.filter((e) => e.muscle === filter);

    const q = U.normalize(query);
    if (!q) return list;
    const tokens = q.split(/\s+/).filter(Boolean);
    return list
      .map((e) => {
        const name = U.normalize(e.name);
        const hay = `${name} ${U.normalize(e.muscle)} ${U.normalize(e.equipment)}`;
        if (!tokens.every((t) => hay.includes(t))) return null;
        let score = 0;
        if (name.startsWith(q)) score = 3;
        else if (name.split(/\s+/).some((w) => w.startsWith(tokens[0]))) score = 2;
        else if (name.includes(tokens[0])) score = 1;
        return { e, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || byRank(a.e, b.e))
      .map((x) => x.e);
  }

  /* ---------- Substituição inteligente ----------
     Mesmo movimento (ex.: outro supino inclinado) > movimento parecido (ex.: crucifixo inclinado) > mesmo músculo.
     Entre iguais, vem primeiro o que você já fez (tem carga de referência). */
  const REASON = { 3: 'Mesmo movimento', 2: 'Movimento parecido', 1: 'Mesmo músculo' };

  function alternatives(exerciseId, { limit = 8 } = {}) {
    const base = get(exerciseId);
    if (!base) return [];
    const related = RELATED[base.pattern] || [];
    const hasHistory = (id) => !!(global.Sessions && global.Sessions.lastPerformance(id));
    return all()
      .filter((e) => e.id !== exerciseId)
      .map((e) => {
        let score = 0;
        if (base.pattern && e.pattern === base.pattern) score = 3;
        else if (base.pattern && related.includes(e.pattern)) score = 2;
        else if (e.muscle === base.muscle) score = 1;
        return { e, score, history: hasHistory(e.id) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.history - a.history) || byRank(a.e, b.e))
      .slice(0, limit)
      .map((x) => Object.assign({}, x.e, { reason: REASON[x.score], score: x.score }));
  }

  // Última carga de um exercício, para mostrar ao lado de cada opção
  function lastText(id) {
    const lp = global.Sessions && global.Sessions.lastPerformance(id);
    if (!lp) return 'Sem histórico ainda';
    const top = lp.sets.reduce((b, x) => ((x.weightKg || 0) * 1000 + x.reps > (b.weightKg || 0) * 1000 + b.reps ? x : b));
    return `Último: ${U.fmtWeight(top.weightKg, { dec: 2 })} × ${top.reps} · ${U.fmtDayMonth(lp.date)}`;
  }

  function openSubstitute({ exerciseId, title = 'Trocar exercício', subtitle = '', inUse = [], note = '', onPick }) {
    const base = get(exerciseId);
    const list = alternatives(exerciseId);
    const body = U.h(`
      <div>
        ${note ? `<p class="t-callout mb-5">${esc(note)}</p>` : ''}
        ${list.length ? `
          <div class="group">
            ${list.map((e) => `
              <button type="button" class="row sub-row" data-id="${esc(e.id)}">
                <span class="row-main">
                  <span class="row-title block truncate">${esc(e.name)}${inUse.includes(e.id) ? ' <span class="tag">no treino</span>' : ''}</span>
                  <span class="row-sub block">${esc([e.equipment, e.reason].filter(Boolean).join(' · '))}</span>
                  <span class="row-sub block sub-last num">${esc(lastText(e.id))}</span>
                </span>
                ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
              </button>`).join('')}
          </div>` : '<p class="t-callout">Nenhuma alternativa na biblioteca para este exercício.</p>'}
        <button type="button" class="btn btn-secondary btn-block mt-4" data-search>${icon('search', { size: 18, stroke: 1.9 })} Buscar outro exercício</button>
      </div>`);
    const sheet = UI.openSheet({ title, subtitle: subtitle || (base ? `No lugar de ${base.name}` : ''), body, tall: list.length > 4 });
    body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) { sheet.close('pick'); onPick(row.dataset.id); return; }
      if (e.target.closest('[data-search]')) {
        sheet.close();
        openPicker({ title: 'Escolher substituto', inWorkout: inUse, onConfirm: (ids) => onPick(ids[0]) });
      }
    });
    return sheet;
  }

  /* ---------- Personalizados: criar, editar, excluir ---------- */
  function validate(data, editingId = null) {
    const errors = {};
    const name = String(data.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) errors.name = 'Dê um nome com pelo menos 2 letras.';
    else if (name.length > 40) errors.name = 'Use até 40 caracteres.';
    else if (all().some((e) => e.id !== editingId && U.normalize(e.name) === U.normalize(name))) errors.name = 'Já existe um exercício com esse nome.';
    if (!MUSCLES.includes(data.muscle)) errors.muscle = 'Escolha o grupo muscular.';
    const equipment = EQUIPMENT.includes(data.equipment) ? data.equipment : '';
    const notes = String(data.notes || '').trim().slice(0, 200);
    return { ok: !Object.keys(errors).length, errors, value: { name, muscle: data.muscle, equipment, notes } };
  }

  function createCustom(data) {
    const now = new Date().toISOString();
    const ex = Object.assign({ id: U.uid('cx_'), createdAt: now, updatedAt: now }, data);
    Store.update('exercises', (list) => { list.push(ex); });
    return get(ex.id);
  }

  function updateCustom(id, data) {
    Store.update('exercises', (list) => {
      const ex = list.find((e) => e.id === id);
      if (ex) Object.assign(ex, data, { updatedAt: new Date().toISOString() });
    });
    return get(id);
  }

  function setDeleted(id, deleted) {
    Store.update('exercises', (list) => {
      const ex = list.find((e) => e.id === id);
      if (!ex) return;
      ex.deleted = deleted;
      if (deleted) ex.deletedAt = new Date().toISOString();
      else delete ex.deletedAt;
    });
  }

  const refreshScreen = () => { if (global.App) global.App.Router.refresh(); };

  function removeCustom(id, after) {
    const ex = get(id);
    if (!ex || !ex.custom) return;
    const used = usage(id);
    const run = () => {
      setDeleted(id, true);
      refreshScreen();
      if (after) after();
      UI.toast(`${ex.name} excluído`, {
        iconName: 'trash', action: 'Desfazer', duration: 5000,
        onAction: () => { setDeleted(id, false); refreshScreen(); }
      });
    };
    if (!used.length) return run();
    UI.confirmSheet({
      title: `Excluir ${ex.name}?`,
      message: `Ele sai da biblioteca, mas continua ${used.length === 1 ? 'no treino' : 'nos treinos'} ${used.map((w) => w.name).join(', ')}.`,
      confirmLabel: 'Excluir exercício', destructive: true, onConfirm: run
    });
  }

  /* ---------- Formulário (novo / editar) ---------- */
  const choiceChips = (list, value, name) => `
    <div class="chips" role="radiogroup" data-choice="${name}">
      ${list.map((v) => `<button type="button" class="chip is-choice" role="radio" aria-checked="${v === value}" data-value="${esc(v)}">${esc(v)}</button>`).join('')}
    </div>`;

  function openForm({ exercise = null, presetName = '', presetMuscle = '', onSaved } = {}) {
    const editing = !!exercise;
    const draft = {
      name: editing ? exercise.name : presetName,
      muscle: editing ? exercise.muscle : presetMuscle,
      equipment: editing ? exercise.equipment : '',
      notes: editing ? (exercise.notes || '') : ''
    };

    const body = U.h(`
      <form class="form" novalidate>
        <label class="form-label" for="ex-name">Nome</label>
        <input id="ex-name" class="field" name="name" maxlength="40" autocomplete="off" autocapitalize="sentences"
               enterkeyhint="done" placeholder="Ex.: Supino com pausa" value="${esc(draft.name)}">
        <p class="field-error" data-err="name"></p>

        <p class="form-label">Grupo muscular</p>
        ${choiceChips(MUSCLES, draft.muscle, 'muscle')}
        <p class="field-error" data-err="muscle"></p>

        <p class="form-label">Equipamento <span class="t-faint">· opcional</span></p>
        ${choiceChips(EQUIPMENT, draft.equipment, 'equipment')}

        <label class="form-label mt-6" for="ex-notes">Observação <span class="t-faint">· opcional</span></label>
        <textarea id="ex-notes" class="field field-area" name="notes" maxlength="200" rows="3"
                  placeholder="Ajuste do banco, pegada, amplitude…">${esc(draft.notes)}</textarea>
      </form>`);
    const footer = U.h(`<button class="btn btn-primary btn-block" type="button">${editing ? 'Salvar' : 'Criar exercício'}</button>`);
    const sheet = UI.openSheet({ title: editing ? 'Editar exercício' : 'Novo exercício', body, footer, focus: editing ? null : '#ex-name' });

    const input = body.querySelector('#ex-name');
    const err = (k, msg) => { body.querySelector(`[data-err="${k}"]`).textContent = msg || ''; };
    input.addEventListener('input', () => { input.classList.remove('is-invalid'); err('name'); });
    U.submitOnEnter(input, body);

    body.querySelectorAll('[data-choice]').forEach((group) => {
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const key = group.dataset.choice;
        const already = chip.getAttribute('aria-checked') === 'true';
        // Grupo muscular é obrigatório; equipamento pode ser desmarcado
        const next = already && key === 'equipment' ? '' : chip.dataset.value;
        draft[key] = next;
        group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.value === next)));
        if (key === 'muscle') err('muscle');
      });
    });

    footer.addEventListener('click', () => body.requestSubmit ? body.requestSubmit() : body.dispatchEvent(new Event('submit', { cancelable: true })));
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = input.value;
      draft.notes = body.querySelector('#ex-notes').value;
      const r = validate(draft, editing ? exercise.id : null);
      if (!r.ok) {
        err('name', r.errors.name); err('muscle', r.errors.muscle);
        if (r.errors.name) input.classList.add('is-invalid');
        body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
        return;
      }
      const saved = editing ? updateCustom(exercise.id, r.value) : createCustom(r.value);
      sheet.close('save');
      refreshScreen();
      UI.toast(editing ? 'Salvo' : 'Exercício criado');
      if (onSaved) onSaved(saved);
    });
    return sheet;
  }

  /* ---------- Detalhe ---------- */

  // Estatísticas do exercício, calculadas do histórico
  function historyHTML(id) {
    const S = global.Statistics;
    const st = S.exerciseStats(global.Sessions.all(), id);
    if (!st) {
      return `
        <p class="t-eyebrow mt-8">Histórico</p>
        <p class="t-callout mt-2">Cargas, recordes e 1RM estimado deste exercício aparecem aqui depois do primeiro treino.</p>`;
    }
    const kg = (v, dec = 2) => U.fmtWeight(v, { dec });
    const setText = (s) => `${U.fmtWeight(s.weightKg, { dec: 2, withUnit: false })} × ${s.reps}`;
    const stat = (label, value, sub = '') => `
      <div class="ex-stat">
        <span class="stat-label">${label}</span>
        <span class="ex-stat-value num">${value}</span>
        ${sub ? `<span class="t-footnote">${sub}</span>` : ''}
      </div>`;
    return `
      <p class="t-eyebrow mt-8">Seus números</p>
      <div class="ex-stats mt-4">
        ${stat('Melhor carga', kg(st.heaviest.weightKg), `${st.heaviest.reps} reps · ${U.fmtDayMonth(st.heaviest.date)}`)}
        ${stat('Melhor série', setText(st.bestSet), U.fmtVolume(S.calculateVolume(st.bestSet.weightKg, st.bestSet.reps)))}
        ${stat('Maior volume', U.fmtVolume(st.maxVolume.volume), U.fmtDayMonth(st.maxVolume.date))}
        ${stat('1RM estimado', st.best1RM ? kg(U.round(st.best1RM.value, 1), 1) : '—', st.best1RM ? `a partir de ${setText(st.best1RM.set)}` : 'só com séries de até 12 reps')}
        ${stat('Sessões', U.fmtNum(st.sessions), `última em ${U.fmtDayMonth(st.last.date)}`)}
      </div>
      <p class="t-footnote mt-3">O 1RM é uma estimativa (fórmula de Epley). Não é preciso testar sua carga máxima.</p>

      <p class="t-eyebrow mt-8">Últimas sessões</p>
      <div class="group mt-3">
        ${st.entries.slice(0, 5).map((e) => {
          const top = e.sets.reduce((b, x) => ((x.weightKg || 0) * 1000 + x.reps > (b.weightKg || 0) * 1000 + b.reps ? x : b));
          return `
            <button type="button" class="row" data-session="${esc(e.sessionId)}">
              <span class="row-main">
                <span class="row-title block num">${setText(top)} ${U.currentUnit()}</span>
                <span class="row-sub block">${U.fmtDayMonth(e.date)} · ${U.plural(e.sets.length, 'série', 'séries')}</span>
              </span>
              <span class="row-value num">${U.fmtVolume(e.volume)}</span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>`;
        }).join('')}
      </div>`;
  }
  function openDetail(id) {
    const ex = get(id);
    if (!ex) return;
    const used = usage(id);
    const favLabel = (on) => `${icon('star', { size: 17, stroke: 1.8 })}<span>${on ? 'Favorito' : 'Favoritar'}</span>`;

    const body = U.h(`
      <div>
        <div class="ex-actions">
          <button type="button" class="btn btn-secondary btn-sm fav-btn" data-fav aria-pressed="${isFavorite(id)}">${favLabel(isFavorite(id))}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add aria-label="Adicionar a um treino">${icon('plus', { size: 17, stroke: 2 })}<span>Adicionar</span></button>
        </div>

        ${ex.notes ? `<p class="t-eyebrow mt-8">Observação</p><p class="t-body mt-2 whitespace-pre-line">${esc(ex.notes)}</p>` : ''}

        <p class="t-eyebrow mt-8">Nos seus treinos</p>
        <p class="t-callout mt-2">${used.length ? used.map((w) => esc(w.name)).join(' · ') : 'Ainda não está em nenhum treino.'}</p>

        ${historyHTML(id)}

        ${(() => {
          const alts = alternatives(id, { limit: 4 });
          return alts.length ? `
            <p class="t-eyebrow mt-8">Alternativas</p>
            <div class="group mt-3">
              ${alts.map((a) => `
                <button type="button" class="row" data-alt="${esc(a.id)}">
                  <span class="row-main">
                    <span class="row-title block truncate">${esc(a.name)}</span>
                    <span class="row-sub block">${esc(a.equipment)} · ${a.reason}</span>
                  </span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>`).join('')}
            </div>` : '';
        })()}

        ${ex.custom ? `
          <div class="group mt-8 has-icons">
            <button type="button" class="row" data-edit><span class="row-icon">${icon('edit', { size: 20 })}</span><span class="row-main row-title">Editar exercício</span></button>
            <button type="button" class="row is-danger" data-del><span class="row-icon">${icon('trash', { size: 20 })}</span><span class="row-main row-title">Excluir exercício</span></button>
          </div>` : ''}
      </div>`);

    const subtitle = [ex.muscle, ex.equipment, ex.custom ? 'Personalizado' : ''].filter(Boolean).join(' · ');
    const sheet = UI.openSheet({ title: ex.name, subtitle, body });

    const favBtn = body.querySelector('[data-fav]');
    favBtn.addEventListener('click', () => {
      const on = toggleFavorite(id);
      favBtn.setAttribute('aria-pressed', String(on));
      favBtn.innerHTML = favLabel(on);
      refreshScreen();
    });

    body.addEventListener('click', (e) => {
      const alt = e.target.closest('[data-alt]');
      if (alt) { sheet.close(); setTimeout(() => openDetail(alt.dataset.alt), 220); return; }
      const row = e.target.closest('[data-session]');
      if (!row) return;
      sheet.close();
      global.App.Router.go(`progress/session/${row.dataset.session}`);
    });

    body.querySelector('[data-add]').addEventListener('click', () => {
      // Treinos do treinador são somente leitura: não entram na lista
      const workouts = global.Workouts.all().filter((w) => !w.managed);
      if (!workouts.length) {
        UI.toast(global.Workouts.all().length ? 'Seus treinos atuais são do treinador. Crie um treino seu para adicionar exercícios.' : 'Crie um treino primeiro', { iconName: 'info', action: 'Criar', onAction: () => { sheet.close(); global.Workouts.openCreate(); } });
        return;
      }
      UI.choiceSheet({
        title: 'Adicionar a…',
        options: workouts.map((w) => ({ value: w.id, label: w.name })),
        value: null,
        onSelect: (wid) => {
          global.Workouts.addExercises(wid, [id]);
          sheet.close();
          UI.toast(`Adicionado a ${global.Workouts.get(wid).name}`);
        }
      });
    });

    if (ex.custom) {
      body.querySelector('[data-edit]').addEventListener('click', () => {
        sheet.close();
        openForm({ exercise: ex });
      });
      body.querySelector('[data-del]').addEventListener('click', () => removeCustom(id, () => sheet.close()));
    }
    return sheet;
  }

  /* ---------- Lista reutilizável (tela e seletor) ---------- */
  function rowHTML(e, ctx) {
    const sub = [e.muscle, e.equipment].filter(Boolean).join(' · ');
    const tag = e.custom ? '<span class="tag">Personalizado</span>' : '';
    if (ctx.mode === 'pick') {
      const on = ctx.selected.has(e.id);
      const inside = ctx.inWorkout.has(e.id) ? ' · <span class="t-accent">no treino</span>' : '';
      return `
        <button type="button" class="row ex-row" role="checkbox" aria-checked="${on}" data-id="${esc(e.id)}">
          <span class="row-main">
            <span class="row-title block truncate">${esc(e.name)}${tag}</span>
            <span class="row-sub block">${esc(sub)}${inside}</span>
          </span>
          <span class="check-circle">${icon('check', { size: 14, stroke: 2.6 })}</span>
        </button>`;
    }
    const fav = ctx.favs.has(e.id);
    return `
      <div class="row ex-row is-tappable" role="button" tabindex="0" data-id="${esc(e.id)}">
        <span class="row-main">
          <span class="row-title block truncate">${esc(e.name)}${tag}</span>
          <span class="row-sub block">${esc(sub)}</span>
        </span>
        <button type="button" class="star-btn" data-fav aria-pressed="${fav}" aria-label="${fav ? 'Remover dos favoritos' : 'Favoritar'} ${esc(e.name)}">
          ${icon('star', { size: 20, stroke: 1.7 })}
        </button>
      </div>`;
  }

  const sectionHTML = (label, items, ctx, extraCls = '') => `
    <section class="list-section ${extraCls}">
      <p class="t-eyebrow group-label">${label}</p>
      <div class="group">${items.map((e) => rowHTML(e, ctx)).join('')}</div>
    </section>`;

  function resultsHTML(st, ctx) {
    const results = search(st.query, { filter: st.filter });
    ctx.favs = favoriteSet();

    if (!results.length) {
      if (st.filter === 'favorites' && !st.query) {
        return `
          <div class="empty mt-2">
            <div class="empty-icon">${icon('star', { size: 24 })}</div>
            <p class="empty-title">Nenhum favorito ainda</p>
            <p class="empty-text">Toque na estrela de um exercício para ter acesso rápido a ele aqui.</p>
          </div>`;
      }
      return `
        <div class="empty mt-2">
          <div class="empty-icon">${icon('search', { size: 24 })}</div>
          <p class="empty-title">Nada encontrado</p>
          <p class="empty-text">${st.query ? `Nenhum exercício com “${esc(st.query)}”.` : 'Nenhum exercício neste grupo.'} Você pode criar o seu.</p>
          <button type="button" class="btn btn-primary" data-new>${icon('plus', { size: 18, stroke: 2 })} Novo exercício</button>
        </div>`;
    }

    if (st.query || st.filter !== 'all') {
      return `
        <p class="t-footnote list-count">${U.plural(results.length, 'exercício', 'exercícios')}</p>
        <div class="group">${results.map((e) => rowHTML(e, ctx)).join('')}</div>`;
    }

    let html = '';
    const favs = results.filter((e) => ctx.favs.has(e.id));
    if (favs.length) html += sectionHTML(`${icon('star', { size: 12, stroke: 2.2 })} Favoritos`, favs, ctx, 'is-favorites');
    MUSCLES.forEach((m) => {
      const items = results.filter((e) => e.muscle === m);
      if (items.length) html += sectionHTML(esc(m), items, ctx);
    });
    return html;
  }

  const controlsHTML = (st) => `
    <label class="search">
      ${icon('search', { size: 18, stroke: 1.8 })}
      <input type="search" data-search placeholder="Pesquisar exercícios" autocomplete="off" autocorrect="off"
             autocapitalize="off" spellcheck="false" enterkeyhint="search" value="${esc(st.query)}" aria-label="Pesquisar exercícios">
      <button type="button" class="search-clear" data-clear aria-label="Limpar busca" ${st.query ? '' : 'hidden'}>${icon('close', { size: 12, stroke: 2.6 })}</button>
    </label>
    <div class="chip-scroller" role="tablist" aria-label="Filtrar por grupo">
      ${[['all', 'Todos'], ['favorites', `${icon('star', { size: 14, stroke: 2 })}Favoritos`]].concat(MUSCLES.map((m) => [m, esc(m)]))
        .map(([v, label]) => `<button type="button" class="chip" role="tab" aria-selected="${st.filter === v}" data-filter="${esc(v)}">${label}</button>`).join('')}
    </div>`;

  // Liga busca, filtros e lista; a lista é redesenhada sem perder o foco da busca
  function bindBrowser(root, st, ctx) {
    const results = root.querySelector('[data-results]');
    const input = root.querySelector('[data-search]');
    const clear = root.querySelector('[data-clear]');
    const paint = () => { results.innerHTML = resultsHTML(st, ctx); };

    input.addEventListener('input', () => {
      st.query = input.value;
      clear.hidden = !st.query;
      paint();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    clear.addEventListener('click', () => { st.query = ''; input.value = ''; clear.hidden = true; paint(); input.focus(); });

    root.querySelector('.chip-scroller').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      st.filter = chip.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      paint();
    });

    paint();
    return { paint };
  }

  /* ---------- Tela Exercícios ---------- */
  const screenState = { query: '', filter: 'all' };

  function renderScreen(root) {
    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <h1 class="t-large-title" data-large-title>Exercícios</h1>
          <button class="icon-btn" data-new aria-label="Novo exercício">${icon('plus', { size: 20, stroke: 2 })}</button>
        </header>
        <div class="mt-6">${controlsHTML(screenState)}</div>
        <div class="mt-6" data-results></div>
      </section>`;

    const browser = bindBrowser(root, screenState, { mode: 'browse' });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) {
        const preset = screenState.query && !search(screenState.query, screenState).length ? screenState.query.trim() : '';
        const presetMuscle = MUSCLES.includes(screenState.filter) ? screenState.filter : '';
        openForm({ presetName: preset, presetMuscle });
        return;
      }
      const star = e.target.closest('[data-fav]');
      if (star) {
        const id = star.closest('[data-id]').dataset.id;
        const on = toggleFavorite(id);
        // Atualiza todas as linhas desse exercício (ele pode aparecer em Favoritos e no grupo)
        root.querySelectorAll(`[data-id="${CSS.escape(id)}"] [data-fav]`).forEach((b) => {
          b.setAttribute('aria-pressed', String(on));
          b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        });
        // Seção Favoritos / filtro Favoritos precisam refletir a mudança
        setTimeout(browser.paint, on ? 260 : 180);
        return;
      }
      const row = e.target.closest('.ex-row');
      if (row) openDetail(row.dataset.id);
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('.ex-row');
      if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openDetail(row.dataset.id); }
    });
  }

  /* ---------- Seletor (adicionar a um treino) ---------- */
  function openPicker({ title = 'Adicionar exercícios', inWorkout = [], onConfirm }) {
    const st = { query: '', filter: 'all' };
    const selected = [];               // mantém a ordem de seleção
    const ctx = { mode: 'pick', selected: new Set(), inWorkout: new Set(inWorkout) };

    const body = U.h(`
      <div class="picker">
        <div class="picker-controls">${controlsHTML(st)}</div>
        <button type="button" class="row picker-new" data-new>
          <span class="row-icon t-accent">${icon('plus', { size: 20, stroke: 2 })}</span>
          <span class="row-main row-title">Criar exercício personalizado</span>
        </button>
        <div class="mt-5" data-results></div>
      </div>`);
    const footer = U.h(`<button type="button" class="btn btn-primary btn-block" disabled>Adicionar</button>`);
    const sheet = UI.openSheet({ title, body, footer, tall: true });

    const browser = bindBrowser(body, st, ctx);
    const paintFooter = () => {
      footer.disabled = !selected.length;
      footer.textContent = selected.length ? `Adicionar ${U.plural(selected.length, 'exercício', 'exercícios')}` : 'Adicionar';
    };
    const toggle = (id, force) => {
      const on = force !== undefined ? force : !ctx.selected.has(id);
      if (on && !ctx.selected.has(id)) { ctx.selected.add(id); selected.push(id); }
      if (!on && ctx.selected.has(id)) { ctx.selected.delete(id); selected.splice(selected.indexOf(id), 1); }
      body.querySelectorAll(`.ex-row[data-id="${CSS.escape(id)}"]`).forEach((r) => r.setAttribute('aria-checked', String(on)));
      paintFooter();
    };

    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) {
        openForm({
          presetName: st.query && !search(st.query, st).length ? st.query.trim() : '',
          presetMuscle: MUSCLES.includes(st.filter) ? st.filter : '',
          onSaved: (ex) => { toggle(ex.id, true); browser.paint(); }
        });
        return;
      }
      const row = e.target.closest('.ex-row');
      if (row) toggle(row.dataset.id);
    });

    footer.addEventListener('click', () => {
      if (!selected.length) return;
      sheet.close('confirm');
      onConfirm([...selected]);
    });
    return sheet;
  }

  global.Exercises = {
    MUSCLES, EQUIPMENT, LIBRARY,
    all, get, resolve, search, isFavorite, toggleFavorite, usage, alternatives, openSubstitute,
    createCustom, updateCustom, removeCustom, validate,
    openForm, openDetail, openPicker, renderScreen
  };
})(window);
