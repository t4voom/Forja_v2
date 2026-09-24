/* FORJA — aplicação: tema, navegação, Home, Perfil e primeiro acesso */
(function (global) {
  'use strict';
  const { U, UI, Store, Statistics, Workouts, Sessions } = global;
  const { $, esc, icon } = U;

  /* ==========================================================================
     Opções e validações compartilhadas
     ========================================================================== */
  const GOALS = [
    { value: 'mass', label: 'Ganhar massa' },
    { value: 'strength', label: 'Aumentar força' },
    { value: 'fat', label: 'Perder gordura' },
    { value: 'conditioning', label: 'Condicionamento' },
    { value: 'other', label: 'Outro' }
  ];
  const EXPERIENCE = [
    { value: 'beginner', label: 'Iniciante' },
    { value: 'intermediate', label: 'Intermediário' },
    { value: 'advanced', label: 'Avançado' }
  ];
  const labelOf = (list, value) => (list.find((o) => o.value === value) || {}).label || '';

  const WEIGHT_KG = { min: 25, max: 350 };
  const HEIGHT_CM = { min: 100, max: 250 };

  const Validate = {
    name(input) {
      const v = String(input || '').trim().replace(/\s+/g, ' ');
      if (!v) return { ok: false, error: 'Digite seu nome.' };
      if (v.length > 30) return { ok: false, error: 'Use até 30 caracteres.' };
      if (!/\p{L}/u.test(v)) return { ok: false, error: 'O nome precisa ter letras.' };
      return { ok: true, value: v };
    },
    weight(input, unit = U.currentUnit()) {
      const n = U.parseDecimal(input);
      if (!Number.isFinite(n)) return { ok: false, error: 'Digite um número, como 72,5.' };
      const kg = U.fromUnit(n, unit);
      if (kg < WEIGHT_KG.min || kg > WEIGHT_KG.max) {
        const lo = U.fmtNum(Math.ceil(U.toUnit(WEIGHT_KG.min, unit)));
        const hi = U.fmtNum(Math.floor(U.toUnit(WEIGHT_KG.max, unit)));
        return { ok: false, error: `Informe um peso entre ${lo} e ${hi} ${unit}.` };
      }
      return { ok: true, value: U.round(kg, 2) };
    },
    height(input) {
      const n = U.parseDecimal(input);
      if (!Number.isFinite(n)) return { ok: false, error: 'Digite a altura em centímetros, como 175.' };
      if (n < HEIGHT_CM.min || n > HEIGHT_CM.max) return { ok: false, error: `Informe uma altura entre ${HEIGHT_CM.min} e ${HEIGHT_CM.max} cm.` };
      return { ok: true, value: Math.round(n) };
    }
  };

  // Peso do perfil também alimenta o histórico de peso corporal (um registro por dia)
  function logBodyweight(kg, date = new Date()) {
    const key = U.dayKey(date);
    Store.update('bodyweight', (list) => {
      const existing = list.find((e) => U.dayKey(e.date) === key);
      if (existing) existing.kg = kg;
      else list.push({ id: U.uid('bw_'), date: date.toISOString(), kg });
      list.sort((a, b) => new Date(a.date) - new Date(b.date));
    });
  }

  // "18 de setembro" (o ano não aparece; só dia e mês importam)
  const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const fmtBirthday = (v) => { const [, m, d] = v.split('-').map(Number); return `${d} de ${MONTHS_LONG[m - 1]}`; };

  // Valor de peso para exibir em um campo editável (na unidade atual)
  const weightInputValue = (kg) => (kg ? U.fmtNum(U.round(U.toUnit(kg), 1), 1).replace(/\./g, '') : '');

  // Idade: calculada pela data de nascimento; sem ela, a idade digitada à mão (profile.age)
  function ageOf(p) {
    if (p.birthDate) {
      const [y, m, d] = p.birthDate.split('-').map(Number);
      const now = new Date();
      let a = now.getFullYear() - y;
      if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
      return a >= 0 ? a : null;
    }
    return Number.isFinite(p.age) ? p.age : null;
  }

  // Código da academia: valida no servidor, atualiza a tela e já baixa os treinos do treinador
  function openAcademyCode() {
    global.Plans.openCodeSheet('academy', () => {
      Router.refresh();
      Remote.sync({ force: true });
    });
  }

  // IMC é sempre calculado (nunca salvo), com peso e altura válidos
  function bmiOf(p) {
    const kg = p.weightKg, cm = p.heightCm;
    if (!(kg >= WEIGHT_KG.min && kg <= WEIGHT_KG.max && cm >= HEIGHT_CM.min && cm <= HEIGHT_CM.max)) return null;
    return U.round(kg / ((cm / 100) ** 2), 1);
  }

  /* ==========================================================================
     Tema e preferências visuais
     ========================================================================== */
  const mqLight = global.matchMedia('(prefers-color-scheme: light)');

  function applyTheme() {
    const s = Store.get('settings');
    const resolved = s.theme === 'system' ? (mqLight.matches ? 'light' : 'dark') : s.theme;
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.classList.toggle('no-motion', s.animations === false);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#F5F5F7' : '#000000');
  }
  if (mqLight.addEventListener) {
    mqLight.addEventListener('change', () => { if (Store.get('settings').theme === 'system') applyTheme(); });
  }

  /* ==========================================================================
     Home
     ========================================================================== */
  const Home = {
    render(root) {
      const profile = Store.get('profile') || {};
      const name = U.firstName(profile.name);
      global.Programs.sync();
      const workout = Workouts.next();
      const live = Sessions.active();
      const history = Sessions.all();
      const week = Statistics.calculateWeeklyStats(history);
      const streak = Statistics.streakInfo(history);
      const insights = Statistics.generateInsights(history, Store.get('bodyweight'));
      // O alerta de equilíbrio mais importante entra primeiro nos insights
      const balance = global.Plans.isPremium() ? global.Balance.topAlert(history) : null;
      if (balance) insights.unshift({ icon: 'balance', text: balance.title, go: 'progress/balance' });
      const today = global.Reminders.today(workout);
      const time = U.durationParts(week.durationSec);
      const now = new Date();

      root.innerHTML = `
        <section class="page home reveal">
          <div class="home-top" style="--i:0">
            <span class="wordmark">FORJA</span>
            <span class="t-eyebrow">${U.fmtWeekdayDate(now)}</span>
          </div>

          <header class="home-hello" style="--i:1">
            <h1 class="t-large-title" data-large-title>${U.greeting(now)}${name ? `, ${esc(name)}` : ''}.</h1>
            <p class="t-sub mt-2">${live ? 'Seu treino está em andamento.' : today.trainedToday ? 'Treino de hoje feito. Bom descanso.' : today.workoutDay && workout ? 'Hoje é dia de treino.' : workout ? 'Seu treino está pronto.' : 'Vamos montar sua rotina.'}</p>
          </header>

          ${today.weightDue ? `
            <div class="nudge mt-8" style="--i:2">
              <span class="nudge-icon">${icon('scale', { size: 20, stroke: 1.7 })}</span>
              <span class="min-w-0 flex-1">
                <span class="row-title block">Dia de se pesar</span>
                <span class="row-sub block">${today.lastWeight ? `Último: ${esc(today.lastWeight)}` : 'Registre para acompanhar a evolução.'}</span>
              </span>
              <span class="nudge-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-action="weight">Registrar</button>
                <button type="button" class="icon-btn is-plain" data-action="snooze-weight" aria-label="Agora não">${icon('close', { size: 16, stroke: 2 })}</button>
              </span>
            </div>` : ''}

          ${Home.showAcademyCard() ? `
            <div class="nudge mt-6" style="--i:2">
              <span class="nudge-icon is-accent">${icon('dumbbell', { size: 20, stroke: 1.7 })}</span>
              <span class="min-w-0 flex-1">
                <span class="row-title block">Treina em academia?</span>
                <span class="row-sub block">Entre com o código e ganhe o Premium.</span>
              </span>
              <span class="nudge-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-action="academy">Entrar</button>
                <button type="button" class="icon-btn is-plain" data-action="hide-academy" aria-label="Agora não">${icon('close', { size: 16, stroke: 2 })}</button>
              </span>
            </div>` : ''}

          <div class="mt-12" style="--i:2">
            <p class="t-eyebrow mb-4">${live ? 'Treino de hoje' : workout ? 'Seu próximo treino' : 'Comece por aqui'}</p>
            ${live ? Home.heroLive(live) : workout ? Home.heroWorkout(workout) : Home.heroEmpty()}
          </div>

          <div class="section" style="--i:3">
            <div class="section-head"><p class="t-eyebrow">Esta semana</p></div>
            <div class="stats ${week.count ? '' : 'is-empty'}">
              <div class="stat">
                <span class="stat-value">${week.count}</span>
                <span class="stat-label">${week.count === 1 ? 'Treino' : 'Treinos'}</span>
              </div>
              <div class="stat">
                <span class="stat-value">${U.fmtVolume(week.volume, { withUnit: false })}</span>
                <span class="stat-label">${U.currentUnit()} de volume</span>
              </div>
              <div class="stat">
                <span class="stat-value">${time.value}<small>${time.unit}</small></span>
                <span class="stat-label">Treinando</span>
              </div>
            </div>
            ${week.count ? '' : '<p class="t-footnote mt-6">Sua semana começa no primeiro treino.</p>'}
          </div>

          ${streak.days || insights.length ? `
            <div class="section" style="--i:4">
              ${streak.days ? `
                <button type="button" class="streak-chip" data-action="progress">
                  ${icon('flame', { size: 18, stroke: 1.8 })}<span class="num">${streak.days}</span> ${streak.days === 1 ? 'dia de sequência' : 'dias de sequência'}
                </button>` : ''}
              ${insights.length ? `
                <ul class="insights ${streak.days ? 'mt-5' : ''}">
                  ${insights.slice(0, 3).map((i) => i.go
                    ? `<li><button type="button" class="insight is-link" data-go="${esc(i.go)}"><span class="insight-icon">${icon(i.icon, { size: 18, stroke: 1.8 })}</span><span class="flex-1 text-left">${esc(i.text)}</span>${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}</button></li>`
                    : `<li class="insight"><span class="insight-icon">${icon(i.icon, { size: 18, stroke: 1.8 })}</span><span>${esc(i.text)}</span></li>`).join('')}
                </ul>` : ''}
            </div>` : ''}
        </section>`;
      root.querySelectorAll('[data-action="progress"]').forEach((b) => b.addEventListener('click', () => Router.go('progress')));
      root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => Router.go(b.dataset.go)));
      root.querySelector('[data-action="weight"]')?.addEventListener('click', () => global.Progress.openWeightSheet());
      root.querySelector('[data-action="snooze-weight"]')?.addEventListener('click', () => { global.Reminders.snoozeWeight(); Router.refresh(); });
      root.querySelector('[data-action="academy"]')?.addEventListener('click', () => openAcademyCode());
      root.querySelector('[data-action="hide-academy"]')?.addEventListener('click', () => {
        Store.update('settings', (s) => { s.hideAcademyCard = true; });
        Router.refresh();
        UI.toast('Você encontra essa opção em Perfil › Academia', { iconName: 'info' });
      });

      root.querySelectorAll('[data-action="create"]').forEach((b) => b.addEventListener('click', () => Workouts.openCreate()));
      root.querySelectorAll('[data-action="open"]').forEach((b) => b.addEventListener('click', () => Router.go(`workouts/${b.dataset.id}`)));
      root.querySelectorAll('[data-action="start"]').forEach((b) => b.addEventListener('click', () => Sessions.begin(b.dataset.id)));
      root.querySelectorAll('[data-action="resume"]').forEach((b) => b.addEventListener('click', () => Sessions.open()));
    },

    // Convite para entrar com o código da academia (só com servidor e sem academia)
    showAcademyCard() {
      return global.Backend.mode === 'sheets' && !(global.Plans.account().academia || {}).vinculada && !Store.get('settings').hideAcademyCard;
    },

    heroLive(a) {
      const done = a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
      const total = a.exercises.reduce((n, e) => n + e.sets.length, 0);
      const elapsed = ((a.finishing ? new Date(a.finishing.endedAt) : Date.now()) - new Date(a.startedAt)) / 1000;
      return `
        <article class="hero" style="--tint:${esc(a.color || 'var(--accent)')}">
          <button type="button" class="hero-open" data-action="resume" aria-label="Continuar ${esc(a.name)}">
            <span class="badge"><span class="live-dot"></span>Em andamento</span>
            <span class="hero-name block">${esc(a.name)}</span>
            <span class="hero-clock block num" data-clock>${U.fmtClock(elapsed)}</span>
            <span class="t-callout block mt-1">${done} de ${total} séries</span>
          </button>
          <div class="hero-foot">
            <span class="t-footnote">${a.finishing ? 'Falta salvar' : 'Tempo total'}</span>
            <button class="btn btn-primary" data-action="resume">Continuar ${icon('arrowRight', { size: 18, stroke: 2 })}</button>
          </div>
        </article>`;
    },

    heroWorkout(w) {
      const last = Sessions.lastForWorkout(w.id);
      return `
        <article class="hero" style="--tint:${esc(w.color || 'var(--accent)')}">
          <button type="button" class="hero-open" data-action="open" data-id="${esc(w.id)}" aria-label="Ver ${esc(w.name)}">
            ${global.Programs.badgeFor(w.id) ? `<span class="badge">${esc(global.Programs.badgeFor(w.id))}</span>` : ''}
            <span class="hero-name block">${esc(w.name)}</span>
            <span class="hero-meta block">${esc(Workouts.muscleSummary(w) || 'Sem exercícios ainda')}</span>
            <span class="t-callout block mt-1">${Workouts.exerciseCount(w)}</span>
          </button>
          <div class="hero-foot">
            <span class="t-footnote">${last ? `Último em ${U.fmtDayMonth(last.startedAt)}` : 'Primeira vez'}</span>
            <button class="btn btn-primary" data-action="start" data-id="${esc(w.id)}">Começar ${icon('arrowRight', { size: 18, stroke: 2 })}</button>
          </div>
        </article>`;
    },

    heroEmpty() {
      return `
        <article class="hero">
          <div class="hero-icon">${icon('dumbbell', { size: 26 })}</div>
          <h2 class="hero-name">Seu primeiro<br>treino.</h2>
          <p class="t-sub mt-4">Escolha um programa pronto, com progressão de 8 semanas, ou monte sua rotina do zero.</p>
          <div class="hero-foot">
            <button class="btn btn-ghost is-muted" data-action="create">Criar do zero</button>
            <button class="btn btn-primary" data-go="workouts/programs">Ver programas ${icon('arrowRight', { size: 18, stroke: 2 })}</button>
          </div>
        </article>`;
    }
  };

  const syncText = (st) => ({ idle: 'Tudo sincronizado com a sua conta.', pending: 'Alterações aguardando envio…', syncing: 'Sincronizando…', offline: 'Sem conexão. As alterações sobem quando a internet voltar.' }[st] || '');

  /* ==========================================================================
     Perfil e configurações
     ========================================================================== */
  const Profile = {
    render(root) {
      const p = Store.get('profile') || {};
      const s = Store.get('settings');
      const t = Statistics.calculateTotals(Sessions.all());
      const streak = Statistics.streakInfo(Sessions.all());
      const vibrationSupported = typeof navigator.vibrate === 'function';

      const row = (key, label, value, iconName) => `
        <button class="row" data-edit="${key}">
          <span class="row-icon">${icon(iconName, { size: 20 })}</span>
          <span class="row-main row-title">${label}</span>
          <span class="row-value">${value || '<span class="t-faint">Definir</span>'}</span>
          ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
        </button>`;

      const stat = (label, value) => `
        <div class="row">
          <span class="row-main row-title">${label}</span>
          <span class="row-value">${value}</span>
        </div>`;

      root.innerHTML = `
        <section class="page">
          <header class="page-header">
            <h1 class="t-large-title" data-large-title>Perfil</h1>
          </header>

          <div class="reveal">
            <button class="profile-id pressable" data-edit="name" style="--i:0">
              <span class="avatar">${esc(U.initial(p.name))}</span>
              <span class="min-w-0 text-left">
                <span class="t-title-2 block truncate">${esc(p.name || 'Sem nome')}</span>
                <span class="t-callout block mt-1">${esc(labelOf(GOALS, p.goal) || 'Defina seu objetivo')}</span>
              </span>
            </button>

            <div class="section" style="--i:1">
              <p class="t-eyebrow group-label">Você</p>
              <div class="group has-icons">
                ${row('weight', 'Peso', p.weightKg ? U.fmtWeight(p.weightKg) : '', 'scale')}
                ${row('height', 'Altura', p.heightCm ? `${p.heightCm} cm` : '', 'ruler')}
                ${row('age', 'Idade', ageOf(p) != null ? U.plural(ageOf(p), 'ano', 'anos') : '', 'user')}
                ${row('goal', 'Objetivo', esc(labelOf(GOALS, p.goal)), 'target')}
                ${row('experience', 'Experiência', esc(labelOf(EXPERIENCE, p.experience)), 'bolt')}
                ${row('birthDate', 'Aniversário', p.birthDate ? fmtBirthday(p.birthDate) : '', 'gift')}
              </div>
              ${bmiOf(p) != null ? `<p class="t-footnote group-note">IMC ${U.fmtNum(bmiOf(p), 1)} · calculado com seu peso e altura atuais.</p>` : ''}
              ${(global.Plans.account().academia || {}).vinculada ? `<p class="t-footnote group-note">Seu treinador na ${esc(global.Plans.account().academia.nome)} vê seu peso, altura, idade e os treinos que você faz (séries, cargas e esforço), mas não as suas anotações.</p>` : ''}
            </div>

            <div class="section" style="--i:2">
              <p class="t-eyebrow group-label">Estatísticas</p>
              <div class="group">
                ${stat('Treinos', U.fmtNum(t.count))}
                ${stat('Séries', U.fmtNum(t.sets))}
                ${stat('Repetições', U.fmtNum(t.reps))}
                ${stat('Volume total', U.fmtVolume(t.volume))}
                ${stat('Tempo treinando', U.fmtDuration(t.durationSec))}
                ${stat('Sequência atual', U.plural(streak.days, 'dia', 'dias'))}
                ${stat('Maior sequência', U.plural(streak.best, 'dia', 'dias'))}
              </div>
            </div>

            <div class="section" style="--i:1">
              <p class="t-eyebrow group-label">Conta</p>
              <div class="group has-icons">
                <button class="row" data-go="profile/plan">
                  <span class="row-icon">${icon('crown', { size: 20 })}</span>
                  <span class="row-main row-title">Plano</span>
                  <span class="row-value">${global.Plans.isPremium() ? `<span class="t-accent">${esc(global.Plans.originLabel())}</span>` : 'Free'}</span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>
                ${global.Backend.mode === 'sheets' ? `
                <button class="row" data-academy-row>
                  <span class="row-icon">${icon('dumbbell', { size: 20 })}</span>
                  <span class="row-main row-title">Academia</span>
                  <span class="row-value">${(global.Plans.account().academia || {}).vinculada ? esc(global.Plans.account().academia.nome) : '<span class="t-faint">Entrar com código</span>'}</span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>` : ''}
                <div class="row">
                  <span class="row-icon">${icon('user', { size: 20 })}</span>
                  <span class="row-main row-title">E-mail</span>
                  <span class="row-value truncate profile-email">${esc((global.Backend.user() || {}).email || '')}</span>
                </div>
                ${global.Backend.mode === 'sheets' ? `
                <button class="row" data-action="password">
                  <span class="row-icon">${icon('lock', { size: 20 })}</span>
                  <span class="row-main row-title">Trocar senha</span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>` : ''}
                <button class="row" data-action="logout">
                  <span class="row-icon">${icon('logout', { size: 20 })}</span>
                  <span class="row-main row-title">Sair da conta</span>
                </button>
              </div>
              ${global.Sync.enabled() ? `<p class="t-footnote group-note" data-sync-state>${syncText(global.Sync.state())}</p>` : ''}
              ${global.Plans.isPremium() ? '' : `
                <button type="button" class="upsell pressable mt-4" data-go="profile/plan">
                  <span class="upsell-icon">${icon('sparkle', { size: 20, stroke: 1.8 })}</span>
                  <span class="min-w-0 text-left flex-1">
                    <span class="row-title block">Seja Premium</span>
                    <span class="row-sub block">Programas, Coach, equilíbrio muscular e mais por ${global.Plans.money(global.Plans.PRICE.monthly)}/mês.</span>
                  </span>
                  ${icon('chevronRight', { size: 18, stroke: 2, cls: 'row-chevron' })}
                </button>`}
            </div>

            <div class="section" style="--i:3">
              <p class="t-eyebrow group-label">Rotina</p>
              <div class="group has-icons">
                <button class="row" data-go="profile/reminders">
                  <span class="row-icon">${icon('bell', { size: 20 })}</span>
                  <span class="row-main row-title">Lembretes</span>
                  <span class="row-value">${global.Plans.isPremium() ? esc(global.Reminders.summary()) : global.Plans.pill()}</span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>
                <button class="row" data-go="${global.Programs.state() ? `workouts/programs/${global.Programs.state().id}` : 'workouts/programs'}">
                  <span class="row-icon">${icon('layers', { size: 20 })}</span>
                  <span class="row-main row-title">Programa</span>
                  <span class="row-value">${!global.Plans.isPremium() ? global.Plans.pill() : global.Programs.state() ? esc(global.Programs.get(global.Programs.state().id).name) : '<span class="t-faint">Escolher</span>'}</span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>
              </div>
            </div>

            <div class="section" style="--i:3">
              <p class="t-eyebrow group-label">Preferências</p>
              <div class="group">
                <div class="row"><span class="row-main row-title">Tema</span><span class="row-control" data-slot="theme"></span></div>
                <div class="row"><span class="row-main row-title">Unidade</span><span class="row-control is-narrow" data-slot="unit"></span></div>
                <div class="row">
                  <span class="row-main">
                    <span class="row-title block">Vibração</span>
                    <span class="row-sub block">${vibrationSupported ? 'Ao concluir séries, recordes e treinos.' : 'Este navegador não oferece vibração.'}</span>
                  </span>
                  <span data-slot="haptics"></span>
                </div>
                <div class="row">
                  <span class="row-main row-title">Animações</span>
                  <span data-slot="animations"></span>
                </div>
              </div>
            </div>

            <div class="section" style="--i:4">
              <p class="t-eyebrow group-label">Dados</p>
              <div class="group">
                ${global.PWA && global.PWA.canOffer() ? `
                <button class="row" data-action="install">
                  <span class="row-icon">${icon('download', { size: 20 })}</span>
                  <span class="row-main">
                    <span class="row-title block">Instalar o FORJA</span>
                    <span class="row-sub block">Ícone na tela inicial, tela cheia e abre sem internet.</span>
                  </span>
                  ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
                </button>` : ''}
                <button class="row is-danger" data-action="reset">
                  <span class="row-icon">${icon('trash', { size: 20 })}</span>
                  <span class="row-main row-title">Apagar todos os dados</span>
                </button>
                ${global.Backend.mode === 'sheets' ? `
                <button class="row is-danger" data-action="delete-account">
                  <span class="row-icon">${icon('user', { size: 20 })}</span>
                  <span class="row-main row-title">Excluir minha conta</span>
                </button>` : ''}
              </div>
              <p class="t-footnote group-note">${global.Backend.mode === 'sheets' ? 'Seus dados ficam na sua conta e também neste aparelho, para funcionar sem internet. Apagar os dados mantém a conta; excluir a conta apaga tudo.' : 'Modo local: sua conta e seus dados ficam apenas neste aparelho.'}</p>
            </div>

            <p class="t-footnote text-center mt-10 legal-links" style="--i:5">
              <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>
              <span aria-hidden="true">·</span>
              <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>
            </p>

            <p class="t-footnote text-center mt-8" style="--i:5"><span class="wordmark t-faint">FORJA</span></p>
          </div>
        </section>`;

      // Controles
      const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
      slot('theme').appendChild(UI.segmented(
        [{ value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }, { value: 'system', label: 'Sistema' }],
        s.theme,
        (v) => { Store.update('settings', (x) => { x.theme = v; }); applyTheme(); },
        { label: 'Tema' }
      ));
      slot('unit').appendChild(UI.segmented(
        [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
        s.unit,
        (v) => { Store.update('settings', (x) => { x.unit = v; }); setTimeout(() => Router.refresh(), 220); },
        { label: 'Unidade' }
      ));
      slot('haptics').appendChild(UI.toggle(s.haptics, (v) => {
        Store.update('settings', (x) => { x.haptics = v; });
        if (v) U.haptic('success');
      }, { label: 'Vibração' }));
      slot('animations').appendChild(UI.toggle(s.animations, (v) => {
        Store.update('settings', (x) => { x.animations = v; });
        applyTheme();
      }, { label: 'Animações' }));

      root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => Profile.edit(b.dataset.edit)));
      root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => Router.go(b.dataset.go)));
      root.querySelector('[data-action="reset"]').addEventListener('click', Profile.confirmReset);
      root.querySelector('[data-action="install"]')?.addEventListener('click', () => global.PWA.install());
      root.querySelector('[data-action="password"]')?.addEventListener('click', Profile.changePassword);
      root.querySelector('[data-action="delete-account"]')?.addEventListener('click', Profile.deleteAccount);
      // Sem academia: abre direto o código. Com academia: detalhes e "Sair da academia" na tela de plano.
      root.querySelector('[data-academy-row]')?.addEventListener('click', () => {
        if ((global.Plans.account().academia || {}).vinculada) Router.go('profile/plan');
        else openAcademyCode();
      });
      root.querySelector('[data-action="logout"]').addEventListener('click', () => global.Auth.confirmLogout());
      const syncEl = root.querySelector('[data-sync-state]');
      if (syncEl) { const off = global.Sync.onChange((st) => { if (!syncEl.isConnected) return off(); syncEl.textContent = syncText(st); }); }
    },

    // #/profile · #/profile/plan · #/profile/reminders
    route(el, p) {
      if (p[0] === 'plan') return global.Plans.render(el);
      if (p[0] === 'reminders') return global.Plans.isPremium() ? global.Reminders.render(el) : global.Plans.renderLocked(el, 'reminders', 'Perfil');
      return Profile.render(el);
    },

    save(patch) {
      Store.update('profile', (p) => Object.assign(p || {}, patch, { updatedAt: new Date().toISOString() }));
      Router.refresh();
      UI.toast('Salvo');
    },

    edit(field) {
      const p = Store.get('profile') || {};
      const unit = U.currentUnit();
      if (field === 'name') {
        UI.inputSheet({
          title: 'Seu nome', value: p.name || '', placeholder: 'Nome', maxlength: 30,
          validate: Validate.name, onSave: (name) => Profile.save({ name })
        });
      } else if (field === 'weight') {
        UI.inputSheet({
          title: 'Peso', subtitle: 'Também entra no seu histórico de peso corporal.',
          value: weightInputValue(p.weightKg), placeholder: '0,0', suffix: unit, inputmode: 'decimal', maxlength: 6,
          validate: (v) => Validate.weight(v, unit),
          onSave: (kg) => { logBodyweight(kg); Profile.save({ weightKg: kg }); }
        });
      } else if (field === 'height') {
        UI.inputSheet({
          title: 'Altura', value: p.heightCm || '', placeholder: '175', suffix: 'cm', inputmode: 'numeric', maxlength: 5,
          validate: Validate.height, onSave: (heightCm) => Profile.save({ heightCm })
        });
      } else if (field === 'goal') {
        UI.choiceSheet({ title: 'Objetivo', options: GOALS, value: p.goal, onSelect: (goal) => Profile.save({ goal }) });
      } else if (field === 'experience') {
        UI.choiceSheet({ title: 'Experiência', options: EXPERIENCE, value: p.experience, onSelect: (experience) => Profile.save({ experience }) });
      } else if (field === 'birthDate') {
        Profile.editBirthday(p.birthDate || '');
      } else if (field === 'age') {
        // Com data de nascimento a idade é calculada; editar a data é o caminho
        if (p.birthDate) return Profile.editBirthday(p.birthDate);
        UI.inputSheet({
          title: 'Idade', subtitle: 'Se preferir, informe a data de nascimento em Aniversário: a idade passa a ser calculada.',
          value: Number.isFinite(p.age) ? String(p.age) : '', placeholder: '25', suffix: 'anos', inputmode: 'numeric', maxlength: 3,
          validate: (v) => {
            const n = Number(String(v).trim());
            return Number.isInteger(n) && n >= 10 && n <= 120 ? { ok: true, value: n } : { ok: false, error: 'Informe uma idade entre 10 e 120 anos.' };
          },
          onSave: (age) => Profile.save({ age })
        });
      }
    },

    // Opcional: só serve para a conquista "Treino de aniversário"
    editBirthday(value) {
      const today = U.dayKey(new Date());
      const body = U.h(`
        <form class="form" novalidate>
          <label class="form-label" for="birth">Data de nascimento</label>
          <input id="birth" class="field" type="date" min="1900-01-01" max="${today}" value="${esc(value)}">
          <p class="field-error" data-err></p>
          <p class="t-footnote mx-1">Usada para calcular sua idade e para a conquista “Treino de aniversário”. Fica salva na sua conta.</p>
          ${value ? '<button type="button" class="btn btn-ghost is-muted btn-block mt-4" data-clear>Remover data</button>' : ''}
        </form>`);
      const footer = U.h('<button type="button" class="btn btn-primary btn-block">Salvar</button>');
      const sheet = UI.openSheet({ title: 'Aniversário', body, footer });
      const save = () => {
        const v = body.querySelector('#birth').value;
        const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null;
        const err = body.querySelector('[data-err]');
        if (!d || Number.isNaN(d.getTime())) { err.textContent = 'Escolha uma data válida.'; return; }
        if (d > new Date() || d.getFullYear() < 1900) { err.textContent = 'Essa data não parece certa.'; return; }
        sheet.close('save');
        Profile.save({ birthDate: v });
      };
      footer.addEventListener('click', save);
      body.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      body.querySelector('[data-clear]')?.addEventListener('click', () => { sheet.close(); Profile.save({ birthDate: null }); });
    },

    // Trocar senha: o servidor confere a atual, grava a nova e encerra as sessões dos outros aparelhos
    changePassword() {
      const body = U.h(`
        <form class="form" novalidate>
          <label class="form-label" for="pw-cur">Senha atual</label>
          <div class="field-wrap">
            <input class="field auth-pass" id="pw-cur" name="current" type="password" autocomplete="current-password" enterkeyhint="next">
            <button type="button" class="auth-eye" data-eye aria-label="Mostrar senhas">${icon('eye', { size: 20, stroke: 1.8 })}</button>
          </div>
          <label class="form-label mt-5" for="pw-new">Nova senha</label>
          <input class="field auth-pass" id="pw-new" name="next" type="password" autocomplete="new-password" enterkeyhint="next" placeholder="Mínimo de 6 caracteres">
          <label class="form-label mt-5" for="pw-new2">Confirmar nova senha</label>
          <input class="field auth-pass" id="pw-new2" name="nextConfirm" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="Digite a nova senha de novo">
          <p class="field-error" aria-live="polite"></p>
        </form>`);
      const footer = U.h('<button type="button" class="btn btn-primary btn-block">Salvar nova senha</button>');
      const sheet = UI.openSheet({ title: 'Trocar senha', subtitle: 'Os outros aparelhos saem da conta.', body, footer, focus: '#pw-cur' });
      passwordForm(body, footer, { busy: 'Salvando…', fields: { wrong_password: 'current', weak_password: 'next', password_same: 'next', password_mismatch: 'nextConfirm' } }, async (d) => {
        const r = await global.Backend.changePassword(d.current, d.next, d.nextConfirm);
        sheet.close('done');
        U.haptic('success');
        UI.toast(r.otherSessionsEnded ? 'Senha alterada. Os outros aparelhos saíram da conta.' : 'Senha alterada.', { duration: 4000 });
      });
    },

    // Excluir a conta (LGPD): pede a senha; o servidor apaga a conta e os dados, e o aparelho esquece tudo
    deleteAccount() {
      const acc = global.Plans.account();
      const items = ['sua conta e o seu login', 'treinos, histórico, cargas e recordes', 'peso, altura, idade e metas'];
      if ((acc.academia || {}).vinculada) items.push(`seu vínculo com a ${acc.academia.nome}`);
      if (global.Plans.isPremium()) items.push('seu Premium');
      const body = U.h(`
        <form class="form" novalidate>
          <p class="t-callout">Isso apaga para sempre:</p>
          <ul class="delete-list">
            ${items.map((t, i) => `<li>${esc(t)}${i === items.length - 1 ? '.' : ';'}</li>`).join('')}
          </ul>
          <p class="t-footnote mt-3">Não dá para desfazer. As cópias de segurança são apagadas automaticamente em até 30 dias.</p>
          <label class="form-label mt-6" for="del-pass">Digite sua senha para confirmar</label>
          <div class="field-wrap">
            <input class="field auth-pass" id="del-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go">
            <button type="button" class="auth-eye" data-eye aria-label="Mostrar senha">${icon('eye', { size: 20, stroke: 1.8 })}</button>
          </div>
          <p class="field-error" aria-live="polite"></p>
        </form>`);
      const footer = U.h(`
        <div class="grid gap-2">
          <button type="button" class="btn btn-danger btn-block" data-confirm>Excluir minha conta</button>
          <button type="button" class="btn btn-ghost is-muted btn-block" data-cancel>Cancelar</button>
        </div>`);
      const sheet = UI.openSheet({ title: 'Excluir minha conta', body, footer });
      footer.querySelector('[data-cancel]').addEventListener('click', () => sheet.close('cancel'));
      passwordForm(body, footer.querySelector('[data-confirm]'), { busy: 'Excluindo…', fields: { wrong_password: 'password' } }, async (d) => {
        await global.Backend.deleteAccount(d.password);
        Store.clearAll();
        try { sessionStorage.setItem('forja.notice', 'Sua conta foi excluída.'); } catch (e) { /* aba privada */ }
        history.replaceState(null, '', location.pathname);
        location.reload();
      });
    },

    confirmReset() {
      UI.confirmSheet({
        title: 'Apagar todos os dados?',
        message: global.Sync.enabled()
          ? 'Treinos, histórico, recordes e perfil serão apagados da sua conta e deste aparelho. Essa ação não pode ser desfeita.'
          : 'Treinos, histórico, recordes e perfil serão removidos deste aparelho. Essa ação não pode ser desfeita.',
        confirmLabel: 'Apagar tudo',
        destructive: true,
        onConfirm: () => {
          Promise.resolve(global.Sync.enabled() ? global.Backend.clearRemote() : null).catch(() => {}).finally(() => {
            Store.clearAll();
            history.replaceState(null, '', location.pathname);
            location.reload();
          });
        }
      });
    }
  };

  // Formulário de senha numa folha: Enter passa para o próximo campo, o olho mostra as senhas,
  // e o erro do servidor fica no campo certo (fields: código do erro → nome do campo)
  function passwordForm(form, button, { busy, fields }, run) {
    const error = form.querySelector('.field-error');
    const inputs = [...form.querySelectorAll('input')];
    const eye = form.querySelector('[data-eye]');
    eye.addEventListener('click', () => {
      const show = inputs[0].type === 'password';
      inputs.forEach((x) => { x.type = show ? 'text' : 'password'; });
      eye.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 20, stroke: 1.8 });
    });
    inputs.forEach((input, i) => {
      input.addEventListener('input', () => { error.textContent = ''; inputs.forEach((x) => x.classList.remove('is-invalid')); });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus(); else button.click();
      });
    });
    const label = button.textContent;
    button.addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      button.textContent = busy;
      try {
        await run(data);
      } catch (err) {
        button.disabled = false;
        button.textContent = label;
        error.textContent = err.message;
        const input = fields[err.code] && form.querySelector(`[name="${fields[err.code]}"]`);
        if (input) { input.classList.add('is-invalid'); input.focus({ preventScroll: true }); }
        if (err.code === 'invalid_session') setTimeout(() => location.reload(), 1500);
      }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); button.click(); });
  }

  /* ==========================================================================
     Navegação
     ========================================================================== */
  const TABS = [
    { route: 'home', label: 'Início', icon: 'home', title: 'FORJA', render: (el) => Home.render(el) },
    { route: 'workouts', label: 'Treinos', icon: 'dumbbell', title: 'Treinos', render: (el, p) => Workouts.renderScreen(el, p) },
    { route: 'exercises', label: 'Exercícios', icon: 'list', title: 'Exercícios', render: (el) => global.Exercises.renderScreen(el) },
    { route: 'progress', label: 'Evolução', icon: 'chart', title: 'Evolução', render: (el, p) => global.Progress.renderScreen(el, p) },
    { route: 'profile', label: 'Perfil', icon: 'user', title: 'Perfil', render: (el, p) => Profile.route(el, p) }
  ];

  /* Rotas: #/aba ou #/aba/parâmetro (ex.: #/workouts/w_123).
     Entrar num nível mais fundo desliza da direita; voltar desliza da esquerda. */
  const Router = (() => {
    let current = null;       // { route, params, path }
    let observer = null;
    let pushed = 0;           // telas abertas com go() nesta sessão (para o "voltar" usar o histórico)
    const scrollMemory = {};

    function parse() {
      const segs = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
      const route = TABS.some((t) => t.route === segs[0]) ? segs[0] : 'home';
      const params = route === segs[0] ? segs.slice(1) : [];
      return { route, params, path: [route].concat(params).join('/') };
    }

    function go(path) {
      const target = `#/${path}`;
      if (location.hash === target) return render();
      if (path.split('/').length > 1) pushed++;
      location.hash = target; // hashchange chama render()
    }

    // Volta pelo histórico quando possível; senão, vai direto para a raiz da aba
    function back(fallback) {
      const root = fallback || (current ? current.route : 'home');
      if (pushed > 0) { pushed--; history.back(); }
      else location.replace(`#/${root}`);
    }

    function render({ animate = true, keepScroll = false } = {}) {
      const next = parse();
      const tab = TABS.find((t) => t.route === next.route);
      const samePath = current && current.path === next.path;
      if (current && !samePath) scrollMemory[current.path] = global.scrollY;
      if (!next.params.length) pushed = 0;

      let motion = '';
      if (animate && !samePath) {
        const prevDepth = current ? current.params.length : 0;
        const sameTab = current && current.route === next.route;
        if (sameTab && next.params.length > prevDepth) motion = 'screen-push';
        else if (sameTab && next.params.length < prevDepth) motion = 'screen-pop';
        else motion = 'screen-enter';
      }

      const screen = document.createElement('div');
      screen.className = `screen ${motion}`.trim();
      screen.dataset.route = next.route;
      tab.render(screen, next.params);

      // Telas novas começam no topo; ao voltar, restaura a posição anterior
      let y = 0;
      if (keepScroll || samePath) y = global.scrollY;
      else if (motion !== 'screen-push') y = scrollMemory[next.path] || 0;
      $('#view').replaceChildren(screen);
      // Telas que precisam de medidas reais (gráficos) desenham aqui, já no documento
      if (typeof screen.onMount === 'function') screen.onMount();
      global.scrollTo(0, y);

      current = next;
      document.title = next.route === 'home' ? 'FORJA' : `${tab.label} · FORJA`;
      $('#topbar-title').textContent = tab.title;
      $$tabs().forEach((a) => {
        if (a.dataset.route === next.route) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      observeLargeTitle(screen);
      Sessions.syncActiveBar();
    }

    const refresh = () => render({ animate: false, keepScroll: true });

    // Barra compacta: aparece quando o título grande sai da tela.
    // Telas com navbar própria (detalhe) usam a dela; as demais, a barra global.
    function observeLargeTitle(screen) {
      if (observer) observer.disconnect();
      const topbar = $('#topbar');
      const navbar = screen.querySelector('.navbar');
      const title = screen.querySelector('[data-large-title]');
      topbar.classList.remove('is-visible');
      if (!title || !('IntersectionObserver' in global)) return;
      const bar = navbar || topbar;
      const cls = navbar ? 'is-scrolled' : 'is-visible';
      observer = new IntersectionObserver(([entry]) => {
        bar.classList.toggle(cls, !entry.isIntersecting && entry.boundingClientRect.top < bar.offsetHeight);
      }, { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px`, threshold: 0 });
      observer.observe(title);
    }

    const $$tabs = () => U.$$('#tabbar .tab');

    function buildTabbar() {
      const nav = $('#tabbar');
      nav.innerHTML = TABS.map((t) => `
        <a class="tab" href="#/${t.route}" data-route="${t.route}">
          ${icon(t.icon, { size: 25, stroke: 1.6 })}
          <span>${t.label}</span>
        </a>`).join('');
      // Tocar na aba atual: numa tela interna volta à raiz; na raiz, rola ao topo
      nav.addEventListener('click', (e) => {
        const a = e.target.closest('.tab');
        if (!a || !current || a.dataset.route !== current.route) return;
        e.preventDefault();
        if (current.params.length) { pushed = 0; location.hash = `#/${current.route}`; return; }
        const smooth = Store.get('settings').animations !== false;
        global.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      });
    }

    // Deslizar da borda esquerda volta (telas internas); o botão "voltar" continua disponível
    function enableEdgeSwipe() {
      const view = $('#view');
      let s = null;
      view.addEventListener('touchstart', (e) => {
        if (!current || !current.params.length || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (t.clientX > 24) return;
        s = { x: t.clientX, y: t.clientY, dx: 0, el: view.firstElementChild };
      }, { passive: true });
      view.addEventListener('touchmove', (e) => {
        if (!s) return;
        const t = e.touches[0];
        s.dx = Math.max(0, t.clientX - s.x);
        if (Math.abs(t.clientY - s.y) > 60 && s.dx < 30) { s.el.style.transform = ''; s = null; return; }
        s.el.style.transition = 'none';
        s.el.style.transform = `translate3d(${s.dx}px,0,0)`;
      }, { passive: true });
      view.addEventListener('touchend', () => {
        if (!s) return;
        const { el, dx } = s;
        s = null;
        el.style.transition = 'transform 220ms cubic-bezier(.22,1,.36,1)';
        if (dx > 90) { el.style.transform = 'translate3d(100%,0,0)'; setTimeout(() => back(), 160); }
        else el.style.transform = '';
      });
    }

    function start() {
      buildTabbar();
      global.addEventListener('hashchange', () => render());
      // Qualquer [data-back] dentro das telas volta
      $('#view').addEventListener('click', (e) => { if (e.target.closest('[data-back]')) back(); });
      enableEdgeSwipe();
      render();
    }

    return { go, back, render, refresh, start, current: () => current };
  })();

  /* ==========================================================================
     Primeiro acesso
     ========================================================================== */
  const Onboarding = (() => {
    const STEPS = ['welcome', 'name', 'weight', 'height', 'goal', 'done'];
    const QUESTIONS = 4; // name, weight, height, goal
    let index = 0;
    let draft = {};
    let lastProgress = 0;
    let onFinish = null;

    const root = () => $('#onboarding');

    function start(done) {
      onFinish = done;
      draft = Object.assign({}, Store.get('profile') || {});
      index = U.clamp(Store.get('meta').onboardingStep || 0, 0, STEPS.length - 1);
      root().hidden = false;
      $('#toast-host').classList.add('is-raised');
      trackViewport(true);
      render('fade');
    }

    // Cada passo é salvo: recarregar a página retoma de onde parou
    function persist() {
      Store.set('profile', draft);
      Store.update('meta', (m) => { m.onboardingStep = index; });
    }

    function goTo(i, dir) {
      index = U.clamp(i, 0, STEPS.length - 1);
      persist();
      render(dir);
    }

    const VIEWS = {
      welcome: () => `
        <div class="flex-1 flex flex-col justify-center">
          <p class="t-display">FORJA</p>
          <p class="t-title-2 t-muted mt-5">Sua evolução<br>começa aqui.</p>
        </div>
        <div class="ob-foot"><button class="btn btn-primary btn-block" type="submit">Começar</button></div>`,

      name: () => `
        <div class="ob-content">
          <h1 class="t-large-title">Como podemos<br>chamar você?</h1>
          <div class="mt-10">
            <input class="ob-input" name="value" type="text" autocomplete="given-name" autocapitalize="words"
                   spellcheck="false" enterkeyhint="next" maxlength="30" placeholder="Seu nome" value="${esc(draft.name || '')}">
          </div>
          <p class="field-error" aria-live="polite"></p>
        </div>
        <div class="ob-foot"><button class="btn btn-primary btn-block" type="submit">Continuar</button></div>`,

      weight: () => `
        <div class="ob-content">
          <h1 class="t-large-title">Qual seu peso?</h1>
          <p class="t-callout mt-3">O ponto de partida para acompanhar sua evolução.</p>
          <div class="mt-10 ob-input-wrap">
            <input class="ob-input num" name="value" inputmode="decimal" autocomplete="off" enterkeyhint="next"
                   maxlength="6" placeholder="0,0" value="${esc(weightInputValue(draft.weightKg))}">
            <span class="ob-unit" data-unit>${U.currentUnit()}</span>
          </div>
          <p class="field-error" aria-live="polite"></p>
          <div class="mt-2" style="width:132px" data-slot="unit"></div>
        </div>
        <div class="ob-foot"><button class="btn btn-primary btn-block" type="submit">Continuar</button></div>`,

      height: () => `
        <div class="ob-content">
          <h1 class="t-large-title">Qual sua altura?</h1>
          <p class="t-callout mt-3">Em centímetros.</p>
          <div class="mt-10 ob-input-wrap">
            <input class="ob-input num" name="value" inputmode="numeric" autocomplete="off" enterkeyhint="next"
                   maxlength="3" placeholder="175" value="${esc(draft.heightCm || '')}">
            <span class="ob-unit">cm</span>
          </div>
          <p class="field-error" aria-live="polite"></p>
        </div>
        <div class="ob-foot"><button class="btn btn-primary btn-block" type="submit">Continuar</button></div>`,

      goal: () => `
        <div class="ob-content">
          <h1 class="t-large-title">Qual seu objetivo?</h1>
          <div class="mt-8" role="radiogroup" aria-label="Objetivo">
            ${GOALS.map((g) => `
              <button type="button" class="option" role="radio" aria-checked="${draft.goal === g.value}" data-value="${g.value}">
                <span>${g.label}</span>
                <span class="option-check">${icon('check', { size: 14, stroke: 2.6 })}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="ob-foot"><button class="btn btn-primary btn-block" type="submit" ${draft.goal ? '' : 'disabled'}>Continuar</button></div>`,

      done: () => `
        <div class="flex-1 flex flex-col justify-center">
          <div class="ob-check">${icon('check', { size: 40, stroke: 2.4 })}</div>
          <h1 class="t-title" style="font-size:44px;letter-spacing:-0.04em">Tudo pronto.</h1>
          <p class="t-title-2 t-muted mt-4">Escolha um programa pronto<br>ou monte o seu treino.</p>
        </div>
        <div class="ob-foot">
          ${global.Backend.mode === 'sheets' && !(global.Plans.account().academia || {}).vinculada ? '<button class="btn btn-primary btn-block" type="button" data-finish="academy">Tenho código da academia</button>' : ''}
          <button class="btn ${global.Backend.mode === 'sheets' && !(global.Plans.account().academia || {}).vinculada ? 'btn-secondary' : 'btn-primary'} btn-block" type="button" data-finish="programs">Ver programas prontos</button>
          <button class="btn btn-secondary btn-block" type="button" data-finish="create">Montar do zero</button>
          <button class="btn btn-ghost is-muted btn-block" type="button" data-finish="later">Fazer depois</button>
        </div>`
    };

    function render(dir) {
      const step = STEPS[index];
      const el = root();
      const q = STEPS.indexOf(step); // 1..4 são perguntas
      const isQuestion = q >= 1 && q <= QUESTIONS;
      const progress = isQuestion ? (q / QUESTIONS) * 100 : lastProgress;
      const skippable = step === 'weight' || step === 'height';

      el.dataset.step = step;
      el.innerHTML = `
        <div class="ob-frame">
          <div class="ob-nav" style="${isQuestion ? '' : 'visibility:hidden'}">
            <button class="icon-btn is-plain" type="button" data-back aria-label="Voltar">${icon('chevronLeft', { size: 22, stroke: 2 })}</button>
            <div class="ob-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${QUESTIONS}" aria-valuenow="${isQuestion ? q : 0}">
              <span style="width:${lastProgress}%"></span>
            </div>
            <button class="btn btn-ghost is-muted btn-sm" type="button" data-skip style="${skippable ? '' : 'visibility:hidden'}">Pular</button>
          </div>
          <form class="ob-step step-in-${dir}" novalidate>${VIEWS[step]()}</form>
        </div>`;

      requestAnimationFrame(() => {
        const bar = el.querySelector('.ob-progress span');
        if (bar) bar.style.width = `${progress}%`;
      });
      lastProgress = progress;
      bind(step, el);
    }

    function showError(form, message) {
      const input = form.querySelector('input');
      const error = form.querySelector('.field-error');
      if (error) error.textContent = message;
      if (input) input.focus({ preventScroll: true });
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }

    function bind(step, el) {
      const form = el.querySelector('form');
      const input = form.querySelector('input[name="value"]');

      el.querySelector('[data-back]').addEventListener('click', () => goTo(index - 1, 'prev'));
      el.querySelector('[data-skip]').addEventListener('click', () => {
        if (step === 'weight') delete draft.weightKg;
        if (step === 'height') delete draft.heightCm;
        goTo(index + 1, 'next');
      });

      if (input) {
        const wrap = input.closest('.ob-input-wrap');
        // Campos numéricos crescem com o valor, para a unidade ficar colada ao número
        const autosize = () => {
          if (!wrap) return;
          const len = Math.max(input.value.length || input.placeholder.length, 2);
          input.style.width = `${len + 0.5}ch`;
        };
        input.addEventListener('input', () => {
          const e = form.querySelector('.field-error');
          if (e) e.textContent = '';
          autosize();
        });
        if (wrap) wrap.addEventListener('click', () => input.focus());
        autosize();
        U.submitOnEnter(input, form);
        input.focus({ preventScroll: true });
      }

      if (step === 'weight') {
        form.querySelector('[data-slot="unit"]').appendChild(UI.segmented(
          [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
          U.currentUnit(),
          (unit) => {
            // Converte o que já foi digitado para a nova unidade
            const typed = U.parseDecimal(input.value);
            const prev = unit === 'kg' ? 'lb' : 'kg';
            Store.update('settings', (s) => { s.unit = unit; });
            if (Number.isFinite(typed)) input.value = U.fmtNum(U.round(U.toUnit(U.fromUnit(typed, prev), unit), 1), 1).replace(/\./g, '');
            form.querySelector('[data-unit]').textContent = unit;
            input.dispatchEvent(new Event('input'));
          },
          { label: 'Unidade' }
        ));
      }

      if (step === 'goal') {
        const submit = form.querySelector('[type="submit"]');
        form.addEventListener('click', (e) => {
          const opt = e.target.closest('.option');
          if (!opt) return;
          form.querySelectorAll('.option').forEach((o) => o.setAttribute('aria-checked', String(o === opt)));
          draft.goal = opt.dataset.value;
          submit.disabled = false;
          persist();
        });
      }

      el.querySelectorAll('[data-finish]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.finish)));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (step === 'name') {
          const r = Validate.name(input.value);
          if (!r.ok) return showError(form, r.error);
          draft.name = r.value;
        } else if (step === 'weight') {
          if (!input.value.trim()) return showError(form, 'Digite seu peso ou toque em Pular.');
          const r = Validate.weight(input.value);
          if (!r.ok) return showError(form, r.error);
          draft.weightKg = r.value;
        } else if (step === 'height') {
          if (!input.value.trim()) return showError(form, 'Digite sua altura ou toque em Pular.');
          const r = Validate.height(input.value);
          if (!r.ok) return showError(form, r.error);
          draft.heightCm = r.value;
        } else if (step === 'goal' && !draft.goal) {
          return;
        }
        goTo(index + 1, step === 'welcome' ? 'next' : 'next');
      });
    }

    function finish(choice) {
      const now = new Date().toISOString();
      const profile = Object.assign({ experience: null }, draft, { createdAt: draft.createdAt || now, updatedAt: now });
      Store.set('profile', profile);
      if (profile.weightKg) logBodyweight(profile.weightKg);
      Store.update('meta', (m) => { m.onboarded = true; m.onboardingStep = 0; m.createdAt = m.createdAt || now; });

      onFinish(choice);
      const el = root();
      el.classList.add('fade-out');
      setTimeout(() => {
        el.hidden = true;
        el.classList.remove('fade-out');
        el.innerHTML = '';
        trackViewport(false);
        $('#toast-host').classList.remove('is-raised');
      }, 320);
    }

    // Mantém os botões inferiores acima do teclado virtual (iOS/Android)
    function syncViewport() {
      const vv = global.visualViewport;
      if (!vv) return;
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      root().style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
    }
    function trackViewport(on) {
      const vv = global.visualViewport;
      if (!vv) return;
      if (on) {
        vv.addEventListener('resize', syncViewport);
        vv.addEventListener('scroll', syncViewport);
        syncViewport();
      } else {
        vv.removeEventListener('resize', syncViewport);
        vv.removeEventListener('scroll', syncViewport);
        root().style.transform = '';
      }
    }

    return { start };
  })();

  /* ==========================================================================
     Servidor: situação da conta e treinos do treinador
     O app puxa os treinos ao abrir e sempre que volta ao primeiro plano (no máximo 1× por minuto),
     então o que o treinador salvar no FORJA Trainer aparece aqui sem precisar sair e entrar.
     ========================================================================== */
  const Remote = (() => {
    let last = 0;
    let busy = false;

    async function sync({ force = false, account = true } = {}) {
      if (!global.Sync.enabled() || busy) return;
      if (!force && Date.now() - last < 60000) return;
      busy = true;
      last = Date.now();
      try {
        if (account) {
          const before = global.Backend.user() || {};
          const u = await global.Backend.refresh();
          if (u && (u.plan !== before.plan || JSON.stringify(u.account) !== JSON.stringify(before.account))) {
            global.Plans.applyUser(u);
            if (started) Router.refresh();
          }
        }
        const data = await global.Backend.pull(['workouts']);
        if (data && Array.isArray(data.workouts) && global.Workouts.applyRemote(data.workouts) && started) Router.refresh();
      } catch (e) {
        if (e.code === 'invalid_session') location.reload();
        // O servidor passou a exigir a confirmação do e-mail: guarda o que ele disse e reabre na tela de confirmação
        else if (e.code === 'email_not_verified') global.Backend.refresh().finally(() => location.reload());
      } finally {
        busy = false;
      }
    }

    function start() {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
      global.addEventListener('online', () => sync());
      sync({ force: true, account: false }); // a conta já foi atualizada em Auth.start
    }

    return { sync, start };
  })();

  /* ==========================================================================
     Inicialização
     ========================================================================== */
  let started = false;

  function startApp(choice) {
    if (started) return;
    started = true;
    if (choice === 'create') history.replaceState(null, '', '#/workouts');
    if (choice === 'programs') history.replaceState(null, '', '#/workouts/programs');
    $('#app').hidden = false;
    $('#active-bar').addEventListener('click', () => Sessions.open());
    Router.start();
    Remote.start();
    Sessions.syncClock();
    if (global.Plans.isPremium()) global.Reminders.start();
    if (choice === 'academy') setTimeout(() => openAcademyCode(), 400);
    else if (choice === 'create') setTimeout(() => Workouts.openCreate(), 350);
    // Treino não finalizado (navegador fechado no meio): oferece continuar
    else if (Sessions.active()) setTimeout(() => Sessions.promptRecovery(), 450);
  }

  function init() {
    Store.checkAvailable();

    // Habilita :active em toques no iOS
    document.addEventListener('touchstart', () => {}, { passive: true });

    if (!Store.isAvailable()) {
      UI.toast('Armazenamento indisponível: seus dados não serão salvos.', { iconName: 'info', duration: 6000 });
    }

    // Primeiro a conta; depois tudo lê e grava no espaço dela
    global.Auth.start((user, info = {}) => {
      Store.migrate();
      applyTheme();
      document.documentElement.classList.toggle('is-premium', global.Plans.isPremium());

      Store.subscribe((evt) => {
        if (evt.type === 'error') UI.toast('Não foi possível salvar neste aparelho.', { iconName: 'info', duration: 4000 });
        if (evt.type === 'external' && started) { applyTheme(); Router.refresh(); }
      });

      global.Sync.start();
      if (info.adopted) {
        if (global.Sync.enabled()) global.Sync.pushAll();
        setTimeout(() => UI.toast('Os treinos deste aparelho agora estão na sua conta.', { iconName: 'check', duration: 5000 }), 900);
      }

      if (Store.get('meta').onboarded) startApp();
      else Onboarding.start(startApp);
    });
  }

  global.App = { Router, Home, Profile, Validate, GOALS, EXPERIENCE, applyTheme, logBodyweight, ageOf, bmiOf, syncRemote: Remote.sync };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
