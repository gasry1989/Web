/**
 * AddUserModal
 * - 行内布局：除备注外所有字段(label+控件)单行
 * - 备注两行 (label + textarea)
 * - 子帐号父账号行在选择子帐号时出现
 * - 密码 / 确认密码单行；强度条与规则放在同一额外区，显示“弱 / 中 / 强”
 * - 内联样式注入；仅此文件维护 UI
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiUserCreate, apiRoleList, apiUserQuery } from '@api/userApi.js';
import { authState } from '@core/auth.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { eventBus } from '@core/eventBus.js';

const MODAL_WIDTH  = 860;
const MODAL_HEIGHT = 560;
const STYLE_ID = 'inline-style-add-user-modal-v3';

const ADMIN_ROLE_ID = 0;
const ROOT_ROLE_ID  = 2;
const CHILD_ROLE_ID = 3;

let modalRef = null;
const parentSearchCtx = { timer:null, lastQuery:'' };

/* ---------------- Style Injection ---------------- */
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
  /* ========== Scoped: AddUserModal (v3 + icon-left) ========== */
  .add-user-modal.fixed-size-modal,
  .add-user-modal.fixed-size-modal .modal-body,
  .add-user-modal.fixed-size-modal .modal-form {
    height:100%; overflow:hidden; box-sizing:border-box;
  }
  .add-user-modal .user-form.no-scroll {
    display:flex; flex-direction:column; height:100%;
    overflow:hidden; padding:10px 14px 12px; box-sizing:border-box; gap:10px;
  }
  .add-user-modal .content-scroll-lock { flex:1; display:flex; flex-direction:column; gap:10px; min-height:0; overflow:hidden; }

  .add-user-modal .form-row { display:flex; align-items:center; gap:14px; min-height:40px; }
  .add-user-modal .form-row .form-label { flex:0 0 110px; text-align:left; font-size:13px; color:#c8d0d7; line-height:1.2; }
  .add-user-modal .form-row .form-field { flex:1; display:flex; align-items:center; gap:8px; min-width:0; }

  .add-user-modal .form-row-remark { display:flex; flex-direction:column; gap:6px; }
  .add-user-modal .form-row-remark .form-label { text-align:left; font-size:13px; color:#c8d0d7; }
  .add-user-modal .form-row-remark .form-field { width:100%; }

  .add-user-modal input,
  .add-user-modal select,
  .add-user-modal textarea { width:100%; box-sizing:border-box; }
  .add-user-modal select { min-height:32px; }
  .add-user-modal textarea {
    resize:vertical; overflow-y:auto; overflow-x:hidden;
    min-height:110px; max-height:240px; line-height:1.4; font-size:13px;
  }

  .add-user-modal .region-group { display:flex; gap:12px; width:100%; }
  .add-user-modal .region-group select { flex:1; }

  /* 父账号列表 */
  .add-user-modal .parent-search-list {
    margin-top:6px; max-height:180px; overflow-y:auto; overflow-x:hidden;
    border:1px solid #2d373f; border-radius:4px; background:#141c23; font-size:13px;
  }
  .add-user-modal .parent-item { padding:6px 10px; cursor:pointer; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; border-bottom:1px solid #1f252b; }
  .add-user-modal .parent-item:last-child { border-bottom:none; }
  .add-user-modal .parent-item:hover { background:#1f2b34; color:#fff; }
  .add-user-modal .parent-item.empty { cursor:default; color:#6c7680; }
  .add-user-modal .hint { font-size:12px; color:#7d8891; margin-top:4px; }

  /* 密码：眼睛在输入框左内部 */
  .add-user-modal .pwd-box {
    position:relative;
    flex:1;
    display:flex;
    align-items:center;
  }
  .add-user-modal .pwd-box input {
    padding-left:34px; /* 为左侧图标预留空间 */
  }
  .add-user-modal .pwd-eye {
    position:absolute;
    left:6px;
    top:50%;
    transform:translateY(-50%);
    width:24px;
    height:24px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:14px;
    cursor:pointer;
    border:none;
    background:transparent;
  }
  .add-user-modal .pwd-mini-actions { display:flex; gap:6px; }

  .add-user-modal .pwd-extra {
    display:flex; flex-direction:column; gap:6px;
    padding-left:110px;
    margin-top:-4px;
  }
  .add-user-modal .pwd-strength-line { display:flex; align-items:center; gap:10px; }
  .add-user-modal .pwd-strength-bg { flex:1; height:6px; background:#2a3238; border-radius:3px; overflow:hidden; }
  .add-user-modal .pwd-strength-bar { height:100%; width:0; background:linear-gradient(90deg,#ff4d4f,#ffa940,#52c41a); transition:width .25s; }
  .add-user-modal .pwd-strength-text { font-size:12px; min-width:30px; text-align:left; color:#97a2ad; }
  .add-user-modal .pwd-strength-text[data-level="弱"] { color:#ff7875; }
  .add-user-modal .pwd-strength-text[data-level="中"] { color:#faad14; }
  .add-user-modal .pwd-strength-text[data-level="强"] { color:#52c41a; }

  .add-user-modal .pwd-inline-msg { font-size:12px; min-height:16px; }
  .add-user-modal .pwd-inline-msg.err { color:#ff7875; }
  .add-user-modal .pwd-inline-msg.ok  { color:#52c41a; }

  .add-user-modal .pwd-rules {
    margin:0; padding-left:16px; font-size:12px; color:#97a2ad;
    line-height:1.3; display:flex; gap:12px; flex-wrap:wrap;
  }
  .add-user-modal .pwd-rules li { list-style:disc; }

  .add-user-modal .bottom-actions {
    display:flex; justify-content:flex-end; gap:12px;
    padding-top:8px; border-top:1px solid #1f252b; flex-shrink:0;
  }

  .add-user-modal * { max-width:100%; box-sizing:border-box; }
  .add-user-modal { overflow-x:hidden; }
  `;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

/* ---------------- Public API ---------------- */
export function showAddUserModal() {
  ensureStyle();
  const exist = getModal('addUserModal');
  if (exist) { exist.open(); return; }

  const container = document.createElement('div');
  container.className = 'modal-form add-user-modal fixed-size-modal';
  container.innerHTML = buildFormHTML();

  modalRef = createModal({
    id:'addUserModal',
    title:'添加用户',
    width:MODAL_WIDTH,
    height:MODAL_HEIGHT,
    content:container,
    footerButtons:[]
  });
  if (modalRef?.el && MODAL_HEIGHT) modalRef.el.style.height = MODAL_HEIGHT + 'px';

  if (!modalRef) return;
  const form = container.querySelector('#addUserForm');
  form.querySelector('[data-close]').addEventListener('click', destroyModal);

  initRoles(form.querySelector('#roleSelect'), form);
  initRegion(form, authState.get().userInfo);
  bindRoleChange(form);
  bindParentSearch(form);
  bindPasswordEnhance(form);
  form.addEventListener('submit', onSubmit);
}

/* ---------------- HTML ---------------- */
function buildFormHTML() {
  return `
    <form id="addUserForm" class="user-form no-scroll" autocomplete="off">
      <div class="content-scroll-lock">
        <input type="hidden" name="parentUserId" value="0" />

        <div class="form-row">
          <div class="form-label">用户角色 <span class="req">*</span></div>
          <div class="form-field">
            <select name="roleId" id="roleSelect" required></select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">登录账号 <span class="req">*</span></div>
          <div class="form-field">
            <input name="account" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" placeholder="字母/数字/下划线"/>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">用户名 <span class="req">*</span></div>
          <div class="form-field">
            <input name="name" required minlength="2" maxlength="32"/>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">密码 <span class="req">*</span></div>
          <div class="form-field">
            <div class="pwd-box">
              <button type="button" class="pwd-eye" data-eye="pwd1" title="显示/隐藏">👁</button>
              <input type="password" name="password" id="pwd1" minlength="8" placeholder="至少8位，含 2 类字符" autocomplete="new-password" required/>
            </div>
            <div class="pwd-mini-actions">
              <button type="button" class="btn btn-xs" id="btnGenPwd">生成</button>
              <button type="button" class="btn btn-xs" id="btnCopyPwd">复制</button>
            </div>
          </div>
        </div>

        <div class="pwd-extra">
          <div class="pwd-strength-line">
            <div class="pwd-strength-bg"><div id="pwdStrengthBar" class="pwd-strength-bar"></div></div>
            <span id="pwdStrengthText" class="pwd-strength-text" data-level=""></span>
          </div>
            <div class="pwd-inline-msg" id="pwdInlineMsg"></div>
          <ul class="pwd-rules">
            <li>≥8位</li><li>≥2类字符</li><li>需二次确认</li>
          </ul>
        </div>

        <div class="form-row">
          <div class="form-label">确认密码 <span class="req">*</span></div>
          <div class="form-field">
            <div class="pwd-box">
              <button type="button" class="pwd-eye" data-eye="pwd2">👁</button>
              <input type="password" name="password2" id="pwd2" minlength="8" placeholder="再次输入密码" autocomplete="new-password" required/>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">地区</div>
          <div class="form-field region-group">
            <select name="provinceId" id="provinceSel"></select>
            <select name="cityId" id="citySel"></select>
            <select name="zoneId" id="zoneSel"></select>
          </div>
        </div>

        <div class="form-row" id="parentUserRow" style="display:none;">
          <div class="form-label">所属账号 <span class="req">*</span></div>
          <div class="form-field">
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
              <input id="parentUserInput" placeholder="搜索总帐号 (roleId=2)"/>
              <div id="parentSearchResult" class="parent-search-list"></div>
              <div class="hint">仅可选择总帐号；显示: userId 账号 用户名</div>
            </div>
            <input type="hidden" name="parentUserId" value="0" />
          </div>
        </div>

        <div class="form-row-remark">
          <div class="form-label">备注</div>
          <div class="form-field">
            <textarea name="memo" maxlength="200" placeholder="不超过200字"></textarea>
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <button type="submit" id="btnSubmitAddUser" class="btn btn-primary" disabled>确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* ---------------- Roles & Parent ---------------- */
function initRoles(selectEl, form) {
  apiRoleList().then(data => {
    const roles = data.roles || [];
    const currentRoleId = authState.get().userInfo?.roleId;
    const filtered = roles.filter(r => r.roleId > currentRoleId && r.roleId !== ADMIN_ROLE_ID);
    selectEl.innerHTML = filtered.map(r =>
      `<option value="${r.roleId}" data-roleid="${r.roleId}">${escapeHTML(r.roleName||'')}</option>`).join('');
    updateParent(form);
  });
}
function bindRoleChange(form) {
  form.querySelector('#roleSelect').addEventListener('change', () => updateParent(form));
}
function updateParent(form) {
  const current = authState.get().userInfo;
  const roleId = Number(form.querySelector('#roleSelect').value);
  const row = form.querySelector('#parentUserRow');
  const hidden = form.querySelector('input[name=parentUserId]');
  if (roleId === CHILD_ROLE_ID) {
    row.style.display = '';
    hidden.value = '';
    form.querySelector('#parentUserInput').value = '';
    form.querySelector('#parentSearchResult').innerHTML = '';
  } else {
    row.style.display = 'none';
    hidden.value = current?.userId || 0;
  }
}

/* ---------------- Parent Search ---------------- */
function bindParentSearch(form) {
  const input = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  if (!input) return;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (parentSearchCtx.timer) clearTimeout(parentSearchCtx.timer);
    if (!val) {
      result.innerHTML=''; parentSearchCtx.lastQuery=''; form.querySelector('input[name=parentUserId]').value='';
      return;
    }
    parentSearchCtx.timer = setTimeout(() => {
      if (val === parentSearchCtx.lastQuery) return;
      parentSearchCtx.lastQuery = val;
      apiUserQuery(val,1,30).then(data => {
        let list = (data.users||[]).filter(u => u.roleId === ROOT_ROLE_ID);
        if (!list.length) {
          result.innerHTML = `<div class="parent-item empty">无匹配总帐号</div>`;
          return;
        }
        result.innerHTML = list.map(u => `
          <div class="parent-item" data-id="${u.userId}">
            ${u.userId} ${escapeHTML(u.userAccount||'')} ${escapeHTML(u.userName||'')}
          </div>`).join('');
        result.querySelectorAll('.parent-item').forEach(div=>{
          if (div.classList.contains('empty')) return;
          div.addEventListener('click', ()=>{
            form.querySelector('input[name=parentUserId]').value = div.getAttribute('data-id');
            input.value = div.textContent;
            result.innerHTML='';
          });
        });
      });
    },300);
  });
}

/* ---------------- Region ---------------- */
function initRegion(form, currentUser) {
  const pSel=form.querySelector('#provinceSel');
  const cSel=form.querySelector('#citySel');
  const zSel=form.querySelector('#zoneSel');
  const ip=currentUser?.provinceId, ic=currentUser?.cityId, iz=currentUser?.zoneId;

  apiProvinceList().then(data=>{
    const arr=data.provinces||[];
    pSel.innerHTML=arr.map(p=>`<option value="${p.provinceId}" ${p.provinceId===ip?'selected':''}>${escapeHTML(p.provinceName||'')}</option>`).join('');
    if(!pSel.value && arr.length) pSel.value=arr[0].provinceId;
    loadCities();
  });
  pSel.addEventListener('change',loadCities);

  function loadCities(){
    const pid=Number(pSel.value);
    if(!pid){ cSel.innerHTML=''; zSel.innerHTML=''; return; }
    apiCityList(pid).then(data=>{
      const arr=data.cities||[];
      cSel.innerHTML=arr.map(c=>`<option value="${c.cityId}" ${c.cityId===ic?'selected':''}>${escapeHTML(c.cityName||'')}</option>`).join('');
      if(!cSel.value && arr.length) cSel.value=arr[0].cityId;
      loadZones();
    });
  }
  cSel.addEventListener('change',loadZones);

  function loadZones(){
    const cid=Number(cSel.value);
    if(!cid){ zSel.innerHTML=''; return; }
    apiZoneList(cid).then(data=>{
      const arr=data.zones||[];
      zSel.innerHTML=arr.map(z=>`<option value="${z.zoneId}" ${z.zoneId===iz?'selected':''}>${escapeHTML(z.zoneName||'')}</option>`).join('');
      if(!zSel.value && arr.length) zSel.value=arr[0].zoneId;
    });
  }
}

/* ---------------- Password Enhance ---------------- */
function bindPasswordEnhance(form) {
  const pwd1 = form.querySelector('#pwd1');
  const pwd2 = form.querySelector('#pwd2');
  const msgEl = form.querySelector('#pwdInlineMsg');
  const submitBtn = form.querySelector('#btnSubmitAddUser');
  const bar = form.querySelector('#pwdStrengthBar');
  const strengthText = form.querySelector('#pwdStrengthText');
  const genBtn = form.querySelector('#btnGenPwd');
  const copyBtn = form.querySelector('#btnCopyPwd');

  // 眼睛按钮（左侧内嵌）
  form.querySelectorAll('.pwd-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = form.querySelector('#' + btn.dataset.eye);
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

  genBtn?.addEventListener('click', async () => {
    const newPwd = generateStrongPassword(12);
    pwd1.value = newPwd;
    pwd2.value = newPwd;
    validate();
    try {
      await copyToClipboard(newPwd);
      eventBus.emit('toast:show', { type:'info', message:'已生成并复制' });
    } catch {
      eventBus.emit('toast:show', { type:'warn', message:'已生成，复制失败，请手动复制' });
    }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!pwd1.value) {
      eventBus.emit('toast:show', { type:'warn', message:'无可复制密码' });
      return;
    }
    try {
      await copyToClipboard(pwd1.value);
      eventBus.emit('toast:show', { type:'success', message:'已复制密码' });
    } catch {
      eventBus.emit('toast:show', { type:'error', message:'复制失败，请手动选择文本' });
    }
  });

  pwd1.addEventListener('input', validate);
  pwd2.addEventListener('input', validate);
  validate();

  function validate() {
    const { ok, msg, score, level } = validatePassword(pwd1.value, pwd2.value);
    msgEl.textContent = msg;
    msgEl.className = 'pwd-inline-msg ' + (ok ? 'ok' : 'err');
    bar.style.width = Math.min(100, score) + '%';
    strengthText.textContent = level || '';
    strengthText.dataset.level = level || '';
    submitBtn.disabled = !ok;
  }
}

function validatePassword(p1,p2){
  const r={ok:false,msg:'',score:0,level:''};
  if(!p1){r.msg='请输入密码';return r;}
  if(p1.length<8){r.msg='密码长度不足 8';return r;}
  let cls=0; if(/[a-z]/.test(p1))cls++; if(/[A-Z]/.test(p1))cls++; if(/\d/.test(p1))cls++; if(/[^A-Za-z0-9]/.test(p1))cls++;
  if(cls<2){r.msg='至少包含 2 类字符';return r;}
  if(!p2){r.msg='请确认密码';return r;}
  if(p1!==p2){r.msg='两次密码不一致';return r;}
  let score=Math.min(60,p1.length*4); score+=(cls-2)*15; if(/([A-Za-z0-9])\1{2,}/.test(p1))score-=10;
  score=Math.max(0,Math.min(100,score));
  r.level=score>=75?'强':score>=50?'中':'弱';
  r.ok=true; r.msg='密码合法'; r.score=score;
  return r;
}
function generateStrongPassword(len=12){
  const pools={ upper:'ABCDEFGHJKLMNPQRSTUVWXYZ', lower:'abcdefghijkmnopqrstuvwxyz', digit:'23456789', symbol:'!@#$%^&*?_+-=~' };
  const pick=s=>s[Math.floor(Math.random()*s.length)];
  let base=[pick(pools.upper),pick(pools.lower),pick(pools.digit),pick(pools.symbol)];
  const all=Object.values(pools).join('');
  while(base.length<len) base.push(pick(all));
  for(let i=base.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; [base[i],base[j]]=[base[j],base[i]]; }
  return base.join('');
}
function copyToClipboard(text) {
  // 返回 Promise 以便调用方可根据结果提示
  return new Promise(async (resolve, reject) => {
    try {
      // 优先使用异步 API（需安全上下文 & 用户手势）
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return resolve(true);
      }
    } catch (e) {
      // 继续尝试旧方式
    }

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      document.body.appendChild(el);
      const selection = document.getSelection();
      const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      el.select();
      const ok = document.execCommand('copy');
      if (originalRange && selection) {
        selection.removeAllRanges();
        selection.addRange(originalRange);
      } else {
        window.getSelection()?.removeAllRanges();
      }
      el.remove();
      if (ok) return resolve(true);
      return reject(new Error('execCommand copy failed'));
    } catch (err) {
      return reject(err);
    }
  });
}

/* ---------------- Submit ---------------- */
function onSubmit(e){
  e.preventDefault();
  const form=e.target;
  const fd=new FormData(form);
  const current=authState.get().userInfo;

  const pwd=(fd.get('password')||'').trim();
  const pwd2=(fd.get('password2')||'').trim();
  const v=validatePassword(pwd,pwd2);
  if(!v.ok){ eventBus.emit('toast:show',{type:'error',message:v.msg}); return; }

  const roleId=Number(fd.get('roleId'));
  if(roleId===ADMIN_ROLE_ID){
    eventBus.emit('toast:show',{type:'error',message:'禁止创建管理员账户'}); return;
  }
  if(roleId<=current.roleId){
    eventBus.emit('toast:show',{type:'error',message:'不可创建与自己同级或更高角色'}); return;
  }

  const isChild=(roleId===CHILD_ROLE_ID);
  let parentUserId=Number(fd.get('parentUserId')||0);
  if(!isChild){ parentUserId=current?.userId||0; }
  else if(!parentUserId){
    eventBus.emit('toast:show',{type:'error',message:'请选择父账号'}); return;
  }

  const payload={
    roleId,
    account:(fd.get('account')||'').trim(),
    name:(fd.get('name')||'').trim(),
    password:pwd,
    provinceId:Number(fd.get('provinceId')||0),
    cityId:Number(fd.get('cityId')||0),
    zoneId:Number(fd.get('zoneId')||0),
    parentUserId,
    memo:(fd.get('memo')||'').trim()
  };
  if(!payload.account || !payload.name){
    eventBus.emit('toast:show',{type:'error',message:'请填写必填字段'}); return;
  }

  apiUserCreate(payload).then(()=>{
    eventBus.emit('toast:show',{type:'success',message:'添加成功'});
    eventBus.emit('user:list:reload');
    destroyModal();
  });
}

/* ---------------- Destroy & Utils ---------------- */
function destroyModal(){
  if(modalRef){ modalRef.close(); modalRef=null; }
  if(parentSearchCtx.timer){ clearTimeout(parentSearchCtx.timer); parentSearchCtx.timer=null; }
}
function escapeHTML(str=''){
  return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}