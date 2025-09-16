/**
 * 音频模式（modeId=3）
 * - 始终渲染 12 根柱（不足补 0），保证 12 等分视觉
 * - 横向柱宽/间距按可用宽度等比计算，刚好铺满（不留大块空白）
 */
export function createModeAudio({ devId } = {}) {
  const MAX_BARS = 12;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  let cv = null, ctx = null, emptyEl = null;
  const tplReady = (async () => {
    const html = await fetch('/modules/features/pages/modes/mode-audio.html', { cache: 'no-cache' }).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = doc.querySelector('#tpl-mode-audio').content.cloneNode(true);
    root.appendChild(frag);
    cv = root.getElementById('cv');
    emptyEl = root.getElementById('empty');
    ctx = cv.getContext('2d');
    draw();
    window.addEventListener('resize', onResize, { passive:true });
  })();

  let state = {
    labels: Array.from({ length: MAX_BARS }, (_, i) => i + 1),
    values: new Array(MAX_BARS).fill(0),
    batteries: new Array(MAX_BARS).fill(0)
  };
  let rafPending = false;

  function onResize(){ if (!rafPending){ rafPending=true; requestAnimationFrame(()=>{ rafPending=false; draw(); }); } }

  function fitCanvas() {
    if (!cv) return 1;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // 限 2x 防过大
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  function draw() {
    if (!cv || !ctx) return;
    const dpr = fitCanvas();
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const n = MAX_BARS;

    // 边距与字号（针对 12 根柱优化）
    const fsAxis = 9 * dpr;
    const fsBarNum = 9 * dpr;
    const fsXLabel = 10 * dpr;

    const padL = 28 * dpr, padR = 10 * dpr, padT = 8 * dpr, padB = 24 * dpr;
    const plotW = Math.max(1, W - padL - padR), plotH = Math.max(1, H - padT - padB);

    // 边框与水平网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.stroke();

    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = `${fsAxis}px Segoe UI,Arial`;
    for (let y = 0; y <= 100; y += 20) {
      const yy = padT + plotH - (y / 100) * plotH;
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(String(y), padL - 5 * dpr, yy);
    }

    // —— 横向均分：先给一个最小间距，再用剩余宽度均分柱宽 —— //
    let gap = Math.max(3 * dpr, Math.floor(plotW / (n * 24))); // 最小间距随宽度缩放
    let barW = Math.floor((plotW - gap * (n + 1)) / n);
    if (barW < 3 * dpr) { // 极窄容器兜底
      barW = 3 * dpr;
      gap = Math.max(2 * dpr, Math.floor((plotW - barW * n) / (n + 1)));
    }
    const usedW = barW * n + gap * (n + 1);
    const leftover = Math.max(0, plotW - usedW);
    let x = padL + gap + Math.floor(leftover / 2); // 居中微调，避免右侧大块空白

    // 柱子与顶部数值
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `${fsBarNum}px Segoe UI,Arial`;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(100, Number(state.values[i]) || 0));
      const h = (v / 100) * plotH;
      const bx = x, by = padT + plotH - h;

      // 柱子（固定白色）
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx, by, barW, h);

      // 顶部数字：太靠上时放入柱内
      const topOutsideY = by - 2 * dpr;
      const topInsideY = Math.max(by + 2 * dpr, padT + 2 * dpr);
      const useInside = (by < padT + 11 * dpr);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = useInside ? 'top' : 'bottom';
      ctx.fillText(String(Math.round(v)), bx + barW / 2, useInside ? topInsideY : topOutsideY);

      x += barW + gap;
    }

    // X 轴标签与电量
    x = padL + gap + Math.floor(leftover / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.font = `${fsXLabel}px Segoe UI,Arial}`;
    for (let i = 0; i < n; i++) {
      const label = state.labels[i] != null ? String(state.labels[i]) : String(i + 1);
      ctx.fillText(label, x + barW / 2, padT + plotH + 3 * dpr);

      const p = Math.max(0, Math.min(100, Number(state.batteries[i]) || 0));
      const ew = Math.max(9 * dpr, Math.min(barW, 28 * dpr));
      const ex = x + (barW - ew) / 2;
      const ey = padT + plotH + 16 * dpr;
      ctx.fillStyle = '#2eff67'; ctx.fillRect(ex, ey, ew * (p / 100), 4 * dpr);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeRect(ex, ey, ew, 4 * dpr);

      x += barW + gap;
    }
  }

  // 始终归一化到 12 根：不足补 0，超出截断
  async function setData(d) {
    await tplReady;
    const rawValues = Array.isArray(d?.values) ? d.values.slice(0, MAX_BARS) : [];
    const rawLabels = Array.isArray(d?.labels) ? d.labels.slice(0, MAX_BARS) : [];
    const rawBatt   = Array.isArray(d?.batteries) ? d.batteries.slice(0, MAX_BARS) : [];

    const values = new Array(MAX_BARS).fill(0);
    const labels = new Array(MAX_BARS).fill(0).map((_, i) => (rawLabels[i] != null ? rawLabels[i] : i + 1));
    const batteries = new Array(MAX_BARS).fill(0);

    for (let i = 0; i < MAX_BARS; i++) {
      if (i < rawValues.length) values[i] = Number(rawValues[i]) || 0;
      if (i < rawBatt.length)   batteries[i] = Number(rawBatt[i]) || 0;
    }

    state = { labels, values, batteries };
    if (emptyEl) {
      const hasAny = rawValues.length > 0;
      emptyEl.style.display = hasAny ? 'none' : 'flex';
    }
    onResize();
  }

  function start() {}
  function destroy() {
    try { window.removeEventListener('resize', onResize); } catch {}
    try { host.remove(); } catch {}
  }

  return { el: host, start, setData, destroy, __devId: devId, __modeId: 3 };
}