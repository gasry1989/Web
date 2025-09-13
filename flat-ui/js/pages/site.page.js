/**
 * Site Page Controller
 * Extracted from modules/features/pages/SitePage.js
 * Preserves original business logic with standalone HTML
 */

window.SitePage = (function() {
    'use strict';

    let rootEl = null;
    let state = {
        filters: { devType: '', devMode: '', filterOnline: false, searchStr: '' },
        devices: { grouped: [], ungrouped: [] },
        loading: false
    };

    const mediaSlots = Array.from({ length: 6 }, (_, i) => ({ idx: i, type: null, inst: null }));

    // Mock data
    const mockDeviceTypes = [
        { devTypeId: 1, typeName: '摄像头' },
        { devTypeId: 2, typeName: '传感器' },
        { devTypeId: 3, typeName: '控制器' }
    ];

    const mockDeviceModes = [
        { devModeId: 1, modeName: '实时监控' },
        { devModeId: 2, modeName: '录像回放' },
        { devModeId: 3, modeName: '报警模式' }
    ];

    const mockDevices = [
        {
            devInfo: {
                id: 1,
                name: '前门摄像头',
                no: 'CAM001',
                onlineState: true,
                typeName: '摄像头',
                modeList: [{ modeId: 1, modeName: '实时监控' }, { modeId: 2, modeName: '录像回放' }],
                location: { lat: 22.5431, lng: 114.0579 }
            },
            userInfo: { userId: 1, userName: 'admin' },
            groupName: '一楼设备'
        },
        {
            devInfo: {
                id: 2,
                name: '温度传感器',
                no: 'TEMP001',
                onlineState: false,
                typeName: '传感器',
                modeList: [{ modeId: 3, modeName: '报警模式' }],
                location: { lat: 22.5441, lng: 114.0589 }
            },
            userInfo: { userId: 2, userName: 'user1' },
            groupName: '二楼设备'
        }
    ];

    const mockSummary = {
        stateList: [
            { typeName: '摄像头', total: 10, onlineCount: 8 },
            { typeName: '传感器', total: 5, onlineCount: 3 },
            { typeName: '控制器', total: 3, onlineCount: 2 }
        ]
    };

    const mockNotifications = [
        { time: Date.now() - 300000, uname: 'user1', online: true },
        { time: Date.now() - 600000, uname: 'user2', online: false },
        { time: Date.now() - 900000, uname: 'admin', online: true }
    ];

    // Mock API functions
    const apiDevTypes = async () => ({ devTypeList: mockDeviceTypes });
    const apiDevModes = async () => ({ devModeList: mockDeviceModes });
    const apiGroupedDevices = async (filters) => ({ devList: filterDevices(mockDevices.filter(d => d.groupName), filters) });
    const apiUngroupedDevices = async (filters) => ({ devList: filterDevices(mockDevices.filter(d => !d.groupName), filters) });
    const apiDeviceSummary = async () => mockSummary;
    const apiOnlineList = async () => ({ list: mockNotifications });
    const apiDeviceInfo = async (devId) => ({ devInfo: mockDevices.find(d => d.devInfo.id === devId)?.devInfo });

    function filterDevices(devices, filters) {
        return devices.filter(device => {
            const dev = device.devInfo;
            if (filters.devType && dev.typeName !== filters.devType) return false;
            if (filters.devMode && !dev.modeList.some(m => m.modeName === filters.devMode)) return false;
            if (filters.filterOnline && !dev.onlineState) return false;
            if (filters.searchStr && !dev.name.toLowerCase().includes(filters.searchStr.toLowerCase()) && 
                !dev.no.toLowerCase().includes(filters.searchStr.toLowerCase())) return false;
            return true;
        });
    }

    function init() {
        rootEl = document.getElementById('siteRoot');
        if (!rootEl) return;

        setupMediaGrid();
        setupTreeFilters();
        initSplitter();
        bootstrapData();
    }

    function setupMediaGrid() {
        const grid = rootEl.querySelector('#mediaGrid');
        grid.innerHTML = mediaSlots.map(s => `
            <div class="sp-cell" data-idx="${s.idx}">
                <div class="sp-cell-hd">
                    <div id="mediaTitle${s.idx}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 24px);">空闲</div>
                    <button data-close="${s.idx}" title="关闭">✕</button>
                </div>
                <div id="mediaBody${s.idx}" class="sp-cell-bd">
                    <div style="color:#567;font-size:12px;">在此显示视频流或模式</div>
                </div>
            </div>
        `).join('');

        // Bind close buttons
        grid.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-close]');
            if (!btn) return;
            const idx = Number(btn.getAttribute('data-close'));
            closeSlot(idx);
        });
    }

    function setupTreeFilters() {
        const searchInput = rootEl.querySelector('#searchInput');
        const typeFilter = rootEl.querySelector('#typeFilter');
        const modeFilter = rootEl.querySelector('#modeFilter');
        const onlineFilter = rootEl.querySelector('#onlineFilter');

        // Populate filter options
        apiDevTypes().then(data => {
            typeFilter.innerHTML = '<option value="">所有类型</option>' +
                (data.devTypeList || []).map(t => `<option value="${escapeHTML(t.typeName)}">${escapeHTML(t.typeName)}</option>`).join('');
        });

        apiDevModes().then(data => {
            modeFilter.innerHTML = '<option value="">所有模式</option>' +
                (data.devModeList || []).map(m => `<option value="${escapeHTML(m.modeName)}">${escapeHTML(m.modeName)}</option>`).join('');
        });

        // Bind filter events
        const onFiltersChange = debounce(() => {
            const filters = {
                devType: typeFilter.value,
                devMode: modeFilter.value,
                filterOnline: onlineFilter.checked,
                searchStr: searchInput.value.trim()
            };
            state.filters = filters;
            reloadByFilters();
        }, 250);

        searchInput.addEventListener('input', onFiltersChange);
        typeFilter.addEventListener('change', onFiltersChange);
        modeFilter.addEventListener('change', onFiltersChange);
        onlineFilter.addEventListener('change', onFiltersChange);
    }

    function initSplitter() {
        const leftWrap = rootEl.querySelector('.sp-left');
        const splitter = rootEl.querySelector('.sp-splitter');
        const MIN = 240, MAXVW = 50;

        splitter.addEventListener('mousedown', (e) => {
            const layoutRect = rootEl.getBoundingClientRect();
            const maxPx = Math.floor(window.innerWidth * (MAXVW / 100));
            
            const glass = document.createElement('div');
            Object.assign(glass.style, {
                position: 'fixed',
                inset: '0',
                cursor: 'col-resize',
                zIndex: '2147483646',
                background: 'transparent'
            });
            document.body.appendChild(glass);

            const move = (ev) => {
                const x = (ev.clientX ?? 0) - layoutRect.left;
                const w = Math.max(MIN, Math.min(Math.round(x), maxPx));
                leftWrap.style.width = w + 'px';
                ev.preventDefault();
            };

            const end = () => {
                try { glass.remove(); } catch {}
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', end);
            };

            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', end, { once: true });
            e.preventDefault();
        });
    }

    async function bootstrapData() {
        try {
            const [types, modes, summary, notifications] = await Promise.all([
                apiDevTypes(),
                apiDevModes(),
                apiDeviceSummary(),
                apiOnlineList()
            ]);

            const [grouped, ungrouped] = await Promise.all([
                apiGroupedDevices(state.filters),
                apiUngroupedDevices(state.filters)
            ]);

            state.devices = {
                grouped: grouped.devList || [],
                ungrouped: ungrouped.devList || []
            };

            renderTree();
            renderSummary(summary);
            renderNotifications(notifications.list || []);
        } catch (e) {
            console.error('[Site] bootstrapData error', e);
        }
    }

    async function reloadByFilters() {
        try {
            const [grouped, ungrouped] = await Promise.all([
                apiGroupedDevices(state.filters),
                apiUngroupedDevices(state.filters)
            ]);

            state.devices = {
                grouped: grouped.devList || [],
                ungrouped: ungrouped.devList || []
            };

            renderTree();
        } catch (e) {
            console.error('[Site] reloadByFilters error', e);
        }
    }

    function renderTree() {
        const treeContent = rootEl.querySelector('#treeContent');
        const allDevices = [...state.devices.grouped, ...state.devices.ungrouped];
        
        if (!allDevices.length) {
            treeContent.innerHTML = '<div style="text-align: center; padding: 20px; color: #567;">暂无设备</div>';
            return;
        }

        // Group devices by groupName
        const groups = {};
        allDevices.forEach(device => {
            const groupName = device.groupName || '未分组设备';
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(device);
        });

        let html = '';
        Object.entries(groups).forEach(([groupName, devices]) => {
            html += `<div class="tree-node group" style="font-weight: bold; color: #cfd8dc;">${escapeHTML(groupName)} (${devices.length})</div>`;
            devices.forEach(device => {
                const dev = device.devInfo;
                const statusIcon = dev.onlineState ? '🟢' : '🔴';
                html += `<div class="tree-node device" data-dev-id="${dev.id}" title="${escapeHTML(dev.name)}">
                    ${statusIcon} ${escapeHTML(dev.no)} - ${escapeHTML(dev.name)}
                </div>`;
            });
        });

        treeContent.innerHTML = html;

        // Bind device click events
        treeContent.addEventListener('click', (e) => {
            const deviceNode = e.target.closest('.tree-node.device');
            if (!deviceNode) return;
            
            const devId = Number(deviceNode.getAttribute('data-dev-id'));
            openDeviceInfo(devId);
        });
    }

    function renderSummary(summary) {
        const summaryEl = rootEl.querySelector('#summaryChart');
        const list = summary?.stateList || [];
        
        summaryEl.innerHTML = list.map(item => {
            const offline = item.total - item.onlineCount;
            return `<div style="margin:6px 0;">
                <div style="font-size:12px;margin-bottom:4px;">${escapeHTML(item.typeName || '')}</div>
                <div style="display:flex;gap:4px;height:16px;">
                    <div style="flex:${item.onlineCount||0};background:#3d89ff;color:#fff;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">${item.onlineCount||0}</div>
                    <div style="flex:${offline||0};background:#324153;color:#dde;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">${offline||0}</div>
                </div>
            </div>`;
        }).join('');
    }

    function renderNotifications(list) {
        const notifyEl = rootEl.querySelector('#notifyList');
        
        notifyEl.innerHTML = (list || []).map(l => {
            const name = l.uname || l.uid;
            return `<div style="padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12px;">
                ${formatTime(l.time)} ${escapeHTML(String(name))} ${l.online ? '上线' : '下线'}
            </div>`;
        }).join('');
    }

    // Media slot functions
    function findFreeSlot() {
        const s = mediaSlots.find(s => !s.type);
        return s ? s.idx : -1;
    }

    function openVideoInSlot(devId, devNo) {
        const idx = findFreeSlot();
        if (idx === -1) {
            alert('没有可用窗口');
            return;
        }
        
        const body = document.getElementById(`mediaBody${idx}`);
        const title = document.getElementById(`mediaTitle${idx}`);
        
        // Mock video display
        body.innerHTML = '<div style="color: #4a9eff; font-size: 14px;">📹 模拟视频流</div>';
        title.textContent = `${devNo} 视频`;
        mediaSlots[idx].type = 'video';
        mediaSlots[idx].inst = { destroy: () => {} }; // Mock instance
    }

    function openModeInSlot(devId, devNo, modeId) {
        const idx = findFreeSlot();
        if (idx === -1) {
            alert('没有可用窗口');
            return;
        }
        
        const body = document.getElementById(`mediaBody${idx}`);
        const title = document.getElementById(`mediaTitle${idx}`);
        
        // Mock mode display
        body.innerHTML = '<div style="color: #52c41a; font-size: 14px;">⚙️ 模拟模式预览</div>';
        title.textContent = `${devNo} 模式`;
        mediaSlots[idx].type = 'mode';
        mediaSlots[idx].inst = { destroy: () => {} }; // Mock instance
    }

    function closeSlot(idx) {
        const s = mediaSlots[idx];
        if (!s) return;
        
        if (s.inst?.destroy) {
            try { s.inst.destroy(); } catch {}
        }
        s.inst = null;
        s.type = null;
        
        const body = document.getElementById(`mediaBody${idx}`);
        const title = document.getElementById(`mediaTitle${idx}`);
        if (body) body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>';
        if (title) title.textContent = '空闲';
    }

    // Device interaction
    function openDeviceInfo(devId) {
        console.log('Opening device info for:', devId);
        const device = [...state.devices.grouped, ...state.devices.ungrouped]
            .find(d => d.devInfo.id === devId);
        
        if (device) {
            const dev = device.devInfo;
            const actions = ['查看视频', '设备概览'];
            if (dev.modeList?.length) {
                actions.push(...dev.modeList.map(m => `模式: ${m.modeName}`));
            }
            
            const choice = prompt(`设备: ${dev.name} (${dev.no})\n在线状态: ${dev.onlineState ? '在线' : '离线'}\n\n可选操作:\n${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n请输入选项序号:`);
            
            if (choice === '1') {
                openVideoInSlot(dev.id, dev.no);
            } else if (choice === '2') {
                alert('设备概览功能 - 需要打开 ../modals/device-overview.html');
            } else if (choice && Number(choice) > 2) {
                const modeIndex = Number(choice) - 3;
                const mode = dev.modeList[modeIndex];
                if (mode) {
                    openModeInSlot(dev.id, dev.no, mode.modeId);
                }
            }
        }
    }

    // Utility functions
    function debounce(fn, wait = 300) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    function escapeHTML(str = '') {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const p = n => n < 10 ? '0' + n : n;
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    // Public API
    return {
        init: init,
        openVideoInSlot: openVideoInSlot,
        openModeInSlot: openModeInSlot,
        closeSlot: closeSlot
    };
})();