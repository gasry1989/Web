let toastId = 0;
export function showToast({ type='info', message='' }) {
  const root = document.getElementById('toastRoot');
  const id = 't_'+(toastId++);
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.id = id;
  div.textContent = message;
  root.appendChild(div);
  setTimeout(() => {
    div.classList.add('show');
  }, 10);
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(()=> div.remove(), 300);
  }, 3000);
}