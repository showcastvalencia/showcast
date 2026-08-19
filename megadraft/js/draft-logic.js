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

  // Media, no suma: con el 4º miembro opcional, sumar dejaría a los equipos
  // de 4 con una puntuación de equipo inflada solo por tener uno más,
  // sin que eso refleje mejor nivel real.
  function calcTeamScore(team) {
    const miembros = (team && Array.isArray(team.miembros)) ? team.miembros : [];
    if (!miembros.length) return 0;
    const total = miembros.reduce((sum, m) => sum + calcMemberScore(m), 0);
    return Math.round(total / miembros.length);
  }

  // Abrevia números grandes para sitios con poco espacio (217000 -> "217K",
  // 89700 -> "89.7K", 2180000 -> "2.18M") — siempre ~3 cifras significativas.
  function formatScore(n) {
    n = Math.round(n || 0);
    if (n < 1000) return String(n);
    const abbreviate = (value, suffix) => {
      if (value >= 100) return Math.round(value) + suffix;
      if (value >= 10) return value.toFixed(1) + suffix;
      return value.toFixed(2) + suffix;
    };
    if (n < 1e6) return abbreviate(n / 1000, 'K');
    return abbreviate(n / 1e6, 'M');
  }

  // ---------- CRONÓMETROS ----------
  const DEFAULT_PREP_SECONDS = 60;
  const DEFAULT_PICK_SECONDS = 15;

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds || 0));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  // Los cronómetros no dependen de un "tick" guardado en Firebase (sería
  // carísimo en escrituras): solo se guarda cuándo empezaron a correr
  // (startedAt, hora del servidor) y cuánto quedaba en ese momento
  // (remaining). Cada pantalla calcula el tiempo restante en local con un
  // setInterval propio, todas a partir del mismo dato — así no hace falta
  // sincronizar nada salvo iniciar/pausar.
  function timerRemaining(timer) {
    if (!timer) return 0;
    if (timer.running && timer.startedAt) {
      const elapsed = (Date.now() - timer.startedAt) / 1000;
      return Math.max(0, (timer.remaining || 0) - elapsed);
    }
    return timer.remaining || 0;
  }

  function startTimer(path, timer) {
    const remaining = timerRemaining(timer);
    return db.ref(path).update({
      running: true,
      remaining: remaining,
      startedAt: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  function pauseTimer(path, timer) {
    const remaining = timerRemaining(timer);
    return db.ref(path).update({
      running: false,
      remaining: remaining,
      startedAt: null,
    });
  }

  // update() (no set()): en el cronómetro de elección, "path" apunta a un
  // objeto que también guarda perTeam/currentTeamId — con set() se borrarían.
  function resetTimer(path, duration) {
    return db.ref(path).update({
      duration: duration,
      remaining: duration,
      running: false,
      startedAt: null,
    });
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
    if (state.draftPhase === 'prep') return null; // nadie elige todavía
    if (state.currentPickIndex >= TOTAL_PICKS) return null;
    return state.draftOrder[state.currentPickIndex % TEAMS_PER_DRAFT];
  }

  function isPrepPhase(state) {
    return !!state && state.status === 'drafting' && state.draftPhase === 'prep';
  }

  // Cualquier pantalla conectada (todas, sin coordinarse entre ellas) llama a
  // esto en su propio setInterval de refresco de cronómetros. Es seguro
  // llamarla en bucle desde varios sitios a la vez: en cuanto el primer
  // cliente escribe el cambio, el resto ve por el 'value' de Firebase que
  // draftPhase ya no es 'prep' y deja de intentarlo — no hace falta ningún
  // servidor ni Cloud Function para esta transición automática.
  function maybeAdvancePrepPhase(state) {
    if (!isPrepPhase(state)) return;
    const prep = state.timers && state.timers.prep;
    if (!prep || !prep.running || timerRemaining(prep) > 0) return;
    if (!state.draftOrder || !state.draftOrder.length) return;

    const firstTeamId = state.draftOrder[0];
    const perTeam = (state.timers.pick && state.timers.pick.perTeam) || {};
    const duration = perTeam[firstTeamId] || DEFAULT_PICK_SECONDS;
    db.ref(STATE_PATH).update({
      draftPhase: 'picking',
      'timers/prep/running': false,
      'timers/pick': {
        perTeam: perTeam, currentTeamId: firstTeamId,
        duration: duration, remaining: duration,
        running: true, startedAt: firebase.database.ServerValue.TIMESTAMP,
      },
    });
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

  // IMPORTANTE: NO se puede hacer transaction() sobre todo "megadraft" (como
  // antes) en cuanto hay más de un equipo reclamado por dispositivos
  // distintos: al reescribir el nodo entero, Firebase revalida las reglas de
  // CADA equipo (incluido su claimedBy), y como el uid del que hace el pick
  // no coincide con el claimedBy de los OTROS equipos, la escritura entera
  // se rechaza con permission_denied — aunque esos campos no cambien de
  // valor. Por eso aquí se valida con una lectura previa y solo se escribe,
  // de forma atómica, el contador (transaction) y luego, con update() y
  // rutas concretas (igual que hace admin.html), el resto — así nunca se
  // toca "teams" y sus reglas por equipo.
  function submitPick(teamId, brawlerId) {
    return db.ref(STATE_PATH).once('value').then(snap => {
      const state = snap.val();
      if (!state) throw new Error('La sala no tiene datos todavía.');
      if (state.status !== 'drafting') throw new Error('El draft no está en marcha.');
      if (state.currentPickIndex >= TOTAL_PICKS) throw new Error('El draft ya ha terminado.');
      const turnTeam = state.draftOrder[state.currentPickIndex % TEAMS_PER_DRAFT];
      if (turnTeam !== teamId) throw new Error('No es tu turno.');
      if (state.pickedBrawlers && state.pickedBrawlers[brawlerId]) throw new Error('Ese personaje ya está elegido.');

      const expectedIndex = state.currentPickIndex;
      return db.ref(`${STATE_PATH}/currentPickIndex`).transaction(idx => {
        if (idx !== expectedIndex) return; // alguien se ha adelantado: aborta
        return idx + 1;
      }).then(result => {
        if (!result.committed) throw new Error('Alguien se ha adelantado. Vuelve a intentarlo.');
        const newIndex = result.snapshot.val();

        const updates = {};
        updates[`pickedBrawlers/${brawlerId}`] = teamId;

        // El cronómetro de elección se reinicia Y arranca solo al pasar de
        // turno, con la duración configurada para el equipo que entra — el
        // admin ya no tiene que pulsar "Iniciar" a mano en cada ronda.
        const perTeam = (state.timers && state.timers.pick && state.timers.pick.perTeam) || {};
        if (newIndex >= TOTAL_PICKS) {
          updates.status = 'complete';
          updates['timers/pick'] = { perTeam: perTeam, currentTeamId: null, duration: 0, remaining: 0, running: false, startedAt: null };
        } else {
          const nextTeamId = state.draftOrder[newIndex % TEAMS_PER_DRAFT];
          const duration = perTeam[nextTeamId] || DEFAULT_PICK_SECONDS;
          updates['timers/pick'] = {
            perTeam: perTeam, currentTeamId: nextTeamId,
            duration: duration, remaining: duration,
            running: true, startedAt: firebase.database.ServerValue.TIMESTAMP,
          };
        }

        return db.ref(STATE_PATH).update(updates);
      });
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
        <img src="${b.icon}" alt="${b.name}" loading="lazy" referrerpolicy="no-referrer" draggable="false">
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
    STATE_PATH, DEFAULT_PREP_SECONDS, DEFAULT_PICK_SECONDS,
    loadBrawlers, subscribeState, signInAnon,
    currentTurnTeamId, currentRound, isComplete, isPrepPhase, maybeAdvancePrepPhase,
    teamPickCount, picksForTeam,
    claimTeam, findTeamByPin, submitPick,
    renderPool, renderTeams,
    fetchPlayerStats, calcMemberScore, calcTeamScore, formatScore,
    formatTime, timerRemaining, startTimer, pauseTimer, resetTimer,
  };
})();
