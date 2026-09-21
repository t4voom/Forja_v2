/* FORJA — treinos (modelos)
   Formato: { id, name, description, color, order, createdAt, updatedAt,
              exercises: [{ id, exerciseId, name, muscle, sets, repMin, repMax, group, loadKg?, restSec?, notes? }],
              muscleGroup?, managed?, managedBy?: { trainerId, trainerName, academiaId, academiaName, at }, releasedFrom? }
   · name/muscle ficam salvos no item como reserva; o nome exibido vem sempre da biblioteca.
   · Toda alteração é salva na hora (Store). Exclusões oferecem "Desfazer".
   · Treinos com managed = true foram montados pelo treinador da academia (FORJA Trainer).
     No app eles são somente leitura; o servidor não deixa o app sobrescrevê-los (ver applyRemote). */
(function (global) {
  'use strict';
  const { Store, U, UI } = global;
  const { esc, icon } = U;

  const COLORS = [
    { value: '#E8853D', label: 'Cobre' },
    { value: '#E5B454', label: 'Âmbar' },
    { value: '#E5675A', label: 'Brasa' },
    { value: '#5E9EFF', label: 'Azul' },
    { value: '#4CC38A', label: 'Verde' },
    { value: '#A78BFA', label: 'Violeta' },
    { value: '#8E8E93', label: 'Grafite' }
  ];
  const LIMITS = { sets: [1, 10], repMin: [1, 50], repMax: [1, 60] };

  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  const now = () => new Date().toISOString();
  const Router = () => global.App.Router;

  /* ==========================================================================
     Leitura
     ========================================================================== */
  function all() { return [...Store.get('workouts')].sort(byOrder); }
  function get(id) { return Store.get('workouts').find((w) => w.id === id) || null; }

  // Grupos musculares únicos, na ordem em que aparecem: "Peito · Tríceps"
  function muscleSummary(workout, max = 3) {
    const seen = [];
    (workout.exercises || []).forEach((item) => {
      const m = global.Exercises.resolve(item).muscle;
      if (m && !seen.includes(m)) seen.push(m);
    });
    const shown = seen.slice(0, max).join(' · ');
    return seen.length > max ? `${shown} +${seen.length - max}` : shown;
  }

  const exerciseCount = (w) => U.plural((w.exercises || []).length, 'exercício', 'exercícios');
  const totalSets = (w) => (w.exercises || []).reduce((sum, x) => sum + (x.sets || 0), 0);
  const scheme = (x) => `${x.sets} × ${x.repMin === x.repMax ? x.repMin : `${x.repMin}–${x.repMax}`}`;
  const isManaged = (w) => !!(w && w.managed);
  const fmtRest = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}` : `${sec} s`);
  // Carga, descanso e observação definidos pelo treinador
  const hasPrescription = (x) => x.loadKg != null || x.restSec != null || !!x.notes;
  const prescriptionText = (x) => [x.loadKg != null ? U.fmtWeight(x.loadKg) : '', x.restSec != null ? `descanso ${fmtRest(x.restSec)}` : ''].filter(Boolean).join(' · ');

  /* ==========================================================================
     Treinos do treinador (servidor)
     ========================================================================== */
  // Mesma regra do servidor (Code.gs › mergeWorkouts_): o treinador manda nos treinos gerenciados,
  // o aluno manda nos dele. Treinos gerenciados que o servidor não tem mais: excluídos pelo treinador
  // (somem) ou devolvidos ao aluno quando ele saiu da academia (vale a versão do servidor).
  function mergeRemote(local, server) {
    const byId = new Map(server.filter(Boolean).map((w) => [w.id, w]));
    const out = [];
    const used = new Set();
    local.forEach((w) => {
      const s = byId.get(w.id);
      if (s && s.managed) { out.push(s); used.add(w.id); return; }
      if (w.managed) { if (s) { out.push(s); used.add(w.id); } return; }
      out.push(w);
      used.add(w.id);
    });
    server.forEach((s) => { if (s && s.managed && !used.has(s.id)) { out.push(s); used.add(s.id); } });
    return out;
  }

  // Aplica a lista vinda do servidor sem disparar um novo envio. Devolve true se algo mudou.
  function applyRemote(server) {
    if (!Array.isArray(server)) return false;
    const local = Store.get('workouts');
    const next = mergeRemote(local, server);
    if (JSON.stringify(next) === JSON.stringify(local)) return false;
    const before = JSON.stringify(local.filter(isManaged));
    Store.importAll({ workouts: next });
    if (JSON.stringify(next.filter(isManaged)) !== before) {
      UI.toast('Seu treinador atualizou seus treinos', { iconName: 'dumbbell', duration: 4000 });
    }
    return true;
  }

  function managedNoteHTML(w) {
    if (w.managed && w.managedBy) {
      return `<p class="managed-note">${icon('user', { size: 15, stroke: 2 })}<span>Montado por <strong>${esc(w.managedBy.trainerName || 'seu treinador')}</strong>${w.managedBy.academiaName ? ` · ${esc(w.managedBy.academiaName)}` : ''}</span></p>`;
    }
    if (w.releasedFrom) {
      return `<p class="t-footnote mt-3">Montado por ${esc(w.releasedFrom.trainerName || 'seu treinador')}${w.releasedFrom.academiaName ? ` na ${esc(w.releasedFrom.academiaName)}` : ''}. Agora o treino é seu.</p>`;
    }
    return '';
  }

  // Rotação: o treino seguinte ao último realizado; sem histórico, o primeiro da lista
  function next() {
    // Com um programa em andamento, a rotação segue só os treinos dele
    const prog = global.Programs ? global.Programs.workoutIds() : [];
    const list = prog.length ? all().filter((w) => prog.includes(w.id)) : all();
    if (!list.length) return null;
    const last = global.Sessions.all().find((s) => list.some((w) => w.id === s.workoutId));
    if (!last) return list[0];
    const i = list.findIndex((w) => w.id === last.workoutId);
    return list[(i + 1) % list.length];
  }

  /* ==========================================================================
     Escrita
     ========================================================================== */
  function validate(data) {
    const errors = {};
    const name = String(data.name || '').trim().replace(/\s+/g, ' ');
    if (!name) errors.name = 'Dê um nome ao treino.';
    else if (name.length > 40) errors.name = 'Use até 40 caracteres.';
    const description = String(data.description || '').trim().slice(0, 120);
    const color = COLORS.some((c) => c.value === data.color) ? data.color : COLORS[0].value;
    return { ok: !Object.keys(errors).length, errors, value: { name, description, color } };
  }

  function create(data) {
    const list = Store.get('workouts');
    const w = Object.assign({
      id: U.uid('w_'),
      order: list.length ? Math.max(...list.map((x) => x.order ?? 0)) + 1 : 0,
      exercises: [],
      createdAt: now(),
      updatedAt: now()
    }, data);
    Store.update('workouts', (ws) => { ws.push(w); });
    return get(w.id);
  }

  function update(id, patchOrFn) {
    Store.update('workouts', (ws) => {
      const w = ws.find((x) => x.id === id);
      if (!w || w.managed) return; // treino do treinador: só ele altera
      if (typeof patchOrFn === 'function') patchOrFn(w);
      else Object.assign(w, patchOrFn);
      w.updatedAt = now();
    });
  }

  // Reatribui "order" conforme a posição atual
  function saveOrder(ids) {
    Store.update('workouts', (ws) => { ws.forEach((w) => { w.order = ids.indexOf(w.id); }); });
  }

  function moveWorkout(from, to) {
    saveOrder(U.moveItem(all().map((w) => w.id), from, to));
  }

  function duplicate(id) {
    const src = get(id);
    if (!src) return null;
    const ids = all().map((w) => w.id);
    const copy = U.clone(src);
    // A cópia é do aluno, mesmo quando o original é do treinador
    delete copy.managed;
    delete copy.managedBy;
    delete copy.releasedFrom;
    copy.id = U.uid('w_');
    copy.name = `${src.name} (cópia)`.slice(0, 40);
    copy.createdAt = copy.updatedAt = now();
    copy.exercises = copy.exercises.map((x) => Object.assign(x, { id: U.uid('wx_') }));
    Store.update('workouts', (ws) => { ws.push(copy); });
    ids.splice(ids.indexOf(id) + 1, 0, copy.id);
    saveOrder(ids);
    return get(copy.id);
  }

  // Exclui na hora e oferece desfazer (restaura na mesma posição)
  function remove(id) {
    const w = get(id);
    if (!w || w.managed) return;
    const ids = all().map((x) => x.id);
    Store.update('workouts', (ws) => ws.filter((x) => x.id !== id));
    UI.toast(`${w.name} excluído`, {
      iconName: 'trash', action: 'Desfazer', duration: 5000,
      onAction: () => {
        Store.update('workouts', (ws) => { ws.push(w); });
        saveOrder(ids);
        Router().refresh();
      }
    });
  }

  function defaultReps(muscle) {
    return muscle === 'Panturrilha' || muscle === 'Abdômen' ? [12, 15] : [8, 12];
  }

  function addExercises(id, exerciseIds) {
    update(id, (w) => {
      exerciseIds.forEach((exId) => {
        const ex = global.Exercises.get(exId);
        if (!ex) return;
        const [repMin, repMax] = defaultReps(ex.muscle);
        w.exercises.push({ id: U.uid('wx_'), exerciseId: ex.id, name: ex.name, muscle: ex.muscle, sets: 3, repMin, repMax, group: null });
      });
    });
  }

  function updateItem(wid, itemId, patch) {
    update(wid, (w) => {
      const x = w.exercises.find((i) => i.id === itemId);
      if (!x) return;
      Object.assign(x, patch);
      // Ajustado à mão: deixa de seguir a progressão do programa
      if (x.base && ('sets' in patch || 'repMin' in patch || 'repMax' in patch)) x.manual = true;
    });
  }

  function removeItem(wid, itemId) {
    const w = get(wid);
    if (!w) return;
    const index = w.exercises.findIndex((x) => x.id === itemId);
    if (index < 0) return;
    const item = w.exercises[index];
    update(wid, (d) => { d.exercises.splice(index, 1); });
    Router().refresh();
    UI.toast(`${global.Exercises.resolve(item).name} removido`, {
      iconName: 'trash', action: 'Desfazer', duration: 5000,
      onAction: () => {
        update(wid, (d) => { d.exercises.splice(Math.min(index, d.exercises.length), 0, item); });
        Router().refresh();
      }
    });
  }

  // Troca o exercício de um item mantendo séries e faixa de reps
  function replaceItem(wid, itemId, newExerciseId) {
    const ex = global.Exercises.get(newExerciseId);
    if (!ex) return;
    update(wid, (w) => {
      const x = w.exercises.find((i) => i.id === itemId);
      if (x) Object.assign(x, { exerciseId: ex.id, name: ex.name, muscle: ex.muscle });
    });
  }

  function replaceExercise(wid, oldExerciseId, newExerciseId) {
    const w = get(wid);
    const item = w && w.exercises.find((x) => x.exerciseId === oldExerciseId);
    if (item) replaceItem(wid, item.id, newExerciseId);
  }

  function moveItem(wid, from, to) {
    update(wid, (w) => { w.exercises = U.moveItem(w.exercises, from, to); });
  }

  /* ==========================================================================
     Formulário: criar / editar
     ========================================================================== */
  function openForm({ workout = null, onSaved } = {}) {
    const editing = !!workout;
    const draft = {
      name: editing ? workout.name : '',
      description: editing ? (workout.description || '') : '',
      color: editing ? workout.color : COLORS[all().length % COLORS.length].value
    };

    const body = U.h(`
      <form class="form" novalidate>
        <label class="form-label" for="w-name">Nome</label>
        <input id="w-name" class="field" name="name" maxlength="40" autocomplete="off" autocapitalize="characters"
               enterkeyhint="done" placeholder="Ex.: Força A" value="${esc(draft.name)}">
        <p class="field-error" data-err="name"></p>

        <label class="form-label" for="w-desc">Descrição <span class="t-faint">· opcional</span></label>
        <textarea id="w-desc" class="field field-area" name="description" maxlength="120" rows="2"
                  placeholder="Ex.: Foco em peito e tríceps">${esc(draft.description)}</textarea>

        <p class="form-label mt-6">Cor</p>
        <div class="swatches" role="radiogroup" aria-label="Cor do treino">
          ${COLORS.map((c) => `
            <button type="button" class="swatch" role="radio" aria-checked="${c.value === draft.color}" aria-label="${c.label}"
                    data-color="${c.value}" style="--c:${c.value}"></button>`).join('')}
        </div>
      </form>`);
    const footer = U.h(`<button class="btn btn-primary btn-block" type="button">${editing ? 'Salvar' : 'Continuar'}</button>`);
    const sheet = UI.openSheet({
      title: editing ? 'Editar treino' : 'Novo treino',
      subtitle: editing ? '' : 'Depois você escolhe os exercícios.',
      body, footer, focus: editing ? null : '#w-name'
    });

    const input = body.querySelector('#w-name');
    const error = body.querySelector('[data-err="name"]');
    input.addEventListener('input', () => { input.classList.remove('is-invalid'); error.textContent = ''; });
    U.submitOnEnter(input, body);

    body.querySelector('.swatches').addEventListener('click', (e) => {
      const s = e.target.closest('.swatch');
      if (!s) return;
      draft.color = s.dataset.color;
      body.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === s)));
    });

    footer.addEventListener('click', () => body.requestSubmit ? body.requestSubmit() : body.dispatchEvent(new Event('submit', { cancelable: true })));
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = input.value;
      draft.description = body.querySelector('#w-desc').value;
      const r = validate(draft);
      if (!r.ok) {
        error.textContent = r.errors.name;
        input.classList.add('is-invalid');
        body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
        input.focus();
        return;
      }
      let saved;
      if (editing) { update(workout.id, r.value); saved = get(workout.id); }
      else saved = create(r.value);
      sheet.close('save');
      if (onSaved) onSaved(saved);
    });
    return sheet;
  }

  // Criar: salva, abre o treino e já oferece a escolha de exercícios
  function openCreate() {
    if (!global.Plans.canCreateWorkout()) return global.Plans.openPaywall('workouts');
    openForm({
      onSaved: (w) => {
        Router().go(`workouts/${w.id}`);
        setTimeout(() => openAddExercises(w.id), 380);
      }
    });
  }

  function openAddExercises(wid) {
    const w = get(wid);
    if (!w) return;
    global.Exercises.openPicker({
      inWorkout: w.exercises.map((x) => x.exerciseId),
      onConfirm: (ids) => {
        addExercises(wid, ids);
        Router().refresh();
        UI.toast(ids.length === 1 ? 'Exercício adicionado' : `${ids.length} exercícios adicionados`);
      }
    });
  }

  /* ==========================================================================
     Configuração de um exercício no treino (séries × repetições)
     ========================================================================== */
  // Exercício de um treino do treinador: só consulta
  function openManagedItem(w, item) {
    const info = global.Exercises.resolve(item);
    const row = (label, value) => `<div class="row"><span class="row-main row-title">${label}</span><span class="row-value num">${value}</span></div>`;
    const body = U.h(`
      <div>
        <p class="scheme-preview num">${scheme(item)}</p>
        <div class="group mt-6">
          ${row('Séries', item.sets)}
          ${row('Repetições', item.repMin === item.repMax ? item.repMin : `${item.repMin} a ${item.repMax}`)}
          ${item.loadKg != null ? row('Carga', esc(U.fmtWeight(item.loadKg))) : ''}
          ${item.restSec != null ? row('Descanso', esc(fmtRest(item.restSec))) : ''}
        </div>
        ${item.notes ? `<p class="t-eyebrow group-label mt-6">Observação do treinador</p><div class="group"><p class="row managed-obs">${esc(item.notes)}</p></div>` : ''}
        <p class="t-footnote group-note">Definido por ${esc((w.managedBy || {}).trainerName || 'seu treinador')}. Para mudar, fale com ele.</p>
        <div class="group mt-8 has-icons">
          <button type="button" class="row" data-view><span class="row-icon">${icon('info', { size: 20 })}</span><span class="row-main row-title">Ver exercício</span></button>
        </div>
      </div>`);
    UI.openSheet({ title: info.name, subtitle: [info.muscle, info.equipment].filter(Boolean).join(' · '), body });
    body.querySelector('[data-view]').addEventListener('click', () => global.Exercises.openDetail(item.exerciseId));
  }

  function openItem(wid, itemId) {
    const w = get(wid);
    const item = w && w.exercises.find((x) => x.id === itemId);
    if (!item) return;
    if (w.managed) return openManagedItem(w, item);
    const info = global.Exercises.resolve(item);
    const cur = { sets: item.sets, repMin: item.repMin, repMax: item.repMax };

    const body = U.h(`
      <div>
        <p class="scheme-preview num" data-preview>${scheme(cur)}</p>
        <div class="group mt-6">
          <div class="row"><span class="row-main row-title">Séries</span><span data-slot="sets"></span></div>
          <div class="row"><span class="row-main"><span class="row-title block">Reps mínimas</span></span><span data-slot="repMin"></span></div>
          <div class="row"><span class="row-main"><span class="row-title block">Reps máximas</span></span><span data-slot="repMax"></span></div>
        </div>
        <p class="t-footnote group-note">${item.base && !item.manual
          ? 'Este exercício segue a progressão semanal do programa. Se você mudar aqui, ele passa a usar os seus valores.'
          : item.base ? 'Você ajustou este exercício: ele usa os seus valores, não os da progressão do programa.'
          : 'Quando você fizer o máximo em todas as séries, o FORJA sugere subir a carga.'}</p>

        <div class="group mt-8 has-icons">
          <button type="button" class="row" data-view><span class="row-icon">${icon('info', { size: 20 })}</span><span class="row-main row-title">Ver exercício</span></button>
          <button type="button" class="row" data-substitute><span class="row-icon">${icon('swap', { size: 20 })}</span><span class="row-main row-title">Substituir exercício</span></button>
          <button type="button" class="row is-danger" data-remove><span class="row-icon">${icon('trash', { size: 20 })}</span><span class="row-main row-title">Remover do treino</span></button>
        </div>
      </div>`);

    const sheet = UI.openSheet({
      title: info.name,
      subtitle: [info.muscle, info.equipment].filter(Boolean).join(' · '),
      body,
      onClose: (reason) => { if (reason !== 'removed') Router().refresh(); }
    });

    const preview = body.querySelector('[data-preview]');
    const save = () => { preview.textContent = scheme(cur); updateItem(wid, itemId, Object.assign({}, cur)); };

    const setsStep = UI.stepper({ value: cur.sets, min: LIMITS.sets[0], max: LIMITS.sets[1], label: 'séries', onChange: (v) => { cur.sets = v; save(); } });
    const maxStep = UI.stepper({ value: cur.repMax, min: cur.repMin, max: LIMITS.repMax[1], label: 'repetições máximas', onChange: (v) => { cur.repMax = v; save(); } });
    const minStep = UI.stepper({
      value: cur.repMin, min: LIMITS.repMin[0], max: LIMITS.repMin[1], label: 'repetições mínimas',
      onChange: (v) => {
        cur.repMin = v;
        // O máximo nunca fica abaixo do mínimo
        cur.repMax = maxStep.setLimits(v, LIMITS.repMax[1]);
        save();
      }
    });
    body.querySelector('[data-slot="sets"]').appendChild(setsStep);
    body.querySelector('[data-slot="repMin"]').appendChild(minStep);
    body.querySelector('[data-slot="repMax"]').appendChild(maxStep);

    body.querySelector('[data-view]').addEventListener('click', () => global.Exercises.openDetail(item.exerciseId));
    body.querySelector('[data-substitute]').addEventListener('click', () => {
      sheet.close('removed');
      global.Exercises.openSubstitute({
        exerciseId: item.exerciseId,
        subtitle: `No lugar de ${info.name} em ${w.name}`,
        inUse: w.exercises.map((x) => x.exerciseId),
        onPick: (newId) => {
          const before = item.exerciseId;
          replaceItem(wid, itemId, newId);
          Router().refresh();
          UI.toast(`Substituído por ${global.Exercises.get(newId).name}`, {
            iconName: 'swap', action: 'Desfazer', duration: 5000,
            onAction: () => { replaceItem(wid, itemId, before); Router().refresh(); }
          });
        }
      });
    });
    body.querySelector('[data-remove]').addEventListener('click', () => { sheet.close('removed'); removeItem(wid, itemId); });
  }

  /* ==========================================================================
     Telas
     ========================================================================== */
  let organizing = { list: false, detail: false };

  const moveButtons = (i, n) => `
    <span class="order-controls">
      <span class="order-arrows">
        <button type="button" class="order-btn" data-move="-1" aria-label="Mover para cima" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp', { size: 14, stroke: 2.2 })}</button>
        <button type="button" class="order-btn" data-move="1" aria-label="Mover para baixo" ${i === n - 1 ? 'disabled' : ''}>${icon('arrowDown', { size: 14, stroke: 2.2 })}</button>
      </span>
      <span class="drag-handle" data-sort-handle aria-hidden="true">${icon('grip', { size: 18, stroke: 2 })}</span>
    </span>`;

  function renderScreen(root, params = []) {
    // "Organizar" vale só enquanto você está na tela; ao navegar para outra, desliga
    const prev = Router().current();
    const path = ['workouts'].concat(params).join('/');
    if (!prev || prev.path !== path) organizing = { list: false, detail: false };
    if (params[0] === 'programs') return global.Programs.render(root, params[1]);
    if (params[0]) return renderDetail(root, params[0]);
    return renderList(root);
  }

  /* ---------- Lista ---------- */
  function renderList(root) {
    const list = all();
    const nextW = next();
    if (list.length < 2) organizing.list = false;
    const org = organizing.list;

    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <h1 class="t-large-title" data-large-title>Seus treinos</h1>
          <div class="flex items-center gap-2">
            ${list.length > 1 ? `<button class="text-btn" data-organize>${org ? 'OK' : 'Organizar'}</button>` : ''}
            ${org ? '' : `<button class="icon-btn" data-create aria-label="Criar treino">${icon('plus', { size: 20, stroke: 2 })}</button>`}
          </div>
        </header>

        ${org ? '' : global.Programs.state() ? `<div class="mt-8">${global.Programs.statusCardHTML()}</div>` : ''}

        ${list.length ? `
          <div class="workout-list mt-8 ${org ? 'is-organizing' : 'reveal'}" data-list>
            ${list.map((w, i) => `
              <article class="workout-card" data-sort-item data-id="${esc(w.id)}" style="--tint:${esc(w.color || 'var(--accent)')};--i:${i}">
                <button type="button" class="workout-card-main" data-open ${org ? 'tabindex="-1"' : ''}>
                  ${!org && (nextW && nextW.id === w.id || w.managed) ? `<span class="workout-card-badges">${nextW && nextW.id === w.id ? '<span class="badge">Próximo</span>' : ''}${w.managed ? `<span class="badge is-trainer">${icon('user', { size: 11, stroke: 2.4 })} Treinador</span>` : ''}</span>` : ''}
                  <span class="workout-card-name">${esc(w.name)}</span>
                  <span class="workout-card-meta">${esc(muscleSummary(w) || 'Sem exercícios ainda')}</span>
                  <span class="workout-card-count">${exerciseCount(w)}${w.exercises.length ? ` · ${U.plural(totalSets(w), 'série', 'séries')}` : ''}</span>
                </button>
                ${org ? moveButtons(i, list.length) : `<span class="workout-card-chevron">${icon('chevronRight', { size: 20, stroke: 2 })}</span>`}
              </article>`).join('')}
          </div>
          ${org ? '<p class="t-footnote mt-5 text-center">Arraste pela alça ou use as setas.</p>' : `
            ${global.Plans.isPremium() ? '' : `<p class="t-footnote mt-5 mx-1">${Math.min(list.length, global.Plans.FREE_WORKOUTS)} de ${global.Plans.FREE_WORKOUTS} treinos do plano Free${list.length >= global.Plans.FREE_WORKOUTS ? ' · <button type="button" class="text-btn rm-inline" data-paywall="workouts">Liberar ilimitados</button>' : ''}</p>`}
            <div class="mt-8">${global.Programs.promoCardHTML()}</div>`}` : `
          <div class="mt-8 reveal">
            <div class="empty">
              <div class="empty-icon">${icon('dumbbell', { size: 26 })}</div>
              <p class="empty-title">Ainda não há treinos</p>
              <p class="empty-text">Comece com um programa pronto ou monte o seu do zero.</p>
              <button class="btn btn-primary" data-go="workouts/programs">Ver programas prontos</button>
              <button class="btn btn-ghost is-muted mt-2" data-create>Criar do zero</button>
            </div>
          </div>`}
      </section>`;

    root.querySelectorAll('[data-create]').forEach((b) => b.addEventListener('click', openCreate));
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => Router().go(b.dataset.go)));
    const orgBtn = root.querySelector('[data-organize]');
    if (orgBtn) orgBtn.addEventListener('click', () => { organizing.list = !organizing.list; Router().refresh(); });

    const listEl = root.querySelector('[data-list]');
    if (!listEl) return;
    listEl.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const mv = e.target.closest('[data-move]');
      if (mv) {
        const i = list.findIndex((w) => w.id === card.dataset.id);
        moveWorkout(i, i + Number(mv.dataset.move));
        Router().refresh();
        return;
      }
      if (!org && e.target.closest('[data-open]')) Router().go(`workouts/${card.dataset.id}`);
    });
    if (org) UI.sortable(listEl, { onReorder: (from, to) => { moveWorkout(from, to); Router().refresh(); } });
  }

  /* ---------- Detalhe ---------- */
  function renderDetail(root, id) {
    const w = get(id);
    if (!w) {
      root.innerHTML = `
        ${navbarHTML('')}
        <section class="page has-navbar">
          <div class="empty mt-6">
            <div class="empty-icon">${icon('dumbbell', { size: 26 })}</div>
            <p class="empty-title">Treino não encontrado</p>
            <p class="empty-text">Ele pode ter sido excluído.</p>
            <button class="btn btn-secondary" data-back>Ver treinos</button>
          </div>
        </section>`;
      return;
    }

    const items = w.exercises;
    const managed = isManaged(w);
    if ((items.length < 2 || managed) && organizing.detail) organizing.detail = false;
    const org = organizing.detail;
    const muscles = w.muscleGroup || muscleSummary(w, 4);

    root.innerHTML = `
      ${navbarHTML(w.name, `<button class="icon-btn" data-menu aria-label="Mais opções">${icon('more', { size: 20 })}</button>`)}
      <section class="page has-navbar">
        <header class="detail-head" style="--tint:${esc(w.color || 'var(--accent)')}">
          <span class="workout-swatch"></span>
          <h1 class="t-large-title mt-4" data-large-title>${esc(w.name)}</h1>
          ${w.description ? `<p class="t-sub mt-2">${esc(w.description)}</p>` : ''}
          <p class="t-callout mt-3">${[muscles, exerciseCount(w), items.length ? U.plural(totalSets(w), 'série', 'séries') : ''].filter(Boolean).map(esc).join(' · ')}</p>
          ${managedNoteHTML(w)}
        </header>

        ${items.length ? `<button class="btn btn-primary btn-block mt-8" data-start>${icon('play', { size: 16, stroke: 2 })} ${global.Sessions.active()?.workoutId === w.id ? 'Continuar treino' : 'Começar treino'}</button>` : ''}

        <div class="section">
          <div class="section-head">
            <p class="t-eyebrow">Exercícios</p>
            ${items.length > 1 && !managed ? `<button class="text-btn" data-organize>${org ? 'OK' : 'Organizar'}</button>` : ''}
          </div>

          ${items.length ? `
            <ol class="group item-list ${org ? 'is-organizing' : ''}" data-list>
              ${items.map((x, i) => {
                const info = global.Exercises.resolve(x);
                return `
                <li class="row item-row" data-sort-item data-item="${esc(x.id)}">
                  ${org ? `<button type="button" class="remove-btn" data-remove aria-label="Remover ${esc(info.name)}">${icon('minus', { size: 14, stroke: 2.6 })}</button>`
                        : `<span class="item-index num">${i + 1}</span>`}
                  <button type="button" class="row-main item-main" data-edit ${org ? 'tabindex="-1"' : ''}>
                    <span class="row-title clamp-2">${esc(info.name)}</span>
                    <span class="row-sub block">${esc([info.muscle, info.equipment].filter(Boolean).join(' · '))}</span>
                    ${hasPrescription(x) ? `<span class="row-sub block item-rx">${esc(prescriptionText(x))}${x.notes ? `${prescriptionText(x) ? ' · ' : ''}${icon('info', { size: 12, stroke: 2.2, cls: 'inline-icon' })} obs.` : ''}</span>` : ''}
                  </button>
                  ${org ? moveButtons(i, items.length) : `<span class="item-scheme num">${scheme(x)}</span>`}
                </li>`;
              }).join('')}
            </ol>` : `
            <div class="empty">
              <div class="empty-icon">${icon('list', { size: 24 })}</div>
              <p class="empty-title">Nenhum exercício ainda</p>
              <p class="empty-text">${managed ? 'Seu treinador ainda não adicionou exercícios.' : 'Escolha os exercícios deste treino na biblioteca.'}</p>
            </div>`}

          ${org || managed ? '' : `<button class="btn ${items.length ? 'btn-secondary' : 'btn-primary'} btn-block mt-4" data-add>${icon('plus', { size: 18, stroke: 2 })} Adicionar exercícios</button>`}
        </div>
      </section>`;

    root.querySelector('[data-add]')?.addEventListener('click', () => openAddExercises(id));
    root.querySelector('[data-start]')?.addEventListener('click', () => global.Sessions.begin(id));
    root.querySelector('[data-organize]')?.addEventListener('click', () => { organizing.detail = !organizing.detail; Router().refresh(); });
    root.querySelector('[data-menu]').addEventListener('click', () => openMenu(id));

    const listEl = root.querySelector('[data-list]');
    if (!listEl) return;
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-item]');
      if (!row) return;
      const index = get(id).exercises.findIndex((x) => x.id === row.dataset.item);
      const mv = e.target.closest('[data-move]');
      if (mv) { moveItem(id, index, index + Number(mv.dataset.move)); Router().refresh(); return; }
      if (e.target.closest('[data-remove]')) { removeItem(id, row.dataset.item); return; }
      if (!org && e.target.closest('[data-edit]')) openItem(id, row.dataset.item);
    });
    if (org) UI.sortable(listEl, { onReorder: (from, to) => { moveItem(id, from, to); Router().refresh(); } });
  }

  const navbarHTML = (title, actions = '') => UI.navbarHTML(title, 'Treinos', actions);

  function openMenu(id) {
    const w = get(id);
    if (!w) return;
    if (w.managed) {
      return UI.actionSheet({
        title: w.name,
        subtitle: 'Treino montado pelo seu treinador',
        actions: [
          { label: 'Duplicar como meu treino', icon: 'copy', onSelect: () => {
            if (!global.Plans.canCreateWorkout()) return global.Plans.openPaywall('workouts');
            const c = duplicate(id); Router().go(`workouts/${c.id}`); UI.toast('Cópia criada. Essa você pode editar.');
          } }
        ]
      });
    }
    UI.actionSheet({
      title: w.name,
      actions: [
        { label: 'Editar nome, descrição e cor', icon: 'edit', onSelect: () => openForm({ workout: w, onSaved: () => { Router().refresh(); UI.toast('Salvo'); } }) },
        { label: 'Duplicar treino', icon: 'copy', onSelect: () => {
          if (!global.Plans.canCreateWorkout()) return global.Plans.openPaywall('workouts');
          const c = duplicate(id); Router().go(`workouts/${c.id}`); UI.toast('Cópia criada');
        } },
        { label: 'Excluir treino', icon: 'trash', danger: true, onSelect: () => { Router().back('workouts'); remove(id); } }
      ]
    });
  }

  global.Workouts = {
    COLORS, all, get, next, muscleSummary, exerciseCount, totalSets, scheme,
    isManaged, fmtRest, prescriptionText, mergeRemote, applyRemote,
    create, update, duplicate, remove, moveWorkout, addExercises, updateItem, removeItem, moveItem, replaceItem, replaceExercise,
    openCreate, openForm, openAddExercises, openItem, renderScreen
  };
})(window);
