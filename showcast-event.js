(() => {
  const event = window.SHOWCAST_CONTENT?.evento || {};
  const {t, locale, localized} = window.ShowCastI18n;
  const ticker = document.getElementById('showcastNews');
  const newsLink = ticker.querySelector('a');
  const panel = document.getElementById('eventCountdown');
  const heading = document.getElementById('countdownGoal');
  const subtitle = panel.querySelector('[data-countdown-subtitle]');
  const status = panel.querySelector('[data-countdown-status]');
  const clock = panel.querySelector('[data-countdown-clock]');
  const outputs = [...clock.querySelectorAll('[data-countdown-value]')];
  const time = panel.querySelector('time');
  const raw = event.cuentaAtras?.inicio;
  const validShape = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
  const parsed = validShape ? Date.parse(raw) : NaN;
  const utcDate = validShape ? new Date(raw.slice(0, 10) + 'T00:00:00Z') : null;
  const originalStart = utcDate && Number.isFinite(+utcDate) && utcDate.toISOString().slice(0, 10) === raw.slice(0, 10) ? parsed : NaN;
  const local = ['localhost','127.0.0.1'].includes(location.hostname);
  const countdownEndpoint = local ? '/api/countdown' : 'https://34.10.158.213.sslip.io/api/countdown';
  let start = originalStart;
  let managed;
  let loadingCountdown = false;
  let timer;
  let inView = false;
  let numberFormat;

  function tick() {
    clearTimeout(timer);
    if (panel.hidden) return;
    const seconds = Math.max(0, Math.ceil((start - Date.now()) / 1000));
    const available = Number.isFinite(start) && seconds > 0;
    if (!available) {
      const message = Number.isFinite(start)
        ? managed?.ended || t('countdown.elapsed', 'La hora prevista ya ha pasado.')
        : t('countdown.pending', 'Fecha y hora por confirmar.');
      if (status.textContent !== message) status.textContent = message;
    }
    clock.hidden = !available;
    status.hidden = available;
    if (!available || !inView || document.hidden) return;

    const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];

    outputs.forEach((output, index) => {
      const value = numberFormat.format(values[index]);
      if (output.textContent !== value) output.textContent = value;
    });
    timer = setTimeout(tick, 1000 - Date.now() % 1000);
  }

  function render() {
    numberFormat = new Intl.NumberFormat(locale(), {minimumIntegerDigits: 2, useGrouping: false});
    const notice = localized(event.avisoPublico).trim();
    const venue = localized(event.lugar).trim();
    if (!ticker.hasAttribute('data-news-managed')) {
      ticker.hidden = !notice && !venue;
      newsLink.textContent = notice || t('news.venue', 'Próximo torneo · {venue}', {venue});
    }
    const visible = !managed || managed.enabled;
    panel.hidden = !visible;
    heading.textContent = managed?.title || t('countdown.title', 'Cuenta atrás del torneo');
    if (subtitle) {
      subtitle.textContent = managed?.subtitle || '';
      subtitle.hidden = !subtitle.textContent;
    }
    for (const unit of clock.querySelectorAll('[data-countdown-unit]')) {
      unit.textContent = t('countdown.unit.' + unit.dataset.countdownUnit, unit.textContent);
    }
    time.hidden = !Number.isFinite(start);
    if (!time.hidden) {
      time.dateTime = new Date(start).toISOString();
      time.textContent = new Intl.DateTimeFormat(locale(), {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid'
      }).format(start) + ' (Europe/Madrid)';
    }
    tick();
  }

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    tick();
  }, {rootMargin: '160px 0px'}).observe(panel);

  async function refreshCountdown() {
    if (document.hidden || loadingCountdown) return;
    loadingCountdown = true;
    try {
      const response = await fetch(countdownEndpoint, {credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)});
      if (!response.ok) return;
      const next = await response.json();
      if (typeof next?.configured !== 'boolean' || typeof next.enabled !== 'boolean') return;
      if (next.configured && next.enabled && (typeof next.target !== 'string' || !Number.isFinite(Date.parse(next.target)))) return;
      const settings = next.configured ? {
        enabled:next.enabled,target:next.target,title:next.title,subtitle:next.subtitle,ended:next.ended
      } : undefined;
      if (JSON.stringify(settings)===JSON.stringify(managed)) return;
      managed = settings;
      start = managed?.enabled ? Date.parse(managed.target) : originalStart;
      render();
    } catch {
      // Keep the last verified countdown while the server is unavailable.
    } finally { loadingCountdown = false; }
  }

  document.addEventListener('showcast:language', render);
  document.addEventListener('visibilitychange', () => { tick(); refreshCountdown(); });
  render();
  refreshCountdown();
  setInterval(refreshCountdown, 30000);
})();
