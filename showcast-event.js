(() => {
  const event = window.SHOWCAST_CONTENT?.evento || {};
  const {t, locale, localized} = window.ShowCastI18n;
  const ticker = document.getElementById('showcastNews');
  const newsLink = ticker.querySelector('a');
  const panel = document.getElementById('eventCountdown');
  const heading = document.getElementById('countdownGoal');
  const status = panel.querySelector('[data-countdown-status]');
  const clock = panel.querySelector('[data-countdown-clock]');
  const outputs = [...clock.querySelectorAll('[data-countdown-value]')];
  const time = panel.querySelector('time');
  const raw = event.cuentaAtras?.inicio;
  const validShape = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
  const parsed = validShape ? Date.parse(raw) : NaN;
  const utcDate = validShape ? new Date(raw.slice(0, 10) + 'T00:00:00Z') : null;
  const start = utcDate && Number.isFinite(+utcDate) && utcDate.toISOString().slice(0, 10) === raw.slice(0, 10) ? parsed : NaN;
  let timer;

  function tick() {
    clearTimeout(timer);
    const seconds = Math.max(0, Math.ceil((start - Date.now()) / 1000));
    const available = Number.isFinite(start) && seconds > 0;
    clock.hidden = !available;
    status.hidden = available;
    status.textContent = Number.isFinite(start)
      ? t('countdown.elapsed', 'La hora prevista ya ha pasado.')
      : t('countdown.pending', 'Fecha y hora por confirmar.');
    if (!available) return;

    const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
    const format = new Intl.NumberFormat(locale(), {minimumIntegerDigits: 2, useGrouping: false});
    outputs.forEach((output, index) => {
      const value = format.format(values[index]);
      if (output.textContent !== value) output.textContent = value;
    });
    if (!document.hidden) timer = setTimeout(tick, 1000 - Date.now() % 1000);
  }

  function render() {
    const notice = localized(event.avisoPublico).trim();
    const venue = localized(event.lugar).trim();
    ticker.hidden = !notice && !venue;
    newsLink.textContent = notice || t('news.venue', 'Próximo torneo · {venue}', {venue});
    heading.textContent = t('countdown.title', 'Cuenta atrás del torneo');
    for (const unit of clock.querySelectorAll('[data-countdown-unit]')) {
      unit.textContent = t('countdown.unit.' + unit.dataset.countdownUnit, unit.textContent);
    }
    if (Number.isFinite(start)) {
      time.hidden = false;
      time.dateTime = new Date(start).toISOString();
      time.textContent = new Intl.DateTimeFormat(locale(), {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid'
      }).format(start) + ' (Europe/Madrid)';
    }
    tick();
  }

  document.addEventListener('showcast:language', render);
  document.addEventListener('visibilitychange', tick);
  render();
})();
