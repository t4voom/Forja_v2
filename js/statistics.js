/* FORJA — cálculos puros (sem DOM, sem storage)
   Formato de sessão concluída:
   { id, workoutId, name, startedAt, endedAt, durationSec,
     exercises: [{ exerciseId, name, muscle, sets: [{ weightKg, reps, type: 'normal'|'warmup'|'drop', done }] }],
     rpe, mood, notes } */
(function (global) {
  'use strict';

  const DAY = 86400000;

  const isValidNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

  // Volume = carga × repetições
  function calculateVolume(weightKg, reps) {
    if (!isValidNumber(weightKg) || !isValidNumber(reps)) return 0;
    return weightKg * reps;
  }

  // Epley: 1RM = peso × (1 + reps / 30). Uma repetição é o próprio peso.
  function calculateEstimated1RM(weightKg, reps) {
    if (!isValidNumber(weightKg) || !isValidNumber(reps) || reps < 1 || weightKg === 0) return 0;
    if (reps === 1) return weightKg;
    return weightKg * (1 + reps / 30);
  }

  // Séries de trabalho: concluídas e que não são aquecimento
  const isWorkingSet = (set) => !!set && set.done !== false && set.type !== 'warmup';

  function workingSets(session) {
    const out = [];
    (session.exercises || []).forEach((ex) => (ex.sets || []).forEach((s) => { if (isWorkingSet(s)) out.push(s); }));
    return out;
  }

  function sessionVolume(session) {
    return workingSets(session).reduce((sum, s) => sum + calculateVolume(s.weightKg, s.reps), 0);
  }

  function summarize(sessions) {
    let volume = 0, durationSec = 0, sets = 0, reps = 0;
    sessions.forEach((s) => {
      const ws = workingSets(s);
      sets += ws.length;
      ws.forEach((set) => { reps += set.reps || 0; volume += calculateVolume(set.weightKg, set.reps); });
      durationSec += s.durationSec || 0;
    });
    return { count: sessions.length, volume, durationSec, sets, reps };
  }

  const inRange = (sessions, from, to) =>
    sessions.filter((s) => { const t = new Date(s.startedAt).getTime(); return t >= from && t < to; });

  // Semana atual (segunda a domingo) comparada com a anterior
  function calculateWeeklyStats(sessions, ref = new Date()) {
    const start = global.U.startOfWeek(ref).getTime();
    const end = start + 7 * DAY;
    const current = summarize(inRange(sessions, start, end));
    const previous = summarize(inRange(sessions, start - 7 * DAY, start));
    const volumeChange = previous.volume > 0 ? (current.volume - previous.volume) / previous.volume : null;
    return Object.assign(current, { previous, volumeChange });
  }

  function calculateTotals(sessions) { return summarize(sessions); }

  /* ---------- Sequência ----------
     Quase ninguém treina todos os dias, então a sequência não quebra com folgas curtas:
     ela continua enquanto você não passa mais de STREAK_MAX_GAP dias seguidos sem treinar.
     O número conta os dias corridos do primeiro ao último treino da sequência atual.
     Recebe qualquer lista com startedAt: as telas passam treinos + cardio (dia de cardio também conta). */
  const STREAK_MAX_GAP = 2;
  const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const diffDays = (a, b) => Math.round((global.U.startOfDay(b) - global.U.startOfDay(a)) / DAY);

  function trainingChains(sessions) {
    const days = [...new Set(sessions.map((s) => global.U.dayKey(s.startedAt)))].sort().map(keyToDate);
    const chains = [];
    days.forEach((d) => {
      const last = chains[chains.length - 1];
      if (last && diffDays(last.end, d) - 1 <= STREAK_MAX_GAP) last.end = d;
      else chains.push({ start: d, end: d });
    });
    chains.forEach((c) => { c.days = diffDays(c.start, c.end) + 1; });
    return chains;
  }

  function streakInfo(sessions, ref = new Date()) {
    const chains = trainingChains(sessions);
    if (!chains.length) return { days: 0, best: 0, workouts: 0, active: false, daysLeft: 0 };
    const last = chains[chains.length - 1];
    const idle = diffDays(last.end, ref) - 1;           // dias completos sem treino desde o último
    const active = idle <= STREAK_MAX_GAP;
    const workouts = active ? sessions.filter((s) => new Date(s.startedAt) >= last.start).length : 0;
    return {
      days: active ? last.days : 0,
      best: Math.max(...chains.map((c) => c.days)),
      workouts,
      active,
      daysLeft: active ? STREAK_MAX_GAP - Math.max(0, idle) : 0   // dias que ainda dá para ficar sem treinar
    };
  }

  function calculateStreak(sessions, ref = new Date()) { return streakInfo(sessions, ref).days; }

  // Progresso de uma meta, 0–1
  function calculateProgress(current, target, start = 0) {
    if (!isValidNumber(current) || !isValidNumber(target) || target === start) return 0;
    return Math.max(0, Math.min(1, (current - start) / (target - start)));
  }

  /* ---------- Recordes e 1RM ---------- */

  // Epley perde precisão com muitas repetições: acima de 12 não estimamos 1RM
  const E1RM_MAX_REPS = 12;
  const estimated1RMForSet = (s) => (s && s.reps <= E1RM_MAX_REPS ? calculateEstimated1RM(s.weightKg, s.reps) : 0);
  const setsVolume = (sets) => sets.reduce((v, s) => v + calculateVolume(s.weightKg, s.reps), 0);

  /* Que recordes uma série bate em relação às séries anteriores do mesmo exercício.
     · weight: maior carga já usada
     · e1rm:   maior 1RM estimado
     · reps:   mais repetições do que nunca com esta mesma carga (e ninguém fez tanto com carga maior)
     Sem histórico não há recorde (a primeira vez é só o ponto de partida). */
  function detectSetRecords(prior, set) {
    if (!prior.length || !isWorkingSet(set)) return [];
    const out = [];
    const w = set.weightKg || 0;
    if (w > 0 && w > Math.max(...prior.map((s) => s.weightKg || 0))) out.push('weight');
    const e = estimated1RMForSet(set);
    if (e > 0 && e > Math.max(0, ...prior.map(estimated1RMForSet)) + 1e-9) out.push('e1rm');
    const same = prior.filter((s) => Math.abs((s.weightKg || 0) - w) < 0.01);
    const heavier = prior.filter((s) => (s.weightKg || 0) >= w);
    if (same.length && set.reps > Math.max(...heavier.map((s) => s.reps || 0))) out.push('reps');
    return out;
  }

  // Todos os recordes do histórico, recalculados em ordem cronológica (mais recentes primeiro)
  function calculatePersonalRecords(sessions) {
    const ordered = [...sessions].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    const seen = new Map();
    const events = [];
    ordered.forEach((s) => (s.exercises || []).forEach((ex) => {
      const ws = (ex.sets || []).filter(isWorkingSet);
      if (!ws.length) return;
      const hist = seen.get(ex.exerciseId) || { sets: [], maxVolume: 0 };
      const running = [...hist.sets];
      const best = {};
      ws.forEach((set) => {
        detectSetRecords(running, set).forEach((type) => {
          const value = type === 'weight' ? set.weightKg : type === 'reps' ? set.reps : estimated1RMForSet(set);
          if (!best[type] || value > best[type].value) best[type] = { type, value, weightKg: set.weightKg, reps: set.reps };
        });
        running.push(set);
      });
      const volume = setsVolume(ws);
      if (hist.sets.length && volume > hist.maxVolume) best.volume = { type: 'volume', value: volume };
      Object.values(best).forEach((e) => events.push(Object.assign({ sessionId: s.id, date: s.startedAt, exerciseId: ex.exerciseId, name: ex.name }, e)));
      seen.set(ex.exerciseId, { sets: running, maxVolume: Math.max(hist.maxVolume, volume) });
    }));
    return events.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /* Agrupa os recordes por exercício em cada treino: uma série mais pesada costuma bater
     carga, 1RM e volume ao mesmo tempo — isso conta como UM recorde, com vários tipos. */
  const RECORD_PRIORITY = ['weight', 'e1rm', 'reps', 'volume'];
  function groupRecords(events) {
    const map = new Map();
    events.forEach((e) => {
      const key = `${e.sessionId}|${e.exerciseId}`;
      if (!map.has(key)) map.set(key, { sessionId: e.sessionId, date: e.date, exerciseId: e.exerciseId, name: e.name, events: [] });
      map.get(key).events.push(e);
    });
    return [...map.values()].map((g) => {
      g.events.sort((a, b) => RECORD_PRIORITY.indexOf(a.type) - RECORD_PRIORITY.indexOf(b.type));
      g.types = g.events.map((e) => e.type);
      g.primary = g.events[0];
      return g;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // Estatísticas de um exercício ao longo do histórico
  function exerciseStats(sessions, exerciseId) {
    const entries = [];
    sessions.forEach((s) => (s.exercises || []).forEach((ex) => {
      if (ex.exerciseId !== exerciseId) return;
      const ws = (ex.sets || []).filter(isWorkingSet);
      if (!ws.length) return;
      entries.push({
        sessionId: s.id, date: s.startedAt, sets: ws, volume: setsVolume(ws),
        topWeight: Math.max(...ws.map((x) => x.weightKg || 0)),
        best1RM: Math.max(0, ...ws.map(estimated1RMForSet))
      });
    }));
    if (!entries.length) return null;
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    const allSets = entries.flatMap((e) => e.sets.map((set) => Object.assign({ date: e.date }, set)));
    const maxBy = (arr, fn) => arr.reduce((b, x) => (fn(x) > fn(b) ? x : b));
    const heaviest = maxBy(allSets, (x) => (x.weightKg || 0) * 1000 + (x.reps || 0));
    const bestSet = maxBy(allSets, (x) => calculateVolume(x.weightKg, x.reps));
    const best1 = maxBy(allSets, estimated1RMForSet);
    return {
      sessions: entries.length,
      entries,
      heaviest,
      bestSet,
      best1RM: estimated1RMForSet(best1) ? { value: estimated1RMForSet(best1), set: best1 } : null,
      maxVolume: maxBy(entries, (e) => e.volume),
      last: entries[0]
    };
  }

  /* ---------- Períodos ---------- */
  const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  function periodStart(period, ref = new Date()) {
    return PERIOD_DAYS[period] ? ref.getTime() - PERIOD_DAYS[period] * DAY : -Infinity;
  }
  function filterByPeriod(list, period, ref = new Date(), key = 'startedAt') {
    const from = periodStart(period, ref);
    return list.filter((x) => new Date(x[key] || x.date).getTime() >= from);
  }

  /* ---------- Séries no tempo (gráficos) ---------- */

  // Agrupa sessões em barras de dia / semana / mês conforme o período
  function bucketize(sessions, period, ref = new Date()) {
    const U = global.U;
    const end = U.startOfDay(ref);
    let gran, start;
    if (period === '7d') { gran = 'day'; start = U.addDays(end, -6); }
    else if (period === '30d') { gran = 'week'; start = U.startOfWeek(U.addDays(end, -29)); }
    else if (period === '90d') { gran = 'week'; start = U.startOfWeek(U.addDays(end, -89)); }
    else if (period === '1y') { gran = 'month'; start = new Date(end.getFullYear(), end.getMonth() - 11, 1); }
    else {
      const first = sessions.length ? U.startOfDay(new Date(Math.min(...sessions.map((s) => new Date(s.startedAt).getTime())))) : end;
      if ((end - first) / DAY <= 120) { gran = 'week'; start = U.startOfWeek(first); }
      else { gran = 'month'; start = new Date(first.getFullYear(), first.getMonth(), 1); }
    }
    const next = (d) => (gran === 'day' ? U.addDays(d, 1) : gran === 'week' ? U.addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
    const buckets = [];
    for (let cur = start; cur <= end; cur = next(cur)) buckets.push({ start: cur, end: next(cur), gran, volume: 0, count: 0, durationSec: 0 });
    sessions.forEach((s) => {
      const t = new Date(s.startedAt);
      const b = buckets.find((x) => t >= x.start && t < x.end);
      if (b) { b.volume += sessionVolume(s); b.count += 1; b.durationSec += s.durationSec || 0; }
    });
    return buckets;
  }

  // Evolução de um exercício, uma entrada por sessão (mais antiga primeiro)
  function exerciseSeries(sessions, exerciseId) {
    const st = exerciseStats(sessions, exerciseId);
    return st ? [...st.entries].reverse() : [];
  }

  // Atividade por dia (calendário e mapa de consistência)
  function dailyActivity(sessions) {
    const map = new Map();
    sessions.forEach((s) => {
      const k = global.U.dayKey(s.startedAt);
      const d = map.get(k) || { count: 0, volume: 0, durationSec: 0, sessions: [] };
      d.count += 1;
      d.volume += sessionVolume(s);
      d.durationSec += s.durationSec || 0;
      d.sessions.push(s);
      map.set(k, d);
    });
    return map;
  }

  const latestBodyweight = (list) => [...(list || [])].sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

  /* ---------- Metas ----------
     Progresso como na especificação: 22 / 30 kg = 73%. Para perder peso,
     conta quanto já foi percorrido do ponto de partida até o alvo. */
  function goalStatus(goal, { sessions, bodyweight }) {
    let current = null;
    if (goal.type === 'exercise') { const st = exerciseStats(sessions, goal.exerciseId); current = st ? st.heaviest.weightKg : 0; }
    else if (goal.type === 'workouts') current = sessions.length;
    else if (goal.type === 'bodyweight') { const last = latestBodyweight(bodyweight); current = last ? last.kg : null; }
    const target = goal.target;
    const start = goal.start ?? 0;
    const losing = goal.type === 'bodyweight' && target < start;
    let pct = 0;
    if (current != null) pct = losing ? (start - current) / (start - target) : (target > 0 ? current / target : 0);
    pct = Math.max(0, Math.min(1, pct));
    const done = current != null && (losing ? current <= target : current >= target);
    return { current, target, start, pct, done, losing };
  }

  /* ---------- Conquistas ---------- */
  const ACHIEVEMENT_CATEGORIES = [
    { id: 'workouts', label: 'Treinos' },
    { id: 'strength', label: 'Força' },
    { id: 'weeks', label: 'Frequência' },
    { id: 'records', label: 'Recordes' },
    { id: 'volume', label: 'Volume' },
    { id: 'streak', label: 'Sequência' },
    { id: 'special', label: 'Especiais' }
  ];

  /* metric: marcos de contagem (treinos, recordes, volume, sequência)
     kind:   regras próprias — lift (carga num exercício), bench-bw (supino com o próprio peso),
             week (dias de treino na mesma semana), birthday (treinar no aniversário) */
  const ACHIEVEMENTS = [
    { id: 'w1', category: 'workouts', metric: 'workouts', target: 1, icon: 'dumbbell', title: 'Primeiro treino', desc: 'Concluir o primeiro treino' },
    { id: 'w10', category: 'workouts', metric: 'workouts', target: 10, icon: 'dumbbell', title: '10 treinos', desc: 'Concluir 10 treinos' },
    { id: 'w25', category: 'workouts', metric: 'workouts', target: 25, icon: 'dumbbell', title: '25 treinos', desc: 'Concluir 25 treinos' },
    { id: 'w50', category: 'workouts', metric: 'workouts', target: 50, icon: 'dumbbell', title: '50 treinos', desc: 'Concluir 50 treinos' },
    { id: 'w100', category: 'workouts', metric: 'workouts', target: 100, icon: 'dumbbell', title: '100 treinos', desc: 'Concluir 100 treinos' },

    { id: 'club-bench-100', category: 'strength', kind: 'lift', exercises: ['supino-reto'], target: 100, icon: 'barbell', title: 'Clube dos 100 kg', desc: '100 kg no supino reto' },
    { id: 'club-squat-140', category: 'strength', kind: 'lift', exercises: ['agachamento-livre'], target: 140, icon: 'barbell', title: 'Clube dos 140 kg', desc: '140 kg no agachamento livre' },
    { id: 'club-dead-180', category: 'strength', kind: 'lift', exercises: ['levantamento-terra'], target: 180, icon: 'barbell', title: 'Clube dos 180 kg', desc: '180 kg no levantamento terra' },
    { id: 'bench-bw', category: 'strength', kind: 'bench-bw', target: 1, icon: 'scale', title: 'Seu peso no supino', desc: 'Supino reto com o seu peso corporal' },

    { id: 'week4', category: 'weeks', kind: 'week', target: 4, icon: 'calendar', title: 'Semana forte', desc: '4 dias de treino na mesma semana' },
    { id: 'week5', category: 'weeks', kind: 'week', target: 5, icon: 'calendar', title: 'Semana perfeita', desc: '5 dias de treino na mesma semana' },

    { id: 'r1', category: 'records', metric: 'records', target: 1, icon: 'trophy', title: 'Primeiro recorde', desc: 'Superar um treino anterior' },
    { id: 'r10', category: 'records', metric: 'records', target: 10, icon: 'trophy', title: '10 recordes', desc: 'Bater 10 recordes' },
    { id: 'r25', category: 'records', metric: 'records', target: 25, icon: 'trophy', title: '25 recordes', desc: 'Bater 25 recordes' },

    { id: 'v10k', category: 'volume', metric: 'volume', target: 10000, icon: 'bolt', title: '10.000 kg', desc: 'Volume total levantado' },
    { id: 'v100k', category: 'volume', metric: 'volume', target: 100000, icon: 'bolt', title: '100.000 kg', desc: 'Volume total levantado' },
    { id: 'v1m', category: 'volume', metric: 'volume', target: 1000000, icon: 'bolt', title: '1.000.000 kg', desc: 'Volume total levantado' },

    { id: 's7', category: 'streak', metric: 'streak', target: 7, icon: 'flame', title: '7 dias de sequência', desc: 'Manter a sequência por 7 dias' },
    { id: 's30', category: 'streak', metric: 'streak', target: 30, icon: 'flame', title: '30 dias de sequência', desc: 'Manter a sequência por 30 dias' },
    { id: 's100', category: 'streak', metric: 'streak', target: 100, icon: 'flame', title: '100 dias de sequência', desc: 'Manter a sequência por 100 dias' },

    { id: 'birthday', category: 'special', kind: 'birthday', target: 1, icon: 'gift', title: 'Treino de aniversário', desc: 'Treinar no dia do seu aniversário' }
  ];

  // Peso corporal vigente numa data (último registro até ela; senão o primeiro depois; senão o do perfil)
  function bodyweightAt(date, bodyweight, profile) {
    const list = [...(bodyweight || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const t = new Date(date).getTime();
    let found = null;
    list.forEach((e) => { if (new Date(e.date).getTime() <= t + DAY) found = e; });
    if (found) return found.kg;
    if (list.length) return list[0].kg;
    return profile && profile.weightKg ? profile.weightKg : null;
  }

  // Aniversário no mesmo dia/mês (quem nasceu em 29/02 comemora em 28/02 nos anos comuns)
  function isBirthday(date, birthDate) {
    if (!birthDate) return false;
    const [, bm, bd] = birthDate.split('-').map(Number);
    const d = new Date(date);
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === bm && day === bd) return true;
    const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return bm === 2 && bd === 29 && m === 2 && day === 28 && !leap(d.getFullYear());
  }

  const maxWeightIn = (session, ids) => Math.max(0, ...(session.exercises || [])
    .filter((e) => ids.includes(e.exerciseId))
    .flatMap((e) => (e.sets || []).filter(isWorkingSet).map((s) => s.weightKg || 0)));

  function evaluateKind(a, asc, ctx) {
    if (a.kind === 'lift') {
      let best = 0, date = null;
      asc.forEach((s) => { const w = maxWeightIn(s, a.exercises); best = Math.max(best, w); if (!date && w >= a.target) date = s.startedAt; });
      return { date, current: best };
    }
    if (a.kind === 'bench-bw') {
      let best = 0, date = null;
      asc.forEach((s) => {
        const w = maxWeightIn(s, ['supino-reto']);
        const bw = w ? bodyweightAt(s.startedAt, ctx.bodyweight, ctx.profile) : null;
        if (!bw) return;
        best = Math.max(best, w / bw);
        if (!date && w >= bw) date = s.startedAt;
      });
      return { date, current: best, needsWeight: !bodyweightAt(new Date(), ctx.bodyweight, ctx.profile) };
    }
    if (a.kind === 'week') {
      const weeks = new Map();
      let best = 0, date = null;
      asc.forEach((s) => {
        const wk = global.U.dayKey(global.U.startOfWeek(s.startedAt));
        if (!weeks.has(wk)) weeks.set(wk, new Set());
        weeks.get(wk).add(global.U.dayKey(s.startedAt));
        const n = weeks.get(wk).size;
        best = Math.max(best, n);
        if (!date && n >= a.target) date = s.startedAt;
      });
      return { date, current: best };
    }
    if (a.kind === 'birthday') {
      const birthDate = ctx.profile && ctx.profile.birthDate;
      const hit = birthDate ? asc.find((s) => isBirthday(s.startedAt, birthDate)) : null;
      return { date: hit ? hit.startedAt : null, current: hit ? 1 : 0, needsBirthDate: !birthDate };
    }
    return { date: null, current: 0 };
  }

  // Cada conquista guarda a data exata em que foi alcançada (recalculada do histórico).
  // ctx.cardio: dias de cardio também contam na sequência (as demais conquistas são de musculação)
  function evaluateAchievements(sessions, ctx = {}) {
    const asc = [...sessions].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    const tl = { workouts: [], volume: [], records: [], streak: [] };
    let vol = 0;
    asc.forEach((s, i) => {
      vol += sessionVolume(s);
      tl.workouts.push({ date: s.startedAt, value: i + 1 });
      tl.volume.push({ date: s.startedAt, value: vol });
    });
    groupRecords(calculatePersonalRecords(asc)).reverse().forEach((r, i) => tl.records.push({ date: r.date, value: i + 1 }));
    let chainStart = null, prev = null;
    const activeDays = asc.map((s) => global.U.dayKey(s.startedAt)).concat((ctx.cardio || []).map((c) => global.U.dayKey(c.startedAt)));
    [...new Set(activeDays)].sort().map(keyToDate).forEach((d) => {
      if (!prev || diffDays(prev, d) - 1 > STREAK_MAX_GAP) chainStart = d;
      prev = d;
      tl.streak.push({ date: d.toISOString(), value: diffDays(chainStart, d) + 1 });
    });
    const now = {
      workouts: asc.length, volume: vol, records: tl.records.length,
      streak: tl.streak.length ? Math.max(...tl.streak.map((x) => x.value)) : 0
    };
    return ACHIEVEMENTS.map((a) => {
      if (a.kind) {
        const r = evaluateKind(a, asc, ctx);
        return Object.assign({}, a, r, { unlocked: !!r.date, progress: Math.min(1, (r.current || 0) / a.target) });
      }
      const hit = tl[a.metric].find((x) => x.value >= a.target);
      return Object.assign({}, a, {
        unlocked: !!hit, date: hit ? hit.date : null,
        current: Math.min(now[a.metric], a.target), progress: Math.min(1, now[a.metric] / a.target)
      });
    });
  }

  /* ---------- Insights ----------
     Frases calculadas só a partir dos dados salvos. Nada inventado, nada de diagnóstico.
     cardio (opcional): registros de cardio, para o tempo de cardio da semana e a folga desde a última atividade. */
  function generateInsights(sessions, bodyweight = [], ref = new Date(), { cardio = [] } = {}) {
    const U = global.U;
    const out = [];
    const now = ref.getTime();
    const weekStart = U.startOfWeek(ref).getTime();
    const cardioWeek = cardio.filter((c) => { const t = new Date(c.startedAt).getTime(); return t >= weekStart && t < weekStart + 7 * DAY; });
    const cardioMin = Math.round(cardioWeek.reduce((n, c) => n + (c.durationSec || 0), 0) / 60);
    if (!sessions.length) {
      if (cardioMin) out.push({ icon: 'heartPulse', text: `Você fez ${cardioMin} min de cardio esta semana.` });
      return out;
    }
    const vol = (from, to) => summarize(inRange(sessions, from, to)).volume;

    const week = calculateWeeklyStats(sessions, ref);
    if (week.count) out.push({ icon: 'calendar', text: `Você treinou ${week.count === 1 ? '1 vez' : `${week.count} vezes`} esta semana.` });
    if (cardioMin) out.push({ icon: 'heartPulse', text: `Você fez ${cardioMin} min de cardio esta semana.` });

    const v1 = vol(now - 7 * DAY, now + 1), v0 = vol(now - 14 * DAY, now - 7 * DAY);
    if (v0 > 0 && v1 > 0) {
      const pct = Math.round(((v1 - v0) / v0) * 100);
      if (Math.abs(pct) >= 5) out.push({ icon: 'chart', text: `Seu volume dos últimos 7 dias está ${Math.abs(pct)}% ${pct > 0 ? 'acima' : 'abaixo'} dos 7 dias anteriores.` });
    }

    const ws = U.startOfWeek(ref).getTime();
    const wv = [3, 2, 1].map((k) => vol(ws - k * 7 * DAY, ws - (k - 1) * 7 * DAY));
    if (wv.every((v) => v > 0) && wv[0] < wv[1] && wv[1] < wv[2]) out.push({ icon: 'chart', text: 'Seu volume aumentou nas últimas 3 semanas.' });

    const recs = groupRecords(calculatePersonalRecords(sessions));
    const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime();
    const monthRecs = recs.filter((r) => new Date(r.date).getTime() >= monthStart).length;
    if (monthRecs) out.push({ icon: 'trophy', text: `Você bateu ${monthRecs === 1 ? '1 recorde' : `${monthRecs} recordes`} este mês.` });
    if (recs.length) out.push({ icon: 'trophy', text: `Seu último recorde foi em ${recs[0].name}, ${U.fmtDayMonth(recs[0].date)}.` });

    // O exercício mais frequente dos últimos 60 dias que está evoluindo
    const recent = inRange(sessions, now - 60 * DAY, now + 1);
    const freq = new Map();
    recent.forEach((s) => (s.exercises || []).forEach((e) => freq.set(e.exerciseId, { n: (freq.get(e.exerciseId)?.n || 0) + 1, name: e.name })));
    let best = null;
    [...freq.entries()].filter(([, f]) => f.n >= 3).forEach(([id, f]) => {
      const series = exerciseSeries(recent, id);
      const a = series[0], b = series[series.length - 1];
      const useE1 = a.best1RM > 0 && b.best1RM > 0;
      const from = useE1 ? a.best1RM : a.topWeight, to = useE1 ? b.best1RM : b.topWeight;
      if (from > 0 && to > from * 1.025) {
        const gain = to / from;
        if (!best || gain > best.gain) best = { gain, name: f.name, from, to, useE1, weeks: Math.max(1, Math.round((new Date(b.date) - new Date(a.date)) / (7 * DAY))) };
      }
    });
    if (best) {
      const fmt = (v) => U.fmtWeight(v, { dec: 1 });
      out.push({ icon: 'bolt', text: `${best.name} está evoluindo: ${best.useE1 ? '1RM estimado' : 'carga'} de ${fmt(best.from)} para ${fmt(best.to)} em ${best.weeks === 1 ? '1 semana' : `${best.weeks} semanas`}.` });
    }

    // Folga desde a última atividade (treino ou cardio)
    const lastDay = Math.max(...sessions.concat(cardio).map((s) => new Date(s.startedAt).getTime()));
    const gap = diffDays(new Date(lastDay), ref);
    if (gap >= 5) out.push({ icon: 'info', text: `Faz ${gap} dias desde seu último treino.` });

    const bw = [...(bodyweight || [])].filter((e) => new Date(e.date).getTime() >= now - 30 * DAY).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (bw.length >= 2) {
      const delta = bw[bw.length - 1].kg - bw[0].kg;
      if (Math.abs(delta) >= 0.1) out.push({ icon: 'scale', text: `Seu peso corporal variou ${delta > 0 ? '+' : '−'}${U.fmtWeight(Math.abs(delta), { dec: 1 })} nos últimos 30 dias.` });
    }
    return out;
  }

  global.Statistics = {
    STREAK_MAX_GAP, streakInfo, trainingChains,
    bucketize, exerciseSeries, dailyActivity, latestBodyweight,
    goalStatus, ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, evaluateAchievements, bodyweightAt, isBirthday, generateInsights,
    calculateVolume, calculateEstimated1RM, isWorkingSet, workingSets, sessionVolume,
    calculateWeeklyStats, calculateTotals, calculateStreak, calculateProgress,
    RECORD_LABEL: { weight: 'Maior carga', e1rm: '1RM estimado', reps: 'Mais repetições', volume: 'Maior volume' },
    E1RM_MAX_REPS, estimated1RMForSet, setsVolume, detectSetRecords, calculatePersonalRecords, groupRecords, exerciseStats,
    PERIOD_DAYS, periodStart, filterByPeriod
  };
})(window);
