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

  function renderTeams(container, state, brawlersById) {
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
      el.innerHTML = `
        <div class="t-head">
          ${team.logoUrl ? `<img src="${team.logoUrl}" alt="${team.name}">` : ''}
          <span class="t-name">${team.name}</span>
        </div>
        <div class="t-picks">${picksHtml}</div>
      `;
      container.appendChild(el);
    });
  }

  return {
    TEAMS_PER_DRAFT, PICKS_PER_TEAM, TOTAL_PICKS,
    loadBrawlers, subscribeState, signInAnon,
    currentTurnTeamId, currentRound, isComplete, teamPickCount, picksForTeam,
    claimTeam, findTeamByPin, submitPick,
    renderPool, renderTeams,
  };
})();
