/**
 * AddUserModal - 模板化
 */
import { createModal, getModal } from '@ui/modal.js';
import { apiUserCreate, apiRoleList, apiUserQuery } from '@api/userApi.js';
import { authState } from '@core/auth.js';
import { apiProvinceList, apiCityList, apiZoneList } from '@api/regionApi.js';
import { eventBus } from '@core/eventBus.js';
import { importTemplate } from '@ui/templateLoader.js';

const MODAL_WIDTH  = 860;
const MODAL_HEIGHT = 560;

const ADMIN_ROLE_ID = 0;
const ROOT_ROLE_ID  = 2;
const CHILD_ROLE_ID = 3;

let modalRef = null;
const parentSearchCtx = { timer:null, lastQuery:'' };

export async function showAddUserModal() {
  const exist = getModal('addUserModal');
  if (exist) { exist.open(); return; }

  let frag;
  try {
    frag = await importTemplate('/modules/features/pages/modals/templates/add-user-modal.html', 'tpl-add-user-modal');
  } catch (e) {
    console.error('[AddUserModal] template load failed', e);
    return;
  }
  const container = document.createElement('div');
  container.appendChild(frag);

  modalRef = createModal({
    id:'addUserModal',
    title:'添加用户',
    width:MODAL_WIDTH,
    height:MODAL_HEIGHT,
    content:container,
    footerButtons:[]
  });

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
function bindRoleChange(form) { form.querySelector('#roleSelect').addEventListener('change', () => updateParent(form)); }
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
    pwd1.value = newPwd; pwd2.value = newPwd; validate();
    try { await copyToClipboard(newPwd); eventBus.emit('toast:show', { type:'info', message:'已生成并复制' }); }
    catch { eventBus.emit('toast:show', { type:'warn', message:'已生成，复制失败，请手动复制' }); }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!pwd1.value) { eventBus.emit('toast:show', { type:'warn', message:'无可复制密码' }); return; }
    try { await copyToClipboard(pwd1.value); eventBus.emit('toast:show', { type:'success', message:'已复制密码' }); }
    catch { eventBus.emit('toast:show', { type:'error', message:'复制失败，请手动选择文本' }); }
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
  return new Promise(async (resolve, reject) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return resolve(true);
      }
    } catch {}
    try {
      const el = document.createElement('textarea');
      el.value = text; el.setAttribute('readonly', ''); el.style.position='fixed'; el.style.left='-9999px'; el.style.top='0';
      document.body.appendChild(el);
      const selection = document.getSelection();
      const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      el.select();
      const ok = document.execCommand('copy');
      if (originalRange && selection) { selection.removeAllRanges(); selection.addRange(originalRange); } else { window.getSelection()?.removeAllRanges(); }
      el.remove();
      if (ok) return resolve(true);
      return reject(new Error('execCommand copy failed'));
    } catch (err) { return reject(err); }
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
  if(roleId===ADMIN_ROLE_ID){ eventBus.emit('toast:show',{type:'error',message:'禁止创建管理员账户'}); return; }
  if(roleId<=current.roleId){ eventBus.emit('toast:show',{type:'error',message:'不可创建与自己同级或更高角色'}); return; }

  const isChild=(roleId===CHILD_ROLE_ID);
  let parentUserId=Number(fd.get('parentUserId')||0);
  if(!isChild){ parentUserId=current?.userId||0; }
  else if(!parentUserId){ eventBus.emit('toast:show',{type:'error',message:'请选择父账号'}); return; }

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
function escapeHTML(str=''){ return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }