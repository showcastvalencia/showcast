/* Fuente pública de ShowCast Admin. Los datos de content.js siguen siendo el respaldo histórico. */
window.ShowCastPublicData = (() => {
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const endpoint = new URL(local ? 'api/gallery' : 'https://34.10.158.213.sslip.io/api/gallery', location.href);
  const mediaPath = new RegExp('^' + endpoint.pathname + '/media/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$');
  const observers = new Set();
  let gallery = [];
  let signature = '[]';
  let pending;
  let timer;
  let relevant = false;
  let visibility;
  const text = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';

  function mediaUrl(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      if (url.origin === endpoint.origin && !url.username && !url.password &&
          !url.search && !url.hash && mediaPath.test(url.pathname)) return url.href;
    } catch {
      // El contrato publica URL absolutas.
    }
    return '';
  }

  function readGallery(payload) {
    if (!Array.isArray(payload)) throw new Error('Respuesta de galería inválida');
    return payload.flatMap(row => {
      const ciudad = text(row?.ciudad, 80);
      const titulo = text(row?.titulo, 100);
      if (!ciudad || !titulo || !Array.isArray(row.items)) return [];
      const items = row.items.flatMap(photo => {
        const src = photo?.tipo === 'foto' ? mediaUrl(photo.src) : '';
        return src ? [{tipo: 'foto', src, caption: text(photo.caption, 250)}] : [];
      });
      const portada = mediaUrl(row.portada);
      return [{
        ciudad, titulo, items,
        fecha: text(row.fecha, 10),
        descripcion: text(row.descripcion, 1000),
        portada: items.some(photo => photo.src === portada) ? portada : ''
      }];
    });
  }

  function publish(next) {
    const serialized = JSON.stringify(next);
    if (serialized === signature) return;
    signature = serialized;
    gallery = next;
    observers.forEach(observer => observer(gallery));
  }

  function refreshGallery() {
    if (!pending) {
      pending = fetch(endpoint, {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000)})
        .then(response => {
          if (!response.ok) throw new Error('Galería no disponible');
          return response.json();
        })
        .then(readGallery)
        .catch(() => [])
        .then(publish)
        .finally(() => { pending = undefined; });
    }
    return pending;
  }

  function schedule() {
    clearInterval(timer);
    if (!document.hidden && observers.size && relevant) {
      refreshGallery();
      timer = setInterval(refreshGallery, 30000);
    }
  }

  function subscribeGallery(observer) {
    observers.add(observer);
    observer(gallery);
    if (observers.size === 1) {
      document.addEventListener('visibilitychange', schedule);
      visibility = new IntersectionObserver(([entry]) => {
        relevant = entry.isIntersecting;
        schedule();
      }, {rootMargin: '400px 0px'});
      visibility.observe(document.getElementById('galeria'));
    }
    return () => {
      observers.delete(observer);
      if (!observers.size) {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', schedule);
        visibility?.disconnect();
        relevant = false;
      }
    };
  }

  return {subscribeGallery, refreshGallery};
})();
