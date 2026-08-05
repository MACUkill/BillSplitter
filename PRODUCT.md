# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ekipy znajomych rozliczające wspólne wydatki. Cztery potwierdzone sceny użycia, wszystkie
realne i wszystkie z telefonu:

1. **Przy stole po kolacji** — telefon w ręku, hałas, paragon leży na stole, uwagi jest
   dwadzieścia sekund. Rozliczenie ma się domknąć, zanim kelner wróci z terminalem.
2. **Wspólny wyjazd** — kilkanaście rachunków przez kilka dni, różne waluty.
   Potwierdzone: **grupa rozlicza się na bieżąco (codziennie albo co któryś dzień)**,
   nie tylko wielkim podsumowaniem na koniec. Stan „ile jestem winien dziś" musi być
   czytelny w każdym momencie wyjazdu, nie dopiero po powrocie.
3. **Jednorazowa okazja** — prezent, impreza, zrzutka ad hoc. Pokój powstaje na jeden
   cel i potem umiera.

Wspólny mianownik: użytkownik jest na telefonie, w ruchu, wśród ludzi — nie przy biurku.

**Scena marginalna (2026-08-03):** współlokatorzy i koszty cykliczne. Produkt jest o
wyjazdach i wyjściach grupowych; długo żyjący pokój ma działać przyzwoicie, ale **nie
jest kryterium projektowym**. Wydatki cykliczne świadomie poza zakresem.

**Rozmiar grupy:** bywa 12–25 osób (wyjazdy, imprezy). Listy, awatary i przypisywanie
pozycji muszą działać przy tej skali, nie przy czterech osobach.

## Product Purpose

Dzielenie wspólnych rachunków i domykanie długów w grupie znajomych: kto co
skonsumował, ile komu wychodzi i czy faktycznie zapłacił. Sukces to rozliczenie
zamknięte bez sporu i bez cudzej dopłaty — pieniądze wracają do płatnika, a nikt nie
musi pilnować kolegi ręcznie.

## Positioning

Dwa mechanizmy flagowe, potwierdzone przez właściciela produktu:

1. **Paragon → kafelki → odklikujesz swoje.** Zdjęcie paragonu, model AI wypisuje
   pozycje, a cała ekipa **równocześnie** stuka to, co jadła. Konkurencja dzieli
   rachunek kwotami i procentami; tutaj jednostką podziału jest realna pozycja z
   paragonu, a wprowadzanie jest rozproszone na całą grupę zamiast spoczywać na jednej
   osobie. Współbieżność jest częścią obietnicy (zapis transakcyjny), nie detalem.
2. **Windykator: przypomnij i potwierdź.** Wpłata jest osobnym zdarzeniem, odbiorca ją
   potwierdza, a wierzyciel może wysłać push do dłużnika. Produkt nie kończy się na
   policzeniu długu — domyka go.

Wspierające, nieflagowe: brak kont (link do pokoju = dostęp) i uczciwość co do grosza
(zaokrąglanie na korzyść płatnika, suma kontrolna „pozycje vs rachunek").

## Operating Context

- Wejście przez link do pokoju; użytkownik wybiera swoje imię z listy. Sesja jest
  anonimowa, przypisana do urządzenia; lista pokoi żyje w `localStorage`.
- Praca w restauracji: słaby zasięg jest normą. Zapisy pozycji mają ścieżkę awaryjną
  offline, aplikacja pokazuje wskaźnik braku sieci.
- Kilka osób pracuje na tym samym rachunku w tej samej sekundzie.
- Zdjęcia paragonów wgrywane z aparatu telefonu (także HEIC), do pięciu na rachunek.
- PWA instalowana na telefonie; push działa na Androidzie, a na iPhonie po dodaniu do
  ekranu początkowego — **potwierdzone jako działające (2026-08-03)**.

## Capabilities and Constraints

Funkcje, które redesign musi zachować w całości:

- Dwa typy rachunku: **prosty** (kwota po równo) i **zaawansowany** (pozycje, koszty
  indywidualne, koszty ogólne kwotowe i procentowe).
- Kafelki pozycji: stuknięcie = dopisanie siebie, edycja, rozbicie pozycji na sztuki,
  ostrzeżenie o pozycjach, których nikt nie wybrał.
- Odczyt paragonu przez AI z podglądem do akceptacji i edycji przed wejściem na rachunek.
- Suma kontrolna: ✓ / nadwyżka / brakuje.
- Rozliczenia w dwóch trybach: „kto komu ile" (z rozbiciem na rachunki) i „najmniej
  przelewów"; rejestr wpłat z potwierdzaniem i historią; waluty nie mieszają się.
- Waluty PLN/EUR/USD z kursem zapisanym w dniu dodania rachunku.
- Przypomnienia (dzwonek, skrzynka, push). Bramka anty-spamowa: dziesięć sekund między
  przypomnieniami do tej samej osoby (zmienione 2026-08-05 z sześciu godzin — produkt ma
  domykać dług, a nie chronić dłużnika; blokujemy tylko walenie w przycisk co sekundę).
- Profil: kolor, zdjęcie, metody płatności (konto/IBAN, telefon, Revolut, PayPal, własne)
  z kopiowaniem; ekran „kto ile wydał i ile wyłożył".
- Zdjęcia paragonów z podglądem i licznikiem miejsca; ukrywanie rachunków; „nie dotyczy";
  edycja składu rachunku; usuwanie rachunku z oknem „Cofnij"; kontekstowa pomoc „?";
  lista „Twoje pokoje"; wskaźnik offline; instalacja PWA.

Ograniczenia techniczne:

- Vanilla JS bez frameworka (Vite + Vitest), Tailwind 3 kompilowany w buildzie —
  skaner klas obejmuje `index.html` i `src/**/*.js`, więc **żadnej klasy nie wolno
  sklejać ze stringów**. Markup żyje w `index.html` (663 linie) i w szablonach wewnątrz
  `src/main.js`.
- Firebase: Firestore, Storage, Auth (anonimowe), Cloud Functions (`europe-central2`),
  FCM. Jeden service worker obsługuje offline i push.
- Sieć asekuracyjna, której redesign nie może obejść: `selectors.contract.test.js`
  (kontrakt identyfikatorów i klas-uchwytów), `render.safety.test.js` (żadna dana z bazy
  nie trafia do znaczników bez neutralizacji). 143 testy jednostkowe muszą zostać zielone.
- Tożsamość jest anonimowa i przypięta do urządzenia — wyczyszczenie danych przeglądarki
  oznacza utratę dostępu do pokoi. To znany, świadomie przyjęty koszt.

Świadomie otwarte (nie do naprawy w redesignie, ale nie do zapomnienia): członek grupy
może podmienić cudzy numer konta; po przekroczeniu 4,5 GB aplikacja kasuje najstarsze
zdjęcia bez pytania.

### Rozstrzygnięcia zakresu (2026-08-03/04)

Wchodzi do redesignu:

- **Jeden rachunek, który rośnie** zamiast wyboru „prosty / zaawansowany" przed pierwszą
  kwotą. Wymaga nowej reguły w `calc.js`: kwota nierozpisana na pozycje i koszty własne
  dzieli się po równo między uczestników (dziś taka reszta zostaje na płatniku).
  **ZROBIONE 2026-08-04:** reguła w `calculateAll`, wybór typu usunięty z okna nowego
  rachunku, ekran „prosty" skasowany (stare rachunki `type: 'simple'` otwierają się na
  wspólnym ekranie bez migracji danych). Status kontroli `under` przestał być błędem —
  interfejs mówi „Nierozpisane X — po Y na osobę". Błędem zostaje wyłącznie `over`.
- **Udziały nierówne** (wagi/procenty) — „ktoś płaci za dwoje" bez obchodzenia tego
  kosztami własnymi.
- **Dziennik zmian** — widoczny ślad, kto zmienił kwotę lub pozycję. Przy grupie 12–25
  osób to mechanizm zaufania, nie ozdoba.
- **Kod pokoju i kod QR wejścia** — pełnoprawna ścieżka „Dołącz" obok linku. Naprawia
  równocześnie problem iOS opisany niżej i scenę „podaj kod przy stole".
- **Arkusz płatności**: metody odbiorcy zamienione w jeden gest — kod ZBP dla rachunku
  polskiego, kod EPC dla euro, gotowy link dla Revolut/PayPal, kopiowanie jako pewnik.
  **Realne wsparcie w aplikacjach bankowych jest niepotwierdzone** — do rozstrzygnięcia
  testem na żywym telefonie, nie deklaracją.
- **Motyw ciemny i jasny**, automatycznie wg systemu.
- **Własny zestaw ikon** wbudowany w build (dziś Font Awesome z CDN) oraz znaki awatarów
  do wyboru: tożsamość niesie kształt, kolor ją wzmacnia, zdjęcie nadpisuje.
- **Ruch informacyjny** — animacja potwierdza zmianę stanu, zwłaszcza gdy wywołał ją ktoś
  inny w grupie.
- **Wolna ręka w słowniku interfejsu** (dziś mieszają się „pokój/grupa",
  „koszty ogólne/modyfikatory", „rozliczenia/wpłaty").

Świadomie poza zakresem: kategorie wydatków i statystyki (koszt nadawania wyższy niż
zysk; gdyby kiedyś, to wyprowadzone z nazw pozycji, które model AI już zwraca), wydatki
cykliczne, eksport, zbiorcze saldo mieszające waluty.

### Znany problem: PWA na iPhonie

Skrót dodany do ekranu początkowego otwiera ekran startowy zamiast pokoju. Dwie
przyczyny: `manifest.json` ma `start_url: "/"`, które na iOS 16.4+ wygrywa z adresem
bieżącej strony, oraz osobny magazyn danych aplikacji ze skrótu — lista pokoi zapisana
w Safari jest tam niewidoczna. Naprawa warstwowa: kod pokoju i QR jako pewnik,
dynamiczny manifest z `start_url` bieżącego pokoju jako eksperyment do potwierdzenia
na telefonie.

## Brand Commitments

- Nazwa **BillSplitter** zostaje na czas redesignu. Właściciel uważa ją za zajętą i
  planuje zmianę — nazwa i logo są **otwartą decyzją**, do rozstrzygnięcia osobno.
  Rozstrzygnięcie 2026-08-04: nowa nazwa **musi być angielska**. Propozycje polskie
  (Rewers, Kwit, Nominał) odrzucone przez właściciela; wybór odłożony, nie zamknięty.
- Język interfejsu: polski. Redesign ma zostawić UI gotowy na tłumaczenie (teksty
  wydzielone, layout znoszący dłuższe stringi), ale **druga wersja językowa nie wchodzi
  do zakresu tego redesignu**.
- Brak istniejącej identyfikacji wizualnej, którą trzeba zachować. Obecny wygląd
  (Tailwind w domyślnych ustawieniach, Font Awesome) jest dowodem stanu, nie zobowiązaniem.

**Głos produktu — zasada twarda:** aplikacja nie dostarcza humoru, tylko formę, którą
grupa wypełnia własnym. Gotowy mem starzeje się w pół roku i dzieli użytkowników;
puste miejsce na żart ekipy nie starzeje się nigdy. Mechanizmy: szablony przypomnień
zapisywane w pokoju (grupa buduje własny zestaw tekstów), ksywki zamiast imion, własny
znak i nazwa pokoju.

**Humor pojawia się wyłącznie tam, gdzie autorem jest człowiek.** Nigdy przy kwocie,
nigdy w komunikacie błędu, nigdy przy nieudanej płatności. System zostaje spokojny i
rzeczowy — żartują ludzie. Przypomnienie jest sprawą dwóch osób: treść widzi wyłącznie
adresat.

## Evidence on Hand

- Działająca aplikacja na gałęzi `BillSplitterV2`, wdrożona pod
  `billsplitterv2--groupbillsplitter.netlify.app` (piaskownica `billsplitter-push-test`).
- Audyt techniczny z 27.07.2026 (13 ustaleń naprawionych, 4 świadomie otwarte).
- 143 testy jednostkowe + 29 testów reguł.
- Brak: opinii użytkowników w formie pisemnej, danych o użyciu, materiałów prasowych,
  logo, zdjęć produktowych. Niczego z tej listy nie wolno wymyślać.

## Product Principles

1. **Pieniądze muszą być godne zaufania.** Każda kwota pokazana użytkownikowi ma
   pokrycie w policzonym stanie: zaokrąglanie zawsze na korzyść płatnika, suma
   kontrolna widoczna, ślad „za co" dostępny. Interfejs nigdy nie sugeruje pewności,
   której dane nie mają.
2. **Ekipa pracuje równolegle.** Wprowadzanie rachunku jest zadaniem grupy, nie jednej
   osoby; równoczesne działania kilku telefonów są normą, nie przypadkiem brzegowym.
3. **Dwadzieścia sekund przy stole.** Główna ścieżka ma się domknąć na telefonie, jedną
   ręką, w hałasie. Wszystko, co nie służy tej ścieżce, schodzi z drogi.
4. **Dług się domyka, nie tylko liczy.** Produkt prowadzi do momentu, w którym pieniądze
   wracają: przypomnienie, wpłata, potwierdzenie.
5. **Zero progu wejścia.** Link wystarcza. Każde przyszłe konto musi być dodatkiem dla
   chętnych, nie bramką przed pierwszym rachunkiem.

## Accessibility & Inclusion

Brak potwierdzonego wymogu formalnego. Warunki realnego użycia narzucają jednak minimum:
używanie jedną ręką, cele dotykowe znoszące stuknięcie w biegu, czytelność przy słabym
świetle w lokalu i kontrast wystarczający na telefonie trzymanym pod kątem.
