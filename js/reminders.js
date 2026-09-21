/* FORJA — lembretes de treino e de peso corporal
   Sem servidor, um app web não consegue acordar o celular sozinho. Por isso são três camadas:
   1. Na tela inicial: "Hoje é dia de treino" e o cartão "Dia de se pesar" (sempre funciona).
   2. Notificações do navegador: chegam enquanto o FORJA está aberto ou instalado (service worker).
   3. Calendário: um arquivo .ics com eventos semanais e alarme — o celular avisa mesmo com o app fechado.
   Estado: Store 'reminders' = { workout: { on, days: [0–6], time }, weight: { on, day, time }, notify, last: {} } */
(function (global) {
  'use strict';
  const { U, UI, Store } = global;
  const { esc, icon } = U;
  const Router = () => global.App.Router;

  // Semana começando na segunda (0 = domingo, como Date.getDay)
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const DAY_LETTER = { 0: 'D', 1: 'S', 2: 'T', 3: 'Q', 4: 'Q', 5: 'S', 6: 'S' };
  const DAY_SHORT = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
  const DAY_LONG = { 0: 'domingo', 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
  const DAY_PLURAL = { 0: 'aos domingos', 1: 'às segundas', 2: 'às terças', 3: 'às quartas', 4: 'às quintas', 5: 'às sextas', 6: 'aos sábados' };
  const ICS_DAY = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
  const SUGGESTED_DAYS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };

  const get = () => Store.get('reminders');
  const save = (fn) => Store.update('reminders', fn);
  const sortDays = (days) => WEEK.filter((d) => days.includes(d));

  const timeParts = (t) => { const [h, m] = String(t || '00:00').split(':').map(Number); return [h || 0, m || 0]; };
  const atTime = (date, t) => { const d = new Date(date); const [h, m] = timeParts(t); d.setHours(h, m, 0, 0); return d; };

  function daysText(days) {
    const d = sortDays(days);
    if (!d.length) return 'Nenhum dia';
    if (d.length === 7) return 'Todos os dias';
    if (d.join() === '1,2,3,4,5') return 'Seg a Sex';
    return d.map((x) => DAY_SHORT[x]).join(', ');
  }

  // Linha curta para o Perfil
  function summary() {
    const r = get();
    if (r.workout.on && r.weight.on) return 'Treino e peso';
    if (r.workout.on) return `${daysText(r.workout.days)} · ${r.workout.time}`;
    if (r.weight.on) return `Peso ${DAY_PLURAL[r.weight.day].replace(/^(às|aos) /, '')}`;
    return 'Desligados';
  }

  /* ==========================================================================
     O que lembrar agora
     ========================================================================== */
  const sessionsToday = () => {
    const key = U.dayKey(new Date());
    return global.Sessions.all().filter((s) => U.dayKey(s.startedAt) === key);
  };

  // Última pesagem programada que já passou (hoje depois do horário, ou o dia da semana anterior)
  function lastWeighIn(now = new Date()) {
    const { day, time } = get().weight;
    let d = atTime(now, time);
    const back = (now.getDay() - day + 7) % 7;
    d = U.addDays(d, -back);
    if (d > now) d = U.addDays(d, -7);
    return d;
  }

  function weightDue(now = new Date()) {
    const r = get();
    if (!r.weight.on) return false;
    const occ = lastWeighIn(now);
    const occKey = U.dayKey(occ);
    if (r.last.weightSnooze === occKey) return false;
    const since = U.startOfDay(occ).getTime();
    return !Store.get('bodyweight').some((e) => new Date(e.date).getTime() >= since);
  }

  // Para a Home
  function today(workout) {
    const r = global.Plans.isPremium() ? get() : { workout: { on: false, days: [] }, weight: { on: false } };
    const now = new Date();
    const last = [...Store.get('bodyweight')].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return {
      workoutDay: !!(r.workout.on && r.workout.days.includes(now.getDay()) && workout),
      trainedToday: sessionsToday().length > 0 && !global.Sessions.active(),
      weightDue: r.weight.on && weightDue(now),
      lastWeight: last ? `${U.fmtWeight(last.kg)} · ${U.fmtDayMonth(last.date)}`.replace(/ (?=kg|lb|[A-Z]{3})/g, '\u00a0') : ''
    };
  }

  function snoozeWeight() {
    const key = U.dayKey(lastWeighIn());
    save((r) => { r.last.weightSnooze = key; });
  }

  /* ==========================================================================
     Notificações
     ========================================================================== */
  const supported = () => 'Notification' in global;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  let swReg = null;

  function registerWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => { swReg = reg; }).catch(() => { /* sem service worker: usa Notification direto */ });
  }

  function notify(title, body, hash, tag) {
    if (permission() !== 'granted') return;
    const url = `${location.pathname}${hash}`;
    const opts = { body, icon: 'assets/icons/icon.svg', badge: 'assets/icons/icon.svg', tag, data: { url } };
    if (swReg && swReg.showNotification) { swReg.showNotification(title, opts).catch(() => {}); return; }
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { global.focus(); location.hash = hash; n.close(); };
    } catch (e) { /* Android exige service worker; sem ele, fica só o aviso na tela inicial */ }
  }

  const STALE_MS = 4 * 3600 * 1000; // passou há mais de 4h: não avisa mais (o aviso da Home cobre)

  function check() {
    const r = get();
    const now = new Date();
    const hidden = document.visibilityState !== 'visible';
    const key = U.dayKey(now);

    if (r.workout.on && r.workout.days.includes(now.getDay()) && r.last.workout !== key) {
      const at = atTime(now, r.workout.time);
      if (now >= at) {
        save((x) => { x.last.workout = key; });
        const w = global.Workouts.next();
        if (r.notify && hidden && now - at < STALE_MS && !sessionsToday().length && !global.Sessions.active()) {
          notify('Hora do treino', w ? `${w.name} está pronto. Bora?` : 'Hoje é dia de treino.', '#/home', 'forja-treino');
        }
      }
    }

    if (r.weight.on) {
      const occ = lastWeighIn(now);
      const occKey = U.dayKey(occ);
      if (r.last.weight !== occKey && weightDue(now)) {
        save((x) => { x.last.weight = occKey; });
        if (r.notify && hidden && now - occ < STALE_MS) notify('Dia de se pesar', 'Registre seu peso para acompanhar a evolução.', '#/progress/body', 'forja-peso');
      }
    }
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    registerWorker();
    check();
    setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
  }

  function enableNotifications(onDone) {
    if (!supported()) { UI.toast('Este navegador não oferece notificações.', { iconName: 'info' }); return onDone(false); }
    const finish = (p) => {
      const ok = p === 'granted';
      save((r) => { r.notify = ok; });
      if (!ok) UI.toast(p === 'denied' ? 'Notificações bloqueadas. Libere nas configurações do site.' : 'Notificações não ativadas.', { iconName: 'info', duration: 4000 });
      onDone(ok);
    };
    if (Notification.permission !== 'default') return finish(Notification.permission);
    Promise.resolve(Notification.requestPermission()).then(finish).catch(() => finish('denied'));
  }

  /* ==========================================================================
     Calendário (.ics) — o celular avisa mesmo com o FORJA fechado
     ========================================================================== */
  const icsDate = (d) => `${d.getFullYear()}${U.pad(d.getMonth() + 1)}${U.pad(d.getDate())}T${U.pad(d.getHours())}${U.pad(d.getMinutes())}00`;
  const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  // Primeira ocorrência a partir de hoje em um dos dias escolhidos
  function firstOccurrence(days, time) {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = atTime(U.addDays(now, i), time);
      if (days.includes(d.getDay()) && d > now) return d;
    }
    return atTime(U.addDays(now, 1), time);
  }

  function event({ uid, start, minutes, days, summary: title, description, alarm }) {
    return [
      'BEGIN:VEVENT',
      `UID:${uid}@forja.app`,
      `DTSTAMP:${icsUtc(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DURATION:PT${minutes}M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${sortDays(days).map((d) => ICS_DAY[d]).join(',')}`,
      `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText(description)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(alarm)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT'
    ];
  }

  function buildICS() {
    const r = get();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FORJA//Lembretes//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:FORJA'];
    const stamp = Date.now().toString(36);
    if (r.workout.on && r.workout.days.length) {
      const prog = global.Programs.state();
      lines.push(...event({
        uid: `treino-${stamp}`, start: firstOccurrence(r.workout.days, r.workout.time), minutes: 60, days: r.workout.days,
        summary: 'Treino · FORJA',
        description: prog ? `Programa ${global.Programs.get(prog.id).name}. Abra o FORJA para ver o treino do dia.` : 'Abra o FORJA para ver o treino do dia.',
        alarm: 'Hora do treino'
      }));
    }
    if (r.weight.on) {
      lines.push(...event({
        uid: `peso-${stamp}`, start: firstOccurrence([r.weight.day], r.weight.time), minutes: 10, days: [r.weight.day],
        summary: 'Registrar peso · FORJA', description: 'Pese-se e registre no FORJA (Evolução › Peso corporal).', alarm: 'Dia de se pesar'
      }));
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function downloadICS() {
    const r = get();
    if (!r.workout.on && !r.weight.on) { UI.toast('Ligue um lembrete primeiro.', { iconName: 'info' }); return; }
    const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forja-lembretes.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    UI.toast('Abra o arquivo para adicionar ao calendário', { iconName: 'calendar', duration: 4000 });
  }

  /* ==========================================================================
     Tela de configuração (#/profile/reminders)
     ========================================================================== */
  function dayChips(selected, { name, single = false }) {
    return `
      <div class="rm-days" role="${single ? 'radiogroup' : 'group'}" aria-label="${esc(name)}" data-days="${esc(name)}">
        ${WEEK.map((d) => `
          <button type="button" class="chip is-choice rm-day" role="${single ? 'radio' : 'checkbox'}" aria-checked="${selected.includes(d)}"
                  data-day="${d}" aria-label="${DAY_LONG[d]}">${DAY_LETTER[d]}</button>`).join('')}
      </div>`;
  }

  function permissionText() {
    const p = permission();
    if (p === 'unsupported') return 'Este navegador não oferece notificações.';
    if (p === 'denied') return 'Bloqueadas neste navegador. Libere nas configurações do site.';
    return 'Chegam no horário enquanto o FORJA estiver aberto ou instalado na tela inicial.';
  }

  function render(root) {
    const r = get();
    const prog = global.Programs.state();
    const suggested = prog ? SUGGESTED_DAYS[prog.perWeek] : null;
    const showSuggest = r.workout.on && suggested && sortDays(r.workout.days).join() !== suggested.join();
    const anyOn = r.workout.on || r.weight.on;

    root.innerHTML = `
      ${UI.navbarHTML('Lembretes', 'Perfil')}
      <section class="page has-navbar">
        <header>
          <h1 class="t-large-title" data-large-title>Lembretes</h1>
          <p class="t-sub mt-2">Um empurrão na hora certa. Constância é o que mais faz diferença no resultado.</p>
        </header>

        <div class="section">
          <p class="t-eyebrow group-label">Treino</p>
          <div class="group">
            <div class="row">
              <span class="row-main"><span class="row-title block">Lembrar de treinar</span>
                <span class="row-sub block">${r.workout.on ? `${daysText(r.workout.days)} às ${esc(r.workout.time)}` : 'Desligado'}</span></span>
              <span data-slot="workout-on"></span>
            </div>
            ${r.workout.on ? `
              <div class="row rm-row-days">${dayChips(r.workout.days, { name: 'workout' })}</div>
              <label class="row"><span class="row-main row-title">Horário</span>
                <input type="time" class="rm-time num" data-time="workout" value="${esc(r.workout.time)}" aria-label="Horário do treino"></label>` : ''}
          </div>
          ${showSuggest ? `
            <p class="t-footnote group-note">Seu programa pede ${prog.perWeek} treinos por semana: ${daysText(suggested)}.
              <button type="button" class="text-btn rm-inline" data-suggest>Usar esses dias</button></p>` : ''}
        </div>

        <div class="section">
          <p class="t-eyebrow group-label">Peso corporal</p>
          <div class="group">
            <div class="row">
              <span class="row-main"><span class="row-title block">Lembrar de me pesar</span>
                <span class="row-sub block">${r.weight.on ? `Toda ${DAY_LONG[r.weight.day]}${r.weight.day === 0 || r.weight.day === 6 ? '' : '-feira'} às ${esc(r.weight.time)}`.replace('Toda domingo', 'Todo domingo').replace('Toda sábado', 'Todo sábado') : 'Desligado'}</span></span>
              <span data-slot="weight-on"></span>
            </div>
            ${r.weight.on ? `
              <div class="row rm-row-days">${dayChips([r.weight.day], { name: 'weight', single: true })}</div>
              <label class="row"><span class="row-main row-title">Horário</span>
                <input type="time" class="rm-time num" data-time="weight" value="${esc(r.weight.time)}" aria-label="Horário da pesagem"></label>` : ''}
          </div>
          <p class="t-footnote group-note">Uma vez por semana, no mesmo dia e horário, de preferência ao acordar. Assim a variação do dia a dia não engana.</p>
        </div>

        <div class="section">
          <p class="t-eyebrow group-label">Como avisar</p>
          <div class="group has-icons">
            <div class="row">
              <span class="row-icon" style="--ic:var(--blue)">${icon('home', { size: 20 })}</span>
              <span class="row-main"><span class="row-title block">Na tela inicial</span>
                <span class="row-sub block">Aviso ao abrir o FORJA no dia certo.</span></span>
              <span class="row-value">${anyOn ? 'Ativo' : '—'}</span>
            </div>
            <div class="row">
              <span class="row-icon" style="--ic:var(--red)">${icon('bell', { size: 20 })}</span>
              <span class="row-main"><span class="row-title block">Notificações</span>
                <span class="row-sub block">${permissionText()}</span></span>
              <span data-slot="notify"></span>
            </div>
            ${r.notify && permission() === 'granted' ? `
              <button type="button" class="row" data-test>
                <span class="row-icon">${icon('sparkle', { size: 20 })}</span>
                <span class="row-main row-title">Enviar notificação de teste</span>
              </button>` : ''}
            <button type="button" class="row" data-ics ${anyOn ? '' : 'disabled'}>
              <span class="row-icon">${icon('calendar', { size: 20 })}</span>
              <span class="row-main"><span class="row-title block">Adicionar ao calendário</span>
                <span class="row-sub block">O calendário do celular avisa mesmo com o FORJA fechado.</span></span>
              ${icon('download', { size: 18, stroke: 1.8, cls: 'row-chevron' })}
            </button>
          </div>
          <p class="t-footnote group-note">Mudou os dias ou horários? Gere o arquivo de novo e apague os eventos antigos do FORJA no calendário.</p>
        </div>
      </section>`;

    const refresh = () => setTimeout(() => Router().refresh(), 180);
    const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
    slot('workout-on').appendChild(UI.toggle(r.workout.on, (v) => {
      save((x) => { x.workout.on = v; if (v && suggested && !x.workout.touched) x.workout.days = suggested; });
      refresh();
    }, { label: 'Lembrar de treinar' }));
    slot('weight-on').appendChild(UI.toggle(r.weight.on, (v) => { save((x) => { x.weight.on = v; }); refresh(); }, { label: 'Lembrar de me pesar' }));
    const nt = UI.toggle(r.notify && permission() === 'granted', (v) => {
      if (!v) { save((x) => { x.notify = false; }); return refresh(); }
      enableNotifications((ok) => { if (!ok) nt.setAttribute('aria-checked', 'false'); refresh(); });
    }, { label: 'Notificações' });
    if (permission() === 'unsupported' || permission() === 'denied') nt.disabled = true;
    slot('notify').appendChild(nt);

    root.querySelectorAll('[data-days]').forEach((group) => group.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      const d = Number(b.dataset.day);
      if (group.dataset.days === 'weight') {
        save((x) => { x.weight.day = d; });
      } else {
        const cur = get().workout.days;
        const next = cur.includes(d) ? cur.filter((x) => x !== d) : cur.concat(d);
        if (!next.length) { UI.toast('Escolha pelo menos um dia.', { iconName: 'info' }); return; }
        save((x) => { x.workout.days = sortDays(next); x.workout.touched = true; });
      }
      U.haptic('tap');
      Router().refresh();
    }));
    root.querySelectorAll('[data-time]').forEach((input) => input.addEventListener('change', () => {
      if (!/^\d{2}:\d{2}$/.test(input.value)) return;
      const which = input.dataset.time;
      save((x) => { x[which].time = input.value; delete x.last[which]; });
      Router().refresh();
    }));
    root.querySelector('[data-suggest]')?.addEventListener('click', () => {
      save((x) => { x.workout.days = suggested; x.workout.touched = true; });
      Router().refresh();
      UI.toast('Dias ajustados ao programa');
    });
    root.querySelector('[data-test]')?.addEventListener('click', () => {
      const w = global.Workouts.next();
      notify('Hora do treino', w ? `${w.name} está pronto. Bora?` : 'Hoje é dia de treino.', '#/home', 'forja-teste');
      UI.toast('Notificação enviada');
    });
    root.querySelector('[data-ics]')?.addEventListener('click', downloadICS);
  }

  global.Reminders = { summary, today, snoozeWeight, start, check, render, buildICS, weightDue, lastWeighIn };
})(window);
