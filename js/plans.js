/* FORJA — planos Free e Premium
   · Plano da conta: Backend.user().plan ('free' | 'premium'), calculado pelo SERVIDOR a partir
     da origem (ACADEMIA, ASSINATURA, CODIGO ou ADMIN) — ver Backend.account() e Code.gs.
   · Plans.gate('chave', fn): roda fn no Premium; no Free, abre o paywall daquela função.
   · Qualquer elemento com data-paywall="chave" abre o paywall ao ser tocado.
   · NÃO existe pagamento ainda: "Assinar" explica isso e oferece os códigos (academia / Premium).
   Telas: escolha depois do cadastro (renderChoice) · #/profile/plan (render) */
(function (global) {
  'use strict';
  const { U, UI } = global;
  const { esc, icon } = U;
  const CFG = global.FORJA_CONFIG || {};
  const PRICE = Object.assign({ monthly: 9.9, yearly: 79.9 }, CFG.price);
  const FREE_WORKOUTS = (CFG.freeLimits || {}).workouts || 3;
  const Router = () => global.App.Router;

  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const yearlyPerMonth = () => PRICE.yearly / 12;
  const yearlySaving = () => Math.round((1 - PRICE.yearly / (PRICE.monthly * 12)) * 100);

  /* ---------- O que cada plano tem ---------- */
  // free: true | false | texto · premium: true | texto
  const COMPARE = [
    { label: 'Registrar treinos, séries e cargas', free: true, premium: true },
    { label: 'Biblioteca de exercícios', free: true, premium: true },
    { label: 'Treinos personalizados', free: `Até ${FREE_WORKOUTS}`, premium: 'Ilimitados' },
    { label: 'Histórico e sequência', free: true, premium: true },
    { label: 'Gráficos de volume e frequência', free: true, premium: true },
    { label: 'Programas prontos com progressão', free: false, premium: true },
    { label: 'Coach: quando subir a carga', free: false, premium: true },
    { label: 'Equilíbrio muscular', free: false, premium: true },
    { label: 'Evolução por exercício e recordes', free: false, premium: true },
    { label: 'Metas e conquistas', free: false, premium: true },
    { label: 'Lembretes de treino e peso', free: false, premium: true },
    { label: 'Card para compartilhar o treino', free: false, premium: true }
  ];

  // Destaques do Premium (cartão do plano e paywall)
  const PERKS = [
    { icon: 'layers', text: '5 programas prontos com progressão de 8 semanas' },
    { icon: 'sparkle', text: 'Coach que diz quando subir a carga' },
    { icon: 'balance', text: 'Mapa de equilíbrio muscular' },
    { icon: 'chart', text: 'Evolução por exercício, recordes e metas' },
    { icon: 'bell', text: 'Lembretes de treino e de peso' },
    { icon: 'dumbbell', text: 'Treinos ilimitados' }
  ];

  // Texto do paywall para cada função bloqueada
  const GATES = {
    programs: { icon: 'layers', title: 'Programas prontos', text: 'Full Body, ABC, Upper/Lower, Push/Pull/Legs e ABCDE, com treinos que se ajustam sozinhos a cada semana.' },
    workouts: { icon: 'dumbbell', title: 'Treinos ilimitados', text: `No Free você pode ter até ${FREE_WORKOUTS} treinos. No Premium, quantos quiser.` },
    coach: { icon: 'sparkle', title: 'Coach de carga', text: 'O Coach analisa seus últimos treinos e diz quando subir a carga, quando manter e quando dar um passo atrás.' },
    balance: { icon: 'balance', title: 'Equilíbrio muscular', text: 'Veja no mapa do corpo quais músculos estão sendo treinados de menos e receba sugestões para equilibrar.' },
    analytics: { icon: 'chart', title: 'Evolução completa', text: 'Carga por exercício, recordes, calendário de consistência, metas e conquistas.' },
    reminders: { icon: 'bell', title: 'Lembretes', text: 'Aviso na hora do treino e no dia de se pesar, com notificações e integração com o calendário do celular.' },
    share: { icon: 'share', title: 'Compartilhar treino', text: 'Gere um card bonito com o resumo do treino para postar nos stories.' }
  };

  const user = () => (global.Backend && global.Backend.user()) || null;
  const plan = () => ((user() || {}).plan === 'premium' ? 'premium' : 'free');
  const isPremium = () => plan() === 'premium';

  /* ==========================================================================
     Bloqueios
     ========================================================================== */
  function gate(key, fn) {
    if (isPremium()) return fn();
    openPaywall(key);
  }

  // Treinos: o Free tem limite
  function canCreateWorkout() {
    return isPremium() || global.Workouts.all().length < FREE_WORKOUTS;
  }

  function openPaywall(key) {
    const g = GATES[key] || GATES.analytics;
    const others = PERKS.filter((p) => p.icon !== g.icon).slice(0, 4);
    const body = U.h(`
      <div class="pw">
        <span class="pw-icon">${icon(g.icon, { size: 28, stroke: 1.7 })}</span>
        <p class="t-eyebrow t-accent mt-5">FORJA Premium</p>
        <h2 class="pw-title">${esc(g.title)}</h2>
        <p class="t-callout mt-2">${esc(g.text)}</p>
        <ul class="pw-perks">
          ${others.map((p) => `<li>${icon('check', { size: 16, stroke: 2.4 })}<span>${esc(p.text)}</span></li>`).join('')}
        </ul>
        <p class="pw-price"><strong>${money(PRICE.monthly)}</strong>/mês · cancele quando quiser</p>
      </div>`);
    const footer = U.h(`
      <div class="grid gap-2">
        <button type="button" class="btn btn-primary btn-block" data-plans>Ver planos</button>
        <button type="button" class="btn btn-ghost is-muted btn-block" data-sheet-close>Agora não</button>
      </div>`);
    const sheet = UI.openSheet({ body, footer, closeButton: true });
    footer.querySelector('[data-sheet-close]').addEventListener('click', () => sheet.close('cancel'));
    footer.querySelector('[data-plans]').addEventListener('click', () => {
      sheet.close('plans');
      if (global.Sessions && global.Sessions.isOpen && global.Sessions.isOpen()) global.Sessions.minimize();
      UI.closeAllSheets();
      setTimeout(() => Router().go('profile/plan'), 120);
    });
  }

  // Cartão no lugar de uma seção bloqueada
  function lockedHTML(key, { title, text } = {}) {
    const g = GATES[key] || GATES.analytics;
    return `
      <section class="section">
        <div class="lock-card">
          <span class="lock-card-top">
            <span class="lock-card-icon">${icon(g.icon, { size: 22, stroke: 1.7 })}</span>
            <span class="premium-pill">${icon('lock', { size: 11, stroke: 2.4 })} Premium</span>
          </span>
          <p class="lock-card-title">${esc(title || g.title)}</p>
          <p class="t-callout mt-1">${esc(text || g.text)}</p>
          <button type="button" class="btn btn-primary btn-sm mt-5" data-paywall="${esc(key)}">Desbloquear</button>
        </div>
      </section>`;
  }

  // Tela inteira bloqueada (rotas como #/progress/balance)
  function renderLocked(root, key, backLabel) {
    const g = GATES[key] || GATES.analytics;
    root.innerHTML = `
      ${UI.navbarHTML(g.title, backLabel)}
      <section class="page has-navbar">
        <div class="locked-page">
          <span class="pw-icon is-large">${icon(g.icon, { size: 34, stroke: 1.6 })}</span>
          <span class="premium-pill mt-6">${icon('lock', { size: 11, stroke: 2.4 })} Premium</span>
          <h1 class="t-large-title mt-4">${esc(g.title)}</h1>
          <p class="t-sub mt-3">${esc(g.text)}</p>
          <button type="button" class="btn btn-primary btn-block mt-8" data-go-plans>Ver planos</button>
          <p class="t-footnote mt-4">A partir de ${money(yearlyPerMonth())}/mês no plano anual.</p>
        </div>
      </section>`;
    root.querySelector('[data-go-plans]').addEventListener('click', () => Router().go('profile/plan'));
  }

  // Selo "Premium" para linhas e cartões
  const pill = () => (isPremium() ? '' : `<span class="premium-pill">${icon('lock', { size: 11, stroke: 2.4 })} Premium</span>`);

  /* ==========================================================================
     Situação da conta (vem do servidor; o app só exibe)
     ========================================================================== */
  const account = () => (global.Backend && global.Backend.account()) || {};
  const serverMode = () => global.Backend && global.Backend.mode === 'sheets';
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '');
  const inAcademy = () => !!(account().academia || {}).vinculada;

  // Texto curto da origem do Premium (Perfil)
  function originLabel() {
    const a = account();
    if (!isPremium()) return 'Free';
    return { ACADEMIA: 'Premium · Academia', ASSINATURA: 'Premium', CODIGO: 'Premium · Código', ADMIN: 'Premium' }[a.origemPremium] || 'Premium';
  }

  // Usuário novo vindo do servidor: aplica Premium, tema e lembretes
  function applyUser(u) {
    const premium = !!u && u.plan === 'premium';
    document.documentElement.classList.toggle('is-premium', premium);
    const appOpen = !document.getElementById('app').hidden;
    if (premium && appOpen && global.Reminders) global.Reminders.start();
    return u;
  }

  /* ==========================================================================
     Tela de planos
     ========================================================================== */
  const state = { billing: 'monthly' };

  function cell(v) {
    if (v === true) return `<span class="cmp-yes" aria-label="Incluído">${icon('check', { size: 16, stroke: 2.6 })}</span>`;
    if (v === false) return '<span class="cmp-no" aria-label="Não incluído">—</span>';
    return `<span class="cmp-text">${esc(v)}</span>`;
  }

  // Cartão do Premium ativo, diferente para cada origem
  function currentCardHTML() {
    const a = account();
    const ac = a.academia || {};
    const sub = a.assinaturaIndividual;
    const code = a.codigoPremium;
    let name = 'Premium', text = '', extra = '';
    if (a.origemPremium === 'ACADEMIA') {
      name = 'Premium Academia';
      text = `Liberado pela <strong>${esc(ac.nome)}</strong>${ac.dataEntrada ? ` desde ${fmtDate(ac.dataEntrada)}` : ''}. Seu treinador pode montar e ajustar seus treinos.`;
      if (sub) extra = `Sua assinatura individual continua registrada${sub.fim ? ` até ${fmtDate(sub.fim)}` : ''}. Se você sair da academia, ela mantém o seu Premium.`;
    } else if (a.origemPremium === 'ASSINATURA') {
      text = `Assinatura ${esc(String(sub && sub.plano || '').toLowerCase() || 'individual')}${sub && sub.renovacao ? ` · renova em ${fmtDate(sub.renovacao)}` : sub && sub.fim ? ` · válida até ${fmtDate(sub.fim)}` : ''}.`;
    } else if (a.origemPremium === 'CODIGO') {
      text = `Liberado pelo código <strong>${esc(code && code.codigo)}</strong>${code && code.ate ? ` até ${fmtDate(code.ate)}` : ', sem prazo'}.`;
    } else {
      text = 'Ativado pela equipe FORJA.';
    }
    return `
      <article class="plan-card is-premium is-current">
        <span class="plan-card-head">
          <span class="plan-name">${esc(name)}</span>
          <span class="badge is-inline">Seu plano</span>
        </span>
        <p class="t-callout mt-3 plan-origin">${text}</p>
        ${extra ? `<p class="t-footnote mt-2">${extra}</p>` : ''}
        <ul class="plan-perks">
          ${PERKS.map((p) => `<li><span class="plan-perk-icon">${icon(p.icon, { size: 16, stroke: 1.9 })}</span><span>${esc(p.text)}</span></li>`).join('')}
        </ul>
        ${a.origemPremium === 'ASSINATURA' ? '<button type="button" class="btn btn-ghost is-muted btn-block mt-4" data-manage>Gerenciar assinatura</button>' : ''}
      </article>`;
  }

  // Códigos: academia e Premium são opções separadas
  function codesHTML() {
    if (!serverMode()) return '';
    const ac = account().academia || {};
    return `
      <section class="section">
        <p class="t-eyebrow group-label">Academia e códigos</p>
        <div class="group has-icons">
          ${ac.vinculada ? `
            <div class="row">
              <span class="row-icon">${icon('dumbbell', { size: 20 })}</span>
              <span class="row-main"><span class="row-title block">${esc(ac.nome)}</span><span class="row-sub block">${ac.premiumAtivo === false ? 'Contrato da academia inativo' : `Aluno desde ${fmtDate(ac.dataEntrada)}`}</span></span>
            </div>
            <button type="button" class="row is-danger" data-leave>
              <span class="row-icon">${icon('logout', { size: 20 })}</span><span class="row-main row-title">Sair da academia</span>
            </button>` : `
            <button type="button" class="row" data-code="academy">
              <span class="row-icon">${icon('dumbbell', { size: 20 })}</span>
              <span class="row-main"><span class="row-title block">Entrar com código da academia</span><span class="row-sub block">Premium pela sua academia e treino do seu treinador</span></span>
              ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
            </button>`}
          <button type="button" class="row" data-code="premium">
            <span class="row-icon">${icon('gift', { size: 20 })}</span>
            <span class="row-main"><span class="row-title block">Resgatar código Premium</span><span class="row-sub block">Promoções e parceiros</span></span>
            ${icon('chevronRight', { size: 16, stroke: 2, cls: 'row-chevron' })}
          </button>
        </div>
      </section>`;
  }

  function pageHTML({ choosing }) {
    const premium = isPremium();
    const yearly = state.billing === 'yearly';
    return `
      <div class="plans">
        ${premium ? currentCardHTML() : `
          <div class="plans-billing" data-slot="billing"></div>
          <article class="plan-card is-premium">
            <span class="plan-card-head">
              <span class="plan-name">Premium</span>
              <span class="badge is-inline">Mais completo</span>
            </span>
            <p class="plan-price num">${money(yearly ? PRICE.yearly : PRICE.monthly)}<small>/${yearly ? 'ano' : 'mês'}</small></p>
            <p class="t-footnote plan-price-note">${yearly ? `Equivale a ${money(yearlyPerMonth())}/mês · economize ${yearlySaving()}%` : `ou ${money(PRICE.yearly)}/ano, economizando ${yearlySaving()}%`}</p>
            <ul class="plan-perks">
              ${PERKS.map((p) => `<li><span class="plan-perk-icon">${icon(p.icon, { size: 16, stroke: 1.9 })}</span><span>${esc(p.text)}</span></li>`).join('')}
            </ul>
            <button type="button" class="btn btn-primary btn-block mt-6" data-subscribe>Assinar Premium</button>
          </article>`}

        ${codesHTML()}

        ${premium ? '' : `
          <article class="plan-card is-current">
            <span class="plan-card-head">
              <span class="plan-name">Free</span>
              <span class="badge is-inline is-muted">Seu plano</span>
            </span>
            <p class="plan-price num">${money(0)}<small>/sempre</small></p>
            <p class="t-footnote plan-price-note">O essencial para registrar seus treinos.</p>
            <ul class="plan-perks is-free">
              <li><span class="plan-perk-icon">${icon('check', { size: 16, stroke: 2.2 })}</span><span>Registrar treinos, séries e cargas</span></li>
              <li><span class="plan-perk-icon">${icon('check', { size: 16, stroke: 2.2 })}</span><span>Até ${FREE_WORKOUTS} treinos personalizados</span></li>
              <li><span class="plan-perk-icon">${icon('check', { size: 16, stroke: 2.2 })}</span><span>Histórico, sequência e gráficos básicos</span></li>
            </ul>
            ${choosing ? '<button type="button" class="btn btn-secondary btn-block mt-6" data-free>Continuar no Free</button>' : ''}
          </article>`}
        ${premium && choosing ? '<button type="button" class="btn btn-primary btn-block mt-6" data-free>Continuar</button>' : ''}

        <section class="section">
          <p class="t-eyebrow group-label">Compare</p>
          <div class="cmp">
            <div class="cmp-row cmp-head"><span></span><span>Free</span><span>Premium</span></div>
            ${COMPARE.map((r) => `<div class="cmp-row"><span class="cmp-label">${esc(r.label)}</span>${cell(r.free)}${cell(r.premium)}</div>`).join('')}
          </div>
        </section>

        <p class="t-footnote text-center mt-8 plans-note">${icon('info', { size: 14, stroke: 2 })} Assinatura pelo app em breve. Nenhuma cobrança é feita nesta versão.</p>
      </div>`;
  }

  function bindPage(root, { choosing, onDone }) {
    const repaint = () => {
      const host = root.querySelector('[data-plans-host]');
      host.innerHTML = pageHTML({ choosing });
      bindPage(root, { choosing, onDone });
      const title = root.querySelector('[data-large-title]');
      if (title && !choosing) title.textContent = isPremium() ? 'Seu plano' : 'Seja Premium';
    };
    const billing = root.querySelector('[data-slot="billing"]');
    if (billing) {
      billing.appendChild(UI.segmented(
        [{ value: 'monthly', label: 'Mensal' }, { value: 'yearly', label: `Anual · −${yearlySaving()}%` }],
        state.billing,
        (v) => { state.billing = v; setTimeout(() => repaint(), 180); },
        { label: 'Cobrança' }
      ));
    }
    const afterChange = (u) => {
      repaint();
      // Treinos do treinador (entrou) ou devolvidos a você (saiu da academia)
      if (global.App && global.App.syncRemote) global.App.syncRemote({ force: true });
      if (choosing && onDone && u && u.plan === 'premium') onDone('premium');
    };
    root.querySelector('[data-subscribe]')?.addEventListener('click', openSubscribeInfo);
    root.querySelector('[data-free]')?.addEventListener('click', () => onDone && onDone(isPremium() ? 'premium' : 'free'));
    root.querySelector('[data-manage]')?.addEventListener('click', () => UI.toast('O gerenciamento da assinatura chega junto com o pagamento pelo app.', { iconName: 'info', duration: 4000 }));
    root.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => openCodeSheet(b.dataset.code, afterChange)));
    root.querySelector('[data-leave]')?.addEventListener('click', () => confirmLeave(afterChange));
  }

  // O pagamento ainda não existe: nada de checkout de mentira
  function openSubscribeInfo() {
    const body = U.h(`
      <div class="pw">
        <span class="pw-icon">${icon('crown', { size: 28, stroke: 1.7 })}</span>
        <h2 class="pw-title mt-5">Assinatura em breve</h2>
        <p class="t-callout mt-2">O pagamento pelo app (Pix e cartão) ainda não está disponível, e nenhuma cobrança é feita. Enquanto isso, você pode liberar o Premium pela sua academia ou com um código promocional.</p>
      </div>`);
    const footer = U.h(`
      <div class="grid gap-2">
        ${serverMode() && !inAcademy() ? '<button type="button" class="btn btn-primary btn-block" data-go-code="academy">Tenho código da academia</button>' : ''}
        ${serverMode() ? '<button type="button" class="btn btn-secondary btn-block" data-go-code="premium">Tenho um código Premium</button>' : ''}
        <button type="button" class="btn btn-ghost is-muted btn-block" data-sheet-close>Entendi</button>
      </div>`);
    const sheet = UI.openSheet({ body, footer, closeButton: true });
    footer.querySelector('[data-sheet-close]').addEventListener('click', () => sheet.close('cancel'));
    footer.querySelectorAll('[data-go-code]').forEach((b) => b.addEventListener('click', () => {
      sheet.close('code');
      setTimeout(() => openCodeSheet(b.dataset.goCode, () => { if (global.App) global.App.Router.refresh(); if (global.App && global.App.syncRemote) global.App.syncRemote({ force: true }); }), 250);
    }));
  }

  const CODE_SHEETS = {
    academy: { title: 'Código da academia', subtitle: 'Peça o código na recepção ou ao seu treinador.', placeholder: 'FORJA-GYM-…', button: 'Entrar na academia', loading: 'Validando…' },
    premium: { title: 'Código Premium', subtitle: 'Códigos de promoções e parceiros do FORJA.', placeholder: 'FORJA-PREM-…', button: 'Resgatar', loading: 'Validando…' }
  };

  // Quem valida é o servidor (código, validade, limite de usos, vagas da academia)
  function openCodeSheet(kind, done) {
    const c = CODE_SHEETS[kind];
    const body = U.h(`
      <form class="form" novalidate>
        <label class="form-label" for="code-input">Código</label>
        <input id="code-input" class="field code-field" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" enterkeyhint="go" placeholder="${c.placeholder}">
        <p class="field-error" aria-live="polite"></p>
      </form>`);
    const footer = U.h(`<button type="button" class="btn btn-primary btn-block">${c.button}</button>`);
    const sheet = UI.openSheet({ title: c.title, subtitle: c.subtitle, body, footer, focus: '#code-input' });
    const input = body.querySelector('input');
    const error = body.querySelector('.field-error');
    input.addEventListener('input', () => { error.textContent = ''; input.classList.remove('is-invalid'); });
    U.submitOnEnter(input, body);
    footer.addEventListener('click', () => body.requestSubmit ? body.requestSubmit() : body.dispatchEvent(new Event('submit', { cancelable: true })));
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) { error.textContent = 'Digite o código.'; input.focus(); return; }
      footer.disabled = true;
      footer.textContent = c.loading;
      try {
        const u = applyUser(kind === 'academy' ? await global.Backend.joinAcademy(code) : await global.Backend.redeemPremiumCode(code));
        sheet.close('done');
        U.haptic('success');
        const a = account();
        celebrate(kind === 'academy' ? `Bem-vindo à ${(a.academia || {}).nome || 'academia'}` : 'Bem-vindo ao Premium',
          kind === 'academy' ? 'Premium liberado. Seu treinador já pode montar seus treinos.' : 'Tudo liberado. Bons treinos.');
        if (done) done(u);
      } catch (err) {
        footer.disabled = false;
        footer.textContent = c.button;
        error.textContent = err.message || 'Não foi possível validar o código.';
        input.classList.add('is-invalid');
        body.classList.remove('shake'); void body.offsetWidth; body.classList.add('shake');
      }
    });
  }

  function confirmLeave(done) {
    const a = account();
    const ac = a.academia || {};
    const keeps = a.assinaturaIndividual ? 'Você continua Premium pela sua assinatura individual.'
      : a.codigoPremium ? 'Você continua Premium pelo seu código até o fim da validade.'
      : 'Você volta para o plano Free.';
    UI.confirmSheet({
      title: `Sair da ${ac.nome || 'academia'}?`,
      message: `${keeps} Seus treinos e seu histórico continuam salvos, inclusive os treinos montados pelo treinador, que passam a ser seus.`,
      confirmLabel: 'Sair da academia',
      destructive: true,
      onConfirm: () => global.Backend.leaveAcademy().then((u) => {
        applyUser(u);
        UI.toast(u.plan === 'premium' ? 'Você saiu da academia e continua Premium' : 'Você saiu da academia. Agora está no plano Free', { iconName: 'check', duration: 4000 });
        if (done) done(u);
      }).catch((e) => UI.toast(e.message, { iconName: 'info', duration: 4000 }))
    });
  }

  function celebrate(title = 'Bem-vindo ao Premium', text = 'Tudo liberado. Bons treinos.') {
    const el = U.h(`
      <div class="pw-celebrate" role="status">
        <span class="pw-icon is-large">${icon('sparkle', { size: 34, stroke: 1.6 })}</span>
        <p class="pw-title mt-5">${esc(title)}</p>
        <p class="t-callout mt-2">${esc(text)}</p>
      </div>`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 320); };
    el.addEventListener('click', close);
    setTimeout(close, 2200);
  }

  // Rota #/profile/plan
  function render(root) {
    root.innerHTML = `
      ${UI.navbarHTML('Planos', 'Perfil')}
      <section class="page has-navbar">
        <header>
          <h1 class="t-large-title" data-large-title>${isPremium() ? 'Seu plano' : 'Seja Premium'}</h1>
          <p class="t-sub mt-2">${isPremium() ? 'Obrigado por treinar com o FORJA.' : 'Treine com um plano, saiba quando subir a carga e veja sua evolução completa.'}</p>
        </header>
        <div class="mt-8" data-plans-host>${pageHTML({ choosing: false })}</div>
      </section>`;
    bindPage(root, { choosing: false });
  }

  // Depois do cadastro, dentro da tela de entrada (sem barra de navegação)
  function renderChoice(container, onDone) {
    container.innerHTML = `
      <div class="auth-scroll">
        <div class="ob-frame is-scroll">
          <div class="step-in-next">
            <p class="wordmark t-accent">FORJA</p>
            <h1 class="t-large-title mt-6">Escolha seu plano</h1>
            <p class="t-sub mt-2">Comece grátis ou entre com o código da sua academia. Dá para mudar quando quiser, no Perfil.</p>
            <div class="mt-8" data-plans-host>${pageHTML({ choosing: true })}</div>
          </div>
        </div>
      </div>`;
    let finished = false;
    bindPage(container, { choosing: true, onDone: (p) => { if (finished) return; finished = true; setTimeout(() => onDone(p), p === 'premium' ? 1600 : 0); } });
  }

  /* ---------- Toque em qualquer [data-paywall] ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-paywall]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    openPaywall(b.dataset.paywall);
  }, true);

  // Compartilhar é Premium (o botão aparece em vários lugares)
  if (global.Share && global.Share.open) {
    const open = global.Share.open;
    global.Share.open = (...args) => gate('share', () => open(...args));
  }

  global.Plans = {
    PRICE, FREE_WORKOUTS, COMPARE, GATES, money,
    plan, isPremium, gate, canCreateWorkout, openPaywall, lockedHTML, renderLocked, pill,
    render, renderChoice, applyUser, account, originLabel, openCodeSheet
  };
})(window);
