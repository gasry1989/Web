import { createModal, getModal } from '../../../ui/modal.js';
import { authState } from '../../../state/authState.js';
import { apiRoleUpdate } from '../../../api/userApi.js';
import { eventBus } from '../../../core/eventBus.js';

let modalRef = null;

export function showRoleMatrixPanel(roles) {
  if (getModal('roleMatrixModal')) return;

  const currentRoleId = authState.get().userInfo?.roleId;
  // 收集所有权限列
  const permIdSet = new Map(); // permId -> name
  roles.forEach(r => (r.permissions || []).forEach(p => permIdSet.set(p.id, p.name)));
  const permCols = Array.from(permIdSet.entries()); // [ [id,name], ... ]

  const container = document.createElement('div');
  container.className = 'role-matrix';
  container.innerHTML = `
    <h3>用户角色权限矩阵</h3>
    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th>角色</th>
            ${permCols.map(([pid,name]) => `<th title="${escapeHTML(name)}">${escapeHTML(name)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${roles.map(r => renderRoleRow(r, permCols, currentRoleId)).join('')}
        </tbody>
      </table>
    </div>
  `;

  modalRef = createModal({
    id: 'roleMatrixModal',
    title: '角色权限管理',
    width: 800,
    content: container,
    footerButtons: [
      { text: '取消', onClick: close => { close(); modalRef = null; } },
      {
        text: '确认',
        primary: true,
        onClick: async close => {
          const edited = collectEdited(roles, permCols, currentRoleId, container);
            try {
              await apiRoleUpdate(edited);
              eventBus.emit('toast:show', { type:'success', message:'权限已更新' });
              close();
              modalRef = null;
            } catch(e){}
        }
      }
    ]
  });

  modalRef && modalRef.open();
}

function renderRoleRow(role, permCols, currentRoleId) {
  const editable = role.roleId > currentRoleId && currentRoleId <= 1; // 仅管理员/测试人员，且只能编辑更大 roleId
  return `
    <tr data-role="${role.roleId}">
      <td>${escapeHTML(role.roleName || '')}</td>
      ${permCols.map(([pid]) => {
        const p = (role.permissions || []).find(x => x.id === pid);
        const checked = p?.granted ? 'checked' : '';
        const disabled = editable ? '' : 'disabled';
        return `<td><input type="checkbox" data-perm="${pid}" ${checked} ${disabled}/></td>`;
      }).join('')}
    </tr>
  `;
}

function collectEdited(roles, permCols, currentRoleId, container) {
  const table = container.querySelector('.matrix-table');
  return roles.map(r => {
    const editable = r.roleId > currentRoleId && currentRoleId <= 1;
    const tr = table.querySelector(`tr[data-role="${r.roleId}"]`);
    const perms = permCols.map(([pid]) => {
      let granted = false;
      const existing = (r.permissions || []).find(p => p.id === pid);
      if (editable) {
        const chk = tr.querySelector(`input[data-perm="${pid}"]`);
        granted = !!chk?.checked;
      } else {
        granted = existing?.granted || false;
      }
      return { id: pid, granted };
    });
    return { roleId: r.roleId, roleName: r.roleName, permissions: perms };
  });
}

export function closeRoleMatrixPanel() {
  if (modalRef) {
    modalRef.close();
    modalRef = null;
  }
}

function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}