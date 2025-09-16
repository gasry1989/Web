/**
 * 倾角模式（modeId=1）
 * - 行高固定为容器高度的 1/12
 * - 空轨道纯黑显示（不渲染行时底部自然留空）
 */
export function createModeTilt({ devId } = {}) {
  const MAX_ITEMS = 12;
  const TOTAL_ROWS = 12;

  const host = document.createElement('div');
  host.style.alignSelf = 'stretch';
  host.style.width = '100%';
  host.style.height = '100%';

  const root = host.attachShadow({ mode: 'open' });

  let wrapEl = null, listEl = null, emptyEl = null, ro = null;

  const tplReady = (async () => {
    const html = await fetch('/modules/features/pages/modes/mode-tilt.html', { cache: 'no-cache' }).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = doc.querySelector('#tpl-mode-tilt').content.cloneNode(true);
    root.appendChild(frag);
    wrapEl = root.querySelector('.wrap');
    listEl = root.getElementById('list');
    emptyEl = root.getElementById('empty');

    ro = new ResizeObserver(()=> applySizing());
    ro.observe(wrapEl);
    applySizing();
  })();

  const ICON_BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#2eff67"><circle cx="12" cy="7" r="5"/><rect x="9" y="12" width="6" height="5" rx="1"/><rect x="10" y="18" width="4" height="2" rx="1"/></g></svg>';
  const ICON_SIREN = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.0"><circle cx="12" cy="12" r="4"/><path d="M5 12a7 7 0 0 1 7-7M19 12a7 7 0 0 0-7 7"/><path d="M2.5 12a9.5 9.5 0 0 1 9.5-9.5M21.5 12A9.5 9.5 0 0 0 12 21.5"/></g></svg>';

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function applySizing() {
    if (!wrapEl) return;
    const H = wrapEl.getBoundingClientRect().height;
    const gapY = 1;
    const rowH = (H - gapY * (TOTAL_ROWS - 1)) / TOTAL_ROWS;

    const fs = clamp(rowH * 0.42, 8, 15);
    const icon = clamp(rowH * 0.58, 10, 18);
    const battH = clamp(rowH * 0.36, 6, 12);
    const battW = clamp(rowH * 1.35, 24, 44);
    const capW = clamp(battH * 0.38, 2.5, 5.5);
    const capH = clamp(battH * 0.78, 3, 8);
    const hgap = clamp(rowH * 0.35, 6, 14);

    host.style.setProperty('--fs', fs + 'px');
    host.style.setProperty('--icon', icon + 'px');
    host.style.setProperty('--batt-h', battH + 'px');
    host.style.setProperty('--batt-w', battW + 'px');
    host.style.setProperty('--cap-w', capW + 'px');
    host.style.setProperty('--cap-h', capH + 'px');
    host.style.setProperty('--hgap', hgap + 'px');
  }

  function makeRow() {
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('div'); name.className = 'name';
    const bulb = document.createElement('span'); bulb.className = 'icon bulb'; bulb.innerHTML = ICON_BULB;
    const siren = document.createElement('span'); siren.className = 'icon siren'; siren.innerHTML = ICON_SIREN;
    const deg = document.createElement('div'); deg.className = 'deg';
    const batt = document.createElement('div'); batt.className = 'batt';
    const fill = document.createElement('div'); fill.className = 'fill'; batt.appendChild(fill);
    row.append(name, bulb, siren, deg, batt);
    return { row, name, bulb, siren, deg, batt, fill };
  }

  let rows = [];
  function render(items) {
    if (!listEl || !emptyEl) return;
    const n = items.length|0;
    emptyEl.style.display = n === 0 ? 'flex' : 'none';

    if (rows.length !== n) {
      listEl.innerHTML = '';
      rows = items.map(() => makeRow());
      rows.forEach(r => listEl.appendChild(r.row));
      applySizing();
    }
    for (let i = 0; i < n; i++) {
      const it = items[i], r = rows[i];
      r.name.textContent = it.name || `倾角${i + 1}#`;
      r.deg.textContent = (Number(it.deg) || 0).toFixed(1) + '°';
      const p = Math.max(0, Math.min(100, Number(it.batt) || 0)) / 100;
      r.fill.style.transform = `scaleX(${p})`;
      r.bulb.classList.toggle('muted', it.alarmOn === false);
      r.siren.classList.toggle('muted', it.sirenOn === false);
    }
  }

  async function setData(data) {
    await tplReady;
    const items = Array.isArray(data?.items) ? data.items.slice(0, MAX_ITEMS) : [];
    render(items);
  }

  function start() {}
  function destroy() { try { ro?.disconnect(); } catch {} try { host.remove(); } catch {} }

  return { el: host, start, setData, destroy, __devId: devId, __modeId: 1 };
}