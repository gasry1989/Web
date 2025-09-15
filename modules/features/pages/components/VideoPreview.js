/**
 * 视频预览（SRS WebRTC + canvas 填满 + DPI 自适配）
 * 样式与结构改为模板注入，CSS 在模板内，组件用 Shadow DOM 隔离。
 */
import { importTemplate } from '@ui/templateLoader.js';

export function createVideoPreview({ objectFit = 'fill' } = {}) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  let canvas = null;
  let ctx = null;
  let sdk = null, video = null, loop = false, rotation = 0, mode = objectFit==='fit'?'fit':'fill', firstFrameLogged=false;
  function log(...a){ try{ console.info('[VideoPreview]', ...a);}catch{} }

  // 模板准备
  const tplReady = importTemplate('/modules/features/pages/components/video-preview.html', 'tpl-video-preview')
    .then(frag => {
      root.appendChild(frag);
      canvas = root.getElementById('vpCanvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ro.observe(canvas);
    })
    .catch(err => console.error('[VideoPreview] template load failed', err));

  const ro = new ResizeObserver(()=>{
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const w = Math.max(1, Math.floor(r.width*dpr));
    const h = Math.max(1, Math.floor(r.height*dpr));
    if (canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
  });

  function render(){
    if(!loop || !canvas || !ctx) return;
    const rect=canvas.getBoundingClientRect(), w=rect.width||1, h=rect.height||1;
    const vw=video?.videoWidth||0, vh=video?.videoHeight||0;
    ctx.save(); ctx.clearRect(0,0,canvas.width,canvas.height);
    if(vw && vh){
      if(!firstFrameLogged){ log('first frame', vw,'x',vh); firstFrameLogged=true; }
      ctx.translate(canvas.width/2, canvas.height/2);
      ctx.rotate(rotation*Math.PI/180);
      let videoW=vw, videoH=vh; if(rotation%180!==0) [videoW,videoH]=[videoH,videoW];
      let drawW=w, drawH=h;
      if(mode==='fit'){ const vr=videoW/videoH, cr=w/h; if(vr>cr){ drawW=w; drawH=w/vr; } else { drawH=h; drawW=h*vr; } }
      else { drawW=w; drawH=h; }
      const sx=canvas.width/w, sy=canvas.height/h;
      if(rotation%180===0){ ctx.drawImage(video, -drawW/2*sx, -drawH/2*sy, drawW*sx, drawH*sy); }
      else { ctx.drawImage(video, -drawH/2*sx, -drawW/2*sy, drawH*sx, drawW*sy); }
    }
    ctx.restore(); requestAnimationFrame(render);
  }

  async function ensureDeps(){
    if(!window.adapter) await new Promise(r=>{ const s=document.createElement('script'); s.src='/js/adapter-7.4.0.min.js'; s.onload=r; s.onerror=r; document.head.appendChild(s); });
    if(!window.SrsRtcPlayerAsync) await new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='/js/srs.sdk.js'; s.onload=resolve; s.onerror=()=>{ const s2=document.createElement('script'); s2.src='https://ossrs.net/srs.sdk.js'; s2.onload=resolve; s2.onerror=reject; document.head.appendChild(s2); }; document.head.appendChild(s); });
  }

  async function play(url){
    await tplReady; // 确保模板与 canvas 就绪
    log('play begin', url);
    await ensureDeps();
    if (sdk){ try{ sdk.close(); }catch{} sdk=null; }
    // eslint-disable-next-line no-undef
    sdk = new SrsRtcPlayerAsync();
    video = document.createElement('video'); video.autoplay=true; video.muted=true; video.playsInline=true;
    video.style.position='absolute'; video.style.left='-99999px'; video.style.top='-99999px';
    document.body.appendChild(video); video.srcObject = sdk.stream;
    try { await sdk.play(url); log('sdk.play resolved'); } catch(e){ log('sdk.play error', e); cleanup(); throw e; }
    try { await video.play(); log('video.play resolved'); } catch(e){ log('video.play error(non-blocking)', e); }
    loop=true; requestAnimationFrame(render);
  }

  function cleanup(){
    loop=false; try{ ro.disconnect(); }catch{}; try{ sdk && sdk.close(); }catch{}; sdk=null;
    try{ if(video){ video.srcObject=null; video.remove(); } }catch{}; firstFrameLogged=false;
  }
  function destroy(){ cleanup(); try{ host.remove(); }catch{} }

  host.el=host; host.play=play; host.destroy=destroy; host.setMode=(m)=>{ mode=m==='fit'?'fit':'fill'; }; host.rotate=()=>{ rotation=(rotation+90)%360; };
  return host;
}