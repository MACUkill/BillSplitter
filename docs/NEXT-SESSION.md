# Brief na następną sesję — pełny redesign

Napisane 2026-08-05 na koniec sesji, w której powstał nowy świat wizualny.
**Zacznij od tego pliku.** Potem `docs/UI-UX.md`, `DESIGN.md`, `PRODUCT.md`.

---

## Stan faktyczny: co JEST, a czego NIE MA

### Jest (nie przerabiaj od zera)

- **System wizualny** — `DESIGN.md`: tokeny, skala ośmiu stopni, reguły nazwane, ruch.
  Świat przypięty referencjami z `Referencje/`. Detektor Impeccable pilnuje zgodności.
- **Znak własny** — żywy paragon, zbudowany i działa.
- **Reguła „jeden rachunek, który rośnie"** — w `calculateAll`, z testami.
- **Narzędzia audytowe** — `tools/audit-layout.mjs`, `tools/audit-buttons.mjs`.
- **Sieć asekuracyjna** — 157 testów, kontrakt selektorów, strażnik escapowania.

### ZAKRES — stan na 2026-08-06

Lista właściciela z 2026-08-05, ze statusem po partiach 1, 1b i 1c.
Wykonanie opisane w `docs/UI-UX.md` §11, decyzje w §10.

| # | Punkt | Stan |
|---|---|---|
| 1 | **Responsywność** — telefon, tablet, desktop | **zrobione**: kontrakt w `DESIGN.md`, audyt chodzi na 360/390/834/1280, siatka 2× od 768 px |
| 2 | **Powiadomienia w interfejsie** — kropki, odznaki, skrzynka | **do zrobienia** (partia 2, §10.2) |
| 3 | **Struktura ustawień** — profil / grupa / aplikacja | **zrobione co do podziału**; brakuje zawartości ustawień pokoju (skład, QR, waluta, opuszczenie) |
| 4 | **Rozliczenia jako osobne miejsce** | **zrobione** — zakładka „Kto komu ile" |
| 5 | **Rachunki z filtrowaniem** | **do zrobienia** (partia 2, §10.4): pigułki `Czekają na Ciebie` / `Moje`, nagłówki dat, licznik |
| 6 | **Historia zmian** | **do zrobienia** (partia 3) |
| 7 | **Własne szablony przypomnień** | **do zrobienia** (partia 3) |
| 8 | **Morfowanie [+] w arkusz** | **zrobione** (View Transitions API) |
| 9 | **Nawigacja na każdym ekranie, zakładki jako miejsca** | **zrobione** (partia 1) |

**Kolejność następnych partii** (rekomendacja przyjęta 2026-08-06):

1. **Partia 2 — Rachunki** (§10.4): filtry pigułkami, nagłówki dat, licznik nad listą.
   Najczęściej używana lista w aplikacji, a dziś ma dwa filtry i płaską listę.
2. **Partia 3 — Powiadomienia i skrzynka** (§10.2): trzy poziomy, kropki na zakładkach,
   odznaka liczbowa wyłącznie dla poziomu 1, skrzynka spod dzwonka.
3. **Partia 4 — Ustawienia pokoju** (§10.3): skład grupy (z odniesieniem do ryzyka
   podmiany cudzego numeru konta), kod QR, waluta domyślna, opuszczenie pokoju.
4. **Partia 5 — Bilans** (§10.1): twarze ekipy, lista „co czeka na Ciebie".
5. **Partia 6 — Historia zmian** i **szablony przypomnień**.
10. **Research — traktuj jako obowiązkowy, nie opcjonalny.** Właściciel powiedział
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
