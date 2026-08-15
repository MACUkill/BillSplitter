---
name: Billyada
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

# Design System: Billyada

> Stan na 2026-08-15. Świat przypięty referencjami właściciela z `Referencje/`.
> Poprzedni kierunek („druk zabezpieczony": banknot, gilosz, mikrodruk, Bodoni) został
> odrzucony w całości i jest **anty-referencją** — nic z niego nie wraca.
>
> Nazwa produktu **Billyada** rozstrzygnięta 2026-08-15. Znak: rachunek przedarty na pół,
> limonka na atramencie, źródło w `public/icons/icon.svg`, rasteryzacja przez
> `node tools/make-icons.mjs`.

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

Szesnaście nasyconych kolorów w `src/identity.js`, liczonych z identyfikatora uczestnika.
Zbiór zamknięty. Zdjęcie ma pierwszeństwo przed kolorem; kolor przed literą.

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

**Reguła strefy bezpiecznej.** Odległości od dolnej krawędzi liczy `env(safe-area-inset-bottom)`,
nigdy stała. Warunkiem, żeby ta funkcja w ogóle zwracała coś innego niż zero, jest
`viewport-fit=cover` w atrybucie `viewport` — bez niego iPhone raportuje zera i cała
obsługa paska gestów jest martwym kodem.

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

### Kontrakt responsywności

Trzy punkty łamania i ani jednego więcej. Każdy istnieje, bo układ go potrzebuje,
nie dlatego, że istnieje urządzenie o tej szerokości. Podejście od telefonu w górę
(`min-width`) — telefon jest stanem podstawowym, reszta jest wzbogaceniem.

| Punkt | Nazwa | Co się zmienia |
|---|---|---|
| — | **telefon** | jedna kolumna, margines 16 px, arkusze od dołu na pełną szerokość, pasek dolny |
| `640px` | **arkusz na środku** | arkusze przestają być wysuwane od dołu: środek, `max-width: 32rem`, promień 28 px ze wszystkich stron |
| `768px` | **tablet** | kontener `max-width: 48rem`, margines 24 px; listy kafelkowe łamią się na **dwie kolumny**, odstęp 16 px |
| `1024px` | **sufit** | kontener zatrzymuje się na `max-width: 56rem` i dalej nie rośnie; arkusze `max-width: 36rem` |

**Reguła jednej kolumny dla kwoty.** Nominał bilansu, kwota rachunku i suma kontrolna
zostają pełną szerokością kolumny na każdej szerokości ekranu. Do siatki wchodzą
wyłącznie listy powtarzalnych kafelków: rachunki i wiersze rozliczeń. Kwota jest
bohaterem, a bohater nie stoi w dwóch kolumnach.

**Reguła strukturalnej adaptacji.** Powyżej 768 px nie wolno skalować układu telefonowego
proporcjonalnie — zmienia się liczba kolumn listy, nie rozmiar elementów. Cel dotykowy
zostaje 48 px na akcji i 44 px na kontrolce na **każdej** szerokości; tablet trzyma się
w dłoniach tak samo jak telefon.

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

### Żywy paragon (komponent sygnaturowy)
Pozycje w kolumnie jak na paragonie. Po prawej każdej linii stos okrągłych twarzy tych,
którzy ją wzięli. Gdy ktoś inny odklika swoje, jego zdjęcie **ląduje na linii z animacją**
w czasie rzeczywistym. Moja pozycja: limonkowe wypełnienie i limonkowa obwódka przy mojej
twarzy. Pozycja niczyja: cichy blok z zachętą „Stuknij, jeśli to Twoje".

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

**Nowy rachunek: arkusz wyrasta nad paskiem.** Pasek zostaje na ekranie, arkusz rośnie
tuż nad nim z zaczepieniem na dole, a koło [+] obraca się o 135° w krzyżyk i jest
przyciskiem zamknięcia. Morfowanie koła w arkusz przez View Transitions API zostało
**odrzucone i nie wraca**: limonka przenikała w biel (mignięcie, nie przemiana), zamknięcie
pokazywało wielki limonkowy kształt rozciągnięty na cały arkusz, a Safari ma to API dopiero
od osiemnastki, więc większość ekipy nigdy tej animacji nie widziała. Obecne rozwiązanie
to zwykłe `transform` i `opacity`, więc wygląda tak samo wszędzie.

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
