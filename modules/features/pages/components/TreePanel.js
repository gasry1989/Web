/**
 * TreePanel 设备树（Shadow DOM）- 模板化
 * 更新：
 *  - 暴露 whenReady()，模板加载完成后再对外可用
 *  - getFilterValues 做空节点兜底，避免空引用
 *  - 自动监听筛选控件变更并重渲染；仅显示在线过滤在渲染期生效
 *  - NEW: “未分组设备”支持点击标题折叠/展开（状态保存在本地 state）
 */
export function createTreePanel() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  const ready = deferred();
  let isReady = false;

  function onFilterChanged(e) {
    const t = e && e.target;
    if (!t || !t.id) return;
    const ids = new Set(['fltDevType', 'fltDevMode', 'fltSearch', 'fltOnline']);
    if (!ids.has(t.id)) return;
    host.dispatchEvent(new CustomEvent('filterchange', {
      bubbles: true,
      detail: getFilterValues()
    }));
    render();
  }

  (async () => {
    try {
      const html = await fetch('/modules/features/pages/components/tree-panel.html', { cache: 'no-cache' }).then(r => r.text());
      const frag = new DOMParser().parseFromString(html, 'text/html').querySelector('#tpl-tree-panel').content.cloneNode(true);
      root.appendChild(frag);

      root.addEventListener('input', onFilterChanged);
      root.addEventListener('change', onFilterChanged);

      isReady = true;
      ready.resolve(true);
      host.dispatchEvent(new Event('ready'));
    } catch (e) {
      ready.reject(e);
    }
  })();

  function render() {
    const treeEl = root.getElementById('tree');
    if (!treeEl) return;

    // 修正：getFilterValues 返回的是 filterOnline
    const { filterOnline } = getFilterValues();
    const onlyOnline = filterOnline;

    const roots = buildForest(state.groupedDevices);
    const expandLevel = state.expandLevel || 2;

    const ungrouped = onlyOnline
      ? state.ungroupedDevices.filter(e => !!(e.devInfo && e.devInfo.onlineState))
      : state.ungroupedDevices;

    const secCls = state.ungroupedCollapsed ? 'is-collapsed' : '';
    const html = `
      <div class="gdt">${roots.map(r => renderUserNodeHTML(r, 1, expandLevel, onlyOnline)).join('')}</div>
      <div class="sec ${secCls}">
        <div class="sec__title">未分组设备 (${ungrouped.length})</div>
        <div class="list">
          ${ungrouped.map(e => {
            const d = e.devInfo || {};
            // 改为显示设备名称优先
            const name = d.name || d.no || String(d.id || '');
            const cls = d.onlineState ? 'is-online' : 'is-offline';
            return `<div class="chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}">
              <span class="ic-dev"></span><span class="title">${escapeHTML(name)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    treeEl.innerHTML = html;
  }

  let state = { groupedDevices: [], ungroupedDevices: [], expandLevel: 2, ungroupedCollapsed: false };

  function normalizeUserInfo(ui) {
    if (!ui) return null;
    return {
      userId: ui.userId ?? ui.id,
      userName: ui.userName ?? ui.name ?? '',
      parentUserId: ui.parentUserId ?? ui.pid ?? null,
      parentUserName: ui.parentUserName ?? '',
      rootUserName: ui.rootUserName ?? '',
      onlineState: typeof ui.onlineState === 'boolean' ? ui.onlineState : undefined
    };
  }

  function buildForest(grouped) {
    const map = new Map();

    // 1) 先为每个“出现过的 userId”建节点
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo);
      if (!ui || ui.userId == null) return;
      if (!map.has(ui.userId)) {
        map.set(ui.userId, {
          userId: ui.userId,
          userName: ui.userName,
          parentUserId: ui.parentUserId,
          children: [],
          deviceChildren: [],
          isOnline: ui.onlineState
        });
      }
    });

    // 2) 为“缺失的父账号”创建占位父节点（父账号自己可能没有设备）
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo);
      if (!ui) return;
      const pid = ui.parentUserId;
      if (pid != null && !map.has(pid)) {
        map.set(pid, {
          userId: pid,
          userName: ui.parentUserName || ui.rootUserName || String(pid),
          parentUserId: null, // 无更上层信息，置空
          children: [],
          deviceChildren: [],
          isOnline: undefined
        });
      }
    });

    // 3) 设备挂载到其所属用户节点
    grouped.forEach(e => {
      const ui = normalizeUserInfo(e.userInfo);
      const di = e.devInfo || {};
      if (!ui || ui.userId == null) return;
      const node = map.get(ui.userId);
      if (!node) return;
      node.deviceChildren.push({
        devId: di.id,
        // 改为显示设备名称优先
        devName: di.name || di.no || String(di.id || ''),
        onlineState: !!di.onlineState,
        raw: di
      });
    });

    // 4) 父子挂接
    map.forEach(n => { n.children = n.children || []; });
    map.forEach(n => {
      const pid = n.parentUserId;
      if (pid != null && map.has(pid)) {
        map.get(pid).children.push(n);
      }
    });

    // 5) 在线态向上聚合
    function calc(n) {
      if (typeof n.isOnline === 'boolean') return n.isOnline;
      let on = n.deviceChildren?.some(d => d.onlineState) || false;
      if (n.children?.length) for (const c of n.children) on = calc(c) || on;
      n.isOnline = on;
      return on;
    }
    map.forEach(calc);

    // 6) 根：无父 或 父不存在于 map
    const roots = [];
    map.forEach(n => {
      if (n.parentUserId == null || !map.has(n.parentUserId)) roots.push(n);
    });
    return roots;
  }

  function renderUserNodeHTML(node, level, expandLevel, onlyOnline = false) {
    if (onlyOnline && !node.isOnline) return '';

    const name = (node.userName || '').trim();
    const expanded = level <= expandLevel;
    const cls = node.isOnline ? 'is-online' : 'is-offline';

    if (!name) {
      const childHTML = (node.children || []).map(c => renderUserNodeHTML(c, level, expandLevel, onlyOnline)).join('');
      const devHTML = ((node.deviceChildren || []).filter(d => !onlyOnline || d.onlineState)).map(d => `
          <div class="node dev ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
            <span class="ic-dev"></span>
            <span class="title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
          </div>
        `).join('');
      return childHTML + devHTML;
    }

    const childrenUsersHTML = (node.children || []).map(c => renderUserNodeHTML(c, level + 1, expandLevel, onlyOnline)).join('');
    const devicesHTML = ((node.deviceChildren || []).filter(d => !onlyOnline || d.onlineState)).map(d => `
          <div class="node dev ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
            <span class="ic-dev"></span>
            <span class="title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
          </div>
        `).join('');
    const hasChildren = !!(childrenUsersHTML || devicesHTML);

    const head = `
      <div class="row ${cls}" data-node-type="user" data-user-id="${node.userId}">
        <span class="toggle ${hasChildren ? '' : 'is-empty'}">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
        <span class="ic-user"></span>
        <span class="title" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
      </div>`;
    const children = hasChildren ? `
      <div class="children ${expanded ? '' : 'is-collapsed'}">
        ${childrenUsersHTML}${devicesHTML}
      </div>` : '';
    return `<div class="node user" data-user-id="${node.userId}">${head}${children}</div>`;
  }

  // 事件
  root.addEventListener('click', (e) => {
    // 切换“未分组设备”折叠
    const secTitle = e.target.closest('.sec__title');
    if (secTitle) {
      state.ungroupedCollapsed = !state.ungroupedCollapsed;
      render();
      return;
    }

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
    const tSel = root.getElementById('fltDevType');
    const mSel = root.getElementById('fltDevMode');
    const sInp = root.getElementById('fltSearch');
    const cChk = root.getElementById('fltOnline');
    const devType = Number((tSel && tSel.value) || '0');
    const devMode = Number((mSel && mSel.value) || '0');
    const searchStr = (sInp && sInp.value ? sInp.value.trim() : '');
    const filterOnline = !!(cChk && cChk.checked);
    return { devType, devMode, searchStr, filterOnline };
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