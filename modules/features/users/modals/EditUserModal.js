/**
 * EditUserModal
 * - 行内布局（除备注两行）
 * - 标签统一左对齐
 * - 父账号仅子帐号角色显示；列表滚动
 * - 内联样式（更新：label left）
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiRoleList, apiUserQuery, apiUserUpdate } from '@api/userApi.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { authState } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';

const MODAL_WIDTH  = 860;
const MODAL_HEIGHT = 560;
const STYLE_ID = 'inline-style-edit-user-modal-v3';

const ADMIN_ROLE_ID = 0;
const ROOT_ROLE_ID  = 2;
const CHILD_ROLE_ID = 3;

let modalRef = null;
const parentSearchCtx = { timer:null, lastQuery:'' };

/* ---------------- Style ---------------- */
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
  /* ========== Scoped: EditUserModal (v3) ========== */
  .edit-user-modal.fixed-size-modal,
  .edit-user-modal.fixed-size-modal .modal-body,
  .edit-user-modal.fixed-size-modal .modal-form {
    height:100%; overflow:hidden; box-sizing:border-box;
  }
  .edit-user-modal .user-form.no-scroll {
    display:flex; flex-direction:column; height:100%;
    overflow:hidden; padding:10px 14px 12px; box-sizing:border-box; gap:10px;
  }
  .edit-user-modal .content-scroll-lock {
    flex:1; display:flex; flex-direction:column; gap:10px; min-height:0; overflow:hidden;
  }
  .edit-user-modal .form-row {
    display:flex; align-items:center; gap:14px; min-height:40px;
  }
  .edit-user-modal .form-row .form-label {
    flex:0 0 110px; text-align:left; font-size:13px; color:#c8d0d7; line-height:1.2;
  }
  .edit-user-modal .form-row .form-field {
    flex:1; display:flex; align-items:center; gap:8px; min-width:0;
  }
  .edit-user-modal input,
  .edit-user-modal select,
  .edit-user-modal textarea {
    width:100%; box-sizing:border-box;
  }
  .edit-user-modal select { min-height:32px; }
  .edit-user-modal .region-group { display:flex; gap:12px; width:100%; }
  .edit-user-modal .region-group select { flex:1; }
  .edit-user-modal .form-row-remark { display:flex; flex-direction:column; gap:6px; }
  .edit-user-modal .form-row-remark .form-label { text-align:left; font-size:13px; color:#c8d0d7; }
  .edit-user-modal textarea {
    resize:vertical; overflow-y:auto; overflow-x:hidden;
    min-height:110px; max-height:240px; line-height:1.4; font-size:13px;
  }
  .edit-user-modal .parent-search-list {
    margin-top:6px; max-height:180px; overflow-y:auto; overflow-x:hidden;
    border:1px solid #2d373f; border-radius:4px; background:#141c23; font-size:13px;
  }
  .edit-user-modal .parent-search-list::-webkit-scrollbar { width:8px; }
  .edit-user-modal .parent-search-list::-webkit-scrollbar-thumb { background:#2c3943; border-radius:4px; }
  .edit-user-modal .parent-item { padding:6px 10px; cursor:pointer; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; border-bottom:1px solid #1f252b; }
  .edit-user-modal .parent-item:last-child { border-bottom:none; }
  .edit-user-modal .parent-item:hover { background:#1f2b34; color:#fff; }
  .edit-user-modal .parent-item.empty { cursor:default; color:#6c7680; }
  .edit-user-modal .hint { font-size:12px; color:#7d8891; margin-top:4px; }
  .edit-user-modal .bottom-actions {
    display:flex; justify-content:flex-end; gap:12px;
    padding-top:8px; border-top:1px solid #1f252b; flex-shrink:0;
  }
  .edit-user-modal * { max-width:100%; box-sizing:border-box; }
  .edit-user-modal { overflow-x:hidden; }
  `;
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=css;
  document.head.appendChild(style);
}

/* ---------------- Public API ---------------- */
export function showEditUserModal(user){
  ensureStyle();
  const exist=getModal('editUserModal');
  if(exist){ exist.open(); return; }

  const container=document.createElement('div');
  container.className='modal-form edit-user-modal fixed-size-modal';
  container.innerHTML=formHTML(user);

  modalRef=createModal({
    id:'editUserModal',
    title:'修改用户信息',
    width:MODAL_WIDTH,
    height:MODAL_HEIGHT,
    content:container,
    footerButtons:[]
  });
  if(modalRef?.el && MODAL_HEIGHT) modalRef.el.style.height=MODAL_HEIGHT+'px';

  if(!modalRef) return;
  const form=container.querySelector('#editUserForm');
  form.querySelector('[data-close]').addEventListener('click', destroy);

  initRoles(form.querySelector('#roleSelect'), form, user);
  initRegion(form, user);
  bindRoleChange(form, user);
  bindParentSearch(form);
  fillBasic(form, user);

  form.addEventListener('submit', e=>onSubmit(e,user));
}

/* ---------------- HTML ---------------- */
function formHTML(user){
  return `
    <form id="editUserForm" class="user-form no-scroll" autocomplete="off">
      <div class="content-scroll-lock">
        <input type="hidden" name="userId" value="${user.userId}">
        <input type="hidden" name="parentUserId" value="0"/>

        <div class="form-row">
          <div class="form-label">用户角色 <span class="req">*</span></div>
          <div class="form-field"><select name="roleId" id="roleSelect" required></select></div>
        </div>

        <div class="form-row">
          <div class="form-label">登录账号</div>
          <div class="form-field">
            <input name="account" value="${escapeHTML(user.userAccount||'')}" disabled />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">用户名 <span class="req">*</span></div>
          <div class="form-field">
            <input name="name" id="nameInput" required minlength="2" maxlength="32" value="${escapeHTML(user.userName||'')}"/>
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
          </div>
        </div>

        <div class="form-row-remark">
          <div class="form-label">备注</div>
          <div class="form-field">
            <textarea name="memo" maxlength="200" placeholder="不超过200字">${escapeHTML(user.memo||'')}</textarea>
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <button type="submit" class="btn btn-primary">确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* ---------------- Roles & Parent ---------------- */
function initRoles(selectEl, form, user){
  apiRoleList().then(data=>{
    const roles=data.roles||[];
    const currentRoleId=authState.get().userInfo.roleId;
    const filtered=roles.filter(r=>r.roleId>currentRoleId && r.roleId!==ADMIN_ROLE_ID);
    let found=filtered.find(r=>r.roleId===user.roleId);
    let disable=false;
    if(!found){
      disable=true;
      filtered.push({ roleId:user.roleId, roleName:user.roleName+'(当前不可变更)' });
    }
    selectEl.innerHTML=filtered
      .sort((a,b)=>a.roleId-b.roleId)
      .map(r=>`<option value="${r.roleId}" data-roleid="${r.roleId}">${escapeHTML(r.roleName||'')}</option>`)
      .join('');
    selectEl.value=String(user.roleId);
    if(disable) selectEl.disabled=true;
    updateParent(form,user);
  });
}
function bindRoleChange(form,user){
  form.querySelector('#roleSelect').addEventListener('change',()=>updateParent(form,user));
}
function updateParent(form,user){
  const current=authState.get().userInfo;
  const roleId=Number(form.querySelector('#roleSelect').value);
  const row=form.querySelector('#parentUserRow');
  const hidden=form.querySelector('input[name=parentUserId]');
  const input=form.querySelector('#parentUserInput');
  const resultBox=form.querySelector('#parentSearchResult');

  if(roleId===CHILD_ROLE_ID){
    row.style.display='';
    if(user.roleId===CHILD_ROLE_ID && user.parentUserId){
      hidden.value=user.parentUserId;
      input.value=`${user.parentUserId} ${user.parentUserAccount||''} ${user.parentUserName||''}`;
    } else {
      hidden.value=''; input.value='';
    }
    resultBox.innerHTML='';
  } else {
    row.style.display='none';
    hidden.value=current.userId;
    input.value='';
    resultBox.innerHTML='';
  }
}

/* ---------------- Parent Search ---------------- */
// 替换原来的 bindParentSearch 函数
function bindParentSearch(form){
  const input  = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  if(!input) return;

  // 当前正在编辑的用户ID（即不允许出现在父账号候选里的那个）
  const editingUserId = Number(form.querySelector('input[name="userId"]')?.value);

  input.addEventListener('input', ()=>{
    const val = input.value.trim();
    if (parentSearchCtx.timer) clearTimeout(parentSearchCtx.timer);

    if (!val) {
      result.innerHTML = '';
      parentSearchCtx.lastQuery = '';
      // 不主动清空 hidden 的 parentUserId（可能用户已选过）
      return;
    }

    parentSearchCtx.timer = setTimeout(()=>{
      if (val === parentSearchCtx.lastQuery) return;
      parentSearchCtx.lastQuery = val;

      apiUserQuery(val, 1, 30).then(data=>{
        // 只要总帐号 (roleId=2)，并排除当前正在编辑的用户自己
        let list = (data.users || []).filter(u => u.roleId === ROOT_ROLE_ID && u.userId !== editingUserId);

        if (!list.length) {
          result.innerHTML = `<div class="parent-item empty">无可选总帐号</div>`;
          return;
        }

        result.innerHTML = list.map(u => `
          <div class="parent-item" data-id="${u.userId}">
            ${u.userId} ${escapeHTML(u.userAccount||'')} ${escapeHTML(u.userName||'')}
          </div>
        `).join('');

        result.querySelectorAll('.parent-item').forEach(div=>{
          if (div.classList.contains('empty')) return;
          div.addEventListener('click', ()=>{
            form.querySelector('input[name=parentUserId]').value = div.getAttribute('data-id');
            input.value = div.textContent;
            result.innerHTML = '';
          });
        });
      });
    }, 300);
  });
}
/* ---------------- Region ---------------- */
function initRegion(form, user){
  const pSel=form.querySelector('#provinceSel');
  const cSel=form.querySelector('#citySel');
  const zSel=form.querySelector('#zoneSel');
  const ip=user.provinceId, ic=user.cityId, iz=user.zoneId;

  apiProvinceList().then(data=>{
    const arr=data.provinces||[];
    pSel.innerHTML=arr.map(p=>
      `<option value="${p.provinceId}" ${p.provinceId===ip?'selected':''}>${escapeHTML(p.provinceName||'')}</option>`
    ).join('');
    if(!pSel.value && arr.length) pSel.value=arr[0].provinceId;
    loadCities();
  });
  pSel.addEventListener('change',loadCities);

  function loadCities(){
    const pid=Number(pSel.value);
    if(!pid){ cSel.innerHTML=''; zSel.innerHTML=''; return; }
    apiCityList(pid).then(data=>{
      const arr=data.cities||[];
      cSel.innerHTML=arr.map(c=>
        `<option value="${c.cityId}" ${c.cityId===ic?'selected':''}>${escapeHTML(c.cityName||'')}</option>`
      ).join('');
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
      zSel.innerHTML=arr.map(z=>
        `<option value="${z.zoneId}" ${z.zoneId===iz?'selected':''}>${escapeHTML(z.zoneName||'')}</option>`
      ).join('');
      if(!zSel.value && arr.length) zSel.value=arr[0].zoneId;
    });
  }
}

/* ---------------- Fill & Submit ---------------- */
function fillBasic(form,user){
  form.querySelector('textarea[name=memo]').value=user.memo||'';
}
function onSubmit(e, originalUser){
  e.preventDefault();
  const form=e.target;
  const fd=new FormData(form);
  const current=authState.get().userInfo;

  const roleId=Number(fd.get('roleId'));
  if(roleId===ADMIN_ROLE_ID){
    eventBus.emit('toast:show',{type:'error',message:'禁止设置为管理员角色'}); return;
  }
  if(roleId<=current.roleId){
    eventBus.emit('toast:show',{type:'error',message:'无权限设置此角色'}); return;
  }

  const isChild=roleId===CHILD_ROLE_ID;
  let parentUserId=Number(fd.get('parentUserId')||0);
  if(!isChild){ parentUserId=current.userId; }
  else if(!parentUserId){
    eventBus.emit('toast:show',{type:'error',message:'请选择父账号'}); return;
  }

  const payload={
    userId:Number(fd.get('userId')),
    roleId,
    name:(fd.get('name')||'').trim(),
    provinceId:Number(fd.get('provinceId')||0),
    cityId:Number(fd.get('cityId')||0),
    zoneId:Number(fd.get('zoneId')||0),
    parentUserId,
    memo:(fd.get('memo')||'').trim()
  };
  if(!payload.name){
    eventBus.emit('toast:show',{type:'error',message:'请输入用户名'}); return;
  }

  apiUserUpdate(payload).then(()=>{
    eventBus.emit('toast:show',{type:'success',message:'修改成功'});
    eventBus.emit('user:list:reload');
    destroy();
  });
}

/* ---------------- Destroy & Utils ---------------- */
function destroy(){
  if(modalRef){ modalRef.close(); modalRef=null; }
  if(parentSearchCtx.timer){ clearTimeout(parentSearchCtx.timer); parentSearchCtx.timer=null; }
}
function escapeHTML(str=''){
  return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}