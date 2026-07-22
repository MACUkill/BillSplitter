// Kanoniczna matematyka rachunków żyje w ../functions/calc.js.
// DLACZEGO tam: Cloud Function deployuje TYLKO katalog functions/, więc wspólny
// moduł musi być w jego wnętrzu — dzięki temu front i backend liczą DOKŁADNIE
// tym samym kodem (jedno źródło prawdy, zero ryzyka rozjazdu). Vite spina to
// bez problemu przy buildzie frontu.
export * from '../functions/calc.js';
