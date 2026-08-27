---
name: Billiada
description: Rozliczenia grupowe — jeden rachunek, który rośnie, dzielony przez całą ekipę naraz.
colors:
  bg: "#F5F6F8"
  surface: "#FFFFFF"
  surface-2: "#EEF0F4"
  ink: "#0E0F13"
  ink-2: "#585C68"
  ink-3: "#7A808D"
  brand: "#C6F03A"
  brand-ink: "#0E0F13"
  owe: "#E21E38"
  due: "#008A5C"
  info: "#2D4AEB"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Archivo Variable, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Bricolage Grotesque Variable, Archivo Variable, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Bricolage Grotesque Variable, Archivo Variable, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.3
  action:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.2
  control:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.2
  caption:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  micro:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.2
  icon:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1
rounded:
  inner: "14px"
  block: "20px"
  card: "24px"
  sheet: "28px"
  pill: "9999px"
spacing:
  tap: "48px"
  tight: "8px"
  field: "16px"
  panel: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "{spacing.tap}"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "{spacing.tap}"
  button-quiet:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "{spacing.tap}"
  button-danger:
    backgroundColor: "{colors.owe}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    height: "{spacing.tap}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.panel}"
  block-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
    padding: "12px 16px"
    height: "{spacing.tap}"
  seg-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "44px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

# Design System: Billiada

> Stan na 2026-08-15. Świat przypięty referencjami właściciela z `Referencje/`.
> Poprzedni kierunek („druk zabezpieczony": banknot, gilosz, mikrodruk, Bodoni) został
> odrzucony w całości i jest **anty-referencją** — nic z niego nie wraca.
>
> Nazwa produktu **Billiada** rozstrzygnięta 2026-08-15 (wcześniej przez chwilę
> „Billyada"). Znak: **koń trojański** w limonce na atramencie, rysunek właściciela.
> Źródło `logo/billiada-logo.png` (600 px), skalowanie `node tools/make-icons.mjs`.
> Nazwa łączy rachunek z Iliadą, więc znak idzie za NAZWĄ, a nie za mechaniką produktu.

## Overview

**Creative North Star: „Stół, przy którym wszyscy sięgają naraz"**

Rachunek dzieli cała ekipa równocześnie i to musi być widać. Interfejs jest jasny,
prosty i szybki: białe podłoże, duże miękkie karty, nasycony kolor niosący **całe bloki**
zamiast akcentów rozsypanych po szarości. Ludzie są obecni wszędzie tam, gdzie stoi
kwota — okrągłym zdjęciem albo kolorowym kołem z literą.

Poziom rzemiosła wyznaczają referencje: nowoczesne aplikacje mobilne do pieniędzy.
Odrzucone: ornament, przygaszone barwniki, wersaliki z rozstrzeleniem, powtarzane
paski tekstu, wszystko, co wygląda na dokument urzędowy.

**Key Characteristics:**

- Białe karty na chłodnym podłożu, promienie 20–24 px, cień miękki i szeroki
- Limonka niesie całe bloki i **zawsze pod czarnym tekstem**
- Kwota jest bohaterem: Bricolage Grotesque, waga 800, cyfry tabelaryczne
- Kolor ma **jedno znaczenie na raz** — patrz Reguła rozdziału kolorów
- Cel dotykowy 48 px w akcjach, nigdy poniżej 44 px
- Ruch tylko w trzech rolach: wejście, cudze działanie, potwierdzenie

## Colors

### Primary

- **Limonka marki** (`{colors.brand}`): bloki akcji, karta bilansu, koło „nowy rachunek",
  zaznaczenie „to jest moje". Zawsze pod czarnym tekstem — nigdy jako kolor tekstu na jasnym tle.
- **Atrament** (`{colors.ink}`): tekst zasadniczy, przycisk drugiego wyboru, pasek nawigacji.

### Secondary — role pieniężne

- **Czerwień długu** (`{colors.owe}`): „winien jesteś" oraz operacja nieodwracalna.
- **Zieleń należności** (`{colors.due}`): „dostajesz", „rozliczone", suma zgodna co do grosza.
- **Błękit stanu** (`{colors.info}`): coś czeka na **twój** ruch. Jedyny ton barwiący całe tło karty.

### Tertiary — tożsamość ludzi

Kolor przypisuje się z identyfikatora uczestnika (paleta szesnastu barw w `src/identity.js`),
a człowiek może go **zmienić dwoma suwakami**: odcieniem i intensywnością. Zdjęcie ma
pierwszeństwo przed kolorem; kolor przed literą.

**Reguła litery, która dobiera się sama.** Litera na znaku bierze jedną z DWÓCH barw
systemu — atrament albo biel — tę, która daje wyższy kontrast z tłem znaku (`readableInk`).
Do 2026-08-15 była zawsze biała i to jedno założenie trzymało całą paletę w wąskim pasmie
ciemnych barw: żółty, jasny cyjan i róż wypadały przez kontrast, nie przez estetykę.
Zdjęcie tego ograniczenia otworzyło całe koło barw w każdej jasności.

**Reguła progu na każdym punkcie suwaka.** Żaden punkt obu suwaków nie może dać koloru,
na którym litera schodzi poniżej 4,5:1. Pośrodku zakresu jasności jest wąskie pasmo,
w którym ani biel, ani atrament nie łapią progu, a jego położenie zależy od odcienia —
`colorFromControls` odsuwa wtedy jasność do bliższego brzegu tego pasma. Pilnują tego
testy przechodzące przez wszystkie odcienie i intensywności.

**Reguła zarezerwowanych sąsiedztw.** Kolor człowieka nie może udawać limonki marki ani
żadnej z trzech barw pieniężnych. Nie wycinamy całych pasm odcienia (to zabrałoby cały
żółty i cały zielony): blokujemy dopiero punkty podobne na **wszystkich trzech** wymiarach
naraz — odcień, nasycenie i jasność. Ciemna oliwka przechodzi, jasna limonka nie.
Suwak omija te strefy sam i mówi, że to zrobił.

**Reguła realnej różnicy.** Dwa kolory tożsamości bliższe niż dwadzieścia stopni odcienia
przy niemal równej jasności to dla oka jeden kolor. Paleta domyślna nie ma ani jednej
takiej pary — wcześniejsza miała piętnaście przy szesnastu pozycjach, czyli była pięcioma
rodzinami udającymi szesnaście barw. Pilnuje tego test.

### Neutral

`{colors.bg}` podłoże · `{colors.surface}` karta · `{colors.surface-2}` blok cichy i pole
wprowadzania · `{colors.ink-2}` tekst pomocniczy · `{colors.ink-3}` podpisy.

### Named Rules

**Reguła rozdziału kolorów.** Trzy zbiory nigdy się nie przecinają: kolor marki (limonka),
kolory ról pieniężnych (czerwień/zieleń/błękit) i kolory tożsamości ludzi. Limonka znaczy
„naciśnij to" albo „to jest twoje" — nigdy „zapłacone". Test: gdyby uczestnik dostał zieleń
należności jako kolor awatara, interfejs kłamałby kolorem przy każdej jego pozycji.

**Reguła jednego tła.** Tło całej karty barwi wyłącznie stan `action` (błękit, coś czeka na
ciebie). Reszta listy zostaje biała, więc oko trafia w jedno miejsce bez szukania.
Kolorowanie kart tożsamością płatnika zostało odrzucone: lista zamieniała się w tęczę,
w której nic nie znaczyło nic.

**Reguła limonki pod lampą.** W motywie ciemnym limonka na wypełnieniu schodzi do 10 %,
bo jasna barwa zmieszana z ciemnym tłem daje brudną oliwkę. Rolę przejmuje limonkowa
kwota i obwódka przy twarzy — światło, nie plama.

## Typography

**Display:** Bricolage Grotesque Variable — kwoty i nagłówki.
**Body:** Archivo Variable — reszta interfejsu, cyfry tabelaryczne.

Oba kroje siedzą w buildzie (`@fontsource-variable`), nie w sieci: aplikacja pracuje
offline i przy słabym zasięgu w lokalu.

**Ta sama zasada obowiązuje ikony i każdą inną bibliotekę front-endu.** Font Awesome
(rodzina `solid`) wchodzi przez `src/tailwind.css` z paczki npm, kod QR rysuje się
lokalnie, konwersja HEIC dogrywa się dynamicznie z buildu. W `index.html` **nie ma prawa
pojawić się `<script src="https://…">` ani `<link href="https://…">`** — przy zablokowanym
CDN znikała cała ikonografia, a to jest scena użycia tej aplikacji: obce wifi, słaby
zasięg, wieczór w lokalu.

### Hierarchy

- **Display** (800, 3–4,5 rem): nominał bilansu, kwota rachunku.
- **Headline** (800, 1,875 rem): nazwa pokoju, nazwa rachunku, tytuł ekranu.
- **Title** (800, 1,25 rem): nagłówek sekcji.
- **Body** (400, 1 rem): treść. **Nigdy poniżej 1 rem w polu wprowadzania** — iOS zoomuje.
- **Label** (700, 0,875 rem): podpis pola, nazwa kolumny.
- **Action** (700, 0,9375 rem): napis na przycisku.
- **Control** (600, 0,8125 rem): segment przełącznika, podpis w pasku nawigacji.
- **Caption** (600, 0,75 rem): podpis pod okrągłą akcją.
- **Micro** (700, 0,6875 rem): licznik przypomnień, najmniejszy dopuszczalny stopień
  — **wyłącznie dla liczb i pojedynczych słów**, nigdy dla zdania.

Poniżej 0,6875 rem nie schodzimy. Skala ma osiem stopni i tyle wystarcza; nowy stopień
wymaga dopisania go tutaj, inaczej detektor systemu zgłosi rozjazd.

### Named Rules

**Reguła cichych groszy.** Grosze mają 0,55 em i krycie 0,45. Złotówki czyta się
z odległości wyciągniętej ręki, grosze dopiero z bliska.

**Reguła zakazu wersalików.** Żadnych wersalików z rozstrzeleniem jako etykiet. To był
język odrzuconego świata; podpis pola jest zwykłym tekstem o grubej wadze.

## Layout

Jedna kolumna, `max-width: 56rem`, margines 16 px na telefonie. Rytm pionowy: 24 px między
sekcjami, 20 px w karcie, 8 px między wierszami listy. Dół dokumentu ma 112 px zapasu pod
pływające elementy plus `env(safe-area-inset-bottom)`.

**Reguła strefy bezpiecznej.** Odległości od KAŻDEJ krawędzi liczy `env(safe-area-inset-*)`,
nigdy stała. Warunkiem, żeby ta funkcja zwracała cokolwiek poza zerem, jest
`viewport-fit=cover` w atrybucie `viewport` — ale ten sam atrybut wpuszcza treść pod
wcięcie także u GÓRY i po BOKACH. Policzenie tylko dołu ucina nagłówek pod zegarkiem;
to się w tym projekcie wydarzyło.

**Reguła `max()` przy dolnej krawędzi.** `env(safe-area-inset-bottom)` w Safari na iPhonie
**nie jest stałe**: przy rozwiniętym pasku adresu wynosi 0, po jego zwinięciu 34 px.
Dlatego odstępy od dołu liczy się jako `max(własny odstęp, env(...))`, a nigdy jako
`calc(własny + env(...))` — przy dodawaniu wszystko przypięte do dołu skacze o 34 px
za każdym razem, gdy przeglądarka chowa swój pasek.

**Reguła pierwszeństwa nad warstwami.** Odstęp liczony z `env()` NIE MOŻE mieszkać
w `@layer base` ani `@layer components`: klasa narzędziowa Tailwinda w znacznikach
(`p-4`, `p-5`) leży w warstwie wyższej i wygrywa bez śladu w konsoli. Taka reguła stoi
poza warstwami. Ten błąd zdarzył się w tym projekcie dwa razy i za każdym razem objawiał
się przyciskami stojącymi tuż nad paskiem gestów.

**Przybliżanie szczypaniem jest wyłączone.** Układ jest jedną kolumną, która skaluje się
sama, więc przybliżenie nic nie odsłania, a zostawia człowieka w widoku, z którego nie wie,
jak wrócić. Trzy warstwy, bo dwie pierwsze iOS ignoruje: atrybut `viewport`,
`touch-action: pan-x pan-y`, blokada zdarzenia `gesturestart`.

### Arkusz — jedna budowa i jedna obietnica gestu

Wszystkie okna są **arkuszami wjeżdżającymi od dołu** na telefonie i wracają na środek
od 640 px. Budowa jest stała: `sheet-head` (uchwyt i tytuł, nie przewija się),
`sheet-body` (treść, przewija, `overscroll-behavior: contain`), `sheet-foot` (przyciski,
nie odjeżdżają z treścią).

**Reguła obietnicy gestu.** Uchwyt u góry arkusza znaczy „zsuń mnie palcem" i naprawdę
zsuwa. Uchwyt, który nie zsuwa, jest gorszy niż jego brak: obiecuje gest, którego nie ma,
i uczy nie ufać pozostałym znakom w interfejsie. Stąd trzy konsekwencje:

- Arkusz, z którego wolno wyjść, ma uchwyt. Ciągnie się za nagłówek; ciągnięcie po treści
  działa tylko przy liście przewiniętej na sam szczyt.
- **Krzyżyk stoi w nagłówku wtedy i tylko wtedy, gdy w stopce nie ma „Anuluj"** — inaczej
  jedno okno miałoby dwa przyciski o tym samym znaczeniu.
- **Okno decyzji nieodwracalnej nie ma ani uchwytu, ani krzyżyka** i nie zamyka się
  kliknięciem w tło. Brak uchwytu mówi to, zanim ktokolwiek spróbuje.

Od 640 px uchwyt znika: arkusz stoi na środku ekranu, nie przy krawędzi, więc nie ma go
dokąd zsunąć i nie ma czego obiecywać.

**Reguła trzech pięter.** O tym, które okno jest na wierzchu, nie może decydować kolejność
w znacznikach. Piętro wynika z tego, SKĄD okno się otwiera, a nie z tego, jak jest ważne:

| Warstwa | Klasa | Kiedy |
|---|---|---|
| 50 | (domyślna) | okno otwierane z ekranu |
| 60 | `modal-over` | okno otwierane Z INNEGO OKNA (wybór jednokrotny) |
| 70 | `modal-top` | decyzja: potwierdzenie albo pytanie wymagające odpowiedzi |

Bez tego arkusz wyboru sposobu płatności otwierał się POD arkuszem, z którego go wywołano,
więc wyboru nie dało się dokonać w ogóle.

### Motyw

**Domyślny motyw jest ciemny** i nie idzie za ustawieniem systemu. Scena użycia to wieczór
w lokalu, więc ciemny jest tu stanem podstawowym, a nie preferencją. Motyw jasny zostaje
pełnoprawnym wyborem i jest pamiętany na urządzeniu. Kolor paska systemowego telefonu
(`theme-color`) przestawia się razem z motywem, inaczej nad ciemnym ekranem wisi jasna
listwa i widać szew.

### Kontrakt responsywności

Trzy punkty łamania i ani jednego więcej. Każdy istnieje, bo układ go potrzebuje,
nie dlatego, że istnieje urządzenie o tej szerokości. Podejście od telefonu w górę
(`min-width`) — telefon jest stanem podstawowym, reszta jest wzbogaceniem.

| Punkt | Nazwa | Co się zmienia |
|---|---|---|
| — | **telefon** | jedna kolumna, margines 16 px, arkusze od dołu na pełną szerokość, pasek dolny |
| `640px` | **arkusz na środku** | arkusze przestają być wysuwane od dołu: środek, `max-width: 32rem`, promień 28 px ze wszystkich stron |
| `768px` | **tablet** | kontener `max-width: 48rem`, margines 24 px |
| `1024px` | **sufit** | kontener zatrzymuje się na `max-width: 56rem` i dalej nie rośnie; arkusze `max-width: 36rem` |

**Reguła jednej kolumny.** Każda lista w tej aplikacji jest JEDNĄ kolumną na każdej
szerokości ekranu. Rachunki łamały się od 768 px na dwie kolumny i zostało to cofnięte
2026-08-15 (decyzja właściciela po zobaczeniu na dużym ekranie), bo:

- rachunki są pogrupowane po dniach, więc dzień z jednym rachunkiem zostawiał dziurę
  obok — lista stawała się szachownicą z przypadkowymi lukami zamiast ciągiem;
- przy dwóch kolumnach przestaje być oczywiste, czy nowsze jest po lewej, czy wyżej;
- nawyk z telefonu przestaje działać, a to ta sama aplikacja i ci sami ludzie.

Kontener i tak zatrzymuje się na 56 rem, więc wiersz nigdy nie rozciąga się na całą
szerokość monitora.

**Reguła strukturalnej adaptacji.** Powyżej 768 px nie wolno skalować układu telefonowego
proporcjonalnie. Zmienia się szerokość kontenera i marginesy, nie rozmiar elementów.
Cel dotykowy zostaje 48 px na akcji i 44 px na kontrolce na **każdej** szerokości;
tablet trzyma się w dłoniach tak samo jak telefon.

**Reguła paska w dłoni.** Pasek nawigacji zostaje dolny i pływający na każdej szerokości,
wyśrodkowany, `width: min(21.25rem, 100vw - 2rem)`. Na dużym ekranie nie przenosi się do
góry ani na bok — to samo miejsce, ten sam gest, jedna nauka. Odsunięcie od dołu to
1,5 rem **ponad** `env(safe-area-inset-bottom)`, nie zamiast niego: na iPhonie z paskiem
gestów pasek nawigacji siadał wcześniej praktycznie na nim i stuknięcie w skrajną zakładkę
bywało wyjściem do ekranu początkowego.

**Typografia przy zmianie szerokości.** Skala ośmiu stopni obowiązuje na wszystkich
szerokościach i nic w niej nie zależy od rozmiaru ekranu.

**Reguła dopasowanego nominału.** Nominał bilansu jest JEDYNYM stopniem dobieranym do
treści, a nie do ekranu: liczba znaków kwoty wybiera jeden z trzech stopni skali
(3 rem / 1,875 rem / 1,25 rem). Powód jest prosty: „0,00" i „1 234 567,00" to ta sama rola
i ten sam blok, ale nie ten sam rozmiar — przy stałym stopniu druga z tych liczb wychodziła
poza limonkowy blok. Skrót waluty stoi wtedy POD liczbą, nie obok: obok zjadał szerokość
potrzebną samym cyfrom.

**Waluty nie sumują się w bilansie.** Gdy w pokoju żyją dwie waluty, bohaterem bloku
zostaje ta o największym saldzie, a pozostałe schodzą wiersz niżej mniejszym stopniem.
Nigdy nie łączy ich znak plus: plus sugerowałby jedną kwotę do zapłaty, a te salda domyka
się osobnymi przelewami.

**Weryfikacja jest częścią kontraktu.** Każdy ekran przechodzi audyt układu na czterech
szerokościach: **360** (mały telefon), **390** (odniesienie), **834** (tablet) i **1280**
(desktop). Zgłoszenie na którejkolwiek z nich jest zgłoszeniem.

## Elevation & Depth

Głębokość robi jasność i miękki cień, nie kreska. Karta odcina się od podłoża bielą;
obramowania używamy tylko tam, gdzie karta leży na karcie.

- **card**: `0 1px 2px rgb(ink / .04), 0 8px 24px rgb(ink / .06)`
- **lift** (arkusz, toast): `0 2px 6px rgb(ink / .08), 0 18px 40px rgb(ink / .12)`
- Motyw ciemny: cienie czarne i mocniejsze, bo tło nie ma czego przyciemniać.

## Shapes

14 px pole wprowadzania · 20 px blok cichy · 24 px karta · 28 px arkusz · pigułka dla
wszystkiego, co się naciska. Pełne koło zarezerwowane dla znaków i liczników: awatar,
licznik przypomnień, koło akcji w nawigacji.

**Reguła braku paska przy krawędzi.** Kolorowy pasek na jednej krawędzi karty jest
odrzucony — to najbardziej rozpoznawalny ślad interfejsu generowanego maszynowo. Stan
niesie wypełnienie całego pola.

## Components

### Buttons
Cztery odmiany i ani jednej więcej: `btn-primary` (limonka), `btn-dark` (atrament),
`btn-quiet` (cichy blok), `btn-danger` (czerwień). Wysokość 48 px, pigułka, `:active`
zmniejsza do 97 %. **Bez `:hover` jako jedynego nośnika stanu.**

**Reguła wyboru odmiany** (dopisana 2026-08-27 po zgłoszeniu właściciela o spójności).
Sama lista czterech odmian nie mówiła, KIEDY której użyć — i barwa zaczęła zależeć od
ekranu, a nie od znaczenia. Audyt znalazł „Potwierdzam" w trzech różnych kolorach naraz
i „Zapisz" inaczej niż „Zapisz wpłatę", choć to ta sama czynność.

| Odmiana | Znaczy | Przykłady |
|---|---|---|
| `btn-primary` | **domykam sprawę, którą ktoś mi postawił** | Potwierdzam · Zapisz · Zapisz wpłatę · Wyślij |
| `btn-dark` | **czynność, którą sam zaczynam** | Dodaj pozycję · Podziel resztę · Wejdź · Kopiuj |
| `btn-danger` | **pieniądze wychodzą ode mnie albo coś znika** | Ureguluj · Usuń rachunek |
| `btn-quiet` | **wyjście, odłożenie, rzecz drugorzędna** | Anuluj · Jeszcze poczekam · Oznacz przeczytane |

Test: gdyby to samo słowo miało dwa kolory na dwóch ekranach, kolor przestaje cokolwiek
znaczyć i zostaje ozdobą. Jedna limonka na powierzchnię — dwie znaczą, że żadna nie jest
tą główną.

**Piąta odmiana istnieje i jest wyjątkiem nazwanym po imieniu.** `btn-ai` (własna barwa
`--ai` z poświatą) obsługuje **wyłącznie odczyt paragonu przez model**. Nie jest to
złamanie reguły czterech, tylko oznaczenie jedynego miejsca, w którym pracę wykonuje
maszyna, a nie człowiek — i dlatego nie wolno jej użyć nigdzie indziej. Gdyby kiedyś
pojawiła się druga taka funkcja, dzielą tę samą barwę.

### Żywy paragon (komponent sygnaturowy)
Pozycje w kolumnie jak na paragonie. Po prawej każdej linii stos okrągłych twarzy tych,
którzy ją wzięli. Gdy ktoś inny odklika swoje, jego zdjęcie **ląduje na linii z animacją**
w czasie rzeczywistym. Moja pozycja: limonkowe wypełnienie linii.

**Po lewej każdej linii stoi pusty okrągły znacznik** — ten sam, co przy wyborze osób
(`person-row-check`), tylko wypełniany limonką zamiast atramentem, bo na paragonie limonka
znaczy „to jest twoje". Puste kółko mówi „to czeka na wybór", ZANIM ktokolwiek dotknie
ekranu; bez niego linia, której nikt nie wziął, nie zdradzała, że da się ją wziąć.

**Pod listą ząbkowana krawędź** (`.receipt-tear`): jednym kształtem, bez ani jednego słowa,
mówi że blok pozycji jest wydrukiem należącym do rachunku, a nie luźną listą kafelków.
To osobny element, nie maska na karcie — maska skasowałaby cień, a cień odróżnia kartę
od podłoża w motywie jasnym.

Podpis linii niczyjej brzmi **„Nikt nie wziął"**, czyli mówi o STANIE. Zachętę niesie
znacznik, więc podpis nie musi już być poleceniem.

### Twoja część rachunku
Karta „Twoja część" stoi **nad** paragonem, zaraz pod decyzją o podziale: najpierw fakty
o rachunku, potem jego kształt, a zaraz potem moje zadanie.

**Reguła sumy nad składnikami.** Na wierzchu karty stoi zadanie (pole kosztu własnego)
i JEDNA liczba: „Twój udział". Rozpiska „z czego się składa" chowa się w zwijanym wierszu.
Suma nad rzeczami, które ją tworzą, jest w porządku — rozpisana suma nad nimi już nie,
bo czytałoby się „Pozycje 96,00", zanim pozycje pojawią się na ekranie.

### Pola i przełączniki
`field` — cichy blok bez ramki, ognisko obwódką błękitu. `seg` — pigułka z segmentami
44 px, stan przez `aria-pressed`. `chip` — mała pigułka informacyjna.

### Wybór z listy — bez rozwijanych list systemowych
`<select>` **nie wchodzi**. Rozwinięta lista systemowa przychodzi z białym tłem,
niebieskim zaznaczeniem i cudzą czcionką, a jej wyglądu nie da się ustawić w żadnej
przeglądarce — na ciemnym ekranie jest ciałem obcym.

- **Wybór jednokrotny** (waluta rachunku, waluta domyślna pokoju, płatnik, rodzaj sposobu
  płatności, rodzaj kosztu wspólnego): `choice-field` — pole wyglądające jak `field`,
  z chevronem po prawej — otwiera arkusz z opcjami. W kodzie: `openChoiceSheet`.
  Od 2026-08-15 w aplikacji nie ma już **ani jednego** znacznika `<select>`.
- **Wybór osób** (skład rachunku, uczestnicy nowego rachunku, „kto to wziął"): wiersz
  `person-row` — zdjęcie albo znak, imię, okrągły znacznik po prawej. Promień `block`,
  zaznaczenie przez `aria-pressed`, nigdy przez systemowy kwadracik. W kodzie:
  `personRowHtml` i `selectedPersonIds`.
- **Wiersz ustawienia** (ekran „Ty"): `settings-row` — jedna wysokość, jeden odstęp
  wewnętrzny, jeden stopień pisma, wartość i chevron po prawej. Promień `block`.

Reguła promieni w kolumnie: **akcja to pigułka, kafelek listy to `block` (20 px)**.
Mieszanie 14 px, 20 px i pigułki w jednej kolumnie widać gołym okiem.

### Dolna nawigacja
Pływająca pigułka o **stałej szerokości**, cztery zakładki **samymi ikonami** i koło
akcji dokładnie na środku. Zakładki mają równe kolumny (`deck-side` po dwie), więc nic
nie przesuwa się przy zmianie miejsca. Aktywna zakładka to jasne koło (`--surface`
w motywie jasnym, `--ink` w ciemnym), nie kolor ikony. Cel dotykowy zakładki i koła
akcji to 56 px — 44 px było minimum, nie wygodą.

**Mrożone szkło.** Pasek ma krycie 0,78 i `backdrop-filter: blur(24px) saturate(1.8)`.
Przy kryciu 0,94 rozmycie było niewidoczne i pasek czytał się jak ciemna listwa doklejona
do dołu okna. Prześwit mówi, że treść płynie POD paskiem, a nie kończy się na nim.
Nasycenie w górę, bo rozmycie samo wypłukuje kolor. Przeglądarka bez `backdrop-filter`
dostaje pełne krycie: półprzezroczysty pasek bez rozmycia to szara mgła na treści.

Nazwa miejsca **nie stoi w pasku** — pada raz, jako `view-title` na górze otwartej
zakładki. Podpis w pasku i tytuł na ekranie to ta sama informacja podana dwa razy,
a na wąskim telefonie podpis urywał się wielokropkiem.

### Znak firmowy
Koń trojański w limonce na atramencie plus logotyp **„Bill" w limonce, „iada" w bieli**,
krój Bricolage Grotesque — ten sam, którym pisane są kwoty.

**Barwy znaku firmowego NIE idą za motywem i to jest jedyny taki wyjątek w całym systemie.**
Limonka na jasnym podłożu ma kontrast około 1,5:1, a biel na jasnym tle nie istnieje —
więc na jasnym podłożu logotyp idzie **wersją jednobarwną**: znak i nazwa atramentem,
a dwutonowość niesie różnica tonu, nie barwa. Znak przechodzi na atrament filtrem
`brightness(0)`, który zeruje kanały koloru i zostawia krycie nietknięte — jeden plik
obsługuje oba motywy.

**Znak stoi SAM, bez ramki i bez podkładki**, w układzie pionowym: znak, pod nim nazwa.
Wersja w ciemnej pigułce została odrzucona 2026-08-15 — obwódka robiła ze znaku naklejkę
i zabierała mu powietrze, a układ poziomy wymuszał małą ikonę, żeby lockup nie rozpychał
wiersza.

Do lockupu wchodzi **przezroczysta** wersja znaku, nie ikona z własnym tłem. Ikony PWA
przychodzą gotowe od właściciela i `tools/make-icons.mjs` ich nie rusza — skaluje
wyłącznie znak używany wewnątrz aplikacji.

Stoi w dwóch miejscach: ekran wczytywania i nagłówek ekranu startowego. **Nie w pokoju** —
tam nazwa pokoju jest ważniejsza od nazwy aplikacji, a logo na każdym ekranie to szyld,
nie produkt.

### Trzy warstwy ekranu rachunku
Rachunek niesie trzy różne rodzaje informacji i każdy ma własny nośnik, bo bez tego
wszystko było białą kartą na chłodnym podłożu i zlewało się w jedno:

- **Kwota rachunku** — biała karta (`card`). Fakt o rachunku.
- **Pozycje** — paragon (`receipt`): wiersze na wspólnej karcie, rozdzielone włoskiem.
  Czyta się jak wydruk, bo tym jest.
- **Twój udział** — blok limonkowy (`card-mine`). Limonka znaczy „to jest twoje" i tak
  samo działa już na twojej linii paragonu. Zero nowego języka: ten sam kolor w tej samej
  roli, o piętro wyżej.

### Wyszukiwanie osoby
Listy wyboru ludzi dostają **lupę** rozwijającą pole wyszukiwania. Kryterium projektowe
to grupa 12–25 osób, przy której przewijanie jest wolniejsze od wpisania trzech liter.
Lupa stoi zwinięta, bo w grupie pięciu osób lista mieści się na ekranie i pole byłoby
tylko kolejnym rzędem do minięcia. Filtr **ukrywa** wiersze, nigdy ich nie kasuje:
zaznaczenie osoby, której akurat nie widać, musi przeżyć wpisywanie.

### Sposób płatności: dwie drogi w jednym wierszu
Jedna metoda, dwa zamiary: „otwórz mi to w aplikacji" i „skopiuję sobie sam". Metody
z uchwytem (Revolut, PayPal, Wise) i numer telefonu dostają przycisk otwierający obok
kopiowania; numer konta zostaje przy samym kopiowaniu, bo nie ma dokąd go otworzyć.
Adres składa się **wyłącznie** z oczyszczonego uchwytu i znanej domeny — nigdy z cudzego
tekstu, bo pole wypełnia dowolna osoba w pokoju, a `href` przyjmujący czyjś tekst to
otwarta furtka na `javascript:`.

### Stan operacji sieciowej mieszka NA RZECZY, nie w dymku

Reguła nazwana, dodana 2026-08-25 po zgłoszeniu z wakacji: „wgrałem zdjęcie profilowe
i nie było żadnego feedbacku, że to się dzieje — dopiero jakoś po minucie się
zaktualizowało".

Dymek żyje 3,6 sekundy. Wysyłka pliku przez zdychające wifi trwa minutę. Przez pozostałe
pięćdziesiąt kilka sekund ekran nie mówił nic, a awatar był stary — czyli wyglądało to
dokładnie tak, jakby nic się nie stało.

**Dymek jest do zdarzeń chwilowych.** Operacja, która może trwać dłużej niż jego życie,
pokazuje swój stan na elemencie, którego dotyczy: procent na awatarze przy wysyłce zdjęcia,
znacznik wysyłki na wierszu, pasek łączności dla całej aplikacji. Stan znika dopiero wtedy,
gdy operacja się kończy — nigdy wcześniej.

Z tej samej reguły wynika druga: **brak ostrzeżenia musi znaczyć „sprawdzone", a nigdy
„nie miałem czym sprawdzić"**. Kontrola, która milknie przy brakujących danych, wygląda
identycznie jak kontrola, która przeszła — i uczy ufać ekranowi, który niczego nie
sprawdził. Kontrola sumy paragonu ma dlatego trzy stany, nie dwa.

### Komunikat pokazuje działanie, nie domysł o przyczynie

Rozjazd kwot mówi, Z CZEGO wynika i W KTÓRĄ STRONĘ, zamiast zgadywać powód. Zdanie
„ktoś przeliczył albo pozycja jest podwójna" trafiało w połowie przypadków, a w drugiej
połowie kierowało na fałszywy trop — bo pomijało koszty ogólne, czyli trzeci składnik
sumy kontrolnej. Kierunek różnicy niesie informację i musi być w treści: nadmiar znaczy
duplikat, niedobór znaczy przeoczoną linię.

Gdy da się naprawić rzecz jednym stuknięciem, obok stoi przycisk, który to robi — ale
**aplikacja nigdy nie robi tego sama**. To są cudze pieniądze.

## Motion

Jedna krzywa: `cubic-bezier(0.2, 0, 0, 1)`. Trzy dozwolone role i nic poza nimi:

1. **Wejście** — arkusz od dołu (300 ms), ekran +8 px (260 ms), lista kaskadą po 40 ms
   z zatrzymaniem na szóstym elemencie.
2. **Cudze działanie** — twarz lądująca na paragonie (320 ms), przetaczana kwota (260 ms).
3. **Potwierdzenie** — podświetlenie zmienionej kwoty (700 ms), wjazd nowego elementu,
   wyjazd usuwanego, toast, potrząśnięcie przy błędzie, **odzew wciśnięcia**.

Wszystko znika przy `prefers-reduced-motion`. Ozdobnik bez jednej z trzech ról nie wchodzi.

**Reguła dwóch nośników przy wciśnięciu.** Odzew dotknięcia niesie i skala (0,97),
i przyciemnienie wypełnienia (4 %). Sama skala nie wystarcza: palec zasłania środek
przycisku dokładnie w chwili, gdy ten się kurczy, więc jedyne, co widać, to obrzeże.
Czas w dół 90 ms, w górę 220 ms — szybko przyjmuje, wolniej oddaje, jak rzecz sprężysta.
Na iOS to wszystko jest MARTWE, dopóki dokument nie ma choćby jednego nasłuchu dotyku;
`main.js` zakłada pusty nasłuch `touchstart` na `body` i to on odblokowuje cały odzew.

**Nowy rachunek: okrąg rozwija arkusz z przycisku.** Pasek zostaje na ekranie, koło [+]
obraca się o 135° w krzyżyk i jest przyciskiem zamknięcia, a arkusz jest ODSŁANIANY
okręgiem rosnącym dokładnie z punktu, w którym stoi [+]. Od pierwszej klatki ma swój
docelowy kolor i swoje miejsce — zmienia się wyłącznie to, ile go widać.

Morfowanie koła w arkusz przez View Transitions API zostało **odrzucone i nie wraca**:
limonka przenikała w biel (mignięcie, nie przemiana), zamknięcie pokazywało wielki
limonkowy kształt rozciągnięty na cały arkusz, a Safari ma to API dopiero od osiemnastki.
Reguła, która z tego wynika: **dwa kształty o różnej jasności nie mają prawa się
przenikać** — jeśli coś ma wyrosnąć z przycisku, ma być odsłaniane albo przesuwane,
nigdy wmieszane w drugi kolor.

Wariant wejścia wybiera jedna klasa na oknie (`anim-reveal` albo `anim-sprout`); oba
warianty stoją obok siebie w arkuszu stylów. **Zamknięcie zawsze idzie tą samą drogą
wstecz i szybciej**: otwarcie ma coś pokazać, zamknięcie ma zejść z drogi.

## Do's and Don'ts

### Do
- **Do** trzymaj trzy zbiory kolorów rozłączne (marka / role pieniężne / ludzie).
- **Do** dawaj każdej akcji odpowiedź: podświetlenie, toast albo zmianę stanu.
- **Do** pisz kwoty cyframi tabelarycznymi, z cichszymi groszami.
- **Do** projektuj stan na `:active` i `aria-*`, nie na `:hover`.
- **Do** trzymaj cele dotykowe na 44 px, akcje na 48 px.
- **Do** podawaj kolor z bazy atrybutem `style`, nigdy klasą sklejaną ze stringu.

- **Do** dawaj uchwyt tylko arkuszom, które naprawdę zsuwają się palcem.
- **Do** licz odstępy od dolnej krawędzi z `env(safe-area-inset-bottom)`, poza warstwami CSS.

### Don't
- **Don't** barw całych kart tożsamością człowieka — kolor niesie STAN, nie osobę.
- **Don't** używaj wersalików z rozstrzeleniem ani powtarzanych pasków tekstu.
- **Don't** dokładaj paska przy krawędzi karty jako oznaczenia stanu.
- **Don't** wciągaj krojów, ikon ani skryptów z cudzego serwera.
- **Don't** animuj bez jednej z trzech ról.
- **Don't** duplikuj wejścia do tej samej rzeczy w dwóch miejscach ekranu.
- **Don't** rysuj znaku sugerującego gest, którego nie ma (uchwyt bez zsuwania, chevron
  bez rozwijania, ołówek bez edycji).
- **Don't** pytaj człowieka o stan, który aplikacja może policzyć sama — status, który
  bywa nieprawdziwy, jest gorszy niż brak statusu.
- **Don't** dawaj czerwieni długu decyzji, którą da się cofnąć; ona znaczy „stąd nie ma
  powrotu" i traci to znaczenie po trzecim użyciu na czymś odwracalnym.
- **Don't** wstawiaj tekstu z bazy do atrybutu `href`.
