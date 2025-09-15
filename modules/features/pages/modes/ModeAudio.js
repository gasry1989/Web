/**
 * 音频模式（modeId=3）
 * - 0~12 根柱；当通过 ?mockCount=12 固定为 12 根时，仍能完整显示
 * - 减小四周 padding 与字号，12 根柱全部可见
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
    window.addEventListener('resize', draw);
  })();

  let state = { labels: [], values: [], batteries: [] };
  let rafPending = false;

  function fitCanvas() {
    if (!cv) return 1;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  function draw() {
    if (!cv || !ctx) return;
    const dpr = fitCanvas();
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const n = state.values.length|0;
    // 更小的边距与字号（针对 12 根柱优化）
    const fsAxis = 9 * dpr;
    const fsBarNum = 9 * dpr;
    const fsXLabel = 10 * dpr;

    const padL = 26 * dpr, padR = 10 * dpr, padT = 8 * dpr, padB = 22 * dpr;
    const plotW = W - padL - padR, plotH = H - padT - padB;

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

    if (!n) return;

    // 间距与柱宽（12 根也可排下）
    const gap = Math.max(2 * dpr, plotW / (n * 16));
    const barW = Math.max(5 * dpr, Math.min(24 * dpr, (plotW - gap * (n + 1)) / n));
    let x = padL + gap;

    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `${fsBarNum}px Segoe UI,Arial`;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(100, Number(state.values[i]) || 0));
      const h = (v / 100) * plotH;
      const bx = x, by = padT + plotH - h;

      // 柱子
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx, by, barW, h);

      // 顶部数字：越界则柱内显示
      const topOutsideY = by - 2 * dpr;
      const topInsideY = Math.max(by + 2 * dpr, padT + 2 * dpr);
      const useInside = (by < padT + 11 * dpr);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = useInside ? 'top' : 'bottom';
      ctx.fillText(String(Math.round(v)), bx + barW / 2, useInside ? topInsideY : topOutsideY);

      x += barW + gap;
    }

    // X 轴标签与电量
    x = padL + gap;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.font = `${fsXLabel}px Segoe UI,Arial`;
    for (let i = 0; i < n; i++) {
      const label = state.labels[i] != null ? String(state.labels[i]) : String(i + 1);
      ctx.fillText(label, x + barW / 2, padT + plotH + 3 * dpr);

      const p = Math.max(0, Math.min(100, Number(state.batteries[i]) || 0));
      const ew = Math.max(9 * dpr, Math.min(barW, 18 * dpr));
      const ex = x + (barW - ew) / 2;
      const ey = padT + plotH + 16 * dpr;
      ctx.fillStyle = '#2eff67'; ctx.fillRect(ex, ey, ew * (p / 100), 4 * dpr);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeRect(ex, ey, ew, 4 * dpr);

      x += barW + gap;
    }
  }

  async function setData(d) {
    await tplReady;
    const labels = Array.isArray(d?.labels) ? d.labels.slice(0, MAX_BARS) : Array.from({ length: (d?.values?.length || 0) }, (_, i) => i + 1);
    const values = Array.isArray(d?.values) ? d.values.slice(0, MAX_BARS) : [];
    const batteries = Array.isArray(d?.batteries) ? d.batteries.slice(0, MAX_BARS) : new Array(values.length).fill(100);

    const n = Math.min(labels.length, values.length, batteries.length);
    state = { labels: labels.slice(0,n), values: values.slice(0,n), batteries: batteries.slice(0,n) };
    if (emptyEl) emptyEl.style.display = (n === 0) ? 'flex' : 'none';

    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); }
  }

  function start() {}
  function destroy() {
    try { window.removeEventListener('resize', draw); } catch {}
    try { host.remove(); } catch {}
  }

  return { el: host, start, setData, destroy, __devId: devId, __modeId: 3 };
}