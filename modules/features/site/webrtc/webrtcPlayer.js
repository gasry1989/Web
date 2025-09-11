/**
 * WebRTC 播放封装（精简版）：
 * - 若 window.SrsRtcPlayerAsync 存在则使用 SRS 拉流
 * - 否则显示占位提示
 * - 返回 { mount(containerEl), play(url), destroy(), getStatus() }
 *
 * 说明：
 * 1. 需在 index.html 中引入 adapter.js / srs.sdk.js 等脚本（你会移植）
 * 2. 这里只处理最基本播放，不含副流切换/统计/拖动小窗交互（留给上层）
 */
export function createWebRTCPlayer({ streamType='main' } = {}) {
  let videoEl = null;
  let sdk = null;
  let status = 'idle';

  function mount(container) {
    videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true; // 小窗默认静音
    videoEl.className = 'rtc-video-el';
    videoEl.style.width = '100%';
    videoEl.style.height = '100%';
    videoEl.style.objectFit = 'contain';
    container.innerHTML = '';
    container.appendChild(videoEl);
  }

  async function play(url) {
    if (!videoEl) throw new Error('player not mounted');
    if (!window.SrsRtcPlayerAsync) {
      status = 'unsupported';
      videoEl.poster = '';
      videoEl.innerHTML = '';
      const alt = document.createElement('div');
      alt.style.cssText = 'font-size:12px;color:#ccc;text-align:center;padding:8px;';
      alt.textContent = 'SRS SDK 未加载 (占位)';
      videoEl.replaceWith(alt);
      return;
    }
    status = 'connecting';
    try {
      sdk = new window.SrsRtcPlayerAsync();
      videoEl.srcObject = sdk.stream;
      await sdk.play(url);
      status = 'playing';
    } catch (e) {
      console.error('WebRTC play failed', e);
      status = 'error';
      if (videoEl) {
        videoEl.style.background='#000';
        videoEl.style.display='flex';
        videoEl.style.alignItems='center';
        videoEl.style.justifyContent='center';
        videoEl.textContent='播放失败';
      }
    }
  }

  function destroy() {
    try {
      if (sdk) {
        sdk.close();
        sdk = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
    } catch(e){}
    status = 'idle';
  }

  function getStatus() {
    return status;
  }

  return { mount, play, destroy, getStatus };
}