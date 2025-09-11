import { authLogin } from '../../core/auth.js';

let rootEl;

export function mountLoginPage() {
  const main = document.getElementById('mainView');
  main.innerHTML = `
    <div class="login-page">
      <h2>登录</h2>
      <form id="loginForm" class="form-vertical">
        <label>账号<input name="account" required autocomplete="username"/></label>
        <label>密码<input type="password" name="pwd" required autocomplete="current-password"/></label>
        <button class="btn btn-primary" type="submit">登录</button>
      </form>
    </div>
  `;
  rootEl = main.querySelector('.login-page');
  const form = main.querySelector('#loginForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const acc = fd.get('account').trim();
    const pwd = fd.get('pwd').trim();
    authLogin(acc, pwd).catch(() => {});
  });
  return () => {};
}

export function unmountLoginPage() {}