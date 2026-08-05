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

### NIE MA — i to jest zakres tej sesji

Właściciel wypisał to wprost 2026-08-05. Żadnego z tych punktów nie ma w dokumentacji:

1. **Responsywność** — nic nie jest udokumentowane ani sprawdzone poza 390×844.
   **Priorytet: telefon i TABLET**, potem desktop. Audyt chodzi na jednej szerokości;
   trzeba go rozszerzyć o punkty łamania i przejrzeć każdy ekran na każdym.
2. **System powiadomień w interfejsie** — „uzupełnij swoje koszty", kropka w nawigacji
   przy nieobejrzanych rachunkach, odznaki. Push istnieje w kodzie (FCM), ale
   powiadomienia *wewnątrz* aplikacji nie są zaprojektowane.
3. **Struktura ustawień** — właściciel chce rozdzielone i uporządkowane:
   ustawienia profilu, ustawienia grupy, ustawienia aplikacji. Dziś to jest wymieszane.
4. **Zakładka rozliczeń i przelewów** jako osobne miejsce, nie sekcja pulpitu.
5. **Rachunki w jednym miejscu z filtrowaniem** — dziś filtr jest szczątkowy.
6. **Historia zmian** — kto zmienił kwotę albo pozycję.
7. **Własne wiadomości przypominające o płatności**, z **domyślną klasyczną treścią**
   wpisaną z góry. Mechanizm głosu produktu: humor tylko od człowieka, nigdy przy
   kwocie ani przy błędzie; treść widzi wyłącznie adresat.
8. **Morfowanie [+] w arkusz** — rozpisane w `docs/UI-UX.md` §4, niezbudowane.
9. **Nawigacja widoczna na każdym ekranie** i zakładki jako prawdziwe miejsca —
   decyzja w `docs/UI-UX.md` §3, niezbudowana. To jest korzeń większości bezsensów.
10. **Research** — konkurencja (Splitwise, Tricount, Settle Up), wzorce PWA na iOS
    i Androidzie, powiadomienia, fundamenty pod przyszłe wydanie natywne.

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

**Świadomie otwarte ryzyka** (nie do naprawy przypadkiem, ale nie do zapomnienia):
członek grupy może podmienić cudzy numer konta; po przekroczeniu 4,5 GB aplikacja kasuje
najstarsze zdjęcia **bez pytania**. Oba dotyczą zaufania, więc każdy nowy ekran ustawień
powinien się do nich odnieść.

**Waluty.** PLN / EUR / USD, kurs zapisywany w dniu dodania rachunku, waluty **nigdy się
nie mieszają** w jednym saldzie. Zbiorcze saldo mieszające waluty jest jawnie poza zakresem.

**Przypomnienia mają bramkę: jedno na sześć godzin.** Projektując własne szablony
wiadomości, trzeba pokazać tę granicę, a nie pozwolić w nią wejść i dostać odmowę.

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

**Odczyt paragonu przez AI przestał działać** (zgłoszenie właściciela). Kod jest
nietknięty: `runParseReceipt`, `httpsCallable(functions, 'parseReceipt')`, podgląd
do akceptacji i logika przycisku są na miejscu, kontrakt selektorów zielony.
Najbardziej prawdopodobna przyczyna leży poza kodem: **funkcja chmurowa potrzebuje
klucza do modelu, którego emulator nie ma**, a w `dev` aplikacja idzie na emulator.
Sprawdź to najpierw, zanim zaczniesz szukać regresji w interfejsie.

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
