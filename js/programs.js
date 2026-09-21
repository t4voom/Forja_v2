/* FORJA — programas prontos
   · Catálogo fixo de programas (Full Body, ABC, Upper/Lower, Push/Pull/Legs, ABCDE).
   · Começar um programa cria treinos comuns (Store 'workouts'), marcados com programId,
     então tudo o que já existe (modo treino, Coach, histórico) funciona igual.
   · Progressão em ciclos de 8 semanas. A "semana" conta treinos feitos, não o calendário:
     semana = treinos do programa no ciclo ÷ treinos por semana. Faltou uma semana? Nada se perde.
   · Cada exercício guarda sua configuração base; a fase da semana é aplicada sobre ela.
     Se você ajustar um exercício à mão, ele passa a usar seus valores (manual: true).
   Estado: Store 'program' = { id, perWeek, workoutIds, cycle, cycleStartedAt, appliedWeek, startedAt } */
(function (global) {
  'use strict';
  const { U, UI, Store } = global;
  const { esc, icon } = U;
  const Router = () => global.App.Router;

  /* ==========================================================================
     Fases do ciclo
     ========================================================================== */
  const CYCLE_WEEKS = 8;
  const PHASES = [
    { key: 'adapt', name: 'Adaptação', weeks: [1], sets: -1,
      text: 'Uma série a menos e cargas confortáveis. Aprenda os movimentos e termine cada série com 2 a 3 repetições sobrando.' },
    { key: 'base', name: 'Base', weeks: [2, 3],
      text: 'Volume completo. Registre as cargas e siga o Coach para subir aos poucos.' },
    { key: 'volume', name: 'Volume', weeks: [4, 5], mainSets: 1,
      text: 'Uma série extra nos exercícios principais. Mais trabalho, mesma técnica.' },
    { key: 'intensity', name: 'Intensidade', weeks: [6, 7], mainSets: 1, mainReps: -2,
      text: 'Faixa de repetições menor nos principais, para usar cargas mais pesadas.' },
    { key: 'deload', name: 'Recuperação', weeks: [8], deload: true,
      text: 'Semana leve: metade das séries e cerca de 70% da carga. Você recupera e volta mais forte no próximo ciclo.' }
  ];
  const phaseOf = (week) => PHASES.find((p) => p.weeks.includes(U.clamp(week, 1, CYCLE_WEEKS))) || PHASES[0];

  // Configuração da semana a partir da base
  function applyPhase(base, main, phase) {
    let sets = base.sets + (phase.sets || 0) + (main ? phase.mainSets || 0 : 0);
    if (phase.deload) sets = Math.ceil(base.sets / 2);
    let repMin = base.repMin, repMax = base.repMax;
    if (main && phase.mainReps) {
      repMin = Math.max(3, base.repMin + phase.mainReps);
      repMax = Math.max(repMin, base.repMax + phase.mainReps);
    }
    return { sets: U.clamp(sets, 1, 10), repMin, repMax };
  }

  /* ==========================================================================
     Catálogo — [id do exercício, séries, reps mín., reps máx., principal?]
     Os ids vêm da biblioteca (Exercises) e nunca mudam.
     ========================================================================== */
  const C = ['#E8853D', '#5E9EFF', '#4CC38A', '#A78BFA', '#E5B454', '#E5675A'];

  const CATALOG = [
    {
      id: 'fullbody', name: 'Full Body', tagline: 'O começo certo para quem está chegando.',
      level: 'beginner', perWeek: [3], minutes: 50, goals: ['mass', 'fat', 'conditioning', 'other'],
      description: 'Corpo inteiro em cada treino, alternando A e B. Poucos exercícios, bem escolhidos, para aprender os movimentos e ganhar força rápido.',
      schedule: 'Treine em dias alternados: A, B, A numa semana; B, A, B na seguinte.',
      days: [
        { name: 'FULL BODY A', exercises: [
          ['leg-press-45', 3, 10, 12, 1], ['supino-reto-com-halteres', 3, 8, 12, 1], ['puxada-frontal', 3, 10, 12, 1],
          ['mesa-flexora', 2, 10, 15], ['elevacao-lateral', 2, 12, 15], ['abdominal-crunch', 2, 12, 20]] },
        { name: 'FULL BODY B', exercises: [
          ['agachamento-goblet', 3, 10, 12, 1], ['remada-baixa', 3, 10, 12, 1], ['desenvolvimento-com-halteres', 3, 8, 12, 1],
          ['stiff-com-halteres', 3, 10, 12], ['rosca-alternada', 2, 10, 12], ['triceps-pulley', 2, 10, 12], ['panturrilha-em-pe', 2, 12, 15]] }
      ]
    },
    {
      id: 'abc', name: 'ABC', tagline: 'O clássico da academia, bem montado.',
      level: 'intermediate', perWeek: [3, 6], minutes: 60, goals: ['mass'],
      description: 'Três treinos: peito e tríceps, costas e bíceps, pernas e ombros. Faça uma volta por semana ou duas, se tiver tempo.',
      schedule: 'Siga a ordem A, B, C. Com 6 treinos por semana, repita o ciclo e descanse no domingo.',
      days: [
        { name: 'A · PEITO E TRÍCEPS', exercises: [
          ['supino-reto', 4, 8, 10, 1], ['supino-inclinado-com-halteres', 3, 8, 12, 1], ['crucifixo-com-halteres', 3, 10, 12],
          ['crossover', 3, 12, 15], ['triceps-pulley', 3, 10, 12], ['triceps-frances', 3, 10, 12]] },
        { name: 'B · COSTAS E BÍCEPS', exercises: [
          ['puxada-frontal', 4, 8, 10, 1], ['remada-curvada', 4, 8, 10, 1], ['remada-unilateral', 3, 10, 12],
          ['pulldown-com-bracos-estendidos', 3, 12, 15], ['rosca-direta', 3, 8, 12], ['rosca-martelo', 3, 10, 12]] },
        { name: 'C · PERNAS E OMBROS', exercises: [
          ['agachamento-livre', 4, 8, 10, 1], ['leg-press-45', 3, 10, 12, 1], ['cadeira-extensora', 3, 12, 15], ['mesa-flexora', 3, 10, 12],
          ['desenvolvimento-com-halteres', 3, 8, 12], ['elevacao-lateral', 3, 12, 15], ['panturrilha-em-pe', 4, 12, 15]] }
      ]
    },
    {
      id: 'upperlower', name: 'Upper/Lower', tagline: 'Força e massa com 4 treinos por semana.',
      level: 'intermediate', perWeek: [4], minutes: 60, goals: ['strength', 'mass'],
      description: 'Superior e inferior, duas vezes cada. Cada músculo treina 2× por semana, o ponto ideal para crescer sem viver na academia.',
      schedule: 'Exemplo: segunda (Superior A), terça (Inferior A), quinta (Superior B), sexta (Inferior B).',
      days: [
        { name: 'SUPERIOR A', exercises: [
          ['supino-reto', 4, 6, 8, 1], ['remada-curvada', 4, 6, 8, 1], ['desenvolvimento-com-halteres', 3, 8, 10],
          ['puxada-frontal', 3, 8, 10], ['rosca-direta', 2, 10, 12], ['triceps-testa', 2, 10, 12]] },
        { name: 'INFERIOR A', exercises: [
          ['agachamento-livre', 4, 6, 8, 1], ['levantamento-terra-romeno', 3, 8, 10, 1], ['leg-press-45', 3, 10, 12],
          ['mesa-flexora', 3, 10, 12], ['panturrilha-em-pe', 4, 10, 15], ['abdominal-na-polia', 3, 12, 15]] },
        { name: 'SUPERIOR B', exercises: [
          ['supino-inclinado-com-halteres', 4, 8, 10, 1], ['puxada-supinada', 4, 8, 10, 1], ['remada-unilateral', 3, 10, 12],
          ['elevacao-lateral', 4, 12, 15], ['crucifixo-inverso', 3, 12, 15], ['rosca-martelo', 2, 10, 12], ['triceps-corda', 2, 10, 12]] },
        { name: 'INFERIOR B', exercises: [
          ['hack-squat', 4, 8, 10, 1], ['elevacao-pelvica', 4, 8, 10, 1], ['agachamento-bulgaro', 3, 10, 12],
          ['cadeira-extensora', 3, 12, 15], ['cadeira-flexora', 3, 10, 12], ['panturrilha-sentado', 4, 12, 15]] }
      ]
    },
    {
      id: 'ppl', name: 'Push/Pull/Legs', tagline: 'Empurrar, puxar, pernas. Simples e eficiente.',
      level: 'intermediate', perWeek: [3, 6], minutes: 65, goals: ['mass', 'strength'],
      description: 'Músculos que trabalham juntos treinam juntos. Com 6 treinos por semana, é um dos programas mais completos para hipertrofia.',
      schedule: 'Siga Push, Pull, Legs. Com 6 por semana, repita o ciclo e descanse um dia.',
      days: [
        { name: 'PUSH', exercises: [
          ['supino-reto', 4, 6, 8, 1], ['desenvolvimento-com-halteres', 3, 8, 10, 1], ['supino-inclinado-com-halteres', 3, 8, 12],
          ['elevacao-lateral', 4, 12, 15], ['crossover', 3, 12, 15], ['triceps-corda', 3, 10, 12], ['triceps-frances', 2, 10, 12]] },
        { name: 'PULL', exercises: [
          ['puxada-frontal', 4, 8, 10, 1], ['remada-curvada', 4, 6, 8, 1], ['remada-baixa', 3, 10, 12],
          ['face-pull', 3, 12, 15], ['rosca-direta', 3, 8, 12], ['rosca-martelo', 2, 10, 12]] },
        { name: 'LEGS', exercises: [
          ['agachamento-livre', 4, 6, 8, 1], ['levantamento-terra-romeno', 3, 8, 10, 1], ['leg-press-45', 3, 10, 12],
          ['mesa-flexora', 3, 10, 12], ['cadeira-extensora', 2, 12, 15], ['panturrilha-em-pe', 4, 10, 15], ['elevacao-de-pernas', 3, 10, 15]] }
      ]
    },
    {
      id: 'abcde', name: 'ABCDE', tagline: 'Um grupo por dia, volume máximo.',
      level: 'advanced', perWeek: [5], minutes: 70, goals: ['mass'],
      description: 'Cinco treinos com foco total em um grupo por vez. Para quem já tem base e quer trabalhar cada músculo com muito volume.',
      schedule: 'De segunda a sexta, na ordem A, B, C, D, E. Fim de semana para recuperar.',
      days: [
        { name: 'A · PEITO', exercises: [
          ['supino-reto', 4, 6, 8, 1], ['supino-inclinado-com-halteres', 4, 8, 10, 1], ['supino-declinado', 3, 8, 12],
          ['crucifixo-inclinado', 3, 10, 12], ['crossover', 3, 12, 15], ['peck-deck', 2, 12, 15]] },
        { name: 'B · COSTAS', exercises: [
          ['barra-fixa', 4, 6, 10, 1], ['remada-curvada', 4, 6, 8, 1], ['puxada-com-triangulo', 3, 10, 12],
          ['remada-baixa', 3, 10, 12], ['pulldown-com-bracos-estendidos', 3, 12, 15], ['hiperextensao-lombar', 2, 12, 15]] },
        { name: 'C · PERNAS', exercises: [
          ['agachamento-livre', 4, 6, 8, 1], ['levantamento-terra-romeno', 4, 8, 10, 1], ['leg-press-45', 3, 10, 12],
          ['cadeira-extensora', 3, 12, 15], ['mesa-flexora', 3, 10, 12], ['elevacao-pelvica', 3, 8, 12], ['panturrilha-em-pe', 4, 10, 15]] },
        { name: 'D · OMBROS', exercises: [
          ['desenvolvimento-com-barra', 4, 6, 8, 1], ['desenvolvimento-arnold', 3, 8, 12, 1], ['elevacao-lateral', 4, 12, 15],
          ['elevacao-lateral-no-cabo', 3, 12, 15], ['face-pull', 3, 12, 15], ['encolhimento', 3, 10, 12], ['abdominal-na-polia', 3, 12, 15]] },
        { name: 'E · BRAÇOS', exercises: [
          ['supino-fechado', 3, 6, 10, 1], ['rosca-direta', 4, 8, 10, 1], ['triceps-testa', 3, 8, 12],
          ['rosca-inclinada', 3, 10, 12], ['triceps-corda', 3, 10, 12], ['rosca-martelo', 3, 10, 12], ['elevacao-de-pernas', 3, 10, 15]] }
      ]
    }
  ];

  const LEVELS = { beginner: 'Iniciante', intermediate: 'Intermediário', advanced: 'Avançado' };
  const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

  const get = (id) => CATALOG.find((p) => p.id === id) || null;
  const exerciseTotal = (p) => p.days.reduce((n, d) => n + d.exercises.length, 0);
  const perWeekText = (p) => (p.perWeek.length > 1 ? `${p.perWeek.join(' ou ')}× por semana` : `${p.perWeek[0]}× por semana`);

  // Programa sugerido pelo perfil (experiência primeiro, depois objetivo)
  function recommendedId() {
    const pr = Store.get('profile') || {};
    const lvl = pr.experience || 'beginner';
    if (lvl === 'beginner') return 'fullbody';
    if (lvl === 'advanced') return pr.goal === 'strength' ? 'upperlower' : 'abcde';
    if (pr.goal === 'strength') return 'upperlower';
    if (pr.goal === 'mass') return 'ppl';
    return 'abc';
  }

  /* ==========================================================================
     Estado do programa em andamento
     ========================================================================== */
  // No Free o programa fica pausado: os treinos continuam como treinos comuns
  function state() {
    if (global.Plans && !global.Plans.isPremium()) return null;
    const s = Store.get('program');
    return s && get(s.id) ? s : null;
  }

  // Treinos do programa que ainda existem (você pode ter excluído algum)
  function workoutIds(s = state()) {
    if (!s) return [];
    const existing = new Set(Store.get('workouts').map((w) => w.id));
    return (s.workoutIds || []).filter((id) => existing.has(id));
  }

  const isProgramWorkout = (wid) => workoutIds().includes(wid);

  // Treinos feitos neste ciclo → semana atual
  function progress(s = state()) {
    if (!s) return null;
    const ids = new Set(s.workoutIds || []);
    const from = new Date(s.cycleStartedAt).getTime();
    const done = Store.get('sessions').filter((x) => ids.has(x.workoutId) && new Date(x.startedAt).getTime() >= from).length;
    const total = CYCLE_WEEKS * s.perWeek;
    const completed = done >= total;
    const week = completed ? CYCLE_WEEKS : Math.floor(done / s.perWeek) + 1;
    const inWeek = completed ? s.perWeek : done % s.perWeek;
    return { done, total, week, inWeek, perWeek: s.perWeek, completed, phase: phaseOf(week), cycle: s.cycle || 1 };
  }

  // Fase para o modo treino (ex.: semana de recuperação muda o conselho do Coach)
  function phaseForWorkout(wid) {
    if (!isProgramWorkout(wid)) return null;
    const p = progress();
    return p && !p.completed ? p.phase : null;
  }

  // Aplica a semana atual aos treinos do programa. Devolve a fase se a semana mudou.
  function applyWeek(week) {
    const phase = phaseOf(week);
    const ids = new Set(workoutIds());
    Store.update('workouts', (ws) => {
      ws.forEach((w) => {
        if (!ids.has(w.id) || w.managed) return; // treino assumido pelo treinador não segue mais o programa
        (w.exercises || []).forEach((x) => {
          if (!x.base || x.manual) return;
          Object.assign(x, applyPhase(x.base, !!x.main, phase));
        });
        w.description = `Semana ${week} de ${CYCLE_WEEKS} · ${phase.name}`;
        w.updatedAt = new Date().toISOString();
      });
    });
    Store.update('program', (s) => { if (s) s.appliedWeek = week; });
    return phase;
  }

  // Chamado ao abrir as telas: mantém os treinos na semana certa e avisa quando ela muda
  function sync({ announce = true } = {}) {
    const s = state();
    if (!s) return null;
    const p = progress(s);
    if (p.completed) {
      if (!s.completedNotified) {
        Store.update('program', (x) => { x.completedNotified = true; });
        if (announce) setTimeout(() => UI.toast(`Ciclo ${p.cycle} de ${get(s.id).name} concluído!`, { iconName: 'trophy', duration: 6000, action: 'Ver', onAction: () => Router().go(`workouts/programs/${s.id}`) }), 500);
      }
      return p;
    }
    if (s.appliedWeek !== p.week) {
      const first = !s.appliedWeek;
      const phase = applyWeek(p.week);
      if (announce && !first) {
        setTimeout(() => UI.toast(`Semana ${p.week} · ${phase.name}. Seus treinos foram ajustados.`, { iconName: 'sparkle', duration: 5000 }), 500);
      }
    }
    return p;
  }

  /* ==========================================================================
     Começar, recomeçar, encerrar
     ========================================================================== */
  function install(programId, perWeek, { replace = false } = {}) {
    const p = get(programId);
    if (!p) return;
    const now = new Date().toISOString();
    const prev = state();
    const removed = [];

    // Programa anterior: seus treinos saem (o histórico continua intacto)
    const dropIds = new Set(prev ? prev.workoutIds || [] : []);
    if (replace) Store.get('workouts').forEach((w) => dropIds.add(w.id));
    Store.get('workouts').forEach((w) => { if (dropIds.has(w.id)) removed.push(w); });
    Store.update('workouts', (ws) => ws.filter((w) => !dropIds.has(w.id)));

    // Os treinos do programa entram no topo da lista
    const created = p.days.map((d, i) => ({
      id: U.uid('w_'),
      name: d.name,
      description: '',
      color: C[i % C.length],
      programId: p.id,
      order: -100 + i,
      createdAt: now,
      updatedAt: now,
      exercises: d.exercises.map(([exerciseId, sets, repMin, repMax, main]) => {
        const ex = global.Exercises.get(exerciseId) || { id: exerciseId, name: exerciseId, muscle: '' };
        return { id: U.uid('wx_'), exerciseId: ex.id, name: ex.name, muscle: ex.muscle, sets, repMin, repMax, group: null,
                 base: { sets, repMin, repMax }, main: !!main };
      })
    }));
    Store.update('workouts', (ws) => {
      ws.push(...created);
      ws.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((w, i) => { w.order = i; });
    });
    Store.set('program', {
      id: p.id, perWeek, workoutIds: created.map((w) => w.id),
      cycle: 1, startedAt: now, cycleStartedAt: now, appliedWeek: 0
    });
    applyWeek(1);
    return { created, removed };
  }

  function restartCycle() {
    Store.update('program', (s) => {
      if (!s) return;
      s.cycle = (s.cycle || 1) + 1;
      s.cycleStartedAt = new Date().toISOString();
      s.appliedWeek = 0;
      delete s.completedNotified;
    });
    applyWeek(1);
  }

  // Encerrar: os treinos ficam como treinos normais, na configuração base
  function stop() {
    const s = state();
    if (!s) return;
    const ids = new Set(workoutIds(s));
    Store.update('workouts', (ws) => {
      ws.forEach((w) => {
        if (!ids.has(w.id) || w.managed) return;
        delete w.programId;
        w.description = '';
        (w.exercises || []).forEach((x) => {
          if (x.base && !x.manual) Object.assign(x, x.base);
          delete x.base; delete x.main; delete x.manual;
        });
      });
    });
    Store.set('program', null);
  }

  /* ==========================================================================
     Fluxo de "Começar programa"
     ========================================================================== */
  function startFlow(programId) {
    if (!global.Plans.isPremium()) return global.Plans.openPaywall('programs');
    const p = get(programId);
    const current = state();
    const chooseFrequency = (next) => {
      if (p.perWeek.length === 1) return next(p.perWeek[0]);
      UI.choiceSheet({
        title: 'Quantos treinos por semana?',
        subtitle: 'Dá para mudar depois recomeçando o programa.',
        options: p.perWeek.map((n) => ({ value: String(n), label: `${n} treinos por semana` })),
        value: String(p.perWeek[0]),
        onSelect: (v) => next(Number(v))
      });
    };
    const chooseMode = (perWeek) => {
      const own = Store.get('workouts').filter((w) => !(current && (current.workoutIds || []).includes(w.id)));
      if (!own.length) return finish(perWeek, false);
      UI.actionSheet({
        title: `Você já tem ${U.plural(own.length, 'treino', 'treinos')}`,
        subtitle: 'O histórico e os recordes continuam salvos em qualquer opção.',
        actions: [
          { label: 'Manter os meus e adicionar o programa', icon: 'plus', onSelect: () => finish(perWeek, false) },
          { label: 'Substituir pelos treinos do programa', icon: 'swap', onSelect: () => finish(perWeek, true) }
        ]
      });
    };
    const finish = (perWeek, replace) => {
      const r = install(programId, perWeek, { replace });
      U.haptic('success');
      Router().go('workouts');
      UI.toast(`${p.name} pronto · Semana 1: Adaptação`, {
        iconName: 'sparkle', duration: 6000,
        ...(r.removed.length ? { action: 'Desfazer', onAction: () => undoInstall(r) } : {})
      });
    };
    const go = () => chooseFrequency(chooseMode);

    if (current && current.id !== programId) {
      UI.confirmSheet({
        title: `Trocar ${get(current.id).name} por ${p.name}?`,
        message: `Os treinos de ${get(current.id).name} saem da sua lista. O que você já treinou continua no histórico.`,
        confirmLabel: 'Trocar programa',
        onConfirm: () => setTimeout(go, 250)
      });
    } else go();
  }

  function undoInstall({ created, removed }) {
    const ids = new Set(created.map((w) => w.id));
    Store.update('workouts', (ws) => ws.filter((w) => !ids.has(w.id)).concat(removed));
    Store.set('program', null);
    Router().refresh();
  }

  /* ==========================================================================
     Interface
     ========================================================================== */
  // Barra de 8 semanas: feitas, atual (com o quanto da semana já foi) e futuras
  function weeksBar(p) {
    return `
      <div class="pg-weeks" role="img" aria-label="Semana ${p.week} de ${CYCLE_WEEKS}">
        ${Array.from({ length: CYCLE_WEEKS }, (_, i) => {
          const w = i + 1;
          const fill = p.completed || w < p.week ? 1 : w === p.week ? p.inWeek / p.perWeek : 0;
          return `<span class="${w === p.week && !p.completed ? 'is-current' : ''} ${phaseOf(w).deload ? 'is-deload' : ''}" style="--p:${fill}"></span>`;
        }).join('')}
      </div>`;
  }

  // Cartão do programa em andamento (lista de treinos)
  function statusCardHTML() {
    const s = state();
    if (!s) return '';
    const p = sync();
    const prog = get(s.id);
    const left = p.perWeek - p.inWeek;
    return `
      <button type="button" class="pg-status pressable" data-go="workouts/programs/${esc(prog.id)}">
        <span class="pg-status-top">
          <span class="t-eyebrow t-accent">Programa · ${esc(prog.name)}</span>
          ${icon('chevronRight', { size: 18, stroke: 2, cls: 'row-chevron' })}
        </span>
        ${p.completed ? `
          <span class="pg-status-title">Ciclo ${p.cycle} concluído</span>
          <span class="t-callout block mt-1">Recomece para um novo ciclo, mais forte.</span>` : `
          <span class="pg-status-title">Semana ${p.week} <small>de ${CYCLE_WEEKS}</small> · ${esc(p.phase.name)}</span>
          <span class="t-callout block mt-1">${p.inWeek ? `${p.inWeek} de ${p.perWeek} treinos nesta semana` : `${U.plural(p.perWeek, 'treino', 'treinos')} nesta semana`}${left && p.inWeek ? ` · faltam ${left}` : ''}</span>`}
        ${weeksBar(p)}
      </button>`;
  }

  function promoCardHTML() {
    if (state()) return '';
    return `
      <button type="button" class="pg-promo pressable" data-go="workouts/programs">
        <span class="pg-promo-icon">${icon('layers', { size: 22, stroke: 1.7 })}</span>
        <span class="min-w-0 text-left">
          <span class="row-title block">Programas prontos ${global.Plans.pill()}</span>
          <span class="row-sub block">Full Body, ABC, Push/Pull/Legs e mais, com progressão de 8 semanas.</span>
        </span>
        ${icon('chevronRight', { size: 18, stroke: 2, cls: 'row-chevron' })}
      </button>`;
  }

  // Linha curta para a Home: "Semana 3 de 8 · Base"
  function badgeFor(wid) {
    if (!isProgramWorkout(wid)) return '';
    const p = progress();
    if (!p) return '';
    return p.completed ? 'Ciclo concluído' : `Semana ${p.week} de ${CYCLE_WEEKS} · ${p.phase.name}`;
  }

  function render(root, id) {
    if (id) return renderDetail(root, id);
    return renderCatalog(root);
  }

  function factsHTML(p) {
    return `
      <span class="pg-facts">
        <span>${LEVELS[p.level]}</span>
        <span>${perWeekText(p)}</span>
        <span>~${p.minutes} min</span>
      </span>`;
  }

  function renderCatalog(root) {
    const s = state();
    const rec = recommendedId();
    const list = [...CATALOG].sort((a, b) => (a.id === rec ? -1 : b.id === rec ? 1 : LEVEL_RANK[a.level] - LEVEL_RANK[b.level]));
    root.innerHTML = `
      ${UI.navbarHTML('Programas', 'Treinos')}
      <section class="page has-navbar">
        <header>
          <h1 class="t-large-title" data-large-title>Programas</h1>
          <p class="t-sub mt-2">Treinos montados por nível, com progressão de ${CYCLE_WEEKS} semanas. Escolha um e comece hoje.</p>
          ${global.Plans.isPremium() ? '' : `<p class="mt-4">${global.Plans.pill()}</p>`}
        </header>
        <div class="pg-list mt-8 reveal">
          ${list.map((p, i) => `
            <button type="button" class="pg-card pressable" data-go="workouts/programs/${p.id}" style="--tint:${C[i % C.length]};--i:${i}">
              ${s && s.id === p.id ? '<span class="badge">Em andamento</span>' : p.id === rec ? '<span class="badge">Recomendado para você</span>' : ''}
              <span class="pg-card-name">${esc(p.name)}</span>
              <span class="pg-card-tagline">${esc(p.tagline)}</span>
              ${factsHTML(p)}
              <span class="pg-card-days">${p.days.map((d) => `<span>${esc(dayShort(d.name))}</span>`).join('')}</span>
            </button>`).join('')}
        </div>
        <p class="t-footnote mt-8 mx-1">Todo programa segue o mesmo ciclo: Adaptação, Base, Volume, Intensidade e uma semana de Recuperação. Você pode trocar exercícios quando quiser.</p>
      </section>`;
    root.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) Router().go(g.dataset.go); });
  }

  // "A · PEITO E TRÍCEPS" → "Peito e tríceps"; "FULL BODY A" → "Full body A"
  function dayShort(name) {
    if (name.includes('·')) { const t = name.split('·')[1].trim(); return t.charAt(0) + t.slice(1).toLowerCase(); }
    return name.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function phasesHTML(p) {
    return `
      <ol class="pg-phases">
        ${PHASES.map((ph) => {
          const now = p && !p.completed && ph.weeks.includes(p.week);
          const past = p && (p.completed || ph.weeks[ph.weeks.length - 1] < p.week);
          return `
          <li class="pg-phase ${now ? 'is-now' : ''} ${past ? 'is-past' : ''}">
            <span class="pg-phase-dot">${past ? icon('check', { size: 12, stroke: 2.6 }) : ''}</span>
            <span class="min-w-0">
              <span class="pg-phase-head"><span class="row-title">${esc(ph.name)}</span><span class="t-footnote">${ph.weeks.length > 1 ? `Semanas ${ph.weeks.join(' e ')}` : `Semana ${ph.weeks[0]}`}</span></span>
              <span class="row-sub block mt-1">${esc(ph.text)}</span>
            </span>
          </li>`;
        }).join('')}
      </ol>`;
  }

  function renderDetail(root, id) {
    const prog = get(id);
    if (!prog) { Router().back('workouts/programs'); return; }
    const s = state();
    const active = s && s.id === id;
    const p = active ? sync() : null;
    const idx = CATALOG.indexOf(prog);
    const ex = (xid) => global.Exercises.get(xid) || { name: xid, muscle: '' };

    root.innerHTML = `
      ${UI.navbarHTML(prog.name, 'Programas', active ? `<button class="icon-btn" data-menu aria-label="Mais opções">${icon('more', { size: 20 })}</button>` : '')}
      <section class="page has-navbar">
        <header class="detail-head" style="--tint:${C[idx % C.length]}">
          ${active ? '<span class="badge">Em andamento</span>' : prog.id === recommendedId() ? '<span class="badge">Recomendado para você</span>' : ''}
          <h1 class="t-large-title" data-large-title>${esc(prog.name)}</h1>
          <p class="t-sub mt-2">${esc(prog.description)}</p>
        </header>

        <div class="pg-fact-grid mt-8">
          <div><p class="t-eyebrow">Nível</p><p class="pg-fact">${LEVELS[prog.level]}</p></div>
          <div><p class="t-eyebrow">Frequência</p><p class="pg-fact">${prog.perWeek.join(' ou ')}×<small>/sem</small></p></div>
          <div><p class="t-eyebrow">Duração</p><p class="pg-fact">${CYCLE_WEEKS}<small>semanas</small></p></div>
          <div><p class="t-eyebrow">Por treino</p><p class="pg-fact">~${prog.minutes}<small>min</small></p></div>
        </div>

        ${active ? `
          <section class="section">
            <div class="card pg-now">
              <p class="t-eyebrow">${p.completed ? `Ciclo ${p.cycle}` : `Ciclo ${p.cycle} · ${U.plural(p.perWeek, 'treino', 'treinos')} por semana`}</p>
              <p class="pg-status-title mt-2">${p.completed ? 'Ciclo concluído' : `Semana ${p.week} <small>de ${CYCLE_WEEKS}</small> · ${esc(p.phase.name)}`}</p>
              <p class="t-callout mt-2">${p.completed ? `Você fez os ${p.total} treinos do ciclo. Recomece: as cargas que você conquistou viram o novo ponto de partida.` : esc(p.phase.text)}</p>
              ${weeksBar(p)}
              <p class="t-footnote mt-3">${p.done} de ${p.total} treinos do ciclo</p>
              ${p.completed ? '<button type="button" class="btn btn-primary btn-block mt-6" data-restart>Recomeçar ciclo</button>' : ''}
            </div>
          </section>` : ''}

        <section class="section">
          <p class="t-eyebrow group-label">Treinos</p>
          <p class="t-footnote mx-1 mb-4">${esc(prog.schedule)}</p>
          ${prog.days.map((d, i) => `
            <div class="pg-day" style="--tint:${C[i % C.length]}">
              <p class="pg-day-name"><span class="workout-swatch"></span>${esc(d.name)}</p>
              <ol class="group">
                ${d.exercises.map(([xid, sets, repMin, repMax, main]) => `
                  <li class="row">
                    <span class="row-main">
                      <span class="row-title block">${esc(ex(xid).name)}${main ? ' <span class="pg-main" title="Exercício principal">Principal</span>' : ''}</span>
                      <span class="row-sub block">${esc(ex(xid).muscle)}</span>
                    </span>
                    <span class="item-scheme num">${sets} × ${repMin}–${repMax}</span>
                  </li>`).join('')}
              </ol>
            </div>`).join('')}
        </section>

        <section class="section">
          <p class="t-eyebrow group-label">Progressão</p>
          ${phasesHTML(p)}
          <p class="t-footnote group-note">A semana avança conforme você treina, não pelo calendário. Perdeu uma semana? Continua de onde parou. Os exercícios marcados como principais ganham séries extras e cargas mais pesadas.</p>
        </section>

        ${active ? '' : `
          <div class="pg-cta">
            <button type="button" class="btn btn-primary btn-block" data-start>${global.Plans.isPremium() ? '' : icon('lock', { size: 16, stroke: 2.2 })} Começar ${esc(prog.name)}</button>
          </div>`}
      </section>`;

    root.querySelector('[data-start]')?.addEventListener('click', () => startFlow(id));
    root.querySelector('[data-restart]')?.addEventListener('click', () => {
      restartCycle(); U.haptic('success'); Router().refresh(); UI.toast(`Ciclo ${state().cycle} começou · Semana 1: Adaptação`, { iconName: 'sparkle' });
    });
    root.querySelector('[data-menu]')?.addEventListener('click', () => openMenu(id));
  }

  function openMenu(id) {
    const prog = get(id);
    UI.actionSheet({
      title: prog.name,
      actions: [
        { label: 'Recomeçar ciclo da semana 1', icon: 'swap', onSelect: () => UI.confirmSheet({
          title: 'Recomeçar o ciclo?', message: 'Você volta para a semana 1 (Adaptação). Seu histórico não muda.',
          confirmLabel: 'Recomeçar', onConfirm: () => { restartCycle(); Router().refresh(); UI.toast('Semana 1 · Adaptação'); }
        }) },
        { label: 'Encerrar programa', icon: 'close', danger: true, onSelect: () => UI.confirmSheet({
          title: `Encerrar ${prog.name}?`,
          message: 'Os treinos continuam na sua lista como treinos normais, sem a progressão semanal.',
          confirmLabel: 'Encerrar', destructive: true,
          onConfirm: () => { stop(); Router().back('workouts'); UI.toast('Programa encerrado'); }
        }) }
      ]
    });
  }

  global.Programs = {
    CATALOG, PHASES, CYCLE_WEEKS, LEVELS, get, state, progress, sync, install, restartCycle, stop, startFlow,
    isProgramWorkout, workoutIds, phaseForWorkout, applyPhase, badgeFor, recommendedId,
    render, statusCardHTML, promoCardHTML
  };
})(window);
