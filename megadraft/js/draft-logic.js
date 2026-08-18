/*
  MEGADRAFT — lógica compartida
  ===============================
  Funciones reutilizadas por draft.html, screen.html y admin.html.
  Depende de firebase-config.js (variables globales `db` y `auth`) estando
  cargado antes que este archivo.
*/
const MD = (function () {
  const TEAMS_PER_DRAFT = 8;
  const PICKS_PER_TEAM = 12;
  const TOTAL_PICKS = TEAMS_PER_DRAFT * PICKS_PER_TEAM;
  const STATE_PATH = 'megadraft';

  // Mismo proxy que usa la web principal para consultar la API de Brawl Stars
  // (ver proxy/brawlstars.php) — solo responde a peticiones desde orígenes
  // autorizados (showcastvalencia.github.io), así que la comprobación de tag
  // no funciona en local (localhost/file://), solo en la web ya publicada.
  const BRAWL_PROXY = 'https://34.10.158.213.sslip.io/proxy/brawlstars.php';

  // ---------- SISTEMA DE PUNTOS (pendiente de ajustar) ----------
  // Cambiar aquí recalcula los puntos de todo el mundo al instante, sin tener
  // que volver a comprobar los tags: solo se guardan las estadísticas en
  // bruto de cada jugador, la puntuación siempre se calcula a partir de ellas.
  const POINTS_PER_TROPHY = 1;
  const POINTS_PER_3V3_VICTORY = 10;
  const POINTS_PER_RANKED_ELO = 50;

  function fetchPlayerStats(tag) {
    const cleanTag = String(tag || '').trim();
    if (!cleanTag) return Promise.reject(new Error('Escribe un código de jugador.'));
    return fetch(BRAWL_PROXY + '?tag=' + encodeURIComponent(cleanTag))
      .then(res => res.json())
      .then(body => {
        if (!body.ok) throw new Error(body.error || 'No se ha podido comprobar la cuenta.');
        return {
          tag: body.tag || cleanTag,
          name: body.name || '',
          iconUrl: body.iconUrl || '',
          trophies: body.trophies || 0,
          victories3v3: body.victories3v3 || 0,
          rankedAllTimePeakElo: body.rankedAllTimePeakElo || 0,
          rankedAllTimePeakName: body.rankedAllTimePeakName || '',
        };
      });
  }

  function calcMemberScore(member) {
    if (!member) return 0;
    return (member.trophies || 0) * POINTS_PER_TROPHY
      + (member.victories3v3 || 0) * POINTS_PER_3V3_VICTORY
      + (member.rankedAllTimePeakElo || 0) * POINTS_PER_RANKED_ELO;
  }

  function calcTeamScore(team) {
    const miembros = (team && Array.isArray(team.miembros)) ? team.miembros : [];
    return miembros.reduce((sum, m) => sum + calcMemberScore(m), 0);
  }

  let brawlersCache = null;

  function loadBrawlers() {
    if (brawlersCache) return Promise.resolve(brawlersCache);
    return fetch('../assets/brawlers.json')
      .then(res => res.json())
      .then(list => { brawlersCache = list; return list; });
  }

  function subscribeState(cb) {
    db.ref(STATE_PATH).on('value', snap => cb(snap.val() || null));
    return () => db.ref(STATE_PATH).off('value');
  }

  function signInAnon() {
    return auth.currentUser
      ? Promise.resolve(auth.currentUser)
      : auth.signInAnonymously().then(cred => cred.user);
  }

  function currentTurnTeamId(state) {
    if (!state || !state.draftOrder || state.status !== 'drafting') return null;
    if (state.currentPickIndex >= TOTAL_PICKS) return null;
    return state.draftOrder[state.currentPickIndex % TEAMS_PER_DRAFT];
  }

  function currentRound(state) {
    if (!state) return 0;
    return Math.min(Math.floor(state.currentPickIndex / TEAMS_PER_DRAFT) + 1, PICKS_PER_TEAM);
  }

  function isComplete(state) {
    return !!state && state.currentPickIndex >= TOTAL_PICKS;
  }

  // Los picks de un equipo no se guardan por equipo: se derivan siempre de
  // pickedBrawlers (única fuente de verdad), que es más sencillo de proteger
  // con las reglas de seguridad de Firebase.
  function picksForTeam(state, teamId) {
    const picked = (state && state.pickedBrawlers) || {};
    return Object.keys(picked).filter(brawlerId => picked[brawlerId] === teamId);
  }

  function teamPickCount(state, teamId) {
    return picksForTeam(state, teamId).length;
  }

  // Intenta "reclamar" un equipo con su PIN. Guarda el teamId en localStorage
  // para que el capitán no tenga que volver a escribir el PIN en ese dispositivo.
  function claimTeam(state, teamId, pin, uid) {
    const team = state && state.teams && state.teams[teamId];
    if (!team) return Promise.reject(new Error('Equipo no encontrado.'));
    if (String(team.pin) !== String(pin)) return Promise.reject(new Error('PIN incorrecto.'));
    if (team.claimedBy && team.claimedBy !== uid) {
      return Promise.reject(new Error('Ese equipo ya se ha conectado desde otro dispositivo.'));
    }
    return db.ref(`${STATE_PATH}/teams/${teamId}/claimedBy`).set(uid).then(() => teamId);
  }

  function findTeamByPin(state, pin) {
    if (!state || !state.teams) return null;
    return Object.keys(state.teams).find(id => String(state.teams[id].pin) === String(pin)) || null;
  }

  // Transacción: valida turno + disponibilidad, añade el pick, avanza el índice.
  function submitPick(teamId, brawlerId) {
    return db.ref(STATE_PATH).transaction(state => {
      if (!state) return state;
      if (state.status !== 'drafting') return state;
      if (state.currentPickIndex >= TOTAL_PICKS) return state;
      const turnTeam = state.draftOrder[state.currentPickIndex % TEAMS_PER_DRAFT];
      if (turnTeam !== teamId) return; // aborta la transacción (no es su turno)
      if (state.pickedBrawlers && state.pickedBrawlers[brawlerId]) return; // ya elegido

      state.pickedBrawlers = state.pickedBrawlers || {};
      state.pickedBrawlers[brawlerId] = teamId;
      state.currentPickIndex += 1;
      if (state.currentPickIndex >= TOTAL_PICKS) state.status = 'complete';
      return state;
    });
  }

  function renderPool(container, brawlers, state, opts) {
    opts = opts || {};
    const picked = (state && state.pickedBrawlers) || {};
    const teams = (state && state.teams) || {};
    const turnTeamId = currentTurnTeamId(state);
    const canPick = opts.myTeamId && opts.myTeamId === turnTeamId && teamPickCount(state, opts.myTeamId) < PICKS_PER_TEAM;

    container.innerHTML = '';
    brawlers.forEach(b => {
      const takenBy = picked[b.id];
      const card = document.createElement('div');
      card.className = 'brawler-card' + (takenBy ? ' taken' : '');
      card.title = b.name;
      card.innerHTML = `
        <img src="${b.icon}" alt="${b.name}" loading="lazy" referrerpolicy="no-referrer">
        ${takenBy && teams[takenBy] ? `<span class="taken-badge" title="${teams[takenBy].name}">${teams[takenBy].name.slice(0,2).toUpperCase()}</span>` : ''}
      `;
      if (!takenBy && canPick && opts.onPick) {
        card.addEventListener('click', () => opts.onPick(b.id));
      }
      container.appendChild(card);
    });
  }

  function renderTeams(container, state, brawlersById, opts) {
    opts = opts || {};
    const teams = (state && state.teams) || {};
    const order = (state && state.draftOrder) || Object.keys(teams);
    const turnTeamId = currentTurnTeamId(state);

    container.innerHTML = '';
    order.forEach(teamId => {
      const team = teams[teamId];
      if (!team) return;
      const picks = picksForTeam(state, teamId);
      const el = document.createElement('div');
      el.className = 'team-card' + (teamId === turnTeamId ? ' active-turn' : '');
      const picksHtml = Array.from({ length: PICKS_PER_TEAM }).map((_, i) => {
        const brawlerId = picks[i];
        if (!brawlerId) return '<span class="empty-slot"></span>';
        const b = brawlersById[brawlerId];
        return `<img src="${b ? b.icon : ''}" alt="${b ? b.name : brawlerId}" title="${b ? b.name : brawlerId}" referrerpolicy="no-referrer">`;
      }).join('');
      const miembros = Array.isArray(team.miembros) ? team.miembros : [];
      const miembrosHtml = miembros.length ? `
        <ul class="t-members">
          ${miembros.map((m, mIdx) => `
            <li>
              <button type="button" class="m-name" data-team="${teamId}" data-member="${mIdx}">${m.nombre || ''}</button>
              <span class="m-score">Puntuación: ${calcMemberScore(m)}</span>
            </li>`).join('')}
        </ul>` : '';
      el.innerHTML = `
        <div class="t-head">
          ${team.logoUrl ? `<img src="${team.logoUrl}" alt="${team.name}">` : ''}
          <span class="t-name">${team.name}</span>
          <span class="t-score">Puntuación: ${calcTeamScore(team)}</span>
        </div>
        ${miembrosHtml}
        <div class="t-picks">${picksHtml}</div>
      `;
      container.appendChild(el);
    });

    if (opts.onMemberClick) {
      container.querySelectorAll('.m-name[data-member]').forEach(btn => {
        btn.addEventListener('click', () => {
          const team = teams[btn.dataset.team];
          const member = team && Array.isArray(team.miembros) ? team.miembros[+btn.dataset.member] : null;
          if (member) opts.onMemberClick(member, team);
        });
      });
    }
  }

  return {
    TEAMS_PER_DRAFT, PICKS_PER_TEAM, TOTAL_PICKS,
    loadBrawlers, subscribeState, signInAnon,
    currentTurnTeamId, currentRound, isComplete, teamPickCount, picksForTeam,
    claimTeam, findTeamByPin, submitPick,
    renderPool, renderTeams,
    fetchPlayerStats, calcMemberScore, calcTeamScore,
  };
})();
