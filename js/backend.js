/* FORJA — backend: contas, plano e sincronização
   Uma interface, dois adaptadores (escolhidos em js/config.js):
   · Local  → contas em forja.accounts, dados no localStorage. Nada sai do aparelho.
   · Sheets → Google Planilhas via Apps Script (backend/apps-script/Code.gs).
              O localStorage continua sendo a fonte do app (rápido e offline);
              cada alteração é enviada para a planilha alguns segundos depois (Sync).
   Sessão do aparelho: forja.session = { token, user: { id, email, name, plan, createdAt, emailVerified, account }, at }
   · user.account vem do servidor (tipoConta, origemPremium, academia, assinaturaIndividual...).
     O que fica no localStorage é só cache: o servidor recalcula tudo a cada abertura (refresh).
   · user.emailVerified === false: conta nova que ainda não tocou no link do e-mail. O servidor recusa
     os dados dela (email_not_verified) até confirmar; o app só mostra a tela "Confirme seu e-mail". */
(function (global) {
  'use strict';
  const CFG = global.FORJA_CONFIG || {};
  const SESSION_KEY = 'forja.session';
  const ACCOUNTS_KEY = 'forja.accounts';

  const readJSON = (k, fallback = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const nowISO = () => new Date().toISOString();
  const randomHex = (bytes = 16) => {
    const a = new Uint8Array(bytes);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* ---------- SHA-256 (crypto.subtle quando existe; senão, implementação própria) ---------- */
  function sha256Fallback(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    m[total - 4] = (bits >>> 24) & 255; m[total - 3] = (bits >>> 16) & 255; m[total - 2] = (bits >>> 8) & 255; m[total - 1] = bits & 255;
    m[total - 8] = Math.floor(bits / 2 ** 32) & 255;
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = (m[i + t * 4] << 24) | (m[i + t * 4 + 1] << 16) | (m[i + t * 4 + 2] << 8) | m[i + t * 4 + 3];
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  async function sha256(str) {
    try {
      if (global.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* contexto sem crypto.subtle (ex.: file://) */ }
    return sha256Fallback(str);
  }

  /* ---------- Erros com mensagem pronta para a tela ---------- */
  const MESSAGES = {
    email_taken: 'Já existe uma conta com este e-mail.',
    invalid_login: 'E-mail ou senha incorretos.',
    invalid_email: 'Digite um e-mail válido.',
    weak_password: 'Use uma senha com pelo menos 6 caracteres.',
    invalid_name: 'Digite seu nome.',
    invalid_session: 'Sua sessão expirou. Entre de novo.',
    network: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
    config: 'O Google Planilhas ainda não foi configurado (sheetsUrl em js/config.js).',
    plan_locked: 'A mudança de plano está bloqueada no servidor.',
    payment_unavailable: 'A assinatura pelo app ainda não está disponível.',
    account_blocked: 'Esta conta está bloqueada. Fale com o suporte.',
    too_many_attempts: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
    server_only: 'Disponível só com a conta conectada ao servidor.',
    code_invalid: 'Código não encontrado. Confira e tente de novo.',
    code_inactive: 'Este código não está mais ativo.',
    code_expired: 'Este código expirou.',
    code_exhausted: 'Este código já atingiu o limite de utilizações.',
    code_used: 'Você já usou este código.',
    academy_code: 'Este é um código de academia. Use a opção “Entrar com código da academia”.',
    premium_code: 'Este é um código Premium. Use a opção “Resgatar código Premium”.',
    academy_code_invalid: 'Código de academia não encontrado. Confira com a sua academia.',
    academy_inactive: 'Esta academia não está ativa no FORJA.',
    academy_contract: 'O contrato desta academia com o FORJA não está válido. Fale com a academia.',
    academy_full: 'Esta academia atingiu o limite de alunos contratados.',
    academy_already: 'Você já faz parte desta academia.',
    academy_other: 'Você já está vinculado a outra academia. Saia dela antes de entrar em uma nova.',
    not_in_academy: 'Você não está vinculado a nenhuma academia.',
    password_mismatch: 'As senhas não são iguais.',
    email_not_verified: 'Confirme seu e-mail para continuar.',
    email_already_verified: 'Este e-mail já foi confirmado.',
    email_same: 'Este já é o e-mail da sua conta.',
    wrong_password: 'Senha incorreta.',
    token_invalid: 'Este link não é válido.',
    token_expired: 'Este link expirou.',
    resend_too_soon: 'Você poderá solicitar um novo e-mail em alguns instantes.',
    email_unavailable: 'Não foi possível enviar e-mails agora. Tente de novo mais tarde.',
    password_same: 'A nova senha precisa ser diferente da atual.',
    terms_required: 'Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.',
    server: 'O servidor não respondeu como esperado. Tente de novo.'
  };
  class BackendError extends Error {
    constructor(code, message) { super(message || MESSAGES[code] || MESSAGES.server); this.code = code; }
  }

  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  // Conta local (sem servidor): Premium, academia e códigos não existem neste modo
  const LOCAL_ACCOUNT = Object.freeze({ tipoConta: 'FREE', origemPremium: 'NENHUMA', statusPremium: 'INATIVO', premium: { ativo: false, origem: 'NENHUMA' }, academia: { vinculada: false, id: null }, assinaturaIndividual: null, codigoPremium: null });
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, plan: u.plan || 'free', createdAt: u.createdAt, account: LOCAL_ACCOUNT });

  function validate({ name, email, password, passwordConfirm, acceptTerms }, { signup = false } = {}) {
    if (signup && !String(name || '').trim()) throw new BackendError('invalid_name');
    if (!validEmail(normEmail(email))) throw new BackendError('invalid_email');
    if (String(password || '').length < 6) throw new BackendError(signup ? 'weak_password' : 'invalid_login');
    if (signup && passwordConfirm !== undefined && passwordConfirm !== password) throw new BackendError('password_mismatch');
    if (signup && acceptTerms === false) throw new BackendError('terms_required');
  }

  /* ==========================================================================
     Adaptador local (localStorage)
     ========================================================================== */
  const Local = {
    name: 'local',
    accounts: () => readJSON(ACCOUNTS_KEY, []),
    save(list) { if (!writeJSON(ACCOUNTS_KEY, list)) throw new BackendError('server', 'Não foi possível salvar neste aparelho.'); },

    async register({ name, email, password, passwordConfirm, acceptTerms }) {
      validate({ name, email, password, passwordConfirm, acceptTerms }, { signup: true });
      const list = Local.accounts();
      email = normEmail(email);
      if (list.some((a) => a.email === email)) throw new BackendError('email_taken');
      const salt = randomHex(16);
      const user = { id: `u_${randomHex(8)}`, email, name: String(name).trim().replace(/\s+/g, ' ').slice(0, 30), plan: 'free', createdAt: nowISO(), salt, hash: await sha256(`${salt}:${password}`) };
      list.push(user);
      Local.save(list);
      return { token: `local.${randomHex(16)}`, user: publicUser(user) };
    },

    async login({ email, password }) {
      validate({ email, password });
      const a = Local.accounts().find((x) => x.email === normEmail(email));
      if (!a || (await sha256(`${a.salt}:${password}`)) !== a.hash) throw new BackendError('invalid_login');
      return { token: `local.${randomHex(16)}`, user: publicUser(a) };
    },

    async me(token, userId) {
      const a = Local.accounts().find((x) => x.id === userId);
      if (!a) throw new BackendError('invalid_session');
      return publicUser(a);
    },

    async logout() {},

    // Sem servidor não há pagamento, código nem academia
    async setPlan() { throw new BackendError('payment_unavailable'); },
    async redeemPremiumCode() { throw new BackendError('server_only'); },
    async joinAcademy() { throw new BackendError('server_only'); },
    async leaveAcademy() { throw new BackendError('server_only'); },
    // Confirmação de e-mail e recuperação de senha precisam do servidor (e-mail)
    async verifyEmail() { throw new BackendError('server_only'); },
    async resendVerification() { throw new BackendError('server_only'); },
    async changeEmail() { throw new BackendError('server_only'); },
    async requestPasswordReset() { throw new BackendError('server_only'); },
    async checkPasswordReset() { throw new BackendError('server_only'); },
    async confirmPasswordReset() { throw new BackendError('server_only'); },
    async changePassword() { throw new BackendError('server_only'); },
    async deleteAccount() { throw new BackendError('server_only'); },

    // Os dados já vivem no aparelho: não há o que baixar nem enviar
    async pull() { return null; },
    async push() { return true; },
    async clear() { return true; }
  };

  /* ==========================================================================
     Adaptador Google Planilhas (Apps Script publicado como App da Web)
     Content-Type text/plain evita o "preflight" de CORS, que o Apps Script não responde.
     ========================================================================== */
  async function call(action, payload = {}) {
    if (!CFG.sheetsUrl) throw new BackendError('config');
    let res;
    try {
      res = await fetch(CFG.sheetsUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, payload))
      });
    } catch (e) { throw new BackendError('network'); }
    let out = null;
    try { out = await res.json(); } catch (e) { /* resposta que não é JSON */ }
    if (!out) throw new BackendError('server');
    if (!out.ok) throw new BackendError(out.error, MESSAGES[out.error] || out.message);
    return out;
  }

  const Sheets = {
    name: 'sheets',
    async register(d) { validate(d, { signup: true }); return call('register', { name: d.name, email: normEmail(d.email), password: d.password, passwordConfirm: d.passwordConfirm, acceptTerms: d.acceptTerms === true }); },
    async login(d) { validate(d); return call('login', { email: normEmail(d.email), password: d.password }); },
    async me(token) { return (await call('me', { token })).user; },
    async logout(token) { await call('logout', { token }); },
    async setPlan(token, userId, plan) { return (await call('setPlan', { token, plan })).user; },
    async redeemPremiumCode(token, code) { return (await call('redeemPremiumCode', { token, code })).user; },
    async joinAcademy(token, code) { return (await call('joinAcademy', { token, code })).user; },
    async leaveAcademy(token) { return (await call('leaveAcademy', { token })).user; },
    // O app só repassa o token do link (linkToken). Quem confere validade, uso e conta é o servidor.
    async verifyEmail(linkToken) { return call('verifyEmail', { linkToken }); },
    async resendVerification(token, linkToken) { return call('resendVerificationEmail', token ? { token } : { linkToken }); },
    async changeEmail(token, email, password) { return call('changeEmail', { token, email: normEmail(email), password }); },
    async requestPasswordReset(email) { return call('requestPasswordReset', { email: normEmail(email) }); },
    async checkPasswordReset(linkToken) { return call('checkPasswordReset', { linkToken }); },
    async confirmPasswordReset(linkToken, password, passwordConfirm) { return call('confirmPasswordReset', { linkToken, password, passwordConfirm }); },
    async changePassword(token, current, next, nextConfirm) { return call('changePassword', { token, current, next, nextConfirm }); },
    async deleteAccount(token, password) { return call('deleteAccount', { token, password }); },
    async pull(token, keys) { return (await call('pull', keys ? { token, keys } : { token })).data || {}; },
    // Devolve { workouts } quando o servidor preservou treinos do treinador
    async push(token, data) { return call('push', { token, data }); },
    async clear(token) { await call('clear', { token }); return true; }
  };

  const adapter = CFG.backend === 'sheets' ? Sheets : Local;

  /* ==========================================================================
     API usada pelo app
     ========================================================================== */
  const session = () => readJSON(SESSION_KEY);
  const token = () => (session() || {}).token;
  function saveSession(tok, user) { writeJSON(SESSION_KEY, { token: tok, user, at: nowISO() }); return user; }
  function setSessionUser(user) { const s = session(); if (s) writeJSON(SESSION_KEY, Object.assign(s, { user })); return user; }
  function requireToken() { const t = token(); if (!t) throw new BackendError('invalid_session'); return t; }
  function forgetSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  const Backend = {
    mode: adapter.name,
    MESSAGES,
    BackendError,
    session,
    user: () => (session() || {}).user || null,

    // Conta nova no servidor: user.emailVerified = false até tocar no link (emailSent diz se o e-mail saiu)
    async register(data) {
      const r = await adapter.register(data);
      const user = saveSession(r.token, r.user);
      return r.emailSent === false ? Object.assign({ emailSent: false }, user) : user;
    },
    async login(data) { const r = await adapter.login(data); return saveSession(r.token, r.user); },

    async logout() {
      await Sync.flush().catch(() => {});
      try { await adapter.logout(token()); } catch (e) { /* sai mesmo sem servidor */ }
      forgetSession();
    },

    // Atualiza nome e plano a partir do servidor (ex.: depois de um pagamento)
    async refresh() {
      const s = session();
      if (!s) return null;
      try { return await Backend.fetchUser(); } catch (e) {
        if (e.code === 'invalid_session') throw e;
        return s.user; // sem internet: continua com o que já sabe
      }
    },

    // Igual ao refresh, mas sem internet dá erro (a tela "Confirme seu e-mail" precisa saber)
    async fetchUser() {
      const s = session();
      if (!s) throw new BackendError('invalid_session');
      try { return setSessionUser(await adapter.me(s.token, s.user.id)); } catch (e) {
        if (e.code === 'invalid_session') forgetSession();
        throw e;
      }
    },

    // Esquece a sessão só neste aparelho (ex.: o servidor já encerrou todas depois da nova senha)
    forgetSession,

    async setPlan(plan) {
      const s = session();
      if (!s) throw new BackendError('invalid_session');
      return setSessionUser(await adapter.setPlan(s.token, s.user.id, plan));
    },

    // Situação da conta como o servidor informou por último (cache; quem decide é o servidor)
    account() { return ((session() || {}).user || {}).account || LOCAL_ACCOUNT; },

    // Código Premium (promoção, parceiro, teste) e código da academia são coisas diferentes
    async redeemPremiumCode(code) { return setSessionUser(await adapter.redeemPremiumCode(requireToken(), String(code || '').trim())); },
    async joinAcademy(code) { return setSessionUser(await adapter.joinAcademy(requireToken(), String(code || '').trim())); },
    async leaveAcademy() { return setSessionUser(await adapter.leaveAcademy(requireToken())); },

    // Confirmação de e-mail (tela "Confirme seu e-mail" e link do e-mail)
    verifyEmail: (linkToken) => adapter.verifyEmail(linkToken),
    resendVerification: () => adapter.resendVerification(requireToken()),
    resendVerificationByLink: (linkToken) => adapter.resendVerification(null, linkToken),
    async changeEmail(email, password) {
      const r = await adapter.changeEmail(requireToken(), email, password);
      setSessionUser(r.user);
      return r;
    },

    // Esqueci minha senha → link no e-mail → nova senha
    requestPasswordReset: (email) => adapter.requestPasswordReset(email),
    checkPasswordReset: (linkToken) => adapter.checkPasswordReset(linkToken),
    confirmPasswordReset: (linkToken, password, passwordConfirm) => adapter.confirmPasswordReset(linkToken, password, passwordConfirm),

    // Perfil: trocar senha (os outros aparelhos saem) e excluir a conta (apaga tudo no servidor)
    async changePassword(current, next, nextConfirm) {
      if (String(next || '').length < 6) throw new BackendError('weak_password');
      if (next !== nextConfirm) throw new BackendError('password_mismatch');
      return adapter.changePassword(requireToken(), current, next, nextConfirm);
    },
    async deleteAccount(password) {
      await adapter.deleteAccount(requireToken(), password);
      forgetSession();
    },

    pull: (keys) => adapter.pull(token(), keys),
    push: (data) => adapter.push(token(), data),
    clearRemote: () => adapter.clear(token())
  };

  /* ==========================================================================
     Sincronização (só no modo planilha)
     Cada chave alterada (treinos, histórico, peso...) é enviada inteira, agrupada em lotes.
     Sem internet, fica pendente e tenta de novo quando a conexão volta.
     ========================================================================== */
  const Sync = (() => {
    const pending = new Set();
    let timer = null;
    let inFlight = null;
    let state = 'idle'; // idle · pending · syncing · offline
    const listeners = new Set();
    const setState = (s) => { state = s; listeners.forEach((fn) => { try { fn(s); } catch (e) {} }); };
    const enabled = () => adapter.name === 'sheets' && !!session();

    function queue(key) {
      if (!enabled()) return;
      pending.add(key);
      setState('pending');
      clearTimeout(timer);
      timer = setTimeout(flush, CFG.syncDelayMs || 2500);
    }

    async function flush() {
      clearTimeout(timer);
      if (!enabled() || !pending.size) return;
      if (inFlight) return inFlight;
      const keys = [...pending];
      pending.clear();
      const data = {};
      keys.forEach((k) => { data[k] = global.Store.get(k); });
      setState('syncing');
      inFlight = Backend.push(data)
        .then((res) => {
          // O servidor manteve os treinos do treinador: aplica a versão dele
          if (res && res.workouts && global.Workouts && global.Workouts.applyRemote(res.workouts) && global.App) global.App.Router.refresh();
          setState(pending.size ? 'pending' : 'idle');
        })
        .catch((e) => {
          keys.forEach((k) => pending.add(k));
          setState('offline');
          if (e.code === 'invalid_session' || e.code === 'email_not_verified') return;
          timer = setTimeout(flush, 30000);
        })
        .finally(() => { inFlight = null; });
      return inFlight;
    }

    function pushAll() { global.Store.KEYS.forEach((k) => pending.add(k)); return flush(); }

    let started = false;
    function start() {
      if (started || !enabled()) return;
      started = true;
      global.Store.subscribe((evt) => { if (evt.type === 'change' && evt.key) queue(evt.key); });
      global.addEventListener('online', flush);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }

    return { start, flush, pushAll, queue, state: () => state, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, enabled };
  })();

  global.Backend = Backend;
  global.Sync = Sync;
})(window);
