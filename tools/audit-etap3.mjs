// Przebieg audytowy ETAPU 3: tryb rozliczania grupy i „rachunek po rachunku".
//
// DLACZEGO ISTNIEJE. Etap 3 dokłada trzeci tryb rozliczania, przypisywanie wpłat do
// rachunków i cztery nowe kawałki interfejsu, a cała logika w main.js trzyma się DOM
// przez `getElementById` i klasy-uchwyty. Testy jednostkowe pilnują matematyki
// (src/perbill.test.js), a kontrakt etykiet — istnienia identyfikatorów. Żaden z nich
// nie sprawdza, czy przycisk „Ureguluj" faktycznie zapisuje wpłatę z `billId` i czy
// druga osoba widzi ją jako spłatę TEGO rachunku. To robi ten przebieg.
//
// DWIE TOŻSAMOŚCI. Sedno trybu rachunkowego widać dopiero z dwóch stron naraz:
// płatnik pyta „kto już oddał", dłużnik odklikuje „Ureguluj". Logowanie jest anonimowe
// i przypisane do sesji przeglądarki, więc druga osoba to osobny kontekst przeglądarki.
//
// WYMAGA dwóch rzeczy uruchomionych obok:
//   npm run emulators
//   npx vite --port 5199 --strictPort
// a potem:
//   BILLIADA_URL=http://localhost:5199/ node tools/audit-etap3.mjs
//
// KOLEJNOŚĆ MA ZNACZENIE: `npm run test:rules` puszczaj PRZED tym przebiegiem albo po
// restarcie emulatorów — ten audyt zostawia w emulatorze prawdziwy pokój i rachunki,
// a testy reguł zakładają czystą bazę.
import puppeteer from 'puppeteer';

const ADRES = process.env.BILLIADA_URL || 'http://localhost:5173/';

const wyniki = [];
const sprawdz = (nazwa, warunek, szczegol = '') => {
  wyniki.push({ nazwa, warunek });
  console.log(`${warunek ? '  OK  ' : ' BŁĄD '} ${nazwa}${szczegol ? '  — ' + szczegol : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const bledy = [];
const nowaKarta = async (context) => {
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') bledy.push(m.text()); });
  page.on('pageerror', (e) => bledy.push('pageerror: ' + e.message));
  return page;
};

// Stuknięcie w przycisk po jego TREŚCI. Większość kontrolek etapu 3 powstaje w czasie
// działania i nie ma własnego identyfikatora — mają go tylko pojemniki.
const klikPoTresci = async (page, selektor, tekst) => {
  const uchwyt = await page.evaluateHandle((sel, txt) => {
    const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(txt));
    return el || null;
  }, selektor, tekst);
  const el = uchwyt.asElement();
  if (!el) throw new Error(`Nie znaleziono „${tekst}" wśród ${selektor}`);
  await el.click();
};

// STUKAJ, DOPÓKI NIE OTWORZY. Ekran rachunku pokazuje się ZANIM `renderBillScreen`
// skończy (jest asynchroniczny — czeka na kursy walut), a nasłuchy przycisków dopina
// dopiero na końcu. Pierwsze stuknięcie potrafi więc trafić w przycisk bez obsługi.
// To nie jest usterka aplikacji: człowiek nie zdąży stuknąć w tym oknie, a robot tak.
const klikAzOtworzy = async (page, przycisk, okno, prob = 8) => {
  for (let i = 0; i < prob; i++) {
    await page.click(przycisk);
    try {
      await page.waitForSelector(okno, { timeout: 1000 });
      return true;
    } catch (_) { /* jeszcze nie ma nasłuchu — próbuj dalej */ }
  }
  throw new Error(`Okno ${okno} nie otworzyło się po stuknięciu w ${przycisk}`);
};

const tekstem = (page, selektor) => page.$eval(selektor, (el) => el.textContent.trim()).catch(() => '');
const chwila = (ms) => new Promise((r) => setTimeout(r, ms));

// Czekanie na WARUNEK, nie na stały czas: zapisy idą przez Firestore i wracają
// nasłuchem, więc każde „poczekaj 300 ms" jest albo za krótkie, albo marnuje czas.
const czekajNa = async (page, fn, opis, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 });
    return true;
  } catch (e) {
    console.log(`        (nie doczekano: ${opis})`);
    return false;
  }
};

// KWOTA RACHUNKU, Z POWTÓRZENIEM. Pole kwoty zapisuje się przy utracie ogniska, a ekran
// rachunku przerysowuje się przy każdym cudzym ruchu — wpisanie potrafi więc trafić
// w moment przerysowania i przepaść. Człowiek zobaczy pustą kwotę i wpisze ją raz jeszcze;
// robot musi zrobić to samo, inaczej audyt raz na kilka przebiegów kłamie o regresji.
const wpiszKwote = async (page, kwota) => {
  for (let i = 0; i < 3; i++) {
    await page.click('#total-bill-amount', { clickCount: 3 });
    await page.type('#total-bill-amount', String(kwota));
    await page.click('#bill-name'); // odbierz ognisko, żeby zapis poszedł
    const ok = await czekajNa(
      page,
      () => (document.querySelector('#control-status') || {}).textContent?.includes('Nierozpisane'),
      'kwota rachunku zapisana',
      4000,
    );
    if (ok) return true;
  }
  return false;
};

// ---------------------------------------------------------------- Ala zakłada pokój
console.log('\n— 1. Pokój i rachunek —');
const alaContext = await browser.createBrowserContext();
const ala = await nowaKarta(alaContext);
await ala.goto(ADRES, { waitUntil: 'domcontentloaded' });
await ala.waitForSelector('#start-screen:not(.hidden)', { timeout: 20000 });

await ala.type('#group-name', 'Etap 3');
for (const imie of ['Ala', 'Bartek']) {
  await ala.type('#member-name-input', imie);
  await ala.click('#add-member-btn');
}
await ala.click('#create-group-btn');
await ala.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 20000 });
if (await ala.$('#join-screen:not(.hidden)')) {
  await klikPoTresci(ala, '#name-selection-list button', 'Ala');
  await ala.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
}
const groupId = new URL(ala.url()).searchParams.get('group');
sprawdz('pokój powstaje, Ala w środku', Boolean(groupId), 'kod ' + groupId);

// Rachunek: Ala wykłada 90, dzieli się po równo na dwie osoby → Bartek winien 45.
await ala.click('#create-new-bill-btn');
await ala.waitForSelector('#new-bill-modal.active', { timeout: 10000 });
await ala.type('#new-bill-name', 'Kolacja');
await ala.click('#confirm-create-bill-btn');
await ala.waitForSelector('#bill-screen:not(.hidden)', { timeout: 20000 });

// Nowy rachunek nie ma wskazanego płatnika — wskazujemy Alę, a potem potwierdzamy
// banerem, że to ona wyłożyła pieniądze. Bez tego rachunek nie tworzy ani jednego długu.
await klikAzOtworzy(ala, '#payer-select', '#choice-modal.active');
await klikPoTresci(ala, '#choice-options .choice-option', 'Ala');
// Wskazanie SIEBIE potwierdza płatnika w tej samej chwili (jedno okno, nie dwa),
// więc nie ma tu banera „Potwierdzam" — jest okno decyzji.
await ala.waitForSelector('#confirm-modal.active', { timeout: 10000 });
await ala.click('#confirm-ok-btn');
const kwotaZapisana = await wpiszKwote(ala, 90);
const platnikPotwierdzony = await czekajNa(
  ala,
  () => !document.querySelector('#payer-confirmation-banner-advanced').textContent.includes('Potwierdź'),
  'potwierdzenie płatnika',
);
sprawdz('rachunek ma potwierdzonego płatnika i kwotę', kwotaZapisana && platnikPotwierdzony);

// ------------------------------------------------------- tryb grupy w ustawieniach
console.log('\n— 2. Tryb grupy —');
await ala.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await ala.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });

const pigulkaPrzed = await tekstem(ala, '#balance-mode-pill');
sprawdz('domyślny tryb bez pola w bazie to „Najmniej przelewów"',
  pigulkaPrzed === 'Najmniej przelewów', pigulkaPrzed || '(pusto)');

await ala.click('#room-settings-btn');
await ala.waitForSelector('#room-settings-modal.active', { timeout: 10000 });
const ileOpcji = await ala.$$eval('#room-settlement-mode .room-mode-btn', (els) => els.length);
sprawdz('ustawienia pokoju dają trzy tryby do wyboru', ileOpcji === 3, `${ileOpcji} opcje`);

await klikPoTresci(ala, '#room-settlement-mode .room-mode-btn', 'Rachunek po rachunku');
const trybZapisany = await czekajNa(
  ala,
  () => document.querySelector('#balance-mode-pill') && document.querySelector('#balance-mode-pill').textContent.trim() === 'Rachunek po rachunku',
  'pigułka trybu na Bilansie',
);
sprawdz('pigułka na Bilansie mówi o nowym trybie', trybZapisany);
await ala.click('#close-room-settings-btn');

const podpisBilansu = await tekstem(ala, '#balance-caption');
sprawdz('podpis Bilansu liczy RACHUNKI, nie osoby',
  podpisBilansu.includes('rachunek') || podpisBilansu.includes('rachunki') || podpisBilansu.includes('rachunków'),
  podpisBilansu);

// Ala jest płatnikiem, więc na jej Bilansie stoi strona odbierania.
const planAli = await tekstem(ala, '#balance-plan-list');
sprawdz('Bilans płatnika mówi o zwrocie za rachunki', planAli.includes('Czekasz na zwrot za'), planAli.slice(0, 80));

// --------------------------------------------------------------- Bartek: druga osoba
console.log('\n— 3. Dłużnik oddaje za konkretny rachunek —');
const bartekContext = await browser.createBrowserContext();
const bartek = await nowaKarta(bartekContext);
await bartek.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await bartek.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 20000 });
if (await bartek.$('#join-screen:not(.hidden)')) {
  await klikPoTresci(bartek, '#name-selection-list button', 'Bartek');
  await bartek.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
}

const bartekWidziTryb = await czekajNa(
  bartek,
  () => document.querySelector('#balance-mode-pill') && document.querySelector('#balance-mode-pill').textContent.trim() === 'Rachunek po rachunku',
  'tryb grupy u drugiej osoby',
);
sprawdz('tryb ustawiony przez Alę dociera do Bartka', bartekWidziTryb);

// Filtr „Do oddania" z licznikiem.
await bartek.click('#nav-bills');
const licznik = await czekajNa(
  bartek,
  () => (document.querySelector('#bill-filter-owed-count') || {}).textContent === ' (1)',
  'licznik przy filtrze „Do oddania"',
);
sprawdz('filtr „Do oddania" liczy jeden rachunek', licznik,
  await tekstem(bartek, '#bill-filter-owed-count'));

await klikPoTresci(bartek, '.bill-filter-btn', 'Do oddania');
const wierszy = await bartek.$$eval('#bills-history-list .card', (els) => els.length);
sprawdz('po filtrze zostaje sam rachunek do oddania', wierszy === 1, `${wierszy} kafelków`);

// LISTA NIESIE SAM STATUS, BEZ KWOTY I BEZ PRZYCISKU (decyzja właściciela 2026-08-26).
// Kwota i „Ureguluj" mieszkają na ekranie rachunku, na limonkowej karcie.
const trescListy = (await tekstem(bartek, '#bills-history-list')).replace(/\s+/g, ' ');
sprawdz('kafelek niesie sam status „Nieopłacone"', trescListy.includes('Nieopłacone'), trescListy.slice(0, 90));
sprawdz('kafelek NIE niesie kwoty ani przycisku',
  !trescListy.includes('45,00') && !trescListy.includes('Ureguluj'), trescListy.slice(0, 90));

// Ukrywanie zeszło pod gest: przycisk istnieje w drzewie (dostępny klawiaturą
// i czytnikiem ekranu), ale leży za kartą, nie w rzędzie z treścią.
sprawdz('ukrywanie schowane za kartą, nie w rzędzie z treścią',
  Boolean(await bartek.$('#bills-history-list .bill-swipe-action')));
sprawdz('starego przycisku oka już nie ma',
  !(await bartek.$('#bills-history-list .hide-bill-btn')));

// Regulowanie WYŁĄCZNIE wewnątrz rachunku.
await bartek.click('#bills-history-list .card');
await bartek.waitForSelector('#bill-screen:not(.hidden)', { timeout: 20000 });
const naLimonce = await czekajNa(
  bartek,
  () => {
    const b = document.querySelector('#bill-settle-btn');
    return b && b.closest('.card-mine') && document.querySelector('#my-participant-card').contains(b);
  },
  '„Ureguluj" na limonkowej karcie',
);
sprawdz('„Ureguluj" stoi na limonkowej karcie „Twój udział"', naLimonce);

await bartek.click('#bill-settle-btn');
await bartek.waitForSelector('#settle-modal.active', { timeout: 10000 });
const notka = await tekstem(bartek, '#settle-record-note');
sprawdz('arkusz wpłaty mówi, KTÓREGO rachunku dotyczy', notka.includes('Kolacja'), notka);
const kwotaWpisana = await bartek.$eval('#settle-amount-input', (el) => el.value);
sprawdz('kwota podpowiedziana to udział z rachunku', kwotaWpisana === '45,00', kwotaWpisana);

await bartek.click('#settle-record-btn');
const znikaZListy = await czekajNa(
  bartek,
  () => (document.querySelector('#bill-filter-owed-count') || {}).textContent === '',
  'rachunek znika z „Do oddania"',
);
sprawdz('po wpłacie rachunek schodzi z listy do oddania', znikaZListy);

// UKRYWANIE SPOD GESTU + LICZNIK PRZY „Ukryte".
// Stuknięcie idzie przez `el.click()`, bo przycisk leży ZA kartą — palcem odsłania się
// go gestem, którego zdalne sterowanie nie odtworzy wiernie. Sprawdzamy tu skutek
// (zapis, licznik, pasek „Cofnij"), nie samą animację przesunięcia.
await bartek.click('#nav-bills');
await klikPoTresci(bartek, '.bill-filter-btn', 'Wszystkie');
await czekajNa(bartek, () => document.querySelector('#bills-history-list .bill-swipe-action'), 'przycisk ukrywania w drzewie');
await bartek.$eval('#bills-history-list .bill-swipe-action', (el) => el.click());
const licznikUkrytych = await czekajNa(
  bartek,
  () => (document.querySelector('#bill-filter-hidden-count') || {}).textContent === ' (1)',
  'licznik przy filtrze „Ukryte"',
);
sprawdz('ukrycie działa i filtr „Ukryte" pokazuje liczbę', licznikUkrytych,
  await tekstem(bartek, '#bill-filter-hidden-count'));
const jestCofnij = await bartek.evaluate(() => {
  const t = document.getElementById('toast-notification');
  return !!t && t.textContent.includes('Cofnij');
});
sprawdz('ukrycie da się cofnąć paskiem', jestCofnij);
// Przywracamy, żeby dalsza część przebiegu widziała rachunek.
await bartek.$eval('#toast-notification button', (el) => el.click());
await czekajNa(
  bartek,
  () => (document.querySelector('#bill-filter-hidden-count') || {}).textContent === '',
  'rachunek wrócił po cofnięciu',
);

// ------------------------------------------------------- Ala: kto już oddał + skrzynka
console.log('\n— 4. Płatnik widzi, kto oddał —');
const alaWidziWplate = await czekajNa(
  ala,
  () => document.querySelector('#nudges-badge') && !document.querySelector('#nudges-badge').classList.contains('hidden'),
  'odznaka wpłaty do potwierdzenia',
);
sprawdz('wpłata Bartka zapala odznakę u Ali', alaWidziWplate);

await ala.click('#nudges-bell');
await ala.waitForSelector('#nudges-modal.active', { timeout: 10000 });
const skrzynka = await tekstem(ala, '#nudges-list');
sprawdz('wiersz w skrzynce mówi, ZA CO jest wpłata', skrzynka.includes('Kolacja'), skrzynka.slice(0, 120));
await ala.click('#close-nudges-modal');

// „Kto już oddał" na ekranie rachunku.
await ala.click('#nav-bills');
await ala.waitForSelector('#bills-history-list .card', { timeout: 10000 });
await ala.click('#bills-history-list .card');
await ala.waitForSelector('#bill-screen:not(.hidden)', { timeout: 20000 });
const ktoOddal = await czekajNa(
  ala,
  () => {
    const el = document.querySelector('#bill-settle-section');
    return el && !el.classList.contains('hidden') && el.textContent.includes('Kto już oddał');
  },
  'sekcja „Kto już oddał"',
);
sprawdz('rachunek pokazuje płatnikowi, kto już oddał', ktoOddal);
const trescSekcji = await tekstem(ala, '#bill-settle-section');
sprawdz('Bartek jest odznaczony jako ten, który oddał',
  trescSekcji.includes('Bartek') && trescSekcji.includes('oddał'), trescSekcji.replace(/\s+/g, ' ').slice(0, 120));
sprawdz('licznik mówi „1 z 1"', trescSekcji.includes('1 z 1'));

// ----------------------------------------------------- wpłata bez przypisania
//
// SCENARIUSZ Z BRIEFU, odtworzony co do kwoty. Kółko długów zamknięte planem minimalnym:
// Bartek jest winien Ali, Ala jest winna Celinie, więc najkrótsza droga każe Bartkowi
// zapłacić CELINIE. Po przejściu grupy na tryb rachunkowy ta wpłata nie gasi ani jednego
// rachunku — Bartek nie ma z Celiną wspólnego rachunku. Nie wolno jej ukryć ani doliczyć
// do cudzego rachunku: ma wylądować w bloku „Wpłaty bez przypisania" i wejść do linii
// uzgadniającej, żeby Bilans i lista rachunków nie mówiły dwóch różnych rzeczy.
console.log('\n— 5. Wpłata bez przypisania (ślad planu minimalnego) —');

// Celina dochodzi do pokoju.
await ala.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await ala.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
await klikAzOtworzy(ala, '#room-settings-btn', '#room-settings-modal.active');
await ala.type('#room-add-member-input', 'Celina');
await ala.click('#room-add-member-btn');
await czekajNa(ala, () => (document.querySelector('#room-members-list') || {}).textContent?.includes('Celina'), 'trzecia osoba w składzie');
// Wracamy do trybu planu minimalnego — to w nim powstają wpłaty bez przypisania.
await klikPoTresci(ala, '#room-settlement-mode .room-mode-btn', 'Najmniej przelewów');
await czekajNa(ala, () => (document.querySelector('#balance-mode-pill') || {}).textContent.trim() === 'Najmniej przelewów', 'powrót do planu minimalnego');
await ala.click('#close-room-settings-btn');

// Rachunek Ali: Ala wykłada 60 za siebie i Bartka → Bartek winien Ali 30.
const dodajRachunek = async (page, nazwa, kwota, platnik, wyklucz = []) => {
  await page.click('#nav-room');
  await klikAzOtworzy(page, '#create-new-bill-btn', '#new-bill-modal.active');
  await page.type('#new-bill-name', nazwa);
  if (wyklucz.length) {
    await page.click('#edit-participants-btn-modal');
    await page.waitForSelector('#new-bill-people:not(.hidden)', { timeout: 5000 });
    for (const imie of wyklucz) await klikPoTresci(page, '#participants-checklist-modal .person-row', imie);
  }
  await page.click('#confirm-create-bill-btn');
  await page.waitForSelector('#bill-screen:not(.hidden)', { timeout: 20000 });
  await klikAzOtworzy(page, '#payer-select', '#choice-modal.active');
  await klikPoTresci(page, '#choice-options .choice-option', platnik);
  await page.waitForSelector('#confirm-modal.active', { timeout: 10000 });
  await page.click('#confirm-ok-btn');
  await wpiszKwote(page, kwota);
  await page.goto(`${ADRES}?group=${new URL(page.url()).searchParams.get('group')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
};

await dodajRachunek(ala, 'Taxi', 60, 'Ala', ['Celina']);

// Rachunek Celiny: Celina wykłada 60 za siebie i Alę → Ala winna Celinie 30.
const celinaContext = await browser.createBrowserContext();
const celina = await nowaKarta(celinaContext);
await celina.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await celina.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 20000 });
if (await celina.$('#join-screen:not(.hidden)')) {
  await klikPoTresci(celina, '#name-selection-list button', 'Celina');
  await celina.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
}
await dodajRachunek(celina, 'Hotel', 60, 'Celina', ['Bartek']);

// Bartek płaci planem minimalnym — a plan każe mu zapłacić CELINIE, nie Ali.
await bartek.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await bartek.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
const planKazeCelinie = await czekajNa(
  bartek,
  () => {
    const el = document.querySelector('#balance-plan-list');
    return el && el.querySelector('.plan-pay-btn') && el.textContent.includes('Celina');
  },
  'plan minimalny kieruje Bartka do Celiny',
);
sprawdz('plan minimalny prowadzi wpłatę Bartka do Celiny', planKazeCelinie);

await bartek.click('#balance-plan-list .plan-pay-btn');
await bartek.waitForSelector('#settle-modal.active', { timeout: 10000 });
await bartek.click('#settle-record-btn');
await czekajNa(bartek, () => !document.querySelector('#settle-modal').classList.contains('active'), 'wpłata zapisana');

// Grupa przechodzi na tryb rachunkowy — i wtedy ta wpłata nie ma czego zgasić.
await klikAzOtworzy(ala, '#room-settings-btn', '#room-settings-modal.active');
await klikPoTresci(ala, '#room-settlement-mode .room-mode-btn', 'Rachunek po rachunku');
await czekajNa(ala, () => (document.querySelector('#balance-mode-pill') || {}).textContent.trim() === 'Rachunek po rachunku', 'tryb rachunkowy');
await ala.click('#close-room-settings-btn');

const widziBlok = await czekajNa(
  bartek,
  () => (document.querySelector('#balance-plan-list') || {}).textContent?.includes('bez przypisania'),
  'blok „Wpłaty bez przypisania"',
);
sprawdz('wpłata poza parą ląduje w bloku „Wpłaty bez przypisania"', widziBlok);

const planBartka = (await tekstem(bartek, '#balance-plan-list')).replace(/\s+/g, ' ');
sprawdz('blok mówi, do kogo poszła i skąd się wzięła',
  planBartka.includes('do Celina') && planBartka.includes('Najmniej przelewów'), planBartka.slice(0, 160));
sprawdz('linia uzgadniająca rozpisuje działanie co do grosza',
  planBartka.includes('1 rachunek 30,00 PLN') && planBartka.includes('−30,00 PLN') && planBartka.includes('zostaje 0,00 PLN'),
  planBartka.slice(0, 200));

// ------------------------------------------------- podgląd cudzego trybu bez akcji
console.log('\n— 6. Cudzy tryb: podgląd bez przycisków —');
await ala.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await ala.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
await ala.click('#nav-settle');
await czekajNa(ala, () => document.querySelectorAll('.settle-mode-btn').length === 3, 'trzy segmenty');

const oznaczonyTrybGrupy = await ala.$$eval('.settle-mode-btn', (els) =>
  els.filter((e) => e.dataset.groupMode === 'true').map((e) => e.textContent.trim()));
sprawdz('tryb grupy jest oznaczony na przełączniku',
  oznaczonyTrybGrupy.length === 1 && oznaczonyTrybGrupy[0] === 'Rachunek po rachunku', oznaczonyTrybGrupy.join(', '));

const notaWTrybieGrupy = await tekstem(ala, '#settle-mode-note');
sprawdz('w trybie grupy nota mówi „Tak rozlicza się ta grupa"',
  notaWTrybieGrupy.includes('Tak rozlicza się ta grupa'), notaWTrybieGrupy);

await klikPoTresci(ala, '.settle-mode-btn', 'Kto komu');
await chwila(200);
const notaObok = await tekstem(ala, '#settle-mode-note');
sprawdz('w cudzym trybie nota mówi, że grupa umówiła się inaczej',
  notaObok.includes('grupa umówiła się inaczej'), notaObok);
const przyciskiWCudzymTrybie = await ala.$$eval('#settlements-list', (els) =>
  els[0] ? els[0].querySelectorAll('.settle-btn, .receive-btn, .nudge-btn, .receive-bill-btn, .open-owed-btn').length : -1);
sprawdz('cudzy tryb nie daje ANI JEDNEGO przycisku akcji',
  przyciskiWCudzymTrybie === 0, `${przyciskiWCudzymTrybie} przycisków`);

// ---------------------------------------------------------------------------- koniec
console.log('\n— 7. Konsola —');
// „Failed to load resource" przy odciętych zasobach zewnętrznych nie jest błędem apki.
const istotne = bledy.filter((t) => !/favicon|Failed to load resource/i.test(t));
sprawdz('brak nieoczekiwanych błędów w konsoli', istotne.length === 0, istotne.slice(0, 3).join(' | '));

await browser.close();

const ile = wyniki.filter((w) => w.warunek).length;
console.log(`\n${ile}/${wyniki.length} sprawdzeń przeszło.`);
process.exit(ile === wyniki.length ? 0 : 1);
