# Brief na następną sesję

Napisane 2026-08-05, zaktualizowane **2026-08-15** po siódmej partii (poprawki po
pierwszych testach na telefonie właściciela).
**Zacznij od tego pliku.** Potem `docs/UI-UX.md`, `DESIGN.md`, `PRODUCT.md`.

---

## Co zmieniło się 2026-08-15 (partia 7) — przeczytaj, zanim cokolwiek ruszysz

Pełny opis w `docs/UI-UX.md` §19. Tu tylko to, co zmienia sposób pracy z kodem:

- **Produkt nazywa się Billiada.** Klucze `localStorage` zostają z przedrostkiem
  `billsplitter_` i **nie wolno ich zmieniać** — to jedyny ślad po pokojach na urządzeniu.
- **Ręczny status uczestnika nie istnieje.** Rachunek ma `splitMode` (`'even'` / `'own'`),
  a gotowość liczy `participantReady`. Wartość `not_applicable` ZOSTAJE w bazie, bo na niej
  stoi wykluczanie z podziału w `functions/calc.js`.
- **Arkusze mają jedną budowę** (`sheet-head` / `sheet-body` / `sheet-foot`) i jedną regułę:
  uchwyt = zsuwa się palcem, krzyżyk tylko gdy w stopce nie ma „Anuluj", okno decyzji
  nieodwracalnej nie ma ani uchwytu, ani krzyżyka. Nie dokładaj klas `p-*` do `.sheet`.
- **Pułapka, która zabiła dwa odstępy:** reguła w `@layer` przegrywa z klasą narzędziową
  Tailwinda w znacznikach. Odstępy liczone z `env(safe-area-inset-bottom)` stoją poza
  warstwami. Objaw: przyciski tuż nad paskiem gestów iPhone'a.
- **View Transitions API zniknęło z aplikacji** i nie wraca (powody w §19.6).
- **`<select>` nie ma już ani jednego.** Każdy wybór jednokrotny idzie przez `openChoiceSheet`.
- `tools/audit-layout.mjs` odfiltrowuje teraz treść zwiniętego `<details>` i elementy
  wyprzewinięte poza kontener. Blok `AUDIT` w tym pliku jest szablonem znakowym: apostrof
  odwrotny w komentarzu wywala cały skrypt.

- **Animacja nowego rachunku: wariant „nad paskiem"** (`anim-sprout` na `#new-bill-modal`).
  Właściciel obejrzał oba na telefonie i wybrał ten. `anim-reveal` (rozwinięcie z koła)
  zostaje w `src/tailwind.css` jako druga opcja — **nie kasuj go**, podmiana to jedno
  słowo w znacznikach.
- **Odstępy od KAŻDEJ krawędzi liczą się z `env(safe-area-inset-*)`, nie tylko od dołu.**
  `viewport-fit=cover` wpuszcza treść pod wcięcie także u góry i po bokach. Pominięcie
  góry ucięło nagłówek na iPhonie 12.
- **`env(safe-area-inset-bottom)` w Safari NIE JEST STAŁE**: 0 przy rozwiniętym pasku
  adresu, 34 px po jego zwinięciu. Odległości od dolnej krawędzi bierz przez
  `max(własny odstęp, env(...))`, nigdy przez dodawanie — inaczej wszystko, co przypięte
  do dołu, skacze o 34 px przy każdym przewinięciu.
- **Pasek nawigacji NIE jest kompensowany względem paska przeglądarki — i nie wolno tego
  przywracać.** Element `position: fixed` z odległością od dołu jest na iOS **już**
  umieszczony nad paskiem Safari. Poprzednie podejście liczyło z JavaScriptu
  `clientHeight - visualViewport.height` („ile układu przykrywa pasek przeglądarki")
  i o tyle podnosiło nawigację. Efekt: na krótkich ekranach, gdzie nie ma czego przewijać,
  Safari nie może schować swojego paska, wartość zostaje na ~75 px i nawigacja stoi
  wyżej niż wszędzie indziej — stąd zgłoszenia „w zakładce Profil nawigacja jest wyżej".
  Wcześniejszy wariant tego samego wzoru wciągał jeszcze `visualViewport.offsetTop`
  i przy ciągnięciu strony w dół posyłał pasek w górę tym mocniej, im mocniej ktoś
  pociągnął. Cała mechanika usunięta 2026-08-16. Z API widocznego obszaru okna zostało
  **tylko wykrywanie klawiatury** (`watchKeyboardForDeck`, próg 140 px — mniej to pasek
  przeglądarki, więcej to klawiatura).
- **Token powiadomień zapisuje się PO wczytaniu pokoju, nie przy starcie.** Przy starcie
  nie wiadomo jeszcze, do której osoby w którym pokoju należy, więc zapis kończył się
  cichym wyjściem i nigdy nie był ponawiany — stąd „przypomnienia zadziałały raz, a potem
  przestały". Strażnik `pushTokenSavedFor` trzyma klucz `pokój:osoba:token`; nie zamieniaj
  go z powrotem na wartość logiczną, bo zapis w jednym pokoju zablokuje zapis w drugim.
- **`puppeteer` jest w `devDependencies`** i musi tam zostać: bez niego oba narzędzia
  audytowe padają na starcie. Audyt wymaga też **emulatorów Firebase** (`npm run emulators`)
  i serwera deweloperskiego — bez emulatorów anonimowe logowanie nie przechodzi
  i aplikacja nie wychodzi poza ekran wczytywania.
- **PRZEWIJA SIĘ `#app-scroll`, A NIE DOKUMENT — i to musi tak zostać.** `html` i `body`
  mają `height: 100%` oraz `overflow: hidden`; cała treść siedzi w jednym przewijanym
  kontenerze, a pasek nawigacji, okna i pasek offline stoją poza nim. Powód: w aplikacji
  uruchamianej z ikony na ekranie początkowym iPhone'a rozciąganie dokumentu na końcu
  przewijania obsługuje warstwa systemowa, która **`overscroll-behavior` na dokumencie
  ignoruje** — a to rozciąganie ciągnęło za sobą pasek nawigacji. W Safari i Firefoksie
  objawu nie było widać, bo tam gest obsługuje sama przeglądarka; zgłoszenie dotyczyło
  wyłącznie trybu z ikony. `overscroll-behavior-y` zostaje jako druga warstwa dla
  przeglądarek, które ją honorują.
- **NA iOS Z IKONY UKŁAD JEST KRÓTSZY O WYSOKOŚĆ GÓRNEGO WCIĘCIA — i to jest wyjaśnienie
  całej serii zgłoszeń o pasku nawigacji i o czarnym pasie na dole.** Przy
  `apple-mobile-web-app-status-bar-style: black-translucent` aplikacja dostaje cały ekran,
  ale blok, od którego liczą się wysokości i do którego przypina się `position: fixed`,
  zostaje krótszy o `env(safe-area-inset-top)` (na iPhonie 12 jakieś 47 px). Dlatego
  `inset: 0` kończył się nad dolną krawędzią, a pasek nawigacji stał za wysoko.
  Kompensacja stoi **na końcu `src/tailwind.css`, poza `@layer`** (w warstwie podstawowej
  przegrałaby z `.deck` z warstwy komponentów) i jest obwarowana dwoma warunkami:
  `@supports (-webkit-touch-callout: none)` plus `@media (display-mode: standalone)`.
  W przeglądarce i na Androidzie deficytu nie ma — tam ta poprawka wypchnęłaby układ
  poza ekran, więc nie wolno rozszerzać jej zasięgu.
- **Podgląd wymiarów okna: PIĘĆ STUKNIĘĆ w znak firmowy albo w numer pokoju** (albo
  `?diag=1` na komputerze). Pokazuje naraz `screen`, `inner`, `docEl`, widoczny obszar,
  wysokość kontenera, odległość paska od dołu i wcięcia bezpieczne. Różnica między
  `screen` a `inner` to dokładnie omawiany deficyt.
- **Pozycję przewijania czytaj i ustawiaj przez `#app-scroll`.** `window.scrollY` zwraca
  teraz zawsze zero, a `window.scrollTo` nic nie robi. W kodzie są do tego trzy pomocnicze
  funkcje: `appScroll`, `appScrollTop`, `appScrollTo`. To samo dotyczy **narzędzia
  audytowego** — mierzy zapas przewijania na tym kontenerze, nie na dokumencie.
- **Wskaźnik przewijania znika przy okazji.** Systemowego wskaźnika DOKUMENTU na iOS nie
  da się ukryć stylami; wskaźnik zwykłego kontenera już tak (`::-webkit-scrollbar`,
  `scrollbar-width`). To był drugi powód tej przebudowy.
- **Komentarze wewnątrz `AUDIT` w `tools/audit-layout.mjs` nie mogą zawierać znaku
  wstecznego** — cały blok jest literałem szablonowym i jeden taki znak rozwala skrypt.
- **NIE ustawiaj `touch-action` na `html` ani `body`.** Deklaracja na korzeniu dokumentu
  zabiera iOS **gest cofania przesunięciem od krawędzi**, czyli podstawową drogę wstecz
  na iPhonie. Przybliżanie szczypaniem blokuje atrybut `viewport` plus odrzucenie zdarzeń
  `gesture*` w `main.js` — i to wystarcza. `touch-action` zostaje wyłącznie na przyciskach
  (`manipulation`) oraz tam, gdzie sami obsługujemy gest: `.sheet` i `.room-swipe`.
- **Trzy piętra okien:** 50 okno z ekranu, 60 (`modal-over`) okno otwierane z innego okna,
  70 (`modal-top`) decyzja. Piętro wynika z tego, SKĄD okno się otwiera. Bez tego arkusz
  wyboru otwierał się pod arkuszem, który go wywołał.
- **Motyw domyślny jest ciemny** i nie idzie już za ustawieniem systemu. Jasny zostaje
  wyborem w zakładce „Ty".
- **Kolor znaku wybiera się DWOMA SUWAKAMI**, nie z zamkniętej palety. `members.X.color`
  przyjmuje teraz dowolny poprawny zapis szesnastkowy — nie dopisuj z powrotem
  sprawdzania przynależności do `IDENTITY_COLORS`, bo odrzuci własny wybór człowieka.
- **Litera na znaku dobiera kolor sama** (`readableInk`). Nie wpisuj `text-white` przy
  kolorze tożsamości: to jedno założenie trzymało wcześniej całą paletę w ciemnym paśmie
  i przez nie w aplikacji nie dało się mieć żółtego.
- **Listy są JEDNOKOLUMNOWE na każdej szerokości.** Siatka dwukolumnowa od 768 px została
  wycofana (`docs/UI-UX.md` §19.12) i nie wraca bez rozmowy z właścicielem.
- **Ikony PWA są plikami właściciela** (`public/icons/icon-*.png`). `tools/make-icons.mjs`
  ich NIE generuje — skaluje tylko przezroczysty znak do wnętrza aplikacji.
- **Po zmianie nazwy, ikon albo manifestu PODBIJ `CACHE` w `public/sw.js`.** Handler
  `activate` kasuje wszystkie pamięci o innej nazwie i to jedyny sposób, żeby telefon
  wyrzucił zasoby o niezmiennych nazwach. `manifest.json` i `/icons/*` idą teraz
  najpierw z sieci (`isIdentity` w `sw.js`), bo iOS bierze podpowiedź nazwy przy
  dodawaniu do ekranu początkowego z `short_name` w manifeście — a stary manifest
  z pamięci podręcznej podpowiadał starą nazwę mimo świeżej strony.
- **Skrót już dodany do ekranu początkowego NIE zaktualizuje się nigdy.** iOS zapisuje
  nazwę i ikonę w chwili dodania. Przy zmianie znaku trzeba usunąć skrót i dodać go
  ponownie — to nie jest usterka do naprawienia w kodzie.
- **Sondy badające ruch muszą wyłączyć tryb ograniczonego ruchu.** Chrome bez interfejsu
  zgłasza `prefers-reduced-motion: reduce` domyślnie, więc bez
  `page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])`
  sonda bada ścieżkę bez animacji i nic o niej nie mówi. Tak właśnie wyszło na jaw, że
  nadpisanie dla ograniczonego ruchu przegrywało specyficznością (`docs/UI-UX.md` §19.6.1).

Pole testowe z pięcioma wariantami zostaje w `docs/animacje-nowego-rachunku.html`.

---

## Stan faktyczny: co JEST, a czego NIE MA

### Jest (nie przerabiaj od zera)

- **System wizualny** — `DESIGN.md`: tokeny, skala ośmiu stopni, reguły nazwane, ruch.
  Świat przypięty referencjami z `Referencje/`. Detektor Impeccable pilnuje zgodności.
- **Znak własny** — żywy paragon, zbudowany i działa.
- **Reguła „jeden rachunek, który rośnie"** — w `calculateAll`, z testami.
- **Narzędzia audytowe** — `tools/audit-layout.mjs`, `tools/audit-buttons.mjs`.
- **Sieć asekuracyjna** — 164 testy jednostkowe + 32 testy reguł Firestore, kontrakt selektorów, strażnik escapowania, próg sygnału.
- **Komponenty wspólne** — `person-row` (wybór osób), `settings-row` (wiersz ustawienia),
  `choice-field` + `openChoiceSheet` (wybór jednokrotny, **zakaz `select`**), `filter-pill`,
  `openConfirm` (jedno okno decyzji nieodwracalnej), `inboxRowHtml` (sprawa w skrzynce).
  Kontrakt w `DESIGN.md` → „Wybór z listy" i „Dolna nawigacja".
- **Zero zależności od cudzych serwerów w buildzie** — kroje, ikony, QR i konwersja HEIC
  idą z paczek npm (§18). Nie dokładaj `<script src="https://…">`.

### ZAKRES — stan na 2026-08-06

Lista właściciela z 2026-08-05, ze statusem po wszystkich partiach.
Wykonanie opisane w `docs/UI-UX.md` §11–§16, decyzje w §10.

| # | Punkt | Stan |
|---|---|---|
| 1 | **Responsywność** — telefon, tablet, desktop | **zrobione**: kontrakt w `DESIGN.md`, audyt chodzi na 360/390/834/1280, siatka 2× od 768 px |
| 2 | **Powiadomienia w interfejsie** — kropki, odznaki, skrzynka | **zrobione** (partia 3, §13): próg z testami, odznaka tylko dla poziomu 1, kropka dla poziomu 2, skrzynka z dwoma segmentami |
| 3 | **Struktura ustawień** — profil / grupa / aplikacja | **zrobione** (partie 1 i 4, §14): profil, aplikacja i pełne ustawienia pokoju ze składem, QR, walutą i opuszczeniem |
| 4 | **Rozliczenia jako osobne miejsce** | **zrobione** — zakładka „Kto komu ile" |
| 5 | **Rachunki z filtrowaniem** | **zrobione** (partia 2, §12): pigułki, nagłówki dni, licznik nad listą, stany puste z powodem |
| 6 | **Historia zmian** | **zrobione** (partia 6, §16): kolekcja events append-only, historia na ekranie rachunku i w Skrzynce |
| 7 | **Własne szablony przypomnień** | **zrobione** (partia 6, §16): kompozytor z domyślną rzeczową treścią, do pięciu szablonów na urządzeniu |
| 8 | **Morfowanie [+] w arkusz** | **zrobione** (View Transitions API) |
| 9 | **Nawigacja na każdym ekranie, zakładki jako miejsca** | **zrobione** (partia 1) |

**Zakres redesignu jest domknięty.** Sześć partii, każda zamknięta audytem i testami;
wykonanie opisane w `docs/UI-UX.md` §11–§16.

**Co zostaje otwarte:**

1. ~~Nazwa produktu i logo~~ — **ZAMKNIĘTE 2026-08-15**: produkt nazywa się **Billiada**,
   znak to koń trojański (`logo/billiada-logo.png`). Wcześniejszy wymóg
   „nazwa musi być angielska" właściciel unieważnił własnym wyborem.
2. **Font Awesome** — ikony do wymiany na własny zestaw (§6). Nie blokuje niczego.
3. **Konta zamiast tożsamości przypiętej do urządzenia** — domknęłoby ryzyko podmiany
   cudzego numeru konta ORAZ granicę prywatności treści przypomnień (reguły Firestore
   nie ukryją pojedynczego pola przed resztą grupy).
4. **Zdjęcia po przekroczeniu 4,5 GB** — świadomie odłożone do wersji monetyzacyjnej.
5. **Wybór animacji nowego rachunku** — pole testowe w `docs/animacje-nowego-rachunku.html`.
6. **Odczyt paragonu na wydanej wersji** — na zrzucie właściciela z 2026-08-15 usługa
   zwróciła **401**. To nie jest usterka interfejsu: funkcja `parseReceipt` odpowiada
   „brak autoryzacji" po stronie OpenRoutera, czyli sekret w Secret Managerze projektu
   `billsplitter-push-test` jest nieważny albo wyczerpany. Do sprawdzenia kluczem, nie kodem.

**Research — obowiązkowy, nie opcjonalny.** Właściciel powiedział
    wprost 2026-08-05: *„nie jestem bogiem co wie wszystko; stworzyłem aplikację, która
    ma solidne podstawy, ale trzeba ją obrać w świetne szaty"*. Czyli: fundament
    produktowy jest jego i jest dobry, a **warstwa doświadczenia należy do ciebie
    i masz jej szukać na zewnątrz**.

    Gdzie patrzeć: aplikacje do dzielenia rachunków (Splitwise, Tricount, Settle Up),
    **aplikacje bankowe** (bo to od nich ludzie mają nawyki wokół kwot, przelewów
    i potwierdzeń) oraz dowolne inne produkty, które robią daną rzecz najlepiej —
    onboarding, puste stany, powiadomienia, arkusze, listy transakcji.

    Nie kopiuj układów. Wyciągaj **rozwiązania problemów**, sprawdzaj je przeciwko
    `PRODUCT.md` i przynoś właścicielowi propozycje z uzasadnieniem. Sugerowanie się
    konkurencją jest tu jawnie dozwolone.

---

## Jak podejść

Właściciel prosi wprost o pracę **pipeline'owo, jak zespół UI/UX w Apple**, i o pytanie
go, gdy trzeba coś rozstrzygnąć albo przeprowadzić burzę mózgów.

Sugerowana kolejność:

1. **Research i inwentaryzacja** — konkurencja, wzorce PWA, powiadomienia. Wykorzystaj
   wtyczki `impeccable` i `ui-ux-pro-max`. Wynik: rozdział w `docs/UI-UX.md`.
2. **Architektura informacji** — pełna mapa: ekrany, zakładki, ustawienia, przepływy,
   stany puste, powiadomienia. Zatwierdź z właścicielem PRZED kodem.
3. **Responsywność jako kontrakt** — punkty łamania, co się dzieje z każdym układem
   na tablecie i desktopie. Dopisz do `DESIGN.md`.
4. **Budowa partiami**, każda zamknięta audytem i testami.
5. **Weryfikacja** — oba przebiegi audytowe na wszystkich szerokościach + detektor.

---

## Z `PRODUCT.md` — wiąże redesign, łatwo przeoczyć

Nie przepisuję całego pliku; to są punkty, które realnie zmieniają decyzje projektowe,
a nie wynikają z niczego innego.

**Znany błąd PWA na iPhonie.** Skrót z ekranu początkowego otwiera ekran startowy zamiast
pokoju. Dwie przyczyny: `manifest.json` ma `start_url: "/"`, które na iOS 16.4+ wygrywa
z adresem bieżącej strony, oraz osobny magazyn danych aplikacji ze skrótu — lista pokoi
zapisana w Safari jest tam niewidoczna. Naprawa warstwowa: **kod pokoju i QR jako pewnik**,
dynamiczny manifest jako eksperyment do potwierdzenia na telefonie. Ma znaczenie tym
większe, że planowane jest wydanie natywne.

**Świadomie otwarte ryzyko:** członek grupy może podmienić cudzy numer konta. Dotyczy
zaufania, więc warto się do niego odnieść przy projektowaniu ustawień grupy. To jedyne
z otwartych ryzyk, które wchodzi do redesignu.
*(Automatyczne kasowanie najstarszych zdjęć po przekroczeniu 4,5 GB — właściciel uznał
2026-08-05 za nieistotne na tym etapie, do ogarnięcia dopiero przy wersji do monetyzacji.
Ekrany ustawień nie mają się do tego odnosić — nie dokładaj tam licznika ani ostrzeżenia
o kasowaniu.)*

**Waluty.** PLN / EUR / USD, kurs zapisywany w dniu dodania rachunku, waluty **nigdy się
nie mieszają** w jednym saldzie. Zbiorcze saldo mieszające waluty jest jawnie poza zakresem.

**Przypomnienia: bramka to dziesięć sekund, nie sześć godzin** (decyzja właściciela
2026-08-05, zmienione w kodzie). Blokujemy wyłącznie walenie w przycisk co sekundę.
Dobijanie się o zwrot pieniędzy bywa zabawne i jest sprawą dwóch osób — produkt ma
domykać dług, a nie chronić dłużnika przed wierzycielem. Projektując własne szablony
wiadomości, **nie dokładaj limitów, których nie ma**.

**Zdjęcia paragonu:** najwyżej pięć na rachunek, także HEIC z iPhone'a, licznik miejsca.

**Rozmiar grupy 12–25 osób jest kryterium projektowym.** Listy, awatary i przypisywanie
pozycji muszą działać przy tej skali, nie przy czterech osobach.

**Scena marginalna:** współlokatorzy i koszty cykliczne. Długo żyjący pokój ma działać
przyzwoicie, ale **nie jest kryterium projektowym** — nie projektuj pod niego.

**Dostępność** — brak wymogu formalnego, ale warunki użycia narzucają minimum: obsługa
jedną ręką, cele dotykowe znoszące stuknięcie w biegu, czytelność przy słabym świetle
w lokalu, kontrast na telefonie trzymanym pod kątem.

**Czego nie wolno wymyślać:** brak opinii użytkowników, danych o użyciu, materiałów
prasowych, logo i zdjęć produktowych. Nic z tej listy nie powstaje „na potrzeby makiety".

**Funkcje do zachowania w całości** — pełna lista jest w `PRODUCT.md` w sekcji
„Capabilities and Constraints". Przejrzyj ją przed przebudową struktury: łatwo zgubić
„nie dotyczy", ukrywanie rachunków, dzielenie pozycji na sztuki, cofanie usunięcia
rachunku albo listę „Twoje pokoje".

---

## Do sprawdzenia na starcie

**Odczyt paragonu przez AI — NAPRAWIONE 2026-08-06.** Przyczyna leżała poza kodem
funkcji: aplikacja w dev bierze projekt z .env.local (billsplitter-push-test), a emulatory
startowały na projekcie domyślnym z .firebaserc (billsplitter-2fdfa). Emulator funkcji
routeuje po identyfikatorze projektu W ADRESIE, więc wywołanie parseReceipt trafiało pod
/billsplitter-push-test/... i wracało 404 (w przeglądarce widoczne jako błąd CORS).
Naprawa: skrypt npm run emulators startuje z --project test. Klucz OPENROUTER_API_KEY
leży w functions/.secret.local i jest na miejscu.

---

## Ostrzeżenia z doświadczenia tej sesji

- **PowerShell psuje polskie znaki** przy `Get-Content -Raw` / `Set-Content` bez jawnego
  kodowania. Używaj `[System.IO.File]::ReadAllText(path, [System.Text.UTF8Encoding]::new($false))`
  i tak samo przy zapisie. Raz zepsuło to cały `index.html`.
- **Okna Chrome nie da się zwęzić** przez rozszerzenie — viewport trzyma 1920.
  Układ telefonowy oglądaj wyłącznie przez `tools/audit-layout.mjs`.
- **Bez emulatorów aplikacja pokazuje pusty ekran** — logowanie anonimowe pada.
- **Nie zmieniaj stylu resztek po starym świecie — kasuj je.** Paski mikrodruku
  przetrwały wymianę świata, bo dostały nowy styl zamiast usunięcia.

---

## Wydanie dla znajomych — stan i co zostało

**Aplikacja JEST wydana.** Gałąź `BillSplitterV2` idzie jako branch deploy Netlify na
`billsplitterv2--groupbillsplitter.netlify.app`, spięty z projektem `billsplitter-push-test`
(Blaze). V1 stoi obok na `main` → `groupbillsplitter.netlify.app` → `billsplitter-2fdfa`.
Wydanie nowej wersji = **wypchnięcie gałęzi**; Netlify sam buduje (`netlify.toml`).

Dlatego **nie ma sekcji `hosting` w `firebase.json`** — hosting robi Netlify, a
dublowanie go w Firebase groziłoby dwiema równoległymi wersjami pod różnymi adresami.
Firebase odpowiada wyłącznie za dane: Firestore, Storage, Functions, Auth, FCM.

### Który projekt

`billsplitter-push-test` i nie ma powodu tego zmieniać. Ma Blaze, klucz VAPID,
CORS na buckecie, sekret OpenRoutera w Secret Managerze i limity wydatków. Piaskownicą
nazywa się historycznie — dla wersji dla znajomych jest to po prostu projekt V2.

**Konfiguracja siedmiu zmiennych `VITE_*` żyje w Netlify** (scope: Specific deploy
contexts → BillSplitterV2), nie w repo. Bez nich build wpada w hardkodowany fallback na
projekt V1 z `src/main.js` — cicho, bo aplikacja wygląda identycznie. Lokalny
`.env.local` służy wyłącznie pracy na tej maszynie i nie trafia do gita.

### Wydanie 2026-08-06 — zrobione

Gałąź `BillSplitterV2` wypchnięta (19 commitów redesignu), Netlify przebudował.
Sprawdzone na żywym adresie `billsplitterv2--groupbillsplitter.netlify.app`:

- nowy build jest na serwerze (pole „Masz kod pokoju?" obecne w HTML),
- **zero adresów CDN** — ikony idą z `/assets/fa-solid-900-*.woff2` (119 kB, HTTP 200),
- przepisanie SPA działa (dowolna ścieżka → 200), `sw.js` z `Cache-Control: no-cache`,
- manifest ma kolory nowego świata (`#0C0D11`),
- bundle celuje w `billsplitter-push-test` (zmienne `VITE_*` z Netlify zadziałały,
  fallback na projekt V1 pozostał martwą gałęzią).

Na `billsplitter-push-test` wdrożone:

- `firestore.rules` i `storage.rules` z repo — w tym reguły kolekcji `events`
  (dopisywalna, niezmienna), bez których dziennik aktywności nie działa,
- funkcje `parseReceipt`, `recalculateGroupSummaryIncrementally`, `sendNudgePush`.

Powtórka po każdej zmianie reguł albo funkcji:

```bash
firebase deploy --only firestore:rules,storage --project test
firebase deploy --only functions --project test
git push origin BillSplitterV2   # samą aplikację wydaje Netlify
```

### Dwie gałęzie, dwa projekty — i pułapka przy scalaniu

Plan właściciela (2026-08-06): `main` trzyma **żywą, stabilną V1**, a `BillSplitterV2`
służy do testów ze znajomymi. Scalenie V2 na `main` dopiero długo po testach.

Stan gałęzi: V2 jest 63 commity przed `main`, `main` nie ma nic, czego V2 nie zna —
scalenie pójdzie czystym fast-forwardem.

**Migracja danych: ROZSTRZYGNIĘTE — nie robimy jej wcale.** Właściciel zdecydował
2026-08-06: stare pokoje, rachunki i rozliczenia są **do wyrzucenia**. Po testach V2
przejmuje wszystko, a V1 przestaje istnieć jako wersja, o którą się dbamy. Nie planuj
eksportu Firestore, nie pisz skryptów przenoszących, nie proponuj okna „przenosin".

Konsekwencja praktyczna, wygodna: testy ze znajomymi mogą iść od razu, bez żadnej decyzji
z góry. Dane w `billsplitter-push-test` są jawnie nietrwałe — gdy przyjdzie cutover,
ekipa po prostu zaczyna od nowa i wolno im to powiedzieć wprost.

**Scalenie V2 na `main` robi WYŁĄCZNIE właściciel, ręcznie i w dalekiej przyszłości.**
To nie jest zadanie do wykonania przez asystenta, nawet gdy testy wypadną dobrze i nawet
gdy wszystko jest zielone. Pracujemy na `BillSplitterV2`; `main` zostaje nietknięty.

Jedyne, co przy cutoverze naprawdę trzeba zrobić po stronie konfiguracji: **kontekst
produkcyjny Netlify musi dostać zmienne `VITE_*` projektu docelowego**. Bez nich build
wpada w hardkodowany fallback na `billsplitter-2fdfa` — cicho, bo aplikacja wygląda
identycznie.

**Reguły są per PROJEKT, nie per gałąź.** Wgranie `firestore.rules` z repo na
`billsplitter-2fdfa` częściowo zepsuje żywą V1 (kasowanie rachunku tylko przez
potwierdzonego płatnika, zamrożony `adminId`, zamknięte pola podsumowań). Robić to
dopiero przy wycofywaniu V1 — nigdy „przy okazji".

### Czego nie da się sprawdzić z tego środowiska

1. **Push na telefonie** — kod jest (FCM, service worker, VAPID), ale nigdy nie było
   testu na fizycznym urządzeniu po redesignie.
2. **Odczyt paragonu na wydanej wersji** — zrzut właściciela z 2026-08-15 pokazuje
   błąd **401**, czyli odrzucony klucz OpenRoutera. Do sprawdzenia w Secret Managerze
   projektu `billsplitter-push-test`, nie w kodzie.
3. **Praca kilku osób naraz** — żywy paragon i salda sprawdzał wyłącznie automat,
   nigdy dwa telefony równocześnie.
4. **Zsuwanie arkusza palcem i przesuwanie kafelka pokoju** — obsługa stoi na zdarzeniach
   wskaźnika, więc automat ich nie dotyka. Do sprawdzenia kciukiem na iPhonie.
5. **Mrożone szkło paska nawigacji** — `backdrop-filter` w zrzutach z puppeteera wychodzi
   inaczej niż na urządzeniu.

### PWA na iPhonie — co wiadomo

Instalacja **została potwierdzona jako działająca** (test właściciela 2026-08-03, przed
redesignem). Otwarty zostaje sam błąd `start_url`: skrót otwiera ekran startowy zamiast
pokoju, a magazyn danych skrótu jest osobny od Safari, więc lista „Twoje pokoje" bywa
w nim pusta. Warstwa ratunkowa jest zbudowana: **link, kod pokoju i kod QR**
(`docs/UI-UX.md` §17). Do sprawdzenia po wydaniu, czy po redesignie instalacja nadal
przechodzi tak samo.
