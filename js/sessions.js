/* FORJA — sessões: histórico, treino em andamento e modo treino
   · O treino em andamento vive em Store 'active' e é salvo a cada toque (carga, reps, série concluída).
   · Fechar o navegador no meio do treino não perde nada: ao abrir de novo, o app oferece continuar.
   · NÃO existe sistema de descanso. O único relógio é o tempo total desde o início do treino.

   Treino em andamento:
   { id, workoutId, name, color, startedAt, updatedAt, cursor,
     exercises: [{ id, exerciseId, name, muscle, equipment, target: { sets, repMin, repMax }, focus,
                   sets: [{ id, weightKg, reps, plan: { weightKg, reps }, type, done, touched, completedAt }] }],
     finishing: { endedAt, rpe, mood, notes } }   ← só existe na tela de conclusão */
(function (global) {
  'use strict';
  const { Store, U, UI, Statistics } = global;
  const { esc, icon } = U;
  const now = () => new Date().toISOString();

  /* ==========================================================================
     Histórico
     ========================================================================== */
  const byDateDesc = (a, b) => new Date(b.startedAt) - new Date(a.startedAt);

  function all() { return [...Store.get('sessions')].sort(byDateDesc); }
  function last() { return all()[0] || null; }
  function lastForWorkout(workoutId) { return all().find((s) => s.workoutId === workoutId) || null; }
  function active() { return Store.get('active'); }
  function get(id) { return Store.get('sessions').find((s) => s.id === id) || null; }

  // Todas as séries de trabalho já registradas de um exercício (base para recordes)
  function priorSetsFor(exerciseId) {
    return Store.get('sessions').flatMap((s) => (s.exercises || [])
      .filter((e) => e.exerciseId === exerciseId)
      .flatMap((e) => (e.sets || []).filter(Statistics.isWorkingSet)));
  }

  // Excluir do histórico (recordes e estatísticas são recalculados), com desfazer
  function removeSession(id, after) {
    const s = get(id);
    if (!s) return;
    Store.update('sessions', (list) => list.filter((x) => x.id !== id));
    if (after) after();
    UI.toast(`${s.name} removido do histórico`, {
      iconName: 'trash', action: 'Desfazer', duration: 6000,
      onAction: () => { Store.update('sessions', (list) => { list.push(s); }); global.App.Router.refresh(); }
    });
  }

  // Última vez que o exercício foi feito (apenas séries de trabalho)
  function lastPerformance(exerciseId) {
    for (const s of all()) {
      const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      const sets = (ex.sets || []).filter(Statistics.isWorkingSet);
      if (sets.length) return { date: s.startedAt, sets };
    }
    return null;
  }

  /* ==========================================================================
     Progressão: sugere, nunca altera sozinho
     ========================================================================== */
  function nextLoad(kg, equipment) {
    const light = equipment === 'Halteres';
    if (U.currentUnit() === 'lb') return U.round(U.fromUnit(Math.round(U.toUnit(kg, 'lb')) + (light ? 2.5 : 5), 'lb'), 3);
    return U.round(kg + (light || kg < 10 ? 1 : 2.5), 2);
  }

  // Todas as séries planejadas no topo da faixa de repetições
  function reachedTop(sets, target) {
    const ws = sets.filter(Statistics.isWorkingSet);
    return !!target && ws.length >= target.sets && ws.every((s) => s.reps >= target.repMax) && ws.some((s) => s.weightKg > 0);
  }

  /* ==========================================================================
     Smart Coach — lê as últimas vezes do exercício (séries, reps e o RPE do treino)
     e sugere o próximo passo. Progressão dupla: completa a faixa de reps → sobe a carga.
     Sempre uma sugestão com botão; nunca muda nada sozinho.
     ========================================================================== */
  function recentPerformances(exerciseId, n = 2) {
    const out = [];
    for (const s of all()) {
      const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
      if (!ex) continue;
      const sets = (ex.sets || []).filter(Statistics.isWorkingSet);
      if (!sets.length) continue;
      out.push({ date: s.startedAt, sets, rpe: s.rpe ?? null });
      if (out.length >= n) break;
    }
    return out;
  }

  function loadStep(equipment, kg) {
    if (U.currentUnit() === 'lb') return U.fromUnit(equipment === 'Halteres' ? 2.5 : 5, 'lb');
    return equipment === 'Halteres' || kg < 10 ? 1 : 2.5;
  }

  function coachAdvice(exerciseId, target, equipment) {
    if (!target) return null;
    const perf = recentPerformances(exerciseId, 2);
    if (!perf.length) return null;
    const last = perf[0];
    const top = Math.max(...last.sets.map((s) => s.weightKg || 0));
    const main = last.sets.filter((s) => (s.weightKg || 0) === top);        // séries com a carga principal
    const reps = main.map((s) => s.reps);
    const repText = reps.every((r) => r === reps[0]) ? `${main.length}×${reps[0]}` : `${reps.join('/')} reps`;
    const done = `${repText} com ${U.fmtWeight(top, { dec: 2 })}`;
    const rpe = last.rpe != null ? ` (RPE ${last.rpe})` : '';
    const complete = last.sets.length >= target.sets;
    const allMax = complete && last.sets.every((s) => s.reps >= target.repMax);
    const inRange = reps.every((r) => r >= target.repMin);
    const failed = reps.some((r) => r < target.repMin);
    const easy = last.rpe != null && last.rpe <= 7;

    // Peso corporal: a progressão é em repetições
    if (top <= 0) {
      if (inRange && !allMax) return { kind: 'reps', title: 'Busque mais repetições', text: `No último treino você fez ${repText}${rpe}. Tente 1 repetição a mais por série.`, from: 0, to: 0, reps: Math.min(target.repMax, Math.max(...reps) + 1) };
      return null;
    }
    if (allMax || (easy && inRange && complete)) {
      const to = nextLoad(top, equipment);
      const why = allMax ? `e chegou ao topo da faixa (${target.repMax} reps)` : 'com facilidade';
      return { kind: 'increase', title: 'Hora de subir a carga', text: `No último treino você fez ${done} ${why}${rpe}. Tente ${U.fmtWeight(to, { dec: 2 })} hoje.`, from: top, to };
    }
    if (failed) {
      const prev = perf[1];
      const prevTop = prev ? Math.max(...prev.sets.map((s) => s.weightKg || 0)) : null;
      const prevFailed = prev && prevTop === top && prev.sets.filter((s) => (s.weightKg || 0) === top).some((s) => s.reps < target.repMin);
      if (prevFailed) {
        const step = loadStep(equipment, top);
        const to = Math.max(step, Math.floor((top * 0.9) / step) * step);
        return { kind: 'deload', title: 'Um passo atrás para subir', text: `Nos dois últimos treinos algumas séries ficaram abaixo de ${target.repMin} reps com ${U.fmtWeight(top, { dec: 2 })}. Que tal ${U.fmtWeight(to, { dec: 2 })} hoje, completando a faixa com boa execução?`, from: top, to };
      }
      return { kind: 'hold', title: 'Mantenha a carga', text: `No último treino você fez ${done}${rpe}, abaixo de ${target.repMin} reps em alguma série. Mantenha ${U.fmtWeight(top, { dec: 2 })} e tente completar a faixa.`, from: top, to: top };
    }
    return {
      kind: 'reps', title: 'Busque mais repetições',
      text: `No último treino você fez ${done}${rpe}. Mantenha ${U.fmtWeight(top, { dec: 2 })} e busque 1 repetição a mais por série até chegar a ${target.repMax}.`,
      from: top, to: top, reps: Math.min(target.repMax, Math.max(...reps) + 1)
    };
  }

  // Semana de recuperação do programa: ~70% da carga da última vez, longe da falha
  function deloadAdvice(exerciseId, equipment) {
    const perf = recentPerformances(exerciseId, 1)[0];
    if (!perf) return { kind: 'deload', title: 'Semana de recuperação', text: 'Use cargas leves e foque na técnica. Termine cada série bem longe da falha.', from: 0, to: 0 };
    const top = Math.max(...perf.sets.map((s) => s.weightKg || 0));
    if (top <= 0) return { kind: 'deload', title: 'Semana de recuperação', text: 'Faça cerca de metade das repetições de costume, sem chegar perto da falha.', from: 0, to: 0 };
    const step = loadStep(equipment, top);
    const to = Math.max(step, Math.floor((top * 0.7) / step) * step);
    return { kind: 'deload', title: 'Semana de recuperação', text: `Use cerca de 70% da carga: ${U.fmtWeight(to, { dec: 2 })} em vez de ${U.fmtWeight(top, { dec: 2 })}. Foque na técnica e termine longe da falha.`, from: top, to };
  }

  /* ==========================================================================
     Treino em andamento (cada mudança é persistida na hora)
     ========================================================================== */
  function mutate(fn) {
    Store.update('active', (a) => {
      if (!a) return;
      fn(a);
      a.updatedAt = now();
    });
  }

  const defaultReps = (muscle) => (muscle === 'Panturrilha' || muscle === 'Abdômen' ? [12, 15] : [8, 12]);

  // Séries já preenchidas com o que foi feito da última vez (o que tentar superar)
  function entryFor(item) {
    const info = global.Exercises.resolve(item);
    const lp = lastPerformance(item.exerciseId);
    // Sem histórico, a carga indicada pelo treinador é o ponto de partida
    const rxLoad = item.loadKg != null ? item.loadKg : null;
    const sets = Array.from({ length: item.sets }, (_, i) => {
      const ref = lp ? (lp.sets[i] || lp.sets[lp.sets.length - 1]) : null;
      const plan = { weightKg: ref ? ref.weightKg : rxLoad, reps: ref ? ref.reps : item.repMin };
      return { id: U.uid('s_'), weightKg: plan.weightKg, reps: plan.reps, plan, type: 'normal', done: false };
    });
    const entry = {
      id: U.uid('se_'), exerciseId: item.exerciseId, name: info.name, muscle: info.muscle, equipment: info.equipment || '',
      target: { sets: item.sets, repMin: item.repMin, repMax: item.repMax }, sets
    };
    // Prescrição do treinador (só exibida; o FORJA não tem cronômetro de descanso)
    if (item.loadKg != null || item.restSec != null || item.notes) entry.rx = { loadKg: rxLoad, restSec: item.restSec != null ? item.restSec : null, notes: item.notes || '' };
    return entry;
  }

  function startWorkout(workoutId) {
    const w = global.Workouts.get(workoutId);
    if (!w) return null;
    const a = {
      id: U.uid('ss_'), workoutId: w.id, name: w.name, color: w.color,
      startedAt: now(), updatedAt: now(), cursor: 0,
      exercises: w.exercises.map(entryFor)
    };
    // Semana do programa (a de recuperação muda o conselho do Coach)
    const phase = global.Programs && global.Programs.phaseForWorkout(w.id);
    if (phase) a.phase = phase.key;
    Store.set('active', a);
    return a;
  }

  // Série em foco: a tocada pelo usuário ou a primeira ainda não feita
  function currentIndex(ex) {
    if (ex.focus != null && ex.sets[ex.focus] && !ex.sets[ex.focus].done) return ex.focus;
    return ex.sets.findIndex((s) => !s.done);
  }

  function setValues(ei, si, patch) {
    mutate((a) => { Object.assign(a.exercises[ei].sets[si], patch, { touched: true }); });
  }

  function completeSet(ei, si, records = []) {
    mutate((a) => {
      const ex = a.exercises[ei];
      const s = ex.sets[si];
      s.done = true;
      s.completedAt = now();
      if (records.length) s.records = records; else delete s.records;
      delete ex.focus;
      // Se a carga mudou em relação ao plano, a próxima série acompanha (a menos que você já a tenha ajustado)
      const next = ex.sets.find((x, i) => i > si && !x.done);
      if (next && !next.touched && (next.weightKg == null || s.weightKg !== s.plan.weightKg)) next.weightKg = s.weightKg;
    });
  }

  function uncompleteSet(ei, si) {
    mutate((a) => { const s = a.exercises[ei].sets[si]; s.done = false; delete s.completedAt; });
  }

  function addSet(ei) {
    mutate((a) => {
      const ex = a.exercises[ei];
      const ref = ex.sets[ex.sets.length - 1] || { weightKg: null, reps: ex.target.repMin };
      ex.sets.push({ id: U.uid('s_'), weightKg: ref.weightKg, reps: ref.reps, plan: { weightKg: ref.weightKg, reps: ref.reps }, type: 'normal', done: false });
    });
  }

  function removeSet(ei, si) {
    mutate((a) => { const ex = a.exercises[ei]; ex.sets.splice(si, 1); delete ex.focus; });
  }

  function setCursor(i) {
    mutate((a) => { a.cursor = U.clamp(i, 0, a.exercises.length - 1); });
  }

  function addExercises(ids) {
    mutate((a) => {
      ids.forEach((id) => {
        const ex = global.Exercises.get(id);
        if (!ex) return;
        const [repMin, repMax] = defaultReps(ex.muscle);
        a.exercises.push(entryFor({ exerciseId: id, name: ex.name, muscle: ex.muscle, sets: 3, repMin, repMax }));
      });
    });
  }

  const doneCount = (a) => a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const plannedCount = (a) => a.exercises.reduce((n, e) => n + e.sets.length, 0);

  /* ---------- Conclusão ---------- */
  function beginFinish() {
    mutate((a) => { a.finishing = a.finishing || { endedAt: now(), rpe: null, mood: null, notes: '' }; });
  }
  function cancelFinish() { mutate((a) => { delete a.finishing; }); }
  function updateFinish(patch) { mutate((a) => { if (a.finishing) Object.assign(a.finishing, patch); }); }

  function summary(a) {
    const end = a.finishing ? new Date(a.finishing.endedAt) : new Date();
    const exercises = a.exercises
      .map((ex) => Object.assign({}, ex, { sets: ex.sets.filter((s) => s.done) }))
      .filter((ex) => ex.sets.length);
    const working = exercises.flatMap((ex) => ex.sets.filter(Statistics.isWorkingSet));
    return {
      durationSec: Math.max(0, Math.round((end - new Date(a.startedAt)) / 1000)),
      exercises,
      sets: working.length,
      reps: working.reduce((n, s) => n + (s.reps || 0), 0),
      volume: working.reduce((v, s) => v + Statistics.calculateVolume(s.weightKg, s.reps), 0)
    };
  }

  // A sessão exatamente como será salva (também usada no card de compartilhamento antes de salvar)
  function previewSession() {
    const a = active();
    return a ? buildSession(a) : null;
  }

  function finishWorkout() {
    const a = active();
    if (!a) return null;
    const session = buildSession(a);
    // Primeiro grava no histórico; só depois encerra o treino em andamento (nunca os dois perdidos)
    if (!Store.get('sessions').some((s) => s.id === a.id)) Store.update('sessions', (list) => { list.push(session); });
    Store.set('active', null);
    return session;
  }

  function buildSession(a) {
    const sum = summary(a);
    const f = a.finishing || {};
    return {
      id: a.id, workoutId: a.workoutId, name: a.name, color: a.color,
      startedAt: a.startedAt, endedAt: f.endedAt || now(), durationSec: sum.durationSec,
      exercises: sum.exercises.map((ex) => ({
        exerciseId: ex.exerciseId, name: ex.name, muscle: ex.muscle, target: ex.target,
        sets: ex.sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps, type: s.type || 'normal', done: true, completedAt: s.completedAt }))
      })),
      rpe: f.rpe ?? null, mood: f.mood ?? null, notes: String(f.notes || '').trim()
    };
  }

  function discard() {
    const backup = active();
    Store.set('active', null);
    return backup;
  }

  /* ==========================================================================
     Modo treino (tela cheia)
     ========================================================================== */
  const T = { open: false, clock: null, lock: null, bound: false };
  const root = () => document.getElementById('training');

  const unit = () => U.currentUnit();
  const wNum = (kg) => (kg == null ? '—' : U.fmtNum(U.round(U.toUnit(kg), 2), 2));
  const wInput = (kg) => (kg == null ? '' : wNum(kg).replace(/\./g, ''));
  const setText = (s) => `${wNum(s.weightKg)} ${unit()} × ${s.reps}`;
  const shortSet = (s) => `${wNum(s.weightKg)} × ${s.reps}`;
  const schemeText = (t) => `${t.sets} × ${t.repMin === t.repMax ? t.repMin : `${t.repMin}–${t.repMax}`}`;
  const weightStep = (ex) => (unit() === 'lb' ? (ex.equipment === 'Halteres' ? 2.5 : 5) : (ex.equipment === 'Halteres' ? 1 : 2.5));
  const elapsed = (a) => ((a.finishing ? new Date(a.finishing.endedAt) : Date.now()) - new Date(a.startedAt)) / 1000;

  /* ---------- Relógio (tempo total) e tela acesa ---------- */
  function tick() {
    const a = active();
    if (!a) return syncClock();
    const text = U.fmtClock(elapsed(a));
    document.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = text; });
  }
  function syncClock() {
    if (active() && !T.clock) T.clock = setInterval(tick, 1000);
    if (!active() && T.clock) { clearInterval(T.clock); T.clock = null; }
  }

  async function keepAwake(on) {
    try {
      if (on && !T.lock && navigator.wakeLock) {
        T.lock = await navigator.wakeLock.request('screen');
        T.lock.addEventListener('release', () => { T.lock = null; });
      } else if (!on && T.lock) {
        const l = T.lock; T.lock = null; await l.release();
      }
    } catch (e) { /* sem suporte ou negado — segue normalmente */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && T.open) keepAwake(true);
    if (document.visibilityState === 'visible') tick();
  });

  /* ---------- Abrir, minimizar, fechar ---------- */
  function open() {
    if (!active()) return;
    const el = root();
    el.hidden = false;
    el.classList.remove('is-leaving');
    document.documentElement.classList.add('training-open');
    T.open = true;
    bind();
    render('tr-in-up');
    syncClock();
    syncActiveBar();
    keepAwake(true);
  }

  function hide() {
    T.open = false;
    keepAwake(false);
    const el = root();
    el.classList.add('is-leaving');
    setTimeout(() => { if (!T.open) { el.hidden = true; el.classList.remove('is-leaving'); el.innerHTML = ''; } }, 240);
    document.documentElement.classList.remove('training-open');
    syncClock();
    syncActiveBar();
  }

  function minimize() {
    hide();
    global.App.Router.refresh();
  }

  // Começar a partir de um treino (Home ou tela do treino)
  function begin(workoutId) {
    const w = global.Workouts.get(workoutId);
    if (!w) return;
    if (!w.exercises.length) {
      UI.toast('Adicione exercícios a este treino primeiro', { iconName: 'info' });
      global.App.Router.go(`workouts/${w.id}`);
      return;
    }
    const a = active();
    if (a) {
      if (a.workoutId === workoutId) return open();
      UI.confirmSheet({
        title: 'Treino em andamento',
        message: `Você já está no ${a.name} (${U.plural(doneCount(a), 'série registrada', 'séries registradas')}). Descartar e começar ${w.name}?`,
        confirmLabel: `Descartar e começar ${w.name}`, cancelLabel: `Continuar ${a.name}`, destructive: true,
        onConfirm: () => { discard(); startWorkout(workoutId); open(); },
        onCancel: open
      });
      return;
    }
    startWorkout(workoutId);
    open();
  }

  function discardFlow() {
    const backup = discard();
    if (T.open) hide();
    syncClock();
    syncActiveBar();
    global.App.Router.refresh();
    UI.toast('Treino descartado', {
      iconName: 'trash', action: 'Desfazer', duration: 6000,
      onAction: () => { Store.set('active', backup); syncClock(); syncActiveBar(); global.App.Router.refresh(); }
    });
  }

  // Ao abrir o app com um treino não finalizado
  function promptRecovery() {
    const a = active();
    if (!a) return;
    const secs = (Date.now() - new Date(a.startedAt)) / 1000;
    const since = secs < 60 ? 'agora há pouco' : `há ${U.fmtDuration(secs)}`;
    UI.confirmSheet({
      title: 'Treino em andamento',
      message: `Você possui um treino não finalizado: ${a.name}, iniciado ${since} · ${U.plural(doneCount(a), 'série registrada', 'séries registradas')}.`,
      confirmLabel: 'Continuar', cancelLabel: 'Descartar',
      onConfirm: open, onCancel: discardFlow
    });
  }

  /* ---------- Barra "treino em andamento" (quando minimizado) ---------- */
  function syncActiveBar() {
    const bar = document.getElementById('active-bar');
    if (!bar) return;
    const a = active();
    const current = global.App && global.App.Router.current();
    const onHome = current && current.route === 'home';   // a Home já mostra o treino em destaque
    const show = !!a && !T.open && !document.getElementById('app').hidden && !onHome;
    document.documentElement.classList.toggle('has-active', show);
    bar.hidden = !show;
    if (!show) return;
    bar.style.setProperty('--tint', a.color || 'var(--accent)');
    bar.innerHTML = `
      <span class="active-dot"></span>
      <span class="active-name">${esc(a.name)}</span>
      <span class="active-clock num" data-clock>${U.fmtClock(elapsed(a))}</span>
      <span class="active-cta">${a.finishing ? 'Concluir' : 'Continuar'}${icon('chevronRight', { size: 16, stroke: 2.2 })}</span>`;
  }

  /* ---------- Renderização ---------- */
  function render(motion = '', { justDone = null } = {}) {
    const a = active();
    const el = root();
    if (!a || !el) return;
    el.innerHTML = a.finishing ? summaryHTML(a, motion) : exerciseHTML(a, motion, justDone);
    if (a.finishing) bindSummary();
  }

  function exerciseHTML(a, motion, justDone) {
    const i = U.clamp(a.cursor || 0, 0, a.exercises.length - 1);
    const ex = a.exercises[i];
    const cur = currentIndex(ex);
    const exDone = ex.sets.length > 0 && cur === -1;
    const isLast = i === a.exercises.length - 1;
    const lp = lastPerformance(ex.exerciseId);
    const coach = ex.sets.some((s) => s.done) ? null
      : a.phase === 'deload' ? deloadAdvice(ex.exerciseId, ex.equipment)
      : coachAdvice(ex.exerciseId, ex.target, ex.equipment);
    const topNow = exDone && reachedTop(ex.sets, ex.target);
    const nextEx = a.exercises[i + 1];

    const segments = a.exercises.map((e, k) => {
      const p = e.sets.length ? e.sets.filter((s) => s.done).length / e.sets.length : 0;
      return `<span class="${k === i ? 'is-current' : ''}" style="--p:${p}"></span>`;
    }).join('');

    let main;
    if (!exDone) main = `<button type="button" class="btn btn-primary tr-main" data-complete ${cur < 0 ? 'disabled' : ''}>${icon('check', { size: 20, stroke: 2.4 })} Concluir série</button>`;
    else if (!isLast) main = `<button type="button" class="btn btn-primary tr-main" data-go="1">Próximo exercício ${icon('arrowRight', { size: 18, stroke: 2 })}</button>`;
    else main = `<button type="button" class="btn btn-primary tr-main" data-finish>Finalizar treino</button>`;

    return `
      <div class="tr-frame">
        <header class="tr-top">
          <button type="button" class="icon-btn is-plain" data-min aria-label="Minimizar treino">${icon('chevronDown', { size: 24, stroke: 2 })}</button>
          <span class="tr-clock num" data-clock aria-label="Tempo total do treino">${U.fmtClock(elapsed(a))}</span>
          <button type="button" class="text-btn" data-finish>Finalizar</button>
        </header>
        <div class="tr-segments" aria-hidden="true">${segments}</div>

        <main class="tr-body ${motion}" data-swipe>
          <button type="button" class="tr-context" data-toc>
            <span>${esc(a.name)}</span><span class="num">${i + 1} / ${a.exercises.length}</span>${icon('chevronDown', { size: 14, stroke: 2.4 })}
          </button>
          <h1 class="tr-name">${esc(ex.name)}</h1>
          <div class="tr-target-row">
            <p class="tr-target">${esc(ex.muscle)} · <span class="num">${schemeText(ex.target)}</span></p>
            <button type="button" class="swap-btn" data-swap aria-label="Trocar exercício">${icon('swap', { size: 15, stroke: 2 })} Trocar</button>
          </div>
          ${ex.swappedFrom ? `<p class="t-footnote mt-1">No lugar de ${esc((global.Exercises.get(ex.swappedFrom) || {}).name || 'outro exercício')}</p>` : ''}
          ${ex.rx ? `
            <div class="tr-rx">
              ${global.Workouts.prescriptionText(ex.rx) ? `<p class="tr-rx-line">${icon('user', { size: 13, stroke: 2.2 })} ${esc(global.Workouts.prescriptionText(ex.rx))}</p>` : ''}
              ${ex.rx.notes ? `<p class="tr-rx-notes">${esc(ex.rx.notes)}</p>` : ''}
            </div>` : ''}

          ${coach && !global.Plans.isPremium() ? `
            <button type="button" class="coach coach-locked" data-paywall="coach">
              <p class="coach-head">${icon('sparkle', { size: 15, stroke: 1.8 })} Coach <span class="premium-pill">${icon('lock', { size: 11, stroke: 2.4 })} Premium</span></p>
              <p class="coach-title">Tenho uma sugestão de carga para hoje</p>
              <p class="t-callout mt-1">O Coach analisou seu último treino neste exercício. Toque para ver com o Premium.</p>
            </button>` : ''}
          ${coach && global.Plans.isPremium() ? `
            <div class="coach coach-${coach.kind}">
              <p class="coach-head">${icon('sparkle', { size: 15, stroke: 1.8 })} Coach</p>
              <p class="coach-title">${esc(coach.title)}</p>
              <p class="t-callout mt-1">${esc(coach.text)}</p>
              ${coach.to !== coach.from ? `<p class="tr-tip-load num">${wNum(coach.from)} → ${wNum(coach.to)} <small>${unit()}</small></p>` : ''}
              ${coach.to !== coach.from ? `<button type="button" class="btn btn-secondary btn-sm mt-1" data-apply="${coach.to}">Usar ${wNum(coach.to)} ${unit()}</button>`
                : coach.reps ? `<button type="button" class="btn btn-secondary btn-sm mt-3" data-apply-reps="${coach.reps}">Meta: ${coach.reps} reps</button>` : ''}
            </div>` : ''}

          <section class="tr-last">
            <p class="t-eyebrow">${lp ? `Último treino · ${U.fmtDayMonth(lp.date)}` : 'Último treino'}</p>
            ${lp ? `<div class="tr-last-sets num">${lp.sets.map((s) => `<span>${shortSet(s)}</span>`).join('')}</div>`
                 : '<p class="t-callout mt-2">Primeira vez neste exercício.</p>'}
          </section>

          <ol class="tr-sets">
            ${ex.sets.map((s, si) => setRowHTML(s, si, si === cur, lp, si === justDone)).join('')}
          </ol>
          <button type="button" class="tr-add" data-add-set>${icon('plus', { size: 16, stroke: 2.2 })} Adicionar série</button>

          ${exDone ? `
            <div class="tr-done">
              <p class="tr-done-title">${icon('check', { size: 18, stroke: 2.4 })} Exercício concluído</p>
              ${(() => {
                const e1 = Math.max(0, ...ex.sets.filter((s) => s.done).map(Statistics.estimated1RMForSet));
                return e1 ? `<p class="t-callout mt-2">1RM estimado hoje: <span class="t-body num">${wNum(U.round(e1, 1))} ${unit()}</span></p>` : '';
              })()}
              ${topNow ? `<p class="t-callout mt-2">Você chegou ao topo da faixa em todas as séries. Na próxima, experimente ${wNum(nextLoad(Math.max(...ex.sets.filter((s) => s.done).map((s) => s.weightKg || 0)), ex.equipment))} ${unit()}.</p>` : ''}
              ${nextEx ? `<p class="t-callout mt-2">Próximo: <span class="t-body">${esc(nextEx.name)}</span></p>` : ''}
            </div>` : ''}
        </main>

        <footer class="tr-foot">
          <button type="button" class="icon-btn tr-nav" data-go="-1" aria-label="Exercício anterior" ${i === 0 ? 'disabled' : ''}>${icon('chevronLeft', { size: 22, stroke: 2 })}</button>
          ${main}
          <button type="button" class="icon-btn tr-nav" data-go="1" aria-label="Próximo exercício" ${isLast ? 'disabled' : ''}>${icon('chevronRight', { size: 22, stroke: 2 })}</button>
        </footer>
      </div>`;
  }

  // Valor grande no topo (toque para digitar) e − + logo abaixo, como no layout da especificação
  const fieldHTML = (key, label, value, suffix) => `
    <div class="tr-field" data-field="${key}">
      <span class="tr-label">${label}</span>
      <button type="button" class="tr-value num" data-type="${key}" aria-label="Digitar ${label.toLowerCase()}">
        <span data-value class="${value === '—' ? 'is-empty' : ''}">${value}</span>${suffix ? `<small>${suffix}</small>` : ''}
      </button>
      <div class="tr-control">
        <button type="button" class="tr-step" data-step="-1" aria-label="Diminuir ${label.toLowerCase()}">${icon('minus', { size: 18, stroke: 2.2 })}</button>
        <button type="button" class="tr-step" data-step="1" aria-label="Aumentar ${label.toLowerCase()}">${icon('plus', { size: 18, stroke: 2.2 })}</button>
      </div>
    </div>`;

  function setRowHTML(s, si, current, lp, justDone) {
    const ref = lp ? lp.sets[si] : null;
    if (current) {
      return `
        <li class="tr-set is-current" data-set="${si}">
          <div class="tr-set-head">
            <span class="t-eyebrow">Série ${si + 1}</span>
            ${ref ? `<span class="tr-set-last num">Último ${shortSet(ref)}</span>` : ''}
          </div>
          <div class="tr-editor">
            ${fieldHTML('weight', 'Carga', wNum(s.weightKg), unit())}
            ${fieldHTML('reps', 'Reps', s.reps == null ? '—' : String(s.reps), '')}
          </div>
        </li>`;
    }
    if (s.done) {
      return `
        <li class="tr-set is-done${justDone ? ' just-done' : ''}" data-set="${si}" role="button" tabindex="0">
          <span class="tr-set-mark">${icon('check', { size: 14, stroke: 2.8 })}</span>
          <span class="tr-set-label">Série ${si + 1}${s.records && s.records.length ? `<span class="pr-badge" title="Recorde">${icon('trophy', { size: 13, stroke: 2 })}</span>` : ''}</span>
          <span class="tr-set-value num">${setText(s)}</span>
        </li>`;
    }
    return `
      <li class="tr-set is-pending" data-set="${si}" role="button" tabindex="0">
        <span class="tr-set-mark num">${si + 1}</span>
        <span class="tr-set-label">Série ${si + 1}</span>
        <span class="tr-set-value num">${s.weightKg == null ? `— × ${s.reps}` : setText(s)}</span>
      </li>`;
  }

  /* ---------- Tela de conclusão ---------- */
  const MOODS = [['awful', '😫', 'Péssimo'], ['meh', '😐', 'Normal'], ['good', '🙂', 'Bom'], ['great', '😎', 'Ótimo'], ['fire', '🔥', 'Incrível']];
  const RPE_TEXT = { 1: 'Muito leve', 2: 'Leve', 3: 'Leve', 4: 'Moderado', 5: 'Moderado', 6: 'Um pouco difícil', 7: 'Difícil', 8: 'Muito difícil', 9: 'Quase no limite', 10: 'Esforço máximo' };
  const RPE_HINT = 'De 1 (muito leve) a 10 (esforço máximo).';

  function summaryHTML(a, motion) {
    const s = summary(a);
    const f = a.finishing;
    const t = U.durationParts(s.durationSec);
    const pending = plannedCount(a) - doneCount(a);
    const recs = sessionRecords(a);
    return `
      <div class="tr-frame is-summary">
        <header class="tr-top">
          <button type="button" class="nav-back" data-resume>${icon('chevronLeft', { size: 24, stroke: 2 })}<span>Voltar ao treino</span></button>
          <span></span><span></span>
        </header>

        <main class="tr-body ${motion}">
          <div class="tr-summary-head">
            <div class="ob-check">${icon('check', { size: 34, stroke: 2.4 })}</div>
            <p class="t-eyebrow t-accent">Treino concluído</p>
            <h1 class="tr-summary-name">${esc(a.name)}</h1>
          </div>

          <div class="summary-grid">
            <div class="summary-stat"><span class="summary-value num">${t.value}<small>${t.unit}</small></span><span class="stat-label">Duração</span></div>
            <div class="summary-stat"><span class="summary-value num">${s.exercises.length}</span><span class="stat-label">${s.exercises.length === 1 ? 'Exercício' : 'Exercícios'}</span></div>
            <div class="summary-stat"><span class="summary-value num">${s.sets}</span><span class="stat-label">${s.sets === 1 ? 'Série' : 'Séries'}</span></div>
            <div class="summary-stat"><span class="summary-value num">${U.fmtVolume(s.volume, { withUnit: false })}<small>${unit()}</small></span><span class="stat-label">Volume</span></div>
          </div>
          ${pending > 0 ? `<p class="t-footnote mt-5">${pending === 1 ? '1 série planejada não foi feita e não entra' : `${pending} séries planejadas não foram feitas e não entram`} no histórico.</p>` : ''}

          ${recs.length ? `
            <section class="section">
              <p class="t-eyebrow t-accent mb-4 flex items-center gap-2">${icon('trophy', { size: 14, stroke: 2 })} ${recs.length === 1 ? 'Novo recorde' : `${recs.length} novos recordes`}</p>
              <div class="group">
                ${recs.map((e) => `
                  <div class="row">
                    <span class="row-main"><span class="row-title block">${esc(e.name)}</span><span class="row-sub block">${e.types.map((t) => Statistics.RECORD_LABEL[t]).join(' · ')}</span></span>
                    <span class="row-value num t-accent">${recordValueText(e.primary)}</span>
                  </div>`).join('')}
              </div>
            </section>` : ''}

          <section class="section">
            <p class="t-eyebrow mb-5">Como foi?</p>

            <p class="form-label">Esforço percebido (RPE)</p>
            <div class="rpe-scale" role="radiogroup" aria-label="RPE de 1 a 10">
              ${Array.from({ length: 10 }, (_, k) => k + 1).map((n) => `<button type="button" role="radio" class="num" aria-checked="${f.rpe === n}" data-rpe="${n}">${n}</button>`).join('')}
            </div>
            <p class="t-footnote mt-2 mx-1" data-rpe-caption>${f.rpe ? `${f.rpe} · ${RPE_TEXT[f.rpe]}` : RPE_HINT}</p>

            <p class="form-label mt-7">Humor</p>
            <div class="mood-row" role="radiogroup" aria-label="Humor">
              ${MOODS.map(([v, e, label]) => `<button type="button" role="radio" aria-checked="${f.mood === v}" aria-label="${label}" title="${label}" data-mood="${v}">${e}</button>`).join('')}
            </div>

            <label class="form-label mt-7" for="tr-notes">Observações</label>
            <textarea id="tr-notes" class="field field-area" rows="3" maxlength="500" placeholder="Como foi o treino?">${esc(f.notes || '')}</textarea>
          </section>
        </main>

        <footer class="tr-foot">
          <button type="button" class="icon-btn tr-nav" data-share aria-label="Compartilhar treino">${icon('share', { size: 22, stroke: 1.8 })}</button>
          <button type="button" class="btn btn-primary btn-block tr-main" data-save>Salvar treino</button>
        </footer>
      </div>`;
  }

  function bindSummary() {
    const notes = root().querySelector('#tr-notes');
    // Observações também são salvas enquanto você digita
    if (notes) notes.addEventListener('input', U.debounce(() => updateFinish({ notes: notes.value }), 300));
  }

  /* ---------- Interações ---------- */
  function bind() {
    if (T.bound) return;
    T.bound = true;
    const el = root();
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tr-set[role="button"]')) { e.preventDefault(); e.target.click(); }
    });

    // Deslizar para os lados troca de exercício (os botões ‹ › fazem o mesmo)
    let sx = null, sy = 0;
    el.addEventListener('touchstart', (e) => {
      if (!e.target.closest('[data-swipe]') || e.touches.length !== 1) { sx = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function onClick(e) {
    const a = active();
    if (!a) return;
    const hit = (sel) => e.target.closest(sel);

    if (hit('[data-min]')) return minimize();
    if (hit('[data-resume]')) { cancelFinish(); return render('tr-in-prev'); }
    if (hit('[data-save]')) return save();
    if (hit('[data-share]')) return global.Share.open(previewSession());
    if (hit('[data-finish]')) return askFinish();
    if (hit('[data-toc]')) return openToc();
    const g = hit('[data-go]'); if (g) return go(Number(g.dataset.go));
    if (hit('[data-complete]')) return complete();
    if (hit('[data-add-set]')) { addSet(a.cursor); return render(); }
    const ap = hit('[data-apply]'); if (ap) return applyLoad(Number(ap.dataset.apply));
    const ar = hit('[data-apply-reps]'); if (ar) return applyReps(Number(ar.dataset.applyReps));
    if (hit('[data-swap]')) return openSwap();
    const st = hit('[data-step]'); if (st) return step(st.closest('[data-field]').dataset.field, Number(st.dataset.step));
    const ty = hit('[data-type]'); if (ty) return typeValue(ty.dataset.type);
    const rpe = hit('[data-rpe]'); if (rpe) return pickRpe(Number(rpe.dataset.rpe));
    const mood = hit('[data-mood]'); if (mood) return pickMood(mood.dataset.mood);
    const row = hit('.tr-set:not(.is-current)'); if (row) return tapSet(Number(row.dataset.set));
  }

  function go(dir) {
    const a = active();
    const next = U.clamp(a.cursor + dir, 0, a.exercises.length - 1);
    if (next === a.cursor) return;
    setCursor(next);
    render(dir > 0 ? 'tr-in-next' : 'tr-in-prev');
  }

  const bump = (el) => { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); };

  // − / + mudam só o número na tela (sem redesenhar) e salvam na hora
  function step(field, dir) {
    const a = active();
    const ei = a.cursor;
    const ex = a.exercises[ei];
    const si = currentIndex(ex);
    if (si < 0) return;
    const s = ex.sets[si];
    let patch;
    if (field === 'weight') {
      if (s.weightKg == null && dir < 0) return;
      const shown = s.weightKg == null ? 0 : U.toUnit(s.weightKg);
      const next = Math.max(0, U.round(shown + dir * weightStep(ex), 2));
      patch = { weightKg: U.round(U.fromUnit(next), 3) };
    } else {
      const next = U.clamp((s.reps || 0) + dir, 1, 100);
      if (next === s.reps) return;
      patch = { reps: next };
    }
    setValues(ei, si, patch);
    const out = root().querySelector(`[data-field="${field}"] [data-value]`);
    if (out) { out.textContent = field === 'weight' ? wNum(patch.weightKg) : String(patch.reps); out.classList.remove('is-empty'); bump(out); }
  }

  function parseWeight(v) {
    const n = U.parseDecimal(v);
    const max = unit() === 'lb' ? 2200 : 1000;
    if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, error: `Informe uma carga entre 0 e ${U.fmtNum(max)} ${unit()}.` };
    return { ok: true, value: U.round(U.fromUnit(n), 3) };
  }
  function parseReps(v) {
    const n = U.parseDecimal(v);
    if (!Number.isInteger(n) || n < 1 || n > 100) return { ok: false, error: 'Use um número inteiro de 1 a 100.' };
    return { ok: true, value: n };
  }

  function typeValue(field, subtitle = '') {
    const a = active();
    const ei = a.cursor;
    const ex = a.exercises[ei];
    const si = currentIndex(ex);
    if (si < 0) return;
    const s = ex.sets[si];
    const isW = field === 'weight';
    UI.inputSheet({
      title: isW ? `Carga · Série ${si + 1}` : `Repetições · Série ${si + 1}`,
      subtitle,
      value: isW ? wInput(s.weightKg) : String(s.reps ?? ''),
      placeholder: isW ? '0' : '10',
      suffix: isW ? unit() : 'reps',
      inputmode: isW ? 'decimal' : 'numeric',
      maxlength: 7,
      validate: isW ? parseWeight : parseReps,
      onSave: (v) => { setValues(ei, si, isW ? { weightKg: v } : { reps: v }); render(); }
    });
  }

  function complete() {
    const a = active();
    const ei = a.cursor;
    const ex = a.exercises[ei];
    const si = currentIndex(ex);
    if (si < 0) return;
    const s = ex.sets[si];
    if (s.weightKg == null) return typeValue('weight', 'Informe a carga desta série. Use 0 para peso corporal.');
    if (!s.reps || s.reps < 1) return typeValue('reps');
    // Recorde: compara com o histórico e com as séries já feitas hoje neste exercício
    const prior = priorSetsFor(ex.exerciseId).concat(ex.sets.filter((x, i) => i !== si && x.done && Statistics.isWorkingSet(x)));
    const records = Statistics.detectSetRecords(prior, Object.assign({}, s, { done: true }));
    completeSet(ei, si, records);
    U.haptic(records.length ? 'record' : 'success');
    render('', { justDone: si });
    if (records.length) showRecord(ex.name, s, records);
    // Mantém a próxima série visível
    const cur = root().querySelector('.tr-set.is-current, .tr-done');
    if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Ao corrigir uma série concluída, o selo de recorde é recalculado
  function refreshRecords(ei, si) {
    const a = active();
    const ex = a.exercises[ei];
    const s = ex.sets[si];
    if (!s || !s.done) return;
    const prior = priorSetsFor(ex.exerciseId).concat(ex.sets.filter((x, i) => i !== si && x.done && Statistics.isWorkingSet(x)));
    const records = Statistics.detectSetRecords(prior, s);
    mutate((d) => { const t = d.exercises[ei].sets[si]; if (records.length) t.records = records; else delete t.records; });
  }

  /* ---------- Animação de novo recorde ---------- */
  const RECORD_ORDER = ['weight', 'e1rm', 'reps'];

  function showRecord(name, set, types) {
    const L = Statistics.RECORD_LABEL;
    const type = RECORD_ORDER.find((t) => types.includes(t));
    const value = type === 'weight' ? `${wNum(set.weightKg)}<small>${unit()}</small>`
      : type === 'e1rm' ? `${wNum(Statistics.estimated1RMForSet(set))}<small>${unit()}</small>`
      : `${set.reps}<small>reps</small>`;
    const detail = type === 'reps' ? `com ${wNum(set.weightKg)} ${unit()}` : `${shortSet(set)}`;
    const others = types.filter((t) => t !== type).map((t) => L[t]);
    const el = U.h(`
      <div class="pr-overlay" role="alert" aria-live="assertive">
        <div class="pr-card">
          <div class="pr-icon">${icon('trophy', { size: 34, stroke: 1.6 })}</div>
          <p class="t-eyebrow t-accent">Novo recorde</p>
          <p class="pr-exercise">${esc(name)}</p>
          <p class="pr-value num">${value}</p>
          <p class="pr-sub">${L[type]} · ${detail}</p>
          ${others.length ? `<p class="pr-extra">Também: ${others.join(' · ')}</p>` : ''}
        </div>
      </div>`);
    root().appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    };
    el.addEventListener('click', close);
    setTimeout(close, 2800);
  }

  // Recordes batidos no treino de hoje (inclui volume, que só fecha no fim do exercício)
  function sessionRecords(a) {
    const sum = summary(a);
    const virtual = { id: a.id, startedAt: a.startedAt, exercises: sum.exercises };
    return Statistics.groupRecords(Statistics.calculatePersonalRecords(all().filter((s) => s.id !== a.id).concat([virtual]))
      .filter((e) => e.sessionId === a.id));
  }

  const recordValueText = (e) => (e.type === 'reps' ? `${e.reps} reps · ${wNum(e.weightKg)} ${unit()}`
    : e.type === 'volume' ? U.fmtVolume(e.value)
    : `${wNum(e.value)} ${unit()}`);

  function applyReps(reps) {
    const a = active();
    const ei = a.cursor;
    mutate((d) => { d.exercises[ei].sets.forEach((s) => { if (!s.done) { s.reps = reps; s.touched = true; } }); });
    render();
    UI.toast(`Meta de ${reps} reps nas próximas séries`);
  }

  /* ---------- Substituição inteligente no meio do treino ----------
     O substituto entra com o PRÓPRIO histórico de carga (entryFor busca a última vez dele).
     Se já houver séries feitas, elas ficam; o substituto recebe só as séries restantes. */
  function swapExercise(ei, newId) {
    const a = active();
    const ex = a.exercises[ei];
    const done = ex.sets.filter((s) => s.done).length;
    const remaining = Math.max(1, ex.sets.length - done);
    const entry = entryFor({ exerciseId: newId, sets: remaining, repMin: ex.target.repMin, repMax: ex.target.repMax });
    entry.target.sets = ex.target.sets;
    entry.swappedFrom = ex.swappedFrom || ex.exerciseId;
    mutate((d) => {
      if (!done) d.exercises.splice(ei, 1, entry);
      else {
        d.exercises[ei].sets = d.exercises[ei].sets.filter((s) => s.done);
        delete d.exercises[ei].focus;
        d.exercises.splice(ei + 1, 0, entry);
        d.cursor = ei + 1;
      }
    });
    return { entry, kept: done };
  }

  function openSwap() {
    const a = active();
    const ex = a.exercises[a.cursor];
    const done = ex.sets.filter((s) => s.done).length;
    global.Exercises.openSubstitute({
      exerciseId: ex.exerciseId,
      subtitle: `No lugar de ${ex.name}`,
      inUse: a.exercises.map((x) => x.exerciseId),
      note: done ? `As ${done === 1 ? '1 série feita fica' : `${done} séries feitas ficam`} em ${ex.name}; o substituto recebe as séries restantes.` : '',
      onPick: (newId) => {
        const original = ex.swappedFrom || ex.exerciseId;
        const { entry } = swapExercise(a.cursor, newId);
        render('tr-in-next');
        const w = global.Workouts.get(a.workoutId);
        // Treino do treinador não é alterado pelo aluno: a troca vale só para hoje
        const inTemplate = w && !w.managed && w.exercises.some((x) => x.exerciseId === original);
        UI.toast(`Trocado por ${entry.name}`, inTemplate ? {
          iconName: 'swap', duration: 6000, action: 'Manter no treino',
          onAction: () => {
            global.Workouts.replaceExercise(a.workoutId, original, newId);
            UI.toast(`${w.name} atualizado`);
          }
        } : { iconName: 'swap' });
      }
    });
  }

  function applyLoad(kg) {
    const a = active();
    const ei = a.cursor;
    mutate((d) => { d.exercises[ei].sets.forEach((s) => { if (!s.done) { s.weightKg = kg; s.touched = true; } }); });
    render();
    UI.toast(`Carga ajustada para ${wNum(kg)} ${unit()}`);
  }

  function tapSet(si) {
    const a = active();
    const ex = a.exercises[a.cursor];
    const s = ex.sets[si];
    if (!s) return;
    if (s.done) return openSetSheet(si);
    mutate((d) => { d.exercises[d.cursor].focus = si; });
    render();
  }

  // Editar uma série já concluída
  function openSetSheet(si) {
    const a = active();
    const ei = a.cursor;
    const ex = a.exercises[ei];
    const s = ex.sets[si];
    const body = U.h(`
      <form class="form" novalidate>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label" for="set-w">Carga (${unit()})</label>
            <input id="set-w" class="field num" name="w" inputmode="decimal" autocomplete="off" maxlength="7" value="${esc(wInput(s.weightKg))}">
          </div>
          <div>
            <label class="form-label" for="set-r">Repetições</label>
            <input id="set-r" class="field num" name="r" inputmode="numeric" autocomplete="off" maxlength="3" value="${esc(s.reps)}">
          </div>
        </div>
        <p class="field-error"></p>
        <div class="group mt-2 has-icons">
          <button type="button" class="row" data-undo><span class="row-icon">${icon('close', { size: 20 })}</span><span class="row-main row-title">Marcar como não feita</span></button>
          <button type="button" class="row is-danger" data-del><span class="row-icon">${icon('trash', { size: 20 })}</span><span class="row-main row-title">Remover série</span></button>
        </div>
      </form>`);
    const footer = U.h('<button type="button" class="btn btn-primary btn-block">Salvar</button>');
    const sheet = UI.openSheet({ title: `Série ${si + 1}`, subtitle: ex.name, body, footer });
    const err = body.querySelector('.field-error');

    const save = () => {
      const w = parseWeight(body.querySelector('#set-w').value);
      const r = parseReps(body.querySelector('#set-r').value);
      if (!w.ok || !r.ok) {
        err.textContent = !w.ok ? w.error : r.error;
        body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
        return;
      }
      setValues(ei, si, { weightKg: w.value, reps: r.value });
      refreshRecords(ei, si);
      sheet.close('save');
      render();
    };
    footer.addEventListener('click', save);
    body.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    body.querySelectorAll('input').forEach((i) => U.submitOnEnter(i, body));
    body.querySelector('[data-undo]').addEventListener('click', () => { uncompleteSet(ei, si); sheet.close(); render(); });
    body.querySelector('[data-del]').addEventListener('click', () => {
      const removed = U.clone(s);
      removeSet(ei, si);
      sheet.close();
      render();
      UI.toast(`Série ${si + 1} removida`, {
        iconName: 'trash', action: 'Desfazer', duration: 5000,
        onAction: () => { mutate((d) => { d.exercises[ei].sets.splice(si, 0, removed); }); render(); }
      });
    });
  }

  // Lista de exercícios do treino (pular direto para um deles, ou adicionar)
  function openToc() {
    const a = active();
    const body = U.h(`
      <div>
        <div class="group">
          ${a.exercises.map((ex, k) => {
            const d = ex.sets.filter((s) => s.done).length;
            const full = ex.sets.length > 0 && d >= ex.sets.length;
            return `
              <button type="button" class="row" data-k="${k}">
                <span class="toc-index num ${full ? 'is-done' : ''}">${full ? icon('check', { size: 13, stroke: 2.8 }) : k + 1}</span>
                <span class="row-main">
                  <span class="row-title block truncate">${esc(ex.name)}</span>
                  <span class="row-sub block">${d} de ${ex.sets.length} séries</span>
                </span>
                ${k === a.cursor ? '<span class="badge is-inline">Agora</span>' : ''}
              </button>`;
          }).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-block mt-4" data-addex>${icon('plus', { size: 18, stroke: 2 })} Adicionar exercício</button>
        <p class="t-footnote text-center mt-3">Exercícios adicionados aqui entram só no treino de hoje.</p>
      </div>`);
    const sheet = UI.openSheet({ title: a.name, subtitle: `${doneCount(a)} de ${plannedCount(a)} séries concluídas`, body });
    body.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]');
      if (k) {
        sheet.close();
        const idx = Number(k.dataset.k);
        const dir = idx >= active().cursor ? 'tr-in-next' : 'tr-in-prev';
        setCursor(idx);
        render(dir);
        return;
      }
      if (e.target.closest('[data-addex]')) {
        sheet.close();
        global.Exercises.openPicker({
          title: 'Adicionar ao treino de hoje',
          inWorkout: active().exercises.map((x) => x.exerciseId),
          onConfirm: (ids) => {
            const start = active().exercises.length;
            addExercises(ids);
            setCursor(start);
            render('tr-in-next');
            UI.toast(ids.length === 1 ? 'Exercício adicionado' : `${ids.length} exercícios adicionados`);
          }
        });
      }
    });
  }

  function askFinish() {
    const a = active();
    if (!doneCount(a)) {
      UI.confirmSheet({
        title: 'Nenhuma série registrada',
        message: 'Descartar este treino? Nada será salvo no histórico.',
        confirmLabel: 'Descartar treino', cancelLabel: 'Continuar treinando', destructive: true,
        onConfirm: discardFlow
      });
      return;
    }
    beginFinish();
    render('tr-in-up');
  }

  function pickRpe(n) {
    updateFinish({ rpe: n });
    root().querySelectorAll('[data-rpe]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.rpe) === n)));
    const cap = root().querySelector('[data-rpe-caption]');
    if (cap) cap.textContent = `${n} · ${RPE_TEXT[n]}`;
  }

  function pickMood(v) {
    const cur = active().finishing.mood;
    const next = cur === v ? null : v;
    updateFinish({ mood: next });
    root().querySelectorAll('[data-mood]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mood === next)));
  }

  function save() {
    const notes = root().querySelector('#tr-notes');
    if (notes) updateFinish({ notes: notes.value });
    const recCount = sessionRecords(active()).length;
    const unlockedBefore = new Set(global.Progress.achievements().filter((a) => a.unlocked).map((a) => a.id));
    const session = finishWorkout();
    if (!session) return;
    const fresh = global.Progress.achievements().filter((a) => a.unlocked && !unlockedBefore.has(a.id));
    if (fresh.length && global.Plans.isPremium()) setTimeout(() => global.Progress.celebrate(fresh), 700);
    U.haptic('finish');
    hide();
    global.App.Router.go('home');
    UI.toast(recCount ? `Treino salvo · ${recCount === 1 ? '1 recorde' : `${recCount} recordes`}` : 'Treino salvo', {
      iconName: recCount ? 'trophy' : 'check', duration: 6000,
      action: 'Compartilhar', onAction: () => global.Share.open(session)
    });
  }

  global.Sessions = {
    MOODS, RPE_TEXT,
    all, get, last, lastForWorkout, active, lastPerformance, coachAdvice, reachedTop, nextLoad, summary, removeSession,
    startWorkout, completeSet, setValues, finishWorkout, previewSession, discard,
    begin, open, minimize, promptRecovery, syncActiveBar, syncClock,
    isOpen: () => T.open
  };
})(window);
