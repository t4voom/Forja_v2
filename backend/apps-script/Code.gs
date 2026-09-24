/**
 * FORJA — backend no Google Planilhas (Apps Script)
 *
 * Como usar: veja backend/LEIA-ME.md. Resumo:
 *   1. Crie uma planilha, abra Extensões › Apps Script e cole este arquivo.
 *   2. Rode a função setup() uma vez (cria as abas e adiciona as colunas que faltarem).
 *   3. Implantar › Nova implantação › App da Web (executar como: você; acesso: qualquer pessoa).
 *   4. Cole a URL /exec em js/config.js (sheetsUrl) e mude backend para 'sheets'.
 *   5. Propriedade do script APP_BASE_URL = endereço público do app (https://...): os links dos e-mails apontam para ela.
 *   6. Menu FORJA Admin › Ativar backup diário: uma cópia da planilha por dia no seu Google Drive.
 *
 * Abas (as três primeiras já existiam; as colunas novas entram sempre no FIM, nada é apagado):
 *   usuarios:            id | email | nome | hash | salt | plano | criadoEm | planoAtualizadoEm
 *                        | tipoConta | origemPremium | statusPremium | premiumManual
 *                        | academiaId | academiaNome | statusVinculoAcademia | dataEntradaAcademia | dataSaidaAcademia
 *                        | dataNascimento | idade | pesoAtual | altura | ultimoAcesso | statusUsuario
 *                        | emailVerificado | dataVerificacaoEmail | tokenVerificacaoEmailHash | tokenVerificacaoEmailExpira
 *                        | tokenResetSenhaHash | tokenResetSenhaExpira | termosAceitosEm | termosVersao
 *   sessoes:             token | userId | criadoEm | expiraEm | tipo (aluno · treinador)
 *   dados:               userId | chave | parte | json | atualizadoEm
 *                        (cada chave do app — treinos, sessões, peso... — é um JSON; textos grandes
 *                         são divididos em partes, porque uma célula aceita no máximo 50 mil caracteres)
 *   academias:           id | nome | codigo | status | plano | limiteAlunos | criadoEm | inicioContrato | fimContrato | statusContrato | atualizadoEm
 *   treinadores:         id | nome | email | hash | salt | status | trocarSenha | criadoEm | ultimoAcesso
 *   treinador_academias: treinadorId | academiaId | papel | status | criadoEm
 *   vinculos_academia:   id | userId | academiaId | status | dataEntrada | dataSaida | motivoSaida | codigoUsado
 *   codigos_premium:     codigo | status | diasPremium | validoAte | limiteUsos | usos | descricao | criadoEm
 *   resgates_codigo:     id | codigo | userId | data | premiumAte
 *   assinaturas:         id | userId | plano | status | inicio | renovacao | fim | origem | idExterno | criadoEm | atualizadoEm
 *   historico_peso:      id | userId | data | pesoKg | origem | status | registradoEm
 *   historico_treinos:   id | userId | treinadorId | treinadorNome | academiaId | data | treinoId | treinoNome | tipo | detalhes
 *
 * PREMIUM NUNCA É UM SIMPLES "premium = true".
 *   O Premium é calculado a partir das fontes, nesta ordem de prioridade:
 *     ACADEMIA   → vínculo ATIVO com academia ATIVA e contrato válido
 *     ASSINATURA → linha ATIVA em "assinaturas" (só o backend/webhook do pagamento grava)
 *     CODIGO     → resgate de código Premium dentro da validade
 *     ADMIN      → coluna premiumManual = SIM (ativação administrativa)
 *   As colunas tipoConta, origemPremium, statusPremium e plano são um ESPELHO recalculado
 *   a cada acesso. Para mudar o Premium de alguém, mude a fonte, não o espelho.
 *
 * E-MAIL CONFIRMADO E RECUPERAÇÃO DE SENHA (só contas de aluno; o FORJA Trainer não muda)
 *   usuarios.emailVerificado: SIM (confirmou pelo link) · NAO (conta nova, ainda não confirmou)
 *                             · LEGADO (conta criada antes da confirmação existir: continua entrando normalmente)
 *   Os links levam um token aleatório de uso único; na planilha fica só o HMAC dele e a validade.
 *   Conta NAO entra, mas só usa me / logout / resendVerificationEmail / changeEmail / deleteAccount até confirmar.
 *   Propriedade obrigatória para enviar e-mails: APP_BASE_URL (endereço público do app).
 *
 * LGPD: o cadastro registra o aceite dos Termos e da Política (termosAceitosEm, termosVersao = TERMS_VERSION).
 *   "Excluir minha conta" (deleteAccount) apaga a conta e os dados; "Apagar todos os dados" (clear) mantém a conta.
 *
 * Todas as chamadas são POST com corpo JSON: { action, ...campos }.
 * Respostas: { ok: true, ... } ou { ok: false, error: 'codigo', message?: 'texto' }.
 */

var SCHEMA_VERSION = '4';

var SHEETS = {
  users: { name: 'usuarios', header: ['id', 'email', 'nome', 'hash', 'salt', 'plano', 'criadoEm', 'planoAtualizadoEm',
    'tipoConta', 'origemPremium', 'statusPremium', 'premiumManual',
    'academiaId', 'academiaNome', 'statusVinculoAcademia', 'dataEntradaAcademia', 'dataSaidaAcademia',
    'dataNascimento', 'idade', 'pesoAtual', 'altura', 'ultimoAcesso', 'statusUsuario',
    'emailVerificado', 'dataVerificacaoEmail', 'tokenVerificacaoEmailHash', 'tokenVerificacaoEmailExpira',
    'tokenResetSenhaHash', 'tokenResetSenhaExpira', 'termosAceitosEm', 'termosVersao'], text: ['dataNascimento', 'termosVersao'] },
  sessions: { name: 'sessoes', header: ['token', 'userId', 'criadoEm', 'expiraEm', 'tipo'] },
  data: { name: 'dados', header: ['userId', 'chave', 'parte', 'json', 'atualizadoEm'], text: ['json'] },
  academies: { name: 'academias', header: ['id', 'nome', 'codigo', 'status', 'plano', 'limiteAlunos', 'criadoEm', 'inicioContrato', 'fimContrato', 'statusContrato', 'atualizadoEm'], text: ['codigo', 'inicioContrato', 'fimContrato'] },
  trainers: { name: 'treinadores', header: ['id', 'nome', 'email', 'hash', 'salt', 'status', 'trocarSenha', 'criadoEm', 'ultimoAcesso'] },
  trainerAcademies: { name: 'treinador_academias', header: ['treinadorId', 'academiaId', 'papel', 'status', 'criadoEm'] },
  links: { name: 'vinculos_academia', header: ['id', 'userId', 'academiaId', 'status', 'dataEntrada', 'dataSaida', 'motivoSaida', 'codigoUsado'] },
  premiumCodes: { name: 'codigos_premium', header: ['codigo', 'status', 'diasPremium', 'validoAte', 'limiteUsos', 'usos', 'descricao', 'criadoEm'], text: ['codigo', 'validoAte'] },
  redemptions: { name: 'resgates_codigo', header: ['id', 'codigo', 'userId', 'data', 'premiumAte'] },
  subscriptions: { name: 'assinaturas', header: ['id', 'userId', 'plano', 'status', 'inicio', 'renovacao', 'fim', 'origem', 'idExterno', 'criadoEm', 'atualizadoEm'], text: ['inicio', 'renovacao', 'fim', 'idExterno'] },
  weights: { name: 'historico_peso', header: ['id', 'userId', 'data', 'pesoKg', 'origem', 'status', 'registradoEm'] },
  workoutLog: { name: 'historico_treinos', header: ['id', 'userId', 'treinadorId', 'treinadorNome', 'academiaId', 'data', 'treinoId', 'treinoNome', 'tipo', 'detalhes'] }
};

var SESSION_DAYS = 60;
var TRAINER_SESSION_HOURS = 12;
var ACTIVE_DAYS = 30;          // aluno "ativo" = usou o app nos últimos N dias
var CHUNK = 45000;
var PW_ITERATIONS = 300;       // rodadas de HMAC-SHA256 no hash de senha (formato v1)
var LOGIN_MAX_FAILS = 5;       // tentativas erradas antes do bloqueio temporário
var LOGIN_LOCK_SECONDS = 900;
var STUDENT_PASSWORD_MIN = 6;  // senha do aluno (a do treinador tem 8, em trainerChangePassword)
var VERIFY_TOKEN_HOURS = 24;   // validade do link "Confirmar meu e-mail"
var RESET_TOKEN_MINUTES = 30;  // validade do link de nova senha
var MAIL_COOLDOWN_SECONDS = 60; // intervalo mínimo entre dois e-mails iguais para a mesma conta/endereço
var MAIL_MAX_PER_HOUR = 5;     // e-mails de conta por conta/endereço por hora
// Versão dos Termos de Uso e da Política de Privacidade aceitos no cadastro (a data da versão publicada).
// Ao mudar os textos de termos.html / privacidade.html, atualize aqui.
var TERMS_VERSION = '2026-09-24';
// Chaves que o app pode gravar (qualquer outra é recusada)
var DATA_KEYS = ['meta', 'profile', 'settings', 'workouts', 'exercises', 'favorites', 'sessions', 'active', 'bodyweight', 'goals', 'program', 'reminders'];
// Cores aceitas nos treinos (as mesmas de js/workouts.js)
var WORKOUT_COLORS = ['#E8853D', '#E5B454', '#E5675A', '#5E9EFF', '#4CC38A', '#A78BFA', '#8E8E93'];

// O que cada papel pode fazer no FORJA Trainer. Não existe endpoint para alterar assinatura,
// limite da academia ou códigos globais: essas ações só existem no menu "FORJA Admin" da planilha.
var ROLE_PERMISSIONS = {
  TREINADOR: ['alunos.ver', 'alunos.dadosFisicos', 'alunos.peso', 'treinos.ver', 'treinos.editar', 'treinadores.ver'],
  GESTOR: ['alunos.ver', 'alunos.dadosFisicos', 'alunos.peso', 'treinos.ver', 'treinos.editar', 'treinadores.ver', 'alunos.desvincular']
};

var REQ = {}; // cache de leitura das abas durante uma requisição
var OUTBOX = []; // e-mails da requisição: saem depois que a trava é liberada (ver doPost)

/* ---------- Entrada ---------- */
function doGet() {
  return json_({ ok: true, app: 'FORJA', status: 'online' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var out;
  OUTBOX = [];
  try {
    // Uma requisição por vez: validações como o limite de alunos ficam atômicas
    lock.waitLock(20000);
    REQ = {};
    ensureSchema_();
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var handler = ACTIONS[req.action];
    out = handler ? handler(req) : { ok: false, error: 'unknown_action' };
  } catch (err) {
    OUTBOX = [];
    if (err && err.code) out = { ok: false, error: err.code, message: err.userMessage || undefined };
    else { console.error(err); out = { ok: false, error: 'server', message: String(err && err.message || err) }; }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  // O envio de e-mail leva ~1 s: fora da trava, ele não segura as requisições dos outros usuários
  flushOutbox_(out);
  return json_(out);
}

var ACTIONS = {
  /* ======================= App do aluno ======================= */
  // A conta nasce com o e-mail NÃO confirmado: entra, mas só acessa os dados depois de tocar no link
  register: function (req) {
    var email = normEmail_(req.email);
    var name = str_(req.name, 30);
    var password = String(req.password || '');
    if (!name) fail_('invalid_name');
    if (!validEmail_(email)) fail_('invalid_email');
    if (password.length < STUDENT_PASSWORD_MIN) fail_('weak_password');
    if (req.passwordConfirm !== undefined && String(req.passwordConfirm) !== password) fail_('password_mismatch');
    // LGPD: o aceite fica registrado (data e versão dos textos)
    if (req.acceptTerms !== true) fail_('terms_required');
    if (findUserBy_('email', email)) fail_('email_taken');
    // Sem como enviar o link, a conta não é criada (ninguém fica preso numa conta que não consegue confirmar)
    mailReady_();
    var salt = Utilities.getUuid();
    var id = 'u_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var stamp = now_();
    var user = createAccount_({
      id: id, email: email, nome: name, hash: pwHash_(salt, password), salt: salt, plano: 'free', criadoEm: stamp,
      tipoConta: 'FREE', origemPremium: 'NENHUMA', statusPremium: 'INATIVO', ultimoAcesso: stamp, statusUsuario: 'ATIVO',
      emailVerificado: 'NAO', termosAceitosEm: stamp, termosVersao: TERMS_VERSION
    });
    throttleMail_('verify:' + user.id);
    sendAccountEmail_('verify', user, true);
    return { ok: true, token: newSession_(id, 'aluno'), user: publicUser_(user, syncAccount_(user)) };
  },

  login: function (req) {
    var email = normEmail_(req.email);
    checkAttempts_('aluno', email);
    var row = findUserBy_('email', email);
    if (!row || !checkPassword_('users', row, String(req.password || ''))) { registerFail_('aluno', email); fail_('invalid_login'); }
    clearFails_('aluno', email);
    if (up_(row.statusUsuario) === 'BLOQUEADO') fail_('account_blocked');
    touch_(row, true);
    return { ok: true, token: newSession_(row.id, 'aluno'), user: publicUser_(row, syncAccount_(row)) };
  },

  // Também responde para conta com e-mail não confirmado (user.emailVerified = false): o app mostra "Confirme seu e-mail"
  me: function (req) {
    var user = auth_(req.token, true);
    touch_(user);
    return { ok: true, user: publicUser_(user, syncAccount_(user)) };
  },

  logout: function (req) {
    var sh = sheet_('sessions');
    var values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) if (values[i][0] === req.token) sh.deleteRow(i + 1);
    delete REQ.sessions;
    return { ok: true };
  },

  /* ---------- Confirmação de e-mail e nova senha (só aluno) ----------
     Os links do e-mail abrem o app em #/confirmar-email/<token> e #/redefinir-senha/<token>.
     O app só repassa o token (linkToken); quem confere tudo é o servidor. */

  // Abrir o link "Confirmar meu e-mail". Não exige sessão: o link pode ser aberto em outro aparelho.
  verifyEmail: function (req) {
    var u = userForLink_('verify', req.linkToken);
    updateAccount_(u, verifiedChanges_());
    return { ok: true, email: maskEmail_(u.email) };
  },

  // "Reenviar confirmação" (com a sessão) ou "Enviar novo link" (com o link vencido, sem sessão)
  resendVerificationEmail: function (req) {
    var u;
    if (req.token) u = auth_(req.token, true);
    else {
      u = accountByLinkToken_('verify', req.linkToken);
      if (!u) fail_('token_invalid');
      if (up_(u.statusUsuario) === 'BLOQUEADO') fail_('account_blocked');
    }
    if (emailVerified_(u)) return { ok: true, alreadyVerified: true, email: maskEmail_(u.email) };
    mailReady_();
    throttleMail_('verify:' + u.id);
    sendAccountEmail_('verify', u, true);
    return { ok: true, email: maskEmail_(u.email), retryIn: MAIL_COOLDOWN_SECONDS };
  },

  // "Alterar e-mail" na tela de confirmação: corrige um e-mail digitado errado. Só para conta ainda não confirmada.
  changeEmail: function (req) {
    var u = auth_(req.token, true);
    if (emailVerified_(u)) fail_('email_already_verified');
    var email = normEmail_(req.email);
    var current = normEmail_(u.email);
    if (!validEmail_(email)) fail_('invalid_email');
    if (email === current) fail_('email_same');
    checkAttempts_('aluno', current);
    if (!checkPassword_('users', u, String(req.password || ''))) { registerFail_('aluno', current); fail_('wrong_password'); }
    clearFails_('aluno', current);
    if (accountByEmail_(email)) fail_('email_taken');
    mailReady_();
    throttleMail_('verify:' + u.id, true); // endereço novo: sem espera, mas conta no limite por hora
    // Links enviados para o endereço antigo deixam de valer
    updateAccount_(u, { email: email, tokenResetSenhaHash: '', tokenResetSenhaExpira: '' });
    sendAccountEmail_('verify', u, true);
    return { ok: true, user: publicUser_(u), retryIn: MAIL_COOLDOWN_SECONDS };
  },

  // "Esqueci minha senha". A resposta é SEMPRE a mesma, exista ou não uma conta com este e-mail.
  requestPasswordReset: function (req) {
    var email = normEmail_(req.email);
    if (!validEmail_(email)) fail_('invalid_email');
    mailReady_();
    // O limite vale para o endereço digitado, com ou sem conta: nem ele revela se a conta existe
    throttleMail_('reset:' + email);
    var u = accountByEmail_(email);
    if (u && up_(u.statusUsuario) !== 'BLOQUEADO') sendAccountEmail_('reset', u, false);
    else queueMail_(padTiming_, false);
    return { ok: true };
  },

  // Tela "Nova senha": confere o link antes de mostrar o formulário (não gasta o link)
  checkPasswordReset: function (req) {
    var u = userForLink_('reset', req.linkToken);
    return { ok: true, email: maskEmail_(u.email) };
  },

  // Grava a nova senha com o mesmo hash do cadastro, gasta o link e encerra as sessões da conta
  confirmPasswordReset: function (req) {
    var u = userForLink_('reset', req.linkToken);
    var password = String(req.password || '');
    if (password.length < STUDENT_PASSWORD_MIN) fail_('weak_password');
    if (req.passwordConfirm !== undefined && String(req.passwordConfirm) !== password) fail_('password_mismatch');
    var salt = Utilities.getUuid();
    // Quem abriu o link provou que o e-mail é dele: se ainda não estava confirmado, fica confirmado
    var changes = emailVerified_(u) ? {} : verifiedChanges_();
    changes.hash = pwHash_(salt, password);
    changes.salt = salt;
    changes.tokenResetSenhaHash = '';
    changes.tokenResetSenhaExpira = '';
    updateAccount_(u, changes);
    endStudentSessions_(u.id);
    clearFails_('aluno', normEmail_(u.email));
    return { ok: true, email: u.email };
  },

  // O pagamento ainda NÃO existe. O app não consegue mais virar Premium sozinho.
  // A assinatura individual só é criada pelo webhook do pagamento (subscriptionWebhook)
  // ou pelo menu "FORJA Admin › Registrar assinatura" da planilha.
  setPlan: function (req) {
    auth_(req.token);
    fail_('payment_unavailable');
  },

  // Código Premium (promoções, parceiros, testes). Não é código de academia.
  redeemPremiumCode: function (req) {
    var user = auth_(req.token);
    var code = normCode_(req.code);
    if (!code) fail_('code_invalid');
    if (findAcademyBy_('codigo', code)) fail_('academy_code');
    var row = findPremiumCode_(code);
    if (!row) fail_('code_invalid');
    if (up_(row.status) !== 'ATIVO') fail_('code_inactive');
    if (!stillValid_(row.validoAte)) fail_('code_expired');
    var limit = int_(row.limiteUsos, 0, 1e9) || 0;
    var used = int_(row.usos, 0, 1e9) || 0;
    if (limit > 0 && used >= limit) fail_('code_exhausted');
    var already = table_('redemptions').rows.some(function (r) { return r.userId === user.id && normCode_(r.codigo) === code; });
    if (already) fail_('code_used');
    var days = int_(row.diasPremium, 0, 36500) || 0;
    var until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : '';
    insert_('redemptions', { id: 'r_' + shortId_(), codigo: code, userId: user.id, data: now_(), premiumAte: until });
    patch_('premiumCodes', row, { usos: used + 1 });
    return { ok: true, user: publicUser_(user, syncAccount_(user)) };
  },

  // Código da academia: vincula o aluno e concede Premium Academia
  joinAcademy: function (req) {
    var user = auth_(req.token);
    var code = normCode_(req.code);
    // 1. código
    if (!code) fail_('academy_code_invalid');
    // 2. academia
    var ac = findAcademyBy_('codigo', code);
    if (!ac) fail_(findPremiumCode_(code) ? 'premium_code' : 'academy_code_invalid');
    // 3 e 4. academia ativa e contrato válido
    var st = academyStatus_(ac);
    if (!st.ok) fail_(st.code);
    // 6. já vinculado?
    if (up_(user.statusVinculoAcademia) === 'ATIVO' && user.academiaId) {
      fail_(String(user.academiaId) === String(ac.id) ? 'academy_already' : 'academy_other');
    }
    // 5. limite de alunos (a trava do doPost garante que duas entradas não passem juntas)
    if (activeStudentsCount_(ac.id) >= academyLimit_(ac)) fail_('academy_full');
    // 7, 8 e 9. vínculo + Premium Academia + planilha
    var stamp = now_();
    insert_('links', { id: 'v_' + shortId_(), userId: user.id, academiaId: ac.id, status: 'ATIVO', dataEntrada: stamp, codigoUsado: code });
    patch_('users', user, {
      academiaId: ac.id, academiaNome: ac.nome, statusVinculoAcademia: 'ATIVO',
      dataEntradaAcademia: stamp, dataSaidaAcademia: ''
    });
    return { ok: true, user: publicUser_(user, syncAccount_(user)) };
  },

  leaveAcademy: function (req) {
    var user = auth_(req.token);
    if (up_(user.statusVinculoAcademia) !== 'ATIVO' || !user.academiaId) fail_('not_in_academy');
    endLink_(user, 'SAIDA_ALUNO');
    return { ok: true, user: publicUser_(user, syncAccount_(user)) };
  },

  // Dados da conta: { chave: valor }. Com keys: [...], só essas chaves.
  pull: function (req) {
    var user = auth_(req.token);
    var keys = Array.isArray(req.keys) ? req.keys.filter(function (k) { return DATA_KEYS.indexOf(k) >= 0; }) : null;
    var got = readKeys_([user.id], keys)[user.id];
    return { ok: true, data: got ? got.data : {} };
  },

  // Grava as chaves enviadas: { data: { chave: valor } }
  push: function (req) {
    var user = auth_(req.token);
    var data = req.data || {};
    var keys = Object.keys(data).filter(function (k) { return DATA_KEYS.indexOf(k) >= 0; });
    if (!keys.length) return { ok: true, saved: 0 };
    var out = {};
    keys.forEach(function (k) { out[k] = data[k]; });
    var res = { ok: true };
    // Treinos do treinador são preservados: o app nunca os sobrescreve
    if ('workouts' in out) {
      var merged = mergeWorkouts_(user.id, out.workouts);
      if (JSON.stringify(merged) !== JSON.stringify(out.workouts)) res.workouts = merged;
      out.workouts = merged;
    }
    res.saved = writeKeys_(user.id, out);
    if ('profile' in out || 'bodyweight' in out) mirrorBody_(user, out);
    touch_(user);
    return res;
  },

  // "Apagar todos os dados" no app: treinos, histórico, pesos e dados do corpo. A conta continua.
  clear: function (req) {
    var user = auth_(req.token);
    eraseTrainingData_(user);
    return { ok: true };
  },

  // Perfil › Trocar senha. Esta sessão continua; as dos outros aparelhos são encerradas.
  changePassword: function (req) {
    var u = auth_(req.token);
    var email = normEmail_(u.email);
    var current = String(req.current || '');
    var next = String(req.next || '');
    checkAttempts_('aluno', email);
    if (!checkPassword_('users', u, current)) { registerFail_('aluno', email); fail_('wrong_password'); }
    clearFails_('aluno', email);
    if (next.length < STUDENT_PASSWORD_MIN) fail_('weak_password');
    if (req.nextConfirm !== undefined && String(req.nextConfirm) !== next) fail_('password_mismatch');
    if (next === current) fail_('password_same');
    var salt = Utilities.getUuid();
    // Um link de "Esqueci minha senha" ainda aberto deixa de valer
    updateAccount_(u, { hash: pwHash_(salt, next), salt: salt, tokenResetSenhaHash: '', tokenResetSenhaExpira: '' });
    return { ok: true, otherSessionsEnded: endStudentSessions_(u.id, req.token) };
  },

  // Perfil › Excluir minha conta (LGPD, direito de eliminação). Pede a senha de novo.
  deleteAccount: function (req) {
    var u = auth_(req.token, true);
    var email = normEmail_(u.email);
    checkAttempts_('aluno', email);
    if (!checkPassword_('users', u, String(req.password || ''))) { registerFail_('aluno', email); fail_('wrong_password'); }
    clearFails_('aluno', email);
    deleteAccount_(u);
    return { ok: true };
  },

  /* ======================= Pagamento (preparado) =======================
     Ponto de entrada para confirmar assinaturas vindas de um gateway (Mercado Pago, Stripe,
     Apple, Google Play...). Nenhum gateway está integrado ainda. Para ligar um, escreva um
     adaptador que confirme o pagamento NO GATEWAY e chame esta ação com o segredo.
     Propriedade obrigatória: WEBHOOK_SECRET (Configurações do projeto › Propriedades do script). */
  subscriptionWebhook: function (req) {
    var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!secret || !safeEqual_(String(req.secret || ''), secret)) fail_('forbidden');
    var user = req.userId ? findUserBy_('id', String(req.userId)) : findUserBy_('email', normEmail_(req.email));
    if (!user) fail_('user_not_found');
    var sub = upsertSubscription_(user, req);
    return { ok: true, subscriptionId: sub.id, account: syncAccount_(user) };
  },

  /* ======================= FORJA Trainer ======================= */
  trainerLogin: function (req) {
    var email = normEmail_(req.email);
    checkAttempts_('treinador', email);
    var t = findTrainerBy_('email', email);
    if (!t || !checkPassword_('trainers', t, String(req.password || ''))) { registerFail_('treinador', email); fail_('invalid_login'); }
    clearFails_('treinador', email);
    if (up_(t.status) !== 'ATIVO') fail_('trainer_inactive');
    patch_('trainers', t, { ultimoAcesso: now_() });
    return { ok: true, token: newSession_(t.id, 'treinador'), trainer: publicTrainer_(t) };
  },

  trainerMe: function (req) {
    var t = trainerAuth_(req.token);
    return { ok: true, trainer: publicTrainer_(t) };
  },

  trainerChangePassword: function (req) {
    var t = trainerAuth_(req.token);
    var next = String(req.next || '');
    if (!checkPassword_('trainers', t, String(req.current || ''))) fail_('wrong_password');
    if (next.length < 8) fail_('weak_password', 'Use uma senha com pelo menos 8 caracteres.');
    if (next === String(req.current || '')) fail_('weak_password', 'A nova senha precisa ser diferente da atual.');
    var salt = Utilities.getUuid();
    patch_('trainers', t, { hash: pwHash_(salt, next), salt: salt, trocarSenha: '' });
    return { ok: true, trainer: publicTrainer_(t) };
  },

  // Cartões, alunos recentes, alterações, evolução de peso e alertas
  trainerOverview: function (req) {
    var ctx = trainerCtx_(req, 'alunos.ver');
    var students = academyStudents_(ctx.academy.id);
    var blobs = readKeys_(students.map(function (u) { return u.id; }), ['workouts']);
    var summaries = students.map(function (u) { return studentSummary_(u, blobs[u.id]); });
    var totalWorkouts = 0, managedWorkouts = 0, active = 0;
    summaries.forEach(function (s) { totalWorkouts += s.treinos; managedWorkouts += s.treinosGerenciados; if (s.status === 'ATIVO') active++; });

    var weights = weightsByUser_(students.map(function (u) { return u.id; }));
    var evolution = summaries.map(function (s) {
      var list = (weights[s.id] || []).slice(-12);
      if (list.length < 2) return null;
      return { id: s.id, nome: s.nome, pontos: list, variacao: round_(list[list.length - 1].pesoKg - list[0].pesoKg, 1) };
    }).filter(Boolean).sort(function (a, b) { return Math.abs(b.variacao) - Math.abs(a.variacao); }).slice(0, 6);

    var recent = summaries.slice().sort(function (a, b) { return cmpDesc_(a.dataEntrada, b.dataEntrada); }).slice(0, 6);
    return {
      ok: true,
      academia: academyPublic_(ctx.academy, students.length),
      cards: { alunos: students.length, limite: academyLimit_(ctx.academy), treinos: totalWorkouts, treinosTreinador: managedWorkouts, ativos: active, inativos: students.length - active },
      alunosRecentes: recent,
      alteracoes: academyLog_(ctx.academy.id, 8),
      atividades: academyActivity_(ctx.academy.id, students, 10),
      evolucaoPeso: evolution,
      alertas: academyAlerts_(ctx.academy, students.length, summaries)
    };
  },

  trainerStudents: function (req) {
    var ctx = trainerCtx_(req, 'alunos.ver');
    var students = academyStudents_(ctx.academy.id);
    var blobs = readKeys_(students.map(function (u) { return u.id; }), ['workouts']);
    return { ok: true, academia: academyPublic_(ctx.academy, students.length), alunos: students.map(function (u) { return studentSummary_(u, blobs[u.id]); }) };
  },

  trainerStudent: function (req) {
    var ctx = trainerCtx_(req, 'alunos.ver');
    var u = studentOf_(ctx, req.userId);
    var got = readKeys_([u.id], ['workouts', 'exercises', 'sessions', 'bodyweight'])[u.id] || { data: {} };
    var d = got.data;
    var canBody = ctx.perms.indexOf('alunos.dadosFisicos') >= 0;
    var canWeight = ctx.perms.indexOf('alunos.peso') >= 0;
    var weights = canWeight ? (weightsByUser_([u.id])[u.id] || []) : [];
    // Conta que ainda não sincronizou o histórico: usa o JSON do app
    if (canWeight && !weights.length && Array.isArray(d.bodyweight)) {
      weights = d.bodyweight.filter(function (e) { return e && validWeight_(e.kg); })
        .map(function (e) { return { data: iso_(e.date), pesoKg: round_(Number(e.kg), 1) }; })
        .sort(function (a, b) { return cmpAsc_(a.data, b.data); });
    }
    var sessions = (Array.isArray(d.sessions) ? d.sessions : []).slice()
      .sort(function (a, b) { return cmpDesc_(a.startedAt, b.startedAt); }).slice(0, 12)
      .map(function (s) {
        var sets = 0;
        (s.exercises || []).forEach(function (e) { sets += (e.sets || []).filter(function (x) { return x.done !== false; }).length; });
        return { id: s.id, treino: s.name || '', data: s.startedAt, duracaoSeg: s.durationSec || null, exercicios: (s.exercises || []).length, series: sets };
      });
    var summary = studentSummary_(u, got);
    return {
      ok: true,
      aluno: {
        id: u.id, nome: u.nome, email: u.email,
        idade: canBody ? summary.idade : null,
        dataNascimento: canBody ? day_(u.dataNascimento) : null,
        pesoAtual: canBody ? summary.pesoAtual : null,
        altura: canBody ? summary.altura : null,
        imc: canBody ? summary.imc : null,
        academia: ctx.academy.nome, dataEntrada: iso_(u.dataEntradaAcademia),
        status: summary.status, ultimoAcesso: summary.ultimoAcesso, ultimaAtualizacao: summary.ultimaAtualizacao
      },
      pesos: weights,
      treinos: (Array.isArray(d.workouts) ? d.workouts : []).slice().sort(byOrder_),
      exerciciosPersonalizados: (Array.isArray(d.exercises) ? d.exercises : []).map(function (e) { return { id: e.id, name: e.name, muscle: e.muscle, equipment: e.equipment }; }),
      sessoes: sessions,
      alteracoes: academyLog_(ctx.academy.id, 30, u.id)
    };
  },

  // Cria (sem workout.id) ou altera um treino do aluno
  trainerSaveWorkout: function (req) {
    var ctx = trainerCtx_(req, 'treinos.editar');
    var u = studentOf_(ctx, req.userId);
    var clean = cleanWorkout_(req.workout);
    var list = readWorkouts_(u.id);
    var id = req.workout && req.workout.id ? String(req.workout.id) : '';
    var index = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) index = i;
    if (id && index < 0) fail_('workout_not_found');
    var before = index >= 0 ? list[index] : null;
    var stamp = now_();
    var w = {
      id: before ? before.id : 'w_' + shortId_(),
      name: clean.name, description: clean.description, muscleGroup: clean.muscleGroup, color: clean.color,
      order: before ? (before.order || 0) : nextOrder_(list),
      exercises: clean.exercises,
      createdAt: before ? (before.createdAt || stamp) : stamp,
      updatedAt: stamp,
      managed: true,
      managedBy: { trainerId: ctx.trainer.id, trainerName: ctx.trainer.nome, academiaId: ctx.academy.id, academiaName: ctx.academy.nome, at: stamp }
    };
    if (index >= 0) list[index] = w; else list.push(w);
    writeKeys_(u.id, { workouts: list });
    var tipo = !before ? 'CRIAR' : before.managed ? 'EDITAR' : 'ASSUMIR';
    logWorkout_(ctx, u, w, tipo, describeChanges_(before, w));
    return { ok: true, treino: w, treinos: list.slice().sort(byOrder_) };
  },

  trainerDeleteWorkout: function (req) {
    var ctx = trainerCtx_(req, 'treinos.editar');
    var u = studentOf_(ctx, req.userId);
    var list = readWorkouts_(u.id);
    var w = null;
    list = list.filter(function (x) { if (x && x.id === String(req.workoutId)) { w = x; return false; } return true; });
    if (!w) fail_('workout_not_found');
    // Treinos criados pelo aluno pertencem a ele; o treinador só exclui os que gerencia
    if (!w.managed) fail_('forbidden', 'Este treino foi criado pelo aluno. Assuma o treino (editar) antes de excluir.');
    writeKeys_(u.id, { workouts: list });
    logWorkout_(ctx, u, w, 'EXCLUIR', 'Treino excluído (' + (w.exercises || []).length + ' exercícios)');
    return { ok: true, treinos: list.slice().sort(byOrder_) };
  },

  // Todos os treinos dos alunos da academia (página Treinos)
  trainerWorkouts: function (req) {
    var ctx = trainerCtx_(req, 'treinos.ver');
    var students = academyStudents_(ctx.academy.id);
    var blobs = readKeys_(students.map(function (u) { return u.id; }), ['workouts']);
    var out = [];
    students.forEach(function (u) {
      var list = blobs[u.id] && Array.isArray(blobs[u.id].data.workouts) ? blobs[u.id].data.workouts : [];
      list.forEach(function (w) {
        if (!w) return;
        out.push({
          alunoId: u.id, alunoNome: u.nome, id: w.id, nome: w.name, grupo: w.muscleGroup || '', cor: w.color || '',
          exercicios: (w.exercises || []).length, series: (w.exercises || []).reduce(function (n, x) { return n + (Number(x.sets) || 0); }, 0),
          gerenciado: !!w.managed, treinador: w.managed && w.managedBy ? w.managedBy.trainerName : '', atualizadoEm: w.updatedAt || w.createdAt || ''
        });
      });
    });
    out.sort(function (a, b) { return cmpDesc_(a.atualizadoEm, b.atualizadoEm); });
    return { ok: true, treinos: out, alteracoes: academyLog_(ctx.academy.id, 20) };
  },

  trainerAcademy: function (req) {
    var ctx = trainerCtx_(req, 'alunos.ver');
    var count = activeStudentsCount_(ctx.academy.id);
    var trainers = [];
    if (ctx.perms.indexOf('treinadores.ver') >= 0) {
      table_('trainerAcademies').rows.forEach(function (l) {
        if (String(l.academiaId) !== String(ctx.academy.id) || up_(l.status) !== 'ATIVO') return;
        var t = findTrainerBy_('id', l.treinadorId);
        if (t) trainers.push({ id: t.id, nome: t.nome, email: t.email, papel: up_(l.papel) || 'TREINADOR', status: up_(t.status), ultimoAcesso: iso_(t.ultimoAcesso), voce: t.id === ctx.trainer.id });
      });
    }
    return { ok: true, academia: academyPublic_(ctx.academy, count), treinadores: trainers, papel: ctx.role, permissoes: ctx.perms };
  },

  // Encerrar o vínculo de um aluno (somente papel GESTOR)
  trainerUnlinkStudent: function (req) {
    var ctx = trainerCtx_(req, 'alunos.desvincular');
    var u = studentOf_(ctx, req.userId);
    endLink_(u, 'ENCERRADO_ACADEMIA');
    syncAccount_(u);
    return { ok: true };
  }
};

/* ==========================================================================
   Configuração inicial e migração (rode setup() uma vez pelo editor;
   depois de atualizar este arquivo ela roda sozinha na primeira requisição)
   ========================================================================== */
function setup() {
  var ss = ss_();
  REQ = {};
  Object.keys(SHEETS).forEach(function (k) { ensureSheet_(ss, SHEETS[k]); });
  var props = PropertiesService.getScriptProperties();
  // "Pimenta" das senhas: fica nas propriedades do script, nunca na planilha nem no app
  if (!props.getProperty('PASSWORD_PEPPER')) props.setProperty('PASSWORD_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  // O pagamento simulado deixou de existir
  props.deleteProperty('ALLOW_PLAN_CHANGE');
  REQ = {};
  migrateUsers_();
  migrateEmailVerification_();
  backfillBody_();
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  var nomes = Object.keys(SHEETS).map(function (k) { return SHEETS[k].name; }).join(', ');
  Logger.log('FORJA: tudo pronto na planilha "' + ss.getName() + '". Abas: ' + nomes + '. Recarregue a planilha (F5) se elas ainda não aparecerem.');
  if (!validBaseUrl_(mailConfig_().baseUrl)) {
    Logger.log('FORJA: ATENÇÃO — defina a propriedade APP_BASE_URL (endereço público do app, https://...). Sem ela, novos cadastros e e-mails de senha ficam indisponíveis.');
  }
  return 'Abas prontas em: ' + ss.getName();
}

function ensureSchema_() {
  if (PropertiesService.getScriptProperties().getProperty('SCHEMA_VERSION') !== SCHEMA_VERSION) setup();
}

// Cria a aba se faltar; se existir, só acrescenta no fim as colunas que faltam
function ensureSheet_(ss, def) {
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  var header;
  if (sh.getLastRow() === 0) {
    sh.appendRow(def.header);
    header = def.header.slice();
  } else {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    while (header.length && !header[header.length - 1]) header.pop();
    var missing = def.header.filter(function (h) { return header.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
      header = header.concat(missing);
    }
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  // Colunas de texto puro (evita a planilha converter códigos, datas e JSON)
  (def.text || []).forEach(function (name) {
    var c = header.indexOf(name);
    if (c >= 0) sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

// Contas antigas: plano 'premium' (pagamento simulado ou mudado à mão) vira ativação administrativa,
// para ninguém perder o Premium que já tinha. O espelho tipoConta/origemPremium é preenchido.
function migrateUsers_() {
  var t = table_('users');
  t.rows.forEach(function (u) {
    if (u.tipoConta) return;
    var changes = { statusUsuario: u.statusUsuario || 'ATIVO' };
    if (String(u.plano).toLowerCase() === 'premium') { changes.premiumManual = 'SIM'; u.premiumManual = 'SIM'; }
    patch_('users', u, changes);
    syncAccount_(u);
  });
}

// Preenche peso, altura, nascimento e o histórico de peso a partir dos JSON que o app já enviou
function backfillBody_() {
  var users = table_('users').rows.filter(function (u) { return !u.pesoAtual && !u.altura; });
  if (!users.length) return;
  var blobs = readKeys_(users.map(function (u) { return u.id; }), ['profile', 'bodyweight']);
  users.forEach(function (u) {
    if (!blobs[u.id]) return;
    mirrorBody_(u, { profile: blobs[u.id].data.profile || null, bodyweight: blobs[u.id].data.bodyweight || [] });
  });
}

/**
 * A planilha onde tudo é gravado.
 * Normalmente é a planilha dona do script (Extensões › Apps Script).
 * Se o script foi criado avulso (script.google.com), configure a propriedade
 * SPREADSHEET_ID em Configurações do projeto › Propriedades do script,
 * com o id que aparece na URL da planilha: .../spreadsheets/d/ESTE_PEDACO/edit
 */
function ss_() {
  var ss = SpreadsheetApp.getActive();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {
      throw new Error('Não consegui abrir a planilha do SPREADSHEET_ID. Confira se o id está certo e se a conta tem acesso.');
    }
  }
  throw new Error('Este script não está ligado a nenhuma planilha. Abra a planilha, vá em Extensões › Apps Script e cole o código lá; ou defina a propriedade SPREADSHEET_ID em Configurações do projeto.');
}

// Apaga sessões vencidas. Opcional: crie um acionador diário para esta função.
function cleanupSessions() {
  var sh = sheet_('sessions');
  var values = sh.getDataRange().getValues();
  var nowMs = Date.now();
  for (var i = values.length - 1; i >= 1; i--) if (new Date(values[i][3]).getTime() < nowMs) sh.deleteRow(i + 1);
}

/* ==========================================================================
   Menu "FORJA Admin" (só quem edita a planilha vê). Ações administrativas
   ficam aqui, e não no app nem no Dashboard: criar academias, treinadores,
   códigos Premium, registrar assinaturas e encerrar vínculos.
   ========================================================================== */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('FORJA Admin')
      .addItem('Criar academia', 'menuCriarAcademia')
      .addItem('Criar treinador', 'menuCriarTreinador')
      .addItem('Vincular treinador a outra academia', 'menuVincularTreinador')
      .addItem('Redefinir senha de treinador', 'menuRedefinirSenhaTreinador')
      .addSeparator()
      .addItem('Criar código Premium', 'menuCriarCodigoPremium')
      .addItem('Registrar assinatura individual', 'menuRegistrarAssinatura')
      .addItem('Cancelar assinatura individual', 'menuCancelarAssinatura')
      .addSeparator()
      .addItem('Encerrar vínculo de aluno com academia', 'menuEncerrarVinculo')
      .addItem('Recalcular Premium de todos', 'menuRecalcular')
      .addSeparator()
      .addItem('Testar envio de e-mail', 'menuTestarEmail')
      .addItem('Confirmar e-mail de aluno (suporte)', 'menuConfirmarEmailAluno')
      .addSeparator()
      .addItem('Ativar backup diário', 'menuAtivarBackup')
      .addItem('Fazer backup agora', 'menuBackupAgora')
      .addSeparator()
      .addItem('Atualizar estrutura (setup)', 'setup')
      .addToUi();
  } catch (e) { /* script avulso: sem menu */ }
}

function ask_(title, text, def) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt(title, text + (def ? '\n(deixe vazio para: ' + def + ')' : ''), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) throw new Error('cancelado');
  var v = String(r.getResponseText() || '').trim();
  return v || (def || '');
}
function say_(title, text) { SpreadsheetApp.getUi().alert(title, text, SpreadsheetApp.getUi().ButtonSet.OK); }
function menu_(fn) {
  REQ = {};
  ensureSchema_();
  try { fn(); } catch (e) {
    if (String(e.message) === 'cancelado') return;
    say_('FORJA', 'Não foi possível: ' + (e.userMessage || e.message || e));
  }
}

function menuCriarAcademia() {
  menu_(function () {
    var nome = ask_('Criar academia', 'Nome da academia:');
    var limite = ask_('Criar academia', 'Limite de alunos contratados:', '50');
    var codigo = ask_('Criar academia', 'Código da academia (ex.: FORJA-GYM-ABC123):', 'gerar automaticamente');
    var fim = ask_('Criar academia', 'Término do contrato (AAAA-MM-DD):', 'sem término');
    var ac = adminCriarAcademia(nome, Number(limite), {
      codigo: codigo === 'gerar automaticamente' ? '' : codigo,
      fim: fim === 'sem término' ? '' : fim
    });
    say_('Academia criada', ac.nome + '\nID: ' + ac.id + '\nCódigo: ' + ac.codigo + '\nLimite: ' + ac.limiteAlunos + ' alunos');
  });
}

function menuCriarTreinador() {
  menu_(function () {
    var nome = ask_('Criar treinador', 'Nome do treinador:');
    var email = ask_('Criar treinador', 'E-mail (usado no login):');
    var academiaId = ask_('Criar treinador', 'Academia (ID, código ou nome):\n' + academyList_());
    var papel = ask_('Criar treinador', 'Papel: TREINADOR ou GESTOR', 'TREINADOR');
    var r = adminCriarTreinador(nome, email, academiaId, papel);
    say_('Treinador criado', r.nome + ' <' + r.email + '>\nSenha provisória: ' + r.senhaProvisoria +
      '\n\nEntregue a senha ao treinador. Ela precisa ser trocada no primeiro acesso ao FORJA Trainer. Ela não fica gravada em lugar nenhum.');
  });
}

function menuVincularTreinador() {
  menu_(function () {
    var email = ask_('Vincular treinador', 'E-mail do treinador:');
    var academiaId = ask_('Vincular treinador', 'Academia (ID, código ou nome):\n' + academyList_());
    var papel = ask_('Vincular treinador', 'Papel: TREINADOR ou GESTOR', 'TREINADOR');
    adminVincularTreinador(email, academiaId, papel);
    say_('FORJA', 'Treinador vinculado.');
  });
}

function menuRedefinirSenhaTreinador() {
  menu_(function () {
    var email = ask_('Redefinir senha', 'E-mail do treinador:');
    var senha = adminRedefinirSenhaTreinador(email);
    say_('Senha redefinida', 'Nova senha provisória: ' + senha + '\nEla precisa ser trocada no próximo acesso.');
  });
}

function menuCriarCodigoPremium() {
  menu_(function () {
    var dias = ask_('Código Premium', 'Dias de Premium (0 = sem prazo):', '30');
    var usos = ask_('Código Premium', 'Limite de utilizações (0 = ilimitado):', '1');
    var validoAte = ask_('Código Premium', 'Código válido até (AAAA-MM-DD):', 'sem validade');
    var descricao = ask_('Código Premium', 'Descrição (ex.: Parceiro X, Teste):', 'Código Premium');
    var c = adminCriarCodigoPremium({ dias: Number(dias), limiteUsos: Number(usos), validoAte: validoAte === 'sem validade' ? '' : validoAte, descricao: descricao });
    say_('Código criado', c.codigo + '\n' + (c.diasPremium ? c.diasPremium + ' dias de Premium' : 'Premium sem prazo') + ' · ' + (c.limiteUsos ? c.limiteUsos + ' uso(s)' : 'usos ilimitados'));
  });
}

function menuRegistrarAssinatura() {
  menu_(function () {
    var email = ask_('Registrar assinatura', 'Use SOMENTE para uma assinatura já paga/confirmada fora do sistema, ou para teste.\n\nE-mail do aluno:');
    var plano = ask_('Registrar assinatura', 'Plano: MENSAL ou ANUAL', 'MENSAL');
    var fim = ask_('Registrar assinatura', 'Válida até (AAAA-MM-DD):', plano.toUpperCase() === 'ANUAL' ? '+365 dias' : '+30 dias');
    var r = adminRegistrarAssinatura(email, { plano: plano, fim: /^\+/.test(fim) ? '' : fim, dias: plano.toUpperCase() === 'ANUAL' ? 365 : 30 });
    say_('Assinatura registrada', 'Conta: ' + r.email + '\nPremium: ' + r.account.tipoConta + ' · origem ' + r.account.origemPremium);
  });
}

function menuCancelarAssinatura() {
  menu_(function () {
    var email = ask_('Cancelar assinatura', 'E-mail do aluno:');
    var r = adminCancelarAssinatura(email);
    say_('Assinatura cancelada', 'Conta: ' + email + '\nAgora: ' + r.tipoConta + ' · origem ' + r.origemPremium);
  });
}

function menuEncerrarVinculo() {
  menu_(function () {
    var email = ask_('Encerrar vínculo', 'E-mail do aluno:');
    var r = adminEncerrarVinculo(email, 'ENCERRADO_ADMIN');
    say_('Vínculo encerrado', 'Conta: ' + email + '\nAgora: ' + r.tipoConta + ' · origem ' + r.origemPremium);
  });
}

function menuRecalcular() {
  menu_(function () {
    var n = 0;
    table_('users').rows.forEach(function (u) { syncAccount_(u); n++; });
    say_('FORJA', n + ' contas recalculadas.');
  });
}

function menuTestarEmail() {
  menu_(function () {
    var email = ask_('Testar envio de e-mail', 'Enviar um e-mail de teste para:');
    var r = adminTestarEmail(email);
    say_('E-mail enviado', 'Confira a caixa de entrada de ' + r.email + ' (e o spam).\nO botão abre: ' + r.link + '\nE-mails que ainda podem ser enviados hoje: ' + r.restantes);
  });
}

function menuAtivarBackup() {
  menu_(function () {
    var r = ativarBackupDiario();
    say_('Backup diário ativado', 'Todo dia, por volta das ' + BACKUP_HOUR + 'h, uma cópia da planilha vai para a pasta "' + r.pasta + '" do seu Google Drive (ficam as últimas ' + BACKUP_KEEP + ').\n\nO primeiro backup já foi feito: ' + r.nome + '\n' + r.url);
  });
}

function menuBackupAgora() {
  menu_(function () {
    var r = backupPlanilha();
    say_('Backup feito', r.nome + '\nPasta: ' + r.pasta + '\n' + r.url + (r.agendado ? '' : '\n\nO backup automático ainda não está ativo: use FORJA Admin › Ativar backup diário.'));
  });
}

function menuConfirmarEmailAluno() {
  menu_(function () {
    var email = ask_('Confirmar e-mail', 'Use quando o aluno comprovou por outro canal que o e-mail é dele.\n\nE-mail do aluno:');
    adminConfirmarEmailAluno(email);
    say_('FORJA', 'E-mail confirmado: ' + normEmail_(email) + '\nO aluno já pode usar o app.');
  });
}

/* ---------- Funções administrativas (também podem ser chamadas pelo editor) ---------- */
// Aceita o ID (GYM001), o código (FORJA-GYM-...) ou o nome exato da academia
function resolveAcademy_(v) {
  var text = String(v || '').trim();
  var ac = findAcademyBy_('id', text.toUpperCase()) || findAcademyBy_('codigo', text);
  if (!ac) {
    var byName = table_('academies').rows.filter(function (r) { return String(r.nome).trim().toLowerCase() === text.toLowerCase(); });
    if (byName.length > 1) fail_('invalid', 'Há mais de uma academia com esse nome. Use o ID:\n' + academyList_());
    ac = byName[0] || null;
  }
  if (!ac) fail_('invalid', 'Academia não encontrada: "' + text + '".\nAcademias cadastradas:\n' + academyList_());
  return ac;
}
function academyList_() {
  var rows = table_('academies').rows;
  if (!rows.length) return '(nenhuma academia cadastrada: use FORJA Admin › Criar academia)';
  return rows.map(function (r) { return '• ' + r.id + ' — ' + r.nome + ' (' + r.codigo + ')'; }).join('\n');
}

function adminCriarAcademia(nome, limite, opts) {
  opts = opts || {};
  nome = str_(nome, 80);
  if (!nome) fail_('invalid', 'Informe o nome da academia.');
  var lim = int_(limite, 1, 100000);
  if (!lim) fail_('invalid', 'Informe um limite de alunos válido.');
  var rows = table_('academies').rows;
  var n = rows.length + 1, id;
  do { id = 'GYM' + ('00' + n).slice(-3); n++; } while (rows.some(function (r) { return r.id === id; }));
  var codigo = normCode_(opts.codigo) || uniqueCode_('FORJA-GYM-');
  if (findAcademyBy_('codigo', codigo) || findPremiumCode_(codigo)) fail_('invalid', 'Esse código já está em uso.');
  if (opts.fim && !toDate_(opts.fim)) fail_('invalid', 'Data de término inválida. Use AAAA-MM-DD.');
  var stamp = now_();
  var ac = {
    id: id, nome: nome, codigo: codigo, status: 'ATIVA', plano: opts.plano || (lim + ' ALUNOS'), limiteAlunos: lim,
    criadoEm: stamp, inicioContrato: opts.inicio || day_(new Date()), fimContrato: opts.fim || '', statusContrato: 'ATIVO', atualizadoEm: stamp
  };
  insert_('academies', ac);
  return ac;
}

function adminCriarTreinador(nome, email, academiaId, papel) {
  nome = str_(nome, 60);
  email = normEmail_(email);
  if (!nome) fail_('invalid', 'Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail_('invalid', 'E-mail inválido.');
  if (findTrainerBy_('email', email)) fail_('invalid', 'Já existe um treinador com esse e-mail.');
  var acad = resolveAcademy_(academiaId);
  academiaId = acad.id;
  var senha = randomPassword_();
  var salt = Utilities.getUuid();
  var id = 't_' + shortId_();
  insert_('trainers', { id: id, nome: nome, email: email, hash: pwHash_(salt, senha), salt: salt, status: 'ATIVO', trocarSenha: 'SIM', criadoEm: now_() });
  adminVincularTreinador(email, academiaId, papel);
  return { id: id, nome: nome, email: email, senhaProvisoria: senha };
}

function adminVincularTreinador(email, academiaId, papel) {
  var t = findTrainerBy_('email', normEmail_(email));
  if (!t) fail_('invalid', 'Treinador não encontrado.');
  var ac = resolveAcademy_(academiaId);
  var role = ROLE_PERMISSIONS[up_(papel)] ? up_(papel) : 'TREINADOR';
  var link = table_('trainerAcademies').rows.filter(function (l) { return l.treinadorId === t.id && String(l.academiaId) === String(ac.id); })[0];
  if (link) patch_('trainerAcademies', link, { papel: role, status: 'ATIVO' });
  else insert_('trainerAcademies', { treinadorId: t.id, academiaId: ac.id, papel: role, status: 'ATIVO', criadoEm: now_() });
}

function adminRedefinirSenhaTreinador(email) {
  var t = findTrainerBy_('email', normEmail_(email));
  if (!t) fail_('invalid', 'Treinador não encontrado.');
  var senha = randomPassword_();
  var salt = Utilities.getUuid();
  patch_('trainers', t, { hash: pwHash_(salt, senha), salt: salt, trocarSenha: 'SIM' });
  return senha;
}

function adminCriarCodigoPremium(opts) {
  opts = opts || {};
  var codigo = normCode_(opts.codigo) || uniqueCode_('FORJA-PREM-');
  if (findPremiumCode_(codigo) || findAcademyBy_('codigo', codigo)) fail_('invalid', 'Esse código já existe.');
  if (opts.validoAte && !toDate_(opts.validoAte)) fail_('invalid', 'Data de validade inválida. Use AAAA-MM-DD.');
  var c = {
    codigo: codigo, status: 'ATIVO', diasPremium: int_(opts.dias, 0, 36500) || 0, validoAte: opts.validoAte || '',
    limiteUsos: int_(opts.limiteUsos, 0, 1e9) || 0, usos: 0, descricao: str_(opts.descricao, 120), criadoEm: now_()
  };
  insert_('premiumCodes', c);
  return c;
}

// Registra uma assinatura confirmada FORA do sistema (ou teste). Não é pagamento.
function adminRegistrarAssinatura(email, opts) {
  opts = opts || {};
  var u = findUserBy_('email', normEmail_(email));
  if (!u) fail_('invalid', 'Conta não encontrada: ' + email);
  var fim = opts.fim || day_(new Date(Date.now() + (opts.dias || 30) * 86400000));
  upsertSubscription_(u, { plano: opts.plano || 'MENSAL', status: 'ATIVA', inicio: day_(new Date()), renovacao: fim, fim: fim, origem: 'ADMIN', idExterno: 'admin-' + shortId_() });
  return { email: u.email, account: syncAccount_(u) };
}

function adminCancelarAssinatura(email) {
  var u = findUserBy_('email', normEmail_(email));
  if (!u) fail_('invalid', 'Conta não encontrada: ' + email);
  table_('subscriptions').rows.forEach(function (s) {
    if (s.userId === u.id && up_(s.status) === 'ATIVA') patch_('subscriptions', s, { status: 'CANCELADA', fim: now_(), atualizadoEm: now_() });
  });
  return syncAccount_(u);
}

function adminEncerrarVinculo(email, motivo) {
  var u = findUserBy_('email', normEmail_(email));
  if (!u) fail_('invalid', 'Conta não encontrada: ' + email);
  if (up_(u.statusVinculoAcademia) !== 'ATIVO') fail_('invalid', 'Essa conta não está vinculada a nenhuma academia.');
  endLink_(u, motivo || 'ENCERRADO_ADMIN');
  return syncAccount_(u);
}

// Confere APP_BASE_URL, o provedor e a cota, e envia um e-mail com o mesmo visual dos e-mails da conta
function adminTestarEmail(email) {
  email = normEmail_(email);
  if (!validEmail_(email)) fail_('invalid', 'E-mail inválido.');
  var cfg = mailConfig_();
  if (!validBaseUrl_(cfg.baseUrl)) fail_('invalid', 'Defina a propriedade APP_BASE_URL (Configurações do projeto › Propriedades do script) com o endereço público do app, começando com https://');
  if (!MAIL_PROVIDERS[cfg.provider]) fail_('invalid', 'EMAIL_PROVIDER desconhecido: ' + cfg.provider);
  deliverMail_(mailTemplate_({
    to: email, subject: 'Teste de envio — FORJA', preheader: 'Os e-mails do FORJA estão configurados.',
    title: 'Tudo certo por aqui', intro: 'Este é um e-mail de teste. Se ele chegou, a confirmação de e-mail e a recuperação de senha do FORJA vão chegar também.',
    button: 'Abrir o FORJA', link: cfg.baseUrl, note: 'O botão abre o endereço configurado em APP_BASE_URL.',
    footer: 'Enviado pelo menu FORJA Admin › Testar envio de e-mail.'
  }));
  return { email: email, link: cfg.baseUrl, restantes: MAIL_PROVIDERS[cfg.provider].remaining() };
}

// Suporte: confirma o e-mail de um aluno sem o link (ex.: o e-mail não chega e ele comprovou a identidade)
function adminConfirmarEmailAluno(email) {
  var u = accountByEmail_(email);
  if (!u) fail_('invalid', 'Conta não encontrada: ' + email);
  if (up_(u.emailVerificado) !== 'SIM') updateAccount_(u, verifiedChanges_());
  return u.email;
}

/* ==========================================================================
   Backup diário da planilha
   A planilha é o banco de dados: uma aba apagada sem querer apagaria contas e treinos.
   Todo dia uma cópia de todas as abas vai para a pasta BACKUP_FOLDER do Google Drive de quem
   é dono do script, guardando as últimas BACKUP_KEEP (as mais antigas vão para a lixeira).
   · A aba "sessoes" não entra: são chaves de acesso ativas; depois de restaurar, basta entrar de novo.
   · Copia com a trava das requisições: o backup nunca pega uma gravação do app pela metade.
   · Ative pelo menu FORJA Admin › Ativar backup diário. Se um backup falhar, o Google avisa por e-mail.
   ========================================================================== */
var BACKUP_FOLDER = 'FORJA — backups';
var BACKUP_KEEP = 30;
var BACKUP_HOUR = 3;

function backupPlanilha() {
  var ss = ss_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var name = 'FORJA backup ' + stamp;
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  var copy, abas = 0;
  try {
    copy = SpreadsheetApp.create(name);
    var blank = copy.getSheets()[0];
    blank.setName('_vazia_' + Date.now()); // a aba padrão da cópia não pode ter o nome de uma aba copiada
    ss.getSheets().forEach(function (sh) {
      if (sh.getName() === SHEETS.sessions.name) return;
      sh.copyTo(copy).setName(sh.getName());
      abas++;
    });
    copy.deleteSheet(blank);
  } catch (e) {
    if (copy) DriveApp.getFileById(copy.getId()).setTrashed(true); // backup pela metade não fica no Drive
    throw e;
  } finally {
    lock.releaseLock();
  }
  var folder = backupFolder_();
  DriveApp.getFileById(copy.getId()).moveTo(folder);
  pruneBackups_(folder);
  PropertiesService.getScriptProperties().setProperty('BACKUP_ULTIMO', new Date().toISOString());
  return { nome: name, url: copy.getUrl(), pasta: folder.getName(), abas: abas, agendado: backupTriggers_().length > 0 };
}

// Um acionador diário só (rodar de novo não duplica). Já faz o primeiro backup.
function ativarBackupDiario() {
  if (!backupTriggers_().length) ScriptApp.newTrigger('backupPlanilha').timeBased().everyDays(1).atHour(BACKUP_HOUR).create();
  return backupPlanilha();
}

function desativarBackupDiario() {
  backupTriggers_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function backupTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'backupPlanilha'; });
}

// A pasta é lembrada pelo id (BACKUP_FOLDER_ID): renomear ou mover a pasta não cria outra
function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* pasta apagada: cria outra */ }
  }
  var folder = DriveApp.createFolder(BACKUP_FOLDER);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

function pruneBackups_(folder) {
  var files = [];
  var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    var f = it.next();
    if (/^FORJA backup /.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
}

// Apenas para testar o fluxo 4 do LEIA-ME: cria a "Academia Teste" (50 alunos, código FORJA-GYM-TESTE)
function testeCriarAcademiaTeste() {
  REQ = {};
  ensureSchema_();
  var ac = findAcademyBy_('codigo', 'FORJA-GYM-TESTE') || adminCriarAcademia('Academia Teste', 50, { codigo: 'FORJA-GYM-TESTE', plano: '50 ALUNOS' });
  Logger.log('Academia Teste: id ' + ac.id + ' · código ' + ac.codigo + ' · limite ' + ac.limiteAlunos);
  return ac;
}

/* ==========================================================================
   Premium: cálculo a partir das fontes
   ========================================================================== */
function accountState_(u) {
  var academy = null, academyOk = false;
  if (u.academiaId && up_(u.statusVinculoAcademia) === 'ATIVO') {
    academy = findAcademyBy_('id', u.academiaId);
    academyOk = !!academy && academyStatus_(academy).ok;
  }
  var sub = activeSubscription_(u.id);
  var code = activeRedemption_(u.id);
  var admin = up_(u.premiumManual) === 'SIM';
  var origem = academyOk ? 'ACADEMIA' : sub ? 'ASSINATURA' : code ? 'CODIGO' : admin ? 'ADMIN' : 'NENHUMA';
  return {
    tipoConta: origem === 'NENHUMA' ? 'FREE' : 'PREMIUM',
    origemPremium: origem,
    statusPremium: origem === 'NENHUMA' ? 'INATIVO' : 'ATIVO',
    premium: { ativo: origem !== 'NENHUMA', origem: origem },
    academia: academy
      ? { vinculada: true, id: academy.id, nome: academy.nome, statusVinculo: 'ATIVO', premiumAtivo: academyOk, dataEntrada: iso_(u.dataEntradaAcademia) }
      : { vinculada: false, id: null },
    assinaturaIndividual: sub ? { status: up_(sub.status), plano: sub.plano, renovacao: iso_(sub.renovacao), fim: iso_(sub.fim), origem: sub.origem } : null,
    codigoPremium: code ? { codigo: code.codigo, ate: iso_(code.premiumAte) || null } : null
  };
}

// Recalcula e grava o espelho (tipoConta, origemPremium, statusPremium, plano)
function syncAccount_(u) {
  var st = accountState_(u);
  var plan = st.tipoConta === 'PREMIUM' ? 'premium' : 'free';
  var changes = { tipoConta: st.tipoConta, origemPremium: st.origemPremium, statusPremium: st.statusPremium, plano: plan };
  if (String(u.plano || 'free').toLowerCase() !== plan) changes.planoAtualizadoEm = now_();
  patch_('users', u, changes);
  return st;
}

function academyStatus_(ac) {
  if (up_(ac.status) !== 'ATIVA') return { ok: false, code: 'academy_inactive' };
  var sc = up_(ac.statusContrato);
  if (sc && sc !== 'ATIVO') return { ok: false, code: 'academy_contract' };
  if (!started_(ac.inicioContrato) || !stillValid_(ac.fimContrato)) return { ok: false, code: 'academy_contract' };
  return { ok: true };
}

// Assinatura válida: ATIVA dentro do prazo, ou CANCELADA com período já pago ainda correndo
function activeSubscription_(userId) {
  var best = null;
  table_('subscriptions').rows.forEach(function (s) {
    if (s.userId !== userId) return;
    var st = up_(s.status);
    var ok = (st === 'ATIVA' && stillValid_(s.fim)) || (st === 'CANCELADA' && s.fim && stillValid_(s.fim));
    if (ok && (!best || cmpDesc_(s.fim || '9999', best.fim || '9999') < 0)) best = s;
  });
  return best;
}

function activeRedemption_(userId) {
  var best = null;
  table_('redemptions').rows.forEach(function (r) {
    if (r.userId !== userId || !stillValid_(r.premiumAte)) return;
    if (!best || !r.premiumAte || (best.premiumAte && cmpDesc_(r.premiumAte, best.premiumAte) < 0)) best = r;
  });
  return best;
}

function upsertSubscription_(u, d) {
  var statuses = ['ATIVA', 'PENDENTE', 'CANCELADA', 'EXPIRADA', 'SUSPENSA'];
  var status = statuses.indexOf(up_(d.status)) >= 0 ? up_(d.status) : 'PENDENTE';
  var origem = str_(d.origem, 30).toUpperCase() || 'DESCONHECIDA';
  var idExterno = str_(d.idExterno, 120);
  var stamp = now_();
  var found = idExterno ? table_('subscriptions').rows.filter(function (s) { return s.userId === u.id && up_(s.origem) === origem && String(s.idExterno) === idExterno; })[0] : null;
  var row = {
    userId: u.id, plano: str_(d.plano, 30).toUpperCase() || 'MENSAL', status: status,
    inicio: d.inicio || (found ? found.inicio : stamp), renovacao: d.renovacao || '', fim: d.fim || '',
    origem: origem, idExterno: idExterno, atualizadoEm: stamp
  };
  if (found) { patch_('subscriptions', found, row); return found; }
  row.id = 'a_' + shortId_();
  row.criadoEm = stamp;
  insert_('subscriptions', row);
  return row;
}

/* ==========================================================================
   Academias e vínculos
   ========================================================================== */
function academyLimit_(ac) { return int_(ac.limiteAlunos, 0, 1e9) || 0; }

function activeStudentsCount_(academiaId) {
  return table_('links').rows.filter(function (l) { return String(l.academiaId) === String(academiaId) && up_(l.status) === 'ATIVO'; }).length;
}

function academyStudents_(academiaId) {
  return table_('users').rows.filter(function (u) {
    return String(u.academiaId) === String(academiaId) && up_(u.statusVinculoAcademia) === 'ATIVO';
  }).map(userObj_);
}

// Encerra o vínculo sem apagar o histórico e devolve ao aluno os treinos que o treinador montou
function endLink_(u, motivo) {
  var stamp = now_();
  table_('links').rows.forEach(function (l) {
    if (l.userId === u.id && String(l.academiaId) === String(u.academiaId) && up_(l.status) === 'ATIVO') {
      patch_('links', l, { status: 'INATIVO', dataSaida: stamp, motivoSaida: motivo });
    }
  });
  var academyName = u.academiaNome;
  patch_('users', u, { statusVinculoAcademia: 'INATIVO', academiaId: '', academiaNome: '', dataSaidaAcademia: stamp });
  releaseManaged_(u.id, academyName);
}

function academyPublic_(ac, count) {
  var st = academyStatus_(ac);
  var end = toDate_(ac.fimContrato);
  return {
    id: ac.id, nome: ac.nome, codigo: ac.codigo, plano: ac.plano, status: up_(ac.status),
    limite: academyLimit_(ac), alunos: count,
    contrato: {
      inicio: day_(ac.inicioContrato), fim: day_(ac.fimContrato), status: up_(ac.statusContrato) || 'ATIVO', valido: st.ok,
      diasRestantes: end ? Math.ceil((endOfDay_(end).getTime() - Date.now()) / 86400000) : null
    },
    criadoEm: iso_(ac.criadoEm)
  };
}

function academyAlerts_(ac, count, summaries) {
  var out = [];
  var limit = academyLimit_(ac);
  var pub = academyPublic_(ac, count);
  if (limit && count >= limit) out.push({ nivel: 'erro', texto: 'Limite de alunos atingido (' + count + ' / ' + limit + '). Novos alunos não conseguem entrar.' });
  else if (limit && count / limit >= 0.9) out.push({ nivel: 'aviso', texto: 'A academia está com ' + Math.round(count / limit * 100) + '% das vagas ocupadas.' });
  if (!pub.contrato.valido) out.push({ nivel: 'erro', texto: 'O contrato da academia não está válido. Os alunos perdem o Premium Academia.' });
  else if (pub.contrato.diasRestantes !== null && pub.contrato.diasRestantes <= 30) out.push({ nivel: 'aviso', texto: 'O contrato termina em ' + pub.contrato.diasRestantes + ' dia(s).' });
  var noWorkout = summaries.filter(function (s) { return !s.treinosGerenciados; }).length;
  if (noWorkout) out.push({ nivel: 'info', texto: noWorkout + (noWorkout === 1 ? ' aluno ainda não tem' : ' alunos ainda não têm') + ' treino montado pelo treinador.', acao: 'alunos?filtro=sem-treino' });
  var inactive = summaries.filter(function (s) { return s.status === 'INATIVO'; }).length;
  if (inactive) out.push({ nivel: 'info', texto: inactive + (inactive === 1 ? ' aluno sem usar' : ' alunos sem usar') + ' o app há mais de ' + ACTIVE_DAYS + ' dias.', acao: 'alunos?filtro=inativos' });
  var noBody = summaries.filter(function (s) { return !s.pesoAtual || !s.altura; }).length;
  if (noBody) out.push({ nivel: 'info', texto: noBody + (noBody === 1 ? ' aluno sem' : ' alunos sem') + ' peso ou altura cadastrados.', acao: 'alunos?filtro=sem-dados' });
  return out;
}

function academyLog_(academiaId, limit, userId) {
  var names = {};
  table_('users').rows.forEach(function (u) { names[u.id] = u.nome; });
  return table_('workoutLog').rows
    .filter(function (r) { return String(r.academiaId) === String(academiaId) && (!userId || r.userId === userId); })
    .sort(function (a, b) { return cmpDesc_(a.data, b.data); })
    .slice(0, limit)
    .map(function (r) {
      return { id: r.id, alunoId: r.userId, alunoNome: names[r.userId] || '', treinador: r.treinadorNome, data: iso_(r.data), treinoId: r.treinoId, treino: r.treinoNome, tipo: up_(r.tipo), detalhes: r.detalhes };
    });
}

// Entradas e saídas de alunos + alterações de treino, em ordem de data
function academyActivity_(academiaId, students, limit) {
  var names = {};
  table_('users').rows.forEach(function (u) { names[u.id] = u.nome; });
  var out = [];
  table_('links').rows.forEach(function (l) {
    if (String(l.academiaId) !== String(academiaId)) return;
    out.push({ tipo: 'ENTRADA', data: iso_(l.dataEntrada), texto: (names[l.userId] || 'Aluno') + ' entrou na academia', alunoId: l.userId });
    if (l.dataSaida) out.push({ tipo: 'SAIDA', data: iso_(l.dataSaida), texto: (names[l.userId] || 'Aluno') + ' saiu da academia', alunoId: l.userId });
  });
  academyLog_(academiaId, limit).forEach(function (r) {
    var verbo = { CRIAR: 'criou', EDITAR: 'alterou', ASSUMIR: 'assumiu', EXCLUIR: 'excluiu' }[r.tipo] || 'alterou';
    out.push({ tipo: 'TREINO', data: r.data, texto: r.treinador + ' ' + verbo + ' ' + r.treino + ' de ' + r.alunoNome, alunoId: r.alunoId });
  });
  return out.sort(function (a, b) { return cmpDesc_(a.data, b.data); }).slice(0, limit);
}

function studentSummary_(u, got) {
  var workouts = got && Array.isArray(got.data.workouts) ? got.data.workouts.filter(Boolean) : [];
  var sorted = workouts.slice().sort(byOrder_);
  var managed = sorted.filter(function (w) { return w.managed; });
  var current = managed[0] || sorted[0] || null;
  var lastWorkout = '';
  workouts.forEach(function (w) { if (cmpDesc_(w.updatedAt, lastWorkout) < 0) lastWorkout = w.updatedAt; });
  var lastAccess = iso_(u.ultimoAcesso);
  var lastSync = got ? got.stamp : '';
  var lastSeen = cmpDesc_(lastAccess, lastSync) < 0 ? lastAccess : lastSync;
  var active = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) <= ACTIVE_DAYS * 86400000;
  var peso = num_(u.pesoAtual), alt = num_(u.altura);
  var updated = [lastSeen, lastWorkout].sort(cmpDesc_)[0] || '';
  return {
    id: u.id, nome: u.nome, email: u.email, idade: age_(u),
    pesoAtual: validWeight_(peso) ? peso : null, altura: validHeight_(alt) ? alt : null, imc: bmi_(peso, alt),
    treinoAtual: current ? current.name : '', treinoAtualId: current ? current.id : '',
    treinos: workouts.length, treinosGerenciados: managed.length,
    status: active ? 'ATIVO' : 'INATIVO', ultimoAcesso: lastSeen || '', ultimaAtualizacao: updated,
    dataEntrada: iso_(u.dataEntradaAcademia)
  };
}

/* ==========================================================================
   Treinador: autenticação e contexto de permissão
   ========================================================================== */
function trainerAuth_(token) {
  var s = findSession_(token);
  if (!s || s.tipo !== 'treinador') fail_('invalid_session');
  var t = findTrainerBy_('id', s.userId);
  if (!t) fail_('invalid_session');
  if (up_(t.status) !== 'ATIVO') fail_('trainer_inactive');
  return t;
}

// Treinador autenticado + ativo + com acesso à academia + academia ativa + permissão
function trainerCtx_(req, perm) {
  var t = trainerAuth_(req.token);
  if (up_(t.trocarSenha) === 'SIM') fail_('password_change_required');
  var academiaId = String(req.academiaId || '');
  var link = table_('trainerAcademies').rows.filter(function (l) {
    return l.treinadorId === t.id && String(l.academiaId) === academiaId && up_(l.status) === 'ATIVO';
  })[0];
  if (!link) fail_('forbidden');
  var ac = findAcademyBy_('id', academiaId);
  if (!ac || up_(ac.status) !== 'ATIVA') fail_('academy_inactive');
  var role = ROLE_PERMISSIONS[up_(link.papel)] ? up_(link.papel) : 'TREINADOR';
  var perms = ROLE_PERMISSIONS[role];
  if (perm && perms.indexOf(perm) < 0) fail_('forbidden');
  return { trainer: t, academy: ac, role: role, perms: perms };
}

// O aluno precisa ter vínculo ATIVO com ESTA academia. Premium individual nunca aparece.
function studentOf_(ctx, userId) {
  var u = findUserBy_('id', String(userId || ''));
  if (!u || String(u.academiaId) !== String(ctx.academy.id) || up_(u.statusVinculoAcademia) !== 'ATIVO') fail_('student_not_found');
  return u;
}

function publicTrainer_(t) {
  var academies = [];
  table_('trainerAcademies').rows.forEach(function (l) {
    if (l.treinadorId !== t.id || up_(l.status) !== 'ATIVO') return;
    var ac = findAcademyBy_('id', l.academiaId);
    if (!ac || up_(ac.status) !== 'ATIVA') return;
    var role = ROLE_PERMISSIONS[up_(l.papel)] ? up_(l.papel) : 'TREINADOR';
    academies.push({ id: ac.id, nome: ac.nome, papel: role, permissoes: ROLE_PERMISSIONS[role], alunos: activeStudentsCount_(ac.id), limite: academyLimit_(ac) });
  });
  return { id: t.id, nome: t.nome, email: t.email, trocarSenha: up_(t.trocarSenha) === 'SIM', academias: academies };
}

/* ==========================================================================
   Treinos: mesclagem app × treinador (o JSON da aba "dados" continua sendo a única fonte)
   ========================================================================== */
function readWorkouts_(userId) {
  var got = readKeys_([userId], ['workouts'])[userId];
  return got && Array.isArray(got.data.workouts) ? got.data.workouts.filter(Boolean) : [];
}

// Regras:
//  · treino gerenciado no servidor → vale a versão do servidor (o treinador manda)
//  · treino marcado como gerenciado no app, mas que não é mais gerenciado no servidor →
//      se ainda existe (aluno saiu da academia) vale a do servidor; se foi excluído pelo treinador, some
//  · treino do aluno → vale o que o app enviou (exceto se o treinador o excluiu)
//  · treinos gerenciados que o app ainda não conhece entram no fim
function mergeWorkouts_(userId, incoming) {
  var current = readWorkouts_(userId);
  var server = {};
  current.forEach(function (w) { server[w.id] = w; });
  var deleted = {};
  table_('workoutLog').rows.forEach(function (r) { if (r.userId === userId && up_(r.tipo) === 'EXCLUIR') deleted[r.treinoId] = true; });
  var out = [], used = {};
  (Array.isArray(incoming) ? incoming : []).forEach(function (w) {
    if (!w || !w.id || used[w.id]) return;
    var s = server[w.id];
    if (s && s.managed) { out.push(s); used[w.id] = true; return; }
    if (w.managed) { if (s) { out.push(s); used[w.id] = true; } return; }
    if (deleted[w.id]) return;
    out.push(w);
    used[w.id] = true;
  });
  current.forEach(function (s) { if (s.managed && !used[s.id]) { out.push(s); used[s.id] = true; } });
  return out;
}

// Aluno saiu da academia: os treinos montados pelo treinador passam a ser dele
function releaseManaged_(userId, academyName) {
  var list = readWorkouts_(userId);
  var changed = false;
  list.forEach(function (w) {
    if (!w.managed) return;
    w.releasedFrom = { academiaName: academyName || (w.managedBy && w.managedBy.academiaName) || '', trainerName: w.managedBy ? w.managedBy.trainerName : '', at: now_() };
    delete w.managed;
    delete w.managedBy;
    w.updatedAt = now_();
    changed = true;
  });
  if (changed) writeKeys_(userId, { workouts: list });
}

function nextOrder_(list) {
  var max = -1;
  list.forEach(function (w) { if (typeof w.order === 'number' && w.order > max) max = w.order; });
  return max + 1;
}

function cleanWorkout_(w) {
  if (!w || typeof w !== 'object') fail_('invalid_workout');
  var name = str_(w.name, 40);
  if (!name) fail_('invalid_workout', 'Dê um nome ao treino.');
  var list = Array.isArray(w.exercises) ? w.exercises : [];
  if (list.length > 40) fail_('invalid_workout', 'Use até 40 exercícios por treino.');
  var ids = {};
  var items = list.map(function (x, i) {
    if (!x || typeof x !== 'object') fail_('invalid_workout');
    var exerciseId = String(x.exerciseId || '').trim();
    if (!/^[a-z0-9_-]{1,80}$/i.test(exerciseId)) fail_('invalid_workout', 'Exercício ' + (i + 1) + ' inválido.');
    var label = str_(x.name, 60) || exerciseId;
    var sets = int_(x.sets, 1, 10);
    var repMin = int_(x.repMin, 1, 50);
    var repMax = int_(x.repMax, 1, 60);
    if (!sets) fail_('invalid_workout', label + ': use de 1 a 10 séries.');
    if (!repMin || !repMax) fail_('invalid_workout', label + ': repetições inválidas.');
    if (repMax < repMin) fail_('invalid_workout', label + ': o máximo de repetições não pode ser menor que o mínimo.');
    var load = blank_(x.loadKg) ? null : dec_(x.loadKg, 0, 500);
    if (!blank_(x.loadKg) && load === null) fail_('invalid_workout', label + ': carga entre 0 e 500 kg.');
    var rest = blank_(x.restSec) ? null : int_(x.restSec, 0, 900);
    if (!blank_(x.restSec) && rest === null) fail_('invalid_workout', label + ': descanso entre 0 e 900 segundos.');
    var id = /^wx_[a-z0-9]{1,40}$/i.test(String(x.id || '')) && !ids[x.id] ? String(x.id) : 'wx_' + shortId_();
    ids[id] = true;
    return { id: id, exerciseId: exerciseId, name: label, muscle: str_(x.muscle, 30), sets: sets, repMin: repMin, repMax: repMax, group: null, loadKg: load, restSec: rest, notes: str_(x.notes, 200) };
  });
  return {
    name: name, description: str_(w.description, 120), muscleGroup: str_(w.muscleGroup, 60),
    color: WORKOUT_COLORS.indexOf(w.color) >= 0 ? w.color : WORKOUT_COLORS[0], exercises: items
  };
}

// Resumo legível do que mudou (vai para historico_treinos.detalhes)
function describeChanges_(before, after) {
  var scheme = function (x) { return x.sets + '×' + (x.repMin === x.repMax ? x.repMin : x.repMin + '-' + x.repMax); };
  if (!before) return ('Criado com ' + after.exercises.length + ' exercício(s): ' + after.exercises.map(function (x) { return x.name + ' ' + scheme(x); }).join(', ')).slice(0, 1000);
  var out = [];
  if (!before.managed) out.push('Treino do aluno assumido pelo treinador');
  if (before.name !== after.name) out.push('Nome: ' + before.name + ' → ' + after.name);
  if ((before.muscleGroup || '') !== after.muscleGroup) out.push('Grupo muscular: ' + (after.muscleGroup || '—'));
  if ((before.description || '') !== after.description) out.push('Descrição alterada');
  var old = {};
  (before.exercises || []).forEach(function (x) { old[x.id] = x; });
  var now = {};
  after.exercises.forEach(function (x) {
    now[x.id] = x;
    var b = old[x.id];
    if (!b) { out.push('+ ' + x.name + ' ' + scheme(x)); return; }
    var bits = [];
    if (b.exerciseId !== x.exerciseId) bits.push('trocado de ' + (b.name || b.exerciseId));
    if (scheme(b) !== scheme(x)) bits.push(scheme(b) + ' → ' + scheme(x));
    if ((b.loadKg == null ? null : Number(b.loadKg)) !== x.loadKg) bits.push('carga ' + (b.loadKg == null ? '—' : b.loadKg + ' kg') + ' → ' + (x.loadKg == null ? '—' : x.loadKg + ' kg'));
    if ((b.restSec == null ? null : Number(b.restSec)) !== x.restSec) bits.push('descanso ' + (x.restSec == null ? '—' : x.restSec + 's'));
    if ((b.notes || '') !== x.notes) bits.push('observação');
    if (bits.length) out.push(x.name + ': ' + bits.join(', '));
  });
  (before.exercises || []).forEach(function (x) { if (!now[x.id]) out.push('− ' + (x.name || x.exerciseId)); });
  var seqA = (before.exercises || []).map(function (x) { return x.id; }).filter(function (id) { return now[id]; });
  var seqB = after.exercises.map(function (x) { return x.id; }).filter(function (id) { return old[id]; });
  if (seqA.join() !== seqB.join()) out.push('Ordem dos exercícios alterada');
  return (out.join('; ') || 'Salvo sem alterações').slice(0, 1000);
}

function logWorkout_(ctx, u, w, tipo, detalhes) {
  insert_('workoutLog', {
    id: 'h_' + shortId_(), userId: u.id, treinadorId: ctx.trainer.id, treinadorNome: ctx.trainer.nome, academiaId: ctx.academy.id,
    data: now_(), treinoId: w.id, treinoNome: w.name, tipo: tipo, detalhes: detalhes
  });
}

/* ==========================================================================
   Peso, altura e idade (espelho do JSON do app em colunas + histórico de peso)
   ========================================================================== */
function mirrorBody_(user, out) {
  var need = [];
  if (!('profile' in out)) need.push('profile');
  if (!('bodyweight' in out)) need.push('bodyweight');
  var stored = need.length ? ((readKeys_([user.id], need)[user.id] || {}).data || {}) : {};
  var profile = ('profile' in out ? out.profile : stored.profile) || {};
  var bw = ('bodyweight' in out ? out.bodyweight : stored.bodyweight) || [];
  if ('bodyweight' in out) syncWeightHistory_(user.id, bw, 'APP');
  var latest = null;
  (Array.isArray(bw) ? bw : []).forEach(function (e) { if (e && validWeight_(e.kg) && (!latest || cmpDesc_(e.date, latest.date) < 0)) latest = e; });
  var peso = latest ? Number(latest.kg) : num_(profile.weightKg);
  var birth = /^\d{4}-\d{2}-\d{2}$/.test(String(profile.birthDate || '')) ? profile.birthDate : '';
  patch_('users', user, {
    pesoAtual: validWeight_(peso) ? round_(peso, 1) : '',
    altura: validHeight_(profile.heightCm) ? Math.round(Number(profile.heightCm)) : '',
    dataNascimento: birth,
    // Idade digitada à mão (só quando não há data de nascimento; com data, ela é calculada)
    idade: !birth && int_(profile.age, 10, 120) ? int_(profile.age, 10, 120) : ''
  });
}

// Uma linha por pesagem. Nada é sobrescrito com outra data; pesagens apagadas no app ficam REMOVIDO.
function syncWeightHistory_(userId, list, origem) {
  var mine = {};
  table_('weights').rows.forEach(function (r) { if (r.userId === userId) mine[r.id] = r; });
  var seen = {}, inserts = [];
  (Array.isArray(list) ? list : []).forEach(function (e) {
    if (!e || !e.id || !validWeight_(e.kg)) return;
    seen[e.id] = true;
    var kg = round_(Number(e.kg), 2);
    var r = mine[e.id];
    if (!r) inserts.push({ id: e.id, userId: userId, data: iso_(e.date), pesoKg: kg, origem: origem, status: 'ATIVO', registradoEm: now_() });
    else if (Number(r.pesoKg) !== kg || up_(r.status) !== 'ATIVO') patch_('weights', r, { pesoKg: kg, status: 'ATIVO' });
  });
  Object.keys(mine).forEach(function (id) { if (!seen[id] && up_(mine[id].status) === 'ATIVO') patch_('weights', mine[id], { status: 'REMOVIDO' }); });
  insertMany_('weights', inserts);
}

function weightsByUser_(userIds) {
  var set = {};
  userIds.forEach(function (id) { set[id] = []; });
  table_('weights').rows.forEach(function (r) {
    if (set[r.userId] && up_(r.status) === 'ATIVO') set[r.userId].push({ data: iso_(r.data), pesoKg: round_(Number(r.pesoKg), 1) });
  });
  Object.keys(set).forEach(function (id) { set[id].sort(function (a, b) { return cmpAsc_(a.data, b.data); }); });
  return set;
}

function age_(u) {
  var b = toDate_(u.dataNascimento);
  if (b) {
    var n = new Date();
    var a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  return int_(u.idade, 10, 120);
}
// IMC é sempre calculado, nunca gravado
function bmi_(kg, cm) { return validWeight_(kg) && validHeight_(cm) ? round_(kg / Math.pow(cm / 100, 2), 1) : null; }
function validWeight_(kg) { var n = Number(kg); return isFinite(n) && n >= 25 && n <= 350; }
function validHeight_(cm) { var n = Number(cm); return isFinite(n) && n >= 100 && n <= 250; }

/* ==========================================================================
   Aba "dados" (JSON por chave)
   ========================================================================== */
function dataValues_() {
  if (!REQ.dataValues) REQ.dataValues = sheet_('data').getDataRange().getValues();
  return REQ.dataValues;
}

// { userId: { data: { chave: valor }, stamp: último atualizadoEm } }
function readKeys_(userIds, keys) {
  var wanted = {};
  userIds.forEach(function (id) { wanted[id] = true; });
  var values = dataValues_();
  var parts = {}, stamps = {};
  for (var i = 1; i < values.length; i++) {
    var uid = values[i][0];
    if (!wanted[uid]) continue;
    var stamp = iso_(values[i][4]);
    if (cmpDesc_(stamp, stamps[uid] || '') < 0) stamps[uid] = stamp;
    var key = values[i][1];
    if (keys && keys.indexOf(key) < 0) continue;
    var u = parts[uid] = parts[uid] || {};
    (u[key] = u[key] || [])[values[i][2]] = values[i][3];
  }
  var out = {};
  Object.keys(stamps).forEach(function (uid) {
    var data = {};
    Object.keys(parts[uid] || {}).forEach(function (k) {
      try { data[k] = JSON.parse(parts[uid][k].join('')); } catch (e) { /* chave corrompida: ignora */ }
    });
    out[uid] = { data: data, stamp: stamps[uid] || '' };
  });
  return out;
}

function writeKeys_(userId, data) {
  var keys = Object.keys(data);
  if (!keys.length) return 0;
  removeRows_(userId, keys);
  var rows = [];
  var stamp = now_();
  keys.forEach(function (k) {
    var text = JSON.stringify(data[k] === undefined ? null : data[k]);
    for (var p = 0, i = 0; i < text.length || p === 0; i += CHUNK, p++) rows.push([userId, k, p, text.slice(i, i + CHUNK), stamp]);
  });
  var sh = sheet_('data');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  delete REQ.dataValues;
  return keys.length;
}

// Remove as linhas de dados da conta (todas, ou só das chaves indicadas)
function removeRows_(userId, keys) {
  var sh = sheet_('data');
  var values = sh.getDataRange().getValues();
  var keep = [values[0]];
  var removed = 0;
  for (var i = 1; i < values.length; i++) {
    var match = values[i][0] === userId && (!keys || keys.indexOf(values[i][1]) >= 0);
    if (match) removed++; else keep.push(values[i]);
  }
  delete REQ.dataValues;
  if (!removed) return;
  // Reescreve a aba de uma vez (bem mais rápido que apagar linha por linha)
  sh.getRange(1, 1, values.length, values[0].length).clearContent();
  sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
}

/* ==========================================================================
   Tabelas por nome de coluna (a ordem das colunas na planilha pode variar)
   ========================================================================== */
function sheet_(which) {
  var def = SHEETS[which];
  var sh = ss_().getSheetByName(def.name);
  if (!sh) { setup(); sh = ss_().getSheetByName(def.name); }
  return sh;
}

function table_(which) {
  if (REQ[which]) return REQ[which];
  var sh = sheet_(which);
  var values = sh.getDataRange().getValues();
  var header = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], o = { _row: i + 1 }, empty = true;
    for (var j = 0; j < header.length; j++) {
      if (!header[j]) continue;
      o[header[j]] = r[j];
      if (r[j] !== '' && r[j] !== null) empty = false;
    }
    if (!empty) rows.push(o);
  }
  REQ[which] = { sh: sh, header: header, rows: rows };
  return REQ[which];
}

// Texto começando com = + - @ viraria fórmula na planilha
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function insert_(which, obj) { insertMany_(which, [obj]); }

function insertMany_(which, objs) {
  if (!objs.length) return;
  var t = table_(which);
  var rows = objs.map(function (o) { return t.header.map(function (h) { return h ? cell_(o[h]) : ''; }); });
  t.sh.getRange(t.sh.getLastRow() + 1, 1, rows.length, t.header.length).setValues(rows);
  delete REQ[which];
}

function patch_(which, rowObj, changes) {
  var t = table_(which);
  var range = t.sh.getRange(rowObj._row, 1, 1, t.header.length);
  var values = range.getValues()[0];
  var changed = false;
  Object.keys(changes).forEach(function (k) {
    var j = t.header.indexOf(k);
    if (j < 0) return;
    var v = changes[k] === null || changes[k] === undefined ? '' : changes[k];
    if (String(values[j]) !== String(v)) { values[j] = cell_(v); changed = true; }
    rowObj[k] = v;
  });
  // A linha inteira é regravada: os textos que já estavam lá também precisam do apóstrofo (senão, um nome
  // como "=Ana" ou "+Forte" vira fórmula na próxima gravação)
  if (changed) range.setValues([values.map(cell_)]);
}

function userObj_(r) { r.name = r.nome; r.plan = String(r.plano || 'free').toLowerCase(); r.createdAt = r.criadoEm; return r; }

function findUserBy_(field, value) {
  var col = field === 'email' ? 'email' : 'id';
  var rows = table_('users').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][col]).trim() === String(value)) return userObj_(rows[i]);
  return null;
}
function findTrainerBy_(field, value) {
  var rows = table_('trainers').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]).trim().toLowerCase() === String(value).trim().toLowerCase()) return rows[i];
  return null;
}
function findAcademyBy_(field, value) {
  var v = field === 'codigo' ? normCode_(value) : String(value || '').trim();
  if (!v) return null;
  var rows = table_('academies').rows;
  for (var i = 0; i < rows.length; i++) {
    var c = field === 'codigo' ? normCode_(rows[i].codigo) : String(rows[i][field]).trim();
    if (c === v) return rows[i];
  }
  return null;
}
function findPremiumCode_(code) {
  var rows = table_('premiumCodes').rows;
  for (var i = 0; i < rows.length; i++) if (normCode_(rows[i].codigo) === code) return rows[i];
  return null;
}
function findSession_(token) {
  if (!token) return null;
  var rows = table_('sessions').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].token === token) {
      if (new Date(rows[i].expiraEm).getTime() < Date.now()) return null;
      return rows[i];
    }
  }
  return null;
}

/* ---------- Sessões e senhas ---------- */
function publicUser_(u, state) {
  state = state || accountState_(u);
  return { id: u.id, email: u.email, name: u.nome, plan: state.tipoConta === 'PREMIUM' ? 'premium' : 'free', createdAt: iso_(u.criadoEm), emailVerified: emailVerified_(u), account: state };
}

function newSession_(userId, tipo) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var ms = tipo === 'treinador' ? TRAINER_SESSION_HOURS * 3600000 : SESSION_DAYS * 86400000;
  insert_('sessions', { token: token, userId: userId, criadoEm: now_(), expiraEm: new Date(Date.now() + ms).toISOString(), tipo: tipo });
  return token;
}

// Sessão de aluno (sessões antigas não têm tipo; token de treinador não serve aqui).
// Conta com e-mail ainda não confirmado só passa nas ações da tela "Confirme seu e-mail" (allowUnverified).
function auth_(token, allowUnverified) {
  var s = findSession_(token);
  if (!s || s.tipo === 'treinador') fail_('invalid_session');
  var user = findUserBy_('id', s.userId);
  if (!user) fail_('invalid_session');
  if (up_(user.statusUsuario) === 'BLOQUEADO') fail_('account_blocked');
  if (!allowUnverified && !emailVerified_(user)) fail_('email_not_verified');
  return user;
}

// Só NAO bloqueia. Vazio vale como LEGADO (linha anterior à atualização ou criada à mão na planilha).
function emailVerified_(u) {
  var v = up_(u.emailVerificado);
  return v !== 'NAO' && v !== 'NÃO';
}

// Último acesso (grava no máximo uma vez por hora, para poupar a planilha)
function touch_(u, force) {
  var last = toDate_(u.ultimoAcesso);
  if (force || !last || Date.now() - last.getTime() > 3600000) patch_('users', u, { ultimoAcesso: now_() });
}

// v1: HMAC-SHA256 iterado, com salt por conta e "pimenta" nas propriedades do script
function pwHash_(salt, password) {
  var key = Utilities.newBlob(pepper_()).getBytes();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt + ':' + password).getBytes(), key);
  for (var i = 1; i < PW_ITERATIONS; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return 'v1$' + PW_ITERATIONS + '$' + hex_(h);
}
function pepper_() {
  var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  if (!pepper) { setup(); pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER'); }
  return pepper;
}
// Hash antigo das contas (SHA-256 com salt), anterior ao formato v1
function legacyHash_(salt, password) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8));
}
// Confere a senha; contas com hash antigo são migradas para v1 no primeiro login certo
function checkPassword_(which, row, password) {
  var stored = String(row.hash || '');
  if (/^v1\$/.test(stored)) return safeEqual_(pwHash_(row.salt, password), stored);
  if (!safeEqual_(legacyHash_(row.salt, password), stored)) return false;
  patch_(which, row, { hash: pwHash_(row.salt, password) });
  return true;
}

// Bloqueio temporário depois de várias senhas erradas
function checkAttempts_(kind, email) {
  var n = Number(CacheService.getScriptCache().get('fail:' + kind + ':' + email) || 0);
  if (n >= LOGIN_MAX_FAILS) fail_('too_many_attempts');
}
function registerFail_(kind, email) {
  var c = CacheService.getScriptCache();
  var k = 'fail:' + kind + ':' + email;
  c.put(k, String(Number(c.get(k) || 0) + 1), LOGIN_LOCK_SECONDS);
}
function clearFails_(kind, email) { CacheService.getScriptCache().remove('fail:' + kind + ':' + email); }

/* ==========================================================================
   Links do e-mail (confirmação e nova senha)
   · Token: 2 UUID v4 (SecureRandom) = 64 caracteres hex, 244 bits aleatórios.
   · Na planilha fica só HMAC-SHA256(PASSWORD_PEPPER, tipo:token) e a validade. Gerar um link
     novo sobrescreve o anterior; usar o link apaga o hash. Cada link vale uma vez só.
   ========================================================================== */
var LINK_TOKENS = {
  verify: { hash: 'tokenVerificacaoEmailHash', expira: 'tokenVerificacaoEmailExpira', ms: VERIFY_TOKEN_HOURS * 3600000, route: 'confirmar-email' },
  reset: { hash: 'tokenResetSenhaHash', expira: 'tokenResetSenhaExpira', ms: RESET_TOKEN_MINUTES * 60000, route: 'redefinir-senha' }
};

// Grava o hash de um token novo e devolve o link completo (só ele carrega o token puro)
function issueLinkToken_(u, kind) {
  var def = LINK_TOKENS[kind];
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
  var changes = {};
  changes[def.hash] = linkTokenHash_(kind, token);
  changes[def.expira] = new Date(Date.now() + def.ms).toISOString();
  updateAccount_(u, changes);
  return mailConfig_().baseUrl + '#/' + def.route + '/' + token;
}

function linkTokenHash_(kind, token) {
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(kind + ':' + token).getBytes(), Utilities.newBlob(pepper_()).getBytes());
  return 'v1$' + hex_(h);
}

// Confere o link: existe e confere com o hash · não venceu · a conta existe e não está bloqueada
function userForLink_(kind, linkToken) {
  var u = accountByLinkToken_(kind, linkToken);
  if (!u) fail_('token_invalid');
  var until = toDate_(u[LINK_TOKENS[kind].expira]);
  if (!until || until.getTime() <= Date.now()) fail_('token_expired');
  if (up_(u.statusUsuario) === 'BLOQUEADO') fail_('account_blocked');
  return u;
}

function verifiedChanges_() {
  return { emailVerificado: 'SIM', dataVerificacaoEmail: now_(), tokenVerificacaoEmailHash: '', tokenVerificacaoEmailExpira: '' };
}

// Gera o link (o anterior deixa de valer) e agenda o e-mail. report: a resposta leva emailSent.
function sendAccountEmail_(kind, u, report) {
  var link = issueLinkToken_(u, kind);
  var to = u.email;
  queueMail_(function () {
    if (kind === 'verify') sendVerificationEmail_(to, link);
    else sendPasswordResetEmail_(to, link);
  }, report);
}

// No máximo 1 e-mail a cada MAIL_COOLDOWN_SECONDS e MAIL_MAX_PER_HOUR por hora, por chave (conta ou endereço)
function throttleMail_(key, skipCooldown) {
  var cache = CacheService.getScriptCache();
  var k = 'mail:' + key;
  var st = {};
  try { st = JSON.parse(cache.get(k) || '{}'); } catch (e) { st = {}; }
  var nowMs = Date.now();
  var count = Number(st.count) || 0;
  if ((!skipCooldown && st.last && nowMs - st.last < MAIL_COOLDOWN_SECONDS * 1000) || count >= MAIL_MAX_PER_HOUR) fail_('resend_too_soon');
  cache.put(k, JSON.stringify({ last: nowMs, count: count + 1 }), 3600);
}

/* ==========================================================================
   E-mails da conta
   O resto do sistema só chama sendVerificationEmail_() e sendPasswordResetEmail_().
   Quem entrega é o provedor da propriedade EMAIL_PROVIDER (padrão: MAILAPP, a cota do próprio Google).
   Para usar Resend, SendGrid, Amazon SES...: acrescente um adaptador em MAIL_PROVIDERS com
   remaining() e send(mensagem, config) — veja backend/LEIA-ME.md — e mude EMAIL_PROVIDER.
   ========================================================================== */
var MAIL_PROVIDERS = {
  MAILAPP: {
    remaining: function () { return MailApp.getRemainingDailyQuota(); },
    send: function (m, cfg) {
      var opts = { to: m.to, subject: m.subject, htmlBody: m.html, body: m.text, name: 'FORJA' };
      if (cfg.replyTo) opts.replyTo = cfg.replyTo;
      MailApp.sendEmail(opts);
    }
  }
};

function mailConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    provider: up_(p.getProperty('EMAIL_PROVIDER')) || 'MAILAPP',
    baseUrl: String(p.getProperty('APP_BASE_URL') || '').trim().replace(/#.*$/, ''),
    replyTo: normEmail_(p.getProperty('EMAIL_REPLY_TO'))
  };
}

// Os links nunca usam um endereço mandado pelo app: um link forjado levaria o token para outro site
function validBaseUrl_(url) {
  return /^https:\/\/[^\s#]+$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s#]*)?$/i.test(url);
}

// Antes de gerar qualquer link: endereço do app configurado, provedor conhecido e cota do dia
function mailReady_() {
  var cfg = mailConfig_();
  var provider = MAIL_PROVIDERS[cfg.provider];
  var problem = !validBaseUrl_(cfg.baseUrl) ? 'APP_BASE_URL ausente ou inválida'
    : !provider ? 'EMAIL_PROVIDER desconhecido: ' + cfg.provider
    : provider.remaining() < 1 ? 'cota diária de e-mails esgotada' : '';
  if (problem) { console.error('FORJA e-mail: ' + problem); fail_('email_unavailable'); }
}

function deliverMail_(m) {
  var cfg = mailConfig_();
  var provider = MAIL_PROVIDERS[cfg.provider];
  if (!provider) throw new Error('EMAIL_PROVIDER desconhecido: ' + cfg.provider);
  provider.send(m, cfg);
}

function sendVerificationEmail_(to, link) {
  deliverMail_(mailTemplate_({
    to: to, subject: 'Confirme seu e-mail — FORJA',
    preheader: 'Confirme seu endereço de e-mail para ativar sua conta no FORJA.',
    title: 'Confirme seu e-mail',
    intro: 'Falta só um passo para ativar sua conta no FORJA. Toque no botão abaixo para confirmar que este endereço é seu.',
    button: 'Confirmar meu e-mail', link: link,
    note: 'O link vale por ' + VERIFY_TOKEN_HOURS + ' horas e só pode ser usado uma vez.',
    footer: 'Se você não criou uma conta no FORJA, pode ignorar este e-mail com segurança.'
  }));
}

function sendPasswordResetEmail_(to, link) {
  deliverMail_(mailTemplate_({
    to: to, subject: 'Redefina sua senha — FORJA',
    preheader: 'Recebemos um pedido para redefinir a senha da sua conta.',
    title: 'Redefina sua senha',
    intro: 'Recebemos um pedido para redefinir a senha da sua conta no FORJA. Toque no botão abaixo para criar uma nova senha.',
    button: 'Criar nova senha', link: link,
    note: 'O link vale por ' + RESET_TOKEN_MINUTES + ' minutos e só pode ser usado uma vez. Ao trocar a senha, você sai da conta em todos os aparelhos.',
    footer: 'Se você não pediu para redefinir a senha, ignore este e-mail. Sua senha atual continua valendo.'
  }));
}

// Mesmo visual do app: fundo agrupado do iOS, cartão branco, botão em cápsula laranja com texto preto.
// Sem nome do usuário: quem cadastra pode digitar o e-mail de outra pessoa.
function mailTemplate_(o) {
  var font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  var url = html_(o.link);
  var html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">' +
    '<title>' + html_(o.subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#F2F2F7;-webkit-text-size-adjust:100%;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + html_(o.preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F2F7;">' +
    '<tr><td align="center" style="padding:40px 16px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">' +
    '<tr><td style="padding:0 4px 18px;font-family:' + font + ';font-size:13px;font-weight:800;letter-spacing:0.22em;color:#BF5A00;">FORJA</td></tr>' +
    '<tr><td style="background:#FFFFFF;border-radius:22px;padding:36px 28px 32px;">' +
    '<h1 style="margin:0 0 12px;font-family:' + font + ';font-size:26px;line-height:1.2;font-weight:700;color:#000000;">' + html_(o.title) + '</h1>' +
    '<p style="margin:0 0 28px;font-family:' + font + ';font-size:16px;line-height:1.5;color:#3C3C43;">' + html_(o.intro) + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="center" bgcolor="#FF9F0A" style="border-radius:9999px;">' +
    '<a href="' + url + '" target="_blank" style="display:block;padding:16px 24px;font-family:' + font + ';font-size:17px;font-weight:600;color:#000000;text-decoration:none;border-radius:9999px;">' + html_(o.button) + '</a>' +
    '</td></tr></table>' +
    '<p style="margin:24px 0 0;font-family:' + font + ';font-size:14px;line-height:1.5;color:#6D6D72;">' + html_(o.note) + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:24px 4px 0;font-family:' + font + ';font-size:12px;line-height:1.6;color:#8E8E93;">' +
    'Se o botão não funcionar, copie este endereço e cole no navegador:<br>' +
    '<a href="' + url + '" target="_blank" style="color:#BF5A00;word-break:break-all;">' + url + '</a>' +
    '<br><br>' + html_(o.footer) +
    '</td></tr></table></td></tr></table></body></html>';
  var text = [o.title, '', o.intro, '', o.button + ': ' + o.link, '', o.note, '', o.footer, '', '— FORJA'].join('\n');
  return { to: o.to, subject: o.subject, html: html, text: text };
}

// Os e-mails da requisição saem em doPost, depois que a trava é liberada
function queueMail_(fn, report) { OUTBOX.push({ fn: fn, report: !!report }); }
function flushOutbox_(out) {
  var jobs = OUTBOX;
  OUTBOX = [];
  jobs.forEach(function (job) {
    var ok = true;
    try { job.fn(); } catch (e) { ok = false; console.error('FORJA e-mail não enviado: ' + (e && e.message || e)); }
    if (job.report && out && out.ok) out.emailSent = ok;
  });
}
// "Esqueci minha senha" sem conta: espera o tempo de um envio, para a demora não denunciar se a conta existe
function padTiming_() { Utilities.sleep(400 + Math.floor(Math.random() * 500)); }

/* ==========================================================================
   Contas de aluno — camada de dados da confirmação de e-mail e da nova senha
   Essas regras só leem e gravam contas e sessões por aqui. Numa migração para
   outro banco (PostgreSQL, Supabase...), é esta seção que muda; as ações não.
   ========================================================================== */
function accountByEmail_(email) { return findUserBy_('email', normEmail_(email)); }

function accountByLinkToken_(kind, linkToken) {
  var token = String(linkToken || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  var field = LINK_TOKENS[kind].hash;
  var hash = linkTokenHash_(kind, token);
  var rows = table_('users').rows;
  for (var i = 0; i < rows.length; i++) if (rows[i][field] && safeEqual_(String(rows[i][field]), hash)) return userObj_(rows[i]);
  return null;
}

function createAccount_(row) {
  insert_('users', row);
  return findUserBy_('id', row.id);
}

function updateAccount_(u, changes) { patch_('users', u, changes); }

// Sai de todos os aparelhos (depois da nova senha), menos a sessão keepToken se vier.
// Só sessões de aluno: as de treinador não mudam.
function endStudentSessions_(userId, keepToken) {
  var t = table_('sessions');
  var mine = t.rows.filter(function (s) { return s.userId === userId && s.tipo !== 'treinador' && (!keepToken || s.token !== keepToken); });
  mine.sort(function (a, b) { return b._row - a._row; }).forEach(function (s) { t.sh.deleteRow(s._row); });
  delete REQ.sessions;
  return mine.length;
}

// Treinos, histórico, pesos e dados do corpo da conta (aba dados, historico_peso e as colunas de
// peso, altura e nascimento). Usado por "Apagar todos os dados" e por "Excluir minha conta".
function eraseTrainingData_(u) {
  removeRows_(u.id, null);
  removeWhere_('weights', function (r) { return r.userId === u.id; });
  updateAccount_(u, { pesoAtual: '', altura: '', dataNascimento: '', idade: '' });
}

// Exclui a conta de vez: libera a vaga na academia, apaga dados, histórico de treinos montados pelo
// treinador, sessões e, por último, a linha da conta (se algo falhar no meio, dá para tentar de novo).
// Ficam só registros sem nenhum dado pessoal, ligados a um id que não existe mais: vínculos antigos,
// resgates de código (contagem de usos) e assinaturas (registro de pagamento).
function deleteAccount_(u) {
  var stamp = now_();
  table_('links').rows.forEach(function (l) {
    if (l.userId === u.id && up_(l.status) === 'ATIVO') patch_('links', l, { status: 'INATIVO', dataSaida: stamp, motivoSaida: 'CONTA_EXCLUIDA' });
  });
  eraseTrainingData_(u);
  removeWhere_('workoutLog', function (r) { return r.userId === u.id; });
  removeWhere_('sessions', function (r) { return r.userId === u.id && r.tipo !== 'treinador'; });
  removeWhere_('users', function (r) { return r.id === u.id; });
}

// Remove as linhas em que fn(linha) é verdadeiro, reescrevendo a aba de uma vez (como removeRows_).
// Os textos passam de novo por cell_: um texto começando com = + - @ não pode virar fórmula.
function removeWhere_(which, fn) {
  var t = table_(which);
  var drop = {};
  var n = 0;
  t.rows.forEach(function (r) { if (fn(r)) { drop[r._row] = true; n++; } });
  if (!n) return 0;
  var values = t.sh.getDataRange().getValues();
  var keep = values.filter(function (row, i) { return !drop[i + 1]; })
    .map(function (row, i) { return i === 0 ? row : row.map(cell_); });
  t.sh.getRange(1, 1, values.length, values[0].length).clearContent();
  t.sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  delete REQ[which];
  return n;
}

// Contas criadas antes da confirmação de e-mail continuam entrando normalmente: LEGADO.
// Uma gravação só, na coluna inteira; linhas vazias da planilha não são tocadas.
function migrateEmailVerification_() {
  var t = table_('users');
  var col = t.header.indexOf('emailVerificado');
  var todo = t.rows.filter(function (u) { return (u.id || u.email) && blank_(u.emailVerificado); });
  if (col < 0 || !todo.length) return 0;
  var range = t.sh.getRange(2, col + 1, t.sh.getLastRow() - 1, 1);
  var values = range.getValues();
  todo.forEach(function (u) { values[u._row - 2][0] = 'LEGADO'; u.emailVerificado = 'LEGADO'; });
  range.setValues(values);
  delete REQ.users;
  return todo.length;
}

/* ---------- Auxiliares ---------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code, message) { var e = new Error(message || code); e.code = code; e.userMessage = message; throw e; }
function now_() { return new Date().toISOString(); }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function validEmail_(e) { return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
// g•••r@gmail.com: o suficiente para a pessoa reconhecer o próprio e-mail
function maskEmail_(e) {
  var parts = String(e || '').split('@');
  var local = parts[0] || '';
  var shown = local.length <= 2 ? local.charAt(0) + '•' : local.charAt(0) + '•••' + local.charAt(local.length - 1);
  return parts.length > 1 ? shown + '@' + parts.slice(1).join('@') : shown;
}
function html_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function normCode_(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }
function up_(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function str_(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max); }
function blank_(v) { return v === null || v === undefined || String(v).trim() === ''; }
function num_(v) { if (blank_(v)) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
function int_(v, min, max) { var n = num_(v); if (n === null || Math.round(n) !== n || n < min || n > max) return null; return n; }
function dec_(v, min, max) { var n = num_(v); if (n === null || n < min || n > max) return null; return round_(n, 2); }
function round_(n, d) { var f = Math.pow(10, d || 0); return Math.round(n * f) / f; }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function shortId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function byOrder_(a, b) { return (a.order || 0) - (b.order || 0); }
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Aceita Date, 'AAAA-MM-DD', 'DD/MM/AAAA' e ISO
function toDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function endOfDay_(d) { var x = new Date(d.getTime()); x.setHours(23, 59, 59, 999); return x; }
function isDateOnly_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
  return /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/.test(String(v).trim());
}
// Vazio = sem prazo. Datas sem hora valem até o fim do dia.
function stillValid_(v) {
  var d = toDate_(v);
  if (!d) return true;
  return (isDateOnly_(v) ? endOfDay_(d) : d).getTime() >= Date.now();
}
function started_(v) { var d = toDate_(v); return !d || d.getTime() <= Date.now(); }
function iso_(v) { var d = toDate_(v); return d ? d.toISOString() : ''; }
function day_(v) { var d = toDate_(v); return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; }
function cmpDesc_(a, b) { var x = toDate_(a), y = toDate_(b); return (y ? y.getTime() : 0) - (x ? x.getTime() : 0); }
function cmpAsc_(a, b) { return -cmpDesc_(a, b); }

// Códigos legíveis, sem letras que confundem (0/O, 1/I)
function randomChars_(n) {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var s = '';
  for (var i = 0; i < n; i++) s += abc[(bytes[i] & 0xff) % abc.length];
  return s;
}
function uniqueCode_(prefix) {
  var code;
  do { code = prefix + randomChars_(6); } while (findAcademyBy_('codigo', code) || findPremiumCode_(code));
  return code;
}
function randomPassword_() { return randomChars_(4) + '-' + randomChars_(4) + '-' + randomChars_(4); }
