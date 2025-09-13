/**
 * 修改密码弹窗 (适配 3.12 接口 /api/web/user/update_password)
 *  - selfChange(本人修改) 需要 oldpwd
 *  - 上级修改下级 不需要 oldpwd
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiUserChangePassword } from '@api/userApi.js';
import { eventBus } from '@core/eventBus.js';
import { authState } from '@core/auth.js';

let modalRef = null;

// 替换原来的 showPasswordModal 函数
// 2. 替换原 showPasswordModal（仅增加 ensurePasswordModalStyle 调用，其他逻辑保持）
export function showPasswordModal(user) {
  ensurePasswordModalStyle();  // 新增调用：注入样式

  const exist = getModal('passwordModal');
  if (exist) { exist.open(); return; }

  const current = authState.get().userInfo;
  const selfChange = current && current.userId === user.userId;

  const content = document.createElement('div');
  content.className = 'password-modal';
  content.innerHTML = buildHTML(user, selfChange);

  modalRef = createModal({
    id: 'passwordModal',
    title: '修改密码',
    width: 480,
    content,
    footerButtons: []
  });
  if (!modalRef) return;

  const form = modalRef.body.querySelector('#pwdForm');
  const oldPwd = form.querySelector('input[name=oldpwd]');
  const pwd1 = form.querySelector('input[name=pwd1]');
  const pwd2 = form.querySelector('input[name=pwd2]');
  const submitBtn = form.querySelector('#btnPwdSubmit');
  const tipsEl = form.querySelector('#pwdInlineMsg');
  const strengthBar = form.querySelector('#pwdStrengthBar');
  const strengthLabel = form.querySelector('#pwdStrengthLabel');

  form.querySelectorAll('.pwd-eye').forEach(btn => {
    btn.addEventListener('click', () => toggleVisibility(btn));
  });

  const genBtn  = form.querySelector('#btnGenPwd');
  const copyBtn = form.querySelector('#btnCopyPwd');

  genBtn.addEventListener('click', async () => {
    const newPwd = generateStrongPassword(12);
    pwd1.value = newPwd;
    pwd2.value = newPwd;
    triggerValidate();
    try {
      await copyToClipboard(newPwd);
      eventBus.emit('toast:show', { type:'info', message:'已生成并复制' });
    } catch {
      eventBus.emit('toast:show', { type:'warn', message:'已生成，复制失败，请手动复制' });
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!pwd1.value) {
      eventBus.emit('toast:show', { type:'warn', message:'无可复制密码' });
      return;
    }
    try {
      await copyToClipboard(pwd1.value);
      eventBus.emit('toast:show', { type:'success', message:'已复制密码' });
    } catch {
      eventBus.emit('toast:show', { type:'error', message:'复制失败，请手动复制' });
    }
  });

  pwd1.addEventListener('input', triggerValidate);
  pwd2.addEventListener('input', triggerValidate);
  if (oldPwd) oldPwd.addEventListener('input', triggerValidate);

  form.querySelector('[data-close]').addEventListener('click', () => {
    modalRef.close(); modalRef = null;
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const newPwd = pwd1.value.trim();
    const oldPwdVal = oldPwd ? oldPwd.value.trim() : '';
    apiUserChangePassword(user.userId, newPwd, selfChange ? { oldPwd: oldPwdVal } : {})
      .then(() => {
        eventBus.emit('toast:show', { type:'success', message:'密码已更新' });
        modalRef.close(); modalRef = null;
      })
      .catch(err => {
        eventBus.emit('toast:show', { type:'error', message: err?.msg || '修改失败' });
      });
  });

  triggerValidate();

  function triggerValidate() {
    const vOld = oldPwd ? oldPwd.value : '';
    const v1 = pwd1.value;
    const v2 = pwd2.value;
    const { ok, msg, score, level } = validatePassword(v1, v2, selfChange, vOld);
    renderStrength(score, level);
    tipsEl.textContent = msg;
    tipsEl.className = 'pwd-inline-msg ' + (ok ? 'ok' : 'err');
    submitBtn.disabled = !ok;
  }
  function renderStrength(score, level) {
    const percent = Math.min(100, Math.round(score));
    strengthBar.style.width = percent + '%';
    strengthBar.dataset.level = level;
    strengthLabel.textContent = level ? level.toUpperCase() : '';
  }
}
// 1. 新增：样式注入（若你已有类似函数，可直接把 CSS 合并）
function ensurePasswordModalStyle() {
  if (document.getElementById('pwd-modal-inline-style')) return;
  const css = `
  /* ===== PasswordModal inline (eye on left) ===== */
  .password-modal .pwd-field {
    position: relative;
    display: flex;
    align-items: center;
  }
  .password-modal .pwd-field input {
    width: 100%;
    box-sizing: border-box;
    padding-left: 34px; /* 预留左侧图标空间 */
  }
  .password-modal .pwd-field .pwd-eye {
    position: absolute;
    left: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .password-modal .pwd-field .pwd-eye:focus {
    outline: 1px solid #3a87ff;
    border-radius: 4px;
  }
  /* 若外层有 with-actions 布局，不影响原有按钮组 */
  `;
  const style = document.createElement('style');
  style.id = 'pwd-modal-inline-style';
  style.textContent = css;
  document.head.appendChild(style);
}
/* ---------- HTML 模板 ---------- */
// 3. 替换 buildHTML（按钮放到输入框左侧，顺序：button + input）
function buildHTML(user, selfChange) {
  return `
    <form id="pwdForm" autocomplete="off">
      <div class="form-item">
        <label class="form-label">用户</label>
        <div class="form-field">
          <input class="readonly" value="${escapeHTML(user.userAccount || '')} (${user.userId})" disabled />
        </div>
      </div>

      ${ selfChange ? `
      <div class="form-item">
        <label class="form-label">旧密码 <span class="req">*</span></label>
        <div class="form-field pwd-field">
          <button type="button" class="pwd-eye" title="显示/隐藏">👁</button>
          <input type="password" name="oldpwd" placeholder="输入当前密码" minlength="1" autocomplete="current-password" required />
        </div>
      </div>` : '' }

      <div class="form-item">
        <label class="form-label">新密码 <span class="req">*</span></label>
        <div class="form-field with-actions">
          <div class="pwd-field">
            <button type="button" class="pwd-eye" title="显示/隐藏">👁</button>
            <input type="password" name="pwd1" placeholder="至少8位，含2种类别" minlength="8" autocomplete="new-password" required />
          </div>
          <div class="pwd-mini-actions">
            <button type="button" class="btn btn-xs" id="btnGenPwd" title="生成随机强密码">生成</button>
            <button type="button" class="btn btn-xs" id="btnCopyPwd" title="复制当前密码">复制</button>
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
          <button type="button" class="pwd-eye" title="显示/隐藏">👁</button>
          <input type="password" name="pwd2" placeholder="再次输入新密码" minlength="8" autocomplete="new-password" required />
        </div>
      </div>

      <div class="form-item">
        <div id="pwdInlineMsg" class="pwd-inline-msg"></div>
        <ul class="pwd-rules">
          ${ selfChange ? '<li>本人修改需输入旧密码</li>' : '' }
          <li>长度 ≥ 8</li>
          <li>至少 2 类字符（大写/小写/数字/符号）</li>
          <li>两次新密码一致</li>
        </ul>
      </div>

      <div class="form-actions">
        <button type="submit" id="btnPwdSubmit" class="btn btn-primary" disabled>确认</button>
        <button type="button" class="btn" data-close>取消</button>
      </div>
    </form>
  `;
}

/* ---------- 校验 ---------- */
function validatePassword(pwd1, pwd2, selfChange, oldPwdVal) {
  const res = { ok:false, msg:'', score:0, level:'' };

  if (selfChange && !oldPwdVal) {
    res.msg = '请输入旧密码';
    return res;
  }
  if (!pwd1) { res.msg='请输入新密码'; return res; }
  if (pwd1.length < 8) { res.msg='新密码不足 8 位'; return res; }

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

/* ---------- 辅助 ---------- */
function toggleVisibility(btn) {
  const field = btn.parentElement.querySelector('input');
  if (!field) return;
  if (field.type === 'password') {
    field.type = 'text';
    btn.textContent = '🙈';
  } else {
    field.type = 'password';
    btn.textContent = '👁';
  }
}

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

// 替换原来的 copyToClipboard 函数
function copyToClipboard(text) {
  return new Promise(async (resolve, reject) => {
    // 首选异步 API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return resolve(true);
      } catch (e) {
        // 继续走降级
      }
    }
    // 降级 execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);

      const selection = document.getSelection();
      const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      ta.select();
      const ok = document.execCommand('copy');

      if (originalRange && selection) {
        selection.removeAllRanges();
        selection.addRange(originalRange);
      } else {
        window.getSelection()?.removeAllRanges();
      }

      ta.remove();
      if (ok) return resolve(true);
      return reject(new Error('execCommand copy failed'));
    } catch (err) {
      return reject(err);
    }
  });
}

function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}