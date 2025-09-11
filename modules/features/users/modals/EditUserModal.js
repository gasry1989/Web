/**
 * EditUserModal
 * 角色映射：管理员:0 测试人员:1 总帐号:2 子帐号:3
 * 逻辑与 AddUserModal 保持一致
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiRoleList, apiUserQuery, apiUserUpdate } from '@api/userApi.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { authState } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';

const ADMIN_ROLE_ID = 0;
const CHILD_ROLE_ID = 3;

let modalRef = null;
const parentSearchCtx = { timer:null, lastQuery:'' };

export function showEditUserModal(user) {
  const exist = getModal('editUserModal');
  if (exist) { exist.open(); return; }

  const container = document.createElement('div');
  container.className = 'modal-form edit-user-modal';
  container.innerHTML = formHTML(user);

  modalRef = createModal({
    id:'editUserModal',
    title:'修改用户信息',
    width:640,
    content:container,
    footerButtons:[]
  });

  if (!modalRef) return;
  const form = modalRef.body.querySelector('#editUserForm');
  form.querySelector('[data-close]').addEventListener('click', destroy);

  initRoles(form.querySelector('#roleSelect'), form, user);
  initRegion(form, user);
  bindRoleChange(form, user);
  bindParentSearch(form);
  fillBasicFields(form, user);

  form.addEventListener('submit', e => onSubmit(e, user));
}

function formHTML(user) {
  return `
    <form id="editUserForm" class="add-user-form" autocomplete="off">
      <input type="hidden" name="userId" value="${user.userId}">
      <input type="hidden" name="parentUserId" value="0"/>

      <div class="form-item">
        <label class="form-label">用户角色 <span class="req">*</span></label>
        <div class="form-field">
          <select name="roleId" id="roleSelect" required></select>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">登录账号</label>
        <div class="form-field">
          <input name="account" value="${escapeHTML(user.userAccount||'')}" disabled />
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">用户名 <span class="req">*</span></label>
        <div class="form-field">
          <input name="name" id="nameInput" required minlength="2" maxlength="32" value="${escapeHTML(user.userName||'')}"/>
        </div>
      </div>

      <div class="form-item form-item-inline">
        <label class="form-label">地区</label>
        <div class="form-field three-cols">
          <select name="provinceId" id="provinceSel"></select>
          <select name="cityId" id="citySel"></select>
          <select name="zoneId" id="zoneSel"></select>
        </div>
      </div>

      <div class="form-item" id="parentUserSection" style="display:none;">
        <label class="form-label">所属账号 <span class="req">*</span></label>
        <div class="form-field">
          <input id="parentUserInput" placeholder="输入关键字搜索父账号"/>
          <div id="parentSearchResult" class="parent-search-list"></div>
          <div class="hint">只能选择非子帐号用户作为父账号 (显示: userId 账号 用户名 roleId)</div>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">备注</label>
        <div class="form-field">
          <textarea name="memo" maxlength="200" rows="3" placeholder="不超过200字">${escapeHTML(user.memo||'')}</textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* -------- Roles -------- */
function initRoles(selectEl, form, user) {
  apiRoleList().then(data => {
    const roles = data.roles || [];
    const current = authState.get().userInfo;
    const currentRoleId = current.roleId;

    const filtered = roles.filter(r =>
      r.roleId > currentRoleId && // 只能改成比自己权限低
      r.roleId !== ADMIN_ROLE_ID   // 不允许管理员
    );

    // 保证当前用户原 roleId 若仍满足过滤可以选中；如果当前被编辑用户的 roleId 不在 filtered，说明无权修改为原角色（直接追加进去只读？此处简化：若不在则 append 但禁用修改）
    let found = filtered.find(r=>r.roleId===user.roleId);
    let disableRoleChange = false;
    if (!found) {
      // 将原角色追加并标记不可修改
      disableRoleChange = true;
      filtered.push({ roleId:user.roleId, roleName:user.roleName+'(当前不可变更)' });
    }

    selectEl.innerHTML = filtered
      .sort((a,b)=>a.roleId-b.roleId)
      .map(r => `<option value="${r.roleId}" data-roleid="${r.roleId}">${escapeHTML(r.roleName||'')}</option>`)
      .join('');

    selectEl.value = String(user.roleId);
    if (disableRoleChange) {
      selectEl.disabled = true;
    }
    updateParentSection(form, user);
  });
}

function bindRoleChange(form, user) {
  const roleSelect = form.querySelector('#roleSelect');
  roleSelect.addEventListener('change', () => {
    updateParentSection(form, user);
  });
}

function updateParentSection(form, user) {
  const current = authState.get().userInfo;
  const roleSelect = form.querySelector('#roleSelect');
  const selectedRoleId = Number(roleSelect.value);
  const section = form.querySelector('#parentUserSection');
  const hiddenParent = form.querySelector('input[name=parentUserId]');
  const parentInput = form.querySelector('#parentUserInput');
  const resultBox = form.querySelector('#parentSearchResult');

  // 如果是子帐号
  if (selectedRoleId === CHILD_ROLE_ID) {
    section.style.display = '';
    // 预填当前父账号（若原账号就是子帐号）
    if (user.roleId === CHILD_ROLE_ID && user.parentUserId) {
      hiddenParent.value = user.parentUserId;
      parentInput.value = `${user.parentUserId} ${user.parentUserAccount||''} ${user.parentUserName||''} ${user.parentRoleId??''}`;
    } else {
      hiddenParent.value = '';
      parentInput.value = '';
    }
    resultBox.innerHTML = '';
  } else {
    section.style.display = 'none';
    hiddenParent.value = current.userId;
    parentInput.value = '';
    resultBox.innerHTML = '';
  }
}

/* -------- Parent Search -------- */
function bindParentSearch(form) {
  const input = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (parentSearchCtx.timer) clearTimeout(parentSearchCtx.timer);
    if (!val) {
      result.innerHTML = '';
      form.querySelector('input[name=parentUserId]').value = '';
      parentSearchCtx.lastQuery = '';
      return;
    }
    parentSearchCtx.timer = setTimeout(() => {
      if (val === parentSearchCtx.lastQuery) return;
      parentSearchCtx.lastQuery = val;

      apiUserQuery(val, 1, 30).then(data => {
        let list = data.users || [];
        list = list.filter(u => u.roleId !== CHILD_ROLE_ID); // 过滤子帐号
        if (!list.length) {
          result.innerHTML = `<div class="parent-item empty">无匹配结果</div>`;
          return;
        }
        result.innerHTML = list.map(u =>
          `<div class="parent-item" data-id="${u.userId}">
            ${u.userId} ${escapeHTML(u.userAccount||'')} ${escapeHTML(u.userName||'')} ${u.roleId}
          </div>`
        ).join('');
        result.querySelectorAll('.parent-item').forEach(div => {
          if (div.classList.contains('empty')) return;
            div.addEventListener('click', () => {
              form.querySelector('input[name=parentUserId]').value = div.getAttribute('data-id');
              input.value = div.textContent;
              result.innerHTML = '';
            });
        });
      });
    }, 300);
  });
}

/* -------- Region 初始化 -------- */
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
    if (!provinceSel.value && arr.length) provinceSel.value = arr[0].provinceId;
    loadCities();
  });

  provinceSel.addEventListener('change', loadCities);

  function loadCities() {
    const pid = Number(provinceSel.value);
    if (!pid) { citySel.innerHTML=''; zoneSel.innerHTML=''; return; }
    apiCityList(pid).then(data => {
      const arr = data.cities || [];
      citySel.innerHTML = arr.map(c =>
        `<option value="${c.cityId}" ${c.cityId===initCity?'selected':''}>${escapeHTML(c.cityName||'')}</option>`
      ).join('');
      if (!citySel.value && arr.length) citySel.value = arr[0].cityId;
      loadZones();
    });
  }

  citySel.addEventListener('change', loadZones);

  function loadZones() {
    const cid = Number(citySel.value);
    if (!cid) { zoneSel.innerHTML=''; return; }
    apiZoneList(cid).then(data => {
      const arr = data.zones || [];
      zoneSel.innerHTML = arr.map(z =>
        `<option value="${z.zoneId}" ${z.zoneId===initZone?'selected':''}>${escapeHTML(z.zoneName||'')}</option>`
      ).join('');
      if (!zoneSel.value && arr.length) zoneSel.value = arr[0].zoneId;
    });
  }
}

/* -------- 填充基本字段 / 初值 -------- */
function fillBasicFields(form, user) {
  form.querySelector('textarea[name=memo]').value = user.memo || '';
  // parentUserId 初始化：在 updateParentSection 中已处理
}

/* -------- 提交 -------- */
function onSubmit(e, originalUser) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const current = authState.get().userInfo;

  const roleId = Number(fd.get('roleId'));
  if (roleId === ADMIN_ROLE_ID) {
    eventBus.emit('toast:show', { type:'error', message:'禁止设置为管理员角色' });
    return;
  }
  // 权限校验（不能提升到 >= 当前登录用户）
  if (roleId <= current.roleId) {
    eventBus.emit('toast:show', { type:'error', message:'无权限设置此角色' });
    return;
  }

  const isChild = roleId === CHILD_ROLE_ID;
  let parentUserId = Number(fd.get('parentUserId') || 0);
  if (!isChild) {
    parentUserId = current.userId;
  } else if (!parentUserId) {
    eventBus.emit('toast:show', { type:'error', message:'请选择父账号' });
    return;
  }

  const payload = {
    userId: Number(fd.get('userId')),
    roleId,
    name: (fd.get('name') || '').trim(),
    provinceId: Number(fd.get('provinceId') || 0),
    cityId: Number(fd.get('cityId') || 0),
    zoneId: Number(fd.get('zoneId') || 0),
    parentUserId,
    memo: (fd.get('memo') || '').trim()
  };

  if (!payload.name) {
    eventBus.emit('toast:show', { type:'error', message:'请输入用户名' });
    return;
  }

  apiUserUpdate(payload).then(() => {
    eventBus.emit('toast:show', { type:'success', message:'修改成功' });
    eventBus.emit('user:list:reload');
    destroy();
  });
}

/* -------- 销毁 -------- */
function destroy() {
  if (modalRef) { modalRef.close(); modalRef=null; }
  if (parentSearchCtx.timer) { clearTimeout(parentSearchCtx.timer); parentSearchCtx.timer=null; }
}

/* -------- Utils -------- */
function escapeHTML(str='') {
  return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}