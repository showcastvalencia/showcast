<?php
/*
  Proxy de la API de Brawl Stars
  ================================
  Llama a esta URL desde el navegador con ?tag=CODIGO (con o sin #):
    proxy/brawlstars.php?tag=8CG8LUJ

  Por qué existe este script y no se llama a la API directamente desde la web:
  - La API de Supercell exige una clave (API key) atada a una IP fija: exponerla
    en el JavaScript del navegador la dejaría visible para cualquiera.
  - Este script vive en el servidor (con IP fija) y hace la llamada real,
    devolviendo al navegador solo los datos que necesitamos.

  Configura tu clave en proxy/config.php antes de usar esto.

  Nota sobre "Ranked": la API oficial sí incluye el rango competitivo real
  (rankedRankName, rankedElo, highestSeasonRankedRankName,
  highestAllTimeRankedRankName, etc.) directamente en la respuesta del
  jugador. No hace falta calcularlo a partir de los trofeos.
*/

header('Content-Type: application/json; charset=utf-8');

/*
  Si la web y este proxy viven en el mismo dominio (lo normal), no hace falta
  tocar nada aquí. Si algún día llamas a este proxy desde otro dominio,
  añade ese dominio a la lista de abajo.
*/
$allowedOrigins = [
    'https://showcastvalencia.github.io',
    // 'https://www.showcast.es',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
}

require __DIR__ . '/config.php';

function fail(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

if (!defined('BRAWL_API_KEY') || BRAWL_API_KEY === '' || BRAWL_API_KEY === 'PON_AQUI_TU_API_KEY') {
    fail(500, 'El proxy no tiene configurada todavía la clave de la API de Brawl Stars (proxy/config.php).');
}

$tagRaw = $_GET['tag'] ?? '';
$tag = strtoupper(trim((string) $tagRaw));
$tag = str_replace(['#', ' '], '', $tag);
$tag = str_replace('O', '0', $tag); // error de tecleo muy común: letra O en vez de cero

if ($tag === '' || !preg_match('/^[0289PYLQGRJCUV]{3,15}$/', $tag)) {
    fail(400, 'Ese código de jugador no tiene un formato válido. Revisa que esté bien escrito (ej. #8CG8LUJ).');
}

$isBattlelog = isset($_GET['battlelog']);
$url = $isBattlelog
    ? 'https://api.brawlstars.com/v1/players/%23' . $tag . '/battlelog'
    : 'https://api.brawlstars.com/v1/players/%23' . $tag;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . BRAWL_API_KEY,
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    fail(502, 'No se ha podido contactar con la API de Brawl Stars. Inténtalo de nuevo en unos segundos.');
}

if ($httpCode === 404) {
    fail(404, 'No existe ningún jugador con ese código. Comprueba que esté bien escrito.');
}
if ($httpCode === 403) {
    fail(500, 'La API ha rechazado la clave: revisa que la IP de este servidor esté autorizada en developer.brawlstars.com.');
}
if ($httpCode === 429) {
    fail(429, 'Se han hecho demasiadas peticiones seguidas. Espera un momento y vuelve a intentarlo.');
}
if ($httpCode !== 200) {
    fail(502, 'La API de Brawl Stars ha devuelto un error inesperado (código ' . $httpCode . ').');
}

$data = json_decode((string) $response, true);
if (!is_array($data)) {
    fail(502, 'Respuesta inválida de la API de Brawl Stars.');
}

if ($isBattlelog) {
    // Historial de partidas (cruce con Challonge, ver CHALLONGE-API.md §12-13):
    // solo los campos que hacen falta para el cruce, nunca la respuesta cruda.
    //
    // Ojo: no todos los modos usan la misma forma. Los modos por equipos
    // (3v3, etc.) llevan battle.teams (array de equipos, cada uno un array
    // de jugadores). Duelo (1v1) es distinto: battle.players es una lista
    // plana de 2 jugadores, y cada uno lleva "brawlers" en PLURAL (puede
    // cambiar de personaje entre rondas) en vez de un solo "brawler".
    // Normalizamos ambas formas a la misma estructura "teams" de 2 lados
    // para que el resto del cruce no tenga que distinguir el modo.
    $items = array_map(function ($item) {
        $rawTeams = $item['battle']['teams'] ?? null;
        if ($rawTeams) {
            $teams = array_map(function ($team) {
                return array_map(function ($player) {
                    return [
                        'tag' => $player['tag'] ?? '',
                        'name' => $player['name'] ?? '',
                        'brawler' => $player['brawler']['name'] ?? '',
                    ];
                }, $team);
            }, $rawTeams);
        } else {
            // Duelo (u otro modo 1 contra 1 sin "teams"): cada jugador es su
            // propio "equipo" de un solo elemento.
            $teams = array_map(function ($player) {
                $brawlerNames = array_map(fn($b) => $b['name'] ?? '', $player['brawlers'] ?? []);
                return [[
                    'tag' => $player['tag'] ?? '',
                    'name' => $player['name'] ?? '',
                    'brawler' => implode('/', array_filter($brawlerNames)),
                ]];
            }, $item['battle']['players'] ?? []);
        }

        return [
            'battleTime' => $item['battleTime'] ?? '',
            'mode' => $item['battle']['mode'] ?? ($item['event']['mode'] ?? ''),
            'map' => $item['event']['map'] ?? '',
            'type' => $item['battle']['type'] ?? '',
            'result' => $item['battle']['result'] ?? '',
            'duration' => $item['battle']['duration'] ?? null,
            'teams' => $teams,
        ];
    }, $data['items'] ?? []);

    echo json_encode(['ok' => true, 'tag' => '#' . $tag, 'items' => $items]);
    exit;
}

echo json_encode([
    'ok' => true,
    'tag' => $data['tag'] ?? ('#' . $tag),
    'name' => $data['name'] ?? '',
    'iconId' => $data['icon']['id'] ?? null,
    'iconUrl' => isset($data['icon']['id'])
        ? 'https://cdn.brawlify.com/profile-icons/regular/' . $data['icon']['id'] . '.png'
        : null,
    'trophies' => $data['trophies'] ?? 0,
    'highestTrophies' => $data['highestTrophies'] ?? 0,
    'expLevel' => $data['expLevel'] ?? null,
    'victories3v3' => $data['3vs3Victories'] ?? 0,
    'soloVictories' => $data['soloVictories'] ?? 0,
    'duoVictories' => $data['duoVictories'] ?? 0,
    'club' => $data['club']['name'] ?? null,
    // Ranked (modo competitivo): la API sí expone estos campos directamente.
    'rankedCurrentName' => $data['rankedRankName'] ?? null,
    'rankedCurrentElo' => $data['rankedElo'] ?? null,
    'rankedSeasonPeakName' => $data['highestSeasonRankedRankName'] ?? null,
    'rankedSeasonPeakElo' => $data['highestSeasonRankedElo'] ?? null,
    'rankedAllTimePeakName' => $data['highestAllTimeRankedRankName'] ?? null,
    'rankedAllTimePeakElo' => $data['highestAllTimeRankedElo'] ?? null,
]);
