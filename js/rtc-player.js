/* RTC Player JavaScript - Extracted from rtc_player7.html */

/* ================= 调试工具与环境日志 ================= */
(function(){
    const DBG_PREFIX='RTC7';
    const pad2=n=>('0'+n).slice(-2);
    function ts(){const d=new Date();return [pad2(d.getHours()),pad2(d.getMinutes()),pad2(d.getSeconds())].join(':')+'.'+(d.getMilliseconds()+'').padStart(3,'0');}
    const logger={
        enabled:true,
        d(tag,...a){ if(!this.enabled) return; try{console.log(`[${DBG_PREFIX} ${ts()}][${tag}]`,...a);}catch(_){} },
        i(tag,...a){ if(!this.enabled) return; try{console.info(`[${DBG_PREFIX} ${ts()}][${tag}]`,...a);}catch(_){} },
        w(tag,...a){ if(!this.enabled) return; try{console.warn(`[${DBG_PREFIX} ${ts()}][${tag}]`,...a);}catch(_){} },
        e(tag,...a){ if(!this.enabled) return; try{console.error(`[${DBG_PREFIX} ${ts()}][${tag}]`,...a);}catch(_){} },
    };
    window.__RTC_LOGGER__=logger;

    // 环境与脚本加载
    const scripts=[].map.call(document.scripts,s=>s.src||'(inline)');
    logger.i('ENV','UserAgent =', navigator.userAgent);
    logger.i('ENV','Scripts loaded =', scripts);
    logger.i('ENV','Adapter exists =', !!window.adapter);
    logger.i('ENV','SrsRtcPlayerAsync exists =', typeof window.SrsRtcPlayerAsync==='function');
})();

/* ================= 全屏防闪烁渲染循环 ================= */
function makeRenderLoop(draw){
    let run=false;
    function loop(){ if(!run) return; draw(); requestAnimationFrame(loop); }
    return { start(){ if(!run){run=true; requestAnimationFrame(loop);} }, stop(){ run=false; } };
}

/* ================= SDP 解析辅助 ================= */
function parseH264ParamsFromSdp(sdp){
    const lines=(sdp||'').split(/\r?\n/);
    const h264Pts=[];
    const fmtpByPt={};
    for(let i=0;i<lines.length;i++){
        const l=lines[i];
        const m=l.match(/^a=rtpmap:(\d+)\s+H264\/90000/i);
        if(m) h264Pts.push(m[1]);
        const f=l.match(/^a=fmtp:(\d+)\s+(.*)$/i);
        if(f) fmtpByPt[f[1]]=f[2];
    }
    const arr=[];
    for(const pt of h264Pts){
        const params=(fmtpByPt[pt]||'').split(';').map(s=>s.trim());
        const map={pt};
        params.forEach(kv=>{
            const [k,v]=kv.split('=');
            if(k) map[k.trim()]=(v||'').trim();
        });
        arr.push(map);
    }
    return arr;
}
function sdpHasVideo(sdp){
    return /m=video\s+\d+\s+[\w/ ]+\s+/i.test(sdp||'');
}
function sdpDirectionForVideo(sdp){
    const m = (sdp||'').match(/m=video[\s\S]*?(?=m=|$)/i);
    if(!m) return '';
    const block=m[0];
    const dir=block.match(/a=(sendrecv|sendonly|recvonly|inactive)/i);
    return dir?dir[1].toLowerCase():'';
}

/* ================= RTCPeerConnection 调试监听 ================= */
function attachPcDebug(pc, tag){
    const log=window.__RTC_LOGGER__;
    if(!pc){ log.w(tag,'attachPcDebug: pc is null'); return; }
    try{
        pc.addEventListener('signalingstatechange',()=>log.i(tag,'signalingState =', pc.signalingState));
        pc.addEventListener('icegatheringstatechange',()=>log.i(tag,'iceGatheringState =', pc.iceGatheringState));
        pc.addEventListener('iceconnectionstatechange',()=>log.i(tag,'iceConnectionState =', pc.iceConnectionState));
        pc.addEventListener('connectionstatechange',()=>log.i(tag,'connectionState =', pc.connectionState));
        pc.addEventListener('icecandidateerror',e=>log.w(tag,'icecandidateerror', e.errorCode, e.errorText||e.url||'' ));
        pc.addEventListener('track',e=>{
            log.i(tag,'ontrack kind=', e.track&&e.track.kind, 'streams=', e.streams&&e.streams.length);
        });

        // SDP 概览
        setTimeout(()=>{
            const ld=pc.localDescription, rd=pc.remoteDescription;
            if(ld){
                log.i(tag,'Local SDP has m=video:', sdpHasVideo(ld.sdp), 'dir:', sdpDirectionForVideo(ld.sdp));
                const h264=parseH264ParamsFromSdp(ld.sdp);
                if(h264.length) log.i(tag,'Local H264 fmtp:', h264);
            }else{
                log.w(tag,'LocalDescription not set yet');
            }
            if(rd){
                log.i(tag,'Remote SDP has m=video:', sdpHasVideo(rd.sdp), 'dir:', sdpDirectionForVideo(rd.sdp));
                const h264=parseH264ParamsFromSdp(rd.sdp);
                if(h264.length) log.i(tag,'Remote H264 fmtp:', h264);
            }else{
                log.w(tag,'RemoteDescription not set yet');
            }
        }, 0);

        // 选中候选对/RTT 快照
        pc.getStats().then(rs=>{
            let pair=null, local=null, remote=null;
            rs.forEach(r=>{
                if(r.type==='transport' && r.selectedCandidatePairId){
                    pair=rs.get(r.selectedCandidatePairId);
                }
            });
            if(!pair){
                rs.forEach(r=>{
                    if(r.type==='candidate-pair' && (r.selected||r.nominated)) pair=r;
                });
            }
            if(pair){
                local=rs.get && rs.get(pair.localCandidateId);
                remote=rs.get && rs.get(pair.remoteCandidateId);
                log.i(tag,'Selected pair:', {
                    state: pair.state, nominated: pair.nominated, currentRTT: pair.currentRoundTripTime,
                    local: local? {type:local.candidateType, ip:local.ip||local.address, protocol:local.protocol}:{},
                    remote: remote? {type:remote.candidateType, ip:remote.ip||remote.address, protocol:remote.protocol}:{},
                });
            }else{
                log.w(tag,'No selected candidate pair yet');
            }
        }).catch(e=>log.w(tag,'getStats pair error', e));
    }catch(e){
        log.w(tag,'attachPcDebug error', e);
    }
}

/* ================= Player 封装 ================= */
function createRtcCanvasPlayer(isPip,onResolution){
    const TAG = isPip ? 'SUB' : 'MAIN';
    const log = window.__RTC_LOGGER__;
    const video=document.createElement('video');
    video.autoplay=true; video.muted=true; video.playsInline=true;
    video.style.position='absolute'; video.style.top='0'; video.style.left='0';
    video.style.width='1px'; video.style.height='1px'; video.style.opacity='0';
    document.body.appendChild(video);

    // video 事件监控
    ['loadedmetadata','resize','playing','pause','waiting','stalled','suspend','abort','emptied','ended','error']
      .forEach(ev=>video.addEventListener(ev, e=>{
          if(ev==='error'){ const err=video.error; log.w(TAG,'video error', err&&err.code, err&&err.message); }
          else log.d(TAG,`video event: ${ev}`, {w:video.videoWidth,h:video.videoHeight,ready:video.readyState});
      }));

    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    canvas.width=1280; canvas.height=720;

    let sdk=null, rotation=0, mode='fit';
    let stats={width:0,height:0,fps:0,vbit:0,abit:0, _hasV:false, _hasA:false};

    const loop=makeRenderLoop(()=>{
        const dispW=canvas.clientWidth||canvas.width;
        const dispH=canvas.clientHeight||canvas.height;
        const vw=video.videoWidth, vh=video.videoHeight;
        if(!vw||!vh) return;

        ctx.save();
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.translate(canvas.width/2,canvas.height/2);
        ctx.rotate(rotation*Math.PI/180);

        let videoW=vw, videoH=vh;
        if(rotation%180!==0) [videoW,videoH]=[videoH,videoW];

        let drawW=dispW, drawH=dispH;
        if(!isPip){
            if(mode==='fit'){
                const vr=videoW/videoH, cr=dispW/dispH;
                if(vr>cr){ drawW=dispW; drawH=dispW/vr; } else { drawH=dispH; drawW=dispH*vr; }
            }
        }

        const scaleX=canvas.width/dispW;
        const scaleY=canvas.height/dispH;

        if(rotation%180===0){
            ctx.drawImage(video,-drawW/2*scaleX,-drawH/2*scaleY,drawW*scaleX,drawH*scaleY);
        }else{
            ctx.drawImage(video,-drawH/2*scaleX,-drawW/2*scaleY,drawH*scaleX,drawW*scaleY);
        }
        ctx.restore();
    });

    function collectStats(pc){
        let last={};
        let firstVideoLogged=false;
        setInterval(()=>pc && pc.getStats().then(rs=>{
            rs.forEach(r=>{
                if(r.type==='inbound-rtp'&&r.kind==='video'){
                    stats._hasV=true;
                    const bytes=r.bytesReceived, frames=r.framesDecoded;
                    const dBytes=last.v?bytes-last.v:0;
                    const dFrames=last.f?frames-last.f:0;
                    const w=r.frameWidth||0, h=r.frameHeight||0;
                    stats.vbit=(dBytes*8/1000).toFixed(1);
                    stats.fps=dFrames;
                    if((w&&h)&&(w!==stats.width||h!==stats.height)){
                        stats.width=w; stats.height=h;
                        onResolution && onResolution(w,h,rotation);
                    }else{
                        stats.width=w; stats.height=h;
                    }
                    if(!firstVideoLogged && (w||h||frames>0)){
                        firstVideoLogged=true;
                        window.__RTC_LOGGER__.i(TAG,'inbound video detected',{w,h,fps:stats.fps, vkbps:stats.vbit});
                    }
                    last.v=bytes; last.f=frames;
                }
                if(r.type==='inbound-rtp'&&r.kind==='audio'){
                    stats._hasA=true;
                    const bytes=r.bytesReceived;
                    const d=last.a?bytes-last.a:0;
                    stats.abit=(d*8/1000).toFixed(1);
                    last.a=bytes;
                }
            });
        }).catch(e=>{
            window.__RTC_LOGGER__.w(TAG,'getStats error', e);
        }),1000);
    }

    async function play(url){
        log.i(TAG,'play() start, url =', url);
        if(sdk){ try{sdk.close();}catch(_){} sdk=null; }
        sdk=new SrsRtcPlayerAsync();
        log.i(TAG,'SrsRtcPlayerAsync created:', !!sdk);
        video.srcObject=sdk.stream;

        // 守护：6s 内没有 inbound-rtp(video) 给出提示
        let watchdogTimer=null;
        function startWatchdog(){
            const t0=Date.now();
            watchdogTimer=setInterval(()=>{
                const elapse=(Date.now()-t0)/1000;
                if(elapse>=6){
                    if(!stats._hasV){
                        log.w(TAG,'No inbound-rtp(video) detected within 6s. Likely not negotiated/subscribed. Check: (1) page requests video? (addTransceiver recvonly / offerToReceiveVideo) (2) URL params video=1 (3) encoder/codec H264 fmtp mismatch');
                    }
                    clearInterval(watchdogTimer); watchdogTimer=null;
                }else{
                    // 若音频到了但视频没到，也提示一次
                    if(stats._hasA && !stats._hasV && elapse>=4){
                        log.w(TAG,'Audio inbound but NO video inbound yet (4s). Suspect video not negotiated.');
                    }
                }
            }, 1000);
        }

        try{
            startWatchdog();
            await sdk.play(url);
            log.i(TAG,'sdk.play() resolved');
            // 绑定 PC 调试
            if(sdk.pc){
                attachPcDebug(sdk.pc, TAG);
            }else{
                log.w(TAG,'sdk.pc is not available after play()');
            }
            // 启动渲染与统计
            loop.start();
            collectStats(sdk.pc);
        }catch(e){
            log.e(TAG,'sdk.play() failed', e);
            if(sdk){try{sdk.close();}catch(_){} sdk=null;}
        }
    }

    return {
        canvas, play,
        rotate:()=>{rotation=(rotation+90)%360; onResolution && onResolution(stats.width,stats.height,rotation); window.__RTC_LOGGER__.i(TAG,'rotate', rotation);},
        toggleMode:()=>{mode=(mode==='fit'?'fill':'fit'); window.__RTC_LOGGER__.i(TAG,'mode ->', mode);},
        getMode:()=>mode, getRotation:()=>rotation,
        getStats:()=>({...stats}),
        mute:(m)=>{video.muted=m; window.__RTC_LOGGER__.i(TAG,'mute', m);}, setVolume:(v)=>{video.volume=v; window.__RTC_LOGGER__.i(TAG,'volume', v);},
        getVideoEl:()=>video,
        attachToSlot:(slot)=>{slot.appendChild(canvas); window.__RTC_LOGGER__.i(TAG,'attachToSlot', slot&&slot.id);},
        isPip:()=>isPip, setPip:(v)=>{isPip=v; window.__RTC_LOGGER__.i(TAG,'setPip', v);}
    };
}

/* ================= DOM & 状态 ================= */
const container=document.getElementById('video_container');
const slotMain=document.getElementById('slot_main');
const slotPip=document.getElementById('slot_pip');
const pipPlaceholder=document.getElementById('pip_placeholder');

const btnStartMain=document.getElementById('btn_start_main');
const btnStartSub=document.getElementById('btn_start_sub');
const inputMain=document.getElementById('url_main');
const inputSub=document.getElementById('url_sub');

const btnMute=document.getElementById('btn_mute');
const iconVol=document.getElementById('icon_volume');
const iconVolOff=document.getElementById('icon_volume_off');
const volumeSlider=document.getElementById('volume_slider');

const btnSwitch=document.getElementById('btn_switch');
const btnInfo=document.getElementById('btn_info');
const btnRotate=document.getElementById('btn_rotate');
const btnFitFill=document.getElementById('btn_fit_fill');
const iconFit=document.getElementById('icon_fit');
const iconFill=document.getElementById('icon_fill');
const btnFullscreen=document.getElementById('btn_fullscreen');
const iconFS=document.getElementById('icon_fullscreen');
const iconFSExit=document.getElementById('icon_fullscreen_exit');
const infoPanel=document.getElementById('info_panel');

let pipUserMoved=false;
let subVisible=false;

/* ================= 播放器实例 ================= */
const playerA=createRtcCanvasPlayer(false);
const playerB=createRtcCanvasPlayer(true,onSmallResolution);
let bigPlayer=playerA;
let smallPlayer=playerB;
playerA.attachToSlot(slotMain);

/* 小窗分辨率适配 */
function onSmallResolution(w,h,rot){
    if(!subVisible) return;
    if(!smallPlayer.isPip()) return;
    if(pipUserMoved) return;
    adjustPipSize(w,h,rot);
    ensurePipInBounds(true);
}

function adjustPipSize(w,h,rot){
    if(!w||!h) return;
    if(rot%180!==0) [w,h]=[h,w];
    const maxW=300,maxH=200;
    let aspect=w/h;
    let tw=maxW, th=tw/aspect;
    if(th>maxH){th=maxH; tw=th*aspect;}
    tw=Math.round(tw); th=Math.round(th);
    slotPip.style.width=tw+'px';
    slotPip.style.height=th+'px';
}

/* ================= 控制条显示隐藏 ================= */
function showControls(autoHide=true){
    container.classList.add('show-controls');
    if(showControls._timer) clearTimeout(showControls._timer);
    if(autoHide) showControls._timer=setTimeout(()=>container.classList.remove('show-controls'),2500);
}
container.addEventListener('mousemove',()=>showControls(true));
container.addEventListener('mouseleave',()=>container.classList.remove('show-controls'));
showControls(true);

/* ================= 音量/静音 ================= */
function refreshVolumeUI(){
    const v=bigPlayer.getVideoEl();
    if(v.muted||v.volume===0){iconVol.style.display='none';iconVolOff.style.display='';}
    else{iconVol.style.display='';iconVolOff.style.display='none';}
    volumeSlider.value=v.volume;
}
btnMute.addEventListener('click',()=>{const v=bigPlayer.getVideoEl();v.muted=!v.muted;refreshVolumeUI(); window.__RTC_LOGGER__.i('UI','toggle mute ->', v.muted);});
volumeSlider.addEventListener('input',()=>{
    const val=parseFloat(volumeSlider.value);
    bigPlayer.setVolume(val);
    if(val>0) bigPlayer.mute(false);
    refreshVolumeUI();
});

/* ================= 模式/旋转 ================= */
function refreshModeIcon(){
    if(bigPlayer.getMode()==='fit'){iconFit.style.display='';iconFill.style.display='none';btnFitFill.setAttribute('data-tip','自适应');}
    else{iconFit.style.display='none';iconFill.style.display='';btnFitFill.setAttribute('data-tip','填充');}
}
btnFitFill.addEventListener('click',()=>{bigPlayer.toggleMode();refreshModeIcon();});
btnRotate.addEventListener('click',()=>bigPlayer.rotate());

/* ================= 全屏 ================= */
btnFullscreen.addEventListener('click',()=>{
    window.__RTC_LOGGER__.i('UI','fullscreen toggle');
    if(!document.fullscreenElement){container.requestFullscreen&&container.requestFullscreen();}
    else{document.exitFullscreen&&document.exitFullscreen();}
});

/* 全屏变化：退出后保证小窗在可视区内 */
document.addEventListener('fullscreenchange',()=>{
    const fs=!!document.fullscreenElement;
    iconFS.style.display=fs?'none':'';
    iconFSExit.style.display=fs?'':'none';
    window.__RTC_LOGGER__.i('UI','fullscreenchange', fs);
    if(!fs){
        // 立即 & 延迟再检查，确保布局回收完成
        ensurePipInBounds(true);
        requestAnimationFrame(()=>ensurePipInBounds(true));
        setTimeout(()=>ensurePipInBounds(true),120);
    }
});

/* 使用 ResizeObserver 监控容器尺寸变化（包括全屏返回） */
new ResizeObserver(()=>ensurePipInBounds(true)).observe(container);

/* ================= 信息面板 ================= */
btnInfo.addEventListener('click',()=>{
    if(infoPanel.style.display==='none'||!infoPanel.style.display){infoPanel.style.display='block';updateInfoPanel();}
    else infoPanel.style.display='none';
});
function updateInfoPanel(){
    if(infoPanel.style.display==='none') return;
    const sBig=bigPlayer.getStats();
    let html=`<h4>大画面 <span class="badge-role">${bigPlayer===playerA?'主流':'副流'}</span></h4>`;
    html+=statsLines(sBig,bigPlayer);
    if(subVisible){
        const sSmall=smallPlayer.getStats();
        html+=`<h4 style="margin-top:6px;">小画面 <span class="badge-role secondary">${smallPlayer===playerA?'主流':'副流'}</span></h4>`;
        html+=statsLines(sSmall,smallPlayer);
    }
    infoPanel.innerHTML=html;
}
function statsLines(st,p){
    return `<div class="info-row"><span>分辨率</span><span>${st.width}x${st.height}</span></div>
            <div class="info-row"><span>帧率</span><span>${st.fps||'-'} fps</span></div>
            <div class="info-row"><span>视频码率</span><span>${st.vbit||'-'} kbps</span></div>
            <div class="info-row"><span>音频码率</span><span>${st.abit||'-'} kbps</span></div>
            <div class="info-row"><span>模式</span><span>${p.getMode()}</span></div>
            <div class="info-row"><span>旋转</span><span>${p.getRotation()}°</span></div>`;
}
setInterval(updateInfoPanel,1000);

/* ================= 播放主流 ================= */
btnStartMain.addEventListener('click',()=>{
    const url=inputMain.value.trim();
    window.__RTC_LOGGER__.i('UI','play main clicked:', url);
    if(!url){alert('请输入主流URL');return;}
    playerA.play(url);
});
inputMain.addEventListener('keydown',e=>{if(e.key==='Enter')btnStartMain.click();});

/* ================= 播放副流 ================= */
btnStartSub.addEventListener('click',()=>{
    const url=inputSub.value.trim();
    window.__RTC_LOGGER__.i('UI','play sub clicked:', url);
    if(!url){alert('请输入副流URL');return;}
    pipUserMoved=false;
    playerB.play(url);
    if(!subVisible){
        smallPlayer=playerB;
        playerB.attachToSlot(slotPip);
        slotPip.style.display='';
        pipPlaceholder.style.display='none';
        subVisible=true;
        btnSwitch.style.display='inline-flex';
    }
});
inputSub.addEventListener('keydown',e=>{if(e.key==='Enter')btnStartSub.click();});

/* ================= 切换主/副 ================= */
btnSwitch.addEventListener('click',()=>{
    if(!subVisible) return;
    window.__RTC_LOGGER__.i('UI','switch main/sub');
    bigPlayer.setPip(true);
    smallPlayer.setPip(false);

    const bigCanvas=bigPlayer.canvas;
    const smallCanvas=smallPlayer.canvas;
    const bigBefore=bigCanvas.getBoundingClientRect();
    const smallBefore=smallCanvas.getBoundingClientRect();

    slotMain.appendChild(smallCanvas);
    slotPip.appendChild(bigCanvas);

    const prev=bigPlayer;
    bigPlayer=smallPlayer;
    smallPlayer=prev;

    const bigAfter=smallCanvas.getBoundingClientRect();
    const smallAfter=bigCanvas.getBoundingClientRect();

    applyFlip(bigCanvas,smallBefore,smallAfter);
    applyFlip(smallCanvas,bigBefore,bigAfter);

    refreshVolumeUI();
    refreshModeIcon();
    updateInfoPanel();

    if(!pipUserMoved){
        const s=smallPlayer.getStats();
        if(s.width&&s.height){
            adjustPipSize(s.width,s.height,smallPlayer.getRotation());
            ensurePipInBounds(true);
        }
    }
});
function applyFlip(canvas,before,after){
    const dx=before.left-after.left;
    const dy=before.top-after.top;
    const sx=before.width/after.width;
    const sy=before.height/after.height;
    canvas.classList.add('swap-anim');
    canvas.style.transformOrigin='0 0';
    canvas.style.transform=`translate(${dx}px,${dy}px) scale(${sx},${sy})`;
    requestAnimationFrame(()=>{
        canvas.style.transform='translate(0,0) scale(1,1)';
        canvas.addEventListener('transitionend',function handler(){
            canvas.classList.remove('swap-anim');
            canvas.style.transform='';
            canvas.removeEventListener('transitionend',handler);
        });
    });
}

/* ================= 小窗拖动（transform 防闪烁） ================= */
(function enablePipDrag(){
    let dragging=false,startX,startY,origLeft,origTop;
    slotPip.addEventListener('mousedown',e=>{
        if(!subVisible) return;
        dragging=true; pipUserMoved=true;
        slotPip.classList.add('dragging');
        const vc=container.getBoundingClientRect();
        const rect=slotPip.getBoundingClientRect();
        origLeft=rect.left-vc.left; origTop=rect.top-vc.top;
        startX=e.clientX; startY=e.clientY;
        if(!slotPip.style.left && !slotPip.style.top){
            slotPip.style.left=origLeft+'px';
            slotPip.style.top=origTop+'px';
            slotPip.style.right='auto'; slotPip.style.bottom='auto';
        }
        e.preventDefault();
    });
    window.addEventListener('mousemove',e=>{
        if(!dragging) return;
        const vc=container.getBoundingClientRect();
        const dx=e.clientX-startX, dy=e.clientY-startY;
        const pipW=slotPip.offsetWidth, pipH=slotPip.offsetHeight;
        let newLeft=origLeft+dx, newTop=origTop+dy;
        if(newLeft<0)newLeft=0;
        if(newTop<0)newTop=0;
        if(newLeft+pipW>vc.width)newLeft=vc.width-pipW;
        if(newTop+pipH>vc.height)newTop=vc.height-pipH;
        slotPip.style.transform=`translate(${newLeft-origLeft}px,${newTop-origTop}px)`;
    });
    window.addEventListener('mouseup',()=>{
        if(!dragging) return;
        dragging=false;
        slotPip.classList.remove('dragging');
        const vc=container.getBoundingClientRect();
        const rect=slotPip.getBoundingClientRect();
        const finalLeft=rect.left-vc.left;
        const finalTop=rect.top-vc.top;
        slotPip.style.transform='';
        slotPip.style.left=finalLeft+'px';
        slotPip.style.top=finalTop+'px';
        slotPip.style.right='auto'; slotPip.style.bottom='auto';
        ensurePipInBounds(true);
    });
})();

/* ================= 保证小窗在范围内（全屏退出调用） ================= */
function ensurePipInBounds(forceReanchor){
    if(!subVisible) return;
    const vc=container.getBoundingClientRect();
    const rect=slotPip.getBoundingClientRect();

    const usingDefault = (!slotPip.style.left && !slotPip.style.top);
    if(usingDefault){
        if(forceReanchor && (rect.left>vc.right || rect.top>vc.bottom || rect.right<vc.left || rect.bottom<vc.top ||
           rect.right>vc.right || rect.bottom>vc.bottom)){
            slotPip.style.left=Math.max(vc.width - rect.width - 16,0)+'px';
            slotPip.style.top =Math.max(vc.height - rect.height - 96,0)+'px';
            slotPip.style.right='auto'; slotPip.style.bottom='auto';
        }
        return;
    }

    let left=parseFloat(slotPip.style.left)||0;
    let top =parseFloat(slotPip.style.top)||0;
    let changed=false;
    if(left+rect.width>vc.width){left=vc.width-rect.width; changed=true;}
    if(top+rect.height>vc.height){top=vc.height-rect.height; changed=true;}
    if(left<0){left=0; changed=true;}
    if(top<0){top=0; changed=true;}
    if(changed){
        slotPip.style.left=left+'px';
        slotPip.style.top=top+'px';
    }
}

/* ================= 初始化 UI ================= */
refreshModeIcon();
refreshVolumeUI();
setTimeout(()=>container.classList.remove('show-controls'),2000);

/* ================= 默认 URL & Query ================= */
const query=parse_query_string();
window.__RTC_LOGGER__.i('ENV','Query params =', query);
srs_init_rtc("#txt_url", query);
if(!inputMain.value){
    const defaultUrl=document.getElementById('txt_url').value;
    window.__RTC_LOGGER__.i('ENV','Default URL from srs_init_rtc =', defaultUrl);
    if(defaultUrl) inputMain.value=defaultUrl;
}
if(query.sub){ inputSub.value=decodeURIComponent(query.sub); }
if(query.autostart==='true' && inputMain.value){
    window.__RTC_LOGGER__.i('ENV','Autostart main with URL =', inputMain.value.trim());
    playerA.play(inputMain.value.trim());
}

/* ================= 键盘辅助 ================= */
document.addEventListener('keydown',e=>{
    if(e.code==='Space'){e.preventDefault();showControls(true);}
});

/* ================= 信息面板刷新 ================= */
setInterval(updateInfoPanel,1000);