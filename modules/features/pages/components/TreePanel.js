/**
 * TreePanel 设备树（Shadow DOM）- 模板化
 * 更新：
 *  - 暴露 whenReady()，模板加载完成后再对外可用
 *  - getFilterValues 做空节点兜底，避免空引用
 */
export function createTreePanel() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  const ready = deferred();
  let isReady = false;

  // 注入模板
  (async () => {
    try {
      const html = await fetch('/modules/features/pages/components/templates/tree-panel.html', { cache: 'no-cache' }).then(r => r.text());
      const frag = new DOMParser().parseFromString(html, 'text/html').querySelector('#tpl-tree-panel').content.cloneNode(true);
      root.appendChild(frag);
      isReady = true;
      ready.resolve(true);
      host.dispatchEvent(new Event('ready'));
    } catch (e) {
      ready.reject(e);
      // 失败也不抛出到外层，保证 host 可用
      // 但没有模板时后续渲染将是空白
    }
  })();

  function render() {
    const treeEl = root.getElementById('tree');
    if (!treeEl) return; // 模板未就绪
    const roots = buildForest(state.groupedDevices);
    const expandLevel = state.expandLevel || 2;
    const html = `
      <div class="gdt">${roots.map(r => renderUserNodeHTML(r, 1, expandLevel)).join('')}</div>
      <div class="sec">
        <div class="sec__title">未分组设备 (${state.ungroupedDevices.length})</div>
        <div class="list">
          ${state.ungroupedDevices.map(e => {
            const d = e.devInfo || {};
            const name = d.no || d.name || String(d.id || '');
            const cls = d.onlineState ? 'is-online' : 'is-offline';
            return `<div class="chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}">
              <span class="ic-dev"></span><span class="title">${escapeHTML(name)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    treeEl.innerHTML = html;
  }

  let state = { groupedDevices: [], ungroupedDevices: [], expandLevel: 2 };
  function normalizeUserInfo(ui) {
    if (!ui) return null;
    return {
      userId: ui.userId ?? ui.id,
      userName: ui.userName ?? ui.name ?? '',
      parentUserId: ui.parentUserId ?? ui.pid ?? null,
      onlineState: typeof ui.onlineState === 'boolean' ? ui.onlineState : undefined
    };
  }
  function buildForest(grouped) {
    const map = new Map();
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo);
      if (!ui || ui.userId == null) return;
      if (!map.has(ui.userId)) map.set(ui.userId, { ...ui, children: [], deviceChildren: [], isOnline: ui.onlineState });
    });
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo); const di = e.devInfo || {};
      if (!ui || ui.userId == null) return;
      const node = map.get(ui.userId); if (!node) return;
      node.deviceChildren.push({ devId: di.id, devName: di.no || di.name || String(di.id || ''), onlineState: !!di.onlineState, raw: di });
    });
    map.forEach(n => { n.children = n.children || []; });
    map.forEach(n => { const pid = n.parentUserId; if (pid != null && map.has(pid)) map.get(pid).children.push(n); });

    function calc(n) {
      if (typeof n.isOnline === 'boolean') return n.isOnline;
      let on = n.deviceChildren?.some(d => d.onlineState) || false;
      if (n.children?.length) for (const c of n.children) on = calc(c) || on;
      n.isOnline = on; return on;
    }
    map.forEach(calc);

    const roots = [];
    map.forEach(n => { if (n.parentUserId == null || !map.has(n.parentUserId)) roots.push(n); });
    return roots;
  }
  function renderUserNodeHTML(node, level, expandLevel) {
    const name = (node.userName || '').trim();
    const hasChildren = (node.children && node.children.length) || (node.deviceChildren && node.deviceChildren.length);
    const expanded = level <= expandLevel;
    const cls = node.isOnline ? 'is-online' : 'is-offline';

    if (!name) {
      return [
        ...(node.children || []).map(c => renderUserNodeHTML(c, level, expandLevel)),
        ...(node.deviceChildren || []).map(d => `
          <div class="node dev ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
            <span class="ic-dev"></span>
            <span class="title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
          </div>
        `)
      ].join('');
    }

    const head = `
      <div class="row ${cls}" data-node-type="user" data-user-id="${node.userId}">
        <span class="toggle ${hasChildren ? '' : 'is-empty'}">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
        <span class="ic-user"></span>
        <span class="title" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
      </div>`;
    const children = hasChildren ? `
      <div class="children ${expanded ? '' : 'is-collapsed'}">
        ${(node.children || []).map(c => renderUserNodeHTML(c, level + 1, expandLevel)).join('')}
        ${(node.deviceChildren || []).map(d => `
          <div class="node dev ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
            <span class="ic-dev"></span>
            <span class="title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
          </div>
        `).join('')}
      </div>` : '';
    return `<div class="node user" data-user-id="${node.userId}">${head}${children}</div>`;
  }

  // 事件（模板未就绪时也可提前绑定到 shadow root）
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.row[data-node-type="user"]');
    if (row) {
      const nodeEl = row.parentElement;
      const kids = nodeEl.querySelector(':scope > .children');
      const toggle = row.querySelector('.toggle');
      if (kids) { const collapsed = kids.classList.toggle('is-collapsed'); if (toggle) toggle.textContent = collapsed ? '▸' : '▾'; }
      return;
    }
    const devEl = e.target.closest('.node.dev,[data-devid].chip');
    if (devEl) {
      const devId = Number(devEl.getAttribute('data-devid'));
      host.dispatchEvent(new CustomEvent('deviceclick', { bubbles: true, detail: { devId } }));
    }
  });

  function setData({ groupedDevices = [], ungroupedDevices = [], expandLevel = 2, devTypes, devModes } = {}) {
    state.groupedDevices = groupedDevices;
    state.ungroupedDevices = ungroupedDevices;
    state.expandLevel = expandLevel;
    // 模板可能尚未就绪时，延后一次
    const apply = () => {
      if (devTypes) {
        const sel = root.getElementById('fltDevType');
        if (sel) {
          const cur = sel.value;
          sel.innerHTML = `<option value="0">全部</option>` + devTypes.map(t => `<option value="${t.typeId}">${t.typeName}</option>`).join('');
          sel.value = cur || '0';
        }
      }
      if (devModes) {
        const sel = root.getElementById('fltDevMode');
        if (sel) {
          const cur = sel.value;
          sel.innerHTML = `<option value="0">全部</option>` + devModes.map(m => `<option value="${m.modeId}">${m.modeName}</option>`).join('');
          sel.value = cur || '0';
        }
      }
      render();
    };
    if (isReady) apply(); else ready.promise.then(apply).catch(()=>{});
  }

  function getFilterValues() {
    // 节点不存在时提供默认值，避免空引用
    const tSel = root.getElementById('fltDevType');
    const mSel = root.getElementById('fltDevMode');
    const sInp = root.getElementById('fltSearch');
    const cChk = root.getElementById('fltOnline');
    const devType = Number((tSel && tSel.value) || '0');
    const devMode = Number((mSel && mSel.value) || '0');
    const searchStr = (sInp && sInp.value ? sInp.value.trim() : '');
    const onlyOnline = !!(cChk && cChk.checked);
    return { devType, devMode, searchStr, onlyOnline };
  }

  const controls = {
    typeSelect: () => root.getElementById('fltDevType'),
    modeSelect: () => root.getElementById('fltDevMode'),
    searchInput: () => root.getElementById('fltSearch'),
    onlyOnlineCheckbox: () => root.getElementById('fltOnline'),
  };

  function escapeHTML(str = '') { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function deferred(){ let resolve, reject; const promise = new Promise((res, rej)=>{ resolve=res; reject=rej; }); return { promise, resolve, reject }; }

  host.setData = setData;
  host.getFilterValues = getFilterValues;
  host.controls = controls;
  host.whenReady = () => ready.promise;
  host.isReady = () => isReady;

  return host;
}