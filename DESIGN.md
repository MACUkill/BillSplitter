---
name: BillSplitter
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

# Design System: BillSplitter

> Stan na 2026-08-05. Świat przypięty referencjami właściciela z `Referencje/`.
> Poprzedni kierunek („druk zabezpieczony": banknot, gilosz, mikrodruk, Bodoni) został
> odrzucony w całości i jest **anty-referencją** — nic z niego nie wraca.

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
sekcjami, 20 px w karcie, 8 px między wierszami listy. Dół dokumentu ma 144 px zapasu pod
pływające elementy plus `env(safe-area-inset-bottom)`.

Wszystkie okna są **arkuszami wjeżdżającymi od dołu** na telefonie i wracają na środek
od 640 px. Każdy arkusz ma uchwyt u góry i zamyka się kliknięciem w tło albo klawiszem
Escape — z wyjątkiem potwierdzeń nieodwracalnych.

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
wyśrodkowany, `max-width: 28rem`. Na dużym ekranie nie przenosi się do góry ani na bok —
to samo miejsce, ten sam gest, jedna nauka.

**Typografia przy zmianie szerokości.** Nominał bilansu 3 rem do 767 px, 3,75 rem od
768 px. Żaden inny stopień skali się nie zmienia — osiem stopni obowiązuje na wszystkich
szerokościach.

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

- **Wybór jednokrotny** (waluta, płatnik, status): `choice-field` — pole wyglądające jak
  `field`, z chevronem po prawej — otwiera arkusz z opcjami. W kodzie: `openChoiceSheet`.
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
w motywie jasnym, `--ink` w ciemnym), nie kolor ikony.

Nazwa miejsca **nie stoi w pasku** — pada raz, jako `view-title` na górze otwartej
zakładki. Podpis w pasku i tytuł na ekranie to ta sama informacja podana dwa razy,
a na wąskim telefonie podpis urywał się wielokropkiem.

## Motion

Jedna krzywa: `cubic-bezier(0.2, 0, 0, 1)`. Trzy dozwolone role i nic poza nimi:

1. **Wejście** — arkusz od dołu (300 ms), ekran +8 px (260 ms), lista kaskadą po 40 ms
   z zatrzymaniem na szóstym elemencie.
2. **Cudze działanie** — twarz lądująca na paragonie (320 ms), przetaczana kwota (260 ms).
3. **Potwierdzenie** — podświetlenie zmienionej kwoty (700 ms), wjazd nowego elementu,
   wyjazd usuwanego, toast, potrząśnięcie przy błędzie.

Wszystko znika przy `prefers-reduced-motion`. Ozdobnik bez jednej z trzech ról nie wchodzi.

## Do's and Don'ts

### Do
- **Do** trzymaj trzy zbiory kolorów rozłączne (marka / role pieniężne / ludzie).
- **Do** dawaj każdej akcji odpowiedź: podświetlenie, toast albo zmianę stanu.
- **Do** pisz kwoty cyframi tabelarycznymi, z cichszymi groszami.
- **Do** projektuj stan na `:active` i `aria-*`, nie na `:hover`.
- **Do** trzymaj cele dotykowe na 44 px, akcje na 48 px.
- **Do** podawaj kolor z bazy atrybutem `style`, nigdy klasą sklejaną ze stringu.

### Don't
- **Don't** barw całych kart tożsamością człowieka — kolor niesie STAN, nie osobę.
- **Don't** używaj wersalików z rozstrzeleniem ani powtarzanych pasków tekstu.
- **Don't** dokładaj paska przy krawędzi karty jako oznaczenia stanu.
- **Don't** wciągaj krojów, ikon ani skryptów z cudzego serwera.
- **Don't** animuj bez jednej z trzech ról.
- **Don't** duplikuj wejścia do tej samej rzeczy w dwóch miejscach ekranu.
