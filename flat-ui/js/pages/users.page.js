/**
 * Users Page Controller
 * Extracted from modules/features/pages/UserListPage.js
 * Preserves original business logic with standalone HTML
 */

window.UsersPage = (function() {
    'use strict';

    let rootEl = null;
    let state = {
        list: [],
        listInfo: { pageIndex: 1, pageSize: 10, pageTotal: 1, total: 0 },
        selection: new Set(),
        loading: false
    };

    // Mock data and API functions - replace with actual implementation
    const mockUsers = [
        {
            userId: 1,
            userAccount: 'admin',
            userName: 'Administrator',
            roleName: '管理员',
            onlineState: true,
            parentUserAccount: '',
            parentUserName: '',
            rootUserAccount: 'root',
            rootUserName: 'Root User',
            provinceName: '广东省',
            cityName: '深圳市',
            zoneName: '南山区',
            createTime: Date.now() - 86400000,
            memo: '系统管理员'
        },
        {
            userId: 2,
            userAccount: 'user1',
            userName: 'Test User 1',
            roleName: '普通用户',
            onlineState: false,
            parentUserAccount: 'admin',
            parentUserName: 'Administrator',
            rootUserAccount: 'root',
            rootUserName: 'Root User',
            provinceName: '广东省',
            cityName: '深圳市',
            zoneName: '福田区',
            createTime: Date.now() - 172800000,
            memo: '测试用户'
        }
    ];

    // Mock API functions
    const apiUserList = async (pageIndex, pageSize) => {
        return new Promise(resolve => {
            setTimeout(() => {
                const start = (pageIndex - 1) * pageSize;
                const end = start + pageSize;
                const list = mockUsers.slice(start, end);
                resolve({
                    userList: list,
                    listInfo: {
                        total: mockUsers.length,
                        pageIndex,
                        pageSize,
                        pageTotal: Math.ceil(mockUsers.length / pageSize)
                    }
                });
            }, 500);
        });
    };

    const apiUserDelete = async (userIds) => {
        return new Promise(resolve => {
            setTimeout(() => {
                // Mock deletion
                console.log('Deleting users:', userIds);
                resolve({ success: true });
            }, 300);
        });
    };

    const eventBus = {
        emit: (event, data) => {
            console.log('EventBus emit:', event, data);
        }
    };

    function init() {
        rootEl = document.querySelector('.users-page');
        if (!rootEl) return;

        bindGlobalActions();
        loadUserPage(1);
    }

    function loadUserPage(pageIndex) {
        state.loading = true;
        updateLoadingState();

        apiUserList(pageIndex, state.listInfo.pageSize)
            .then(data => {
                const list = data.userList || data.users || [];
                const li = data.listInfo || {
                    total: list.length,
                    pageIndex,
                    pageSize: state.listInfo.pageSize,
                    pageTotal: Math.max(1, Math.ceil(list.length / state.listInfo.pageSize))
                };
                state.loading = false;
                state.list = list;
                state.listInfo = li;
                renderAll();
            })
            .catch(err => {
                console.error('[UsersPage] loadUserPage error', err);
                state.loading = false;
                showError('加载失败');
            });
    }

    function updateLoadingState() {
        if (!rootEl) return;
        const tbody = rootEl.querySelector('#userTableBody');
        if (state.loading) {
            tbody.innerHTML = '<tr><td colspan="14" class="loading"><span class="spinner"></span>加载中...</td></tr>';
        }
    }

    function showError(message) {
        if (!rootEl) return;
        const tbody = rootEl.querySelector('#userTableBody');
        tbody.innerHTML = `<tr><td colspan="14" class="loading" style="color: #ff4d4f;">${escapeHTML(message)}</td></tr>`;
    }

    function renderAll() {
        if (!rootEl) return;
        renderTable();
        renderPagination();
    }

    function renderTable() {
        const tbody = rootEl.querySelector('#userTableBody');
        const selection = state.selection;
        
        if (!state.list.length) {
            tbody.innerHTML = '<tr><td colspan="14" class="loading">暂无数据</td></tr>';
            return;
        }

        tbody.innerHTML = state.list.map(u => {
            const checked = selection.has(u.userId) ? 'checked' : '';
            return `
                <tr>
                    <td><input type="checkbox" data-id="${u.userId}" ${checked}/></td>
                    <td>${safe(u.userId)}</td>
                    <td>${escapeHTML(u.userAccount || '')}</td>
                    <td>${escapeHTML(u.roleName || '')}</td>
                    <td>${escapeHTML(u.userName || '')}</td>
                    <td>${u.onlineState
                        ? '<span class="dot dot-green" title="在线"></span>'
                        : '<span class="dot dot-gray" title="离线"></span>'}
                    </td>
                    <td>${escapeHTML(u.parentUserAccount || '')}</td>
                    <td>${escapeHTML(u.parentUserName || '')}</td>
                    <td>${escapeHTML(u.rootUserAccount || '')}</td>
                    <td>${escapeHTML(u.rootUserName || '')}</td>
                    <td>${escapeHTML([u.provinceName,u.cityName,u.zoneName].filter(Boolean).join(''))}</td>
                    <td>${formatTime(u.createTime)}</td>
                    <td>${escapeHTML(u.memo || '')}</td>
                    <td>
                        <button class="btn btn-xs" data-op="edit" data-id="${u.userId}">修改信息</button>
                        <button class="btn btn-xs" data-op="pwd" data-id="${u.userId}">修改密码</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Bind checkbox events
        tbody.querySelectorAll('input[type=checkbox][data-id]').forEach(chk => {
            chk.addEventListener('change', () => {
                const id = Number(chk.getAttribute('data-id'));
                const sel = new Set(state.selection);
                chk.checked ? sel.add(id) : sel.delete(id);
                state.selection = sel;
            });
        });

        // Bind row button events
        tbody.addEventListener('click', onRowButtonClick);
    }

    function onRowButtonClick(e) {
        const btn = e.target.closest('button[data-op]');
        if (!btn) return;
        
        const op = btn.getAttribute('data-op');
        const id = Number(btn.getAttribute('data-id'));
        const user = state.list.find(u => u.userId === id);
        if (!user) return;
        
        if (op === 'edit') openEditUserModal(user);
        if (op === 'pwd') openPasswordModal(user);
    }

    function renderPagination() {
        const pager = rootEl.querySelector('#userPagination');
        const { pageIndex, pageTotal } = state.listInfo;
        const pages = buildPageWindow(pageIndex, pageTotal, 2);
        
        pager.innerHTML = `
            <button class="pg-btn" data-pg="prev" ${pageIndex===1?'disabled':''}>&lt;</button>
            ${pages.map(p => `<button class="pg-btn ${p===pageIndex?'active':''}" data-pg="${p}">${p}</button>`).join('')}
            <button class="pg-btn" data-pg="next" ${pageIndex===pageTotal?'disabled':''}>&gt;</button>
        `;
        
        pager.querySelectorAll('.pg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.getAttribute('data-pg');
                let target = pageIndex;
                if (val==='prev') target = pageIndex - 1;
                else if (val==='next') target = pageIndex + 1;
                else target = Number(val);
                if (target < 1 || target > pageTotal) return;
                loadUserPage(target);
            });
        });
    }

    function buildPageWindow(current, total, window = 2) {
        const pages = [];
        const start = Math.max(1, current - window);
        const end = Math.min(total, current + window);
        
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    }

    function bindGlobalActions() {
        const actionsEl = rootEl.querySelector('#userActions');
        
        actionsEl.innerHTML = `
            <button class="btn btn-primary" id="btnAddUser">添加</button>
            <button class="btn btn-danger" id="btnDeleteUser">删除</button>
            <button class="btn" id="btnDeviceOverview">设备概览</button>
            <button class="btn" id="btnRoleMatrix">用户角色权限管理</button>
        `;

        actionsEl.addEventListener('click', e => {
            if (!(e.target instanceof HTMLElement)) return;
            switch (e.target.id) {
                case 'btnAddUser': openAddUserModal(); break;
                case 'btnDeleteUser': deleteSelectedUsers(); break;
                case 'btnDeviceOverview': openDeviceOverview(); break;
                case 'btnRoleMatrix': openRoleMatrixPanel(); break;
            }
        });

        rootEl.querySelector('#chkAll').addEventListener('change', e => {
            const checked = e.target.checked;
            const newSel = new Set();
            if (checked) state.list.forEach(u => newSel.add(u.userId));
            state.selection = newSel;
            renderTable(); // Re-render to update checkboxes
        });
    }

    function deleteSelectedUsers() {
        const sel = Array.from(state.selection);
        if (!sel.length) {
            eventBus.emit('toast:show', { type:'info', message:'请选择要删除的用户' });
            alert('请选择要删除的用户');
            return;
        }
        if (!confirm(`确认删除选中 ${sel.length} 个用户？`)) return;
        
        apiUserDelete(sel).then(() => {
            eventBus.emit('toast:show', { type:'success', message:'删除成功' });
            alert('删除成功');
            state.selection = new Set();
            loadUserPage(state.listInfo.pageIndex);
        });
    }

    // Modal functions - these would open modal HTML files
    function openAddUserModal() {
        console.log('Opening add user modal...');
        // window.open('../modals/add-user.html', '_blank', 'width=900,height=600');
        alert('添加用户功能 - 需要打开 ../modals/add-user.html');
    }

    function openEditUserModal(user) {
        console.log('Opening edit user modal for:', user);
        alert(`编辑用户功能 - 需要打开 ../modals/edit-user.html 并传递用户数据: ${user.userName}`);
    }

    function openPasswordModal(user) {
        console.log('Opening password modal for:', user);
        alert(`修改密码功能 - 需要打开 ../modals/password.html 并传递用户数据: ${user.userName}`);
    }

    function openDeviceOverview() {
        const sel = Array.from(state.selection);
        console.log('Opening device overview modal for users:', sel);
        alert(`设备概览功能 - 需要打开 ../modals/device-overview.html`);
    }

    function openRoleMatrixPanel() {
        console.log('Opening role matrix panel...');
        alert('角色权限管理功能 - 需要打开 ../modals/role-matrix.html');
    }

    // Utility functions
    function escapeHTML(str='') {
        return str.replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function safe(v) { 
        return v == null ? '' : v; 
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
        loadUserPage: loadUserPage
    };
})();