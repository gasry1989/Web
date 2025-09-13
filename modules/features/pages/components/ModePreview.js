/**
 * 模式预览（填满 + 栅格 + 自适应字号）
 * 修复要点：:host 100% 铺满；内容不再“细长一条”
 */
export function createModePreview({ modeId, devId } = {}) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
  :host { all: initial; contain: content; display:block; width:100%; height:100%; }
  *,*::before,*::after{ box-sizing:border-box; }
  .wrap { width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#0b1119; color:#cfe; }
  .panel { width:100%; padding:10px 12px; display:grid; grid-template-columns:auto 1fr; grid-column-gap:12px; grid-row-gap:8px; font-size:clamp(12px,1.5vw,18px); line-height:1.6; }
  .label { white-space:nowrap; color:#a9cbe0; }
  .value { font-weight:600; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
  `;
  const wrap = document.createElement('div'); wrap.className='wrap';
  wrap.innerHTML = `
    <div class="panel">
      <div class="label">倾角X</div><div class="value" id="mx">0.00</div>
      <div class="label">倾角Y</div><div class="value" id="my">0.00</div>
      <div class="label">倾角Z</div><div class="value" id="mz">0.00</div>
      <div class="label">位移</div><div class="value" id="mm">0.000</div>
      <div class="label">电量</div><div class="value" id="mb">100%</div>
    </div>`;
  root.append(style, wrap);

  let timer=null;
  const api={
    start(){
      if (timer) return;
      let s={x:0,y:0,z:0,m:0,b:100};
      const set=(id,v)=>{ const el=root.getElementById(id); if(el) el.textContent=v; };
      timer=setInterval(()=>{
        s.x=clamp(s.x+rand(-0.05,0.05),-5,5);
        s.y=clamp(s.y+rand(-0.05,0.05),-5,5);
        s.z=clamp(s.z+rand(-0.05,0.05),-5,5);
        s.m=Math.max(0, s.m+rand(0.001,0.003));
        if (s.b>0 && Math.random()<0.03) s.b-=1;
        set('mx',s.x.toFixed(2)); set('my',s.y.toFixed(2)); set('mz',s.z.toFixed(2)); set('mm',s.m.toFixed(3)); set('mb',s.b+'%');
      },200);
    },
    destroy(){ try{ timer&&clearInterval(timer);}catch{} timer=null; try{ host.remove(); }catch{} },
    el: host
  };
  function rand(a,b){return Math.random()*(b-a)+a;}
  function clamp(v,min,max){return v<min?min:v>max?max:v;}
  return api;
}