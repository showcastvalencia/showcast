<?php
/*
  Proxy de la API de Challonge (SOLO LECTURA)
  ==============================================
  Llama a esta URL desde el navegador con ?tournament=SLUG_O_ID
    proxy/challonge.php?tournament=torneo_3v3_showcast

  Por qué existe este script y no se llama a la API directamente desde la web:
  - La clave de API de Challonge da control total sobre la cuenta (podría
    cambiar resultados, borrar equipos...); exponerla en el JavaScript del
    navegador la dejaría visible para cualquiera.
  - Este proxy es DELIBERADAMENTE de solo lectura: solo implementa el GET de
    torneo+partidos+participantes. Nunca se añaden aquí verbos de escritura
    (POST/PUT) — así es físicamente imposible gastar cuota de escritura por
    accidente desde el sitio. Ver CHALLONGE-API.md secciones 10 y 15.

  Configura tu clave en proxy/config.php antes de usar esto
  (define('CHALLONGE_API_KEY', '...');, junto a BRAWL_API_KEY).

  Cuota: cada llamada a este proxy cuesta 1 petición de las 500/mes de
  Challonge. Solo se debe llamar desde un botón ("Actualizar historial"),
  nunca desde un temporizador/polling — ver CHALLONGE-API.md sección 11.
*/

header('Content-Type: application/json; charset=utf-8');

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

if (!defined('CHALLONGE_API_KEY') || CHALLONGE_API_KEY === '' || CHALLONGE_API_KEY === 'PON_AQUI_TU_API_KEY') {
    fail(500, 'El proxy no tiene configurada todavía la clave de la API de Challonge (proxy/config.php).');
}

$tournamentRaw = $_GET['tournament'] ?? '';
$tournament = trim((string) $tournamentRaw);

if ($tournament === '' || !preg_match('/^[a-zA-Z0-9_\-]{1,100}$/', $tournament)) {
    fail(400, 'Falta el identificador del torneo (slug o id de Challonge), o tiene un formato inválido.');
}

$url = 'https://api.challonge.com/v2.1/tournament/' . rawurlencode($tournament)
     . '.json?include_matches=1&include_participants=1';

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization-Type: v1',
        'Authorization: ' . CHALLONGE_API_KEY,
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    fail(502, 'No se ha podido contactar con la API de Challonge. Inténtalo de nuevo en unos segundos.');
}

if ($httpCode === 404) {
    fail(404, 'No existe ningún torneo con ese identificador. Revisa el slug o id de Challonge.');
}
if ($httpCode === 401 || $httpCode === 403) {
    fail(500, 'La API de Challonge ha rechazado la clave. Revisa proxy/config.php.');
}
if ($httpCode === 429) {
    fail(429, 'Se ha agotado la cuota mensual de la API de Challonge (500 peticiones/mes), o se han hecho demasiadas peticiones seguidas.');
}
if ($httpCode !== 200) {
    fail(502, 'La API de Challonge ha devuelto un error inesperado (código ' . $httpCode . ').');
}

$body = json_decode((string) $response, true);
if (!is_array($body) || !isset($body['data'])) {
    fail(502, 'Respuesta inválida de la API de Challonge.');
}

// Aplanamos el formato JSON:API (data/attributes/included) a algo simple
// de consumir desde historial-logic.js, sin perder ningún campo relevante.
$tournamentData = $body['data'];
$attrs = $tournamentData['attributes'] ?? [];

$matches = [];
$participants = [];
foreach (($body['included'] ?? []) as $item) {
    if (($item['type'] ?? '') === 'match') {
        $matches[] = array_merge(['id' => $item['id']], $item['attributes'] ?? []);
    } elseif (($item['type'] ?? '') === 'participant') {
        $participants[] = array_merge(['id' => $item['id']], $item['attributes'] ?? []);
    }
}

echo json_encode([
    'ok' => true,
    'tournament' => [
        'id' => $tournamentData['id'] ?? $tournament,
        'name' => $attrs['name'] ?? '',
        'state' => $attrs['state'] ?? '',
        'tournamentType' => $attrs['tournament-type'] ?? ($attrs['tournament_type'] ?? ''),
    ],
    'matches' => $matches,
    'participants' => $participants,
]);
