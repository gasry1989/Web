/**
 * 修改用户信息 Modal (新版 createModal)
 * 规则：
 * - 不可将角色提升为与当前用户同级或更高；仅可下调（roleId 数值更大）
 * - 不允许修改自己角色
 */
import { createModal, getModal } from '../../../ui/modal.js';
import { apiUserUpdate, apiRoleList, apiUserQuery } from '../../../api/userApi.js';
import { apiProvinceList, apiCityList, apiZoneList } from '../../../api/regionApi.js';
import { authState } from '../../../state/authState.js';
import { eventBus } from '../../../core/eventBus.js';

let modalRef = null;

export function showEditUserModal(user) {
  const exist = getModal('editUserModal');
  if (exist) { exist.open(); return; }

  const currentUserId = authState.get().userInfo?.userId;
  const currentRoleId = authState.get().userInfo?.roleId;
  const editingSelf = user.userId === currentUserId;

  const container = document.createElement('div');
  container.className = 'modal-form edit-user-modal';
  container.innerHTML = `
    <h3>修改用户信息</h3>
    <form id="editUserForm" class="form-vertical">
      ${editingSelf ? '' : `
        <div class="form-row">
          <label>用户角色<span class="req">*</span></label>
          <select name="roleId" id="roleSelect" required></select>
        </div>
      `}
      <div class="form-row">
        <label>登录账号<span class="req">*</span></label>
        <input name="account" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" value="${escapeHTML(user.userAccount||'')}" autocomplete="off"/>
      </div>
      <div class="form-row">
        <label>用户名<span class="req">*</span></label>
        <input name="name" required minlength="2" maxlength="32" value="${escapeHTML(user.userName||'')}" autocomplete="off"/>
      </div>
      <div class="form-row flex-3">
        <label>省<select name="provinceId" id="provinceSel"></select></label>
        <label>市<select name="cityId" id="citySel"></select></label>
        <label>区<select name="zoneId" id="zoneSel"></select></label>
      </div>
      <div class="form-row">
        <label>所属账号(父账号)</label>
        <input name="parentUserId" id="parentUserInput" placeholder="搜索父账号" value="${user.parentUserId||''}" autocomplete="off"/>
        <div id="parentSearchResult" class="parent-search-list"></div>
      </div>
      <div class="form-row">
        <label>备注</label>
        <textarea name="memo" maxlength="200">${escapeHTML(user.memo||'')}</textarea>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;

  modalRef = createModal({
    id: 'editUserModal',
    title: '修改用户',
    width: 520,
    content: container,
    footerButtons: []
  });

  if (!modalRef) return;
  modalRef.open();

  const form = modalRef.body.querySelector('#editUserForm');
  const cancelBtn = form.querySelector('[data-close]');
  cancelBtn.addEventListener('click', () => { modalRef.close(); modalRef = null; });

  if (!editingSelf) {
    loadRolesForEdit(form.querySelector('#roleSelect'), currentRoleId, user.roleId);
  }
  initRegion(form, user);
  bindParentSearch(form);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);

    const payload = {
      userId: user.userId,
      account: (fd.get('account') || '').trim(),
      name: (fd.get('name') || '').trim(),
      memo: (fd.get('memo') || '').trim(),
      zoneId: Number(fd.get('zoneId') || 0),
      parentUserId: Number(fd.get('parentUserId') || 0)
    };
    if (!editingSelf) {
      payload.roleId = Number(fd.get('roleId'));
      if (payload.roleId <= currentRoleId) {
        eventBus.emit('toast:show', { type:'error', message:'角色不可平级或上调' });
        return;
      }
    }

    apiUserUpdate(payload).then(() => {
      eventBus.emit('toast:show', { type:'success', message:'修改成功' });
      eventBus.emit('user:list:reload');
      modalRef.close();
      modalRef = null;
    });
  });
}

export function closeEditUserModal() {
  if (modalRef) {
    modalRef.close();
    modalRef = null;
  }
}

function loadRolesForEdit(select, currentRoleId, userOldRoleId) {
  apiRoleList().then(data => {
    const roles = data.roles || [];
    const filtered = roles.filter(r => r.roleId > currentRoleId);
    select.innerHTML = filtered.map(r =>
      `<option value="${r.roleId}" ${r.roleId===userOldRoleId?'selected':''}>${escapeHTML(r.roleName||'')}</option>`
    ).join('');
  });
}

function initRegion(form, user) {
  const provinceSel = form.querySelector('#provinceSel');
  const citySel = form.querySelector('#citySel');
  const zoneSel = form.querySelector('#zoneSel');

  const initProvince = user.provinceId;
  const initCity = user.cityId;
  const initZone = user.zoneId;

  apiProvinceList().then(data => {
    const arr = data.provinces || [];
    provinceSel.innerHTML = arr.map(p =>
      `<option value="${p.provinceId}" ${p.provinceId===initProvince?'selected':''}>${escapeHTML(p.provinceName||'')}</option>`
    ).join('');
    provinceSel.dispatchEvent(new Event('change'));
  });

  provinceSel.addEventListener('change', () => {
    const pid = Number(provinceSel.value);
    apiCityList(pid).then(data => {
      const arr = data.cities || [];
      citySel.innerHTML = arr.map(c =>
        `<option value="${c.cityId}" ${c.cityId===initCity?'selected':''}>${escapeHTML(c.cityName||'')}</option>`
      ).join('');
      citySel.dispatchEvent(new Event('change'));
    });
  });

  citySel.addEventListener('change', () => {
    const cid = Number(citySel.value);
    apiZoneList(cid).then(data => {
      const arr = data.zones || [];
      zoneSel.innerHTML = arr.map(z =>
        `<option value="${z.zoneId}" ${z.zoneId===initZone?'selected':''}>${escapeHTML(z.zoneName||'')}</option>`
      ).join('');
    });
  });
}

function bindParentSearch(form) {
  const input = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  let timer = null;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (timer) clearTimeout(timer);
    if (!val) {
      result.innerHTML = '';
      return;
    }
    timer = setTimeout(() => {
      apiUserQuery(val, 1, 10).then(data => {
        const list = data.users || [];
        result.innerHTML = list.map(u =>
          `<div class="parent-item" data-id="${u.userId}" title="${escapeHTML(u.userName||'')}">${u.userId} ${escapeHTML(u.userAccount||'')} ${escapeHTML(u.userName||'')}</div>`
        ).join('');
        result.querySelectorAll('.parent-item').forEach(div => {
          div.addEventListener('click', () => {
            input.value = div.textContent;
            form.querySelector('input[name=parentUserId]').value = div.getAttribute('data-id');
            result.innerHTML = '';
          });
        });
      });
    }, 300);
  });
}

function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}