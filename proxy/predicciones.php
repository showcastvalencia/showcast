<?php
/*
  Proxy de envío de predicciones (SOLO ESCRITURA)
  ==================================================
  Recibe por POST la predicción de un visitante para la fase clasificatoria
  de un torneo (ranking de equipos del 1º al último) y la guarda en la misma
  Realtime Database de Firebase que ya usan Enfrentamientos e Historial, en un nodo
  nuevo /predicciones — ver el plan en la conversación / ARQUITECTURA.md.

  Por qué existe este script en vez de escribir directamente a Firebase desde
  el navegador (como sí hace el resto del sitio, p. ej. screen.html):
  - Hay que evitar que la misma persona vote varias veces. La única forma
    fiable de identificar "la misma persona" sin pedir cuentas ni login es su
    IP, y el navegador no puede leer ni demostrar su propia IP — hace falta
    un componente de servidor que la lea de la petición HTTP real.
  - Cada voto se guarda con una clave = hash(IP + sal secreta), nunca la IP
    en claro. Si la misma IP vuelve a votar, SOBRESCRIBE su voto anterior en
    vez de duplicarlo — no bloquea revotar, solo evita contar dos veces a la
    misma persona.
  - La escritura en Firebase usa el "database secret" heredado (bypassa las
    reglas de seguridad de la base de datos), así que tiene que quedarse en
    el servidor — nunca puede ir en JavaScript de cliente.

  Este proxy es DELIBERADAMENTE de solo escritura para este único propósito:
  no lee ni expone nada de Firebase. La lectura de los votos agregados la
  hace directamente el navegador contra la Realtime Database (lectura
  pública por reglas, sin necesitar este proxy ni ningún secreto).
*/

header('Content-Type: application/json; charset=utf-8');

$allowedOrigins = [
    'https://showcastvalencia.github.io',
    // 'https://www.showcast.es',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/config.php';

function fail(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'Este endpoint solo acepta POST.');
}

if (
    !defined('FIREBASE_DATABASE_URL') || FIREBASE_DATABASE_URL === ''
    || !defined('FIREBASE_DB_SECRET') || FIREBASE_DB_SECRET === ''
    || !defined('PREDICCIONES_IP_SALT') || PREDICCIONES_IP_SALT === ''
) {
    fail(500, 'El proxy no tiene configuradas todavía las credenciales de Firebase (proxy/config.php).');
}

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    fail(400, 'Cuerpo de la petición inválido (se esperaba JSON).');
}

$torneoId = trim((string) ($body['torneoId'] ?? ''));
if ($torneoId === '' || !preg_match('/^[a-zA-Z0-9_\-]{1,100}$/', $torneoId)) {
    fail(400, 'Falta el identificador del torneo, o tiene un formato inválido.');
}

$fase = trim((string) ($body['fase'] ?? ''));
if ($fase !== 'clasificatoria') {
    // De momento solo existe la fase clasificatoria (ranking de equipos).
    // La fase eliminatoria (picks por partido) se añade en una segunda entrega.
    fail(400, 'Fase de predicción no soportada.');
}

$ranking = $body['ranking'] ?? null;
if (!is_array($ranking) || count($ranking) < 2 || count($ranking) > 64) {
    fail(400, 'El ranking debe ser una lista de entre 2 y 64 ids de participante.');
}
$ranking = array_map('strval', $ranking);
if (count($ranking) !== count(array_unique($ranking))) {
    fail(400, 'El ranking no puede tener ids de participante repetidos.');
}
foreach ($ranking as $participantId) {
    if ($participantId === '' || !preg_match('/^[a-zA-Z0-9_\-]{1,50}$/', $participantId)) {
        fail(400, 'Uno de los ids de participante del ranking tiene un formato inválido.');
    }
}

$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if ($ip === '') {
    fail(400, 'No se ha podido determinar la IP de la petición.');
}
$ipHash = hash('sha256', $ip . PREDICCIONES_IP_SALT);

$payload = json_encode([
    'ranking' => array_values($ranking),
    'ts' => round(microtime(true) * 1000),
]);

$url = rtrim(FIREBASE_DATABASE_URL, '/')
     . '/predicciones/' . rawurlencode($torneoId) . '/clasificatoria/votos/' . rawurlencode($ipHash) . '.json'
     . '?auth=' . rawurlencode(FIREBASE_DB_SECRET);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    fail(502, 'No se ha podido contactar con Firebase. Inténtalo de nuevo en unos segundos.');
}
if ($httpCode !== 200) {
    fail(502, 'Firebase ha devuelto un error inesperado (código ' . $httpCode . ').');
}

echo json_encode(['ok' => true]);
