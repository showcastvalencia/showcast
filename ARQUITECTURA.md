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
14. [Problemas encontrados (y cómo se resolvieron)](#14-problemas-encontrados-y-cómo-se-resolvieron)
15. [Limitaciones conocidas (asumidas, no bugs)](#15-limitaciones-conocidas-asumidas-no-bugs)
16. [Dónde viven los secretos](#16-dónde-viven-los-secretos)
17. [Qué queda pendiente](#17-qué-queda-pendiente)

---

## 1. Qué es esto

La web tiene dos partes con propósitos muy distintos que conviven en el mismo repositorio:

**El sitio principal** — una landing page informativa (`index.html`) con inscripciones, galería, clasificaciones y contacto. Pensada para que alguien sin conocimientos técnicos pueda actualizar el contenido desde un panel visual (`admin.html`) sin tocar código.

**Megadraft** — una herramienta en vivo, tipo Kahoot, para hacer el draft de personajes de un torneo: hasta 8 equipos entran desde su móvil con un PIN, eligen 12 Brawlers cada uno por turnos, y una pantalla/proyector (o una salida OBS) muestra todo en tiempo real. Vive en `megadraft/` y es un subsistema autocontenido con su propio backend (Firebase).

Ambas partes comparten el mismo dominio de GitHub Pages, la misma paleta visual y la carpeta `assets/`, pero no comparten código ni base de datos. Se pueden entender por separado.

## 2. Mapa de archivos

```
/
├── index.html              # sitio público — landing + inscripciones
├── content.js               # todo el texto/imágenes del sitio, en un objeto JS
├── admin.html                # editor visual de content.js — NO está en git (ver §6)
├── assets/
│   ├── logo.png
│   ├── brawlers.json          # catálogo de 106 Brawlers para Megadraft
│   ├── brawlers/*.png          # iconos autoalojados de cada Brawler (ver §14)
│   └── uploads/*.jpg            # fotos subidas desde admin.html
├── proxy/
│   ├── brawlstars.php            # intermediario hacia la API oficial de Brawl Stars
│   ├── config.php                 # clave de API — NO está en git
│   └── .htaccess                   # bloquea el acceso directo a config.php
├── google-apps-script/
│   └── Code.gs                      # recibe el formulario → fila en Google Sheets
└── megadraft/                        # subsistema del draft en vivo — ver §9
    ├── index.html                     # portada: "soy capitán" / pantalla principal
    ├── draft.html                      # vista del capitán (login por PIN + picks)
    ├── admin.html                       # panel del organizador — con PIN de acceso
    ├── screen.html                       # pantalla/proyector, solo lectura
    ├── stream.html                        # salida 16:9 pensada para OBS
    ├── megadraft.css                       # estilos propios del subsistema
    ├── README-FIREBASE.md                   # cómo montar el proyecto Firebase desde cero
    └── js/
        ├── firebase-config.js                 # claves públicas del SDK de Firebase
        └── draft-logic.js                      # TODA la lógica compartida entre páginas
```

No hay `package.json`, ni bundler, ni framework. Cada HTML carga sus `<script>` directamente por CDN o ruta relativa. Esto es deliberado: cualquiera puede abrir un archivo, editarlo y recargar la página sin instalar nada.

## 3. Hosting y despliegue

| Pieza | Dónde vive | Cómo se despliega |
|---|---|---|
| Sitio + Megadraft | GitHub Pages | push/merge a `main` → publicado solo, sin build |
| Proxy de Brawl Stars | VM propia (`34.10.158.213.sslip.io`) | manual — no forma parte de este repo git en producción |
| Base de datos Megadraft | Firebase Realtime Database (plan gratuito Spark) | proyecto `showcast-md`, reglas se publican a mano en la consola |
| Inscripciones | Google Apps Script + Sheets | se despliega a mano desde el editor de Apps Script |

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

que valida el formato del tag, llama a la API oficial con la clave (guardada en `proxy/config.php`, fuera de git), y devuelve solo los campos que la web necesita — nunca la clave, nunca la respuesta cruda completa. También corrige el error de tecleo más común (una `O` en vez de un `0`) y limita el CORS a los orígenes de la propia web.

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

## 14. Problemas encontrados (y cómo se resolvieron)

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

## 15. Limitaciones conocidas (asumidas, no bugs)

- **El PIN de `megadraft/admin.html` es cosmético.** Es un código de 4 cifras fijo en el propio JavaScript del cliente, pensado solo para que no cualquiera con el enlace entre y toque el draft por error — no es seguridad real ante alguien que abra el código fuente.
- **Cualquier participante puede liberar el equipo de otro** desde la consola del navegador (la regla de `claimedBy` permite poner `null` a cualquier usuario autenticado, sin distinguir "admin" de "capitán"). Se aceptó porque diferenciar roles exigiría Cloud Functions.
- **Sin build ni tests automatizados.** Toda verificación de cambios es manual: abrir el navegador y probar. Los cambios grandes de Megadraft en este proyecto se han validado con drafts de prueba completos de 8 equipos / 96 picks antes de darlos por buenos.
- **`admin.html` (del sitio principal) no se auto-actualiza.** Si la forma de `content.js` cambia, hay que editar a mano la copia local de `admin.html` de cada persona que lo use — no hay ningún mecanismo que las mantenga sincronizadas.

## 16. Dónde viven los secretos

Nada de esto está en git. Si se pierde el ordenador que los tiene, hay que regenerarlos desde los paneles de cada servicio — no hay copia de seguridad centralizada.

| Secreto | Vive en | Se usa para |
|---|---|---|
| Clave de API de Brawl Stars | `proxy/config.php` (excluido por `.gitignore`) | autorizar al proxy PHP frente a la API oficial |
| Personal Access Token de GitHub | `localStorage` del navegador, pegado en `admin.html` | que el editor de contenido pueda abrir PRs |
| Config del SDK de Firebase | `megadraft/js/firebase-config.js` (sí está en git) | inicializar Firebase — **no es secreta**, es pública por diseño; la seguridad real la dan las reglas de la base de datos, no el secretismo de estas claves |
| PIN de `megadraft/admin.html` | hardcodeado en el JS del propio archivo | disuasión visual, no seguridad (§15) |

## 17. Qué queda pendiente

**Animación de revelado en `stream.html`**: el panel lateral de "última elección" en la vista de stream tiene una animación CSS provisional. Se decidió explícitamente esperar a los archivos oficiales del Fan Kit de Supercell (ilustraciones/gifs de personaje a tamaño grande) antes de construir la versión final — no hay que iterar más sobre esto hasta que esos assets lleguen.
