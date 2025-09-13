/**
 * Login Page Controller
 * Extracted from modules/features/pages/LoginPage.js
 * Preserves original business logic with standalone HTML
 */

// Global namespace for login functionality
window.LoginPage = (function() {
    'use strict';

    let captchaText = '';
    let mounted = false;

    // Mock auth and eventBus functions - replace with actual implementation
    const authLogin = async (account, password) => {
        // Simulate login API call
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (account === 'admin' && password === 'admin123') {
                    resolve({ success: true, token: 'mock-token' });
                } else {
                    reject({ msg: '账号或密码错误' });
                }
            }, 1000);
        });
    };

    const eventBus = {
        emit: (event, data) => {
            console.log('EventBus emit:', event, data);
            // You could implement a real event system here
        }
    };

    function init() {
        if (mounted) return;
        mounted = true;

        const form = document.getElementById('loginForm');
        if (!form) return;

        // Bind event handlers
        form.addEventListener('submit', onSubmit);
        
        const pwdEye = form.querySelector('.pwd-eye');
        if (pwdEye) {
            pwdEye.addEventListener('click', togglePwdVisibility);
        }

        const refreshBtn = form.querySelector('#btnCaptchaRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', generateCaptcha);
        }

        const canvas = form.querySelector('#captchaCanvas');
        if (canvas) {
            canvas.addEventListener('click', generateCaptcha);
        }

        // Generate initial captcha
        generateCaptcha();
    }

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

        // Validation
        if (!acc || !pwd || !cap) {
            showError(msgEl, '请填写所有字段');
            return;
        }
        if (!validateCaptcha(cap)) {
            showError(msgEl, '验证码错误');
            generateCaptcha();
            return;
        }

        const btn = form.querySelector('#btnLogin');
        btn.disabled = true;
        btn.textContent = '登录中...';

        authLogin(acc, pwd)
            .then(() => {
                eventBus.emit('toast:show', { type:'success', message:'登录成功' });
                // Redirect or handle successful login
                console.log('Login successful, redirecting...');
                // window.location.href = '/users.html'; // or appropriate redirect
            })
            .catch(err => {
                showError(msgEl, (err && err.msg) || '登录失败');
                generateCaptcha();
                console.log('Login error:', err);
            })
            .finally(() => {
                btn.disabled = false;
                btn.textContent = '登录';
            });
    }

    function showError(msgEl, message) {
        msgEl.textContent = message;
        msgEl.classList.add('err');
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

    /* ---------------- Captcha Generation ---------------- */
    function generateCaptcha() {
        captchaText = randomCaptcha(5);
        drawCaptcha(captchaText);
    }

    function randomCaptcha(len) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        let s = '';
        for (let i = 0; i < len; i++) {
            s += chars[Math.floor(Math.random() * chars.length)];
        }
        return s;
    }

    function drawCaptcha(text) {
        const c = document.getElementById('captchaCanvas');
        if (!c) return;
        const ctx = c.getContext('2d');
        const w = c.width, h = c.height;
        ctx.clearRect(0, 0, w, h);

        // Background gradient
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1d252d');
        g.addColorStop(1, '#26323d');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        // Draw text
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const fs = 20 + Math.random() * 6;
            ctx.font = `${fs}px bold monospace`;
            ctx.fillStyle = randColor();
            const x = 10 + i * (w - 20) / text.length;
            const y = 25 + Math.random() * 8;
            const ang = (Math.random() - 0.5) * 0.6;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            ctx.fillText(ch, 0, 0);
            ctx.restore();
        }

        // Draw interference lines
        for (let i = 0; i < 4; i++) {
            ctx.strokeStyle = randColor();
            ctx.beginPath();
            ctx.moveTo(Math.random() * w, Math.random() * h);
            ctx.lineTo(Math.random() * w, Math.random() * h);
            ctx.stroke();
        }

        // Draw noise dots
        for (let i = 0; i < 18; i++) {
            ctx.fillStyle = randColor();
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
    }

    function randColor() {
        return `rgb(${100 + Math.random() * 155 | 0},${100 + Math.random() * 155 | 0},${100 + Math.random() * 155 | 0})`;
    }

    function validateCaptcha(input) {
        return input.toLowerCase() === captchaText.toLowerCase();
    }

    // Public API
    return {
        init: init,
        generateCaptcha: generateCaptcha
    };
})();