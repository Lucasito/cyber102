// Recording overlay only; injected into an isolated browser, never shipped with the site.
(() => {
  function mount() {
    if (window.top !== window || document.getElementById('demo-pointer-overlay')) return;
    const host = document.createElement('div');
    host.id = 'demo-pointer-overlay';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{pointer-events:none}
      #pointer{position:fixed;left:100px;top:100px;width:38px;height:48px;filter:drop-shadow(0 2px 2px #0008);transform:translate(-3px,-2px)}
      #halo{position:fixed;left:100px;top:100px;width:44px;height:44px;margin:-22px;border-radius:50%;background:#ffb30030;border:2px solid #ff9800b0;box-sizing:border-box}
      .click{position:fixed;width:64px;height:64px;margin:-32px;border:5px solid #ff8a00;background:#ffb30055;border-radius:50%;box-sizing:border-box;animation:press 1.1s ease-out forwards}
      @keyframes press{0%{transform:scale(.45);opacity:1}30%{transform:scale(1);opacity:1}100%{transform:scale(1.45);opacity:0}}
    </style><div id="halo"></div><svg id="pointer" viewBox="0 0 38 48"><path d="M4 3 L4 34 L12 27 L18 43 L25 40 L18 25 L30 25 Z" fill="#171717" stroke="white" stroke-width="2.6" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(host);
    const pointer = shadow.getElementById('pointer');
    const halo = shadow.getElementById('halo');
    function move(x, y) {
      for (const element of [pointer, halo]) { element.style.left = x + 'px'; element.style.top = y + 'px'; }
      sessionStorage.setItem('__demoPointer', JSON.stringify({x, y}));
    }
    function showClick(x, y, age = 0) {
      const ring = document.createElement('div');
      ring.className = 'click';
      ring.style.left = x + 'px'; ring.style.top = y + 'px';
      ring.style.animationDelay = `-${age}ms`;
      shadow.appendChild(ring);
      setTimeout(() => ring.remove(), Math.max(0, 1150 - age));
    }
    const previous = JSON.parse(sessionStorage.getItem('__demoPointer') || 'null');
    if (previous) move(previous.x, previous.y);
    const lastClick = JSON.parse(sessionStorage.getItem('__demoLastClick') || 'null');
    if (lastClick && Date.now() - lastClick.at < 1100) showClick(lastClick.x, lastClick.y, Date.now() - lastClick.at);
    addEventListener('mousemove', e => move(e.clientX, e.clientY), true);
    addEventListener('pointerdown', e => {
      move(e.clientX, e.clientY);
      sessionStorage.setItem('__demoLastClick', JSON.stringify({x: e.clientX, y: e.clientY, at: Date.now()}));
      showClick(e.clientX, e.clientY);
      window.__demoClickCount = (window.__demoClickCount || 0) + 1;
      const target = e.target.closest('a,button,input,select,textarea,label');
      window.demoClick?.(e.clientX, e.clientY, (target?.getAttribute('aria-label') || target?.name || target?.textContent || target?.tagName || '').trim().slice(0, 100));
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
  else mount();
})();
