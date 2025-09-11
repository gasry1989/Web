import { createModal, getModal } from '../../../ui/modal.js';
import { authState } from '../../../state/authState.js';
import { apiUserUpdatePassword } from '../../../api/userApi.js';
import { eventBus } from '../../../core/eventBus.js';

let modalRef = null;

export function showPasswordModal(user) {
  const exist = getModal('passwordModal');
  if (exist) { exist.open(); return; }

  const current = authState.get().userInfo;
  const isSelf = current?.userId === user.userId;

  const container = document.createElement('div');
  container.className = 'modal-form password-modal-wrapper';
  container.innerHTML = `...保持原来的 HTML ...`;

  modalRef = createModal({
    id: 'passwordModal',
    title: '修改密码',
    width: 400,
    content: container,
    footerButtons: []
  });

  if (!modalRef) return;
  const form = modalRef.body.querySelector('#pwdForm');
  const cancelBtn = form.querySelector('[data-close]');
  cancelBtn.addEventListener('click', () => { modalRef.close(); modalRef=null; });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const np = (fd.get('newpwd')||'').trim();
    const np2 = (fd.get('newpwd2')||'').trim();
    if (np.length < 6) {
      eventBus.emit('toast:show',{type:'error',message:'新密码长度不足'}); return;
    }
    if (np!==np2) {
      eventBus.emit('toast:show',{type:'error',message:'两次新密码不一致'}); return;
    }
    const payload = {
      userId: user.userId,
      newpwd: np,
      oldpwd: isSelf ? (fd.get('oldpwd')||'').trim() : ''
    };
    apiUserUpdatePassword(payload).then(()=>{
      eventBus.emit('toast:show',{type:'success',message:'密码已更新'});
      modalRef.close(); modalRef=null;
    });
  });
}

export function closePasswordModal(){
  if (modalRef){ modalRef.close(); modalRef=null; }
}