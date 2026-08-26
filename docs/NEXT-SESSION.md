# Brief na następną sesję

> ## ⚠️ ZACZNIJ TUTAJ — ETAP 3: TRYB GLOBALNY I „RACHUNEK PO RACHUNKU" (2026-08-26)
>
> **Gałąź robocza: `etap1-offline-i-feedback`** (11 commitów, drzewo czyste, NIE scalona
> do `BillSplitterV2`). Etapy 1 i 2 są zrobione — opisane w `docs/UI-UX.md` §20 i §21.
> Etap 3 jest do zrobienia i to jest ta część, na której właścicielowi zależy najbardziej,
> bo jego ekipa czeka na nią w trakcie używania aplikacji.
>
> **Pełny zapis decyzji projektowych (osiem rund rozmowy z właścicielem):**
> https://claude.ai/code/artifact/bc3c3b5d-659d-4bc5-8003-1cd5b9e428e5
>
> Przeczytaj go, zanim cokolwiek zaprojektujesz od nowa. Większość rzeczy, które wyglądają
> na oczywiste ulepszenia, została już rozważona i świadomie odrzucona.

---

## Zanim ruszysz: co jest zrobione i jak to sprawdzić

```
npm test                         # 263 testy jednostkowe
npm run emulators                # w osobnym oknie
npm run test:rules               # 34 testy reguł — WYMAGA CZYSTEGO EMULATORA
npx vite --port 5199 --strictPort
BILLIADA_URL=http://localhost:5199/ node tools/audit-offline.mjs   # 13 sprawdzeń

VITE_USE_EMULATOR=true npx vite build
npx vite preview --port 5197 --strictPort
BILLIADA_URL=http://localhost:5197/ node tools/audit-sw.mjs        # 9 sprawdzeń
```

**KOLEJNOŚĆ MA ZNACZENIE.** Testy reguł zakładają czystą bazę, a przebiegi przeglądarkowe
zostawiają w emulatorze prawdziwe pokoje i rachunki. Puszczone po audycie wywalają kilka
sprawdzeń z `PERMISSION_DENIED` i wygląda to jak regresja reguł, której nikt nie wprowadził
— sprawdzone, ta sama liczba błędów wychodzi na gałęzi bazowej. Reguły najpierw albo
restart emulatorów pomiędzy.

**`TaskStop` nie ubija emulatora do końca** — zostaje proces `java` i `node` trzymające porty
4773 i 8770. Trzeba je znaleźć przez `netstat -ano` i ubić po PID, inaczej kolejny start
kończy się „Could not start emulator hub, port taken".

---

## ETAP 3 — ZAKRES

### 1. Ustawienie trybu w grupie

- Pole `settlementMode` w dokumencie grupy: `'min'` | `'net'` | `'perBill'`.
  **Brak pola = `'min'`, czyli dzisiejsze zachowanie.** Żaden istniejący pokój nie zmienia
  się sam z siebie.
- Dziś tryb żyje jako `let settlementMode = 'min'` w `src/main.js` (zmienna lokalna, ginie
  przy przeładowaniu). Zostaje jako WIDOK; plan do wykonania idzie z pola grupy.
- Ekran wyboru w ustawieniach pokoju: trzy opcje, przy każdej jedno zdanie wyjaśnienia.
- **Tryb grupy świeci limonką marki** i niesie zdanie „Tak rozlicza się ta grupa"
  (decyzja właściciela). Pozostałe dwa segmenty są widoczne i do otwarcia, ale **bez
  przycisków akcji** — z jedną cichą linią „grupa umówiła się inaczej".

### 2. Trzy tryby to jedna drabina zwijania

| Tryb | Co zwija |
|---|---|
| Najmniej przelewów | zwija **między osobami** — optymalizuje trasę |
| Kto komu | zwija **na osobie** — sumuje należności wobec jednej |
| Rachunek po rachunku | **nie zwija nic** — w kolejności dodawania rachunków |

**To jest reguła twarda i była łamana trzy razy w rozmowie.** W trybie trzecim NIE MA
żadnych podsumowań, sum ani grupowania po osobie. Jeśli ktoś chce wiedzieć, ile łącznie
idzie do Marka, przełącza się na „Kto komu" — po to on jest. Nie dowoź do jednego trybu
tego, co robi sąsiedni.

### 3. Gdzie mieszka tryb rachunkowy

- **Rachunki** — filtr „Do oddania (N)" na istniejącej liście (mechanizm filtrów już jest,
  `getBillUserState`). „Ureguluj" na wierszu i na ekranie rachunku.
- **„Kto już oddał" na ekranie rachunku** — dla płatnika, **w każdym trybie**. Dziś tej
  informacji nie ma tam wcale, a pytanie „oddałeś mi za kolację?" pada zawsze.
- **Przelewy NIE powtarzają listy rachunków.** Sekcja „Do oddania" to trzy linijki
  z przejściem, nie lista. Odbieranie, przypominanie i rejestr wpłat zostają na miejscu —
  windykator działa w każdym trybie.
- **Bilans** analogicznie: wielka kwota bez zmian (saldo na czysto jest identyczne we
  wszystkich trybach — to niezmiennik), podpis liczy rachunki zamiast osób, pigułka trybu.

### 4. Wpłaty: `billId` i reguła przypisania

- Wpłata dostaje **opcjonalne** pole `billId`. Stare wpłaty działają bez migracji.
- **Przypisanie TYLKO W OBRĘBIE PARY**: wpłata X→Y gasi długi X wobec Y, od najstarszego.
  Wcześniejsza wersja tej reguły (FIFO bez ograniczenia do pary) była BŁĘDNA — pokazywałaby
  rachunek jako spłacony Markowi, choć pieniądze poszły do Oli.
- Czego nie da się przypisać (wpłaty poprowadzone planem minimalnym, a takie w pokoju
  właściciela **prawdopodobnie już są**) ląduje w bloku **„Wpłaty bez przypisania"**
  z kwotą, odbiorcą i zdaniem „powstała w trybie »Najmniej przelewów«".
- Do tego linia uzgadniająca, żeby Bilans i lista rachunków nie mówiły dwóch różnych rzeczy:
  `5 rachunków 130,00 · wpłata bez przypisania −30,00 · zostaje 100,00`.

### 5. Potwierdzanie — NIE BUDUJ TEGO OD NOWA

`src/nudges.js` `inboxItems` ma już `kind: 'confirm-payment'` na poziomie 1 (odznaka
liczbowa). Pojawia się na Bilansie w „Czeka na Ciebie" i w skrzynce pod dzwonkiem,
z przyciskiem potwierdzenia prosto z wiersza, bez okna (`src/main.js`, `.inbox-confirm-btn`).

**Brakuje wyłącznie nazwy rachunku.** Dodanie `billId` naprawia to w skrzynce, na Bilansie,
w rejestrze i w treści push naraz.

**5 rachunków odklikniętych naraz = 5 wpłat = odznaka „5" i 5 wierszy w skrzynce.**
Właściciel: *„i bardzo dobrze, w trybie rachunkowym robimy łopatologicznie bardzo"*.
NIE zwijać. Dodać tylko nazwę rachunku w wierszu i sortowanie po płatniku, żeby wiersze
tej samej osoby stały obok siebie.

### 6. Niezmiennik do przykrycia testem

**Saldo na czysto każdej osoby jest identyczne we wszystkich trzech trybach.** Tryb zmienia
wyłącznie trasę pieniędzy i grubość ziarna, nigdy wynik. To jedyna rzecz, która broni przed
tym, żeby trzy tryby stały się trzema księgowościami.

---

## Czego NIE ruszać

- **Algorytmu planu minimalnego.** Etap 4, osobna gałąź, świadomie odłożony. Reguła
  nienaruszalnego przelewu, wiersze planu jako dokumenty, migracja — wszystko czeka.
  Dopóki tego nie ma, plan minimalny nadal przelicza się przy każdym rachunku i przy
  każdej cudzej wpłacie. To jest znane i zaakceptowane.
- **Osobnego odświeżania na żądanie** (przycisk, gest pociągnięcia). Właściciel dopytuje
  kolegę, co ten miał na myśli. Pasek „Nowa wersja gotowa" to co innego — on już jest
  i był warunkiem bezpieczeństwa etapu 2.
- **`firebase/storage` jako importu statycznego.** Dziesięć miejsc wywołań za 31 kB,
  na ścieżkach zdjęć, których nie da się w pełni przetestować. Świadoma decyzja.

## Długi z etapu 1, warte zamknięcia przy okazji

- **41 czekanych zapisów** w `src/main.js` (`await updateDoc` / `addDoc`). Offline te
  obietnice nie rozwiązują się nigdy. Przerobione są 3 najgorsze (dołączanie do pokoju,
  zapis wpłaty, potwierdzanie wpłat) — wzorzec to `fireWrite`. Tryb rachunkowy mnoży
  akcje potwierdzania, więc kolejne konwersje mają tu realną wartość.
- **Nasłuch dokumentu grupy w `renderGroupDashboard` nie ma zapisanego `unsubscribe`**
  (przypisanie idzie do zapytania o rachunki). Przy powtórnej nawigacji nasłuchy się
  stakują. Zastane, nie wprowadzone przez etap 1 — ale przy dokładaniu ekranów zrobi się
  gorsze.

## Dwie rzeczy nieobejrzane na oczy

- **Pięć stanów przełącznika powiadomień** — wymaga buildu produkcyjnego, bo w trybie
  deweloperskim vite nie rejestruje service workera i widać stan „niedostępne".
- **Arkusz akceptacji paragonu** (pięć warstw utwardzenia) — wymaga klucza do modelu AI.
  Kod jest pod 32 testami w `src/receipt.flags.test.js`, ale nikt tego nie widział.

## Pytania otwarte dla właściciela

1. Czy wypchnąć gałąź `etap1-offline-i-feedback` na origin? (pytane dwa razy, bez odpowiedzi)
2. Czy budujemy tryb „Dowolny" (każdy rozlicza się jak chce)? Rekomendacja: **nie**
   w pierwszym podejściu — to jedyne ustawienie, które celowo odtwarza problem, który
   naprawiamy.
3. Czy zaznaczanie kilku rachunków naraz zostaje, czy zostaje jedno „Ureguluj" na rachunek?

---


Napisane 2026-08-05, zaktualizowane **2026-08-16** po pełnym audycie.

> ### ⚠️ ZACZNIJ OD `docs/AUDYT-2026-08.md`
>
> Audyt z 2026-08-16 znalazł i naprawił **siedem usterek**, w tym trzy pieniężne
> (kwota znikała z rachunku; rabat już wliczony odejmowany drugi raz; kwota podatku
> czytana jako procent) oraz przyczynę zgłoszenia „powiadomienia na iPhonie działały
> rzadko". Ma sekcję **Decyzje** z pytaniami do właściciela.
>
> Gałąź `worktree-ux-poprawki-v2` **została scalona 2026-08-17**. Zajrzyj do §Decyzje
> punkt 1 — jest tam opis pułapki „scalone bez konfliktu, a mimo to zepsute", która
> przy tym scaleniu unieważniła jedną z poprawek.
>
> Dopiero potem ten plik, `docs/UI-UX.md`, `DESIGN.md`, `PRODUCT.md`.

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
- **CZARNY PAS NA DOLE W APLIKACJI Z IKONY: SPRAWA OTWARTA. NIE PRZESUWAJ NICZEGO W DÓŁ.**
  Hipoteza „blok pozycjonowania jest krótszy o `env(safe-area-inset-top)`, więc trzeba
  dodać tyle na dole" została **sprawdzona na telefonie i obalona**: pasek nawigacji
  i dół treści wyjechały poza ekran. To dowodzi, że `inset: 0` sięga dolnej krawędzi
  WIDOKU — a pas leży poniżej widoku, czyli widok nie zajmuje całego ekranu.
  Aktualna próba to `html { min-height: calc(100% + env(safe-area-inset-top)) }`
  pod `@supports (-webkit-touch-callout: none)` i `@media (display-mode: standalone)`;
  nic nie przesuwa, więc nic nie może uciąć. Jeśli nie pomogła, następny krok to pomiar
  (`screen` obok `inner` w podglądzie wymiarów), a nie kolejna korekta na wyczucie.
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
- **Sieć asekuracyjna** — 187 testów jednostkowych + 32 testy reguł Firestore, kontrakt selektorów, strażnik escapowania, próg sygnału.
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
6. **Odczyt paragonu na wydanej wersji** — usługa zwracała **401** (zrzut z 2026-08-15).
   Audyt 2026-08-16 zawęził to do jednej rzeczy: **sam klucz jest dobry, nieważny jest
   sekret wgrany do projektu**. Klucz z `E:/BillSplitter/.env` przeszedł czternaście
   odczytów w `tools/receipt-bench.mjs` bez jednego błędu. Zostaje rotacja sekretu —
   dwa kroki, oba konieczne (funkcja jest przypięta do numeru wersji sekretu):
   `firebase functions:secrets:set OPENROUTER_API_KEY --data-file <plik>`
   plus `firebase deploy --only functions:parseReceipt`.
   **Jakość samego odczytu jest zmierzona i dobra** — 14/14 paragonów co do grosza,
   patrz `docs/AUDYT-2026-08.md` §B.

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
   **Audyt 2026-08-16 znalazł dwie przyczyny zgłoszenia „działało rzadko" i obie naprawił:**
   serwer blokował dymek na sześć godzin mimo decyzji o dziesięciu sekundach, a token
   zapisywał się tylko do pokoju otwartego w chwili włączania powiadomień. Pełny opis
   i instrukcja sprawdzenia kciukiem: `docs/AUDYT-2026-08.md` §E.
   **Wymaga wgrania funkcji**, żeby zadziałało na żywo.
2. **Odczyt paragonu na wydanej wersji** — patrz punkt 6 wyżej: kod i prompt są sprawdzone
   pomiarem, zostaje rotacja sekretu w Secret Managerze.
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
