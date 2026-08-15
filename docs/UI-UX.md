# UI/UX — stan prac, decyzje, zaległości

Dokument roboczy do wznawiania sesji. `DESIGN.md` mówi JAK ma wyglądać;
ten plik mówi CO jest zrobione, co jest zepsute i co dalej.

Stan na **2026-08-06**. Ostatnia zamknięta partia: 1c (patrz §11).

---

## 1. Jak wznowić pracę

**Zdanie otwierające nową sesję:**

> Przeczytaj `docs/UI-UX.md`, `DESIGN.md` i `PRODUCT.md`, potem zrób punkt 3.

Te trzy pliki plus `.impeccable/surfaces/index-html.md` (kierunek powierzchni) niosą
komplet kontekstu. Referencje wizualne właściciela leżą w `Referencje/` — świat jest nimi
przypięty, więc zaczynaj od ich obejrzenia.

```bash
npm run dev          # aplikacja na http://localhost:5173
npm run emulators    # Firebase Emulator Suite (w dev aplikacja idzie na emulator,
                     # więc bez nich logowanie anonimowe pada i widać pusty ekran).
                     # Startuje z --project test, bo .env.local kieruje aplikację na
                     # billsplitter-push-test, a emulator funkcji routuje po
                     # identyfikatorze projektu W ADRESIE: przy rozjeździe parseReceipt
                     # wraca 404 (w przeglądarce widoczne jako błąd CORS).
npm test             # 164 testy jednostkowe
npm run test:rules   # 32 testy reguł Firestore (wymaga emulatorów)
npm run build
```

### Narzędzia audytowe

Dwa przebiegi w `tools/`. Wymagają puppeteera: `npm i --no-save puppeteer`.

```bash
node tools/audit-layout.mjs ./shots          # zrzuty + pomiar układu, domyślnie 390×844
node tools/audit-layout.mjs ./shots 834      # tablet; zrzuty lądują w ./shots/w834
node tools/audit-buttons.mjs                 # szuka martwych przycisków, domyślnie 390
node tools/audit-buttons.mjs 834             # to samo na tablecie
```

Kontrakt responsywności z `DESIGN.md` wymaga **czterech szerokości: 360, 390, 834, 1280**.
Oba przebiegi biorą szerokość jako argument (wysokość i tryb dotyku dobierają się same),
a `audit-layout` trzyma zrzuty każdej szerokości w osobnym podkatalogu `w<szerokość>`.

- **`audit-layout.mjs`** prowadzi aplikację przez pełną ścieżkę (grupa → rachunek →
  pozycje → odklikanie → koszt wspólny → pulpit → profil → oba motywy), zapisuje zrzut
  każdego stanu i mierzy: wyjazdy poza ekran, nachodzące się cele dotykowe, przyciski
  poniżej 44 px, przewijanie w poziomie, błędy konsoli.
- **`audit-buttons.mjs`** klika każdy widoczny przycisk na każdej zakładce i porównuje
  odcisk stanu przed i po (ekran, okno, motyw, przewinięcie, `aria-pressed`, zwinięte
  sekcje, długość treści, ognisko klawiatury). Wypisuje kandydatów na martwe przyciski.
  Uwaga: przycisk klikany, gdy jest już aktywny, oraz „Zmień zdjęcie" (systemowe okno
  pliku) zawsze wychodzą jako fałszywe alarmy.

**Okno Chrome nie daje się zwęzić do szerokości telefonu przez rozszerzenie** — dlatego
te przebiegi chodzą na puppeteerze z prawdziwym viewportem i działającymi media queries.
To jest jedyna droga do oglądania układu telefonowego w tym projekcie.

### Detektor systemu projektowego

```bash
node <ścieżka-do-wtyczki>/scripts/detect.mjs --json index.html src/tailwind.css
```

Czyta `DESIGN.md` i zgłasza każdą wartość spoza systemu. Dwa wpisy są znane i świadome:
`broken-image` (podgląd zdjęcia paragonu z pustym `src`, wypełnianym przy otwarciu)
oraz `design-system-font: Font Awesome 7 Free` (prawdziwy dług, patrz §6 — ikony
są już w buildzie, ale mają zostać zastąpione własnym zestawem).

---

## 2. Decyzje kierunkowe

**Świat wizualny** przypięty referencjami właściciela z `Referencje/` (nowoczesne
aplikacje mobilne do pieniędzy). Poprzedni kierunek „druk zabezpieczony" odrzucony
w całości 2026-08-04 i traktowany jako anty-referencja.

**Znak własny: ŻYWY PARAGON** — zdjęcia ekipy lądują na liniach paragonu w czasie
rzeczywistym, gdy ktoś odklika swoje. Zbudowany, działa.

**Jeden rachunek, który rośnie** — bez wyboru „prosty / zaawansowany". Kwota nierozpisana
dzieli się po równo. Zrobione: reguła w `calculateAll`, ekran „prosty" skasowany.

**Nazwa produktu i logo** — otwarte. Nowa nazwa **musi być angielska**; polskie propozycje
odrzucone. Do rozstrzygnięcia osobno.

---

## 3. STRUKTURA NAWIGACJI — ZBUDOWANE 2026-08-05 (partia 1)

> **Stan: zrobione.** Pasek przełącza miejsca, jest widoczny na każdym ekranie pokoju,
> podwójne wejścia zniknęły, ustawienia pokoju otwierają się spod nazwy pokoju.
> Szczegóły wykonania i to, czego partia 1 NIE ruszyła, są w §11.

### Problem

Obecny pasek to zakładki, które **przewijają do sekcji jednej długiej strony**.
To jest ani nawigacja, ani przewijanie. Wynikające z tego bezsensy, wskazane przez
właściciela 2026-08-05:

- „Kto komu ile" istnieje **dwa razy**: jako sekcja pulpitu z własnym przełącznikiem
  trybu i jako zakładka w pasku.
- „Rachunki" tak samo: sekcja z filtrem plus zakładka.
- „Ty" w pasku dubluje awatar w nagłówku, który robi to samo.
- Zwijana sekcja „Pokój" na dole nie ma uzasadnienia — to ustawienia pokoju, więc
  należą do nazwy pokoju, nie do końca listy.
- Pasek znika na ekranie rachunku, więc nie jest globalny.

### Decyzja

> **Uzupełnione 2026-08-05:** tabela niżej opisuje pasek czterosegmentowy. Właściciel
> rozstrzygnął tego samego dnia, że **rozliczenia dostają własne miejsce**, więc
> obowiązuje wersja pięciosegmentowa z §10. Reszta tej sekcji (pasek zawsze widoczny,
> koniec dublowania wejść, ustawienia pokoju spod nazwy pokoju) zostaje w mocy.

**Zakładki stają się prawdziwymi miejscami, a pasek jest widoczny zawsze.**

| Zakładka | Zawartość | Uwagi |
|---|---|---|
| **Bilans** | limonkowy blok bilansu + „kto komu ile" z przełącznikiem trybu | wejście domyślne |
| **[+]** | akcja: nowy rachunek | koło limonkowe, morfuje w arkusz (§4) |
| **Rachunki** | lista rachunków z filtrem | |
| **Ty** | profil: zdjęcie, kolor, sposoby płatności, ile wydałeś | zastępuje awatar-skrót |

Znika: awatar w nagłówku jako wejście do profilu (zostaje jako **podgląd tożsamości**,
niekliaklny), zwijana sekcja „Pokój", zakładka dublująca sekcję.

**Ustawienia pokoju** (link, kod, miejsce na zdjęcia, instalacja) otwierają się
**stuknięciem w nazwę pokoju** w nagłówku — z chevronem, żeby było widać, że to przycisk.

Pasek zostaje widoczny na ekranie rachunku i profilu. Przy otwartym arkuszu nadal
zjeżdża (arkusz to jedna decyzja do domknięcia), ale to jedyne wyjątki.

### Co to znaczy w kodzie

- `setupDeckNav` przestaje przewijać, zaczyna przełączać widoczność sekcji pulpitu.
- `showScreen` pokazuje pasek na `group-dashboard`, `bill` i `profile`.
- Sekcja „Pokój" wyjeżdża z pulpitu do arkusza otwieranego z nagłówka.
- Kontrakt selektorów pilnuje, żeby żaden uchwyt nie zniknął po cichu.

---

## 4. MORFOWANIE [+] W ARKUSZ (priorytet 2)

Życzenie właściciela: stuknięcie w limonkowe koło **rozrasta je** w arkusz „nowy
rachunek", zamiast otwierać okno znikąd. Krótko i przyjemnie.

Specyfikacja:

- Technika: `View Transitions API` z `view-transition-name` wspólnym dla koła i arkusza
  (przeglądarki bez wsparcia dostają obecny wjazd od dołu — degradacja bez ubytku funkcji).
- Czas: 320–380 ms, krzywa `cubic-bezier(0.2, 0, 0, 1)` (ta sama, co reszta ruchu).
- Przebieg: koło rośnie i traci promień do 28 px arkusza, limonka blaknie do koloru karty,
  ikona `+` zanika w pierwszych 40 % czasu, treść arkusza pojawia się w ostatnich 40 %.
- Zamknięcie odtwarza to samo wstecz.
- Znika przy `prefers-reduced-motion` — zostaje zwykłe pojawienie.

---

## 5. ZALEGŁE USTERKI (do przejrzenia element po elemencie)

Wskazane przez właściciela, jeszcze nienaprawione:

- [x] **Wybór koloru w profilu** — zrobione 2026-08-05 (partia 1b): pole „Kolor znaku"
      z bieżącą barwą, paleta w arkuszu.
- [x] **Zwijana sekcja „Pokój"** — skasowana, treść w arkuszu spod nazwy pokoju (partia 1).
- [x] **Dublowanie wejść** — awatar w nagłówku usunięty, wejście do profilu tylko z paska.
- [x] Stan pusty na Bilansie: „Pokój jest pusty" + kod pokoju (partia 1).
- [x] Odcień „coś czeka na ciebie" zszedł z 9 % na 6 % (partia 6).
- [x] Pole kwoty pokazuje `480,00` — `type="text"` z klawiaturą numeryczną (partia 1b).
- [x] Nazwa pokoju: stopień niżej poniżej 640 px, żeby mieściła się bez wielokropka.

### Zweryfikowane przebiegiem audytowym 2026-08-05 (360 / 390 / 834 / 1280)

Przebieg na czterech szerokościach, aplikacja na emulatorach. **Zero wyjazdów poza ekran,
zero przewijania w poziomie, zero błędów konsoli na każdej szerokości.** To, co zostało:

| Znalezisko | Gdzie | Waga |
|---|---|---|
| `status-select` ma **147×36 px** — poniżej progu 44 | wybór statusu na kafelku rachunku | **jedyna** usterka celu dotykowego, jaka przeżyła weryfikację |
| **Pasek zasłania sekcję „Pokój"** i trzeci wiersz „Ile kto wydał" | 390 px, dół pulpitu i profilu | znika wraz z rozbiciem pulpitu (§10.1) |
| **Nazwa pokoju ucięta do „Wyjazd …"** przy 390 px | nagłówek | potwierdza zaległość z listy wyżej |
| **Szesnaście kółek koloru naraz** zajmuje pół ekranu profilu | profil | potwierdza zaległość z listy wyżej |
| `480.00` zamiast `480,00` | pole kwoty rachunku | potwierdza zaległość z listy wyżej |
| Pasek pokazuje **podpis tylko przy aktywnej** zakładce, reszta to same ikony | pasek, wszystkie szerokości | `DESIGN.md` przewiduje stopień „control" jako *podpis w pasku nawigacji* — rozjazd z systemem |
| **Tablet 834 px: układ telefonowy rozciągnięty** — kafelek rachunku ciągnie się przez całą szerokość, nagłówek i filtr na przeciwnych krańcach, pod treścią pusta połowa ekranu | 834 i 1280 | to jest dokładnie błąd opisany w §9.6; naprawia go 10.6 |

**Kolory tożsamości a role pieniężne — pomiar, nie wrażenie.** `src/identity.js:23-26`
deklaruje paletę „celowo rozłączną z rolami pieniężnymi". Pomiar odległości barwy (CIE Lab)
tego nie potwierdza: `#4338CA` indygo leży **dE 11,2** od błękitu stanu, `#1D4ED8` lazur
**13,5**, `#BE123C` malina **17,4** od czerwieni długu, `#0F766E` szmaragd **24,9** od
zieleni należności. Sześć z szesnastu kolorów siedzi bliżej niż 20 — na awatarze o średnicy
28 px w wierszu pozycji to jest odległość myląca. **Reguła rozdziału kolorów z `DESIGN.md`
jest dziś spełniona na papierze, nie w pikselach.** Do rozstrzygnięcia przy partii z ludźmi.

**Narzędzie audytowe kłamało — naprawione w tej sesji.** Przed poprawką każdy przebieg
zgłaszał 12 za małych celów i 5–6 nachodzeń. Po trzech poprawkach zostaje
**1 cel i 0 nachodzeń**:

- cele rozpychane klasą `hit-44` (warstwa `::after`) mierzono samym pudełkiem elementu,
  więc naprawiona usterka wracała jako usterka;
- pole wyboru owinięte etykietą mierzono kwadracikiem 16 px, choć klika się cały wiersz —
  sprawdzone ręcznie w przeglądarce, klik w imię zaznacza osobę;
- przycisk w otwartym oknie porównywano z przyciskiem strony pod zasłoną, co dawało
  „nachodzenie" tam, gdzie jest zwykłe piętro.

Zasłonięcie treści przez pasek nawigacji ma teraz osobny worek `covered` — to inna usterka
i inna naprawa niż dwa przyciski w jednym miejscu.

### Odczyt paragonu — naprawiony 2026-08-05

Zgłoszenie „odczyt przestał działać" nie miało źródła w kodzie. Klucz OpenRouter w
`functions/.secret.local` był **unieważniony** (`401 User not found`). Po wymianie klucza
przebieg kontrolny przez emulator: **HTTP 200 w 3,6 s**, pięć pozycji z ilościami,
`receiptTotal: 264`, `modifiers: []` — czyli podatek wliczony nie wraca jako napiwek
(poprawka z `923b1cd` trzyma). Koszt jednego odczytu: **0,001028 $** modelem
`google/gemini-3.1-flash-lite`, zgodnie z komentarzem w `functions/index.js:147-149`.

Miejsce klucza ma znaczenie: emulator czyta **`functions/.secret.local`**, nie `.env.local`
w katalogu głównym (to plik Vite dla przeglądarki). Klucz bez przedrostka `VITE_` i tak nie
wchodzi do paczki — sprawdzone przebiegiem `npm run build` i przeszukaniem `dist/` — ale
trzymanie sekretu serwerowego w pliku frontendu jest mylące i nie działa. Na produkcji:
`firebase functions:secrets:set OPENROUTER_API_KEY`.

### Przejście ręczne w przeglądarce, grupa 13 osób (2026-08-05)

Pierwszy przebieg aplikacji **w skali z `PRODUCT.md`** (12–25 osób), na żywych emulatorach.
Kryterium było zapisane, ale nigdy nie sprawdzone. Nie przeszło.

**Ekran rachunku puchnie liniowo z liczbą osób.** Sekcja „Uczestnicy" wypisuje każdą osobę
jako pełną kartę z czterema wierszami rozbicia (koszty własne / pozycje / koszty wspólne /
łącznie) — także wtedy, gdy wszystkie cztery są zerowe. Pomiar: **12 kart × 217 px = 2 700 px
przy 4 061 px całej strony, czyli 66 % ekranu rachunku to karty w większości puste.** Przy
25 osobach wychodzi ponad 5 000 px. Scena „dwadzieścia sekund przy stole" tego nie znosi.
Karta musi się zwijać do jednej linii, a rozwijać na żądanie.

**Wybór płatnika to systemowa lista rozwijana z trzynastoma imionami** — bez twarzy, bez
kolorów, bez zdjęć. `DESIGN.md` mówi „ludzie są obecni wszędzie tam, gdzie stoi kwota";
tu przy najważniejszym pytaniu rachunku („kto wyłożył pieniądze") ludzi nie ma wcale.

**Na pulpicie ekipa nie istnieje wizualnie.** Trzynaście osób w pokoju i ani jednej twarzy
na ekranie startowym pokoju. To największa różnica do poziomu referencji.

**Pomoc „?" tłumaczy zasady, nie interfejs.** Dzisiejsze okno na ekranie rachunku to siedem
punktów ciągłego tekstu o regułach produktu („suma pozycji pilnuje, żeby wpisy nie
przekroczyły kwoty rachunku"). Nie ma tam ani jednej ikony i ani jednego zdania o tym, co
robi konkretny przycisk. Życzenie właściciela z 10.7 to więc przebudowa treści, nie kosmetyka.

**Drobne, ale realne:**

- „**13 osoby w grupie**" — zła odmiana liczebnika; przy 2–4 działa, od 5 w górę nie.
- „**Dołącz do Wyjazd w Bieszczady 2026**" — nazwa wstawiona w zdanie bez odmiany
  ani cudzysłowu.
- „**138,50PLN**" — brak spacji przed walutą, powtarza się w całym rozbiciu uczestnika.
- **Baner „potwierdź płatnika" wpycha treść w dół** po wyborze płatnika: przyciski
  przeskakują o ~75 px pod palcem, który już celuje.
- Pole kwoty przyjmuje i pokazuje `1480.50`, a zdanie pod nim mówi już `1 480,50 PLN` —
  ta sama liczba w dwóch zapisach na jednym ekranie.

Naprawione w tej sesji (nie wracać):

- Nawigacja zasłaniała „Stwórz rachunek" (jedna skala warstw + pasek zjeżdża)
- Brak powrotu kliknięciem w tło (globalnie + Escape, poza potwierdzeniami kasowania)
- `renderBalancePanel` nigdy nie wywoływane — limonkowy blok bilansu był pusty
- Za małe cele: kasownik żetonu, pigułki, kod pokoju, wybór statusu
- Nachodzące obszary trafienia ołówka i kosza przy pozycji
- „Rachunki" w pasku nie robiło nic (obserwator cofał podświetlenie)
- Przycisk pomocy nachodził na treść (przeniesiony do nagłówków)
- Paski powtarzanego tekstu („JAK CI ODDAĆ PIENIĄDZE · …") — resztki wyrzuconego świata
- „Koszt ogólny" → „koszt wspólny" z wyjaśnieniem podziału po równo
- Limonka dawała brudną oliwkę w motywie ciemnym

---

## 6. ZAKRES PRODUKTOWY DO ZROBIENIA

Z `PRODUCT.md`, sekcja „Rozstrzygnięcia zakresu":

- [ ] **Zdjęcia ludzi w ścieżce wejścia** — referencje stoją na twarzach; bez tego
      wszędzie widać kolorowe koła z literami. Największa różnica do poziomu referencji.
- [ ] **Udziały nierówne** (wagi/procenty) — „ktoś płaci za dwoje".
- [x] **Dziennik zmian** — zrobione (partia 6, §16): kolekcja `events` append-only.
- [x] **Kod pokoju i kod QR** — zrobione (partie 4 i „wydanie", §14 i §17): kod
      w nagłówku i w ustawieniach, QR rysowany lokalnie, pole wejścia kodem na ekranie
      startowym. Kod nadal jest identyfikatorem dokumentu — skrócenie go do formy
      „czterech znaków do podyktowania" zostaje otwarte.
- [ ] **Arkusz płatności ZBP/EPC** — wymaga testu na żywym telefonie właściciela.
- [~] **Własny zestaw ikon** — Font Awesome zszedł z CDN do buildu (§18), więc offline
      już nie boli. Zastąpienie go własnym zestawem zostaje otwarte.
- [~] **Własne szablony przypomnień** — zrobione na urządzeniu (partia 6, §16).
      OTWARTE zostaje zapisywanie ich **w pokoju**, żeby grupa budowała wspólny zestaw
      tekstów, zamiast dostawać gotowe żarty od aplikacji. To jest mechanizm głosu
      produktu z `PRODUCT.md`, nie ozdoba: **humor pojawia się wyłącznie tam, gdzie
      autorem jest człowiek** — nigdy przy kwocie, nigdy w komunikacie błędu, nigdy
      przy nieudanej płatności. Przypomnienie jest sprawą dwóch osób: treść widzi
      wyłącznie adresat. Do tego samego mechanizmu należą **ksywki zamiast imion**
      i własna nazwa pokoju.

---

## 7. Czego NIE zmieniać bez rozmowy

Rozstrzygnięcia, które kosztowały osobną decyzję właściciela:

- **Świat wizualny jest przypięty referencjami.** Poprzedni kierunek („druk zabezpieczony")
  odrzucony w całości; nie wraca ornament, przygaszone barwniki ani wersaliki.
- **Zero kont.** Link, kod pokoju albo QR. Każde przyszłe konto jest dodatkiem dla
  chętnych, nie bramką przed pierwszym rachunkiem.
- **Zaokrąglanie zawsze na korzyść płatnika.**
- **Nazwa produktu musi być angielska.** Polskie propozycje odrzucone.
- **Kategorie wydatków, statystyki, wydatki cykliczne i eksport są poza zakresem.**
- **Zieleń nie może znaczyć naraz „potwierdzone" i „zapłać"** — to był błąd V1 i źródło
  nieufności do ekranu operującego cudzymi pieniędzmi.

---

## 8. Sieć asekuracyjna

Nie do obejścia przy żadnej zmianie interfejsu:

- `src/selectors.contract.test.js` — każdy uchwyt, po który sięga kod, istnieje w markupie.
  Redesign, który usunie `id`, nie wywoła błędu — przycisk po prostu przestanie działać.
- `src/render.safety.test.js` — żadna dana z bazy nie trafia do znaczników bez neutralizacji.
  Do dokumentu grupy pisze każdy, kto zna link.
- `src/calc.rounding.test.js` — reguła „kwota nierozpisana dzieli się po równo",
  zaokrąglanie na korzyść płatnika.

---

## 9. RESEARCH ZEWNĘTRZNY (2026-08-05)

Wykonany na polecenie właściciela: warstwa doświadczenia ma pochodzić z zewnątrz, nie
z głowy. Zebrane **rozwiązania problemów**, nie układy do skopiowania. Każde ustalenie
sprawdzone przeciw `PRODUCT.md`; to, co się z nim gryzie, jest odrzucone z powodem.

### 9.1 Dzielenie rachunków — czego uczy konkurencja

Źródło pierwszorzędne: badanie z użytkownikami przeprowadzone na ścieżce „ureguluj"
w Splitwise ([case study](https://medium.com/@giuseppeditaranto98/redesigning-the-settle-up-functionality-on-splitwise-ux-case-study-5e988cc99708)).
Zgłoszone przez badanych problemy, wszystkie dotyczą nas jeden do jednego:

| Problem u nich | Nasz stan | Wniosek |
|---|---|---|
| Mylące słownictwo „OWE / LENT / PAID" | mamy „winien / dostajesz" plus dwa tryby rozliczeń | Słownictwo domknąć raz, w jednym słowniku. `PRODUCT.md` już to zapowiada („wolna ręka w słowniku"). |
| Ureguluj niedostępne w trakcie przewijania | pasek zjeżdża, „Kto komu ile" jest sekcją | Potwierdza decyzję §3: **rozliczenia muszą być miejscem, nie sekcją**. |
| **Brak powiadomienia, gdy ktoś się rozliczył** | mamy push tylko dla przypomnień (`sendNudgePush`) | Największa luka. Wpłata i potwierdzenie wpłaty to zdarzenia, o których druga strona dziś dowiaduje się przypadkiem. |
| Brak przelewu w aplikacji, niejasne metody płatności | mamy metody płatności w profilu, arkusz ZBP/EPC zaległy | Podnosi wagę arkusza płatności — to nie ozdoba, to najczęstszy zgłaszany brak. |
| Nadmiar przycisków, brak hierarchii | pulpit ma dziś wszystko naraz | Potwierdza rozbicie pulpitu na miejsca. |

Wynik ich przebudowy: domknięcie ścieżki rozliczenia **z zerowego odsetka do 100 %**.
Dźwignia jest w nawigacji i słowniku, nie w grafice.

Porównania rynkowe (Tricount, Settle Up, Splitwise) zgodnie wskazują ten sam podział ról:
Splitwise przegrywa na progu wejścia, bo ma „więcej menu i ustawień"; Tricount wygrywa
prostotą startu; Settle Up wygrywa **czytelnym rozdziałem czerwone/zielone** i pracą
offline ([1](https://splitpilot.io/blog/tricount-vs-splitwise/),
[2](https://tetras-ltd.com/en/blog/tricount-vs-splitwise-vs-settle-up-best-app)).
Wszystkie trzy przewagi mamy już wpisane w `PRODUCT.md` (zero kont, ścieżka awaryjna
offline, role pieniężne w kolorze). **Redesign ma ich nie zgubić przy dokładaniu miejsc** —
to jest realne ryzyko rozbicia pulpitu na cztery zakładki.

### 9.2 Aplikacje bankowe — lista transakcji i filtry

Ustalenie kierunkowe: dobra lista transakcji jest traktowana jak **zbiór do odpytania**,
nie jak archiwum — wyszukiwanie, filtry, grupowanie po dacie, rozwijany szczegół
([Meniga](https://www.meniga.com/resources/user-experience-in-mobile-banking-apps/),
[UXPin](https://www.uxpin.com/studio/blog/filter-ui-and-ux/)).

Twarde reguły do przeniesienia na listę rachunków:

- **Aktywne filtry muszą być widoczne** jako pigułki do skasowania. Na telefonie panel
  filtra jest schowany, więc bez pigułek użytkownik nie wie, czemu czegoś nie widzi.
  Dziś mamy `#bill-filters` z dwoma stanami („Wszystkie / Ukryte", `src/main.js:558`)
  i to jest jedyny wymiar — a przy 12–25 osobach i kilkunastu rachunkach z wyjazdu to
  za mało.
- **Licznik wyników aktualizowany na żywo** — „7 rachunków · 1 240,00 zł" nad listą.
  Sam licznik jest tańszy niż statystyki, których `PRODUCT.md` zabrania, i nie jest
  kategorią wydatku — jest sumą tego, co widać.
- **Grupowanie po dacie** zamiast płaskiej listy. Scena „wspólny wyjazd" z `PRODUCT.md`
  to kilkanaście rachunków przez kilka dni; „Dzisiaj / Wczoraj / 3 sierpnia" robi z tego
  dziennik wyjazdu bez dokładania jednej funkcji.
- Wymiary filtra sensowne dla nas: **osoba** (kto płacił / kogo dotyczy), **waluta**
  (waluty się nie mieszają, więc to naturalny podział), **stan** (nierozpisane / do
  odklikania przeze mnie / ukryte). **Nie**: kategoria wydatku — poza zakresem z `PRODUCT.md`.

### 9.3 Powiadomienia w interfejsie

Rozstrzygnięcie wzorca, potwierdzone niezależnie w kilku źródłach
([Braze](https://www.braze.com/resources/articles/beware-red-dot-badging),
[Setproduct](https://www.setproduct.com/blog/badge-ui-design)):

- **Kropka** = „tu jest coś nowego", gdy liczba nie ma znaczenia.
- **Liczba** = gdy użytkownik musi znać ilość, żeby ocenić pilność.
- Slack używa obu naraz i to jest wzorzec do naśladowania: liczba przy tym, co jest
  skierowane do ciebie osobiście, kropka przy zwykłym ruchu w tle.
- **Ślepota na czerwoną kropkę** jest udokumentowana: znacznik, który zapala się zawsze,
  przestaje cokolwiek znaczyć. Odznaka musi mieć próg.

Przełożenie na nas (rozdział ról, zgodny z regułą rozdziału kolorów z `DESIGN.md`):

| Sygnał | Postać | Gdzie |
|---|---|---|
| Przypomnienie skierowane do mnie | **liczba** (czerwień długu) | dzwonek — jest, `#nudges-badge` |
| Ktoś wpłacił / potwierdził moją wpłatę | **liczba** | zakładka rozliczeń |
| Nowy rachunek, którego nie widziałem | **kropka** | zakładka rachunków |
| Rachunek czeka na moje odklikanie | **kropka**, dodatkowo błękit stanu na kafelku | zakładka rachunków + kafelek |
| Zmiana cudzej kwoty na rachunku, który mnie dotyczy | **kropka** | dziennik zmian |

Wymóg z tego samego źródła: **każde powiadomienie musi dać się zakotwiczyć w jednym
miejscu nawigacji**. To jest test poprawności naszej architektury informacji — jeżeli
sygnału nie da się przypiąć do zakładki, to znaczy, że brakuje miejsca albo miejsce jest złe.

Do zaprojektowania osobno, bo dziś nie ma tego wcale: **„uzupełnij swoje koszty"** —
sygnał, który nie jest przypomnieniem o pieniądzach, tylko o niedokończonej pracy na
rachunku. Musi być odróżnialny od windykacji, inaczej wpadnie w ten sam kanał i zabije
mu wagę.

### 9.4 Struktura ustawień

Wytyczne systemowe ([Android](https://developer.android.com/design/ui/mobile/guides/patterns/settings),
[Toptal](https://www.toptal.com/designers/ux/settings-ux)):

- Grupować w małe zbiory z nagłówkami; przy większej liczbie **rozbić na podekrany**.
- **Konto, informacje o aplikacji, pomoc i opinie to osobne miejsca, nie pozycje na
  liście ustawień.**
- Zaczynać od architektury informacji, nie od listy przełączników.
- Polityka domyślnych wartości: „uprzejme domyślne", czyli takie, których większość
  nie musi zmieniać.

Nasz stan (z inwentaryzacji kodu): ustawienia leżą w **trzech niepowiązanych miejscach** —
profil (`index.html:337-368`), zwijana sekcja „Pokój" na pulpicie (`index.html:289-327`)
i przełącznik motywu w nagłówku (`src/main.js:96-125`). Właściciel chce trzech poziomów:
**profil / grupa / aplikacja**. To się składa z wytyczną: trzy poziomy to trzy zbiory,
a nie jedna długa lista.

### 9.5 Historia zmian

Wzorzec ([AppMaster](https://appmaster.io/blog/audit-logging-internal-tools-activity-feed),
[wolf-tech](https://wolf-tech.io/blog/designing-an-activity-feed-for-b2b-saas-events-aggregation-and-privacy-safe-logging)):
rozdzielić **dziennik zdarzeń** (dopisywany, kompletny, źródło prawdy) od **strumienia
dla człowieka** (zagregowany, czytelny, bez szumu). Wpis odpowiada na pięć pytań: kto,
co, jaka zmiana, kiedy, skąd.

Dla nas ważna jest agregacja: przy 12–25 osobach odklikujących pozycje równocześnie
surowy dziennik zamieni się w ścianę. Grupować po człowieku i oknie czasu
(„Kasia odkliknęła 4 pozycje · 19:41"), rozwijać na żądanie. Zdarzenia warte pokazania:
zmiana kwoty rachunku, dodanie/usunięcie pozycji, zmiana składu, wpłata i jej
potwierdzenie, usunięcie rachunku. Odklikanie własnej pozycji **nie** jest zdarzeniem
dziennika — jest już widoczne na żywym paragonie.

### 9.6 Responsywność

Ustalenia ([Framer](https://www.framer.com/blog/responsive-breakpoints/),
[BrowserStack](https://www.browserstack.com/guide/responsive-design-breakpoints)):

- Rozciągnięcie układu telefonowego na tablet to najczęstszy błąd: elementy wyglądają
  na przeskalowane, a nie zaprojektowane. **Adaptacja na tablet jest strukturalna, nie
  proporcjonalna.**
- Punkt łamania wynika z układu, nie z listy urządzeń. 3–5 punktów wystarcza.
- Podejście od telefonu w górę (`min-width`) jest standardem.

Nasz stan: **jeden punkt łamania w całym projekcie** — `640 px`, użyty wyłącznie do
kosmetyki arkuszy (`src/tailwind.css:402`, `:556`). Kontener ma `max-w-4xl`
(`index.html:165`), czyli na desktopie jedna kolumna rozciąga się do 56 rem i wygląda
dokładnie tak, jak opisuje ten błąd. Audyt chodzi na jednej szerokości 390 px na sztywno
(`tools/audit-layout.mjs:13`) i nie da się go sparametryzować — to jest pierwsza rzecz
do naprawienia w narzędziach, bo bez tego nie zobaczymy niczego, co budujemy.

### 9.7 Czego research NIE zmienia

Sprawdzone i odrzucone jako sprzeczne z `PRODUCT.md`:

- **Kategorie wydatków i wykresy** — obecne w każdej aplikacji do finansów osobistych,
  u nas jawnie poza zakresem.
- **Konta i lista znajomych** (rozwiązanie Splitwise na „kto to jest") — łamie zasadę
  „zero progu wejścia". Tożsamość zostaje przy pokoju.
- **Saldo zbiorcze mieszające waluty** — poza zakresem, mimo że tak robi konkurencja.
- **Gotowe żarty w szablonach przypomnień** — łamie zasadę głosu produktu: humor
  pochodzi wyłącznie od człowieka.

---

## 10. ARCHITEKTURA INFORMACJI (rozstrzygnięcia właściciela 2026-08-05)

Cztery decyzje podjęte przez właściciela po researchu z §9. To jest mapa, którą buduje
się partiami — nie propozycja.

### 10.1 Miejsca

Pasek ma **pięć segmentów** i jest widoczny na każdym ekranie wewnątrz pokoju.

| Segment | Co niesie | Skąd się bierze dzisiaj |
|---|---|---|
| **Bilans** *(wejście)* | mój nominał per waluta, twarze ekipy, lista „co czeka na Ciebie", rozwijane „ile kto wyłożył" | `renderBalancePanel()` `src/main.js:895`, `computeSpending()` `:1273` (dziś w profilu) |
| **Rozliczenia** | „kto komu ile" / „najmniej przelewów", moje wiersze na górze, wpłaty do potwierdzenia, historia, arkusz płatności | `renderSettlements()` `src/main.js:986` — dziś sekcja pulpitu |
| **[+]** | nowy rachunek, morfowanie koła w arkusz (§4) | `new-bill-modal` `index.html:509` |
| **Rachunki** | lista z filtrami, grupowaniem po dacie i licznikiem | `renderBillsList()` `src/main.js:1356` |
| **Ty** | profil (zdjęcie, ksywka, kolor, metody płatności) + **Aplikacja** (motyw, powiadomienia, instalacja, pomoc) | `renderProfile()` `src/main.js:1288` + motyw `:96-125` + push `:2492` |

Poza paskiem, ale wewnątrz pokoju:

- **Ekran rachunku** — pasek zostaje widoczny (dziś znika, `src/main.js:467-473`).
- **Ustawienia pokoju** — arkusz spod **nazwy pokoju** w nagłówku, z chevronem.
  Wchłania zwijaną sekcję „Pokój" (`index.html:289-327`), która znika z pulpitu.
- **Skrzynka** — arkusz spod dzwonka (`#nudges-bell`), dwa segmenty: **Dla Ciebie**
  i **Wszystko**. Opis w 10.2.

Ekrany poza pokojem (`start`, `join`, `loading`) paska nie mają — nie ma czego przełączać.

**Znika bez zamiennika:** zwijana sekcja „Pokój", awatar w nagłówku jako wejście do
profilu (zostaje jako niekliakalny podgląd tożsamości), zakładki przewijające do sekcji,
podwójne wejście do „kto komu ile" i do rachunków.

### 10.2 Powiadomienia — trzy poziomy, jeden próg

Decyzja właściciela: *„powiadomienia muszą się ograniczać do najważniejszych i kluczowych.
Nie chcę spamu i widocznej KAŻDEJ zmiany"*. Stąd twardy podział — sygnał **kosztuje**,
więc dostaje go tylko to, co dotyczy moich pieniędzy albo mojego ruchu.

**Poziom 1 — push i odznaka liczbowa.** Dotyczy moich pieniędzy i domyka dług.

| Zdarzenie | Dlaczego tu |
|---|---|
| Przypomnienie o zwrocie skierowane do mnie | treść widzi wyłącznie adresat; to jest windykacja |
| Ktoś zgłosił wpłatę do mnie i czeka na moje potwierdzenie | blokuje domknięcie długu po mojej stronie |
| Odbiorca potwierdził moją wpłatę | zamyka pętlę; bez tego użytkownik nie wie, że skończył |

**Poziom 2 — kropka na zakładce, bez pusha.** Coś mnie dotyczy, ale nie ma pilności.

| Zdarzenie | Gdzie kropka |
|---|---|
| Nowy rachunek, w którym jestem uczestnikiem | Rachunki |
| Rachunek czeka na moje odklikanie („uzupełnij swoje koszty") | Rachunki + błękit stanu na kafelku |
| Zmieniła się kwota rachunku, w którym mam udział | Rachunki |

**Poziom 3 — Aktywność, zero sygnału.** Wchodzisz, kiedy chcesz wiedzieć.

Kto co odkliknął, dodanie i edycja pozycji przez innych, zmiana składu rachunku,
ukrycie rachunku, dołączenie kogoś do pokoju, zmiana nazwy pokoju, usunięcie rachunku.

**Reguły progu** (bez nich wracamy do ślepoty na czerwoną kropkę, §9.3):

1. Odznaka **liczbowa** wyłącznie dla poziomu 1. Nigdy dla poziomu 2.
2. Kropka gaśnie po wejściu w miejsce, którego dotyczy. Odznaka gaśnie po obsłużeniu
   sprawy, nie po samym obejrzeniu.
3. Poziom 3 **nie zapala niczego, nigdy** — ani kropki na zakładce, ani na dzwonku.
4. Nic, co zrobiłem sam, nie generuje sygnału dla mnie.
5. Push wychodzi wyłącznie z poziomu 1 i tylko wtedy, gdy aplikacja jest zamknięta;
   przy otwartej wystarcza toast, jak dziś (`onMessage`, `src/main.js:2551`).

**Skrzynka** ma dwa segmenty: **Dla Ciebie** (poziom 1 i 2, domyślny, tu żyje odznaka)
oraz **Wszystko** (pełna Aktywność, poziom 3, agregowana po człowieku i oknie czasu —
„Kasia odkliknęła 4 pozycje · 19:41"). Historia zmian jednego rachunku jest dostępna
także z ekranu tego rachunku, bo tam jest jej kontekst.

### 10.3 Ustawienia — trzy zbiory, dwa wejścia

| Zbiór | Wejście | Zawartość |
|---|---|---|
| **Profil** | zakładka „Ty" | zdjęcie, ksywka, kolor, metody płatności |
| **Aplikacja** | zakładka „Ty", niżej | motyw, powiadomienia push, instalacja PWA, pomoc, o aplikacji |
| **Pokój** | nazwa pokoju w nagłówku | nazwa, kod i QR, link, skład grupy, miejsce na zdjęcia, waluta domyślna, szablony przypomnień, opuszczenie pokoju |

Ustawienia pokoju stoją przy rzeczy, której dotyczą — to samo rozstrzygnięcie co §3.
Przy składzie grupy trzeba się odnieść do świadomie otwartego ryzyka z `PRODUCT.md`:
**każdy członek może podmienić cudzy numer konta**. Skoro ryzyko zostaje, interfejs ma
je pokazywać — zmiana cudzej metody płatności jest zdarzeniem Aktywności, widocznym.

### 10.4 Rachunki

- **Filtry pigułkami, zawsze widoczne**: `Wszystkie` · `Czekają na Ciebie` · `Moje` ·
  `Ukryte`, a wymiary **osoba** i **waluta** w arkuszu filtra. Aktywny filtr zostaje
  na ekranie jako pigułka do skasowania (§9.2).
- **Nagłówki dat** zamiast płaskiej listy: „Dzisiaj / Wczoraj / 3 sierpnia".
- **Licznik nad listą**: „7 rachunków · 1 240,00 zł". Suma tego, co widać po filtrze —
  nie statystyka, nie kategoria.
- Dzisiejszy stan do zastąpienia: `currentBillFilter` z dwiema wartościami
  (`src/main.js:558`), `getBillUserState()` (`:1348`).

### 10.5 Stany puste

Cztery, wszystkie dziś nieobsłużone albo szczątkowe:

| Miejsce | Stan | Co ma mówić |
|---|---|---|
| Bilans | pokój bez rachunków | zachęta do pierwszego rachunku, kod pokoju do podania przy stole |
| Rozliczenia | zero długów | **moment nagrody** — „Wszystko wyrównane", nie pusta lista |
| Rachunki | filtr bez wyników | co odfiltrowano i jak to skasować jednym stuknięciem |
| Skrzynka | brak spraw | spokojnie, bez zachęty do działania |

### 10.6 Responsywność

Decyzja właściciela: **jedna kolumna szersza, listy w siatce 2×**. Master-detail
odrzucony.

| Od | Co się zmienia |
|---|---|
| `<640` | telefon: jedna kolumna, arkusze od dołu, pasek dolny — stan dzisiejszy |
| `≥640` | arkusze wracają na środek (jest, `src/tailwind.css:402`) |
| `≥768` | **tablet**: kontener rośnie, listy rachunków i wierszy rozliczeń łamią się na dwie kolumny kafelków; nominał bilansu i ekran rachunku zostają jedną kolumną |
| `≥1024` | kontener zatrzymuje się na 56 rem (`max-w-4xl`, `index.html:165`); siatka 2× zostaje, pasek pływa wyśrodkowany |

Kwota nigdy nie wchodzi do siatki — bohater zostaje w kolumnie. Wartości liczbowe
trafiają do `DESIGN.md` jako kontrakt, razem z rozszerzeniem `tools/audit-layout.mjs`
o parametr szerokości (dziś 390 px na sztywno, `tools/audit-layout.mjs:13`).

### 10.7 Pomoc „?" — wyjaśnia ekran, na którym stoisz

Życzenie właściciela 2026-08-05: *„chcę mieć jakiś rodzaj tutorialu, na razie w prostej
wersji ten button ?, który wytłumaczy prosto najważniejsze rzeczy. Bardzo proste
i zrozumiałe. Jak w niego klikniemy, tłumaczy, co robią poszczególne buttony i sekcje"*.

**Wersja pierwsza: legenda ekranu.** „?" stoi w nagłówku każdego miejsca (jest już jako
`#help-fab`, `help-modal` `index.html:543`) i otwiera arkusz z listą tego, co jest na
tym ekranie: **ikona taka sama jak w interfejsie + jedno zdanie**. Nic więcej.

- Treść **zależy od miejsca** — na Rachunkach tłumaczy filtry i kafelek, na Rozliczeniach
  dwa tryby i wpłatę, na rachunku żywy paragon i sumę kontrolną.
- Jedno zdanie na pozycję, język prosty, bez słownictwa produktowego. Test: zrozumiałe
  dla kogoś, kto pierwszy raz widzi aplikację, w hałasie, w dwadzieścia sekund.
- Kolejność pozycji = kolejność na ekranie, z góry na dół. Legenda nie jest spisem funkcji,
  tylko mapą tego, co użytkownik właśnie widzi.
- Zamyka się jak każdy arkusz: tło, Escape, uchwyt.

**Czego tu nie ma i dlaczego:** przymusowego przewodnika po pierwszym wejściu (blokuje
scenę „dwadzieścia sekund przy stole"), dymków prowadzących krok po kroku i kropek
„nowość". Pomoc jest **na żądanie**. Prowadzenie krok po kroku zostaje jako możliwa
druga wersja, po zbudowaniu legendy — nie odwrotnie.

### 10.8 Pierwsze uruchomienie — dodanie do ekranu początkowego

Życzenie właściciela: informacja ma się pokazać **przy pierwszym uruchomieniu**, nie wisieć
ciągle, a potem być dostępna w ustawieniach. Decyzja należy do użytkownika.

**Kiedy:** raz, po pierwszym wejściu **do pokoju** — nie na ekranie startowym. Zanim
człowiek zobaczy wartość, propozycja instalacji jest zaczepką.

**Warunki wyświetlenia** (wszystkie muszą być spełnione):

1. aplikacja nie chodzi już jako zainstalowana (`display-mode: standalone`),
2. użytkownik nie widział tej propozycji wcześniej (znacznik w `localStorage`),
3. jest w pokoju, nie na ekranie startowym.

**Postać:** arkusz od dołu, dwa wyjścia — „Dodaj" i „Nie teraz". Oba zamykają na zawsze;
żadnego przypominania, żadnego drugiego podejścia. Odrzucenie jest odpowiedzią, nie
odroczeniem.

**Dwie ścieżki, bo systemy różnią się naprawdę:**

| System | Co się dzieje |
|---|---|
| Android / Chrome | „Dodaj" wywołuje systemowe okno instalacji (`beforeinstallprompt`, mamy w `setupPwaInstallButton()` `src/main.js:2563`) |
| **iPhone / Safari** | systemowego okna **nie ma** — arkusz pokazuje trzy kroki z ikoną Udostępnij: *Udostępnij → Do ekranu początkowego → Dodaj* |

**Ostrzeżenie do wpisania w ścieżkę iOS:** skrót z ekranu początkowego otwiera ekran
startowy, nie pokój, i ma osobny magazyn danych (`PRODUCT.md`, „Znany problem: PWA na
iPhonie"). Instrukcja musi więc kończyć się **kodem pokoju do wpisania po instalacji** —
inaczej użytkownik wykonuje trzy kroki i ląduje w pustej aplikacji. To jest jedyny
uczciwy sposób podania tego, dopóki dynamiczny `start_url` nie zostanie potwierdzony
na żywym telefonie.

**Później:** stałe wejście „Dodaj do ekranu początkowego" w **Ty → Aplikacja** (10.3),
z tą samą treścią. Dziś ten przycisk siedzi w zwijanej sekcji „Pokój"
(`#install-pwa-btn`, `#ios-install-hint`, `index.html:289-327`), która znika — przenosi
się razem z resztą ustawień aplikacji.

---

## 11. PARTIA 1 — SZKIELET NAWIGACJI (zbudowane 2026-08-05)

Pierwsza partia budowy IA z §10. Zamknięta audytem na czterech szerokościach
(360 / 390 / 834 / 1280), przebiegiem przycisków i 157 testami.

### Co weszło

| Zmiana | Gdzie |
|---|---|
| Zakładki są **miejscami**, nie skokami przewijania: `view-balance`, `view-settle`, `view-bills` | `index.html`, `showDeckView()` w `src/main.js` |
| Pasek **widoczny na ekranie rachunku** i na profilu; na rachunku podświetla „Rachunki" | `showScreen()` |
| Awatar w nagłówku przestał być przyciskiem — jest podglądem tożsamości | `index.html` (nagłówek pokoju) |
| Strzałka „wróć" z profilu usunięta — powrót idzie paskiem | ekran profilu |
| **Ustawienia pokoju** jako arkusz spod nazwy pokoju (kod, link, udziały, miejsce na zdjęcia) | `#room-settings-modal` |
| Zwijana sekcja „Pokój" **skasowana**, nie przestylowana | pulpit |
| **Aplikacja** na ekranie „Ty": powiadomienia, motyw, „Jak to działa", instalacja PWA | ekran profilu |
| Motyw przeniesiony z nagłówka pokoju do „Aplikacji"; ikona pokazuje stan WŁĄCZONY, nie docelowy | `applyTheme()` |
| Zwijanie rozliczeń usunięte — miejsca się nie zwija | pulpit |
| Pomoc „?" zna ekran profilu; treść pomocy pulpitu opisuje pasek, a nie nieistniejący wybór „prosty / zaawansowany" | `HELP_CONTENT` |
| Stan pusty na Bilansie: „Pokój jest pusty" + kod pokoju; podpis zera rozróżnia „nic nie policzone" od „wszystko rozliczone" | `renderBalancePanel()` |

### Naprawy układu z tej samej partii

- **Koło [+] stoi na środku paska** niezależnie od aktywnej zakładki. Zakładki siedzą
  w dwóch skrzydłach o równej szerokości (`.deck-side`); wcześniej rozwinięcie
  „Rachunki" spychało jedyny przycisk akcji w lewo.
- **Aktywna pigułka jest jasna także w ciemnym motywie** — wcześniej `--surface` na
  `--surface-2` znaczyło „tu jesteś" wyłącznie etykietą.
- **Cel dotykowy wyboru statusu ma realne 44 px** (otoczka straciła odstęp pionowy,
  który tylko wyglądał na klikalny).
- **Radio „Kwota / Procent"** klika się całą etykietą, nie 16-pikselowym kółkiem.
- **Nazwa pokoju schodzi o stopień skali poniżej 640 px** — przy 3 rem „Wyjazd
  w Bieszczady" kończył się na „Wyjazd w …".
- **Listy rachunków i rozliczeń łamią się na dwie kolumny od 768 px** (kontrakt
  responsywności z `DESIGN.md`; kwota zostaje w jednej kolumnie).

### Zmiana w narzędziu audytowym

`tools/audit-layout.mjs` liczy teraz zasłonięcie przez pasek **w układzie dokumentu**:
zgłasza wyłącznie treść, której spod paska nie da się wyjąć przewinięciem (czyli tę,
która przy końcu przewijania nadal siedzi pod paskiem). Odkąd pasek jest widoczny wszędzie,
chwilowe nachodzenie przy przewijaniu jest normą, a nie usterką — bez tej poprawki narzędzie
zgłaszało kilkanaście fałszywych alarmów na ekran. Ścieżka audytu obeszła nowe miejsca:
`12-rozliczenia`, `13-rachunki`, `14-ustawienia-pokoju`, `15-profil`, `16-profil-jasny`.

### Partia 1b — interakcje i kontrolki (2026-08-05, po uwagach właściciela)

| Uwaga właściciela | Co zrobione |
|---|---|
| „Ile kto wydał" nie ma być w profilu | rozpiska usunięta; statystyka pokoju (Twoje udziały / cała grupa) została w ustawieniach pokoju |
| „Jak to działa" w profilu bez sensu, skoro jest „?" | przycisk usunięty; pomoc żyje wyłącznie pod „?" i zna też ekran profilu |
| Wybór koloru wygląda amatorsko | jedno pole „Kolor znaku" z bieżącą barwą; paleta w arkuszu, kółka bez liter, wybrane z ptaszkiem |
| Pasek nachodzi, brzydki [+] | cztery zakładki o stałej, równej szerokości z podpisem pod ikoną widocznym zawsze; pasek ma stałą szerokość; koło [+] siedzi w pasku, bez poświaty, z reakcją na naciśnięcie |
| Rozwinięty select wygląda obco | listy systemowe zastąpione arkuszami: status uczestnika, waluta, płatnik |
| Ikona przy selektorze statusu nachodzi | otoczka wyrównuje w osi, chevron wyśrodkowany w pionie, ikona nie jest rozciągana |
| [+] ma morfować w arkusz | View Transitions API — koło rozrasta się w arkusz „nowy rachunek" i zbiega z powrotem; bez wsparcia albo przy ograniczonym ruchu zostaje zwykłe pojawienie |

Przy okazji: kwota rachunku pokazuje się z przecinkiem (480,00), a toast stoi wyżej,
żeby nie stykał się z paskiem.

**Nowe uchwyty:** `#choice-modal` (uniwersalny wybór jednokrotny), `#status-modal`,
`#color-picker-modal`, klasa `.choice-field`. Każdy nowy wybór jednokrotny ma iść przez
`openChoiceSheet` — nie dokładaj nowych elementów `select`.

### Czego partia 1 NIE ruszyła (kolejne partie)

1. **Skrzynka** spod dzwonka i trzy poziomy powiadomień (§10.2) — dzwonek działa po staremu.
2. **Rachunki**: filtry pigułkami `Czekają na Ciebie` / `Moje`, nagłówki dat, licznik
   nad listą (§10.4). Dziś nadal `Wszystkie` / `Ukryte`.
3. **Bilans**: twarze ekipy, lista „co czeka na Ciebie", rozwijane „ile kto wyłożył”
   (dziś „Ile kto wydał” siedzi na ekranie „Ty”).
4. **Ustawienia pokoju**: skład grupy, QR, waluta domyślna, szablony przypomnień,
   opuszczenie pokoju, odniesienie do ryzyka podmiany cudzego numeru konta (§10.3).
5. **Morfowanie [+] w arkusz** (§4) — koło nadal otwiera okno bez przejścia.
6. **Historia zmian** (§10.5 i brief) — niezaczęte.
7. **Stany puste**: zrobiony Bilans; Rozliczenia, Rachunki po filtrze i Skrzynka czekają.

### Partia 1c — dopieszczenie (2026-08-06, po uwagach właściciela)

| Uwaga | Co zrobione |
|---|---|
| Aktywna zakładka źle siedzi na krawędzi paska (rozjazd promieni) | zakładka ma promień pigułki, tak jak pasek; aktywna to jasne koło |
| Awatar w nagłówku ma inną wielkość niż przyciski i jest zbędny | usunięty w całości — zdjęcie i kolor są w zakładce „Ty" |
| Podpisy w pasku zabierają miejsce | pasek to same ikony; nazwa miejsca stoi jako `view-title` na górze każdej zakładki (Bilans / Kto komu ile / Rachunki / Twój profil) |
| Wybór osób wygląda inaczej w trzech miejscach | jeden komponent `person-row` (zdjęcie + imię + okrągły znacznik) w składzie rachunku, uczestnikach nowego rachunku i „kto to wziął" |
| Niespójne przyciski i promienie na ekranie „Ty" | wszystkie wiersze to `settings-row`: jedna wysokość, jeden odstęp, jeden stopień pisma, promień `block` |
| Instrukcja instalacji nie mówi PO CO | arkusz spod „Zainstaluj na urządzeniu": najpierw powód, potem kroki z ikonami Safari, na końcu kod pokoju do wpisania po instalacji |
| Nie widać, że paragon da się odczytać | zdanie pod nagłówkiem „Paragon" mówi o odczycie i o tym, że pozycje idą do sprawdzenia przed wejściem do rachunku |

**Naprawa spoza interfejsu:** odczyt paragonu wracał z 404. Aplikacja w `dev` bierze
projekt z `.env.local` (`billsplitter-push-test`), a emulatory startowały na projekcie
domyślnym z `.firebaserc` (`billsplitter-2fdfa`). Emulator funkcji routuje po
identyfikatorze projektu w adresie, więc wywołanie nie trafiało w nic. `npm run emulators`
startuje teraz z `--project test`. Po zmianie trzeba **zrestartować emulatory**.

---

## 12. PARTIA 2 — RACHUNKI I GĘSTOŚĆ EKRANÓW (2026-08-06)

### Rachunki (§10.4 zrealizowane)

- **Filtry pigułkami, zawsze widoczne**: `Wszystkie` · `Czekają na Ciebie` · `Moje` ·
  `Ukryte`. Rząd przewija się w poziomie, aktywny filtr niesie wypełnienie, nie ramkę.
  - `Czekają na Ciebie` = dokładnie te rachunki, którym `billStatus` daje ton `action`.
    Jedno źródło prawdy dla filtra i dla błękitu na kafelku.
  - **`Moje` = rachunki, za które wyłożyłem pieniądze** (jestem płatnikiem).
    Decyzja robocza — `docs/UI-UX.md` §10.4 nie definiowała tego wymiaru.
    **Do potwierdzenia przez właściciela.**
- **Nagłówki dni**: „Dzisiaj / Wczoraj / 3 sierpnia". Data zeszła z kafelka, na kafelku
  została godzina (rozróżnia dwie kolacje tego samego dnia).
- **Licznik nad listą**: „7 rachunków · 1 240,00 PLN", sumowany po walutach osobno,
  liczony po filtrze.
- **Stany puste z powodem**: każdy filtr ma własne zdanie i przycisk „Pokaż wszystkie".

### Gęstość ekranów (uwagi właściciela 2026-08-06)

| Uwaga | Co zrobione |
|---|---|
| „Najmniej przelewów" ma być domyślne i pierwsze | tryb domyślny to `min`, segment stoi pierwszy; „Kto komu" jako druga opcja |
| „Pozostali w grupie" to za dużo treści | lista cudzych przelewów **zwinięta** pod wiersz „Jeszcze N przelewy w grupie" — informacja dla ciekawskich, nie zadanie |
| Na ekranie rachunku widać wszystkich uczestników | sekcja **zwinięta**, podpis niesie „Ekipa: N osoby · M do uzupełnienia", więc zwinięcie nic nie ukrywa |
| Przy „Ureguluj" brak znaku osoby | arkusz wpłaty pokazuje zdjęcie/kolor odbiorcy przy kwocie |

### Zostało z architektury (§10)

1. **Powiadomienia i skrzynka** (§10.2) — trzy poziomy, kropki na zakładkach, odznaka
   liczbowa tylko dla poziomu 1, skrzynka spod dzwonka. **Następna partia.**
2. **Ustawienia pokoju** (§10.3) — skład grupy z odniesieniem do ryzyka podmiany cudzego
   numeru konta, kod QR, waluta domyślna, opuszczenie pokoju.
3. **Bilans** (§10.1) — twarze ekipy, lista „co czeka na Ciebie".
4. **Historia zmian** i **szablony przypomnień**.
5. Odcień „coś czeka na ciebie" do zejścia z 9 % na 6 % (§5).

---

## 13. PARTIA 3 — PRÓG SYGNAŁU I SKRZYNKA (2026-08-06)

Realizacja §10.2. Sam próg jest **czystą funkcją z testami** (`src/nudges.js`:
`inboxItems`, `badgeCount`, `hasDot`; 7 przypadków w `src/nudges.test.js`), bo to on
decyduje, czy użytkownik ufa czerwonej kropce, czy przestaje ją widzieć.

| Poziom | Nośnik | Co wchodzi |
|---|---|---|
| **1** | odznaka **liczbowa** przy dzwonku | przypomnienie do mnie (nieprzeczytane), cudza wpłata do mnie czekająca na moje potwierdzenie, potwierdzenie mojej wpłaty przez odbiorcę |
| **2** | **kropka** na zakładce „Rachunki", bez liczby | rachunek czekający na mój ruch (ton `action` z `billStatus`) |
| **3** | nic | reszta — do obejrzenia w segmencie „Wszystko" |

**Reguły, które kod faktycznie egzekwuje:**

- Liczba wyłącznie dla poziomu 1 (`badgeCount` filtruje po `level === 1`).
- Kropka gaśnie po wejściu w „Rachunki" i zapala się ponownie dopiero przy rachunku,
  którego tam jeszcze nie widziałem (`markBillsSeen`, klucz `billsplitter_seen_bills_<pokój>`).
- Potwierdzenie mojej wpłaty gaśnie po otwarciu skrzynki — nie ma czego „obsłużyć",
  samo obejrzenie zamyka sprawę (`billsplitter_seen_confirmations_<pokój>`).
- Nic, co zrobiłem sam, nie wraca do mnie jako sygnał (warunki na `myId` / `myUid`).
- Stan „widziane" mieszka w `localStorage` per pokój — to sprawa tego telefonu,
  nie fakt o rachunku.

**Skrzynka** (dzwonek w nagłówku): dwa segmenty. „Dla Ciebie" pokazuje sprawy poziomu 1
i 2 z akcją przy każdej (Ureguluj, Potwierdzam, Otwórz rachunek). „Wszystko" to rejestr
złożony z przypomnień i wpłat.

**Świadome ograniczenie:** pełna Aktywność z §10.2 poziom 3 (kto co odkliknął, edycje
pozycji, zmiany składu) wymaga osobnej kolekcji zdarzeń w Firestore — nie da się jej
odtworzyć z dzisiejszych danych. Segment „Wszystko" pokazuje więc to, co jest zapisane:
przypomnienia i wpłaty. Dopisanie kolekcji zdarzeń zostaje jako osobna partia, razem
z **historią zmian rachunku**, bo to ten sam mechanizm.

---

## 14. PARTIA 4 — USTAWIENIA POKOJU (2026-08-06)

Realizacja §10.3. Wszystko żyje w arkuszu spod nazwy pokoju.

| Rzecz | Jak działa |
|---|---|
| **Kod QR** | rysowany lokalnie (`qrcode-generator`, bez sieci — aplikacja pracuje offline), zwinięty do stuknięcia, korekcja „M" |
| **Skład grupy** | lista osób ze zdjęciem, „to Ty", „wolne — nikt jeszcze nie zajął" i liczbą sposobów płatności; dopisanie osoby do żyjącego pokoju |
| **Ryzyko podmiany numeru konta** | wypowiedziane wprost pod składem: każda osoba w pokoju może zmienić cudzy numer, więc przed przelewem na nowy numer trzeba potwierdzić to poza aplikacją |
| **Waluta domyślna** | pole pokoju `defaultCurrency`, którego używa nowy rachunek; istniejące rachunki zostają przy swojej (kurs zapisuje się w dniu dodania) |
| **Opuszczenie pokoju** | zwalnia moje imię (`claimedBy: null`) i kasuje skrót z tego urządzenia; rachunki i rozliczenia zostają |

**Przy okazji:** jedno okno potwierdzenia dla całej aplikacji (`openConfirm`,
`#confirm-modal`) — decyzja nieodwracalna nie zamyka się kliknięciem w tło.
Sumy pokoju piszą się przecinkiem, jak wszystkie inne kwoty.

**Nowa zależność:** `qrcode-generator` (bez zależności własnych, ~10 kB w buildzie).
Uwaga przy pracy: `npm install` czegokolwiek usuwa puppeteera zainstalowanego
z `--no-save`, więc po zmianie zależności trzeba go wgrać ponownie:
`npm i --no-save puppeteer`.

### Co zostało z architektury

1. **Bilans** (§10.1) — twarze ekipy, lista „co czeka na Ciebie", rozwijane „ile kto wyłożył".
2. **Kolekcja zdarzeń** — pełna Aktywność (poziom 3 progu) i **historia zmian rachunku**.
   To jeden mechanizm i jedna partia.
3. **Własne szablony przypomnień** z domyślną klasyczną treścią.
4. Odcień „coś czeka na ciebie" do zejścia z 9 % na 6 % (§5).

---

## 15. PARTIA 5 — BILANS JAKO WEJŚCIE DO POKOJU (2026-08-06)

Realizacja §10.1 w zakresie, który przetrwał późniejsze decyzje właściciela.

| Element | Dlaczego tak |
|---|---|
| **Twarze ekipy** pod nominałem | sam nominał nie mówi, kogo dotyczy; przy 12–25 osobach rząd zdjęć odpowiada na „czy wszyscy już są?" szybciej niż lista imion w ustawieniach. Rząd przewija się w poziomie, żeby kwota została bohaterem ekranu |
| **„Czeka na Ciebie"** | te same sprawy, co w skrzynce (poziom 1 i 2 progu), ale na wejściu do pokoju. Skrzynka jest dla tych, którzy jej szukają; ta sekcja dla tych, którzy po prostu weszli. Znika bez śladu, gdy nic nie czeka |
| Jedna obsługa wierszy | `wireInboxActions` podpięte do skrzynki i do Bilansu — ta sama sprawa nie może reagować inaczej zależnie od miejsca, w którym ją widzisz |

**Świadomie pominięte z §10.1:** rozwijane „ile kto wyłożył" na Bilansie. Właściciel
rozstrzygnął 2026-08-06, że rozpiska per osoba znika, a statystyka pokoju zostaje
w ustawieniach pokoju. Późniejsza decyzja wygrywa z wcześniejszą architekturą — ten
wiersz w §10.1 jest nieaktualny.

### Stan po pięciu partiach

Zrobione: nawigacja jako miejsca, arkusze zamiast list systemowych, spójne kontrolki,
rachunki z filtrami i dniami, próg sygnału ze skrzynką, ustawienia pokoju, bilans jako
wejście.

Zostało:

1. **Kolekcja zdarzeń** w Firestore — pełna Aktywność (poziom 3) i **historia zmian
   rachunku**. Jeden mechanizm, jedna partia. Do zaprojektowania: kształt dokumentu
   zdarzenia, kto go pisze, jak długo żyje.
2. **Własne szablony przypomnień** z domyślną klasyczną treścią (brief §7). Uwaga
   z `PRODUCT.md`: bramka to dziesięć sekund, więc przy szablonach **nie dokładaj
   limitów, których nie ma**.
3. Odcień „coś czeka na ciebie" do zejścia z 9 % na 6 % (§5).
4. Nazwa produktu i logo — otwarte, nazwa musi być angielska (§2).

---

## 16. PARTIA 6 — DZIENNIK AKTYWNOŚCI I SZABLONY PRZYPOMNIEŃ (2026-08-06)

### Dziennik aktywności (kolekcja `events`)

Nowa podkolekcja pokoju: `groups/{id}/events`. **Append-only** — reguły pozwalają czytać
i dopisywać, ale `update` i `delete` są zamknięte na głucho, także dla autora wpisu.
Dziennik, który da się poprawić albo wyczyścić, nie jest dziennikiem.

Etykieta powstaje **w chwili zapisu** i jest gotowym zdaniem („zmienił/a kwotę rachunku
„Kolacja" z 100,00 PLN na 120,00 PLN"). Dzięki temu odczyt nie wymaga rachunku, którego
już może nie być — wpis o usuniętym rachunku dalej się czyta.

Zapisywane zdarzenia: zmiana kwoty rachunku, wskazanie płatnika, dodanie / edycja /
usunięcie pozycji, odklikanie pozycji (kto co wziął), zmiana składu rachunku, dopisanie
osoby do pokoju.

Zapis jest **najlepszym staraniem**: gdy się nie uda, akcja użytkownika i tak się wykonała
i nie ma powodu jej przerywać komunikatem o dzienniku. Gdy reguły w emulatorze są starsze
niż `firestore.rules` (typowe zaraz po zmianie), aplikacja pracuje dalej z pustą historią.

Gdzie widać:

- **Historia zmian** na ekranie rachunku — zwinięta, z licznikiem wpisów. Tam jest jej
  kontekst.
- **Skrzynka → Wszystko** — dziennik zmieszany z przypomnieniami i wpłatami, najnowsze
  pierwsze. Poziom 3 progu: zero sygnału, wchodzisz kiedy chcesz wiedzieć.

Testy reguł (`npm run test:rules`, 32 przypadki) pilnują trzech rzeczy: dopisać można
tylko w swoim imieniu, wpisu nie da się zmienić ani skasować (także własnego), a czytać
może każdy z linkiem.

### Szablony przypomnień

Przycisk „Przypomnij" otwiera **kompozytor** zamiast wysyłać od razu:

- Domyślna treść jest **rzeczowa i wpisana z góry**: *„Cześć! Przypominam o zwrocie za
  nasz wspólny rachunek. Dzięki!"*. Produkt nie żartuje przy kwocie ani przy błędzie —
  humor może dołożyć wyłącznie człowiek, wpisując własną treść, i wtedy jest to jego żart.
- Własne szablony (do pięciu) zapisują się **na urządzeniu**, pigułkami nad polem treści.
- Treść widzi **adresat**, w skrzynce, jako cytat oddzielony od zdania aplikacji.
- **Bramka pozostaje dziesięć sekund** — przy szablonach nie dokładamy limitów, których
  nie ma (`PRODUCT.md`).

**Granica techniczna wypowiedziana wprost:** reguły Firestore nie potrafią ukryć
pojedynczego pola dokumentu przed resztą grupy. „Treść widzi wyłącznie adresat" jest więc
zasadą interfejsu, nie gwarancją kryptograficzną — ktoś z konsolą i linkiem do pokoju
odczyta pole `message`. Domknięcie wymagałoby kont i osobnej kolekcji per odbiorca.

### Stan zamknięcia redesignu

Wszystkie punkty zakresu z `docs/NEXT-SESSION.md` są zrobione. Otwarte zostają:

1. **Nazwa produktu i logo** — decyzja właściciela, nazwa musi być angielska (§2).
2. **Font Awesome** — ikony do wymiany na własny zestaw (§6), jedyne zgłoszenie detektora
   poza znanym `broken-image`.
3. **Konta zamiast tożsamości przypiętej do urządzenia** — domknęłoby też ryzyko podmiany
   cudzego numeru konta i granicę prywatności treści przypomnień.

---

## 17. DOŁĄCZANIE DO POKOJU — trzy drogi (2026-08-06)

Wymóg właściciela: ma działać jak Tricount — **bez logowania**, link wystarcza.

| Droga | Jak działa | Gdzie w kodzie |
|---|---|---|
| **Link** | `?group=<id>` prowadzi na ekran wyboru imienia; wybór przypina sesję urządzenia do imienia (`claimedBy`) | `handleGroupJoin` |
| **Kod pokoju** | pole „Masz kod pokoju?" na ekranie startowym; sprawdza istnienie pokoju PRZED przełączeniem ekranu i mówi wprost, gdy kodu nie ma | `enterByCode` w `setupStartScreenListeners` |
| **Kod QR** | koduje ten sam link; skan aparatem wchodzi do pokoju | `renderRoomQr` w ustawieniach pokoju |

**Pułapka wielkości liter (naprawiona 2026-08-06):** identyfikator pokoju powstaje
z `Math.random().toString(36)`, więc jest **małymi literami**, a `formatSerial` pokazuje
go **wielkimi**, bo tak czyta się numer z cudzego telefonu. Wpisany kod trzeba sprowadzić
do małych liter — bez tego wyszukanie pudłuje zawsze, przy każdym kodzie. Gdyby kiedyś
doszedł inny sposób nadawania kodów, `enterByCode` próbuje też wariantu „jak wpisano".

**Tożsamość zostaje na urządzeniu** (`claimedBy` w dokumencie grupy + lista pokoi
w `localStorage`). Konsekwencje, świadomie przyjęte do wersji dla znajomych:

- wyczyszczenie danych przeglądarki = utrata listy pokoi; wraca się linkiem albo kodem,
- ten sam człowiek na drugim urządzeniu przejmuje imię (jest okno „to imię jest zajęte"),
- wgląd we wszystkie swoje pokoje z dowolnego urządzenia wymaga **kont** — planowane
  dopiero przy monetyzacji, zgodnie z decyzją właściciela z 2026-08-06.

---

## 18. ZGODNOŚĆ PRZEGLĄDAREK I KONIEC ZALEŻNOŚCI OD SIECI (2026-08-06)

### Dwie rzeczy przychodziły z cudzych serwerów — już nie

Build wysyłany znajomym ciągnął **Font Awesome z cdnjs** i **heic2any z jsdelivr**.
Przy zablokowanym CDN (firmowe wifi, blokada reklam) albo słabym zasięgu w lokalu
znikała **cała ikonografia** — pasek nawigacji, chevrony, aparat, statusy — a zdjęcie
z iPhone'a nie wchodziło bez zrozumiałego komunikatu. Aplikacja, która deklaruje pracę
offline, nie może zależeć od cudzego serwera przy pierwszym otwarciu.

- **Ikony** wchodzą do buildu przez `src/tailwind.css` (`fontawesome.css` + `solid.css`).
  Bierzemy wyłącznie rodzinę `solid`, bo tylko jej używamy — 65 wystąpień `fas`, zero
  ikon marek. Koszt: 119 kB woff2.
- **heic2any** wczytuje się **dynamicznie**, dopiero przy wybraniu pliku HEIC
  (`loadHeic2Any`). Waży 1,35 MB, a większość wejść nie dotyka zdjęć — nie ma powodu,
  żeby każdy płacił za nią czasem pierwszego otwarcia.
- **Pułapka wersji:** pakiet to Font Awesome **7**, a w `index.html` stała zaszyta
  rodzina `'Font Awesome 6 Free'` z czasów CDN-u. Po wciągnięciu ikon do buildu ta nazwa
  przestała istnieć i chevron przy statusie znikał bez śladu. Przy zmianie wersji pakietu
  trzeba przejrzeć zaszyte nazwy rodzin.

Sprawdzone przebiegiem z **zablokowaną siecią**: strona nie wykonuje ani jednego żądania
poza `localhost`, `document.fonts.check('900 32px "Font Awesome 7 Free"')` zwraca `true`,
a font przychodzi z `/node_modules/@fortawesome/...` (w produkcji: z `dist/assets`).

W buildzie zostają wyłącznie adresy usług Firebase (logowanie, rejestracja FCM) oraz
`open.er-api.com` dla kursów walut — ten ostatni ma `try/catch`, więc brak sieci nie psuje
aplikacji, tylko pomija przelicznik.

### Granica wsparcia wypowiedziana wprost

`vite.config.js` ma teraz `build.target: ['safari15.4', 'chrome107', 'firefox115']`.
Safari 15.4 jest progiem naturalnym: od niego działa selektor `:has()`, na którym stoi
chowanie paska przy otwartym arkuszu i odsunięcie treści spod paska offline.

| Rzecz | Chrome (Android/desktop) | Safari iOS | Firefox |
|---|---|---|---|
| Układ, arkusze, kontrolki | działa | działa od 15.4 | działa od 121 (`:has()`) |
| Morfowanie `[+]` w arkusz | działa (111+) | **od Safari 18**; niżej zwykłe pojawienie | brak — zwykłe pojawienie |
| Push | działa | **tylko w aplikacji z ekranu początkowego, iOS 16.4+** | działa |
| Instalacja PWA | pełna | ręczna (Udostępnij → Do ekranu początkowego) | ograniczona |
| HEIC z iPhone'a | nie dotyczy | konwersja po stronie przeglądarki | nie dotyczy |
| Kod QR | rysowany lokalnie, bez sieci | jw. | jw. |

Degradacja jest wszędzie bezstratna funkcjonalnie: brak View Transitions oznacza brak
animacji, a nie brak arkusza.

> **Nieaktualne od 2026-08-15 (§19.6).** Wiersz „Morfowanie `[+]` w arkusz" w tabeli wyżej
> opisuje rozwiązanie, którego już nie ma. View Transitions API zostało z aplikacji
> wyrzucone; animacja otwierania arkusza stoi teraz na zwykłym `transform` i `opacity`,
> więc działa jednakowo we wszystkich trzech przeglądarkach z tabeli.

---

## 19. PARTIA 7 — POPRAWKI PO TESTACH NA TELEFONIE (2026-08-15)

Podstawą tej partii jest **piętnaście zrzutów z iPhone'a właściciela** (`Screenshots/`)
plus jego lista uwag. To pierwsza partia oparta na użyciu aplikacji przez człowieka,
a nie na przebiegu automatu, i to widać w jej charakterze: większość rzeczy nie była
brakiem funkcji, tylko obietnicą, której interfejs nie dotrzymywał.

### 19.1 Nazwa produktu: **Billyada**

Nazwa rozstrzygnięta przez właściciela 2026-08-15 i zamyka punkt otwarty z §2.
Zmienione: `<title>`, `apple-mobile-web-app-title`, `manifest.json` (`name`, `short_name`,
`description`), `public/sw.js`, `package.json`, przedrostek w konsoli i teksty pomocy.

**Czego NIE zmieniono i dlaczego:** przedrostek `billsplitter_` w kluczach `localStorage`.
Te klucze trzymają listę pokoi, motyw i szablony przypomnień na urządzeniu. Zmiana
przedrostka wyczyściłaby listę pokoi każdemu, kto już aplikacji używa, a powrót do pokoju
wymagałby wtedy kodu od kogoś innego. Nazwa klucza nikomu się nie wyświetla.

### 19.2 Znak aplikacji

`public/icons/icon.svg` jest źródłem prawdy, `node tools/make-icons.mjs` rasteryzuje go
do pięciu rozmiarów przez puppeteera (już obecnego w repo — dokładanie `sharp` tylko dla
ikony byłoby kosztem bez pokrycia).

Znak: **rachunek przedarty na pół**. Limonkowy prostokąt przecięty ukośną szczeliną,
obie połowy przesunięte względem siebie. Ukos, nie prosta — prosta czyta się jak znak
równości. Przesunięcie, bo bez niego to jeden kształt z kreską w środku. Tło pełne, bez
własnego zaokrąglenia: ikona jest maskowalna, a własny promień dałby ciemną obwódkę
wewnątrz kształtu narzuconego przez system. Znak siedzi w środkowych 66 % kwadratu,
czyli w strefie bezpiecznej.

### 19.3 Dwie ciche awarie znalezione przy okazji

**Nominał bilansu renderował się bez stylu.** `denominationHtml` w `main.js` wypisywał
klasy `denomination`, `denomination-relief`, `denomination-fraction`, `denomination-currency`
— nazwy z odrzuconego świata „druku zabezpieczonego". W arkuszu stylów tych klas NIE MA
(są `amount`, `amount-fraction`, `amount-currency`). Efekt: kwota bilansu szła gołym
tekstem, bez kroju kwot, bez cichszych groszy i bez odstępu przed walutą — stąd zgłoszone
„120,80PLN" sklejone w jedno słowo, dotykające krawędzi limonkowego bloku. Brakująca klasa
nie jest błędem, więc nic tego nie zgłaszało przez cały redesign.

**Waluta domyślna wyglądała na niezmienną.** Etykietę `#room-currency-label` ustawiało
wyłącznie `openRoomSettings`, więc po wyborze arkusz zamykał się, a pole nadal pokazywało
starą walutę. Zapis do bazy działał od zawsze; niewidoczna była tylko jego odpowiedź.
Stąd zgłoszenie „nie mogę zmienić waluty, gdy są już rachunki".

### 19.4 Fundament dotykowy

| Rzecz | Było | Jest |
|---|---|---|
| `viewport` | bez `viewport-fit=cover` | z nim — bez tego `env(safe-area-inset-*)` zwraca ZERA na iPhonie, więc cała obsługa paska gestów była martwa |
| Przybliżanie szczypaniem | działało | wyłączone trzema warstwami: atrybut `viewport`, `touch-action: pan-x pan-y`, blokada `gesturestart` (iOS ignoruje dwie pierwsze) |
| Pasek nawigacji | 17,5 rem, 0,875 rem nad krawędzią, krycie 0,94 | 21,25 rem, 1,5 rem nad paskiem gestów, krycie 0,78 z rozmyciem 24 px; cele 56 px zamiast 44 |
| Zapas na dole treści | klasa `pb-36` w znacznikach | `#app-container` w CSS, `calc(7rem + env(...))` |
| Toast | `bottom-28` wpisane w JavaScripcie | klasa `.toast-dock` licząca wysokość paska i safe-area |

**Pułapka warstw Tailwinda, która wystąpiła DWA razy i musi zostać zapisana.**
Reguła w `@layer base` albo `@layer components` przegrywa z klasą narzędziową w znacznikach,
bo warstwa `utilities` leży nad nimi. Tak zginęło `padding-bottom: env(safe-area-inset-bottom)`
na `.sheet` (każdy arkusz miał `p-5`) i tak samo zginął zapas na `#app-container` (klasa `p-4`).
Objaw jest zawsze ten sam: przyciski stojące tuż nad paskiem gestów iPhone'a. Lekarstwo:
reguła BEZ warstwy, bo styl nieowarstwowany wygrywa z każdą warstwą niezależnie od kolejności.

**Odzew dotknięcia na iOS.** Zgłoszenie „brakuje drobnego feedbacku przy kliknięciu, jest
statycznie" miało jedną przyczynę: Safari nie stosuje pseudoklasy `:active` do niczego,
dopóki dokument nie ma choćby jednego nasłuchu dotyku. Jedna linijka w `init()`
(`body.addEventListener('touchstart', () => {}, { passive: true })`) odblokowuje CAŁY odzew
w aplikacji. Do tego drugi nośnik: `filter: brightness(0.96)` obok `scale(0.97)`, bo palec
zasłania środek przycisku dokładnie wtedy, gdy ten się kurczy — widać wyłącznie obrzeże.

### 19.5 Arkusze: jedna budowa, jedna obietnica gestu

Zgłoszenie: „niektóre zakładki mają kreskę u góry sugerującą, że można przeciągnąć,
a tak naprawdę nic to nie robi; inne mają tylko X; nie ma tu spójności".

Diagnoza była gorsza, niż brzmiała: istniały DWA rody okien. Jedne z uchwytem i przyciskiem
„Zamknij" na dole, drugie z paskiem nagłówka i krzyżykiem. Uchwyt w tych pierwszych był
rysunkiem — obiecywał gest, którego nie było. To gorsze niż brak uchwytu, bo uczy nie ufać
pozostałym znakom w interfejsie.

**Reguła, która to zamyka:**

1. **Uchwyt znaczy „zsuń mnie palcem" i naprawdę zsuwa** (`wireSheetDrag`). Ciągnie się za
   nagłówek; ciągnięcie po treści działa tylko przy liście przewiniętej na sam szczyt —
   tak zachowuje się arkusz systemowy. Opór po przekroczeniu 96 px, zamknięcie po 96 px
   albo przy szybkim machnięciu (0,6 px/ms).
2. **Krzyżyk stoi w nagłówku wtedy i tylko wtedy, gdy w stopce nie ma „Anuluj".** Inaczej
   byłyby dwa przyciski o jednym znaczeniu w jednym oknie.
3. **Okno decyzji nieodwracalnej nie ma ani uchwytu, ani krzyżyka** (`sheet-confirm`),
   i nie zamyka się kliknięciem w tło. Brak uchwytu mówi to, zanim ktokolwiek spróbuje.
4. Budowa jest stała: `sheet-head` (nie przewija) / `sheet-body` (przewija, `overscroll-behavior: contain`)
   / `sheet-foot` (nie przewija). Odstępy siedzą w CSS, nie w klasach `p-5` — patrz pułapka warstw wyżej.
5. Od 640 px uchwyt **znika**: arkusz stoi na środku ekranu, nie przy krawędzi, więc nie ma
   go dokąd zsunąć i nie ma czego obiecywać.

Przy okazji zniknęły **dwie ostatnie listy systemowe** (`<select>`): rodzaj sposobu płatności
i rodzaj kosztu wspólnego. Obie chodzą teraz przez `openChoiceSheet`. Zakaz z DESIGN.md jest
wreszcie prawdziwy w całej aplikacji.

### 19.6 Nowy rachunek: koniec morfowania przez View Transitions

Poprzednie rozwiązanie wyrzucone w całości i **nie wraca**. Trzy powody, wszystkie widoczne
gołym okiem:

1. Limonkowe koło przenikało w BIAŁY arkusz. Między barwami o takiej różnicy jasności
   przenikanie nie czyta się jako przemiana przedmiotu, tylko jako mignięcie.
2. Przy zamykaniu przeglądarka pokazywała najpierw wielki limonkowy kształt ze znakiem [+]
   rozciągnięty na cały arkusz, a dopiero potem go zmniejszała.
3. Safari ma to API dopiero od osiemnastki, więc większość ekipy nigdy tej animacji nie widziała.

**W zamian:** okno `new-bill-modal` nosi klasę `keeps-deck`. Pasek ZOSTAJE na ekranie,
arkusz wyrasta tuż nad nim z zaczepieniem na dole (`transform-origin: bottom center`),
a koło [+] obraca się o 135° w krzyżyk i jest przyciskiem zamknięcia. Nic nie przenika,
nic nie zmienia koloru, droga powrotna jest odwrotnością drogi otwarcia, a całość to
zwykłe `transform` i `opacity` — działa wszędzie tak samo.

Zakładki pod otwartym arkuszem gasną i przestają być klikalne: pasek trzyma w tej chwili
jedną rolę.

**Do rozstrzygnięcia przez właściciela.** `docs/animacje-nowego-rachunku.html` to pole
testowe z pięcioma wariantami tej animacji (nad paskiem, rozwinięcie z koła, kaskada,
wyciągnięcie z paska, podniesienie ekranu), każdy z argumentami za i przeciw. W aplikacji
stoi wariant 1. Podmiana to jedna sekcja w `src/tailwind.css`.

### 19.7 Rachunek: tryb podziału zamiast ręcznego statusu

Właściciel: „nie wiem, co zrobić ze statusem Nieuzupełnione/Uzupełnione; może powinniśmy
go usunąć do ręcznej ingerencji". Decyzja: **usunięty w całości** (wybór właściciela
2026-08-15, wariant „auto + switch").

Status był pytaniem do człowieka o rzecz, którą aplikacja i tak wie. Skutek: rachunek
pokazywał „Nieuzupełnione" komuś, kto wszystko odkliknął, i „Uzupełnione" komuś, kto tylko
przestawił pole. Status kłamał, a kłamiący status przy pieniądzach jest gorszy niż jego brak.
Do tego ta sama zmiana kwoty własnej przestawiała `participants.X.status` na trzy różne
sposoby zależnie od tego, czy jestem płatnikiem.

**Teraz rachunek ma jeden przełącznik `splitMode`:**

- `'even'` (Po równo) — kwota dzieli się na uczestników, nie ma czego uzupełniać, wszyscy
  gotowi od razu. Sekcja pozycji i cały paragon **schodzą z ekranu**: jeśli rachunek dzieli
  się po równo, to lista pozycji nie ma czego zmienić, a stojąc tam sugerowałaby, że ma.
- `'own'` (Ze swoimi kosztami) — gotowy jest ten, kto stuknął choć jedną pozycję albo wpisał
  koszt własny (`participantReady`).

Nowy rachunek startuje w `'even'`. Rachunki sprzed tej zmiany nie mają tego pola, więc tryb
odczytuje się z zawartości: są pozycje albo koszty własne → `'own'`. Powrót do `'even'` jest
zablokowany, dopóki rachunek ma rozpisane pozycje — przełączenie kasowałoby czyjś wybór
bez pytania, więc zamiast tego mówimy wprost, co stoi na przeszkodzie.

**„Mnie nie dotyczy" odpadło jako WYBÓR**, bo od wypisania kogoś z rachunku jest edycja
składu, a dwie drogi do tego samego znaczyły dwa różne stany w bazie. Sama **wartość**
`not_applicable` ZOSTAJE: na niej stoi wykluczanie z podziału w `functions/calc.js` i noszą
ją stare rachunki. Pole `status` niesie już tylko członkostwo (`'in'` albo `'not_applicable'`).

### 19.8 Płatnik: okno decyzji zamiast banera

Zgłoszenie właściciela: „mam wrażenie, że obecnie jak wyskakuje ta informacja na górze,
to można łatwo ją zignorować".

Miał rację i to jest usterka wagi pierwszej: **bez potwierdzenia płatnika rachunek nie wchodzi
do rozliczeń**, czyli najważniejszy krok był tym, który najłatwiej pominąć — baner przewijał
się razem z treścią.

- **Wskazanie płatnika** przechodzi teraz przez okno z imieniem i „Potwierdzam". Wskazując
  SIEBIE potwierdzam w tej samej chwili (dwa pytania o to samo pod rząd to jedno za dużo).
- **Wskazany płatnik** dostaje przy wejściu na rachunek okno „Czy to Ty zapłaciłeś?" z „Tak, ja"
  i „Nie ja". To okno decyzji: bez uchwytu, bez krzyżyka, bez zamykania kliknięciem w tło.
  Pytanie pada RAZ na wejście (`payerClaimAskedFor`), nie raz na przerysowanie.
- „Nie ja" **czyści wskazanie płatnika**, zamiast tylko zamykać okno. Inaczej ktoś błędnie
  wskazany zostawałby z pytaniem wracającym przy każdym wejściu i bez sposobu na naprostowanie.
- Baner u góry zostaje jako przypomnienie dla tego, kto zamknął okno i wrócił później.

`openConfirm` dostało parametr `tone`. Czerwień długu znaczy „stąd nie ma powrotu" i nie może
stać pod pytaniem, które niczego nie kasuje — potwierdzenie płatnika idzie limonką.

### 19.9 Reszta listy właściciela

| Zgłoszenie | Rozstrzygnięcie |
|---|---|
| Rząd twarzy ekipy na Bilansie „zabiera tylko miejsce" | Usunięty. Nie odpowiadał na pytanie zadawane na Bilansie, a zabierał wysokość tuż pod kwotą. Skład grupy jest w ustawieniach pokoju i tam jest pełniejszy. |
| Kolejność w ustawieniach pokoju | Kod i link → waluta domyślna → podsumowanie wydatków → skład grupy → opuszczenie pokoju. Kolejność idzie za częstością, nie za budową danych. |
| Krzyżyk kasujący pokój „bardzo łatwo wcisnąć" | Zastąpiony **przesunięciem kafelka w lewo** (wybór właściciela), które odsłania czerwony kosz, plus okno potwierdzenia. Gest jest odwracalny: puszczenie przed połową drogi zwija kafelek. |
| Brak wyjścia na listę pokoi | Strzałka w lewo w nagłówku pokoju. Ten sam znak, co na ekranie rachunku: „o poziom wyżej". Nie myli się z „Opuść pokój", bo tam zwalnia się imię. |
| Powrót do ostatniego pokoju po restarcie | Aplikacja bez `?group=` w adresie otwiera pokój odwiedzony ostatnio. Wyjątek: znacznik `billsplitter_skip_resume` w pamięci SESJI, ustawiany, gdy człowiek SAM wyszedł na listę albo opuścił pokój. Znacznik ginie przy następnym uruchomieniu, więc skrót PWA z iPhone'a trafia do pokoju od razu — po jednorazowym wejściu kodem, bo skrót ma własną pamięć. |
| Kod pokoju ze spacją | Działa od dawna (`enterByCode` zdejmuje spacje, myślniki i wielkość liter). Teraz jest to **napisane** w ustawieniach pokoju, bo funkcja, o której nikt nie wie, nie istnieje. |
| Dwa wyglądy wyboru osób | Okno nowego rachunku dostało `person-row` — te same wiersze ze zdjęciem, co przy pozycji paragonu. Do trzech list wyboru osób doszła **lupa** rozwijająca pole wyszukiwania (kryterium 12–25 osób z PRODUCT.md). Filtr UKRYWA wiersze, nie kasuje ich, więc zaznaczenie osoby chwilowo niewidocznej przeżywa wpisywanie. |
| Rejestr wpłat „dziwną listą rozwijaną" | **Osobne miejsce** (arkusz pełnoekranowy) z nagłówkami dni, twarzami obu stron, kwotą, godziną i stanem potwierdzenia. Kasowanie: tylko własna wpłata i tylko dopóki odbiorca jej nie potwierdził — naprawa pomyłki sprzed minuty, nie kasowanie historii. Reguły Firestore pilnują tego samego warunku. |
| Chevrony „Ekipa" po prawej, „Historia zmian" po lewej | Wszystkie po prawej (`ml-auto`), we wszystkich trzech miejscach. |
| Link do Revoluta jako tekst do skopiowania | Metody, które da się otworzyć (Revolut, PayPal, Wise, telefon), dostały przycisk otwierający; kopiowanie zostaje OBOK. Adres składamy wyłącznie z uchwytu i znanej domeny — nigdy z cudzego tekstu, bo `href` przyjmujący czyjś tekst to otwarta furtka na `javascript:`. Doszedł Wise. |
| „Zlewa mi się mój udział z kwotą rachunku i pozycjami" | Trzy warstwy, trzy nośniki: kwota rachunku = biała karta, pozycje = paragon z włoskami, **twój udział = blok limonkowy** (`.card-mine`). Limonka znaczy „to jest twoje" i tak samo działa już na twojej linii paragonu. |
| Em dash „źle wygląda i AI-owo" | Wyczyszczone ze WSZYSTKICH tekstów interfejsu (znaczniki i literały w JavaScripcie). W komentarzach kodu zostaje — tam nikt ich nie czyta z ekranu. |
| Audyt napisów | `HELP_CONTENT` przepisane w całości. Poprzednia wersja mówiła o imionach „po przecinku" (dodaje się je pojedynczo), o filtrze „Wszystkie / Ukryte" (filtrów jest pięć) i o ręcznym statusie (już nie istnieje). Pomoc opisująca nieistniejący ekran jest gorsza od braku pomocy. |

### 19.10 Dwa fałszywe alarmy naprawione w narzędziu audytowym

`tools/audit-layout.mjs` zgłaszał dwie rzeczy, których na ekranie nie ma:

1. Treść **zwiniętego `<details>`** — Chrome chowa ją przez `content-visibility`, a nie
   `display: none`, więc `getBoundingClientRect` nadal zwraca prostokąt. Stąd „Edytuj skład
   pod paskiem nawigacji" dla przycisku, którego nie widać.
2. Element **wyprzewinięty poza swój kontener** — ma współrzędne i potrafi wypaść za
   nagłówkiem arkusza. Stąd „krzyżyk nachodzi na pole waluty".

Oba są teraz odfiltrowane w `visible()`. Pogoń za takim zgłoszeniem kończy się psuciem
układu, który był w porządku, więc to nie jest kosmetyka narzędzia.

**Uwaga dla przyszłych zmian w tym pliku:** blok `AUDIT` jest szablonem znakowym, więc
apostrof odwrotny w komentarzu zamyka literał i wywala cały skrypt.

### 19.11 Stan audytu po partii

Cztery szerokości z kontraktu (360 / 390 / 834 / 1280), 32 stany ekranu, **zero zgłoszeń**:
bez wyjazdów poza ekran, bez celów poniżej progu, bez nachodzących się przycisków, bez
treści uwięzionej pod paskiem. 164 testy jednostkowe przechodzą.
