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
npm test             # 187 testów jednostkowych
npm run test:rules   # 32 testy reguł Firestore (wymaga emulatorów)
npm run build
```

### Narzędzia audytowe

Trzy przebiegi w `tools/`. Dwa pierwsze wymagają puppeteera: `npm i --no-save puppeteer`.

**Adres serwera bierze się ze zmiennej `BILLIADA_URL`** (domyślnie `http://localhost:5173/`).
Vite podnosi port, gdy 5173 jest zajęty — bez tej zmiennej audyt po cichu bada CUDZĄ, starą
instancję aplikacji. Zdarzyło się to podczas audytu 2026-08-16.

```bash
node tools/audit-layout.mjs ./shots          # zrzuty + pomiar układu, domyślnie 390×844
node tools/audit-layout.mjs ./shots 834      # tablet; zrzuty lądują w ./shots/w834
node tools/audit-buttons.mjs                 # szuka martwych przycisków, domyślnie 390
BILLIADA_URL=http://localhost:5199/ node tools/audit-layout.mjs ./shots   # inny port
```

**Odczyt paragonów — stanowisko pomiarowe** (`tools/receipt-bench.mjs`, bez puppeteera,
za to z siecią i kluczem OpenRoutera). Woła model dokładnie tak jak `parseReceipt`
i przepuszcza wynik przez to samo sito `normalizeReceipt` co przeglądarka, więc zmianę
promptu widać w liczbach, a nie w odczuciach.

```bash
node tools/receipt-bench.mjs --fetch     # raz: pobiera 14 zdjęć z Wikimedia Commons
node tools/receipt-bench.mjs             # mierzy; wynik to % odczytów co do grosza
node tools/receipt-bench.mjs --model google/gemini-3.5-flash
```

Wzorce w `tools/receipt-corpus.json` spisane ręcznie ze zdjęć. Korpus celuje w konkretne
pułapki: PTU, rabat już wliczony w cenę, kaucja, podatek doliczany po amerykańsku, zdjęcie
obrócone o 90°, cztery języki obce i dwa zdjęcia, które paragonem NIE SĄ. Stan na
2026-08-16: **14/14 co do grosza**. Szczegóły w `docs/AUDYT-2026-08.md` §B.
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
- **Skrzynka** — arkusz spod dzwonka (`#nudges-bell`), jedna lista: sprawy czekające
  na mój ruch. Opis w 10.2.

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

**Skrzynka** to JEDNA lista: sprawy poziomu 1 i 2, tu żyje odznaka. Poziom 3 nie ma
w niej domu — mieszka w **rejestrze wpłat** (arkusz z zakładki Rozliczenia, z filtrami
i przełącznikiem „Moje / Wszystkie") oraz w **historii zmian** na ekranie rachunku,
bo tam jest jej kontekst.

Segment „Wszystko" istniał tu do 2026-09-02 i został usunięty: powtarzał rejestr
w słabszej postaci (te same wpłaty bez stanu i bez filtrów), czyli łamał regułę
„każda sprawa ma jeden dom". Cena jest jedna i świadoma — ślad przypomnień („kto komu
i kiedy przypomniał") nie ma dziś widoku. Dokumenty zostają w bazie; gdyby okazał się
potrzebny, jego miejsce jest w rejestrze jako kolejny filtr.

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
| **3** | nic | reszta — do obejrzenia w rejestrze wpłat i w historii zmian rachunku |

**Reguły, które kod faktycznie egzekwuje:**

- Liczba wyłącznie dla poziomu 1 (`badgeCount` filtruje po `level === 1`).
- Kropka gaśnie po wejściu w „Rachunki" i zapala się ponownie dopiero przy rachunku,
  którego tam jeszcze nie widziałem (`markBillsSeen`, klucz `billsplitter_seen_bills_<pokój>`).
- Potwierdzenie mojej wpłaty gaśnie po otwarciu skrzynki — nie ma czego „obsłużyć",
  samo obejrzenie zamyka sprawę (`billsplitter_seen_confirmations_<pokój>`).
- Nic, co zrobiłem sam, nie wraca do mnie jako sygnał (warunki na `myId` / `myUid`).
- Stan „widziane" mieszka w `localStorage` per pokój — to sprawa tego telefonu,
  nie fakt o rachunku.

**Skrzynka** (dzwonek w nagłówku): jedna lista. Pokazuje sprawy poziomu 1 i 2 z akcją
przy każdej (Ureguluj, Potwierdzam, Otwórz rachunek) i nic poza tym. Sprzątanie wiersza
to ikona × w rogu, nie przycisk w rzędzie akcji — sprzątanie ma wagę sprzątania.

**Nic, co stukniesz w tej liście, nie ucieka spod palca** (2026-09-02). Sprawa
rozstrzygnięta stuknięciem — potwierdzona wpłata, podtrzymany przelew, zdjęte
przypomnienie — zostaje na swoim miejscu jako wiersz bez czynności i znika dopiero
przy następnym otwarciu skrzynki. Inaczej sąsiedni wiersz wskakuje pod palec, który
jeszcze nie zdążył się podnieść. Wyjątek: „Zdejmij przypomnienia" czyści je od razu,
bo pusta lista JEST odpowiedzią na tę prośbę.

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
- **Rejestr wpłat** — wpłaty i zmiany kwot, najnowsze pierwsze, z filtrami
  i przełącznikiem „Moje / Wszystkie". Poziom 3 progu: zero sygnału, wchodzisz kiedy
  chcesz wiedzieć.

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

### 19.1 Nazwa produktu: **Billiada**

Nazwa rozstrzygnięta przez właściciela 2026-08-15 i zamyka punkt otwarty z §2.
Zmienione: `<title>`, `apple-mobile-web-app-title`, `manifest.json` (`name`, `short_name`,
`description`), `public/sw.js`, `package.json`, przedrostek w konsoli i teksty pomocy.

**Czego NIE zmieniono i dlaczego:** przedrostek `billsplitter_` w kluczach `localStorage`.
Te klucze trzymają listę pokoi, motyw i szablony przypomnień na urządzeniu. Zmiana
przedrostka wyczyściłaby listę pokoi każdemu, kto już aplikacji używa, a powrót do pokoju
wymagałby wtedy kodu od kogoś innego. Nazwa klucza nikomu się nie wyświetla.

### 19.2 Znak i logotyp

**Znak: koń trojański**, rysunek właściciela (`logo/billiada-logo.png`, 600 px,
limonka na atramencie). Nazwa łączy rachunek z Iliadą, więc znak idzie za NAZWĄ, a nie
za mechaniką produktu — i to jest dobra decyzja, bo mechanikę i tak niesie żywy paragon
wewnątrz aplikacji. Wcześniejsza propozycja (rachunek przedarty na pół, generowany z SVG)
została zastąpiona rysunkiem właściciela 2026-08-15 i usunięta z repozytorium.

`node tools/make-icons.mjs` skaluje źródło do sześciu rozmiarów przez puppeteera (już
obecnego w repo — dokładanie `sharp` tylko dla ikony byłoby kosztem bez pokrycia):
16 i 32 na kartę przeglądarki, 96 do użycia w samej aplikacji, 180 dla iPhone'a,
192 i 512 dla manifestu. Sześćset pikseli źródła wystarcza na wszystko, co robi aplikacja
w sieci; wydanie natywne poprosi kiedyś o 1024 px albo o plik wektorowy.

**Logotyp: „Bill" w limonce marki, „iada" w bieli**, krój Bricolage Grotesque — ten sam,
którym pisane są kwoty, więc logotyp nie wprowadza do aplikacji nowego kroju.

Logotyp **zawsze stoi na ciemnym podłożu** i jego barwy NIE idą za motywem. To jest jawny
wyjątek od reguły rozdziału kolorów z `DESIGN.md`: limonka na jasnym tle ma kontrast około
1,5:1, czyli jest nieczytelna, a biel na jasnym tle nie istnieje. Znak firmowy jest jedyną
rzeczą w tej aplikacji, która ma stałe barwy niezależne od motywu — bo tym właśnie jest
znak firmowy. W motywie jasnym logotyp siedzi więc we własnym ciemnym bloku.

Gdzie stoi: ekran wczytywania i nagłówek ekranu startowego. Nie w pokoju — tam nazwa
pokoju jest ważniejsza od nazwy aplikacji, a logo na każdym ekranie to szyld, nie produkt.

**Nagłówek ekranu startowego to sam znak.** Wielkie „Podziel rachunek" i zdanie pod nim
zniknęły 2026-08-15 na wniosek właściciela, i słusznie: pod spodem stoją dwie karty,
które mówią to samo własnymi nagłówkami („Masz kod pokoju?", „Nazwa grupy"), więc
nagłówek powtarzał treść ekranu i spychał pierwszą realną akcję poniżej zgięcia.
Opis produktu nie zniknął — przeniósł się pod znak zapytania, czyli tam, gdzie pomoc
mieszka na każdym innym ekranie. Przycisk nie potrzebuje własnej obsługi, bo `showHelp`
bierze treść z `HELP_CONTENT` po nazwie ekranu.

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
a koło [+] obraca się o 135° w krzyżyk i jest przyciskiem zamknięcia. Zakładki pod
otwartym arkuszem gasną i przestają być klikalne: pasek trzyma w tej chwili jedną rolę.

**Wariant wejścia wybiera JEDNA KLASA na oknie w `index.html`.** Oba warianty żyją
w `src/tailwind.css` obok siebie, bo właściciel zastrzegł możliwość powrotu:

| Klasa | Ruch | Stan |
|---|---|---|
| `anim-reveal` | okrąg rośnie z punktu, w którym stoi [+], i ODSŁANIA arkusz | **włączone** (wybór właściciela 2026-08-15) |
| `anim-sprout` | arkusz wyrasta nad paskiem z zaczepieniem na dole | gotowe do powrotu |

Cofnięcie to podmiana jednego słowa w znacznikach i nic więcej.

**Dlaczego „rozwinięcie z koła" nie powtarza błędu morfowania.** Arkusz od pierwszej
klatki ma swój docelowy kolor i swoje miejsce — zmienia się wyłącznie to, ile go widać.
Nie ma dwóch kształtów przenikających się nawzajem, więc nie ma czym mignąć.

Środek okręgu to **nie** dno arkusza, tylko `calc(100% + 4rem)`: arkusz stoi 7,25 rem nad
dolną krawędzią, a koło [+] jakieś 3,25 rem, czyli 4 rem niżej. Bez tej poprawki okrąg
wychodziłby z krawędzi arkusza zamiast z przycisku, a cały sens wariantu polega na tym,
że wychodzi DOKŁADNIE z przycisku. `calc()` trzyma to niezależnie od wysokości arkusza.

**Zamknięcie dostało własną animację** (`sheet-conceal` / `sheet-shrink`, 280 ms, krzywa
wyjściowa). Wcześniej zamknięcia nie było w ogóle: `.modal` bez klasy `active` dostaje
`display: none` w tej samej klatce, więc arkusz po prostu znikał. Teraz najpierw wchodzi
klasa `is-closing`, a `active` schodzi dopiero po animacji, z zapasowym licznikiem czasu
na wypadek, gdyby `animationend` nie doszedł (karta w tle, przerwana animacja).

### 19.6.1 Dwa błędy złapane sondą, nie okiem

Warto zapisać, bo oba były niewidoczne w zrzutach.

1. **Tryb ograniczonego ruchu nie działał.** Nadpisanie w `@media (prefers-reduced-motion)`
   miało trzy klasy w selektorze, a reguła włączająca animację — cztery (doszła klasa
   wariantu). Krótszy selektor przegrywał specyficznością i animacja leciała mimo
   ustawienia systemowego. Wykryte przypadkiem: **Chrome bez interfejsu zgłasza
   `prefers-reduced-motion: reduce` domyślnie**, więc sonda badała ścieżkę bez ruchu
   i pokazała, że mimo to `animation-name` jest ustawiony. Dla części ludzi to nie jest
   preferencja, tylko warunek korzystania z telefonu bez mdłości.
   *Wniosek na przyszłość:* sondy sprawdzające ruch muszą wołać
   `page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])`,
   inaczej testują coś innego, niż się wydaje.
2. **Koło [+] było martwe przez 280 ms po zamknięciu.** Klasa `active` wisi przez czas
   animacji wyjścia, więc stuknięcie w tym oknie trafiało w gałąź „zamknij", ta wychodziła
   od razu (bo już się zamyka) i przycisk nie robił nic. Arkusz w trakcie zamykania liczy
   się teraz jako ZAMKNIĘTY.

Przy okazji: zsunięcie arkusza palcem nie zeruje już przesunięcia przed zamknięciem.
Wcześniej arkusz podskakiwał z powrotem na miejsce i dopiero stamtąd znikał, czyli gest
kończył się ruchem w przeciwną stronę.

**Pole testowe zostaje:** `docs/animacje-nowego-rachunku.html` ma pięć wariantów
(nad paskiem, rozwinięcie z koła, kaskada, wyciągnięcie z paska, podniesienie ekranu),
każdy z argumentami za i przeciw.

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

### 19.12 Druga tura po testach na telefonie (2026-08-15, wieczór)

Właściciel przeszedł aplikację jeszcze raz na iPhonie 12. Osiem zgłoszeń, z czego
**dwa to regresje wprowadzone tego samego dnia** — warto to zapisać, bo pokazuje koszt
zmian w warstwie systemowej.

**Regresja 1: ucięta góra ekranu.** `viewport-fit=cover` wpuszcza treść pod wcięcie
i pasek stanu. Dołożyliśmy odstęp na DOLE (pasek gestów), a zapomnieliśmy o GÓRZE, więc
nazwa grupy i przyciski nagłówka wjechały pod zegarek. `#app-container` ma teraz
`padding-top: calc(1rem + env(safe-area-inset-top))`, boki liczą `max()` z wcięciem
(orientacja pozioma), a pasek offline dostał własny odstęp górny.

**Regresja 2: skacząca nawigacja przy zmianie zakładki.** Dwie przyczyny naraz:

1. `bottom: calc(1.5rem + env(safe-area-inset-bottom))`. W Safari na iPhonie ta wartość
   **nie jest stała**: przy rozwiniętym pasku adresu wynosi 0, po zwinięciu skacze na
   34 px. Zapis z dodawaniem przenosił cały skok na pasek nawigacji. Teraz
   `bottom: max(1.5rem, env(safe-area-inset-bottom))` — skok schodzi z 34 px do 10 px,
   a w aplikacji zainstalowanej na ekranie początkowym znika zupełnie.
2. `showDeckView` wołało `window.scrollTo({ top: 0 })` przy KAŻDEJ zmianie zakładki,
   także gdy strona już była na górze. Na iPhonie takie przewinięcie rozwija pasek
   adresu, czyli samo wywołuje zmianę z punktu 1. Teraz przewijamy tylko wtedy, gdy
   `scrollY > 0`.

Sonda w emulatorze pokazywała pasek stojący w miejscu co do dziesiątej piksela —
usterki nie dało się odtworzyć bez prawdziwego Safari. To jest granica tych narzędzi
i warto ją pamiętać.

**Prześwitujący czerwony kontener pod kafelkiem pokoju.** Podłoże wiersza było czerwone,
a kafelek je zasłaniał. Dwa problemy naraz: wygładzanie krawędzi nie daje dwóch
identycznych łuków przy tym samym promieniu (stąd czerwony rąbek), a odzew dotknięcia
kurczył kafelek do 97 % i odsłaniał czerwień na całym obwodzie. Teraz podłoże jest
przezroczyste, czerwień siedzi wyłącznie pod koszem, a kafelek pokoju na wciśnięcie
**przyciemnia się zamiast kurczyć**.

**Arkusz wyboru otwierał się POD arkuszem, z którego go wywołano.** Wszystkie okna miały
tę samą warstwę, więc o wierzchu decydowała kolejność w znacznikach — a `choice-modal`
stoi wcześniej niż `payment-methods-modal`. Skutek: sposobu płatności nie dało się wybrać
w ogóle. Wprowadzone **trzy piętra okien**: 50 dla okna otwieranego z ekranu, 60 dla okna
otwieranego z innego okna, 70 dla decyzji. Piętro wynika z tego, SKĄD okno się otwiera,
a nie z tego, jak jest ważne.

**Dwa wiersze o tej samej roli wyglądały na dwa systemy.** „Jeszcze 3 przelewy w grupie"
(`settle-others-summary`) i „Rejestr wpłat" (`settings-row`) stały pod sobą w jednej
kolumnie i różniły się stopniem pisma, wagą i tonem. Ujednolicone do jednego wyglądu.
Różnica została tam, gdzie coś znaczy: chevron w dół rozwija w miejscu, chevron w prawo
otwiera osobne miejsce.

**Motyw domyślny: ciemny.** Aplikacja szła za ustawieniem systemu, więc pierwsze wejście
u kogoś z jasnym telefonem pokazywało wersję jasną. Scena użycia to wieczór w lokalu,
więc ciemny jest tu stanem podstawowym, nie preferencją. Jasny zostaje pełnoprawnym
wyborem w zakładce „Ty". Nasłuch zmiany ustawienia systemowego usunięty razem
z podążaniem za nim, a `theme-color` przestawia się teraz razem z motywem.

**Animacja nowego rachunku wróciła do wariantu „nad paskiem"** (`anim-sprout`) po
obejrzeniu obu na telefonie. `anim-reveal` zostaje w arkuszu stylów.

### 19.13 Kolejność na ekranie rachunku i czytelność pozycji

Rozstrzygnięte z właścicielem przed wdrożeniem.

**Nowa kolejność:** pełna kwota → jak dzielimy → **Twoja część** → paragon → pozycje →
koszty wspólne → ekipa → historia. Dwie zmiany i obie mają ten sam powód:

- **Paragon nad pozycjami.** Był pod nimi, czyli pod czymś, co z niego powstaje.
  Przy pierwszym rachunku kolejność ekranu przeczyła kolejności czynności.
- **Twoja część zaraz pod decyzją o podziale.** Wcześniej własna kwota leżała pod
  paragonem i wszystkimi pozycjami: żeby zrobić swoje, trzeba było najpierw minąć cudze.

Karta została przy tym **rozdzielona**, i to jest sedno rozwiązania. Robiła dwie rzeczy
naraz: była polem do wypełnienia (koszt własny) i podsumowaniem (Pozycje / Koszty wspólne
/ Łącznie). Pole chce stać wysoko, bo to zadanie; rozpisana suma chce stać nisko, bo suma
należy się po tym, co ją tworzy. Przeniesiona w całości pokazywałaby „Pozycje 96,00",
zanim pozycje w ogóle pojawią się na ekranie.

Teraz na wierzchu stoi zadanie plus **jedna liczba** („Twój udział"), a rozpiska chowa się
w zwijanym „Z czego się składa". Suma nad rzeczami, które ją tworzą, jest w porządku;
rozpisana suma nad nimi już nie.

**Czytelność pozycji** — zgłoszenie „kafelki nie mówią, że można je kliknąć":

1. Część wrażenia „statyczności" wynikała z martwego `:active` na iOS i zniknęła razem
   z naprawą z §19.4. Warto to wiedzieć, zanim doda się cokolwiek nowego.
2. **Pusty znacznik po lewej każdej linii.** To ten sam okrągły znacznik, co przy wyborze
   osób (`person-row-check`), więc nie dokłada do aplikacji nowego języka. Puste kółko
   mówi „to czeka na wybór", zanim ktokolwiek dotknie ekranu. Wypełnia się **limonką**,
   nie atramentem: na paragonie limonka znaczy „to jest twoje" i tak samo barwi całą linię.
3. **Ząbkowana krawędź pod listą** (`.receipt-tear`). Jednym kształtem, bez ani jednego
   słowa, mówi że blok pozycji JEST wydrukiem należącym do rachunku, a nie luźną listą.
   Osobny element, a nie maska na karcie: maska skasowałaby cień, a cień odróżnia kartę
   od podłoża w motywie jasnym. Przeglądarka bez masek dostaje prostą krawędź.
4. Podpis linii, której nikt nie wziął, zmienił się ze „Stuknij, jeśli to Twoje" na
   **„Nikt nie wziął"**. Zachętę niesie teraz znacznik, a podpis może wreszcie mówić
   o STANIE — tym samym, który liczy odznaka „2 bez wyboru" nad listą.

### 19.14 Nazwa i znak: Billiada

Nazwa doprecyzowana przez właściciela na **Billiada** (wcześniej przez chwilę „Billyada").
Znak to jego własny rysunek: **koń trojański** w limonce na atramencie. Nazwa łączy
rachunek z Iliadą, więc znak idzie za nazwą — mechanikę produktu i tak niesie żywy
paragon w środku. Wcześniejsza propozycja (rachunek przedarty na pół, generowany z SVG)
usunięta z repozytorium.

Logotyp: **„Bill" w limonce, „iada" w bieli**, krój Bricolage Grotesque — ten sam, którym
pisane są kwoty, więc logotyp nie wprowadza dziewiątego stopnia ani drugiego kroju.
Znak stoi SAM, bez ramki i bez podkładki, w układzie pionowym: znak, pod nim nazwa.
Wersja w ciemnej pigułce została odrzucona przez właściciela 2026-08-15 — obwódka robiła
ze znaku naklejkę i zabierała mu powietrze, a układ poziomy wymuszał małą ikonę, żeby
lockup nie rozpychał wiersza.

Bez pigułki logotyp stoi wprost na tle aplikacji, więc na JASNYM motywie idzie wersją
jednobarwną: znak i nazwa atramentem, dwutonowość niesie różnica tonu, nie barwa.
Znak przechodzi na atrament filtrem `brightness(0)` — zeruje kanały koloru i zostawia
krycie nietknięte, więc jeden plik obsługuje oba motywy bez dogrywania drugiego obrazka.

**Barwy logotypu nie idą za motywem i to jest jawny wyjątek** od reguły rozdziału kolorów:
limonka na jasnym podłożu ma kontrast około 1,5:1, a biel na jasnym tle nie istnieje.
Znak firmowy jest jedyną rzeczą w tej aplikacji ze stałymi barwami — bo tym właśnie jest.

Logotyp stoi w dwóch miejscach: na ekranie wczytywania (jedyne miejsce, gdzie nic innego
się nie dzieje) i w nagłówku ekranu startowego. **Nie w pokoju** — tam nazwa pokoju jest
ważniejsza od nazwy aplikacji, a logo na każdym ekranie to szyld, nie produkt.

### 19.15 Kolor znaku: dwa suwaki zamiast szesnastu kółek

Zgłoszenie właściciela: „wybór kolorów jest dość ograniczony i niektóre są bardzo
podobne, może suwak?". Zanim cokolwiek dotknąłem, policzyłem paletę — i objaw okazał się
łagodniejszy od choroby.

**Stara paleta miała szesnaście pozycji, ale pięć rodzin.** Piętnaście par różniło się
mniej niż o dwadzieścia stopni odcienia przy niemal równej jasności, czyli dla oka było
tym samym kolorem: „malina" i „wiśnia" dzieliły DWA stopnie, „fiolet" i „ametyst" jeden.
Do tego **sześć kolorów siedziało na barwach ról pieniężnych**: „lazur" siedem stopni od
błękitu „czeka na Ciebie", „malina" siedem od czerwieni długu, „szmaragd" piętnaście od
zieleni należności. Paleta łamała regułę rozdziału kolorów, którą sama miała chronić.

**Przyczyną było jedno założenie: litera na znaku jest zawsze biała.** To wymuszało
wyłącznie ciemne barwy, więc szesnaście kolorów wciskało się w jedno wąskie pasmo
jasności, gdzie różnicował je tylko odcień — a odcień się zbijał. To także powód, dla
którego w palecie nie było żółtego: wypadł przez kontrast, nie przez estetykę.

**Zmiana, która odblokowała resztę:** litera dobiera kolor sama (`readableInk`, jedna
z dwóch barw systemu, wybierana po luminancji). Od tej chwili całe koło barw jest
dostępne w każdej jasności.

**Kontrolka** (wybór właściciela): dwa suwaki — odcień i intensywność. Intensywność jest
jedną liczbą sterującą nasyceniem i jasnością naraz; osobne suwaki dałyby więcej kolorów,
ale też całe obszary nieczytelnego błota (wysoka jasność przy niskim nasyceniu to prawie
biel). Ścieżka suwaka odcienia pokazuje **dokładnie te kolory, które wyjdą przy bieżącej
intensywności**, a nie ogólną tęczę, a odcienie zarezerwowane widać na niej jako szare
odcinki, zanim palec tam trafi.

**Trzy gwarancje i sposób, w jaki są dotrzymane:**

1. **Czytelność.** Żaden punkt obu suwaków nie schodzi poniżej 4,5:1. Pośrodku zakresu
   jasności jest wąskie pasmo, w którym ANI biel, ANI atrament nie łapią progu (dla
   nasyconej czerwieni wychodziło 4,45), a jego położenie zależy od odcienia.
   `colorFromControls` odsuwa wtedy jasność do bliższego brzegu pasma. **Znalazł to test,
   nie oko** — dlatego test przechodzi teraz przez wszystkie odcienie co pięć stopni
   i wszystkie intensywności co dziesięć.
2. **Znaczenia.** Sąsiedztwa limonki marki i trzech barw pieniężnych są wyłączone, ale
   jako punkty w trzech wymiarach, nie jako całe pasma odcienia. Suwak omija je sam
   i pisze, dlaczego uchwyt odskoczył — interfejs, który rusza się bez wyjaśnienia,
   czyta się jak zepsuty.
3. **Rozróżnialność.** Aplikacja **nie blokuje** powtórki i **nie ostrzega** przed nią
   (decyzja właściciela). Pokazuje rząd „Kolory w pokoju" ze znakami reszty ekipy
   i zostawia wybór człowiekowi.

**Paleta domyślna przebudowana** przy tej samej okazji, bo to ona trafia do ludzi, którzy
nigdy nie otworzą arkusza wyboru: szesnaście barw co 22,5 stopnia po całym kole,
z naprzemienną jasnością (parzyste ciemne i nasycone, nieparzyste jasne i łagodniejsze),
z omijaniem stref zarezerwowanych. Zero par nie do odróżnienia, zero kolizji ze znaczeniami.

**Przydział przy zakładaniu grupy rozrzucony po palecie**, a nie po kolei. Paleta jest
ułożona wzdłuż koła barw, więc branie kolejnych pozycji dawało czteroosobowej grupie
cztery sąsiadujące odcienie. Krok siedem jest względnie pierwszy z szesnastką, więc
obchodzi całą paletę bez powtórki, a kolejni ludzie dostają barwy z przeciwnych stron koła.

### 19.16 Pasek nawigacji: kompensacja usunięta w całości (2026-08-16)

Trzy podejścia do „pasek nawigacji stoi w różnych miejscach" były trzema wariantami tego
samego błędu. Kolejno: liczenie z `visualViewport.offsetTop` (pasek odlatywał w górę tym
mocniej, im mocniej ktoś ciągnął stronę w dół), potem samo
`clientHeight - visualViewport.height` (pasek stał wyżej **tylko w zakładce Profil**),
aż do rozstrzygnięcia: **nie było czego kompensować**. Element `position: fixed`
z odległością od dołu jest na iOS już umieszczony nad paskiem Safari.

Objaw rozstrzygnął sprawę lepiej niż kod. Różnica wynosiła około 75 pikseli, czyli
dokładnie wysokość dolnego paska Safari, i występowała wyłącznie na Profilu — ekranie
tak krótkim, że strona nie ma czego przewijać, więc Safari **nie może** schować swojego
paska. Wszędzie indziej pasek przeglądarki znikał przy pierwszym przewinięciu i poprawka
schodziła do zera. Wcześniejsze zgłoszenie „nawigacja zmienia pozycję przy przełączaniu
zakładek" to była ta sama poprawka w akcji.

Zostało: odległość od dołu w CSS (`max(1,5rem, env(safe-area-inset-bottom))`) i nasłuch
klawiatury, który pasek **chowa** (`watchKeyboardForDeck`, próg 140 px — mniej to pasek
przeglądarki, więcej to klawiatura). Dołożone `overscroll-behavior-y: none` na `html`
i `body` wyłącza rozciąganie strony na końcu przewijania: bez tego iOS przy ciągnięciu
w dół odbija całym dokumentem i ciągnie za sobą wszystko, co przypięte. Aplikacja nie ma
odświeżania pociągnięciem, więc nie tracimy nic.

### 19.17 Trzy drobiazgi z tej samej tury

**Pasek przewijania ukryty** (`::-webkit-scrollbar` plus `scrollbar-width`). Aplikacja to
jedna kolumna kart, nie dokument — o długości treści mówi sama lista. Załatwia to komputer
i Androida; **na iPhonie wskaźnik przewijania całego dokumentu rysuje system** i stylami
się go nie zdejmie. Zniknąłby dopiero, gdyby przewijał kontener wewnątrz strony zamiast
samego dokumentu, a to przebudowa układu ze skutkami dla nawigacji i narzędzia audytowego.
Nie warta ukrycia kreski.

**Objaśnienie znika z okna „Nowy rachunek".** Akapit tłumaczył, że rachunek startuje
podziałem po równo i że da się to przestawić. Przełącznik „Jak dzielimy" stoi na rachunku
na wierzchu i mówi to samo — tylko wtedy, gdy jest to komuś potrzebne. Okno zakładania
rachunku ma pytać o nazwę i o to, kogo dotyczy, i na tym kończyć.

**Znak firmowy zostaje kolorowy w jasnym motywie** (decyzja właściciela). Wcześniej koń
i „Bill" schodziły na jasnym tle na atrament, bo limonka na bieli ma kontrast około 1,5:1.
To jest jednak decyzja o znaku, nie o tekście: nazwy marki nikt nie czyta jako treści,
rozpoznaje ją po kształcie i barwie, a jednakowy wygląd w obu motywach jest wart więcej
niż zgodność ze współczynnikiem. **Wyjątek kończy się na logotypie** — reguła 4,5:1
obowiązuje w całej reszcie aplikacji bez zmian.

### 19.18 Partia 8 — paragon, koszty wspólne, powiadomienia (2026-08-16)

**Wydruk ma teraz DWIE linie oderwania.** Dolna mówiła „to paragon", górna nie mówiła nic,
więc blok zaczynał się jak zwykła karta, a kończył jak wydruk. Kształt jest ten sam,
obrócony. Ząbek rysują dwie warstwy o wspólnej masce, przesunięte o półtora piksela:
spodnia limonkowa, wierzchnia w kolorze papieru — dzięki temu **limonkowa ramka biegnie
także po linii oderwania**, zamiast urywać się na niej. Zwykły `border` tego nie umie,
bo maska wycina kształt razem z obramowaniem.

**Koszty wspólne dostały tę samą formę i wreszcie mówią, czym są.** Zgłoszenie właściciela:
„brakuje informacji, że koszt wspólny to faktycznie koszt wspólny". Teraz mówią to trzy
rzeczy naraz — nagłówek sekcji, jedno zdanie o dzieleniu po równo między wszystkich,
i kwota **na osobę** przy każdym wierszu. Ostatnie jest najważniejsze: dopiero „3,50/os."
pokazuje, co ten koszt znaczy dla patrzącego. Przy procencie obok nazwy stoi sam procent,
a po prawej kwota w złotówkach — razem mówią to, czego żadne z nich nie mówi osobno.

**Oba przyciski są białe i mają ikony**: paragon przy „Dodaj pozycję", ekipa przy „Dodaj
koszt wspólny". Ta sama waga, bo to dwie równorzędne drogi dopisania czegoś do rachunku;
ikony rozstrzygają, która dotyczy jednej osoby, a która wszystkich.

**Szukanie wśród pozycji** pojawia się od ósmej pozycji i stoi POD wydrukiem. Przy pięciu
pozycjach szybciej spojrzeć niż pisać, a pole nad treścią zabierałoby miejsce tam, gdzie
nikt go nie potrzebuje. Filtr nakładany jest po renderze, nie w danych — inaczej każdy
cudzy zapis czyściłby wpisane słowo w połowie wpisywania.

**Sposoby płatności uczestnika da się otworzyć w ustawieniach pokoju.** Wiersz mówił
„2 sposoby płatności" i na tym kończył; teraz rozwija się w miejscu i pokazuje dokładnie
te same wiersze, co okno „Ureguluj" — numer, „Otwórz", „Kopiuj".

**Odstęp nad stopką arkusza jest jeden dla wszystkich arkuszy.** Wcześniej wynikał z tego,
co akurat stało na końcu treści (pole z `mb-4` dawało 34 px, bez niej 18 px), więc nie było
reguły, był przypadek. Margines ostatniego dziecka schodzi do zera, oddech należy do arkusza.

**Waluta z paragonu przestała lądować w koszu.** Model odczytywał ją razem z pozycjami,
ale nic z niej nie wynikało — pozycje z zagranicy wchodziły jako złotówki. Teraz, gdy
odczytana waluta różni się od waluty rachunku, w podglądzie stoi pas z przyciskiem
„Ustaw EUR”. Nic nie dzieje się samo: kurs zapisuje się w dniu dodania, więc to decyzja
człowieka. Instrukcja dla modelu mówi wprost, żeby przy braku wskazówek na paragonie
zwrócić `null` — zgadywanie waluty po języku nazw dań byłoby gorsze niż brak odpowiedzi.

**Kwoty idą jednym krojem.** Cztery miejsca renderowały pieniądze zwykłym tekstem
(Archivo) zamiast klasą `.amount` (Bricolage): wiersz „kto komu ile” w zwiniętej sekcji,
rejestr wpłat, rozpiska pod saldem i modyfikatory w podglądzie paragonu. Zgłoszenie
właściciela było trafne — to nie był zamysł, to był brak.

**Powrót z rachunku gestem wygląda tak samo jak strzałką.** Gest wywołuje `popstate`,
a obsługa tego zdarzenia zrywała wszystkie nasłuchy bazy i szła przez ponowne pobranie
dokumentu pokoju z sieci: ekran rozbierało się do zera i składało po odpowiedzi serwera.
Strzałka tego nie robiła, bo pracuje na danych z pamięci. Teraz powrót do tego samego
pokoju idzie tą samą drogą, a przewinięcie listy rachunków wraca tam, gdzie było.

**Przypomnienia na iPhonie: znaleziona przyczyna „raz zadziałało, potem nigdy".**
Token FCM zmienia się (na iOS potrafi po każdym zamknięciu aplikacji). Aplikacja pobierała
przy starcie świeży token i próbowała go zapisać, ale w tej chwili pokój nie był jeszcze
wczytany, więc zapis kończył się cichym wyjściem — i **nikt nigdy nie próbował ponownie**.
Do bazy nie trafiał żaden nowy token, a stary funkcja wysyłkowa usuwała jako martwy przy
pierwszej nieudanej próbie. Zapis jest teraz ponawiany po każdym wczytaniu pokoju, a klucz
`pokój:osoba:token` pilnuje, żeby nie pisać w kółko tego samego. (Poprzedni strażnik był
zwykłym „true/false" i po zapisie w jednym pokoju blokował zapis w drugim.)

### 19.19 Pasek nawigacji: trzecie i ostatnie podejście (2026-08-16)

Rozstrzygnęła obserwacja właściciela: **w Safari i Firefoksie pasek stoi, a w aplikacji
uruchomionej z ikony na ekranie początkowym przeskakuje w zakładce Profil.** To wyklucza
wszystko, co robiliśmy do tej pory, bo arkusz stylów jest w obu przypadkach ten sam.

Research potwierdził rzecz znaną i opisaną: **`overscroll-behavior` na dokumencie iOS
ignoruje**. Rozciąganie strony na końcu przewijania obsługuje tam warstwa systemowa,
a nie silnik strony — w Safari gest przechwytuje sama przeglądarka i objawu nie widać,
w trybie z ikony nie ma tej warstwy pośredniej i dokument odbija razem ze wszystkim,
co jest do niego przypięte.

Wyjście jest jedno i stosują je aplikacje, które na iOS działają poprawnie: **dokument
przestaje się przewijać**. `html` i `body` dostają stałą wysokość i ukryte przepełnienie,
a treść przewija się w jednym kontenerze wewnątrz strony (`#app-scroll`). Czego nie da się
rozciągnąć, to nie pociągnie za sobą niczego przypiętego.

Trzy skutki, wszystkie dobre:
1. Pasek nawigacji stoi nieruchomo we wszystkich zakładkach, także na krótkim Profilu.
2. **Znika systemowy wskaźnik przewijania** — tego dokumentu nie dało się ukryć stylami,
   wskaźnik zwykłego kontenera już tak. Zgłoszenie z tej samej tury zamyka się samo.
3. Zawartość pod otwartym oknem nie ma jak drgnąć, bo poza kontenerem nie ma czego przewijać.

Koszt: pozycję przewijania czyta się i ustawia przez ten kontener, nie przez okno
(`window.scrollY` zwraca zero). Dotyczy to także narzędzia audytowego.

### 19.20 Dwa kolory z decyzji właściciela (2026-08-16)

**Twoja część rachunku to teraz pełna limonka**, a nie limonka na 16 % krycia. Przy kilku
kartach na ekranie ledwie zabarwiona karta ginęła. Wyspa w kolorze marki jest tym samym
blokiem, co saldo w Bilansie i koło [+] w pasku — wszędzie tam limonka znaczy „to jest
twoja liczba, po nią tu przyszedłeś".

Pełny kolor wymusił własny zestaw tonów, bo tekst pomocniczy aplikacji jest liczony pod tło
karty, nie pod limonkę: wszystko wewnątrz przechodzi na atrament z limonki w trzech mocach,
kreski i pola też. Osobno trzeba było rozstrzygnąć **barwy pieniężne**: zieleń „dostajesz"
i błękit stanu mają na limonce kontrast rzędu 1,5–2,5:1, a ich rola jest tam już obsadzona
przez samo tło — schodzą więc na atrament i niosą treść słowem. **Czerwień długu zostaje
kolorem**, bo tej informacji nie wolno zgubić, tyle że w wersji przyciemnionej
(`--owe-on-brand`, 6,5:1). Wyszło to na zrzucie z audytu: „Płatnik · potwierdzony" świecił
turkusem na limonce.

**Przycisk „Odczytaj paragon" dostał fiolet spoza palety** (`--ai`). To jedyne miejsce
w aplikacji, za którym stoi model, i jedyny fiolet: limonka znaczy „to jest twoje", barwy
pieniężne znaczą kierunek długu, a ten przycisk nie należy do żadnej z tych rodzin. Fiolet
niesie dziś skojarzenie z modelami tak samo, jak koperta niesie pocztę — korzystamy z tego
zamiast tłumaczyć to słowami. Do tego ikona różdżki i delikatna poświata, bo przy pierwszym
rachunku nikt nie wie, że zdjęcie paragonu da się w ogóle odczytać.

### 19.21 Poprawki po testach partii 8 (2026-08-16)

**Martwy pas na dole ekranu** — mój błąd z przebudowy przewijania. Kontener brał wysokość
z rodzica (`height: 100%`) i na iPhonie z ikony wychodził o kilkadziesiąt pikseli za krótki:
pod paskiem nawigacji zostawała czarna przestrzeń, a ostatni kafelek listy urywał się
w połowie. `position: fixed; inset: 0` nie ma o co pytać — kontener JEST oknem.

**Sposoby płatności w ustawieniach pokoju rozjeżdżały się poza kartę.** Wiersz z numerem
konta i dwoma przyciskami dostawał 3,5 rem wcięcia „pod awatarem" i przestawał się mieścić.
Wcięcie było ozdobą, więc wyleciało, a wiersz układa się teraz w dwóch poziomach: ikona
i numer w rzędzie, przyciski pod spodem. W oknie „Ureguluj" zostaje jednym rzędem, bo tam
ma dla siebie całą szerokość arkusza.

**Szukanie po pozycjach to teraz TEN SAM mechanizm, co szukanie osoby.** Pierwsza wersja
była osobnym kodem z własnym polem i własnym zachowaniem — i wyszło dokładnie to, czego
należało się spodziewać: pole bez klasy `field` nie miało tła ani koloru tekstu („nie widać
napisów"), a filtr działał inaczej niż przy osobach. Wspólny mechanizm sterują teraz
atrybuty w znacznikach (`data-search-rows`, `data-search-empty`), więc lupa rozwija pole
identycznie w obu miejscach. Pole przeniesione **nad** wydruk: tam patrzy oko, kiedy szuka.

**Opis pod „Koszty wspólne" usunięty** (decyzja właściciela). To samo mówi podpis przy
każdym wierszu — „Dla wszystkich · 3,50/os." — i mówi to w złotówkach, w miejscu, gdzie
ktoś patrzy.

**Audyt zobaczył trzy nowe stany**: sposoby płatności w profilu, rozwinięty wiersz
uczestnika w ustawieniach pokoju i szukanie po paragonie (lista wydłużona do ośmiu pozycji,
bo lupa pokazuje się dopiero od ósmej). Pierwszy z nich od razu znalazł realny błąd,
którego nie widziało żadne oko: przycisk usuwania sposobu płatności miał 36 px zamiast
44 px wymaganych dla celu dotykowego — przy operacji nieodwracalnej.

### 19.22 Czarny pas na dole: hipoteza sprawdzona i obalona (2026-08-16)

Czwarte podejście do tej samej rodziny objawów, tym razem z researchem — i **hipoteza
okazała się błędna**. Zapisuję ją, bo wygląda przekonująco i ktoś jej jeszcze spróbuje.

**Co zakładałem.** Że przy `apple-mobile-web-app-status-bar-style: black-translucent` blok,
od którego liczą się wysokości i do którego przypina się `position: fixed`, jest krótszy
o wysokość górnego wcięcia (~47 px na iPhonie 12) — bo tyle właśnie czerni widać na dole.
Dodałem więc tyle na dole kontenerowi i paskowi nawigacji.

**Co się stało.** Pasek nawigacji i dół treści **wyjechały poza ekran**. To jest dowód
w drugą stronę: `inset: 0` sięgało dolnej krawędzi widoku już wcześniej. Czarny pas leży
**poniżej widoku**, czyli sam widok nie zajmuje całego ekranu — a tego nie naprawi się
przesuwaniem czegokolwiek wewnątrz niego.

**Co zostało.** `html { min-height: calc(100% + env(safe-area-inset-top)) }` pod tymi
samymi dwoma warunkami. Nic nie przesuwa i nic nie może uciąć — dokument ma ukryte
przepełnienie, a wszystko widoczne jest przypięte do okna. Jeśli iOS rozciągnie widok
do wysokości dokumentu, pas zniknie; jeśli nie, reguła po prostu nic nie robi.

**Wniosek na przyszłość.** Trzy z czterech podejść do tej rodziny objawów były zgadywaniem
na podstawie zrzutu, i trzy razy trafiły obok. Panel z wymiarami okna (pięć stuknięć w znak
firmowy) istnieje właśnie po to, żeby czwarty raz zacząć od liczb: `screen` obok `inner`
mówi wprost, czy widok jest krótszy od ekranu, i o ile.

### 19.11 Stan audytu po partii

Cztery szerokości z kontraktu (360 / 390 / 834 / 1280), 32 stany ekranu, **zero zgłoszeń**:
bez wyjazdów poza ekran, bez celów poniżej progu, bez nachodzących się przycisków, bez
treści uwięzionej pod paskiem. 170 testów jednostkowych przechodzi.

Audyt przycisków zgłasza trzy pozycje i **wszystkie trzy są fałszywe** — warto to wiedzieć,
zanim ktoś zacznie ich „naprawiać": klik w zakładkę, na której już się jest (`nav-room`,
`nav-me`, nic się nie zmienia, bo nie ma czego zmieniać) oraz przełącznik trybu podziału
(`bill-mode-own`), który zapisuje do Firestore i czeka na powrót danych — a baza w audycie
odpowiada 403.

## 20. ETAP 1 — SIEĆ, FEEDBACK I ZAUFANIE DO LICZB (2026-08-26)

Partia wykonana po zgłoszeniach z wakacji (właściciel i jego kolega, oba telefony przy
zasięgu na jedną kreskę). Zakres świadomie wąski: **żadnych zmian w danych, w regułach
Firestore ani w service workerze.** Wszystko, co tu opisane, da się wgrać na gałąź, z której
ekipa korzysta w trakcie wyjazdu.

### 20.1 Sieć, która jest, ale nie odpowiada

Zgłoszenie: „w trybie samolotowym apka od razu rozumie, że jest offline, ale przy bardzo
wolnym internecie albo gdy wifi jest, a nie działa — ciemny ekran, potem biały, a potem
nagle się odpala".

Cztery przyczyny, wszystkie naprawione:

1. **Wejście do pokoju czekało na serwer.** `await getDoc(...)` stało przed pierwszym
   malowaniem, a `getDoc` przy włączonej pamięci trwałej i tak najpierw próbuje sieci.
   Teraz pokój wstaje z pamięci (`getDocFromCache`), a nasłuchy dociągają świeże dane w tle.
2. **`navigator.onLine` nie wykrywa lie-fi.** Trzy stany zamiast dwóch, czytane z
   `metadata.fromCache`, plus licznik własnych zapisów czekających na wysyłkę.
3. **Zapisy zawieszały interfejs.** Obietnica z `updateDoc`/`addDoc` rozwiązuje się dopiero
   po potwierdzeniu serwera — offline nigdy. Zajęcie imienia, zapis wpłaty i potwierdzanie
   wpłat idą teraz przez `fireWrite`: akcja wykonuje się od razu, stan wysyłki niesie pasek.
4. **Ekran wczytywania nie miał terminu.** Po 1,5 s mówi „Łączę się…", po 4 s „Sieć nie
   odpowiada — wchodzę na zapisane dane".

**Pułapka, którą trzeba znać przy każdej kolejnej zmianie w tym obszarze:** `forgetRoom`
kasuje pokój z `localStorage`, czyli jedyny jego ślad na urządzeniu. Wolno go wywołać
**wyłącznie po odpowiedzi potwierdzonej przez serwer** (`!metadata.fromCache`) — odczyt
Firestore potrafi rozwiązać się z pamięci, a wtedy „nie istnieje" znaczy tylko „nie mam
tego u siebie".

### 20.2 Nowy przebieg audytowy: `tools/audit-offline.mjs`

Stanu „wifi jest, serwer milczy" **nie odtwarza przełącznik offline** w narzędziach
przeglądarki — tamten blokuje też serwer, z którego idzie sama aplikacja, więc strona
się nie wczytuje i nie ma czego badać. Przebieg odcina zamiast tego sam Firestore.

```
npm run emulators
npx vite --port 5199 --strictPort
BILLIADA_URL=http://localhost:5199/ node tools/audit-offline.mjs
```

Trzynaście sprawdzeń: zwykły start, założenie pokoju, wejście przy milczącym serwerze
(zmierzone **136 ms**), zachowanie listy pokoi, treść paska w obu stanach, praca offline
i powrót serwera.

**Przebieg złapał błąd, którego nie widać w kodzie:** `onSnapshot` domyślnie nie zgłasza
zmian samych metadanych, więc powrót serwera przy niezmienionych danych nie wywoływał
żadnego wywołania zwrotnego i pasek zostawał zapalony. Stan łączności ma dlatego własny,
pusty nasłuch z `includeMetadataChanges` — dokładanie tej opcji do nasłuchu grupy kazałoby
przerysowywać cały pulpit przy każdym potwierdzeniu zapisu.

### 20.3 Feedback: stan mieszka na rzeczy, nie w dymku

Zgłoszenie: „wgrałem zdjęcie profilowe i nie było żadnego feedbacku, że to się dzieje —
dopiero jakoś po minucie się zaktualizowało". Dymek żyje 3,6 s, wysyłka trwała minutę.

Podgląd lokalny pojawia się w chwili wyboru pliku, procent idzie z `uploadBytesResumable`,
a stan siedzi **na awatarze** i przeżywa przerysowania wywołane cudzymi zmianami. Reguła
nazwana zapisana w `DESIGN.md`.

### 20.4 Powiadomienia: zgoda to nie to samo, co rejestracja

Zgłoszenie: „wyskoczył alert, że się nie powiodło, ale potem jak klikam na tę opcję, to
pisze, że są włączone". Przełącznik ma pięć stanów zamiast trzech, `getToken` limit czasu
i trzy próby, a po powrocie sieci rejestracja ponawia się sama. Token FCM przestał trafiać
do konsoli produkcyjnej.

### 20.5 Liczby, którym można ufać

- **Rozjazd sumy pokazuje działanie, nie domysł.** „Ktoś przeliczył albo pozycja jest
  podwójna" pomijało koszty ogólne — trzeci składnik sumy kontrolnej. Ekran rozpisuje teraz
  składniki i daje przycisk „Ustaw kwotę rachunku na…". Aplikacja nigdy nie robi tego sama.
- **Kontrola paragonu ma trzy stany.** Brak sumy z paragonu wyłączał ostrzeżenie w całości,
  więc arkusz wyglądał tak samo pewnie jak przy zgodnej sumie. Trzeci stan prosi o jedną
  liczbę i przywraca pełne sprawdzenie.
- **Znak różnicy jest w treści.** Nadmiar znaczy duplikat, niedobór — przeoczoną linię.
  Jedno zdanie na oba kierunki myliło w połowie przypadków.
- **Podejrzany wiersz mówi o sobie sam** (duplikat, pozycja większa niż paragon, nazwa
  podsumowania). Znacznik, nigdy ciche odznaczenie.
- **„Kto komu" przestaje straszyć długami widmo.** Po wpłacie poprowadzonej planem
  minimalnym ta zakładka pokazywała długi, których już nie ma — odtworzone w
  `src/plan.origin.test.js`. Wiersz bez rachunku za sobą przyznaje się do tego i traci
  przycisk akcji razem z dzwonkiem.
- **Udział przed wyborem pozycji** dostaje znacznik „wstępnie" przy samej kwocie.

### 20.6 Stan testów po etapie

263 testy jednostkowe, 34 testy reguł, 13 sprawdzeń przebiegu offline. Wszystko zielone.

### 20.7 Pułapka przy uruchamianiu testów

`npm run test:rules` zakłada **czystą bazę w emulatorze**, a `tools/audit-offline.mjs`
i `tools/shot-etap1.mjs` zostawiają w niej prawdziwe pokoje, rachunki i wpłaty. Puszczone
w złej kolejności testy reguł wywalają kilka sprawdzeń z `PERMISSION_DENIED` i wygląda to
jak regresja reguł, której nikt nie wprowadził — sprawdzone, ta sama liczba błędów wychodzi
na gałęzi bazowej.

Kolejność bezpieczna: **testy reguł najpierw, przebiegi przeglądarkowe potem** — albo
restart emulatorów pomiędzy. Po restarcie 34 testy reguł przechodzą komplet.

## 21. ETAP 2 — POWŁOKA Z PAMIĘCI I ŚCIEŻKA AKTUALIZACJI (2026-08-26)

Partia świadomie WĘŻSZA niż plan: osobne odświeżanie na żądanie (przycisk, gest
pociągnięcia) **nie wchodzi**, dopóki właściciel nie ustali z kolegą, co ten miał na myśli,
mówiąc „nie da się odświeżać tej apki" — patrz pamięć projektu.

### 21.1 Powłoka idzie z pamięci natychmiast

Nawigacja dawała sieci **trzy sekundy**, zanim pokazała kopię z pamięci. Przy „net jest,
ale nie działa" to były trzy sekundy pustego ekranu, zanim przeglądarka dostała choćby
HTML — czyli zgłoszony „ciemny ekran".

Czekanie nie miało czego kupić: powłoka to jeden plik, identyczny dla każdego pokoju,
a dane idą z Firestore osobnym kanałem na żywo. Zmierzone na buildzie produkcyjnym przy
całkowicie odciętym serwerze: **18–20 ms**.

### 21.2 Cena tej zmiany i jej spłata

Po wdrożeniu człowiek pracuje na poprzedniej wersji aż do odświeżenia. Bez sygnału
zamienilibyśmy trzy sekundy czekania na **cichą starą wersję** — problem gorszy, bo
niewidoczny. Stąd pasek „Nowa wersja aplikacji jest gotowa" z przyciskiem.

`skipWaiting()` **wypada** z instalacji i to nie jest przeoczenie. Nowy worker wchodził
dotąd natychmiast, w środku życia otwartej strony; przy pamięci pierwszej znaczyłoby to,
że nowy worker podaje nowe pliki stronie działającej na starym kodzie. Nazwy zasobów niosą
skrót zawartości, więc kawałek doładowywany leniwie (`heic2any`) może w nowym wydaniu nie
istnieć — i funkcja przestaje działać w połowie sesji, bez słowa.

### 21.3 Pieczęć wydania — bez niej cała ścieżka jest martwa

**Przeglądarka rozpoznaje nowego service workera WYŁĄCZNIE po zmianie bajtów `sw.js`.**
Vite kopiuje ten plik z `public/` bez zmian, więc wdrożenie nowego kodu aplikacji przy
nietkniętym `sw.js` nie wywołuje żadnego `updatefound`. Pasek nigdy by się nie pokazał.

Wtyczka `billiada-sw-stamp` w `vite.config.js` dopisuje skrót zbudowanego `index.html` —
ten niesie nazwy zasobów ze skrótami zawartości, więc pieczęć zmienia się dokładnie wtedy,
gdy zmienia się aplikacja, i ani razu więcej. Znalezione przy pisaniu testu tej ścieżki,
nie po zgłoszeniu.

### 21.4 Waga paczki — czego NIE da się zrobić

Zmierzone rozmiary: **firestore 538 kB, auth 114 kB, kod aplikacji 171 kB**, storage 31 kB,
messaging 25 kB, qrcode 21 kB, functions 8 kB.

Firestore to sześćdziesiąt procent paczki i **jest potrzebny do pierwszego rysowania**, bo
bez niego nie ma danych. Cel „poniżej 250 kB do pierwszego malowania" z planu etapu 2 jest
więc **nieosiągalny** bez wymiany SDK na wywołania REST — a to przebudowa, nie optymalizacja.
Zapisane wprost, żeby nikt nie ścigał tej liczby.

Co zrobione zamiast tego:

- **Podział na paczki dostawcy.** Nie po to, żeby było lżej, tylko żeby aktualizacja była
  tania: `vendor-firestore` i `vendor-auth` mają swoje skróty zawartości, więc wdrożenie
  samego kodu aplikacji każe pobrać **206 kB zamiast 892 kB**. Sprawdzone — przy zmianie
  napisu w `main.js` skróty obu paczek dostawcy nie drgnęły.
- **Leniwe `qrcode-generator` i `firebase/messaging`** (46 kB): kod QR dogrywa się przy
  rozwinięciu, powiadomienia po rejestracji service workera, która i tak czeka na `load`.
- **`firebase/storage` ZOSTAJE statyczny, świadomie.** Dziesięć miejsc wywołań, w tym jedno
  poza kontekstem asynchronicznym, a zysk to 31 kB. Nie warto ruszać ścieżek zdjęć, których
  nie da się w pełni przetestować bez klucza do modelu AI.

### 21.5 Nowy przebieg audytowy: `tools/audit-sw.mjs`

Service worker rejestruje się **wyłącznie w buildzie produkcyjnym**, więc `audit-offline.mjs`
(chodzi po serwerze deweloperskim) nie dotyka go w ogóle.

```
npm run emulators
VITE_USE_EMULATOR=true npx vite build
npx vite preview --port 5197 --strictPort
BILLIADA_URL=http://localhost:5197/ node tools/audit-sw.mjs
```

Build MUSI iść na emulatory, żeby test nie dotknął żywych danych. Dziewięć sprawdzeń:
instalacja, powłoka przy odciętym serwerze, pojawienie się paska po podmianie pieczęci,
przejęcie sterów po stuknięciu.

### 21.6 Stan testów po etapie

263 testy jednostkowe, 34 testy reguł, 13 sprawdzeń przebiegu offline, 9 sprawdzeń
przebiegu service workera. Wszystko zielone.

---

## 22. ETAP 3 — TRYB GLOBALNY I „RACHUNEK PO RACHUNKU" (2026-08-26)

Aplikacja umie się rozliczać na trzy sposoby i grupa wybiera JEDEN. Do tej pory
przełącznik na ekranie rozliczeń był ustawieniem widoku jednej osoby (zwykła zmienna
w `main.js`, ginąca przy przeładowaniu), a plan minimalny był jedyną odpowiedzią na
pytanie „co mam zrobić".

> ⚠️ **§22.1–22.3 opisują pierwszą wersję etapu 3 — TRZY tryby z przełącznikiem widoku.**
> Model został uproszczony do DWÓCH tego samego dnia, po obejrzeniu na telefonie:
> patrz **§22.10**, które jest wersją obowiązującą. Zostawione, bo tłumaczy, skąd wzięła
> się reguła zwijania i dlaczego jeden z trybów wypadł.

### 22.1 Trzy tryby to JEDNA DRABINA ZWIJANIA (wersja pierwsza)

| Tryb | Co zwija | Gdzie liczy |
|---|---|---|
| Najmniej przelewów (`min`) | **między osobami** — optymalizuje trasę | `simplifyDebts` |
| Kto komu (`net`) | **na osobie** — sumuje należności wobec jednej | `netDirected` |
| Rachunek po rachunku (`perBill`) | **nic** — wiersz na rachunek, w kolejności dodawania | `src/perbill.js` |

**REGUŁA TWARDA: żaden tryb nie dowozi tego, co robi sąsiedni.** W trybie rachunkowym
NIE MA podsumowań po osobie, sum ani grupowania. Kto chce wiedzieć, ile łącznie idzie do
Marka, przełącza się na „Kto komu" — po to on jest. Ta reguła była w rozmowie łamana trzy
razy i dlatego stoi tu wprost.

Jedyny wyjątek jest w TREŚCI PRZYPOMNIENIA: jedna osoba, która nie oddała za trzy
rachunki, dostaje jedno przypomnienie na sumę, a nie trzy pod rząd. To jest wiadomość
do człowieka, nie obraz długu — dług obok zostaje rozpisany rachunek po rachunku.

### 22.2 Tryb GRUPY i tryb WIDOKU to dwie różne rzeczy

- **Tryb grupy** — pole `settlementMode` w dokumencie grupy (`'min' | 'net' | 'perBill'`).
  **Brak pola znaczy `'min'`**, czyli dzisiejsze zachowanie: żaden istniejący pokój nie
  zmienia się sam z siebie po wgraniu tej wersji. Wartość spoza listy też schodzi do
  `'min'` — do dokumentu grupy pisze każdy, kto ma link, więc śmieć w tym polu nie może
  zepsuć ekranu rozliczeń.
- **Tryb widoku** — to, na co patrzę w tej chwili. Wolno obejrzeć każdy z trzech, ale
  **w cudzym trybie ekran nie daje ANI JEDNEGO przycisku akcji**, tylko jedną cichą linię
  „grupa umówiła się inaczej". Przelew wykonany planem, na który grupa się nie umówiła,
  kończy się wpłatą, której nie ma jak przypisać — i to jest dokładnie ten dług, który
  trzeba potem tłumaczyć osobnym blokiem.

Tryb grupy świeci **limonką marki** na przełączniku, ZAWSZE — także gdy oglądam inny.
Widok idzie za trybem grupy, dopóki człowiek sam nie przestawi przełącznika
(`settlementViewPinned`); po ręcznym przestawieniu nie wyrywamy mu ekranu spod palca.

Wybór mieszka w **ustawieniach pokoju**, trzema wierszami z pełnym zdaniem wyjaśnienia
przy każdym — nie arkuszem wyboru z samymi nazwami. „Kto komu" i „Rachunek po rachunku"
brzmią podobnie, dopóki nie napisze się wprost, co się w nich zwija. Zmiana idzie do
dziennika aktywności: przy cudzych pieniądzach zmiana bez śladu jest gorsza od zmiany,
o której ktoś nie wiedział.

### 22.3 Gdzie mieszka tryb rachunkowy

- **Rachunki** — filtr „Do oddania (N)" na istniejącej liście. Filtr działa w KAŻDYM
  trybie: pytanie „co jeszcze wisi" nie zależy od tego, jak grupa się umówiła. Kwota na
  kafelku pokazuje w trybie rachunkowym **ile ZOSTAŁO**, nie ile było, a „Ureguluj" stoi
  osobnym wierszem pod kafelkiem — czwarty element w rzędzie z imieniem, kwotą i krzyżykiem
  ukrywania zaczyna się zawijać poniżej 400 px.
- **„Kto już oddał" na ekranie rachunku — w KAŻDYM trybie.** To nie jest część trybu
  rachunkowego, tylko odpowiedź na pytanie, które pada zawsze: „oddałeś mi za tę kolację?".
  Do tej pory rachunek nie miał na nie ani słowa, a płatnik składał sobie odpowiedź
  z dat i kwot w rejestrze wpłat.
- **Rozliczenia NIE powtarzają listy rachunków.** Sekcja „Do oddania" to trzy linijki
  z przejściem do zakładki „Rachunki". Strona „Dostajesz" idzie tam wierszami rachunek po
  rachunku — bo to jedyne miejsce, w którym płatnik odbiera wpłaty i przypomina o nich.
  Rejestr wpłat i windykator działają w każdym trybie.
- **Bilans** — wielka kwota **bez zmian** (saldo na czysto jest identyczne we wszystkich
  trybach, patrz 22.5), podpis liczy rachunki zamiast osób, nad kwotą pigułka trybu.

### 22.4 Wpłaty: `billId` i reguła przypisania

Wpłata dostaje **opcjonalne** pole `billId`, dopisywane tylko wtedy, gdy wpłata faktycznie
dotyczy jednego rachunku. Stare wpłaty działają bez migracji.

**PRZYPISANIE TYLKO W OBRĘBIE PARY.** Wpłata X→Y gasi wyłącznie długi X wobec Y, od
najstarszego rachunku. Wcześniejsza wersja tej reguły (najstarszy dług X wobec KOGOKOLWIEK)
była błędna: pokazywałaby rachunek jako spłacony Markowi, choć pieniądze poszły do Oli.
Wskazany `billId` idzie pierwszy, reszta pary po nim; nadwyżka ponad wskazany rachunek
schodzi na resztę tej samej pary, zanim uzna się ją za nieprzypisaną.

**Czego nie da się przypisać, to się przyznaje.** Wpłata poprowadzona planem minimalnym
(„Kuba płaci Oli za dług wobec Marka") nie ma po stronie pary ani jednego rachunku.
W pokoju działającym od miesięcy takich wpłat prawdopodobnie już trochę jest. Nie wolno
ich ukryć (pieniądze wyszły z konta) ani doliczyć na siłę do cudzego rachunku (fałszywy
dowód wpłaty). Lądują w bloku **„Wpłaty bez przypisania"** z kwotą, odbiorcą i zdaniem
„powstała w trybie »Najmniej przelewów«", a różnicę nazywa **linia uzgadniająca**:

```
1 rachunek 30,00 PLN · wpłata bez przypisania −30,00 PLN · zostaje 0,00 PLN
```

Bez niej lista rachunków mówiłaby „30,00 do oddania", a saldo na czysto „0,00" — i nic
by tej sprzeczności nie tłumaczyło.

### 22.5 NIEZMIENNIK: saldo na czysto jest identyczne we wszystkich trzech trybach

Tryb zmienia wyłącznie trasę pieniędzy i grubość ziarna, **nigdy wynik**. To jedyna rzecz,
która broni przed tym, żeby trzy tryby stały się trzema księgowościami — i dlatego ma
własny test (`netFromBills` vs `myNetByCurrency`), a nie przypis w komentarzu. Test
sprawdza to także na stu losowych pokojach po pięć osób i na kółku długów zamkniętym
planem minimalnym.

### 22.6 Potwierdzanie — NIE BUDOWANE OD NOWA

`src/nudges.js` miał już `kind: 'confirm-payment'` na poziomie 1 progu sygnału. Dołożone
są dwie rzeczy:

- **nazwa rachunku** (`billId` jedzie przez `inboxItems` do skrzynki, Bilansu i rejestru),
- **sortowanie tak, żeby wiersze tej samej osoby stały obok siebie**. Pięć rachunków
  odklikniętych naraz to nadal **pięć wpłat, odznaka „5" i pięć wierszy** — nie zwijamy
  ich (decyzja właściciela: „w trybie rachunkowym robimy łopatologicznie bardzo"). Ale
  rozsypane po skrzynce zmuszałyby do pięciu osobnych decyzji o tej samej osobie; obok
  siebie są jedną sprawą z pięcioma stuknięciami. Kolejność OSÓB nadal idzie od najnowszej
  sprawy, więc świeże rzeczy zostają na górze.

### 22.7 Usterki znalezione przy okazji (wszystkie zastane)

- **Kwota wpłaty nie wyświetlała się nigdzie poza rejestrem.** Wpłata zapisuje kwotę
  w złotych, w polu `amount`; pola `amountG` nie ma na niej nigdy. Skrzynka i dziennik
  aktywności czytały `s.amountG`, więc pisały „Bartek zgłosił/a wpłatę." i „Bartek → Ala:
  0,00 PLN". Przypomnienia mają `amountG` i stąd wzięła się ta pomyłka: sąsiednie źródła,
  dwa różne kształty danych.
- **Odznaka na dzwonku nie zapalała się po cudzej wpłacie.** Nasłuch wpłat nie wołał
  `updateNudgeBadge`, więc sygnał poziomu 1 pojawiał się dopiero przy następnej zmianie
  dokumentu grupy — czyli często wcale.
- **Skład grupy nie odświeżał się po dopisaniu osoby.** `renderRoomMembers` wołało
  wyłącznie `openRoomSettings`; dopisanie dawało toast „Dodano: X" i ani jednej zmiany na
  liście dwa centymetry wyżej. Wyglądało to na zapis, który nie przeszedł.
- **Nasłuch dokumentu grupy nie miał zapisanego `unsubscribe`** (dług z etapu 1). Każda
  powtórna nawigacja do pokoju dokładała kolejny nasłuch.
- **Trzy potwierdzenia wpłat przerobione na `fireWrite`** — offline `await updateDoc` nie
  rozwiązuje się nigdy, a tryb rachunkowy mnoży te potwierdzenia.

### 22.8 Nowy przebieg audytowy: `tools/audit-etap3.mjs`

Testy jednostkowe pilnują matematyki, kontrakt etykiet — istnienia identyfikatorów. Żaden
z nich nie sprawdza, czy „Ureguluj" zapisuje wpłatę z `billId` i czy druga osoba widzi ją
jako spłatę TEGO rachunku. Przebieg prowadzi **trzy tożsamości w trzech kontekstach
przeglądarki** (Ala, Bartek, Celina) przez pełny scenariusz, z kółkiem długów zamkniętym
planem minimalnym włącznie.

```
npm run emulators
npx vite --port 5199 --strictPort
BILLIADA_URL=http://localhost:5199/ node tools/audit-etap3.mjs
```

42 sprawdzenia. Uwaga na dwie pułapki pisania takich przebiegów, obie zapisane w kodzie:
ekran rachunku pokazuje się ZANIM `renderBillScreen` dopnie nasłuchy (stąd `klikAzOtworzy`),
a pole kwoty zapisuje się przy utracie ogniska i potrafi trafić w moment przerysowania
(stąd `wpiszKwote` z powtórzeniem).

### 22.9 Poprawki po pierwszym obejrzeniu na telefonie (2026-08-26, wieczór)

Właściciel wystawił gałąź jako branch deploy Netlify i obejrzał ją na telefonie. Pięć
uwag, wszystkie o tym samym: **zakładka „Rachunki" niosła za dużo naraz.**

- **Zakładka nazywa się „Rozliczenia", nie „Kto komu ile".** Stary tytuł kolidował
  z nazwą trybu „Kto komu" — po dołożeniu trzeciego trybu ta sama nazwa znaczyła
  i miejsce, i jeden ze sposobów liczenia.
- **Wiersz rachunku niesie w trybie rachunkowym SAM STATUS, bez kwoty.** „Nieopłacone" /
  „Opłacone" dla dłużnika, „Czeka na zwrot" / „Rozliczony" dla płatnika. Dwie pary słów,
  bo dwie role: płatnik już zapłacił, więc rachunek nie jest z jego strony „nieopłacony".
  Kwota stoi na ekranie rachunku, przy przycisku. Chip płatnika wycisza się wtedy do
  neutralnego — inaczej wiersz niósł dwa czerwone znaczki mówiące to samo.
- **„Ureguluj" znika z listy i wchodzi na limonkową kartę „Twój udział".** Na liście
  robił z każdego wiersza dwa piętra; na karcie stoi tam, gdzie i tak stoi kwota.
  Czerwona pigułka na limonce jest wyjątkiem od zasady „na limonce nie ma czerwieni":
  zasada dotyczy KOLORU TEKSTU, a pełna pigułka z białym napisem ma z limonką kontrast
  wyższy niż z białą kartą.
- **Wiersz „Zostaje do oddania" wchodzi dopiero po CZĘŚCIOWEJ wpłacie.** Bez wpłat jest
  co do grosza tą samą liczbą, co „Twój udział" dwa wiersze wyżej.
- **Ukrywanie zeszło pod GEST.** Przekreślone oko stało w rzędzie obok kwoty, centymetr
  od miejsca, w które stuka się, żeby wejść w rachunek — a skutkiem pomyłki jest
  zniknięcie rachunku z listy. Teraz wiersz odsuwa się palcem w lewo i odsłania „Ukryj";
  pomyłkowe odsunięcie nie robi nic, a samo ukrycie da się cofnąć paskiem „Cofnij"
  (ten sam wzorzec, co przy kasowaniu rachunku). Przycisk jest PRAWDZIWYM elementem
  w drzewie i `:focus-within` odsuwa kartę tak samo jak palec — gest bez alternatywy
  jest dla części ludzi ścianą.
- **Filtr „Ukryte" pokazuje liczbę.** To jedyny filtr, który człowiek nakłada sam na
  siebie, i jedyny, po którym rachunek znika mu z oczu.
- **NAZWY RACHUNKÓW NIE UCINAJĄ SIĘ.** „Pizzeria u Wujka Stacha" schodziła do
  „Pizzeria u W…" i na liście, i w nagłówku ekranu rachunku. Nazwa jest tożsamością
  wiersza — po niej odróżnia się dwie kolacje z tego samego tygodnia — więc ucięcie
  zabierało dokładnie tę część, która rozróżnia.

  Samo zdjęcie `truncate` nie wystarczyło: kolumna nazwy miała przy 390 px około 150 px,
  bo po prawej stała kwota albo status. W trybie rachunkowym prawa kolumna niesie SAM
  ZNACZEK, a ten czyta się równie dobrze w rzędzie podpisów piętro niżej — więc tam
  schodzi, a nazwa dostaje całą szerokość wiersza. W pozostałych trybach po prawej stoi
  LICZBA, która musi być wyrównana do prawej, i zostaje na miejscu.

  Razem z tym doszedł `maxlength="60"` na polu nazwy: skoro nazwa zawija się na tyle
  wierszy, ile trzeba, to bez ograniczenia wklejony akapit rozepchnąłby kafelek na pół
  ekranu. Nagłówek rachunku dostał `leading-tight` zamiast `leading-none` — przy zawijaniu
  wiersze w stopniu 3xl zachodziły na siebie ogonkami — i wyrównanie `items-start`,
  żeby strzałka powrotu nie odjeżdżała na środek wysokości razem z drugim wierszem.

Rozstrzygnięcie osi gestu jest w `attachSwipeToHide`: kierunek ustala się RAZ, przy
pierwszym wyraźnym ruchu (próg 8 px). Bez tego lista albo nie chce się przewijać, albo
wiersze uciekają w bok przy każdym przewinięciu — ten sam palec, ten sam ruch, inna
intencja.


### 22.10 DWA TRYBY, ZERO SEGMENTÓW — model obowiązujący (2026-08-26, wieczór)

Właściciel obejrzał trzy tryby na telefonie i postawił pytanie, które okazało się
rozstrzygające: **czy aplikacja jest w stanie obsłużyć dowolny tryb rozliczeń — czy
raczej trzeba wybrać jeden i trzymać się go?**

Odpowiedź siedzi w danych, nie w wygodzie interfejsu:

- **„Kto komu" i „Rachunek po rachunku" to ta sama trasa pieniędzy, tylko w innym
  powiększeniu.** Każdy przelew idzie od dłużnika do płatnika rachunku, na którym obaj
  byli. Wpłatę zrobioną w jednym da się więc opisać w drugim — i już się dało, bez ani
  jednej linijki dodatkowego kodu.
- **„Najmniej przelewów" wymyśla trasy, których żaden rachunek nie stworzył.** Kuba płaci
  Oli za dług wobec Marka. Nie da się tego oznaczyć na żadnym rachunku nie dlatego, że
  brakuje interfejsu, tylko dlatego, że pieniądze poszły tam, gdzie nie wskazuje żaden
  rachunek.

Asymetria jest JEDNOSTRONNA: zapłata za konkretny rachunek w pokoju grającym planem
minimalnym niczego nie psuje — wychodzi tylko więcej przelewów, niż musiało. Odwrotnie
już nie.

Stąd model obowiązujący:

| | Najmniej przelewów (`min`) | Rachunkowy (`perBill`) |
|---|---|---|
| **Bilans** | plan minimalny, „Ureguluj" do osoby z planu | podsumowanie: ile, za ile rachunków, ilu osobom + przejście do Rozliczeń |
| **Rozliczenia** | plan minimalny | wiersz na OSOBĘ, suma jej rachunków, rozwijane „Za co", „Ureguluj" |
| **Rachunki** | udział poglądowo, bez statusu i bez filtra „Do oddania" | status Opłacone/Nieopłacone, filtr „Do oddania (N)", „Ureguluj" w rachunku |

**PRZEŁĄCZNIK TRYBU ZNIKA Z EKRANU ROZLICZEŃ.** Tryby nie są powiększeniami tych samych
pieniędzy, tylko dwoma sposobami ich wydawania — a każdy z nich potrzebuje INNYCH
informacji na wszystkich trzech ekranach. Wybór jest jeden, należy do grupy i mieszka
w ustawieniach pokoju.

Wartość `'net'` w dokumencie grupy **przechodzi na `'perBill'`**. Trzeci tryb istniał
przez pół dnia i któryś pokój mógł zdążyć go zapisać; to, co robił, jest dziś WIDOKIEM
trybu rachunkowego na ekranie Rozliczeń, więc przepisanie zachowuje intencję, a nie
tylko unika śmiecia w polu.

#### Rozliczenia w trybie rachunkowym: wiersz na osobę

Rozpisanie rachunek po rachunku dublowało zakładkę „Rachunki", a przy jednym przelewie
za trzy kolacje kazało odklikiwać trzy wiersze. Przelew robi się DO CZŁOWIEKA, nie do
rachunku, więc ekran, na którym się płaci, jest ułożony po ludziach.

Rachunki nie znikają — są pod „Za co" przy każdym wierszu i w arkuszu wyboru przy
regulowaniu. To jedyne miejsce, w którym tryb rachunkowy sumuje po osobie, i jest to
świadome odstępstwo od reguły z §22.1.

Przy okazji rozwiązuje się usterka przypomnień: dzwonek stał wcześniej przy wierszu
rachunku i wysyłał przypomnienie o kwocie JEDNEGO rachunku („przypominam o 45,00", choć
wisi 120,00), a drugie stuknięcie wpadało w blokadę antyspamową. Wiersz na osobę liczy
sumę z definicji.

#### Arkusz „Za co płacisz" i pole `billIds`

Jeden przelew w banku bywa zapłatą za kilka rachunków, więc wpłata **niesie listę
rachunków**, które pokrywa (`billIds`), a nie jest rozdzielana regułą „od najstarszego".
Domyślnie zaznaczone są wszystkie; odznaczenie przelicza sumę na przycisku.

Reguła „od najstarszego" zostaje dla wpłat, które takiej listy nie mają — starych i tych
z planu minimalnego — ale przy jawnym wyborze byłaby wprost szkodliwa: przy odznaczeniu
środkowego rachunku zgasiłaby nie te, które człowiek wybrał, a odbiorca nie miałby skąd
wiedzieć, za co dostał pieniądze.

Nadwyżka ponad wybrane rachunki schodzi na resztę tej samej pary, zanim uzna się ją za
nieprzypisaną: przelew większy niż suma zaznaczonych to najczęściej dopłata do
pozostałych, a nie pomyłka.

**JEDEN PRZELEW = JEDNA WPŁATA** (decyzja właściciela, odwraca wcześniejsze „5 rachunków
= 5 wpłat"). Odbiorca dostaje jeden wiersz do potwierdzenia, a lista rachunków stoi przy
nim wypisana — w skrzynce, na Bilansie i w rejestrze. Stare pole `billId` (jeden napis)
jest nadal czytane, dla wpłat zapisanych, zanim wybór wielu rachunków istniał.

### 22.11 „Kto już oddał" schodzi do „Ekipy" (2026-08-26)

Osobna sekcja „Kto już oddał" na ekranie rachunku była DRUGĄ LISTĄ TYCH SAMYCH LUDZI,
dwa ekrany pod pierwszą. Zgłoszenie właściciela: zbędna — statusy mają siedzieć przy
osobach, w zwijanej „Ekipie", razem z resztą szczegółów uczestnika.

- Znacznik stoi w rzędzie z imieniem: **„✓ Oddał/a"** albo **„Zostaje 45,00 PLN"**.
- Podpis zwiniętej sekcji niesie to, po co się ją rozwija: **„Ekipa: 3 osoby · oddało
  2 z 3"**. Licznik uzupełnień wraca do podpisu, gdy nie ma jeszcze czego rozliczać
  (rachunek bez potwierdzonego płatnika albo bez kwoty).
- **WYŁĄCZNIE W TRYBIE RACHUNKOWYM.** To zmiana wobec pierwotnej decyzji („w każdym
  trybie") i wynika z modelu z §22.10: w planie minimalnym wpłaty idą trasami, których
  żaden rachunek nie stworzył, więc zdanie „oddał za TEN rachunek" nie ma się z czego
  wziąć. Dokładnie z tego samego powodu w tym trybie nie ma statusu na liście rachunków
  ani filtra „Do oddania" — jedna reguła, trzy miejsca.
- Strona dłużnika zostaje bez zmian na limonkowej karcie „Twój udział".

Nasłuch wpłat przerysowuje teraz CAŁY ekran rachunku (`renderBillScreen`), a nie samą
sekcję: znaczniki liczą się z wpłat, więc po cudzej wpłacie ekran musi się odświeżyć,
inaczej pokazuje stan sprzed niej.

### 22.12 Stan testów po etapie

**298 testów jednostkowych** (35 w `src/perbill.test.js`), 34 testy reguł, 13 sprawdzeń
przebiegu offline, 9 sprawdzeń service workera, 42 sprawdzenia przebiegu etapu 3. Wszystko
zielone. Reguły Firestore **nie wymagały zmiany**: `settlementMode` na dokumencie grupy
i `billId` na wpłacie mieszczą się w istniejących regułach, a pola podsumowań nadal są
zamrożone.

---

## 23. POTWIERDZANIE PRZELEWÓW — etap 5 (2026-08-29)

Do tej pory na zgłoszoną wpłatę dało się odpowiedzieć wyłącznie „tak": wpłata miała
jedno pole `confirmed` i nic więcej. Kto nie widział przelewu na koncie, **nie miał
czym tego powiedzieć** — więc nie robił nic, a wtedy nie działo się nic. Wpis wisiał
w nieskończoność, a saldo twierdziło, że pieniądze doszły.

### 23.1 Trzy dziury, od których się zaczęło

1. **Odpowiedź była jedna.** Brak drugiej odpowiedzi znaczył, że znaczek „potwierdzona"
   nie niósł żadnej informacji o tym, czy pieniądze naprawdę doszły.
2. **Osoba znikała z „Dostajesz".** Zgłoszona wpłata od razu zbijała dług do zera, a lista
   pokazuje tylko długi większe od zera — więc płatnik tracił wiersz tej osoby w tej samej
   sekundzie, w której powinien był o niej pomyśleć.
3. **Podpis kłamał.** „Bez niego dług zostaje otwarty" — nieprawda: saldo nie czyta pola
   `confirmed` i nigdy nie czytało. Dług był zamknięty, zanim ktokolwiek cokolwiek
   potwierdził.

### 23.2 Model: sześć stanów, każdy pisany przez inną stronę

| Stan | Liczy się do salda? | Kto pisze |
|---|---|---|
| Zgłoszona | tak | — |
| Potwierdzona | tak | odbiorca (`confirmed`) |
| Nie znaleziona | **nie** | odbiorca (`disputed`) |
| Sprawdzana ponownie | **nie** | nadawca (`insisted`) |
| Do wyjaśnienia | **nie** | odbiorca (`stalled`, druga odmowa) |
| Wycofana | **nie** | nadawca (`withdrawn`) |

Wszystkie pola są **opcjonalne** — wpłaty sprzed tej zmiany nie mają żadnego i czytają
się dokładnie jak dotąd. **Migracji nie ma i nie będzie.**

Reguły Firestore pilnują przypisania ról: nadawca nie może sam sobie potwierdzić wpłaty
ani zdjąć cudzej odmowy. Pilnują też stanu niemożliwego — potwierdzona i sporna naraz
znaczyłyby dwie sprzeczne rzeczy o tych samych pieniądzach, bo saldo czyta oba pola.

Predykat `settlementCountsInLedger` (functions/calc.js) jest **jednym źródłem prawdy**
dla obu ksiąg (`buildLedger` i `billLedger`). Rozjazd między nimi znaczyłby, że Bilans
i Rozliczenia mówią o tych samych pieniądzach dwie różne rzeczy.

### 23.3 Stos — i dlaczego nazwy mówią o STANIE

Ekran rozliczeń ma dwie strony (Płacisz / Dostajesz) z przełącznikiem segmentowym
i gestem przesunięcia. Sam gest jest niewidzialny, więc afordancję niesie przełącznik —
ten sam wzorzec, którym działa skrzynka.

> **Uzupełnione 2026-08-29 (§24.2).** Gest nie jest już niewidzialny: strony leżą na
> jednej taśmie i jadą za palcem razem z pigułką przełącznika, a nieaktywny segment nosi
> strzałkę. Kropki pod listą zniknęły.

Wewnątrz stron stoją **nazwane stosy**. Stos zajmuje wysokość jednej karty niezależnie
od tego, czy leży w nim dwie sprawy, czy czterdzieści — piętnaście osób i trzy osoby dają
ten sam pierwszy ekran.

- **Dostajesz:** „Do potwierdzenia" · „Do wyjaśnienia" · „Czekasz na przelew"
- **Płacisz:** „Do zapłaty" · „Do wyjaśnienia"
- **Rachunek:** „Do potwierdzenia" · „Do wyjaśnienia" (bez trzeciego — patrz §23.6)

**Nazwy mówią o STANIE, nie o kategorii, i to jest cała różnica wobec pierwszej próby
tego podziału.** „Do potwierdzenia" obok „Dostajesz" czytało się jak dwie listy tego
samego, bo drugie słowo nazywało kategorię i brzmiało, jakby obejmowało pierwszą.
„Do potwierdzenia" obok „Czekasz na przelew" pomylić się nie da: jedno znaczy „ktoś
już przelał, sprawdź", drugie „jeszcze nie przelał, poganiaj".

**ODWROTNA GĘSTOŚĆ.** Zwinięty stos jest *bogatszy* od rozwiniętej listy: gdy patrzysz
na jedną sprawę, chcesz szczegółu; gdy skanujesz czterdzieści — gęstości. Zwinięty:
twarz 46 px, przyciski z napisami, pełne daty. Rozwinięty: wiersz 52 px, ikony, kropka
stanu zamiast pigułki.

> **Poprawione 2026-08-29 (§24.4).** Wiersz rozwinięty ma dziś 56 px i przyciski 44 px,
> a szczegóły są OSIĄGALNE pod strzałką przy wierszu — „uboższy" nie może znaczyć
> „niedostępny". Blok stanu o stałej wysokości nie powstaje wcale, gdy nie ma czego w nim
> pokazać (plan minimalny), bo wtedy puste są WSZYSTKIE karty stosu i nic nie skacze.

**BLOK STANU MA STAŁĄ WYSOKOŚĆ TRZECH WIERSZY.** To nie jest estetyka. Stos przeklikuje
się po kolei, więc gdyby karta rosła i malała z liczbą rachunków, przyciski skakałyby
pod palcem: stukasz „Mam", następna karta jest krótsza i palec ląduje nad „Nie widzę".
Przy cudzych pieniądzach to jest sposób na potwierdzenie nie tej wpłaty, co trzeba.

Kolejność w stosie idzie po tym, **czyj jest ruch i czy da się go zrobić teraz** —
nie po dacie. Sprawa stojąca od tygodnia wygląda na pilną, ale „Jednak mam" wymaga tego,
żeby pieniądze faktycznie doszły, a nie kolejnego stuknięcia.

### 23.4 Tarcie jest niesymetryczne

- **„Mam"** — jedno stuknięcie, bez arkusza, z paskiem „Cofnij" (6 s). Odpowiedź
  spodziewana i częsta; arkusz przed nią opodatkowuje wszystkich, żeby chronić przed
  rzadkim missclickiem, a przy piętnastu wpłatach robi z 15 stuknięć 30.
- **„Nie widzę"** — arkusz trzech przyczyn. Zostaje **nie dlatego, że pyta „na pewno?"**
  (taki arkusz byłby czystym podatkiem), tylko dlatego, że **podaje trzy fakty**, których
  człowiek mógł nie mieć: przelew międzybankowy idzie do następnego dnia roboczego, BLIK
  bywa widoczny pod pełnym nazwiskiem, sprawdź właściwe konto. To ostatnie miejsce,
  w którym da się zatrzymać fałszywy alarm, zanim dotrze do drugiej osoby.

Zapis idzie do bazy **od razu** (`fireWrite`), bo aplikacja działa offline, a obietnica
z Firestore bez sieci nie rozwiązuje się nigdy. „Cofnij" jest więc drugim zapisem.

### 23.5 Słownictwo — trzy rozstrzygnięcia

- **„Nie widzę", nie „Nie mam".** To nie ta sama rzecz: „nie mam" orzeka o świecie
  i brzmi jak zarzut, „nie widzę" mówi prawdę — szukałem i nie znalazłem. Dzięki temu
  wiadomość, która pójdzie do drugiej strony, nie zaczyna się od oskarżenia o kłamstwo.
- **„Pomyłka, nie wysłałem", nie „Wycofaj wpłatę".** To drugie było słownikiem bazy
  danych; nikt nie myśli o sobie „wycofuję wpłatę". I prowadzi **prosto do przelewu** —
  bo bez tego człowiek wyśle pieniądze teraz i stuknie „Wysłałem na pewno", zostawiając
  w mocy stare zgłoszenie ze **starą datą**. Odbiorca dostanie tę datę jako podpowiedź
  i przeszuka wyciąg wokół dnia, w którym nic nie wyszło.
- **Imiona wyłącznie w mianowniku.** „Masz ten przelew?", nie „Masz przelew od Bartek?".
  Polskich imion nie da się odmienić regułą (Bartek→Bartka, Ania→Ani, Kuba→Kuby),
  a zgadywanie na końcówkach kaleczy część imion w każdej ekipie. Kto pyta — mówi twarz
  i podpis pod nagłówkiem.

### 23.6 Rachunek

Ten sam wzorzec, zawężony do jednego rachunku, **pod** limonkową kartą, nie w niej: karta
mówi „ile wynosi mój udział", stos „kto mi przelał". Przy okazji znika problem kolorów —
na limonce nie istnieje ani limonkowy przycisk, ani ciemny (w motywie ciemnym `--ink`
jest prawie bielą), więc karty musiałyby mieć własną paletę.

~~**Brak stosu „Czekasz na przelew"** i to jest ta sama reguła, co przy dzwonku:
przypomnienie idzie DO OSOBY, na całą jej zaległość, a nie do rachunku. Ci ludzie są
widoczni tam, gdzie już są — jako chip przy imieniu w „Ekipie".~~

> **COFNIĘTE 2026-08-29 (§24.9).** Stos „Czekasz na przelew" stoi na rachunku, ale tylko
> w trybie rachunkowym. Powód: część ekipy rozlicza się rachunek po rachunku i do zakładki
> Rozliczenia nie zagląda, więc płatnik widział, kto nie oddał, i nie mógł z tym zrobić nic
> bez wyjścia na inną zakładkę. Zarzut o trzy przypomnienia do tej samej osoby rozbija się
> o bramkę czasową w `sendNudge`, która działa per osoba.

**Potwierdzenie jest niepodzielne.** Jeden przelew bywa zapłatą za pięć rachunków,
a potwierdza się PRZELEW, nie rachunek — więc karta mówi wprost „Pokrywa też N innych
rachunków", zanim ktoś stuknie „Mam".

### 23.7 Kwota przestaje być wpisywana

Przy „Ureguluj" kwota jest **wyprowadzana z wyboru rachunków**, nie wpisywana z palca.
Wpisana nie odpowiadała żadnemu zbiorowi rachunków, więc odbiorca dostawał pytanie
o gołą liczbę i sam musiał zgadnąć, czego dotyczy i czy jesteście kwita.

Wyjątkiem jest **„Oddał/a mi już"** (dawne „Mam wpłatę"): tam człowiek przepisuje realną
kwotę gotówki, której aplikacja nie zna. Zasada porządkująca: **kwotę wolno wpisać
z palca dokładnie tam, gdzie nie tworzy to pytania dla drugiego człowieka.**

Przy okazji ten przycisk przestał robić dwie rzeczy pod jednym napisem — potwierdzał
cudze zgłoszenie albo otwierał arkusz, zależnie od stanu.

### 23.8 Bilans i rejestr

**Bilans przestaje być drugą skrzynką.** Renderował pełne kafelki — te same, co skrzynka
pod dzwonkiem — więc ekran wejściowy robił się listą zadań, a powtórzony sygnał uczy
przewijać oba. Zostają dwa wiersze-drogowskazy: limonka tam, gdzie jest mój ruch,
szarość tam, gdzie sprawa stoi.

**Rejestr** ma dwa segmenty („Moje" / „Cała grupa") i jedną regułę wstępu: wchodzi
wyłącznie to, **co ruszyło pieniądze albo jest dowodem w sporze**. Test brzmi *czy po
tym zdarzeniu ktoś jest komuś winien inną kwotę*. Przypomnienia, stuknięcia pozycji
i zmiany nazw go nie przechodzą — bez tej reguły rejestr po tygodniu wyjazdu przestaje
być dowodem i staje się szumem.

Każdy wiersz niesie **dwie daty** (zgłoszenia i rozstrzygnięcia). Oba pola były w bazie
od zawsze, tylko nigdy ich nie było widać — a różnica między nimi odpowiada na pytanie,
które pada przy każdym większym wyjeździe.

### 23.9 Dwa błędy starsze od tego etapu, znalezione po drodze

- **Wejście wprost z odnośnika w rachunek nie włączało nasłuchów pokoju.**
  `renderGroupDashboard` woła się tylko z `navigateToGroup`, więc kto kliknął
  powiadomienie push, dostawał rachunek z pustą listą wpłat i nic tego nie prostowało.
  Chip „Oddał/a" pokazywał wtedy „Zostaje…" nawet komuś, kto oddał wszystko.
- **Pasek „Cofnij" brał tło z tokenu TEKSTU** (`bg-ink`), a ten w motywie ciemnym —
  domyślnym w tej aplikacji — jest prawie bielą. Pasek odwracał się na jasny. Ta sama
  pułapka, którą kod opisuje już przy znaku firmowym.

### 23.10 Stan testów po etapie

**381 testów jednostkowych** (14 nowych w `src/calc.dispute.test.js`), **41 testów reguł**
(7 nowych na rozdział ról i stan niemożliwy). Wszystko zielone.

**Reguły i funkcje NIE są wdrożone** — to osobna decyzja i osobne wdrożenie. Bez wdrożenia
reguł przycisk „Nie widzę" nie zadziała, a bez wdrożenia funkcji spór nie wyśle pusha.

---

## 24. DWADZIEŚCIA ZGŁOSZEŃ Z TELEFONU (2026-08-29, wieczór)

Etap 5 poszedł na telefon właściciela i wrócił z listą dwudziestu punktów. Nie jest to
lista życzeń — to protokół z użycia: co jest zepsute, co brzydkie, czego nie da się
zrobić. Rozdział opisuje, co z każdym z nich zrobiliśmy i dlaczego akurat tak.

### 24.1 Regresja, od której trzeba było zacząć

**Karty stosu straciły odstęp wewnętrzny.** `stackHtml` składa wierzch stosu z klasy
`card` — a `.card` niesie wyłącznie tło, promień i cień, ŻADNEGO odstępu; dawały go
zawsze klasy Tailwinda w znacznikach. Tu ich nie było, więc kwota dotykała krawędzi
karty, przyciski rozlewały się na całą szerokość kolumny i cały ekran wyglądał
na rozwalony („zepsułeś formatowanie całkowicie, wywaliły się krawędzie i kafelki").

Odstęp należy teraz do klasy `.stack-top`, nie do znaczników — bo `.stack-top` jest
jedynym miejscem, w którym ta karta powstaje.

**Przy okazji: zasłona pod paskiem stanu.** `viewport-fit=cover` razem
z `apple-mobile-web-app-status-bar-style: black-translucent` wpuszcza treść pod zegarek
iPhone'a. Odstęp w `#app-container` trzyma ją niżej na SAMEJ GÓRZE ekranu, ale
po przewinięciu nazwy rachunków i kwoty przejeżdżały przez zegarek i wskaźnik baterii.
`#status-scrim` maluje tam tło aplikacji (warstwa 45: nad treścią i nawigacją, pod
paskami systemowymi i oknami), więc treść wjeżdża pod niego i znika, zamiast się z nim
zderzać. W przeglądarce z paskiem adresu wcięcie wynosi zero i zasłony po prostu nie ma.

### 24.2 Gest między stronami idzie za palcem

Do tej pory gest był „machnięciem": aplikacja mierzyła odległość dopiero po oderwaniu
palca i podmieniała stronę skokiem. Nie było więc widać ANI ŻE gest istnieje, ANI że
właśnie działa — a machnięcie, które nie odpowiada w trakcie, czyta się jak przypadek,
nie jak sterowanie.

**Obie strony leżą teraz na jednej taśmie** (`.settle-track`) i przesuwają się razem.
`--settle-p` to postęp od 0 (Płacisz) do 1 (Dostajesz) — JEDNA liczba, z której bierze
się i przesunięcie taśmy, i położenie pigułki w przełączniku. Dzięki temu w trakcie gestu
oba elementy jadą za palcem i widać, że to jedno urządzenie, a nie dwa niezależne.

Szczegóły, które wyszły dopiero na sondzie w przeglądarce:

- **Przerwa 2 rem między stronami.** `overflow: hidden` przycina przy brzegu ODSTĘPU
  (1 rem poza treścią, robionego pod cienie kart), więc strona odsunięta dokładnie
  o własną szerokość kończy się centymetr za wcześnie i widać jej róg. Przerwa odsuwa
  ją o oba brzegi naraz.
- **Na czas gestu okno ma wysokość DŁUŻSZEJ ze stron.** Bez tego strona wjeżdżająca
  zza krawędzi była przycinana do wysokości tej, z której się wychodzi — przy jednej
  sprawie po lewej i sześciu po prawej wyglądało to jak wjeżdżanie treści do szpary.
- **Próg jest podwójny:** ćwierć szerokości ekranu ALBO szybki rzut (ponad 0,4 px/ms)
  na co najmniej 40 px. Sam próg odległości kazałby przeciągać stronę do połowy ekranu
  przy każdym przełączeniu.
- **Oś ustala się raz**, na pierwszych ośmiu pikselach ruchu, i nie zmienia do końca
  gestu. Bez tego gest ukośny raz przewijałby listę, raz przesuwał stronę.
- `touch-action: pan-y` stoi na `.settle-track`, NIE na korzeniu dokumentu — tam
  zabrałby iOS gest cofania (patrz komentarz przy `html` w tailwind.css).

**Przełącznik jest na całą szerokość** i zaznaczenie rysuje osobna pigułka (`.seg-thumb`),
nie tło przycisku: tylko wtedy da się je przesuwać płynnie razem z taśmą.

**Kropki pod listą zniknęły.** Stały na SAMYM DOLE strony, czyli za wszystkim, co na niej
jest — przy trzech stosach trzeba było przewinąć pół ekranu, żeby je zobaczyć. Wskaźnik
„są dwie strony" ma sens wyłącznie wtedy, gdy widać go razem ze stroną. Rolę przejmuje
przełącznik plus **strzałka przy nieaktywnym segmencie** — jedyny STAŁY znak, że gest
w bok ma sens (ruch pigułki działa dopiero wtedy, gdy ktoś już spróbował).

**Strona pusta jest osiągalna.** Reguła „nie ląduj na pustej stronie" robiła wcześniej
dwie rzeczy naraz i odbijała także wtedy, gdy człowiek SAM przesunął palcem — więc gest
wyglądał na zepsuty. Podpowiedź działa teraz tylko przy pierwszym wejściu
(`settleSideChosen`), a pusta strona mówi, że jest pusta (`.settle-empty`), zamiast
pokazywać pusty prostokąt, który czyta się jak niedowczytana treść.

### 24.3 Cofanie z rachunku — własny gest zamiast cudzego

„Czasem na iOS przesunięcie z rachunku nie wraca do listy — czasem działa, czasem nie."

Aplikacja liczyła na gest SYSTEMOWY. On jednak nie jest obietnicą: w aplikacji
uruchomionej z ikony (a tak jej używa ekipa właściciela) iOS raz go daje, raz nie,
a kiedy treść przewija się w kontenerze `#app-scroll` i akurat wybrzmiewa rozpęd
przewijania, gest przepada bez śladu.

`setupEdgeBack` robi ten sam gest u nas: start w pasie 28 px od lewej krawędzi, próg
72 px, oś ustalana raz. **Gdy przeglądarka przejmie gest u siebie, strona dostaje
`touchcancel` — i wtedy nasz milknie.** Dzięki temu cofnięcie nie wykona się dwa razy,
a wykona się zawsze. Strzałka w nagłówku i gest wołają tę samą funkcję
(`leaveBillScreen`), bo ta sama czynność nie ma prawa zachowywać się różnie zależnie
od tego, czym się ją wykonało.

Pas jest wąski świadomie: szerszy kradłby stukanie w lewą kolumnę ekranu rachunku,
gdzie stoją znaki uczestników przy pozycjach paragonu.

### 24.4 Stos: wygląd, ruch i osiągalne szczegóły

**Krawędzie to teraz PEŁNE KARTY, nie doklejone paski.** Poprzednia wersja rysowała pod
kartą dwa prostokąty z twardą kreską dookoła. Kreska na dole karty czytała się jak obrys
tabelki, a nie jak przedmiot leżący niżej — bo w tym systemie NIC nie ma obrysu;
głębokość niosą wyłącznie cień i szerokość. Teraz to pełne prostokąty w kolorze karty,
zwężane `scaleX` i przesuwane w dół, każdy głębszy bledszy. `scaleX` zamiast odstępów
z dwóch powodów: zwężenie jest proporcjonalne do szerokości ekranu i da się je animować
bez przeliczania układu.

**Zwijanie i rozwijanie jest ruchem, nie podmianą.** Obie gęstości powstają z `innerHTML`,
więc przejścia nie da się zrobić samym CSS: stary układ znika, zanim nowy istnieje.
`noteStackHeight` mierzy wysokość PRZED przerysowaniem, `applyStackMorph` dojeżdża
do nowej po nim. To jedyne dwie liczby, jakich potrzeba, a ruch jest zwykłą zmianą
wysokości i przezroczystości — tanią i taką samą wszędzie. Strażnik na `setTimeout`
domyka animację, gdyby `transitionend` nie doszedł (przerysowanie z bazy w trakcie ruchu);
bez niego stos zostałby na stałe przycięty do starej wysokości.

**Wiersz rozwiniętej listy da się rozwinąć osobno.** To była realna dziura: po rozwinięciu
stosu nie dało się sprawdzić, jakie rachunki pokrywa dany przelew. Odwrotna gęstość
(§23.3) mówi, że rozwinięty wiersz jest UBOŻSZY — ale „uboższy" nie może znaczyć
„niedostępny". Strzałka przy wierszu otwiera blok `.stack-detail` z pełnymi danymi.
Stan siedzi wyłącznie w DOM: po przerysowaniu z bazy szczegóły wracają do zwiniętych
i to jest w porządku, bo to podgląd, a nie ustawienie.

**Przyciski w wierszu urosły z 32 px do 44 px.** Rozwinięty stos to jedyne miejsce, gdzie
„Mam" i „Nie widzę" nie mają przy sobie napisu — czyli jedyne, gdzie cała odpowiedź
na cudzy przelew mieści się w kółku. 44 px to próg, którego pilnuje `tools/audit-layout.mjs`.

Wiersz musiał się przez to przebudować: **imię i kwota dzielą pierwszą linię, podpis stoi
pod nimi**. Wcześniej kwota była osobną kolumną i to ona, nie przyciski, zjadała
szerokość — „2015,23 PLN" zabierało jedną trzecią wiersza, więc „dziś · 2 rachunki"
łamało się na trzy linijki. Teraz podpis dostaje całą szerokość kolumny i nie łamie się
nigdy (nadmiar wielokropkiem).

**Pusty blok stanu nie powstaje w ogóle.** Stała wysokość trzech wierszy (§23.3) ma sens
tam, gdzie karty stosu RÓŻNIĄ się liczbą wierszy. W planie „Najmniej przelewów" przelew
nie należy do żadnego rachunku, więc bez wyjątku każda karta osoby ma zero wierszy —
i rezerwowanie na nie trzech pustych linijek dawało kartę z pionową kreską i pasem
pustki pod imieniem. Wysokość kart w takim stosie zostaje równa, bo puste są wszystkie.

**Ikona zamiast napisu „Zwiń"/„Rozwiń"** w nagłówku stosu; słowo zostaje w `aria-label`.

**Ikona „Ureguluj" w wierszu** przestała być zwykłą strzałką w prawo — tą samą, którą
w całej aplikacji znaczy „przejdź dalej". Na przycisku, który otwiera regulowanie długu,
czytała się jako nawigacja, a nie jako zapłata. `fa-money-bill-transfer` nie zostawia
wątpliwości.

### 24.5 Rejestr: szukanie, filtry, ikona

Rejestr jest DOWODEM, a dowodu szuka się pod konkretne pytanie: „czy oddałem Pawłowi
za tę kolację", „co wisi niepotwierdzone". Po tygodniu wyjazdu przewinięcie czterdziestu
wpisów do tego nie wystarcza.

- **Pole szuka** po imionach obu stron, nazwach rachunków i kwocie — po wszystkim,
  co człowiek pamięta. Nikt nie pamięta identyfikatora wpisu.
- **Cztery pigułki stanu** (Wszystkie / Czekają / Potwierdzone / Do wyjaśnienia) z liczbami.
  Liczby liczą się PO szukaniu: pigułka ma mówić, ile dostaniesz po jej stuknięciu.
- **Zmiany kwot** schodzą z listy pod filtrem stanu — nie mają stanu wpłaty, więc nie
  mają czego pokazać w żadnym kubełku.
- **Pusty rejestr to co innego niż pusty wynik szukania** i mówimy o tym osobno: pierwsze
  znaczy „nic się jeszcze nie wydarzyło", drugie „szukaj inaczej".
- Każde otwarcie zaczyna od pełnej listy. Szukanie jest pytaniem na teraz, a nie
  ustawieniem — wczorajsze słowo ukrywałoby dziś połowę dowodów.
- **Ikona wejścia** to zegar ze strzałką, nie trzy kreski z kropkami: te ostatnie czyta
  się w każdej aplikacji jako sortowanie, czyli jako coś, co ZMIENIA to, na co patrzę.
  Rejestr niczego nie zmienia — pokazuje, co się już wydarzyło.

### 24.6 Co zniknęło z Rozliczeń

**Akapit wstępny** („Każdy przelew idzie do osoby, która wyłożyła pieniądze…") zszedł
pod znak zapytania w nagłówku pokoju. To odpowiedź na pytanie zadawane RAZ, postawiona
na górze ekranu, po który przychodzi się codziennie. Pomoc zna teraz zakładkę, nie tylko
ekran (`HELP_CONTENT['group-dashboard:view-settle']`), więc „?" na Rozliczeniach otwiera
rozliczenia, a nie ogólny opis pokoju — i wolno tam napisać WIĘCEJ, niż mieściło się
w akapicie.

Zostaje jedno zdanie, i to wyłącznie w planie minimalnym i wyłącznie wtedy, gdy realnie
zachodzi sprzeczność: „jesteś winien dwóm osobom" na Bilansie obok pustej strony
„Płacisz" tutaj. To nie jest wykład o trybie, tylko fakt o TWOICH liczbach.

**„Jeszcze N zwrotów w grupie"** — spis długów MIĘDZY INNYMI LUDŹMI — zniknął bez
zamiennika. Nie dawało się z nim zrobić nic: nie mój przelew, nie moje przypomnienie,
nie moje potwierdzenie. Zajmował ostatni wiersz ekranu, na którym wszystko inne jest
czynnością do wykonania, a przy piętnastu osobach rozwijał się w listę dłuższą niż moje
własne rozliczenia.

**Do rejestru NIE trafił** i to nie jest przeoczenie: rejestr przyjmuje wyłącznie to,
co RUSZYŁO pieniądze („czy po tym zdarzeniu ktoś jest komuś winien inną kwotę"),
a cudzy niezapłacony dług niczym jeszcze nie ruszył. Kto ile wydał w pokoju, widać
w ustawieniach pokoju.

### 24.7 Dymek jest odwrotnością tła — w OBU motywach

Dzień wcześniej pasek „Cofnij" dostał barwy przypięte na stałe do ciemnych (§23.9)
i to był błąd w drugą stronę: w motywie ciemnym, czyli DOMYŚLNYM, ciemny prostokąt
na ciemnym tle znika. Komunikat, który ma przerwać to, co się właśnie robi, musi odcinać
się od wszystkiego, na czym może stanąć.

Reguła jest więc jedna i wspólna dla obu dymków: **tło z `--ink`, tekst z `--surface`**.
W motywie jasnym wychodzi czarny dymek, w ciemnym — biały. Do tego cienka obwódka
w kolorze powierzchni i mocniejszy cień (na `.toast-dock`, nie klasą narzędziową:
`shadow-lift` z warstwy `utilities` wygrywałby z regułą komponentu). Czerwień „Cofnij"
idzie odwrotnie do motywu, bo tło dymka też jest odwrotnością tła aplikacji.

### 24.8 Lista rachunków: jedna siatka, jeden znaczek, liczby przy filtrach

**Imię płatnika zniknęło ze statusów.** „Płaci Mikołaj" stało obok znaku Mikołaja — czyli
było DRUGIM nośnikiem tej samej informacji, a przy „Bartłomiej" zjadało pół kolumny
i to nazwa rachunku, czyli tożsamość wiersza, musiała się skracać. Statusy mówią teraz
o STANIE („Do oddania", „Czeka na płatnika", „Czeka na kwotę"), a kto — mówi twarz.

**Jeden znaczek stanu na wiersz.** W trybie rachunkowym wiersz niósł dwa naraz („Płaci
Ala" + „Nieopłacone"). Po zdjęciu imion zostałoby „Do oddania" obok „Nieopłacone", czyli
dwa napisy o tym samym. Kolejność pierwszeństwa, od najpilniejszego:

1. cudzy przelew czeka na moje sprawdzenie (mój ruch, cudze pieniądze),
2. sprawa sporna wokół tego rachunku,
3. stan rozliczenia w trybie rachunkowym (nieopłacone / czeka na zwrot / domknięte),
4. status ogólny rachunku (uzupełnianie, kwota, płatnik).

Pierwszy z nich dostaje też błękit stanu na kafelku, także przy domkniętym statusie —
to jedyne miejsce na tej liście, gdzie CUDZE pieniądze czekają na moje jedno stuknięcie.

**Siatka wiersza jest niezmienna:**

```
[ znak ]  nazwa rachunku (jeden wiersz, nadmiar wielokropkiem)
          [znaczek stanu] · godzina                        kwota
```

Nazwa łamała się wcześniej na dowolną liczbę wierszy „żeby jej nie ucinać" — ale
konkurowała o szerokość z kwotą po prawej, więc i tak się łamała, tylko na dwa albo trzy
wiersze. Teraz ma CAŁĄ szerokość kolumny (znaczek zszedł piętro niżej), więc ucięcie
zdarza się rzadziej niż zawijanie kiedyś, a kafelek ma jedną wysokość niezależnie
od treści.

**Liczba przy KAŻDEJ pigułce filtra.** Wcześniej miały ją dwie, bo warunek przynależności
był pisany osobno dla listy i osobno dla licznika — i nikomu nie chciało się powtarzać
go po raz trzeci. `pasujeDoFiltru` jest teraz jedną regułą dla obu, więc żaden licznik
nie może się rozjechać z tym, co filtr realnie pokaże.

**Filtr „Do potwierdzenia"** pojawia się WYŁĄCZNIE wtedy, gdy ma co pokazać. Pigułka,
która przez większość życia pokoju stoi pusta, uczy omijać wzrokiem cały pasek — a ta
niesie jedyną rzecz na tym ekranie, przy której czekają cudze pieniądze.

> **Rozszerzone 2026-08-30 (§24.12).** Ta reguła obowiązuje dziś WSZYSTKIE pigułki,
> nie tylko tę jedną.

### 24.9 Stos „Czekasz na przelew" wraca na rachunek

§23.6 mówił: **brak** tego stosu na ekranie rachunku, bo przypomnienie idzie DO OSOBY,
na całą jej zaległość, a nie do rachunku. **Ta decyzja zostaje cofnięta** i powód jest
mocniejszy od poprzedniego: część ekipy właściciela rozlicza się rachunek po rachunku
i do zakładki Rozliczenia praktycznie nie zagląda. Wszystko, co da się zrobić
w Rozliczeniach, musi więc być osiągalne z rachunku.

Brakowało dokładnie jednej rzeczy. Dłużnik miał limonkową kartę „Twój udział"
z przyciskiem „Ureguluj", a płatnik widział wyłącznie zwinięty spis „Ekipa: 14 osób ·
oddało 2 z 14" — czyli wiedział, kto nie oddał, i nie mógł z tym zrobić nic bez wyjścia
na inną zakładkę.

Dawny zarzut („trzy rachunki, trzy przypomnienia do tej samej osoby") rozbija się
o bramkę czasową w `sendNudge`, która działa PER OSOBA: druga i trzecia wysyłka pod rząd
po prostu nie wychodzi. Kwota w przypomnieniu dotyczy tego rachunku i jest prawdziwa —
mniejsza od całości, ale nie fałszywa.

**Wyłącznie w trybie rachunkowym.** W planie „Najmniej przelewów" pieniądze idą trasami,
których ten rachunek nie stworzył, więc „czekasz na przelew ZA TEN rachunek" byłoby
zdaniem nie do obronienia, a „Oddał/a mi już" zapisałoby wpłatę, która niczego tam nie
gasi. Wpłata zapisana z tego miejsca niesie `billId` tego rachunku — inaczej gotówka
wzięta przy stole zgasiłaby dług „gdzieś", a rachunek dalej stałby jako nieopłacony.

### 24.10 Karta rachunku i Bilans

- **Opis obu sposobów podziału zszedł pod „?"** obok nagłówka „Jak dzielimy". Pod
  przełącznikiem stały dwa–trzy wiersze tłumaczące WYBRANY tryb — na karcie, którą
  przewija się przy każdym wejściu, a przeczytać trzeba raz w życiu. Znak zapytania
  tłumaczy teraz OBA sposoby naraz, czyli więcej niż tamten opis. Pod przełącznikiem
  zostaje wyłącznie POWÓD, dla którego akurat teraz nie da się go przestawić — a to nie
  jest wykład, tylko fakt o tym jednym rachunku.
- **„Kto wyłożył pieniądze" pokazuje twarz.** Było jedynym miejscem w aplikacji, gdzie
  zostawało samo imię, więc czytało się inaczej niż wszędzie indziej.
- **W trybie „po równo" milknie linijka „Nierozpisane X, czyli po Y na osobę".** Opisuje
  dokładnie to, co mówi nazwa trybu dwa centymetry niżej, i robi to słowem
  „nierozpisane", które brzmi jak zaległość do załatwienia. Zdanie zostaje tam, gdzie
  niesie wiadomość: w trybie ze swoimi kosztami.
- **Bilans dostał jedno przypomnienie do wszystkich**, którzy nie stuknęli swoich pozycji
  na MOICH rachunkach (czyli tych, na których to ja wyłożyłem pieniądze — to jedyna
  definicja, która daje prawo poganiać). Jedna osoba dostaje jedno przypomnienie, nawet
  gdy zalega na czterech rachunkach; przy jednym rachunku niesie odnośnik prosto do niego,
  przy kilku nie ma odnośnika, bo nie da się wskazać jednego miejsca, które załatwia
  sprawę. Adresat może więc nieść WŁASNY rachunek (`lista[].billId`) — przypomnienie
  z karty rachunku dotyczy jednego, zbiorcze z Bilansu obejmuje kilka naraz.

### 24.11 Ekran wyboru imienia miał wyjście donikąd

Był jedynym ekranem w aplikacji BEZ drogi powrotnej: kto wszedł w cudzy pokój z listy albo
z linku i zorientował się, że to nie ten, zostawał tam na dobre — jedyną drogą było
wyczyszczenie adresu, czyli rzecz niedostępna w aplikacji uruchomionej z ikony.
Strzałka woła `goToRoomsList`, czyli dokładnie to, co strzałka w pokoju.

### 24.12 Pasek filtrów: znikanie, kolor, nazwy (2026-08-30)

Filtr „Do potwierdzenia" pojawiał się tylko wtedy, gdy miał co pokazać (§24.8) — i to
było pytanie właściciela: *„może inne filtry też powinny tak działać?"*. Powinny, bo
uzasadnienie nie miało w sobie nic szczególnego dla tego jednego filtra.

**PIGUŁKA ZNIKA, GDY NIE MA CO POKAZAĆ.** Pasek filtrów jest obietnicą: „stuknij, a coś
zobaczysz". Pigułka, która daje pustą listę, tę obietnicę łamie — i nie robi tego lokalnie:
uczy omijać wzrokiem CAŁY rząd, razem z tymi, które akurat coś niosą. Skoro liczbę przy
każdej pigułce i tak liczymy (§24.8), to zero jest gotową odpowiedzią na pytanie, czy
pigułka ma prawo tam stać.

Dwa wyjątki:

- **„Wszystkie"** zostaje zawsze. To punkt wyjścia i droga powrotna z każdego innego
  filtra; pasek bez niego byłby ślepą uliczką.
- **Pigułka WŁAŚNIE WYBRANA zostaje, nawet pusta.** Inaczej znikałaby spod palca dokładnie
  w chwili, gdy domykasz ostatnią sprawę z tej listy — a zamiast domknięcia („Żaden przelew
  nie czeka na Twoje potwierdzenie") dostawałbyś skok na inną listę. Pusty stan i tak niesie
  przycisk „Pokaż wszystkie", więc wyjście jest jedno stuknięcie dalej.

**Cały pasek schodzi z ekranu, gdy zostaje na nim mniej niż dwie pigułki.** Rząd wysokości
celu dotykowego zajęty przez samo słowo „Wszystkie" nie jest paskiem filtrów. Dotyczy
to świeżego pokoju i pokoju, w którym wszystko jest domknięte — czyli dwóch stanów,
w których człowiek i tak nie przyszedł tu filtrować.

**KOLOR PIGUŁKI TO KOLOR STANU, KTÓRY WYBIERA.** Czerwone „Do oddania" nad czerwonym
„Nieopłacone" na kafelku, błękitne „Czekają na Ciebie" nad błękitnym kafelkiem z moim
ruchem, zielone „Wyłożyłeś/aś" nad zielonym „Wyłożyłeś/aś". Filtr i to, co wybiera, mają
wyglądać na tę samą rzecz — inaczej trzeba się nauczyć, że są powiązane.

Kolor dostają WYŁĄCZNIE filtry wybierające stan pieniędzy. „Wszystkie", „Nie dotyczą Cię"
i „Ukryte" zostają szare: kolor w tej aplikacji coś znaczy i rozdanie go wszystkim
odebrałoby mu to znaczenie. Nieprzyciśnięta pigułka niesie barwę w napisie i w liczniku,
przyciśnięta wypełnia się nią w całości.

**Barwa tekstu na wypełnieniu liczona jest per motyw**, nie zapisana jako biel. W motywie
ciemnym `--owe`, `--due` i `--info` są ROZJAŚNIONE (bo na ciemnym tle ciemna czerwień się
zapada), więc biały napis na nich jest nieczytelny — obowiązuje ta sama zasada, co przy
limonce: jasne wypełnienie zawsze nosi ciemny tekst. Licznik na wypełnionej pigułce
potrzebuje osobnych, bardziej szczegółowych reguł niż wersja szara: bez nich
`.filter-pill.is-owe .filter-pill-count` (trzy klasy) wygrywa z regułą stanu wciśnięcia
(dwie klasy i atrybut) i na czerwonym wypełnieniu zostaje czerwony licznik.

**Dwie nazwy przestały kłamać:**

- **„Moje" → „Wyłożyłeś/aś".** W domyślnym widoku KAŻDY rachunek jest „mój", bo lista
  pokazuje wyłącznie te, które mnie dotyczą — więc słowo nie rozróżniało niczego. Nowy
  napis to dokładnie to samo słowo, które nosi kafelek takiego rachunku, i ten sam zielony
  kolor.
- **„Reszta grupy" → „Nie dotyczą Cię".** Właściciel napisał wprost: *„nie wiem, czym jest
  «reszta grupy»"*. Filtr pokazuje rachunki, na których nie ma Cię wśród uczestników,
  i **zostaje**, bo robi jedną rzecz, której nie robi nic innego w aplikacji: pozwala
  sprawdzić, czy ktoś Cię przypadkiem nie pominął przy dodawaniu składu. To jedyny powód,
  dla którego wolno tu zaglądać w cudze pieniądze — i dlatego napis jest tym samym zdaniem,
  co status na takim kafelku („Nie dotyczy Cię"). Przy zgranej ekipie pigułka i tak znika,
  bo lista jest pusta.

Sprawdzone w przeglądarce: pusty pokój — paska nie ma; jeden rachunek bez płatnika — paska
nie ma (tylko „Wszystkie" miałoby co pokazać); po ukryciu rachunku pojawia się „Ukryte";
wejście w „Ukryte" i przywrócenie rachunku ZOSTAWIA pigułkę z pustym licznikiem i zdaniem
„Nie masz ukrytych rachunków".

### 24.13 Stan testów po etapie

**381 testów jednostkowych, wszystko zielone.** Dwa nowe wpisy w `RUNTIME_CREATED_IDS`
(`settle-panes`, `remind-fill-all-btn`). Przebieg `tools/audit-layout.mjs` przy 390 px
i 360 px: zero wyjazdów poza ekran, zero nachodzeń, zero przewijania w poziomie —
zostają dwa znane i świadome wyjątki celu dotykowego (ołówek przy nazwie rachunku
i cichy odnośnik „Oddał/a mi już").
