(() => {
  const ticker = document.getElementById('showcastNews');
  if (!ticker) return;
  const local = ['127.0.0.1','localhost'].includes(location.hostname);
  const endpoint = local ? '/api/news' : 'https://34.10.158.213.sslip.io/api/news';
  const allowedLinks = new Set(['#evento','#inscripcion','#galeria','#torneos']);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const label = ticker.querySelector('strong');
  let record, signature, animation, windowWidth, requestPending, timer, resizeFrame;
  let visible = false;
  let hovered = false;
  let focused = false;

  function syncMotion() {
    if (!animation) return;
    if (visible && !document.hidden && !hovered && !focused) animation.play();
    else animation.pause();
  }

  function render() {
    animation?.cancel();
    windowWidth = ticker.clientWidth;
    ticker.replaceChildren(label);
    ticker.hidden = record.mode === 'hidden' || !record.items.length;
    if (ticker.hidden) return;
    const viewport = document.createElement('div');
    viewport.className = 'sc-news-window';
    const track = document.createElement('div');
    track.className = 'sc-news-track';
    track.style.columnGap = record.gap + 'px';
    const moving = record.mode === 'continuous' && !reduced.matches;
    if (moving) track.classList.add('is-moving');
    function append(duplicate) {
      for (const item of record.items) {
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.text;
        if (duplicate) {
          link.tabIndex = -1;
          link.setAttribute('aria-hidden','true');
        }
        track.append(link);
      }
    }
    append(false);
    viewport.append(track);
    ticker.append(viewport);
    if (!moving) return;
    const cycle = track.getBoundingClientRect().width + record.gap;
    for (let i = 0; i < Math.ceil(viewport.clientWidth / cycle) + 1; i++) append(true);
    animation = track.animate([{transform:'translateX(0)'},{transform:`translateX(${-cycle}px)`}],
      {duration:cycle * 1000 / record.speed,iterations:Infinity});
    syncMotion();
  }

  async function refresh() {
    if (requestPending || document.hidden) return;
    requestPending = true;
    try {
      const response = await fetch(endpoint,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)});
      if (!response.ok) return;
      const next = await response.json();
      if (typeof next.revision !== 'string' || !['continuous','static','hidden'].includes(next.mode) ||
        !Number.isInteger(next.speed) || next.speed < 10 || next.speed > 200 ||
        !Number.isInteger(next.gap) || next.gap < 8 || next.gap > 120 || !Array.isArray(next.items)) return;
      next.items = next.items.filter(item => typeof item?.text === 'string' && item.text && allowedLinks.has(item.href));
      const current = JSON.stringify(next);
      if (signature === current) return;
      signature = current;
      record = next;
      ticker.setAttribute('data-news-managed','');
      render();
    } catch {
      // Keep the current display when the service is temporarily unavailable.
    } finally {
      requestPending = false;
    }
  }
  ticker.addEventListener('mouseenter', () => { hovered = true; syncMotion(); });
  ticker.addEventListener('mouseleave', () => { hovered = false; syncMotion(); });
  ticker.addEventListener('focusin', () => { focused = true; syncMotion(); });
  ticker.addEventListener('focusout', event => {
    focused = ticker.contains(event.relatedTarget);
    syncMotion();
  });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  }).observe(ticker);
  function schedule() {
    clearInterval(timer);
    if (!document.hidden) {
      refresh();
      timer = setInterval(refresh, 30000);
    }
    syncMotion();
  }
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', () => { if (record) render(); });
  window.addEventListener('resize', () => {
    if (resizeFrame !== undefined) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (record && ticker.clientWidth !== windowWidth) render();
    });
  });
  schedule();
})();
