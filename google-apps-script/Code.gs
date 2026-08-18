/*
  SHOWCAST — Inscripciones a Google Sheets
  =========================================
  Este script recibe los envíos del formulario de inscripción de la web
  (index.html) y los guarda como filas nuevas en una Hoja de cálculo de
  Google, que se actualiza sola y puedes descargar como Excel (.xlsx)
  cuando quieras (Archivo → Descargar → Microsoft Excel).

  CÓMO DESPLEGARLO (una sola vez, ~5 minutos):
  1. Crea una Hoja de cálculo nueva en https://sheets.google.com
     (por ejemplo, "Showcast — Inscripciones").
  2. Dentro de la hoja: Extensiones → Apps Script.
  3. Borra el contenido de Code.gs que aparece por defecto y pega
     TODO el contenido de este archivo.
  4. Guarda (icono de disquete) y ponle un nombre al proyecto, ej.
     "Showcast Inscripciones".
  5. Pulsa Implementar → Nueva implementación.
     - Tipo: "Aplicación web".
     - Descripción: la que quieras.
     - Ejecutar como: tu cuenta (Yo).
     - Quién tiene acceso: "Cualquier usuario".
  6. Autoriza los permisos que te pida Google (es tu propio script).
  7. Copia la URL que te da ("URL de la aplicación web", termina en /exec).
  8. Pégala en content.js, en el campo "formEndpoint": "PEGA_AQUI_LA_URL".
  9. Cada vez que alguien se inscriba desde la web, aparecerá una fila
     nueva automáticamente en esta Hoja de cálculo.

  Si más adelante cambias los campos del formulario en index.html,
  actualiza también la lista HEADERS de abajo para que coincidan.
*/

const HEADERS = ['Fecha', 'Tag Brawl Stars', 'Nombre', 'Edad', 'Equipo', 'Categoría', 'Email', 'Teléfono', 'Comentarios'];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  const p = e.parameter || {};
  sheet.appendRow([
    new Date(),
    p.playerTag || '',
    p.nombre || '',
    p.edad || '',
    p.equipo || '',
    p.categoria || '',
    p.email || '',
    p.telefono || '',
    p.mensaje || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
