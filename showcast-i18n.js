(() => {
  const files = { es: 'es', 'ca-valencia': 'ca-valencia', en: 'en' };
  const formats = { es: 'es-ES', 'ca-valencia': 'ca-ES-valencia', en: 'en-GB' };
  const preferenceKey = 'showcast.language';
  const attributes = ['placeholder', 'aria-label', 'title', 'alt'];
  const sources = new WeakMap();
  const content = new WeakMap();
  const bundles = new Map();
  let language = 'es';
  let base = {};
  let dictionary = {};
  let request = 0;
  const normalize = value => value.trim().replace(/\s+/g, ' ');
  const sourceIndex = new Map();
  let rules = [];

  function pick(value) {
    if (typeof value === 'string') return value;
    if (typeof value?.[language] === 'string' && value[language].trim()) return value[language];
    return typeof value?.es === 'string' ? value.es : '';
  }

  function translate(key, fallback, vars = {}) {
    const value = dictionary[key] ?? base[key] ?? fallback ?? key;
    return value.replace(/\{(\w+)\}/g, (token, name) => vars[name] ?? token);
  }

  function load(code) {
    if (!bundles.has(code)) {
      const promise = fetch(new URL('showcast-' + files[code] + '.json', scriptUrl))
        .then(response => {
          if (!response.ok) throw new Error('Language file unavailable');
          return response.json();
        }).catch(error => {
          bundles.delete(code);
          throw error;
        });
      bundles.set(code, promise);
    }
    return bundles.get(code);
  }

  function translateSource(value, allowRules) {
    const trimmed = value.trim();
    const key = sourceIndex.get(normalize(value));
    if (key) return value.replace(trimmed, () => translate(key));
    if (allowRules) {
      for (const [id, pattern] of rules) {
        const match = trimmed.match(pattern);
        if (match) {
          const vars = match.groups;
          if (vars.amount && /^\d+(?:\.\d+)?$/.test(vars.amount)) {
            const precision = vars.amount.split('.')[1]?.length || 0;
            vars.amount = new Intl.NumberFormat(formats[language], {
              minimumFractionDigits: precision, maximumFractionDigits: precision
            }).format(Number(vars.amount));
          }
          return value.replace(trimmed, () => translate(id, trimmed, vars));
        }
      }
    }
    return value;
  }

  function applyValue(node, name, value, write, allowRules) {
    if (!value) return;
    let state = sources.get(node);
    if (!state) sources.set(node, state = {});
    const original = state[name]?.rendered === value ? state[name].original : value;
    const rendered = translateSource(original, allowRules);
    if (rendered !== original || state[name]) state[name] = {original, rendered};
    if (rendered !== value) write(rendered);
  }

  function applyDate(element) {
    const value = element.dataset.i18nDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return;
    const formatted = new Intl.DateTimeFormat(formats[language], {dateStyle: 'long', timeZone: 'UTC'}).format(date);
    if (element.textContent !== formatted) element.textContent = formatted;
  }

  const skip = '[data-i18n-skip], [data-i18n-content], script, style, svg, [data-i18n-date]';
  const translatableAttributes = attributes.map(name => '[' + name + ']').join(',');

  function apply(root) {
    const applyText = node => {
      if (!node.parentElement?.closest(skip)) {
        applyValue(node, 'text', node.data, value => { node.data = value; }, true);
      }
    };
    if (root.nodeType === Node.TEXT_NODE) return applyText(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest('[data-i18n-skip], script, style, svg')) return;
    if (root.matches('[data-i18n-date]')) applyDate(root);
    root.querySelectorAll('[data-i18n-date]').forEach(applyDate);
    for (const node of [root, ...root.querySelectorAll('[data-i18n-content]')]) {
      if (!content.has(node)) continue;
      const value = pick(content.get(node));
      if (node.textContent !== value) node.textContent = value;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) applyText(walker.currentNode);
    for (const node of [root, ...root.querySelectorAll(translatableAttributes)]) {
      if (node.closest(skip)) continue;
      for (const name of attributes) {
        applyValue(node, name, node.getAttribute(name), value => node.setAttribute(name, value), true);
      }
    }
  }

  function codeFor(tag) {
    if (!tag) return null;
    if (/^(ca|val)(-|$)/i.test(tag)) return 'ca-valencia';
    const code = tag.toLowerCase().split('-')[0];
    return Object.hasOwn(files, code) ? code : null;
  }

  function configureSources() {
    for (const [key, source] of Object.entries(base)) {
      if (!key.startsWith('format.')) {
        sourceIndex.set(normalize(source), key);
        continue;
      }
      // Solo se crean patrones a partir del catálogo español local.
      const escape = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = source.split(/(\{\w+\})/g).map(part =>
        /^\{\w+\}$/.test(part) ? '(?<' + part.slice(1, -1) + '>.+?)' : escape(part)
      ).join('');
      rules.push([key, new RegExp('^' + pattern + '$')]);
    }
  }

  function applyLanguage(code) {
    language = code;
    document.documentElement.lang = code;
    document.title = translate('page.title', 'SHOWCAST — Organización de eventos Gaming');
    apply(document.body);
  }

  async function select(code, save = false) {
    const version = ++request;
    let chosen = codeFor(code) || 'es';
    let loaded = {};
    try { loaded = chosen === 'es' ? base : await load(chosen); }
    catch { chosen = 'es'; }
    if (version !== request) return;
    dictionary = loaded;
    applyLanguage(chosen);
    document.querySelector('#siteLanguage [data-flag]').dataset.flag = chosen;
    document.querySelectorAll('#languageMenu [data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === chosen));
    });
    if (save) {
      try { localStorage.setItem(preferenceKey, chosen); } catch { /* Storage may be disabled. */ }
    }
    document.dispatchEvent(new CustomEvent('showcast:language', {detail: {language: chosen}}));
  }

  const scriptUrl = document.currentScript.src;
  window.ShowCastI18n = {
    t: translate,
    localized: pick,
    bindContent: (element, value) => {
      if (typeof value === 'string') {
        element.textContent = value;
      } else if (value && typeof value.es === 'string') {
        content.set(element, value);
        element.dataset.i18nContent = '';
        element.textContent = pick(value);
      }
    },
    locale: () => formats[language],
    formatNumber: number => new Intl.NumberFormat(formats[language]).format(number)
  };

  document.addEventListener('DOMContentLoaded', async () => {
    const menu = document.getElementById('languageMenu');
    let ready = false;
    let selectedEarly;
    menu.addEventListener('click', e => {
      const option = e.target.closest('[data-language]');
      if (!option) return;
      if (ready) select(option.dataset.language, true);
      else selectedEarly = option.dataset.language;
    });
    try { base = await load('es'); } catch { return; }
    ready = true;
    configureSources();
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(apply);
        else if (record.type === 'characterData') apply(record.target);
        else {
          const node = record.target;
          const name = record.attributeName;
          if (!node.closest(skip)) {
            applyValue(node, name, node.getAttribute(name), value => node.setAttribute(name, value), true);
          }
        }
      }
    }).observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: attributes
    });
    let saved;
    try { saved = localStorage.getItem(preferenceKey); } catch { /* Storage may be disabled. */ }
    const detected = (navigator.languages || [navigator.language]).map(codeFor).find(Boolean);
    await select(selectedEarly || saved || detected || 'es', Boolean(selectedEarly));
  });
})();
