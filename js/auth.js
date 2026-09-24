/* FORJA — entrar, criar conta, confirmar e-mail, recuperar senha e sair
   Fluxo: boas-vindas → criar conta → confirme seu e-mail → (link) → escolher plano → primeiro acesso → app
          boas-vindas → entrar → app   (e-mail ainda não confirmado → confirme seu e-mail)
          entrar → esqueci minha senha → (link) → nova senha → entrar
   Links do e-mail: #/confirmar-email/<token> e #/redefinir-senha/<token>. O token sai da barra de
   endereços assim que é lido e só vai para o servidor, que decide tudo (validade, uso único, conta).
   Os dados que já existiam no aparelho antes do login passam para a primeira conta criada/aberta nele. */
(function (global) {
  'use strict';
  const { U, UI, Store, Backend } = global;
  const { $, esc, icon } = U;

  const RESEND_WAIT = 60;                          // segundos (o servidor devolve retryIn; este é o padrão)
  const VERIFIED_SIGNAL = 'forja.emailVerified';   // avisa outra aba aberta que o e-mail foi confirmado
  const LINK_ROUTES = { 'confirmar-email': 'verify', 'redefinir-senha': 'reset' };

  let onReady = null;
  let pending = { from: 'login', emailSent: true }; // tela "Confirme seu e-mail"
  let link = null;                                   // { kind: 'verify' | 'reset', token, email }
  let linkFail = null;                               // erro ao abrir o link (sem internet, conta bloqueada...)
  let draftEmail = '';                               // e-mail digitado, levado entre Entrar, Esqueci e Nova senha
  let resendAt = 0;                                  // "Reenviar confirmação" liberado a partir de
  let resetAgainAt = 0;                              // "Enviar de novo" (esqueci a senha) liberado a partir de
  let cleanup = null;                                // listeners e timers da tela atual
  const root = () => $('#auth');

  function start(done) {
    onReady = done;
    link = takeLink();
    if (link) return openLink();
    const s = Backend.session();
    if (s && s.user && s.user.id) {
      if (s.user.emailVerified === false) return openPending('boot');
      Store.useUser(s.user.id);
      done(s.user, {});
      // Plano, academia e nome podem ter mudado no servidor (assinatura, código, vínculo encerrado...).
      // O Premium guardado no aparelho é só cache: vale o que o servidor responder. Sem internet, segue com o que tem.
      if (Backend.mode === 'sheets') {
        Backend.refresh().then((u) => {
          if (!u) return;
          // O servidor diz que o e-mail não está confirmado: a próxima abertura mostra a confirmação
          if (u.emailVerified === false) return location.reload();
          if (u.plan !== s.user.plan || JSON.stringify(u.account) !== JSON.stringify(s.user.account)) {
            global.Plans.applyUser(u);
            if (global.App) global.App.Router.refresh();
          }
        }).catch(() => {
          UI.toast(Backend.MESSAGES.invalid_session, { iconName: 'info', duration: 5000 });
          setTimeout(() => location.reload(), 1500);
        });
      }
      return;
    }
    show();
    render('welcome', 'fade');
    // Aviso deixado antes de recarregar (ex.: conta excluída)
    let notice = null;
    try { notice = sessionStorage.getItem('forja.notice'); sessionStorage.removeItem('forja.notice'); } catch (e) { /* aba privada */ }
    if (notice) setTimeout(() => UI.toast(notice, { iconName: 'check', duration: 4500 }), 500);
  }

  function show() {
    root().hidden = false;
    // Avisos no topo: embaixo ficam os botões destas telas
    $('#toast-host').classList.add('is-raised', 'is-top');
  }

  // Link do e-mail na URL? O token sai da barra de endereços e do histórico na hora
  const LINK_RE = /^#\/(confirmar-email|redefinir-senha)\/([A-Za-z0-9]{16,128})\/?$/;
  function takeLink() {
    if (Backend.mode !== 'sheets') return null;
    const m = location.hash.match(LINK_RE);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return { kind: LINK_ROUTES[m[1]], token: m[2], email: '' };
  }

  // Link aberto com o app já aberto nesta aba (só o # muda, a página não recarrega): recomeça por ele
  global.addEventListener('hashchange', () => { if (LINK_RE.test(location.hash)) location.reload(); });

  /* ---------- Telas ---------- */
  const localNote = () => (Backend.mode === 'local'
    ? '<p class="t-footnote text-center auth-mode">Modo local: a conta fica só neste aparelho.</p>' : '');
  const backBtn = (to) => `
      <div class="ob-nav">
        <button class="icon-btn is-plain" type="button" data-to="${to}" data-dir="prev" aria-label="Voltar">${icon('chevronLeft', { size: 22, stroke: 2 })}</button>
      </div>`;
  const eyeBtn = () => `<button type="button" class="auth-eye" data-eye aria-label="Mostrar senha">${icon('eye', { size: 20, stroke: 1.8 })}</button>`;
  const badge = (name, tone = '') => `<div class="auth-badge ${tone}">${icon(name, { size: 34, stroke: 1.8 })}</div>`;
  const checkBadge = () => `<div class="ob-check">${icon('check', { size: 40, stroke: 2.4 })}</div>`;
  const emailPill = (email) => `<p class="auth-email mt-5">${icon('mail', { size: 17, stroke: 1.8 })}<span>${esc(email)}</span></p>`;
  const btn = (cls, label, attr) => `<button class="btn ${cls} btn-block" type="button" ${attr}>${label}</button>`;

  // Tela de situação (link conferido, e-mail enviado, senha salva...): selo, título, texto e botões
  const status = ({ badge: top, title, text = '', extra = '', actions = '' }) => `
      <div class="ob-step">
        <div class="auth-status" aria-live="polite">
          ${top}
          <h1 class="t-large-title">${title}</h1>
          ${text ? `<p class="t-callout mt-3">${text}</p>` : ''}
          ${extra}
        </div>
        ${actions ? `<div class="ob-foot">${actions}</div>` : ''}
      </div>`;

  const VIEWS = {
    welcome: () => `
      <div class="ob-step step-in-fade">
        <div class="flex-1 flex flex-col justify-center">
          <p class="t-display">FORJA</p>
          <p class="t-title-2 t-muted mt-5">Treino, carga e evolução.<br>Tudo no seu bolso.</p>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="button" data-to="signup">Criar conta</button>
          <button class="btn btn-secondary btn-block" type="button" data-to="login">Já tenho conta</button>
          ${localNote()}
        </div>
      </div>`,

    signup: () => `
      ${backBtn('welcome')}
      <form class="ob-step" novalidate data-form="signup">
        <div class="ob-content">
          <h1 class="t-large-title">Crie sua conta</h1>
          <p class="t-callout mt-3">Seus treinos, cargas e recordes guardados na sua conta.</p>
          <div class="mt-8">
            <label class="form-label" for="a-name">Nome</label>
            <input class="field" id="a-name" name="name" autocomplete="given-name" autocapitalize="words" maxlength="30" enterkeyhint="next" placeholder="Como quer ser chamado">
            <label class="form-label mt-5" for="a-email">E-mail</label>
            <input class="field" id="a-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="voce@email.com">
            <label class="form-label mt-5" for="a-pass">Senha</label>
            <div class="field-wrap">
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="new-password" enterkeyhint="next" placeholder="Mínimo de 6 caracteres">
              ${eyeBtn()}
            </div>
            <label class="form-label mt-5" for="a-pass2">Confirmar senha</label>
            <input class="field auth-pass" id="a-pass2" name="passwordConfirm" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="Digite a senha de novo">
            <label class="auth-terms mt-5">
              <input type="checkbox" name="acceptTerms">
              <span>Li e aceito os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</span>
            </label>
            <p class="field-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Criar conta</button>
          <p class="t-footnote text-center auth-switch">Já tem conta? <button type="button" class="text-btn" data-to="login">Entrar</button></p>
        </div>
      </form>`,

    login: () => `
      ${backBtn('welcome')}
      <form class="ob-step" novalidate data-form="login">
        <div class="ob-content">
          <h1 class="t-large-title">Bem-vindo<br>de volta</h1>
          <div class="mt-8">
            <label class="form-label" for="a-email">E-mail</label>
            <input class="field" id="a-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="voce@email.com" value="${esc(draftEmail)}">
            <label class="form-label mt-5" for="a-pass">Senha</label>
            <div class="field-wrap">
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="Sua senha">
              ${eyeBtn()}
            </div>
            <p class="field-error" aria-live="polite"></p>
            <button type="button" class="text-btn auth-forgot" data-forgot>Esqueci minha senha</button>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Entrar</button>
          <p class="t-footnote text-center auth-switch">Ainda não tem conta? <button type="button" class="text-btn" data-to="signup">Criar conta</button></p>
        </div>
      </form>`,

    // Conta entrou, mas o e-mail ainda não foi confirmado. Quem decide é o servidor (user.emailVerified).
    verify: () => `
      <div class="ob-step">
        <div class="ob-content">
          ${badge('mail')}
          <h1 class="t-large-title">Confirme seu e-mail</h1>
          <p class="t-callout mt-3">${pending.from === 'signup'
            ? 'Enviamos um link para ativar sua conta. Toque nele para continuar.'
            : 'Você ainda precisa confirmar seu endereço de e-mail para continuar.'}</p>
          ${emailPill((Backend.user() || {}).email || '')}
          ${pending.emailSent ? '' : '<p class="field-error" data-warn>Não conseguimos enviar o e-mail agora. Toque em “Reenviar confirmação”.</p>'}
          <p class="t-footnote mt-5">Abra o e-mail e toque em “Confirmar meu e-mail”. Não chegou? Veja o spam e a aba Promoções.</p>
          <div class="auth-wait mt-6">
            <span class="auth-dot" aria-hidden="true"></span>
            <span class="flex-1">Aguardando confirmação</span>
            <button type="button" class="text-btn" data-check>Já confirmei</button>
          </div>
        </div>
        <div class="ob-foot">
          ${btn('btn-primary', 'Reenviar confirmação', 'data-resend')}
          ${btn('btn-secondary', 'Alterar e-mail', 'data-to="change-email"')}
          ${btn('btn-ghost is-muted', 'Sair', 'data-logout')}
        </div>
      </div>`,

    'change-email': () => `
      ${backBtn('verify')}
      <form class="ob-step" novalidate data-form="change-email">
        <div class="ob-content">
          <h1 class="t-large-title">Alterar e-mail</h1>
          <p class="t-callout mt-3">Digitou o e-mail errado? Informe o certo e enviaremos um novo link de confirmação para ele.</p>
          <div class="mt-8">
            <label class="form-label" for="a-email">Novo e-mail</label>
            <input class="field" id="a-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="voce@email.com">
            <label class="form-label mt-5" for="a-pass">Senha</label>
            <div class="field-wrap">
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="Para confirmar que é você">
              ${eyeBtn()}
            </div>
            <p class="field-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Enviar novo link</button>
        </div>
      </form>`,

    forgot: () => `
      ${backBtn('login')}
      <form class="ob-step" novalidate data-form="forgot">
        <div class="ob-content">
          <h1 class="t-large-title">Esqueceu<br>a senha?</h1>
          <p class="t-callout mt-3">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
          <div class="mt-8">
            <label class="form-label" for="a-email">E-mail</label>
            <input class="field" id="a-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="send" placeholder="voce@email.com" value="${esc(draftEmail)}">
            <p class="field-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Enviar link</button>
        </div>
      </form>`,

    // Resposta genérica: não diz se existe conta com o e-mail
    'forgot-sent': () => status({
      badge: badge('mail'),
      title: 'Verifique seu e-mail',
      text: 'Se existir uma conta associada a este e-mail, enviaremos instruções para redefinir sua senha.',
      extra: `${emailPill(draftEmail)}<p class="t-footnote mt-5">O link vale por 30 minutos. Não chegou? Veja o spam e a aba Promoções.</p>`,
      actions: btn('btn-primary', 'Voltar para entrar', 'data-to="login" data-dir="prev"') + btn('btn-ghost is-muted', 'Enviar de novo', 'data-again')
    }),

    /* Link aberto do e-mail */
    checking: () => status({
      badge: '<div class="auth-badge"><span class="auth-spinner" role="progressbar" aria-label="Carregando"></span></div>',
      title: link && link.kind === 'reset' ? 'Verificando o link…' : 'Confirmando seu e-mail…',
      text: 'Só um instante.'
    }),

    verified: () => status({
      badge: checkBadge(),
      title: 'E-mail confirmado!',
      text: 'Seu e-mail foi confirmado com sucesso.',
      actions: btn('btn-primary', 'Entrar no FORJA', 'data-enter')
    }),

    'link-expired': () => (link.kind === 'reset'
      ? status({
        badge: badge('clock'),
        title: 'Este link expirou.',
        text: 'Por segurança, o link para criar uma nova senha vale por 30 minutos. Peça um novo.',
        actions: btn('btn-primary', 'Pedir novo link', 'data-to="forgot"') + btn('btn-ghost is-muted', 'Voltar', 'data-leave')
      })
      : status({
        badge: badge('clock'),
        title: 'Este link expirou.',
        text: 'Por segurança, o link de confirmação vale por 24 horas. Peça um novo e ele chega no mesmo e-mail.',
        actions: btn('btn-primary', 'Enviar novo link', 'data-relink') + btn('btn-ghost is-muted', 'Voltar', 'data-leave')
      })),

    'link-sent': () => status({
      badge: badge('mail'),
      title: 'Enviamos um novo link',
      text: 'Abra o e-mail e toque em “Confirmar meu e-mail”. O link vale por 24 horas.',
      extra: link.email ? emailPill(link.email) : '',
      actions: btn('btn-secondary', 'Voltar', 'data-leave')
    }),

    'link-invalid': () => status({
      badge: badge('alert', 'is-muted'),
      title: 'Este link não é válido.',
      text: link.kind === 'reset'
        ? 'Ele pode já ter sido usado ou trocado por um link mais novo. Se precisar, peça outro em “Esqueci minha senha”.'
        : 'Ele pode já ter sido usado ou trocado por um link mais novo. Se você já confirmou seu e-mail, é só entrar.',
      actions: btn('btn-primary', 'Voltar', 'data-leave')
    }),

    'link-error': () => status({
      badge: badge('alert', 'is-muted'),
      title: 'Não foi possível abrir o link',
      text: esc(linkFail ? linkFail.message : ''),
      actions: (linkFail && linkFail.code === 'account_blocked' ? '' : btn('btn-primary', 'Tentar de novo', 'data-retry'))
        + btn('btn-ghost is-muted', 'Voltar', 'data-leave')
    }),

    reset: () => `
      ${backBtn('leave')}
      <form class="ob-step" novalidate data-form="reset">
        <div class="ob-content">
          <h1 class="t-large-title">Crie uma<br>nova senha</h1>
          <p class="t-callout mt-3">Para a conta ${esc(link.email)}. Use pelo menos 6 caracteres.</p>
          <div class="mt-8">
            <label class="form-label" for="a-pass">Nova senha</label>
            <div class="field-wrap">
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="new-password" enterkeyhint="next" placeholder="Mínimo de 6 caracteres">
              ${eyeBtn()}
            </div>
            <label class="form-label mt-5" for="a-pass2">Confirmar nova senha</label>
            <input class="field auth-pass" id="a-pass2" name="passwordConfirm" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="Digite a senha de novo">
            <p class="field-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Salvar nova senha</button>
        </div>
      </form>`,

    'reset-done': () => status({
      badge: checkBadge(),
      title: 'Senha atualizada',
      text: 'Sua nova senha já está valendo. Por segurança, você saiu da conta em todos os aparelhos.',
      actions: btn('btn-primary', 'Entrar', 'data-to="login"')
    })
  };

  // Brilho de fundo: cheio nas telas de boas-vindas e de sucesso, discreto nas demais
  const GLOW = { welcome: 'welcome', verified: 'welcome', 'reset-done': 'welcome' };

  function render(view, dir = 'next') {
    leave();
    const el = root();
    el.dataset.step = GLOW[view] || 'form';
    el.innerHTML = `<div class="ob-frame">${VIEWS[view]()}</div>`;
    keepWords(el);
    const step = el.querySelector('.ob-step');
    if (step && !step.className.includes('step-in-')) step.classList.add(`step-in-${dir}`);
    bind(view, el);
  }

  function leave() {
    if (cleanup) { cleanup(); cleanup = null; }
  }

  // "e-mail" não quebra no hífen ("e-" numa linha e "mail" na outra). O endereço digitado fica como está.
  function keepWords(el) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (/\b[Ee]-mail/.test(n.nodeValue) && !n.parentElement.closest('.auth-email')) hits.push(n);
    }
    hits.forEach((n) => {
      const frag = document.createDocumentFragment();
      n.nodeValue.split(/(\b[Ee]-mail)/).forEach((part, i) => {
        if (!part) return;
        if (i % 2) frag.appendChild(Object.assign(document.createElement('span'), { className: 'nowrap', textContent: part }));
        else frag.appendChild(document.createTextNode(part));
      });
      n.replaceWith(frag);
    });
  }

  function bind(view, el) {
    el.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.to === 'leave') return leaveLink();
      render(b.dataset.to, b.dataset.dir || (b.dataset.to === 'welcome' ? 'prev' : 'next'));
    }));
    el.querySelectorAll('[data-leave]').forEach((b) => b.addEventListener('click', leaveLink));
    if (SCREENS[view]) SCREENS[view](el);
    const form = el.querySelector('form');
    if (form) bindForm(view, form);
  }

  /* ---------- Formulários ---------- */
  const SUBMIT = {
    signup: { busy: 'Criando conta…', run: async (d) => afterRegister(await Backend.register(d)) },
    login: { busy: 'Entrando…', run: async (d) => afterAuth(await Backend.login(d)) },
    'change-email': { busy: 'Enviando…', run: changeEmail },
    forgot: { busy: 'Enviando…', run: requestReset },
    reset: { busy: 'Salvando…', run: saveNewPassword }
  };
  // Erro do servidor → campo que fica vermelho
  const FIELD_OF = {
    invalid_email: 'email', email_taken: 'email', email_same: 'email', invalid_name: 'name',
    weak_password: 'password', invalid_login: 'password', wrong_password: 'password', password_mismatch: 'passwordConfirm',
    terms_required: 'acceptTerms'
  };

  function bindForm(view, form) {
    const error = form.querySelector('.field-error');
    const inputs = [...form.querySelectorAll('input:not([type="checkbox"])')];
    const clear = () => { error.textContent = ''; form.querySelectorAll('.is-invalid').forEach((x) => x.classList.remove('is-invalid')); };
    form.querySelectorAll('input[type="checkbox"]').forEach((c) => c.addEventListener('change', clear));
    inputs.forEach((input, i) => {
      input.addEventListener('input', clear);
      // "Próximo" do teclado pula para o campo seguinte; no último, envia
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus();
        else form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    });
    // O olho mostra/esconde todas as senhas do formulário (a senha e a confirmação)
    const eye = form.querySelector('[data-eye]');
    if (eye) eye.addEventListener('click', () => {
      const passes = [...form.querySelectorAll('.auth-pass')];
      const show = passes[0].type === 'password';
      passes.forEach((p) => { p.type = show ? 'text' : 'password'; });
      eye.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 20, stroke: 1.8 });
      eye.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
    });
    form.querySelector('[data-forgot]')?.addEventListener('click', () => {
      if (Backend.mode === 'local') {
        UI.toast('No modo local não há recuperação de senha. Ela chega junto com o servidor.', { iconName: 'info', duration: 4500 });
        return;
      }
      draftEmail = form.querySelector('[name="email"]').value.trim();
      render('forgot', 'next');
    });
    const first = inputs.find((x) => !x.value) || inputs[0];
    setTimeout(() => first && first.isConnected && first.focus({ preventScroll: true }), 350);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      form.querySelectorAll('input[type="checkbox"]').forEach((c) => { data[c.name] = c.checked; });
      const submit = form.querySelector('[type="submit"]');
      const label = submit.textContent;
      submit.disabled = true;
      submit.classList.add('is-loading');
      submit.textContent = SUBMIT[view].busy;
      try {
        await SUBMIT[view].run(data);
      } catch (err) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.textContent = label;
        error.textContent = err.message || 'Algo deu errado. Tente de novo.';
        const input = FIELD_OF[err.code] && form.querySelector(`[name="${FIELD_OF[err.code]}"]`);
        if (input) { (input.closest('.auth-terms') || input).classList.add('is-invalid'); input.focus({ preventScroll: true }); }
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
  }

  /* ---------- Confirme seu e-mail ---------- */
  function openPending(from, { emailSent = true } = {}) {
    pending = { from, emailSent };
    show();
    render('verify', from === 'boot' ? 'fade' : 'next');
    // Pode ter confirmado em outro aparelho enquanto o app estava fechado
    if (from === 'boot') checkVerified({ quiet: true });
  }

  const SCREENS = {
    verify(el) {
      el.querySelector('[data-check]').addEventListener('click', (e) => checkVerified({ button: e.currentTarget }));
      el.querySelector('[data-logout]').addEventListener('click', (e) => {
        busy(e.currentTarget, 'Saindo…');
        Backend.logout().finally(() => render('welcome', 'prev'));
      });
      const stop = resendButton(el.querySelector('[data-resend]'), {
        until: () => resendAt, label: 'Reenviar confirmação', waitLabel: 'Reenviar em',
        run: async () => {
          const r = await Backend.resendVerification();
          if (r.alreadyVerified) return checkVerified();
          resendAt = Date.now() + (r.retryIn || RESEND_WAIT) * 1000;
          const sent = r.emailSent !== false;
          if (sent) el.querySelector('[data-warn]')?.remove();
          UI.toast(sent ? 'Novo link enviado. Confira sua caixa de entrada.' : Backend.MESSAGES.email_unavailable, { iconName: sent ? 'mail' : 'info', duration: 4000 });
        }
      });
      // Voltou para o app (depois de tocar no link) ou outra aba confirmou: confere na hora
      const onVisible = () => { if (document.visibilityState === 'visible') checkVerified({ quiet: true }); };
      const onStorage = (e) => { if (e.key === VERIFIED_SIGNAL) checkVerified({ quiet: true }); };
      document.addEventListener('visibilitychange', onVisible);
      global.addEventListener('storage', onStorage);
      cleanup = () => {
        stop();
        document.removeEventListener('visibilitychange', onVisible);
        global.removeEventListener('storage', onStorage);
      };
    },

    'forgot-sent'(el) {
      cleanup = resendButton(el.querySelector('[data-again]'), {
        until: () => resetAgainAt, label: 'Enviar de novo', waitLabel: 'Enviar de novo em',
        run: async () => {
          await Backend.requestPasswordReset(draftEmail);
          resetAgainAt = Date.now() + RESEND_WAIT * 1000;
          UI.toast('Pronto. Se a conta existir, o novo link chega em instantes.', { iconName: 'mail', duration: 4000 });
        }
      });
    },

    verified(el) { el.querySelector('[data-enter]').addEventListener('click', (e) => enterAfterLink(e.currentTarget)); },
    'link-expired'(el) { el.querySelector('[data-relink]')?.addEventListener('click', (e) => relink(e.currentTarget)); },
    'link-error'(el) { el.querySelector('[data-retry]')?.addEventListener('click', openLink); }
  };

  // O servidor responde se o e-mail já foi confirmado (o app nunca decide sozinho)
  let checking = false;
  async function checkVerified({ quiet = false, button = null } = {}) {
    if (checking) return;
    checking = true;
    if (button) busy(button, 'Verificando…');
    try {
      const u = await Backend.fetchUser();
      if (u.emailVerified !== false) return await enterVerified(u);
      if (!quiet) UI.toast('Ainda não recebemos a confirmação. Toque no link que enviamos para você.', { iconName: 'mail', duration: 4500 });
    } catch (e) {
      if (e.code === 'invalid_session' || e.code === 'account_blocked') return sessionEnded(e);
      if (!quiet) UI.toast(e.message, { iconName: 'info', duration: 4000 });
    } finally {
      checking = false;
      if (button && button.isConnected) idle(button);
    }
  }

  // E-mail confirmado: segue como quem acabou de entrar. Conta sem dados no servidor = conta nova → plano e primeiro acesso.
  async function enterVerified(user) {
    Store.useUser(user.id);
    const data = await Backend.pull();
    leave();
    if (data && Object.keys(data).length) {
      Store.importAll(data);
      return finish(user, {});
    }
    return afterSignup(user);
  }

  // A sessão acabou no servidor (senha trocada em outro aparelho, conta bloqueada...): volta para Entrar
  function sessionEnded(e) {
    draftEmail = (Backend.user() || {}).email || draftEmail;
    Backend.forgetSession();
    render('login', 'prev');
    UI.toast(e.message, { iconName: 'info', duration: 4500 });
  }

  async function changeEmail(d) {
    const r = await Backend.changeEmail(d.email, d.password);
    pending.emailSent = r.emailSent !== false;
    resendAt = Date.now() + (r.retryIn || RESEND_WAIT) * 1000;
    render('verify', 'prev');
    UI.toast(pending.emailSent ? 'E-mail alterado. Enviamos um novo link.' : Backend.MESSAGES.email_unavailable, { iconName: pending.emailSent ? 'mail' : 'info', duration: 4000 });
  }

  /* ---------- Esqueci minha senha ---------- */
  async function requestReset(d) {
    link = null;
    draftEmail = String(d.email || '').trim().toLowerCase();
    await Backend.requestPasswordReset(draftEmail);
    resetAgainAt = Date.now() + RESEND_WAIT * 1000;
    render('forgot-sent', 'next');
  }

  /* ---------- Links do e-mail ---------- */
  const minDelay = () => new Promise((r) => setTimeout(r, 450)); // o "Confirmando…" não pisca

  async function openLink() {
    show();
    render('checking', 'fade');
    try {
      if (link.kind === 'verify') {
        const [r] = await Promise.all([Backend.verifyEmail(link.token), minDelay()]);
        link.email = r.email || '';
        try { localStorage.setItem(VERIFIED_SIGNAL, String(Date.now())); } catch (e) { /* aba privada */ }
        U.haptic('success');
        render('verified', 'fade');
      } else {
        const [r] = await Promise.all([Backend.checkPasswordReset(link.token), minDelay()]);
        link.email = r.email || '';
        render('reset', 'fade');
      }
    } catch (e) { linkError(e); }
  }

  function linkError(e) {
    if (e.code === 'token_expired') return render('link-expired', 'fade');
    if (e.code === 'token_invalid') return render('link-invalid', 'fade');
    linkFail = e;
    render('link-error', 'fade');
  }

  // "Enviar novo link" com o link de confirmação vencido (funciona sem estar logado neste aparelho)
  async function relink(button) {
    busy(button, 'Enviando…');
    try {
      const r = await Backend.resendVerificationByLink(link.token);
      if (r.alreadyVerified) return render('verified', 'fade');
      link.email = r.email || '';
      render('link-sent', 'next');
    } catch (e) {
      if (e.code === 'token_invalid') return render('link-invalid', 'fade');
      idle(button);
      UI.toast(e.message, { iconName: 'info', duration: 4000 });
    }
  }

  // "Entrar no FORJA": com a conta aberta neste aparelho, segue direto; senão, vai para Entrar
  async function enterAfterLink(button) {
    const s = Backend.session();
    link = null;
    if (!s || !s.user) return render('login', 'next');
    if (s.user.emailVerified !== false) return location.reload(); // já usava o app: abre normalmente
    busy(button, 'Entrando…');
    try {
      const u = await Backend.fetchUser();
      if (u.emailVerified !== false) return await enterVerified(u);
      openPending('login'); // o link era de outra conta; esta ainda não confirmou
    } catch (e) {
      if (e.code === 'invalid_session' || e.code === 'account_blocked') return sessionEnded(e);
      idle(button);
      UI.toast(e.message, { iconName: 'info', duration: 4000 });
    }
  }

  // "Voltar" nas telas do link: segue o fluxo normal do app (conta aberta ou boas-vindas)
  function leaveLink() {
    link = null;
    const s = Backend.session();
    if (s && s.user && s.user.id) return location.reload();
    render('welcome', 'prev');
  }

  async function saveNewPassword(d) {
    if (String(d.password || '').length < 6) throw new Backend.BackendError('weak_password');
    if (d.password !== d.passwordConfirm) throw new Backend.BackendError('password_mismatch');
    let r;
    try {
      r = await Backend.confirmPasswordReset(link.token, d.password, d.passwordConfirm);
    } catch (e) {
      if (e.code === 'token_expired' || e.code === 'token_invalid') return linkError(e);
      throw e;
    }
    // O servidor encerrou todas as sessões da conta; neste aparelho também
    const s = Backend.session();
    if (s && s.user && String(s.user.email).toLowerCase() === String(r.email).toLowerCase()) Backend.forgetSession();
    draftEmail = r.email || '';
    link = null;
    U.haptic('success');
    render('reset-done', 'fade');
  }

  /* ---------- Botões ---------- */
  function busy(button, text) {
    if (!('label' in button.dataset)) button.dataset.label = button.textContent;
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = text;
  }
  function idle(button) {
    button.disabled = false;
    button.classList.remove('is-loading');
    if ('label' in button.dataset) { button.textContent = button.dataset.label; delete button.dataset.label; }
  }

  // Reenviar com a espera do servidor (contagem regressiva). Devolve a função que para o relógio.
  function resendButton(button, { until, label, waitLabel, run }) {
    let timer = null;
    const tick = () => {
      const left = Math.ceil((until() - Date.now()) / 1000);
      button.disabled = left > 0;
      button.textContent = left > 0 ? `${waitLabel} ${left} s` : label;
      if (left <= 0 && timer) { clearInterval(timer); timer = null; }
    };
    const arm = () => { clearInterval(timer); timer = null; tick(); if (button.disabled) timer = setInterval(tick, 1000); };
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = 'Enviando…';
      try { await run(); } catch (e) {
        if (e.code === 'invalid_session') return sessionEnded(e);
        UI.toast(e.message, { iconName: 'info', duration: 4000 });
      }
      button.classList.remove('is-loading');
      if (button.isConnected) arm();
    });
    arm();
    return () => clearInterval(timer);
  }

  /* ---------- Depois de entrar ---------- */
  // Conta nova no servidor nasce com o e-mail não confirmado → "Confirme seu e-mail". No modo local, segue direto.
  async function afterRegister(user) {
    if (user.emailVerified === false) {
      resendAt = Date.now() + RESEND_WAIT * 1000; // o primeiro e-mail acabou de sair
      return openPending('signup', { emailSent: user.emailSent !== false });
    }
    return afterSignup(user);
  }

  async function afterAuth(user) {
    draftEmail = '';
    if (user.emailVerified === false) return openPending('login');
    return afterLogin(user);
  }

  async function afterSignup(user) {
    Store.useUser(user.id);
    const adopted = Store.adoptLegacy();
    // Nome do cadastro já vai para o perfil (o primeiro acesso pula essa pergunta)
    if (!adopted || !(Store.get('profile') || {}).name) {
      Store.update('profile', (p) => Object.assign(p || {}, { name: user.name }));
      if (!Store.get('meta').onboarded) Store.update('meta', (m) => { m.onboardingStep = Math.max(m.onboardingStep || 0, 2); });
    }
    U.haptic('success');
    global.Plans.renderChoice(root(), () => finish(user, { fresh: true, adopted }));
  }

  async function afterLogin(user) {
    Store.useUser(user.id);
    let adopted = false;
    if (Backend.mode === 'sheets') {
      const data = await Backend.pull();
      if (data && Object.keys(data).length) Store.importAll(data);
      else adopted = Store.adoptLegacy();
    } else {
      adopted = Store.adoptLegacy();
    }
    finish(user, { adopted });
  }

  function finish(user, info) {
    leave();
    $('#toast-host').classList.remove('is-top');
    const el = root();
    el.classList.add('fade-out');
    onReady(user, info);
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove('fade-out');
      el.innerHTML = '';
      if (!Store.get('meta').onboarded) return; // o primeiro acesso ainda usa o toast elevado
      $('#toast-host').classList.remove('is-raised');
    }, 320);
  }

  /* ---------- Sair ---------- */
  function confirmLogout() {
    UI.confirmSheet({
      title: 'Sair da conta?',
      message: Backend.mode === 'local'
        ? 'Seus dados continuam neste aparelho e voltam quando você entrar de novo.'
        : 'Seus dados estão salvos na sua conta e voltam quando você entrar de novo.',
      confirmLabel: 'Sair',
      destructive: true,
      onConfirm: () => {
        Backend.logout().finally(() => {
          history.replaceState(null, '', location.pathname);
          location.reload();
        });
      }
    });
  }

  global.Auth = { start, confirmLogout };
})(window);
