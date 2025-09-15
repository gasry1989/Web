/**
 * 位移·倾角模式（modeId=2）— 只渲染，不发 WS/不定时
 */
export function createModeDispTilt({ devId } = {}) {
  const TAG = `[ModeDispTilt#${devId ?? '-'}]`;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  console.info(TAG, 'create');

  let listEl = null;
  const tplReady = (async () => {
    const html = await fetch('/modules/features/pages/modes/mode-disp-tilt.html', { cache: 'no-cache' }).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = doc.querySelector('#tpl-mode-disp-tilt').content.cloneNode(true);
    root.appendChild(frag);
    listEl = root.getElementById('list');
    console.info(TAG, 'template loaded');
  })();

  const ICON_SIREN = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M5 12a7 7 0 0 1 7-7M19 12a7 7 0 0 0-7 7"/><path d="M2.5 12a9.5 9.5 0 0 1 9.5-9.5M21.5 12A9.5 9.5 0 0 0 12 21.5"/></g></svg>';

  function makeRow() {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('div'); lab.className = 'lab';
    const badge = document.createElement('div'); badge.className = 'badge';
    const batt = document.createElement('div'); batt.className = 'batt';
    const fill = document.createElement('div'); fill.className = 'fill'; batt.appendChild(fill);
    const siren = document.createElement('span'); siren.className = 'icon'; siren.innerHTML = ICON_SIREN;
    const val = document.createElement('div'); val.className = 'val';
    row.append(lab, badge, batt, siren, val);
    return { row, lab, badge, batt, fill, siren, val };
  }

  let rows = [];
  function render(items) {
    if (!listEl) return;
    if (rows.length !== items.length) {
      listEl.innerHTML = '';
      rows = items.map(() => makeRow());
      rows.forEach(r => listEl.appendChild(r.row));
      console.info(TAG, 'rows rebuilt:', rows.length);
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i], r = rows[i];
      r.lab.textContent = it.type || '位移';
      r.badge.textContent = it.badge != null ? it.badge : 0;
      const p = Math.max(0, Math.min(100, Number(it.batt) || 0)) / 100;
      r.fill.style.transform = `scaleX(${p})`;
      r.siren.style.opacity = it.sirenOn === false ? 0.3 : 0.95;
      r.val.textContent = String(it.valueText || '');
      r.val.classList.toggle('wave', it.type === '倾角');
    }
  }

  async function setData(data) {
    await tplReady;
    const items = Array.isArray(data?.items) ? data.items : [];
    console.info(TAG, 'setData items:', items.length, items[0] || '');
    render(items);
  }

  function start() { console.info(TAG, 'start (no timers, wait external feed)'); }
  function destroy() { try { host.remove(); } catch {} console.info(TAG, 'destroy'); }

  return { el: host, start, setData, destroy, __devId: devId, __modeId: 2 };
}