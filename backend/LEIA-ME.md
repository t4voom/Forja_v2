# FORJA com Google Planilhas

O Google Planilhas é o banco de dados do FORJA. O app (celular) e o **FORJA Trainer** (Dashboard web das academias) falam com o mesmo Apps Script, que valida tudo antes de gravar.

```
FORJA (celular)          ┐                ┌─────────────────────────┐     ┌──────────────────────┐
 localStorage = cache    ├── POST JSON ──►│ Apps Script (Code.gs)   │ ──► │ Planilha             │
FORJA Trainer (web)      ┘                │ autentica, autoriza,    │     │ usuarios · dados ... │
 /trainer                                 │ valida e grava          │     │ academias · treinos  │
                                          └─────────────────────────┘     └──────────────────────┘
```

- O app continua lendo e gravando no localStorage (rápido e funciona offline) e envia cada alteração para a planilha ~2,5 s depois.
- **O localStorage nunca é a fonte da verdade** para Premium, academia, permissões, assinatura ou limite de alunos: a cada abertura o app pergunta ao servidor (`me`) e usa a resposta.
- Ao abrir o app e ao voltar para ele (no máximo 1× por minuto), o app baixa os treinos (`pull`), e o que o treinador salvou aparece.
- Senhas nunca são gravadas: só o *hash* (HMAC-SHA256 iterado, com salt por conta e uma "pimenta" guardada nas propriedades do script).
- A planilha ganha um **backup diário** automático no seu Google Drive (ative uma vez pelo menu). Veja [Backup diário](#backup-diário).
- O app abre **sem internet** e pode ser **instalado** na tela inicial. Veja [App instalável e sem internet](#app-instalável-e-sem-internet).
- Conta de aluno nova precisa **confirmar o e-mail** pelo link antes de usar o app; "Esqueci minha senha" manda um link para criar uma senha nova. Veja [Confirmação de e-mail e nova senha](#confirmação-de-e-mail-e-nova-senha).

## Instalação / atualização

1. **Planilha.** Use a planilha que você já tem (ou crie uma em [sheets.new](https://sheets.new)).
2. **Código.** *Extensões › Apps Script*: substitua todo o conteúdo de `Código.gs` pelo arquivo `backend/apps-script/Code.gs`. Salve.
3. **Endereço do app.** *Configurações do projeto (engrenagem) › Propriedades do script › Adicionar propriedade*: `APP_BASE_URL` = o endereço público do app, começando com `https://` (ex.: `https://forja.seudominio.com/`). É para ele que os botões dos e-mails apontam. **Sem ela, novos cadastros e e-mails de senha ficam indisponíveis** (o app mostra "Não foi possível enviar e-mails agora").
4. **Estrutura.** Escolha a função `setup` e clique em *Executar*. O Google pede autorização — agora inclui **"Enviar e-mail como você"** (é o que manda os links). Ela:
   - cria só as abas que faltam e acrescenta **no fim** só as colunas que faltam — nada é apagado nem reordenado;
   - converte contas antigas com `plano = premium` em Premium **ADMIN** (`premiumManual = SIM`), para ninguém perder o que já tinha;
   - marca as contas de aluno que já existiam como `emailVerificado = LEGADO` (continuam entrando normalmente — veja abaixo);
   - preenche `pesoAtual`, `altura`, `dataNascimento` e o `historico_peso` a partir dos dados que o app já tinha enviado.
   > Se você esquecer, ela roda sozinha na primeira requisição depois da atualização (propriedade `SCHEMA_VERSION`). Mas a **autorização de e-mail só é dada pelo editor**: rode `setup` (ou o menu *Testar envio de e-mail*) pelo menos uma vez.
5. **Publicar.** *Implantar › Gerenciar implantações › Editar (lápis) › Versão: Nova versão › Implantar*. A URL `/exec` continua a mesma. (Primeira vez: *Nova implantação › App da Web*, executar como **Eu**, acesso **Qualquer pessoa**.)
6. **App e Dashboard.** Os dois usam `js/config.js` (`backend: 'sheets'`, `sheetsUrl: '.../exec'`). O Dashboard fica em `/trainer/` no mesmo site do app. Publique também os arquivos novos do app (`index.html` já aponta para `?v=20260924a`).
7. **Recarregue a planilha (F5).** Aparece o menu **FORJA Admin**. Use *FORJA Admin › Testar envio de e-mail* para conferir se o e-mail chega e se o botão abre o app.
8. **Backup.** *FORJA Admin › Ativar backup diário* (uma vez só). O Google pede mais duas autorizações: acesso ao **Google Drive** (para criar a pasta de backups) e **executar quando você não estiver presente** (o acionador diário).

## Menu "FORJA Admin" (só quem edita a planilha)

| Item | O que faz |
|---|---|
| Criar academia | Nome, limite de alunos, código (ou gera `FORJA-GYM-XXXXXX`) e término do contrato. ID sequencial: `GYM001`, `GYM002`… |
| Criar treinador | Nome, e-mail, academia e papel (`TREINADOR` ou `GESTOR`). Mostra uma **senha provisória** uma única vez; o treinador troca no primeiro acesso. |
| Vincular treinador a outra academia | Um treinador pode trabalhar em várias academias. |
| Redefinir senha de treinador | Gera nova senha provisória. |
| Criar código Premium | Dias de Premium, limite de usos, validade e descrição (gera `FORJA-PREM-XXXXXX`). |
| Registrar / Cancelar assinatura individual | **Só** para assinatura paga/confirmada fora do sistema, ou teste. Não é pagamento. |
| Encerrar vínculo de aluno | Tira o aluno da academia sem apagar o histórico. |
| Recalcular Premium de todos | Recalcula o espelho `tipoConta`/`origemPremium` de todas as contas. |
| Testar envio de e-mail | Confere `APP_BASE_URL`, o provedor e a cota, e manda um e-mail de teste com o mesmo visual dos e-mails da conta. |
| Confirmar e-mail de aluno (suporte) | Marca o e-mail do aluno como confirmado sem o link (ex.: o e-mail não chega e ele comprovou a identidade por outro canal). |
| Ativar backup diário | Cria o acionador diário (por volta das 3h) e já faz o primeiro backup. Rodar de novo não duplica. |
| Fazer backup agora | Uma cópia na hora (antes de mexer na planilha à mão, por exemplo). |

Também dá para chamar pelo editor: `adminCriarAcademia`, `adminCriarTreinador`, `adminCriarCodigoPremium`, `adminRegistrarAssinatura`, `adminEncerrarVinculo`… e `testeCriarAcademiaTeste()` (cria a "Academia Teste", 50 alunos, código `FORJA-GYM-TESTE`).

## Backup diário

A planilha é o banco de dados do FORJA: uma aba ou coluna apagada sem querer apagaria contas e treinos. Com o backup ativado, todo dia (por volta das 3h, no fuso do projeto) o script:

1. cria uma planilha **"FORJA backup AAAA-MM-DD HH:MM"** com uma cópia de **todas as abas**, menos `sessoes` (são as chaves de acesso ativas: não precisam de backup e não devem circular);
2. guarda a cópia na pasta **"FORJA — backups"** do Google Drive de quem é dono do script;
3. mantém as **30 cópias mais novas**; as mais antigas vão para a lixeira do Drive (e ainda podem ser recuperadas por 30 dias).

- A cópia é feita com a mesma trava das requisições do app, então nunca pega uma gravação pela metade. Se algum aluno usar o app exatamente nesse segundo, a requisição dele espera alguns segundos.
- Se um backup falhar, o Google manda um e-mail para você com o erro (acionadores com falha avisam o dono).
- Pode renomear ou mover a pasta: o script a encontra pelo id (propriedade `BACKUP_FOLDER_ID`). Se a pasta for apagada, ele cria outra.
- **Não compartilhe a pasta de backups.** Ela tem os mesmos dados da planilha (e-mails, peso, altura, e os *hashes* das senhas).
- Para desligar: *Extensões › Apps Script › Acionadores* (relógio, à esquerda) e apague o acionador `backupPlanilha`, ou rode a função `desativarBackupDiario` pelo editor.

**Para restaurar:** abra o backup do dia certo, clique com o botão direito na aba que quer recuperar › *Copiar para › Planilha existente* › escolha a planilha do FORJA. Na planilha do FORJA, apague a aba estragada e renomeie a cópia para o nome original (ex.: `usuarios`). Como `sessoes` não vem no backup, quem já estava logado continua logado; se você restaurar tudo de uma vez, no pior caso os alunos só precisam entrar de novo.

## App instalável e sem internet

Arquivos: `manifest.webmanifest`, `sw.js`, `js/pwa.js` e os ícones em `assets/icons/`.

- **Sem internet:** depois da primeira abertura, o app fica guardado no aparelho e abre mesmo sem sinal (ou com sinal ruim: se a internet não responder em 3,5 s, abre a cópia guardada). Os treinos já ficavam no aparelho; o que mudou é que agora o próprio app abre. O que for registrado sem internet vai para a planilha quando a conexão voltar.
- **Instalar:** no Android (Chrome), *Perfil › Dados › Instalar o FORJA* abre o convite de instalação; também dá pelo menu ⋮ do Chrome. No iPhone, a mesma opção mostra o caminho: *Safari › Compartilhar › Adicionar à Tela de Início*. Instalado, o app abre em tela cheia com o ícone do FORJA, e a opção some do Perfil.
  - No iPhone, o app instalado tem um armazenamento separado do Safari: na primeira vez, é preciso **entrar de novo** (os dados vêm da conta). Os links dos e-mails abrem no Safari; a confirmação vale para a conta e o app instalado percebe sozinho.
- **Publicar uma versão nova continua igual:** troque o `?v=` do `index.html`. Com internet, o app abre a versão nova na hora e o aparelho troca os arquivos antigos pelos novos. Não precisa mexer no `sw.js`.
- O service worker só cuida dos arquivos do app. As chamadas ao Apps Script nunca passam pelo cache (os dados sempre vêm do servidor), e um FORJA Trainer publicado em `/trainer/` no mesmo site não é afetado.

## Confirmação de e-mail e nova senha

Só para contas de **aluno**. O FORJA Trainer não mudou: login, sessões de 12 h, troca de senha e senha provisória pelo menu continuam iguais.

**Criar conta:** o servidor cria a conta com `emailVerificado = NAO`, gera um link de uso único e manda o e-mail *"Confirme seu e-mail — FORJA"*. O app mostra **Confirme seu e-mail** (reenviar, alterar e-mail, sair). A pessoa toca em *Confirmar meu e-mail* → o app abre em `#/confirmar-email/<token>` → *Confirmando seu e-mail…* → **E-mail confirmado!** → *Entrar no FORJA* → escolha de plano e primeiro acesso. Se a tela de confirmação ficou aberta em outra aba ou no celular, ela percebe sozinha ao voltar para o app.

**Entrar sem ter confirmado:** senha certa, mas o app não abre: mostra **Confirme seu e-mail** com *Reenviar confirmação*, *Alterar e-mail* e *Sair*. Quem decide é o servidor: com o e-mail não confirmado ele só aceita `me`, `logout`, `resendVerificationEmail` e `changeEmail`; qualquer outra ação responde `email_not_verified`.

**Esqueci minha senha:** Entrar › *Esqueci minha senha* › e-mail › resposta sempre igual (*"Se existir uma conta associada a este e-mail, enviaremos instruções…"*), exista a conta ou não › e-mail *"Redefina sua senha — FORJA"* › `#/redefinir-senha/<token>` › nova senha + confirmação › **Senha atualizada** › Entrar. Ao trocar a senha, **todas as sessões de aluno da conta são encerradas** (sai de todos os aparelhos) e o bloqueio de 15 min por senhas erradas é zerado. Se o e-mail ainda não estava confirmado, fica confirmado (abrir o link prova que o e-mail é da pessoa).

**Links:**

| | Confirmação de e-mail | Nova senha |
|---|---|---|
| Validade | 24 h | 30 min |
| Uso | único (usar apaga o hash) | único |
| Pedir outro | invalida o anterior | invalida o anterior |
| Na planilha | `tokenVerificacaoEmailHash` + `tokenVerificacaoEmailExpira` | `tokenResetSenhaHash` + `tokenResetSenhaExpira` |

- O token tem 244 bits aleatórios (2 UUID v4). Na planilha fica só `HMAC-SHA256(PASSWORD_PEPPER, tipo:token)`: quem lê a planilha não consegue montar um link. O token vai depois do `#` no endereço (não chega a servidor nenhum, nem aparece em log de hospedagem) e o app o tira da barra de endereços assim que lê.
- Os links sempre usam `APP_BASE_URL`, nunca um endereço mandado pelo app (um link forjado levaria o token para outro site).
- Limite de envio: 1 e-mail a cada 60 s e no máximo 5 por hora, por conta (confirmação) ou por endereço digitado (senha). Passou disso, o app mostra *"Você poderá solicitar um novo e-mail em alguns instantes."*
- Os e-mails **não levam o nome** da pessoa (quem cadastra pode digitar o e-mail de outra pessoa) e só têm texto fixo.

**Contas que já existiam:** a atualização marca todas como `emailVerificado = LEGADO`, que vale como confirmado. Ninguém perde o acesso, nenhuma sessão aberta cai e o app antigo continua funcionando até recarregar. `LEGADO` fica separado de `SIM` de propósito: se um dia você quiser pedir confirmação às contas antigas, basta trocar `LEGADO` por `NAO` nessas linhas (célula vazia também vale como confirmado, para linhas antigas ou criadas à mão).

### Envio de e-mail

Hoje o envio usa o **MailApp** do próprio Apps Script: não precisa de chave, senha nem serviço externo, e o e-mail sai da conta Google dona do script com o nome **FORJA**.

| Propriedade do script | Obrigatória | Para quê |
|---|---|---|
| `APP_BASE_URL` | **sim** | Endereço público do app (`https://...`). Os botões dos e-mails abrem `APP_BASE_URL#/confirmar-email/...` e `APP_BASE_URL#/redefinir-senha/...`. |
| `EMAIL_REPLY_TO` | não | E-mail que recebe as respostas (ex.: `suporte@seudominio.com`). |
| `EMAIL_PROVIDER` | não | Provedor de envio. Padrão: `MAILAPP`. Só mude quando acrescentar outro adaptador (abaixo). |

**Limites do MailApp** (cotas atuais do Google — confira em *developers.google.com/apps-script/guides/services/quotas*):
- conta Gmail comum: **100 destinatários por dia**; Google Workspace: **1.500 por dia**. Cada cadastro, reenvio e "esqueci minha senha" gasta 1;
- quando a cota do dia acaba, o servidor responde `email_unavailable` e **não cria a conta** (para ninguém ficar preso numa conta que não consegue confirmar). A cota volta no dia seguinte;
- o remetente é o endereço da conta Google do script (dá para mudar só o nome e o *reply-to*). Numa conta Gmail comum não existe "no-reply".

Para o começo (dezenas de cadastros por dia) o MailApp basta. Acima disso, ou para enviar de `nao-responda@seudominio.com`, troque de provedor — **só a seção "E-mails da conta" do `Code.gs` muda**. O resto do sistema só chama `sendVerificationEmail_()` e `sendPasswordResetEmail_()`. Exemplo com o Resend (a chave fica nas propriedades do script, nunca no app):

```js
// Em MAIL_PROVIDERS, ao lado de MAILAPP. Propriedades: EMAIL_PROVIDER = RESEND,
// EMAIL_PROVIDER_API_KEY = re_..., EMAIL_FROM = FORJA <nao-responda@seudominio.com>
RESEND: {
  remaining: function () { return 1e9; },
  send: function (m, cfg) {
    var p = PropertiesService.getScriptProperties();
    var res = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + p.getProperty('EMAIL_PROVIDER_API_KEY') },
      payload: JSON.stringify({ from: p.getProperty('EMAIL_FROM'), to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: cfg.replyTo || undefined })
    });
    if (res.getResponseCode() >= 300) throw new Error('Resend ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}
```
(SendGrid e Amazon SES seguem o mesmo formato: uma chamada HTTP em `send`.) Usar `UrlFetchApp` pede uma autorização nova ("conectar a um serviço externo"): rode `setup` pelo editor depois de colar.

### Para trocar o Google Planilhas por outro banco depois

As regras de confirmação e de nova senha (ações `verifyEmail`, `resendVerificationEmail`, `changeEmail`, `requestPasswordReset`, `checkPasswordReset`, `confirmPasswordReset`) não falam com a planilha: usam só as funções da seção **"Contas de aluno — camada de dados"** do `Code.gs` (`accountByEmail_`, `accountByLinkToken_`, `createAccount_`, `updateAccount_`, `endStudentSessions_`). Numa migração para PostgreSQL/Supabase, é essa seção que muda. As colunas novas viram campos óbvios: `email_verified` (`SIM`/`LEGADO` = verdadeiro), `email_verified_at`, `verify_token_hash`, `verify_token_expires_at`, `reset_token_hash`, `reset_token_expires_at`.

## Como o Premium funciona

O Premium **não é** `premium = true`. O servidor calcula a partir das fontes, nesta prioridade:

| Origem | Fonte na planilha | Quando vale |
|---|---|---|
| `ACADEMIA` | `usuarios.academiaId` + `statusVinculoAcademia = ATIVO`, academia `ATIVA`, contrato válido | enquanto o vínculo e o contrato valerem |
| `ASSINATURA` | linha em `assinaturas` com `status = ATIVA` (ou `CANCELADA` com período pago ainda correndo) | até `fim` (vazio = sem prazo) |
| `CODIGO` | linha em `resgates_codigo` | até `premiumAte` (vazio = sem prazo) |
| `ADMIN` | `usuarios.premiumManual = SIM` | até alguém apagar |

- As colunas `tipoConta`, `origemPremium`, `statusPremium` e `plano` são um **espelho** recalculado a cada acesso. Para mudar o Premium de alguém, mude a **fonte** (não o espelho).
- Premium individual + academia: a origem atual é `ACADEMIA`, e a assinatura continua registrada. Se o vínculo acabar, o servidor recalcula e a pessoa volta a ser `ASSINATURA` (ou `CODIGO`, `ADMIN`, ou `FREE`).
- O treinador **só enxerga alunos com vínculo ATIVO com a academia dele**. Premium individual ou por código nunca aparece no Dashboard.

## Pagamento (preparado, não integrado)

Não existe gateway de pagamento. O app **não** vira Premium sozinho (a ação `setPlan` responde `payment_unavailable`) e a tela de planos diz isso claramente.

Para integrar Mercado Pago, Stripe, Apple ou Google Play depois:
1. Defina a propriedade do script `WEBHOOK_SECRET` (um texto longo e aleatório).
2. Escreva um adaptador (Cloud Function, Worker ou outro Apps Script) que receba a notificação do gateway, **confirme o pagamento na API do gateway** e chame:
   ```json
   { "action": "subscriptionWebhook", "secret": "…", "email": "aluno@x.com",
     "status": "ATIVA", "plano": "MENSAL", "origem": "MERCADOPAGO", "idExterno": "id-da-assinatura",
     "inicio": "2026-09-21", "renovacao": "2026-10-21", "fim": "2026-10-21" }
   ```
   Chamadas repetidas com o mesmo `origem` + `idExterno` atualizam a mesma linha. Status aceitos: `ATIVA`, `PENDENTE`, `CANCELADA`, `EXPIRADA`, `SUSPENSA`.

## Treinos do treinador

- Os treinos continuam no JSON da aba `dados` (chave `workouts`) — **uma única fonte**, sem tabela duplicada.
- Treino salvo pelo treinador ganha `managed: true` e `managedBy` (treinador, academia). No app ele fica somente leitura ("Montado por…").
- No `push`, o servidor **preserva** os treinos gerenciados: um app desatualizado nunca apaga ou sobrescreve o que o treinador fez. Treinos excluídos pelo treinador não voltam (a exclusão fica em `historico_treinos`).
- Editar um treino criado pelo aluno faz o treinador **assumi-lo** (tipo `ASSUMIR` no histórico).
- Quando o aluno sai da academia, os treinos montados pelo treinador passam a ser dele (`releasedFrom`).
- Campos extras por exercício: `loadKg` (carga), `restSec` (descanso) e `notes` (observação). O app mostra os três, e usa a carga como ponto de partida no modo treino.

## Formato dos dados

Abas existentes (colunas novas entram no fim):

| Aba | Colunas |
|---|---|
| `usuarios` | id, email, nome, hash, salt, plano, criadoEm, planoAtualizadoEm, **tipoConta, origemPremium, statusPremium, premiumManual, academiaId, academiaNome, statusVinculoAcademia, dataEntradaAcademia, dataSaidaAcademia, dataNascimento, idade, pesoAtual, altura, ultimoAcesso, statusUsuario, emailVerificado** (`SIM`/`NAO`/`LEGADO`), **dataVerificacaoEmail, tokenVerificacaoEmailHash, tokenVerificacaoEmailExpira, tokenResetSenhaHash, tokenResetSenhaExpira** |
| `sessoes` | token, userId, criadoEm, expiraEm, **tipo** (`aluno` 60 dias · `treinador` 12 h) |
| `dados` | userId, chave, parte, json, atualizadoEm |

Abas novas:

| Aba | Colunas |
|---|---|
| `academias` | id, nome, codigo, status (`ATIVA`…), plano, limiteAlunos, criadoEm, inicioContrato, fimContrato, statusContrato (`ATIVO`…), atualizadoEm |
| `treinadores` | id, nome, email, hash, salt, status (`ATIVO`/`INATIVO`), trocarSenha, criadoEm, ultimoAcesso |
| `treinador_academias` | treinadorId, academiaId, papel (`TREINADOR`/`GESTOR`), status, criadoEm |
| `vinculos_academia` | id, userId, academiaId, status (`ATIVO`/`INATIVO`), dataEntrada, dataSaida, motivoSaida, codigoUsado |
| `codigos_premium` | codigo, status (`ATIVO`/`INATIVO`), diasPremium, validoAte, limiteUsos, usos, descricao, criadoEm |
| `resgates_codigo` | id, codigo, userId, data, premiumAte |
| `assinaturas` | id, userId, plano, status, inicio, renovacao, fim, origem, idExterno, criadoEm, atualizadoEm |
| `historico_peso` | id, userId, data, pesoKg, origem, status (`ATIVO`/`REMOVIDO`), registradoEm |
| `historico_treinos` | id, userId, treinadorId, treinadorNome, academiaId, data, treinoId, treinoNome, tipo (`CRIAR`/`EDITAR`/`ASSUMIR`/`EXCLUIR`), detalhes |

Observações:
- **IMC não é gravado**: é calculado na hora (peso ÷ altura²). **Idade** é calculada pela `dataNascimento`; a coluna `idade` só guarda a idade digitada por quem não informou a data.
- `historico_peso` nunca perde linhas: pesagem apagada no app vira `REMOVIDO`.
- "Quantidade atual de alunos" é contada na hora (`vinculos_academia` com status `ATIVO`), então nunca fica desatualizada.
- Para bloquear um aluno: `usuarios.statusUsuario = BLOQUEADO`. Para desligar um treinador: `treinadores.status = INATIVO` (vale na próxima chamada).

## Permissões do FORJA Trainer

| Papel | Pode |
|---|---|
| `TREINADOR` | ver/pesquisar alunos da academia, dados físicos, histórico de peso, ver/criar/editar/excluir treinos, ver a equipe |
| `GESTOR` | tudo do treinador + encerrar vínculo de aluno |

Ninguém no Dashboard altera assinatura, limite da academia ou códigos: essas ações não existem na API, só no menu da planilha. Toda chamada confere: sessão de treinador válida → treinador ativo → acesso àquela academia → academia ativa → permissão → aluno com vínculo ativo com a academia → dados válidos.

## Ações da API (POST `{ action, ... }`)

App: `register`, `login`, `me`, `logout`, `pull` (com `keys` opcional), `push`, `clear`, `redeemPremiumCode`, `joinAcademy`, `leaveAcademy`, `setPlan` (desligada).
Conta do aluno: `verifyEmail` (`linkToken`), `resendVerificationEmail` (`token` da sessão, ou `linkToken` vencido), `changeEmail` (`token`, `email`, `password`; só antes de confirmar), `requestPasswordReset` (`email`), `checkPasswordReset` (`linkToken`), `confirmPasswordReset` (`linkToken`, `password`, `passwordConfirm`).
Dashboard: `trainerLogin`, `trainerMe`, `trainerChangePassword`, `trainerOverview`, `trainerStudents`, `trainerStudent`, `trainerSaveWorkout`, `trainerDeleteWorkout`, `trainerWorkouts`, `trainerAcademy`, `trainerUnlinkStudent`.
Pagamento: `subscriptionWebhook` (exige `WEBHOOK_SECRET`).

## Limites bons de saber

- Cada chamada ao Apps Script leva de 0,5 a 2 s; o app sincroniza em segundo plano e o Dashboard guarda as telas por 30 s em memória.
- As requisições são processadas uma por vez (LockService), o que deixa o limite de alunos à prova de corrida, mas limita o volume. Cotas da conta gratuita: ~20 mil chamadas/dia.
- Opcional: crie um acionador diário para `cleanupSessions` (apaga sessões vencidas).
- E-mails: 100 por dia numa conta Gmail comum, 1.500 no Google Workspace (veja [Envio de e-mail](#envio-de-e-mail)). O envio acontece depois de liberar a trava, então não atrasa as requisições dos outros alunos.
- Não apague a propriedade `PASSWORD_PEPPER`: sem ela, as senhas no formato novo deixam de conferir (seria preciso redefinir todas).
