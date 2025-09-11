import { authLogin } from '../../core/auth.js';
import { eventBus } from '@core/eventBus.js'; // 若没有可删除此行及 toast 相关调用

let captchaText = '';
let mounted = false;

export function mountLoginPage() {
  mounted = true;

  // 登录模式：隐藏侧栏 / 侧栏折叠按钮 / 头部登录按钮
  const appLayout = document.getElementById('appLayout');
  appLayout && appLayout.classList.add('login-mode');

  const sideBar = document.getElementById('sideBar');
  if (sideBar) sideBar.style.display = 'none';

  // 可能存在的侧栏折叠按钮（以前插入的）
  const collapseBtn = document.querySelector('#sideBar .sb-collapse-btn');
  if (collapseBtn) collapseBtn.style.display = 'none';

  // 头部右上角“登录”按钮（示例 id：headerLoginBtn；若你的实际不一致，可调整）
  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (headerLoginBtn) headerLoginBtn.style.display = 'none';
  // 兜底：文本为“登录”的按钮也隐藏（如果没有 id）
  document.querySelectorAll('button, a').forEach(el => {
    if ((/登录/.test(el.textContent || '')) && !el.id) {
      el.style.display = 'none';
    }
  });

  const main = document.getElementById('mainView');
  // 清空并渲染登录卡片（不再有外围大边框）
  main.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h2 class="login-title">设备管理平台登录</h2>
        <form id="loginForm" autocomplete="off">
          <div class="form-item">
            <label class="form-label">账号</label>
            <div class="form-field">
              <input name="account" required autocomplete="username" autofocus />
            </div>
          </div>
          <div class="form-item">
            <label class="form-label">密码</label>
            <div class="form-field pwd-field">
              <input type="password" name="pwd" required autocomplete="current-password" />
              <button type="button" class="pwd-eye" title="显示/隐藏">👁</button>
            </div>
          </div>
          <div class="form-item">
            <label class="form-label">验证码</label>
            <div class="form-field captcha-field">
              <input name="captcha" required placeholder="不区分大小写" autocomplete="off" />
              <canvas id="captchaCanvas" width="120" height="40" title="点击刷新验证码"></canvas>
              <button type="button" id="btnCaptchaRefresh" class="btn captcha-icon-btn" title="刷新验证码" aria-label="刷新">
                <svg viewBox="0 0 24 24" class="icon-refresh" width="18" height="18">
                  <path d="M12 5V2L8 6l4 4V7c2.757 0 5 2.243 5 5a5 5 0 0 1-5 5 5.002 5.002 0 0 1-4.9-4H5.917A7.002 7.002 0 0 0 12 21a7 7 0 0 0 0-14Z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="form-item inline-msg" id="loginInlineMsg"></div>
          <div class="form-actions">
            <button class="btn btn-primary" id="btnLogin" type="submit">登录</button>
          </div>
        </form>
      </div>
      <div class="login-footer">© ${new Date().getFullYear()} Company</div>
    </div>
  `;

  const form = main.querySelector('#loginForm');
  form.addEventListener('submit', onSubmit);

  form.querySelector('.pwd-eye').addEventListener('click', togglePwdVisibility);
  form.querySelector('#btnCaptchaRefresh').addEventListener('click', generateCaptcha);
  form.querySelector('#captchaCanvas').addEventListener('click', generateCaptcha);

  generateCaptcha();
  return () => {};
}

export function unmountLoginPage() {
  mounted = false;
  // 还原（下次进入其他页面）
  const sideBar = document.getElementById('sideBar');
  if (sideBar) {
    sideBar.style.display = '';
  }
  const appLayout = document.getElementById('appLayout');
  appLayout && appLayout.classList.remove('login-mode');

  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (headerLoginBtn) headerLoginBtn.style.display = '';
  const collapseBtn = document.querySelector('#sideBar .sb-collapse-btn');
  if (collapseBtn) collapseBtn.style.display = '';
}

/* ---------------- 提交 ---------------- */
function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const acc = (fd.get('account') || '').trim();
  const pwd = (fd.get('pwd') || '').trim();
  const cap = (fd.get('captcha') || '').trim();

  const msgEl = form.querySelector('#loginInlineMsg');
  msgEl.textContent = '';
  msgEl.className = 'form-item inline-msg';

  // 只校验非空 & 验证码，按你的要求不做长度校验
  if (!acc || !pwd || !cap) {
    msgEl.textContent = '请填写所有字段';
    msgEl.classList.add('err');
    return;
  }
  if (!validateCaptcha(cap)) {
    msgEl.textContent = '验证码错误';
    msgEl.classList.add('err');
    generateCaptcha();
    return;
  }

  const btn = form.querySelector('#btnLogin');
  btn.disabled = true;
  btn.textContent = '登录中...';

  authLogin(acc, pwd)
    .then(() => {
      eventBus?.emit?.('toast:show', { type:'success', message:'登录成功' });
      location.hash = '#/users';
    })
    .catch(err => {
      msgEl.textContent = (err && err.msg) || '登录失败';
      msgEl.classList.add('err');
      generateCaptcha();
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = '登录';
    });
}

function togglePwdVisibility(e) {
  const input = e.currentTarget.parentElement.querySelector('input[name=pwd]');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    e.currentTarget.textContent = '🙈';
  } else {
    input.type = 'password';
    e.currentTarget.textContent = '👁';
  }
}

/* ---------------- 验证码 ---------------- */
function generateCaptcha() {
  captchaText = randomCaptcha(5);
  drawCaptcha(captchaText);
}

function randomCaptcha(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function drawCaptcha(text) {
  const c = document.getElementById('captchaCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0,0,w,h);

  const g = ctx.createLinearGradient(0,0,w,h);
  g.addColorStop(0,'#1d252d');
  g.addColorStop(1,'#26323d');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);

  for (let i=0;i<text.length;i++) {
    const ch = text[i];
    const fs = 20 + Math.random()*6;
    ctx.font = `${fs}px bold monospace`;
    ctx.fillStyle = randColor();
    const x = 10 + i*(w-20)/text.length;
    const y = 25 + Math.random()*8;
    const ang = (Math.random()-0.5)*0.6;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(ang);
    ctx.fillText(ch,0,0);
    ctx.restore();
  }
  for (let i=0;i<4;i++) {
    ctx.strokeStyle = randColor();
    ctx.beginPath();
    ctx.moveTo(Math.random()*w, Math.random()*h);
    ctx.lineTo(Math.random()*w, Math.random()*h);
    ctx.stroke();
  }
  for (let i=0;i<18;i++) {
    ctx.fillStyle = randColor();
    ctx.fillRect(Math.random()*w, Math.random()*h, 2, 2);
  }
}

function randColor() {
  return `rgb(${100+Math.random()*155|0},${100+Math.random()*155|0},${100+Math.random()*155|0})`;
}
function validateCaptcha(input) {
  return input.toLowerCase() === captchaText.toLowerCase();
}