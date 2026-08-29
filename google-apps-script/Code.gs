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

const HEADERS = ['Fecha', 'Tag Brawl Stars', 'Nombre', 'Año de nacimiento', 'Equipo', 'Categoría', 'Email', 'Teléfono', 'Comentarios'];

// Longitud máxima por campo. El endpoint /exec es público ("Cualquier
// usuario"), así que cualquiera puede hacer un POST directo sin pasar por el
// formulario de la web — esto evita que una sola fila pueda tener megas.
const MAX_LEN = 500;

/*
  Neutraliza la inyección de fórmulas ("CSV injection").

  Google Sheets interpreta como FÓRMULA cualquier celda cuyo texto empiece por
  =, +, - o @. Como el endpoint es público, alguien podía enviar un nombre como
    =HYPERLINK("http://sitio-malo.example","Pincha aquí")
  y esa celda se convertía en un enlace real en la hoja — peligroso sobre todo
  al descargarla como Excel, que es justo el flujo que describe la cabecera de
  este archivo.

  Anteponer un apóstrofo hace que Sheets trate el valor como texto literal. El
  apóstrofo no se ve al leer la celda, solo al editarla.
*/
function sanitizeCell(value) {
  let text = String(value == null ? '' : value);
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
  // \t, \r y \n al principio también pueden servir para colar una fórmula.
  if (/^[=+\-@\t\r\n]/.test(text)) return "'" + text;
  return text;
}

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  const p = e.parameter || {};
  sheet.appendRow([
    new Date(),
    sanitizeCell(p.playerTag),
    sanitizeCell(p.nombre),
    sanitizeCell(p.anioNacimiento),
    sanitizeCell(p.equipo),
    sanitizeCell(p.categoria),
    sanitizeCell(p.email),
    sanitizeCell(p.telefono),
    sanitizeCell(p.mensaje)
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
