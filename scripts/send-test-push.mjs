// Ręczna wysyłka testowego pushu (Faza 6.4/6.5) — zastępuje Cloud Function na czas testów.
// Wysyła payload DATA-ONLY, bo notyfikację buduje nasz service worker (public/sw.js).
//
// Wymaga klucza konta serwisowego projektu-piaskownicy (NIE trzymamy go w repo):
//   $env:GOOGLE_APPLICATION_CREDENTIALS='E:\secrets\...json'
//   node scripts/send-test-push.mjs <TOKEN_FCM> ["Tytuł"] ["Treść"]
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';

const [, , token, title, body] = process.argv;
if (!token) {
  console.error('Użycie: node scripts/send-test-push.mjs <TOKEN_FCM> ["Tytuł"] ["Treść"]');
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('Brak GOOGLE_APPLICATION_CREDENTIALS — wskaż plik klucza konta serwisowego.');
  process.exit(1);
}

// Wczytujemy jawnie, żeby błąd ścieżki był czytelny (a nie „default credentials not found").
let credential;
try {
  credential = cert(JSON.parse(readFileSync(keyPath, 'utf8')));
} catch (err) {
  console.error(`Nie mogę wczytać klucza z ${keyPath}: ${err.message}`);
  process.exit(1);
}

initializeApp({ credential });

const message = {
  token,
  data: {
    title: title || 'Przypomnienie o zaległości',
    body: body || 'Michał przypomina o 40,00 PLN. Już zapłaciłeś? Zapisz wpłatę.',
    url: '/',
    tag: 'billsplitter-nudge',
  },
  webpush: {
    // Wysoki priorytet — inaczej przeglądarka może odłożyć dostarczenie.
    headers: { Urgency: 'high', TTL: '3600' },
  },
};

try {
  const id = await getMessaging().send(message);
  console.log('Wysłano:', id);
} catch (err) {
  console.error('Błąd wysyłki:', err.code || '', err.message);
  process.exit(1);
}
