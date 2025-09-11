/**
 * AddUserModal (重构版本)
 * - 统一结构：.form-item > label.form-label + .form-field
 * - 必填星号放在 label 内
 * - 省/市/区 三列并排
 * - 再次打开采用 reopen 机制
 * - 成功后触发 user:list:reload
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiUserCreate, apiRoleList, apiUserQuery } from '@api/userApi.js';
import { authState } from '@core/auth.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { eventBus } from '@core/eventBus.js';

let modalRef = null;
const parentSearchCtx = { timer: null, lastQuery: '' };

export function showAddUserModal() {
  const exist = getModal('addUserModal');
  if (exist) { exist.open(); return; }

  const container = document.createElement('div');
  container.className = 'modal-form add-user-modal';
  container.innerHTML = formHTML();

  modalRef = createModal({
    id: 'addUserModal',
    title: '添加用户',
    width: 640,
    content: container,
    footerButtons: [] // 使用表单内 actions
  });

  if (!modalRef) return;

  const form = modalRef.body.querySelector('#addUserForm');
  const cancelBtn = form.querySelector('[data-close]');
  cancelBtn.addEventListener('click', () => destroyModal());

  // 绑定逻辑
  initRoles(form.querySelector('#roleSelect'));
  initRegion(form);
  bindParentSearch(form);

  form.addEventListener('submit', onSubmit);
}

function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const pwd = (fd.get('password') || '').trim();
  const pwd2 = (fd.get('password2') || '').trim();
  if (pwd !== pwd2) {
    eventBus.emit('toast:show', { type: 'error', message: '两次密码不一致' });
    return;
  }
  if (pwd.length < 6) {
    eventBus.emit('toast:show', { type: 'error', message: '密码至少 6 位' });
    return;
  }

  const userInfo = {
    roleId: Number(fd.get('roleId')),
    account: (fd.get('account') || '').trim(),
    name: (fd.get('name') || '').trim(),
    password: pwd,
    provinceId: Number(fd.get('provinceId') || 0),
    cityId: Number(fd.get('cityId') || 0),
    zoneId: Number(fd.get('zoneId') || 0),
    parentUserId: Number(fd.get('parentUserId') || 0),
    memo: (fd.get('memo') || '').trim()
  };

  if (!userInfo.account || !userInfo.name || !userInfo.roleId) {
    eventBus.emit('toast:show', { type: 'error', message: '请填写必填字段' });
    return;
  }

  apiUserCreate(userInfo).then(() => {
    eventBus.emit('toast:show', { type: 'success', message: '添加成功' });
    eventBus.emit('user:list:reload');
    destroyModal();
  });
}

/* ---------- 构建 HTML ---------- */
function formHTML() {
  return `
    <form id="addUserForm" class="add-user-form" autocomplete="off">
      <div class="form-item">
        <label class="form-label">用户角色 <span class="req">*</span></label>
        <div class="form-field">
          <select name="roleId" id="roleSelect" required></select>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">登录账号 <span class="req">*</span></label>
        <div class="form-field">
          <input name="account" required minlength="3" maxlength="32"
                 pattern="[A-Za-z0-9_]+" placeholder="字母/数字/下划线"/>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">用户名 <span class="req">*</span></label>
        <div class="form-field">
          <input name="name" required minlength="2" maxlength="32"/>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">密码 <span class="req">*</span></label>
        <div class="form-field">
          <input type="password" name="password" required minlength="6" autocomplete="new-password"/>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">确认密码 <span class="req">*</span></label>
        <div class="form-field">
          <input type="password" name="password2" required minlength="6" autocomplete="new-password"/>
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

      <div class="form-item">
        <label class="form-label">所属账号 (父账号)</label>
        <div class="form-field">
          <input name="parentUserId" id="parentUserInput" placeholder="输入关键字搜索父账号"/>
          <div id="parentSearchResult" class="parent-search-list"></div>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">备注</label>
        <div class="form-field">
          <textarea name="memo" maxlength="200" rows="3" placeholder="不超过200字"></textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* ---------- 角色 ---------- */
function initRoles(selectEl) {
  apiRoleList().then(data => {
    const roles = data.roles || [];
    const currentRoleId = authState.get().userInfo?.roleId;
    const filtered = roles.filter(r => r.roleId > currentRoleId);
    selectEl.innerHTML = filtered
      .map(r => `<option value="${r.roleId}">${escapeHTML(r.roleName || '')}</option>`)
      .join('');
  });
}

/* ---------- 地区级联 ---------- */
function initRegion(form) {
  const provinceSel = form.querySelector('#provinceSel');
  const citySel = form.querySelector('#citySel');
  const zoneSel = form.querySelector('#zoneSel');

  apiProvinceList().then(data => {
    const arr = data.provinces || [];
    provinceSel.innerHTML = arr.map(p =>
      `<option value="${p.provinceId}">${escapeHTML(p.provinceName || '')}</option>`
    ).join('');
    provinceSel.dispatchEvent(new Event('change'));
  });

  provinceSel.addEventListener('change', () => {
    const pid = Number(provinceSel.value);
    if (!pid) {
      citySel.innerHTML = ''; zoneSel.innerHTML = ''; return;
    }
    apiCityList(pid).then(data => {
      const arr = data.cities || [];
      citySel.innerHTML = arr.map(c =>
        `<option value="${c.cityId}">${escapeHTML(c.cityName || '')}</option>`
      ).join('');
      citySel.dispatchEvent(new Event('change'));
    });
  });

  citySel.addEventListener('change', () => {
    const cid = Number(citySel.value);
    if (!cid) { zoneSel.innerHTML = ''; return; }
    apiZoneList(cid).then(data => {
      const arr = data.zones || [];
      zoneSel.innerHTML = arr.map(z =>
        `<option value="${z.zoneId}">${escapeHTML(z.zoneName || '')}</option>`
      ).join('');
    });
  });
}

/* ---------- 父账号搜索 ---------- */
function bindParentSearch(form) {
  const input = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  const hiddenSetter = () => form.querySelector('input[name=parentUserId]');

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (parentSearchCtx.timer) clearTimeout(parentSearchCtx.timer);
    if (!val) {
      result.innerHTML = '';
      hiddenSetter().value = '';
      parentSearchCtx.lastQuery = '';
      return;
    }
    parentSearchCtx.timer = setTimeout(() => {
      if (val === parentSearchCtx.lastQuery) return;
      parentSearchCtx.lastQuery = val;
      apiUserQuery(val, 1, 10).then(data => {
        const list = data.users || [];
        if (!list.length) {
          result.innerHTML = `<div class="parent-item empty">无匹配结果</div>`;
          return;
        }
        result.innerHTML = list.map(u =>
          `<div class="parent-item" data-id="${u.userId}" title="${escapeHTML(u.userName||'')}">
            ${u.userId} ${escapeHTML(u.userAccount||'')} ${escapeHTML(u.userName||'')}
          </div>`
        ).join('');
        result.querySelectorAll('.parent-item').forEach(div => {
          if (div.classList.contains('empty')) return;
          div.addEventListener('click', () => {
            hiddenSetter().value = div.getAttribute('data-id');
            input.value = div.textContent;
            result.innerHTML = '';
          });
        });
      });
    }, 300);
  });
}

/* ---------- 销毁 ---------- */
function destroyModal() {
  if (modalRef) { modalRef.close(); modalRef = null; }
  if (parentSearchCtx.timer) {
    clearTimeout(parentSearchCtx.timer);
    parentSearchCtx.timer = null;
  }
}

export function closeAddUserModal() {
  destroyModal();
}

/* ---------- 工具 ---------- */
function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}