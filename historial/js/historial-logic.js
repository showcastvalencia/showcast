/*
  HISTORIAL DE PARTIDAS — lógica de cruce Challonge + Brawl Stars
  ==================================================================
  Implementación del algoritmo descrito en CHALLONGE-API.md sección 13.
  Se usa desde admin.html al pulsar "Actualizar historial de partidas"
  (nunca automático/polling, ver sección 11 del mismo documento).

  El emparejamiento automático es una heurística, no puede ser perfecto:
  no hay ningún campo en la API de Brawl Stars que diga "esta batalla es
  el partido X de Challonge". Se empareja por sala amistosa + que
  coincidan TODOS los tags vinculados de cada equipo — sin ventana de
  tiempo, porque acotar por minutos era un número mágico frágil que no
  evitaba los falsos positivos reales (entrenos, revanchas con los
  mismos jugadores). Para esos casos existe la pantalla "Reajudicar
  partidos" del admin, pensada para corregir a mano lo que el automático
  no pueda distinguir.
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

  // Perfil de un jugador (icono, trofeos, prestigio...) — usado por el
  // visor de perfil al pulsar un jugador en la pantalla pública.
  function fetchPlayer(tag) {
    const cleanTag = normalizeTag(tag);
    if (!cleanTag) return Promise.reject(new Error('Tag vacío.'));
    return fetch(BRAWL_PROXY + '?tag=' + encodeURIComponent(cleanTag))
      .then(r => r.json())
      .then(body => {
        if (!body.ok) throw new Error(body.error || 'No se ha podido comprobar la cuenta.');
        return body;
      });
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

  function countKnownTags(team, knownTags) {
    const known = new Set((knownTags || []).map(normalizeTag));
    return (team || []).filter(p => known.has(normalizeTag(p.tag))).length;
  }

  // Deben coincidir TODOS los tags vinculados de cada equipo (no solo
  // algunos) en el lado correspondiente. Un equipo sin ningún tag vinculado
  // nunca puede dar positivo — no hay nada que comprobar.
  // En "modo de prueba" (laxo=true) basta con que aparezca 1 tag conocido
  // por lado — para poder probar el cruce sin depender de un modo de juego
  // concreto (Duelo, sala 3v3 con bots...) ni de tener todos los miembros
  // vinculados.
  function battleMatchesTeams(battle, tagsA, tagsB, laxo) {
    if (!tagsA.length || !tagsB.length) return null;
    const teams = filterRealPlayers(battle.teams);
    if (teams.length !== 2) return null;
    const [t1, t2] = teams;
    const reqA = laxo ? 1 : tagsA.length;
    const reqB = laxo ? 1 : tagsB.length;
    if (countKnownTags(t1, tagsA) >= reqA && countKnownTags(t2, tagsB) >= reqB) {
      return { equipoA: t1, equipoB: t2 };
    }
    if (countKnownTags(t2, tagsA) >= reqA && countKnownTags(t1, tagsB) >= reqB) {
      return { equipoA: t2, equipoB: t1 };
    }
    return null;
  }

  // La API v2.1 real no expone player1_id/player2_id/scores_csv (esos son
  // nombres heredados de v1 que aparecían en la documentación) — los partidos
  // llevan un array points_by_participant: [{participant_id, scores}, ...],
  // y la fecha de actualización va anidada en timestamps.updated_at.
  function matchParticipantIds(match) {
    if (match.player1_id != null && match.player2_id != null) {
      return [match.player1_id, match.player2_id];
    }
    const points = match.points_by_participant || [];
    return [points[0] && points[0].participant_id, points[1] && points[1].participant_id];
  }

  function matchUpdatedAt(match) {
    return match.updated_at || (match.timestamps && match.timestamps.updated_at) || null;
  }

  // battle.result ("victory"/"defeat"/"draw") es la perspectiva del jugador
  // cuyo battlelog se consultó (battle.perspectivaTag, añadido al recoger
  // las candidatas) — no dice directamente si ganó "equipoA" o "equipoB".
  // Hay que traducirlo mirando en qué lado estaba ese tag.
  function resultadoJuego(battle, sides) {
    const perspectiva = normalizeTag(battle.perspectivaTag);
    if (!battle.result || !perspectiva) return null;
    const enA = sides.equipoA.some(p => normalizeTag(p.tag) === perspectiva);
    const enB = sides.equipoB.some(p => normalizeTag(p.tag) === perspectiva);
    if (!enA && !enB) return null;
    if (battle.result === 'draw') return 'empate';
    if (battle.result === 'victory') return enA ? 'equipoA' : 'equipoB';
    if (battle.result === 'defeat') return enA ? 'equipoB' : 'equipoA';
    return null;
  }

  // Convierte una batalla del battlelog + a qué lado pertenece cada equipo
  // en un "juego" tal como se guarda en Firebase (§14 de CHALLONGE-API.md).
  function battleToJuego(battle, sides, orden) {
    return {
      orden,
      battleTime: battle.battleTime,
      modo: battle.mode || '',
      mapa: battle.map || '',
      duracion: battle.duration || null,
      ganador: resultadoJuego(battle, sides),
      picksEquipoA: sides.equipoA.map(p => ({ jugador: p.name, brawler: p.brawler, tag: p.tag || '' })),
      picksEquipoB: sides.equipoB.map(p => ({ jugador: p.name, brawler: p.brawler, tag: p.tag || '' })),
    };
  }

  function correlateMatch(match, participantsById, tagsByParticipant, battlelogsByTag, debugLines, laxo) {
    const [pAId, pBId] = matchParticipantIds(match);
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
        // Qué tag trajo esta entrada — hace falta para traducir battle.result
        // (perspectiva de ESE jugador) a "ganó equipoA/equipoB" en battleToJuego.
        candidatas.push(Object.assign({}, b, { perspectivaTag: tag }));
      });
    });

    if (debugLines) {
      debugLines.push(`Partido ${match.id} (${equipoA.nombre} vs ${equipoB.nombre}): ${candidatas.length} batalla(s) en el battlelog de los tags vinculados.`);
      candidatas.forEach(b => {
        if (!laxo && b.type !== 'friendly') {
          debugLines.push(`  · ${b.battleTime}: descartada, tipo="${b.type}" (se necesita "friendly")`);
          return;
        }
        const sides = battleMatchesTeams(b, tagsA, tagsB, laxo);
        if (sides) {
          debugLines.push(`  · ${b.battleTime}: ✓ coincide (tipo=${b.type}, mapa ${b.map}, modo ${b.mode})`);
        } else {
          const teams = filterRealPlayers(b.teams);
          const detalle = teams.map((t, i) => `lado ${i + 1}: ${countKnownTags(t, tagsA)}/${tagsA.length} tag(s) de ${equipoA.nombre}, ${countKnownTags(t, tagsB)}/${tagsB.length} de ${equipoB.nombre}`).join(' / ');
          debugLines.push(`  · ${b.battleTime}: descartada, no coinciden tags (${detalle || 'sin datos de equipos (formato de partida distinto, ej. Duelo)'})`);
        }
      });
    }

    const emparejadas = candidatas
      .filter(b => laxo || b.type === 'friendly')
      .map(b => ({ battle: b, sides: battleMatchesTeams(b, tagsA, tagsB, laxo) }))
      .filter(x => x.sides)
      .sort((a, b) => parseBattleTime(a.battle.battleTime) - parseBattleTime(b.battle.battleTime));

    const juegos = emparejadas.map((x, idx) => battleToJuego(x.battle, x.sides, idx + 1));

    let ganador = null;
    if (match.winner_id === pAId) ganador = pAId;
    else if (match.winner_id === pBId) ganador = pBId;

    return {
      challongeMatchId: match.id,
      ronda: match.round || null,
      equipoA,
      equipoB,
      resultadoChallonge: { scoresCsv: match.scores || match.scores_csv || '', ganador },
      juegos,
    };
  }

  // Orquesta todo el flujo de un clic en "Actualizar historial de partidas".
  // participantesTags: { [participantId]: ["#TAG1","#TAG2","#TAG3"] }
  // opciones: { ignorarProcesados, debug, laxo } — "Modo de prueba" en el
  // admin activa las tres: reprocesa partidos ya guardados, muestra por qué
  // cada batalla encajó o no, y (laxo) ignora el tipo de sala y exige solo 1
  // tag conocido por lado en vez de todos — para poder probar el cruce con
  // cualquier modo de juego (ranked, Duelo...) sin depender de montar una
  // sala amistosa con la composición exacta del torneo.
  function actualizarHistorial(torneoSlug, challongeTournamentId, participantesTags, opciones) {
    opciones = opciones || {};
    const debugLines = opciones.debug ? [] : null;
    const laxo = !!opciones.laxo;

    return fetchTournament(challongeTournamentId).then(body => {
      const participantsById = {};
      (body.participants || []).forEach(p => { participantsById[p.id] = p; });

      return db.ref('historial/' + torneoSlug + '/procesados').once('value').then(snap => {
        const procesados = opciones.ignorarProcesados ? {} : (snap.val() || {});
        const nuevos = (body.matches || []).filter(m => m.state === 'complete' && !procesados[m.id]);

        if (!nuevos.length) {
          return { procesados: 0, total: (body.matches || []).length, debugLines };
        }

        const tagsNeeded = new Set();
        nuevos.forEach(m => {
          const [pAId, pBId] = matchParticipantIds(m);
          (participantesTags[pAId] || []).forEach(t => tagsNeeded.add(normalizeTag(t)));
          (participantesTags[pBId] || []).forEach(t => tagsNeeded.add(normalizeTag(t)));
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
              const resultado = correlateMatch(m, participantsById, participantesTags, battlelogs, debugLines, laxo);
              updates['historial/' + torneoSlug + '/matches/' + m.id] = resultado;
              updates['historial/' + torneoSlug + '/procesados/' + m.id] = true;
            });
            updates['historial/' + torneoSlug + '/meta'] = {
              challongeTournamentId,
              nombre: body.tournament.name || '',
              actualizadoEn: new Date().toISOString(),
            };
            return db.ref().update(updates).then(() => ({ procesados: nuevos.length, total: (body.matches || []).length, debugLines }));
          });
      });
    });
  }

  return {
    fetchTournament, fetchBattlelog, fetchPlayer, actualizarHistorial, normalizeTag,
    // Expuestas para la pantalla de reajudicación manual (admin.html):
    filterRealPlayers, isBot, parseBattleTime, battleToJuego,
  };
})();
