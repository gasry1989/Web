/**
 * TreePanel 设备树（Shadow DOM）
 * 变更要点：
 * - 不再创建任何“占位父节点”，严格使用接口返回的 userInfo 列表构树
 * - 渲染时，userName 为空则“跳过该层”，把其子用户与设备直接提升到同级（不显示“未命名用户”）
 * - 在线=白色，离线=灰色，分组设备与未分组设备保持一致
 */
export function createTreePanel() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
  :host { all: initial; contain: content; }
  *, *::before, *::after { box-sizing: border-box; }
  .wrap {
    --panel-bg:#0f1720; --panel-line:rgba(255,255,255,.08);
    --text:#cfd8dc; --text-dim:#9fb1bb; --on:#ffffff; --off:#7a8a93;
    --dev-on-bg:linear-gradient(135deg,#5aa0ff,#3d89ff);
    --dev-off-bg:#5b6b78;
    height:100%; display:flex; flex-direction:column; background:var(--panel-bg); color:var(--text);
  }
  .filters { padding:8px 10px; border-bottom:1px solid var(--panel-line); }
  .filters label { color:var(--text-dim); display:flex; align-items:center; gap:6px; }
  .filters .row { display:grid; grid-template-columns:1fr; gap:6px; }
  .filters input[type="text"], .filters select {
    width:100%; background:#0b121a; color:var(--text); border:1px solid var(--panel-line); border-radius:4px; padding:4px 6px;
  }
  .filters .chk { display:flex; align-items:center; gap:6px; white-space:nowrap; justify-content:flex-start; }
  .filters .btn { padding:4px 10px; border:1px solid var(--panel-line); background:#122133; color:#cfd8dc; border-radius:4px; cursor:pointer; }

  .tree { flex:1 1 auto; overflow:auto; }
  .gdt { padding:6px 8px; min-width:100%; width:max-content; }
  .node + .node { margin-top:6px; }
  .row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none; }
  .row:hover { background:#0e1a24; }
  .toggle { width:16px; text-align:center; color:#9fb1bb; }
  .toggle.is-empty { visibility:hidden; }
  .ic-user { display:none; }
  .ic-dev { width:12px; height:12px; border-radius:2px; display:inline-block; background:var(--dev-on-bg); }
  .title { white-space:nowrap; }
  .row.is-online .title { color:var(--on); }
  .row.is-offline .title { color:var(--off); }

  .children { margin-left:18px; border-left:1px dashed rgba(255,255,255,.12); padding-left:10px; }
  .children.is-collapsed { display:none; }

  /* 分组设备在线/离线颜色 */
  .node.dev.is-online .title { color:var(--on); }
  .node.dev.is-offline .title { color:var(--off); }
  .node.dev.is-online .ic-dev { background:var(--dev-on-bg); }
  .node.dev.is-offline .ic-dev { background:var(--dev-off-bg); }

  .sec { margin:8px 8px 12px; }
  .sec__title { font-weight:600; padding:6px 8px; color:#e1edf7; background:#10212e; border-radius:4px; border:1px solid rgba(255,255,255,.08); }
  .list { padding:6px 8px; display:flex; flex-direction:column; gap:4px; }
  .chip { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:4px; cursor:pointer; }
  .chip:hover { background:#15202b; border:1px solid rgba(255,255,255,.08); }
  .chip .ic-dev { width:12px; height:12px; border-radius:2px; }
  .chip.is-online .title { color:var(--on); }
  .chip.is-offline .title { color:var(--off); }
  .chip.is-online .ic-dev { background:var(--dev-on-bg); }
  .chip.is-offline .ic-dev { background:var(--dev-off-bg); }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="filters">
      <div class="row">
        <label>设备类型：<select id="fltDevType"><option value="0">全部</option></select></label>
        <label>设备模式：<select id="fltDevMode"><option value="0">全部</option></select></label>
        <label>名称/编号：<input id="fltSearch" placeholder="模糊搜索"/></label>
        <label class="chk"><input type="checkbox" id="fltOnline"/> 仅显示在线</label>
        <button class="btn" id="btnRefresh">刷新</button>
      </div>
    </div>
    <div class="tree" id="tree"></div>
  `;
  root.append(style, wrap);

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

  // 严格按接口返回构树：不造“占位父节点”
  function buildForest(grouped) {
    const map = new Map();
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo);
      if (!ui || ui.userId == null) return;
      if (!map.has(ui.userId)) map.set(ui.userId, { ...ui, children: [], deviceChildren: [], isOnline: ui.onlineState });
    });
    // 设备挂载到对应用户
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo); const di = e.devInfo || {};
      if (!ui || ui.userId == null) return;
      const node = map.get(ui.userId); if (!node) return;
      node.deviceChildren.push({ devId: di.id, devName: di.no || di.name || String(di.id || ''), onlineState: !!di.onlineState, raw: di });
    });
    // 子用户（仅当父存在时才挂）
    map.forEach(n => { n.children = n.children || []; });
    map.forEach(n => { const pid = n.parentUserId; if (pid != null && map.has(pid)) map.get(pid).children.push(n); });

    // 在线计算（保留原有规则）
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

  function render() {
    const treeEl = root.getElementById('tree');
    const roots = buildForest(state.groupedDevices);
    const expandLevel = state.expandLevel || 2;
    const html = `
      <div class="gdt">${roots.map(r => renderUserNodeHTML(r, 1, expandLevel)).join('')}</div>
      <div class="sec">
        <div class="sec__title">未分组设备 (${state.ungroupedDevices.length})</div>
        <div class="list">
          ${state.ungroupedDevices.map(e => {
            const d = e.devInfo || {}; const name = d.no || d.name || String(d.id || ''); const cls = d.onlineState ? 'is-online' : 'is-offline';
            return `<div class="chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}">
              <span class="ic-dev"></span><span class="title">${escapeHTML(name)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    treeEl.innerHTML = html;
  }

  // 渲染：userName 为空 => 跳过该层，直接渲染其子用户与设备（不显示“未命名用户”）
  function renderUserNodeHTML(node, level, expandLevel) {
    const name = (node.userName || '').trim();
    const hasChildren = (node.children && node.children.length) || (node.deviceChildren && node.deviceChildren.length);
    const expanded = level <= expandLevel;
    const cls = node.isOnline ? 'is-online' : 'is-offline';

    if (!name) {
      // 不渲染用户行，直接把内容提升到同级
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
    if (devTypes) {
      const sel = root.getElementById('fltDevType');
      const cur = sel.value;
      sel.innerHTML = `<option value="0">全部</option>` + devTypes.map(t => `<option value="${t.typeId}">${t.typeName}</option>`).join('');
      sel.value = cur || '0';
    }
    if (devModes) {
      const sel = root.getElementById('fltDevMode');
      const cur = sel.value;
      sel.innerHTML = `<option value="0">全部</option>` + devModes.map(m => `<option value="${m.modeId}">${m.modeName}</option>`).join('');
      sel.value = cur || '0';
    }
    render();
  }

  function getFilterValues() {
    const devType = Number(root.getElementById('fltDevType').value || '0');
    const devMode = Number(root.getElementById('fltDevMode').value || '0');
    const searchStr = root.getElementById('fltSearch').value.trim();
    const onlyOnline = root.getElementById('fltOnline').checked;
    return { devType, devMode, searchStr, onlyOnline };
  }

  const controls = {
    refreshBtn: () => root.getElementById('btnRefresh'),
    typeSelect: () => root.getElementById('fltDevType'),
    modeSelect: () => root.getElementById('fltDevMode'),
    searchInput: () => root.getElementById('fltSearch'),
    onlyOnlineCheckbox: () => root.getElementById('fltOnline'),
  };

  function escapeHTML(str = '') { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  host.setData = setData;
  host.getFilterValues = getFilterValues;
  host.controls = controls;

  return host;
}