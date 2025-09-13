/**
 * EditUserModal - 模板化
 */
import { createModal, getModal } from '@ui/modal.js';
import { apiRoleList, apiUserQuery, apiUserUpdate } from '@api/userApi.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { authState } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';
import { importTemplate } from '@ui/templateLoader.js';

const MODAL_WIDTH  = 860;
const MODAL_HEIGHT = 560;

const ADMIN_ROLE_ID = 0;
const ROOT_ROLE_ID  = 2;
const CHILD_ROLE_ID = 3;

let modalRef = null;
const parentSearchCtx = { timer:null, lastQuery:'' };

export async function showEditUserModal(user){
  const exist=getModal('editUserModal');
  if(exist){ exist.open(); return; }

  let frag;
  try {
    frag = await importTemplate('/modules/features/pages/modals/templates/edit-user-modal.html', 'tpl-edit-user-modal');
  } catch (e) {
    console.error('[EditUserModal] template load failed', e);
    return;
  }
  const container=document.createElement('div');
  container.appendChild(frag);

  // 预填 ID、账号与备注
  container.querySelector('input[name="userId"]').value = user.userId;
  container.querySelector('#euAccount').value = user.userAccount || '';
  container.querySelector('#euMemo').value = user.memo || '';

  modalRef=createModal({
    id:'editUserModal',
    title:'修改用户信息',
    width:MODAL_WIDTH,
    height:MODAL_HEIGHT,
    content:container,
    footerButtons:[]
  });

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
function bindRoleChange(form,user){ form.querySelector('#roleSelect').addEventListener('change',()=>updateParent(form,user)); }
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
function bindParentSearch(form){
  const input  = form.querySelector('#parentUserInput');
  const result = form.querySelector('#parentSearchResult');
  if(!input) return;

  const editingUserId = Number(form.querySelector('input[name="userId"]')?.value);

  input.addEventListener('input', ()=>{
    const val = input.value.trim();
    if (parentSearchCtx.timer) clearTimeout(parentSearchCtx.timer);

    if (!val) {
      result.innerHTML = '';
      parentSearchCtx.lastQuery = '';
      return;
    }

    parentSearchCtx.timer = setTimeout(()=>{
      if (val === parentSearchCtx.lastQuery) return;
      parentSearchCtx.lastQuery = val;

      apiUserQuery(val, 1, 30).then(data=>{
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
function fillBasic(form,user){ form.querySelector('#nameInput').value = user.userName || ''; }
function onSubmit(e, originalUser){
  e.preventDefault();
  const form=e.target;
  const fd=new FormData(form);
  const current=authState.get().userInfo;

  const ADMIN_ROLE_ID = 0, CHILD_ROLE_ID = 3;

  const roleId=Number(fd.get('roleId'));
  if(roleId===ADMIN_ROLE_ID){ eventBus.emit('toast:show',{type:'error',message:'禁止设置为管理员角色'}); return; }
  if(roleId<=current.roleId){ eventBus.emit('toast:show',{type:'error',message:'无权限设置此角色'}); return; }

  const isChild=roleId===CHILD_ROLE_ID;
  let parentUserId=Number(fd.get('parentUserId')||0);
  if(!isChild){ parentUserId=current.userId; }
  else if(!parentUserId){ eventBus.emit('toast:show',{type:'error',message:'请选择父账号'}); return; }

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
  if(!payload.name){ eventBus.emit('toast:show',{type:'error',message:'请输入用户名'}); return; }

  apiUserUpdate(payload).then(()=>{
    eventBus.emit('toast:show',{type:'success',message:'修改成功'});
    eventBus.emit('user:list:reload');
    destroy();
  });
}

/* ---------------- Destroy & Utils ---------------- */
function destroy(){ if(modalRef){ modalRef.close(); modalRef=null; } if(parentSearchCtx.timer){ clearTimeout(parentSearchCtx.timer); parentSearchCtx.timer=null; } }
function escapeHTML(str=''){ return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }