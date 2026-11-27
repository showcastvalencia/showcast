(() => {
  const wrap = document.getElementById('galleryAccordion');
  const data = window.SHOWCAST_CONTENT || {};
  const local = Array.isArray(data.galeriaEdiciones) && data.galeriaEdiciones.length
    ? data.galeriaEdiciones
    : (Array.isArray(data.galeria) && data.galeria.length ? [{titulo: 'Galería', items: data.galeria}] : []);
  const previews = window.ShowCastGalleryPreviews || {};
  const {t} = window.ShowCastI18n;
  const expiry = 30 * 86400000;
  const sections = new Map();
  let rows = [];
  let mounted = false;
  let expiryTimer;
  let openedAlbum = false;

  const escape = value => String(value ?? '').replace(/[&<>"']/g, key =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[key]);
  const bodyOf = entry => entry.querySelector(':scope > .gallery-edicion-body');
  const toggleOf = entry => entry.querySelector(':scope > button');
  const newLabel = () => t('gallery.new', 'Nuevo');

  function isNew(item, now) {
    return Number.isFinite(item.publicadoEn) && item.publicadoEn <= now && now < item.publicadoEn + expiry;
  }

  function updateBadges() {
    clearTimeout(expiryTimer);
    let next = Infinity;
    const now = Date.now();
    for (const {row, entry} of sections.values()) {
      let hasNew = false;
      for (const item of row.items || []) {
        if (isNew(item, now)) {
          hasNew = true;
          next = Math.min(next, item.publicadoEn + expiry);
        } else if (item.publicadoEn > now) next = Math.min(next, item.publicadoEn);
      }
      const label = toggleOf(entry).querySelector('.gallery-new');
      label.hidden = !hasNew;
      label.textContent = newLabel();
      bodyOf(entry).querySelectorAll('.gallery-tile .gallery-new').forEach(badge => {
        badge.hidden = !isNew({publicadoEn: Number(badge.dataset.published)}, now);
        badge.textContent = newLabel();
      });
    }
    if (Number.isFinite(next)) expiryTimer = setTimeout(updateBadges, Math.min(2147483647, Math.max(10, next - now)));
  }

  function photo(item, cover) {
    const variants = previews[item.src] || [];
    const first = variants[0];
    const srcset = [...new Map(variants.map(v => [v.w, v])).values()].map(v => escape(v.src) + ' ' + v.w + 'w').join(', ');
    const responsive = first ? ' width="' + first.w + '" height="' + first.h + '" srcset="' + srcset +
      '" sizes="(max-width: 440px) 84vw, (max-width: 780px) 43vw, 32vw"' : '';
    const published = Number.isFinite(item.publicadoEn)
      ? '<span class="gallery-new" data-i18n-skip data-published="' + item.publicadoEn + '" hidden></span>' : '';
    return '<button type="button" class="gallery-tile has-photo gallery-tile-photo" data-gallery-original="' +
      escape(item.src) + '"><img src="' + escape(first?.src || item.miniatura || item.src) + '"' +
      responsive + ' alt="' + escape(item.caption || 'Foto Showcast') + '" loading="lazy" decoding="async">' +
      '<span class="gallery-image-error" hidden>Imagen no disponible</span>' +
      (cover ? '<span class="gallery-cover-label">Portada</span>' : '') + published +
      (item.caption ? '<span data-i18n-skip>' + escape(item.caption) + '</span>' : '') + '</button>';
  }

  function media(item, cover) {
    if (item.tipo === 'foto' || !item.tipo) return photo(item, cover);
    if (item.tipo === 'youtube') {
      const id = item.src?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,15})/)?.[1];
      return id ? '<div class="gallery-tile has-photo"><iframe loading="lazy" src="https://www.youtube.com/embed/' +
        id + '" title="' + escape(item.caption || 'Vídeo de YouTube') + '" allowfullscreen></iframe></div>' : '';
    }
    if (item.tipo === 'video') return '<div class="gallery-tile has-photo"><video controls playsinline preload="none" src="' +
      escape(item.src) + '"></video></div>';
    return '';
  }

  function albumHtml(row) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.fecha)
      ? '<time data-i18n-date="' + escape(row.fecha) + '" datetime="' + escape(row.fecha) + '">' + escape(row.fecha) + '</time>'
      : escape(row.fecha || 'Próximamente');
    const location = row.ubicacion ? '<span>📍 ' + escape(row.ubicacion) + '</span>' : '';
    const map = row.ubicacion ? '<div class="edicion-map"><iframe loading="lazy" src="https://www.google.com/maps?q=' +
      encodeURIComponent(row.ubicacion + ', Valencia') + '&amp;output=embed" title="Mapa ' + escape(row.ubicacion) + '"></iframe></div>' : '';
    const items = row.items || [];
    const tiles = items.map(item => media(item, item.src === row.portada)).join('');
    return '<div class="edicion-meta"><span>📅 ' + date + '</span>' + location + '</div>' +
      (row.descripcion ? '<p class="edicion-meta" data-i18n-skip>' + escape(row.descripcion) + '</p>' : '') + map +
      (tiles ? '<div class="gallery-grid">' + tiles + '</div>'
        : '<p class="gallery-edicion-empty">Todavía no hay fotos en este apartado.</p>');
  }

  function setOpen(entry, open) {
    entry.classList.toggle('open', open);
    toggleOf(entry).setAttribute('aria-expanded', String(open));
    const body = bodyOf(entry);
    body.hidden = !open;
    if (!open) {
      if (entry.classList.contains('sub')) body.firstElementChild.replaceChildren();
      else body.querySelectorAll('.gallery-edicion.sub').forEach(album => bodyOf(album).firstElementChild.replaceChildren());
      return;
    }
    if (entry.classList.contains('sub')) materialize(entry);
    else body.querySelectorAll('.gallery-edicion.sub.open').forEach(materialize);
    updateBadges();
  }

  function materialize(entry) {
    const {row} = sections.get(entry.dataset.galleryKey);
    const content = bodyOf(entry).firstElementChild;
    if (content.firstElementChild) return;
    content.innerHTML = albumHtml(row);
  }

  function openDeepLink() {
    const target = new URLSearchParams(location.search).get('album');
    if (!target || openedAlbum || location.hash !== '#galeria') return;
    const match = sections.get(target);
    if (!match) return;
    openedAlbum = true;
    setOpen(match.entry.parentElement.closest('.gallery-edicion'), true);
    setOpen(match.entry, true);
    requestAnimationFrame(() => match.entry.scrollIntoView({block: 'center'}));
  }

  function render() {
    if (!mounted) return;
    const previous = new Map([...wrap.querySelectorAll('[data-gallery-key]')].map(entry =>
      [entry.dataset.galleryKey, entry.classList.contains('open')]));
    const focused = document.activeElement?.closest('[data-gallery-key]');
    const cities = new Map();
    rows.forEach(row => {
      const name = row.ciudad || 'Sin ciudad';
      if (!cities.has(name)) cities.set(name, []);
      cities.get(name).push(row);
    });
    const byKey = new Map();
    sections.clear();
    function entryHtml(key, title, open, inside, row) {
      return '<div class="gallery-edicion' + (row ? ' sub' : '') + (open ? ' open' : '') +
        '" data-gallery-key="' + escape(key) + '"><button type="button" class="gallery-edicion-toggle" aria-expanded="' +
        open + '"><span' + (title && title !== 'Sin ciudad' && title !== 'Sin título' ? ' data-i18n-skip' : '') + '>' +
        escape(title) + '</span>' + (row ? '<span class="gallery-new" data-i18n-skip hidden></span>' : '') +
        '<span class="chev" aria-hidden="true"></span></button><div class="gallery-edicion-body"' +
        (open ? '' : ' hidden') + '><div>' + inside + '</div></div></div>';
    }
    wrap.innerHTML = [...cities].map(([city, albums], i) => {
      const cityKey = JSON.stringify([city]);
      const counts = new Map();
      const children = albums.map((row, j) => {
        const title = row.anio || row.titulo;
        const occurrence = counts.get(title) || 0;
        counts.set(title, occurrence + 1);
        const key = JSON.stringify([city, title, occurrence]);
        byKey.set(key, row);
        return entryHtml(key, title || 'Sin título', previous.get(key) ?? (i === 0 && j === 0), '', row);
      }).join('');
      return entryHtml(cityKey, city, previous.get(cityKey) ?? i === 0, '<div class="gallery-accordion nested">' + children + '</div>');
    }).join('') || '<p class="gallery-note">No hay álbumes disponibles.</p>';
    let focusTarget;
    wrap.querySelectorAll('[data-gallery-key]').forEach(entry => {
      const key = entry.dataset.galleryKey;
      if (byKey.has(key)) sections.set(key, {row: byKey.get(key), entry});
      if (focused?.dataset.galleryKey === key) focusTarget = toggleOf(entry);
    });
    wrap.querySelectorAll('.gallery-edicion.open .gallery-edicion.sub.open').forEach(materialize);
    focusTarget?.focus({preventScroll: true});
    updateBadges();
    openDeepLink();
  }

  wrap.addEventListener('click', event => {
    const button = event.target.closest('.gallery-edicion-toggle');
    if (!button) return;
    const entry = button.closest('.gallery-edicion');
    setOpen(entry, !entry.classList.contains('open'));
  });
  wrap.addEventListener('error', event => {
    const img = event.target;
    if (!img.matches?.('.gallery-tile-photo img')) return;
    const original = img.closest('button').dataset.galleryOriginal;
    if (!img.dataset.fallback && new URL(original, location.href).href !== img.currentSrc) {
      img.dataset.fallback = 'true';
      img.removeAttribute('srcset');
      img.src = original;
    } else {
      img.hidden = true;
      img.closest('button').disabled = true;
      const warning = img.nextElementSibling;
      warning.hidden = false;
      img.closest('button').setAttribute('aria-label', img.alt + ' · ' + warning.textContent);
    }
  }, true);
  document.addEventListener('showcast:language', updateBadges);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateBadges(); });
  window.addEventListener('hashchange', openDeepLink);
  const lazy = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    lazy.disconnect();
    mounted = true;
    render();
  }, {rootMargin: '350px 0px'});
  lazy.observe(document.getElementById('galeria'));
  window.ShowCastPublicData.subscribeGallery(editions => {
    rows = [...local, ...editions];
    render();
  });
})();
