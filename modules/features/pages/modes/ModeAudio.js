/**
 * 音频模式（modeId=3）— 只渲染，不发 WS/不定时
 * - 绘图区下移，柱顶数字不裁剪
 * - 最小柱宽 8px，适配 0~5 台
 * - 无设备时显示“无探头”
 */
export function createModeAudio({ devId } = {}) {
  const TAG = `[ModeAudio#${devId ?? '-'}]`;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  console.info(TAG, 'create');

  let cv = null, ctx = null, emptyEl = null;
  const tplReady = (async () => {
    const html = await fetch('/modules/features/pages/modes/mode-audio.html', { cache: 'no-cache' }).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = doc.querySelector('#tpl-mode-audio').content.cloneNode(true);
    root.appendChild(frag);
    cv = root.getElementById('cv');
    emptyEl = root.getElementById('empty');
    ctx = cv.getContext('2d');
    draw(); // 初始清屏
    window.addEventListener('resize', draw);
    console.info(TAG, 'template loaded');
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

    const padL = 36 * dpr, padR = 20 * dpr, padT = 16 * dpr, padB = 36 * dpr;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    // 框与网格
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.stroke();

    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = `${12 * dpr}px Segoe UI,Arial`;
    for (let y = 0; y <= 100; y += 20) {
      const yy = padT + plotH - (y / 100) * plotH;
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(String(y), padL - 6 * dpr, yy);
    }

    const n = state.values.length|0;
    if (!n) return; // 无柱时仅显示坐标框，"无探头"由 overlay 呈现

    const gap = Math.max(6 * dpr, plotW / (n * 4));
    const barW = Math.min(40 * dpr, Math.max(8 * dpr, (plotW - gap * (n + 1)) / n));
    let x = padL + gap;

    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `${12 * dpr}px Segoe UI,Arial`;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(100, Number(state.values[i]) || 0));
      const h = (v / 100) * plotH;
      const bx = x, by = padT + plotH - h;

      // 柱
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx, by, barW, h);

      // 智能数字位置
      const topOutsideY = by - 4 * dpr;
      const topInsideY = Math.max(by + 2 * dpr, padT + 2 * dpr);
      const useInside = (by < padT + 14 * dpr);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = useInside ? 'top' : 'bottom';
      ctx.fillText(String(Math.round(v)), bx + barW / 2, useInside ? topInsideY : topOutsideY);

      x += barW + gap;
    }

    // X 标签与电量绿块
    x = padL + gap;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.font = `${14 * dpr}px Segoe UI,Arial`;
    for (let i = 0; i < n; i++) {
      const label = state.labels[i] != null ? String(state.labels[i]) : String(i + 1);
      ctx.fillText(label, x + barW / 2, padT + plotH + 6 * dpr);

      const p = Math.max(0, Math.min(100, Number(state.batteries[i]) || 0));
      const ew = Math.max(12 * dpr, Math.min(barW, 26 * dpr));
      const ex = x + (barW - ew) / 2;
      const ey = padT + plotH + 20 * dpr;
      ctx.fillStyle = '#2eff67'; ctx.fillRect(ex, ey, ew * (p / 100), 6 * dpr);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeRect(ex, ey, ew, 6 * dpr);

      x += barW + gap;
    }
  }

  async function setData(d) {
    await tplReady;
    const labels = Array.isArray(d?.labels) ? d.labels : Array.from({ length: (d?.values?.length || 0) }, (_, i) => i + 1);
    const values = Array.isArray(d?.values) ? d.values : [];
    const batteries = Array.isArray(d?.batteries) ? d.batteries : new Array(d?.values?.length || 0).fill(100);

    state = { labels, values, batteries };
    if (emptyEl) emptyEl.style.display = (values.length === 0) ? 'flex' : 'none';

    console.info(TAG, 'setData bars:', state.values.length, 'first:', state.values[0]);
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; draw(); });
    }
  }

  function start() { console.info(TAG, 'start (no timers, wait external feed)'); }
  function destroy() {
    try { window.removeEventListener('resize', draw); } catch {}
    try { host.remove(); } catch {}
    console.info(TAG, 'destroy');
  }

  return { el: host, start, setData, destroy, __devId: devId, __modeId: 3 };
}