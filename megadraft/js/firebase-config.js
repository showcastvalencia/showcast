/*
  CONFIGURACIÓN DE FIREBASE
  ==========================
  1. Ve a https://console.firebase.google.com y crea un proyecto gratis
     (plan "Spark").
  2. Dentro del proyecto: Compilación → Realtime Database → Crear base de
     datos (elige "modo de prueba" para empezar; las reglas reales se
     configuran después, ver megadraft/README-FIREBASE.md).
  3. En Configuración del proyecto (⚙️) → General → baja hasta "Tus apps" →
     pulsa el icono "</>" para añadir una app web. No hace falta Hosting.
  4. Copia el objeto "firebaseConfig" que te da Firebase y pégalo aquí abajo,
     sustituyendo el de ejemplo.

  Estas claves son públicas por diseño (las usa el navegador del usuario):
  la seguridad real la dan las Reglas de la Realtime Database, no el
  secretismo de este archivo.
*/
const firebaseConfig = {
  apiKey: "AIzaSyAHADdP2DKlMv9VgIxSV4TeqsQt5dorNtg",
  authDomain: "showcast-md.firebaseapp.com",
  databaseURL: "https://showcast-md-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "showcast-md",
  storageBucket: "showcast-md.firebasestorage.app",
  messagingSenderId: "66291140388",
  appId: "1:66291140388:web:636453abf792dd73c015b1"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
