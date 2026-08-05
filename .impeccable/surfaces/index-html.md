---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["src/main.js"]
---

Zakres: cała aplikacja BillSplitter (index.html + szablony w src/main.js). Tryb: Operate —
sukcesem jest domknięte rozliczenie, nie wrażenie. Przebudowa obejmuje ZARÓWNO świat wizualny,
JAK I przepływy: zakładanie grupy, dodawanie rachunku, pozycje z paragonu, rozliczenia i wpłaty
są projektowane od zera, nie przemalowywane.

Odbiorca i zadanie: ekipa 12–25 osób na wyjeździe albo wieczorem w lokalu, telefon w ręku,
słabe światło, hałas. Zadania w kolejności ważności: (1) zobaczyć, ile jestem winien i komu,
(2) odkliknąć swoje pozycje z paragonu, gdy robi to równocześnie cała ekipa, (3) domknąć dług
— przypomnij, wpłać, potwierdź.

Treść i dowód: prawdziwe kwoty z Firestore, pozycje odczytane z paragonu przez model AI,
rejestr wpłat z potwierdzeniami. Nic nie jest zmyślone; puste stany są realnymi stanami
produktu, nie ilustracją.

Ograniczenia: vanilla JS bez frameworka, Tailwind 3 kompilowany (żadnych klas sklejanych ze
stringów), kontrakt selektorów w src/selectors.contract.test.js i strażnik escapowania w
src/render.safety.test.js muszą zostać zielone. Offline i słaby zasięg to norma. Zero kont —
wejście linkiem, kodem pokoju albo kodem QR.

Kierunek (2026-08-04, zastępuje „druk zabezpieczony"): język nowoczesnej aplikacji mobilnej
przypięty referencjami właściciela z folderu `Referencje/` — białe podłoże, duże miękkie karty,
NASYCONY KOLOR NA CAŁYCH BLOKACH zamiast akcentów, gruby geometryczny grotesk, wielka kwota
z przygaszonymi końcówkami, stosy okrągłych awatarów ze zdjęciami, pigułkowe przełączniki,
pływająca dolna nawigacja. Poprzeczka rzemiosła: poziom wykonania z tych referencji.
Poprzedni kierunek (banknot, gilosz, mikrodruk, Bodoni, przygaszone barwniki) jest ANTY-REFERENCJĄ
— odrzucony przez właściciela w całości: kolory, typografia, ornament, układ i czytelność.

Zapamiętywalny moment — ŻYWY PARAGON: rachunek czyta się jak paragon, a gdy ekipa odklikuje
swoje pozycje, zdjęcia uczestników lądują na liniach na oczach patrzącego, w czasie rzeczywistym.
Współbieżność przestaje być obietnicą w opisie i staje się obrazem: widać, że pracuje was
piętnastu naraz. Konkurencja tego nie ma — tam jedna osoba wpisuje za wszystkich.

Nierozstrzygnięte: nazwa produktu i logo (musi być ANGIELSKA; polskie propozycje odrzucone,
BillSplitter zostaje tymczasowo); realne wsparcie kodów płatniczych ZBP i EPC w aplikacjach
bankowych — do sprawdzenia testem na telefonie; krótki kod pokoju i kod QR zamiast
dwudziestoznakowego identyfikatora dokumentu.
