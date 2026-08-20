/*
  HISTORIAL DE PARTIDAS — lógica de cruce Challonge + Brawl Stars
  ==================================================================
  Implementación del algoritmo descrito en CHALLONGE-API.md sección 13.
  Se usa desde admin.html al pulsar "Actualizar historial de partidas"
  (nunca automático/polling, ver sección 11 del mismo documento).
*/
const HD = (function () {
  // El proxy PHP no vive en GitHub Pages (que no ejecuta PHP) sino en la VM
  // aparte que ya usa el resto de la web — las URLs vienen de content.js,
  // igual que brawlProxyEndpoint en index.html (ver ARQUITECTURA.md §8).
  const content = window.SHOWCAST_CONTENT || {};
  const BRAWL_PROXY = content.brawlProxyEndpoint || '../proxy/brawlstars.php';
  const CHALLONGE_PROXY = content.challongeProxyEndpoint || '../proxy/challonge.php';

  function normalizeTag(tag) {
    return String(tag || '').toUpperCase().replace('#', '').trim();
  }

  function fetchTournament(tournamentId) {
    return fetch(CHALLONGE_PROXY + '?tournament=' + encodeURIComponent(tournamentId))
      .then(r => r.json())
      .then(body => {
        if (!body.ok) throw new Error(body.error || 'Error al leer el torneo de Challonge.');
        return body;
      });
  }

  function fetchBattlelog(tag) {
    const cleanTag = normalizeTag(tag);
    if (!cleanTag) return Promise.resolve([]);
    return fetch(BRAWL_PROXY + '?tag=' + encodeURIComponent(cleanTag) + '&battlelog=1')
      .then(r => r.json())
      .then(body => (body.ok ? (body.items || []) : []));
  }

  // "Bot N" con un tag corto (3-4 caracteres) es el patrón de los bots que
  // rellenan huecos en salas amistosas — ver CHALLONGE-API.md §12.
  function isBot(player) {
    return /^Bot \d+$/.test(player.name || '') || normalizeTag(player.tag).length <= 4;
  }

  function filterRealPlayers(teams) {
    return (teams || []).map(team => (team || []).filter(p => !isBot(p)));
  }

  // "20260819T170334.000Z" -> Date
  function parseBattleTime(iso) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(iso || '');
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  }

  function withinWindow(battleTimeIso, centerDate, windowMinutes) {
    const t = parseBattleTime(battleTimeIso);
    if (!t) return false;
    return Math.abs(t.getTime() - centerDate.getTime()) <= windowMinutes * 60 * 1000;
  }

  function countKnownTags(team, knownTags) {
    const known = new Set((knownTags || []).map(normalizeTag));
    return (team || []).filter(p => known.has(normalizeTag(p.tag))).length;
  }

  // Al menos 2 de los 3 tags conocidos de cada equipo deben aparecer en el
  // lado correspondiente — ver CHALLONGE-API.md §13 paso 7.
  function battleMatchesTeams(battle, tagsA, tagsB, minMatches) {
    minMatches = minMatches || 2;
    const teams = filterRealPlayers(battle.teams);
    if (teams.length !== 2) return null;
    const [t1, t2] = teams;
    if (countKnownTags(t1, tagsA) >= minMatches && countKnownTags(t2, tagsB) >= minMatches) {
      return { equipoA: t1, equipoB: t2 };
    }
    if (countKnownTags(t2, tagsA) >= minMatches && countKnownTags(t1, tagsB) >= minMatches) {
      return { equipoA: t2, equipoB: t1 };
    }
    return null;
  }

  function correlateMatch(match, participantsById, tagsByParticipant, battlelogsByTag, windowMinutes) {
    const pAId = match.player1_id;
    const pBId = match.player2_id;
    const equipoA = { participantId: pAId, nombre: (participantsById[pAId] || {}).name || ('Participante ' + pAId) };
    const equipoB = { participantId: pBId, nombre: (participantsById[pBId] || {}).name || ('Participante ' + pBId) };
    const tagsA = tagsByParticipant[pAId] || [];
    const tagsB = tagsByParticipant[pBId] || [];

    const candidatas = [];
    const vistas = new Set();
    [...tagsA, ...tagsB].forEach(tag => {
      (battlelogsByTag[normalizeTag(tag)] || []).forEach(b => {
        const key = b.battleTime + '|' + JSON.stringify(b.teams);
        if (vistas.has(key)) return;
        vistas.add(key);
        candidatas.push(b);
      });
    });

    const centro = match.updated_at ? new Date(match.updated_at) : new Date();
    const enVentana = candidatas.filter(b => withinWindow(b.battleTime, centro, windowMinutes));
    const emparejadas = enVentana
      .filter(b => b.type === 'friendly')
      .map(b => ({ battle: b, sides: battleMatchesTeams(b, tagsA, tagsB) }))
      .filter(x => x.sides)
      .sort((a, b) => parseBattleTime(a.battle.battleTime) - parseBattleTime(b.battle.battleTime));

    const juegos = emparejadas.map((x, idx) => ({
      orden: idx + 1,
      battleTime: x.battle.battleTime,
      modo: x.battle.mode || '',
      mapa: x.battle.map || '',
      duracion: x.battle.duration || null,
      picksEquipoA: x.sides.equipoA.map(p => ({ jugador: p.name, brawler: p.brawler })),
      picksEquipoB: x.sides.equipoB.map(p => ({ jugador: p.name, brawler: p.brawler })),
    }));

    let ganador = null;
    if (match.winner_id === pAId) ganador = pAId;
    else if (match.winner_id === pBId) ganador = pBId;

    return {
      challongeMatchId: match.id,
      ronda: match.round || null,
      equipoA,
      equipoB,
      resultadoChallonge: { scoresCsv: match.scores_csv || '', ganador },
      juegos,
    };
  }

  // Orquesta todo el flujo de un clic en "Actualizar historial de partidas".
  // participantesTags: { [participantId]: ["#TAG1","#TAG2","#TAG3"] }
  function actualizarHistorial(torneoSlug, challongeTournamentId, participantesTags, windowMinutes) {
    windowMinutes = windowMinutes || 30;
    return fetchTournament(challongeTournamentId).then(body => {
      const participantsById = {};
      (body.participants || []).forEach(p => { participantsById[p.id] = p; });

      return db.ref('historial/' + torneoSlug + '/procesados').once('value').then(snap => {
        const procesados = snap.val() || {};
        const nuevos = (body.matches || []).filter(m => m.state === 'complete' && !procesados[m.id]);

        if (!nuevos.length) {
          return { procesados: 0, total: (body.matches || []).length };
        }

        const tagsNeeded = new Set();
        nuevos.forEach(m => {
          (participantesTags[m.player1_id] || []).forEach(t => tagsNeeded.add(normalizeTag(t)));
          (participantesTags[m.player2_id] || []).forEach(t => tagsNeeded.add(normalizeTag(t)));
        });

        // Peticiones al proxy de Brawl Stars EN SERIE (no en paralelo), para
        // no acercarse al límite por segundo de la clave — ver CHALLONGE-API.md §16b.
        const tagList = Array.from(tagsNeeded).filter(Boolean);
        const battlelogs = {};
        return tagList
          .reduce((chain, tag) => chain.then(() => fetchBattlelog(tag)).then(items => { battlelogs[tag] = items; }), Promise.resolve())
          .then(() => {
            const updates = {};
            nuevos.forEach(m => {
              const resultado = correlateMatch(m, participantsById, participantesTags, battlelogs, windowMinutes);
              updates['historial/' + torneoSlug + '/matches/' + m.id] = resultado;
              updates['historial/' + torneoSlug + '/procesados/' + m.id] = true;
            });
            updates['historial/' + torneoSlug + '/meta'] = {
              challongeTournamentId,
              nombre: body.tournament.name || '',
              actualizadoEn: new Date().toISOString(),
            };
            return db.ref().update(updates).then(() => ({ procesados: nuevos.length, total: (body.matches || []).length }));
          });
      });
    });
  }

  return { fetchTournament, fetchBattlelog, actualizarHistorial, normalizeTag };
})();
