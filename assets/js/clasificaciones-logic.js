/*
  CLASIFICACIONES — lógica de cruce Challonge + Brawl Stars
  ==========================================================
  Fusión de lo que antes eran dos sistemas separados (tabla/bracket de
  #clasificaciones en index.html, alimentada solo por Challonge, y el
  subsistema historial/ que cruzaba Challonge con el battlelog de Brawl
  Stars). Ver ARQUITECTURA.md §14 y CHALLONGE-API.md.

  Se usa desde:
  - index.html (solo las funciones de lectura: fetchTournament, fetchPlayer,
    computeStandings, agrupación por fase — nunca escribe nada).
  - admin.html (todo lo anterior más actualizarHistorial, para el panel de
    vinculación de equipos/tags y el botón "Actualizar historial de
    partidos" — necesita `db`/`auth` de Firebase ya inicializados).

  El torneo es SIEMPRE uno de Challonge con "two-stage" activado (fase de
  grupos + fase final) — el nodo de Firebase se indexa directamente por el
  id/slug del torneo de Challonge (torneoId), sin ningún identificador local
  aparte (a diferencia del viejo historial/, que usaba un "slug" propio).
*/
const CD = (function () {
  const content = window.SHOWCAST_CONTENT || {};
  const BRAWL_PROXY = content.brawlProxyEndpoint || 'proxy/brawlstars.php';
  const CHALLONGE_PROXY = content.challongeProxyEndpoint || 'proxy/challonge.php';

  function normalizeTag(tag) {
    return String(tag || '').toUpperCase().replace('#', '').trim();
  }

  /*
    Escapa texto antes de meterlo en una plantilla que se asigna con
    .innerHTML. OBLIGATORIO para cualquier dato que no controlemos nosotros:

    - Nombres de jugador de Brawl Stars: los elige libremente cualquier
      persona del mundo en su cuenta de Supercell, y llegan aquí tal cual
      desde el battlelog (proxy/brawlstars.php no los sanea).
    - Nombres de equipo/participante de Challonge.
    - Nombres y tags escritos a mano en admin.html y guardados en Firebase.

    Sin esto, un nombre como <img src=x onerror=...> se ejecuta en el
    navegador de cualquier visitante de #clasificaciones — y, peor, en la
    sesión de admin.html, que tiene el token de GitHub en localStorage y
    permiso de escritura en Firebase.

    Escapa también " y ' para poder usarse dentro de atributos (data-tag,
    value...), no solo entre etiquetas.
  */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
  // visor de perfil al pulsar un jugador en la tabla/bracket público.
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
  // algunos) en el lado correspondiente, salvo en "modo de prueba" (laxo),
  // donde basta con que aparezca 1 tag conocido por lado.
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

  // La API v2.1 real no expone player1_id/player2_id/scores_csv — los
  // partidos llevan un array points_by_participant: [{participant_id,
  // scores}, ...], y la fecha de actualización va anidada en
  // timestamps.updated_at.
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

  // Torneo de dos fases: comprobado contra un torneo real (CHALLONGE-API.md
  // §9 asumía que el PARTIDO llevaría un group_id asociado — no es así, la
  // API v2.1 real no expone ningún group_id en el objeto de partido). Lo que
  // sí lleva group_id es el PARTICIPANTE, así que un partido se considera de
  // fase de grupos si sus dos participantes tienen group_id asignado.
  function isGroupStageMatch(match, participantsById) {
    const [aId, bId] = matchParticipantIds(match);
    const a = participantsById[aId], b = participantsById[bId];
    return !!(a && a.group_id != null) && !!(b && b.group_id != null);
  }

  // battle.result ("victory"/"defeat"/"draw") es la perspectiva del jugador
  // cuyo battlelog se consultó (battle.perspectivaTag) — no dice
  // directamente si ganó "equipoA" o "equipoB". Hay que traducirlo mirando
  // en qué lado estaba ese tag.
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
  // en un "juego" tal como se guarda en Firebase.
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
      esFaseDeGrupos: isGroupStageMatch(match, participantsById),
      equipoA,
      equipoB,
      resultadoChallonge: { scoresCsv: match.scores || match.scores_csv || '', ganador },
      juegos,
    };
  }

  // ---------- Tabla de posiciones de la fase de grupos ----------
  // No replica el algoritmo exacto de Challonge (con sus desempates propios,
  // p.ej. Buchholz) — es un cálculo propio y suficiente para mostrar una
  // clasificación real: victorias, derrotas, empates y diferencia de sets,
  // ordenado por victorias y luego por diferencia de sets.
  function parseSetsDiff(scoresCsv) {
    let a = 0, b = 0;
    String(scoresCsv || '').split(',').forEach(s => {
      const parts = s.trim().split('-').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        if (parts[0] > parts[1]) a++; else if (parts[1] > parts[0]) b++;
      }
    });
    return [a, b];
  }

  function computeStandings(matches, participantsById) {
    const stats = {};
    function blank(id) { return { id, pj: 0, v: 0, d: 0, e: 0, setsF: 0, setsC: 0 }; }

    (matches || []).forEach(m => {
      if (!isGroupStageMatch(m, participantsById) || m.state !== 'complete') return;
      const [aId, bId] = matchParticipantIds(m);
      if (aId == null || bId == null) return;
      stats[aId] = stats[aId] || blank(aId);
      stats[bId] = stats[bId] || blank(bId);
      stats[aId].pj++; stats[bId].pj++;

      const [setsA, setsB] = parseSetsDiff(m.scores || m.scores_csv);
      stats[aId].setsF += setsA; stats[aId].setsC += setsB;
      stats[bId].setsF += setsB; stats[bId].setsC += setsA;

      if (m.winner_id === aId) { stats[aId].v++; stats[bId].d++; }
      else if (m.winner_id === bId) { stats[bId].v++; stats[aId].d++; }
      else { stats[aId].e++; stats[bId].e++; }
    });

    return Object.values(stats)
      .map(s => Object.assign({}, s, {
        nombre: (participantsById[s.id] || {}).name || ('Participante ' + s.id),
        setsDiff: s.setsF - s.setsC,
      }))
      .sort((a, b) => b.v - a.v || b.setsDiff - a.setsDiff || a.nombre.localeCompare(b.nombre));
  }

  // Orquesta todo el flujo de un clic en "Actualizar historial de
  // partidos" (admin.html). participantesTags: { [participantId]:
  // ["#TAG1","#TAG2","#TAG3"] }. opciones: { ignorarProcesados, debug, laxo }
  // — "Modo de prueba" en el admin activa las tres.
  function actualizarHistorial(torneoId, participantesTags, opciones) {
    opciones = opciones || {};
    const debugLines = opciones.debug ? [] : null;
    const laxo = !!opciones.laxo;

    return fetchTournament(torneoId).then(body => {
      const participantsById = {};
      (body.participants || []).forEach(p => { participantsById[p.id] = p; });

      return db.ref('clasificaciones/' + torneoId + '/procesados').once('value').then(snap => {
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
        // no acercarse al límite por segundo de la clave — CHALLONGE-API.md §16b.
        const tagList = Array.from(tagsNeeded).filter(Boolean);
        const battlelogs = {};
        return tagList
          .reduce((chain, tag) => chain.then(() => fetchBattlelog(tag)).then(items => { battlelogs[tag] = items; }), Promise.resolve())
          .then(() => {
            const updates = {};
            nuevos.forEach(m => {
              const resultado = correlateMatch(m, participantsById, participantesTags, battlelogs, debugLines, laxo);
              updates['clasificaciones/' + torneoId + '/matches/' + m.id] = resultado;
              updates['clasificaciones/' + torneoId + '/procesados/' + m.id] = true;
            });
            updates['clasificaciones/' + torneoId + '/meta'] = {
              nombre: body.tournament.name || '',
              actualizadoEn: new Date().toISOString(),
            };
            return db.ref().update(updates).then(() => ({ procesados: nuevos.length, total: (body.matches || []).length, debugLines }));
          });
      });
    });
  }

  return {
    fetchTournament, fetchBattlelog, fetchPlayer, actualizarHistorial, normalizeTag, escapeHtml,
    matchParticipantIds, matchUpdatedAt, isGroupStageMatch, computeStandings,
    // Expuestas para la pantalla de reajudicación manual (admin.html):
    filterRealPlayers, isBot, parseBattleTime, battleToJuego,
  };
})();
