# Guía de la API de Challonge

> **Implementado y probado contra un torneo real (20 agosto 2026).** El subsistema `historial/` (proxy, panel de administración, pantalla pública) ya existe en el repositorio. Este documento sigue siendo la referencia de diseño; la sección 4 (Autenticación) se actualizó tras descubrir, al implementarlo, que Challonge ya no ofrece la clave v1 simple para aplicaciones nuevas.

Challonge es el servicio que ya usan muchísimas comunidades de esports para publicar brackets (llaves) de torneo: eliminación simple, doble, round robin y suizo. Este documento explica su API pública paso a paso — autenticación, recursos, límites reales de cuota — y, en la segunda mitad, el diseño concreto que Showcast construye: **usar Challonge solo en lectura** (el torneo y los equipos se siguen dando de alta a mano en la web de Challonge, como siempre) y cruzar cada partido con el *battlelog* de la API de Brawl Stars para tener un historial propio con qué personajes se usaron en cada partida.

- **Versión**: API v2.1
- **Auth**: OAuth2 Client Credentials (ver §4C — la clave v1 simple ya no se puede generar para apps nuevas)
- **Uso**: solo lectura — sin crear torneos ni participantes por API

## Índice

**Fundamentos**
1. [Qué es Challonge](#1-qué-es-challonge)
2. [v1 vs v2.1 — cuál usar](#2-v1-vs-v21--cuál-usar)
3. [Límites, cuotas y precio](#3-límites-cuotas-y-precio)
4. [Autenticación](#4-autenticación)
5. [Formato de peticiones (JSON:API)](#5-formato-de-peticiones-jsonapi)

**Los tres recursos**
6. [Torneos](#6-torneos)
7. [Participantes](#7-participantes)
8. [Partidos y resultados](#8-partidos-y-resultados)
9. [Torneos de dos fases](#9-torneos-de-dos-fases-grupos-suizo--final)

**La decisión de Showcast**
10. [Qué SÍ y qué NO vamos a llamar](#10-qué-sí-y-qué-no-vamos-a-llamar)
11. [Presupuesto de cuota (500/mes)](#11-presupuesto-de-cuota-500-peticionesmes)

**Historial de partidas**
12. [El battlelog de Brawl Stars](#12-el-battlelog-de-brawl-stars)
13. [Cómo se cruzan los dos mundos](#13-cómo-se-cruzan-los-dos-mundos)
14. [Estructura del historial resultante](#14-estructura-del-historial-resultante)
15. [El nuevo endpoint del proxy](#15-el-nuevo-endpoint-del-proxy)
16. [Limitaciones y riesgos](#16-limitaciones-y-riesgos-a-tener-en-cuenta)
16b. [Límites de la API de Brawl Stars](#16b-los-límites-de-la-api-de-brawl-stars-aparte)
17. [Alternativas y librerías](#17-alternativas-y-librerías-existentes)

---

## 1. Qué es Challonge

Challonge ([challonge.com](https://challonge.com)) es una plataforma web para crear y publicar brackets de torneo. Lo que la mayoría de organizaciones usan es la propia web: creas el torneo a mano, metes los participantes, y Challonge dibuja el bracket y deja que la gente vea el avance en directo desde un enlace público. La **API** es la puerta trasera de todo eso: en vez de crear el torneo a golpe de clic, lo haces por código — útil si quieres generar el bracket automáticamente a partir de datos que ya tienes en otro sitio, o si quieres mostrar los resultados dentro de tu propia web en vez de mandar a la gente a challonge.com.

Soporta cuatro formatos de torneo de forma nativa: **eliminación simple**, **eliminación doble**, **round robin** (todos contra todos) y **suizo**. Y, desde hace relativamente poco, **torneos de dos fases**: una fase de grupos (round robin o suizo) que alimenta una fase final de eliminación — justo la estructura de "fase de grupos suizo → fase final" que se mencionó como formato objetivo del torneo de Showcast fuera del alcance de Megadraft.

## 2. v1 vs v2.1 — cuál usar

Challonge tiene dos generaciones de API activas a la vez, lo cual es la primera fuente de confusión al leer su documentación (mucho contenido en internet todavía referencia v1).

| | API v1 (legacy) | API v2.1 (actual) |
|---|---|---|
| Base URL | `api.challonge.com/v1` | `api.challonge.com/v2.1` |
| Formato | JSON u XML "planos" | JSON:API (envuelto en `data`/`attributes`) |
| Auth | API key + HTTP Basic, o `?api_key=` | API key v1 reetiquetada, u OAuth2 completo |
| Torneos de 2 fases | ❌ no soportado | ✅ soportado (§9) |
| Recomendación oficial | Solo para clientes ya migrados | **Usar esta para cualquier cosa nueva** |

Lo curioso: la clave de API que generas sigue siendo la misma "clave v1" de siempre (se genera en [challonge.com/settings/developer](https://challonge.com/settings/developer)) — lo que cambia es la URL a la que llamas y una cabecera que le dices a v2.1 "trátame como si usara auth de v1". No hace falta OAuth para empezar.

## 3. Límites, cuotas y precio

> ⚠️ **Esto ya está en vigor, no es una fecha futura.** Challonge cambió su modelo en 2026: **el plan gratuito solo incluye 500 peticiones de API al mes**. Hubo un periodo de gracia hasta el **6 de julio de 2026** en el que se avisaba pero no se bloqueaba nada. Hoy (19 de agosto de 2026) ese periodo de gracia ya terminó — cualquier app gratuita que supere las 500 peticiones/mes recibe `429 Too Many Requests` el resto del ciclo.

500 peticiones al mes suena a poco, pero para el patrón de uso de un torneo puntual (crear el torneo una vez, dar de alta 16-32 participantes, actualizar resultados partido a partido) es razonable si no se hace nada en bucle. Donde sí se puede disparar el contador es si alguna pantalla en vivo hace *polling* del bracket cada pocos segundos para varias personas simultáneamente — eso agotaría la cuota en minutos.

Los precios exactos de los planes de pago no están publicados de forma pública/indexable (hay que consultarlos ya logueado en el [Developer Portal](https://connect.challonge.com), en `connect.challonge.com`). Lo que sí es público: el uso y el plan actual se controlan y se suben desde ese mismo portal.

> ⚠️ **No está publicado cuándo se reinicia el contador.** Ninguna fuente oficial dice si las "500/mes" son por **mes natural** (día 1 a fin de mes) o por **ciclo de facturación/aniversario de la cuenta** (la fecha en la que se creó la app developer, cada mes). Son cosas muy distintas para planificar un evento: si el reinicio no coincide con el día 1, hacer pruebas "el mes antes" del torneo puede gastar cuota que no se repone hasta después de la fecha del evento. La única fuente fiable es el propio **Developer Portal** (`connect.challonge.com`), que muestra el uso actual y — casi con toda seguridad — la fecha exacta de reinicio de la cuenta real de Showcast. Conviene comprobarlo ahí antes de fijar el calendario de pruebas, no asumir mes natural.

## 4. Autenticación

> ⚠️ **Actualizado tras la implementación real (20 agosto 2026):** cuando se escribió este documento, `challonge.com/settings/developer` todavía generaba una clave v1 simple para copiar y pegar. Ya no es así: esa página ahora solo redirige al Developer Portal (`connect.challonge.com`), y crear una aplicación ahí da un **Client ID + Client Secret** (OAuth2), no una clave suelta. La clave v1 sigue existiendo como *concepto* de autenticación (la cabecera `Authorization-Type: v1` todavía funciona si ya tenías una clave de antes), pero ya no hay forma de generar una nueva desde la interfaz web. Lo que Showcast usa realmente es la opción C de abajo.

### A) Clave de API v1 (legacy, ya no se puede generar nueva)

Si tu cuenta tiene una clave v1 de hace tiempo, sigue funcionando así:
```
Authorization-Type: v1
Authorization: tu_clave_api_v1
Content-Type: application/vnd.api+json
Accept: application/json
```
Pero para una aplicación nueva (como la de Showcast) ya no hay botón para generarla — solo queda como referencia histórica.

### B) OAuth2 — Authorization Code (pensado para apps de terceros)

Solo hace falta si la app la va a usar gente que **no** comparte la cuenta de Challonge de Showcast (por ejemplo, una app pública donde cada organizador conecta su propia cuenta). Se registra la aplicación en `connect.challonge.com` para obtener un `client_id`/`client_secret`, y luego:

```
# 1. mandas al usuario a autorizar
GET https://api.challonge.com/oauth/authorize
    ?client_id=TU_CLIENT_ID
    &redirect_uri=https://tuweb.com/callback
    &response_type=code
    &scope=me tournaments:read tournaments:write matches:write participants:write

# 2. Challonge redirige con un "code"; lo cambias por un token
POST https://api.challonge.com/oauth/token
  { client_id, client_secret, code, grant_type: "authorization_code" }

# 3. usas el token en cada petición
Authorization-Type: v2
Authorization: Bearer access_token_recibido
```

No aplica a Showcast — nadie tiene que "iniciar sesión" con su propia cuenta de Challonge, todo se hace sobre la única cuenta de la organización.

### C) OAuth2 — Client Credentials (la que usa Showcast en realidad)

El equivalente moderno a la clave v1: autoriza en nombre de la propia cuenta de la aplicación, sin ningún paso de "el usuario inicia sesión". Es lo más parecido a "una clave que copias y pegas", solo que en dos partes (Client ID + Client Secret) y con un token intermedio que caduca.

1. Entra en [connect.challonge.com](https://connect.challonge.com) con la cuenta de Challonge de la organización → **"+ New Application"** → rellena nombre, descripción y un enlace de referencia (la web de Showcast) → **Save**. Obtienes un **Client ID** y un **Client Secret**.
2. Pide un token de acceso (dura **7 días**, hay que renovarlo — el proxy lo cachea, ver §15):
   ```bash
   curl -X POST https://api.challonge.com/oauth/token \
     -d grant_type=client_credentials \
     -d client_id=TU_CLIENT_ID \
     -d client_secret=TU_CLIENT_SECRET
   ```
   Devuelve `{ "access_token": "...", "expires_in": 604800, "scope": "me tournaments:read matches:read participants:read ..." }` — el scope por defecto ya es de solo lectura, ni siquiera hace falta pedirlo explícitamente.
3. Usa ese token en cada petición:
   ```
   Authorization-Type: v2
   Authorization: Bearer access_token_recibido
   Content-Type: application/vnd.api+json
   Accept: application/json
   ```

**Aplicación creada para Showcast**: "Showcast — Historial de partidas" en el Developer Portal (`connect.challonge.com/challonge/apps/58701/edit`). Las credenciales viven en `proxy/config.php` (local, gitignored), nunca en el repositorio.

## 5. Formato de peticiones (JSON:API)

v2.1 sigue la especificación [JSON:API](https://jsonapi.org): cada recurso va envuelto en `data`, con el contenido real dentro de `attributes`. Es más verboso que un JSON "plano", pero es predecible una vez lo has visto una vez.

**Petición típica (crear algo)**
```json
{
  "data": {
    "type": "tournament",
    "attributes": {
      "name": "Torneo 3v3 Showcast",
      "tournament_type": "single elimination"
    }
  }
}
```

**Respuesta típica**
```json
{
  "data": {
    "id": "30201",
    "type": "tournament",
    "attributes": {
      "name": "Torneo 3v3 Showcast",
      "url": "torneo_3v3_showcast",
      "tournament_type": "single elimination",
      "state": "pending"
    }
  }
}
```

> ● **Ojo con la documentación mezclada.** Parte de la documentación pública de v2.1 todavía muestra ejemplos "planos" heredados de v1 (`{"tournament": {"id": ...}}` en vez de `{"data": {"attributes": ...}}`) marcados como *deprecated* dentro de la propia página de v2.1. En caso de duda, el formato JSON:API (con `data`/`attributes`) es el correcto para peticiones nuevas.

---

## 6. Torneos

El recurso raíz. Todo (participantes, partidos) cuelga de un `tournament_id`.

> ● **Referencia, no lo que vamos a usar.** Showcast ha decidido **no** crear torneos ni participantes por API (§10) para no gastar cuota en algo que ya se hace una vez a mano, sin prisa, desde la web de Challonge. Esta sección se documenta igualmente porque hace falta para entender la forma de los datos que sí vamos a *leer* más adelante.

`POST /v2.1/tournaments.json` — campos más relevantes al crear uno:

| Campo | Tipo | Notas |
|---|---|---|
| `name` | string | máx. 60 caracteres |
| `tournament_type` | string | `single elimination` (por defecto), `double elimination`, `round robin`, `swiss` |
| `url` | string | slug para `challonge.com/<url>` |
| `open_signup` | boolean | si la gente puede autoinscribirse desde la web pública de Challonge |
| `private` | boolean | oculta el torneo del índice público (por defecto `false`) |
| `signup_cap` | integer | máximo de participantes |
| `swiss_rounds` | integer | solo si `tournament_type` es `swiss` |
| `pts_for_match_win`, `pts_for_bye`... | decimal | puntuación del sistema suizo/round robin |

Ejemplo real, curl, creando el torneo de fase suiza de Showcast:

```bash
curl -X POST https://api.challonge.com/v2.1/tournaments.json \
  -H "Authorization-Type: v1" \
  -H "Authorization: $CHALLONGE_API_KEY" \
  -H "Content-Type: application/vnd.api+json" \
  -H "Accept: application/json" \
  -d '{
    "data": {
      "type": "tournament",
      "attributes": {
        "name": "Showcast — Fase de grupos (suizo)",
        "tournament_type": "swiss",
        "swiss_rounds": 5,
        "open_signup": false,
        "private": false
      }
    }
  }'
```

`GET /v2.1/tournament/{tournament}.json?include_participants=1&include_matches=1` — el identificador `{tournament}` puede ser el `id` numérico o el `url` (slug). Los parámetros `include_participants`/`include_matches` evitan tener que hacer 3 peticiones separadas para pintar una pantalla completa del bracket.

`GET /v2.1/tournaments.json?state=in_progress&type=swiss` — lista con filtros por `state` (`pending` / `in_progress` / `ended`), `type`, rango de fechas de creación, y paginación (`page`, `per_page`, 25 por defecto).

**Transiciones de estado del torneo**: un torneo no "empieza" solo al crear los partidos: hay que avisar explícitamente a Challonge de que cambie de fase, con endpoints dedicados (no es un simple `PUT` de un campo `state`): `start`, `finalize`, `reset`, `start_group_stage`, `finalize_group_stage`.

## 7. Participantes

Un "participante" en Challonge es, en el contexto de Showcast, **un equipo** (no un jugador individual) — igual que ya se modela en Megadraft. No hace falta que tenga cuenta de Challonge: `name` es el único campo obligatorio.

> ● **Aquí sí leeremos, pero no crearemos.** Los equipos se siguen dando de alta a mano en Challonge. Lo único que hará Showcast con este recurso es un `GET` de la lista una vez por torneo (§11), para poder traducir el `participant_id` numérico de cada partido a un nombre de equipo reconocible y, sobre todo, a los tags de Brawl Stars de sus miembros — que Showcast ya tiene guardados en Firebase desde Megadraft.

`POST /v2.1/tournaments/{tournament_id}/participants.json`

```bash
curl -X POST https://api.challonge.com/v2.1/tournaments/torneo_3v3_showcast/participants.json \
  -H "Authorization-Type: v1" -H "Authorization: $CHALLONGE_API_KEY" \
  -H "Content-Type: application/vnd.api+json" -H "Accept: application/json" \
  -d '{
    "data": {
      "type": "participant",
      "attributes": {
        "name": "Puçol Titans",
        "seed": 1,
        "misc": "team_puçol_titans"
      }
    }
  }'
```

`misc` es un campo libre de texto que Challonge no usa para nada — perfecto para guardar el `teamId` interno de Showcast/Megadraft y poder cruzar los datos de vuelta después.

`POST /v2.1/tournaments/{tournament_id}/participants/bulk_add.json` — para dar de alta los 8 equipos de golpe en vez de 8 peticiones sueltas — importante para no gastar cuota (§3) sin necesidad:

```json
{
  "data": {
    "type": "Participant",
    "attributes": {
      "participants": [
        { "name": "Puçol Titans", "seed": 1 },
        { "name": "Espai Jove Storm", "seed": 2 },
        { "name": "Valencia Sparks", "seed": 3 }
      ]
    }
  }
}
```

Otros endpoints del mismo recurso: listar (`GET .../participants.json`), actualizar/hacer check-in (`PUT`), y `POST .../participants/randomize.json` para barajar la seed inicial — útil si Showcast quiere que el orden del bracket sea aleatorio en vez de por puntuación (con Megadraft ya se calcula una puntuación real por equipo, así que probablemente interese **seedear a mano** con esa puntuación en vez de aleatorizar).

## 8. Partidos y resultados

Challonge genera los partidos automáticamente al arrancar el torneo (según el formato elegido) — no se crean partidos a mano, solo se **reportan resultados** sobre los que ya existen.

> ● **Este recurso es el corazón de lo que sí usaremos.** El organizador sigue reportando los resultados a mano en la web de Challonge, igual que siempre. Showcast solo hará `GET` de este recurso — para leer qué partidos ya están `complete`, su `scores_csv`, quién ganó y, sobre todo, **cuándo se actualizó** (`updated_at`), que es lo que permite ir a buscar la batalla real correspondiente en el battlelog de Brawl Stars (§13).

`GET /v2.1/tournaments/{tournament_id}/matches.json` — lista todos los partidos con su estado (`pending`, `open`, `complete`), qué dos participantes se enfrentan, y su ronda.

`PUT /v2.1/tournaments/{tournament}/matches/{match_id}.json` — reportar el resultado de un partido, por ejemplo "Puçol Titans" gana 2-1 en mapas:

```bash
curl -X PUT ".../matches/23575258.json" \
  -H "Authorization-Type: v1" -H "Authorization: $CHALLONGE_API_KEY" \
  --data-urlencode "match[scores_csv]=13-7,9-11,13-10" \
  --data-urlencode "match[winner_id]=16543993"
```

`scores_csv` es una lista de marcadores separados por comas, un elemento por mapa/ronda jugada dentro de ese partido (`13-7,9-11,13-10` = tres mapas). **Restricción importante:** si mandas `winner_id`, `scores_csv` es obligatorio también — no se puede declarar un ganador sin marcador.

Al reportar el último resultado pendiente de una ronda, Challonge avanza el bracket automáticamente: genera el siguiente partido, mueve al ganador, etc. No hace falta gestionar el avance de rondas manualmente.

Otros endpoints útiles: `reopen` (deshacer un resultado si se reportó mal), `mark_as_underway` / `unmark_as_underway` (marcar qué partido se está jugando ahora mismo, útil para una pantalla de "en directo").

## 9. Torneos de dos fases (grupos suizo → final)

Esta es la razón por la que se eligió v2.1 en vez de v1 (§2): el formato de "fase de grupos suizo, luego fase final" del torneo de Showcast se parece bastante a lo que Challonge llama **two-stage tournament** — con la salvedad de que Challonge no sabe nada de restricciones de alineación entre fases (eso seguiría siendo criterio del organizador). Como el torneo se configura a mano en la web de Challonge, las transiciones de estado de esta sección (`start_group_stage`, `finalize_group_stage`...) también las pulsa el organizador ahí — Showcast no las dispara por API, solo **lee** en qué fase está el torneo cuando lo necesita (§8).

Se activa al crear el torneo, con dos bloques nuevos de configuración:

```json
{
  "data": {
    "type": "tournament",
    "attributes": {
      "name": "Torneo 3v3 Showcast",
      "tournament_type": "single elimination",
      "group_stage_enabled": true,
      "group_stage_options": {
        "stage_type": "swiss",
        "group_size": 4,
        "participant_count_to_advance_per_group": 2
      }
    }
  }
}
```

**Flujo de estados de un torneo de dos fases:**

```
pending ──start_group_stage──→ group stage en curso
     (se reportan los partidos de grupos con el mismo
      endpoint PUT de matches que en §8, con group_id)
                      │
            finalize_group_stage
                      ▼
            fase final generada ──start──→ fase final en curso
                      │
                 finalize
                      ▼
               torneo completo (final_rank asignado a cada participante)
```

Los partidos de la fase de grupos son partidos normales (mismo endpoint `PUT .../matches/{id}` de siempre), solo que llevan un `group_id` asociado. Al terminar y llamar a `finalize_group_stage`, Challonge calcula automáticamente quién avanza según `participant_count_to_advance_per_group` y genera el bracket de la fase final ya con esos equipos.

---

## 10. Qué SÍ y qué NO vamos a llamar

Decisión tomada: Challonge se sigue gestionando **a mano**, desde su propia web, exactamente igual que hasta ahora — el torneo, los 8 equipos y el reporte de cada resultado los sigue tecleando el organizador en challonge.com. La API solo entra para **leer** lo que ya existe y enriquecerlo con datos reales de Brawl Stars.

| Acción | ¿Por API? | Motivo |
|---|---|---|
| Crear el torneo | ❌ a mano en Challonge | se hace una vez, sin prisa; no vale la pena gastar cuota en algo puntual |
| Dar de alta los 8 equipos | ❌ a mano en Challonge | igual — es un formulario, no un proceso repetitivo |
| Cambiar de fase (`start_group_stage`, `finalize`...) | ❌ a mano en Challonge | lo pulsa el organizador cuando toca, no hay nada que automatizar |
| Reportar el resultado de un partido | ❌ a mano en Challonge | el organizador ya lo hace en el momento, en la propia web |
| Leer el torneo (estado, fase actual) | ✅ `GET`, 1 vez por consulta | necesario para saber qué mostrar |
| Leer los participantes (mapear id → equipo → tags) | ✅ `GET`, cacheado | traducir `participant_id` a algo útil |
| Leer los partidos ya completados | ✅ `GET`, bajo demanda | es la entrada al cruce con Brawl Stars (§13) |

> ● **El disparador es un botón, no un temporizador.** Nada de esto se consulta automáticamente en bucle. Se lee cuando alguien (el organizador, desde un panel de administración) pulsa un botón tipo **"Actualizar historial de partidas"**. Ese único gesto humano es lo que mantiene el consumo de cuota bajo control (§11) — el equivalente a "Recargar info de jugadores" que ya existe en `megadraft/admin.html`, pero para partidos de Challonge en vez de perfiles de jugador.

## 11. Presupuesto de cuota (500 peticiones/mes)

Con el diseño de solo-lectura-bajo-demanda de §10, el coste real es minúsculo comparado con el límite. La trampa a evitar es una sola: **el polling automático**.

**Coste de una pulsación de "Actualizar historial"**

| Petición | Coste | Nota |
|---|---|---|
| `GET /tournament/{id}.json?include_matches=1` | 1 | trae el torneo Y sus partidos en una sola llamada — evita un `GET` aparte a `/matches.json` |
| `GET /tournaments/{id}/participants.json` | 1 (solo si hay equipos nuevos) | se cachea en Firebase tras la primera vez; no hace falta repetirla cada click si la lista de equipos no ha cambiado |

**≈ 1-2 peticiones a Challonge por cada vez que se pulsa el botón.** El resto del trabajo (ir a buscar el battlelog de cada jugador) es contra la API de Brawl Stars, que tiene su propia cuota independiente y no descuenta nada de las 500 de Challonge.

**Cálculo para un evento real**: un torneo de 8 equipos a dos fases (suizo de 5 rondas + eliminatoria de 3 rondas) tiene 8 rondas en total. Si el organizador pulsa "Actualizar" una vez al terminar cada ronda:

```
8 rondas × ~2 peticiones/click ≈ 16 peticiones por evento completo
```

Incluso siendo generosos — pulsando cada 10-15 minutos durante un evento de 4 horas en vez de solo al final de cada ronda — son unas 16-20 pulsaciones × 2 ≈ **~40 peticiones por evento**. Eso deja margen de sobra para **más de 10 eventos completos en el mismo mes** sin acercarse al límite de 500.

> ⚠️ **Lo que NO hay que hacer nunca**: poner un `setInterval` en una pantalla pública (tipo `screen.html` de Megadraft) que llame a Challonge cada 30 segundos "para que se vea en directo". Un evento de 3 horas a ese ritmo son `3×3600/30 ≈ 360` llamadas — **por sí solo, un único evento así agotaría casi toda la cuota mensual**. Si en algún momento se quiere una vista que se refresque sola, tiene que leer de la **copia cacheada en Firebase** (que sí admite todo el polling que haga falta, gratis, como ya hace Megadraft), nunca de la API de Challonge directamente desde el navegador de cada espectador.

---

## 12. El battlelog de Brawl Stars

La pieza que hace posible todo esto: la API oficial de Brawl Stars expone, para cualquier tag, sus últimas batallas jugadas — con qué personaje, en qué modo, contra quién y con qué resultado.

`GET /v1/players/%23{tag}/battlelog`

```json
{
  "items": [
    {
      "battleTime": "20260819T170334.000Z",
      "event": { "id": 15000005, "mode": "bounty", "modeId": 3, "map": "Shooting Star" },
      "battle": {
        "mode": "bounty",
        "type": "friendly",
        "result": "victory",
        "duration": 118,
        "teams": [
          [
            { "tag": "#2RYQ8YYJV", "name": "SC|AleXxDiiaaz", "brawler": { "id": 16000045, "name": "STU", "power": -1, "trophies": -1 } },
            { "tag": "#9UC", "name": "Bot 2", "brawler": { "id": 16000009, "name": "DYNAMIKE", "power": -1, "trophies": -1 } }
          ],
          [
            { "tag": "#2J89YPUQUJ", "name": "SC|Kol.Beat", "brawler": { "id": 16000099, "name": "PIERCE", "power": -1, "trophies": -1 } },
            { "tag": "#Y92", "name": "Bot 3", "brawler": { "id": 16000016, "name": "PAM", "power": -1, "trophies": -1 } }
          ]
        ]
      }
    }
  ]
}
```

*Ejemplo real capturado de una sala amistosa 2v2 con un bot por equipo — confirma la forma exacta que devuelve la API en la práctica, bots incluidos.*

| Detalle | Implicación |
|---|---|
| Devuelve solo las **últimas ~25 batallas** de ese jugador | sin filtro por fecha ni paginación — si no se consulta a tiempo, la batalla del torneo puede "caer" del historial sin recuperación posible |
| No hay ID único de batalla | la única forma de identificar "esta es la batalla del partido X" es cruzar tiempo + jugadores (§13) |
| `type` distingue el tipo de sala | una partida jugada en sala privada (la forma normal de organizar un torneo) aparece como `"friendly"`; ya confirmado con el ejemplo real de arriba |
| `teams` es una lista de listas | cada sublista son los jugadores de un lado — perfecto para comparar contra el roster de cada equipo de Showcast |

> ⚠️ **Los bots que rellenan huecos también salen en `teams`.** Si una sala amistosa se crea sin llenar todos los puestos, Brawl Stars la rellena con bots — y esos bots aparecen como participantes normales del array `teams`, con nombre `"Bot N"`, un `tag` corto y no estándar (`#9UC`, `#Y92` — 3-4 caracteres, frente a los 8-9 de un tag real), y `brawler.power` / `brawler.trophies` siempre a **`-1`**. De hecho, en este ejemplo real `power` y `trophies` vienen a `-1` incluso en los dos jugadores humanos — así que ese campo **no es fiable para detectar bots por sí solo**; lo fiable es el nombre (`"Bot "` + número) y la longitud del tag. Esto hay que filtrarlo antes de comparar contra el roster conocido de cada equipo (§13), o un bot "PAM" acabaría registrado como si un jugador real hubiera elegido ese Brawler.

## 13. Cómo se cruzan los dos mundos

Challonge sabe *quién jugó contra quién y quién ganó*. Brawl Stars sabe *qué personaje usó cada uno y en qué mapa*. Ninguno de los dos sabe del otro — el cruce lo hace Showcast, por tiempo y por jugadores.

1. **Disparo manual**: el organizador pulsa "Actualizar historial de partidas" en el panel de admin.
2. **Leer Challonge**: `GET /tournament/{id}.json?include_matches=1` (§11) — de la respuesta se filtran los partidos con `state: "complete"` que todavía no estén guardados en el historial local (comparando por `match.id`).
3. **Resolver equipos**: cada `player1_id`/`player2_id` del partido se traduce a un equipo real usando la lista de participantes cacheada (§11), y de ahí a los tags de Brawl Stars de sus miembros — ya guardados en Firebase desde Megadraft.
4. **Pedir el battlelog**: por cada partido nuevo, se pide (vía el proxy, §15) el battlelog de un miembro de cada equipo — no cuenta contra la cuota de Challonge.
5. **Filtrar por tiempo**: de ese battlelog se descartan todas las entradas cuyo `battleTime` no caiga dentro de una ventana razonable alrededor de cuándo se reportó el resultado en Challonge (p. ej. ±30 minutos — configurable, porque `updated_at` es cuándo se *reportó*, no necesariamente el segundo exacto en que terminó de jugarse).
6. **Descartar bots**: antes de comparar nada, se eliminan de `teams` las entradas cuyo `name` empiece por `"Bot "` (§12) — si no, un bot relleno acabaría contando como si un jugador real hubiera elegido ese Brawler.
7. **Filtrar por jugadores**: de lo que quede, se queda solo con las batallas donde **al menos 2 de los 3 tags conocidos** de cada equipo aparecen en `teams` (no exigir 3 de 3 evita falsos negativos si alguien jugó con una cuenta distinta a la registrada, o si la sala se completó con un bot y solo hay 2 jugadores reales por lado).
8. **Emparejar juego a juego**: un partido de Challonge al mejor de 3 (`scores_csv: "2-1"`, 2 elementos = 2 mapas jugados) puede corresponder a 2-3 entradas del battlelog. Se ordenan por `battleTime` y se asignan en ese mismo orden como "juego 1, juego 2...".
9. **Guardar** el resultado combinado en Firebase (§14), marcando el `match.id` de Challonge como ya procesado para no repetir el trabajo en la siguiente actualización.

> ⚠️ **Cuanto antes se actualice, mejor.** Como el battlelog solo guarda ~25 batallas por jugador sin filtro de fecha (§12), si el organizador espera al día siguiente para pulsar "Actualizar", los jugadores más activos pueden haber jugado de sobra fuera del torneo como para que la batalla del partido ya no esté en su historial — y esa entrada del historial de Showcast se queda sin datos de Brawl Stars, de forma irrecuperable. Conviene actualizar **ronda a ronda**, no al final del día.

## 14. Estructura del historial resultante

Lo que queda guardado en Firebase tras el cruce, listo para que el sitio lo lea y lo pinte (igual que ya lee `screen.html` el estado de Megadraft):

```json
{
  "challongeMatchId": 23575258,
  "ronda": 2,
  "equipoA": { "id": "team3", "nombre": "Puçol Titans" },
  "equipoB": { "id": "team7", "nombre": "Valencia Sparks" },
  "resultadoChallonge": { "scoresCsv": "2-1", "ganador": "team3" },
  "juegos": [
    {
      "orden": 1, "battleTime": "2026-08-19T19:05:12Z",
      "modo": "brawlBall", "mapa": "Sneaky Fields", "duracion": 128,
      "picksEquipoA": [ { "jugador": "jugador1", "brawler": "SHELLY" } /* ...x3 */ ],
      "picksEquipoB": [ /* ...x3 */ ]
    },
    { "orden": 2 /* ... */ }
  ],
  "actualizadoEn": "2026-08-19T19:40:03Z"
}
```

Con esto, una nueva sección tipo "Historial de partidas" en el sitio podría mostrar, por ronda o por equipo, no solo quién ganó (eso ya lo enseña el *embed* público de Challonge) sino **qué se jugó realmente**: mapa, duración, y los 6 personajes elegidos — algo que Challonge por sí solo nunca podría mostrar, porque no tiene ni idea de que el juego es Brawl Stars.

## 15. El nuevo endpoint del proxy

Igual que con la clave de Brawl Stars, la clave de Challonge no puede ir en JavaScript de cliente — da control total sobre la cuenta (podría cambiar resultados, borrar equipos...). Hacen falta dos piezas nuevas, siguiendo el mismo patrón que `proxy/brawlstars.php`:

**a) Ampliar `proxy/brawlstars.php` con el battlelog**

```php
// nuevo caso dentro del proxy existente: ?tag=XXXX&battlelog=1
if (isset($_GET['battlelog'])) {
    $url = 'https://api.brawlstars.com/v1/players/%23' . $tag . '/battlelog';
    // ...misma llamada curl + misma clave BRAWL_API_KEY que ya usa el proxy...
    // devolver solo battleTime, mode, map, type, result, duration y teams —
    // nunca la respuesta cruda completa, igual que ya hace el endpoint de jugador
}
```

**b) `proxy/challonge.php` (implementado, de solo lectura)**

Ya construido — código real, no un boceto. Dos detalles que solo se descubrieron al probarlo contra un torneo real y que merece la pena dejar anotados (por si alguien vuelve a tropezar con lo mismo):

- El endpoint correcto es `/v2.1/tournaments/{id}.json` (**plural**), no `/tournament/{id}.json` (singular) — un error fácil de cometer porque parte de la documentación de Challonge todavía usa el singular en ejemplos heredados de v1.
- Hace falta la cabecera `Content-Type: application/vnd.api+json` incluso en peticiones `GET` sin cuerpo — si falta, la API responde `415 Unsupported Media Type`.

Usa el token OAuth2 de §4C (`Authorization-Type: v2`, `Authorization: Bearer ...`), pedido a `https://api.challonge.com/oauth/token` con `grant_type=client_credentials` y cacheado en disco (`proxy/challonge-token-cache.json`, fuera de git) hasta que caduca a los 7 días, para no pedir uno nuevo en cada petición.

Este proxy nunca implementa acciones de escritura a propósito (crear torneo, dar de alta participante, reportar resultado) — no porque el token no lo permita (de hecho el scope por defecto del Client Credentials ya es de solo lectura, ver §4C), sino porque es una decisión de diseño consciente para que sea físicamente imposible gastar cuota de escritura por accidente desde el sitio.

## 16. Limitaciones y riesgos a tener en cuenta

- **El battlelog es efímero** (§12/§13) — la ventana real para capturar los datos de un partido es de horas, no de días. Es el riesgo más importante de todo el diseño.
- **La correlación es heurística, no exacta.** No existe ningún campo que diga "esta batalla de Brawl Stars es el partido nº 23575258 de Challonge" — se infiere por tiempo y jugadores, lo que puede fallar (aunque con baja probabilidad) si dos partidos con jugadores parecidos se juegan casi a la vez.
- **Sin restricciones de alineación nativas en Challonge.** Si el torneo necesita reglas propias de composición de equipo entre fases, esa lógica sigue siendo responsabilidad de Showcast — Challonge solo gestiona el bracket y los resultados.
- **Cuota de Challonge de 500 peticiones/mes ya activa** (§3) — el diseño de §10-§11 se queda muy por debajo, pero solo mientras se respete la regla de "nunca polling automático".
- **El campo `type` del battlelog depende de cómo se organice la partida en el juego** — conviene verificarlo con una batalla real de prueba antes de confiar en el filtro `"friendly"`.
- **Precios de los planes de pago de Challonge no son públicos** — si algún día el uso creciera más allá de lo previsto aquí, habría que consultar el coste real dentro del Developer Portal.

## 16b. Los límites de la API de Brawl Stars, aparte

La cuota de Challonge (§3) es un tope **mensual** y publicado. La de Brawl Stars es otra cosa completamente distinta: Supercell **no publica ninguna cifra oficial** — ni en [developer.brawlstars.com](https://developer.brawlstars.com) ni en ningún otro sitio oficial — y en su lugar aplica un **throttling por segundo**, silencioso, atado a la propia clave.

**Lo que sí se sabe con certeza:**

- **Es la misma infraestructura** para Clash of Clans, Clash Royale y Brawl Stars — los tres APIs de Supercell comparten backend y comportamiento de límites, aunque cada juego tenga su propia documentación por separado.
- **Cada clave lleva su propio "tier" de throttling incrustado.** La clave que ya usa `proxy/config.php` es un JWT que, decodificado, declara `"tier": "developer/silver"` — ese es el nivel real de la cuenta de Showcast, no un valor de ejemplo genérico.
- **No hay tope mensual ni diario**, solo un límite de *peticiones por segundo*. Pruebas de la comunidad sobre esta misma infraestructura (reportadas directamente por Supercell en su foro de desarrolladores para Clash of Clans, que comparte backend con Brawl Stars) sitúan el límite habitual en torno a **~10 peticiones/segundo** para una clave estándar — al superarlo no siempre falla de golpe: a veces se *throttlea* (se retrasa la respuesta) y otras veces responde `429` directamente.
- **Las respuestas llevan cabeceras de rate limit** (`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-retry-after`) en esta misma familia de APIs — la forma fiable de conocer el límite *real* de la clave de Showcast es mirar esas cabeceras en una respuesta real del proxy, no fiarse de una cifra genérica encontrada en internet.
- **La clave también está atada a una IP fija** (`"cidrs"` en ese mismo JWT) — ya documentado en [ARQUITECTURA.md](ARQUITECTURA.md), y es un límite distinto (de origen, no de ritmo).

**Qué implica para el historial de partidas (§13)**: cada actualización pide el battlelog de, como mínimo, un jugador por equipo del partido nuevo — con 8 equipos y varios partidos por ronda, podrían ser 10-15 peticiones seguidas al proxy de Brawl Stars en una sola pulsación de "Actualizar". A ~10 peticiones/segundo de margen, eso es cosa de 1-2 segundos, pero es buena práctica que el proxy las encadene con una pequeña pausa entre cada una (o las resuelva en serie) en vez de lanzarlas todas literalmente en paralelo, para no acercarse al límite en una ráfaga.

## 17. Alternativas y librerías existentes

Si en algún momento hiciera falta más que las dos o tres llamadas de solo lectura de §15, no habría que escribir el cliente HTTP desde cero — existen wrappers ya hechos, aunque casi todos apuntan todavía a v1:

| Librería | Lenguaje | Nota |
|---|---|---|
| [pychallonge](https://github.com/ZEDGR/pychallonge) | Python | el más usado de la comunidad, API v1 |
| [challonge-api](https://github.com/dolejska-daniel/challonge-api) | PHP | encajaría directamente con el proxy PHP ya existente en `proxy/` |
| [challonge (crate)](https://docs.rs/challonge/) | Rust | — |

Dado que el proxy de Brawl Stars de Showcast ya está en PHP puro sin dependencias, lo más consistente sería seguir ese mismo patrón (llamadas `curl` directas, sin librería) en vez de añadir una dependencia externa nueva solo para esto — el volumen de endpoints que realmente hacen falta (§10) es pequeño.
