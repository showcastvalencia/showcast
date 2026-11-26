/* La galería de Admin se publica en GitHub Pages. content.js conserva las ediciones históricas. */
window.ShowCastPublicData = (() => {
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const endpoint = new URL(local ? 'api/gallery' : 'https://34.10.158.213.sslip.io/api/gallery', location.href);
  const manifest = new URL('showcast-gallery.json', document.baseURI);
  const mediaPath = new RegExp('^' + endpoint.pathname + '/media/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$');
  const observers = new Set();
  let gallery = [];
  let signature = '[]';
  let pending;
  let timer;
  let relevant = false;
  let visibility;
  const text = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';

  function mediaUrl(value, fromPages) {
    if (typeof value !== 'string') return '';
    try {
      if (fromPages) {
        if (!/^assets\/showcast-admin\/[a-f0-9]{64}\.webp$/.test(value)) return '';
        return new URL(value, manifest).href;
      }
      const url = new URL(value);
      if (url.origin === endpoint.origin && !url.username && !url.password &&
          !url.search && !url.hash && mediaPath.test(url.pathname)) return url.href;
    } catch {
      // El contrato publica URL absolutas.
    }
    return '';
  }

  function readGallery(payload, fromPages) {
    if (!Array.isArray(payload)) throw new Error('Respuesta de galería inválida');
    return payload.flatMap(row => {
      const ciudad = text(row?.ciudad, 80);
      const titulo = text(row?.titulo, 100);
      if (!ciudad || !titulo || !Array.isArray(row.items)) return [];
      const items = row.items.flatMap(photo => {
        const src = photo?.tipo === 'foto' ? mediaUrl(photo.src, fromPages) : '';
        return src ? [{tipo: 'foto', src, caption: text(photo.caption, 250)}] : [];
      });
      const portada = mediaUrl(row.portada, fromPages);
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
      const get = url => fetch(url, {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000)});
      pending = get(manifest)
        .then(async response => {
          if (response.status === 404) {
            const legacy = await get(endpoint);
            if (!legacy.ok) throw new Error('Galería no disponible');
            return readGallery(await legacy.json(), false);
          }
          if (!response.ok) throw new Error('Galería no disponible');
          const data = await response.json();
          if (data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.revision)) throw new Error('Formato de galería inválido');
          return readGallery(data.editions, true);
        })
        .catch(() => gallery)
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
