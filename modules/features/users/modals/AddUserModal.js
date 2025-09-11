/**
 * AddUserModal (角色映射：管理员:0 测试人员:1 总帐号:2 子帐号:3)
 *
 * 新增：增强密码逻辑（与修改密码弹窗一致）
 *  - 长度 >= 8 且 至少 2 类字符(大写/小写/数字/符号)
 *  - 强度条、生成、复制、显示/隐藏
 *  - 两次一致才允许提交
 *
 * 现有逻辑保持：
 *  - 只能创建 roleId > 当前登录用户 roleId
 *  - 禁止创建管理员 (0)
 *  - 子帐号(3) 必须选择父账号（父账号不能是子帐号）
 *  - 其它角色父账号 = 当前登录用户
 *  - 地区默认当前登录用户
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiUserCreate, apiRoleList, apiUserQuery } from '@api/userApi.js';
import { authState } from '@core/auth.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { eventBus } from '@core/eventBus.js';

let modalRef = null;
const parentSearchCtx = { timer: null, lastQuery: '' };

// 角色常量
const ADMIN_ROLE_ID = 0;
const TEST_ROLE_ID  = 1;
const ROOT_ROLE_ID  = 2;
const CHILD_ROLE_ID = 3;

export function showAddUserModal() {
  const exist = getModal('addUserModal');
  if (exist) { exist.open(); return; }

  const container = document.createElement('div');
  container.className = 'modal-form add-user-modal';
  container.innerHTML = buildFormHTML();

  modalRef = createModal({
    id: 'addUserModal',
    title: '添加用户',
    width: 640,
    content: container,
    footerButtons: []
  });
  if (!modalRef) return;

  const form = modalRef.body.querySelector('#addUserForm');
  form.querySelector('[data-close]').addEventListener('click', destroyModal);

  initRoles(form.querySelector('#roleSelect'), form);
  initRegion(form, authState.get().userInfo);
  bindRoleChange(form);
  bindParentSearch(form);
  bindPasswordEnhance(form); // 新增：增强密码逻辑绑定
  form.addEventListener('submit', onSubmit);
}

export function closeAddUserModal() {
  destroyModal();
}

/* ---------------- HTML ---------------- */
function buildFormHTML() {
  return `
    <form id="addUserForm" class="add-user-form" autocomplete="off">
      <input type="hidden" name="parentUserId" value="0" />

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

      <!-- 增强密码区域 开始 -->
      <div class="form-item">
        <label class="form-label">密码 <span class="req">*</span></label>
        <div class="form-field with-actions">
          <div class="pwd-field">
            <input type="password" name="password" id="pwd1"
              placeholder="至少8位，含2种字符类别"
              minlength="8" autocomplete="new-password" required />
            <button type="button" class="pwd-eye" data-eye="pwd1" title="显示/隐藏">👁</button>
          </div>
          <div class="pwd-mini-actions">
            <button type="button" class="btn btn-xs" id="btnGenPwd" title="生成随机强密码">生成</button>
            <button type="button" class="btn btn-xs" id="btnCopyPwd" title="复制密码">复制</button>
          </div>
        </div>
        <div class="pwd-strength-wrap">
          <div class="pwd-strength-bg">
            <div id="pwdStrengthBar" class="pwd-strength-bar" data-level=""></div>
          </div>
          <span id="pwdStrengthLabel" class="pwd-strength-label"></span>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">确认密码 <span class="req">*</span></label>
        <div class="form-field pwd-field">
          <input type="password" name="password2" id="pwd2"
            placeholder="再次输入密码" minlength="8"
            autocomplete="new-password" required />
          <button type="button" class="pwd-eye" data-eye="pwd2" title="显示/隐藏">👁</button>
        </div>
      </div>

      <div class="form-item">
        <div id="pwdInlineMsg" class="pwd-inline-msg"></div>
        <ul class="pwd-rules">
          <li>长度 ≥ 8</li>
          <li>至少 2 类字符（大写 / 小写 / 数字 / 符号）</li>
          <li>两次输入一致后才能提交</li>
        </ul>
      </div>
      <!-- 增强密码区域 结束 -->

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
          <div class="hint">只能选择非子帐号 (roleId ≠ 3) 作为父账号；显示格式: userId 账号 用户名 roleId</div>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">备注</label>
        <div class="form-field">
          <textarea name="memo" maxlength="200" rows="3" placeholder="不超过200字"></textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" id="btnSubmitAddUser" class="btn btn-primary" disabled>确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* ---------------- Roles ---------------- */
function initRoles(selectEl, form) {
  apiRoleList().then(data => {
    const roles = data.roles || [];
    const current = authState.get().userInfo;
    const currentRoleId = current?.roleId;

    const filtered = roles.filter(r =>
      r.roleId > currentRoleId &&
      r.roleId !== ADMIN_ROLE_ID
    );

    selectEl.innerHTML = filtered
      .map(r => `<option value="${r.roleId}" data-roleid="${r.roleId}" data-name="${escapeHTML(r.roleName||'')}">
        ${escapeHTML(r.roleName||'')}
      </option>`).join('');

    updateParentSection(form);
  });
}

function bindRoleChange(form) {
  form.querySelector('#roleSelect').addEventListener('change', () => {
    updateParentSection(form);
  });
}

function updateParentSection(form) {
  const currentUser = authState.get().userInfo;
  const roleSelect = form.querySelector('#roleSelect');
  const selected = roleSelect.options[roleSelect.selectedIndex];
  const selectedRoleId = Number(selected?.getAttribute('data-roleid'));
  const section = form.querySelector('#parentUserSection');
  const hiddenParent = form.querySelector('input[name=parentUserId]');

  if (isChildRole(selectedRoleId)) {
    section.style.display = '';
    hiddenParent.value = '';
    form.querySelector('#parentUserInput').value = '';
    form.querySelector('#parentSearchResult').innerHTML = '';
  } else {
    section.style.display = 'none';
    hiddenParent.value = currentUser?.userId || 0;
    form.querySelector('#parentSearchResult').innerHTML = '';
  }
}

function isChildRole(roleId) {
  return roleId === CHILD_ROLE_ID;
}

/* ---------------- Parent Search (3.7) ---------------- */
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
        list = filterParentCandidates(list);
        if (!list.length) {
          result.innerHTML = `<div class="parent-item empty">无匹配结果</div>`;
          return;
        }
        result.innerHTML = list.map(u =>
          `<div class="parent-item" data-id="${u.userId}" title="${escapeHTML(u.userName||'')}">
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

function filterParentCandidates(list) {
  return list.filter(u => u.roleId !== CHILD_ROLE_ID);
}

/* ---------------- Region (默认当前用户) ---------------- */
function initRegion(form, currentUser) {
  const provinceSel = form.querySelector('#provinceSel');
  const citySel = form.querySelector('#citySel');
  const zoneSel = form.querySelector('#zoneSel');

  const initProvince = currentUser?.provinceId;
  const initCity = currentUser?.cityId;
  const initZone = currentUser?.zoneId;

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

/* ---------------- 增强密码逻辑绑定 ---------------- */
function bindPasswordEnhance(form) {
  const pwd1 = form.querySelector('#pwd1');
  const pwd2 = form.querySelector('#pwd2');
  const msgEl = form.querySelector('#pwdInlineMsg');
  const submitBtn = form.querySelector('#btnSubmitAddUser');
  const strengthBar = form.querySelector('#pwdStrengthBar');
  const strengthLabel = form.querySelector('#pwdStrengthLabel');
  const genBtn = form.querySelector('#btnGenPwd');
  const copyBtn = form.querySelector('#btnCopyPwd');

  // 显示/隐藏
  form.querySelectorAll('.pwd-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = form.querySelector(`#${btn.dataset.eye}`);
      if (!target) return;
      if (target.type === 'password') {
        target.type = 'text';
        btn.textContent = '🙈';
      } else {
        target.type = 'password';
        btn.textContent = '👁';
      }
    });
  });

  genBtn.addEventListener('click', () => {
    const newPwd = generateStrongPassword(12);
    pwd1.value = newPwd;
    pwd2.value = newPwd;
    validate();
    copyToClipboard(newPwd);
    eventBus.emit('toast:show', { type:'info', message:'已生成并复制' });
  });

  copyBtn.addEventListener('click', () => {
    if (!pwd1.value) {
      eventBus.emit('toast:show', { type:'warn', message:'无可复制密码' });
      return;
    }
    copyToClipboard(pwd1.value);
    eventBus.emit('toast:show', { type:'success', message:'已复制密码' });
  });

  pwd1.addEventListener('input', validate);
  pwd2.addEventListener('input', validate);
  validate();

  function validate() {
    const v1 = pwd1.value;
    const v2 = pwd2.value;
    const { ok, msg, score, level } = validatePasswordNewUser(v1, v2);
    renderStrength(score, level);
    msgEl.textContent = msg;
    msgEl.className = 'pwd-inline-msg ' + (ok ? 'ok' : 'err');
    submitBtn.disabled = !ok;
  }

  function renderStrength(score, level) {
    const percent = Math.min(100, Math.round(score));
    strengthBar.style.width = percent + '%';
    strengthBar.dataset.level = level;
    strengthLabel.textContent = level ? level.toUpperCase() : '';
  }
}

/* 校验函数（无旧密码） */
function validatePasswordNewUser(pwd1, pwd2) {
  const res = { ok:false, msg:'', score:0, level:'' };
  if (!pwd1) { res.msg='请输入密码'; return res; }
  if (pwd1.length < 8) { res.msg='密码长度不足 8'; return res; }

  let classes = 0;
  if (/[a-z]/.test(pwd1)) classes++;
  if (/[A-Z]/.test(pwd1)) classes++;
  if (/\d/.test(pwd1)) classes++;
  if (/[^A-Za-z0-9]/.test(pwd1)) classes++;

  if (classes < 2) { res.msg='至少包含 2 类字符'; return res; }
  if (!pwd2) { res.msg='请再次输入确认密码'; return res; }
  if (pwd1 !== pwd2) { res.msg='两次密码不一致'; return res; }

  let score = Math.min(60, pwd1.length * 4);
  score += (classes - 2) * 15;
  if (/([A-Za-z0-9])\1{2,}/.test(pwd1)) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let level = '弱';
  if (score >= 75) level = '强';
  else if (score >= 50) level = '中';

  res.ok = true;
  res.msg = '密码合法';
  res.score = score;
  res.level = level;
  return res;
}

/* 随机强密码生成 */
function generateStrongPassword(len=12) {
  const pools = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnopqrstuvwxyz',
    digit: '23456789',
    symbol: '!@#$%^&*?_+-=~'
  };
  const pick = s => s[Math.floor(Math.random()*s.length)];
  let base = [pick(pools.upper), pick(pools.lower), pick(pools.digit), pick(pools.symbol)];
  const all = pools.upper + pools.lower + pools.digit + pools.symbol;
  while (base.length < len) base.push(pick(all));
  for (let i=base.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}

function copyToClipboard(text) {
  try {
    navigator.clipboard?.writeText(text);
  } catch(e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position='fixed';
    ta.style.left='-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(_) {}
    ta.remove();
  }
}

/* ---------------- Submit ---------------- */
function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const current = authState.get().userInfo;

  const password = (fd.get('password') || '').trim();
  const password2 = (fd.get('password2') || '').trim();

  // 冗余防护：如果按钮逻辑出了问题，仍手动校验
  const v = validatePasswordNewUser(password, password2);
  if (!v.ok) {
    eventBus.emit('toast:show', { type:'error', message: v.msg || '密码不合法' });
    return;
  }

  const roleId = Number(fd.get('roleId'));
  if (roleId === ADMIN_ROLE_ID) {
    eventBus.emit('toast:show', { type:'error', message:'禁止创建管理员账户' });
    return;
  }

  if (roleId <= current.roleId) {
    eventBus.emit('toast:show', { type:'error', message:'不可创建与自己同级或更高权限角色' });
    return;
  }

  const isChild = isChildRole(roleId);
  let parentUserId = Number(fd.get('parentUserId') || 0);
  if (!isChild) {
    parentUserId = current?.userId || 0;
  } else if (isChild && !parentUserId) {
    eventBus.emit('toast:show', { type:'error', message:'请选择父账号' });
    return;
  }

  const payload = {
    roleId,
    account: (fd.get('account') || '').trim(),
    name: (fd.get('name') || '').trim(),
    password,
    provinceId: Number(fd.get('provinceId') || 0),
    cityId: Number(fd.get('cityId') || 0),
    zoneId: Number(fd.get('zoneId') || 0),
    parentUserId,
    memo: (fd.get('memo') || '').trim()
  };

  if (!payload.account || !payload.name) {
    eventBus.emit('toast:show', { type:'error', message:'请填写必填字段' });
    return;
  }

  apiUserCreate(payload).then(() => {
    eventBus.emit('toast:show', { type:'success', message:'添加成功' });
    eventBus.emit('user:list:reload');
    destroyModal();
  });
}

/* ---------------- Destroy ---------------- */
function destroyModal() {
  if (modalRef) { modalRef.close(); modalRef = null; }
  if (parentSearchCtx.timer) {
    clearTimeout(parentSearchCtx.timer);
    parentSearchCtx.timer = null;
  }
}

/* ---------------- Utils ---------------- */
function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}