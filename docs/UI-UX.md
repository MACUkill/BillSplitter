# UI/UX — stan prac, decyzje, zaległości

Dokument roboczy do wznawiania sesji. `DESIGN.md` mówi JAK ma wyglądać;
ten plik mówi CO jest zrobione, co jest zepsute i co dalej.

Stan na **2026-08-05**.

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
                     # więc bez nich logowanie anonimowe pada i widać pusty ekran)
npm test             # 157 testów
npm run build
```

### Narzędzia audytowe

Dwa przebiegi w `tools/`. Wymagają puppeteera: `npm i --no-save puppeteer`.

```bash
node tools/audit-layout.mjs ./shots    # zrzuty + pomiar układu przy 390×844
node tools/audit-buttons.mjs           # szuka martwych przycisków
```

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
oraz `design-system-font: Font Awesome` (prawdziwy dług, patrz §6).

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

## 3. STRUKTURA NAWIGACJI — do przebudowy (priorytet 1)

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

- [ ] **Wybór koloru w profilu** wysypuje szesnaście kółek naraz. Ma być jedno pole
      „Twój kolor" z bieżącym kolorem, a paleta w arkuszu po stuknięciu.
- [ ] **Zwijana sekcja „Pokój"** — patrz §3, do przeniesienia pod nazwę pokoju.
- [ ] **Dublowanie wejść** — patrz §3.
- [ ] Pulpit przy jednym rachunku wygląda pusto: brak stanu pustego z zachętą.
- [ ] Odcień „coś czeka na ciebie" (błękit 9 %) ciągnie oko mocniej niż limonkowy
      bilans. Zejść do 6 %.
- [ ] Pole kwoty pokazuje `480.00` zamiast `480,00` (polski separator).
- [ ] Nazwa pokoju ucinana już przy średniej długości — rozważyć dwie linie.

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
- [ ] **Dziennik zmian** — kto zmienił kwotę albo pozycję.
- [ ] **Krótki kod pokoju i kod QR** — dziś w nagłówku stoi identyfikator dokumentu
      Firestore, nie do podyktowania przy stole.
- [ ] **Arkusz płatności ZBP/EPC** — wymaga testu na żywym telefonie właściciela.
- [ ] **Własny zestaw ikon w buildzie** zamiast Font Awesome z CDN.
- [ ] **Własne szablony przypomnień zapisywane w pokoju** — grupa buduje swój zestaw
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
