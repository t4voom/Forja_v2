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

## Instalação / atualização

1. **Planilha.** Use a planilha que você já tem (ou crie uma em [sheets.new](https://sheets.new)).
2. **Código.** *Extensões › Apps Script*: substitua todo o conteúdo de `Código.gs` pelo arquivo `backend/apps-script/Code.gs`. Salve.
3. **Estrutura.** Escolha a função `setup` e clique em *Executar* (autorize quando o Google pedir). Ela:
   - cria só as abas que faltam e acrescenta **no fim** só as colunas que faltam — nada é apagado nem reordenado;
   - converte contas antigas com `plano = premium` em Premium **ADMIN** (`premiumManual = SIM`), para ninguém perder o que já tinha;
   - preenche `pesoAtual`, `altura`, `dataNascimento` e o `historico_peso` a partir dos dados que o app já tinha enviado.
   > Se você esquecer, ela roda sozinha na primeira requisição depois da atualização (propriedade `SCHEMA_VERSION`).
4. **Publicar.** *Implantar › Gerenciar implantações › Editar (lápis) › Versão: Nova versão › Implantar*. A URL `/exec` continua a mesma. (Primeira vez: *Nova implantação › App da Web*, executar como **Eu**, acesso **Qualquer pessoa**.)
5. **App e Dashboard.** Os dois usam `js/config.js` (`backend: 'sheets'`, `sheetsUrl: '.../exec'`). O Dashboard fica em `/trainer/` no mesmo site do app.
6. **Recarregue a planilha (F5).** Aparece o menu **FORJA Admin**.

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

Também dá para chamar pelo editor: `adminCriarAcademia`, `adminCriarTreinador`, `adminCriarCodigoPremium`, `adminRegistrarAssinatura`, `adminEncerrarVinculo`… e `testeCriarAcademiaTeste()` (cria a "Academia Teste", 50 alunos, código `FORJA-GYM-TESTE`).

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
| `usuarios` | id, email, nome, hash, salt, plano, criadoEm, planoAtualizadoEm, **tipoConta, origemPremium, statusPremium, premiumManual, academiaId, academiaNome, statusVinculoAcademia, dataEntradaAcademia, dataSaidaAcademia, dataNascimento, idade, pesoAtual, altura, ultimoAcesso, statusUsuario** |
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
Dashboard: `trainerLogin`, `trainerMe`, `trainerChangePassword`, `trainerOverview`, `trainerStudents`, `trainerStudent`, `trainerSaveWorkout`, `trainerDeleteWorkout`, `trainerWorkouts`, `trainerAcademy`, `trainerUnlinkStudent`.
Pagamento: `subscriptionWebhook` (exige `WEBHOOK_SECRET`).

## Limites bons de saber

- Cada chamada ao Apps Script leva de 0,5 a 2 s; o app sincroniza em segundo plano e o Dashboard guarda as telas por 30 s em memória.
- As requisições são processadas uma por vez (LockService), o que deixa o limite de alunos à prova de corrida, mas limita o volume. Cotas da conta gratuita: ~20 mil chamadas/dia.
- Opcional: crie um acionador diário para `cleanupSessions` (apaga sessões vencidas).
- Não apague a propriedade `PASSWORD_PEPPER`: sem ela, as senhas no formato novo deixam de conferir (seria preciso redefinir todas).
