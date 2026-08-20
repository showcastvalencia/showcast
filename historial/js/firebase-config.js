/*
  CONFIGURACIÓN DE FIREBASE
  ==========================
  Mismo proyecto Firebase que ya usa Megadraft (megadraft/js/firebase-config.js)
  — es la misma organización, mismo plan gratuito "Spark", y este subsistema
  solo añade un nodo nuevo (/historial) al mismo proyecto en vez de crear uno
  aparte. Si el proyecto de Firebase cambiara alguna vez, actualiza los dos
  archivos a la vez.

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
