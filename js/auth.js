/* FORJA — entrar, criar conta e sair
   Fluxo: boas-vindas → criar conta → escolher plano → primeiro acesso (peso, altura, objetivo) → app
          boas-vindas → entrar → app
   Os dados que já existiam no aparelho antes do login passam para a primeira conta criada/aberta nele. */
(function (global) {
  'use strict';
  const { U, UI, Store, Backend } = global;
  const { $, esc, icon } = U;

  let onReady = null;
  const root = () => $('#auth');

  function start(done) {
    onReady = done;
    const s = Backend.session();
    if (s && s.user && s.user.id) {
      Store.useUser(s.user.id);
      done(s.user, {});
      // Plano, academia e nome podem ter mudado no servidor (assinatura, código, vínculo encerrado...).
      // O Premium guardado no aparelho é só cache: vale o que o servidor responder. Sem internet, segue com o que tem.
      if (Backend.mode === 'sheets') {
        Backend.refresh().then((u) => {
          if (!u) return;
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
    const el = root();
    el.hidden = false;
    $('#toast-host').classList.add('is-raised');
    render('welcome', 'fade');
  }

  /* ---------- Telas ---------- */
  const localNote = () => (Backend.mode === 'local'
    ? '<p class="t-footnote text-center auth-mode">Modo local: a conta fica só neste aparelho.</p>' : '');

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
      <div class="ob-nav">
        <button class="icon-btn is-plain" type="button" data-to="welcome" aria-label="Voltar">${icon('chevronLeft', { size: 22, stroke: 2 })}</button>
      </div>
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
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="Mínimo de 6 caracteres">
              <button type="button" class="auth-eye" data-eye aria-label="Mostrar senha">${icon('eye', { size: 20, stroke: 1.8 })}</button>
            </div>
            <p class="field-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Criar conta</button>
          <p class="t-footnote text-center auth-switch">Já tem conta? <button type="button" class="text-btn" data-to="login">Entrar</button></p>
        </div>
      </form>`,

    login: () => `
      <div class="ob-nav">
        <button class="icon-btn is-plain" type="button" data-to="welcome" aria-label="Voltar">${icon('chevronLeft', { size: 22, stroke: 2 })}</button>
      </div>
      <form class="ob-step" novalidate data-form="login">
        <div class="ob-content">
          <h1 class="t-large-title">Bem-vindo<br>de volta</h1>
          <div class="mt-8">
            <label class="form-label" for="a-email">E-mail</label>
            <input class="field" id="a-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="voce@email.com">
            <label class="form-label mt-5" for="a-pass">Senha</label>
            <div class="field-wrap">
              <input class="field auth-pass" id="a-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="Sua senha">
              <button type="button" class="auth-eye" data-eye aria-label="Mostrar senha">${icon('eye', { size: 20, stroke: 1.8 })}</button>
            </div>
            <p class="field-error" aria-live="polite"></p>
            <button type="button" class="text-btn auth-forgot" data-forgot>Esqueci minha senha</button>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn btn-primary btn-block" type="submit">Entrar</button>
          <p class="t-footnote text-center auth-switch">Ainda não tem conta? <button type="button" class="text-btn" data-to="signup">Criar conta</button></p>
        </div>
      </form>`
  };

  function render(view, dir = 'next') {
    const el = root();
    el.dataset.step = view === 'welcome' ? 'welcome' : 'form';
    el.innerHTML = `<div class="ob-frame">${VIEWS[view]()}</div>`;
    const step = el.querySelector('.ob-step');
    if (step && !step.className.includes('step-in-')) step.classList.add(`step-in-${dir}`);
    bind(view, el);
  }

  function bind(view, el) {
    el.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => render(b.dataset.to, b.dataset.to === 'welcome' ? 'prev' : 'next')));
    const form = el.querySelector('form');
    if (!form) return;

    const error = form.querySelector('.field-error');
    const inputs = [...form.querySelectorAll('input')];
    inputs.forEach((input, i) => {
      input.addEventListener('input', () => { error.textContent = ''; inputs.forEach((x) => x.classList.remove('is-invalid')); });
      // "Próximo" do teclado pula para o campo seguinte; no último, envia
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus();
        else form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    });
    const eye = form.querySelector('[data-eye]');
    eye.addEventListener('click', () => {
      const pass = form.querySelector('.auth-pass');
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      eye.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 20, stroke: 1.8 });
      eye.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
    });
    form.querySelector('[data-forgot]')?.addEventListener('click', () => UI.toast(
      Backend.mode === 'local' ? 'No modo local não há recuperação de senha. Ela chega junto com o servidor.' : 'Recuperação por e-mail em breve. Fale com o suporte.',
      { iconName: 'info', duration: 4500 }
    ));
    setTimeout(() => inputs[0] && inputs[0].focus({ preventScroll: true }), 350);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('[type="submit"]');
      const label = btn.textContent;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.textContent = view === 'signup' ? 'Criando conta…' : 'Entrando…';
      try {
        if (view === 'signup') await afterSignup(await Backend.register(data));
        else await afterLogin(await Backend.login(data));
      } catch (err) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = label;
        error.textContent = err.message || 'Algo deu errado. Tente de novo.';
        const bad = { invalid_email: 'email', email_taken: 'email', weak_password: 'password', invalid_name: 'name', invalid_login: 'password' }[err.code];
        const input = bad && form.querySelector(`[name="${bad}"]`);
        if (input) { input.classList.add('is-invalid'); input.focus({ preventScroll: true }); }
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
  }

  /* ---------- Depois de entrar ---------- */
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
