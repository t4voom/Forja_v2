/* FORJA — baixar meus dados (LGPD: acesso e portabilidade)
   · Arquivo completo (JSON): a conta e tudo o que o app guarda — treinos, histórico, cardio, peso, metas,
     programa, lembretes e preferências. Serve para levar os dados para outro app ou guardar uma cópia.
   · Planilha (CSV): uma linha por série de musculação e uma por atividade de cardio. Separador ";" e vírgula
     decimal, como o Excel em português espera; abre também no Google Planilhas e no Numbers.
   · No celular abre a folha de compartilhar (Salvar em Arquivos, e-mail, Drive...) quando o sistema aceita
     o tipo de arquivo; senão (e no computador) o arquivo é baixado. Nada é enviado para lugar nenhum pelo app. */
(function (global) {
  'use strict';
  const { U, UI, Store } = global;
  const { esc, icon } = U;

  const stamp = () => U.dayKey(new Date());

  /* ---------- Arquivo completo ---------- */
  function buildJSON() {
    const user = (global.Backend && global.Backend.user()) || null;
    const data = Store.snapshot();
    return {
      app: 'FORJA',
      formato: 1,
      exportadoEm: new Date().toISOString(),
      conta: user ? {
        id: user.id, nome: user.name, email: user.email, plano: user.plan,
        criadaEm: user.createdAt || null, emailConfirmado: user.emailVerified !== false,
        detalhes: user.account || null
      } : null,
      // Mesmo formato que o app usa por dentro (unidades: kg, km, segundos; datas em ISO 8601)
      dados: data
    };
  }

  /* ---------- Planilha ---------- */
  const HEAD = ['Data', 'Hora', 'Tipo', 'Treino ou atividade', 'Exercício', 'Grupo muscular', 'Série', 'Tipo da série', 'Carga (kg)', 'Repetições', 'Duração (min)', 'Distância (km)', 'Calorias (kcal)', 'Esforço (RPE)', 'Observações'];
  const SET_TYPE = { warmup: 'Aquecimento', drop: 'Drop-set' };

  // Número com vírgula decimal (sem separador de milhar, para a planilha ler como número)
  const n = (v, dec = 2) => (Number.isFinite(v) ? String(U.round(v, dec)).replace('.', ',') : '');
  // Texto: aspas quando precisa; nada começando com = + - @ vira fórmula
  function cell(v) {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }
  const dateCell = (iso) => { const d = new Date(iso); return `${U.pad(d.getDate())}/${U.pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const timeCell = (iso) => { const d = new Date(iso); return `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`; };

  function buildCSV() {
    const rows = [];
    Store.get('sessions').forEach((s) => {
      let first = true;
      (s.exercises || []).forEach((ex) => {
        const name = ((global.Exercises && global.Exercises.get(ex.exerciseId)) || {}).name || ex.name || ex.exerciseId;
        (ex.sets || []).filter((x) => x && x.done !== false).forEach((set, i) => {
          rows.push({ at: s.startedAt, cells: [
            dateCell(s.startedAt), timeCell(s.startedAt), 'Musculação', cell(s.name), cell(name), cell(ex.muscle || ''),
            String(i + 1), SET_TYPE[set.type] || 'Normal', n(set.weightKg), set.reps == null ? '' : String(set.reps),
            '', '', '', s.rpe == null ? '' : String(s.rpe), first ? cell(s.notes || '') : ''
          ] });
          first = false;
        });
      });
    });
    Store.get('cardio').forEach((c) => {
      rows.push({ at: c.startedAt, cells: [
        dateCell(c.startedAt), timeCell(c.startedAt), 'Cardio', cell(global.Cardio.labelOf(c)), '', '',
        '', '', '', '', n((c.durationSec || 0) / 60, 1), c.distanceKm ? n(c.distanceKm, 3) : '', c.kcal ? String(c.kcal) : '',
        c.rpe == null ? '' : String(c.rpe), cell(c.notes || '')
      ] });
    });
    rows.sort((a, b) => new Date(a.at) - new Date(b.at));
    // BOM: o Excel reconhece o UTF-8 (acentos) só com ele
    return '﻿' + [HEAD.map(cell).join(';')].concat(rows.map((r) => r.cells.join(';'))).join('\r\n') + '\r\n';
  }

  /* ---------- Entrega ---------- */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Celular: folha de compartilhar, se aceitar o tipo. Senão, baixa. Devolve 'shared' | 'saved' | 'cancel'.
  async function deliver(text, name, type) {
    const blob = new Blob([text], { type });
    const touch = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare) {
      try {
        const file = new File([blob], name, { type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Meus dados do FORJA' });
          return 'shared';
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
      }
    }
    download(blob, name);
    return 'saved';
  }

  async function exportJSON() {
    const r = await deliver(JSON.stringify(buildJSON(), null, 2), `forja-meus-dados-${stamp()}.json`, 'application/json');
    if (r === 'saved') UI.toast('Arquivo salvo em Downloads', { iconName: 'download' });
  }

  async function exportCSV() {
    const r = await deliver(buildCSV(), `forja-treinos-${stamp()}.csv`, 'text/csv');
    if (r === 'saved') UI.toast('Planilha salva em Downloads', { iconName: 'download' });
  }

  /* ---------- Folha "Baixar meus dados" ---------- */
  function open() {
    const sessions = Store.get('sessions').length;
    const cardio = Store.get('cardio').length;
    const body = U.h(`
      <div>
        <div class="group has-icons">
          <button type="button" class="row" data-export="json">
            <span class="row-icon">${icon('layers', { size: 20 })}</span>
            <span class="row-main">
              <span class="row-title block">Arquivo completo</span>
              <span class="row-sub block">Tudo da sua conta, em JSON. Para guardar uma cópia ou levar para outro app.</span>
            </span>
            ${icon('download', { size: 18, stroke: 2, cls: 'row-chevron' })}
          </button>
          <button type="button" class="row" data-export="csv">
            <span class="row-icon">${icon('list', { size: 20 })}</span>
            <span class="row-main">
              <span class="row-title block">Planilha dos treinos</span>
              <span class="row-sub block">${esc(`${U.plural(sessions, 'treino', 'treinos')} e ${U.plural(cardio, 'cardio', 'cardios')}, em CSV. Abre no Excel e no Google Planilhas.`)}</span>
            </span>
            ${icon('download', { size: 18, stroke: 2, cls: 'row-chevron' })}
          </button>
        </div>
        <p class="t-footnote group-note">Os arquivos são gerados neste aparelho, com os dados que ele tem agora. Nada é enviado para ninguém: você escolhe onde salvar.</p>
      </div>`);
    const sheet = UI.openSheet({ title: 'Baixar meus dados', subtitle: 'Uma cópia de tudo o que o FORJA guarda da sua conta.', body });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-export]');
      if (!b) return;
      sheet.close('export');
      (b.dataset.export === 'json' ? exportJSON() : exportCSV()).catch(() => UI.toast('Não foi possível gerar o arquivo', { iconName: 'info' }));
    });
    return sheet;
  }

  global.DataExport = { open, buildJSON, buildCSV, exportJSON, exportCSV };
})(window);
