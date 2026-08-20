<?php
/*
  Proxy de la API de Challonge (SOLO LECTURA)
  ==============================================
  Llama a esta URL desde el navegador con ?tournament=SLUG_O_ID
    proxy/challonge.php?tournament=torneo_3v3_showcast

  Por qué existe este script y no se llama a la API directamente desde la web:
  - Las credenciales de Challonge dan control sobre la cuenta; exponerlas en
    el JavaScript del navegador las dejaría visibles para cualquiera.
  - Este proxy es DELIBERADAMENTE de solo lectura: solo implementa el GET de
    torneo+partidos+participantes. Nunca se añaden aquí verbos de escritura
    (POST/PUT) — así es físicamente imposible gastar cuota de escritura por
    accidente desde el sitio. Ver CHALLONGE-API.md secciones 10 y 15.

  Autenticación: OAuth2 "Client Credentials" (Challonge ya no ofrece una
  clave v1 simple para aplicaciones nuevas — ver CHALLONGE-API.md sección 4).
  Este proxy pide un token de acceso con CHALLONGE_CLIENT_ID/SECRET
  (proxy/config.php) y lo cachea en disco (challonge-token-cache.json, fuera
  de git) hasta que caduque, en vez de pedir uno nuevo en cada petición.

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

if (!defined('CHALLONGE_CLIENT_ID') || CHALLONGE_CLIENT_ID === '' || !defined('CHALLONGE_CLIENT_SECRET') || CHALLONGE_CLIENT_SECRET === '') {
    fail(500, 'El proxy no tiene configuradas todavía las credenciales de la API de Challonge (proxy/config.php).');
}

// Token de acceso OAuth2 (Client Credentials), cacheado en disco hasta que
// caduque (válido ~7 días) para no pedir uno nuevo en cada petición.
function getChallongeAccessToken(): string {
    $cacheFile = __DIR__ . '/challonge-token-cache.json';
    if (is_file($cacheFile)) {
        $cache = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cache) && ($cache['expires_at'] ?? 0) > time() + 300) {
            return $cache['access_token'];
        }
    }

    $ch = curl_init('https://api.challonge.com/oauth/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'client_credentials',
            'client_id' => CHALLONGE_CLIENT_ID,
            'client_secret' => CHALLONGE_CLIENT_SECRET,
        ]),
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        fail(500, 'No se ha podido obtener un token de acceso de Challonge. Revisa CHALLONGE_CLIENT_ID/SECRET en proxy/config.php.');
    }
    $token = json_decode((string) $response, true);
    if (!is_array($token) || empty($token['access_token'])) {
        fail(502, 'Respuesta inválida al pedir el token de acceso de Challonge.');
    }

    file_put_contents($cacheFile, json_encode([
        'access_token' => $token['access_token'],
        'expires_at' => time() + (int) ($token['expires_in'] ?? 3600) - 300,
    ]));

    return $token['access_token'];
}

$tournamentRaw = $_GET['tournament'] ?? '';
$tournament = trim((string) $tournamentRaw);

if ($tournament === '' || !preg_match('/^[a-zA-Z0-9_\-]{1,100}$/', $tournament)) {
    fail(400, 'Falta el identificador del torneo (slug o id de Challonge), o tiene un formato inválido.');
}

$accessToken = getChallongeAccessToken();

$url = 'https://api.challonge.com/v2.1/tournaments/' . rawurlencode($tournament)
     . '.json?include_matches=1&include_participants=1';

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization-Type: v2',
        'Authorization: Bearer ' . $accessToken,
        'Content-Type: application/vnd.api+json',
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
    fail(500, 'La API de Challonge ha rechazado el token de acceso. Revisa proxy/config.php.');
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
