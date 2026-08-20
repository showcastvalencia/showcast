# Arquitectura de Showcast

> Documento vivo — si tocas la arquitectura (nuevos endpoints, nuevos secretos, cambios en el modelo de datos de Megadraft...), actualiza este archivo en el mismo PR.

Showcast es una organización juvenil que organiza torneos de Brawl Stars en la Comunidad Valenciana. La web es **100% estática** (sin build, sin backend propio) más un subsistema en vivo, **Megadraft**, para hacer drafts de personajes con hasta 8 equipos conectados a la vez.

Este documento explica cómo encajan las piezas, por qué se tomaron ciertas decisiones y qué ha fallado ya una vez, para que la próxima persona que toque esto no tenga que redescubrirlo.

- **Repo**: `showcastvalencia/showcast`
- **Vivo en**: `showcastvalencia.github.io/showcast`
- **Stack**: HTML + CSS + JS sin build, Firebase Realtime Database, PHP, Google Apps Script

## Índice

1. [Qué es esto](#1-qué-es-esto)
2. [Mapa de archivos](#2-mapa-de-archivos)
3. [Hosting y despliegue](#3-hosting-y-despliegue)
4. [index.html — el sitio público](#4-indexhtml--el-sitio-público)
5. [content.js — todo el contenido en un solo objeto](#5-contentjs--todo-el-contenido-en-un-solo-objeto)
6. [admin.html — el editor visual](#6-adminhtml--el-editor-visual)
7. [Inscripciones — Google Apps Script](#7-inscripciones--google-apps-script)
8. [Proxy de la API de Brawl Stars](#8-proxy-de-la-api-de-brawl-stars)
9. [Qué es Megadraft](#9-qué-es-megadraft)
10. [Las 5 páginas de Megadraft](#10-las-5-páginas-de-megadraft)
11. [Modelo de datos de Megadraft](#11-modelo-de-datos-de-megadraft)
12. [Autenticación y reglas de seguridad](#12-autenticación-y-reglas-de-seguridad)
13. [Cronómetros y el flujo automático de fases](#13-cronómetros-y-el-flujo-automático-de-fases)
14. [Historial de partidas: cruce Challonge + Brawl Stars](#14-historial-de-partidas-cruce-challonge--brawl-stars)
15. [Problemas encontrados (y cómo se resolvieron)](#15-problemas-encontrados-y-cómo-se-resolvieron)
16. [Limitaciones conocidas (asumidas, no bugs)](#16-limitaciones-conocidas-asumidas-no-bugs)
17. [Dónde viven los secretos](#17-dónde-viven-los-secretos)
18. [Qué queda pendiente](#18-qué-queda-pendiente)

---

## 1. Qué es esto

La web tiene tres partes con propósitos muy distintos que conviven en el mismo repositorio:

**El sitio principal** — una landing page informativa (`index.html`) con inscripciones, galería, clasificaciones y contacto. Pensada para que alguien sin conocimientos técnicos pueda actualizar el contenido desde un panel visual (`admin.html`) sin tocar código.

**Megadraft** — una herramienta en vivo, tipo Kahoot, para hacer el draft de personajes de un torneo: hasta 8 equipos entran desde su móvil con un PIN, eligen 12 Brawlers cada uno por turnos, y una pantalla/proyector (o una salida OBS) muestra todo en tiempo real. Vive en `megadraft/` y es un subsistema autocontenido con su propio backend (Firebase).

**Historial de partidas** — cruza los resultados de Challonge (gestionado a mano, solo lectura por API) con el battlelog de Brawl Stars para mostrar qué Brawler usó cada equipo en cada partida real. Vive en `historial/`, comparte el proyecto Firebase de Megadraft pero es un subsistema independiente. Ver §14.

Las tres partes comparten el mismo dominio de GitHub Pages, la misma paleta visual y la carpeta `assets/`, pero no comparten código ni base de datos entre sí (salvo Megadraft e Historial, que sí comparten el proyecto Firebase). Se pueden entender por separado.

## 2. Mapa de archivos

```
/
├── index.html              # sitio público — landing + inscripciones
├── content.js               # todo el texto/imágenes del sitio, en un objeto JS
├── admin.html                # editor visual de content.js — NO está en git (ver §6)
├── assets/
│   ├── logo.png
│   ├── brawlers.json          # catálogo de 106 Brawlers para Megadraft
│   ├── brawlers/*.png          # iconos autoalojados de cada Brawler (ver §15)
│   └── uploads/*.jpg            # fotos subidas desde admin.html
├── proxy/
│   ├── brawlstars.php            # intermediario hacia la API oficial de Brawl Stars
│   ├── challonge.php              # intermediario hacia la API de Challonge (solo lectura)
│   ├── config.php                  # claves/credenciales de ambas APIs — NO está en git
│   ├── challonge-token-cache.json   # token OAuth2 de Challonge cacheado — NO está en git, se regenera solo
│   └── .htaccess                     # bloquea el acceso directo a config.php
├── google-apps-script/
│   └── Code.gs                      # recibe el formulario → fila en Google Sheets
├── megadraft/                        # subsistema del draft en vivo — ver §9
│   ├── index.html                     # portada: "soy capitán" / pantalla principal
│   ├── draft.html                      # vista del capitán (login por PIN + picks)
│   ├── admin.html                       # panel del organizador — con PIN de acceso
│   ├── screen.html                       # pantalla/proyector, solo lectura
│   ├── stream.html                        # salida 16:9 pensada para OBS
│   ├── megadraft.css                       # estilos propios del subsistema
│   ├── README-FIREBASE.md                   # cómo montar el proyecto Firebase desde cero (reglas de AMBOS: megadraft e historial)
│   └── js/
│       ├── firebase-config.js                 # claves públicas del SDK de Firebase
│       └── draft-logic.js                      # TODA la lógica compartida entre páginas
└── historial/                          # subsistema de historial de partidas — ver §14
    ├── index.html                       # pantalla pública: partidos por ronda, expandibles
    ├── admin.html                        # panel: vincular participantes, disparar el cruce
    ├── historial.css                      # estilos propios del subsistema
    └── js/
        ├── firebase-config.js               # mismo proyecto Firebase que Megadraft (showcast-md)
        └── historial-logic.js                # algoritmo de correlación Challonge ↔ Brawl Stars
```

No hay `package.json`, ni bundler, ni framework. Cada HTML carga sus `<script>` directamente por CDN o ruta relativa. Esto es deliberado: cualquiera puede abrir un archivo, editarlo y recargar la página sin instalar nada.

## 3. Hosting y despliegue

| Pieza | Dónde vive | Cómo se despliega |
|---|---|---|
| Sitio + Megadraft + Historial | GitHub Pages | push/merge a `main` → publicado solo, sin build |
| Proxy de Brawl Stars y de Challonge | VM propia de Google Cloud (`34.10.158.213.sslip.io`, instancia `e2-micro`) | manual — no forma parte de este repo git en producción |
| Base de datos Megadraft e Historial | Firebase Realtime Database (plan gratuito Spark) | proyecto `showcast-md`, reglas se publican a mano en la consola (mismo proyecto para los dos nodos, `/megadraft` y `/historial`) |
| Inscripciones | Google Apps Script + Sheets | se despliega a mano desde el editor de Apps Script |

> ⚠️ **GitHub Pages no ejecuta PHP.** Cualquier código de cliente que necesite llamar al proxy (`brawlstars.php`, `challonge.php`) tiene que usar la URL absoluta de la VM (`brawlProxyEndpoint`/`challongeProxyEndpoint` en `content.js`), nunca una ruta relativa tipo `../proxy/algo.php` — esa ruta relativa "funciona" en local con `php -S` (por eso el bug pasó desapercibido en pruebas locales) pero en producción GitHub Pages sirve el `.php` como texto plano en vez de ejecutarlo. Ver §14 para el caso real en el que esto pasó.

> ⚠️ **Acceso a la VM de Google Cloud**: consola de `console.cloud.google.com` → Compute Engine → Instancias de VM → botón **SSH** (terminal en el propio navegador, sin necesidad de clave ni de `gcloud` instalado). Para subir archivos nuevos, el icono ⚙️ de esa misma ventana SSH tiene un botón "Subir archivo". La carpeta del proxy en el servidor es `/var/www/html/proxy/`.

> ⚠️ **Ojo con la caché de GitHub Pages.** Después de fusionar un cambio, la CDN puede tardar 1–3 minutos (a veces más) en servir la versión nueva, aunque la Action de despliegue ya aparezca en verde. Antes de investigar un fallo tras un merge reciente, compara el contenido de `raw.githubusercontent.com/.../main/archivo` (siempre al día) contra lo que sirve el dominio `.github.io` — si difieren, es caché, no código.

## 4. index.html — el sitio público

Una única página de ~1700 líneas, sin router, dividida en secciones ancladas por `id`: `#top`, `#quienes-somos`, `#galeria`, `#evento`, `#inscripcion`, `#clasificaciones`, `#sobre-nosotros`, `#patrocinadores`, `#mapa`, `#unete`, `#contacto`. No hay JavaScript de "aplicación": la interactividad es puntual (formulario, galería, menú).

El HTML de cada sección es **estático** en el marcado, pero el texto que muestra se rellena en tiempo de carga desde `window.SHOWCAST_CONTENT` (definido en `content.js`, cargado antes de que `index.html` lo necesite). Si `content.js` desaparece o no carga, la página muestra los placeholders escritos a mano en el HTML como red de seguridad.

El formulario de inscripción envía por `fetch` a `formEndpoint` (el Apps Script, §7) y el buscador de jugador para "Clasificaciones" llama a `brawlProxyEndpoint` (el proxy PHP, §8) — ambas URLs también vienen de `content.js`, no están hardcodeadas.

## 5. content.js — todo el contenido en un solo objeto

Este archivo **es** el CMS. No hay base de datos para el sitio principal: todo el texto editable vive en un objeto JS que se versiona en git como cualquier otro archivo de código.

```js
window.SHOWCAST_CONTENT = {
  formEndpoint: "https://script.google.com/macros/s/.../exec",
  brawlProxyEndpoint: "https://34.10.158.213.sslip.io/proxy/brawlstars.php",
  evento: { titulo, juego, lugar, fecha },
  quienesSomos: { intro, pilares: [...] },
  galeria: [ { src, tipo: "foto"|"video"|"youtube", caption } ],
  equipo: [...], patrocinadores: [...],
  torneosOrganizados: [...], localidades: [...],
  contacto: { email, telefono, instagram, tiktok, youtube, whatsapp }
};
```

Un cambio de contenido es, literalmente, un commit que sobreescribe este archivo. Eso es lo que hace `admin.html` automáticamente por debajo (§6): nunca edita el DOM en producción, genera un `content.js` nuevo y lo publica vía la API de GitHub.

## 6. admin.html — el editor visual

> ⚠️ **Este archivo NO se sube a GitHub.** `.gitignore` lo excluye a propósito. Vive solo en local, en el ordenador de quien lo usa. **No se autoactualiza cuando se fusiona una PR** — si cambian los campos de `content.js`, hay que editar la copia local de `admin.html` a mano para que coincidan.

Es un formulario que refleja campo a campo la forma de `content.js` (título del evento, galería, equipo, patrocinadores, redes...). Al terminar de editar, el botón **"Publicar cambios"** no escribe directamente en `main`: usa la API REST de GitHub con un *Personal Access Token* pegado en el propio formulario para:

1. Leer el SHA de la punta de `main`.
2. Crear una rama nueva `admin-edit-<timestamp>`.
3. Si se han añadido fotos/vídeos nuevos en la galería, subirlos como archivos binarios (base64) a `assets/uploads/` en esa rama.
4. Escribir el `content.js` nuevo en esa rama.
5. Abrir una Pull Request de esa rama contra `main`.

Nunca hace commit ni merge directo — la persona que gestiona la web revisa y fusiona la PR desde GitHub, igual que cualquier otro cambio de código. Esto es intencional: da un punto de revisión humano entre "alguien edita el formulario" y "el cambio está en producción", sin que esa persona necesite saber usar git.

**Por qué está fuera de git**: el PAT de GitHub se pega en un `<input>` y se guarda en `localStorage` del navegador para no tener que volver a pegarlo cada vez. Es una herramienta interna de gestión de contenido, no algo pensado para visitantes. Mantenerlo fuera del repo público es más simple que añadirle autenticación.

## 7. Inscripciones — Google Apps Script

No hay base de datos para las inscripciones al torneo: el formulario de `index.html` hace un `POST` directo a un Google Apps Script desplegado como aplicación web, que añade una fila a una Google Sheet (`Fecha`, `Tag`, `Nombre`, `Edad`, `Equipo`, `Categoría`, `Email`, `Teléfono`, `Comentarios`).

El archivo `google-apps-script/Code.gs` de este repo es la **fuente de verdad versionada**, pero el despliegue real vive dentro de la interfaz de Google Apps Script (Extensiones → Apps Script, dentro de la Sheet) — pegar el contenido a mano y volver a "Implementar" es el único modo de actualizar el script en producción. El repo no lo despliega solo.

## 8. Proxy de la API de Brawl Stars

La sección "Clasificaciones" del sitio, y el sistema de puntuación de Megadraft, necesitan datos reales de un jugador (trofeos, victorias, rango ranked...) a partir de su tag. Esa consulta no puede hacerse directamente desde el navegador.

**Por qué**: la API oficial de Supercell exige una *API key* atada a una IP fija. Ponerla en JavaScript de cliente la dejaría visible para cualquiera que abra las herramientas de desarrollador — y esa clave, una vez filtrada, permitiría a cualquiera hacer peticiones en nombre de esta cuenta hasta que se revoque.

`proxy/brawlstars.php` resuelve esto viviendo en un servidor con IP fija (la VM en `34.10.158.213.sslip.io`), donde sí puede guardar la clave server-side, y expone un único endpoint:

```
GET /proxy/brawlstars.php?tag=8CG8LUJ
```

que valida el formato del tag, llama a la API oficial con la clave (guardada en `proxy/config.php`, fuera de git), y devuelve solo los campos que la web necesita — nunca la clave, nunca la respuesta cruda completa. También corrige el error de tecleo más común (una `O` en vez de un `0`) y limita el CORS a los orígenes de la propia web. Entre esos campos está `prestige` (mapeado desde `totalPrestigeLevel` de la respuesta real), usado por la insignia de prestigio del modal de verificación de tag — ver §15.

Tanto `index.html` (sección Clasificaciones) como `megadraft/js/draft-logic.js` (`fetchPlayerStats`, para calcular la puntuación de cada jugador) llaman al mismo endpoint. Es el único punto de contacto de todo el proyecto con la API oficial de Supercell.

## 9. Qué es Megadraft

Un subsistema completo, separado del sitio principal, para hacer en vivo la fase de draft de personajes de un torneo: 8 equipos, cada uno elige 12 Brawlers por turnos, sincronizado en tiempo real entre hasta ~10 dispositivos distintos (8 capitanes + pantalla + stream) sin que nadie tenga que refrescar nada a mano.

```
móvil capitán 1 ──┐
móvil capitán 2 ──┤
   ...     8    ──┼──→ Firebase Realtime DB ←── admin.html (organizador)
screen.html (proyector) ──┤   (única fuente de verdad,
stream.html (OBS)   ──┘     lectura pública, escritura con auth)
```

No hay servidor propio para Megadraft — cada página HTML habla directamente con Firebase Realtime Database desde el navegador. Se descartó explícitamente usar Cloud Functions para mantenerse en el plan gratuito "Spark" de Firebase; todas las reglas de negocio (de quién es el turno, si un personaje ya está cogido...) están en JavaScript de cliente + [reglas de seguridad de la base de datos](#12-autenticación-y-reglas-de-seguridad).

## 10. Las 5 páginas de Megadraft

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Cualquiera | Portada: enlace a "Soy capitán" o a la pantalla principal. |
| `draft.html` | Capitán de equipo | Entra con el PIN de 4 dígitos de su equipo, ve el pool y elige cuando es su turno. |
| `admin.html` | Organizador | Crea/edita los 8 equipos, arranca/pausa/reinicia el draft, controla cronómetros. Detrás de un PIN de acceso. |
| `screen.html` | Proyector de sala | Solo lectura: pool completo + los 8 equipos con sus picks, pensado para pantalla grande. |
| `stream.html` | OBS (retransmisión) | Layout 16:9 dedicado, más denso, con panel de "última elección" — pensado para overlay/escena de stream. |

Las cuatro páginas visibles al público (todas menos `admin.html`) cargan `js/draft-logic.js`, que concentra **toda** la lógica de negocio y de Firebase. Ninguna página reimplementa "de quién es el turno" o "cómo se calcula la puntuación" por su cuenta — todas llaman a las mismas funciones del objeto `MD` que expone ese archivo.

## 11. Modelo de datos de Megadraft

```
/megadraft/
  status: "config" | "drafting" | "complete"
  draftPhase: "prep" | "picking"
  draftOrder: [teamId, teamId, ...]      // 8 ids, peor → mejor puntuación
  currentPickIndex: 0..95                 // ronda = floor(idx/8)+1
  pickedBrawlers/{brawlerId}: teamId       // única fuente de qué está cogido
  timers/
    prep:  { duration, remaining, running, startedAt }
    pick:  { duration, remaining, running, startedAt,
             currentTeamId, perTeam: { teamId: segundos } }
  teams/{teamId}/
    name, logoUrl, pin, claimedBy,
    miembros: [ { nombre, tag, iconUrl, trophies,
                   victories3v3, rankedAllTimePeakElo, ... } ]
```

Dos decisiones de diseño no obvias:

- **Los picks de un equipo no se guardan en el equipo.** Se derivan siempre de `pickedBrawlers` (qué equipo tiene cada Brawler), que es la única fuente de verdad. Simplifica las reglas de seguridad y evita conflictos al reiniciar el draft.
- **La puntuación de equipo es la media, no la suma** de sus miembros (`MD.calcTeamScore`). Con suma, un equipo de 4 jugadores parecía siempre más fuerte que uno de 3 solo por tener un jugador más, sin reflejar su nivel real.

## 12. Autenticación y reglas de seguridad

No hay cuentas reales. Cada dispositivo se autentica de forma anónima contra Firebase Auth (`MD.signInAnon()`) — necesario para poder escribir cualquier dato, incluso desde páginas de "solo lectura" para las personas (ver el problema del auto-avance, §13).

El PIN de 4 dígitos no es autenticación real: es una capa de conveniencia. Al acertarlo, el `uid` anónimo de ese navegador se guarda en `teams/{id}/claimedBy`, "reclamando" ese equipo para que dos móviles no jueguen como el mismo equipo a la vez.

```json
// Reglas de Realtime Database (se pegan a mano en la consola de Firebase)
"megadraft": {
  ".read": true,
  "teams/$teamId/claimedBy": {
    ".write": "auth != null && (!data.exists() || data.val() == auth.uid || newData.val() == null)"
  },
  "...otros campos": { ".write": "auth != null" }
}
```

El detalle completo de las reglas está en [`megadraft/README-FIREBASE.md`](megadraft/README-FIREBASE.md).

**Qué NO protege esto (limitación asumida)**: un capitán con conocimientos técnicos podría, desde la consola del navegador, forzar un pick fuera de su turno saltándose la interfaz. La UI normal y la transacción de `submitPick` verifican correctamente el turno contra el estado del servidor, así que el uso normal del evento está cubierto — pero un participante decidido a hacer trampa manipulando la base de datos directamente podría lograrlo. Reglas más estrictas requerirían Cloud Functions (plan de pago). Para un torneo amistoso entre 8 equipos conocidos, se ha decidido que este nivel es suficiente.

## 13. Cronómetros y el flujo automático de fases

El requisito era que el organizador solo tuviera que pulsar **un botón** ("Iniciar sala") y todo lo demás ocurriera solo: un minuto de preparación (nadie puede elegir todavía) → arranca la cuenta atrás del primer equipo → al elegir, se resetea y arranca el siguiente equipo → así 96 veces.

**Cómo se calcula el tiempo sin gastar escrituras**: ningún cronómetro escribe en la base de datos cada segundo (eso costaría dinero/cuota a escala). En vez de eso, cada timer guarda solo `{duration, remaining, running, startedAt}` con `startedAt` como marca de tiempo del servidor. Cada pantalla calcula el tiempo restante en local con `MD.timerRemaining()`, comparando `Date.now()` contra `startedAt`. Un `setInterval` de 500ms solo actualiza el texto en pantalla, nunca la base de datos.

**Quién dispara el paso de "preparación" a "elección"**: no hay un servidor que vigile el reloj. En su lugar, **todas** las páginas conectadas (incluidas `screen.html` y `stream.html`, que antes eran de solo lectura) ejecutan `MD.maybeAdvancePrepPhase(state)` en su propio `setInterval`. La función comprueba si el tiempo de preparación ya llegó a cero y, si es así, escribe la transición. Es una escritura redundante e idempotente: la primera pestaña que lo detecta gana, todas las demás ven el estado ya actualizado y no hacen nada. Por eso `screen.html` y `stream.html` tuvieron que empezar a llamar a `MD.signInAnon()` aunque nadie interactúe con ellas — necesitan permiso de escritura para poder disparar ese cambio de fase si son la única pestaña abierta.

## 14. Historial de partidas: cruce Challonge + Brawl Stars

Un tercer subsistema, `historial/`, independiente de Megadraft aunque comparte su mismo proyecto Firebase. Diseño completo y contexto en [`CHALLONGE-API.md`](CHALLONGE-API.md) — este apartado es el resumen operativo.

**Qué hace**: Challonge sabe quién jugó contra quién y quién ganó; Brawl Stars sabe qué Brawler usó cada uno y en qué mapa. Ninguno de los dos sabe del otro. `historial/admin.html` cruza ambos por tiempo y por jugadores cuando el organizador pulsa **"Actualizar historial de partidas"** (nunca automático — ver el aviso de cuota en `CHALLONGE-API.md` §11), y guarda el resultado combinado en Firebase para que `historial/index.html` lo muestre al público.

**Challonge se sigue gestionando 100% a mano** en challonge.com — crear el torneo, dar de alta equipos, iniciar fases, reportar resultados. La API (via `proxy/challonge.php`) solo se usa para **leer**, nunca para escribir; es una decisión de diseño deliberada, no una limitación técnica.

**Autenticación de Challonge — OAuth2 Client Credentials, no una clave simple.** A diferencia de Brawl Stars (una sola clave JWT que se pega y ya está), Challonge migró su Developer Portal a `connect.challonge.com` y ya no permite generar una clave v1 suelta para aplicaciones nuevas. Hace falta:
1. Crear una "Application" en `connect.challonge.com` (ya hecha: **"Showcast — Historial de partidas"**, id `58701`) → da un `Client ID` + `Client Secret`.
2. `proxy/challonge.php` pide un token de acceso (`POST https://api.challonge.com/oauth/token`, `grant_type=client_credentials`) y lo cachea en `proxy/challonge-token-cache.json` hasta que caduca (~7 días), para no pedir uno nuevo en cada petición.
3. El scope por defecto del token ya es de solo lectura (`tournaments:read`, `matches:read`, `participants:read`...) — ni siquiera hace falta pedirlo explícitamente.

**Tres bugs reales encontrados al desplegar contra un torneo real** (no en desarrollo local, donde todo parecía funcionar):
- El endpoint de la API v2.1 es `/v2.1/tournaments/{id}.json` (**plural**) — parte de la documentación oficial de Challonge todavía muestra el singular (`/tournament/{id}.json`, heredado de v1), que devuelve 404 aunque el torneo exista.
- Falta la cabecera `Content-Type: application/vnd.api+json` en la petición `GET`, aunque no lleve cuerpo — sin ella, la API responde `415 Unsupported Media Type`.
- Un partido de la API v2.1 **no** tiene `player1_id`/`player2_id`/`scores_csv` (nombres heredados de v1 que aparecían en ejemplos de documentación) — usa `points_by_participant` (array de `{participant_id, scores}`) y la fecha de actualización va anidada en `timestamps.updated_at`. `historial-logic.js` tiene `matchParticipantIds()`/`matchUpdatedAt()` para normalizar esto.

**Modelo de datos** (nodo nuevo `/historial` en el mismo Firebase `showcast-md` de Megadraft, reglas en [`megadraft/README-FIREBASE.md`](megadraft/README-FIREBASE.md)):

```
/historial/{torneoSlug}/
  meta: { challongeTournamentId, nombre, actualizadoEn }
  participantes/{challongeParticipantId}: { nombre, tags: ["#XXXX", ...] }
  matches/{challongeMatchId}: {
    ronda, equipoA, equipoB, resultadoChallonge,
    juegos: [ { orden, battleTime, modo, mapa, duracion, ganador, picksEquipoA, picksEquipoB } ]
  }
  procesados/{challongeMatchId}: true
```

`juegos[].ganador` es `"equipoA"` / `"equipoB"` / `"empate"` / `null` — traducido de `battle.result` de Brawl Stars (`"victory"`/`"defeat"`/`"draw"`), que es la perspectiva del jugador cuyo battlelog se consultó, no dice directamente qué equipo ganó. Hay que mirar en qué lado estaba ese jugador para saberlo (`resultadoJuego()` en `historial-logic.js`).

La vinculación "qué participante de Challonge es qué equipo/tags de Brawl Stars" se hace a mano desde `historial/admin.html` (con pre-relleno automático si existe un equipo de Megadraft con el mismo nombre) — no se asume que el torneo tenga que venir de Megadraft.

**Emparejamiento automático**: sala amistosa (`type: "friendly"`) + coinciden **todos** los tags vinculados de cada equipo en el mismo lado de la batalla. Sin ventana de tiempo — se probó primero con un límite de ±30 min, pero era un número mágico frágil que no evitaba los falsos positivos reales (entrenos, revanchas con los mismos jugadores) y sí podía descartar partidas legítimas reportadas tarde. Al no ser infalible (dos equipos pueden jugar más de una sala amistosa entre sí), existen dos herramientas para lo que el automático no resuelva:

- **"Modo de prueba"** (checkbox en `historial/admin.html`): reprocesa partidos ya guardados, acepta cualquier tipo de sala (no solo `friendly`) y basta con que coincida **1** tag por equipo en vez de todos — pensado para poder probar el cruce con una partida real de ladder/ranked cualquiera, sin tener que montar una sala amistosa con la composición exacta del torneo. Muestra además un log de por qué cada batalla candidata encajó o no.
- **"Reajudicar partidos a mano"**: pantalla con vista dividida — a la izquierda el battlelog de un jugador (búsqueda por tag), a la derecha los juegos ya asignados a un partido elegido; arrastrar (drag-and-drop nativo del navegador) una batalla de la izquierda a la derecha la añade al partido, con botón para quitarla y otro para guardar. Sirve para corregir manualmente lo que el emparejamiento automático haya hecho mal.

**Un modo de juego con formato distinto, no soportado**: Duelo (1v1) no usa `battle.teams` (array de equipos) como el resto de modos — usa `battle.players`, una lista plana, con `brawlers` en **plural** por jugador porque se puede cambiar de personaje entre rondas. El proxy no lo normaliza (`teams` sale vacío para esas batallas) — decisión consciente: Duelo no es un modo que se vaya a jugar en el torneo y es poco jugado en general, así que no compensaba la complejidad. Si hiciera falta soportarlo, el código de referencia (sin desplegar) está en la PR #23.

**Diseño visual de la pantalla pública**: cada partido se despliega mostrando, por juego, a los jugadores de cada lado con su icono de Brawler (reutilizando `assets/brawlers.json`/`assets/brawlers/`, ver §15 "iconos no cargaban") en tarjetas cuadradas, con la imagen de marca `assets/VS.png` en el centro (antes era texto "VS" con contorno CSS; se sustituyó por el asset de diseño). El lado ganador de cada juego se resalta con un degradado de color desde el borde exterior hacia dentro (azul, con más alcance) y el perdedor con otro más tenue y de caída más rápida (rojo) — ambos calculados a partir de `juegos[].ganador`. La pantalla usa un listener de Firebase en tiempo real (`.on('value')`, no `.once()`) para que los partidos nuevos aparezan solos sin recargar mientras alguien tiene la pantalla abierta durante el evento.

**Reajudicación manual y `perspectivaTag`**: `battleToJuego()` necesita que la batalla lleve marcado `perspectivaTag` (el tag desde cuyo battlelog se consultó) para que `resultadoJuego()` pueda traducir `victory`/`defeat` a `equipoA`/`equipoB` — el cruce automático (`correlateMatch()`) lo añade solo. El flujo de arrastrar-y-soltar de "Reajudicar partidos a mano" también tiene que añadirlo explícitamente (con el tag escrito en el buscador) antes de llamar a `HD.battleToJuego()`, o el juego se guarda sin `ganador` — ver §15.

**Visor de perfil de jugador**: al pulsar sobre un jugador en `historial/index.html` se abre un modal con su perfil (icono, nombre, tag, prestigio, trofeos, victorias 3v3, ranked histórico/actual) — mismo contenido que el modal "¿Es esta tu cuenta?" de la página principal (§8), sin los botones de confirmación sí/no, consultado con `HD.fetchPlayer(tag)` (mismo proxy, sin `battlelog=1`). Para esto, `battleToJuego()` guarda ahora también el `tag` de cada jugador dentro de `picksEquipoA`/`picksEquipoB` (antes solo `jugador`/`brawler`) — los juegos guardados **antes** de este cambio no tienen ese `tag`, así que sus tarjetas no son clicables hasta que se reprocesen.

**Un 4º tag (suplente) por participante**: `historial/admin.html` muestra normalmente 3 campos de tag por participante (equipo 3v3), con un botón "+" para añadir un 4º opcional. Si un participante ya tenía 4 tags guardados de antes, se renderiza directamente con los 4 campos y sin el botón. No hace falta ningún cambio en la lógica de cruce — `battleMatchesTeams()` ya soporta cualquier número de tags vinculados por equipo.

## 15. Problemas encontrados (y cómo se resolvieron)

El historial real de bugs de este proyecto. Vale la pena leerlo antes de tocar la lógica de picks o el sistema de imágenes: son los sitios donde ya ha dolido una vez.

### 🔴 Alta — La transacción de `submitPick` fallaba con 2+ equipos activos

- **Síntoma**: en cuanto dos capitanes con `uid` distintos habían reclamado equipos distintos, el segundo pick fallaba con `permission_denied`.
- **Causa**: el código llamaba a `.transaction()` sobre el nodo *padre* (`megadraft` entero) para hacer el "leer-modificar-escribir" atómico de `currentPickIndex`. Firebase revalida las reglas de seguridad de **todo** el subárbol que la transacción toca — incluyendo campos hermanos sin cambios, como el `claimedBy` de equipos que ni siquiera estaban involucrados en ese pick, cuya regla condicional exige que coincida con el `uid` de quien escribe.
- **Arreglo**: se estrechó la transacción para que actúe **solo** sobre `currentPickIndex`, y todo lo demás (el pick en sí, el siguiente cronómetro) se escribe aparte con un `.update()` de rutas planas — el mismo patrón que ya usaba `admin.html` para guardar equipos. Regla general: nunca hacer `.transaction()` sobre un nodo más ancho de lo estrictamente necesario.

### 🟠 Media — Los iconos de Brawler no cargaban (brawlify.com bloqueaba las descargas)

- **Síntoma**: `curl` contra `brawlify.com/images/profile-icons/...` devolvía una página HTML de "Security Check" (desafío anti-bot de Cloudflare) en vez de la imagen, incluso con cabeceras de User-Agent y Referer. Extraerlo vía `<canvas>` en el navegador tampoco funcionaba ("tainted canvas", sin cabeceras CORS).
- **Arreglo**: el subdominio `cdn.brawlify.com/profile-icons/regular/{id}.png` —el mismo dominio que ya usa de forma fiable el proxy de Brawl Stars— no tiene esa protección. Se descargaron ahí los 106 iconos y se autoalojaron en `assets/brawlers/`, actualizando `brawlers.json` para apuntar a rutas relativas locales en vez de a brawlify.com.

### 🟡 Baja — Long-press en móvil sacaba el menú nativo del sistema

- **Síntoma**: al mantener pulsada una carta de Brawler en móvil, el sistema operativo mostraba su propio menú de selección/contexto por encima, en vez de nada.
- **Arreglo**: `-webkit-touch-callout:none; user-select:none; touch-action:manipulation;` en las cartas, `pointer-events:none; draggable="false"` en las imágenes dentro (el click lo captura el elemento padre).

### 🟡 Baja — Auth de Firebase no persiste entre localhost y producción

- **Síntoma**: probando en local (`npx serve` en `localhost:4173`) las escrituras fallaban con `PERMISSION_DENIED` aunque en producción funcionaban.
- **Causa**: Firebase Auth guarda la sesión anónima en `localStorage`, que es por origen. Una pestaña logueada en `https://showcastvalencia.github.io` no tiene sesión en `http://localhost:4173` — son orígenes distintos.
- **Arreglo**: no es un bug, es esperado. Al probar en local hace falta que la página llame a `MD.signInAnon()` igualmente.

### 🟡 Baja — El panel de admin no actualizaba el nombre al recomprobar un tag distinto

- **Síntoma**: si se cambiaba el tag de Brawl Stars de un miembro y se volvía a comprobar, el nombre de jugador se quedaba con el valor antiguo.
- **Causa**: el código solo asignaba el nombre nuevo si el campo estaba vacío: `if(!member.nombre.trim() && stats.name)`.
- **Arreglo**: sincronizar siempre que la API devuelva un nombre: `if(stats.name) member.nombre = stats.name;`

### 🔴 Alta — Subir `config.php` local a la VM borró la clave real de Brawl Stars de producción

- **Síntoma**: tras desplegar `proxy/challonge.php` a la VM (subiendo también `proxy/config.php` desde el repo local para añadir las credenciales de Challonge), el proxy de Brawl Stars empezó a fallar con "La API ha rechazado la clave" — incluso el endpoint de búsqueda de jugador, que llevaba meses funcionando.
- **Causa**: el `proxy/config.php` que existía en el entorno de desarrollo tenía una `BRAWL_API_KEY` distinta (autorizada para otra IP) a la que estaba realmente en producción. Al copiar el archivo local al servidor sin comprobar antes cuál era el vigente, se sobrescribió la clave correcta con una que no es válida para la IP de esta VM (`34.10.158.213`) — y no había ninguna copia de seguridad del `config.php` de producción en ningún sitio.
- **Arreglo**: las claves de Brawl Stars no desaparecen de la cuenta aunque se pierda el archivo — siguen listadas en `developer.brawlstars.com` hasta que se revocan. Se localizó ahí la clave cuyo `cidrs` coincidía con la IP de la VM (se puede comprobar decodificando la parte central del JWT en base64, sin librerías: contiene `{"cidrs": ["..."], "type": "client"}`) y se volvió a desplegar.
- **Lección para la próxima vez**: antes de sobrescribir `proxy/config.php` en el servidor, hacer `cp config.php config.php.bak` ahí mismo. Es un paso de 5 segundos que habría evitado todo esto.

### 🟡 Baja — El degradado ganador/perdedor no salía en algunos partidos (no era un bug de CSS)

- **Síntoma**: tras desplegar el campo `ganador` y su degradado azul/rojo, un partido reprocesado sí lo mostraba pero otro (con varios juegos) no mostraba nada — parecía un fallo intermitente del CSS o del cálculo.
- **Causa real**: `actualizarHistorial()` solo recalcula los partidos que **no** estén ya en `historial/{slug}/procesados`. Si se pulsa "Actualizar" **sin** marcar "Modo de prueba", cualquier partido ya procesado se salta por completo — se queda con los datos exactamente como estaban la última vez que sí se procesó, que en este caso era de antes de que existiera el campo `ganador`. No es que el degradado fallara para ese partido: es que ese partido nunca llegó a pasar por el código nuevo.
- **Complicación añadida al diagnosticarlo**: los "juegos viejos" de ese partido concreto incluían batallas donde el tag actualmente vinculado ya ni siquiera aparecía como participante — porque el battlelog de cada jugador solo guarda sus ~25 batallas más recientes de forma **independiente** (§12 de `CHALLONGE-API.md`), así que la misma batalla puede seguir visible en el log de un jugador (el que juega menos) y haber "caído" ya del de otro (el que juega más). Reprocesar con tags distintos a los de la vez anterior puede hacer que aparezcan/desaparezcan juegos aunque la batalla real no haya cambiado.
- **Arreglo**: no hay ningún cambio de código — es el comportamiento esperado de "Modo de prueba" (§14), solo que no era obvio desde fuera. Se reprocesó ese partido con la casilla marcada y el campo `ganador` se calculó bien.
- **Lección**: mientras se sigan ajustando la lógica de correlación o los tags vinculados, conviene tener "Modo de prueba" marcado al pulsar "Actualizar" — si no, partidos ya procesados quedan silenciosamente desactualizados sin ningún aviso en pantalla.

### 🟡 Baja — La reajudicación manual guardaba juegos sin `ganador` (sin degradado)

- **Síntoma**: un partido corregido a mano en "Reajudicar partidos" no mostraba el degradado ganador/perdedor en la pantalla pública, aunque el mismo tipo de batalla sí lo mostraba cuando la encontraba el cruce automático.
- **Causa**: el `drop` handler de `historial/admin.html` pasaba la batalla arrastrada directamente a `HD.battleToJuego()` sin el campo `perspectivaTag` que sí añade `correlateMatch()` en el cruce automático. Sin ese campo, `resultadoJuego()` no tiene forma de saber de qué jugador es la perspectiva de `battle.result` y devuelve `null`.
- **Arreglo**: el `drop` handler ahora clona la batalla con `Object.assign({}, battleRaw, { perspectivaTag: <tag del buscador> })` antes de pasarla a `battleToJuego()` — mismo patrón que el cruce automático. Los juegos que se hubieran guardado antes de este fix con este bug hay que volver a arrastrarlos para que se recalculen con el campo correcto (PR #28).

### 🟢 Nueva — Insignia de prestigio y sustitución del badge VS por assets de diseño

- **Prestigio**: la API real de Brawl Stars expone el total de prestigio de la cuenta como `totalPrestigeLevel` (no está documentado con ese nombre en ningún wrapper público de GitHub — se confirmó pegando una respuesta real de `GET /v1/players/{tag}` del usuario). El proxy lo reenvía como `prestige`; el modal "¿Es esta tu cuenta?" de `index.html` (verificación de tag en inscripción) muestra `assets/prestigio.webp` con el número superpuesto en blanco (con contorno oscuro para legibilidad sobre el icono).
- **VS.png**: el único badge gráfico de "VS" del sitio (entre los dos equipos de cada juego en `historial/index.html`) se sustituyó por `assets/VS.png` en vez de texto con `-webkit-text-stroke` — ver nota en §14.

## 16. Limitaciones conocidas (asumidas, no bugs)

- **El PIN de `megadraft/admin.html` es cosmético.** Es un código de 4 cifras fijo en el propio JavaScript del cliente, pensado solo para que no cualquiera con el enlace entre y toque el draft por error — no es seguridad real ante alguien que abra el código fuente.
- **Cualquier participante puede liberar el equipo de otro** desde la consola del navegador (la regla de `claimedBy` permite poner `null` a cualquier usuario autenticado, sin distinguir "admin" de "capitán"). Se aceptó porque diferenciar roles exigiría Cloud Functions.
- **Sin build ni tests automatizados.** Toda verificación de cambios es manual: abrir el navegador y probar. Los cambios grandes de Megadraft en este proyecto se han validado con drafts de prueba completos de 8 equipos / 96 picks antes de darlos por buenos.
- **`admin.html` (del sitio principal) no se auto-actualiza.** Si la forma de `content.js` cambia, hay que editar a mano la copia local de `admin.html` de cada persona que lo use — no hay ningún mecanismo que las mantenga sincronizadas.

## 17. Dónde viven los secretos

Nada de esto está en git. Si se pierde el ordenador que los tiene, hay que regenerarlos desde los paneles de cada servicio — no hay copia de seguridad centralizada. **Antes de sobrescribir `proxy/config.php` en el servidor, hacer una copia (`cp config.php config.php.bak`) — ver el incidente de §15.**

| Secreto | Vive en | Se usa para |
|---|---|---|
| Clave de API de Brawl Stars | `proxy/config.php` (excluido por `.gitignore`) | autorizar al proxy PHP frente a la API oficial |
| Client ID / Client Secret de Challonge | `proxy/config.php` (mismo archivo, excluido por `.gitignore`) | pedir tokens OAuth2 (Client Credentials) para `proxy/challonge.php` — la app se llama "Showcast — Historial de partidas" en `connect.challonge.com` |
| Token de acceso de Challonge (derivado, no una credencial "raíz") | `proxy/challonge-token-cache.json` (excluido por `.gitignore`) | cachear el token OAuth2 mientras no caduque (~7 días), regenerado solo si falta o caduca |
| Personal Access Token de GitHub | `localStorage` del navegador, pegado en `admin.html` | que el editor de contenido pueda abrir PRs |
| Config del SDK de Firebase | `megadraft/js/firebase-config.js` y `historial/js/firebase-config.js` (sí están en git, mismo proyecto `showcast-md`) | inicializar Firebase — **no es secreta**, es pública por diseño; la seguridad real la dan las reglas de la base de datos, no el secretismo de estas claves |
| PIN de `megadraft/admin.html` | hardcodeado en el JS del propio archivo | disuasión visual, no seguridad (§16) |

## 18. Qué queda pendiente

**Animación de revelado en `stream.html`**: el panel lateral de "última elección" en la vista de stream tiene una animación CSS provisional. Se decidió explícitamente esperar a los archivos oficiales del Fan Kit de Supercell (ilustraciones/gifs de personaje a tamaño grande) antes de construir la versión final — no hay que iterar más sobre esto hasta que esos assets lleguen.
