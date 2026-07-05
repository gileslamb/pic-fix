/* ============================================================================
   Pixfix synth-ui — reusable tactile synth controls, vanilla + SVG, no deps.
   Design goals: touch-first (vertical drag, big targets, value-on-adjust,
   double-tap reset), transform-only animation, hand-drawn character.

   Binding contract (so a reskin never changes audio):
     Knob(input,opts) / Fader(input,opts) take a native <input type=range>,
     hide it, and drive it — on change they set input.value and dispatch a
     native 'input' event. Whatever handler the app already has on that input
     runs unchanged, with identical values.

   Standalone helpers for the showcase: Toggle(opts), XYPad(host,opts).
   ==========================================================================*/
(function(){
  "use strict";
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;

  /* shared <defs> (gradients + hand-drawn roughen filter), injected once */
  function ensureDefs(){
    if(document.getElementById('pui-defs')) return;
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('id','pui-defs'); s.setAttribute('width','0'); s.setAttribute('height','0');
    s.style.position='absolute'; s.style.width='0'; s.style.height='0';
    s.innerHTML=`<defs>
      <radialGradient id="puiBody" cx="38%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,.95)"/>
        <stop offset="40%" stop-color="rgba(244,238,229,.55)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,.22)"/>
      </radialGradient>
      <filter id="puiRough"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="1" seed="7" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter>
    </defs>`;
    document.body.appendChild(s);
  }

  /* shared value readout pill */
  let RO;
  function ro(){ if(!RO){ RO=document.createElement('div'); RO.className='pui-readout'; document.body.appendChild(RO); } return RO; }
  function readoutShow(nearEl,text){ const r=ro(); r.textContent=text; const b=nearEl.getBoundingClientRect();
    r.style.left=(b.left+b.width/2)+'px'; r.style.top=(b.top-14)+'px'; r.classList.add('show'); }
  function readoutMove(nearEl,text){ if(!RO) return; RO.textContent=text; const b=nearEl.getBoundingClientRect();
    RO.style.left=(b.left+b.width/2)+'px'; RO.style.top=(b.top-14)+'px'; }
  function readoutHide(){ if(RO) RO.classList.remove('show'); }

  function bump(el,cls){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* ---------------------------------------------------------------- KNOB -- */
  function knobSVG(){
    let ticks=''; const N=11;
    for(let i=0;i<N;i++){ const a=(-135+i*27)*Math.PI/180;
      const x1=(50+Math.sin(a)*31).toFixed(1), y1=(50-Math.cos(a)*31).toFixed(1),
            x2=(50+Math.sin(a)*38).toFixed(1), y2=(50-Math.cos(a)*38).toFixed(1);
      ticks+=`<line class="pui-tick" data-i="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    return `<svg class="pui-svg" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="pui-glow" cx="50" cy="50" r="30" fill="var(--accent)" opacity="0"/>
      <circle class="pui-rim" cx="50" cy="50" r="41" filter="url(#puiRough)"/>
      <circle class="pui-face" cx="50" cy="50" r="35" fill="url(#puiBody)"/>
      <g class="pui-ticks">${ticks}</g>
      <g class="pui-ind"><line class="pui-needle" x1="50" y1="49" x2="50" y2="22"/><circle class="pui-hub" cx="50" cy="50" r="5"/></g>
    </svg>`;
  }
  function Knob(input, opts){
    opts=opts||{}; ensureDefs();
    const min=+input.min||0, max=(input.max!==''&&input.max!=null?+input.max:100);
    const def=(opts.default!=null?opts.default:(input.getAttribute('value')!=null?+input.getAttribute('value'):+input.value||0));
    const size=opts.size||76;
    input.classList.add('pui-native');
    const wrap=document.createElement('div'); wrap.className='pui-knob'+(opts.glow?' glow':'');
    wrap.style.width=size+'px'; wrap.setAttribute('role','slider'); wrap.setAttribute('tabindex','0');
    wrap.setAttribute('aria-label',opts.label||input.getAttribute('aria-label')||input.id||'knob');
    wrap.setAttribute('aria-valuemin',min); wrap.setAttribute('aria-valuemax',max);
    wrap.innerHTML=knobSVG();
    input.parentNode.insertBefore(wrap,input); wrap.appendChild(input);
    if(opts.label){ const l=document.createElement('div'); l.className='pui-label'; l.textContent=opts.label; wrap.appendChild(l); }
    const ind=wrap.querySelector('.pui-ind'), ticks=[...wrap.querySelectorAll('.pui-tick')], glow=wrap.querySelector('.pui-glow');
    const frac=()=>(clamp(+input.value,min,max)-min)/((max-min)||1);
    const label=()=> opts.format? opts.format(+input.value) : Math.round(frac()*100)+(opts.unit||'');
    function paint(){ const f=frac(); ind.setAttribute('transform',`rotate(${(-135+f*270).toFixed(2)} 50 50)`);
      ticks.forEach((t,i)=>t.classList.toggle('on', (i/(ticks.length-1)) <= f+0.001));
      if(opts.glow&&glow){ glow.setAttribute('opacity',(0.1+f*0.62).toFixed(3)); glow.setAttribute('r',(28+f*17).toFixed(1)); }
      wrap.setAttribute('aria-valuenow',Math.round(+input.value)); }
    function setVal(v,fire){ v=clamp(v,min,max); if(input.step&&input.step!=='any'){ const s=+input.step; v=Math.round(v/s)*s; }
      input.value=v; if(fire!==false) input.dispatchEvent(new Event('input',{bubbles:true})); paint(); }
    let dragging=false, sy=0, sv=0, lastTap=0;
    wrap.addEventListener('pointerdown',e=>{
      const now=Date.now();
      if(now-lastTap<300){ setVal(def,true); readoutShow(wrap,label()); bump(wrap.querySelector('.pui-svg'),'grab'); setTimeout(readoutHide,450); lastTap=0; e.preventDefault(); return; }
      lastTap=now; dragging=true; sy=e.clientY; sv=+input.value; try{wrap.setPointerCapture(e.pointerId);}catch(_){}
      wrap.classList.add('grab'); readoutShow(wrap,label()); e.preventDefault();
    });
    wrap.addEventListener('pointermove',e=>{ if(!dragging)return; const dy=sy-e.clientY;
      setVal(sv+(dy/(opts.travel||168))*(max-min),true); readoutMove(wrap,label()); e.preventDefault(); });
    function end(){ if(!dragging)return; dragging=false; wrap.classList.remove('grab'); readoutHide(); }
    wrap.addEventListener('pointerup',end); wrap.addEventListener('pointercancel',end);
    wrap.addEventListener('keydown',e=>{ const st=(max-min)/20;
      if(e.key==='ArrowUp'||e.key==='ArrowRight'){ setVal(+input.value+st,true); e.preventDefault(); }
      else if(e.key==='ArrowDown'||e.key==='ArrowLeft'){ setVal(+input.value-st,true); e.preventDefault(); } });
    paint();
    return { el:wrap, paint, setVal, get value(){return +input.value;} };
  }

  /* --------------------------------------------------------------- FADER -- */
  function Fader(input, opts){
    opts=opts||{}; const min=+input.min||0, max=(input.max!==''&&input.max!=null?+input.max:100);
    const def=(opts.default!=null?opts.default:(input.getAttribute('value')!=null?+input.getAttribute('value'):+input.value||0));
    input.classList.add('pui-native');
    const wrap=document.createElement('div'); wrap.className='pui-fader';
    wrap.setAttribute('role','slider'); wrap.setAttribute('tabindex','0');
    wrap.setAttribute('aria-label',opts.label||input.getAttribute('aria-label')||input.id||'fader');
    wrap.setAttribute('aria-valuemin',min); wrap.setAttribute('aria-valuemax',max);
    wrap.innerHTML=`<div class="pui-fader-track"><div class="pui-fader-slot"></div><div class="pui-fader-fill"></div><div class="pui-fader-cap"></div></div>`;
    input.parentNode.insertBefore(wrap,input); wrap.appendChild(input);
    if(opts.label){ const l=document.createElement('div'); l.className='pui-label'; l.textContent=opts.label; wrap.appendChild(l); }
    const track=wrap.querySelector('.pui-fader-track'), cap=wrap.querySelector('.pui-fader-cap'), fill=wrap.querySelector('.pui-fader-fill');
    const PAD=12;
    const frac=()=>(clamp(+input.value,min,max)-min)/((max-min)||1);
    const label=()=> opts.format? opts.format(+input.value) : Math.round(frac()*100)+(opts.unit||'');
    function paint(){ const f=frac(); const h=track.clientHeight||132; const travel=h-PAD*2;
      const y=PAD+ (1-f)*travel; cap.style.bottom=(h-y)+'px'; fill.style.height=(f*travel)+'px';
      wrap.setAttribute('aria-valuenow',Math.round(+input.value)); }
    function setVal(v,fire){ v=clamp(v,min,max); if(input.step&&input.step!=='any'){ const s=+input.step; v=Math.round(v/s)*s; }
      input.value=v; if(fire!==false) input.dispatchEvent(new Event('input',{bubbles:true})); paint(); }
    function fromY(clientY){ const b=track.getBoundingClientRect(); const travel=b.height-PAD*2;
      const f=clamp(1-((clientY-b.top-PAD)/travel),0,1); return min+f*(max-min); }
    let dragging=false, lastTap=0;
    track.addEventListener('pointerdown',e=>{ const now=Date.now();
      if(now-lastTap<300){ setVal(def,true); readoutShow(wrap,label()); setTimeout(readoutHide,450); lastTap=0; e.preventDefault(); return; }
      lastTap=now; dragging=true; try{track.setPointerCapture(e.pointerId);}catch(_){}
      wrap.classList.add('grab'); setVal(fromY(e.clientY),true); readoutShow(wrap,label()); e.preventDefault(); });
    track.addEventListener('pointermove',e=>{ if(!dragging)return; setVal(fromY(e.clientY),true); readoutMove(wrap,label()); e.preventDefault(); });
    function end(){ if(!dragging)return; dragging=false; wrap.classList.remove('grab'); readoutHide(); }
    track.addEventListener('pointerup',end); track.addEventListener('pointercancel',end);
    wrap.addEventListener('keydown',e=>{ const st=(max-min)/20;
      if(e.key==='ArrowUp'){ setVal(+input.value+st,true); e.preventDefault(); }
      else if(e.key==='ArrowDown'){ setVal(+input.value-st,true); e.preventDefault(); } });
    requestAnimationFrame(paint);
    return { el:wrap, paint, setVal, get value(){return +input.value;} };
  }

  /* -------------------------------------------------------------- SWITCH -- */
  /* Standalone rocker. opts:{on,label,labelOn,labelOff,onChange}. For app
     integration this can wrap an existing button's handler. */
  function Toggle(opts){
    opts=opts||{}; let on=!!opts.on;
    const wrap=document.createElement('div'); wrap.className='pui-switch';
    const rk=document.createElement('div'); rk.className='pui-rocker'+(on?' on':'');
    rk.setAttribute('role','switch'); rk.setAttribute('tabindex','0'); rk.setAttribute('aria-checked',on);
    rk.setAttribute('aria-label',opts.label||'switch');
    rk.innerHTML=`<span class="pui-rocker-cap"><i class="pui-rocker-dot"></i><i class="pui-rocker-dot"></i></span>`;
    wrap.appendChild(rk);
    const lab=document.createElement('div'); lab.className='pui-label'; wrap.appendChild(lab);
    function txt(){ lab.textContent = opts.label ? opts.label+' · '+(on?(opts.labelOn||'on'):(opts.labelOff||'off')) : (on?(opts.labelOn||'on'):(opts.labelOff||'off')); }
    function set(v,fire){ on=!!v; rk.classList.toggle('on',on); rk.setAttribute('aria-checked',on); bump(rk,'flip'); txt(); if(fire!==false&&opts.onChange) opts.onChange(on); }
    rk.addEventListener('click',()=>set(!on,true));
    rk.addEventListener('keydown',e=>{ if(e.key===' '||e.key==='Enter'){ set(!on,true); e.preventDefault(); } });
    txt();
    return { el:wrap, set, get on(){return on;} };
  }

  /* --------------------------------------------------------------- XY PAD -- */
  /* Puck + fading trail. opts:{interactive,label,onChange(x,y),xLabel,yLabel}.
     .set(x,y,down) drives it externally (x,y in 0..1). When integrated over the
     synth keyboard it is driven by the existing pointer maths — display only. */
  function XYPad(host, opts){
    opts=opts||{};
    host.classList.add('pui-xy'); if(opts.bare) host.classList.add('pui-xy-bare');
    const cv=document.createElement('canvas');
    const puck=document.createElement('div'); puck.className='pui-xy-puck';
    if(!opts.bare){ const grid=document.createElement('div'); grid.className='pui-xy-grid'; host.appendChild(grid); }
    host.appendChild(cv); host.appendChild(puck);
    const listenEl=opts.listenOn||host;      // where pointer events come from (e.g. the keyboard)
    host.setAttribute('role','application'); host.setAttribute('aria-label',opts.label||'XY expression pad');
    const cx=cv.getContext('2d'); let W=0,H=0,dpr=1; const trail=[]; let raf=0, down=false;
    function fit(){ const b=host.getBoundingClientRect(); dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
      W=Math.round(b.width*dpr); H=Math.round(b.height*dpr); cv.width=W; cv.height=H; }
    function loop(){ raf=requestAnimationFrame(loop); cx.clearRect(0,0,W,H);
      const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#ff5a5f';
      for(let i=trail.length-1;i>=0;i--){ const p=trail[i]; p.a-=0.045; if(p.a<=0){ trail.splice(i,1); continue; }
        cx.beginPath(); cx.arc(p.x*W,p.y*H,(6+p.a*10)*dpr,0,7); cx.fillStyle=acc; cx.globalAlpha=p.a*0.5; cx.fill(); }
      cx.globalAlpha=1; if(trail.length===0 && !down){ cancelAnimationFrame(raf); raf=0; } }
    function place(x,y){ puck.style.transform=`translate(${x*host.clientWidth}px,${y*host.clientHeight}px)`; }
    function set(x,y,isDown){ x=clamp(x,0,1); y=clamp(y,0,1); host.classList.add('active'); if(isDown!=null) down=isDown;
      host.classList.toggle('grab',down); place(x,y);
      trail.push({x,y,a:1}); if(trail.length>26) trail.shift(); if(!raf) loop(); }
    function clear(){ down=false; host.classList.remove('grab'); }
    if(opts.interactive){
      const xy=e=>{ const b=listenEl.getBoundingClientRect(); return [ clamp((e.clientX-b.left)/b.width,0,1), clamp((e.clientY-b.top)/b.height,0,1) ]; };
      // In overlay mode the puck is display-only: don't preventDefault or capture,
      // so the underlying control (the keyboard) keeps its own pointer handling.
      const passive=!!opts.overlay;
      listenEl.addEventListener('pointerdown',e=>{ const[x,y]=xy(e); down=true; set(x,y,true); if(!passive){ try{listenEl.setPointerCapture(e.pointerId);}catch(_){} }
        if(opts.onChange)opts.onChange(x,1-y); if(!passive) e.preventDefault(); });
      listenEl.addEventListener('pointermove',e=>{ if(!down)return; const[x,y]=xy(e); set(x,y,true); if(opts.onChange)opts.onChange(x,1-y); if(!passive) e.preventDefault(); });
      const up=()=>{ down=false; host.classList.remove('grab'); if(passive) host.classList.remove('active'); };
      listenEl.addEventListener('pointerup',up); listenEl.addEventListener('pointercancel',up);
    }
    fit(); window.addEventListener('resize',fit);
    return { el:host, set, clear, fit };
  }

  window.PixSynthUI={ Knob, Fader, Toggle, XYPad, version:1 };
})();
