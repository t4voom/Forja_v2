/* FORJA — cards de compartilhamento
   Gera uma imagem do treino (Canvas, sem bibliotecas e sem internet) para os stories do Instagram,
   o WhatsApp ou o feed. Compartilha pela folha nativa do celular (Web Share) quando existe;
   senão, salva o PNG. Os números vêm do histórico — nada inventado. */
(function (global) {
  'use strict';
  const { U, UI, Statistics } = global;

  // O card é sempre escuro: fica melhor nos stories, independente do tema do app
  const C = {
    bg: '#0B0B0C',
    text: '#F5F5F7',
    text2: '#8E8E93',
    text3: '#4A4A4F',
    accent: '#E8853D',
    line: 'rgba(255,255,255,0.10)',
    pill: 'rgba(232,133,61,0.16)',
    pill2: 'rgba(255,255,255,0.07)',
    // Sobre foto (ou sem fundo): cinza some, então os tons secundários viram branco translúcido
    soft: 'rgba(245,245,247,0.82)',
    softer: 'rgba(245,245,247,0.6)',
    pillPhoto: 'rgba(232,133,61,0.32)',
    pill2Photo: 'rgba(0,0,0,0.42)'
  };
  const muted = (ctx) => (ctx.__onPhoto ? C.soft : C.text2);
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';
  const FORMATS = {
    story: { w: 1080, h: 1920, label: 'Stories' },
    square: { w: 1080, h: 1080, label: 'Quadrado' },
    overlay: { w: 1080, h: 1024, label: 'Transparente' }   // sem fundo: para colar sobre uma foto
  };

  /* ---------- Dados do card ---------- */
  function cardData(session) {
    const saved = global.Sessions.all();
    const all = saved.some((s) => s.id === session.id) ? saved : saved.concat([session]);
    const working = Statistics.workingSets(session);
    const volume = Statistics.sessionVolume(session);
    const records = Statistics.groupRecords(Statistics.calculatePersonalRecords(all)).filter((r) => r.sessionId === session.id);
    const others = all.filter((s) => s.id !== session.id && s.workoutId && s.workoutId === session.workoutId);
    const bestVolume = others.length > 0 && volume > Math.max(...others.map(Statistics.sessionVolume));
    const recordIds = new Set(records.map((r) => r.exerciseId));

    // Os exercícios que mais pesaram no treino, com a melhor série de cada
    const exercises = (session.exercises || [])
      .map((ex) => {
        const ws = (ex.sets || []).filter(Statistics.isWorkingSet);
        if (!ws.length) return null;
        const top = ws.reduce((b, x) => ((x.weightKg || 0) * 1000 + x.reps > (b.weightKg || 0) * 1000 + b.reps ? x : b));
        return { name: ex.name, top, volume: Statistics.setsVolume(ws), record: recordIds.has(ex.exerciseId) };
      })
      .filter(Boolean)
      .sort((a, b) => b.volume - a.volume);

    return {
      name: session.name,
      date: new Date(session.startedAt),
      volume,
      sets: working.length,
      exerciseCount: exercises.length,
      durationSec: session.durationSec || 0,
      exercises,
      records: records.length,
      streak: Statistics.streakInfo(all.concat(global.Cardio ? global.Cardio.all() : [])).days,
      headline: records.length ? (records.length === 1 ? 'Novo recorde.' : `${records.length} novos recordes.`)
        : bestVolume ? 'Maior volume até hoje.'
        : 'Treino concluído.'
    };
  }

  /* ---------- Desenho ---------- */
  const font = (size, weight = 700) => `${weight} ${size}px ${FONT}`;

  // Texto com espaçamento entre letras (funciona em qualquer navegador)
  function spaced(ctx, text, x, y, spacing, align = 'left') {
    const chars = [...text];
    const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
    let cx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    ctx.textAlign = 'left';
    chars.forEach((ch) => { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; });
    return width;
  }

  // Diminui a fonte até caber; se nem no mínimo couber, corta com reticências
  function fit(ctx, text, maxW, size, min, weight = 700) {
    let s = size;
    ctx.font = font(s, weight);
    while (ctx.measureText(text).width > maxW && s > min) { s -= 4; ctx.font = font(s, weight); }
    let t = text;
    while (ctx.measureText(t).width > maxW && t.length > 1) t = `${t.slice(0, -2)}…`;
    return { size: s, text: t };
  }

  function wrap(ctx, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Reaproveita os ícones SVG do app (os mesmos traços finos)
  function drawIcon(ctx, name, x, y, size, color, lw = 1.8) {
    const svg = U.ICONS[name] || '';
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const m of svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)) {
      const p = new Path2D(m[1]);
      if (/fill="currentColor"/.test(m[0])) ctx.fill(p);
      ctx.stroke(p);
    }
    for (const m of svg.matchAll(/<rect([^>]*)>/g)) {
      const a = (k) => Number((m[1].match(new RegExp(`\\s${k}="([\\d.]+)"`)) || [])[1] || 0);
      roundRect(ctx, a('x'), a('y'), a('width'), a('height'), a('rx'));
      ctx.stroke();
    }
    ctx.restore();
  }

  // A marca do FORJA (a mesma do ícone do app)
  function drawMark(ctx, x, y, size) {
    const k = size / 512;
    ctx.save();
    roundRect(ctx, x, y, size, size, 112 * k);
    ctx.fillStyle = '#161617';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 46 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 188 * k, y + 376 * k); ctx.lineTo(x + 188 * k, y + 140 * k); ctx.lineTo(x + 338 * k, y + 140 * k);
    ctx.moveTo(x + 188 * k, y + 258 * k); ctx.lineTo(x + 300 * k, y + 258 * k);
    ctx.stroke();
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(x + 352 * k, y + 364 * k, 22 * k, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function glow(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('ALPHA', alpha));
    g.addColorStop(1, color.replace('ALPHA', 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // Grão sutil, sempre igual para o mesmo treino
  function grain(ctx, seedText) {
    let seed = [...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const { width, height } = ctx.canvas;
    for (let i = 0; i < (width * height) / 220; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.018 + rand() * 0.03})`;
      ctx.fillRect(rand() * width, rand() * height, 1.6, 1.6);
    }
  }

  function pill(ctx, x, y, iconName, text, strong) {
    ctx.font = font(34, 600);
    const w = 44 + 16 + ctx.measureText(text).width + 36;
    roundRect(ctx, x, y, w, 76, 38);
    ctx.fillStyle = ctx.__onPhoto ? (strong ? C.pillPhoto : C.pill2Photo) : (strong ? C.pill : C.pill2);
    ctx.fill();
    drawIcon(ctx, iconName, x + 26, y + 19, 38, C.accent, 1.9);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 26 + 38 + 14, y + 50);
    return w;
  }

  const kgText = (kg) => `${U.fmtNum(U.round(U.toUnit(kg), 2), 2)} ${U.currentUnit()}`;
  const dateText = (d) => `${U.WEEKDAYS[d.getDay()]} · ${U.fmtDayMonth(d)}`;

  // Sombra suave no texto: mantém legível sobre qualquer foto
  function textShadow(ctx, on) {
    ctx.shadowColor = on ? 'rgba(0,0,0,0.55)' : 'transparent';
    ctx.shadowBlur = on ? 28 : 0;
    ctx.shadowOffsetY = on ? 2 : 0;
  }

  function drawBackground(ctx, d, photo) {
    const { width: W, height: H } = ctx.canvas;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    if (photo) {
      // Foto cobrindo o card inteiro (como "cover"), com gradiente escuro para os números
      const s = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
      const pw = photo.naturalWidth * s, ph = photo.naturalHeight * s;
      ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph);
      ctx.__onPhoto = true;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.3, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      textShadow(ctx, true);
      return;
    }
    glow(ctx, W * 0.86, H * 0.16, W * 0.95, 'rgba(232,133,61,ALPHA)', 0.30);
    glow(ctx, W * 0.05, H * 0.98, W * 0.8, 'rgba(232,133,61,ALPHA)', 0.10);
    grain(ctx, d.name + d.date.toISOString());
  }

  function drawTop(ctx, d, M, top) {
    const W = ctx.canvas.width;
    drawMark(ctx, M, top, 84);
    ctx.fillStyle = C.text;
    ctx.font = font(38, 800);
    spaced(ctx, 'FORJA', M + 84 + 26, top + 56, 8);
    ctx.fillStyle = muted(ctx);
    ctx.font = font(32, 600);
    spaced(ctx, dateText(d.date), W - M, top + 54, 3, 'right');
  }

  function drawStats(ctx, d, M, y, valueSize) {
    const W = ctx.canvas.width;
    const colW = (W - 2 * M) / 3;
    const stats = [
      [U.fmtDuration(d.durationSec), 'Duração'],
      [String(d.sets), d.sets === 1 ? 'Série' : 'Séries'],
      [String(d.exerciseCount), d.exerciseCount === 1 ? 'Exercício' : 'Exercícios']
    ];
    ctx.fillStyle = C.line;
    ctx.fillRect(M, y, W - 2 * M, 2);
    stats.forEach(([v, label], i) => {
      const x = M + i * colW;
      ctx.fillStyle = C.text;
      const f = fit(ctx, v, colW - 48, valueSize, 44, 700);
      ctx.fillText(f.text, x, y + 40 + valueSize);   // mesma linha de base para todos os números
      ctx.fillStyle = muted(ctx);
      ctx.font = font(28, 600);
      spaced(ctx, label.toUpperCase(), x, y + 40 + valueSize + 54, 3);
    });
    return y + 40 + valueSize + 54;
  }

  function drawPills(ctx, d, M, y) {
    let x = M;
    if (d.records) x += pill(ctx, x, y, 'trophy', d.records === 1 ? '1 recorde' : `${d.records} recordes`, true) + 16;
    if (d.streak > 1 && x + 420 < ctx.canvas.width - M) pill(ctx, x, y, 'flame', `${d.streak} dias de sequência`, false);
  }

  /* Stories: o Instagram cobre ~250px no topo (perfil/progresso) e ~340px embaixo (resposta).
     Tudo que importa fica na faixa do meio. */
  function drawStory(ctx, d, photo) {
    const W = 1080, H = 1920, M = 96;
    const SAFE_BOTTOM = H - 360;
    drawBackground(ctx, d, photo);
    drawTop(ctx, d, M, 170);

    let y = 420;
    ctx.fillStyle = C.accent;
    ctx.font = font(40, 700);
    const eyebrow = fit(ctx, d.name.toUpperCase(), W - 2 * M, 40, 28, 700);
    spaced(ctx, eyebrow.text, M, y, 6);

    ctx.fillStyle = C.text;
    ctx.font = font(116, 800);
    const lines = wrap(ctx, d.headline, W - 2 * M).slice(0, 2);
    lines.forEach((l) => { y += 124; ctx.fillText(l, M, y); });

    // Número herói: o total levantado
    y += 280;
    const vol = U.fmtVolume(d.volume, { withUnit: false });
    const hero = fit(ctx, vol, W - 2 * M - 150, 250, 150, 800);
    ctx.fillStyle = C.text;
    ctx.fillText(hero.text, M - 6, y);
    const hw = ctx.measureText(hero.text).width;
    ctx.fillStyle = muted(ctx);
    ctx.font = font(80, 700);
    ctx.fillText(U.currentUnit(), M + hw + 18, y);
    ctx.font = font(44, 500);
    ctx.fillText('levantados', M, y + 76);

    y = drawStats(ctx, d, M, y + 130, 76);

    // Melhores séries
    const ROW = 76;
    const listTop = y + 70;
    const room = SAFE_BOTTOM - 40 - listTop;
    const rows = Math.max(0, Math.min(3, d.exercises.length, Math.floor((room + 36) / ROW)));
    d.exercises.slice(0, rows).forEach((ex, i) => {
      const ry = listTop + i * ROW;
      if (i) { ctx.fillStyle = C.line; ctx.fillRect(M, ry - 40, W - 2 * M, 2); }
      const right = `${kgText(ex.top.weightKg)} × ${ex.top.reps}`;
      ctx.font = font(40, 700);
      const rw = ctx.measureText(right).width;
      ctx.fillStyle = C.text;
      ctx.textAlign = 'right';
      ctx.fillText(right, W - M, ry + 14);
      ctx.textAlign = 'left';
      let nx = M;
      if (ex.record) { drawIcon(ctx, 'trophy', M, ry - 20, 36, C.accent, 2); nx += 50; }
      const name = fit(ctx, ex.name, W - 2 * M - rw - 40 - (nx - M), 40, 30, 500);
      ctx.fillStyle = C.text;
      ctx.fillText(name.text, nx, ry + 14);
    });

    drawPills(ctx, d, M, SAFE_BOTTOM);
    ctx.fillStyle = ctx.__onPhoto ? C.softer : C.text3;
    ctx.font = font(30, 600);
    spaced(ctx, 'TREINADO COM FORJA', M, SAFE_BOTTOM + 150, 4);
  }

  function drawSquare(ctx, d, photo) {
    const W = 1080, H = 1080, M = 80;
    drawBackground(ctx, d, photo);
    drawTop(ctx, d, M, 80);

    let y = 330;
    ctx.fillStyle = C.accent;
    const eyebrow = fit(ctx, d.name.toUpperCase(), W - 2 * M, 36, 26, 700);
    spaced(ctx, eyebrow.text, M, y, 5);
    ctx.fillStyle = C.text;
    const head = fit(ctx, d.headline, W - 2 * M, 84, 56, 800);
    y += 100;
    ctx.fillText(head.text, M, y);

    y += 230;
    const vol = U.fmtVolume(d.volume, { withUnit: false });
    const hero = fit(ctx, vol, W - 2 * M - 130, 200, 120, 800);
    ctx.fillStyle = C.text;
    ctx.fillText(hero.text, M - 4, y);
    const hw = ctx.measureText(hero.text).width;
    ctx.fillStyle = muted(ctx);
    ctx.font = font(64, 700);
    ctx.fillText(U.currentUnit(), M + hw + 16, y);

    drawStats(ctx, d, M, y + 70, 64);
    drawPills(ctx, d, M, H - 150);
  }

  // Sem fundo: só a parte do FORJA, para colar sobre a própria foto (sticker)
  function drawOverlay(ctx, d) {
    const W = 1080, M = 64;
    ctx.__onPhoto = true;
    textShadow(ctx, true);
    drawTop(ctx, d, M, 56);

    let y = 250;
    ctx.fillStyle = C.accent;
    const eyebrow = fit(ctx, d.name.toUpperCase(), W - 2 * M, 38, 26, 700);
    spaced(ctx, eyebrow.text, M, y, 6);

    ctx.fillStyle = C.text;
    const head = fit(ctx, d.headline, W - 2 * M, 76, 52, 800);
    y += 92;
    ctx.fillText(head.text, M, y);

    y += 220;
    const vol = U.fmtVolume(d.volume, { withUnit: false });
    const hero = fit(ctx, vol, W - 2 * M - 130, 200, 120, 800);
    ctx.fillStyle = C.text;
    ctx.fillText(hero.text, M - 4, y);
    const hw = ctx.measureText(hero.text).width;
    ctx.fillStyle = muted(ctx);
    ctx.font = font(68, 700);
    ctx.fillText(U.currentUnit(), M + hw + 16, y);
    ctx.font = font(40, 500);
    ctx.fillText('levantados', M, y + 64);

    drawStats(ctx, d, M, y + 104, 68);
    drawPills(ctx, d, M, 884);
  }

  function render(session, format, { photo = null } = {}) {
    const f = FORMATS[format];
    const canvas = document.createElement('canvas');
    canvas.width = f.w;
    canvas.height = f.h;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    const d = cardData(session);
    if (format === 'overlay') drawOverlay(ctx, d);
    else if (format === 'story') drawStory(ctx, d, photo);
    else drawSquare(ctx, d, photo);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  }

  /* ---------- Compartilhar / salvar ---------- */
  function supportsFileShare() {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'forja.png', { type: 'image/png' })] }));
    } catch (e) { return false; }
  }

  const fileName = (session, format) => `forja-${U.dayKey(session.startedAt)}-${format === 'story' ? 'stories' : format === 'square' ? 'quadrado' : 'transparente'}.png`;

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

  const canCopy = () => !!(navigator.clipboard && navigator.clipboard.write && global.ClipboardItem);

  const HINTS = {
    share: 'Escolha Instagram, WhatsApp ou onde preferir.',
    save: 'Salve a imagem e poste nos stories ou envie no WhatsApp.',
    overlay: 'Sem fundo: copie ou salve e cole sobre a sua foto nos stories (figurinha de foto).'
  };

  function open(session) {
    if (!session) return;
    let format = 'story';
    let blob = null;
    let url = null;
    let photo = null;        // foto escolhida: só na memória enquanto esta tela está aberta
    let photoUrl = null;
    const canShare = supportsFileShare();

    const body = U.h(`
      <div class="share">
        <div data-slot="format"></div>
        <div class="share-stage"><img class="share-preview is-story" alt="Prévia do card do treino"></div>
        <div class="share-photo" data-photo-row>
          <button type="button" class="btn btn-secondary btn-sm" data-photo>${U.icon('image', { size: 17, stroke: 1.9 })}<span>Usar foto de fundo</span></button>
          <button type="button" class="btn btn-ghost is-muted btn-sm" data-photo-remove hidden>Remover foto</button>
          <input type="file" accept="image/*" data-photo-input hidden>
        </div>
        <p class="t-footnote text-center mt-3" data-hint></p>
      </div>`);
    const footer = U.h(`
      <div class="share-actions">
        ${canCopy() ? `<button type="button" class="btn btn-secondary" data-copy aria-label="Copiar imagem">${U.icon('copy', { size: 20, stroke: 1.9 })}</button>` : ''}
        ${canShare ? `<button type="button" class="btn btn-secondary" data-save aria-label="Salvar imagem">${U.icon('download', { size: 20, stroke: 1.9 })}</button>` : ''}
        <button type="button" class="btn btn-primary" data-go>${canShare ? `${U.icon('share', { size: 19, stroke: 1.9 })} Compartilhar` : `${U.icon('download', { size: 19, stroke: 1.9 })} Salvar imagem`}</button>
      </div>`);
    const sheet = UI.openSheet({
      title: 'Compartilhar treino', subtitle: session.name, body, footer,
      onClose: () => { if (url) URL.revokeObjectURL(url); if (photoUrl) URL.revokeObjectURL(photoUrl); }
    });
    const img = body.querySelector('img');
    const stage = body.querySelector('.share-stage');
    const buttons = footer.querySelectorAll('button');
    const photoBtn = body.querySelector('[data-photo]');
    const removeBtn = body.querySelector('[data-photo-remove]');
    const input = body.querySelector('[data-photo-input]');

    const paint = async () => {
      img.classList.add('is-loading');
      buttons.forEach((b) => { b.disabled = true; });
      blob = await render(session, format, { photo });
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      img.src = url;
      img.classList.toggle('is-story', format === 'story');
      img.classList.toggle('is-overlay', format === 'overlay');
      stage.classList.toggle('is-transparent', format === 'overlay');
      // A foto de fundo vale para Stories e Quadrado; o Transparente já é feito para ir sobre uma foto
      body.querySelector('[data-photo-row]').hidden = format === 'overlay';
      photoBtn.querySelector('span').textContent = photo ? 'Trocar foto' : 'Usar foto de fundo';
      removeBtn.hidden = !photo;
      body.querySelector('[data-hint]').textContent = format === 'overlay' ? HINTS.overlay : canShare ? HINTS.share : HINTS.save;
      img.classList.remove('is-loading');
      buttons.forEach((b) => { b.disabled = false; });
    };

    photoBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { UI.toast('Escolha um arquivo de imagem', { iconName: 'info' }); return; }
      const nextUrl = URL.createObjectURL(file);
      const pic = new Image();
      pic.onload = () => {
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = nextUrl;
        photo = pic;
        paint();
      };
      pic.onerror = () => { URL.revokeObjectURL(nextUrl); UI.toast('Não foi possível abrir essa foto', { iconName: 'info' }); };
      pic.src = nextUrl;
    });
    removeBtn.addEventListener('click', () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photo = null;
      photoUrl = null;
      paint();
    });

    footer.querySelector('[data-copy]')?.addEventListener('click', async () => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]);
        UI.toast('Imagem copiada', { iconName: 'copy' });
      } catch (e) {
        UI.toast('Este navegador não deixou copiar — use Salvar', { iconName: 'info' });
      }
    });

    body.querySelector('[data-slot="format"]').appendChild(UI.segmented(
      Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label })), format,
      (v) => { format = v; paint(); }, { label: 'Formato' }
    ));

    footer.querySelector('[data-save]')?.addEventListener('click', () => { if (blob) { download(blob, fileName(session, format)); UI.toast('Imagem salva', { iconName: 'download' }); } });
    footer.querySelector('[data-go]').addEventListener('click', async () => {
      if (!blob) return;
      if (!canShare) { download(blob, fileName(session, format)); UI.toast('Imagem salva', { iconName: 'download' }); return; }
      try {
        const file = new File([blob], fileName(session, format), { type: 'image/png' });
        await navigator.share({ files: [file], title: 'FORJA', text: `${session.name} concluído no FORJA.` });
        sheet.close('shared');
      } catch (e) {
        if (e && e.name !== 'AbortError') { download(blob, fileName(session, format)); UI.toast('Não foi possível compartilhar — imagem salva', { iconName: 'download' }); }
      }
    });

    paint();
    return sheet;
  }

  global.Share = { open, render, cardData };
})(window);
