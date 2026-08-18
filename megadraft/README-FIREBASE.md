# Megadraft — configuración de Firebase

La Sala de Draft usa **Firebase Realtime Database** (plan gratuito "Spark") para sincronizar en vivo los picks entre los móviles de los 8 capitanes y la pantalla principal. Pasos para dejarlo funcionando:

## 1. Crear el proyecto (lo tienes que hacer tú — requiere tu cuenta Google)

1. Ve a https://console.firebase.google.com y pulsa "Crear un proyecto".
2. Ponle un nombre (ej. "showcast-megadraft"). No hace falta Google Analytics, puedes desactivarlo.
3. Dentro del proyecto: menú lateral → **Categorías de producto → Bases de datos y almacenamiento → Realtime Database → Crear base de datos**.
   - Ubicación: la más cercana (Europa).
   - Modo de inicio: "Modo de prueba" está bien de momento — las reglas reales se pegan en el paso 2 de este documento.
4. Menú lateral → **Categorías de producto → Seguridad → Authentication** → pestaña **"Sign-in method"** → habilita **"Anónimo"**. Es el único método de login que usa Megadraft (sin cuentas reales, cada capitán solo introduce el PIN de su equipo).
   - Nota: la consola de Firebase reorganiza este menú de vez en cuando. Si no ves "Categorías de producto", busca "Authentication" con la lupa de arriba a la izquierda ("Buscar productos").
5. Icono de engranaje (⚙️) → **Configuración del proyecto → General** → baja hasta "Tus apps" → pulsa el icono `</>` (Web) → dale un apodo → **Registrar app** (no hace falta Firebase Hosting).
6. Copia el objeto `firebaseConfig` que te muestra y pégalo en [`megadraft/js/firebase-config.js`](js/firebase-config.js), sustituyendo los valores de ejemplo.

Estas claves son públicas por diseño — las usa el navegador de cualquier visitante. La seguridad real la dan las **reglas** del siguiente paso, no el secretismo de estas claves.

## 2. Reglas de la Realtime Database

En la consola de Firebase: **Realtime Database → pestaña "Reglas"** → sustituye todo por esto → **Publicar**:

```json
{
  "rules": {
    "megadraft": {
      ".read": true,
      "teams": {
        "$teamId": {
          "claimedBy": {
            ".write": "auth != null && (!data.exists() || data.val() == auth.uid || newData.val() == null)"
          },
          "name": { ".write": "auth != null" },
          "logoUrl": { ".write": "auth != null" },
          "pin": { ".write": "auth != null" },
          "puntuacion": { ".write": "auth != null" },
          "miembros": { ".write": "auth != null" }
        }
      },
      "pickedBrawlers": { ".write": "auth != null" },
      "status": { ".write": "auth != null" },
      "draftOrder": { ".write": "auth != null" },
      "currentPickIndex": { ".write": "auth != null" }
    }
  }
}
```

**Qué protege esto:**
- Lectura pública (para que `screen.html` funcione sin que nadie tenga que loguearse).
- Solo un usuario autenticado (aunque sea anónimo) puede escribir.
- `claimedBy` (qué dispositivo controla cada equipo) solo lo puede fijar quien lo reclamó primero con el PIN — nadie puede "robar" el asiento de otro equipo, ni desde la consola del navegador. La única excepción es **liberarlo (ponerlo a `null`)**, permitido a cualquier usuario autenticado — es lo que usa el botón "Liberar equipo" de `admin.html` cuando un capitán se queda atascado en un dispositivo que ya no tiene (ver limitación más abajo).
- Los picks de cada equipo **no se guardan por equipo**: se derivan siempre de `pickedBrawlers` (qué equipo tiene cada personaje), que es la única fuente de verdad. Esto simplifica las reglas y evita conflictos de permisos al reiniciar el draft desde el panel de admin.

**Nota técnica**: el panel de administración (`admin.html`) escribe los datos de cada equipo con `update()` usando rutas completas (`teams/team1/name`, `teams/team1/pin`, etc.) en vez de sobrescribir todo el nodo `teams` de golpe — así cada ruta se valida por separado contra las reglas de arriba, que solo dan permiso a nivel de campo individual, no a nivel del equipo completo.

**Qué NO protege (limitación conocida y asumida):** que un capitán fuerce un pick fuera de su turno manipulando directamente la base de datos desde la consola del navegador, saltándose la interfaz. La lógica normal (botones de `draft.html`) y la transacción de `submitPick` en `js/draft-logic.js` ya verifican el turno correctamente contra el estado real del servidor — esto cubre el uso normal del evento. Tampoco protege que un capitán libere el equipo de OTRO equipo desde la consola (no solo el admin puede poner `claimedBy` a `null`) — no hay forma de distinguir "el admin" de "un capitán cualquiera" sin añadir un sistema de roles, que se ha descartado a propósito. Reglas más estrictas requerirían Cloud Functions (plan de pago Blaze), que también se ha descartado para mantener todo esto 100% gratuito. Para un torneo amistoso entre 8 equipos conocidos, este nivel es razonable.

## 3. Comprobar que funciona

1. Recarga `admin.html`, crea los 8 equipos y pulsa "Guardar equipos".
2. Abre `draft.html` en un par de pestañas distintas (o dispositivos), entra con dos PINs distintos.
3. Pulsa "Iniciar draft" desde `admin.html`.
4. Abre `screen.html` en otra pestaña y comprueba que los picks aparecen ahí en tiempo real según se van haciendo.
