        // Style: Tailwind kompilowany w buildzie (dawniej skrypt z cdn.tailwindcss.com).
        import './tailwind.css';
        // Importy Firebase (npm) + moduł obliczeń
        import {
            calculateAll, calculateAllForBill, buildLedger, simplifyDebts, fromGrosze, toGrosze,
            billSettleGate, billCountsInLedger, billSplitMode,
        } from './calc.js';
        import { unreadNudgeCount, hasRecentNudge, inboxItems, badgeCount, hasDot } from './nudges.js';
        import { myPlanRows, planVsPairwise } from './plan.js';
        import { billLedger, myBillsToPay, billSettledBy, myUnassigned, reconcileToPay, currenciesToPay, ledgerVisibleBills } from './perbill.js';
        import { itemQuantity, itemPickers, isPicked, unassignedItems, toggleItemPicker, splitItemByUnits } from './items.js';
        import {
            identityColor, initials, IDENTITY_COLORS,
            readableInk, colorFromControls, controlsFromColor, nearestAllowedHue, isReservedColor,
        } from './identity.js';
        // Kod QR rysowany lokalnie, w buildzie. Biblioteka bez zależności i bez sieci:
        // aplikacja pracuje offline, więc obrazek z cudzego serwera nie wchodzi w grę.
        // Pakiet NIE wchodzi do paczki startowej — dogrywa się dopiero przy rozwinięciu
        // kodu QR (patrz `loadQrcode`). Przy stole nikt go nie potrzebuje.
        import { initializeApp } from "firebase/app";
        import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "firebase/auth";
        import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, getDocFromCache, setDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, serverTimestamp, deleteDoc, deleteField, getDocs, runTransaction, increment, limit } from "firebase/firestore";
        import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject, connectStorageEmulator } from "firebase/storage";
        // `firebase/messaging` (25 kB) NIE wchodzi do paczki startowej. Powiadomienia
        // uruchamiają się dopiero po rejestracji service workera, a ta i tak czeka na
        // zdarzenie `load` — więc leniwe dogranie nie opóźnia niczego, co widać na ekranie.
        import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
        import { normalizeReceipt, receiptItemsToSharedCosts, receiptModifiersToGlobalCosts, receiptItemFlags, receiptCheck } from './receipt.js';

        // Config z ENV (jeśli podany) — inaczej wpisany na sztywno projekt produkcyjny.
        // Dzięki temu testy pushu jadą na osobnym projekcie-piaskownicy (.env.local),
        // a produkcyjny build bez env-ów zachowuje się dokładnie jak dotąd.
        const env = import.meta.env;
        const firebaseConfig = env.VITE_FIREBASE_PROJECT_ID ? {
          apiKey: env.VITE_FIREBASE_API_KEY,
          authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: env.VITE_FIREBASE_APP_ID,
        } : {
          apiKey: "AIzaSyDNyWvjy15al4ZN3QyajUl8lPFU_uAu9QA",
          authDomain: "billsplitter-2fdfa.firebaseapp.com",
          projectId: "billsplitter-2fdfa",
          storageBucket: "billsplitter-2fdfa.firebasestorage.app",
          messagingSenderId: "723187568149",
          appId: "1:723187568149:web:c924b01f9a2b326600081c"
        };
        
        const appId = 'bill-splitter-public';

        // Inicjalizacja Firebase
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
        const storage = getStorage(app);
        // Region musi zgadzać się z deklaracją w functions/index.js, inaczej wywołanie trafia w pustkę.
        const functions = getFunctions(app, 'europe-central2');

        // --- DEV: podłączenie do Firebase Emulator Suite (pełna izolacja od produkcji) ---
        // VITE_USE_EMULATOR=true wymusza emulator także w buildzie PROD — potrzebne do testów
        // pushu, bo service worker (warunek FCM) rejestruje się tylko w buildzie produkcyjnym.
        const USE_EMULATOR = env.VITE_USE_EMULATOR === 'true' || env.DEV;
        if (USE_EMULATOR) {
            connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            connectFirestoreEmulator(db, '127.0.0.1', 8770);
            connectStorageEmulator(storage, '127.0.0.1', 9199);
            connectFunctionsEmulator(functions, '127.0.0.1', 5001);
            console.info('[Billiada] Emulator Firebase (127.0.0.1) — żywe dane nietknięte.');
            if (!env.DEV) console.warn('[Billiada] UWAGA: build produkcyjny podpięty do EMULATORA (VITE_USE_EMULATOR=true). To build testowy, nie do wdrożenia.');
        }

        // Globalne zmienne stanu
        let currentUser = null;
        let currentGroupId = null;
        let currentBillId = null;
        let groupData = null;
        let billData = null;
        let exchangeRates = null;
        let unsubscribeGroup = null;
        // Nasłuch DOKUMENTU grupy (`unsubscribeGroup` trzyma zapytanie o rachunki — nazwa
        // jest zastana). Do 2026-08-26 wynik `onSnapshot` na dokumencie grupy nie był nigdzie
        // zapisywany, więc każda powtórna nawigacja do pokoju dokładała kolejny nasłuch:
        // po trzech wejściach każda zmiana imienia przerysowywała ekran trzy razy.
        let unsubscribeGroupDoc = null;
        let unsubscribeBill = null;
        let unsubscribeSettlements = null;
        let unsubscribeNudges = null;
        let unsubscribeEvents = null;
        // Nasłuch WYŁĄCZNIE od stanu łączności — patrz `watchConnectivity`.
        let unsubscribeNet = null;
        let latestEvents = []; // dziennik aktywności pokoju (append-only)
        let isAuthReady = false;
        let currentScreenName = null;
        // TRYB ROZLICZANIA JEST JEDEN I NALEŻY DO GRUPY — pole `settlementMode`
        // w dokumencie grupy (`'min'` | `'perBill'`). Brak pola znaczy `'min'`, więc żaden
        // istniejący pokój nie zmienia się sam z siebie po wgraniu tej wersji.
        //
        // NIE MA TRYBU WIDOKU (usunięty 2026-08-26, decyzja właściciela). Przez pół dnia
        // istniał przełącznik na ekranie Rozliczeń, którym dało się obejrzeć cudzy tryb
        // bez przycisków akcji. Wypadł, bo dwa tryby nie są dwoma widokami tych samych
        // pieniędzy: „Najmniej przelewów" prowadzi przelewy trasami, których żaden
        // rachunek nie stworzył, a tryb rachunkowy trzyma je przy rachunkach. To są dwa
        // różne sposoby wydawania pieniędzy, a nie dwa powiększenia — i każdy z nich
        // potrzebuje INNYCH informacji na Bilansie, w Rozliczeniach i na Rachunkach.
        let settleContext = null; // { to, currency, billIds } — kontekst modala „Ureguluj"
        // Która strona Rozliczeń jest na wierzchu: 'owe' (Płacisz) albo 'due' (Dostajesz).
        // Stan jest ULOTNY i tak ma zostać — to wybór na teraz, nie ustawienie pokoju.
        let settleSide = 'owe';
        // Czy stronę wybrał CZŁOWIEK (stuknięciem albo gestem), czy tylko podpowiedź przy
        // wejściu. Rozróżnienie jest potrzebne dokładnie w jednym miejscu: podpowiedź wolno
        // odbić z pustej strony, cudzy wybór — nie (patrz `renderSettlements`).
        let settleSideChosen = false;
        let paymentEditMethods = [];
        let paymentEditMemberId = null;
        let newBillState = { name: '', type: null, participantIds: [] };
        let photoToDelete = null; 
        let memberIdToTakeover = null;
        let deferredInstallPrompt = null;
        // ŻYWY PARAGON: kto był zapisany na której pozycji przy poprzednim renderze.
        // Różnica między tym a stanem z bazy mówi, czyja twarz WŁAŚNIE wskoczyła —
        // i tylko ona dostaje animację lądowania. Czyszczone przy wejściu na rachunek.
        let lastPickersByItem = new Map();
        
        const STORAGE_LIMIT_BYTES = 4.5 * 1024 * 1024 * 1024; // 4.5 GB
        // Odstęp między przypomnieniami do tej samej osoby. Dziesięć sekund, nie sześć
        // godzin: produkt ma domykać dług, a nie chronić dłużnika przed wierzycielem.
        const NUDGE_GATE_MS = 10 * 1000;

        // --- MOTYW: banknot w dzień, ten sam banknot pod lampą UV w nocy ---
        // Scena użycia to lokal wieczorem, więc ciemny nie jest fanaberią: jasny ekran
        // w półmroku oślepia i wymusza przymykanie oczu przy kwotach. Domyślnie idziemy
        // za ustawieniem systemu; ręczny wybór zapamiętujemy na urządzeniu.
        // DOMYŚLNY MOTYW JEST CIEMNY, niezależnie od ustawienia systemu (decyzja
        // właściciela 2026-08-15). Wcześniej aplikacja szła za systemem, więc pierwsze
        // wejście u kogoś z jasnym telefonem pokazywało wersję jasną — a scena użycia
        // to wieczór w lokalu i to ciemny jest tu stanem podstawowym, nie preferencją.
        // Motyw jasny NIE znika: zostaje pełnoprawnym wyborem w zakładce „Ty" i jest
        // pamiętany na urządzeniu.
        const THEME_KEY = 'billsplitter_theme';
        const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
        const activeTheme = () => storedTheme() || 'dark';
        const applyTheme = (theme) => {
            document.documentElement.dataset.theme = theme;
            // Pasek systemowy telefonu idzie za motywem aplikacji, inaczej nad ciemnym
            // ekranem wisi jasna listwa i widać szew.
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', theme === 'dark' ? '#0C0D11' : '#F5F6F8');
            // Ikona pokazuje motyw WŁĄCZONY TERAZ, ten sam stan co podpis obok.
            // Wcześniej pokazywała motyw docelowy: przy ciemnym świeciło słońce,
            // więc obrazek i podpis mówiły dwie różne rzeczy naraz.
            const icon = document.getElementById('theme-toggle-icon');
            if (icon) icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
            // Motyw siedzi w „Aplikacji" jako wiersz z wartością, nie jako ikona-zagadka
            // w nagłówku pokoju. Wiersz mówi wprost, co jest ustawione teraz.
            const value = document.getElementById('theme-toggle-value');
            if (value) value.textContent = theme === 'dark' ? 'Ciemny' : 'Jasny';
        };
        const toggleTheme = () => {
            const next = activeTheme() === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
            applyTheme(next);
        };

        // Motyw stosujemy od razu przy starcie, jeszcze zanim odpowie Firebase — inaczej
        // pierwsze sekundy w półmroku to biały ekran w twarz.
        //
        // Nasłuch zmiany ustawienia systemowego został usunięty razem z podążaniem za nim:
        // skoro domyślny motyw jest ciemny zawsze, przełączenie telefonu na jasny nie ma
        // prawa nic zmienić w aplikacji, a przełączanie ekranu pod palcami w trakcie
        // liczenia pieniędzy byłoby gorsze niż jakikolwiek zysk z automatyki.
        const setupTheme = () => {
            applyTheme(activeTheme());
            const btn = document.getElementById('theme-toggle-btn');
            if (btn) btn.onclick = toggleTheme;
        };

        // Kod pokoju czytany na głos przy stole i przepisywany z cudzego telefonu —
        // dzielimy go na czwórki, bo tak czyta się numer seryjny na banknocie.
        const formatSerial = (id) => String(id || '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

        // Kopiowanie ma jedno miejsce, bo zawodzi na trzy sposoby: brak API w starszym
        // WebView, odmowa uprawnienia i wywołanie spoza gestu użytkownika. Gdy się nie uda,
        // pokazujemy treść w toaście — użytkownik ma ją przepisać, a nie zostać z niczym.
        const copyText = (text, okMessage) => {
            const value = String(text || '');
            if (!value) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value)
                    .then(() => showToast(okMessage))
                    .catch(() => showToast('Do skopiowania: ' + value));
            } else {
                showToast('Do skopiowania: ' + value);
            }
        };

        // --- GŁÓWNA LOGIKA APLIKACJI ---
        function showToast(message, isError = false) {
            const toastId = 'toast-notification';
            let existingToast = document.getElementById(toastId);
            if (existingToast) existingToast.remove();
            const toast = document.createElement('div');
            toast.id = toastId;
            toast.textContent = message;
            // Nad dolną nawigacją, nie pod nią — inaczej komunikat chowa się za paskiem.
            // Błąd dostaje `role="alert"`, żeby czytnik ekranu przeczytał go od razu;
            // potwierdzenie idzie łagodniej i nie przerywa czytania.
            toast.setAttribute('role', isError ? 'alert' : 'status');
            // Bez `shadow-lift`: cień i obwódkę niesie teraz `.toast-dock`, bo muszą być
            // te same dla obu dymków (patrz uwaga przy `.toast-dock` w tailwind.css),
            // a klasa narzędziowa Tailwinda i tak wygrywałaby z regułą komponentu.
            toast.className = `toast-in toast-dock px-4 py-3 rounded-block font-semibold transition-opacity duration-300 ${isError ? 'bg-owe text-white' : 'bg-ink text-surface'}`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 400);
            }, 3600);
        }

        // --- NOWY RACHUNEK: ARKUSZ WYRASTA NAD PASKIEM ----------------------------
        //
        // Poprzednie rozwiązanie — morfowanie koła [+] w arkusz przez View Transitions
        // API — zostało wyrzucone 2026-08-15 po testach właściciela na iPhonie i NIE
        // WRACA. Trzy powody, wszystkie widoczne gołym okiem:
        //
        //   1. Limonkowe koło przenikało w BIAŁY arkusz. Między barwami o takiej różnicy
        //      jasności przenikanie nie czyta się jako przemiana przedmiotu, tylko jako
        //      mignięcie: „przycisk był seledynowy, a popup robi się biały".
        //   2. Przy zamykaniu przeglądarka najpierw pokazywała wielki limonkowy kształt
        //      ze znakiem [+] rozciągnięty na cały arkusz, a dopiero potem go zmniejszała.
        //      Wersja właściciela: „w jednym momencie robi się duży seledynowy kształt
        //      z plusem i się zmniejsza, bardzo nieestetycznie".
        //   3. Safari ma to API dopiero od osiemnastki, więc na sporej części telefonów
        //      i tak nie było żadnej animacji. Dopracowywaliśmy ruch, którego większość
        //      ekipy nigdy nie widziała.
        //
        // Zamiast tego: PASEK ZOSTAJE NA EKRANIE (klasa `keeps-deck` na oknie), arkusz
        // wyrasta tuż nad nim z punktem zaczepienia na dole, a koło [+] obraca się
        // o 135° w krzyżyk i przez cały czas jest tym samym przedmiotem. Nie zamienia
        // się w arkusz — otwiera go i zamyka. Nic nie przenika, nic nie zmienia koloru,
        // droga powrotna jest dokładnie odwrotna do drogi otwarcia, a całość to zwykłe
        // `transform` i `opacity`, więc działa wszędzie tak samo.
        const prefersReducedMotion = () =>
            !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

        // Podświetla element, którego wartość właśnie się zmieniła. Wywoływane po zapisie,
        // żeby było widać, ŻE się zapisało — bez tego udany zapis wygląda identycznie jak
        // nieudane kliknięcie. Klasę trzeba zdjąć i nałożyć ponownie, bo inaczej druga
        // zmiana z rzędu nic nie animuje.
        const flashValue = (el) => {
            if (!el) return;
            el.classList.remove('value-flash');
            void el.offsetWidth;
            el.classList.add('value-flash');
        };

        // Konwersja HEIC (zdjęcia z iPhone'a) wchodzi DOPIERO wtedy, gdy ktoś wybierze
        // taki plik. Biblioteka waży swoje, a większość wejść do aplikacji nie dotyka
        // zdjęć — nie ma powodu, żeby każdy płacił za nią czasem pierwszego otwarcia.
        // Wcześniej przychodziła z CDN-u: przy zablokowanym skrypcie zdjęcie z iPhone'a
        // po prostu nie wchodziło, i to bez zrozumiałego komunikatu.
        let heic2anyPromise = null;
        const loadHeic2Any = () => {
            if (!heic2anyPromise) heic2anyPromise = import('heic2any').then((m) => m.default || m);
            return heic2anyPromise;
        };

        const generateId = () => Math.random().toString(36).substring(2, 10);
        // Parsuje kwotę z przecinkiem/kropką (zasięg modułu — używane m.in. w „Ureguluj").
        const parseLocalFloat = (val) => parseFloat(String(val).replace(',', '.')) || 0;

        const formatSummary = (summaryObject) => {
            if (!summaryObject || Object.keys(summaryObject).length === 0) {
                return '0,00 PLN';
            }

            const currencyOrder = ['PLN', 'EUR', 'USD'];
            
            return Object.entries(summaryObject)
                .sort((a, b) => {
                    const indexA = currencyOrder.indexOf(a[0]);
                    const indexB = currencyOrder.indexOf(b[0]);
                    if (indexA === -1) return 1;
                    if (indexB === -1) return -1;
                    return indexA - indexB;
                })
                .map(([currency, amount]) => `${amount.toFixed(2).replace(".", ",")} ${currency}`)
                .join(' + ');
        };

        const fetchExchangeRates = async (base = 'PLN') => {
            try {
                const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
                if (!response.ok) throw new Error('Network response was not ok');
                const data = await response.json();
                exchangeRates = data;
                return exchangeRates;
            } catch (error) {
                console.error("Nie udało się pobrać kursów walut:", error);
                showToast("Nie udało się pobrać kursów walut.", true);
                return null;
            }
        };
        
        const handleUrlChange = () => {
            // POWRÓT Z RACHUNKU GESTEM OD KRAWĘDZI.
            //
            // Zgłoszenie właściciela: przy powrocie strzałką nie dzieje się nic dziwnego,
            // a przy powrocie gestem ekran miga i przeskakuje przewinięcie. Powód siedział
            // tutaj: gest wywołuje `popstate`, a ta funkcja zrywała WSZYSTKIE nasłuchy
            // bazy i szła przez `handleGroupJoin`, czyli przez ponowne pobranie dokumentu
            // pokoju z sieci. Ekran rozbierało się do zera i składało z powrotem po
            // odpowiedzi serwera — stąd mignięcie. Strzałka tego nie robiła, bo woła
            // `navigateToGroup` na danych, które już leżą w pamięci.
            //
            // Ten sam ruch ma wyglądać tak samo niezależnie od tego, czym się go wykonało.
            const back = new URLSearchParams(window.location.search);
            const backGroup = back.get('group');
            const backBill = back.get('bill');
            if (backGroup && backGroup === currentGroupId && !backBill && currentBillId && groupData) {
                if (unsubscribeBill) unsubscribeBill();
                unsubscribeBill = null;
                navigateToGroup(backGroup, false);
                return;
            }

            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeGroupDoc) unsubscribeGroupDoc();
            if (unsubscribeBill) unsubscribeBill();
            if (unsubscribeSettlements) unsubscribeSettlements();
            unsubscribeGroup = null;
            unsubscribeGroupDoc = null;
            unsubscribeBill = null;
            unsubscribeSettlements = null;

            const urlParams = new URLSearchParams(window.location.search);
            let groupId = urlParams.get('group');

            // POWRÓT DO OSTATNIEGO POKOJU.
            //
            // Skrót PWA z ekranu początkowego iPhone'a startuje z `start_url` z manifestu,
            // czyli bez `?group=…`, i lądował na liście pokoi za każdym razem. Na Androidzie
            // to samo dzieje się po zamknięciu karty. Skoro aplikacja obsługuje jeden pokój
            // naraz i prawie zawsze jest to ten sam pokój, otwieramy go od razu.
            //
            // Warunek jest jeden: nie robimy tego, gdy człowiek SAM wyszedł na listę pokoi
            // (strzałka w nagłówku albo opuszczenie pokoju). Znacznik siedzi w pamięci
            // SESJI, więc przetrwa przeładowanie po opuszczeniu pokoju, a zginie przy
            // następnym uruchomieniu aplikacji — dokładnie tak, jak trzeba.
            if (!groupId && !sessionStorage.getItem(SKIP_RESUME_KEY)) {
                const last = getMyRooms().sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))[0];
                if (last && last.id) {
                    groupId = last.id;
                    history.replaceState(null, '', `?group=${groupId}`);
                }
            }

            currentGroupId = groupId;

            if (groupId) {
                handleGroupJoin(groupId);
            } else {
                showScreen('start');
                groupData = null;
                billData = null;
            }
        };

        // Znacznik „człowiek chciał być na liście pokoi". Wyłącza automatyczny powrót
        // do ostatniego pokoju do końca tej sesji przeglądarki.
        const SKIP_RESUME_KEY = 'billsplitter_skip_resume';
        const goToRoomsList = () => {
            try { sessionStorage.setItem(SKIP_RESUME_KEY, '1'); } catch (_) {}
            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeGroupDoc) unsubscribeGroupDoc();
            if (unsubscribeBill) unsubscribeBill();
            if (unsubscribeSettlements) unsubscribeSettlements();
            if (unsubscribeNudges) unsubscribeNudges();
            if (unsubscribeEvents) unsubscribeEvents();
            // Nasłuch łączności też schodzi razem z pokojem — poza pokojem nie ma czego
            // pilnować, a zostawiony wisiałby na dokumencie, którego już nie oglądamy.
            if (unsubscribeNet) unsubscribeNet();
            unsubscribeGroup = unsubscribeGroupDoc = unsubscribeBill = unsubscribeSettlements = null;
            unsubscribeNudges = unsubscribeEvents = unsubscribeNet = null;
            netFromCache = false;
            renderNetBanner();
            currentGroupId = null;
            currentBillId = null;
            groupData = null;
            billData = null;
            history.pushState(null, '', window.location.pathname);
            showScreen('start');
        };

        const startAppLogic = () => {
            isAuthReady = true;
            const createBtn = document.getElementById('create-group-btn');
            createBtn.disabled = false;
            // Napis mówi, co jest do zrobienia TERAZ: dopóki lista jest pusta, przycisk
            // prosi o osobę, a nie udaje, że wszystko gotowe.
            const hasDraft = (document.getElementById('member-names') || {}).value;
            createBtn.textContent = hasDraft ? 'Załóż grupę' : 'Dodaj choć jedną osobę';
            
            handleUrlChange();
        };

        // --- ARKUSZ ZSUWANY PALCEM ----------------------------------------------
        // Uchwyt u góry arkusza obiecuje gest. Do 2026-08-15 niczego nie robił: był
        // rysunkiem czterdziestu pikseli, po którym palec zjeżdżał w dół i nic się nie
        // działo. To jest gorsze niż brak uchwytu — interfejs, który obiecuje i nie
        // dowozi, uczy nie ufać reszcie znaków.
        //
        // Teraz uchwyt naprawdę zsuwa. Ciągniemy za NAGŁÓWEK (uchwyt plus tytuł), nie za
        // całą powierzchnię: gdyby chwytać wszędzie, przewijanie listy w środku arkusza
        // co chwilę kończyłoby się jego zamknięciem. Wyjątek: gdy treść jest przewinięta
        // do samej góry, ciągnięcie po treści też zsuwa — tak działa arkusz systemowy
        // i tego ludzie próbują odruchowo.
        const SHEET_CLOSE_PX = 96;      // dystans, po którym arkusz się poddaje
        const SHEET_CLOSE_VELOCITY = 0.6; // px/ms — szybkie machnięcie zamyka wcześniej

        const wireSheetDrag = (modal) => {
            const sheet = modal.querySelector('.sheet');
            const head = modal.querySelector('.sheet-head');
            const body = modal.querySelector('.sheet-body');
            // Okno decyzji nieodwracalnej nie ma uchwytu i nie wolno go zsunąć.
            if (!sheet || !head || sheet.classList.contains('sheet-confirm')) return;

            let startY = 0, dy = 0, startedAt = 0, dragging = false, decided = false;

            const reset = () => {
                sheet.classList.remove('is-dragging');
                sheet.style.transform = '';
                dragging = false;
                decided = false;
                dy = 0;
            };

            const onDown = (e) => {
                // Na szerokości tabletu arkusz stoi na środku ekranu, a nie przy dolnej
                // krawędzi — nie ma go dokąd zsunąć, więc gest nie obowiązuje.
                if (window.matchMedia('(min-width: 640px)').matches) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                // Ciągnięcie po treści działa TYLKO przy liście przewiniętej na sam szczyt.
                if (e.target.closest('.sheet-body') && body && body.scrollTop > 0) return;
                // Pole tekstowe i przycisk zostawiamy w spokoju: tam palec ma inną robotę.
                if (e.target.closest('input, textarea, button, a, [contenteditable]') && !e.target.closest('.sheet-head')) return;
                // Czyścimy ślad po ewentualnym niedokończonym geście z poprzedniego razu.
                sheet.style.transform = '';
                startY = e.clientY;
                startedAt = performance.now();
                dragging = true;
                decided = false;
                dy = 0;
            };

            const onMove = (e) => {
                if (!dragging) return;
                const delta = e.clientY - startY;
                if (!decided) {
                    if (Math.abs(delta) < 8) return;
                    // W górę arkusz nie jedzie — nad nim nie ma miejsca.
                    if (delta < 0) { dragging = false; return; }
                    decided = true;
                    sheet.classList.add('is-dragging');
                    try { sheet.setPointerCapture(e.pointerId); } catch (_) {}
                }
                // Opór przy dole: pierwsze piksele idą jeden do jednego, dalsze coraz
                // wolniej. Bez tego arkusz odjeżdżał od palca i gubił wrażenie masy.
                dy = delta <= SHEET_CLOSE_PX ? delta : SHEET_CLOSE_PX + (delta - SHEET_CLOSE_PX) * 0.4;
                sheet.style.transform = `translateY(${dy}px)`;
            };

            const onUp = () => {
                if (!dragging) return;
                const velocity = dy / Math.max(1, performance.now() - startedAt);
                const shouldClose = decided && (dy > SHEET_CLOSE_PX || velocity > SHEET_CLOSE_VELOCITY);
                if (!shouldClose) { reset(); return; }
                // Przy zamknięciu NIE zerujemy przesunięcia od razu: arkusz podskoczyłby
                // wtedy z powrotem na miejsce i dopiero stamtąd zniknął, czyli gest palca
                // kończyłby się ruchem w przeciwną stronę. Przesunięcie znika dopiero po
                // domknięciu okna, gdy i tak nikt go nie widzi.
                dragging = false;
                decided = false;
                sheet.classList.remove('is-dragging');
                closeModal(modal);
                setTimeout(() => { sheet.style.transform = ''; dy = 0; }, 340);
            };

            head.addEventListener('pointerdown', onDown);
            if (body) body.addEventListener('pointerdown', onDown);
            sheet.addEventListener('pointermove', onMove);
            sheet.addEventListener('pointerup', onUp);
            sheet.addEventListener('pointercancel', onUp);
        };

        // Zamknięcie arkusza w jednym miejscu. `new-bill-modal` ma własną drogę wyjścia
        // (koło [+] w pasku musi wrócić z krzyżyka do plusa), więc przechodzi przez
        // własną funkcję. Przypisuje ją `addNewBillModalListeners`.
        let closeNewBillSheet = () => {};
        const closeModal = (modal) => {
            if (!modal) return;
            if (modal.id === 'new-bill-modal') { closeNewBillSheet(); return; }
            modal.classList.remove('active');
        };

        // --- ŁĄCZNOŚĆ MA TRZY STANY, NIE DWA -------------------------------------
        //
        // `navigator.onLine` mówi o KARCIE SIECIOWEJ, a nie o tym, czy cokolwiek dolatuje.
        // Stąd zgłoszenie właściciela: w trybie samolotowym aplikacja „od razu rozumie",
        // że jest offline, a na wifi bez internetu albo na jednej kresce udaje, że wszystko
        // gra — i milczy, zamiast powiedzieć, co się dzieje.
        //
        // Trzeci stan czytamy z metadanych nasłuchów Firestore: `fromCache` znaczy
        // „to, co widzisz, przyszło z pamięci, bo serwer nie odpowiada". SDK ustawia to
        // sam, bez dodatkowego odpytywania sieci.
        //
        // Licznik `netPending` liczy WŁASNE zapisy czekające na potwierdzenie serwera —
        // to jedyna liczba, która odpowiada na pytanie „czy moja zmiana na pewno poszła".
        let netFromCache = false;
        let netPending = 0;

        const renderNetBanner = () => {
            const banner = document.getElementById('offline-banner');
            const text = document.getElementById('offline-banner-text');
            if (!banner || !text) return;

            const czekaja = netPending > 0
                ? ` ${netPending} ${plural(netPending, 'zmiana czeka', 'zmiany czekają', 'zmian czeka')} na wysyłkę.`
                : '';

            let message = '';
            if (!navigator.onLine) message = `Brak sieci — pokazuję zapisane dane.${czekaja}`;
            else if (netFromCache) message = `Sieć nie odpowiada — pokazuję zapisane dane.${czekaja}`;
            else if (netPending > 0) message = `Wysyłam zmiany…${czekaja}`;

            banner.classList.toggle('hidden', message === '');
            if (message) text.textContent = message;
        };

        // Wołane z każdego nasłuchu, który dostaje metadane. Jeden wspólny stan dla całej
        // aplikacji — inaczej pasek mówiłby co innego w zależności od tego, który ekran
        // odrysował się ostatni.
        const noteSnapshot = (metadata) => {
            if (!metadata) return;
            const wasFromCache = netFromCache;
            netFromCache = metadata.fromCache === true;
            if (wasFromCache !== netFromCache) renderNetBanner();
        };

        // OSOBNY NASŁUCH TYLKO OD ŁĄCZNOŚCI — i to nie jest nadmiarowość.
        //
        // `onSnapshot` DOMYŚLNIE NIE ZGŁASZA zmian samych metadanych. Powrót serwera przy
        // niezmienionych danych nie wywołuje więc żadnego wywołania zwrotnego i pasek
        // zostaje zapalony na „Sieć nie odpowiada", choć wszystko już działa. Złapał to
        // dopiero przebieg `tools/audit-offline.mjs` — z samego kodu tego nie widać.
        //
        // Poprawka wymaga `includeMetadataChanges`, ale dokładanie go do nasłuchu grupy
        // kazałoby przerysowywać CAŁY pulpit przy każdym potwierdzeniu zapisu — a w trybie
        // rachunkowym takich potwierdzeń idzie kilka pod rząd. Dlatego stan łączności
        // dostaje własny, pusty nasłuch: zero rysowania, jedno zadanie.
        const watchConnectivity = (groupDocRef) => {
            if (unsubscribeNet) unsubscribeNet();
            unsubscribeNet = onSnapshot(
                groupDocRef,
                { includeMetadataChanges: true },
                (snap) => noteSnapshot(snap.metadata),
                (err) => console.warn('[Billiada] Nasłuch łączności przerwany:', err),
            );
        };

        // ZAPIS, KTÓRY NIE ZATRZYMUJE INTERFEJSU.
        //
        // Obietnica z `updateDoc`/`addDoc` rozwiązuje się dopiero po potwierdzeniu SERWERA —
        // offline NIGDY, choć zapis jest bezpiecznie zakolejkowany lokalnie i widać go na
        // ekranie. Każde `await` na takim zapisie zawiesza więc krok interfejsu przy słabej
        // sieci: arkusz się nie zamyka, potwierdzenie nie przychodzi, człowiek stuka drugi raz.
        //
        // Tutaj czekamy na SKUTEK, a nie na serwer: akcja idzie dalej od razu, a stan wysyłki
        // niesie pasek łączności. `await` zostaje wyłącznie tam, gdzie naprawdę potrzebna jest
        // odpowiedź serwera (odczyty, transakcje rozstrzygające konflikt).
        const fireWrite = (promise, failMessage) => {
            netPending += 1;
            renderNetBanner();
            Promise.resolve(promise)
                .catch((err) => {
                    console.warn('[Billiada] Zapis nieudany:', err);
                    if (failMessage) showToast(failMessage, true);
                })
                .finally(() => {
                    netPending = Math.max(0, netPending - 1);
                    renderNetBanner();
                });
        };

        // --- EKRAN WCZYTYWANIA MA BUDŻET CZASU -----------------------------------
        //
        // Kołowrotek bez terminu kręci się tak samo przy 200 ms i przy czterdziestu
        // sekundach, więc nie niesie żadnej informacji dokładnie wtedy, gdy jest najbardziej
        // potrzebna. Zasada: NIGDY niemy kołowrotek dłużej niż dwie sekundy.
        const LOADING_SPEAK_MS = 1500;
        const LOADING_GIVE_UP_MS = 4000;
        let loadingTimers = [];

        const setLoadingNote = (message) => {
            const note = document.getElementById('loading-note');
            if (!note) return;
            note.textContent = message;
            note.classList.toggle('hidden', !message);
        };

        const stopLoadingBudget = () => {
            loadingTimers.forEach(clearTimeout);
            loadingTimers = [];
            setLoadingNote('');
        };

        const startLoadingBudget = () => {
            stopLoadingBudget();
            loadingTimers = [
                setTimeout(() => setLoadingNote('Łączę się…'), LOADING_SPEAK_MS),
                setTimeout(() => setLoadingNote('Sieć nie odpowiada — wchodzę na zapisane dane.'), LOADING_GIVE_UP_MS),
            ];
        };

        const init = () => {
            setupTheme();
            showScreen('loading');

            // ODZEW DOTKNIĘCIA NA iOS. Safari nie stosuje pseudoklasy `:active` do
            // niczego, dopóki dokument nie ma choćby jednego nasłuchu dotyku. Bez tej
            // jednej linijki CAŁY odzew wciśnięcia (`.btn:active`, `.tap:active`,
            // `.person-row:active`) był na iPhonie martwy — i to jest odpowiedź na
            // zgłoszenie „brakuje mi drobnego feedbacku przy kliknięciu, jest statycznie".
            document.body.addEventListener('touchstart', () => {}, { passive: true });

            // PRZYBLIŻANIE SZCZYPANIEM. iOS ignoruje `user-scalable=no` w atrybucie
            // `viewport` od dziesiątej wersji, więc gest trzeba odrzucić wprost.
            // `gesturestart` jest zdarzeniem wyłącznie Safari i wyłącznie o skalowaniu,
            // więc nie odbiera niczego innego.
            ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
                document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
            });

            document.querySelectorAll('.modal').forEach(wireSheetDrag);

            window.addEventListener('popstate', handleUrlChange);

            onAuthStateChanged(auth, (user) => {
                if (user) {
                    if (!isAuthReady) {
                        currentUser = user;
                        startAppLogic();
                    }
                } else {
                    signInAnonymously(auth).catch(error => {
                        console.error("Błąd anonimowego logowania:", error);
                        showToast("Nie można połączyć z usługą.", true);
                    });
                }
            });
            setupStartScreenListeners();
            addNewBillModalListeners();
            setupPhotoUploadListeners();
            setupGlobalModalListeners();
            setupPwaInstallButton();
            setupDeckNav();
            setupEdgeBack();
            watchKeyboardForDeck();
            setupPersonSearch();
            registerServiceWorker();
            showViewportDiagnostics();

            // Faza 5: wskaźnik łączności (Firestore persistentLocalCache i tak kolejkuje zmiany).
            // Od 2026-08-25 trzy stany zamiast dwóch — patrz `renderNetBanner`.
            window.addEventListener('online', renderNetBanner);
            window.addEventListener('offline', renderNetBanner);
            renderNetBanner();

            // Faza 3/4: kopiowanie danych płatności (delegacja — przetrwa przerenderowania; uniwersalne dla każdej metody).
            document.addEventListener('click', (e) => {
                const copyBtn = e.target.closest('.copy-account-btn');
                if (!copyBtn) return;
                e.stopPropagation();
                copyText(copyBtn.dataset.account || '', 'Skopiowano!');
            });

            // Faza 4: na focusie przewiń pole nad klawiaturę (mobile).
            document.addEventListener('focusin', (e) => {
                const t = e.target;
                if (window.innerWidth < 768 && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
                    setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 300);
                }
            });
        };

        // --- Faza 4: „Moje pokoje" — lista dołączonych pokoi (localStorage, przypięta do urządzenia) ---
        //
        // UWAGA PRZY ZMIANIE NAZWY PRODUKTU: przedrostek `billsplitter_` w kluczach
        // pamięci lokalnej ZOSTAJE, mimo że aplikacja nazywa się teraz Billiada.
        // Te klucze to jedyny ślad po pokojach, motywie i szablonach na urządzeniu.
        // Zmiana przedrostka wyczyściłaby listę pokoi każdemu, kto już aplikacji używa,
        // a odzyskanie pokoju wymagałoby kodu od kogoś innego. Nazwa klucza nikomu się
        // nie wyświetla, więc nie ma tu nic do zyskania.
        const ROOMS_KEY = 'billsplitter_rooms';
        const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const getMyRooms = () => { try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || []; } catch { return []; } };
        const saveMyRooms = (rooms) => { try { localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms)); } catch {} };
        const rememberRoom = (id, name) => {
            if (!id) return;
            const rooms = getMyRooms().filter(r => r.id !== id);
            rooms.unshift({ id, name: name || 'Pokój', lastVisited: Date.now() });
            saveMyRooms(rooms);
        };
        const forgetRoom = (id) => saveMyRooms(getMyRooms().filter(r => r.id !== id));

        // POKÓJ NA LIŚCIE: KASOWANIE PRZESUNIĘCIEM, NIE KRZYŻYKIEM.
        //
        // Do 2026-08-15 przy każdym pokoju stał krzyżyk. Leżał dokładnie tam, gdzie
        // kciuk trzyma telefon, a jedno stuknięcie kasowało wpis — za tanio jak na
        // „zniknij mi to z ekranu", zwłaszcza że w pokoju bez zapisanego linku powrót
        // wymaga wtedy kodu od kogoś innego. Teraz kafelek przesuwa się palcem w lewo
        // i dopiero wtedy odsłania czerwony kosz (decyzja właściciela 2026-08-15).
        // Gest jest odwracalny: puszczenie przed połową drogi zwija kafelek z powrotem.
        const SWIPE_REVEAL_PX = 88;

        const renderMyRooms = () => {
            const container = document.getElementById('my-rooms');
            if (!container) return;
            const rooms = getMyRooms().sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
            if (rooms.length === 0) { container.innerHTML = ''; return; }
            container.innerHTML = `
                <h3 class="font-display text-2xl font-bold mb-1 text-left">Twoje pokoje</h3>
                <p class="text-sm text-ink-3 mb-3">Przesuń kafelek w lewo, żeby usunąć pokój z listy na tym telefonie.</p>
                <div class="space-y-2">
                    ${rooms.map(r => `
                        <div class="room-swipe">
                            <button class="room-forget-btn room-swipe-delete" data-room-id="${r.id}" title="Usuń z listy na tym urządzeniu" aria-label="Usuń pokój ${escapeHtml(r.name)} z listy"><i class="fas fa-trash"></i></button>
                            <button class="enter-room-btn room-swipe-face card tap w-full flex items-center justify-between gap-2 p-4 min-h-tap text-left" data-room-id="${r.id}">
                                <span class="font-semibold truncate">${escapeHtml(r.name)}</span>
                                <i class="fas fa-arrow-right text-ink-3 flex-shrink-0"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <div class="flex items-center my-6"><div class="flex-grow border-t border-ink/15"></div><span class="px-3 text-xs font-bold text-ink-3">albo nowy pokój</span><div class="flex-grow border-t border-ink/15"></div></div>
            `;
            container.querySelectorAll('.room-swipe').forEach(wireRoomSwipe);
        };

        // Obsługa gestu. Trzymamy się wskaźników (`pointer*`), a nie zdarzeń dotyku:
        // to jedno API na palec, rysik i mysz, więc na komputerze gest też działa.
        const wireRoomSwipe = (row) => {
            const face = row.querySelector('.room-swipe-face');
            if (!face) return;
            let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, open = false;

            const setX = (x) => { face.style.transform = `translateX(${x}px)`; };
            const close = () => { open = false; face.classList.remove('is-dragging'); setX(0); };

            face.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                startX = e.clientX; startY = e.clientY; dx = 0;
                dragging = true; decided = false;
            });

            face.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const mx = e.clientX - startX;
                const my = e.clientY - startY;
                // Dopóki nie wiadomo, czy to przewijanie strony, czy przesuwanie kafelka,
                // nie ruszamy niczego. Rozstrzyga pierwsze wyraźne 10 px: pion oddaje
                // gest stronie, poziom zabiera go dla siebie.
                if (!decided) {
                    if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
                    decided = true;
                    if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; }
                    face.classList.add('is-dragging');
                    face.setPointerCapture(e.pointerId);
                }
                // W prawo nic nie odsłaniamy — kosz jest tylko po jednej stronie.
                dx = Math.max(-SWIPE_REVEAL_PX, Math.min(0, (open ? -SWIPE_REVEAL_PX : 0) + mx));
                setX(dx);
            });

            const finish = () => {
                if (!dragging) return;
                dragging = false;
                face.classList.remove('is-dragging');
                if (!decided) return;
                open = dx < -SWIPE_REVEAL_PX / 2;
                setX(open ? -SWIPE_REVEAL_PX : 0);
            };
            face.addEventListener('pointerup', finish);
            face.addEventListener('pointercancel', finish);

            // Stuknięcie w odsłonięty kafelek zwija go z powrotem, zamiast wchodzić
            // do pokoju: pierwszy ruch po odsłonięciu kosza to prawie zawsze „jednak nie".
            face.addEventListener('click', (e) => {
                if (decided) { e.preventDefault(); e.stopPropagation(); }
                if (open) { e.preventDefault(); e.stopPropagation(); close(); }
            }, true);

            row.querySelector('.room-forget-btn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = row.querySelector('.room-forget-btn').dataset.roomId;
                const name = (getMyRooms().find((r) => r.id === id) || {}).name || 'Pokój';
                openConfirm({
                    title: 'Usunąć z listy?',
                    body: `„${name}" zniknie z listy na tym telefonie. Sam pokój, rachunki i rozliczenia zostają. Wrócisz do niego kodem albo linkiem.`,
                    confirmLabel: 'Usuń z listy',
                    onConfirm: async () => { forgetRoom(id); renderMyRooms(); showToast('Usunięto z listy.'); },
                });
                close();
            });
        };

        // --- Faza 4: kontekstowy tutorial „?" per ekran ---
        // Treści przejrzane 2026-08-15 pod kątem zgodności z tym, co aplikacja NAPRAWDĘ
        // robi. Poprzednia wersja mówiła o imionach „po przecinku" (od dawna dodaje się
        // je pojedynczo), o filtrze „Wszystkie / Ukryte" (filtrów jest pięć) i o ręcznym
        // statusie uczestnika (już nie istnieje). Pomoc, która opisuje nieistniejący
        // ekran, jest gorsza od braku pomocy: uczy szukać czegoś, czego nie ma.
        const HELP_CONTENT = {
            'start': {
                title: 'Jak zacząć',
                html: `<p><b>Zrób zdjęcie paragonu, a ekipa odklika swoje pozycje.</b> Bez kont i bez logowania.</p>
                    <p>Billiada dzieli rachunki w grupie znajomych i liczy, kto komu ile jest winien.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li>Nazwij grupę i dopisz osoby pojedynczo. Resztę ekipy dodasz później.</li>
                        <li>Zaproś znajomych linkiem, kodem pokoju albo kodem QR. Każdy wybiera swoje imię z listy.</li>
                        <li>Dodajecie rachunki, a aplikacja liczy podział. Grosze zawsze na korzyść płatnika.</li>
                        <li>Masz kod pokoju od kogoś? Wpisz go w polu wyżej. Spacja i wielkość liter nie mają znaczenia.</li>
                    </ul>
                    <p>Pokoje zapisują się na tym telefonie. Przy następnym uruchomieniu aplikacja otworzy ten, w którym byłeś ostatnio.</p>`
            },
            'join': {
                title: 'Dołączanie do grupy',
                html: `<ul class="list-disc pl-5 space-y-1">
                        <li>Wybierz swoje imię z listy, żeby dołączyć.</li>
                        <li>Wygaszone imię jest już zajęte. Jeśli to Ty na innym urządzeniu, możesz przejąć sesję.</li>
                        <li>Po wejściu ustawisz swoje zdjęcie, kolor znaku i sposoby płatności.</li>
                    </ul>`
            },
            'group-dashboard': {
                title: 'Pokój: co gdzie jest',
                html: `<p>Pasek na dole to cztery miejsca w pokoju i jeden przycisk akcji pośrodku.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Bilans</b>: ile jesteś na plusie albo na minusie. To jedna liczba, po którą tu wchodzisz.</li>
                        <li><b>Rozliczenia</b>: kto komu ile oddaje. „Ureguluj" zapisuje wpłatę, a odbiorca ją potwierdza. Stamtąd wchodzi się też do rejestru wpłat.</li>
                        <li><b>[+]</b> pośrodku: nowy rachunek. Po otwarciu ten sam przycisk zamienia się w krzyżyk i zamyka okno.</li>
                        <li><b>Rachunki</b>: wszystkie rachunki pokoju z pięcioma filtrami, od „Czekają na Ciebie" po „Ukryte".</li>
                        <li><b>Ty</b>: Twoje zdjęcie, kolor znaku, sposoby płatności i ustawienia aplikacji.</li>
                    </ul>
                    <p><b>Nazwa pokoju u góry</b> otwiera ustawienia pokoju: kod, link, kod QR, waluta domyślna, skład grupy i wyjście z pokoju.</p>
                    <p><b>Strzałka w lewo</b> obok nazwy wraca do listy Twoich pokoi. Nie zwalnia imienia, tylko wychodzi z pokoju.</p>`
            },
            // ROZLICZENIA MAJĄ WŁASNĄ POMOC, bo z ich ekranu zszedł 2026-08-29 akapit
            // wstępny. Wyjaśnienie nie zniknęło — przeniosło się tam, gdzie wolno mu być
            // dłuższe i gdzie nikt go nie czyta drugi raz wbrew sobie.
            'group-dashboard:view-settle': {
                title: 'Rozliczenia: kto komu oddaje',
                html: `<p><b>Ekran ma dwie strony.</b> „Płacisz" to Twoje długi, „Dostajesz" to cudze wobec Ciebie. Przełączasz je stuknięciem albo przesunięciem palcem w bok.</p>
                    <p>Sprawy zbierają się w <b>stosy</b>. Zwinięty stos pokazuje jedną sprawę z pełnymi szczegółami i ma zawsze tę samą wysokość — czy leżą w nim dwie sprawy, czy czterdzieści. Strzałka przy nazwie stosu rozwija go w listę; wtedy każdy wiersz da się rozwinąć osobno, żeby zobaczyć, za jakie rachunki jest ten przelew.</p>
                    <p><b>Sposób rozliczania wybiera się raz, w ustawieniach pokoju</b>, i to on decyduje, jak wyglądają te strony:</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Rachunek po rachunku</b>: każdy przelew idzie do osoby, która wyłożyła pieniądze. Kwota przy imieniu to suma jej rachunków, których jeszcze nie oddałeś — przy regulowaniu wybierasz, które z nich pokrywasz.</li>
                        <li><b>Najmniej przelewów</b>: aplikacja szuka najkrótszej drogi dla całej ekipy, więc część długów przechodzi bokiem. Możesz tu nie mieć nic do zapłaty, mimo że para po parze jesteś komuś winien — Twój dług spłaca ktoś, kto jest winien Tobie. Plan przelicza się od nowa po każdym nowym rachunku.</li>
                    </ul>
                    <p><b>Wpłata ma dwie strony.</b> „Ureguluj" zapisuje, że wysłałeś pieniądze; odbiorca dostaje pytanie „masz ten przelew?" i odpowiada „Mam" albo „Nie widzę". Dopóki nie odpowie, dług wisi dalej — a po odmowie wraca na saldo i sprawa trafia do stosu „Do wyjaśnienia".</p>
                    <p><b>Rejestr</b> (zegar w nagłówku) to spis wszystkiego, co ruszyło pieniądze: wpłaty i zmiany kwot, od najnowszego.</p>`
            },
            'profile': {
                title: 'Ty i aplikacja',
                html: `<ul class="list-disc pl-5 space-y-1">
                        <li><b>Imię, zdjęcie i kolor znaku</b>: tak widzi Cię ekipa przy pozycjach rachunku.</li>
                        <li><b>Sposoby płatności</b>: konto, telefon, Revolut, PayPal, Wise albo własna nazwa. Znajomi zobaczą je przy Twoich należnościach, a te, które da się otworzyć, dostaną przycisk otwierający aplikację.</li>
                        <li><b>Aplikacja</b> to ustawienia tego telefonu: powiadomienia o zaległościach, motyw jasny albo ciemny, instalacja na ekranie początkowym.</li>
                    </ul>
                    <p>Ile kto wydał w tym pokoju znajdziesz w ustawieniach pokoju, pod nazwą grupy.</p>`
            },
            'bill': {
                title: 'Rachunek',
                html: `<p><b>Jeden rachunek, który rośnie.</b> Zacznij od samej kwoty. Reszta jest opcjonalna i dopisujesz ją wtedy, gdy jest potrzebna.</p>
                    <p><b>Jak dzielimy</b> to jedyna decyzja o kształcie rachunku:</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Po równo</b>: cała kwota dzieli się na uczestników i nikt niczego nie uzupełnia.</li>
                        <li><b>Ze swoimi kosztami</b>: każdy stuka swoje pozycje i wpisuje koszty własne. Wszystko, czego nikt nie weźmie imiennie, i tak dzieli się po równo.</li>
                    </ul>
                    <p>Status „uzupełnione" liczy się sam z tego, co stoi w rachunku. Nie trzeba go nigdzie ustawiać.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Pozycje z paragonu</b>: zrób zdjęcie i odczytaj je, a potem <b>stuknij linie, które jadłeś</b>. Cena pozycji dzieli się po równo między wszystkich, którzy ją stuknęli, a ich zdjęcia pojawiają się na linii na żywo.</li>
                        <li>Pozycję o ilości większej niż 1 możesz <b>podzielić na sztuki</b> (ołówek, potem „Podziel na sztuki"), gdy każdą sztukę wziął kto inny.</li>
                        <li><b>Pozycja dla wszystkich</b> to napiwek, serwis albo wino na stół. Dodajesz ją tym samym przyciskiem, co każdą inną, i zaznaczasz w arkuszu „Dla wszystkich": dzieli się po równo, nikt nie musi jej stukać, a jej kwotę można podać też jako procent rachunku.</li>
                        <li><b>Koszt tylko Twój</b> to coś, co zamówiłeś wyłącznie dla siebie.</li>
                        <li><b>Suma pozycji</b> pilnuje, żeby wpisy nie przekroczyły kwoty rachunku. Niedobór nie jest błędem: to właśnie ta część, która idzie po równo.</li>
                        <li>Grosze zaokrąglają się w górę, żeby płatnik nigdy nie był stratny.</li>
                        <li>Na koniec wskaż płatnika i potwierdź, że to on wyłożył pieniądze.</li>
                    </ul>
                    <p><b>Podział reszty.</b> Dopóki na rachunku wisi kwota, której nikt nie wziął, nie da się go rozliczać — inaczej ten, kto stuknął swoje, dopłacałby za tego, kto tego nie zrobił.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li>Jeśli pozycje pokrywają całą kwotę, rachunek jest <b>gotowy od razu</b> i nikt niczego nie zatwierdza.</li>
                        <li>Jeśli coś zostaje, resztę dzieli <b>płatnik</b> (albo osoba, która założyła pokój) i decyduje, czy idzie po równo, czy do tych, którzy nie stuknęli swoich pozycji.</li>
                        <li>Kto dostał taką resztę, widzi to przy swojej kwocie i może stuknąć <b>„To nie moje"</b> — wtedy płatnik dostanie prośbę o cofnięcie podziału.</li>
                        <li>Rachunki, które jeszcze się uzupełniają, nie liczą się do salda — wchodzą do niego dopiero, gdy są gotowe.</li>
                    </ul>`
            }
        };

        // Jedno okno informacyjne na całą aplikację. Pomoc spod „?" i wyjaśnienia typu
        // „czemu nie mogę tego uregulować" to ta sama rzecz: tekst do przeczytania i wyjście.
        // Osobne okno na każde z nich znaczyłoby dwa wyglądy tej samej czynności.
        const showInfo = (title, html) => {
            document.getElementById('help-modal-title').textContent = title;
            document.getElementById('help-modal-body').innerHTML = html;
            document.getElementById('help-modal').classList.add('active');
        };

        // POMOC ZNA ZAKŁADKĘ, NIE TYLKO EKRAN (2026-08-29). Pulpit to trzy różne miejsca
        // pod jednym „?", a wykład o rozliczeniach zszedł z ekranu Rozliczeń właśnie tutaj
        // — więc musi się otwierać wtedy, gdy stoję na Rozliczeniach, a nie na Bilansie.
        // Klucz szczegółowy wygrywa, ogólny jest zapasem dla zakładek, które własnego nie mają.
        const showHelp = () => {
            const content = HELP_CONTENT[`${currentScreenName}:${currentDeckView}`] || HELP_CONTENT[currentScreenName];
            if (!content) return;
            showInfo(content.title, content.html);
        };

        // --- DOLNA NAWIGACJA — kciuk pracuje w dolnej trzeciej ekranu ---
        // Zakładka jest MIEJSCEM, nie skokiem przewijania. Wcześniej pulpit był jedną
        // długą stroną, a pasek przewijał do sekcji: przy pustym pokoju nie było dokąd
        // przewinąć i stuknięcie wyglądało na nieskuteczne, a podświetlenie skakało po
        // każdym ruchu palca. Teraz każdy segment pokazuje swój widok i nic nie kłamie.
        const DECK_NAV_VIEWS = {
            'nav-room': 'view-balance',
            'nav-settle': 'view-settle',
            'nav-bills': 'view-bills',
        };

        // Który widok pulpitu jest otwarty — pamiętany, żeby powrót z rachunku albo
        // z profilu wracał tam, skąd się wyszło, a nie zawsze na bilans.
        let currentDeckView = 'view-balance';

        // --- PODGLĄD WYMIARÓW OKNA (ukryty) -----------------------------------------
        // Narzędzie diagnostyczne, nie funkcja aplikacji. Powstało po trzech podejściach
        // do jednego zgłoszenia („pasek nawigacji stoi za wysoko", „na dole został pas"),
        // z których każde było zgadywaniem: przeglądarka na komputerze pokazuje inne
        // liczby niż iPhone z ikony, a zdalnie nie da się ich zmierzyć inaczej niż
        // pytając człowieka o zrzut. Panel pokazuje wszystkie miary naraz, więc jeden
        // zrzut rozstrzyga, która warstwa jest za krótka.
        //
        // WŁĄCZA GO GEST, NIE ADRES. Aplikacja uruchomiona z ikony na ekranie początkowym
        // nie ma paska adresu, więc `?diag=1` byłby tam nieosiągalny — a to właśnie tam
        // objawy występują. Pięć stuknięć w znak firmowy albo w numer pokoju, w ciągu
        // półtorej sekundy; parametr w adresie zostaje jako droga na komputerze.
        const DIAG_TAPS = 5;
        let diagTaps = 0;
        let diagTimer = null;

        const showViewportDiagnostics = () => {
            document.addEventListener('click', (e) => {
                // Cel gestu został JEDEN: znak firmowy na liście pokoi (2026-08-26).
                // Drugim był kod pokoju w nagłówku pulpitu, ale zniknął. Nazwa pokoju nie
                // nadaje się na zamiennik — otwiera ustawienia, więc pięć stuknięć otwierałoby
                // arkusz pięć razy i podgląd wylądowałby pod nim. Lista pokoi ma ten sam
                // rozmiar okna, co pulpit, więc narzędzie mierzy dokładnie to samo.
                if (!e.target.closest('.brand-lockup')) return;
                clearTimeout(diagTimer);
                diagTaps += 1;
                diagTimer = setTimeout(() => { diagTaps = 0; }, 1500);
                if (diagTaps < DIAG_TAPS) return;
                diagTaps = 0;
                const open = document.getElementById('viewport-diag');
                if (open) open.remove();
                else buildViewportDiagnostics();
            });
            if (new URLSearchParams(window.location.search).get('diag') === '1') {
                buildViewportDiagnostics();
            }
        };

        const buildViewportDiagnostics = () => {
            if (document.getElementById('viewport-diag')) return;
            const box = document.createElement('div');
            box.id = 'viewport-diag';
            document.body.appendChild(box);
            const read = () => {
                const vv = window.visualViewport;
                const cs = getComputedStyle(document.documentElement);
                const inset = (side) => cs.getPropertyValue(`--probe-${side}`).trim() || '?';
                const sc = document.getElementById('app-scroll');
                const deck = document.getElementById('deck-nav');
                const deckRect = deck ? deck.getBoundingClientRect() : null;
                box.innerHTML = [
                    `screen ${window.screen.width}×${window.screen.height}`,
                    `inner ${window.innerWidth}×${window.innerHeight}`,
                    `docEl ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
                    vv ? `visual ${Math.round(vv.width)}×${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : 'visual —',
                    sc ? `scroll ${Math.round(sc.getBoundingClientRect().height)} (tresc ${sc.scrollHeight})` : 'scroll —',
                    deckRect ? `deck dol ${Math.round(window.innerHeight - deckRect.bottom)} px od dolu` : 'deck —',
                    `safe gora ${inset('top')} / dol ${inset('bottom')}`,
                    `standalone ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true}`,
                    'stuknij 5× w znak, żeby zamknąć',
                ].map((t) => `<span>${t}</span>`).join('');
            };
            read();
            if (window.visualViewport) window.visualViewport.addEventListener('resize', read);
            window.addEventListener('resize', read);
            box.addEventListener('click', read);
        };

        // PRZEWIJANIE MIESZKA W `#app-scroll`, NIE W DOKUMENCIE.
        // Dokument ma stałą wysokość i zero przewijania, żeby na iPhonie z ikony nie dało
        // się go rozciągnąć na końcu listy — bo to rozciąganie ciągnęło za sobą pasek
        // nawigacji. Wszystkie odczyty i zapisy pozycji idą więc przez ten kontener;
        // `window.scrollY` zwraca tu teraz zawsze zero i jest bezużyteczne.
        const appScroll = () => document.getElementById('app-scroll');
        const appScrollTop = () => { const el = appScroll(); return el ? el.scrollTop : 0; };
        const appScrollTo = (top) => { const el = appScroll(); if (el) el.scrollTop = top; };

        const setDeckNavCurrent = (btnId) => {
            document.querySelectorAll('#deck-nav .deck-btn').forEach(btn => {
                if (btn.id === btnId) btn.setAttribute('aria-current', 'page');
                else btn.removeAttribute('aria-current');
            });
        };

        const showDeckView = (viewId) => {
            currentDeckView = viewId;
            Object.values(DECK_NAV_VIEWS).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('hidden', id !== viewId);
            });
            const btnId = Object.keys(DECK_NAV_VIEWS).find(k => DECK_NAV_VIEWS[k] === viewId);
            if (btnId) setDeckNavCurrent(btnId);
            // Przewijamy na górę TYLKO wtedy, gdy strona faktycznie jest przewinięta.
            // Bezwarunkowe przewinięcie na górę w Safari na iPhonie rozwija pasek adresu, a to
            // zmienia wysokość widocznego obszaru i przesuwa wszystko, co jest przypięte
            // do dolnej krawędzi. Jedno zbędne przewinięcie kosztowało skok paska
            // nawigacji przy każdej zmianie zakładki.
            if (appScrollTop() > 0) appScrollTo(0);
            // Odsunięty wiersz rachunku nie może przeżyć wyjścia z zakładki. Zmiana widoku
            // tylko ukrywa węzły, więc bez tego wiersz zastawał odsunięty i po powrocie
            // wyglądał na zepsuty — „jest przesunięty, choć go nie ruszałem".
            zamknijWiersz();
            refreshDeckPin();
            // Taśma rozliczeń dostaje wysokość Z KODU, a element ukryty ma wysokość zero —
            // więc gdy przerysowanie z bazy trafiło w moment, w którym stoimy na innej
            // zakładce, taśma zapamiętałaby zero i po powrocie strona byłaby pusta.
            // Dopinamy ją w chwili, gdy zakładka realnie staje się widoczna.
            if (viewId === 'view-settle') settlePanesSync({ animate: false });
        };

        const setupDeckNav = () => {
            Object.entries(DECK_NAV_VIEWS).forEach(([btnId, viewId]) => {
                const btn = document.getElementById(btnId);
                if (!btn) return;
                btn.onclick = () => {
                    if (currentScreenName !== 'group-dashboard') showScreen('group-dashboard');
                    showDeckView(viewId);
                    if (btnId === 'nav-bills') markBillsSeen();
                    // „Odbiorca potwierdził Twoją wpłatę" domyka pętlę i nie ma czego
                    // obsłużyć — gaśnie po obejrzeniu. Do 2026-08-26 gasło WYŁĄCZNIE po
                    // otwarciu skrzynki spod dzwonka; odkąd Bilans jest głównym domem spraw
                    // ruszających saldo, wiersz zostawałby tam w nieskończoność u kogoś,
                    // kto do skrzynki nigdy nie zagląda. Gasimy na ŚWIADOME wejście
                    // na zakładkę, nie na samo narysowanie ekranu — tak samo jak kropkę
                    // na „Rachunkach".
                    if (btnId === 'nav-room') markConfirmationsSeen();
                };
            });
            const meBtn = document.getElementById('nav-me');
            if (meBtn) meBtn.onclick = () => { renderProfile(); renderPushToggle(); showScreen('profile'); };

            // Wyjście z pokoju na listę pokoi. Strzałka w lewo znaczy w tej aplikacji
            // „o poziom wyżej" — tak samo jak na ekranie rachunku. Nie myl tego
            // z „Opuść pokój": tam zwalniamy imię, tu tylko wychodzimy.
            const roomsBtn = document.getElementById('back-to-rooms-btn');
            if (roomsBtn) roomsBtn.onclick = () => goToRoomsList();

            // TA SAMA DROGA Z EKRANU WYBORU IMIENIA. Ten ekran nie ma jeszcze pokoju
            // w rozumieniu „mojego", ale ma dokładnie to samo wyjście: `goToRoomsList`
            // zrywa nasłuchy, czyści adres i stawia znacznik „człowiek chciał być na
            // liście pokoi", więc aplikacja nie wciągnie go z powrotem samoczynnie.
            const joinBackBtn = document.getElementById('join-back-btn');
            if (joinBackBtn) joinBackBtn.onclick = () => goToRoomsList();
        };

        // --- PASEK NAWIGACJI A KLAWIATURA -------------------------------------------
        //
        // TU BYŁA POPRAWKA, KTÓRA SAMA BYŁA USTERKĄ. Przez trzy podejścia próbowałem
        // „kompensować" pasek przeglądarki: liczyć, ile dolnej części układu jest
        // przykryte, i podnosić o tyle pasek nawigacji. Cały ten pomysł stał na fałszywym
        // założeniu.
        //
        // Na iOS element `position: fixed` z odległością od dołu JEST JUŻ pozycjonowany
        // nad paskiem Safari — przeglądarka robi to sama. Nie było czego kompensować,
        // a dodatek podnosił pasek o wysokość paska przeglądarki, czyli o jakieś 75 px.
        //
        // Objaw, który to rozstrzygnął (zgłoszenie właściciela): pasek stał wyżej TYLKO
        // w zakładce Profil. Profil jest krótki, więc strona nie ma czego przewijać,
        // więc Safari NIE MOŻE schować swojego paska — i tylko tam „kompensacja"
        // wychodziła niezerowa. Na dłuższych zakładkach pasek przeglądarki znikał przy
        // przewijaniu i poprawka schodziła do zera. Stąd też pierwotne „nawigacja zmienia
        // pozycję przy przełączaniu zakładek": to była moja własna poprawka w akcji.
        //
        // Zostaje wyłącznie odległość od dołu w CSS (`max(1,5rem, env(...))`) i to
        // wystarcza. Poniżej został sam nasłuch klawiatury, bo tam pasek ma ZNIKNĄĆ,
        // a nie przesunąć się o kilka pikseli — i pomyłka o 75 px niczego tam nie psuje.
        const KEYBOARD_MIN_PX = 140; // mniej to pasek przeglądarki, więcej to klawiatura

        let refreshDeckPin = () => {};

        // Nazwa została historyczna, ale ten nasłuch obsługuje teraz DWIE rzeczy: pasek
        // nawigacji i okna modalne. Obie reagują na to samo zdarzenie i na ten sam próg,
        // więc drugi nasłuch byłby drugą prawdą o tym, czy klawiatura jest otwarta.
        const watchKeyboardForDeck = () => {
            const vv = window.visualViewport;
            if (!vv) return;

            let queued = false;
            const apply = () => {
                queued = false;
                // Klawiatura zabiera 250 px i więcej; pasek przeglądarki najwyżej 90 px.
                // Próg 140 px rozdziela je z zapasem w obie strony.
                const covered = document.documentElement.clientHeight - vv.height;
                const klawiatura = covered >= KEYBOARD_MIN_PX;
                const deck = document.getElementById('deck-nav');
                if (deck) deck.classList.toggle('deck-keyboard', klawiatura);

                // KLAWIATURA MA PODNOSIĆ ARKUSZ, A NIE CHOWAĆ GO POD SOBĄ
                // (zgłoszenie właściciela, iPhone 12, 2026-08-20).
                //
                // Arkusze stoją w oknie `position: fixed; inset: 0`, a iOS przy otwarciu
                // klawiatury NIE zmniejsza układowego okna widoku — zmniejsza wyłącznie
                // widoczne. Okno modalne zostawało więc pełnej wysokości, a arkusz dosunięty
                // do jego dołu lądował pod klawiaturą.
                //
                // Objaw był mylący: za drugim razem Safari sam doprzewijał zawartość i wtedy
                // wyglądało to poprawnie. Stąd wrażenie, że „czasem działa" — a naprawdę
                // działał przypadek, nie układ.
                //
                // `--kb-inset` niesie wysokość zasłoniętego pasa. Skracamy o nią okno modalne
                // WYSOKOŚCIĄ, nie `bottom`: `bottom: 0` ustawia klasa `inset-0` z Tailwinda
                // i wygrałaby kolejnością, natomiast wysokości nikt tam nie ustawia, więc
                // konfliktu nie ma (przy `position: fixed` podana wysokość unieważnia `bottom`).
                //
                // Odejmujemy też `offsetTop`, bo Safari potrafi przesunąć widoczne okno w górę
                // zamiast je skrócić — wtedy sama różnica wysokości kłamie o kilkadziesiąt pikseli.
                const zaslona = Math.max(0, document.documentElement.clientHeight - vv.offsetTop - vv.height);
                document.documentElement.style.setProperty('--kb-inset', `${klawiatura ? zaslona : 0}px`);
            };
            const schedule = () => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(apply);
            };

            vv.addEventListener('resize', schedule);
            window.addEventListener('orientationchange', schedule);
            refreshDeckPin = schedule;
            apply();
        };

        const showScreen = (screenName) => {
            ['loading', 'start', 'join', 'group-dashboard', 'bill', 'profile'].forEach(s => {
                const screenEl = document.getElementById(`${s}-screen`);
                if (screenEl) screenEl.classList.add('hidden');
            });
            // WEJŚCIE NA INNY EKRAN ZACZYNA SIĘ OD GÓRY.
            // Zmiana zakładki robiła to od dawna (`showDeckView`), ale przejście MIĘDZY
            // EKRANAMI nie ruszało przewinięcia w ogóle — więc stuknięcie rachunku po
            // przewinięciu listy otwierało go w połowie, poniżej pola z kwotą, a wejście
            // w Profil z długiego rachunku lądowało pod jego treścią.
            //
            // PRZEZ `appScrollTop`/`appScrollTo`, NIE PRZEZ `window.scrollY` (scalenie
            // 2026-08-17). Pierwotna wersja tej poprawki czytała `window.scrollY`, bo
            // wtedy przewijał się dokument. Równolegle powstała zmiana „przewija się
            // kontener, nie dokument" — po niej `window.scrollY` zwraca zawsze zero,
            // więc warunek nigdy by nie zaskoczył i poprawka byłaby martwa, choć kod
            // wyglądałby na obecny. Git scalił oba pliki bez konfliktu.
            //
            // Warunek „tylko gdy naprawdę przewinięte" zostaje: bezwarunkowe przewinięcie
            // na górę rozwija w Safari pasek adresu, a to przesuwa wszystko przypięte
            // do dolnej krawędzi.
            if (screenName !== currentScreenName && appScrollTop() > 0) appScrollTo(0);
            const targetScreen = document.getElementById(`${screenName}-screen`);
            if (targetScreen) {
                targetScreen.classList.remove('hidden');
                // Animacja wejścia odpala się przy KAŻDYM przejściu, więc klasę trzeba
                // zdjąć i nałożyć ponownie — inaczej przeglądarka uzna, że nic się nie
                // zmieniło, i drugie wejście na ten sam ekran byłoby nieme.
                targetScreen.classList.remove('screen-in');
                void targetScreen.offsetWidth;
                targetScreen.classList.add('screen-in');
            }
            currentScreenName = screenName;
            // Ekran wczytywania sam pilnuje swojego budżetu czasu: zapala odliczanie, gdy
            // się pokazuje, i gasi je, gdy cokolwiek innego wejdzie na wierzch. Dzięki temu
            // żaden ekran docelowy nie musi o tym pamiętać.
            if (screenName === 'loading') startLoadingBudget();
            else stopLoadingBudget();
            // Każde wejście na ekran przelicza poprawkę położenia paska: inaczej wartość
            // policzona przy poprzednim geście zostawała i pasek stał wyżej niż powinien
            // (zgłoszenie: „w sekcji Profil nawigacja jest lekko wyżej").
            refreshDeckPin();
            // Kontekstowy przycisk pomocy „?" — widoczny tylko na ekranach z treścią.
            const fab = document.getElementById('help-fab');
            if (fab) fab.classList.toggle('hidden', !HELP_CONTENT[screenName]);
            // Dolna nawigacja jest widoczna na KAŻDYM ekranie wewnątrz pokoju, także na
            // rachunku. Znikała tam wcześniej i wyjście z rachunku miało tylko strzałkę
            // w rogu — inna droga powrotna niż wszędzie indziej, czyli druga nauka.
            // Ekrany poza pokojem (start, dołączanie, wczytywanie) paska nie mają:
            // nie ma czego przełączać.
            const deck = document.getElementById('deck-nav');
            if (deck) {
                const onDeck = screenName === 'group-dashboard' || screenName === 'profile' || screenName === 'bill';
                deck.classList.toggle('hidden', !onDeck);
                if (screenName === 'profile') setDeckNavCurrent('nav-me');
                // Rachunek należy do Rachunków — pasek mówi, w której części pokoju stoisz.
                else if (screenName === 'bill') setDeckNavCurrent('nav-bills');
                else if (screenName === 'group-dashboard') {
                    const btnId = Object.keys(DECK_NAV_VIEWS).find(k => DECK_NAV_VIEWS[k] === currentDeckView);
                    setDeckNavCurrent(btnId || 'nav-room');
                }
            }
            if (screenName === 'start') renderMyRooms();
        };

        // WEJŚCIE DO POKOJU IDZIE NAJPIERW DO PAMIĘCI, NIE DO SIECI.
        //
        // Zgłoszenie właściciela (2026-08-25): „w trybie samolotowym apka od razu rozumie,
        // że jest offline, ale przy bardzo wolnym internecie albo gdy wifi jest, a nie
        // działa — ciemny ekran, potem biały, a potem nagle się odpala".
        //
        // Powód siedział w jednej linijce: `await getDoc(...)` przed pierwszym malowaniem.
        // `getDoc` przy włączonej pamięci trwałej I TAK najpierw próbuje serwera, a przy
        // „sieć jest, ale nie odpowiada" potrafi wisieć kilkanaście sekund, zanim SDK sam
        // uzna, że jest offline. Przez ten czas stoi goły ekran wczytywania. W trybie
        // samolotowym problemu nie było, bo tam SDK wie od razu, że sieci nie ma.
        //
        // Teraz: kopia z pamięci rysuje pokój NATYCHMIAST, a nasłuchy `onSnapshot`
        // z `renderGroupDashboard` dociągają świeże dane w tle i same przerysowują ekran.
        const handleGroupJoin = async (groupId) => {
            const urlParams = new URLSearchParams(window.location.search);
            currentBillId = urlParams.get('bill');
            currentGroupId = groupId;

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, groupId);

            const enterGroup = (snap) => {
                groupData = snap.data();
                rememberRoom(groupId, groupData.groupName); // zapamiętaj pokój lokalnie (łatwy powrót)
                const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                if (myMember) {
                    if (currentBillId) joinBill(groupId, currentBillId);
                    else navigateToGroup(groupId, false);
                } else {
                    showScreen('join');
                    document.getElementById('join-group-name').textContent = groupData.groupName;
                    renderJoinScreen();
                }
            };

            // 1. Pamięć podręczna — bez czekania na cokolwiek.
            try {
                const cached = await getDocFromCache(groupDocRef);
                if (cached.exists()) { enterGroup(cached); return; }
            } catch (_) { /* pusta pamięć przy pierwszym wejściu — to normalne */ }

            // 2. Nie ma kopii, więc trzeba zapytać. Dopiero TERAZ wolno czekać.
            let fresh;
            try {
                fresh = await getDoc(groupDocRef);
            } catch (err) {
                // BRAK SIECI I BRAK KOPII. Pokoju NIE KASUJEMY — nie wiemy, czy istnieje.
                console.warn('[Billiada] Nie udało się pobrać pokoju:', err);
                showToast('Nie mam tego pokoju w pamięci i nie ma połączenia. Spróbuj, gdy wróci sieć.', true);
                showScreen('start');
                return;
            }

            if (fresh.exists()) { enterGroup(fresh); return; }

            // POKÓJ WOLNO ZAPOMNIEĆ WYŁĄCZNIE NA SŁOWO SERWERA.
            //
            // `forgetRoom` kasuje wpis z `localStorage`, a to jest JEDYNY ślad po pokoju na
            // urządzeniu (PRODUCT.md): po skasowaniu powrót wymaga kodu od kogoś innego.
            // `getDoc` potrafi rozwiązać się z PAMIĘCI, gdy SDK wie, że jest offline —
            // i wtedy „nie istnieje" znaczy tylko „nie mam tego u siebie". Kasowanie na tej
            // podstawie zabierałoby ludziom pokoje przy słabym zasięgu, czyli dokładnie tam,
            // gdzie ta aplikacja pracuje.
            if (fresh.metadata && fresh.metadata.fromCache) {
                showToast('Brak połączenia — nie mogę teraz otworzyć tego pokoju.', true);
                showScreen('start');
                return;
            }

            showToast("Taka grupa nie istnieje!", true);
            forgetRoom(groupId); // martwy skrót z „Moich pokoi" — potwierdzony przez serwer
            history.pushState(null, '', window.location.pathname);
            showScreen('start');
        };

        const renderJoinScreen = () => {
            const nameList = document.getElementById('name-selection-list');
            nameList.innerHTML = '';
            // Use the memberOrder array to render buttons in the correct order
            const memberOrder = groupData.memberOrder || Object.keys(groupData.members || {});
            const members = groupData.members || {};

            memberOrder.forEach(memberId => {
                const m = members[memberId];
                if (!m) return; // Skip if member data is missing for some reason

                const button = document.createElement('button');
                button.innerHTML = `<span class="flex items-center">${avatarHtml(m.name, m.id)}<span class="truncate font-semibold">${escapeHtml(m.name)}</span></span>`;
                button.className = "card tap w-full min-h-tap p-3 text-left";
                if (m.claimedBy) {
                    // Imię już zajęte: wygaszone, ale nadal klikalne — ktoś, kto stracił dostęp
                    // po wyczyszczeniu przeglądarki, musi móc odzyskać swoje imię.
                    button.className += " opacity-50";
                    button.onclick = () => {
                        memberIdToTakeover = m.id;
                        document.getElementById('takeover-name-modal').classList.add('active');
                    };
                } else {
                    button.onclick = () => claimName(m.id);
                }
                nameList.appendChild(button);
            });
        };
        
        // ZAJĘCIE IMIENIA NIE CZEKA NA SERWER.
        //
        // Do 2026-08-25 stało tu `await updateDoc(...)` przed `navigateToGroup`. Offline
        // ta obietnica NIE ROZWIĄZUJE SIĘ NIGDY (zapis czeka w kolejce na potwierdzenie
        // serwera), więc dołączenie do pokoju wisiało w nieskończoność — mimo że imię
        // było już zajęte lokalnie i widziałby to każdy nasłuch. Człowiek stukał drugi raz
        // w inne imię, bo pierwsze „nie zadziałało".
        const claimName = (memberId) => {
            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            fireWrite(
                updateDoc(groupDocRef, { [`members.${memberId}.claimedBy`]: currentUser.uid }),
                'Nie udało się zająć imienia.',
            );
            // Kopia w pamięci od razu wie swoje: nasłuch grupy i tak zaraz to potwierdzi,
            // ale ekran pokoju rysuje się w tej samej klatce i musi znać swojego członka.
            if (groupData && groupData.members && groupData.members[memberId]) {
                groupData.members[memberId].claimedBy = currentUser.uid;
            }
            navigateToGroup(currentGroupId, false);
        };

        const navigateToGroup = (groupId, pushState = true) => {
            const backFromBill = Boolean(currentBillId);
            currentGroupId = groupId;
            currentBillId = null;
            if (pushState) {
                history.pushState(null, '', `?group=${groupId}`);
            }
            renderGroupDashboard();
            // Przewinięcie przywracamy DOPIERO po tym, jak lista rachunków dojdzie z bazy
            // i będzie miała swoją wysokość — wcześniej strona nie ma dokąd się przewinąć.
            // Dwa podejścia wystarczą: pierwsze łapie dane z pamięci podręcznej Firestore,
            // drugie odpowiedź z sieci.
            if (backFromBill && dashboardScrollY > 0) {
                const target = dashboardScrollY;
                const tryRestore = () => {
                    const el = appScroll();
                    if (!el || el.scrollHeight - el.clientHeight < target) return false;
                    el.scrollTop = target;
                    return true;
                };
                requestAnimationFrame(() => {
                    if (tryRestore()) return;
                    setTimeout(tryRestore, 350);
                });
            }
        };
        
        // --- Faza 3: filtry i ukrywanie rachunków ---
        let latestBills = [];
        let latestSettlements = []; // rejestr wpłat (model wpłat)
        let latestNudges = []; // przypomnienia (nudge-windykator)
        let currentBillFilter = 'all';

        const renderGroupDashboard = () => {
            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeGroupDoc) unsubscribeGroupDoc();
            if (unsubscribeSettlements) unsubscribeSettlements();
            if (unsubscribeNudges) unsubscribeNudges();
            if (unsubscribeEvents) unsubscribeEvents();

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            watchConnectivity(groupDocRef);

            unsubscribeGroupDoc = onSnapshot(groupDocRef, (docSnap) => {
                // Metadane nasłuchu to jedyne wiarygodne źródło wiedzy o tym, czy serwer
                // odpowiada — `navigator.onLine` tego nie wie (patrz `renderNetBanner`).
                noteSnapshot(docSnap.metadata);
                if (!docSnap.exists()) return;
                groupData = docSnap.data();
                const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                // Token powiadomień dopisujemy DOPIERO tutaj, bo dopiero teraz wiadomo,
                // do której osoby w którym pokoju należy. Przy starcie aplikacji tej
                // wiedzy nie ma — patrz komentarz przy `savePushToken`.
                savePushToken();
                document.getElementById('dashboard-group-name').textContent = groupData.groupName;
                const userNameEl = document.getElementById('dashboard-user-name');
                userNameEl.textContent = myMember ? myMember.name : '...';
                const nameDisplay = document.getElementById('dashboard-user-name-display');
                if (nameDisplay) nameDisplay.textContent = myMember ? myMember.name : '...';
                // Kod pokoju żyje wyłącznie w ustawieniach pokoju — powód przy nagłówku
                // pulpitu w index.html.
                const serialSheetEl = document.getElementById('room-settings-serial');
                if (serialSheetEl) serialSheetEl.textContent = formatSerial(currentGroupId);
                userNameEl.onclick = async () => {
                    if (!myMember) return;
                    await updateDoc(groupDocRef, {
                        [`members.${myMember.id}.claimedBy`]: null
                    });
                    handleGroupJoin(currentGroupId);
                };

                document.getElementById('group-share-link').value = window.location.origin + window.location.pathname + `?group=${currentGroupId}`;
                
                // Limit bierzemy ze stałej, a nie z wpisanego na sztywno „5.00 GB" — pokazywana
                // wartość rozjeżdżała się z faktycznym progiem (4,5 GB), po którym apka zaczyna
                // kasować najstarsze zdjęcia.
                const usageInGB = ((groupData.totalStorageUsed || 0) / (1024 * 1024 * 1024)).toFixed(2);
                const limitInGB = (STORAGE_LIMIT_BYTES / (1024 * 1024 * 1024)).toFixed(2);
                document.getElementById('storage-usage').textContent = `${usageInGB} GB / ${limitInGB} GB`;

                if (myMember) {
                    const myGrossSpend = (groupData.userGrossSpend && groupData.userGrossSpend[myMember.id]) || {};
                    const groupGrossSpend = groupData.groupGrossSpend || {};

                    document.getElementById('summary-my-gross-spend').textContent = formatSummary(myGrossSpend);
                    document.getElementById('summary-group-gross-spend').textContent = formatSummary(groupGrossSpend);

                    const paySummary = document.getElementById('dashboard-payment-summary');
                    const payBtn = document.getElementById('dashboard-payment-btn');
                    if (paySummary && payBtn) {
                        const methods = getPaymentMethods(myMember);
                        paySummary.textContent = methods.length === 0 ? 'Dodaj sposób płatności' : `Sposoby płatności (${methods.length})`;
                        payBtn.onclick = () => openPaymentModal();
                    }

                    renderColorField(myMember);
                }
                // Tryb rozliczania mieszka w dokumencie grupy, więc przychodzi TĄ drogą —
                // także wtedy, gdy zmienił go ktoś inny przy stole. Wszystkie trzy ekrany
                // czytają go wprost przez `groupSettlementMode()`, więc wystarczy je
                // przerysować (dalej w tej funkcji).
                const roomSettings = document.getElementById('room-settings-modal');
                if (roomSettings && roomSettings.classList.contains('active')) {
                    renderRoomSettlementMode();
                    // SKŁAD GRUPY TEŻ (poprawione 2026-08-26). `renderRoomMembers` wołało
                    // dotąd wyłącznie `openRoomSettings`, więc dopisanie osoby dawało toast
                    // „Dodano: X" i ANI JEDNEJ zmiany na liście stojącej dwa centymetry
                    // wyżej. Wyglądało to na zapis, który nie przeszedł — a przechodził.
                    renderRoomMembers();
                }

                // Numery kont / metody / imiona / zdjęcia mogły się zmienić — odśwież widoki.
                renderBillsList();
                renderSettlements();
                renderBalancePanel();
                // Znaczniki „oddał/a" w „Ekipie" liczą się z wpłat, więc ekran rachunku
                // musi się przerysować po cudzej wpłacie — inaczej pokazuje stan sprzed niej.
                // WARUNEK IDZIE PO `billData`, NIE PO NAZWIE EKRANU (poprawione 2026-08-29).
                // Przy wejściu WPROST Z ODNOŚNIKA (a tak wchodzi się z powiadomienia push)
                // ten nasłuch potrafi wystrzelić, zanim ekran ogłosi się rachunkiem — wtedy
                // stary warunek nie łapał, rachunek rysował się z pustą listą wpłat i nic go
                // już nie odświeżało. Stosy „Do potwierdzenia" i „Do wyjaśnienia" były więc
                // puste dokładnie dla kogoś, kogo aplikacja właśnie tam przysłała.
                if (currentBillId && billData) withFocusPreserved(renderBillScreen);
                updateNudgeBadge();
                savePushToken(); // token mógł powstać zanim wiedzieliśmy, kim jest użytkownik
                if (currentScreenName === 'profile') renderProfile();
            });

            const billsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), orderBy('createdAt', 'desc'));
            // Pokój, do którego należy TEN nasłuch. Migawka potrafi przyjść po wyjściu z pokoju,
            // a stempel `everOpened` jest zapisem — pisanie go pod nowe `currentGroupId` trafiłoby
            // w cudzy rachunek.
            const grupaNasluchu = currentGroupId;
            unsubscribeGroup = onSnapshot(billsQuery, (snapshot) => {
                noteSnapshot(snapshot.metadata);
                latestBills = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
                stampEverOpened(grupaNasluchu);
                renderBillsList();
                renderSettlements();
                renderBalancePanel();
                // ODZNAKA I KROPKA LICZĄ SIĘ TEŻ Z RACHUNKÓW (`actionBillsForMe`), a ten
                // nasłuch ich nie odświeżał — więc sygnał o rachunku czekającym na mój ruch
                // zapalał się dopiero przy następnej wpłacie albo zmianie w grupie, czyli
                // często wcale. Po wprowadzeniu bramy widać to wyraźniej: zamknięcie rachunku
                // ZDEJMUJE zadanie płatnikowi, a otwarcie z powrotem je dokłada.
                updateNudgeBadge();
            });

            const settlementsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), orderBy('createdAt', 'desc'));
            unsubscribeSettlements = onSnapshot(settlementsQuery, (snapshot) => {
                latestSettlements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderSettlements();
                renderBalancePanel();
                // Lista rachunków niesie od etapu 3 kwoty POZOSTAŁE do oddania, a te
                // zmienia każda cudza wpłata — bez tego kafelek pokazywałby dług,
                // który ktoś właśnie spłacił, aż do następnej zmiany rachunku.
                renderBillsList();
                // Znaczniki „oddał/a" w „Ekipie" liczą się z wpłat, więc ekran rachunku
                // musi się przerysować po cudzej wpłacie — inaczej pokazuje stan sprzed niej.
                if (currentScreenName === 'bill') withFocusPreserved(renderBillScreen);
                // ODZNAKA NA DZWONKU (poprawione 2026-08-26). Cudza wpłata czekająca na
                // moje potwierdzenie jest sygnałem poziomu 1, ale ten nasłuch nie wołał
                // `updateNudgeBadge`, więc odznaka zapalała się dopiero przy następnej
                // zmianie dokumentu grupy albo przypomnienia — czyli często wcale.
                // Sprawa siedziała w skrzynce, a nic o niej nie mówiło.
                updateNudgeBadge();
                // Rejestr otwarty na ekranie musi widzieć cudze potwierdzenie od razu —
                // to jedyne miejsce, w którym ktoś czeka na ruch drugiej osoby.
                const logModal = document.getElementById('settlements-log-modal');
                if (logModal && logModal.classList.contains('active')) renderSettlementsLog();
            });

            const nudgesQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`), orderBy('createdAt', 'desc'));
            unsubscribeNudges = onSnapshot(nudgesQuery, (snapshot) => {
                latestNudges = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                updateNudgeBadge();
                const modal = document.getElementById('nudges-modal');
                if (modal && modal.classList.contains('active')) renderNudges();
                // TE SAME SPRAWY STOJĄ W DWÓCH MIEJSCACH, więc muszą się odświeżać w obu
                // (zgłoszenie właściciela 2026-08-26: „na Bilansie nie działa Oznacz
                // przeczytane"). Zapis szedł poprawnie i odznaka na dzwonku gasła, ale ten
                // nasłuch przerysowywał WYŁĄCZNIE skrzynkę spod dzwonka — więc wiersz na
                // Bilansie zostawał na ekranie do następnej zmiany rachunku albo wpłaty.
                // Z zewnątrz wygląda to dokładnie jak przycisk, który nic nie robi.
                renderBalanceWaiting();
            });

            // Dziennik aktywności. Limit 200 wpisów: to jest ślad ostatnich dni pokoju,
            // a nie archiwum — bez limitu długo żyjący pokój ciągnąłby przy każdym
            // wejściu wszystko, co się w nim kiedykolwiek wydarzyło.
            const eventsQuery = query(
                collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/events`),
                orderBy('createdAt', 'desc'),
                limit(200),
            );
            unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
                latestEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                const modal = document.getElementById('nudges-modal');
                if (modal && modal.classList.contains('active')) renderNudges();
                renderBillHistory();
            }, (error) => {
                // Dziennik jest dodatkiem, nie warunkiem pracy: gdy reguły w emulatorze
                // są starsze niż `firestore.rules` (typowe zaraz po zmianie), aplikacja
                // ma działać dalej z pustą historią, a nie sypać błędami w konsoli.
                latestEvents = [];
                renderBillHistory();
                console.warn('[Billiada] Dziennik aktywności niedostępny:', error.code || error);
            });

            document.getElementById('copy-group-link-btn').onclick = () => {
                copyText(document.getElementById('group-share-link').value, 'Link do grupy skopiowany!');
            };
            // Ustawienia pokoju otwierają się spod NAZWY pokoju — stoją przy rzeczy,
            // której dotyczą. Zwijana sekcja „Pokój" na pulpicie zniknęła bez zamiennika.
            const roomSettingsBtn = document.getElementById('room-settings-btn');
            if (roomSettingsBtn) roomSettingsBtn.onclick = () => openRoomSettings();
            const roomSettingsCopySerial = document.getElementById('room-settings-copy-serial-btn');
            if (roomSettingsCopySerial) roomSettingsCopySerial.onclick = () => copyText(currentGroupId, 'Kod pokoju skopiowany.');
            const closeRoomSettings = document.getElementById('close-room-settings-btn');
            if (closeRoomSettings) closeRoomSettings.onclick = () => document.getElementById('room-settings-modal').classList.remove('active');

            // Kod QR rysowany lokalnie — aplikacja pracuje offline, więc obrazek
            // z cudzego serwera nie wchodzi w grę.
            const qrToggle = document.getElementById('room-qr-toggle');
            if (qrToggle) qrToggle.onclick = () => {
                const wrap = document.getElementById('room-qr-wrap');
                const willShow = wrap.classList.contains('hidden');
                wrap.classList.toggle('hidden', !willShow);
                qrToggle.querySelector('span').textContent = willShow ? 'Ukryj kod QR' : 'Pokaż kod QR';
                if (willShow) renderRoomQr();
            };

            const addMemberInput = document.getElementById('room-add-member-input');
            const addMemberBtn = document.getElementById('room-add-member-btn');
            if (addMemberBtn) addMemberBtn.onclick = () => addMemberToRoom(addMemberInput.value);
            if (addMemberInput) addMemberInput.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addMemberToRoom(addMemberInput.value); }
            };

            const roomCurrencyBtn = document.getElementById('room-currency-btn');
            if (roomCurrencyBtn) roomCurrencyBtn.onclick = () => {
                openChoiceSheet({
                    title: 'Waluta domyślna pokoju',
                    current: (groupData && groupData.defaultCurrency) || 'PLN',
                    options: [
                        { value: 'PLN', label: 'PLN', hint: 'złoty polski' },
                        { value: 'EUR', label: 'EUR', hint: 'euro' },
                        { value: 'USD', label: 'USD', hint: 'dolar amerykański' },
                    ],
                    onPick: async (value) => {
                        await updateDoc(groupDocRef, { defaultCurrency: value });
                        // USTERKA NAPRAWIONA 2026-08-15: etykietę waluty ustawiało wyłącznie
                        // `openRoomSettings`, więc po wyborze arkusz zamykał się, a pole nadal
                        // pokazywało starą walutę. Zapis szedł do bazy poprawnie, ale ekran
                        // mówił, że nic się nie stało — stąd zgłoszenie „nie mogę zmienić
                        // waluty domyślnej, gdy są już rachunki". Zmiana ZAWSZE była możliwa;
                        // niewidoczna była tylko jej odpowiedź.
                        const label = document.getElementById('room-currency-label');
                        if (label) label.textContent = value;
                        showToast('Nowe rachunki będą w ' + value + '.');
                    },
                });
            };

            const leaveBtn = document.getElementById('leave-room-btn');
            if (leaveBtn) leaveBtn.onclick = () => leaveRoom();

            document.querySelectorAll('.bill-filter-btn').forEach(btn => {
                btn.onclick = () => { currentBillFilter = btn.dataset.filter; renderBillsList(); };
            });

            showScreen('group-dashboard');
        };
        
        // --- TRYB PODZIAŁU RACHUNKU ------------------------------------------------
        //
        // Do 2026-08-15 każdy uczestnik ustawiał sobie status ręcznie: Nieuzupełnione /
        // Uzupełnione / Mnie nie dotyczy. To było pytanie do człowieka o rzecz, którą
        // aplikacja i tak wie — czy dopisał swoje pozycje. Efekt: rachunek pokazywał
        // „Nieuzupełnione" komuś, kto wszystko już odkliknął, i „Uzupełnione" komuś, kto
        // tylko przestawił pole. Status kłamał, a kłamiący status przy pieniądzach jest
        // gorszy niż jego brak.
        //
        // Teraz rachunek ma JEDEN przełącznik trybu, a status liczy się sam:
        //   'even' (Po równo)          — kwota dzieli się na uczestników, nie ma czego
        //                                uzupełniać, więc wszyscy są gotowi od razu.
        //   'own'  (Ze swoimi kosztami) — gotowy jest ten, kto stuknął choć jedną pozycję
        //                                albo wpisał koszt własny.
        // „Mnie nie dotyczy" odpadło jako WYBÓR: od wypisania kogoś z rachunku jest
        // edycja składu. Sama WARTOŚĆ `not_applicable` zostaje w bazie, bo to na niej
        // stoi wykluczanie z podziału w `functions/calc.js` i noszą ją stare rachunki.
        const PARTICIPANT_IN = 'in';
        const PARTICIPANT_OUT = 'not_applicable';

        // `billSplitMode` mieszka od 2026-08-26 w functions/calc.js — razem z bramą rozliczeń,
        // która czyta tryb tą samą regułą. Dwie kopie tego wnioskowania znaczyłyby, że ekran
        // i brama mogą kiedyś powiedzieć o jednym rachunku dwie różne rzeczy.

        // Czy udział tej osoby jest już opisany. W trybie „po równo" zawsze tak.
        const participantReady = (bill, participantId) => {
            if (!bill || !participantId) return false;
            const p = (bill.participants || {})[participantId];
            if (!p || p.status === PARTICIPANT_OUT) return false;
            if (billSplitMode(bill) === 'even') return true;
            if (Number(p.individualAmount) > 0) return true;
            return ((bill.sharedCosts) || []).some((it) => isPicked(it, participantId));
        };

        // --- BRAMA ROZLICZEŃ: kto ma klucz -----------------------------------------
        //
        // Reguła jest w functions/calc.js (`billSettleGate`) i mówi o PIENIĄDZACH: rachunku
        // nie wolno regulować, dopóki jakaś kwota wisi bez właściciela. Tutaj mieszka tylko
        // odpowiedź na drugie pytanie — KTO może tę bramę otworzyć ręcznie.
        //
        // Trzy klucze, w tej kolejności:
        //   płatnik  — bo to jego pieniądze wróciły z zewnątrz i to on siedział przy stole,
        //   admin    — założyciel pokoju; zawór na wypadek, gdy płatnik zniknie,
        //   każdy    — po tygodniu.
        //
        // Ten trzeci nie jest ozdobą. `adminId` to uid urządzenia i jest ZAMROŻONY regułami
        // (firestore.rules), więc wyczyszczone dane albo nowy telefon kasują admina pokoju
        // bezpowrotnie. Bez terminu dałoby się doprowadzić pokój do stanu, w którym NIKT nie
        // może odblokować rozliczeń — czyli aplikacja zabrałaby ludziom ich własne pieniądze.
        const CLOSE_GRACE_DAYS = 7;

        const msOf = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;

        const isRoomAdmin = () => !!(groupData && currentUser && groupData.adminId === currentUser.uid);

        // Ile dni rachunek czeka na zamknięcie. Świeżo zapisany dokument nie ma jeszcze
        // czasu serwerowego (null) — wtedy jest z definicji nowy, nie stary.
        const billOpenDays = (bill) => {
            const ms = msOf(bill && bill.createdAt);
            return ms > 0 ? (Date.now() - ms) / 86400000 : 0;
        };

        // Kto ma zamknięcie jako SWOJE ZADANIE — płatnik i admin pokoju.
        // Tylko oni dostają sygnał („Zamknij rachunek" na kafelku, kropka „czeka na Ciebie").
        // Termin siedmiu dni daje PRAWO, ale nie robi z tego zadania: inaczej po tygodniu
        // dwudziestu pięciu ludziom naraz zapaliłoby się to samo wezwanie do jednej czynności,
        // którą wykona jedna osoba. Przycisk i tak czeka w środku rachunku.
        const isPrimaryCloser = (bill, myMemberId) =>
            !!bill && ((!!myMemberId && bill.payerId === myMemberId) || isRoomAdmin());

        const canCloseBill = (bill, myMemberId) => {
            if (!bill) return false;
            if (isPrimaryCloser(bill, myMemberId)) return true;
            return billOpenDays(bill) >= CLOSE_GRACE_DAYS;
        };

        // Czy z TEGO rachunku wolno dziś przelewać pieniądze.
        // Potwierdzenie płatnika celowo NIE jest tu powtórzone: rachunek bez niego nie tworzy
        // ani jednego długu (`computeBillDebts`), więc nie ma czego blokować, a dublowanie
        // warunku dałoby dwa miejsca, w których trzeba pamiętać o tej samej rzeczy.
        const canSettleBill = (bill) => billSettleGate(bill).open;

        // ZAMKNIĘTY RACHUNEK JEST ZAMROŻONY W CAŁOŚCI, A NIE TYLKO NA STUKANIE W PARAGON.
        //
        // Reguła stała od 2026-08-26 przy jednym module obsługi („na zamkniętym rachunku nikt
        // już nie klika"), ale pilnowała JEDNEJ z sześciu dróg, którymi da się zmienić treść
        // rachunku. Ołówek przy pozycji, kosz, „Dodaj pozycję", koszty wspólne, kwota rachunku
        // i przełącznik trybu omijały ją w całości — a każda z nich przesuwa cudze kwoty.
        //
        // Sonda audytowa 2026-08-26: rachunek zamknięty „po równo", udziały 133,34 / 133,34 /
        // 33,34. Płatnik poprawia ołówkiem jedną pozycję ze 100 na 180 i wychodzi 106,67 /
        // 186,67 / 6,67 — brama ANI DRGNIE, bo nic nie zawisło bez właściciela, tylko zmieniło
        // właściciela. Ania płaci o 53 zł więcej, Kuba ma nadpłatę, nikt nie dostaje ani słowa.
        //
        // Zamrożenie nie jest ślepym zaułkiem: płatnik i admin mają nad banerem „Otwórz rachunek
        // z powrotem", a ten pyta wprost i mówi, ile osób już zapłaciło. Reszta ekipy ma „To nie
        // moje". Zmiana kwot po zamknięciu ma być decyzją, a nie skutkiem ubocznym stuknięcia.
        const billFrozen = (bill) => !!bill && bill.settleOpen === true && billSettleGate(bill).open;

        // ZMIANA NAZWY RACHUNKU W MIEJSCU (zgłoszenie właściciela 2026-08-27).
        //
        // Nazwa jest TOŻSAMOŚCIĄ rachunku — po niej odróżnia się dwie kolacje z tego samego
        // tygodnia. Dawało się ją wpisać wyłącznie przy zakładaniu, a rachunek nazywa się
        // w pośpiechu przy stole, więc literówka zostawała w nim na zawsze.
        //
        // WOLNO KAŻDEMU Z POKOJU, dokładnie tak jak wolno poprawić opis pozycji na paragonie.
        // Nazwa nie rusza ANI JEDNEJ kwoty, a zamknięcie jej u płatnika znaczyłoby, że
        // literówki nie da się poprawić, dopóki on nie otworzy aplikacji. Kto zmienił, stoi
        // w Aktywności — to poziom 3 progu sygnału (docs/UI-UX.md §10.2): żadnej kropki,
        // żadnego pusha, ślad zostaje.
        //
        // ZAMROŻENIE ZAMKNIĘTEGO RACHUNKU TU NIE OBOWIĄZUJE (`billFrozen`). Ono broni kwot
        // przed cichym przesunięciem pod opłaconą wpłatą — nazwa nie przesuwa niczego.
        let billNameEditing = false;

        const billNameEl = () => document.getElementById('bill-name');
        const billNameInputEl = () => document.getElementById('bill-name-input');

        const showBillNameEditor = (edytujemy) => {
            const naglowek = billNameEl();
            const pole = billNameInputEl();
            const olowek = document.getElementById('bill-name-edit-btn');
            if (!naglowek || !pole) return;
            billNameEditing = edytujemy;
            naglowek.classList.toggle('hidden', edytujemy);
            if (olowek) olowek.classList.toggle('hidden', edytujemy);
            pole.classList.toggle('hidden', !edytujemy);
        };

        const startBillNameEdit = () => {
            const pole = billNameInputEl();
            if (!pole || !billData) return;
            if (!myMemberNow()) { showToast('Najpierw dołącz do grupy.', true); return; }
            pole.value = billData.billName || '';
            showBillNameEditor(true);
            pole.focus();
            pole.select();
        };

        // `zapisz` = false przy Escape: wychodzimy bez zapisu i bez toastu.
        const finishBillNameEdit = (zapisz) => {
            const pole = billNameInputEl();
            if (!billNameEditing || !pole || !billData) return;
            const stara = billData.billName || '';
            const nowa = pole.value.trim();
            showBillNameEditor(false);
            if (!zapisz || nowa === stara) return;
            // Pusta nazwa zostawiłaby rachunek bez tożsamości — na liście, w skrzynce
            // i w rejestrze wpłat stałby wtedy pusty wiersz.
            if (!nowa) { showToast('Rachunek musi mieć nazwę.', true); return; }
            fireWrite(
                updateDoc(
                    doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId),
                    { billName: nowa },
                ),
                'Nie udało się zmienić nazwy rachunku.',
            );
            logEvent({
                type: 'bill-rename',
                billId: currentBillId,
                label: `zmienił/a nazwę rachunku „${stara}" na „${nowa}"`,
            });
        };

        // Zwraca true, gdy odmówiliśmy — wołane jako `if (refuseFrozen()) return;`.
        const refuseFrozen = () => {
            if (!billFrozen(billData)) return false;
            const my = myMemberNow();
            showToast(canCloseBill(billData, my && my.id)
                ? 'Reszta jest już podzielona. Cofnij podział u góry, żeby poprawić pozycje.'
                : 'Reszta jest już podzielona. Poproś o cofnięcie podziału, żeby poprawić pozycje.');
            return true;
        };

        // Powód blokady — ludzkim językiem, do postawienia PRZY wyłączonym przycisku.
        // Martwy szary guzik bez zdania obok czyta się jak usterka aplikacji, a nie jak
        // świadoma ochrona; to jest różnica między „apka nie działa" a „jeszcze nie czas".
        // Powód blokady — ludzkim językiem. NAZWY RACHUNKU tu nie ma (decyzja właściciela
        // 2026-08-26): zdanie stoi zawsze przy tym rachunku albo w jego oknie, więc nazwa
        // powtarzała to, co człowiek ma przed oczami, i zjadała pół wiersza.
        // „Kuba, Ola i Piotr" zamiast „kuba, ola, piotr" — zdanie, nie lista z bazy.
        // Przy dłuższej liście ucinamy, bo to jest wtręt w zdaniu, a nie spis obecności.
        const imionaZdanie = (ids, maks = 3) => {
            const imiona = (ids || []).map((id) => memberName(id));
            if (imiona.length === 0) return '';
            if (imiona.length === 1) return imiona[0];
            if (imiona.length <= maks) return `${imiona.slice(0, -1).join(', ')} i ${imiona[imiona.length - 1]}`;
            const reszta = imiona.length - maks;
            return `${imiona.slice(0, maks).join(', ')} i ${reszta} ${plural(reszta, 'inna osoba', 'inne osoby', 'innych osób')}`;
        };

        // KTO NIESIE CUDZĄ CZĘŚĆ — zdanie musi się zgadzać w liczbie. Przy jednej osobie
        // „ich część niosą dziś inni" brzmi jak błąd, a to jest zdanie o cudzych pieniądzach.
        const cudzaCzescHtml = (ile) => (ile === 1
            ? 'tę część niesie dziś ktoś inny'
            : 'ich część niosą dziś inni');

        const settleBlockReason = (bill) => {
            const gate = billSettleGate(bill);
            if (gate.open) return '';
            if (gate.reason === 'over') {
                // JEDNO ZDANIE NA OBA TRYBY (2026-08-30). Stały tu dwa, bo w trybie „po równo"
                // jedyną rzeczą zdolną przekroczyć kwotę rachunku był „koszt wspólny" — osobne
                // pojęcie z osobną sekcją. Odkąd to jest po prostu pozycja (dla wszystkich),
                // słowo „pozycje" wskazuje na to, co realnie stoi na ekranie w obu trybach.
                return 'Pozycje przekraczają kwotę rachunku. Ktoś musi to poprawić, zanim ruszą przelewy.';
            }
            // NIKT NIE MA UDZIAŁU ZEROWEGO. Tu nie chodzi o kwotę — wszystko jest rozpisane
            // co do grosza — tylko o to, że rozpisane jest na ZA MAŁO OSÓB.
            if (gate.reason === 'nostake') {
                const kto = imionaZdanie(gate.bezStawki);
                const ilu = (gate.bezStawki || []).length;
                return `${kto} nie ${ilu === 1 ? 'wziął/ęła' : 'wzięli'} ani jednej pozycji, a ${cudzaCzescHtml(ilu)}.`;
            }
            const kwota = fmtMoney(gate.unallocatedG || 0, (bill && bill.currency) || 'PLN');
            return gate.reason === 'changed'
                ? `Po podziale doszło ${kwota}, których nikt nie wziął. Reszta czeka na ponowny podział.`
                : `Rachunek jeszcze się uzupełnia — ${kwota} nikt nie wziął.`;
        };

        // OKNO ZAMIAST ZDANIA POD PRZYCISKIEM (decyzja właściciela 2026-08-26).
        //
        // Wyjaśnienie stało na stałe pod wyszarzonym „Ureguluj" i zajmowało miejsce przy
        // każdym wejściu, choć jest odpowiedzią na pytanie, które pada RAZ: „czemu nie mogę
        // tego oddać?". Teraz przycisk zostaje na widoku (nie znika — znikający czyta się
        // jak usterka), ale wygląda na wyłączony, a powód pokazuje się dopiero po stuknięciu.
        const showSettleBlockedInfo = (bill) => {
            const gate = billSettleGate(bill);
            if (gate.open) return;
            if (gate.reason === 'nostake') {
                showInfo('Jeszcze nie teraz', `
                    <p>${escapeHtml(settleBlockReason(bill))}</p>
                    <p>Rachunek jest rozpisany co do grosza, ale ktoś, kto siedział przy stole, nie jest winien ani złotówki — a jego część zapłaci wtedy ktoś inny.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li>Jeśli tylko nie zdążyli stuknąć — poczekaj albo im przypomnij.</li>
                        <li>Jeśli naprawdę nic nie brali — płatnik domyka rachunek i przelewy ruszają.</li>
                    </ul>`);
                return;
            }
            const kroki = gate.reason === 'over'
                ? '<li>Popraw kwotę rachunku albo pozycje, żeby suma się zgadzała.</li>'
                : `<li>Stuknij na paragonie pozycje, które są Twoje.</li>
                   <li>Gdy nic już nie wisi bez właściciela, rachunek odblokuje się sam.</li>
                   <li>Jeśli coś zostaje, płatnik dzieli resztę i decyduje, co z tą kwotą.</li>`;
            showInfo('Jeszcze nie teraz', `
                <p>${escapeHtml(settleBlockReason(bill))}</p>
                <p>Dopóki tak jest, przelew z tego rachunku byłby przelewem za cudze pozycje.</p>
                <ul class="list-disc pl-5 space-y-1">${kroki}</ul>`);
        };

        // Z CZEGO SKŁADA SIĘ KWOTA WISZĄCA BEZ WŁAŚCICIELA.
        //
        // To jest cała treść decyzji, którą podejmuje płatnik — i dlatego mówimy o POZYCJACH,
        // nie o ludziach. „Wino 40,00" widać od razu, że było wspólne; „Danie 40,00 · Danie
        // 40,00" widać, że to czyjeś jedzenie. Lista imion nie niesie tej wiedzy, a paragon tak.
        // WYPISYWANIE POZYCJI PO NAZWIE BYŁO BŁĘDEM (zgłoszenie właściciela 2026-08-26).
        // Paragon z japońskiej restauracji ma nazwy po sześćdziesiąt znaków, a osiem takich
        // pozycji zamieniało baner w ścianę tekstu, przez którą nie było widać ani kwoty,
        // ani przycisku. Do tego lista niczego nie dodawała: te same pozycje stoją niżej
        // na wydruku, wyszarzone, i tam widać je lepiej niż w akapicie.
        //
        // Zostają dwie liczby, bo jedna nie wystarcza: „4 z 15 pozycji" nie mówi, czy chodzi
        // o grosze, czy o połowę rachunku, a sama kwota nie mówi, ilu pozycji szukać.
        const restBreakdownHtml = (bill, calculations) => {
            const cur = (bill && bill.currency) || 'PLN';
            const czesci = [];
            const sierot = calculations.orphanCount || 0;
            const wszystkich = calculations.itemCount || 0;
            if (sierot > 0) {
                czesci.push(`<p class="text-sm text-ink-2"><b class="text-ink">${sierot} z ${wszystkich} pozycji nikt nie wziął</b> · ${fmtMoney(toGrosze(calculations.orphanAmount || 0), cur)}</p>`);
            }
            // Różnica między kwotą rachunku a sumą pozycji. Na rachunku bez ani jednej pozycji
            // jest całą jego treścią, nie usterką — więc nazywamy ją spokojnie.
            const resztaG = toGrosze(calculations.unallocated) - toGrosze(calculations.orphanAmount);
            if (resztaG > 0) {
                czesci.push(`<p class="text-sm text-ink-2"><b class="text-ink">Nierozpisane z kwoty rachunku:</b> ${fmtMoney(resztaG, cur)}</p>`);
            }
            return czesci.join('');
        };

        // LISTA OSÓB, KTÓRA NIE ROZLAZŁA SIĘ NA PÓŁ EKRANU.
        //
        // Aplikacja ma obsłużyć ekipy 12–25 osób (PRODUCT.md), a wypisane w akapicie imiona
        // piętnastu ludzi zjadały cały arkusz i spychały przyciski poza ekran. Lista jest więc
        // ZWINIĘTA i przewijana we własnym pudełku: kto chce wiedzieć, kogo to dotyczy,
        // rozwija — a kto nie, widzi samą liczbę i decyzję.
        const peopleListHtml = (osoby) => {
            if (!osoby || !osoby.length) return '';
            // TWARZE, NIE ROZWIJANA LISTA. Rozwijanie rosło w dół i spychało przyciski poza
            // ekran — a arkusz, w którym po rozwinięciu nie widać już opcji, przestaje być
            // wyborem. Stos twarzy mieści się w jednym wierszu, od razu POKAZUJE, że osób
            // jest dużo, i niczego nie przesuwa. Imiona idą pod spodem jedną linią.
            const widoczne = osoby.slice(0, 8);
            const imiona = osoby.map((p) => p.name || memberName(p.id));
            const podpis = imiona.length > 3
                ? `${imiona.slice(0, 3).join(', ')} i ${imiona.length - 3} ${plural(imiona.length - 3, 'inna osoba', 'inne osoby', 'innych osób')}`
                : imiona.join(', ');
            return `<div class="mt-2 flex items-center gap-2">
                    <span class="flex -space-x-2 flex-shrink-0">${
                        widoczne.map((p) => avatarHtml(p.name || memberName(p.id), p.id, 'w-8 h-8 text-xs')).join('')
                    }${osoby.length > widoczne.length ? `<span class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-surface-2 text-ink-2">+${osoby.length - widoczne.length}</span>` : ''}</span>
                </div>
                <p class="text-xs text-ink-3 mt-1.5 truncate">${escapeHtml(podpis)}</p>`;
        };

        // --- KAFELEK STANU RACHUNKU: JEDEN SZKIELET NA WSZYSTKIE STANY --------------
        //
        // Zgłoszenie właściciela 2026-08-30: „ten kafelek nie ma ładu i składu". Miał rację,
        // a powód był strukturalny, nie kosmetyczny — kafelek nie był KOMPONENTEM, tylko
        // pięcioma osobnymi kawałkami znaczników pisanymi ręcznie w pięciu gałęziach.
        // Stąd brały się cztery rozjazdy naraz:
        //   1. raz `items-center`, raz `items-start` — przy trzywierszowej treści znaczek
        //      stanu pływał w połowie wysokości albo stał u góry, zależnie od gałęzi;
        //   2. jedna gałąź („Potwierdzam") nie miała znaczka w ogóle, więc tekst zaczynał
        //      się w innym miejscu niż we wszystkich pozostałych stanach;
        //   3. tekst PŁYNĄŁ OBOK znaczka, a znaczki mają różne długości („Błąd" ↔
        //      „Uzupełniamy") — czyli kolumna tekstu startowała raz stąd, raz stamtąd;
        //   4. `flex-wrap justify-between` stawiało przycisk raz obok treści, raz pod nią,
        //      więc kształt kafelka zmieniała SZEROKOŚĆ EKRANU, a nie znaczenie.
        //
        // Trzy reguły, które to zamykają — i dlatego są tu, a nie w pięciu miejscach:
        //   • znaczek stanu ma WŁASNY RZĄD razem z tytułem, więc jego długość przestaje
        //     mieć znaczenie: kolumna treści zawsze startuje przy lewej krawędzi karty;
        //   • znaczek jest ZAWSZE — żaden stan nie wypada z rytmu;
        //   • pogrubione zdanie wiodące (dotąd wtopione w środek akapitu jako `<b>`)
        //     awansuje na TYTUŁ, więc treść krótka i długa wyglądają tak samo i różnią się
        //     wyłącznie wysokością akapitu pod tytułem.
        // Przyciski zawsze na pełną szerokość i zawsze pod spodem — nigdy obok treści.
        //
        // TREŚĆ SIĘ NIE ZMIENIA. To jest wyłącznie porządek, o który prosiło zgłoszenie.
        const billBannerHtml = ({ chipClass = 'chip', chip, title, body = '', extra = '', actions = '' }) => `
            <div class="card bill-banner">
                <div class="bill-banner-head">
                    <span class="${chipClass} bill-banner-chip">${chip}</span>
                    <span class="bill-banner-title">${title}</span>
                </div>
                ${body ? `<p class="bill-banner-body">${body}</p>` : ''}
                ${extra}
                ${actions ? `<div class="bill-banner-actions">${actions}</div>` : ''}
            </div>`;

        // BANER STANU RACHUNKU. Mówi trzy rzeczy i ani jednej więcej: ile wisi, czemu to
        // blokuje przelewy i czyj jest ruch. Wchodzi w baner, który już istnieje — ekran
        // rachunku jest zapchany i nie zniesie kolejnej karty.
        const gateBannerHtml = (bill, myMemberId) => {
            const gate = billSettleGate(bill);
            const cur = bill.currency || 'PLN';

            if (gate.reason === 'over') {
                return billBannerHtml({
                    chipClass: 'chip text-owe',
                    chip: 'Błąd',
                    title: `Pozycje przekraczają kwotę rachunku o ${fmtMoney(toGrosze(gate.diff || 0), cur)}.`,
                    body: 'Dopóki to się nie zgadza, nikt nie może się rozliczyć — inaczej wszyscy by przepłacili. Popraw kwotę rachunku albo pozycje wyżej.',
                });
            }

            const calculations = calculateAllForBill(bill);
            const mogeZamknac = canCloseBill(bill, myMemberId);
            const kwota = fmtMoney(gate.unallocatedG || 0, cur);
            // BANER NAZYWA BLOKADĘ PO IMIENIU (zgłoszenie właściciela 2026-08-27).
            // Kafelek na liście niesie już tylko stan, więc to jest jedyne miejsce, w którym
            // pada CAŁE zdanie: co jest zablokowane, dlaczego i co to odblokuje. Bez tego
            // wyszarzony „Ureguluj" niżej czyta się jak usterka aplikacji.
            // NIKT Z UDZIAŁEM ZEROWYM. Baner wymienia te osoby po imieniu, bo to jedyna
            // informacja, która pozwala coś zrobić: albo im przypomnieć, albo stwierdzić,
            // że faktycznie nic nie brali.
            // Zdanie wiodące i wyjaśnienie stoją teraz OSOBNO, bo szkielet kafelka rozdziela
            // tytuł od treści (patrz `billBannerHtml`). Do 2026-08-30 były jednym ciągiem
            // z pogrubionym początkiem w środku akapitu.
            const brakStawki = gate.reason === 'nostake';
            const tytul = brakStawki
                ? `${escapeHtml(imionaZdanie(gate.bezStawki))} nie ${(gate.bezStawki || []).length === 1 ? 'wziął/ęła' : 'wzięli'} ani jednej pozycji.`
                : gate.reason === 'changed'
                    ? 'Rachunek zmienił się po podziale reszty.'
                    : 'Ten rachunek jeszcze się uzupełnia.';
            const trescHtml = brakStawki
                ? `Rachunek spina się co do grosza, ale ${cudzaCzescHtml((gate.bezStawki || []).length)} — dlatego regulowanie płatności jest jeszcze zablokowane.`
                : gate.reason === 'changed'
                    ? `${kwota} znów nie ma właściciela, więc regulowanie płatności jest z powrotem zablokowane.`
                    : `${kwota} nikt nie wziął, a dopóki tak jest, regulowanie płatności jest zablokowane — inaczej przelew szedłby za cudze pozycje.`;

            // Kto nie może zamknąć, dostaje jedno zdanie o tym, na kogo się czeka, i jedno
            // polecenie, które MOŻE wykonać. Wołanie do czynności, której ktoś nie ma jak
            // zrobić, jest w tej aplikacji uznane za usterkę (patrz `billStatus`).
            if (!mogeZamknac) {
                const kto = bill.payerId ? memberName(bill.payerId) : 'płatnik';
                return billBannerHtml({
                    chipClass: 'chip text-info',
                    chip: 'Uzupełniamy',
                    title: tytul,
                    body: `${trescHtml} ${brakStawki ? `Rachunek domknie <strong>${escapeHtml(kto)}</strong>.` : `Stuknij niżej na paragonie, co Twoje — a resztę podzieli <strong>${escapeHtml(kto)}</strong>.`}`,
                    extra: restBreakdownHtml(bill, calculations),
                });
            }

            const ilu = Object.values(bill.participants || {})
                .filter((p) => p.status !== PARTICIPANT_OUT && !participantReady(bill, p.id)).length;
            // PRZYCISKI JEDEN POD DRUGIM, NIE OBOK SIEBIE. W rzędzie „Zamknij rachunek"
            // łamało się na dwa wiersze na wąskim telefonie, a złamana etykieta na przycisku
            // wygląda na usterkę układu. Pod spodem obie mieszczą się w całości.
            // NAJPIERW ZAPYTAJ, POTEM DZIEL (decyzja właściciela 2026-08-27).
            //
            // Podział reszty jest ZAWSZE PRZYBLIŻENIEM — dokładny wynik daje dopiero to, że
            // ludzie stukną swoje pozycje, i po to w ogóle powstała brama. Do tej pory głośny
            // (czarny) był ten gorszy wynik, a lepszy stał pod nim wyszarzony — czyli układ
            // po cichu popychał płatnika w stronę zgadywania.
            //
            // Do tego `btn-quiet` po prostu ginął: jego tło (238) na białej karcie (255) to
            // siedemnaście punktów różnicy, a tuż nad nim stała pełna czerń. W takim
            // sąsiedztwie przestaje wyglądać na przycisk — ta sama pułapka, którą opisuje
            // uwaga przy `billsAsideHtml`.
            //
            // Teraz obie drogi mają tę samą wagę, a kolejność czytania podpowiada tę
            // dokładniejszą. Limonki tu NIE MA świadomie: w regule z DESIGN.md znaczy ona
            // „domykam sprawę, którą ktoś mi postawił", a przypomnienie sam zaczynam — i jest
            // to przycisk, który budzi do dwudziestu pięciu telefonów naraz.
            const przypomnijHtml = ilu > 0
                ? `<button id="remind-fill-btn" class="btn btn-dark w-full">Przypomnij ${ilu} ${plural(ilu, 'osobie', 'osobom', 'osobom')}</button>`
                : '';
            // „LUB" MIĘDZY DWIEMA DROGAMI (zgłoszenie właściciela 2026-08-27).
            //
            // Odkąd oba przyciski mają tę samą wagę, czytają się jak lista kroków do
            // wykonania po kolei — a to są DWIE ODPOWIEDZI na to samo pytanie: „poczekać na
            // ludzi czy rozstrzygnąć samemu". W motywie ciemnym oba są białe i bez tego
            // rozdzielnika wyglądają jak jeden przedmiot przecięty na pół.
            //
            // Ten sam znak, co w arkuszu podziału („Podziel po równo" LUB „Wrzuć
            // spóźnialskim") — nie wprowadzamy drugiego sposobu na powiedzenie tej samej
            // rzeczy. Pojawia się WYŁĄCZNIE wtedy, gdy są dwie drogi: bez kogo przypominać
            // zostaje sam przycisk rozstrzygnięcia i nie ma czego rozdzielać.
            const lubHtml = ilu > 0
                ? `<div class="flex items-center gap-3 py-1">
                        <span class="h-px flex-grow bg-ink/10"></span>
                        <span class="text-xs font-bold text-ink-3 tracking-wide">LUB</span>
                        <span class="h-px flex-grow bg-ink/10"></span>
                    </div>`
                : '';
            // Marginesy przy przyciskach zniknęły: odstępy niesie teraz `.bill-banner-actions`
            // jedną wartością dla całego kafelka, więc nie da się ich rozjechać w jednej
            // gałęzi i nie zauważyć tego w czterech pozostałych.
            return billBannerHtml({
                chipClass: 'chip text-info',
                chip: 'Uzupełniamy',
                title: tytul,
                body: trescHtml,
                extra: restBreakdownHtml(bill, calculations),
                actions: `${przypomnijHtml}${lubHtml}<button id="close-bill-btn" class="btn btn-dark w-full">${brakStawki ? 'Domknij rachunek' : 'Podziel resztę'}</button>`,
            });
        };

        const wireGateBanner = () => {
            const zamknij = document.getElementById('close-bill-btn');
            if (zamknij) zamknij.onclick = () => openCloseBillSheet();
            const przypomnij = document.getElementById('remind-fill-btn');
            if (przypomnij) przypomnij.onclick = () => sendFillReminders();
        };

        // PRZYPOMNIENIE O UZUPEŁNIENIU — jedyny sygnał, który wysyła TU człowiek, nie zegar.
        // Automat po iluś godzinach byłby wygodny, ale reguła progu sygnału (docs/UI-UX.md
        // §10.2) mówi wprost: sygnał kosztuje i dostaje go to, co dotyczy moich pieniędzy.
        // Push „ktoś czeka, aż klikniesz" wysłany przez zegar uczy ignorować powiadomienia.
        // Otwiera TEN SAM arkusz, co przypomnienie o zwrocie: szablony, własna treść,
        // potwierdzenie przy wysyłce do kilkunastu osób. Wysyłka jednym stuknięciem, bez okna,
        // była tu wcześniej wyjątkiem od reguły — a przypomnienie budzi cudzy telefon
        // niezależnie od tego, czy prosi o pieniądze, czy o kliknięcie.
        const sendFillReminders = () => {
            const my = myMemberNow();
            if (!my || !billData) return;
            const spozniacy = Object.values(billData.participants || {})
                .filter((p) => p.status !== PARTICIPANT_OUT && p.id !== my.id && !participantReady(billData, p.id));
            if (!spozniacy.length) { showToast('Wszyscy już coś stuknęli.'); return; }
            // Kwota zero: to nie jest upomnienie o pieniądze, tylko prośba o ruch.
            openNudgeCompose(
                spozniacy.map((p) => ({ toId: p.id, amountG: 0 })),
                billData.currency || 'PLN',
                null,
                { kind: 'fill', billId: currentBillId, billName: billData.billName || '' },
            );
        };

        // ARKUSZ ZAMKNIĘCIA. Dwie drogi, żadna nie zaznaczona z góry.
        const openCloseBillSheet = () => {
            if (!billData) return;
            const gate = billSettleGate(billData);
            if (gate.open) { showToast('Ten rachunek jest już gotowy do rozliczeń.'); return; }
            const cur = billData.currency || 'PLN';
            const calculations = calculateAllForBill(billData);
            // CAŁA KWOTA NIEROZPISANA, NIE SAMA NADWYŻKA (poprawione po audycie 2026-08-26).
            //
            // Stało tu `gate.unallocatedG`, czyli kwota NICZYJA — a na rachunku zamkniętym,
            // do którego ktoś dopisał pozycję, jest to wyłącznie ta nowa część. Zapisanie jej
            // jako `restSettledG` znaczyło, że decyzja obejmuje 60 zł z wiszących 240 —
            // więc po zamknięciu brama natychmiast wracała na miejsce i RACHUNKU NIE DAŁO SIĘ
            // JUŻ ZAMKNĄĆ ANI RAZU. Płatnik, który poprawił własny rachunek, blokował ekipie
            // przelewy na zawsze.
            //
            // Decyzja o reszcie jest jedna i niepodzielna: `restTo` to jedna lista dla całej
            // kwoty, więc zamknięcie rozstrzyga CAŁOŚĆ nierozpisanego na nowo.
            const wiszaceG = toGrosze(calculations.unallocated);

            // NIC DO PODZIAŁU, TYLKO DO POTWIERDZENIA (reguła „każdy ma stawkę").
            //
            // Rachunek spina się co do grosza, więc `wiszaceG` wynosi zero i zwykły arkusz
            // proponowałby „podziel 0,00 po równo" — czyli zdanie bez treści. Decyzja jest
            // tu innego rodzaju: nie „komu przypisać pieniądze", tylko „czy ci ludzie
            // naprawdę nic nie brali". Odpowiedź zapisujemy tą samą flagą (`settleOpen`),
            // bo znaczy dokładnie to samo: płatnik wziął rachunek na siebie i domknął go.
            if (gate.reason === 'nostake') {
                const ludzie = (gate.bezStawki || []).map((id) => ({ id, name: memberName(id) }));
                const tytul = document.getElementById('close-bill-title');
                if (tytul) tytul.textContent = 'Domknij rachunek';
                document.getElementById('close-bill-summary').innerHTML = `
                    <div class="block-quiet p-4">
                        <div class="flex items-baseline justify-between gap-3">
                            <span class="font-bold">Nie ${ludzie.length === 1 ? 'wziął/ęła' : 'wzięli'} ani jednej pozycji</span>
                            <span class="text-2xl font-bold tabular-nums">${ludzie.length}</span>
                        </div>
                        ${peopleListHtml(ludzie)}
                        <p class="text-sm text-ink-2 mt-2">Rachunek spina się co do grosza, więc nie ma czego dzielić — ale ${cudzaCzescHtml(ludzie.length)}. Domknięcie <b class="text-ink">odblokuje regulowanie płatności</b> i zostawi kwoty takie, jakie są teraz.</p>
                    </div>`;
                const boxBezStawki = document.getElementById('close-bill-options');
                boxBezStawki.innerHTML = `
                    <button class="close-bill-opt btn btn-dark w-full">Domknij rachunek</button>
                    <p class="text-sm text-ink-2 -mt-1">Tak robimy, gdy te osoby naprawdę nic nie brały. Jeśli tylko nie zdążyły stuknąć — lepiej poczekać albo im przypomnieć.</p>
                    <button id="close-bill-later" class="btn btn-quiet w-full">Jeszcze poczekam</button>`;
                boxBezStawki.querySelector('.close-bill-opt').onclick = () => applyBillClose(null, 0);
                document.getElementById('close-bill-later').onclick =
                    () => closeModal(document.getElementById('close-bill-modal'));
                document.getElementById('close-bill-modal').classList.add('active');
                return;
            }
            const tytulPodzialu = document.getElementById('close-bill-title');
            if (tytulPodzialu) tytulPodzialu.textContent = 'Podziel resztę';

            const aktywni = Object.values(billData.participants || {}).filter((p) => p.status !== PARTICIPANT_OUT);
            const spozniacy = aktywni.filter((p) => !participantReady(billData, p.id));

            // Rachunek zamykany PONOWNIE: część tej kwoty była już kiedyś rozdzielona,
            // a to zamknięcie rozstrzyga ją na nowo. Bez tego zdania płatnik widzi kwotę
            // większą niż ta, o której mówił baner, i nie ma jak tego pogodzić.
            const juzRozdzieloneG = Math.max(0, wiszaceG - (gate.unallocatedG || 0));
            const ponownieHtml = juzRozdzieloneG > 0
                ? `<p class="text-sm text-ink-2 mt-2">W tym <b class="text-ink">${fmtMoney(juzRozdzieloneG, cur)}</b> rozdzielone przy poprzednim podziale — ta decyzja rozstrzyga całość na nowo.</p>`
                : '';
            // Odstęp niesie tu OPAKOWANIE, a nie same akapity: `restBreakdownHtml` stoi też
            // w kafelku stanu rachunku, gdzie odstępy rozdaje `gap` całego kafelka i własny
            // margines akapitu dokładałby się do niego drugi raz.
            const rozpiskaHtml = restBreakdownHtml(billData, calculations);
            document.getElementById('close-bill-summary').innerHTML = `
                <div class="block-quiet p-4">
                    <div class="flex items-baseline justify-between gap-3">
                        <span class="font-bold">Nikt nie wziął</span>
                        <span class="text-2xl font-bold tabular-nums">${fmtMoney(wiszaceG, cur)}</span>
                    </div>
                    ${rozpiskaHtml ? `<div class="mt-2 space-y-2">${rozpiskaHtml}</div>` : ''}
                    ${ponownieHtml}
                    <p class="text-sm text-ink-2 mt-2">Podział tej kwoty <b class="text-ink">domyka rachunek</b> i odblokowuje regulowanie płatności — od tej chwili ekipa może oddawać pieniądze.</p>
                </div>`;

            const perWszyscyG = aktywni.length ? Math.ceil(wiszaceG / aktywni.length) : 0;
            const opcje = [`
                <button class="close-bill-opt btn btn-dark w-full" data-rest="all">Podziel po równo</button>
                <p class="text-sm text-ink-2 -mt-1">Po <b class="text-ink">${fmtMoney(perWszyscyG, cur)}</b> na każdą z ${aktywni.length} ${plural(aktywni.length, 'osoby', 'osób', 'osób')}. Tak robimy, gdy to była wspólna rzecz — wino, przystawka, napiwek.</p>`];

            // Druga droga pokazuje się TYLKO wtedy, gdy jest komu przypisać. Przy rachunku,
            // na którym wszyscy coś stuknęli, nie ma „spóźnialskich" i pytanie nie ma adresata.
            if (spozniacy.length > 0 && spozniacy.length < aktywni.length) {
                const perSpozG = Math.ceil(wiszaceG / spozniacy.length);
                // „LUB" MIĘDZY DROGAMI. Dwa przyciski jeden pod drugim czyta się jak listę
                // kroków do wykonania po kolei, a to są DWIE WYKLUCZAJĄCE SIĘ odpowiedzi na
                // jedno pytanie. Żadna nie jest zaznaczona z góry, więc rozdzielenie ich
                // słowem jest jedyną rzeczą, która mówi „wybierz jedną".
                opcje.push(`
                    <div class="flex items-center gap-3 py-1">
                        <span class="h-px flex-grow bg-ink/10"></span>
                        <span class="text-xs font-bold text-ink-3 tracking-wide">LUB</span>
                        <span class="h-px flex-grow bg-ink/10"></span>
                    </div>
                    <button class="close-bill-opt btn btn-dark w-full" data-rest="late">Wrzuć spóźnialskim</button>
                    <p class="text-sm text-ink-2 -mt-1">Po <b class="text-ink">${fmtMoney(perSpozG, cur)}</b> dla ${spozniacy.length} ${plural(spozniacy.length, 'osoby', 'osób', 'osób')}, które nie stuknęły ani jednej pozycji. Tak robimy, gdy to było czyjeś jedzenie.</p>
                    ${peopleListHtml(spozniacy)}`);
            }

            opcje.push(`<button id="close-bill-later" class="btn btn-quiet w-full">Jeszcze poczekam</button>`);
            const box = document.getElementById('close-bill-options');
            box.innerHTML = opcje.join('');
            box.querySelectorAll('.close-bill-opt').forEach((btn) => {
                btn.onclick = () => applyBillClose(
                    btn.dataset.rest === 'late' ? spozniacy.map((p) => p.id) : null,
                    wiszaceG,
                );
            });
            document.getElementById('close-bill-later').onclick =
                () => closeModal(document.getElementById('close-bill-modal'));
            document.getElementById('close-bill-modal').classList.add('active');
        };

        const applyBillClose = (restTo, wiszaceG) => {
            const my = myMemberNow();
            closeModal(document.getElementById('close-bill-modal'));
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            // `fireWrite`, nie `await`: przy braku sieci obietnica z `updateDoc` NIE ROZWIĄZUJE
            // SIĘ NIGDY (zapis czeka w kolejce na potwierdzenie serwera). Czekanie na nią
            // zostawiłoby płatnika bez ani jednego znaku, że cokolwiek się stało — a przy
            // stole w restauracji brak zasięgu jest normą, nie wyjątkiem. Kopia w pamięci
            // wie swoje od razu, więc ekran przerysuje się sam.
            fireWrite(updateDoc(billDocRef, {
                settleOpen: true,
                // `everOpened` nie wraca już nigdy do false: rachunek raz otwarty musi
                // zostać w księdze długów, bo ktoś mógł za niego zapłacić.
                everOpened: true,
                closedAt: serverTimestamp(),
                closedBy: (my && my.id) || null,
                restTo: restTo || null,
                restSettledG: Math.max(0, Math.round(wiszaceG || 0)),
            }), 'Nie udało się podzielić reszty.');
            logEvent({
                type: 'bill-closed',
                billId: currentBillId,
                label: wiszaceG <= 0
                    ? `domknął/ęła rachunek „${billData.billName}" — nic nie zostało do podziału`
                    : (restTo
                        ? `podzielił/a resztę rachunku „${billData.billName}" — nierozpisane ${fmtMoney(wiszaceG, billData.currency)} dla tych, którzy nie stuknęli swoich pozycji`
                        : `podzielił/a resztę rachunku „${billData.billName}" — nierozpisane ${fmtMoney(wiszaceG, billData.currency)} po równo`),
            });
            showToast('Rachunek gotowy — można się rozliczać.');
            // (ta sama wiadomość dla obu dróg domknięcia: dla ekipy zmienia się dokładnie
            // jedna rzecz — od tej chwili da się oddawać pieniądze)
        };

        // „TO NIE MOJE" — jedyne wyjście dla kogoś, komu przypisano resztę bez jego udziału.
        // Nie otwiera rachunku samo: otwarcie przelicza kwoty ludziom, którzy mogli już
        // zapłacić, więc decyzja należy do tego, kto zamykał.
        const requestBillReopen = async () => {
            const my = myMemberNow();
            if (!my || !billData) return;
            const doKogo = billData.closedBy || billData.payerId;
            if (!doKogo || doKogo === my.id) { showToast('Resztę na tym rachunku podzieliłeś/aś sam/a.'); return; }
            const ok = await sendNudge(doKogo, 0, billData.currency || 'PLN', REOPEN_NUDGE_MESSAGE, {
                kind: 'reopen',
                billId: currentBillId,
                billName: billData.billName || '',
            });
            if (ok) showToast(`Prośba poszła do: ${memberName(doKogo)}.`);
        };

        // OTWARCIE COFA DECYZJĘ O RESZCIE, nie tylko zdejmuje blokadę.
        //
        // Wracamy DOKŁADNIE do stanu sprzed zamknięcia: kwota, której nikt nie wziął, znów
        // jest niczyja, a przypisanie spóźnialskim znika. Zostawienie `restTo` przy otwartym
        // rachunku byłoby najgorszym z możliwych stanów — ludzie klikaliby swoje pozycje,
        // mając w tle cudzą decyzję sprzed poprawki, o której nikt już nie pamięta.
        //
        // `everOpened` zostaje na true: rachunek raz otwarty nie wypada z księgi długów,
        // bo mogły już za niego pójść wpłaty (patrz functions/calc.js).
        const reopenBill = (billId) => {
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, billId);
            fireWrite(
                updateDoc(billDocRef, {
                    settleOpen: false,
                    restTo: null,
                    restSettledG: 0,
                    closedBy: null,
                }),
                'Nie udało się otworzyć rachunku.',
            );
            showToast('Podział cofnięty — ekipa może poprawić swoje pozycje.');
        };

        // Otwarcie z ekranu rachunku, ręką płatnika albo admina. Osobno od `reopenBill`,
        // bo tu trzeba ostrzec: kwoty się przeliczą, a ktoś mógł już zapłacić.
        const reopenBillWithConfirm = () => {
            if (!currentBillId || !billData) return;
            const zaplacili = billSettledBy(perBillNow(), currentBillId).filter((x) => x.paidG > 0).length;
            // Rachunek domknięty BEZ podziału (reguła „każdy ma stawkę") nie ma czego cofać
            // w kwotach — cofa się samo domknięcie. Zdanie o „podziale kwoty nierozpisanej"
            // mówiłoby wtedy o czymś, co nigdy się nie wydarzyło.
            const cofamyPodzial = (billData.restSettledG || 0) > 0;
            const cofamyHtml = cofamyPodzial
                ? 'Podział kwoty nierozpisanej zostanie cofnięty, a ekipa znów będzie mogła klikać pozycje.'
                : 'Rachunek wróci do uzupełniania, a ekipa znów będzie mogła klikać pozycje.';
            openConfirm({
                title: cofamyPodzial ? 'Cofnąć podział reszty?' : 'Cofnąć domknięcie rachunku?',
                body: zaplacili > 0
                    ? `${cofamyHtml} ${zaplacili} ${plural(zaplacili, 'osoba już zapłaciła', 'osoby już zapłaciły', 'osób już zapłaciło')} — ich kwoty się przeliczą, a różnica pojawi się w rozliczeniach.`
                    : `${cofamyHtml} Przelewy z tego rachunku znów będą zablokowane.`,
                confirmLabel: cofamyPodzial ? 'Cofnij podział' : 'Cofnij domknięcie',
                tone: 'brand',
                onConfirm: () => reopenBill(currentBillId),
            });
        };

        // PODPIS POD KAFELKIEM ZNIKNĄŁ — I FUNKCJA ZNIKA RAZEM Z NIM.
        //
        // `getBillSummaryHtml` budowało drugi wiersz na kafelku rachunku. Przebudowa listy
        // z 2026-08-26 („robi się bardzo dużo informacji na tej zakładce") zdjęła ten wiersz
        // z widoku, ale funkcja została i była WOŁANA PRZY KAŻDYM ODRYSOWANIU, a jej wynik
        // po cichu wyrzucany. Wyszło to dopiero przy teście w przeglądarce 2026-08-27:
        // dwa razy poprawiałem w niej treść, przekonany, że zmieniam coś na ekranie.
        //
        // Wszystko, co mówiła, mówi dziś `billStatus` — jednym słownikiem, dla kafelka
        // rachunku i dla wiersza rozliczenia naraz.

        // --- STATUS RACHUNKU: jeden słownik na cały interfejs ---
        //
        // Kolor w tej aplikacji znaczy STAN PIENIĘDZY, nigdy tożsamość i nigdy ozdobę.
        // Cztery tony i nic więcej:
        //   action — czeka na TWÓJ ruch (błękit stanu; jedyny ton, który barwi całe tło)
        //   wait   — zrobione po twojej stronie, czeka na kogoś innego (ton cichy)
        //   owe    — jesteś winien (czerwień)
        //   due    — wyłożyłeś, pieniądze mają wrócić do ciebie (zieleń)
        //   none   — nie dotyczy cię (szarość)
        // Ten sam słownik obsługuje kafelek rachunku i wiersz rozliczenia, więc czerwień
        // nie może znaczyć w dwóch miejscach dwóch różnych rzeczy.
        const STATUS_TONES = {
            action: { chip: 'chip text-info', amount: 'font-bold text-info' },
            wait:   { chip: 'chip', amount: 'font-bold text-ink-3' },
            owe:    { chip: 'chip text-owe', amount: 'font-bold text-owe tabular-nums' },
            due:    { chip: 'chip text-due', amount: 'font-bold text-due tabular-nums' },
            none:   { chip: 'chip', amount: 'font-bold text-ink-3' },
        };

        const billStatus = (bill, myMember, myParticipant) => {
            // `labelHtml`, nie `label`: etykieta bywa złożona z imienia pobranego z bazy
            // i jest escapowana TU, przy budowie. Nazwa mówi wprost, że dalej jedzie
            // gotowy fragment znaczników — strażnik w render.safety.test.js czyta nazwy.
            const make = (tone, labelHtml, amount = '') => ({
                tone,
                labelHtml,
                amount,
                chipClass: STATUS_TONES[tone].chip,
                amountClass: STATUS_TONES[tone].amount,
            });

            if (!myParticipant || myParticipant.status === 'not_applicable') return make('none', 'Nie dotyczy Cię');
            // SYGNAŁ DOSTAJE TEN, KTO MOŻE WYKONAĆ CZYNNOŚĆ — I NIKT INNY.
            //
            // Reguła istniała tu od 2026-08-17 („wołanie do czynności, której ta osoba nie
            // ma jak wykonać" jest usterką), ale obowiązywała tylko w jednym miejscu.
            // Rachunek BEZ WSKAZANEGO PŁATNIKA nie ma właściciela zadania z definicji — kod
            // nie ma skąd wiedzieć, kto wyłożył pieniądze — więc ton `action` szedł do
            // WSZYSTKICH uczestników. Przy ekipie piętnastu osób jeden świeży rachunek
            // zapalał „czeka na Twój ruch" piętnastu ludziom, a robiła to jedna osoba
            // w pięć sekund. Wszyscy zaalarmowani, nikt odpowiedzialny — najgorszy możliwy
            // rodzaj sygnału i najkrótsza droga do ślepoty na kropkę.
            //
            // Chip zostaje w każdym z tych przypadków: informacja jest, tylko przestaje być
            // wezwaniem. Ton `wait` nie zapala ani kropki, ani wiersza „czeka na Ciebie".
            // IMIĘ PŁATNIKA ZNIKNĘŁO ZE STATUSÓW (zgłoszenie właściciela 2026-08-29:
            // „jest napisane «Płaci Mikołaj» i jest jego avatar — może wystarczy sam avatar").
            // Miał rację i to nie jest tylko oszczędność miejsca: znaczek płatnika stoi
            // w tym samym wierszu, dwa centymetry w lewo, więc imię było DRUGIM nośnikiem
            // tej samej informacji — a przy „Bartłomiej" zjadało pół kolumny, przez co nazwa
            // rachunku, czyli tożsamość wiersza, musiała się skracać. Pełne imię stoi na
            // karcie rachunku, gdzie jest miejsce i gdzie ktoś realnie o nie pyta.
            // Statusy mówią teraz o STANIE, a kto — mówi twarz.
            if (!bill.payerId) return make('wait', 'Wskaż, kto płacił');
            if (!bill.payerConfirmed) {
                return myMember.id === bill.payerId
                    ? make('action', 'Potwierdź, że zapłaciłeś/aś')
                    : make('wait', 'Czeka na płatnika');
            }
            // Patrz uwaga wyżej: dla niepłatnika to nie jest zadanie, tylko oczekiwanie.
            // Ton 'action' zapala kropkę i wciąga rachunek do „Czeka na Ciebie", więc dawał
            // sygnał o czynności, której ta osoba nie może wykonać.
            if (!bill.totalAmount || bill.totalAmount <= 0) {
                return (bill.payerConfirmed && myMember.id !== bill.payerId)
                    ? make('wait', 'Czeka na kwotę')
                    : make('action', 'Uzupełnij kwotę');
            }
            // W trybie „po równo" nikt niczego nie uzupełnia, więc ten stan tam nie
            // istnieje — i to jest cała różnica między dwoma trybami rachunku.
            if (!participantReady(bill, myMember.id)) return make('action', 'Stuknij, co Twoje');

            // BRAMA NA LIŚCIE RACHUNKÓW. Kto zrobił swoje, a rachunek dalej się uzupełnia,
            // ma to zobaczyć NA LIŚCIE — inaczej kafelek pokazuje ostateczną kwotę i budzi
            // pytanie, czemu jej nie da się oddać dopiero po wejściu do środka.
            const gate = billSettleGate(bill);
            if (!gate.open) {
                // Nadwyżkę poprawia ten, kto ma otwarte pola rachunku — czyli płatnik
                // (i admin). Reszta ekipy widzi, że coś się nie zgadza, ale nie dostaje
                // wezwania do czynności, której nie ma jak wykonać.
                if (gate.reason === 'over') {
                    return isPrimaryCloser(bill, myMember.id)
                        ? make('action', 'Rachunek się nie spina')
                        : make('wait', 'Rachunek się nie spina');
                }
                // CHIP NA LIŚCIE OPISUJE STAN RACHUNKU, NIE WYDAJE POLECENIA
                // (zgłoszenie właściciela 2026-08-27: „«Podziel resztę» jako status jest
                // totalnie bez sensu"). Lista rachunków odpowiada na pytanie „co się dzieje
                // z moimi pieniędzmi", a nie „co mam teraz zrobić" — polecenie należy do
                // wnętrza rachunku, gdzie stoi przycisk i całe wyjaśnienie.
                //
                // Ton zostaje różny dla obu ról i to on niesie „czyj ruch": płatnik i admin
                // dostają błękit stanu (kropka, wiersz „Czeka na Ciebie"), reszta ekipy samą
                // informację. Zmienia się słowo, nie sygnał.
                return make(isPrimaryCloser(bill, myMember.id) ? 'action' : 'wait', 'Rachunek się uzupełnia');
            }

            const calculations = calculateAllForBill(bill);
            const myCalc = calculations.participantTotals.find(pt => pt.participant.id === myMember.id);
            const myTotal = myCalc ? myCalc.total : 0;
            const money = (v) => `${v.toFixed(2).replace('.', ',')} ${bill.currency}`;

            // Wyłożyłeś: pieniądze są na zewnątrz i mają wrócić. Twój własny udział nie jest
            // długiem, więc pokazujemy to, co realnie czekasz odzyskać.
            if (bill.payerId === myMember.id) {
                const outstanding = Math.max(0, calculations.controlSum - myTotal);
                return make('due', 'Wyłożyłeś/aś', money(outstanding));
            }
            return make('owe', 'Do oddania', money(myTotal));
        };

        // --- Tożsamość uczestnika: zdjęcie, a bez zdjęcia kolor z literą ---
        // Zdjęcie ma pierwszeństwo zawsze: to twarze robią z tego ekranu ludzi, a nie
        // księgowość. Bez zdjęcia zostaje pełne koło w nasyconym kolorze osoby z białą
        // literą — czytelne przy dwudziestu ośmiu pikselach i przy dwudziestu pięciu osobach.
        const PROFILE_COLORS = IDENTITY_COLORS;
        const colorForMember = (memberId, name) => {
            const explicit = ((groupData && groupData.members && groupData.members[memberId]) || {}).color;
            // Przyjmujemy KAŻDY poprawny zapis szesnastkowy, nie tylko kolory z palety.
            // Do 2026-08-15 stało tu sprawdzenie przynależności do zamkniętego zbioru —
            // miało chronić przed kolorami ze starych palet, ale po wprowadzeniu suwaka
            // odrzucałoby własny wybór człowieka i po cichu wracało do koloru z losowania.
            // Wzorzec jest twardy, więc do atrybutu stylu nadal nie wejdzie nic innego
            // niż sześć znaków szesnastkowych.
            if (/^#[0-9a-f]{6}$/i.test(String(explicit || ''))) return explicit.toUpperCase();
            return identityColor(memberId, name);
        };
        // sizeClass podmienia rozmiar/odstęp (nie dokłada się do domyślnych) — inaczej przy Tailwindzie
        // konkurencyjne klasy w rodzaju w-9 i w-6 rozstrzyga kolejność w arkuszu, nie w atrybucie.
        // Adres zdjęcia i kolor pochodzą z bazy, a do dokumentu grupy pisze każdy, kto ma link.
        // Bez escapowania wystarczyłoby ustawić sobie „zdjęcie" z cudzysłowem w środku, żeby
        // wyjść z atrybutu i wstrzyknąć kod, który wykona się u WSZYSTKICH członków grupy.
        const avatarHtml = (name, memberId, sizeClass = 'w-10 h-10 text-base mr-3') => {
            const member = (groupData && groupData.members && groupData.members[memberId]) || {};
            if (member.photoURL) {
                return `<img src="${escapeHtml(member.photoURL)}" alt="" class="rounded-full object-cover flex-shrink-0 ${sizeClass}">`;
            }
            const color = colorForMember(memberId, name);
            const mark = escapeHtml(initials(name));
            // Kolor idzie atrybutem stylu, bo to dana z bazy — klasa sklejana ze stringu
            // wyparowałaby przy kompilacji Tailwinda.
            // Litera dobiera kolor sama: ciemna na jasnym znaku, biała na ciemnym.
            // Do 2026-08-15 była zawsze biała, co wymuszało paletę wyłącznie ciemnych
            // barw i to właśnie ta jedna linijka trzymała szesnaście kolorów w jednym
            // wąskim pasmie jasności. `readableInk` zwraca jedną z DWÓCH barw systemu,
            // więc do znaczników nie wchodzi nic z bazy.
            return `<span class="rounded-full flex-shrink-0 inline-flex items-center justify-center font-bold ${sizeClass}" style="background-color:${escapeHtml(color)};color:${readableInk(color)}">
                <span style="font-size:0.72em">${mark}</span>
            </span>`;
        };

        // PŁATNIK JESZCZE NIEZNANY — pytajnik w kole, a nie dziura po znaku.
        //
        // Rachunek bez wskazanego płatnika miał w wierszu PUSTE miejsce: kolumna znaków
        // rozjeżdżała się, a brak niczego nie znaczył. Pytajnik trafia w tę samą kolumnę,
        // co twarze, i mówi to, co jest do powiedzenia — nie wiadomo jeszcze, kto wyłożył
        // pieniądze. Kreskowana obwódka odróżnia go od czyjegoś znaku: to puste miejsce
        // do wypełnienia, a nie osoba o dziwnym kolorze.
        const unknownPayerHtml = (sizeClass = 'w-11 h-11 text-base') =>
            `<span class="rounded-full flex-shrink-0 inline-flex items-center justify-center font-bold border-2 border-dashed border-ink-3/40 text-ink-3 ${sizeClass}" aria-label="Nie wiadomo, kto płacił" title="Nie wiadomo, kto płacił">
                <span style="font-size:0.72em">?</span>
            </span>`;

        // --- Faza 4/5-bridge: metody płatności per osoba (wiele: konto, telefon, Revolut, PayPal, własne) ---
        const PAYMENT_TYPES = {
            account: { label: 'Konto / IBAN', icon: 'fa-building-columns', placeholder: 'Numer konta / IBAN' },
            phone:   { label: 'Telefon (BLIK / Revolut)', icon: 'fa-mobile-screen-button', placeholder: 'Numer telefonu' },
            revolut: { label: 'Revolut', icon: 'fa-at', placeholder: '@nick albo revolut.me/nick' },
            paypal:  { label: 'PayPal', icon: 'fa-paypal', brand: true, placeholder: 'paypal.me/nick albo e-mail' },
            wise:    { label: 'Wise', icon: 'fa-globe', placeholder: 'nick albo wise.com/pay/me/nick' },
            other:   { label: 'Inne (własna nazwa)', icon: 'fa-money-bill-wave', placeholder: 'Numer / adres / uchwyt' },
        };
        const paymentIconClass = (type) => { const t = PAYMENT_TYPES[type] || PAYMENT_TYPES.other; return `${t.brand ? 'fab' : 'fas'} ${t.icon}`; };
        const paymentLabel = (m) => (m && m.type === 'other' && m.label) ? m.label : (PAYMENT_TYPES[(m && m.type)] || PAYMENT_TYPES.other).label;

        // --- SPOSÓB PŁATNOŚCI JAKO ODNOŚNIK -----------------------------------------
        //
        // Do 2026-08-15 uchwyt Revoluta był tekstem do skopiowania i tyle: człowiek
        // kopiował „@macu", wychodził z aplikacji, szukał Revoluta, wklejał. Trzy ruchy
        // na coś, co telefon potrafi zrobić jednym. Teraz uchwyt, który da się otworzyć,
        // dostaje przycisk otwierający aplikację albo stronę, a kopiowanie zostaje OBOK,
        // bo część ludzi i tak woli wkleić sobie sama.
        //
        // Numer konta i telefon zostają przy kopiowaniu (telefon dodatkowo przy dzwonieniu):
        // nie ma dokąd ich „otworzyć", a udawanie, że jest, kończy się pustym ekranem.
        //
        // Adres składamy WYŁĄCznie z uchwytu i znanej domeny — nigdy nie wstawiamy
        // cudzego tekstu jako adresu, bo pole wpisuje dowolna osoba z pokoju, a `href`
        // przyjmujący czyjś tekst to otwarta furtka na `javascript:`.
        const paymentHandle = (value) => String(value || '')
            .trim()
            .replace(/^https?:\/\//i, '')
            .replace(/^(www\.)?(revolut\.me|paypal\.me|wise\.com\/pay\/me)\//i, '')
            .replace(/^@/, '')
            .replace(/[^A-Za-z0-9._-]/g, '');

        const paymentLink = (m) => {
            if (!m || !m.value) return null;
            const raw = String(m.value).trim();
            if (m.type === 'phone') {
                const digits = raw.replace(/[^\d+]/g, '');
                return digits.length >= 6 ? { href: `tel:${digits}`, label: 'Zadzwoń', icon: 'fa-phone' } : null;
            }
            if (m.type === 'revolut') {
                const h = paymentHandle(raw);
                return h ? { href: `https://revolut.me/${h}`, label: 'Otwórz Revolut', icon: 'fa-arrow-up-right-from-square' } : null;
            }
            if (m.type === 'paypal') {
                // Adres e-mail nie ma postaci linku płatniczego — zostaje do skopiowania.
                if (raw.includes('@') && !/^@/.test(raw)) return null;
                const h = paymentHandle(raw);
                return h ? { href: `https://paypal.me/${h}`, label: 'Otwórz PayPal', icon: 'fa-arrow-up-right-from-square' } : null;
            }
            if (m.type === 'wise') {
                const h = paymentHandle(raw);
                return h ? { href: `https://wise.com/pay/me/${h}`, label: 'Otwórz Wise', icon: 'fa-arrow-up-right-from-square' } : null;
            }
            if (m.type === 'other') {
                // Własna metoda bywa po prostu linkiem. Przyjmujemy TYLKO http(s) —
                // żadnego `javascript:` ani `data:` z cudzego pola.
                const url = /^https:\/\/[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? raw
                    : (/^http:\/\/[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? raw : null);
                return url ? { href: url, label: 'Otwórz', icon: 'fa-arrow-up-right-from-square' } : null;
            }
            return null;
        };

        // Wiersz metody płatności w oknie „Ureguluj". Dwie drogi obok siebie: otwórz
        // albo skopiuj. `rel="noopener"` obowiązkowo — obce okno nie ma prawa sięgnąć
        // do naszego przez `window.opener`.
        const paymentMethodRowHtml = (m) => {
            const link = paymentLink(m);
            return `<div class="pay-method">
                <i class="${paymentIconClass(m.type)} text-ink-3 w-5 text-center flex-shrink-0"></i>
                <div class="flex-grow min-w-0">
                    <p class="text-xs font-bold text-ink-3">${escapeHtml(paymentLabel(m))}</p>
                    <p class="text-sm credential truncate">${escapeHtml(m.value)}</p>
                </div>
                ${link ? `<a class="pay-method-open tap" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer"><i class="fas ${link.icon}"></i>${escapeHtml(link.label)}</a>` : ''}
                <button class="copy-account-btn tap min-h-tap px-3 rounded-full text-sm font-bold text-ink bg-surface flex-shrink-0" data-account="${escapeHtml(m.value)}" title="Kopiuj">Kopiuj</button>
            </div>`;
        };
        // Backward-compat: stare pojedyncze accountNumber czytane jako jedna metoda „konto".
        const getPaymentMethods = (member) => {
            if (!member) return [];
            if (Array.isArray(member.paymentMethods)) return member.paymentMethods.filter(m => m && m.value);
            if (member.accountNumber) return [{ type: 'account', value: member.accountNumber }];
            return [];
        };
        // Rodzaj dodawanej metody. Trzymany w `data-value` przycisku, nie w `<select>`:
        // to była OSTATNIA lista systemowa w aplikacji i wyglądała dokładnie tak, jak
        // opisuje DESIGN.md („Wybór z listy"): biały prostokąt z niebieskim zaznaczeniem
        // i cudzą czcionką na ciemnym ekranie. Widać to na zrzucie właściciela.
        const setPaymentAddType = (type) => {
            const btn = document.getElementById('pm-add-type');
            const label = document.getElementById('pm-add-type-label');
            const t = PAYMENT_TYPES[type] || PAYMENT_TYPES.other;
            if (btn) btn.dataset.value = type;
            if (label) label.textContent = t.label;
            const labelInput = document.getElementById('pm-add-label');
            if (labelInput) labelInput.classList.toggle('hidden', type !== 'other');
            const valueInput = document.getElementById('pm-add-value');
            if (valueInput) valueInput.placeholder = t.placeholder;
        };

        // Edytor metod płatności (modal). Pracuje na kopii roboczej, zapisuje całą tablicę do Firestore.
        const savePaymentMethods = async () => {
            if (!paymentEditMemberId || !currentGroupId) return;
            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            await updateDoc(groupDocRef, { [`members.${paymentEditMemberId}.paymentMethods`]: paymentEditMethods });
        };
        const renderPaymentEditor = () => {
            const list = document.getElementById('payment-methods-list');
            if (!list) return;
            if (paymentEditMethods.length === 0) {
                list.innerHTML = `<p class="text-sm text-ink-3">Brak metod. Dodaj pierwszą poniżej.</p>`;
                return;
            }
            list.innerHTML = paymentEditMethods.map((m, i) => `
                <div class="card flex items-center gap-2 p-2">
                    <i class="${paymentIconClass(m.type)} text-ink-3 w-4 text-center"></i>
                    <div class="flex-grow min-w-0">
                        <p class="text-sm font-bold text-ink-3">${escapeHtml(paymentLabel(m))}</p>
                        <input class="pm-value-edit credential w-full text-sm p-1 bg-transparent outline-none" value="${escapeHtml(m.value)}" data-index="${i}" placeholder="wartość">
                    </div>
                    <button class="pm-remove-btn tap w-11 h-11 rounded-full flex items-center justify-center text-ink-3 flex-shrink-0" data-index="${i}" title="Usuń" aria-label="Usuń sposób płatności"><i class="fas fa-trash text-sm"></i></button>
                </div>
            `).join('');
        };
        const openPaymentModal = () => {
            const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;
            paymentEditMemberId = myMember.id;
            paymentEditMethods = getPaymentMethods(myMember).map(m => ({ ...m }));
            renderPaymentEditor();
            setPaymentAddType('account');
            document.getElementById('pm-add-label').value = '';
            document.getElementById('pm-add-value').value = '';
            document.getElementById('payment-methods-modal').classList.add('active');
        };

        // --- Faza 5: widok „Rozliczenia" (ledger kto komu ile / min. przelewów) + „Ureguluj" ---
        const CURRENCY_ORDER = ['PLN', 'EUR', 'USD'];
        const memberName = (id) => ((groupData && groupData.members && groupData.members[id]) || {}).name || 'Ktoś';
        const fmtMoney = (amountG, currency) => `${fromGrosze(amountG).toFixed(2).replace('.', ',')} ${currency}`;
        // Nazwa rachunku po identyfikatorze — potrzebna wszędzie tam, gdzie o rachunku
        // mówi coś, co nie jest samym rachunkiem: wpłata, skrzynka, rejestr.
        const billNameById = (id) => {
            const b = latestBills.find((x) => x.id === id);
            return (b && b.data && b.data.billName) || '';
        };

        // ZA CO BYŁA WPŁATA — nazwy rachunków, które pokrywa. `billIds` (tablica) niesie
        // wybór z arkusza „Za co płacisz"; `billId` (jeden napis) zostaje dla wpłat
        // zapisanych, zanim ten wybór istniał. Wpłaty spoza trybu rachunkowego nie mają
        // ani jednego, ani drugiego — i wtedy nie zmyślamy odpowiedzi.
        const billNamesOfSettlement = (s) => {
            const ids = Array.isArray(s && s.billIds) && s.billIds.length
                ? s.billIds
                : ((s && s.billId) ? [s.billId] : []);
            return ids.map(billNameById).filter(Boolean);
        };

        // Zdanie „za co" do wiersza skrzynki i rejestru. Przy jednym rachunku nazwa
        // wprost, przy kilku — liczba i wyliczenie, bo pięć nazw w jednej linii nie
        // mieści się na telefonie, a ucięcie zabiera właśnie tę część, która rozróżnia.
        const settlementForWhat = (s) => {
            const nazwy = billNamesOfSettlement(s);
            if (!nazwy.length) return '';
            if (nazwy.length === 1) return ` za „${escapeHtml(nazwy[0])}"`;
            return ` za ${nazwy.length} ${plural(nazwy.length, 'rachunek', 'rachunki', 'rachunków')}`;
        };

        // Nominał: złotówki niosą wagę, grosze schodzą o klasę niżej. Chwyt podpatrzony
        // w referencjach — przy kolumnie kwot różnica w czytelności jest natychmiastowa.
        // `withCurrency` wyłączamy tam, gdzie waluta jest już powiedziana raz na całą listę
        // (kafelki pozycji, rozpiska udziałów) — dwadzieścia razy „PLN" to szum, nie informacja.
        //
        // USTERKA NAPRAWIONA 2026-08-15: ta funkcja wypisywała klasy `denomination`,
        // `denomination-relief`, `denomination-fraction` i `denomination-currency` —
        // nazwy z odrzuconego świata „druku zabezpieczonego". W arkuszu stylów tych klas
        // NIE MA (są `amount`, `amount-fraction`, `amount-currency`), więc kwota bilansu
        // renderowała się jako goły tekst: bez kroju kwot, bez cichszych groszy i bez
        // odstępu przed walutą. Stąd „120,80PLN" sklejone w jedno słowo, dotykające
        // krawędzi limonkowego bloku. Cicha awaria po zmianie nazw w CSS bez zmiany
        // w JavaScripcie — nic nie zgłaszało błędu, bo brakująca klasa nie jest błędem.
        const amountHtml = (amountG, currency, toneClass, { withCurrency = true } = {}) => {
            const sign = amountG < 0 ? '−' : '';
            const abs = Math.abs(Number(amountG) || 0);
            const whole = Math.floor(abs / 100).toLocaleString('pl-PL');
            const fraction = String(abs % 100).padStart(2, '0');
            const cur = withCurrency ? `<span class="amount-currency">${escapeHtml(currency)}</span>` : '';
            return `<span class="amount ${toneClass}">${sign}${whole}<span class="amount-fraction">,${fraction}</span>${cur}</span>`;
        };

        // Nominał bilansu. Osobna funkcja, bo tu waluta stoi POD kwotą, a stopień pisma
        // zależy od tego, ile znaków ma liczba: przy „1 234 567,00" stały stopień wypychał
        // cyfry poza blok. Cztery stopnie ze skali z DESIGN.md i ani jednego więcej.
        const heroAmountHtml = (amountG, currency, toneClass) => {
            const sign = amountG < 0 ? '−' : '';
            const abs = Math.abs(Number(amountG) || 0);
            const whole = Math.floor(abs / 100).toLocaleString('pl-PL');
            const fraction = String(abs % 100).padStart(2, '0');
            // Liczymy znaki tego, co realnie stanie w wierszu: złotówki, przecinek i grosze.
            // Grosze mają 0,55 stopnia, więc liczą się za pół znaku każdy.
            const width = whole.length + 2;
            const size = width <= 7 ? '3rem' : width <= 10 ? '1.875rem' : '1.25rem';
            return `<div>
                <span class="amount amount-hero ${toneClass}" style="--amount-size:${size}">${sign}${whole}<span class="amount-fraction">,${fraction}</span></span>
                <span class="amount-hero-unit">${escapeHtml(currency)}</span>
            </div>`;
        };

        // --- TRZY TRYBY ROZLICZANIA -------------------------------------------------
        //
        // JEDNA DRABINA ZWIJANIA tego samego długu, a nie trzy księgowości:
        //
        //   min     — zwija MIĘDZY OSOBAMI: optymalizuje trasę pieniędzy (simplifyDebts).
        //   net     — zwija NA OSOBIE: sumuje należności wobec jednej (ledger.net).
        //   perBill — NIE ZWIJA NIC: wiersz na rachunek, w kolejności dodawania.
        //
        // REGUŁA TWARDA: żaden tryb nie dowozi tego, co robi sąsiedni. W „Rachunek po
        // rachunku" NIE MA podsumowań po osobie — kto chce wiedzieć, ile łącznie idzie
        // do Marka, przełącza się na „Kto komu", bo po to on jest.
        const SETTLEMENT_MODES = [
            {
                id: 'min',
                tytul: 'Najmniej przelewów',
                opis: 'Aplikacja układa najkrótszą drogę dla całej ekipy. Przelewów robicie jak najmniej, ale część długów przechodzi bokiem — i wtedy nie da się powiedzieć, który rachunek został opłacony.',
            },
            {
                id: 'perBill',
                tytul: 'Rachunkowy',
                opis: 'Każdy przelew idzie do osoby, która wyłożyła pieniądze za konkretny rachunek. Przelewów jest więcej, za to przy każdym wiadomo, za co jest, a rachunki mają status „opłacone".',
            },
        ];
        // `tytul`/`opis`, a nie `name`/`desc`: strażnik escapowania (render.safety.test.js)
        // czyta NAZWY zmiennych i słusznie traktuje `name` jako daną z bazy. Tu są to
        // napisy z kodu, ale rozszerzanie listy wyjątków w teście po to, żeby przepuścić
        // dwie linie, rozluźniałoby sieć asekuracyjną dla wszystkich następnych.
        const settlementModeName = (id) => (SETTLEMENT_MODES.find((m) => m.id === id) || SETTLEMENT_MODES[0]).tytul;

        // TRYB GRUPY. Brak pola w dokumencie = 'min', czyli zachowanie sprzed etapu 3.
        // Wartość spoza listy też schodzi do 'min': dokument grupy jest zapisywalny przez
        // każdego, kto ma link, więc śmieć w tym polu nie może zepsuć ekranu rozliczeń.
        //
        // `'net'` PRZECHODZI NA `'perBill'`. Przez pół dnia istniał trzeci tryb o tej
        // nazwie („Kto komu") i któryś pokój mógł zdążyć go zapisać. Nie znika bez śladu:
        // to, co robił, jest dziś WIDOKIEM trybu rachunkowego na ekranie Rozliczeń —
        // wiersz na osobę z sumą jej rachunków. Przepisanie zachowuje więc intencję,
        // a nie tylko unika śmiecia w polu.
        const groupSettlementMode = () => {
            const m = groupData && groupData.settlementMode;
            if (m === 'net') return 'perBill';
            return SETTLEMENT_MODES.some((x) => x.id === m) ? m : 'min';
        };

        // Długi rozpisane na rachunki, z naniesionymi wpłatami (src/perbill.js).
        // KSIĘGA DŁUGÓW LICZY TYLKO TO, CO DA SIĘ ZAPŁACIĆ.
        //
        // Rachunek, którego brama nigdy nie była otwarta, ma kwoty WSTĘPNE — wchodzą do
        // niej dopiero po zamknięciu. Bez tego wielka liczba na Bilansie zmieniałaby się
        // pod ludźmi w miarę, jak ekipa odklikuje pozycje, a przelew zrobiony po drodze
        // byłby przelewem za cudze jedzenie.
        //
        // Rachunek RAZ otwarty zostaje w księdze na zawsze, nawet gdy brama się zamknie
        // (`billCountsInLedger`): ktoś mógł już za niego zapłacić, a wpłata bez długu po
        // drugiej stronie tworzy w `buildLedger` krawędź odwrotną — czyli FAŁSZYWY DŁUG
        // w drugą stronę. To ta sama rodzina usterek, co „wiersz widmo" z src/plan.js.
        // RACHUNEK, Z KTÓREGO DA SIĘ JUŻ PŁACIĆ, ZOSTAJE W KSIĘDZE NA ZAWSZE.
        //
        // `everOpened` stawiało dotąd WYŁĄCZNIE ręczne zamknięcie rachunku (`applyBillClose`),
        // a brama otwiera się na trzy sposoby: decyzją płatnika ('closed'), sama z siebie na
        // rachunku rozpisanym co do grosza ('exact') i z założenia w trybie „po równo" ('even').
        // Dwa ostatnie nie zapisywały niczego — więc rachunek, z którego cała ekipa mogła już
        // przelewać, nosił `everOpened: false` i wypadał z księgi przy pierwszej zmianie, która
        // zamykała bramę. Znikały wtedy CUDZE długi z tego rachunku, a wpłata, która już poszła,
        // zamieniała się w `buildLedger` w dług płatnika wobec tego, kto mu zapłacił.
        //
        // Sonda audytowa 2026-08-26: rachunek na 300 zł rozpisany co do grosza, Kuba oddaje
        // swoje 100, płatnik dopisuje zapomnianą herbatę za 50 — i księga mówi, że to PŁATNIK
        // jest winien Kubie 100, a dług Ani znika. Dwieście złotych różnicy z jednego stuknięcia,
        // przy rachunku, który na własnym ekranie dalej pokazuje udziały 100 / 100 / 100.
        //
        // Dlatego flagę stawiamy w chwili, w której staje się prawdziwa: gdy brama pierwszy raz
        // stoi otworem na rachunku z potwierdzonym płatnikiem i kwotą. Zapis jest jednorazowy
        // (`everOpened` nigdy nie wraca do false), idempotentny — dwa telefony zapiszą tę samą
        // wartość — i idzie przez `fireWrite`, więc nie czeka na sieć. `stampedEverOpened`
        // pilnuje tylko tego, żeby nie powtórzyć zapisu, zanim wróci echo z serwera.
        const stampedEverOpened = new Set();
        const stampEverOpened = (groupId) => {
            if (!groupId || groupId !== currentGroupId) return;
            latestBills.forEach(({ id, data }) => {
                if (!data || data.gated !== true || data.everOpened === true) return;
                // Rachunek bez potwierdzonego płatnika albo bez kwoty nie tworzy ANI JEDNEGO
                // długu (`computeBillDebts`), więc nie ma czego trzymać w księdze — a bez tego
                // warunku flagę dostawałby każdy świeżo założony szkic.
                if (!data.payerConfirmed || toGrosze(data.totalAmount || 0) <= 0) return;
                if (!billSettleGate(data).open) return;
                if (stampedEverOpened.has(id)) return;
                stampedEverOpened.add(id);
                fireWrite(
                    updateDoc(doc(db, `artifacts/${appId}/public/data/groups/${groupId}/bills`, id), { everOpened: true }),
                    null,
                );
            });
        };

        // RACHUNEK, KTÓRY SIĘ NIE SPINA, ZNIKA Z EKRANÓW O PIENIĄDZACH (decyzja właściciela
        // 2026-08-27). Nadwyżka znaczy, że dwie liczby na rachunku się kłócą: suma pozycji
        // i kwota, którą płatnik realnie wyłożył. Aplikacja nie była w tej restauracji i nie
        // ma jak rozstrzygnąć, która z nich jest prawdziwa — więc udziały policzone z takiego
        // rachunku są ZMYŚLONE, a nie tylko wstępne.
        //
        // Do tej pory brama blokowała je wyłącznie na ekranie samego rachunku. Zakładka
        // Rozliczenia sumuje długi z wielu rachunków i o bramę nie pytała, więc pokazywała
        // kwotę zawyżoną razem z DZIAŁAJĄCYM przyciskiem „Ureguluj" — a dłużnik, który nie
        // zaglądał do tego rachunku, nie miał jak się zorientować. Sonda: pizza za 33 zł
        // z napiwkiem wpisanym jako 30 zamiast 3 → każdy widział 20,00 zamiast 11,00.
        //
        // Dlatego taki rachunek po prostu NIE ISTNIEJE dla Bilansu i Rozliczeń. Wraca sam,
        // w tej samej sekundzie, w której płatnik poprawi wpis. Nie mówimy o tym ani słowa
        // przy kwotach do oddania: człowiek, który ma zwrócić pieniądze, i tak nie może tego
        // naprawić, a wołanie do czynności, której nie da się wykonać, jest w tej aplikacji
        // uznane za usterkę. Kto chce wiedzieć, widzi na liście rachunków chip „Rachunek się
        // nie spina", a płatnik dostaje z niego pełne wezwanie (kropka, „Czeka na Ciebie").
        //
        // JEDEN WYJĄTEK — I BEZ NIEGO TA ZMIANA BYŁABY GORSZA NIŻ PROBLEM.
        // Wpłata musi mieć w księdze dług, który gasi. Rachunek wyjęty z księgi zostawia
        // wpłaty za niego w powietrzu, a `buildLedger` wyciąga z tego jedyny możliwy wniosek:
        // że to PŁATNIK jest winien pieniądze temu, kto mu właśnie zapłacił. Sonda: Ania
        // oddaje całe 76 zł, potem płatnik psuje jeden z rachunków — i po schowaniu go księga
        // mówi „Michał winien Ani 11 zł". Dlatego rachunek, do którego ktokolwiek już dopłacił,
        // ZOSTAJE (z zawyżoną kwotą, ale bez odwróconego kierunku). W praktyce to rzadkie:
        // rachunek psuje się prawie zawsze zanim ktokolwiek zdążył cokolwiek oddać.
        // Sama reguła (z wyjątkiem od niej) mieszka w src/perbill.js razem z resztą
        // matematyki o wpłatach — tam ma testy. Tu zostaje wyłącznie podanie jej danych.
        const ledgerBills = () => ledgerVisibleBills(
            latestBills.map(({ id, data }) => ({ ...data, id })).filter(billCountsInLedger),
            latestSettlements,
        );

        // RACHUNKI POZA KSIĘGĄ — mają płatnika i kwotę, a mimo to nie liczą się do salda.
        // Dwa powody: rachunek jeszcze się uzupełnia albo się nie spina.
        //
        // NIGDZIE ICH NIE OGŁASZAMY (decyzja właściciela 2026-08-27): to zdanie skierowane
        // do kogoś, kto nic z nim nie zrobi, a zamyka rachunek płatnik i to on dostaje
        // wezwanie. Ta lista służy do JEDNEJ rzeczy — do milczenia we właściwym momencie.
        // Dopóki istnieje choć jeden taki rachunek, ekran nie ma prawa ogłosić „wszystko
        // rozliczone, nikt nikomu nic nie jest winien", bo to byłaby nieprawda o cudzych
        // pieniądzach. Zamiast tego mówi krócej i uczciwie: „nic do rozliczenia".
        const billsOutsideLedger = () => {
            const wKsiedze = new Set(ledgerBills().map((b) => b.id));
            return latestBills
                .map(({ id, data }) => ({ ...data, id }))
                .filter((b) => !wKsiedze.has(b.id) && b.payerConfirmed && toGrosze(b.totalAmount || 0) > 0);
        };

        const perBillNow = () => billLedger(ledgerBills(), latestSettlements);

        // Moje należności i zobowiązania w jednym miejscu — to jest liczba, po którą
        // ludzie otwierają aplikację, więc liczymy ją raz i podajemy wszystkim widokom.
        const myLedgerRows = () => {
            const my = myMemberNow();
            if (!my) return { rows: [], myId: null };
            const ledger = buildLedger(ledgerBills(), latestSettlements);
            const rows = [];
            Object.keys(ledger).forEach((cur) => {
                ledger[cur].net.forEach((t) => {
                    if (t.from === my.id) rows.push({ currency: cur, other: t.to, amountG: t.amountG, dir: 'owe' });
                    else if (t.to === my.id) rows.push({ currency: cur, other: t.from, amountG: t.amountG, dir: 'due' });
                });
            });
            // `ledger` wychodzi na zewnątrz, bo Bilans potrzebuje z niego jeszcze planu
            // (`myPlanRows`), a budowanie go drugi raz przy każdym odrysowaniu byłoby
            // liczeniem tego samego dwa razy przy piętnastu osobach i kilkunastu rachunkach.
            return { rows, myId: my.id, ledger };
        };

        const renderBalancePanel = () => {
            const amountsEl = document.getElementById('balance-amounts');
            const captionEl = document.getElementById('balance-caption');
            if (!amountsEl || !captionEl) return;
            // Akcje mieszkają od 2026-08-17 w osobnej sekcji pod blokiem, patrz renderBalancePlan.
            renderBalancePlan();

            // Zachęta do pierwszego rachunku żyje tylko w pustym pokoju — potem
            // znika bez śladu, żeby nie zabierać miejsca kwocie.
            const emptyEl = document.getElementById('balance-empty');
            if (emptyEl) {
                emptyEl.classList.toggle('hidden', latestBills.length > 0);
                const serial = document.getElementById('balance-empty-serial');
                if (serial) serial.textContent = formatSerial(currentGroupId);
            }
            renderBalanceWaiting();
            renderBalanceFilling();

            // PIGUŁKA TRYBU. Wielka kwota jest we wszystkich trzech trybach identyczna
            // (saldo na czysto to niezmiennik), więc bez pigułki nic tu nie mówiłoby,
            // jak ta ekipa zamierza ją domknąć. W pustym pokoju milczy: tryb rozliczania
            // nie jest pierwszą rzeczą, którą trzeba wiedzieć, zanim jest pierwszy rachunek.
            const pill = document.getElementById('balance-mode-pill');
            if (pill) {
                pill.classList.toggle('hidden', latestBills.length === 0);
                pill.textContent = settlementModeName(groupSettlementMode());
            }

            const { rows, myId, ledger } = myLedgerRows();
            const byCurrency = {};
            rows.forEach((r) => {
                const bucket = byCurrency[r.currency] || (byCurrency[r.currency] = { owe: 0, due: 0 });
                bucket[r.dir] += r.amountG;
            });
            // WALUTA WIODĄCA TO TA O NAJWIĘKSZYM SALDZIE, nie ta pierwsza alfabetycznie.
            // Salda walut nigdy się nie sumują (PRODUCT.md), więc bohaterem bloku zostaje
            // liczba, która najbardziej waży, a reszta schodzi wiersz niżej mniejszym
            // stopniem. Przy jednej walucie zachowanie jest dokładnie takie, jak było.
            const currencies = Object.keys(byCurrency).sort((a, b) => {
                const netOf = (c) => Math.abs(byCurrency[c].due - byCurrency[c].owe);
                if (netOf(b) !== netOf(a)) return netOf(b) - netOf(a);
                const ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
            });

            if (currencies.length === 0) {
                // Zero znaczy dwie różne rzeczy i podpis musi je rozróżniać: w pokoju
                // z rachunkami to SUKCES („wszystko rozliczone"), a w pokoju bez
                // rachunków — po prostu początek. Jeden podpis na oba stany kłamał
                // w świeżym pokoju i kłócił się z zachętą poniżej.
                const cur = (groupData && groupData.defaultCurrency) || 'PLN';
                amountsEl.innerHTML = heroAmountHtml(0, cur, 'text-brand-ink');
                // Trzeci stan: rachunki są, ale żaden nie wszedł jeszcze do salda. Wtedy
                // podpis milknie zamiast ogłaszać, że nikt nikomu nic nie jest winien.
                captionEl.textContent = latestBills.length === 0
                    ? 'Jeszcze nic nie policzone.'
                    : (billsOutsideLedger().length > 0
                        ? 'Nic do rozliczenia.'
                        : 'Wszystko rozliczone. Nikt nikomu nic nie jest winien.');
                return;
            }

            // Kwota w bloku marki jest CZARNA, a kierunek niesie podpis pod nią. Czerwień
            // i zieleń na limonce byłyby nieczytelne, a kolor marki nie może znaczyć
            // „winien" ani „dostajesz" — od tego są wiersze ludzi na białych kartach.
            const netOf = (cur) => byCurrency[cur].due - byCurrency[cur].owe;
            amountsEl.innerHTML = currencies.map((cur, i) => {
                if (i === 0) return heroAmountHtml(netOf(cur), cur, 'text-brand-ink');
                // Kolejne waluty: własny wiersz, mniejszy stopień, skrót obok kwoty.
                // Bez znaku plus między nimi — plus sugerowałby jedną sumę do zapłaty,
                // a te salda domyka się osobnymi przelewami.
                return `<p class="amount amount-second text-brand-ink">${amountHtml(netOf(cur), cur, 'text-brand-ink')}</p>`;
            }).join('');

            const oweRows = rows.filter((r) => r.dir === 'owe');
            const dueRows = rows.filter((r) => r.dir === 'due');
            const people = (n) => (n === 1 ? '1 osobie' : `${n} osobom`);
            const peopleFrom = (n) => (n === 1 ? '1 osoby' : `${n} osób`);
            // Liczymy LUDZI, nie wiersze. Ktoś, komu jestem winien i w złotówkach,
            // i w euro, to nadal jedna osoba — a „winien jesteś 2 osobom" przy jednym
            // dłużniku byłoby po prostu nieprawdą.
            const uniquePeople = (list) => new Set(list.map((r) => r.other)).size;
            const oweCount = uniquePeople(oweRows);
            const dueCount = uniquePeople(dueRows);
            // WIELKA LICZBA TO ODEJMOWANIE — POKAŻ JEGO SKŁADNIKI (zgłoszenie właściciela
            // 2026-08-17: „nowa osoba kompletnie może nie skumać tego Bilansu").
            //
            // Do tej pory blok pokazywał saldo NA CZYSTO (należności minus długi), a pod nim
            // liczby OSÓB — bez ani jednej kwoty składowej. Kto był jednocześnie wierzycielem
            // i dłużnikiem, widział wielkie „+1 200", a zaraz pod tym ciemny przycisk
            // „Ureguluj 50,00" z kwotą, która nie występowała nigdzie wyżej. Pytanie, które
            // się wtedy rodzi — „po co mam komuś przelewać, skoro tylu ludzi jest winnych
            // mnie?" — nie miało na tym ekranie odpowiedzi.
            //
            // Teraz przy obu kierunkach naraz rozpisujemy działanie: ile dostajesz, ile
            // oddajesz. Wtedy „Ureguluj 50,00" jest po prostu drugą linijką, a nie kwotą
            // znikąd. Przy jednym kierunku (przypadek zwykły) zostaje jedno zdanie jak dotąd —
            // rozpisywanie działania, które ma jeden składnik, byłoby hałasem.
            //
            // KWOTY BIERZEMY Z PLANU, NIE Z PAR (2026-08-17). Saldo na czysto jest w obu
            // ujęciach identyczne — plan zmienia wyłącznie trasę pieniędzy — ale rozpisanie
            // już nie: para po parze można dostawać od jedenastu osób i oddawać jednej,
            // a planem dostawać od trzech i nie oddawać nikomu. Skoro przyciski pod spodem
            // wykonują plan, to rozpisanie nad nimi musi mówić o tym samym.
            //
            // PODPIS LICZY TO, CO TRYB: osoby albo rachunki (etap 3). W trybie
            // „Rachunek po rachunku" zdanie „oddajesz 2 osobom" byłoby fałszywą obietnicą
            // dwóch przelewów — tam oddaje się osobno za każdy rachunek, więc liczbą,
            // która coś znaczy, jest liczba rachunków.
            const mode = groupSettlementMode();
            const perBill = mode === 'perBill' ? perBillNow() : null;
            const rachunki = (n) => `${n} ${plural(n, 'rachunek', 'rachunki', 'rachunków')}`;
            const planRows = myPlanRows(ledger, myId);
            const planCur = (c) => planRows.find((p) => p.currency === c) || { payTotalG: 0, receiveTotalG: 0, pay: [], receive: [] };
            const cur0 = currencies[0];
            let oweTotalG = planCur(cur0).payTotalG;
            let dueTotalG = planCur(cur0).receiveTotalG;
            let oweIle = planCur(cur0).pay.length;
            let dueIle = planCur(cur0).receive.length;
            // Zdanie w całości, a nie rdzeń z podmienianym rzeczownikiem: polska odmiana
            // nie pozwala skleić „oddajesz N osobom" i „oddajesz za N rachunków" z jednego
            // szablonu, a próba kończy się formą „oddajesz 2 rachunkom".
            // `kwota` bywa pusta — przy jednym kierunku podpis jej nie niesie.
            let oweFraza = (n, kwota) => `oddajesz ${kwota ? kwota + ' ' : ''}${people(n)}`;
            let dueFraza = (n, kwota) => `dostajesz ${kwota ? kwota + ' ' : ''}od ${peopleFrom(n)}`;
            if (perBill) {
                const doOddania = myBillsToPay(perBill, myId).filter((r) => r.currency === cur0);
                const doOdebrania = perBill.rows.filter((r) => r.payer === myId && r.openG > 0 && r.currency === cur0);
                oweTotalG = doOddania.reduce((s, r) => s + r.openG, 0);
                dueTotalG = doOdebrania.reduce((s, r) => s + r.openG, 0);
                oweIle = doOddania.length;
                dueIle = doOdebrania.length;
                oweFraza = (n, kwota) => `oddajesz ${kwota ? kwota + ' ' : ''}za ${rachunki(n)}`;
                dueFraza = (n, kwota) => `dostajesz ${kwota ? kwota + ' ' : ''}za ${rachunki(n)}`;
            }
            const wieleWalut = currencies.length > 1;
            if (oweIle && dueIle && !wieleWalut) {
                // Kolor NIE niesie tu kierunku: na limonce czerwień i zieleń są nieczytelne
                // (patrz uwaga przy `netOf`). Kierunek niosą słowa i strzałki.
                const mocno = (g) => `<b class="font-bold">${fmtMoney(g, cur0)}</b>`;
                captionEl.innerHTML = `<span class="block">na czysto</span>
                    <span class="block mt-2 font-normal">↓ ${dueFraza(dueIle, mocno(dueTotalG))}</span>
                    <span class="block font-normal">↑ ${oweFraza(oweIle, mocno(oweTotalG))}</span>`;
            } else {
                const parts = [];
                if (oweIle) parts.push(oweFraza(oweIle, ''));
                if (dueIle) parts.push(dueFraza(dueIle, ''));
                if (wieleWalut) parts.push(`${currencies.length} waluty, każda rozliczana osobno`);
                captionEl.textContent = parts.join(' · ');
            }
        };

        // CO MASZ ZROBIĆ — jedyne akcje rozliczeniowe na Bilansie, wyprowadzone z planu.
        //
        // Dwie strony traktujemy inaczej i to jest sedno skalowania do piętnastu osób:
        //   • PŁACISZ — jawne wiersze. W planie minimalnym to zwykle zero albo jeden przelew,
        //     więc lista jest z natury krótka i każdy jej wiersz zasługuje na własny przycisk.
        //   • DOSTAJESZ — jedna linia zbiorcza. Kto wyłożył za całą ekipę, ma czternaście
        //     wpłat do odebrania; czternaście wierszy zjadłoby cały ekran, a i tak nie da się
        //     z nimi zrobić nic innego niż przypomnieć. Więc: licznik plus jedna akcja masowa.
        // BLOK „WPŁATY BEZ PRZYPISANIA" — wspólny dla Bilansu i ekranu rozliczeń.
        //
        // Wpłata poprowadzona planem minimalnym („Kuba płaci Oli za dług wobec Marka")
        // nie ma po stronie pary ani jednego rachunku, więc w trybie rachunkowym nie gasi
        // niczego. Takich wpłat w pokoju właściciela PRAWDOPODOBNIE JUŻ TROCHĘ JEST —
        // pokój działa od miesięcy w planie minimalnym. Nie wolno ich ani ukryć (pieniądze
        // wyszły z konta), ani doliczyć na siłę do cudzego rachunku (to byłby fałszywy
        // dowód wpłaty). Zostaje trzecia droga: nazwać je i pokazać, skąd się wzięły.
        const unassignedBlockHtml = (sent) => {
            if (!sent.length) return '';
            const wiersze = sent.map((u) => `
                <div class="flex items-baseline justify-between gap-3 py-1">
                    <span class="min-w-0 truncate text-sm">do <b>${escapeHtml(memberName(u.to))}</b></span>
                    <span class="amount flex-shrink-0">${fmtMoney(u.leftG, u.currency)}</span>
                </div>`).join('');
            return `<div class="block-quiet p-4">
                <p class="font-bold">${sent.length === 1 ? 'Wpłata bez przypisania' : 'Wpłaty bez przypisania'}</p>
                <div class="mt-2">${wiersze}</div>
                <p class="text-xs text-ink-3 mt-2">${sent.length === 1 ? 'Powstała' : 'Powstały'} w trybie „Najmniej przelewów": ${sent.length === 1 ? 'ta wpłata poszła' : 'te wpłaty poszły'} do osoby, z którą nie macie wspólnego rachunku, więc ${sent.length === 1 ? 'nie gasi' : 'nie gaszą'} tu żadnego. Saldo na czysto ${sent.length === 1 ? 'ją liczy' : 'je liczy'} normalnie.</p>
            </div>`;
        };

        // CO MASZ ZROBIĆ w trybie rachunkowym — PODSUMOWANIE Z PRZEJŚCIEM, NIE LISTA.
        //
        // Bilans odpowiada na „gdzie stoję": ile wisi, ilu osobom i za ile rachunków.
        // Szczegóły — wiersz na osobę, rozwijane „Za co", wybór rachunków przy płaceniu —
        // mieszkają w zakładce Rozliczenia i tylko tam (decyzja właściciela 2026-08-26).
        // Dwa miejsca na tę samą czynność rozjeżdżają się przy pierwszej poprawce.
        const renderBalancePlanPerBill = (wrap, list, note, myId) => {
            const per = perBillNow();
            const doOddania = myBillsToPay(per, myId);
            const doOdebrania = (per.rows || []).filter((r) => r.payer === myId && r.openG > 0);
            const bezPrzypisania = myUnassigned(per, myId).sent;
            if (!doOddania.length && !doOdebrania.length && !bezPrzypisania.length) {
                wrap.classList.add('hidden');
                list.innerHTML = '';
                note.textContent = '';
                return;
            }
            wrap.classList.remove('hidden');

            const html = [];
            currenciesToPay(per, myId).forEach((cur) => {
                const u = reconcileToPay(per, myId, cur);
                if (!u.billCount && !u.unassignedG) return;
                // LINIA UZGADNIAJĄCA. Bez niej ten ekran i lista rachunków mówiłyby dwie
                // różne rzeczy o tej samej sytuacji: lista pokazywałaby 130,00 do oddania,
                // a saldo na czysto 100,00 — bo trzydziestkę wysłano kiedyś w bok.
                const uzgodnienie = u.unassignedG > 0
                    ? `<p class="text-xs text-ink-3 mt-2">${u.billCount} ${plural(u.billCount, 'rachunek', 'rachunki', 'rachunków')} ${fmtMoney(u.billsG, cur)} · ${
                        bezPrzypisania.length === 1 ? 'wpłata bez przypisania' : 'wpłaty bez przypisania'} −${fmtMoney(u.unassignedG, cur)} · zostaje ${fmtMoney(u.restG, cur)}</p>`
                    : '';
                // Podpis liczy DWIE rzeczy naraz: rachunki i ludzi. Sama liczba rachunków
                // nie mówi, ile razy trzeba wejść w bank, a sama liczba osób nie mówi,
                // z czego to się wzięło.
                const osoby = new Set(doOddania.filter((r) => r.currency === cur).map((r) => r.payer)).size;
                html.push(`<div class="card p-4">
                    <div class="flex items-center justify-between gap-3">
                        <span class="font-bold text-lg">Do oddania</span>
                        <span class="amount text-2xl text-owe flex-shrink-0">${fmtMoney(u.restG, cur)}</span>
                    </div>
                    <p class="text-sm text-ink-2 mt-1">${u.billCount} ${plural(u.billCount, 'rachunek', 'rachunki', 'rachunków')} · ${osoby === 1 ? '1 osobie' : `${osoby} osobom`}</p>
                    <div class="mt-3 flex items-center gap-2">
                        <button class="plan-open-settle-btn btn btn-danger flex-grow">Zobacz rozliczenia</button>
                    </div>
                    ${uzgodnienie}
                </div>`);
            });

            html.push(unassignedBlockHtml(bezPrzypisania));

            // Strona odbierania działa TAK SAMO W KAŻDYM TRYBIE — windykator nie jest
            // częścią sposobu rozliczania, tylko odpowiedzią na „kto mi jeszcze nie oddał".
            // Liczymy tu jednak rachunki, nie osoby, bo w tym trybie wpłata przychodzi
            // za konkretny rachunek.
            const walutyOdbioru = [...new Set(doOdebrania.map((r) => r.currency))];
            walutyOdbioru.forEach((cur) => {
                const moje = doOdebrania.filter((r) => r.currency === cur);
                const sumaG = moje.reduce((s, r) => s + r.openG, 0);
                const ludzie = [...new Set(moje.map((r) => r.debtor))];
                html.push(`<div class="card p-4">
                    <div class="flex items-center justify-between gap-3">
                        <span class="font-bold text-lg">Czekasz na zwrot</span>
                        <span class="amount text-2xl text-due flex-shrink-0">${fmtMoney(sumaG, cur)}</span>
                    </div>
                    <p class="text-sm text-ink-2 mt-1">${moje.length} ${plural(moje.length, 'rachunek', 'rachunki', 'rachunków')} · od ${ludzie.length === 1 ? '1 osoby' : `${ludzie.length} osób`}</p>
                    <div class="mt-3 flex items-center gap-2">
                        <button class="plan-nudge-people-btn btn btn-dark flex-grow" data-currency="${escapeHtml(cur)}">Przypomnij (${ludzie.length})</button>
                        <button class="plan-open-settle-btn btn btn-quiet flex-shrink-0">Zobacz kto</button>
                    </div>
                </div>`);
            });

            list.innerHTML = html.join('');

            // ZOSTAJE SAMA DROGA, BEZ WYKŁADU (decyzja właściciela 2026-08-26).
            //
            // Stało tu zdanie „Każdy przelew idzie do osoby, która wyłożyła pieniądze" —
            // wyjaśnienie trybu, czyli odpowiedź na pytanie zadawane raz w życiu, postawiona
            // pod kwotą, po którą ludzie przychodzą codziennie. Pełne tłumaczenie mechaniki
            // zostaje w Rozliczeniach, tuż obok rzeczy, której dotyczy.
            //
            // Zniknęło też zastrzeżenie „kwoty mogą się jeszcze zmienić — N czeka na Twój
            // ruch": mówi to samo, co blok o rachunkach poza saldem dwa wiersze wyżej,
            // a powtórzony sygnał uczy przewijać oba.
            //
            // I odnośnik „Rozliczenia: kto, ile i za co →" (2026-08-26). Był TRZECIĄ drogą
            // do tej samej zakładki na jednym ekranie: kafelek „Do oddania" ma pełen przycisk
            // „Zobacz rozliczenia", „Czekasz na zwrot" ma „Zobacz kto", a na dole ekranu stoi
            // pasek z zakładką Rozliczenia. Do tego podkreślony odnośnik tekstowy nie
            // występuje nigdzie indziej w tej aplikacji — wszystko inne jest przyciskiem
            // albo pigułką — więc wyglądał jak ciało obce, a po odjęciu zdania obok został
            // sam, bez kontekstu.
            note.textContent = '';

            list.querySelectorAll('.plan-nudge-people-btn').forEach((btn) => {
                btn.onclick = () => {
                    const cur = btn.dataset.currency;
                    // Przypomnienie idzie DO OSOBY, nie do rachunku: jedna osoba, która
                    // nie oddała za trzy rachunki, ma dostać jedno przypomnienie na sumę,
                    // a nie trzy pod rząd. Tu wolno zsumować, bo to treść wiadomości,
                    // a nie obraz długu — dług obok zostaje rozpisany rachunek po rachunku.
                    const perOsoba = new Map();
                    doOdebrania.filter((r) => r.currency === cur).forEach((r) => {
                        perOsoba.set(r.debtor, (perOsoba.get(r.debtor) || 0) + r.openG);
                    });
                    const mojeId = (myMemberNow() || {}).id || null;
                    const adresaci = [...perOsoba]
                        .filter(([toId]) => !maSpornaWplateDoMnie(mojeId, toId))
                        .map(([toId, amountG]) => ({ toId, amountG }));
                    if (!adresaci.length) { showToast('Zostały same sprawy do wyjaśnienia.'); return; }
                    openNudgeCompose(adresaci, cur);
                };
            });
            wrap.querySelectorAll('.plan-open-settle-btn').forEach((btn) => {
                btn.onclick = () => { showDeckView(DECK_NAV_VIEWS['nav-settle']); };
            });
        };

        const renderBalancePlan = () => {
            const wrap = document.getElementById('balance-plan');
            const list = document.getElementById('balance-plan-list');
            const note = document.getElementById('balance-plan-note');
            if (!wrap || !list || !note) return;

            const { rows, myId, ledger } = myLedgerRows();
            const mode = groupSettlementMode();

            // TRYB RACHUNKOWY NIE POWTARZA TU LISTY RACHUNKÓW. Lista mieszka w zakładce
            // „Rachunki" pod filtrem „Do oddania" i to jest jej jedyne miejsce; druga
            // kopia tych samych wierszy na Bilansie byłaby drugą prawdą o tym samym,
            // która rozjeżdża się przy pierwszej poprawce w jednej z nich.
            if (mode === 'perBill') { renderBalancePlanPerBill(wrap, list, note, myId); return; }

            const planRows = myId ? myPlanRows(ledger, myId) : [];
            wrap.classList.toggle('hidden', planRows.length === 0);
            if (planRows.length === 0) { list.innerHTML = ''; note.textContent = ''; return; }

            const wieleWalut = planRows.length > 1;
            list.innerHTML = planRows.map((p) => {
                const naglowekWaluty = wieleWalut ? `<p class="chip mb-2">${escapeHtml(p.currency)}</p>` : '';
                const wierszeDoZaplaty = p.pay.map((t) => `
                    <div class="card p-4">
                        <div class="flex items-center justify-between gap-3">
                            <span class="flex items-center min-w-0 gap-3">${avatarHtml(memberName(t.other), t.other, 'w-11 h-11 text-base')}<span class="truncate font-bold text-lg">${escapeHtml(memberName(t.other))}</span></span>
                            <span class="amount text-2xl text-owe flex-shrink-0">${fmtMoney(t.amountG, p.currency)}</span>
                        </div>
                        <div class="mt-3 flex items-center gap-2">
                            <!-- „Ureguluj" i CZERWONY, jak wszędzie indziej (2026-08-18).
                                 Stało tu „Zapłać" na białym przycisku — nie z decyzji, tylko
                                 z bezwładu: klasa przywędrowała z poprzedniego układu Bilansu,
                                 gdzie ten przycisk leżał na limonkowym bloku. W nowym miejscu
                                 kłóciła się z trzema innymi wejściami do tej samej czynności
                                 (zakładka „Rozliczenia", skrzynka, tytuł arkusza) ORAZ z czerwoną kwotą
                                 na tej samej karcie. Czerwień znaczy w tej aplikacji „pieniądze
                                 wychodzą od Ciebie" i tak ma zostać. -->
                            <button class="plan-pay-btn btn btn-danger flex-grow" data-to="${escapeHtml(t.other)}" data-amount-g="${t.amountG}" data-currency="${escapeHtml(p.currency)}">Ureguluj</button>
                        </div>
                        <p class="text-xs text-ink-3 mt-2">Tak wychodzi najkrócej. <button class="plan-why-btn underline" type="button">Skąd ta kwota?</button></p>
                    </div>`).join('');
                // Zdanie „nie masz nic do zapłaty" mówimy WPROST, zamiast milczeć — to jest
                // odpowiedź na pytanie właściciela „mam uregulować czy nie?".
                //
                // ALE TYLKO WTEDY, GDY NAPRAWDĘ MA SIĘ DŁUGI. Kto wyłożył za całą ekipę
                // i nie jest winien nikomu ani grosza, dostawałby inaczej zapewnienie, że
                // „jego długi rozliczają się same" — o długach, których nigdy nie miał.
                const dlugiParami = rows.some((r) => r.dir === 'owe' && r.currency === p.currency);
                const brakDoZaplaty = p.pay.length === 0 && dlugiParami
                    ? `<div class="card p-4"><p class="font-bold">Nie masz nic do zapłaty</p><p class="text-sm text-ink-2 mt-1">Twoje długi rozliczają się same — spłacają je ci, którzy są winni Tobie.</p></div>`
                    : '';
                const wierszOdbioru = p.receive.length
                    ? `<div class="card p-4">
                        <div class="flex items-center justify-between gap-3">
                            <span class="font-bold text-lg">Czekasz na ${p.receive.length} ${plural(p.receive.length, 'wpłatę', 'wpłaty', 'wpłat')}</span>
                            <span class="amount text-2xl text-due flex-shrink-0">${fmtMoney(p.receiveTotalG, p.currency)}</span>
                        </div>
                        <div class="mt-3 flex items-center gap-2">
                            <button class="plan-nudge-all-btn btn btn-dark flex-grow" data-currency="${escapeHtml(p.currency)}">Przypomnij (${p.receive.length})</button>
                            <button class="plan-open-settle-btn btn btn-quiet flex-shrink-0">Zobacz kto</button>
                        </div>
                    </div>`
                    : '';
                return naglowekWaluty + wierszeDoZaplaty + brakDoZaplaty + wierszOdbioru;
            }).join('');

            // Zdanie o planie mówi PRAWDĘ, także wtedy, gdy skrócić się nie da: przy jednym
            // płatniku za całą ekipę plan ma dokładnie tyle przelewów co podział para po parze,
            // bo każdy i tak oddaje osobno. Obiecywanie wtedy oszczędności byłoby kłamstwem.
            const { plan, pairwise } = planVsPairwise(ledger);
            // KWOTY BYWAJĄ TYMCZASOWE i trzeba to powiedzieć, skoro plan stoi teraz NAD
            // sekcją „Czeka na Ciebie". Dopóki rachunek czeka na mój ruch („Stuknij, co
            // Twoje", „Uzupełnij kwotę"), plan liczy się z niepełnych danych i kwoty jeszcze
            // się przesuną. Wcześniej ta sekcja była niżej, więc człowiek najpierw widział,
            // czego brakuje; po zamianie kolejności widzi najpierw wynik i mógłby mu zaufać
            // bardziej, niż zasługuje. Zdanie pojawia się WYŁĄCZNIE wtedy, gdy coś faktycznie
            // czeka — przy pustej skrzynce nie dokłada ani słowa.
            // Ta gałąź obsługuje WYŁĄCZNIE plan minimalny — tryb rachunkowy ma własną
            // (`renderBalancePlanPerBill`) i wychodzi z funkcji wyżej.
            //
            // Zdanie o liczbie przelewów ZOSTAJE: to fakt o TYM planie („3 zamiast 7"),
            // a nie wykład o tym, jak działa tryb. Zastrzeżenie „kwoty mogą się zmienić"
            // odpadło — mówi to samo, co blok o rachunkach poza saldem wyżej.
            const zdanieTrybu = plan < pairwise
                ? `Rozliczamy najkrótszą drogą: <b>${plan} ${plural(plan, 'przelew', 'przelewy', 'przelewów')}</b> zamiast ${pairwise}.`
                : 'Rozliczamy najkrótszą drogą — krócej się tu nie da.';
            // Sam fakt o planie, bez odnośnika — powód przy bliźniaczej linii w trybie
            // rachunkowym. Do zakładki Rozliczeń prowadzi pasek na dole ekranu, a przy
            // należnościach jeszcze przycisk „Zobacz kto" w kafelku.
            note.innerHTML = zdanieTrybu;

            list.querySelectorAll('.plan-pay-btn').forEach((btn) => {
                btn.onclick = () => openSettleModal(btn.dataset.to, Number(btn.dataset.amountG), btn.dataset.currency, 'send');
            });
            list.querySelectorAll('.plan-nudge-all-btn').forEach((btn) => {
                btn.onclick = () => {
                    const p = planRows.find((r) => r.currency === btn.dataset.currency);
                    if (!p) return;
                    const mojeId = (myMemberNow() || {}).id || null;
                    const adresaci = p.receive
                        .filter((r) => !maSpornaWplateDoMnie(mojeId, r.other))
                        .map((r) => ({ toId: r.other, amountG: r.amountG }));
                    if (!adresaci.length) { showToast('Zostały same sprawy do wyjaśnienia.'); return; }
                    openNudgeCompose(adresaci, p.currency);
                };
            });
            wrap.querySelectorAll('.plan-open-settle-btn, .plan-why-btn').forEach((btn) => {
                btn.onclick = () => { showDeckView(DECK_NAV_VIEWS['nav-settle']); };
            });
        };

        // Wiersz osoby: twarz, imię i kwota w jednej linii, akcje pod spodem. Rozbicie na
        // dwa piętra zamiast upychania czterech rzeczy w rząd — przy imieniu „Bartek" i kwocie
        // „1 240,00 EUR" wszystko w jednej linii zaczyna się zawijać na wąskim telefonie.
        const settleRowHtml = (name, id, amountHtml, actionsHtml, detailHtml = '') =>
            `<div class="card p-4">
                <div class="flex items-center justify-between gap-3">
                    <span class="flex items-center min-w-0 gap-3">${avatarHtml(name, id, 'w-11 h-11 text-base')}<span class="truncate font-bold text-lg">${escapeHtml(name)}</span></span>
                    <span class="flex-shrink-0">${amountHtml}</span>
                </div>
                ${actionsHtml ? `<div class="mt-3 flex items-center gap-2">${actionsHtml}</div>` : ''}
                ${detailHtml}
            </div>`;

        // Rozkład długu netto na rachunki (do „z detalem"): wkłady w stronę from→to (+) i offset to→from (−).
        const debtDetailHtml = (directed, from, to, cur) => {
            const fwd = ((directed.find(d => d.from === from && d.to === to) || {}).contributions) || [];
            const rev = ((directed.find(d => d.from === to && d.to === from) || {}).contributions) || [];
            if (fwd.length === 0 && rev.length === 0) return '';
            const line = (c, neg) => {
                const isPay = c.kind === 'payment';
                const label = c.label || (isPay ? 'Wpłata' : 'Rachunek');
                // Wpłata zbija dług, więc idzie kolorem należności i ze znakiem minus —
                // dwa nośniki, bo sam kolor nie wystarcza przy daltonizmie.
                return `<div class="flex justify-between gap-2 text-xs py-0.5"><span class="truncate text-ink-3">${escapeHtml(label)}</span><span class="amount flex-shrink-0 ${neg ? 'text-due' : 'text-ink-3'}">${neg ? '−' : ''}${fmtMoney(c.amountG, cur)}</span></div>`;
            };
            return `<details class="mt-1.5"><summary class="text-xs text-ink-2 cursor-pointer select-none">Za co</summary>
                <div class="mt-1 pl-2 border-l border-ink/15">${fwd.map(c => line(c, false)).join('')}${rev.map(c => line(c, true)).join('')}</div></details>`;
        };

        // === STAN WPŁATY ========================================================
        //
        // Sześć stanów, z których pięć powstało 2026-08-29 razem z odpowiedzią „nie widzę".
        // Do tej pory wpłata miała jeden bit (`confirmed`) i dlatego na zgłoszony przelew
        // dało się odpowiedzieć wyłącznie „tak" — kto nie widział pieniędzy na koncie,
        // nie miał czym tego powiedzieć.
        //
        // Trzy nowe pola pisze KAŻDE INNA STRONA i to jest w nich najważniejsze:
        //   `disputed`  — odbiorca: „szukałem i nie znalazłem"
        //   `insisted`  — nadawca:  „wysłałem na pewno, sprawdź jeszcze raz"
        //   `stalled`   — odbiorca: „nadal nie widzę" (druga odmowa, koniec ping-ponga)
        //   `withdrawn` — nadawca:  „pomyłka, nie wysłałem"
        //
        // Reguły Firestore pilnują dokładnie tego przypisania, więc nikt nie może
        // odpowiedzieć za drugą stronę. Wszystkie pola są opcjonalne — wpłaty sprzed
        // tej zmiany nie mają żadnego i czytają się jak „pending"/"confirmed".
        const SETTLE_PENDING = 'pending';       // zgłoszona, czeka na odbiorcę
        const SETTLE_CONFIRMED = 'confirmed';   // domknięta
        const SETTLE_DISPUTED = 'disputed';     // odbiorca nie znalazł, piłka u nadawcy
        const SETTLE_INSISTED = 'insisted';     // nadawca podtrzymał, piłka u odbiorcy
        const SETTLE_STALLED = 'stalled';       // dwie rundy bez skutku, aplikacja milczy
        const SETTLE_WITHDRAWN = 'withdrawn';   // nadawca wycofał zgłoszenie

        const settlementState = (s) => {
            if (!s) return SETTLE_PENDING;
            if (s.withdrawn === true) return SETTLE_WITHDRAWN;
            if (s.disputed === true) {
                if (s.stalled === true) return SETTLE_STALLED;
                return s.insisted === true ? SETTLE_INSISTED : SETTLE_DISPUTED;
            }
            return s.confirmed === true ? SETTLE_CONFIRMED : SETTLE_PENDING;
        };

        // CZY TA SPRAWA CZEKA NA MÓJ RUCH — jedyne kryterium, po którym dzielimy stosy
        // i jedyne, które zapala sygnał. Świeże zgłoszenie i podtrzymanie nadawcy czekają
        // na odbiorcę; odmowa odbiorcy czeka na nadawcę; sprawa „stoi" nie czeka na nikogo.
        const settlementWaitsFor = (s) => {
            switch (settlementState(s)) {
                case SETTLE_PENDING: return 'to';     // odbiorca
                case SETTLE_INSISTED: return 'to';    // odbiorca, druga runda
                case SETTLE_DISPUTED: return 'from';  // nadawca
                default: return null;                 // confirmed / stalled / withdrawn
            }
        };

        const mySettlements = (myId, strona) => (myId
            ? latestSettlements.filter((s) => s && s[strona] === myId && s.from !== s.to)
            : []);

        // Wpłaty czekające na MOJĄ odpowiedź — to one zapalają odznakę i wiersz na Bilansie.
        const settlementsAwaitingMe = (myId) =>
            mySettlements(myId, 'to').filter((s) => settlementWaitsFor(s) === 'to');
        // Sprawy sporne widziane z obu stron. Odbiorca widzi te, na które sam odpowiedział
        // odmownie; nadawca te, których druga strona nie znalazła.
        const disputesAsPayee = (myId) => mySettlements(myId, 'to')
            .filter((s) => [SETTLE_DISPUTED, SETTLE_STALLED].includes(settlementState(s)));
        const disputesAsDebtor = (myId) => mySettlements(myId, 'from')
            .filter((s) => [SETTLE_DISPUTED, SETTLE_INSISTED, SETTLE_STALLED].includes(settlementState(s)));

        const settlementAmountG = (s) => toGrosze((s && s.amount) || 0);
        const settlementCurrency = (s) => (s && s.currency) || 'PLN';

        // Data zgłoszenia stoi na KAŻDYM kafelku o wpłacie i to nie jest ozdoba: to jedyna
        // rzecz, po której da się znaleźć przelew na wyciągu bankowym. Bez niej druga runda
        // sporu jest tylko głośniejszym powtórzeniem pierwszej.
        const tsDate = (t) => (t && typeof t.toDate === 'function') ? t.toDate() : null;
        const stampLong = (t) => {
            const d = tsDate(t);
            if (!d) return '';
            const dni = Math.round(
                (new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000,
            );
            const godzina = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
            if (dni === 0) return `dziś ${godzina}`;
            if (dni === 1) return `wczoraj ${godzina}`;
            const sameYear = d.getFullYear() === new Date().getFullYear();
            return `${d.toLocaleDateString('pl-PL', sameYear
                ? { day: 'numeric', month: 'long' }
                : { day: 'numeric', month: 'long', year: 'numeric' })}, ${godzina}`;
        };
        const stampShort = (t) => {
            const d = tsDate(t);
            if (!d) return '';
            const dni = Math.round(
                (new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000,
            );
            if (dni === 0) return 'dziś';
            if (dni === 1) return 'wczoraj';
            return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
        };

        // === STOS SPRAW =========================================================
        //
        // Jedna nazwa, jedna sprawa na wierzchu, reszta pod spodem. Powód jest
        // arytmetyczny: lista rośnie wraz z ekipą, a stos ma zawsze wysokość jednej
        // karty — piętnaście osób i trzy osoby dają ten sam pierwszy ekran.
        //
        // NAZWY STOSÓW MÓWIĄ O STANIE, NIE O KATEGORII, i to jest cała różnica wobec
        // pierwszej próby tego podziału. „Do potwierdzenia" obok „Dostajesz" czytało się
        // jak dwie listy tego samego, bo drugie słowo nazywało kategorię i brzmiało,
        // jakby obejmowało również pierwszą. „Do potwierdzenia" obok „Czekasz na przelew"
        // pomylić się nie da: jedno znaczy „ktoś już przelał, sprawdź", drugie „jeszcze
        // nie przelał, poganiaj".
        //
        // ODWROTNA GĘSTOŚĆ. Zwinięty stos jest BOGATSZY od rozwiniętej listy: gdy patrzysz
        // na jedną sprawę, chcesz szczegółu; gdy skanujesz czterdzieści — gęstości.
        const stackOpenKey = (name) => `billsplitter_stack_${name}_${currentGroupId || 'x'}`;
        const stackIsOpen = (name, domyslnie) => {
            try {
                const v = localStorage.getItem(stackOpenKey(name));
                return v === null ? domyslnie : v === '1';
            } catch { return domyslnie; }
        };
        const setStackOpen = (name, open) => {
            try { localStorage.setItem(stackOpenKey(name), open ? '1' : '0'); } catch (_) {}
        };

        // Blok stanu ma ZAWSZE trzy wiersze — patrz `.stack-state` w tailwind.css.
        // Bez tego przyciski skakałyby pod palcem przy przeklikiwaniu stosu.
        const stackLine = (lewo, prawo = '', klasa = '') =>
            `<span class="stack-state-line ${klasa}"><span class="truncate">${lewo}</span>${prawo ? `<b class="flex-shrink-0">${prawo}</b>` : '<span></span>'}</span>`;
        // PUSTY BLOK STANU NIE POWSTAJE W OGÓLE. Stała wysokość ma sens tam, gdzie karty
        // stosu RÓŻNIĄ się liczbą wierszy — ale w planie „Najmniej przelewów" przelew nie
        // należy do żadnego rachunku, więc BEZ WYJĄTKU każda karta osoby ma zero wierszy.
        // Rezerwowanie na nie trzech pustych linijek dawało kartę z pionową kreską i pasem
        // pustki pod imieniem (widoczne na zrzucie audytu 2026-08-29). Wysokość kart w takim
        // stosie i tak zostaje równa, bo puste są wszystkie.
        const stackState = (linie) =>
            (linie || []).filter(Boolean).length === 0
                ? ''
                : `<div class="stack-state">${[...linie, '', ''].slice(0, 3).map((l) => l || '<span class="stack-state-line"></span>').join('')}</div>`;

        // ZWIJANIE I ROZWIJANIE JEST RUCHEM, NIE PODMIANĄ (zgłoszenie właściciela 2026-08-29).
        //
        // Obie gęstości powstają z `innerHTML`, więc przejścia nie da się zrobić samym CSS:
        // stary układ znika, zanim nowy istnieje. Mierzymy więc wysokość PRZED przerysowaniem
        // i dojeżdżamy do nowej po nim. To jedyne dwie liczby, jakich potrzeba, a ruch jest
        // zwykłą zmianą wysokości i przezroczystości — czyli tanią i taką samą wszędzie.
        //
        // Kto ma wyłączone animacje w systemie, dostaje podmianę natychmiastową.
        let stackMorphFrom = null;

        const stackBodyEl = (name) =>
            [...document.querySelectorAll('.stack-body')].find((el) => el.dataset.stack === name) || null;

        // Wołane TUŻ PRZED przerysowaniem stosu o tej nazwie.
        const noteStackHeight = (name) => {
            const el = stackBodyEl(name);
            stackMorphFrom = el ? { name, h: el.getBoundingClientRect().height } : null;
        };

        // Wołane na końcu funkcji rysującej, gdy nowy układ już stoi w dokumencie.
        const applyStackMorph = () => {
            const from = stackMorphFrom;
            stackMorphFrom = null;
            if (!from || prefersReducedMotion()) return;
            const el = stackBodyEl(from.name);
            if (!el) return;
            const to = el.getBoundingClientRect().height;
            if (Math.abs(to - from.h) < 2) return;
            el.classList.add('is-morphing');
            el.style.height = `${from.h}px`;
            void el.offsetHeight; // wymuszenie przeliczenia — bez tego obie wysokości skleją się w jedną klatkę
            el.style.transition = 'height 300ms cubic-bezier(0.2, 0, 0, 1)';
            el.style.height = `${to}px`;
            let straznik = null;
            const koniec = () => {
                clearTimeout(straznik);
                el.removeEventListener('transitionend', koniec);
                el.style.transition = '';
                el.style.height = '';
                el.classList.remove('is-morphing');
            };
            // Strażnik na wypadek, gdyby `transitionend` nie doszedł (przerysowanie z bazy
            // w trakcie ruchu). Bez niego stos zostałby na stałe przycięty do starej wysokości.
            straznik = setTimeout(koniec, 450);
            el.addEventListener('transitionend', koniec);
        };

        // `items` to trójki { big, row, details } — ta sama sprawa w trzech gęstościach.
        // `details` jest opcjonalne: to rozwinięcie POJEDYNCZEGO wiersza rozwiniętej listy.
        const stackHtml = ({ name, title, tone = '', items, otwartyDomyslnie = false }) => {
            if (!items || !items.length) return '';
            const open = items.length > 1 && stackIsOpen(name, otwartyDomyslnie);
            // IKONA ZAMIAST NAPISU „ZWIŃ"/„ROZWIŃ" (zgłoszenie właściciela 2026-08-29).
            // Strzałka mówi to samo bez czytania, a nagłówek stosu przestaje mieć dwa
            // napisy walczące o wzrok. Słowo zostaje w `aria-label` dla czytnika ekranu.
            const head = `<div class="stack-head">
                <span class="stack-title ${tone}">${escapeHtml(title)}<span class="stack-count">${items.length}</span></span>
                ${items.length > 1
                    ? `<button type="button" class="stack-toggle icon-btn-sm is-quiet" data-stack="${escapeHtml(name)}" data-open="${open ? '1' : '0'}" aria-label="${open ? 'Zwiń stos' : 'Rozwiń stos'}"><i class="fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'}"></i></button>`
                    : ''}
            </div>`;
            const body = open
                ? `<div class="card stack-list">${items.map(stackItemHtml).join('')}</div>`
                : stackCollapsedHtml(items);
            return `${head}<div class="stack-body" data-stack="${escapeHtml(name)}">${body}</div>`;
        };

        // Wiersz rozwiniętej listy razem ze swoim rozwinięciem. Szczegóły są ZWINIĘTE
        // domyślnie i to jest cały sens tej gęstości — ale mają być OSIĄGALNE, bo inaczej
        // rozwinięcie stosu odbiera informację zamiast ją porządkować (zgłoszenie
        // właściciela 2026-08-29: po rozwinięciu nie dało się sprawdzić, jakie rachunki
        // pokrywa dany przelew).
        // ROZWIJA CAŁY WIERSZ, NIE STRZAŁKA OBOK PRZYCISKÓW (zgłoszenie właściciela
        // 2026-08-30). Osobna strzałka stała przy prawej krawędzi, czyli TUŻ OBOK „Mam" —
        // a to jest najgorsze możliwe sąsiedztwo: chybienie o pięć pikseli przy celowaniu
        // w szczegóły potwierdzało cudzy przelew. Teraz celuje się w środek wiersza, daleko
        // od przycisków, a chybienie w drugą stronę tylko rozwija szczegóły, czyli nie rusza
        // niczyich pieniędzy. Tarcie wylądowało po właściwej stronie.
        //
        // TWARZ WIERSZA JEST PRAWDZIWYM PRZYCISKIEM, nie klikalnym `div`-em. Przyciski akcji
        // stoją OBOK niej, jako rodzeństwo — gdyby leżały w środku, każdy z nich musiałby
        // blokować propagację zdarzenia, a zapomniana blokada to cicha usterka przy cudzych
        // pieniądzach. Przy okazji dostajemy klawiaturę, czytnik ekranu i `aria-expanded`
        // za darmo. Wiersz bez szczegółów przycisku nie dostaje: nie ma czego rozwijać.
        //
        // Blok szczegółów znajdujemy PRZEZ SĄSIEDZTWO w drzewie, a nie po identyfikatorze
        // (patrz nasłuch niżej) — dzięki temu nazwa stosu, sklejana z identyfikatorem
        // rachunku, w ogóle nie trafia do znaczników.
        const stackItemHtml = (x) => {
            const wiersz = (srodek) => `<div class="stack-row">${srodek}${x.rowActions || ''}</div>`;
            if (!x.details) return `<div class="stack-item">${wiersz(`<span class="stack-row-face is-plain">${x.rowFace}</span>`)}</div>`;
            return `<div class="stack-item">
                ${wiersz(`<button type="button" class="stack-row-face tap" aria-expanded="false">${x.rowFace}</button>`)}
                <div class="stack-row-detail" hidden>${x.details}</div>
            </div>`;
        };

        // STOS ZWINIĘTY. Pod wierzchnią kartą leżą dwie warstwy — nie więcej, bo trzecia
        // niczego już nie dodaje, a zjada wysokość. Każda głębsza jest węższa i bledsza,
        // czyli dokładnie tak, jak wygląda stos kartek widziany z góry.
        const stackCollapsedHtml = (items) => {
            const edges = items.length > 2
                ? `<div class="stack-edge stack-edge-2"></div><div class="stack-edge stack-edge-1"></div>`
                : items.length > 1 ? `<div class="stack-edge stack-edge-1"></div>` : '';
            // Klasa składana W CAŁOŚCI przed wstawieniem — skaner Tailwinda znajduje
            // wtedy każdą nazwę jako pełny tekst (patrz selectors.contract.test.js).
            const topClass = `card stack-top${items[0].flagged || ''}`;
            return `<div class="stack">${edges}<div class="${topClass}">${items[0].big}</div></div>`;
        };

        // Rozwijanie POJEDYNCZEGO wiersza. Jedna delegacja na cały dokument, bo wiersze
        // stoją w trzech miejscach (dwie strony rozliczeń i ekran rachunku), a każde z nich
        // przerysowuje się osobno. Stan jest wyłącznie w DOM — po przerysowaniu z bazy
        // szczegóły wracają do zwiniętych i to jest w porządku: to podgląd, nie ustawienie.
        //
        // Szukamy przez SĄSIEDZTWO, nie po identyfikatorze. Identyfikator trzeba by skleić
        // z nazwy stosu, a ta bywa sklejona z identyfikatorem rachunku — czyli z danymi
        // z bazy, których do znaczników nie wpuszczamy bez potrzeby. Blok szczegółów i tak
        // leży zawsze w tym samym `.stack-item`, co jego wiersz.
        document.addEventListener('click', (e) => {
            const face = e.target.closest('.stack-row-face');
            if (!face || face.tagName !== 'BUTTON') return;
            const box = face.closest('.stack-item').querySelector('.stack-row-detail');
            if (!box) return;
            const otwarte = box.hidden;
            box.hidden = !otwarte;
            face.setAttribute('aria-expanded', otwarte ? 'true' : 'false');
        });

        // --- KARTY SPRAW ---------------------------------------------------------
        //
        // Każda karta odpowiada na jedno pytanie i niesie DOKŁADNIE te przyciski, które
        // ten stan pozwala wykonać. Kolor przycisku mówi o RODZAJU czynności, nie o jej
        // ważności na danej karcie: czerwień to „pieniądze wychodzą ode mnie", limonka
        // „domykam sprawę pieniędzy", ciemny „czynność, która pieniędzy nie rusza"
        // (stąd „Przypomnij" jest ciemny ZAWSZE, także gdy stoi sam na karcie).
        const zacoBody = (s) => {
            const nazwy = billNamesOfSettlement(s);
            if (!nazwy.length) return '';
            return `<div class="stack-zaco-body">${nazwy
                .map((n) => `<span class="stack-state-line"><span class="truncate">${escapeHtml(n)}</span></span>`)
                .join('')}</div>`;
        };
        // Blok stanu bywa rozwijalny („Za co"), ale rozwinięcie doklejamy POD nim, żeby
        // sam blok został przy stałej wysokości.
        const stackStateMaybeZaco = (s, linie) => {
            const body = zacoBody(s);
            if (!body) return stackState(linie);
            return `<details class="stack-zaco">
                <summary>${stackState(linie)}</summary>
                ${body}
            </details>`;
        };

        const settleAvatarBig = (id) => avatarHtml(memberName(id), id, 'w-12 h-12 text-lg');
        const settleAvatarRow = (id) => avatarHtml(memberName(id), id, 'w-7 h-7 text-xs');

        // SZCZEGÓŁY POD WIERSZEM. Ta sama treść, co blok stanu dużej karty, tylko bez
        // sztywnej wysokości: tutaj nic nie skacze pod palcem, bo rozwinięcie jest ruchem
        // świadomym, a nie stanem, przez który się przeklikuje.
        const detailRow = (lewo, prawo = '', klasa = '') =>
            `<span class="detail-line ${klasa}"><span class="truncate">${lewo}</span>${prawo ? `<b class="flex-shrink-0">${prawo}</b>` : ''}</span>`;
        const detailBlock = (linie) => `<div class="stack-detail">${linie.filter(Boolean).join('')}</div>`;

        // --- GŁOWA KARTY NA WIERZCHU STOSU: jeden szkielet na trzy karty --------------
        //
        // Zgłoszenie właściciela 2026-08-30: „kafelek Do wyjaśnienia ma dziwny układ,
        // po lewej tekst zciśnięty i bardzo zwinięty". Przyczyna była arytmetyczna,
        // nie estetyczna: trzy karty stosu lepiły własny rząd `[znak][tekst][kwota]`,
        // w którym kwota stała w stopniu 2xl z `flex-shrink-0`. Na telefonie 390 px karta
        // ma 326 px treści, z czego znak i odstępy zjadają 60, a kwota „1082,30 PLN"
        // w tym stopniu kolejne 155 — na tytuł zostawało około 110 px. Nazwie osoby to nie
        // przeszkadzało, ale gdy tytułem jest ZDANIE („Macu nie znalazł Twojego przelewu"),
        // łamało się ono na cztery wiersze, a znak i kwota pływały w połowie ich wysokości.
        //
        // Zdanie i duża kwota nie zmieszczą się w jednym rzędzie i nie ma sensu ich do tego
        // zmuszać. Kwota schodzi więc wiersz niżej, na prawy koniec rzędu ze znaczkiem stanu:
        // oba są krótkie, więc się nie biją, a tytuł dostaje całą szerokość kolumny.
        // To ten sam układ, co w kafelku rejestru (`.log-row`) — nagłówek, a pod nim rząd
        // „stan po lewej, pieniądze po prawej".
        //
        // PODPIS DOSTAJE WŁASNY WIERSZ TYLKO WTEDY, gdy zajęty jest znaczkiem. Bez tego
        // karta planu przelewów (nazwa + „2 rachunki" + kwota) urosłaby o wiersz, choć
        // nie ma czego rozdzielać.
        const stackBigHead = ({ avatar, title, note = '', chip = '', amount = '', amountClass = '' }) => `
            <div class="stack-big">
                ${avatar}
                <div class="stack-big-col">
                    <p class="stack-big-title">${title}</p>
                    ${chip && note ? `<p class="stack-big-note">${note}</p>` : ''}
                    <div class="stack-big-meta">
                        <span class="stack-big-side">${chip || (note ? `<span class="stack-big-note">${note}</span>` : '')}</span>
                        ${amount ? `<span class="amount stack-big-amount ${amountClass}">${amount}</span>` : ''}
                    </div>
                </div>
            </div>`;

        // Ile rachunków pokrywa ta wpłata — jedna fraza, używana w obu gęstościach.
        const ileRachunkow = (s) => {
            const n = billNamesOfSettlement(s).length;
            return n ? `${n} ${plural(n, 'rachunek', 'rachunki', 'rachunków')}` : '';
        };

        // KARTA WPŁATY OCZAMI ODBIORCY. Cztery stany, cztery zestawy przycisków.
        const payeeCard = (s, billCtx = null) => {
            const stan = settlementState(s);
            const kwota = fmtMoney(settlementAmountG(s), settlementCurrency(s));
            const kto = escapeHtml(memberName(s.from));
            const zaCo = ileRachunkow(s);
            const kiedy = stampLong(s.createdAt);
            const id = escapeHtml(s.id);
            const czeka = stan === SETTLE_PENDING || stan === SETTLE_INSISTED;

            // IMIONA STOJĄ WYŁĄCZNIE W MIANOWNIKU — inaczej wychodzi „Masz przelew od Bartek?".
            // Polskich imion nie da się odmienić regułą (Bartek→Bartka, Ania→Ani, Kuba→Kuby),
            // a zgadywanie na końcówkach kaleczy część imion w każdej ekipie. Dlatego pytanie
            // nie zawiera imienia w ogóle: kto pyta, mówi twarz i podpis pod nagłówkiem.
            //
            // Z tego samego powodu czasowniki są w formie „zgłosił/a": aplikacja nie zna płci
            // i nie ma jak jej zgadnąć. Ta konwencja stoi tu od początku, w całej skrzynce.
            const naglowek = stan === SETTLE_PENDING
                ? 'Masz ten przelew?'
                : stan === SETTLE_INSISTED
                    ? 'Podtrzymuje: wysłał/a na pewno'
                    : stan === SETTLE_STALLED
                        ? 'Sprawa czeka na Was'
                        : 'Sprawdza u siebie';
            const podpis = `${kto}${kiedy ? ` · ${escapeHtml(kiedy)}` : ''}`;

            // „Nie widzę", nie „Nie mam". To nie ta sama rzecz: „nie mam" orzeka o świecie
            // i brzmi jak zarzut, a „nie widzę" mówi prawdę — szukałem i nie znalazłem.
            // Dzięki temu wiadomość, która pójdzie do drugiej strony, nie zaczyna się
            // od oskarżenia o kłamstwo.
            const akcje = czeka
                ? `<button class="settle-yes-btn btn btn-primary flex-grow" data-id="${id}"><i class="fas fa-check mr-1.5"></i>${stan === SETTLE_INSISTED ? 'Jednak mam' : 'Mam'}</button>
                   <button class="settle-no-btn btn btn-ghost flex-grow" data-id="${id}"><i class="fas fa-xmark mr-1.5"></i>${stan === SETTLE_INSISTED ? 'Nadal nie widzę' : 'Nie widzę'}</button>`
                : `<button class="settle-yes-btn btn btn-primary flex-grow" data-id="${id}"><i class="fas fa-check mr-1.5"></i>Jednak mam</button>
                   <button class="nudge-btn btn btn-dark flex-shrink-0" data-nudge-to="${escapeHtml(s.from)}" data-amount-g="${settlementAmountG(s)}" data-currency="${escapeHtml(settlementCurrency(s))}">Przypomnij</button>`;

            // Przy zgłoszeniu czekającym na odpowiedź blok stanu pokazuje RACHUNKI, bo to
            // jest to, co człowiek sprawdza. Przy sporze — DATY, bo po nich szuka się
            // przelewu na wyciągu i to jest jedyne narzędzie, jakie aplikacja ma do oddania.
            const nazwy = billNamesOfSettlement(s);

            // NA EKRANIE RACHUNKU KARTA MÓWI O TYM JEDNYM RACHUNKU — ale musi powiedzieć
            // też prawdę o zasięgu odpowiedzi. Jeden przelew bywa zapłatą za pięć rachunków,
            // a potwierdza się PRZELEW, nie rachunek: „Mam" stuknięte tutaj domyka też
            // cztery pozostałe. Bez tej linijki człowiek zamyka pięć spraw, myśląc, że
            // zamyka jedną.
            const linieRachunku = billCtx ? [
                stackLine('Jego udział w tym rachunku', escapeHtml(fmtMoney(billCtx.udzialG, billCtx.currency)), 'is-lead'),
                stackLine('Zgłoszone', escapeHtml(kiedy)),
                nazwy.length > 1
                    ? stackLine(`Pokrywa też ${nazwy.length - 1} ${plural(nazwy.length - 1, 'inny rachunek', 'inne rachunki', 'innych rachunków')}`, '', 'is-more')
                    : stackLine('Pokrywa tylko ten rachunek', ''),
            ] : null;

            const linie = linieRachunku && czeka
                ? linieRachunku
                : czeka
                ? (nazwy.length
                    ? nazwy.slice(0, 3).map((n, i) => ((i === 2 && nazwy.length > 3)
                        ? stackLine(`Za co · ${nazwy.length} rachunków <i class="fas fa-chevron-down stack-zaco-chevron ml-1"></i>`, '', 'is-more')
                        : stackLine(escapeHtml(n), '')))
                    : [stackLine('Wpłata bez przypisania do rachunków', '', 'is-lead')])
                : stan === SETTLE_INSISTED
                    ? [stackLine('Poszukaj jeszcze raz', '', 'is-lead'),
                       stackLine('Zgłoszone', escapeHtml(kiedy)),
                       stackLine('Kwota', escapeHtml(kwota))]
                    : stan === SETTLE_STALLED
                        ? [stackLine('Dogadajcie się poza aplikacją', '', 'is-lead'),
                           stackLine('Zgłoszone', escapeHtml(kiedy)),
                           stackLine('Nie znalazłeś dwa razy', '')]
                        : [stackLine('Nie znalazłeś tego przelewu', '', 'is-lead'),
                           stackLine('Zgłoszone', escapeHtml(kiedy)),
                           stackLine(`${zaCo || 'bez rachunków'}`, '')];

            const flagged = czeka ? '' : ' card-flagged';
            // Chip TYLKO tam, gdzie nie powtarza nagłówka stosu. W stosie „Do wyjaśnienia"
            // pigułka „Do wyjaśnienia" byłaby echem tytułu dwa centymetry wyżej.
            const chip = stan === SETTLE_INSISTED
                ? `<span class="chip text-info"><i class="fas fa-eye"></i>Sprawdź jeszcze raz</span>`
                : '';

            return {
                flagged,
                big: `${stackBigHead({
                          avatar: settleAvatarBig(s.from),
                          title: escapeHtml(naglowek),
                          note: podpis,
                          chip,
                          amount: escapeHtml(kwota),
                      })}
                      ${stackStateMaybeZaco(s, linie)}
                      <div class="mt-3 flex items-center gap-2">${akcje}</div>`,
                rowFace: `${settleAvatarRow(s.from)}
                        <span class="flex-grow min-w-0">
                            <span class="stack-row-top"><span class="stack-row-name truncate">${kto}</span><span class="amount stack-row-amount">${escapeHtml(kwota)}</span></span>
                            <span class="stack-row-sub"><span class="stack-dot ${czeka ? 'is-info' : 'is-gray'}"></span><span class="stack-row-sub-text">${escapeHtml(stampShort(s.createdAt))}${zaCo ? ` · ${escapeHtml(zaCo)}` : ''}</span><i class="fas fa-chevron-down stack-row-chevron" aria-hidden="true"></i></span>
                        </span>`,
                rowActions: `<button class="settle-no-btn icon-btn-sm is-ghost" data-id="${id}" aria-label="Nie widzę"><i class="fas fa-xmark"></i></button>
                        <button class="settle-yes-btn icon-btn-sm is-yes" data-id="${id}" aria-label="Mam"><i class="fas fa-check"></i></button>`,
                details: detailBlock([
                    detailRow(escapeHtml(naglowek), '', 'is-lead'),
                    detailRow('Kwota', escapeHtml(kwota)),
                    detailRow('Zgłoszone', escapeHtml(kiedy)),
                    billCtx ? detailRow('Udział w tym rachunku', escapeHtml(fmtMoney(billCtx.udzialG, billCtx.currency))) : '',
                    nazwy.length
                        ? `${detailRow(`Pokrywa ${nazwy.length} ${plural(nazwy.length, 'rachunek', 'rachunki', 'rachunków')}`, '', 'is-head')}${nazwy.map((n) => detailRow(escapeHtml(n))).join('')}`
                        : detailRow('Wpłata bez przypisania do rachunków'),
                ]),
            };
        };

        // KARTA WPŁATY OCZAMI NADAWCY — czyli tego, kto zgłosił przelew i usłyszał „nie widzę".
        // Nazwy przycisków mówią o tym, co się NAPRAWDĘ stało: człowiek właśnie sprawdził
        // w banku i odkrył albo że wysłał, albo że nie. „Wycofaj wpłatę" (poprzednia nazwa)
        // było słownikiem bazy danych — nikt nie myśli o sobie „wycofuję wpłatę".
        //
        // „Pomyłka, nie wysłałem" MUSI prowadzić prosto do przelewu, i to nie jest wygoda:
        // bez tego człowiek wyśle pieniądze teraz i stuknie „Wysłałem na pewno", zostawiając
        // w mocy stare zgłoszenie ze starą datą. Odbiorca dostanie wtedy tę datę jako
        // podpowiedź i będzie przeszukiwał wyciąg wokół dnia, w którym nic nie wyszło.
        const debtorDisputeCard = (s) => {
            const stan = settlementState(s);
            const kwota = fmtMoney(settlementAmountG(s), settlementCurrency(s));
            const kto = escapeHtml(memberName(s.to));
            const id = escapeHtml(s.id);
            const czekaNaMnie = stan === SETTLE_DISPUTED || stan === SETTLE_STALLED;

            const naglowek = stan === SETTLE_INSISTED
                ? `${kto} sprawdza jeszcze raz`
                : stan === SETTLE_STALLED
                    ? 'Sprawa czeka na Was'
                    : `${kto} nie znalazł Twojego przelewu`;

            const akcje = stan === SETTLE_INSISTED
                ? `<button class="settle-oops-btn btn btn-ghost flex-grow" data-id="${id}">Pomyłka, nie wysłałem</button>`
                : `<button class="settle-insist-btn btn btn-dark flex-grow" data-id="${id}">Wysłałem na pewno</button>
                   <button class="settle-oops-btn btn btn-ghost flex-grow" data-id="${id}">Pomyłka, nie wysłałem</button>`;

            const linie = [
                stackLine(stan === SETTLE_INSISTED ? 'Czeka na jego odpowiedź' : 'Dług wrócił na saldo', '', 'is-lead'),
                stackLine('Zgłoszone', escapeHtml(stampLong(s.createdAt))),
                zacoBody(s)
                    ? stackLine('Za co <i class="fas fa-chevron-down stack-zaco-chevron ml-1"></i>', '', 'is-more')
                    : stackLine('Kwota', escapeHtml(kwota)),
            ];

            return {
                flagged: ' card-flagged',
                big: `${stackBigHead({
                          avatar: settleAvatarBig(s.to),
                          title: escapeHtml(naglowek),
                          chip: `<span class="chip"><i class="fas fa-eye"></i>${stan === SETTLE_STALLED ? 'Do wyjaśnienia' : 'Sprawdzacie'}</span>`,
                          amount: escapeHtml(kwota),
                          amountClass: 'text-owe',
                      })}
                      ${stackStateMaybeZaco(s, linie)}
                      <div class="mt-3 flex items-center gap-2">${akcje}</div>`,
                rowFace: `${settleAvatarRow(s.to)}
                        <span class="flex-grow min-w-0">
                            <span class="stack-row-top"><span class="stack-row-name truncate">${kto}</span><span class="amount stack-row-amount text-owe">${escapeHtml(kwota)}</span></span>
                            <span class="stack-row-sub"><span class="stack-dot is-gray"></span><span class="stack-row-sub-text">${czekaNaMnie ? 'czeka na Ciebie' : 'sprawdza'} · ${escapeHtml(stampShort(s.createdAt))}</span><i class="fas fa-chevron-down stack-row-chevron" aria-hidden="true"></i></span>
                        </span>`,
                rowActions: `<button class="settle-oops-btn icon-btn-sm is-ghost" data-id="${id}" aria-label="Pomyłka, nie wysłałem"><i class="fas fa-rotate-left"></i></button>`,
                details: detailBlock([
                    detailRow(escapeHtml(naglowek), '', 'is-lead'),
                    detailRow('Kwota', escapeHtml(kwota)),
                    detailRow('Zgłoszone', escapeHtml(stampLong(s.createdAt))),
                    (() => {
                        const nazwy = billNamesOfSettlement(s);
                        return nazwy.length
                            ? `${detailRow(`Pokrywa ${nazwy.length} ${plural(nazwy.length, 'rachunek', 'rachunki', 'rachunków')}`, '', 'is-head')}${nazwy.map((n) => detailRow(escapeHtml(n))).join('')}`
                            : detailRow('Wpłata bez przypisania do rachunków');
                    })(),
                ]),
            };
        };

        // OTWARTE RACHUNKI ZWINIĘTE NA OSOBIE — podstawa ekranu Rozliczeń w trybie
        // rachunkowym. Zwraca wiersze `{ other, currency, sumaG, rachunki[] }`.
        //
        // To jest jedyne miejsce, w którym tryb rachunkowy sumuje po osobie — i jest to
        // świadome. Przelew robi się DO CZŁOWIEKA, nie do rachunku, więc ekran, na którym
        // się płaci, musi być ułożony po ludziach. Rozpisanie na rachunki nie znika:
        // siedzi pod „Za co" przy każdym wierszu i wraca w pełnej krasie przy wyborze,
        // co dokładnie pokrywam.
        const perBillPerPerson = (rows, mojaStrona) => {
            const map = new Map();
            rows.forEach((r) => {
                const other = mojaStrona === 'debtor' ? r.payer : r.debtor;
                const key = `${other}|${r.currency}`;
                let g = map.get(key);
                if (!g) { g = { other, currency: r.currency, sumaG: 0, rachunki: [] }; map.set(key, g); }
                g.sumaG += r.openG;
                g.rachunki.push(r);
            });
            // Największy dług pierwszy: przy kilkunastu osobach to on jest pytaniem dnia.
            return [...map.values()].sort((a, b) => b.sumaG - a.sumaG);
        };

        // KARTA OSOBY. Tu nie ma żadnej wpłaty do rozstrzygnięcia — jest człowiek i kwota.
        // `grupa` to wiersz z `perBillPerPerson`: { other, currency, sumaG, rachunki[] }.
        //
        // Suma sporna dopisuje się CICHĄ LINIJKĄ, bez przycisku. Powód: gdy odbiorca
        // odrzuci przelew, dług wraca na saldo, więc ta sama osoba stoi i w stosie spraw
        // (z kwotą przelewu), i tutaj (z całym długiem). Bez tej linijki dwie liczby o tej
        // samej osobie wyglądałyby na sprzeczne; z nią widać, że jedna jest częścią drugiej.
        // Przycisku tam nie ma świadomie — sprawę załatwia się w stosie spraw, nie w dwóch
        // miejscach naraz.
        const personCard = (grupa, { kierunek, sporneG = 0 }) => {
            // W planie minimalnym przelew nie należy do żadnego rachunku (idzie trasą,
            // której nie stworzył ani jeden rachunek), więc lista „za co" jest pusta —
            // i to jest prawda o tym trybie, a nie brak danych.
            const ile = (grupa.rachunki || []).length;
            const zaCo = ile ? `${ile} ${plural(ile, 'rachunek', 'rachunki', 'rachunków')}` : '';
            const kwota = fmtMoney(grupa.sumaG, grupa.currency);
            const kolor = kierunek === 'owe' ? 'text-owe' : 'text-due';
            const imie = escapeHtml(memberName(grupa.other));
            const other = escapeHtml(grupa.other);
            const cur = escapeHtml(grupa.currency);

            const linie = grupa.rachunki.slice(0, 3).map((r, i) => (
                (i === 2 && ile > 3)
                    ? stackLine(`…i ${ile - 2} więcej`, '', 'is-more')
                    : stackLine(escapeHtml(r.billName || 'Rachunek'), escapeHtml(fmtMoney(r.openG, r.currency)))
            ));

            const crossref = sporneG > 0
                ? `<span class="crossref"><i class="fas fa-eye"></i>Z tego ${escapeHtml(fmtMoney(sporneG, grupa.currency))} czeka na wyjaśnienie</span>`
                : '';

            // „Przypomnij" jest CIEMNY, nie limonkowy, i to jest reguła na całą aplikację:
            // kolor mówi o rodzaju czynności, nie o jej wadze na danej karcie. Przypomnienie
            // nie rusza pieniędzy — wysyła wiadomość do człowieka. Limonka zostaje dla tego,
            // co domyka sprawę pieniędzy, czerwień dla tego, co je wyprowadza.
            // W trybie rachunkowym „Ureguluj" prowadzi do WYBORU rachunków (bo kwota bierze
            // się z zaznaczenia), w planie minimalnym wprost do okna wpłaty — tam przelew
            // nie należy do żadnego rachunku, więc nie ma czego wybierać.
            const uregulujBtn = ile
                ? `<button class="pick-bills-btn btn btn-danger flex-grow" data-other="${other}" data-currency="${cur}">Ureguluj ${escapeHtml(kwota)}</button>`
                : `<button class="settle-btn btn btn-danger flex-grow" data-to="${other}" data-amount-g="${grupa.sumaG}" data-currency="${cur}">Ureguluj ${escapeHtml(kwota)}</button>`;
            const akcje = kierunek === 'owe'
                ? uregulujBtn
                : `<button class="nudge-btn btn btn-dark flex-grow" data-nudge-to="${other}" data-amount-g="${grupa.sumaG}" data-currency="${cur}"><i class="fas fa-bell mr-1.5"></i>Przypomnij</button>`;
            const cichy = kierunek === 'owe' ? ''
                : `<button type="button" class="receive-btn quiet-link mt-2" data-from="${other}" data-amount-g="${grupa.sumaG}" data-currency="${cur}">Oddał/a mi już</button>`;

            // IKONA MÓWI O PIENIĄDZACH, NIE O KIERUNKU (zgłoszenie właściciela 2026-08-29).
            // Stała tu zwykła strzałka w prawo — ta sama, którą w całej aplikacji znaczy
            // „przejdź dalej". Na przycisku, który otwiera regulowanie długu, czytała się
            // więc jako nawigacja, a nie jako zapłata. Banknoty ze strzałkami nie zostawiają
            // wątpliwości: stąd wychodzą pieniądze.
            const ikonaRow = kierunek === 'owe'
                ? (ile
                    ? `<button class="pick-bills-btn icon-btn-sm is-danger" data-other="${other}" data-currency="${cur}" aria-label="Ureguluj"><i class="fas fa-money-bill-transfer"></i></button>`
                    : `<button class="settle-btn icon-btn-sm is-danger" data-to="${other}" data-amount-g="${grupa.sumaG}" data-currency="${cur}" aria-label="Ureguluj"><i class="fas fa-money-bill-transfer"></i></button>`)
                : `<button class="nudge-btn icon-btn-sm is-dark" data-nudge-to="${other}" data-amount-g="${grupa.sumaG}" data-currency="${cur}" aria-label="Przypomnij"><i class="fas fa-bell"></i></button>`;

            return {
                flagged: '',
                big: `${stackBigHead({
                          avatar: avatarHtml(memberName(grupa.other), grupa.other, 'w-12 h-12 text-lg'),
                          title: imie,
                          note: zaCo ? escapeHtml(zaCo) : '',
                          amount: escapeHtml(kwota),
                          amountClass: kolor,
                      })}
                      ${stackState(linie)}
                      ${crossref}
                      <div class="mt-3 flex items-center gap-2">${akcje}</div>
                      ${cichy}`,
                rowFace: `${avatarHtml(memberName(grupa.other), grupa.other, 'w-7 h-7 text-xs')}
                        <span class="flex-grow min-w-0">
                            <span class="stack-row-top"><span class="stack-row-name truncate">${imie}</span><span class="amount stack-row-amount ${kolor}">${escapeHtml(kwota)}</span></span>
                            <span class="stack-row-sub"><span class="stack-dot is-mute"></span><span class="stack-row-sub-text">${escapeHtml(zaCo || 'plan przelewów')}</span><i class="fas fa-chevron-down stack-row-chevron" aria-hidden="true"></i></span>
                        </span>`,
                rowActions: ikonaRow,
                details: detailBlock([
                    detailRow('Razem', escapeHtml(kwota), 'is-lead'),
                    ile
                        ? `${detailRow(`${ile} ${plural(ile, 'rachunek', 'rachunki', 'rachunków')}`, '', 'is-head')}${grupa.rachunki
                            .map((r) => detailRow(escapeHtml(r.billName || 'Rachunek'), escapeHtml(fmtMoney(r.openG, r.currency))))
                            .join('')}`
                        : detailRow('Przelew z planu — nie należy do żadnego rachunku'),
                    sporneG > 0 ? detailRow('Czeka na wyjaśnienie', escapeHtml(fmtMoney(sporneG, grupa.currency))) : '',
                ]),
            };
        };

        // Ile z długu tej osoby wisi w sprawie spornej — do cichej linijki na karcie osoby.
        const sporneWobec = (spory, otherId, currency) => spory
            .filter((s) => (s.from === otherId || s.to === otherId) && settlementCurrency(s) === currency)
            .reduce((sum, s) => sum + settlementAmountG(s), 0);

        // Rozpisanie „za co" pod wierszem osoby: nazwa rachunku i kwota, jeden pod drugim.
        const perBillDetailHtml = (grupa) => `
            <details class="mt-1.5"><summary class="text-xs text-ink-2 cursor-pointer select-none">Za co</summary>
                <div class="mt-1 pl-2 border-l border-ink/15">${grupa.rachunki.map((r) => `
                    <div class="flex justify-between gap-2 text-xs py-0.5">
                        <span class="truncate text-ink-3">${escapeHtml(r.billName || 'Rachunek')}</span>
                        <span class="amount flex-shrink-0 text-ink-3">${fmtMoney(r.openG, r.currency)}</span>
                    </div>`).join('')}</div>
            </details>`;

        // EKRAN ROZLICZEŃ W TRYBIE RACHUNKOWYM — wiersz na OSOBĘ.
        //
        // Nie ma tu wiersza na rachunek i to jest zmiana z 2026-08-26: rozpisanie rachunek
        // po rachunku dublowało zakładkę „Rachunki", a przy jednym przelewie za trzy
        // kolacje kazało odklikiwać trzy wiersze. Rachunki nie znikają — są pod „Za co"
        // i w arkuszu wyboru przy regulowaniu, gdzie da się odznaczyć te, których akurat
        // nie pokrywam.
        // --- CZTERY ODPOWIEDZI NA ZGŁOSZONY PRZELEW -------------------------------
        //
        // Wszystkie cztery piszą do bazy OD RAZU (`fireWrite`, nie `await`), bo aplikacja
        // działa offline, a obietnica z Firestore bez sieci nie rozwiązuje się nigdy.
        // Odłożony zapis byłby tu gorszy niż niedoskonałe cofanie: zniknąłby przy
        // zamknięciu aplikacji, a człowiek byłby przekonany, że odpowiedział.
        //
        // TARCIE JEST NIESYMETRYCZNE i to jest świadome. „Mam" to odpowiedź spodziewana
        // i częsta — dostaje jedno stuknięcie i pasek „Cofnij". „Nie widzę" cofa pieniądze
        // i budzi drugiego człowieka, więc zatrzymuje się na arkuszu — ale ten arkusz nie
        // pyta „na pewno?", tylko podaje trzy fakty, których człowiek mógł nie mieć.
        // Arkusz, który tylko pyta, jest czystym podatkiem; arkusz, który coś mówi, nie jest.
        // ZBIORCZE PRZYPOMNIENIE OMIJA SPORNE. To nie jest detal.
        //
        // Po odmowie („nie widzę tego przelewu") dług WRACA na saldo, więc osoba
        // z niezałatwioną sprawą znów trafia na listę dłużników — i zbiorcza wysyłka
        // potraktowałaby ją jak każdą inną, wysyłając „oddaj 340 zł" komuś, kto właśnie
        // twierdzi, że te 340 wysłał. To brzmi jak zarzut kłamstwa i jest najgorszą
        // możliwą wiadomością w tej sytuacji.
        //
        // Ich sprawa ma własne miejsce i własny przycisk — w stosie „Do wyjaśnienia".
        const maSpornaWplateDoMnie = (myId, otherId) => disputesAsPayee(myId)
            .some((s) => s.from === otherId);

        const settleDocRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`, id);

        // Wpłata potwierdzona przed chwilą — do jednorazowego zielonego błysku w rejestrze
        // (patrz `.log-row.is-just-confirmed` w src/tailwind.css). Trzymamy CZAS obok
        // identyfikatora, bo potwierdzać można także z ekranu rozliczeń, przy zamkniętym
        // rejestrze: bez znacznika czasu błysk czekałby w kolejce i odpalił się przy
        // wejściu do rejestru pół godziny później, ogłaszając „właśnie" coś dawnego.
        let justConfirmedSettlement = null;

        const confirmSettlement = (id) => {
            const s = latestSettlements.find((x) => x.id === id);
            if (!s) return;
            justConfirmedSettlement = { id, at: Date.now() };
            // Potwierdzenie ZAWSZE gasi spór — inaczej wpłata zostałaby poza saldem
            // mimo tego, że odbiorca właśnie powiedział „jednak mam".
            //
            // NIE RUSZAMY `insisted`: to pole NADAWCY („wysłałem na pewno"), a reguły
            // Firestore pilnują rozdziału ról i odrzuciłyby cały zapis. Zresztą nie ma po co
            // — `settlementState` pyta najpierw o spór, więc wpłata bez sporu jest po prostu
            // potwierdzona, niezależnie od tego, co nadawca wcześniej podtrzymywał.
            fireWrite(updateDoc(settleDocRef(id), {
                confirmed: true, confirmedBy: currentUser.uid, confirmedAt: serverTimestamp(),
                disputed: false, stalled: false,
            }), 'Nie udało się potwierdzić wpłaty.');
            showUndoToast(`Wpłata potwierdzona · ${memberName(s.from)}`, () => {
                fireWrite(updateDoc(settleDocRef(id), {
                    confirmed: false, confirmedBy: null, confirmedAt: null,
                }), 'Nie udało się cofnąć potwierdzenia.');
            });
        };

        const disputeSettlement = (id) => {
            const s = latestSettlements.find((x) => x.id === id);
            if (!s) return;
            // Druga odmowa KOŃCZY ping-ponga. Aplikacja nie rozstrzyga sporu, więc po
            // dwóch rundach milknie: zostaje zapis obu wypowiedzi i dwa wyjścia, otwarte
            // bezterminowo. Bez tego progu dwoje ludzi mogłoby się nawzajem budzić w kółko.
            const drugaRunda = settlementState(s) === SETTLE_INSISTED;
            fireWrite(updateDoc(settleDocRef(id), {
                disputed: true, disputedBy: currentUser.uid, disputedAt: serverTimestamp(),
                confirmed: false,
                ...(drugaRunda ? { stalled: true } : {}),
            }), 'Nie udało się zgłosić braku przelewu.');
            showUndoToast('Zgłoszono brak przelewu', () => {
                fireWrite(updateDoc(settleDocRef(id), {
                    disputed: false, disputedBy: null, disputedAt: null,
                    ...(drugaRunda ? { stalled: false } : {}),
                }), 'Nie udało się cofnąć zgłoszenia.');
            });
        };

        const insistSettlement = (id) => {
            fireWrite(updateDoc(settleDocRef(id), {
                insisted: true, insistedAt: serverTimestamp(),
            }), 'Nie udało się wysłać prośby o sprawdzenie.');
            showToast('Poprosiliśmy o sprawdzenie jeszcze raz.');
        };

        // „POMYŁKA, NIE WYSŁAŁEM" — i od razu droga do przelewu.
        //
        // To nie jest wygoda, tylko higiena daty. Bez tej ścieżki człowiek idzie do banku,
        // odkrywa, że nie wysłał, WYSYŁA TERAZ i stuka „Wysłałem na pewno" — a wtedy stoi
        // w mocy stare zgłoszenie ze starą datą. Odbiorca dostaje tę datę jako podpowiedź
        // i przeszukuje wyciąg wokół dnia, w którym nic nie wyszło.
        //
        // KASUJEMY albo ZNACZAMY, zależnie od tego, czy ktoś już to widział. Świeża pomyłka,
        // na którą nikt nie zdążył odpowiedzieć, znika bez śladu — tak działa „Usuń wpis"
        // od 2026-08-15. Ale zgłoszenie, na które druga strona już odpowiedziała, zostaje
        // w rejestrze jako „wycofana": rejestr ma być dowodem, a dowód z dziurą nim nie jest.
        const withdrawSettlement = (id) => {
            const s = latestSettlements.find((x) => x.id === id);
            if (!s) return;
            const ktosOdpowiedzial = s.disputed === true || s.confirmed === true;
            const billIds = Array.isArray(s.billIds) ? s.billIds : (s.billId ? [s.billId] : []);
            const other = s.to;
            const currency = settlementCurrency(s);

            if (ktosOdpowiedzial) {
                fireWrite(updateDoc(settleDocRef(id), {
                    withdrawn: true, withdrawnAt: serverTimestamp(),
                }), 'Nie udało się wycofać zgłoszenia.');
            } else {
                fireWrite(deleteDoc(settleDocRef(id)), 'Nie udało się usunąć zgłoszenia.');
            }
            showToast('Poprzednie zgłoszenie zniknęło.');

            // Prowadzimy prosto tam, gdzie człowiek i tak zaraz pójdzie: do wyboru rachunków
            // (tryb rachunkowy) albo do okna wpłaty (plan minimalny).
            if (groupSettlementMode() === 'perBill' && billIds.length) openPickBills(other, currency);
            else openSettleModal(other, settlementAmountG(s), currency, 'send', billIds.length ? billIds : null);
        };

        // Arkusz trzech przyczyn. Trzyma id wpłaty, o którą pytamy — sam arkusz jest
        // jeden na całą aplikację, bo pytanie jest zawsze to samo.
        let pendingDisputeId = null;
        const openNoTransferSheet = (id) => {
            const s = latestSettlements.find((x) => x.id === id);
            if (!s) return;
            pendingDisputeId = id;
            const lead = document.getElementById('no-transfer-lead');
            if (lead) {
                lead.textContent = `${memberName(s.from)} zgłosił przelew ${fmtMoney(settlementAmountG(s), settlementCurrency(s))}`
                    + `${stampLong(s.createdAt) ? ` — ${stampLong(s.createdAt)}` : ''}. Zanim to zgłosisz, sprawdź trzy najczęstsze przyczyny:`;
            }
            document.getElementById('no-transfer-modal').classList.add('active');
        };

        // DWIE STRONY EKRANU ROZLICZEŃ, każda z własnymi nazwanymi stosami.
        //
        //   Płacisz    → „Do zapłaty" (LUDZIE)  + „Do wyjaśnienia" (SPRAWY)
        //   Dostajesz  → „Do potwierdzenia" (SPRAWY) + „Do wyjaśnienia" (SPRAWY)
        //                + „Czekasz na przelew" (LUDZIE)
        //
        // Stos trzyma ALBO ludzi, ALBO sprawy — nigdy jedno i drugie w tej samej kupce.
        // Ludzie odpowiadają na pytanie „ile mi wisi", sprawy na „czy ten przelew doszedł".
        // Wrzucenie ich razem było pierwszą wersją tego ekranu i właśnie dlatego nie dało
        // się z niego dowiedzieć, że potwierdziło się już wszystko: stos z przypomnieniami
        // nigdy się nie opróżnia.
        //
        // CUDZE DŁUGI ZNIKNĘŁY Z TEGO EKRANU (decyzja właściciela 2026-08-29).
        //
        // Stała pod stronami rozwijana linijka „Jeszcze N zwrotów w grupie" — spis długów
        // MIĘDZY INNYMI LUDŹMI. Nie dawało się z nią zrobić nic: nie mój przelew, nie moje
        // przypomnienie, nie moje potwierdzenie. Zajmowała ostatni wiersz ekranu, na którym
        // wszystko inne jest czynnością do wykonania, i przy piętnastu osobach rozwijała się
        // w listę dłuższą niż moje własne rozliczenia.
        //
        // Do rejestru NIE TRAFIA i to nie jest przeoczenie: rejestr przyjmuje wyłącznie to,
        // co RUSZYŁO pieniądze („czy po tym zdarzeniu ktoś jest komuś winien inną kwotę"),
        // a cudzy niezapłacony dług niczym jeszcze nie ruszył. Kto ile wydał w pokoju, widać
        // w ustawieniach pokoju.
        //
        // Zwraca `{ oweHtml, dueHtml, oweCount, dueCount }`.
        const settlementSides = (myId) => {
            const mode = groupSettlementMode();
            const doPotwierdzenia = settlementsAwaitingMe(myId);
            const sporyOdbiorcy = disputesAsPayee(myId);
            const sporyDluznika = disputesAsDebtor(myId);

            let ludzieOwe = [];
            let ludzieDue = [];
            let bezHtml = '';

            if (mode === 'perBill') {
                const per = perBillNow();
                ludzieOwe = perBillPerPerson(myBillsToPay(per, myId), 'debtor');
                ludzieDue = perBillPerPerson((per.rows || []).filter((r) => r.payer === myId && r.openG > 0), 'payer');
                const bez = myUnassigned(per, myId).sent;
                bezHtml = bez.length ? `<div class="mt-4">${unassignedBlockHtml(bez)}</div>` : '';
            } else {
                // Plan minimalny i „kto komu": przelew idzie trasą, której nie stworzył
                // żaden pojedynczy rachunek, więc karta osoby nie ma listy „za co”.
                const ledger = buildLedger(ledgerBills(), latestSettlements);
                Object.keys(ledger).forEach((cur) => {
                    const transfers = simplifyDebts(ledger[cur].directed);
                    transfers.forEach((t) => {
                        const grupa = { currency: cur, sumaG: t.amountG, rachunki: [] };
                        if (t.from === myId) ludzieOwe.push({ ...grupa, other: t.to });
                        else if (t.to === myId) ludzieDue.push({ ...grupa, other: t.from });
                    });
                });
                ludzieOwe.sort((a, b) => b.sumaG - a.sumaG);
                ludzieDue.sort((a, b) => b.sumaG - a.sumaG);
            }

            const kartyOwe = ludzieOwe.map((g) => personCard(g, {
                kierunek: 'owe',
                sporneG: sporneWobec(sporyDluznika, g.other, g.currency),
            }));
            const kartyDue = ludzieDue.map((g) => personCard(g, {
                kierunek: 'due',
                sporneG: sporneWobec(sporyOdbiorcy, g.other, g.currency),
            }));

            // KOLEJNOŚĆ W STOSIE: najpierw to, co czeka na MÓJ ruch i da się zrobić teraz.
            // „Najstarsze pierwsze" byłoby tu złym kryterium — sprawa stojąca od tygodnia
            // wygląda na pilną, ale „Jednak mam" wymaga tego, żeby pieniądze faktycznie
            // doszły, a nie kolejnego stuknięcia. Świeże pytanie domyka się w sekundę.
            const odNajstarszych = (a, b) => (tsDate(a.createdAt)?.getTime() || 0) - (tsDate(b.createdAt)?.getTime() || 0);
            doPotwierdzenia.sort(odNajstarszych);
            sporyOdbiorcy.sort(odNajstarszych);
            sporyDluznika.sort(odNajstarszych);

            // Stan pusty ma TYLKO „Do potwierdzenia" — brak przelewów do sprawdzenia jest
            // dobrą wiadomością i człowiek ma się o niej dowiedzieć. Pozostałe stosy
            // znikają bez śladu, bo pusta lista „do wyjaśnienia" byłaby zaproszeniem
            // do szukania problemu, którego nie ma.
            const potwierdzenia = doPotwierdzenia.length
                ? stackHtml({
                    name: 'confirm', title: 'Do potwierdzenia', tone: 'is-info',
                    items: doPotwierdzenia.map(payeeCard),
                })
                : (kartyDue.length || sporyOdbiorcy.length
                    ? `<div class="stack-done mb-4"><i class="fas fa-check"></i><span>Nie masz przelewów do potwierdzenia</span></div>`
                    : '');

            const oweHtml = [
                stackHtml({
                    name: 'pay', title: 'Do zapłaty', tone: 'is-owe', items: kartyOwe,
                }),
                sporyDluznika.length
                    ? `<div class="mt-4">${stackHtml({ name: 'mydisputes', title: 'Do wyjaśnienia', items: sporyDluznika.map(debtorDisputeCard) })}</div>`
                    : '',
                bezHtml,
            ].filter(Boolean).join('');

            const dueHtml = [
                potwierdzenia,
                sporyOdbiorcy.length
                    ? `<div class="mt-4">${stackHtml({ name: 'disputes', title: 'Do wyjaśnienia', items: sporyOdbiorcy.map(payeeCard) })}</div>`
                    : '',
                kartyDue.length
                    ? `<div class="mt-4">${stackHtml({ name: 'waiting', title: 'Czekasz na przelew', tone: 'is-due', items: kartyDue })}</div>`
                    : '',
            ].filter(Boolean).join('');

            return {
                oweHtml, dueHtml,
                oweCount: kartyOwe.length + sporyDluznika.length,
                dueCount: doPotwierdzenia.length + sporyOdbiorcy.length + kartyDue.length,
            };
        };

        // ARKUSZ „ZA CO PŁACISZ". Wybór rachunków, które pokrywa jeden przelew.
        //
        // Wpłata NIESIE listę wybranych rachunków (`billIds`), a nie jest rozdzielana
        // regułą „od najstarszego". Reguła zostaje dla wpłat, które takiej listy nie mają
        // — starych i tych z planu minimalnego — ale tutaj byłaby wprost szkodliwa:
        // przy odznaczeniu środkowego rachunku zgasiłaby nie te, które człowiek wybrał,
        // a odbiorca nie miałby skąd wiedzieć, za co dostał pieniądze.
        let pickBillsState = null;

        const renderPickBills = () => {
            const list = document.getElementById('pick-bills-list');
            const lead = document.getElementById('pick-bills-lead');
            const confirm = document.getElementById('pick-bills-confirm');
            if (!list || !pickBillsState) return;
            const { rachunki, wybrane, currency, other } = pickBillsState;
            lead.textContent = `Przelew do: ${memberName(other)}. Odznacz to, czego teraz nie pokrywasz.`;
            // Wiersz nosi klasy `person-row`, ale BEZ twarzy: rachunek nie jest osobą,
            // a kółko ze znakiem obok nazwy kolacji czytałoby się jak czyjś awatar.
            // Zostaje sam kształt wiersza i znacznik wyboru, który już tam mieszka.
            list.innerHTML = rachunki.map((r) => `
                <button type="button" class="person-row" data-id="${escapeHtml(r.billId)}" aria-pressed="${wybrane.has(r.billId) ? 'true' : 'false'}">
                    <span class="flex-grow min-w-0 truncate font-medium">${escapeHtml(r.billName || 'Rachunek')}</span>
                    <span class="amount text-ink-2 flex-shrink-0">${fmtMoney(r.openG, r.currency)}</span>
                    <span class="person-row-check" aria-hidden="true"><i class="fas fa-check"></i></span>
                </button>`).join('');
            const sumaG = rachunki.filter((r) => wybrane.has(r.billId)).reduce((s, r) => s + r.openG, 0);
            confirm.textContent = sumaG > 0 ? `Ureguluj ${fmtMoney(sumaG, currency)}` : 'Zaznacz choć jeden rachunek';
            confirm.disabled = sumaG <= 0;
            confirm.classList.toggle('opacity-50', sumaG <= 0);
            list.querySelectorAll('.person-row').forEach((row) => {
                row.onclick = () => {
                    const id = row.dataset.id;
                    if (wybrane.has(id)) wybrane.delete(id); else wybrane.add(id);
                    renderPickBills();
                };
            });
        };

        const openPickBills = (otherId, currency) => {
            const per = perBillNow();
            const my = myMemberNow();
            if (!my) { showToast('Najpierw dołącz do grupy.', true); return; }
            const rachunki = myBillsToPay(per, my.id)
                .filter((r) => r.payer === otherId && r.currency === currency);
            if (!rachunki.length) return;
            pickBillsState = {
                other: otherId,
                currency,
                rachunki,
                wybrane: new Set(rachunki.map((r) => r.billId)),
            };
            renderPickBills();
            document.getElementById('pick-bills-modal').classList.add('active');
        };

        const renderSettlements = () => {
            const container = document.getElementById('settlements-list');
            if (!container || !groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const myId = myMember ? myMember.id : null;

            const groupMode = groupSettlementMode();
            const ledger = buildLedger(ledgerBills(), latestSettlements);
            const currencies = Object.keys(ledger).sort((a, b) => {
                const ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
            });

            // Stan pusty jest tu stanem SUKCESU, nie brakiem danych — i tak ma wyglądać.
            const nothing = `<div class="card p-5 flex items-center gap-3">
                <span class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-due/12 text-due"><i class="fas fa-check text-lg"></i></span>
                <span><span class="block font-bold">Wszystko rozliczone</span><span class="block text-sm text-ink-2">Nikt nikomu nic nie jest winien.</span></span>
            </div>`;
            // „Wszystko rozliczone" TYLKO wtedy, gdy naprawdę nie ma czego rozliczać.
            // Rachunki poza księgą nie są tu już wypisywane (decyzja właściciela 2026-08-27),
            // ale przy nich ten ekran MILCZY, zamiast ogłaszać sukces: pokój pełen
            // niedokończonych rachunków twierdziłby inaczej, że nikt nikomu nic nie jest
            // winien — czyli aplikacja mówiłaby nieprawdę o cudzych pieniądzach.
            const nicDoRozliczenia = `<div class="card p-5 flex items-center gap-3">
                <span class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-2 text-ink-3"><i class="fas fa-check text-lg"></i></span>
                <span class="font-bold">Nic do rozliczenia</span>
            </div>`;
            if (currencies.length === 0) {
                container.innerHTML = billsOutsideLedger().length > 0 ? nicDoRozliczenia : nothing;
                return;
            }

            // WYKŁAD ZSZEDŁ POD ZNAK ZAPYTANIA (decyzja właściciela 2026-08-29).
            //
            // Stał tu czterowierszowy akapit tłumaczący tryb rozliczania — na górze ekranu,
            // nad wszystkim, co się na nim robi, i tak samo długi przy setnym wejściu jak
            // przy pierwszym. To jest odpowiedź na pytanie zadawane RAZ, więc mieszka teraz
            // w pomocy pod „?" w nagłówku pokoju (HELP_CONTENT), gdzie wolno jej być
            // dłuższą i pełniejszą.
            //
            // JEDNO ZDANIE ZOSTAJE, ale wyłącznie w planie minimalnym i wyłącznie wtedy,
            // gdy realnie zachodzi sprzeczność: „jesteś winien dwóm osobom" na Bilansie
            // obok pustej strony „Płacisz" tutaj. To nie jest wykład o trybie, tylko fakt
            // o TWOICH liczbach — a fakt, którego bez wyjaśnienia nie da się pogodzić
            // z sąsiednim ekranem, musi stać tam, gdzie się go zobaczy.
            const myOweCount = new Set(
                Object.keys(ledger).flatMap((c) => ledger[c].net.filter((t) => t.from === myId).map((t) => t.to)),
            ).size;

            const strony = settlementSides(myId);

            const wstep = (groupMode !== 'perBill' && myOweCount > 0 && strony.oweCount === 0)
                ? `<p class="block-quiet p-3.5 text-xs text-ink-2 mb-3">Nie masz tu nic do zapłaty, choć para po parze jesteś winien ${myOweCount === 1 ? 'jednej osobie' : `${myOweCount} osobom`}. Twój dług spłaca ktoś, kto jest winien Tobie — na tym polega plan „Najmniej przelewów".</p>`
                : '';

            // STRONA PUSTA NIE JEST POWODEM, ŻEBY NA NIEJ LĄDOWAĆ — ale też nie jest powodem,
            // ŻEBY NIE DAŁO SIĘ NA NIĄ WEJŚĆ (zgłoszenie właściciela 2026-08-29). Do tej pory
            // ta sama reguła robiła obie rzeczy: odbijała z powrotem także wtedy, gdy człowiek
            // sam przesunął palcem na pustą stronę, więc gest wyglądał na zepsuty. Teraz
            // podpowiedź działa TYLKO przy pierwszym wejściu, zanim ktokolwiek wybrał stronę.
            if (!settleSideChosen) {
                if (settleSide === 'owe' && strony.oweCount === 0 && strony.dueCount > 0) settleSide = 'due';
                if (settleSide === 'due' && strony.dueCount === 0 && strony.oweCount > 0) settleSide = 'owe';
            }

            const seg = (id, napis, n) => `<button type="button" class="settle-side-btn seg-btn" data-side="${id}" aria-pressed="${settleSide === id ? 'true' : 'false'}">${napis}${n ? `<span class="seg-count">${n}</span>` : ''}</button>`;
            // STAN PUSTY STRONY JEST ODPOWIEDZIĄ, NIE MILCZENIEM. Kto przesunął palcem
            // na „Dostajesz" i nie ma tam nic, ma przeczytać, że nie czeka na żadną wpłatę
            // — inaczej pusty ekran czyta się jak usterka wczytywania.
            const pusto = (ikona, tekst) => `<div class="settle-empty"><span class="settle-empty-icon"><i class="fas ${ikona}"></i></span><span>${tekst}</span></div>`;

            container.innerHTML = `
                ${wstep}
                <div class="seg seg-wide mb-3" id="settle-seg"><span class="seg-thumb" aria-hidden="true"></span>${seg('owe', 'Płacisz', strony.oweCount)}${seg('due', 'Dostajesz', strony.dueCount)}</div>
                <div id="settle-panes" class="settle-swipe">
                    <div class="settle-track">
                        <div class="settle-pane" data-side="owe">${strony.oweHtml || pusto('fa-check', 'Nikomu nic nie jesteś winien.')}</div>
                        <div class="settle-pane" data-side="due">${strony.dueHtml || pusto('fa-check', 'Nie czekasz na żadną wpłatę.')}</div>
                    </div>
                </div>
            `;

            // Obie strony stoją teraz w dokumencie ZAWSZE — przełącznik i gest tylko
            // przesuwają taśmę. Dzięki temu przejście da się animować, a strona pusta
            // jest osiągalna tak samo jak pełna.
            settlePanesSync({ animate: false });
            applyStackMorph();

            // Wejście do rejestru wpłat. Sam rejestr mieszka w osobnym arkuszu
            // pełnoekranowym — patrz `renderSettlementsLog`.
            const logBtn = document.getElementById('open-settlements-log');
            if (logBtn) logBtn.classList.toggle('hidden', latestSettlements.length === 0 && !(latestEvents || []).some((ev) => ev && ev.type === 'bill-amount'));
        };

        // --- TAŚMA DWÓCH STRON ----------------------------------------------------
        //
        // Obie strony leżą obok siebie na jednej taśmie, a widać tę, na którą taśma jest
        // przesunięta. `--settle-p` to POSTĘP od 0 (Płacisz) do 1 (Dostajesz) — jedna liczba,
        // z której bierze się i przesunięcie taśmy, i położenie pigułki w przełączniku.
        // Dzięki temu w trakcie gestu OBA elementy jadą za palcem i widać, że to jedno
        // urządzenie, a nie dwa niezależne.
        //
        // WYSOKOŚĆ USTAWIAMY Z KODU, bo strony są różnej długości. Bez tego taśma miałaby
        // zawsze wysokość dłuższej i pod krótszą zostawałby pas pustki na pół ekranu.
        let settleObserver = null;

        const settlePanesSync = ({ animate = true } = {}) => {
            const list = document.getElementById('settlements-list');
            const box = document.getElementById('settle-panes');
            if (!list || !box) return;
            const pane = box.querySelector(`.settle-pane[data-side="${settleSide}"]`);
            if (!pane) return;
            list.style.setProperty('--settle-p', settleSide === 'due' ? '1' : '0');
            list.querySelectorAll('.settle-side-btn').forEach((b) => {
                b.setAttribute('aria-pressed', b.dataset.side === settleSide ? 'true' : 'false');
            });
            box.classList.toggle('is-animated', animate && !prefersReducedMotion());
            // WYSOKOŚĆ ZERO ZNACZY „JESTEM UKRYTY", NIE „JESTEM PUSTY". Ekran rozliczeń
            // przerysowuje się przy każdej zmianie w bazie, także wtedy, gdy stoimy
            // na Bilansie albo Rachunkach — a element w ukrytej zakładce ma zerową
            // wysokość. Zapisanie jej na sztywno zostawiłoby po powrocie pustą stronę.
            // Wtedy zdejmujemy wysokość w ogóle: taśma bierze ją z dłuższej strony,
            // a `showDeckView` dopina właściwą w chwili, gdy zakładka się pokazuje.
            const wysokosc = pane.offsetHeight;
            box.style.height = wysokosc > 0 ? `${wysokosc}px` : '';
            // Rozwinięcie „Za co", zwinięcie stosu, dopisany wiersz z bazy — wszystko
            // to zmienia wysokość strony bez przerysowania całego ekranu. Obserwator
            // dopina wysokość taśmy do tego, co realnie stoi na wierzchu.
            if (settleObserver) settleObserver.disconnect();
            if (typeof ResizeObserver === 'function') {
                settleObserver = new ResizeObserver(() => {
                    const teraz = box.querySelector(`.settle-pane[data-side="${settleSide}"]`);
                    // Ta sama reguła, co wyżej: zero znaczy „ukryty", a nie „pusty".
                    if (teraz && teraz.offsetHeight > 0) box.style.height = `${teraz.offsetHeight}px`;
                });
                settleObserver.observe(pane);
            }
        };

        const setSettleSide = (side) => {
            if (side !== 'owe' && side !== 'due') return;
            settleSideChosen = true;
            if (side === settleSide) { settlePanesSync(); return; }
            settleSide = side;
            settlePanesSync();
        };

        // --- REJESTR WPŁAT ----------------------------------------------------------
        //
        // Do 2026-08-15 rejestr był zwiniętą linijką „Rejestr wpłat (4)" doklejoną pod
        // rozliczeniami. Nie wyglądał na listę, a po rozwinięciu upychał nadawcę,
        // odbiorcę, kwotę, datę i stan potwierdzenia w jeden wiersz z wielokropkiem.
        // Teraz to osobne miejsce z pełnym wierszem na wpłatę i nagłówkiem dnia —
        // tym samym, co na liście rachunków, więc czyta się bez uczenia się nowego.
        //
        // KASOWANIE: tylko WŁASNA wpłata i tylko dopóki odbiorca jej nie potwierdził
        // (decyzja właściciela 2026-08-15). To naprawa własnej pomyłki sprzed minuty,
        // a nie kasowanie historii — po potwierdzeniu wpis jest dowodem dla dwóch stron
        // i znika wyłącznie wpłatą w drugą stronę. Reguły Firestore pilnują tego samego.
        // REJESTR MA DWA SEGMENTY I JEDNĄ REGUŁĘ WSTĘPU.
        //
        // „Moje" to sprawy, w których jestem stroną — mój dowód. „Cała grupa" to to samo
        // dla wszystkich, bo pieniądze w pokoju nie są tajemnicą.
        //
        // Wchodzi WYŁĄCZNIE to, co ruszyło pieniądze albo jest dowodem w sporze. Test:
        // „czy po tym zdarzeniu ktoś jest komuś winien inną kwotę". Przypomnienia,
        // stuknięcia pozycji i zmiany nazw nie przechodzą tego testu — bez tej reguły
        // rejestr po tygodniu wyjazdu przestaje być dowodem i staje się szumem.
        let logMode = 'mine';
        // Stan szukania i filtra stanu. Ulotny jak `settleSide`: to pytanie na teraz,
        // a nie ustawienie — po zamknięciu arkusza rejestr wraca do pełnej listy.
        let logQuery = '';
        let logFilter = 'all';

        // Do której pigułki należy ta wpłata. Cztery kubełki, bo tyle jest realnych pytań:
        // „co jeszcze wisi", „co domknięte", „co poszło nie tak" i „wszystko".
        const logBucket = (s) => {
            const stan = settlementState(s);
            if (stan === SETTLE_CONFIRMED) return 'confirmed';
            if (stan === SETTLE_PENDING || stan === SETTLE_INSISTED) return 'pending';
            return 'issue';
        };

        // Po czym szukamy: imiona OBU stron, nazwy rachunków i kwota. Czyli po wszystkim,
        // co człowiek pamięta, gdy szuka dowodu — nikt nie pamięta identyfikatora wpisu.
        const logHaystack = (s) => [
            memberName(s.from),
            memberName(s.to),
            ...billNamesOfSettlement(s),
            fmtMoney(toGrosze(s.amount || 0), s.currency || 'PLN'),
        ].join(' ').toLowerCase();

        const renderSettlementsLog = () => {
            const list = document.getElementById('settlements-log-list');
            if (!list) return;
            const myId = (myMemberNow() || {}).id || null;

            document.querySelectorAll('.log-mode-btn').forEach((btn) => {
                btn.setAttribute('aria-pressed', String(btn.dataset.log === logMode));
            });
            document.querySelectorAll('.log-filter-btn').forEach((btn) => {
                btn.setAttribute('aria-pressed', String(btn.dataset.logFilter === logFilter));
            });

            const moje = (s) => s && (s.from === myId || s.to === myId);
            const wszystkieMoje = logMode === 'mine' ? latestSettlements.filter(moje) : latestSettlements;
            // Zmiana kwoty rachunku to jedyne zdarzenie spoza wpłat, które przechodzi test
            // „czy ktoś jest teraz winien inną kwotę" — i odpowiada na pytanie, które pada
            // zawsze: czemu nagle jestem winien więcej.
            const wszystkieZmiany = (latestEvents || []).filter((ev) => ev && ev.type === 'bill-amount');

            // PUSTY REJESTR TO CO INNEGO NIŻ PUSTY WYNIK SZUKANIA — i mówimy o tym osobno,
            // bo pierwsze znaczy „nic się jeszcze nie wydarzyło", a drugie „szukaj inaczej".
            if (wszystkieMoje.length === 0 && wszystkieZmiany.length === 0) {
                document.getElementById('log-filters').classList.add('hidden');
                document.querySelector('.log-search').classList.add('hidden');
                list.innerHTML = `<p class="text-ink-3 text-sm py-6 text-center">${logMode === 'mine'
                    ? 'Nie masz jeszcze żadnych wpłat ani zmian kwot.'
                    : 'Nikt jeszcze nie zapisał żadnej wpłaty.'}</p>`;
                return;
            }
            document.getElementById('log-filters').classList.remove('hidden');
            document.querySelector('.log-search').classList.remove('hidden');

            const szukane = logQuery.trim().toLowerCase();
            const pasuje = (s) => !szukane || logHaystack(s).includes(szukane);
            const znalezione = wszystkieMoje.filter(pasuje);

            // Liczby przy pigułkach liczą się PO szukaniu: pigułka ma mówić, ile dostaniesz
            // po jej stuknięciu, a nie ile było przed wpisaniem słowa.
            document.querySelectorAll('.log-filter-btn').forEach((btn) => {
                const k = btn.dataset.logFilter;
                const ile = k === 'all' ? znalezione.length : znalezione.filter((s) => logBucket(s) === k).length;
                const licznik = btn.querySelector('.filter-pill-count');
                if (licznik) licznik.textContent = ile ? String(ile) : '';
            });

            const wplaty = logFilter === 'all' ? znalezione : znalezione.filter((s) => logBucket(s) === logFilter);
            // Zmiany kwot nie mają stanu wpłaty, więc pod filtrem stanu nie mają czego
            // pokazać — schodzą z listy zamiast udawać, że pasują do każdego kubełka.
            const zmianyKwot = logFilter !== 'all'
                ? []
                : wszystkieZmiany.filter((ev) => !szukane
                    || `${ev.byName || memberName(ev.by)} ${ev.label || ''}`.toLowerCase().includes(szukane));

            if (wplaty.length === 0 && zmianyKwot.length === 0) {
                list.innerHTML = `<p class="text-ink-3 text-sm py-6 text-center">Nic nie pasuje do tego, czego szukasz.</p>`;
                return;
            }

            const dayLabel = (date) => {
                if (!date) return 'Bez daty';
                const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
                const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
                if (days === 0) return 'Dzisiaj';
                if (days === 1) return 'Wczoraj';
                const sameYear = date.getFullYear() === new Date().getFullYear();
                return date.toLocaleDateString('pl-PL', sameYear
                    ? { day: 'numeric', month: 'long' }
                    : { day: 'numeric', month: 'long', year: 'numeric' });
            };

            let html = '';
            let lastDay = null;
            // Czy zielony błysk faktycznie trafił w tym przebiegu na ekran. Gasimy go dopiero
            // wtedy — potwierdzenie wraca z bazy osobnym zapisem, więc pierwszy przerysunek
            // zaraz po stuknięciu bywa jeszcze bez niego.
            let blysnietoPotwierdzeniem = false;
            wplaty.forEach((s) => {
                const at = (s.createdAt && s.createdAt.toDate) ? s.createdAt.toDate() : null;
                const key = at ? `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}` : 'brak';
                if (key !== lastDay) {
                    lastDay = key;
                    html += `<p class="bills-day-title mt-4 mb-2 first:mt-0">${escapeHtml(dayLabel(at))}</p>`;
                }
                const stan = settlementState(s);
                const canConfirm = stan !== SETTLE_CONFIRMED && stan !== SETTLE_WITHDRAWN && s.to === myId;
                const canDelete = s.createdBy === currentUser.uid && !s.confirmed;
                // CHIP NAZYWA STAN, a nie tylko „jest / nie ma potwierdzenia". Odkąd na
                // zgłoszony przelew da się odpowiedzieć „nie widzę", dwa stany to za mało:
                // rejestr ma być dowodem, a dowód musi umieć powiedzieć, na czym stanęło.
                //
                // ODBIORCA, KTÓRY NIE ZAJĄŁ IMIENIA, nie może potwierdzić — reguły pilnują,
                // żeby robił to wyłącznie właściciel konta. Wpis wisiałby wtedy w „Czeka"
                // bez nikogo, kto mógłby to ruszyć, więc mówimy o tym wprost zamiast
                // udawać, że sprawa czeka na człowieka, którego w pokoju nie ma.
                const odbiorcaWszedl = !!((groupData && groupData.members && groupData.members[s.to] || {}).claimedBy);
                const badge = stan === SETTLE_CONFIRMED
                    ? `<span class="chip text-due"><i class="fas fa-check"></i>Potwierdzona</span>`
                    : stan === SETTLE_WITHDRAWN
                        ? `<span class="chip"><i class="fas fa-rotate-left"></i>Wycofana</span>`
                        : stan === SETTLE_STALLED
                            ? `<span class="chip"><i class="fas fa-eye"></i>Do wyjaśnienia</span>`
                            : stan === SETTLE_DISPUTED
                                ? `<span class="chip"><i class="fas fa-eye"></i>Nie znaleziona</span>`
                                : stan === SETTLE_INSISTED
                                    ? `<span class="chip text-info"><i class="fas fa-eye"></i>Sprawdzana ponownie</span>`
                                    : odbiorcaWszedl
                                        ? `<span class="chip text-info"><i class="fas fa-hourglass-half"></i>Czeka na potwierdzenie</span>`
                                        : `<span class="chip"><i class="fas fa-user-clock"></i>Ta osoba nie dołączyła do pokoju</span>`;
                // DWIE DATY NA KAŻDYM WIERSZU. Oba pola były w bazie od zawsze, tylko nigdy
                // ich nie było widać — a różnica między nimi odpowiada na pytanie, które
                // pada przy każdym większym wyjeździe: ile ktoś zwlekał z potwierdzeniem.
                //
                // DWIE POSTACIE DAT, NIE JEDNA (2026-08-30). Pełna tabelka „etykieta ⟷ pełny
                // znacznik czasu" w KAŻDYM wierszu podnosiła kafelek o dwa rzędy tam, gdzie
                // nie miała czego dowodzić: przy wpłacie potwierdzonej następnego dnia nikt
                // nie liczy minut. Sprawa sporna to co innego — tam różnica dat JEST dowodem
                // i zostaje rozpisana co do godziny.
                const sporna = stan === SETTLE_DISPUTED || stan === SETTLE_STALLED || stan === SETTLE_INSISTED;
                const daty = [
                    ['Zgłoszona', s.createdAt],
                    stan === SETTLE_CONFIRMED ? ['Potwierdzona', s.confirmedAt] : null,
                    sporna ? ['Nie znaleziona', s.disputedAt] : null,
                    stan === SETTLE_WITHDRAWN ? ['Wycofana', s.withdrawnAt] : null,
                ].filter((x) => x && x[1]);
                const datyHtml = daty.length === 0
                    ? ''
                    : sporna
                        ? `<div class="log-dates">${daty.map(([co, kiedy]) =>
                            `<span class="log-date-row"><span>${escapeHtml(co)}</span><b>${escapeHtml(stampLong(kiedy))}</b></span>`).join('')}</div>`
                        : `<p class="log-dates-inline">${daty.map(([co, kiedy]) =>
                            `${escapeHtml(co)} <b>${escapeHtml(stampShort(kiedy))}</b>`).join(' · ')}</p>`;

                // KWOTA NIESIE KIERUNEK KOLOREM — ale wyłącznie w „Moich sprawach", bo tylko
                // tam istnieje „ja", względem którego pieniądze wychodzą albo wracają.
                // W widoku całej grupy nie ma takiego punktu odniesienia i barwa kłamałaby,
                // więc kwota zostaje atramentowa. Ta sama reguła, co wszędzie indziej:
                // czerwień znaczy „ode mnie", zieleń „do mnie", nigdy nic więcej.
                const kwotaKlasa = logMode !== 'mine' ? '' : (s.from === myId ? 'text-owe' : (s.to === myId ? 'text-due' : ''));

                // UKŁAD: NAGŁÓWEK I TREŚĆ NA PEŁNĄ SZEROKOŚĆ (zgłoszenie właściciela 2026-08-30).
                //
                // Do 2026-08-30 wiersz miał po lewej szynę z dwiema twarzami i strzałką —
                // na telefonie 360 px około stu pikseli, czyli JEDNĄ TRZECIĄ szerokości karty,
                // przez całą jej wysokość. Przy `align-items: center` twarze pływały dodatkowo
                // w połowie wysokości wysokiego kafelka, otoczone pustką. Do tego tożsamość
                // była niesiona DWA RAZY: twarzami w szynie i zaraz obok imionami w tekście.
                //
                // Teraz twarz stoi tuż przed swoim imieniem i jest z nim jednym słowem, a cała
                // reszta — nazwa rachunku, stan, daty, przyciski — dostaje pełną szerokość karty
                // zamiast wcięcia o szerokość szyny. Kwota idzie na prawy koniec nagłówka, więc
                // kwoty wszystkich wierszy ustawiają się w jedną kolumnę i rejestr da się
                // przejrzeć wzrokiem po pieniądzach, a nie po imionach.
                const strona = (id) => `<span class="log-party">${avatarHtml(memberName(id), id, 'w-6 h-6 text-[0.625rem]')}<b>${escapeHtml(memberName(id))}</b></span>`;
                const swiezoPotwierdzona = stan === SETTLE_CONFIRMED
                    && justConfirmedSettlement
                    && justConfirmedSettlement.id === s.id
                    && (Date.now() - justConfirmedSettlement.at) < 8000;
                if (swiezoPotwierdzona) blysnietoPotwierdzeniem = true;
                // Klasa składana POZA szablonem — tak samo, jak przy linii paragonu:
                // skaner Tailwinda nie znajduje nazw sklejanych wewnątrz atrybutu.
                const klasaWiersza = swiezoPotwierdzona ? 'log-row is-just-confirmed' : 'log-row';
                html += `<div class="${klasaWiersza}">
                    <div class="log-head">
                        <span class="log-parties">${strona(s.from)}<i class="fas fa-arrow-right log-arrow"></i>${strona(s.to)}</span>
                        <span class="amount log-amount ${kwotaKlasa}">${fmtMoney(toGrosze(s.amount || 0), s.currency || 'PLN')}</span>
                    </div>
                    ${billNamesOfSettlement(s).length
                        ? `<p class="log-bills">${billNamesOfSettlement(s).map((n) => escapeHtml(n)).join(' · ')}</p>`
                        : ''}
                    <div class="log-state">${badge}</div>
                    ${datyHtml}
                    ${(canConfirm || canDelete) ? `<div class="log-actions">
                        ${canConfirm ? `<button class="confirm-settle-btn btn btn-primary" data-id="${escapeHtml(s.id)}">Potwierdzam</button>` : ''}
                        ${canDelete ? `<button class="settle-delete-btn btn btn-quiet" data-id="${escapeHtml(s.id)}">Usuń wpis</button>` : ''}
                    </div>` : ''}
                </div>`;
            });
            // Zmiany kwot idą osobnym blokiem na dole: są rzadsze i innego rodzaju
            // niż wpłaty, a wymieszane z nimi po dacie gubiłyby się między wierszami.
            if (zmianyKwot.length) {
                html += `<p class="bills-day-title mt-5 mb-2">Zmiany kwot</p>`;
                // TEN SAM SZKIELET, CO WPŁATA (2026-08-30). Zmiana kwoty stała tu w bloku
                // `block-quiet` o innym tle, innym zaokrągleniu i innym odstępie niż wiersz
                // wpłaty pół ekranu wyżej — dwie listy w jednym arkuszu wyglądały jak dwie
                // różne aplikacje. Treść zostaje ta sama, zmienia się wyłącznie to, że
                // korzysta z tego samego pudełka: twarz przy imieniu w nagłówku, opis
                // i znacznik czasu pod spodem, na pełną szerokość.
                zmianyKwot.forEach((ev) => {
                    const kiedy = stampLong(ev.createdAt);
                    const kto = ev.byName || memberName(ev.by);
                    html += `<div class="log-row">
                        <div class="log-head">
                            <span class="log-parties"><span class="log-party">${avatarHtml(kto, ev.by, 'w-6 h-6 text-[0.625rem]')}<b>${escapeHtml(kto)}</b></span></span>
                        </div>
                        <p class="log-bills">${escapeHtml(ev.label || '')}</p>
                        ${kiedy ? `<p class="log-dates-inline">${escapeHtml(kiedy)}</p>` : ''}
                    </div>`;
                });
            }
            list.innerHTML = html;
            if (blysnietoPotwierdzeniem) justConfirmedSettlement = null;
        };

        const openSettlementsLog = () => {
            // Każde otwarcie zaczyna się od pełnej listy. Szukanie jest pytaniem na teraz,
            // a nie ustawieniem — wczorajsze słowo ukrywałoby dziś połowę dowodów.
            logQuery = '';
            logFilter = 'all';
            const pole = document.getElementById('log-search');
            if (pole) pole.value = '';
            const czysc = document.getElementById('log-search-clear');
            if (czysc) czysc.classList.add('hidden');
            renderSettlementsLog();
            document.getElementById('settlements-log-modal').classList.add('active');
        };

        // mode: 'send' = ja płacę (Ureguluj, do potwierdzenia) | 'receive' = ja otrzymałem (od razu potwierdzone)
        // `bills` — identyfikatory rachunków, które ta wpłata pokrywa. Pojedynczy napis
        // (przycisk na rachunku) albo tablica (arkusz „Za co płacisz"). Pole jest
        // OPCJONALNE: wpłaty bez niego działają bez żadnej migracji, a takich są
        // w istniejących pokojach wszystkie dotychczasowe.
        const openSettleModal = (otherId, amountG, currency, mode = 'send', bills = null) => {
            const billIds = (Array.isArray(bills) ? bills : [bills]).filter(Boolean);
            settleContext = { mode, other: otherId, currency, billIds, amountG: Number(amountG) || 0 };
            const amountStr = fromGrosze(Number(amountG) || 0).toFixed(2);
            const staleKwoty = mode !== 'receive';
            const input = document.getElementById('settle-amount-input');
            const fixed = document.getElementById('settle-amount-fixed');
            input.value = amountStr.replace('.', ',');
            input.classList.toggle('hidden', staleKwoty);
            fixed.classList.toggle('hidden', !staleKwoty);
            fixed.textContent = amountStr.replace('.', ',');
            document.getElementById('settle-amount-note').textContent = staleKwoty
                ? (billIds.length
                    ? 'Kwota to suma wybranych rachunków.'
                    : 'Kwota z planu przelewów.')
                : 'Wpisz kwotę, którą naprawdę dostałeś — także gotówką.';

            // Tytuł przelewu podpowiadamy WYŁĄCZNIE wtedy, gdy jest jednoznaczny.
            const tytulWrap = document.getElementById('settle-title-wrap');
            const nazwaJednego = billIds.length === 1 ? billNameById(billIds[0]) : '';
            tytulWrap.classList.toggle('hidden', !(staleKwoty && nazwaJednego));
            if (staleKwoty && nazwaJednego) {
                document.getElementById('settle-title-value').textContent = nazwaJednego;
                document.getElementById('settle-copy-title').dataset.account = nazwaJednego;
            }
            document.getElementById('settle-currency').textContent = currency;
            document.getElementById('settle-copy-amount').dataset.account = amountStr;
            document.getElementById('settle-name').textContent = memberName(otherId);
            const settleAvatar = document.getElementById('settle-avatar');
            if (settleAvatar) settleAvatar.innerHTML = avatarHtml(memberName(otherId), otherId, 'w-12 h-12 text-lg');
            document.getElementById('settle-name-label').textContent = mode === 'receive' ? 'Otrzymano od' : 'Wpłata do';
            document.getElementById('settle-record-btn').innerHTML = mode === 'receive'
                ? '<i class="fas fa-check mr-2"></i>Zapisz otrzymaną wpłatę'
                : '<i class="fas fa-check mr-2"></i>Zapisz wpłatę';
            // Nazwa rachunku w zdaniu pod przyciskiem, gdy wpłata dotyczy jednego rachunku.
            // Bez niej „Zapisz wpłatę" wygląda tak samo przy wpłacie ogólnej i przy zwrocie
            // za konkretną kolację — a to jest dokładnie ta różnica, po którą ktoś tu wszedł.
            const nazwy = settleContext.billIds.map(billNameById).filter(Boolean);
            const zaCo = nazwy.length === 1
                ? ` Wpłata dotyczy rachunku „${nazwy[0]}".`
                : nazwy.length > 1
                    ? ` Wpłata pokrywa ${nazwy.length} ${plural(nazwy.length, 'rachunek', 'rachunki', 'rachunków')}: ${nazwy.map((n) => `„${n}"`).join(', ')}.`
                    : '';
            document.getElementById('settle-record-note').textContent = (mode === 'receive'
                ? 'Potwierdzasz, że otrzymałeś tę kwotę.'
                : 'Zapisuje, że przelałeś tę kwotę. Odbiorca ją potwierdzi.')
                + zaCo;
            // Metody płatności pokazujemy tylko gdy JA płacę (send).
            const methodsWrap = document.getElementById('settle-methods-wrap');
            if (mode === 'receive') {
                methodsWrap.classList.add('hidden');
            } else {
                methodsWrap.classList.remove('hidden');
                const methods = getPaymentMethods((groupData && groupData.members && groupData.members[otherId]) || null);
                document.getElementById('settle-methods').innerHTML = methods.length === 0
                    ? `<p class="text-sm text-ink-3">Odbiorca nie zapisał jeszcze żadnego sposobu płatności. Dogadajcie się poza aplikacją.</p>`
                    : `<p class="text-sm font-bold text-ink-3 mb-2">Gdzie przelać</p>` + methods.map(paymentMethodRowHtml).join('');
            }
            document.getElementById('settle-modal').classList.add('active');
        };

        // --- Faza 6.3: przypomnienia (nudge-windykator) ---
        const myMemberNow = () => Object.values((groupData && groupData.members) || {})
            .find(m => m.claimedBy === (currentUser && currentUser.uid)) || null;

        // --- PRÓG SYGNAŁU: co zapala odznakę, a co tylko kropkę (docs/UI-UX.md §10.2) ---
        // Stan „już to widziałem" mieszka na urządzeniu, nie w bazie: to sprawa tego
        // telefonu, a nie faktu o rachunku. Klucze są per pokój, żeby dwa pokoje nie
        // gasiły sobie nawzajem sygnałów.
        const seenKey = (what) => `billsplitter_seen_${what}_${currentGroupId || 'x'}`;
        const readSeen = (what) => {
            try { return JSON.parse(localStorage.getItem(seenKey(what)) || '[]'); }
            catch { return []; }
        };
        const writeSeen = (what, ids) => {
            try { localStorage.setItem(seenKey(what), JSON.stringify(ids.slice(0, 200))); } catch (_) {}
        };

        // Rachunki czekające na MÓJ ruch — to samo źródło prawdy, co błękit na kafelku
        // i filtr „Czekają na Ciebie": ton `action` z `billStatus`.
        const actionBillsForMe = () => {
            const my = myMemberNow();
            if (!my) return [];
            return latestBills
                .map(({ id, data }) => ({ id, data }))
                .filter(({ data }) => {
                    const p = data.participants ? data.participants[my.id] : null;
                    if (!p || p.status === 'not_applicable') return false;
                    if ((data.hiddenBy || []).includes(my.id)) return false;
                    return billStatus(data, my, p).tone === 'action';
                })
                .map(({ id, data }) => ({
                    id,
                    title: data.billName,
                    label: billStatus(data, myMemberNow(), data.participants[my.id]).labelHtml,
                    at: (data.createdAt && data.createdAt.toMillis) ? data.createdAt.toMillis() : 0,
                }));
        };

        const currentInbox = () => {
            const my = myMemberNow();
            if (!my) return [];
            const ms = (t) => (t && t.toMillis) ? t.toMillis() : 0;
            return inboxItems({
                myId: my.id,
                myUid: currentUser && currentUser.uid,
                nudges: latestNudges.map(n => ({ ...n, createdAtMs: ms(n.createdAt) })),
                // `amountG` DOLICZAMY TU (poprawione 2026-08-26). Wpłata zapisuje kwotę
                // w złotych, w polu `amount`; pola `amountG` nie ma na niej nigdy.
                // Skrzynka czytała `s.amountG`, więc każdy wiersz o wpłacie szedł bez
                // kwoty: „Bartek zgłosił/a wpłatę." — bez ani jednej liczby, w aplikacji
                // o cudzych pieniądzach. Przypomnienia mają `amountG` i stąd wzięła się
                // ta pomyłka: dwa sąsiednie źródła, dwa różne kształty danych.
                settlements: latestSettlements.map(s => ({
                    ...s,
                    amountG: toGrosze(s.amount || 0),
                    createdAtMs: ms(s.createdAt),
                    confirmedAtMs: ms(s.confirmedAt),
                    disputedAtMs: ms(s.disputedAt),
                })),
                actionBills: actionBillsForMe(),
                seenConfirmations: readSeen('confirmations'),
            });
        };

        const updateNudgeBadge = () => {
            const badge = document.getElementById('nudges-badge');
            const bell = document.getElementById('nudges-bell');
            const my = myMemberNow();
            if (bell) bell.classList.toggle('hidden', !my);

            const items = currentInbox();

            // Odznaka LICZBOWA wyłącznie dla poziomu 1 — to reguła, bez której wracamy
            // do ślepoty na czerwoną kropkę (§10.2, reguła 1).
            if (badge) {
                const count = badgeCount(items);
                badge.textContent = count > 9 ? '9+' : String(count);
                badge.classList.toggle('hidden', count === 0);
            }

            // Kropka na „Rachunkach" gaśnie po wejściu w zakładkę i zapala się dopiero,
            // gdy pojawi się rachunek, którego jeszcze tam nie widziałem (§10.2, reguła 2).
            const dot = document.getElementById('nav-bills-dot');
            if (dot) {
                const seen = readSeen('bills');
                const fresh = items.some((x) => x.level === 2 && !seen.includes(x.id));
                dot.classList.toggle('hidden', !(hasDot(items) && fresh));
            }
        };

        // Wejście na zakładkę „Rachunki" gasi kropkę: sprawy zostały obejrzane.
        const markBillsSeen = () => {
            const ids = currentInbox().filter((x) => x.level === 2).map((x) => x.id);
            writeSeen('bills', ids);
            const dot = document.getElementById('nav-bills-dot');
            if (dot) dot.classList.add('hidden');
        };

        // Wierzyciel przypomina dłużnikowi (toId). Anty-spam: max raz na 6h do tej samej osoby.
        // --- SZABLONY PRZYPOMNIEŃ ---------------------------------------------------
        // Domyślna treść jest RZECZOWA i wpisana z góry: produkt nie żartuje przy
        // kwocie ani przy błędzie. Humor może dołożyć wyłącznie człowiek, wpisując
        // własną treść — i wtedy jest to jego żart, a nie żart aplikacji.
        const DEFAULT_NUDGE_MESSAGE = 'Cześć! Przypominam o zwrocie za nasz wspólny rachunek. Dzięki!';
        // Dwa przypomnienia, które NIE są o pieniądzach — i dlatego mają własną treść.
        // Gdyby jechały domyślną, telefon powiedziałby „przypomina o zaległości" komuś,
        // kto nie jest nic winien, a to jest najkrótsza droga do wyłączenia powiadomień.
        const FILL_NUDGE_MESSAGE = 'Stuknij swoje pozycje na rachunku — czekamy, żeby się rozliczyć.';
        const REOPEN_NUDGE_MESSAGE = 'To nie moje — proszę o cofnięcie podziału reszty, chcę poprawić swoje pozycje.';
        // SZABLONY OSOBNO DLA KAŻDEGO RODZAJU PRZYPOMNIENIA.
        // Wspólna szuflada znaczyłaby, że pod prośbą „stuknij swoje pozycje" wyskakują
        // gotowce o oddawaniu pieniędzy — czyli podpowiedzi do zupełnie innej rozmowy.
        const nudgeTemplatesKey = (kind = 'debt') =>
            kind === 'fill' ? 'billsplitter_fill_templates' : 'billsplitter_nudge_templates';
        const readNudgeTemplates = (kind = 'debt') => {
            try { return JSON.parse(localStorage.getItem(nudgeTemplatesKey(kind)) || '[]'); }
            catch { return []; }
        };
        const writeNudgeTemplates = (list, kind = 'debt') => {
            // Pięć szablonów wystarczy: dłuższa lista przestaje być wyborem, a staje się
            // kolejną rzeczą do przewijania w chwili, gdy chce się po prostu wysłać.
            try { localStorage.setItem(nudgeTemplatesKey(kind), JSON.stringify(list.slice(0, 5))); } catch (_) {}
        };

        let nudgeDraft = null; // { lista, currency, kind, billId, billName }

        const nudgeDefaultMessage = (kind) => (kind === 'fill' ? FILL_NUDGE_MESSAGE : DEFAULT_NUDGE_MESSAGE);

        const renderNudgeTemplates = () => {
            const wrap = document.getElementById('nudge-templates');
            if (!wrap) return;
            const kind = (nudgeDraft && nudgeDraft.kind) || 'debt';
            const templates = [nudgeDefaultMessage(kind), ...readNudgeTemplates(kind)];
            wrap.innerHTML = templates.map((t, i) => `
                <button class="nudge-template-btn filter-pill" data-index="${i}" title="${escapeHtml(t)}">
                    ${escapeHtml(i === 0 ? 'Klasyczna' : t.slice(0, 24) + (t.length > 24 ? '…' : ''))}
                </button>`).join('');
            wrap.querySelectorAll('.nudge-template-btn').forEach((btn) => {
                btn.onclick = () => {
                    document.getElementById('nudge-message').value = templates[Number(btn.dataset.index)];
                };
            });
        };

        // Kompozytor przyjmuje JEDNĄ OSOBĘ ALBO LISTĘ (od 2026-08-17).
        //
        // Powód listy: Bilans pokazywał wcześniej jeden przycisk „Przypomnij: <największy
        // dłużnik>", który nigdy się nie zmieniał. Przy jedenastu dłużnikach dawało się
        // dosięgnąć dokładnie jednego z nich, a po wysłaniu nic na ekranie nie drgało, więc
        // nie było nawet wiadomo, czy poszło. Kto dobija się o zwrot przy piętnastu osobach,
        // potrzebuje jednego ruchu na wszystkich, a nie piętnastu okien po kolei.
        //
        // Treść jest WSPÓLNA dla całej listy — świadomie. Osobna wiadomość do każdego brzmi
        // ładniej, ale w praktyce to piętnaście formularzy do wypełnienia, więc nikt by tego
        // nie użył. Szablony działają bez zmian.
        //
        // OD 2026-08-26 KOMPOZYTOR OBSŁUGUJE DWA RODZAJE PROŚB. Prośba o uzupełnienie pozycji
        // szła wcześniej jednym stuknięciem, bez okna — czyli ten sam ruch, co przypomnienie
        // o pieniądzach, wyglądał na dwa różne mechanizmy i nie dawało się dopisać ani słowa.
        // Teraz obie drogi mają ten sam arkusz, te same szablony i to samo potwierdzenie przy
        // wysyłce do kilkunastu osób.
        const openNudgeCompose = (adresaci, amountGlubCurrency, currency, opcje = {}) => {
            const my = myMemberNow();
            if (!my) { showToast('Najpierw dołącz do grupy.', true); return; }
            // Adresat może NIEŚĆ WŁASNY RACHUNEK. Przy przypomnieniu z karty rachunku
            // wszyscy dotyczą tego samego, ale przypomnienie zbiorcze z Bilansu obejmuje
            // kilka rachunków naraz — a odnośnik w powiadomieniu ma prowadzić tam, gdzie
            // TA osoba ma coś do zrobienia, nie tam, gdzie ma ktoś inny.
            const lista = (Array.isArray(adresaci)
                ? adresaci.map((a) => ({
                    toId: a.toId,
                    amountG: Number(a.amountG) || 0,
                    billId: a.billId || null,
                    billName: a.billName || '',
                }))
                : [{ toId: adresaci, amountG: Number(amountGlubCurrency) || 0, billId: null, billName: '' }]
            ).filter((a) => a.toId && a.toId !== my.id);
            if (lista.length === 0) return;
            const waluta = (Array.isArray(adresaci) ? amountGlubCurrency : currency) || 'PLN';
            const kind = opcje.kind === 'fill' ? 'fill' : 'debt';
            nudgeDraft = {
                lista, currency: waluta, kind,
                billId: opcje.billId || null,
                billName: opcje.billName || '',
            };

            const tytul = document.querySelector('#nudge-compose-modal .sheet-title');
            if (tytul) tytul.textContent = kind === 'fill' ? 'Przypomnij o uzupełnieniu' : 'Przypomnij o zwrocie';
            const podpowiedz = document.getElementById('nudge-message-hint');
            if (podpowiedz) {
                podpowiedz.textContent = kind === 'fill'
                    ? 'Zobaczy ją tylko adresat. Powiadomienie prowadzi prosto do tego rachunku, więc nie musisz tłumaczyć, gdzie kliknąć.'
                    : 'Zobaczy ją tylko adresat. Kwota jedzie osobno, więc w treści nie musisz jej powtarzać.';
            }

            const nameEl = document.getElementById('nudge-compose-name');
            const avatarEl = document.getElementById('nudge-compose-avatar');
            const amountEl = document.getElementById('nudge-compose-amount');
            const razemG = lista.reduce((s, a) => s + a.amountG, 0);
            // Przy prośbie o uzupełnienie kwota nie ma sensu — nikt nikomu nic nie jest winien.
            // W to miejsce idzie nazwa rachunku, bo to ona mówi, o co chodzi.
            const jedenRachunek = nudgeDraft.billName || (lista.length === 1 ? lista[0].billName : '');
            const ileRachunkowWLiscie = new Set(lista.map((a) => a.billId).filter(Boolean)).size;
            const podpis = kind === 'fill'
                ? (jedenRachunek
                    ? `rachunek „${jedenRachunek}"`
                    : (ileRachunkowWLiscie > 1
                        ? `${ileRachunkowWLiscie} ${plural(ileRachunkowWLiscie, 'rachunek', 'rachunki', 'rachunków')}`
                        : 'Twoje rachunki'))
                : (razemG > 0 ? `zaległość ${fmtMoney(razemG, waluta)}` : '');
            if (lista.length === 1) {
                nameEl.textContent = memberName(lista[0].toId);
                avatarEl.innerHTML = avatarHtml(memberName(lista[0].toId), lista[0].toId, 'w-12 h-12 text-lg');
                amountEl.textContent = podpis;
            } else if (kind === 'fill') {
                nameEl.textContent = `${lista.length} ${plural(lista.length, 'osoby', 'osób', 'osób')}`;
                const widoczne = lista.slice(0, 5);
                avatarEl.innerHTML = `<span class="flex -space-x-2">${
                    widoczne.map((a) => avatarHtml(memberName(a.toId), a.toId, 'w-9 h-9 text-sm')).join('')
                }${lista.length > widoczne.length ? `<span class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-surface-2 text-ink-2">+${lista.length - widoczne.length}</span>` : ''}</span>`;
                amountEl.textContent = podpis;
            } else {
                nameEl.textContent = `${lista.length} ${plural(lista.length, 'osoby', 'osób', 'osób')}`;
                // Stos twarzy zamiast jednej: od razu widać, do kogo to leci. Pięć mieści się
                // bez ścisku na najwęższym telefonie, reszta idzie licznikiem — tak samo jak
                // przy pozycjach paragonu.
                const widoczne = lista.slice(0, 5);
                avatarEl.innerHTML = `<span class="flex -space-x-2">${
                    widoczne.map((a) => avatarHtml(memberName(a.toId), a.toId, 'w-9 h-9 text-sm')).join('')
                }${lista.length > widoczne.length ? `<span class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-surface-2 text-ink-2">+${lista.length - widoczne.length}</span>` : ''}</span>`;
                amountEl.textContent = razemG > 0 ? `razem ${fmtMoney(razemG, waluta)}` : '';
            }
            document.getElementById('nudge-message').value = nudgeDefaultMessage(kind);
            renderNudgeTemplates();
            document.getElementById('nudge-compose-modal').classList.add('active');
        };

        // Zwraca `true`, gdy przypomnienie faktycznie poszło. Przy wysyłce do całej listy
        // bramka czasowa wycina część adresatów, a raport („poszło do 9 z 11") ma mówić
        // prawdę — bez tej wartości licznik byłby zgadywaniem.
        // `cicho` wyłącza pojedyncze powiadomienia w rogu: przy jedenastu osobach byłoby
        // ich jedenaście, jedno na drugim.
        const sendNudge = async (toId, amountG, currency, message = DEFAULT_NUDGE_MESSAGE, { cicho = false, kind = 'debt', billId = null, billName = '' } = {}) => {
            const my = myMemberNow();
            if (!my) { if (!cicho) showToast('Najpierw dołącz do grupy.', true); return false; }
            if (!toId || toId === my.id) return false;
            const withMs = latestNudges.map(x => ({
                from: x.from, to: x.to,
                createdAtMs: (x.createdAt && x.createdAt.toMillis) ? x.createdAt.toMillis() : undefined,
            }));
            // Bramka anty-spamowa, nie kaganiec. Decyzja właściciela 2026-08-05: sześć
            // godzin było za ostre — dobijanie się o zwrot pieniędzy bywa zabawne i jest
            // sprawą dwóch osób. Blokujemy wyłącznie wciśnięcie przycisku w kółko,
            // czyli przypadkowe albo złośliwe walenie co sekundę.
            if (hasRecentNudge(withMs, my.id, toId, Date.now(), NUDGE_GATE_MS)) {
                if (!cicho) showToast('Chwila, przypomnienie właśnie poszło.');
                return false;
            }
            await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`), {
                from: my.id,
                to: toId,
                amountG: Number(amountG) || 0,
                currency: currency || 'PLN',
                // Treść pokazujemy WYŁĄCZNIE adresatowi. Interfejs nikomu innemu jej nie
                // wyświetla; reguły Firestore nie potrafią ukryć pojedynczego pola przed
                // resztą grupy, więc to jest zasada produktu, a nie gwarancja techniczna
                // — i tak jest opisana w dokumentacji.
                message: String(message || '').trim().slice(0, 240) || DEFAULT_NUDGE_MESSAGE,
                // RODZAJ PRZYPOMNIENIA. Do 2026-08-26 istniał tylko jeden („oddaj pieniądze"),
                // więc pola nie było. Teraz są trzy i różnią się tym, CZEGO oczekują:
                //   'debt'   — oddaj pieniądze (windykator),
                //   'fill'   — stuknij swoje pozycje, rachunek czeka na zamknięcie,
                //   'reopen' — otwórz rachunek z powrotem, przypisano mi cudzą resztę.
                // Bez tego pola skrzynka i push mówiłyby „przypomina o zaległości" komuś,
                // kto nie jest nic winien.
                kind,
                billId,
                billName: String(billName || '').slice(0, 120),
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                readBy: [],
            });
            if (!cicho) showToast('Wysłano przypomnienie.');
            return true;
        };

        const nudgeRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`, id);

        // Inbox dłużnika: przypomnienia skierowane do mnie, z deep-linkiem „Ureguluj".
        // SKRZYNKA — dwa segmenty. „Dla Ciebie" to sprawy czekające na mój ruch,
        // „Wszystko" to rejestr, z którego nic nie zapala sygnału.
        let inboxMode = 'you';

        const inboxRowHtml = ({ icon, tone, title, subtitle, actionsHtml }) => `
            <div class="card p-3">
                <div class="flex items-start gap-3">
                    <span class="inbox-icon ${tone}"><i class="fas ${icon}"></i></span>
                    <div class="min-w-0 flex-grow">
                        <p class="text-sm font-semibold">${title}</p>
                        ${subtitle ? `<p class="text-xs text-ink-3 mt-0.5">${subtitle}</p>` : ''}
                    </div>
                </div>
                ${actionsHtml ? `<div class="flex items-center gap-2 mt-2.5">${actionsHtml}</div>` : ''}
            </div>`;

        // KAŻDA SPRAWA MA JEDEN DOM (decyzja właściciela 2026-08-26).
        //
        // Skrzynka i sekcja „Czeka na Ciebie" na Bilansie pokazywały DOKŁADNIE TO SAMO,
        // więc jedna z nich była zawsze zbędna — a powtórzony sygnał uczy przewijać oba.
        // Podział nie idzie po poziomach progu, tylko po pytaniu, na które dana rzecz
        // odpowiada:
        //
        //   SKRZYNKA  — sprawy od LUDZI. Przypomnienie ma cykl życia (nieprzeczytane,
        //               przeczytane, ureguluj), a miejsce, w którym ten cykl ma sens,
        //               jest jedno. Nic się nie chowa: liczba na dzwonku wisi na każdym
        //               ekranie, więc sprawa jest zawsze jedno stuknięcie stąd.
        //   BILANS    — rzeczy, które RUSZAJĄ SALDO. Cudza wpłata czekająca na moje
        //               potwierdzenie nie jest wiadomością, tylko stanem pieniędzy:
        //               dopóki jej nie potwierdzę, wielka liczba wyżej kłamie.
        //   RACHUNKI  — rachunki czekające na mój ruch. Tam stoi chip, filtr i kropka.
        const INBOX_SALDO_KINDS = ['confirm-payment', 'payment-confirmed'];

        const renderInboxForYou = (container, items = currentInbox()) => {
            if (items.length === 0) {
                // Stan pusty skrzynki ma być SPOKOJNY, bez zachęty do działania:
                // brak spraw jest tu dobrą wiadomością, a nie pustą półką do zapełnienia.
                container.innerHTML = `<p class="text-ink-3 text-sm py-6 text-center">Nic nie czeka na Twój ruch.</p>`;
                return;
            }
            // ILE NAPRAWDĘ WISI — LICZONE NA ŻYWO Z KSIĘGI (audyt 2026-08-27).
            //
            // Przypomnienie zapisuje kwotę w chwili wysyłki i nosi ją już zawsze, jak liczba
            // napisana długopisem na karteczce. Wiersz w skrzynce NIE ZNIKA po spłaceniu długu
            // — gaśnie dopiero po ręcznym „Oznacz przeczytane" — a pod spodem stał żywy
            // przycisk „Ureguluj" z tą starą liczbą i podpis „Już zapłaciłeś? Zapisz wpłatę".
            // Czyli: oddajesz 120 zł, po tygodniu robisz porządek w skrzynce, stukasz — i
            // zapisujesz DRUGĄ wpłatę 120 zł. Wpłaty niepotwierdzone liczą się do salda tak
            // samo jak potwierdzone, więc w tej samej sekundzie Bilans mówi, że to PŁATNIK
            // jest winien 120 zł temu, kto mu właśnie oddał pieniądze.
            //
            // Teraz karteczka nie ma własnej liczby: przy każdym otwarciu skrzynki pytamy
            // księgę, ile jeszcze zostało tej konkretnej osobie w tej walucie.
            const mojeDlugiG = new Map();
            myLedgerRows().rows.forEach((r) => {
                if (r.dir === 'owe') mojeDlugiG.set(`${r.other}|${r.currency}`, r.amountG);
            });
            container.innerHTML = items.map((x) => {
                const amount = x.amountG ? fmtMoney(Number(x.amountG), x.currency || 'PLN') : '';
                if (x.kind === 'nudge') {
                    // Treść od człowieka idzie jako CYTAT, oddzielona od zdania aplikacji:
                    // ma być jasne, kto to napisał, zwłaszcza gdy ktoś żartuje.
                    const quoted = x.message
                        ? `<span class="block mt-1 text-ink-2 italic">„${escapeHtml(x.message)}"</span>`
                        : '';
                    const rachunekHtml = x.billName ? ` na rachunku <b>${escapeHtml(x.billName)}</b>` : '';
                    // PROŚBA O UZUPEŁNIENIE. Przycisk prowadzi WPROST do pozycji, bo o to
                    // dokładnie chodzi — a nie do listy rachunków, z której trzeba szukać.
                    if (x.nudgeKind === 'fill') {
                        return inboxRowHtml({
                            icon: 'fa-hand-pointer', tone: 'is-info',
                            title: `<b>${escapeHtml(memberName(x.from))}</b> czeka, aż stukniesz swoje pozycje${rachunekHtml}.${quoted}`,
                            subtitle: 'Rachunek nie da się rozliczyć, dopóki coś na nim wisi bez właściciela.',
                            actionsHtml: `${x.billId ? `<button class="nudge-open-bill-btn btn btn-dark" data-bill="${escapeHtml(x.billId)}">Otwórz rachunek</button>` : ''}
                                <button class="nudge-read-btn btn btn-quiet" data-id="${escapeHtml(x.id)}">Oznacz przeczytane</button>`,
                        });
                    }
                    // „TO NIE MOJE" — prośba o otwarcie rachunku z powrotem. Trafia do tego,
                    // kto zamykał, i daje mu decyzję na miejscu: otworzyć albo zostawić.
                    // Aplikacja nie rozsądza sporu — pokazuje obie drogi i się wycofuje.
                    if (x.nudgeKind === 'reopen') {
                        return inboxRowHtml({
                            icon: 'fa-rotate-left', tone: 'is-info',
                            title: `<b>${escapeHtml(memberName(x.from))}</b> prosi o cofnięcie podziału reszty${rachunekHtml}.${quoted}`,
                            subtitle: 'Cofnięcie przeliczy kwoty — także tym, którzy już zapłacili.',
                            actionsHtml: `${x.billId ? `<button class="nudge-reopen-btn btn btn-dark" data-bill="${escapeHtml(x.billId)}" data-id="${escapeHtml(x.id)}">Cofnij podział</button>` : ''}
                                <button class="nudge-read-btn btn btn-quiet" data-id="${escapeHtml(x.id)}">Zostaw jak jest</button>`,
                        });
                    }
                    // „ODDAJ PIENIĄDZE" — jedyny rodzaj przypomnienia, który niesie kwotę.
                    // Patrz `mojeDlugiG` wyżej: liczba pochodzi z księgi, nie z karteczki.
                    const walutaNudge = x.currency || 'PLN';
                    const zostaloG = mojeDlugiG.get(`${x.from}|${walutaNudge}`) || 0;
                    if (zostaloG <= 0) {
                        // NIE MA CZYM ZAPŁACIĆ DRUGI RAZ. Wiersz zostaje (to dalej wiadomość
                        // od człowieka i to on decyduje, kiedy ją zdjąć), ale traci przycisk
                        // i czerwień — bo nie ma już żadnej czynności do wykonania.
                        return inboxRowHtml({
                            icon: 'fa-circle-check', tone: 'is-due',
                            title: `<b>${escapeHtml(memberName(x.from))}</b> przypominał/a o zaległości${amount ? ` <b>${amount}</b>` : ''}.${quoted}`,
                            subtitle: 'Nic już nie wisi — ten dług jest spłacony.',
                            actionsHtml: `<button class="nudge-read-btn btn btn-quiet" data-id="${escapeHtml(x.id)}">Oznacz przeczytane</button>`,
                        });
                    }
                    // Kwota mogła się zmienić od wysyłki (rachunek poprawiony, część spłacona).
                    // Mówimy o tym wprost: inaczej liczba w cytowanej wiadomości kłóci się
                    // z liczbą na przycisku i wygląda to na usterkę.
                    const zmianaHtml = (Number(x.amountG) > 0 && Number(x.amountG) !== zostaloG)
                        ? `<span class="block mt-1 text-xs font-normal text-ink-3">Przypomnienie mówiło o ${amount} — od tego czasu kwota się zmieniła.</span>`
                        : '';
                    return inboxRowHtml({
                        icon: 'fa-bell', tone: 'is-owe',
                        title: `<b>${escapeHtml(memberName(x.from))}</b> przypomina o zaległości <b>${fmtMoney(zostaloG, walutaNudge)}</b>.${quoted}${zmianaHtml}`,
                        subtitle: 'Już zapłaciłeś? Zapisz wpłatę, żeby dług zniknął.',
                        actionsHtml: `<button class="nudge-settle-btn btn btn-danger" data-to="${escapeHtml(x.from)}" data-amount-g="${zostaloG}" data-currency="${escapeHtml(walutaNudge)}">Ureguluj</button>
                            <button class="nudge-read-btn btn btn-quiet" data-id="${escapeHtml(x.id)}">Oznacz przeczytane</button>`,
                    });
                }
                // ZA CO — bez tego wiersz mówi tylko „Bartek zgłosił wpłatę 120,00",
                // a odbiorca ma zgadywać, które kolacje właśnie zostały zamknięte.
                // Wpłaty spoza trybu rachunkowego nie niosą tej informacji i wtedy nie
                // dokładamy nic: pusty cudzysłów byłby gorszy niż milczenie.
                const zaCo = settlementForWhat(x);
                // Przy kilku rachunkach wypisujemy je pod spodem, bo to jest właśnie ta
                // chwila, w której płatnik sprawdza, czy zgadza się z jego rachunkami.
                const nazwyRachunkow = billNamesOfSettlement(x);
                const listaRachunkow = nazwyRachunkow.length > 1
                    ? `<span class="block mt-1">${nazwyRachunkow.map((n) => `• ${escapeHtml(n)}`).join('<br>')}</span>`
                    : '';
                if (x.kind === 'confirm-payment') {
                    // DWIE ODPOWIEDZI, NIE JEDNA. Do 2026-08-29 stał tu sam „Potwierdzam",
                    // więc kto nie widział przelewu na koncie, nie miał czym tego powiedzieć
                    // — i nie robił nic, a wtedy nie działo się nic.
                    return inboxRowHtml({
                        icon: x.insisted ? 'fa-eye' : 'fa-hand-holding-dollar', tone: 'is-info',
                        title: x.insisted
                            ? `<b>${escapeHtml(memberName(x.from))}</b> podtrzymuje, że wysłał/a${amount ? ` <b>${amount}</b>` : ''}${zaCo}.${listaRachunkow}`
                            : `<b>${escapeHtml(memberName(x.from))}</b> zgłosił/a wpłatę${amount ? ` <b>${amount}</b>` : ''}${zaCo}.${listaRachunkow}`,
                        subtitle: x.insisted ? 'Poszukaj jeszcze raz na koncie.' : 'Sprawdź konto i odpowiedz.',
                        actionsHtml: `<button class="inbox-confirm-btn btn btn-primary" data-id="${escapeHtml(x.id)}"><i class="fas fa-check mr-1.5"></i>${x.insisted ? 'Jednak mam' : 'Mam'}</button>
                            <button class="inbox-nomoney-btn btn btn-ghost" data-id="${escapeHtml(x.id)}"><i class="fas fa-xmark mr-1.5"></i>${x.insisted ? 'Nadal nie widzę' : 'Nie widzę'}</button>`,
                    });
                }
                // MÓJ PRZELEW, KTÓREGO DRUGA STRONA NIE ZNALAZŁA. Dług właśnie wrócił na
                // saldo, więc bez tego wiersza pieniądze wracałyby znikąd — a to wygląda
                // na usterkę aplikacji, nie na wiadomość od człowieka.
                //
                // „Pomyłka, nie wysłałem" prowadzi PROSTO do przelewu i to nie jest wygoda,
                // tylko higiena daty: bez tego człowiek wyśle teraz i stuknie „wysłałem
                // na pewno", zostawiając w mocy stare zgłoszenie ze starą datą — a odbiorca
                // dostanie tę datę jako podpowiedź i przeszuka wyciąg wokół dnia, w którym
                // nic nie wyszło.
                if (x.kind === 'payment-disputed') {
                    return inboxRowHtml({
                        icon: 'fa-eye', tone: 'is-info',
                        title: `<b>${escapeHtml(memberName(x.from))}</b> nie znalazł/a Twojego przelewu${amount ? ` <b>${amount}</b>` : ''}${zaCo}.${listaRachunkow}`,
                        subtitle: 'Dług wrócił na saldo. Sprawdź, czy przelew wyszedł.',
                        actionsHtml: `<button class="inbox-insist-btn btn btn-dark" data-id="${escapeHtml(x.id)}">Wysłałem na pewno</button>
                            <button class="inbox-oops-btn btn btn-ghost" data-id="${escapeHtml(x.id)}">Pomyłka, nie wysłałem</button>`,
                    });
                }
                if (x.kind === 'payment-confirmed') {
                    return inboxRowHtml({
                        icon: 'fa-circle-check', tone: 'is-due',
                        title: `<b>${escapeHtml(memberName(x.from))}</b> potwierdził/a Twoją wpłatę${amount ? ` <b>${amount}</b>` : ''}${zaCo}.${listaRachunkow}`,
                        subtitle: 'Sprawa zamknięta.',
                    });
                }
                return inboxRowHtml({
                    icon: 'fa-receipt', tone: 'is-info',
                    title: `<b>${escapeHtml(x.title || 'Rachunek')}</b> czeka na Twój ruch.`,
                    subtitle: x.label || '',
                    actionsHtml: `<button class="inbox-bill-btn btn btn-quiet" data-id="${escapeHtml(x.id)}">Otwórz rachunek</button>`,
                });
            }).join('');
        };

        // Te same sprawy na Bilansie, czyli na wejściu do pokoju. Skrzynka jest dla
        // tych, którzy jej szukają — to jest dla tych, którzy po prostu weszli.
        // Sekcja znika bez śladu, gdy nic nie czeka: pusta lista „Czeka na Ciebie"
        // byłaby zaproszeniem do szukania problemu, którego nie ma.
        // BLOK „W UZUPEŁNIANIU" USUNIĘTY (decyzja właściciela 2026-08-27).
        //
        // Stał na Bilansie i w Rozliczeniach i ogłaszał, że N rachunków „czeka na zamknięcie,
        // więc jeszcze nie liczy się do salda". Powód usunięcia jest ten sam, co przy rachunku
        // z nadwyżką: to jest zdanie skierowane do kogoś, kto nic z nim nie zrobi. Zamyka
        // rachunek płatnik i to on dostaje wezwanie — reszta ekipy dostawała ogłoszenie,
        // które tylko dokładało treści do dwóch najgęstszych ekranów w aplikacji.
        // Do tego samo „czeka na zamknięcie" da się przeczytać na kilka sposobów.
        //
        // ZOSTAJE wiersz „N rachunków czeka na Twój ruch" — bo tam ruch jest MÓJ.
        // `billsOutsideLedger()` żyje dalej: pilnuje, żeby stan pusty nie ogłaszał sukcesu,
        // którego nie ma (patrz `renderSettlements` i podpis na Bilansie).

        // JEDEN BLOK NA WSZYSTKIE RACHUNKI POZA SALDEM (decyzja właściciela 2026-08-26).
        //
        // Stały tu dwa szare prostokąty jeden pod drugim — „W uzupełnianiu" i osobny kafelek
        // „N rachunków czeka na Twój ruch" — a mówiły o tej samej rzeczy: o rachunkach, które
        // jeszcze nie weszły do salda. Trzeci raz to samo szło drobnym drukiem pod planem
        // przelewów. Zamiast rosnąć, Bilans się teraz skraca.
        //
        // STYL: `block-quiet`, bo to INFORMACJA, a `card` w tym systemie znaczy PIENIĄDZE
        // („Do oddania", „Czekasz na zwrot"). Przycisk jest `btn-dark`, nie `btn-quiet` —
        // cichy ma tło `surface-2`, czyli dokładnie to samo, co blok, w którym stoi, i czyta
        // się wtedy jak wyśrodkowany tekst, a nie jak coś do naciśnięcia (ta sama pułapka
        // co przy `control-fix-total`). Żadnej czerwieni ani zieleni: te dwa kolory znaczą
        // w tej aplikacji wyłącznie kierunek pieniędzy.
        // ZADANIA MÓWIMY WYŁĄCZNIE NA BILANSIE (decyzja właściciela 2026-08-26).
        //
        // Rozliczenia mają nieść tylko to, co dotyczy przelewów i potwierdzeń. Kwota, która
        // jeszcze nie weszła do salda, ZOSTAJE tam mimo to — i to nie jest wyjątek od tej
        // reguły, tylko jej konsekwencja: bez tego zdania pokój pełen niezamkniętych
        // rachunków ogłaszałby „Wszystko rozliczone. Nikt nikomu nic nie jest winien",
        // czyli aplikacja mówiłaby nieprawdę o cudzych pieniądzach. Wołanie „stuknij swoje
        // pozycje" i przejście na listę rachunków odpadają — od tego jest Bilans.
        const billsAsideHtml = () => {
            const zadania = currentInbox().filter((x) => x.level === 2);
            if (!zadania.length) return '';

            const zadaniaHtml = `<p class="text-sm text-ink-2"><b class="text-ink">${zadania.length} ${plural(zadania.length, 'rachunek czeka', 'rachunki czekają', 'rachunków czeka')} na Twój ruch.</b></p>`;
            // Jeden rachunek — wchodzimy wprost w niego. Kilka — na listę z nałożonym filtrem,
            // bo inaczej człowiek ląduje wśród dwudziestu i sam szuka tych dwóch.
            const jedyny = zadania.length === 1 ? zadania[0].id : '';
            const etykieta = zadania.length === 1 ? 'Otwórz rachunek' : 'Pokaż rachunki';
            // BŁĘKIT STANU, TEN SAM CO NA KAFELKU RACHUNKU (`tile-action`).
            // Blok mówi „to czeka na Ciebie" — czyli dokładnie to, co kafelek na liście —
            // więc musi mieć ten sam kolor. Szary `block-quiet` znaczy w tym systemie
            // „informacja, nic do zrobienia" i na tym bloku po prostu kłamał.
            return `<div class="card tile-action p-4">
                ${zadaniaHtml}
                <button class="bills-aside-btn btn btn-dark w-full mt-3" data-bill="${escapeHtml(jedyny)}" data-tasks="${zadania.length}">${etykieta}</button>
            </div>`;
        };

        // Jedna delegacja na oba miejsca, w których stoi ten blok (Bilans i Rozliczenia).
        // Obie listy przerysowują się przy każdej zmianie, więc nasłuch wpięty w konkretny
        // przycisk ginąłby razem z nim.
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.bills-aside-btn');
            if (!btn) return;
            if (btn.dataset.bill) { joinBill(currentGroupId, btn.dataset.bill); return; }
            // Filtr ustawiamy PRZED przejściem, żeby lista otworzyła się na tym, o czym
            // mówi blok — ale tylko wtedy, gdy faktycznie jest co filtrować.
            currentBillFilter = Number(btn.dataset.tasks) > 0 ? 'waiting' : 'all';
            showDeckView('view-bills');
            renderBillsList();
        });

        // KTO NIE STUKNĄŁ SWOJEGO NA MOICH RACHUNKACH — CAŁA GRUPA NARAZ.
        //
        // Na karcie rachunku „Przypomnij" istnieje od dawna, ale działa w obrębie JEDNEGO
        // rachunku. Kto wyłożył pieniądze za trzy kolacje, musiał wejść w każdą z osobna
        // i wysłać trzy razy — a spóźnialscy się powtarzają, więc ta sama osoba dostawała
        // trzy powiadomienia pod rząd. Właściciel poprosił o jedno miejsce, z którego leci
        // to do wszystkich (2026-08-29).
        //
        // „Moje rachunki" znaczy TE, NA KTÓRYCH JA WYŁOŻYŁEM PIENIĄDZE. To jedyna definicja,
        // która daje prawo poganiać: czekam na swoje. Rachunek cudzy, nawet założony przeze
        // mnie, poganiania nie uzasadnia — od tego jest jego płatnik.
        //
        // JEDNA OSOBA DOSTAJE JEDNO PRZYPOMNIENIE, nawet gdy zalega na czterech rachunkach.
        // Gdy zalega na jednym, przypomnienie niesie odnośnik prosto do niego; przy kilku
        // odnośnika nie ma, bo nie da się wskazać jednego miejsca, które załatwia sprawę.
        const czekajaNaUzupelnienie = () => {
            const my = myMemberNow();
            if (!my) return [];
            const moje = latestBills
                .map(({ id, data }) => ({ ...data, id }))
                .filter((b) => b.payerId === my.id
                    && toGrosze(b.totalAmount || 0) > 0
                    && !billSettleGate(b).open);
            const mapa = new Map();
            moje.forEach((b) => {
                Object.values(b.participants || {})
                    .filter((p) => p.status !== PARTICIPANT_OUT && p.id !== my.id && !participantReady(b, p.id))
                    .forEach((p) => {
                        const wpis = mapa.get(p.id) || { toId: p.id, amountG: 0, rachunki: [] };
                        wpis.rachunki.push({ id: b.id, name: b.billName || '' });
                        mapa.set(p.id, wpis);
                    });
            });
            return [...mapa.values()];
        };

        const remindFillAllHtml = () => {
            const ludzie = czekajaNaUzupelnienie();
            if (!ludzie.length) return '';
            const n = ludzie.length;
            const twarze = ludzie.slice(0, 5);
            // BLOK JEST CICHY (`block-quiet`), NIE KARTĄ. `card` znaczy w tym systemie
            // PIENIĄDZE („Do oddania", „Czekasz na zwrot"), a tu nikt nikomu jeszcze nic
            // nie jest winien — te rachunki nie weszły nawet do salda. Przycisk jest ciemny,
            // bo budzi do dwudziestu pięciu cudzych telefonów: limonka znaczy „domykam
            // sprawę, którą ktoś mi postawił", a tę zaczynam sam.
            return `<div class="block-quiet p-4">
                <div class="flex items-center gap-3">
                    <span class="flex -space-x-2 flex-shrink-0">${twarze
                        .map((a) => avatarHtml(memberName(a.toId), a.toId, 'w-8 h-8 text-xs'))
                        .join('')}${n > twarze.length ? `<span class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-surface text-ink-2">+${n - twarze.length}</span>` : ''}</span>
                    <span class="text-sm text-ink-2 min-w-0"><b class="text-ink">${n === 1 ? '1 osoba nie stuknęła' : `${n} ${plural(n, 'osoba nie stuknęła', 'osoby nie stuknęły', 'osób nie stuknęło')}`} swoich pozycji</b> na Twoich rachunkach.</span>
                </div>
                <button id="remind-fill-all-btn" class="btn btn-dark w-full mt-3"><i class="fas fa-bell mr-1.5"></i>Przypomnij ${n} ${plural(n, 'osobie', 'osobom', 'osobom')}</button>
            </div>`;
        };

        const renderBalanceFilling = () => {
            const wrap = document.getElementById('balance-filling');
            if (!wrap) return;
            const przypomnij = remindFillAllHtml();
            const html = [billsAsideHtml(), przypomnij ? `<div class="mt-2">${przypomnij}</div>` : ''].filter(Boolean).join('');
            wrap.innerHTML = html;
            wrap.classList.toggle('hidden', !html);
            const btn = document.getElementById('remind-fill-all-btn');
            if (btn) btn.onclick = () => {
                const ludzie = czekajaNaUzupelnienie();
                if (!ludzie.length) { showToast('Wszyscy już coś stuknęli.'); return; }
                // Waluta jest tu bez znaczenia (kwota to zero — prosimy o ruch, nie o pieniądze),
                // ale kompozytor jej wymaga, więc bierzemy domyślną walutę pokoju.
                openNudgeCompose(
                    ludzie.map((a) => ({
                        toId: a.toId,
                        amountG: 0,
                        billId: a.rachunki.length === 1 ? a.rachunki[0].id : null,
                        billName: a.rachunki.length === 1 ? a.rachunki[0].name : '',
                    })),
                    (groupData && groupData.defaultCurrency) || 'PLN',
                    null,
                    { kind: 'fill' },
                );
            };
        };

        // BILANS JEST DROGOWSKAZEM, NIE DRUGĄ SKRZYNKĄ (decyzja właściciela 2026-08-29).
        //
        // Do tej pory renderował PEŁNE kafelki spraw — te same, co skrzynka pod dzwonkiem.
        // Powtórzony sygnał uczy przewijać oba, a ekran wejściowy do pokoju robił się listą
        // zadań zamiast odpowiedzi na pytanie „ile mam".
        //
        // Zostają DWA WIERSZE, każdy z własnym tonem, bo odpowiadają na różne pytania:
        // limonka tam, gdzie jest mój ruch, szarość tam, gdzie sprawa stoi. Obsługa mieszka
        // w Rozliczeniach — przycisk prowadzi prosto na właściwą stronę.
        const renderBalanceWaiting = () => {
            const wrap = document.getElementById('balance-waiting');
            const list = document.getElementById('balance-waiting-list');
            if (!wrap || !list) return;
            const my = myMemberNow();
            const myId = my ? my.id : null;

            const doPotwierdzenia = settlementsAwaitingMe(myId);
            const spory = [...disputesAsPayee(myId), ...disputesAsDebtor(myId)];
            wrap.classList.toggle('hidden', doPotwierdzenia.length === 0 && spory.length === 0);
            if (!doPotwierdzenia.length && !spory.length) { list.innerHTML = ''; return; }

            const suma = (lista) => {
                const waluty = new Set(lista.map(settlementCurrency));
                if (waluty.size !== 1) return '';
                return fmtMoney(lista.reduce((n, x) => n + settlementAmountG(x), 0), [...waluty][0]);
            };
            const wiersz = ({ ikona, ton, tytul, podpis, przycisk, klasa, strona, etykieta }) => `
                <div class="card p-3.5 ${klasa}">
                    <div class="flex items-center gap-3">
                        <span class="inbox-icon ${ton}"><i class="fas ${ikona}"></i></span>
                        <span class="min-w-0 flex-grow">
                            <span class="block text-sm font-semibold">${tytul}</span>
                            ${podpis ? `<span class="block text-xs text-ink-3 mt-0.5">${escapeHtml(podpis)}</span>` : ''}
                        </span>
                        <button class="balance-go-btn btn ${przycisk} flex-shrink-0" data-side="${strona}">${etykieta}</button>
                    </div>
                </div>`;

            let html = '';
            if (doPotwierdzenia.length) {
                const n = doPotwierdzenia.length;
                html += wiersz({
                    ikona: 'fa-circle-question', ton: 'is-info', klasa: '', strona: 'due',
                    tytul: `<b>${n} ${plural(n, 'przelew', 'przelewy', 'przelewów')}</b> ${n === 1 ? 'czeka' : 'czekają'} na Twoje potwierdzenie`,
                    podpis: suma(doPotwierdzenia) ? `Razem ${suma(doPotwierdzenia)}` : '',
                    przycisk: 'btn-primary', etykieta: 'Sprawdź',
                });
            }
            if (spory.length) {
                const n = spory.length;
                html += wiersz({
                    ikona: 'fa-eye', ton: 'is-info', klasa: 'card-flagged mt-2', strona: 'due',
                    tytul: `<b>${n} ${plural(n, 'przelew', 'przelewy', 'przelewów')}</b> do wyjaśnienia`,
                    podpis: suma(spory) || '',
                    przycisk: 'btn-quiet', etykieta: 'Zobacz',
                });
            }
            list.innerHTML = html;
        };


        // Rząd twarzy całej ekipy pod nominałem został usunięty 2026-08-15 na wniosek
        // właściciela. Powód jest prosty i wart zapisania, żeby nie wrócił: rząd
        // odpowiadał na pytanie „kto jest w pokoju", którego na Bilansie nikt nie zadaje,
        // a zabierał wysokość pierwszego ekranu tuż pod kwotą, po którą ludzie tu wchodzą.
        // Skład grupy mieszka w ustawieniach pokoju i jest tam pełniejszy: widać, kto ma
        // sposób płatności, a kto jeszcze nie zajął swojego imienia.

        // „Wszystko" — rejestr zdarzeń, które da się odtworzyć z danych, jakie już mamy:
        // przypomnienia i wpłaty. Pełna Aktywność (kto co odkliknął, edycje pozycji)
        // wymaga osobnej kolekcji zdarzeń i jest rozpisana w §10.2 jako oddzielna partia.
        const renderInboxAll = (container) => {
            const ms = (t) => (t && t.toMillis) ? t.toMillis() : 0;
            const events = [
                ...latestNudges.map((n) => {
                    // Rejestr musi nazywać rzecz po imieniu: od 2026-08-26 przypomnienie
                    // bywa prośbą o stuknięcie pozycji albo o otwarcie rachunku, a nie
                    // o pieniądze. Jedno zdanie dla trzech różnych spraw kłamałoby o dwóch.
                    const odHtml = `<b>${escapeHtml(memberName(n.from))}</b>`;
                    const doHtml = `<b>${escapeHtml(memberName(n.to))}</b>`;
                    const rachunekHtml = n.billName ? ` (${escapeHtml(n.billName)})` : '';
                    if (n.kind === 'fill') {
                        return { at: ms(n.createdAt), icon: 'fa-hand-pointer', tone: 'is-info',
                            title: `${odHtml} poprosił/a ${doHtml} o stuknięcie swoich pozycji${rachunekHtml}.` };
                    }
                    if (n.kind === 'reopen') {
                        return { at: ms(n.createdAt), icon: 'fa-rotate-left', tone: 'is-info',
                            title: `${odHtml} poprosił/a ${doHtml} o cofnięcie podziału reszty${rachunekHtml}.` };
                    }
                    return { at: ms(n.createdAt), icon: 'fa-bell', tone: 'is-owe',
                        title: `${odHtml} przypomniał/a ${doHtml} o zaległości${n.amountG ? ` ${fmtMoney(Number(n.amountG), n.currency || 'PLN')}` : ''}.` };
                }),
                ...latestSettlements.map((s) => ({
                    at: ms(s.confirmedAt) || ms(s.createdAt),
                    icon: s.confirmed ? 'fa-circle-check' : 'fa-clock',
                    tone: s.confirmed ? 'is-due' : 'is-info',
                    // `toGrosze(s.amount)`, NIE `s.amountG` (poprawione 2026-08-26). Wpłata
                    // zapisuje kwotę w złotych, w polu `amount` — pola `amountG` nie ma na
                    // niej nigdy, więc dziennik aktywności pokazywał przy KAŻDEJ wpłacie
                    // „0,00". Przypomnienia mają `amountG` i stąd wzięła się ta pomyłka:
                    // dwa sąsiednie wiersze, dwa różne kształty danych.
                    title: `<b>${escapeHtml(memberName(s.from))}</b> → <b>${escapeHtml(memberName(s.to))}</b>: ${fmtMoney(toGrosze(s.amount || 0), s.currency || 'PLN')}${
                        settlementForWhat(s)}${s.confirmed ? ' · potwierdzone' : ' · czeka na potwierdzenie'}`,
                })),
                // Dziennik aktywności: kto zmienił kwotę, kto co odkliknął, kto dopisał
                // osobę. Zero sygnału (poziom 3), ale ślad zostaje.
                ...latestEvents.map((ev) => ({
                    at: ms(ev.createdAt), icon: 'fa-clock-rotate-left', tone: 'is-info',
                    title: `<b>${escapeHtml(ev.byName || memberName(ev.by))}</b> ${escapeHtml(ev.label || '')}`,
                })),
            ].sort((a, b) => b.at - a.at);

            if (events.length === 0) {
                container.innerHTML = `<p class="text-ink-3 text-sm py-6 text-center">Jeszcze nic się nie wydarzyło.</p>`;
                return;
            }
            container.innerHTML = events.map((e) => inboxRowHtml({
                icon: e.icon, tone: e.tone, title: e.title,
                subtitle: e.at ? new Date(e.at).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '',
            })).join('');
        };

        const renderNudges = () => {
            const container = document.getElementById('nudges-list');
            if (!container) return;
            const my = myMemberNow();
            const uid = currentUser && currentUser.uid;
            document.querySelectorAll('.inbox-mode-btn').forEach((btn) => {
                btn.setAttribute('aria-pressed', String(btn.dataset.inbox === inboxMode));
            });
            const unread = my ? unreadNudgeCount(latestNudges, my.id, uid) : 0;
            const readAllBtn = document.getElementById('nudges-readall-btn');
            if (readAllBtn) readAllBtn.classList.toggle('hidden', unread === 0 || inboxMode !== 'you');
            if (inboxMode === 'all') { renderInboxAll(container); return; }
            // Rachunki czekające na mój ruch NIE wchodzą do skrzynki — mają własny dom
            // na zakładce „Rachunki" (chip, filtr, kropka). Wchodzą za to nadal do
            // `currentInbox`, bo z nich liczy się właśnie ta kropka.
            renderInboxForYou(container, currentInbox().filter((x) => x.level === 1));
        };

        // Potwierdzenie mojej wpłaty nie ma czego „obsłużyć" — samo obejrzenie zamyka sprawę.
        // Wiersz stoi w DWÓCH miejscach (skrzynka i Bilans), więc i gaszenie musi działać
        // z obu — inaczej u kogoś, kto zagląda tylko w jedno, zostaje na zawsze.
        const markConfirmationsSeen = () => {
            const confirmations = currentInbox().filter((x) => x.kind === 'payment-confirmed').map((x) => x.id);
            if (!confirmations.length) return;
            writeSeen('confirmations', [...readSeen('confirmations'), ...confirmations]);
            updateNudgeBadge();
            renderBalanceWaiting();
        };

        const openNudgesModal = () => {
            inboxMode = 'you';
            renderNudges();
            markConfirmationsSeen();
            document.getElementById('nudges-modal').classList.add('active');
        };

        // --- Krok 4: edycja członków rachunku (dodaj/usuń uczestnika) ---
        const renderBillMembersList = () => {
            const list = document.getElementById('bill-members-list');
            if (!list || !billData || !groupData) return;
            const order = groupData.memberOrder || Object.keys(groupData.members || {});
            const participants = billData.participants || {};
            list.innerHTML = order.map(id => {
                const m = groupData.members[id];
                if (!m) return '';
                const p = participants[id];
                const inBill = p && p.status !== 'not_applicable';
                const isPayer = billData.payerId === id;
                return personRowHtml({
                    id,
                    name: m.name,
                    selected: inBill,
                    disabled: isPayer, // płatnika nie da się wypisać z własnego rachunku
                    note: isPayer ? '(płatnik)' : '',
                });
            }).join('');
            // Licznik i pasek „Wszyscy / Nikt" — ta sama pomoc, co przy tworzeniu rachunku.
            // Wisiały tam bez użytku, bo zapalał je wyłącznie licznik nowego rachunku.
            syncPersonSearchCount(list.closest('.sheet-body') || list.parentElement);
        };
        const openBillMembersModal = () => {
            if (!billData || !groupData) return;
            renderBillMembersList();
            document.getElementById('bill-members-modal').classList.add('active');
        };
        const toggleBillMember = async (id, include) => {
            if (!currentBillId) return;
            const m = (groupData.members || {})[id];
            if (!m) return;
            // Skład rachunku dzieli koszty ogólne i kwotę nierozpisaną, więc dopisanie albo
            // wypisanie jednej osoby zmienia udział KAŻDEJ POZOSTAŁEJ — i robi to nie ruszając
            // bramy, bo nic nie zawisło bez właściciela. Patrz `billFrozen`.
            if (refuseFrozen()) return;
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            if (include) {
                // Jedna wartość na „jest w rachunku". Wcześniej były trzy („incomplete",
                // „unpaid", „completed") i wszystkie znaczyły dla matmy dokładnie to samo,
                // bo `functions/calc.js` czyta wyłącznie „not_applicable".
                const activeStatus = PARTICIPANT_IN;
                // dotted updates: tworzą/aktualizują wpis bez kasowania np. individualAmount
                await updateDoc(billDocRef, {
                    [`participants.${id}.id`]: id,
                    [`participants.${id}.name`]: m.name,
                    [`participants.${id}.status`]: activeStatus,
                });
                showToast(`Dodano: ${m.name}`);
            } else {
                // czyste usunięcie z rachunku (płatnika nie da się odznaczyć — checkbox disabled)
                await updateDoc(billDocRef, { [`participants.${id}`]: deleteField() });
                showToast(`Usunięto: ${m.name}`);
            }
            logEvent({
                type: 'bill-members',
                billId: currentBillId,
                label: `${include ? 'dopisał/a' : 'wypisał/a'} ${m.name} ${include ? 'do' : 'z'} rachunku „${billData.billName}"`,
            });
        };

        // --- Krok 5: ekran „Profil" — wyłącznie tożsamość i ustawienia urządzenia ---
        // Rozpiska „ile kto wydał" NIE mieszka tutaj: profil odpowiada na pytanie
        // „kim jestem w tej grupie", a nie „ile wydała ekipa". Statystyka pokoju
        // (Twoje udziały / cała grupa) stoi w ustawieniach pokoju, przy pokoju.
        // WIERSZ OSOBY — jedyny sposób pokazywania wyboru ludzi w tej aplikacji.
        // Zdjęcie (albo znak), imię, znacznik po prawej. Używają go: skład rachunku,
        // uczestnicy nowego rachunku i „kto to wziął" przy pozycji paragonu.
        const personRowHtml = ({ id, name, selected, disabled = false, note = '' }) => `
            <button type="button" class="person-row tap" data-id="${escapeHtml(String(id))}"
                aria-pressed="${selected ? 'true' : 'false'}" ${disabled ? 'disabled' : ''}>
                ${avatarHtml(name, id)}
                <span class="flex-grow min-w-0 truncate font-medium">${escapeHtml(name)}${note ? ` <span class="text-xs text-ink-3">${escapeHtml(note)}</span>` : ''}</span>
                <span class="person-row-check" aria-hidden="true"><i class="fas fa-check"></i></span>
            </button>`;

        // Odczyt zaznaczenia z listy wierszy — jedno miejsce, żeby trzy listy nie
        // rozjechały się w sposobie pytania „kto jest zaznaczony".
        // `:not(.is-filtered)` NIE wchodzi tu celowo: ukrycie wiersza przez wyszukiwarkę
        // jest zmianą widoku, nie odznaczeniem. Gdyby filtr wypisywał ludzi z rachunku,
        // wpisanie trzech liter kasowałoby cały wcześniejszy wybór.
        const selectedPersonIds = (containerId) =>
            [...document.querySelectorAll(`#${containerId} .person-row[aria-pressed="true"]`)]
                .map((el) => el.dataset.id);

        // --- WYSZUKIWANIE OSOBY -------------------------------------------------
        // Kryterium projektowe z PRODUCT.md to grupa 12–25 osób. Przy takiej liście
        // znalezienie jednego imienia przewijaniem jest wolniejsze niż wpisanie trzech
        // liter, a przy pozycji paragonu robi się to w pośpiechu, przy stole.
        // Lupa stoi zwinięta i rozwija pole dopiero po stuknięciu: w grupie pięciu osób
        // lista mieści się na ekranie i pole byłoby tylko kolejnym rzędem do minięcia.
        //
        // Filtr NIE kasuje wierszy z DOM, tylko je ukrywa klasą `is-filtered`. Dzięki
        // temu zaznaczenie osoby, której akurat nie widać, przeżywa wpisywanie.
        const personSearchNormalize = (s) => String(s || '')
            .toLocaleLowerCase('pl-PL')
            // Ktoś szukający „lukasz" ma znaleźć „Łukasz". Rozkładamy znaki diakrytyczne
            // i zdejmujemy je; „ł" nie ma postaci rozłożonej, więc idzie osobno.
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

        const personSearchList = (wrap) => {
            const box = wrap && wrap.querySelector('.person-search');
            const id = box && box.dataset.searchFor;
            return id ? document.getElementById(id) : null;
        };

        const syncPersonSearchCount = (wrap) => {
            const box = wrap && wrap.querySelector('.person-search');
            const list = personSearchList(wrap);
            if (!box || !list) return;
            const counter = box.querySelector('.person-search-count');
            if (!counter) return;
            const picked = list.querySelectorAll('.person-row[aria-pressed="true"]').length;
            const total = list.querySelectorAll('.person-row').length;
            counter.textContent = total ? `${picked}/${total}` : '';
            syncMassPick(box, list, picked, total);
        };

        // MASOWY WYBÓR OSÓB (zgłoszenie właściciela 2026-08-18).
        // Przy ekipie dwudziestoosobowej wybranie pięciu osób znaczyło piętnaście
        // odklikiwań. Pasek dokłada dwa ruchy: „Wszyscy" i „Nikt".
        //
        // Pasek POWSTAJE Z KODU, nie ze znaczników, bo listy osób są trzy (nowy rachunek,
        // skład rachunku, kto wziął pozycję) i trzy kopie tego samego rozjechałyby się
        // przy pierwszej zmianie.
        //
        // Pojawia się dopiero od PIĘCIU osób: przy trzech dwa dodatkowe przyciski są
        // hałasem, a nie pomocą.
        const MASS_PICK_MIN = 5;
        const syncMassPick = (box, list, picked, total) => {
            let pasek = box.parentElement.querySelector('.person-mass');
            if (total < MASS_PICK_MIN) { if (pasek) pasek.remove(); return; }
            if (!pasek) {
                pasek = document.createElement('div');
                pasek.className = 'person-mass filter-pills mb-2';
                pasek.innerHTML = `
                    <button type="button" class="person-mass-btn filter-pill" data-mass="all">Wszyscy</button>
                    <button type="button" class="person-mass-btn filter-pill" data-mass="none">Nikt</button>`;
                box.insertAdjacentElement('afterend', pasek);
            }
            // Widoczne, czyli po odsianiu szukaniem — „Wszyscy" po wpisaniu „Ka" bierze
            // Kasię i Kamila, a nie całą listę. Inaczej szukanie i masowy wybór kłóciłyby się.
            const widoczne = [...list.querySelectorAll('.person-row')].filter((r) => !r.classList.contains('hidden'));
            const wybrane = widoczne.filter((r) => r.getAttribute('aria-pressed') === 'true').length;
            pasek.querySelector('[data-mass="all"]').disabled = widoczne.length === 0 || wybrane === widoczne.length;
            pasek.querySelector('[data-mass="none"]').disabled = wybrane === 0;
        };

        // Ten sam mechanizm obsługuje teraz DWIE rzeczy: listę osób i listę pozycji
        // paragonu. Wiersz, po którym filtrujemy, wskazuje `data-search-rows`, a zdanie
        // dla pustego wyniku `data-search-empty`. Osobne szukanie po pozycjach istniało
        // przez pół dnia i było błędem: dwa mechanizmy do tej samej czynności znaczą
        // dwa różne zachowania pod palcem (zgłoszenie właściciela: „powinno działać
        // tak samo jak wyszukiwanie osób").
        const applyPersonFilter = (wrap) => {
            const box = wrap && wrap.querySelector('.person-search');
            const list = personSearchList(wrap);
            if (!box || !list) return;
            const rowSel = box.dataset.searchRows || '.person-row';
            const emptyText = box.dataset.searchEmpty || 'Nikt taki nie jest w tym pokoju.';
            const needle = personSearchNormalize((box.querySelector('.person-search-input') || {}).value);
            let visible = 0;
            list.querySelectorAll(rowSel).forEach((row) => {
                const hit = !needle || personSearchNormalize(row.textContent).includes(needle);
                row.classList.toggle('hidden', !hit);
                if (hit) visible++;
            });
            // Stan pusty mówi, czego szukano — inaczej lista wygląda na zepsutą.
            let empty = list.querySelector('.person-search-empty');
            if (visible === 0 && needle) {
                if (!empty) {
                    empty = document.createElement('p');
                    empty.className = 'person-search-empty';
                    list.appendChild(empty);
                }
                empty.textContent = emptyText;
                empty.classList.remove('hidden');
            } else if (empty) {
                empty.classList.add('hidden');
            }
        };

        const resetPersonSearch = (wrap) => {
            const box = wrap && wrap.querySelector('.person-search');
            if (!box) return;
            const input = box.querySelector('.person-search-input');
            if (input) input.value = '';
            box.classList.remove('is-open');
            const toggle = box.querySelector('.person-search-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
            applyPersonFilter(wrap);
            syncPersonSearchCount(wrap);
        };

        // Jedna delegacja na cały dokument: wyszukiwarek jest kilka, a zachowanie jedno.
        const setupPersonSearch = () => {
            document.addEventListener('click', (e) => {
                const toggle = e.target.closest('.person-search-toggle');
                if (!toggle) return;
                const box = toggle.closest('.person-search');
                const willOpen = !box.classList.contains('is-open');
                box.classList.toggle('is-open', willOpen);
                toggle.setAttribute('aria-expanded', String(willOpen));
                const input = box.querySelector('.person-search-input');
                if (willOpen) { if (input) input.focus(); }
                else if (input) { input.value = ''; applyPersonFilter(box.parentElement); }
            });
            document.addEventListener('input', (e) => {
                const input = e.target.closest('.person-search-input');
                if (!input) return;
                applyPersonFilter(input.closest('.person-search').parentElement);
            });
            document.addEventListener('click', (e) => {
                const btn = e.target.closest('.person-mass-btn');
                if (!btn || btn.disabled) return;
                const wrap = btn.closest('.person-mass').parentElement;
                const list = personSearchList(wrap);
                if (!list) return;
                const chce = btn.dataset.mass === 'all';
                // Stukamy WIERSZ, zamiast przestawiać atrybut: każda z trzech list zapisuje
                // stan inaczej (jedna do bazy, inne do pamięci okna), a przejście tą samą
                // drogą co palec gwarantuje, że nic się nie rozjedzie.
                [...list.querySelectorAll('.person-row')]
                    .filter((r) => !r.classList.contains('hidden'))
                    .filter((r) => (r.getAttribute('aria-pressed') === 'true') !== chce)
                    .forEach((r) => r.click());
                syncPersonSearchCount(wrap);
            });
        };

        // SZUKANIE W ARKUSZU WYBORU (zgłoszenie właściciela 2026-08-20).
        // Przy piętnastoosobowej ekipie lista płatników jest dłuższa niż ekran, a wybór
        // jest JEDEN — czyli całą czynnością jest odnalezienie imienia. Wpisanie trzech
        // liter bije przewijanie piętnastu wierszy.
        //
        // Świadomie NIE piszemy tu drugiej wyszukiwarki: to ta sama, która obsługuje
        // uczestników i pozycje paragonu, podpięta przez `data-search-for`. Aplikacja
        // miała już raz dwa mechanizmy do jednej czynności i skończyło się dwoma różnymi
        // zachowaniami pod palcem — patrz uwaga przy `applyPersonFilter`.
        //
        // Próg ośmiu pozycji: krótsza lista mieści się na ekranie i lupa jest wtedy
        // ozdobą, a nie pomocą. Przy trzech walutach nie pojawi się nigdy, przy płatniku
        // od siedmiu osób w rachunku.
        const CHOICE_SEARCH_MIN = 8;

        // WYBÓR JEDNOKROTNY — jeden arkusz dla każdej listy (waluta, płatnik).
        // `options`: [{ value, label, hint?, avatarHtml? }].
        // `search`: { label?, placeholder?, empty? } — podpisy zależą od tego, czego
        // dotyczy lista, bo „Nikt taki nie jest w tym pokoju" przy walutach byłoby bzdurą.
        const openChoiceSheet = ({ title, options, current, onPick, search = null }) => {
            const modal = document.getElementById('choice-modal');
            const list = document.getElementById('choice-options');
            if (!modal || !list) return;
            document.getElementById('choice-title').textContent = title;
            list.innerHTML = options.map((o) => {
                const selected = String(o.value) === String(current);
                return `<button class="choice-option card tap w-full min-h-tap p-3 flex items-center gap-3 text-left" data-value="${escapeHtml(String(o.value))}" aria-pressed="${selected}">
                    ${o.avatarHtml || ''}
                    <span class="flex-grow min-w-0">
                        <span class="block font-semibold truncate">${escapeHtml(o.label)}</span>
                        ${o.hint ? `<span class="block text-sm text-ink-3 truncate">${escapeHtml(o.hint)}</span>` : ''}
                    </span>
                    <i class="fas fa-check text-ink flex-shrink-0 ${selected ? '' : 'hidden'}"></i>
                </button>`;
            }).join('');
            list.querySelectorAll('.choice-option').forEach((btn) => {
                btn.onclick = async () => {
                    modal.classList.remove('active');
                    if (btn.dataset.value !== String(current)) await onPick(btn.dataset.value);
                };
            });

            const szukajka = document.getElementById('choice-search');
            if (szukajka) {
                szukajka.classList.toggle('hidden', options.length < CHOICE_SEARCH_MIN);
                const podpis = (search && search.label) || 'Szukaj';
                const przycisk = szukajka.querySelector('.person-search-toggle');
                const pole = szukajka.querySelector('.person-search-input');
                if (przycisk) { przycisk.setAttribute('aria-label', podpis); przycisk.title = podpis; }
                if (pole) { pole.placeholder = (search && search.placeholder) || podpis; pole.setAttribute('aria-label', podpis); }
                szukajka.dataset.searchEmpty = (search && search.empty) || 'Nic takiego tu nie ma.';
                // Arkusz otwiera się ZAWSZE ze zwiniętą lupą i pustym polem. Zapytanie
                // zapamiętane z poprzedniego otwarcia ukrywałoby część listy, nie mówiąc
                // dlaczego — a przy wyborze płatnika znaczyłoby to brakujące imię.
                resetPersonSearch(szukajka.parentElement);
            }

            modal.classList.add('active');
        };

        // Arkusz „Twój status" (`openStatusSheet`) został usunięty 2026-08-15 razem
        // z ręcznym wyborem statusu. Historia w komentarzu przy `billSplitMode`.

        // --- DZIENNIK AKTYWNOŚCI ----------------------------------------------------
        // Przy grupie 12–25 osób ślad „kto zmienił kwotę" jest mechanizmem zaufania,
        // nie ozdobą: bez niego jedyną odpowiedzią na „kto to zrobił?" jest cudza pamięć.
        //
        // Etykieta powstaje W CHWILI ZAPISU i jest gotowym zdaniem. Dzięki temu odczyt
        // dziennika nie wymaga rachunku, którego już może nie być — a wpis o usuniętym
        // rachunku dalej się czyta.
        //
        // Zapis jest „najlepszym staraniem": jeśli się nie uda, akcja użytkownika i tak
        // się wykonała i nie ma powodu jej przerywać komunikatem o dzienniku.
        const logEvent = async ({ type, label, billId = null }) => {
            const me = myMemberNow();
            if (!me || !currentGroupId) return;
            try {
                await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/events`), {
                    type,
                    label,
                    billId,
                    by: me.id,
                    byName: me.name,
                    createdBy: currentUser.uid,
                    createdAt: serverTimestamp(),
                });
            } catch (e) {
                console.warn('[Billiada] Nie udało się dopisać zdarzenia:', e);
            }
        };

        // Zdarzenie w formie zdania: kto, co, kiedy. Etykieta jest już gotowa (powstała
        // przy zapisie), więc tutaj dokładamy tylko autora i czas.
        const eventRowHtml = (ev) => {
            const when = (ev.createdAt && ev.createdAt.toDate)
                ? ev.createdAt.toDate().toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
                : '';
            return `<div class="card p-3 flex items-start gap-3">
                ${avatarHtml(ev.byName || memberName(ev.by), ev.by, 'w-8 h-8 text-xs')}
                <span class="min-w-0 flex-grow">
                    <span class="block text-sm"><b>${escapeHtml(ev.byName || memberName(ev.by))}</b> ${escapeHtml(ev.label || '')}</span>
                    ${when ? `<span class="block text-xs text-ink-3 mt-0.5">${escapeHtml(when)}</span>` : ''}
                </span>
            </div>`;
        };

        // Historia JEDNEGO rachunku — na ekranie tego rachunku, bo tam jest jej kontekst.
        const renderBillHistory = () => {
            const wrap = document.getElementById('bill-history-details');
            const list = document.getElementById('bill-history-list');
            const label = document.getElementById('bill-history-label');
            if (!wrap || !list) return;
            if (!currentBillId) { wrap.classList.add('hidden'); return; }
            const events = latestEvents.filter((e) => e.billId === currentBillId);
            wrap.classList.toggle('hidden', events.length === 0);
            if (events.length === 0) { list.innerHTML = ''; return; }
            if (label) label.textContent = `Historia zmian · ${events.length} ${plural(events.length, 'wpis', 'wpisy', 'wpisów')}`;
            list.innerHTML = events.map(eventRowHtml).join('');
        };

        // Który rachunek już zapytał mnie o to, czy jestem płatnikiem. Zerowane przy
        // wejściu na rachunek, żeby pytanie padło raz na wizytę, a nie raz na render.
        let payerClaimAskedFor = null;

        const openPayerClaim = () => {
            const modal = document.getElementById('payer-claim-modal');
            if (!modal || !billData) return;
            const body = document.getElementById('payer-claim-body');
            if (body) {
                body.textContent = `Ktoś wskazał Ciebie jako osobę, która wyłożyła pieniądze za rachunek „${billData.billName}".`;
            }
            const billId = currentBillId;
            const billRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, billId);

            document.getElementById('payer-claim-yes').onclick = async () => {
                modal.classList.remove('active');
                await updateDoc(billRef, { payerConfirmed: true });
                showToast('Potwierdzone. Ekipa widzi już, ile Ci oddać.');
                logEvent({ type: 'bill-payer-confirm', billId, label: `potwierdził/a, że zapłacił/a za rachunek „${billData.billName}"` });
            };

            // „Nie ja" jest pełnoprawną odpowiedzią i czyści wskazanie, zamiast tylko
            // zamykać okno. Inaczej ktoś błędnie wskazany zostawałby z pytaniem, które
            // wraca przy każdym wejściu, i bez sposobu, żeby to naprostować.
            document.getElementById('payer-claim-no').onclick = async () => {
                modal.classList.remove('active');
                await updateDoc(billRef, { payerId: null, payerConfirmed: false });
                showToast('Wskazanie płatnika wyczyszczone.');
                logEvent({ type: 'bill-payer', billId, label: `zaprzeczył/a, że zapłacił/a za rachunek „${billData.billName}"` });
            };

            modal.classList.add('active');
        };

        // POTWIERDZENIE DECYZJI NIEODWRACALNEJ — jedno okno dla całej aplikacji.
        // Osobne okno na każdą taką decyzję kończyło się trzema wyglądami tego samego
        // pytania i trzema różnymi drogami wyjścia.
        //
        // `tone` rozstrzyga KOLOR przycisku potwierdzenia i nie jest ozdobą. Czerwień
        // długu ma w tej aplikacji jedno znaczenie: „stąd nie ma powrotu" (DESIGN.md,
        // reguła rozdziału kolorów). Okno pytające, czy to Ty wyłożyłeś pieniądze, nic
        // nie kasuje — czerwony przycisk mówiłby wtedy nieprawdę i po kilku takich
        // oknach czerwień przestałaby cokolwiek znaczyć. Dlatego domyślnie 'danger'
        // (bo większość tych okien naprawdę kasuje), a decyzje odwracalne proszą o 'brand'.
        const openConfirm = ({ title, body, confirmLabel = 'Potwierdzam', tone = 'danger', onConfirm }) => {
            const modal = document.getElementById('confirm-modal');
            if (!modal) return;
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-body').textContent = body;
            const ok = document.getElementById('confirm-ok-btn');
            const cancel = document.getElementById('confirm-cancel-btn');
            ok.className = tone === 'brand' ? 'btn btn-primary flex-1' : 'btn btn-danger flex-1';
            ok.textContent = confirmLabel;
            ok.onclick = async () => {
                modal.classList.remove('active');
                await onConfirm();
            };
            cancel.onclick = () => modal.classList.remove('active');
            modal.classList.add('active');
        };

        // --- USTAWIENIA POKOJU (docs/UI-UX.md §10.3) --------------------------------

        // SPOSÓB ROZLICZANIA CAŁEJ GRUPY.
        //
        // Trzy wiersze z pełnym zdaniem wyjaśnienia przy każdym, a nie arkusz wyboru
        // z samymi nazwami: „Kto komu" i „Rachunek po rachunku" brzmią podobnie, dopóki
        // nie napisze się wprost, co się w nich zwija. To jest ustawienie, które ktoś
        // zmienia raz na pokój, więc miejsce na zdanie jest.
        //
        // ZMIANA DZIAŁA NA WSZYSTKICH i tak ma być: rozliczenie ma sens tylko wtedy, gdy
        // cała ekipa robi to samo. Dlatego idzie do dziennika aktywności — przy cudzych
        // pieniądzach zmiana bez śladu jest gorsza od zmiany, o której ktoś nie wiedział.
        const renderRoomSettlementMode = () => {
            const wrap = document.getElementById('room-settlement-mode');
            if (!wrap) return;
            const current = groupSettlementMode();
            wrap.innerHTML = SETTLEMENT_MODES.map((m) => `
                <button class="room-mode-btn card w-full p-4 text-left flex items-start gap-3 ${m.id === current ? 'card-mine' : ''}" data-mode="${m.id}" aria-pressed="${m.id === current}">
                    <span class="w-6 flex-shrink-0 pt-0.5 ${m.id === current ? 'text-ink' : 'text-ink-3'}">
                        <i class="fas ${m.id === current ? 'fa-circle-check' : 'fa-circle'} ${m.id === current ? '' : 'opacity-30'}"></i>
                    </span>
                    <span class="min-w-0">
                        <span class="block font-bold">${m.tytul}</span>
                        <span class="block text-sm text-ink-2 mt-0.5">${m.opis}</span>
                    </span>
                </button>`).join('');
            wrap.querySelectorAll('.room-mode-btn').forEach((btn) => {
                btn.onclick = async () => {
                    const value = btn.dataset.mode;
                    if (value === groupSettlementMode()) return;
                    fireWrite(
                        updateDoc(groupDocRefById(currentGroupId), { settlementMode: value }),
                        'Nie udało się zmienić sposobu rozliczania.',
                    );
                    logEvent({ type: 'settlement-mode', label: `zmienił/a sposób rozliczania na „${settlementModeName(value)}"` });
                    showToast(`Rozliczacie się: ${settlementModeName(value)}.`);
                };
            });
        };

        const openRoomSettings = () => {
            renderRoomMembers();
            renderRoomSettlementMode();
            const curLabel = document.getElementById('room-currency-label');
            if (curLabel) curLabel.textContent = (groupData && groupData.defaultCurrency) || 'PLN';
            // Kod QR startuje zwinięty: to skrót dla jednej sytuacji przy stole,
            // a nie rzecz, którą trzeba oglądać przy każdym wejściu w ustawienia.
            const qrWrap = document.getElementById('room-qr-wrap');
            if (qrWrap) qrWrap.classList.add('hidden');
            const qrToggle = document.getElementById('room-qr-toggle');
            if (qrToggle) qrToggle.querySelector('span').textContent = 'Pokaż kod QR';
            document.getElementById('room-settings-modal').classList.add('active');
        };

        // Kod QR dogrywa się dopiero przy rozwinięciu — 21 kB, których ekipa przy stole
        // nie potrzebuje do niczego innego. Ta sama zasada, co przy `heic2any`.
        let qrcodePromise = null;
        const loadQrcode = () => {
            if (!qrcodePromise) qrcodePromise = import('qrcode-generator').then((m) => m.default || m);
            return qrcodePromise;
        };

        const renderRoomQr = async () => {
            const box = document.getElementById('room-qr');
            if (!box) return;
            const link = document.getElementById('group-share-link').value;
            if (!link) { box.innerHTML = ''; return; }
            const qrcode = await loadQrcode();
            // Typ 0 = automatyczny dobór wersji, korekcja „M": czytelny nawet gdy ktoś
            // skanuje z ekranu pod kątem, w słabym świetle lokalu.
            const qr = qrcode(0, 'M');
            qr.addData(link);
            qr.make();
            box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
            const svg = box.querySelector('svg');
            if (svg) { svg.style.width = '11rem'; svg.style.height = '11rem'; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Kod QR z linkiem do pokoju'); }
        };

        const renderRoomMembers = () => {
            const list = document.getElementById('room-members-list');
            const count = document.getElementById('room-members-count');
            if (!list || !groupData) return;
            const order = groupData.memberOrder || Object.keys(groupData.members || {});
            const me = myMemberNow();
            if (count) count.textContent = `${order.length} ${plural(order.length, 'osoba', 'osoby', 'osób')}`;
            list.innerHTML = order.map((id) => {
                const m = groupData.members[id];
                if (!m) return '';
                const isMe = me && me.id === id;
                const methods = getPaymentMethods(m).length;
                // „Wolne" znaczy: imię nikim nie zajęte, więc ktoś może je przejąć,
                // wchodząc do pokoju kodem. To jest informacja o dostępie, nie ozdoba.
                // ZAŁOŻYCIEL POKOJU PRZESTAŁ BYĆ NIEWIDZIALNY (2026-08-26). `adminId` istniał
                // w bazie od zawsze, ale nie pokazywał się nigdzie — a od tej wersji niesie
                // realną moc: założyciel może zamknąć rachunek, gdy płatnik zniknął. Władza,
                // o której nikt nie wie, kto ją ma, jest gorsza niż jej brak.
                const zalozyl = !!(groupData.adminId && m.claimedBy === groupData.adminId);
                const podpisy = [isMe ? 'to Ty' : (m.claimedBy ? '' : 'wolne, nikt jeszcze nie zajął')]
                    .concat(zalozyl ? ['założył/a pokój'] : [])
                    .filter(Boolean);
                const note = podpisy.join(' · ');
                const pay = methods > 0
                    ? `${methods} ${plural(methods, 'sposób płatności', 'sposoby płatności', 'sposobów płatności')}`
                    : 'brak sposobu płatności';
                const head = `${avatarHtml(m.name, id)}
                    <span class="flex-grow min-w-0">
                        <span class="block font-medium truncate">${escapeHtml(m.name)}${note ? ` <span class="text-xs text-ink-3">· ${escapeHtml(note)}</span>` : ''}</span>
                        <span class="block text-xs text-ink-3 truncate">${escapeHtml(pay)}</span>
                    </span>`;

                // WIERSZ, KTÓRY MÓWI „mam dwa sposoby płatności", MA JE POKAZAĆ.
                // Zgłoszenie właściciela: skoro w ustawieniach pokoju stoi informacja
                // o sposobach płatności, powinno dać się w nią zajrzeć i użyć numeru,
                // a nie tylko przeczytać, że istnieje. Wiersze są dokładnie te same,
                // co w oknie „Ureguluj" (`paymentMethodRowHtml`) — otwórz albo skopiuj —
                // więc nie dokładamy do aplikacji drugiego sposobu na tę samą rzecz.
                if (methods === 0) {
                    return `<div class="person-row" role="group">${head}</div>`;
                }
                return `<details class="member-pay">
                    <summary class="person-row cursor-pointer">
                        ${head}
                        <i class="fas fa-chevron-down settle-others-chevron" aria-hidden="true"></i>
                    </summary>
                    <div class="member-pay-body">
                        ${getPaymentMethods(m).map(paymentMethodRowHtml).join('')}
                    </div>
                </details>`;
            }).join('');
        };

        // Dopisanie osoby do pokoju, który już żyje: przy grupie 12–25 osób ktoś zawsze
        // dosiada się po pierwszym rachunku, a wcześniej jedyną drogą było założenie
        // pokoju od nowa.
        const addMemberToRoom = async (rawName) => {
            const name = String(rawName || '').trim();
            const input = document.getElementById('room-add-member-input');
            if (!name) { showToast('Wpisz imię.', true); if (input) input.focus(); return; }
            if (!groupData) return;
            const taken = Object.values(groupData.members || {}).some(
                (m) => m.name.trim().toLowerCase() === name.toLowerCase(),
            );
            if (taken) { showToast('Ktoś w pokoju ma już to imię.', true); return; }
            const id = `m${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const order = groupData.memberOrder || Object.keys(groupData.members || {});
            await updateDoc(groupDocRefById(currentGroupId), {
                [`members.${id}`]: { id, name, claimedBy: null },
                memberOrder: [...order, id],
            });
            if (input) input.value = '';
            showToast(`Dodano: ${name}`);
            logEvent({ type: 'room-member-add', label: `dopisał/a do pokoju: ${name}` });
        };

        const groupDocRefById = (groupId) => doc(db, `artifacts/${appId}/public/data/groups`, groupId);

        // Opuszczenie pokoju zwalnia MOJE imię i kasuje skrót z tego urządzenia.
        // Rachunki zostają: dług nie znika dlatego, że ktoś wyszedł z aplikacji.
        const leaveRoom = async () => {
            const me = myMemberNow();
            if (!me) return;
            openConfirm({
                title: 'Opuścić pokój?',
                body: 'Twoje imię zostanie zwolnione, a pokój zniknie z listy na tym urządzeniu. Rachunki i rozliczenia zostają.',
                confirmLabel: 'Opuść pokój',
                onConfirm: async () => {
                    await updateDoc(groupDocRefById(currentGroupId), { [`members.${me.id}.claimedBy`]: null });
                    forgetRoom(currentGroupId);
                    document.getElementById('room-settings-modal').classList.remove('active');
                    showToast('Pokój opuszczony.');
                    // Bez tego znacznika przeładowanie po opuszczeniu pokoju wpadłoby
                    // w automatyczny powrót i wrzuciło człowieka do NASTĘPNEGO pokoju
                    // z listy — dokładnie wtedy, gdy właśnie chciał z pokoju wyjść.
                    try { sessionStorage.setItem(SKIP_RESUME_KEY, '1'); } catch (_) {}
                    window.location.href = window.location.origin + window.location.pathname;
                },
            });
        };

        // KOLOR ZNAKU — jedno pole z bieżącym kolorem, paleta dopiero po stuknięciu.
        // Szesnaście kółek wyłożonych naraz na ekranie profilu wyglądało jak paleta
        // farb, a nie jak ustawienie: krzyczały wszystkie kolory naraz, w każdym stała
        // litera imienia, a wybrany dało się rozpoznać wyłącznie po cienkim pierścieniu.
        const renderColorField = (myMember) => {
            if (!myMember) return;
            const dot = document.getElementById('profile-color-dot');
            if (dot) dot.style.backgroundColor = colorForMember(myMember.id, myMember.name);
        };

        // --- WYBÓR KOLORU ZNAKU: DWA SUWAKI -----------------------------------------
        //
        // Szesnaście gotowych kółek zastąpił suwak odcienia i suwak intensywności
        // (decyzja właściciela 2026-08-15). Powód był konkretny: przy dwudziestu osobach
        // gotowa paleta nie starcza, a jej kolory były do siebie zbyt podobne, żeby
        // wybór cokolwiek znaczył.
        //
        // Trzy rzeczy, które ten wybór musi pilnować, i sposób, w jaki to robi:
        //   1. CZYTELNOŚĆ — litera dobiera kolor sama (`readableInk`), więc każdy punkt
        //      na obu suwakach jest kolorem, na którym da się przeczytać znak.
        //   2. ZNACZENIA — sąsiedztwa limonki marki i trzech barw pieniężnych są
        //      wyłączone. Nie całe pasma odcienia (to zabrałoby cały żółty i zielony),
        //      tylko punkty podobne na wszystkich trzech wymiarach naraz.
        //   3. ROZRÓŻNIALNOŚĆ — aplikacja NIE blokuje powtórki i nie ostrzega przed nią
        //      (wybór właściciela). Pokazuje, kto ma jaki kolor, i zostawia decyzję.
        let colorDraft = { hue: 258, intensity: 40 };

        const currentDraftColor = () => colorFromControls(colorDraft.hue, colorDraft.intensity);

        // Ścieżka suwaka odcienia pokazuje DOKŁADNIE te kolory, które wyjdą przy bieżącej
        // intensywności — nie ogólną tęczę. Odcienie zarezerwowane dla znaczeń schodzą
        // do szarości, więc widać je jako martwe odcinki, zanim palec tam trafi.
        const paintHueTrack = () => {
            const slider = document.getElementById('color-hue');
            if (!slider) return;
            const stops = [];
            for (let i = 0; i <= 36; i++) {
                const hue = Math.round((i * 360) / 36) % 360;
                const hex = colorFromControls(hue, colorDraft.intensity);
                stops.push(`${isReservedColor(hex) ? 'rgb(var(--ink-3))' : hex} ${(i / 36 * 100).toFixed(2)}%`);
            }
            slider.style.setProperty('--slider-track', `linear-gradient(to right, ${stops.join(',')})`);
            slider.style.setProperty('--slider-thumb', currentDraftColor());
        };

        // Ścieżka intensywności pokazuje ten sam odcień od najjaśniejszego do najciemniejszego.
        const paintIntensityTrack = () => {
            const slider = document.getElementById('color-intensity');
            if (!slider) return;
            const stops = [];
            for (let i = 0; i <= 10; i++) {
                stops.push(`${colorFromControls(colorDraft.hue, i * 10)} ${i * 10}%`);
            }
            slider.style.setProperty('--slider-track', `linear-gradient(to right, ${stops.join(',')})`);
            slider.style.setProperty('--slider-thumb', currentDraftColor());
        };

        const renderColorPreview = () => {
            const me = myMemberNow();
            const hex = currentDraftColor();
            const mark = document.getElementById('color-preview-mark');
            if (mark) {
                mark.style.backgroundColor = hex;
                mark.style.color = readableInk(hex);
                mark.textContent = initials(me ? me.name : '?');
            }
            const label = document.getElementById('color-preview-hex');
            if (label) label.textContent = hex;
            const note = document.getElementById('color-reserved-note');
            if (note) {
                // Ten komunikat pada tylko wtedy, gdy suwak sam odsunął odcień. Bez niego
                // uchwyt „ucieka" spod palca bez wyjaśnienia, co wygląda na usterkę.
                //
                // Przełączamy KRYCIE, nie obecność w układzie: wiersz ma zarezerwowaną
                // wysokość (`.color-note`), więc pojawienie się komunikatu nie przesuwa
                // suwaka pod palcem. Treść zostaje w węźle także po zgaszeniu, bo
                // kasowanie jej wywoływało drugie ogłoszenie u czytnika ekranu.
                const reserved = isReservedColor(colorFromControls(colorDraft.rawHue ?? colorDraft.hue, colorDraft.intensity));
                if (reserved) {
                    note.textContent = 'Ten odcień jest zarezerwowany dla oznaczeń kwot, więc suwak go omija.';
                }
                note.classList.toggle('is-on', reserved);
            }
            paintHueTrack();
            paintIntensityTrack();
        };

        const renderTakenColors = () => {
            const wrap = document.getElementById('color-taken');
            if (!wrap || !groupData) return;
            const me = myMemberNow();
            const order = groupData.memberOrder || Object.keys(groupData.members || {});
            const others = order.filter((id) => !me || id !== me.id);
            if (others.length === 0) {
                wrap.innerHTML = `<p class="text-sm text-ink-3">Jesteś na razie sam w tym pokoju.</p>`;
                return;
            }
            wrap.innerHTML = others.map((id) => {
                const m = groupData.members[id];
                if (!m) return '';
                return `<span class="color-taken-item" title="${escapeHtml(m.name)}">
                    ${avatarHtml(m.name, id, 'w-10 h-10 text-sm')}
                    <span class="color-taken-name">${escapeHtml(m.name)}</span>
                </span>`;
            }).join('');
        };

        const openColorPicker = () => {
            const me = myMemberNow();
            if (!me) return;
            colorDraft = controlsFromColor(colorForMember(me.id, me.name));
            const hue = document.getElementById('color-hue');
            const intensity = document.getElementById('color-intensity');
            if (hue) hue.value = String(colorDraft.hue);
            if (intensity) intensity.value = String(colorDraft.intensity);
            renderTakenColors();
            renderColorPreview();
            document.getElementById('color-picker-modal').classList.add('active');
        };

        const setupColorPicker = () => {
            const hue = document.getElementById('color-hue');
            const intensity = document.getElementById('color-intensity');
            if (!hue || !intensity) return;

            hue.oninput = () => {
                const raw = Number(hue.value);
                // Odcień zarezerwowany przeskakujemy do najbliższego dozwolonego, ale
                // ZAPAMIĘTUJEMY surową wartość — inaczej nie da się powiedzieć, dlaczego
                // uchwyt odskoczył, a interfejs, który rusza się sam bez wyjaśnienia,
                // czyta się jak zepsuty.
                colorDraft.rawHue = raw;
                colorDraft.hue = nearestAllowedHue(raw, colorDraft.intensity);
                renderColorPreview();
            };
            intensity.oninput = () => {
                colorDraft.intensity = Number(intensity.value);
                // Zmiana intensywności przesuwa granice stref zarezerwowanych, więc
                // odcień trzeba sprawdzić ponownie.
                colorDraft.hue = nearestAllowedHue(colorDraft.hue, colorDraft.intensity);
                renderColorPreview();
            };

            const save = document.getElementById('save-color-picker-btn');
            if (save) save.onclick = async () => {
                const me = myMemberNow();
                if (!me || !currentGroupId) return;
                const hex = currentDraftColor();
                document.getElementById('color-picker-modal').classList.remove('active');
                await updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), {
                    [`members.${me.id}.color`]: hex,
                });
                showToast('Zmieniono kolor znaku.');
            };
        };

        const renderProfile = () => {
            if (!groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const av = document.getElementById('profile-avatar-preview');
            if (av && myMember) {
                // WYSYŁKA W TOKU WYGRYWA ZE STANEM Z BAZY. Nasłuch grupy przerysowuje profil
                // przy każdej cudzej zmianie, a bez tego warunku każde takie przerysowanie
                // zdejmowałoby podgląd nowego zdjęcia i wracało do starego awatara — czyli
                // wysyłka wyglądałaby na przerwaną.
                if (pendingPhoto) {
                    av.innerHTML = pendingPhotoHtml();
                } else if (myMember.photoURL) {
                    av.innerHTML = `<img src="${escapeHtml(myMember.photoURL)}" class="w-16 h-16 rounded-full object-cover" alt="">`;
                } else {
                    // Ten sam znak, co wszędzie indziej, tylko w pełnym rozmiarze: dopiero
                    // tutaj widać gęstość rozety, po której ekipa rozpoznaje człowieka.
                    av.innerHTML = avatarHtml(myMember.name, myMember.id, 'w-16 h-16 text-4xl');
                }
            }
            const removeBtn = document.getElementById('profile-photo-remove-btn');
            if (removeBtn) removeBtn.classList.toggle('hidden', !(myMember && myMember.photoURL));
            renderColorField(myMember);
        };

        // --- ZDJĘCIE PROFILOWE ----------------------------------------------------
        //
        // Zgłoszenie z 2026-08-25 (kolega właściciela, wakacje, bardzo słaby zasięg):
        // „jak uploadowałem zdjęcie profilowe, nie było żadnego feedbacku, że to się
        // dzieje — dopiero jakoś po minucie się zaktualizowało".
        //
        // Przyczyna była dokładna: jedyną informacją zwrotną był dymek „Wgrywanie
        // zdjęcia…", który żyje 3,6 sekundy (patrz `showToast`). Wysyłka trwała minutę,
        // więc przez pozostałe pięćdziesiąt kilka sekund ekran nie mówił NIC, a awatar
        // był stary — czyli wyglądało to dokładnie tak, jakby nic się nie stało.
        //
        // ZASADA OGÓLNA, KTÓRA Z TEGO WYNIKA: stan operacji sieciowej mieszka NA RZECZY,
        // której dotyczy, a nie w dymku. Dymek jest do zdarzeń chwilowych; wysyłka pliku
        // przez zdychające wifi zdarzeniem chwilowym nie jest.
        let pendingPhoto = null; // { previewUrl, percent } — trwa wysyłka

        const pendingPhotoHtml = () => `
            <span class="relative block w-16 h-16">
                <img src="${escapeHtml(pendingPhoto.previewUrl)}" class="w-16 h-16 rounded-full object-cover opacity-50" alt="">
                <span class="absolute inset-0 flex items-center justify-center rounded-full bg-ink/60 text-surface text-xs font-bold">${pendingPhoto.percent}%</span>
            </span>`;

        const setPendingPhoto = (next) => {
            // Adres obiektowy trzeba zwolnić ręcznie, inaczej podgląd trzyma plik w pamięci
            // do końca życia karty. Przy kilku podejściach z rzędu to megabajty.
            if (pendingPhoto && (!next || next.previewUrl !== pendingPhoto.previewUrl)) {
                try { URL.revokeObjectURL(pendingPhoto.previewUrl); } catch (_) {}
            }
            pendingPhoto = next;
            if (currentScreenName === 'profile') renderProfile();
        };

        const uploadProfilePhoto = async (file) => {
            const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember || !file) return;
            let f = file, name = file.name || 'photo.jpg';
            if (file.type === 'image/heic' || name.toLowerCase().endsWith('.heic')) {
                try { showToast('Konwertowanie zdjęcia HEIC...'); f = await (await loadHeic2Any())({ blob: file, toType: 'image/jpeg', quality: 0.8 }); name = name.replace(/\.[^/.]+$/, '') + '.jpg'; }
                catch (e) { console.error(e); showToast('Nie udało się przekonwertować HEIC.', true); return; }
            }
            if (!f.type || !f.type.startsWith('image/')) { showToast('Wybierz obraz.', true); return; }
            if (f.size > 20 * 1024 * 1024) { showToast('Zdjęcie za duże (max 20 MB).', true); return; }

            // PODGLĄD NATYCHMIAST, jeszcze przed dotknięciem sieci. Awatar zmienia się
            // w tej samej chwili, w której człowiek wybrał plik — reszta to już tylko
            // czekanie, o którym ekran mówi wprost.
            setPendingPhoto({ previewUrl: URL.createObjectURL(f), percent: 0 });

            const oldURL = myMember.photoURL;
            const storageRef = ref(storage, `groups/${currentGroupId}/profile-photos/${myMember.id}/${Date.now()}-${name}`);
            // `uploadBytesResumable`, nie `uploadBytes`: tamto nie ma zdarzeń postępu,
            // więc nie da się z niego zrobić żadnego wskaźnika poza „trwa".
            const task = uploadBytesResumable(storageRef, f);

            task.on('state_changed',
                (snap) => {
                    const percent = snap.totalBytes > 0
                        ? Math.min(99, Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
                        : 0;
                    if (pendingPhoto && pendingPhoto.percent !== percent) {
                        setPendingPhoto({ ...pendingPhoto, percent });
                    }
                },
                (err) => {
                    console.error('[Billiada] Wysyłka zdjęcia nieudana:', err);
                    setPendingPhoto(null);
                    showToast('Nie udało się wgrać zdjęcia. Spróbuj ponownie.', true);
                },
                async () => {
                    try {
                        const url = await getDownloadURL(task.snapshot.ref);
                        // Zapis adresu NIE jest czekany: offline i tak trafia do kolejki,
                        // a nasłuch grupy pokaże nowe zdjęcie od razu.
                        fireWrite(
                            updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), { [`members.${myMember.id}.photoURL`]: url }),
                            'Zdjęcie wysłane, ale nie udało się go zapisać w profilu.',
                        );
                        if (oldURL) { try { await deleteObject(ref(storage, oldURL)); } catch (_) {} }
                        showToast('Zapisano zdjęcie profilowe.');
                    } catch (e) {
                        console.error('[Billiada] Nie udało się odczytać adresu zdjęcia:', e);
                        showToast('Zdjęcie wysłane, ale nie udało się go zapisać.', true);
                    } finally {
                        setPendingPhoto(null);
                    }
                });
        };
        const removeProfilePhoto = async () => {
            const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember || !myMember.photoURL) return;
            const oldURL = myMember.photoURL;
            await updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), { [`members.${myMember.id}.photoURL`]: deleteField() });
            try { await deleteObject(ref(storage, oldURL)); } catch (e) {}
            showToast('Usunięto zdjęcie.');
        };

        // Model wpłat: rachunki nie mają stanu „opłacone" (settlement w Rozliczeniach).
        // Zostają filtry Wszystkie / Ukryte (not_applicable lub ręcznie ukryte).
        // Trzy rozłączne stany rachunku wobec MNIE. Wcześniej „nie dotyczy" i „ukryte
        // przeze mnie" wpadały do jednego worka, więc nie dało się zapytać o rachunki
        // grupy, które mnie nie dotyczą, ani odróżnić ich od tych, które sam schowałem.
        const getBillUserState = (bill, myMember) => {
            const myP = bill.participants ? bill.participants[myMember.id] : null;
            if (!myP || myP.status === 'not_applicable') return 'others';
            if ((bill.hiddenBy || []).includes(myMember.id)) return 'hidden';
            return 'visible';
        };

        // Polska odmiana po liczbie: 1 przelew, 2 przelewy, 5 przelewów. Bez tego
        // interfejs pisał „8 przelewy", co przy pieniądzach czyta się jak niedbałość.
        const plural = (n, one, few, many) => {
            const mod10 = n % 10, mod100 = n % 100;
            if (n === 1) return one;
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
            return many;
        };

        // Data rachunku w postaci klucza dnia i podpisu nad grupą. „Dzisiaj" i „Wczoraj"
        // niosą więcej niż liczba: przy stole pytanie brzmi „to ta wczorajsza kolacja?".
        const billCreatedDate = (bill) =>
            (bill.createdAt && bill.createdAt.toDate) ? bill.createdAt.toDate() : null;

        const billDayKey = (bill) => {
            const d = billCreatedDate(bill);
            if (!d) return 'brak-daty';
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        };

        const billDayLabel = (bill) => {
            const d = billCreatedDate(bill);
            if (!d) return 'Bez daty';
            const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
            const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
            if (days === 0) return 'Dzisiaj';
            if (days === 1) return 'Wczoraj';
            const sameYear = d.getFullYear() === new Date().getFullYear();
            return d.toLocaleDateString('pl-PL', sameYear
                ? { day: 'numeric', month: 'long' }
                : { day: 'numeric', month: 'long', year: 'numeric' });
        };

        // Licznik nad listą: ile tego jest i na ile opiewa to, co widać po filtrze.
        // Waluty NIGDY się nie mieszają, więc każda dostaje własną sumę.
        const renderBillsCount = (visible) => {
            const el = document.getElementById('bills-count');
            if (!el) return;
            if (visible.length === 0) { el.textContent = ''; return; }
            const bills = (n) => `${n} ${plural(n, 'rachunek', 'rachunki', 'rachunków')}`;
            const sums = {};
            visible.forEach(({ data }) => {
                const cur = data.currency || 'PLN';
                sums[cur] = (sums[cur] || 0) + toGrosze(data.totalAmount || 0);
            });
            const money = Object.entries(sums)
                .filter(([, g]) => g > 0)
                .map(([cur, g]) => fmtMoney(g, cur));
            el.textContent = [bills(visible.length), ...money].join(' · ');
        };

        // Stan pusty mówi, CO odfiltrowano i jak to skasować — inaczej pusta lista
        // wygląda jak awaria, a nie jak wynik własnego wyboru sprzed sekundy.
        const billsEmptyStateHtml = () => {
            if (latestBills.length === 0) {
                return '<p class="block-quiet p-5 text-sm text-ink-2">Pusty pokój. Pierwszy rachunek dodasz limonkowym przyciskiem na dole ekranu.</p>';
            }
            // Pusta lista pod WYBRANYM filtrem jest dziś jedynym powodem, dla którego pusta
            // pigułka w ogóle stoi na pasku (patrz `renderBillsList`) — więc to zdanie musi
            // nieść DOMKNIĘCIE, a nie samą informację o zerze.
            const messages = {
                waiting: 'Nic nie czeka na Twój ruch. Wszystko, co Twoje, jest uzupełnione.',
                confirm: 'Żaden przelew nie czeka na Twoje potwierdzenie.',
                owed: 'Nie masz nic do oddania. Za każdy rachunek już się rozliczyłeś/aś.',
                mine: 'Nie wyłożyłeś/aś jeszcze pieniędzy za żaden rachunek.',
                others: 'Każdy rachunek w tym pokoju dotyczy także Ciebie.',
                hidden: 'Nie masz ukrytych rachunków.',
                all: 'Żaden rachunek Cię nie dotyczy. Zajrzyj do „Nie dotyczą Cię".',
            };
            const message = messages[currentBillFilter] || messages.all;
            const reset = currentBillFilter === 'all'
                ? ''
                : '<button id="bills-filter-reset" class="btn btn-quiet mt-3">Pokaż wszystkie</button>';
            return `<div class="block-quiet p-5"><p class="text-sm text-ink-2">${message}</p>${reset}</div>`;
        };

        // ODSUWANIE WIERSZA PALCEM — jeden odsunięty naraz.
        //
        // Dwa otwarte wiersze znaczyłyby dwa przyciski „Ukryj" na ekranie i pytanie,
        // który z nich dotyczy czego. Zamykamy poprzedni przy otwarciu następnego.
        let otwartyWiersz = null;
        // CZYŚCIMY WSZYSTKIE ODSUNIĘTE WIERSZE, nie tylko ten zapamiętany.
        //
        // Wersja pilnująca jednej zmiennej zostawiała wiersz otwarty, gdy klasa trafiła
        // na niego inną drogą niż śledzony gest — a wtedy nic już jej nie zdejmowało
        // i wiersz zastawał odsunięty „sam z siebie". Przy kilkunastu wierszach przebieg
        // po liście kosztuje tyle co nic, a księgowość, która może się rozjechać ze stanem
        // w drzewie, przestaje istnieć.
        const zamknijWiersz = () => {
            document.querySelectorAll('.bill-swipe.is-open').forEach((el) => el.classList.remove('is-open'));
            otwartyWiersz = null;
        };

        // Szerokość odsłanianego przycisku musi zgadzać się z `.bill-swipe-action`
        // w src/tailwind.css. Czytamy ją z elementu, żeby jedna liczba nie żyła w dwóch
        // plikach i nie rozjechała się po zmianie stylu.
        const attachSwipeToHide = (swipe, card) => {
            let x0 = 0, y0 = 0;
            // null = jeszcze nie wiadomo, w którą stronę idzie palec.
            let poziomo = null;
            let start = 0; // przesunięcie karty w chwili dotknięcia
            let dx = 0;
            let bylGest = false;

            const szerokosc = () => {
                const akcja = swipe.querySelector('.bill-swipe-action');
                return akcja ? akcja.offsetWidth : 96;
            };

            // PRZESUNIĘCIE CZYTAMY Z ELEMENTU, NIE ZGADUJEMY Z KLASY (poprawione
            // 2026-08-26 po zgłoszeniu „jeden rachunek jest przesunięty, choć go nie
            // ruszałem, i da się go przesunąć jeszcze bardziej w lewo").
            //
            // Poprzednia wersja pytała o klasę `is-open` i z niej wyliczała punkt wyjścia
            // gestu. Wystarczyło, żeby karta była odsunięta z INNEGO powodu niż ta klasa
            // — bo `:focus-within` też ją odsuwał — a wyliczenie startowało od zera przy
            // karcie stojącej już w lewo. Wynik: skok i przesunięcie poza granicę.
            // Teraz stan jest jeden i czytany wprost z macierzy przekształcenia, więc
            // nie da się go rozjechać z niczym.
            const przesuniecie = () => {
                // Bez przekształcenia przeglądarka zwraca napis „none", na którym
                // konstruktor macierzy wywala się wyjątkiem — a to jest stan DOMYŚLNY,
                // czyli ten najczęstszy.
                const t = getComputedStyle(card).transform;
                if (!t || t === 'none') return 0;
                try {
                    const m = new DOMMatrixReadOnly(t);
                    return Number.isFinite(m.m41) ? m.m41 : 0;
                } catch (_) {
                    return 0;
                }
            };

            card.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                x0 = e.touches[0].clientX;
                y0 = e.touches[0].clientY;
                poziomo = null;
                start = przesuniecie();
                dx = start;
                bylGest = false;
            }, { passive: true });

            card.addEventListener('touchmove', (e) => {
                if (e.touches.length !== 1) return;
                const rx = e.touches[0].clientX - x0;
                const ry = e.touches[0].clientY - y0;

                // OŚ ROZSTRZYGA SIĘ RAZ, przy pierwszym wyraźnym ruchu. Bez tego lista
                // albo nie chce się przewijać, albo wiersze uciekają w bok przy każdym
                // przewinięciu — a to ten sam palec i ten sam ruch, tylko inna intencja.
                if (poziomo === null) {
                    if (Math.abs(rx) < 8 && Math.abs(ry) < 8) return;
                    poziomo = Math.abs(rx) > Math.abs(ry);
                    if (poziomo) {
                        zamknijWiersz();
                        swipe.classList.add('is-dragging');
                    }
                }
                if (!poziomo) return;

                // Tylko w lewo, i nie dalej niż szerokość przycisku. Ciągnięcie w prawo
                // z pozycji zamkniętej nie ma czego odsłonić. Punkt wyjścia to FAKTYCZNE
                // przesunięcie karty zmierzone przy dotknięciu — patrz `przesuniecie`.
                dx = Math.max(-szerokosc(), Math.min(0, start + rx));
                card.style.transform = `translateX(${dx}px)`;
                bylGest = true;
                // Przewijanie w pionie musi zejść z drogi, gdy palec idzie w bok.
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            const koniec = () => {
                if (poziomo) {
                    swipe.classList.remove('is-dragging');
                    card.style.transform = '';
                    // Połowa szerokości: mniej znaczy „rozmyśliłem się", więcej „otwieram".
                    const otwiera = dx < -szerokosc() / 2;
                    swipe.classList.toggle('is-open', otwiera);
                    otwartyWiersz = otwiera ? swipe : null;
                }
                poziomo = null;
            };
            card.addEventListener('touchend', koniec, { passive: true });
            card.addEventListener('touchcancel', koniec, { passive: true });

            // Stuknięcie w odsuniętą kartę ZAMYKA ją, zamiast wchodzić w rachunek.
            // Bez tego jedyną drogą powrotu byłoby trafienie w „Ukryj" albo odsunięcie
            // wiersza z powrotem — a odruch mówi „stuknij obok, żeby anulować".
            card.addEventListener('click', (e) => {
                if (bylGest || swipe.classList.contains('is-open')) {
                    e.stopPropagation();
                    e.preventDefault();
                    zamknijWiersz();
                    bylGest = false;
                }
            }, true);

            // DOJŚCIE KLAWIATURĄ I CZYTNIKIEM EKRANU. Ognisko na przycisku otwiera wiersz
            // TĄ SAMĄ klasą, co palec — inaczej wygląd i stan gestu rozjeżdżają się
            // (patrz uwaga przy `przesuniecie`). Zamknięcie przy zejściu ogniska, chyba że
            // ktoś w międzyczasie otworzył wiersz palcem.
            const akcja = swipe.querySelector('.bill-swipe-action');
            if (akcja) {
                akcja.addEventListener('focus', () => {
                    // TYLKO OGNISKO OD KLAWIATURY (poprawione 2026-08-26 po zgłoszeniu
                    // „przycisk Ukryj jest widoczny na wierzchu od razu po wejściu").
                    //
                    // Ten nasłuch jest JEDYNĄ drogą, którą wiersz otwiera się bez gestu palca,
                    // a reagował na KAŻDE ognisko — także nadane dotknięciem, przywrócone przez
                    // przeglądarkę po powrocie na widok albo ustawione programowo. Wtedy pierwszy
                    // wiersz listy witał człowieka odsunięty, choć nikt go nie ruszał.
                    // `:focus-visible` jest prawdziwe wyłącznie przy nawigacji klawiaturą
                    // i czytnikiem ekranu — czyli dokładnie w przypadku, dla którego ten
                    // nasłuch powstał. Safari zna je od 15.4, czyli od naszej dolnej granicy.
                    let odKlawiatury = true;
                    try { odKlawiatury = akcja.matches(':focus-visible'); } catch (_) { odKlawiatury = true; }
                    if (!odKlawiatury) return;
                    zamknijWiersz();
                    swipe.classList.add('is-open');
                    otwartyWiersz = swipe;
                });
                akcja.addEventListener('blur', () => {
                    if (otwartyWiersz === swipe) zamknijWiersz();
                });
            }
        };

        const renderBillsList = () => {
            const billsList = document.getElementById('bills-history-list');
            if (!billsList || !groupData) return;
            // KAŻDE RYSOWANIE LISTY ZACZYNA SIĘ OD WIERSZY ZAMKNIĘTYCH. Wiersze powstają
            // od nowa, więc klasa `is-open` nie ma jak ich przeżyć — ale zmienna `otwartyWiersz`
            // wskazywałaby na element wyrzucony już z drzewa, a wtedy zamknięcie następnego
            // wiersza nie miałoby czego zamknąć. Jedna linia kasuje całą tę księgowość.
            zamknijWiersz();
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;

            document.querySelectorAll('.bill-filter-btn').forEach(btn => {
                btn.setAttribute('aria-pressed', String(btn.dataset.filter === currentBillFilter));
            });

            // DŁUGI ROZPISANE NA RACHUNKI — potrzebne filtrowi „Do oddania" i kwotom
            // na kafelkach w trybie rachunkowym. Liczone RAZ na przerysowanie: przy
            // dwudziestu rachunkach i piętnastu osobach liczenie tego w pętli po wierszach
            // byłoby dwudziestokrotnym przebiegiem po tych samych danych.
            const per = perBillNow();
            const mojeDoOddania = new Map();
            myBillsToPay(per, myMember.id).forEach((r) => mojeDoOddania.set(r.billId, r));
            // Ile jeszcze ma do mnie wrócić z każdego rachunku, za który wyłożyłem.
            const doMnieZRachunku = new Map();
            (per.rows || []).filter((r) => r.payer === myMember.id).forEach((r) => {
                doMnieZRachunku.set(r.billId, (doMnieZRachunku.get(r.billId) || 0) + r.openG);
            });
            const perBillActive = groupSettlementMode() === 'perBill';

            // KTÓRE RACHUNKI MAJĄ SPRAWY PRZELEWOWE — liczone RAZ na przerysowanie.
            // Jeden przelew bywa zapłatą za pięć rachunków, więc pytanie brzmi „czy ten
            // rachunek jest wśród nich", a nie „czy przelew ma ten identyfikator".
            const rachunkiWplaty = (s) => (Array.isArray(s.billIds) && s.billIds.length)
                ? s.billIds
                : (s.billId ? [s.billId] : []);
            // KWOTA PRZELEWU NALEŻY DO WIERSZA TYLKO WTEDY, GDY JEST JEDNOZNACZNA.
            //
            // Jedna wpłata bywa zapłatą za pięć rachunków i wtedy ŻADNA jej część nie jest
            // przypisana do żadnego z nich — pokazanie jej przy jednym kłamałoby o cudzych
            // pieniądzach. Zliczamy więc osobno: ile przelewów czeka i ile z nich dotyczy
            // wyłącznie tego rachunku. Kwota idzie na ekran tylko w tym drugim przypadku.
            const doPotwierdzeniaRachunki = new Map();
            settlementsAwaitingMe(myMember.id).forEach((s) => {
                const rachunki = rachunkiWplaty(s);
                rachunki.forEach((b) => {
                    const wpis = doPotwierdzeniaRachunki.get(b)
                        || { ile: 0, amountG: 0, currency: null, jednoznaczna: true };
                    wpis.ile += 1;
                    if (rachunki.length === 1) {
                        wpis.amountG += settlementAmountG(s);
                        wpis.currency = wpis.currency || settlementCurrency(s);
                    } else {
                        wpis.jednoznaczna = false;
                    }
                    doPotwierdzeniaRachunki.set(b, wpis);
                });
            });
            const sporneRachunki = new Set();
            [...disputesAsPayee(myMember.id), ...disputesAsDebtor(myMember.id)].forEach((s) => {
                rachunkiWplaty(s).forEach((b) => sporneRachunki.add(b));
            });

            // FILTR „DO ODDANIA" ISTNIEJE TYLKO W TRYBIE RACHUNKOWYM (decyzja właściciela
            // 2026-08-26). W planie minimalnym wpłaty idą trasami, których żaden rachunek
            // nie stworzył, więc nie da się uczciwie powiedzieć, czy TEN rachunek został
            // opłacony — filtr obiecywałby odpowiedź, której nie ma skąd wziąć.
            // Zdejmujemy go PRZED filtrowaniem, inaczej po zmianie trybu lista raz
            // narysowałaby się przez filtr, którego już nie ma.
            const owedBtn = document.querySelector('.bill-filter-btn[data-filter="owed"]');
            if (owedBtn) owedBtn.classList.toggle('hidden', !perBillActive);
            if (!perBillActive && currentBillFilter === 'owed') currentBillFilter = 'all';

            // Pięć wymiarów, jeden na raz. „Czekają na Ciebie" to dokładnie te rachunki,
            // które `billStatus` oznacza tonem `action` — czyli jedno źródło prawdy dla
            // filtra i dla błękitu na kafelku. „Moje" to te, za które wyłożyłem pieniądze.
            // „Do oddania" — te, za które wciąż jestem winien płatnikowi; działa w KAŻDYM
            // trybie, bo pytanie „co jeszcze wisi" nie zależy od tego, jak grupa się umówiła.
            // JEDNA REGUŁA PRZYNALEŻNOŚCI, dwa zastosowania: lista i liczby przy pigułkach.
            // Do 2026-08-29 liczby miały własne, osobno pisane warunki — i były tylko dwie,
            // bo trzeciej nikomu nie chciało się powtarzać po raz trzeci. Teraz reguła jest
            // jedna, więc każdy filtr może mieć licznik i żaden nie może się rozjechać
            // z tym, co realnie pokaże po stuknięciu.
            const pasujeDoFiltru = (filtr, id, data) => {
                const state = getBillUserState(data, myMember);
                if (filtr === 'hidden') return state === 'hidden';
                if (filtr === 'others') return state === 'others';
                // Reszta filtrów pracuje wyłącznie na rachunkach, które MNIE dotyczą
                // i których sam nie schowałem — to jest domyślny świat tej listy.
                if (state !== 'visible') return false;
                if (filtr === 'confirm') return doPotwierdzeniaRachunki.has(id);
                if (filtr === 'waiting') {
                    const p = data.participants ? data.participants[myMember.id] : null;
                    return doPotwierdzeniaRachunki.has(id) || billStatus(data, myMember, p).tone === 'action';
                }
                if (filtr === 'owed') return mojeDoOddania.has(id);
                if (filtr === 'mine') return data.payerId === myMember.id;
                return true;
            };

            const visible = latestBills.filter(({ id, data }) => pasujeDoFiltru(currentBillFilter, id, data));

            // LICZBA I OBECNOŚĆ PIGUŁKI Z JEDNEGO PRZEBIEGU (2026-08-30).
            //
            // Liczba przy pigułce (2026-08-29) odpowiadała na pytanie „czy tam coś jest",
            // które bez niej wymagało odwiedzenia filtra. Skoro jednak i tak ją liczymy,
            // to pigułka z zerem nie musi w ogóle stać na pasku: pasek filtrów jest
            // obietnicą „stuknij, a coś zobaczysz", a pusta pigułka tę obietnicę łamie
            // i uczy omijać wzrokiem cały rząd — razem z tymi, które akurat coś niosą.
            //
            // DWA WYJĄTKI OD ZNIKANIA:
            //   • „Wszystkie" — punkt wyjścia i droga powrotna z każdego innego filtra;
            //   • pigułka WŁAŚNIE WYBRANA, nawet pusta. Inaczej znikałaby spod palca
            //     dokładnie w chwili, gdy domykasz ostatnią sprawę z tej listy, a zamiast
            //     domknięcia („nic już nie czeka") dostawałbyś skok na inną listę.
            //     Pusty stan i tak niesie przycisk „Pokaż wszystkie".
            //
            // „Do oddania" ma jeszcze własny powód nieobecności — tryb rozliczania,
            // a nie liczba rachunków (patrz wyżej).
            let widocznychPigulek = 0;
            document.querySelectorAll('.bill-filter-btn').forEach((btn) => {
                const filtr = btn.dataset.filter;
                const ile = latestBills.filter(({ id, data }) => pasujeDoFiltru(filtr, id, data)).length;
                const licznik = btn.querySelector('.filter-pill-count');
                // Zero chowa licznik zamiast pisać „0" — pusty filtr ma wyglądać na pusty,
                // a nie na zepsuty. Widać go zresztą wyłącznie wtedy, gdy jest wybrany.
                if (licznik) licznik.textContent = ile ? String(ile) : '';
                const wTymTrybie = filtr !== 'owed' || perBillActive;
                const chowamy = !wTymTrybie
                    || (ile === 0 && filtr !== 'all' && filtr !== currentBillFilter);
                btn.classList.toggle('hidden', chowamy);
                if (!chowamy) widocznychPigulek += 1;
            });
            // Pasek z jedną pigułką nie jest paskiem filtrów, tylko napisem „Wszystkie"
            // zajmującym rząd wysokości celu dotykowego. W świeżym pokoju i w pokoju,
            // w którym wszystko jest domknięte, schodzi z ekranu w całości.
            const pasekFiltrow = document.getElementById('bill-filters');
            if (pasekFiltrow) pasekFiltrow.classList.toggle('hidden', widocznychPigulek < 2);

            renderBillsCount(visible);

            // Wiersze powstają od nowa, więc odsunięty wiersz przestaje istnieć razem
            // ze swoim węzłem — wskaźnik musi zejść razem z nim.
            otwartyWiersz = null;
            billsList.innerHTML = '';
            if (visible.length === 0) {
                billsList.innerHTML = billsEmptyStateHtml();
                const reset = document.getElementById('bills-filter-reset');
                if (reset) reset.onclick = () => { currentBillFilter = 'all'; renderBillsList(); };
                return;
            }

            // Nagłówki dni zamiast płaskiej listy: przy dwudziestu rachunkach data
            // czyta się raz na grupę, nie raz na wiersz.
            let currentDayKey = null;
            let dayGrid = null;
            const startDay = (bill) => {
                const heading = document.createElement('p');
                heading.className = 'bills-day-title mt-4 mb-2 first:mt-0';
                heading.textContent = billDayLabel(bill);
                billsList.appendChild(heading);
                dayGrid = document.createElement('div');
                dayGrid.className = 'bills-day-grid space-y-2';
                billsList.appendChild(dayGrid);
            };

            visible.forEach(({ id, data: bill }) => {
                const dayKey = billDayKey(bill);
                if (dayKey !== currentDayKey) {
                    currentDayKey = dayKey;
                    startDay(bill);
                }
                const myParticipant = bill.participants ? bill.participants[myMember.id] : null;
                const isHidden = (bill.hiddenBy || []).includes(myMember.id);
                const canToggleHide = myParticipant && myParticipant.status !== 'not_applicable';

                // Data rachunku idzie mikrodrukiem: jest potrzebna do odróżnienia dwóch kolacji
                // w tym samym miejscu, ale nie konkuruje z nazwą ani z kwotą.
                // GODZINA ZDJĘTA Z WIERSZA (zgłoszenie właściciela 2026-08-30: „Do
                // wyjaśnienia + godzina + kwota — bardzo się ciasno im robi w kafelku").
                // Miał rację i wybór był arytmetyczny. Rząd podpisów ma na telefonie 390 px
                // około 280 px, a stały w nim trzy rzeczy: znaczek stanu (do 180 px przy
                // „Przelew do sprawdzenia"), godzina i kwota. Dwie z nich są tu po coś —
                // znaczek mówi, co się dzieje, kwota mówi o pieniądzach — a godzina
                // odpowiadała na pytanie, którego nikt nie zadaje: o której powstał
                // rachunek. Datę niesie nagłówek dnia nad grupą, więc nic nie ginie.
                // Odzyskane miejsce idzie w całości na znaczek i kwotę, które przestają
                // się o nie bić.
                // KOLOR NIESIE STATUS, nie tożsamość. Kolorowanie kafelka kolorem płatnika
                // zamieniało listę w tęczę, w której nic nie znaczyło nic. Tu odcień pojawia
                // się WYŁĄCZNIE tam, gdzie jest coś do wiedzenia: co czeka na twój ruch,
                // ile jesteś winien, co już domknięte. Biały kafelek to stan spokojny.
                const status = billStatus(bill, myMember, myParticipant);

                // KWOTA NA KAFELKU MÓWI, ILE ZOSTAŁO, A NIE ILE BYŁO — ale tylko w trybie
                // rachunkowym, bo tylko tam wpłata jest przypisana do rachunku. W planie
                // minimalnym wpłata idzie w bok i „zostało" nie miałoby tu sensu.
                //
                // SAMA KWOTA, BEZ PRZYCISKU (zgłoszenie właściciela 2026-08-26: „robi się
                // bardzo dużo informacji na tej zakładce, bezsensownie"). „Ureguluj" stało
                // tu osobnym wierszem pod kafelkiem i rozdymało listę o piętro na każdym
                // rachunku do oddania. Regulowanie mieszka teraz WYŁĄCZNIE wewnątrz
                // rachunku, na limonkowej karcie „Twój udział" — jedno wejście zamiast
                // dwóch, a lista wraca do jednego wiersza na rachunek.
                // W TRYBIE RACHUNKOWYM WIERSZ NIESIE SAM STATUS, BEZ KWOTY (decyzja
                // właściciela 2026-08-26). Kwota stoi na ekranie rachunku, na limonkowej
                // karcie, razem z przyciskiem — a na liście odpowiada wyłącznie na pytanie
                // „czy mam to jeszcze na głowie". Liczba w tym miejscu kazała ją czytać
                // i porównywać przy każdym przewinięciu, choć nic z niej nie wynikało.
                //
                // DWIE PARY SŁÓW, BO DWIE ROLE. Dłużnik ma coś do zapłacenia („Nieopłacone"),
                // ale płatnik już zapłacił — z jego strony rachunek nie jest „nieopłacony",
                // tylko czeka na zwroty. Jedno słowo na obie role kłamałoby jednej z nich.
                // JEDEN ZNACZEK STANU NA WIERSZ (przeprojektowane 2026-08-29).
                //
                // Do tej pory w trybie rachunkowym wiersz niósł DWA znaczki naraz: status
                // ogólny („Płaci Ala") i stan rozliczenia („Nieopłacone"). Po zdjęciu imion
                // ze statusów zostałoby „Do oddania" obok „Nieopłacone", czyli dwa napisy
                // o tym samym. Znaczek jest więc jeden i wygrywa ten BLIŻSZY pieniądzom.
                //
                // KOLEJNOŚĆ PIERWSZEŃSTWA, od najpilniejszego:
                //   1. cudzy przelew czeka na moje sprawdzenie   (mój ruch, cudze pieniądze)
                //   2. sprawa sporna wokół tego rachunku          (stoi, dopóki się nie dogadamy)
                //   3. stan rozliczenia w trybie rachunkowym      (nieopłacone / czeka na zwrot / domknięte)
                //   4. status ogólny rachunku                     (uzupełnianie, kwota, płatnik)
                const mojDlug = mojeDoOddania.get(id);
                const doMnie = doMnieZRachunku.get(id);
                const statusChip = (klasa, ikona, tekst) =>
                    `<span class="chip ${klasa} flex-shrink-0"><i class="fas ${ikona}"></i>${tekst}</span>`;
                let kwotaHtml = status.amount ? `<span class="${status.amountClass}">${status.amount}</span>` : '';
                let chipHtml = `<span class="${status.chipClass}">${status.labelHtml}</span>`;
                // Czy ten wiersz woła o MÓJ ruch — stąd błękitne tło kafelka i kropka.
                let wolaMnie = status.tone === 'action';

                if (perBillActive && status.tone === 'owe') {
                    chipHtml = mojDlug
                        ? statusChip('text-owe', 'fa-circle-exclamation', 'Nieopłacone')
                        : statusChip('text-due', 'fa-check', 'Opłacone');
                } else if (perBillActive && status.tone === 'due' && typeof doMnie === 'number') {
                    chipHtml = doMnie > 0
                        ? statusChip('', 'fa-hourglass-half', 'Czeka na zwrot')
                        : statusChip('text-due', 'fa-check', 'Rozliczony');
                }
                if (sporneRachunki.has(id)) {
                    chipHtml = statusChip('', 'fa-eye', 'Do wyjaśnienia');
                }
                // NAJWYŻSZY PRIORYTET: ktoś zgłosił przelew za ten rachunek i czeka na moje
                // „Mam" (zgłoszenie właściciela 2026-08-29: „warto może wyróżnić rachunki,
                // gdzie mamy do potwierdzenia przelewy"). To jedyny stan na tej liście,
                // w którym CUDZE pieniądze czekają na moje jedno stuknięcie — i jedyny,
                // przy którym rachunek dostaje tu wołanie mimo domkniętego statusu.
                const doPotwierdzeniaTu = doPotwierdzeniaRachunki.get(id);
                if (doPotwierdzeniaTu) {
                    chipHtml = statusChip('text-info', 'fa-circle-question', doPotwierdzeniaTu.ile === 1
                        ? 'Przelew do sprawdzenia'
                        : `${doPotwierdzeniaTu.ile} przelewy do sprawdzenia`);
                    // KWOTA WRACA NA TEN WIERSZ (zgłoszenie właściciela 2026-08-30: „przy
                    // statusie Przelewy do sprawdzenia nie wyświetla się kwota — specjalnie
                    // czy błąd?"). Do 2026-08-30 była tu kasowana bez śladu i bez powodu
                    // widocznego z ekranu, więc wiersz czytał się jak niedowczytany.
                    // Powód istniał, ale dotyczył TYLKO wpłat za kilka rachunków naraz —
                    // i teraz milczy dokładnie w tym przypadku, a nie zawsze.
                    // Barwa `info`, nie zieleń: te pieniądze jeszcze do mnie nie doszły,
                    // to jest ZGŁOSZENIE czekające na moje sprawdzenie, nie wpływ.
                    kwotaHtml = (doPotwierdzeniaTu.jednoznaczna && doPotwierdzeniaTu.amountG > 0)
                        ? `<span class="font-bold text-info tabular-nums">${fmtMoney(doPotwierdzeniaTu.amountG, doPotwierdzeniaTu.currency || 'PLN')}</span>`
                        : '';
                    wolaMnie = true;
                }

                // WIERSZ ODSUWANY PALCEM. Kartę i przycisk ukrywania rozdziela teraz gest,
                // a nie centymetr ekranu — powód przy `.bill-swipe` w src/tailwind.css.
                // Rachunek, którego nie wolno mi ukryć („nie dotyczy Cię"), nie dostaje
                // opakowania w ogóle: pusty gest, który nic nie odsłania, czyta się gorzej
                // niż brak gestu.
                const billEl = document.createElement('div');
                billEl.className = "card tap p-4 cursor-pointer";
                // Tło barwi się tylko przy zadaniu do wykonania — reszta listy zostaje biała,
                // więc oko trafia w to jedno miejsce bez szukania.
                //
                // KLASA, NIE STYL W ATRYBUCIE (poprawione 2026-08-26 po zgłoszeniu „przycisk
                // Ukryj widać na wierzchu, i to tylko przy niektórych statusach").
                // Stało tu `backgroundColor = 'rgb(var(--info) / 0.06)'`, czyli tło o SZEŚCIU
                // PROCENTACH KRYCIA — i nadpisywało nieprzezroczyste tło `.bill-swipe-card`.
                // Karta stawała się przezroczysta w 94%, więc schowany pod nią przycisk
                // „Ukryj" prześwitywał bez żadnego gestu. Objaw pojawiał się WYŁĄCZNIE na
                // kafelkach z tonem `action` („Wskaż, kto płacił", „Stuknij, co Twoje",
                // „Zamknij rachunek") i stąd wrażenie, że usterka zależy od statusu.
                // Klasa nakłada barwę WARSTWĄ na nieprzezroczystym tle — patrz src/tailwind.css.
                if (wolaMnie) billEl.classList.add('tile-action');
                // PEŁNA NAZWA RACHUNKU, BEZ UCINANIA (zgłoszenie właściciela 2026-08-26:
                // „Pizzeria u Wujka Stacha" schodziła do „Pizzeria u W…"). Nazwa jest
                // tożsamością wiersza — po niej odróżnia się dwie kolacje z tego samego
                // tygodnia — więc ucięcie zabiera dokładnie tę część, która rozróżnia.
                //
                // Sama rezygnacja z `truncate` nie wystarczyła: kolumna nazwy miała przy
                // 390 px około 150 px, bo po prawej stała jeszcze kwota albo status.
                // W trybie rachunkowym prawa kolumna niesie SAM ZNACZEK, a ten czyta się
                // równie dobrze w rzędzie podpisów piętro niżej — więc tam schodzi,
                // a nazwa dostaje całą szerokość. W pozostałych trybach po prawej stoi
                // LICZBA, która musi być wyrównana do prawej i zostaje na miejscu.
                // WIERSZ O STAŁYM UKŁADZIE I STAŁEJ WYSOKOŚCI (zgłoszenie właściciela
                // 2026-08-29: „wkurza mnie, że zmienia się wysokość rachunków na liście
                // oraz układ danych się przesuwa w zależności od długości treści").
                //
                // Miał rację co do przyczyny: nazwa łamała się na dowolną liczbę wierszy,
                // znaczki stały w rzędzie ze zawijaniem, a kwota raz stała w prawej kolumnie,
                // raz schodziła do rzędu podpisów — więc kafelek miał inny KSZTAŁT zależnie
                // od treści. Lista, po której się skanuje wzrokiem, musi mieć jedną siatkę.
                //
                // Siatka jest teraz dwuwierszowa i niezmienna:
                //   [ znak ]  nazwa rachunku (jeden wiersz, nadmiar wielokropkiem)
                //             [znaczek stanu] · godzina                        kwota
                // Nazwa dostaje CAŁĄ szerokość kolumny, bo znaczek zszedł piętro niżej —
                // czyli ucięcie zdarza się rzadziej niż wtedy, gdy nazwa nie była ucinana
                // wcale, ale konkurowała o miejsce z kwotą po prawej.
                billEl.innerHTML = `
                    <div class="bill-row">
                        ${bill.payerId ? avatarHtml(memberName(bill.payerId), bill.payerId, 'w-11 h-11 text-base') : unknownPayerHtml()}
                        <div class="min-w-0 flex-grow">
                            <p class="bill-row-name">${escapeHtml(bill.billName)}</p>
                            <div class="bill-row-meta">
                                <span class="bill-row-state">${chipHtml}</span>
                                ${kwotaHtml ? `<span class="flex-shrink-0">${kwotaHtml}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
                billEl.onclick = (e) => {
                    if (e.target.closest('button')) return;
                    joinBill(currentGroupId, id);
                };

                if (!canToggleHide) {
                    (dayGrid || billsList).appendChild(billEl);
                    return;
                }

                const swipe = document.createElement('div');
                swipe.className = 'bill-swipe';
                const akcja = document.createElement('button');
                akcja.type = 'button';
                akcja.className = 'bill-swipe-action tap';
                akcja.innerHTML = `<i class="fas ${isHidden ? 'fa-eye' : 'fa-eye-slash'} text-lg"></i><span>${isHidden ? 'Przywróć' : 'Ukryj'}</span>`;
                akcja.setAttribute('aria-label', `${isHidden ? 'Przywróć' : 'Ukryj'} rachunek ${bill.billName}`);
                billEl.classList.add('bill-swipe-card');
                swipe.append(akcja, billEl);
                attachSwipeToHide(swipe, billEl);

                akcja.onclick = (e) => {
                    e.stopPropagation();
                    const billRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, id);
                    const przelacz = (ukryj) => fireWrite(
                        updateDoc(billRef, { hiddenBy: ukryj ? arrayUnion(myMember.id) : arrayRemove(myMember.id) }),
                        'Nie udało się zmienić widoczności rachunku.',
                    );
                    przelacz(!isHidden);
                    // PASEK „COFNIJ" — ta sama sieć asekuracyjna, co przy kasowaniu rachunku.
                    // Ukrycie jest odwracalne, ale rachunek znika z listy w tej samej chwili,
                    // więc bez paska trzeba wiedzieć o istnieniu filtra „Ukryte", żeby wrócić.
                    showUndoToast(
                        isHidden ? 'Przywrócono rachunek.' : 'Ukryto rachunek.',
                        () => przelacz(isHidden),
                    );
                };

                (dayGrid || billsList).appendChild(swipe);
            });
        };

        // --- Faza 4: zachowaj to, co użytkownik wpisuje, przy zdalnym przerenderowaniu ---
        const withFocusPreserved = async (renderFn) => {
            const el = document.activeElement;
            const editable = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.id;
            const snap = editable ? { id: el.id, value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
            await renderFn();
            if (!snap) return;
            const again = document.getElementById(snap.id);
            if (!again) return;
            try { again.value = snap.value; } catch (_) {}
            again.focus();
            try { again.setSelectionRange(snap.start, snap.end); } catch (_) {}
        };

        // Ile było przewinięte na liście rachunków, gdy ktoś wszedł w rachunek.
        // Bez tego powrót — obojętnie czy strzałką, czy gestem — stawiał człowieka
        // na górze listy, choć wybrany rachunek stał w jej połowie. Przy dwudziestu
        // rachunkach to znaczy szukanie tego samego miejsca drugi raz.
        let dashboardScrollY = 0;

        // WYJŚCIE Z RACHUNKU — JEDNA FUNKCJA NA WSZYSTKIE DROGI. Strzałka w nagłówku
        // i gest od krawędzi muszą robić DOKŁADNIE to samo, bo inaczej ta sama czynność
        // zaczyna zachowywać się różnie zależnie od tego, czym się ją wykonało.
        const leaveBillScreen = () => {
            if (!currentBillId) return;
            if (unsubscribeBill) unsubscribeBill();
            navigateToGroup(currentGroupId);
        };

        // GEST COFANIA OD LEWEJ KRAWĘDZI — WŁASNY, BO CUDZY BYWA NIEOBECNY.
        //
        // Zgłoszenie właściciela 2026-08-29: „czasem na iOS przesunięcie z rachunku nie
        // wraca do listy — czasem działa, czasem nie". Wersja pierwsza tego kodu nie
        // istniała w ogóle: aplikacja liczyła na gest SYSTEMOWY. On jednak nie jest
        // obietnicą. W aplikacji uruchomionej z ikony (a tak jej używa ekipa właściciela)
        // iOS raz go daje, raz nie, a kiedy treść przewija się w kontenerze `#app-scroll`
        // i akurat wybrzmiewa rozpęd przewijania, gest przepada bez śladu. Stąd
        // „czasem działa".
        //
        // Rozwiązanie: ten sam gest, ale nasz — a gdy przeglądarka zdecyduje się przejąć
        // go u siebie, strona dostaje `touchcancel` i nasz po prostu milknie. Dzięki temu
        // cofnięcie nie wykona się dwa razy, a wykona się ZAWSZE.
        //
        // Strefa startu jest wąska (28 px) i to nie jest ostrożność, tylko konieczność:
        // szerszy pas kradłby stukanie w lewą kolumnę ekranu rachunku (znaki uczestników
        // przy pozycjach paragonu stoją dokładnie tam).
        const setupEdgeBack = () => {
            const STREFA = 28;
            const PROG = 72;
            let x0 = null, y0 = null, os = null;

            const czynny = () => currentScreenName === 'bill'
                && !!currentBillId
                && !document.querySelector('.modal.active');

            document.addEventListener('touchstart', (e) => {
                x0 = null;
                os = null;
                if (e.touches.length !== 1 || !czynny()) return;
                const t = e.touches[0];
                if (t.clientX > STREFA) return;
                x0 = t.clientX;
                y0 = t.clientY;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (x0 === null || !e.touches.length) return;
                const dx = e.touches[0].clientX - x0;
                const dy = e.touches[0].clientY - y0;
                // Oś ustala się raz i nie zmienia: gest ukośny albo cofa, albo przewija,
                // a nie raz jedno, raz drugie.
                if (os === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                    os = (dx > 0 && Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';
                }
            }, { passive: true });

            document.addEventListener('touchend', (e) => {
                const start = x0;
                const osGestu = os;
                x0 = null;
                os = null;
                if (start === null || osGestu !== 'x' || !e.changedTouches.length) return;
                if (e.changedTouches[0].clientX - start < PROG) return;
                leaveBillScreen();
            }, { passive: true });

            // Przeglądarka przejęła gest u siebie — nasz ma zamilknąć.
            document.addEventListener('touchcancel', () => { x0 = null; os = null; }, { passive: true });
        };

        const joinBill = async (groupId, billId) => {
            dashboardScrollY = appScrollTop();
            currentGroupId = groupId;
            currentBillId = billId;
            history.pushState(null, '', `?group=${groupId}&bill=${billId}`);
            if (unsubscribeBill) unsubscribeBill();
            // Wchodzimy na gotowy paragon, więc nic nie ma prawa animować przy otwarciu —
            // ruch tłumaczy ZMIANĘ, a pierwszy render żadnej zmiany nie pokazuje.
            lastPickersByItem = new Map();
            // Nowe wejście na rachunek to nowa okazja, żeby zapytać wskazanego płatnika,
            // czy to naprawdę on zapłacił.
            payerClaimAskedFor = null;
            // Szukanie należy do jednego paragonu. Wpisane słowo przeniesione na następny
            // rachunek ukryłoby połowę pozycji bez żadnego powodu widocznego na ekranie.
            resetItemSearch();
            
            if (!groupData) {
                const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, groupId);
                const groupDoc = await getDoc(groupDocRef);
                if(groupDoc.exists()) {
                    groupData = groupDoc.data();
                } else {
                    showToast("Błąd: Nie można znaleźć grupy dla tego rachunku.", true);
                    return;
                }
            }

            // WEJŚCIE WPROST Z ODNOŚNIKA MUSI TEŻ WŁĄCZYĆ NASŁUCHY POKOJU.
            //
            // Nasłuchy wpłat, przypomnień i dziennika zakłada `renderGroupDashboard`, a ta
            // woła się wyłącznie z `navigateToGroup`. Kto wszedł prosto w rachunek — czyli
            // każdy, kto kliknął powiadomienie push albo odnośnik od kolegi — dostawał
            // rachunek z PUSTĄ listą wpłat i nic już tego nie prostowało.
            //
            // Objawy były ciche i dlatego przeżyły: chip „Oddał/a" w „Ekipie" liczy się
            // z wpłat, więc pokazywał „Zostaje …" nawet komuś, kto oddał wszystko. Teraz
            // doszły do tego stosy spraw, które były puste dokładnie dla kogoś, kogo
            // aplikacja właśnie tam przysłała.
            if (!unsubscribeSettlements) renderGroupDashboard();

            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${groupId}/bills`, billId);
            unsubscribeBill = onSnapshot(billDocRef, (doc) => {
                billData = doc.data();
                if (billData) {
                    // Jeden ekran dla każdego rachunku. Stare rachunki zapisane jako
                    // „prosty" otwierają się tutaj bez migracji danych: brak pozycji
                    // znaczy, że cała kwota jest nierozpisana i dzieli się po równo —
                    // czyli dokładnie to, co dawniej robił osobny ekran.
                    billData.photos = billData.photos || [];
                    billData.sharedCosts = billData.sharedCosts || [];
                    billData.globalCosts = billData.globalCosts || [];
                    withFocusPreserved(renderBillScreen);
                    showScreen('bill');
                }
            });
        };
        
        // Kurs do PLN: preferuj ZAPISANY na rachunku (kurs z dnia dodania), fallback = bieżący (jeśli pobrany dla tej waluty).
        const plnRateFor = (currency, savedRate) => {
            if (typeof savedRate === 'number' && savedRate > 0) return savedRate;
            if (exchangeRates && exchangeRates.base === currency && exchangeRates.rates && exchangeRates.rates.PLN) return exchangeRates.rates.PLN;
            return null;
        };
        const getPlnConversionHtml = (amount, currency, savedRate) => {
            const r = plnRateFor(currency, savedRate);
            if (currency !== 'PLN' && r && amount > 0) {
                return `(≈ ${(amount * r).toFixed(2)} PLN)`;
            }
            return '';
        };

        // Patch przy zmianie waluty: zapisuje KURS Z DNIA (waluta→PLN) na rachunku,
        // żeby historyczne przeliczenia nie zmieniały się wraz z bieżącym kursem.
        const currencyPatch = async (cur) => {
            const patch = { currency: cur };
            if (cur && cur !== 'PLN') {
                const rates = await fetchExchangeRates(cur);
                if (rates && rates.rates && rates.rates.PLN) {
                    patch.exchangeRatePLN = rates.rates.PLN;
                    patch.exchangeRateAt = serverTimestamp();
                }
            }
            return patch;
        };

        // Model wpłat: rachunek = KONSUMPCJA. Status = tylko członkostwo/uzupełnienie,
        // BEZ opłacone/nieopłacone (rozliczenie żyje w „Rozliczeniach", nie na rachunku).
        // Status jest teraz ODCZYTEM, nie kontrolką: nikt go nie ustawia, bo aplikacja
        // wie sama (patrz `participantReady`). Dlatego to zwykły podpis, a nie przycisk
        // otwierający arkusz — kontrolka, którą da się kliknąć, obiecuje decyzję,
        // a tu żadnej decyzji do podjęcia nie ma.
        const getStatusHtml = (isMe, isPayer, participantId) => {
            const isPayerConfirmed = billData.payerConfirmed === true;

            if (isPayer) {
                if (isPayerConfirmed) {
                    return `<span class="text-sm font-semibold text-due">Płatnik · potwierdzony</span>`;
                }
                return `<span class="text-sm font-semibold text-ink-2">Płatnik</span>`;
            }

            const ready = participantReady(billData, participantId);
            if (ready) {
                return `<span class="text-sm font-semibold text-ink-2 flex items-center gap-1.5"><i class="fas fa-check"></i>Uzupełnione</span>`;
            }
            // Ton „informacja" znaczy w tej aplikacji „coś czeka na ruch". U siebie
            // mówimy, CO zrobić; u kogoś innego stwierdzamy fakt, bo nie ma tam nic
            // do zrobienia przeze mnie.
            return isMe
                ? `<span class="text-sm font-semibold text-info flex items-center gap-1.5"><i class="fas fa-hand-pointer"></i>Stuknij swoje pozycje niżej</span>`
                : `<span class="text-sm font-semibold text-info flex items-center gap-1.5"><i class="fas fa-hourglass-half"></i>Jeszcze nie uzupełnił/a</span>`;
        };

        // --- Faza 7A: pozycje paragonu jako kafelki ---
        // Kafelek = element sharedCosts. Stuknięcie dopisuje/wypisuje MNIE z pozycji,
        // a matma (advancedExactSharesGrosze) dzieli kwotę równo między wybierających.
        const itemsDocRef = () => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);

        // WSPÓŁBIEŻNOŚĆ POZYCJI — dlaczego to nie jest zwykłe updateDoc.
        // Kafelki powstały po to, żeby po kolacji CAŁA EKIPA odklikiwała swoje pozycje naraz.
        // Zapis całej tablicy `sharedCosts` z lokalnej kopii oznaczał, że dwa stuknięcia w tej
        // samej sekundzie czytają ten sam stan i nadpisują się nawzajem — czyjś wybór znikał
        // BEZ ŚLADU, a jego udział po cichu spadał na płatnika. Transakcja czyta pozycje
        // świeżo w momencie zapisu i ponawia próbę przy kolizji, więc oba stuknięcia wchodzą.
        //
        // Zapasowe wyjście: transakcje wymagają sieci (nie kolejkują się w pamięci podręcznej
        // jak zwykły zapis). Gdy jesteśmy offline, wracamy do zapisu całej tablicy — lepiej
        // przyjąć stuknięcie z ryzykiem kolizji niż odmówić działania przy słabym zasięgu.
        const mutateItems = async (mutate) => {
            const billRef = itemsDocRef();
            try {
                await runTransaction(db, async (tx) => {
                    const snap = await tx.get(billRef);
                    if (!snap.exists()) return;
                    const fresh = snap.data().sharedCosts || [];
                    tx.update(billRef, { sharedCosts: mutate(fresh) });
                });
            } catch (err) {
                console.warn('[Billiada] Transakcja pozycji nieudana — zapis awaryjny:', err);
                await updateDoc(billRef, { sharedCosts: mutate(billData.sharedCosts || []) });
            }
        };

        // TA SAMA OCHRONA, ALE DLA OBU TABLIC NARAZ.
        //
        // Odkąd „Dla wszystkich" jest właściwością pozycji, jeden zapis potrafi dotknąć
        // OBU tablic: przełączenie przenosi pozycję z `sharedCosts` do `globalCosts` albo
        // z powrotem. Dwa osobne `updateDoc` są tu dwoma błędami naraz — po pierwsze
        // między nimi pozycja istnieje dwa razy albo wcale (a jeśli drugi zapis nie
        // dojdzie, zostaje tak na stałe), po drugie każdy z nich nadpisuje CAŁĄ tablicę
        // z lokalnej kopii, więc kasuje cudze stuknięcia z ostatnich sekund. A kafelki
        // paragonu powstały właśnie po to, żeby cała ekipa odklikiwała swoje NARAZ
        // (patrz `mutateItems` wyżej).
        //
        // `mutate` dostaje ŚWIEŻE tablice z bazy i zwraca gotowy zestaw pól do zapisania.
        // Zapasowe wyjście identyczne jak przy pozycjach: offline transakcja nie przejdzie,
        // a odmowa działania przy słabym zasięgu byłaby gorsza niż ryzyko kolizji.
        const mutateBillItems = async (mutate) => {
            const billRef = itemsDocRef();
            const zTablic = (d) => mutate({
                sharedCosts: (d && d.sharedCosts) || [],
                globalCosts: (d && d.globalCosts) || [],
            });
            try {
                await runTransaction(db, async (tx) => {
                    const snap = await tx.get(billRef);
                    if (!snap.exists()) return;
                    tx.update(billRef, zTablic(snap.data()));
                });
            } catch (err) {
                console.warn('[Billiada] Transakcja pozycji nieudana — zapis awaryjny:', err);
                await updateDoc(billRef, zTablic(billData));
            }
        };

        const renderItemTiles = () => {
            const list = document.getElementById('shared-costs-list');
            if (!list || !billData) return;
            const items = billData.sharedCosts || [];
            // POZYCJE DLA WSZYSTKICH STOJĄ NA TYM SAMYM WYDRUKU (2026-08-30). Dawniej miały
            // własną sekcję pod paragonem i własny przycisk — dwa pojęcia tam, gdzie ludzie
            // widzą jedną rzecz: linię na paragonie. Idą NA KOŃCU listy, bo tym właśnie są:
            // dopiskiem pod pozycjami, tak jak napiwek na prawdziwym paragonie.
            const forAll = billData.globalCosts || [];
            const wszystkich = items.length + forAll.length;
            const cur = billData.currency || 'PLN';
            const me = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === (currentUser && currentUser.uid));
            const myId = me ? me.id : null;

            const header = document.getElementById('items-section-header');
            if (header) {
                const missing = unassignedItems(billData).length;
                // Licznik „bez wyboru" jest jedyną czerwienią w tej sekcji: to realny brak
                // w rozliczeniu, a nie ozdoba. Same kafelki znaczą brak przerywaną krawędzią.
                header.innerHTML = wszystkich === 0 ? '' :
                    `<div class="flex items-center justify-between gap-2 mb-3">
                        <h3 class="font-display text-xl font-extrabold tracking-tight">Pozycje (${wszystkich})</h3>
                        ${missing > 0 ? `<p class="chip text-owe">${missing} bez wyboru</p>` : ''}
                    </div>`;
            }

            // Ząbkowana krawędź należy się WYŁĄCZNIE prawdziwemu paragonowi: pod stanem
            // pustym wyglądałaby jak oderwany kawałek niczego.
            const tear = document.getElementById('receipt-tear');
            const tearTop = document.getElementById('receipt-tear-top');
            const searchWrap = document.getElementById('item-search-wrap');

            if (wszystkich === 0) {
                list.className = '';
                if (tear) tear.classList.add('hidden');
                if (tearTop) tearTop.classList.add('hidden');
                if (searchWrap) searchWrap.classList.add('hidden');
                list.innerHTML = `<p class="block-quiet p-5 text-sm text-ink-2">Brak pozycji. Zrób zdjęcie paragonu wyżej i odczytaj je albo dopisz pozycję ręcznie. Potem każdy stuknie to, co jadł.</p>`;
                return;
            }
            if (tear) tear.classList.remove('hidden');
            if (tearTop) tearTop.classList.remove('hidden');
            // Wyszukiwarka pojawia się dopiero przy paragonie, na którym szukanie ma sens.
            // Przy pięciu pozycjach jest szybciej spojrzeć niż pisać.
            if (searchWrap) searchWrap.classList.toggle('hidden', wszystkich < ITEM_SEARCH_MIN);

            // ŻYWY PARAGON — znak tej aplikacji.
            //
            // Pozycje stoją w KOLUMNIE jak na paragonie, nie w siatce kafelków: paragon czyta
            // się z góry na dół, a przy trzydziestu pozycjach siatka zmusza oko do skakania.
            // Po prawej każdej linii stoi stos twarzy tych, którzy ją wzięli — i to jest ta
            // rzecz, której nie ma konkurencja: gdy piętnaście osób odklikuje równocześnie,
            // widzisz cudze zdjęcia lądujące na liniach na własnym ekranie, w czasie
            // rzeczywistym. Współbieżność przestaje być obietnicą w opisie i staje się obrazem.
            // Bez `mb-3`: odstęp pod paragonem należy teraz do ząbkowanej krawędzi
            // i do przycisku pod nią, a margines tutaj odsuwałby ząbki od wydruku.
            list.className = 'receipt card overflow-hidden';
            list.innerHTML = items.map(it => {
                const pickers = itemPickers(it).filter(pid => billData.participants[pid]);
                const count = pickers.length;
                const mine = isPicked(it, myId);
                const qty = itemQuantity(it);
                const amountG = toGrosze(it.amount || 0);
                const perPersonG = count > 0 ? Math.ceil(amountG / count) : 0;

                const baseLineClass = mine ? 'receipt-line receipt-line-mine' : (count === 0 ? 'receipt-line receipt-line-void' : 'receipt-line');

                // Pięć twarzy mieści się bez ścisku na najwęższym telefonie; reszta idzie
                // licznikiem. Moja twarz dostaje klasę, po której arkusz maluje jej obwódkę.
                //
                // Animacja lądowania należy WYŁĄCZNIE cudzym wyborom. Własne stuknięcie jest
                // odpowiedzią na twój ruch i nie wymaga tłumaczenia; ruch bez powodu to hałas.
                const seenBefore = lastPickersByItem.get(it.id);
                // Własne stuknięcie też zasługuje na odpowiedź — nie animacją lądowania
                // (to jest język cudzych działań), tylko krótkim podświetleniem całej
                // linii. Potwierdza, że zapis wrócił z bazy, a nie że kliknięcie zginęło.
                const myPickChanged = seenBefore && myId && seenBefore.has(myId) !== pickers.includes(myId);
                const faces = pickers.slice(0, 5).map(pid => {
                    const m = billData.participants[pid];
                    const landed = seenBefore && !seenBefore.has(pid) && pid !== myId;
                    const base = pid === myId ? 'face face-mine' : 'face';
                    return avatarHtml(m.name, pid, landed ? `${base} face-landing` : base);
                }).join('');

                // Klasa składana POZA szablonem: strażnik escapowania czyta wyrażenia
                // w znacznikach po nazwach, a nazwa klasy z członem „value" wygląda
                // dla niego jak dana z bazy wstawiona bez neutralizacji.
                const lineClass = myPickChanged ? `${baseLineClass} value-flash` : baseLineClass;
                return `<div class="${lineClass} cursor-pointer select-none" data-item-id="${it.id}">
                    <span class="pick-mark" aria-hidden="true"><i class="fas fa-check"></i></span>
                    <span class="flex-grow min-w-0">
                        <span class="block font-bold leading-tight truncate">${escapeHtml(it.description || 'Pozycja')}${qty > 1 ? ` <span class="text-ink-3 font-semibold">×${qty}</span>` : ''}</span>
                        <span class="mt-1.5 flex items-center gap-2 min-h-[1.75rem]">
                            ${count > 0
                                ? `<span class="face-stack">${faces}</span>${count > 5 ? `<span class="text-xs font-bold text-ink-3">+${count - 5}</span>` : ''}
                                   <span class="text-xs ${mine ? 'font-bold text-ink' : 'text-ink-3'}">${fmtMoney(perPersonG, cur)}/os.</span>`
                                : `<span class="chip text-ink-3">Nikt nie wziął</span>`}
                        </span>
                    </span>
                    <span class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-xl">${amountHtml(amountG, cur, 'text-ink', { withCurrency: false })}</span>
                        <button class="item-edit-btn w-11 h-11 rounded-full flex items-center justify-center text-ink-3 flex-shrink-0" data-item-id="${it.id}" title="Edytuj pozycję" aria-label="Edytuj pozycję"><i class="fas fa-pen text-xs"></i></button>
                    </span>
                </div>`;
            }).join('') + forAll.map((gc) => forAllLineHtml(gc, {
                heads: activeHeadCount(),
                cur,
                // Ołówek, nie kosz — dokładnie jak przy pozycji imiennej. Kasowanie mieszka
                // w arkuszu edycji, o jeden krok dalej: przy linii paragonu dwa cele dotykowe
                // obok siebie nachodziły na siebie i kosz łapał stuknięcia w ołówek.
                akcja: `<button class="item-edit-btn w-11 h-11 rounded-full flex items-center justify-center text-ink-3 flex-shrink-0" data-item-id="${gc.id}" title="Edytuj pozycję" aria-label="Edytuj pozycję"><i class="fas fa-pen text-xs"></i></button>`,
            })).join('');

            // Zapamiętujemy stan PO wyrenderowaniu, żeby następny zapis z bazy wiedział,
            // które twarze są nowe. Przy pierwszym wejściu na rachunek mapa jest pusta,
            // więc nic nie animuje — wchodzisz na gotowy paragon, a nie na fajerwerki.
            items.forEach(it => {
                lastPickersByItem.set(it.id, new Set(itemPickers(it)));
            });

            // Filtr nakładamy PO renderze, bo render przychodzi z bazy i zdarza się
            // wtedy, gdy ktoś inny odklikuje swoje. Gdyby filtrowanie siedziało w danych,
            // każdy cudzy zapis czyściłby szukanie w połowie wpisywania.
            applyItemFilter();
        };

        // --- SZUKANIE WŚRÓD POZYCJI ------------------------------------------------
        // Paragon z czterdziestoma pozycjami czyta się dobrze dopóki się po nim nie
        // SZUKA. „Co ja jadłem" przy takiej długości to przewijanie w obie strony.
        // Obsługę niesie wspólny mechanizm szukania (`applyPersonFilter`) — ten sam,
        // co przy wyborze osób, sterowany atrybutami w znacznikach. Pole ma więc
        // identyczne zachowanie: zwinięta lupa, rozwijane pole, filtr przy wpisywaniu.
        const ITEM_SEARCH_MIN = 8;

        const itemSearchWrap = () => {
            const box = document.getElementById('item-search-wrap');
            return box ? box.parentElement : null;
        };

        const applyItemFilter = () => {
            const wrap = itemSearchWrap();
            if (wrap) applyPersonFilter(wrap);
        };

        // --- POZYCJA „DLA WSZYSTKICH" (dawny koszt wspólny) ------------------------
        //
        // Jeden wiersz wydruku, dwa miejsca użycia: na wspólnym paragonie w trybie „ze
        // swoimi kosztami" (`renderItemTiles`) i w sekcji starych wpisów w trybie
        // „po równo" (`renderGlobalCosts`). Jedna funkcja, bo to jest ta sama rzecz —
        // dwa osobne szablony na tę samą treść rozjechały się już raz i po to je scalamy.
        //
        // Wiersz mówi trzy rzeczy naraz: znaczkiem, że to nie jest niczyja pozycja, tylko
        // wspólna; podpisem „Dla wszystkich"; i — najważniejsze — kwotą rozpisaną NA OSOBĘ.
        // Dopiero „3,50/os." pokazuje, co ten wpis znaczy dla patrzącego.
        const forAllValue = (gc) => {
            // Number() zamiast .toFixed() wprost: wartość wpisana z konsoli jako tekst
            // wywalała cały render listy (a z nim ekran rachunku).
            const wartosc = Number(gc.value) || 0;
            const isPercent = gc.type === 'percent';
            // Procent liczymy od kwoty rachunku — tak samo, jak liczy to rozliczenie.
            const baseG = toGrosze((billData && billData.totalAmount) || 0);
            return { wartosc, isPercent, totalG: isPercent ? Math.round(baseG * wartosc / 100) : toGrosze(wartosc) };
        };

        const forAllLineHtml = (gc, { heads, cur, akcja }) => {
            const { wartosc, isPercent, totalG } = forAllValue(gc);
            const perHeadG = heads > 0 ? Math.ceil(totalG / heads) : 0;
            // Przy procencie zostaje na ekranie SAM procent obok nazwy, a po prawej
            // stoi już kwota w złotówkach: „15%" i „18,30" mówią razem to, czego
            // żadne z nich nie mówi osobno.
            return `
                <div class="receipt-line">
                    <span class="global-cost-mark" aria-hidden="true"><i class="fas fa-users"></i></span>
                    <span class="flex-grow min-w-0">
                        <span class="block font-bold leading-tight truncate">${escapeHtml(gc.description)}${isPercent ? ` <span class="text-ink-3 font-semibold">${wartosc}%</span>` : ''}</span>
                        <span class="mt-1.5 flex items-center gap-2 min-h-[1.75rem]">
                            <span class="text-xs text-ink-3">Dla wszystkich${heads > 0 ? ` · ${fmtMoney(perHeadG, cur)}/os.` : ''}</span>
                        </span>
                    </span>
                    <span class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-xl">${amountHtml(totalG, cur, 'text-ink', { withCurrency: false })}</span>
                        ${akcja}
                    </span>
                </div>`;
        };

        const activeHeadCount = () => Object.values((billData && billData.participants) || {})
            .filter((p) => p.status !== PARTICIPANT_OUT).length;

        // STARE WPISY NA RACHUNKU „PO RÓWNO" — i nic poza tym.
        //
        // W tym trybie pozycja dla wszystkich nie ma czego robić: kwota rachunku i tak
        // dzieli się przez liczbę osób, więc napiwek osobną linią daje wynik co do grosza
        // taki sam jak napiwek wliczony w kwotę. Dokładał za to własną gałąź błędu
        // („przekraczają kwotę rachunku"), osiągalną wyłącznie tutaj.
        //
        // Nie wolno go jednak UKRYĆ, bo jego kwota nadal się liczy — pieniądze niewidoczne,
        // a policzone, to najgorsza możliwa usterka w aplikacji o cudzych pieniądzach.
        // Sekcja pokazuje się więc wyłącznie wtedy, gdy taki wpis istnieje, i mówi wprost,
        // co z nim zrobić. Dodać nowego nie ma jak.
        const renderGlobalCosts = () => {
            const list = document.getElementById('global-costs-list');
            const section = document.getElementById('global-costs-section');
            if (!list || !billData) return;
            const costs = billData.globalCosts || [];
            const cur = billData.currency || 'PLN';
            const header = document.getElementById('global-costs-header');
            const tear = document.getElementById('global-tear');
            const tearTop = document.getElementById('global-tear-top');

            // W trybie „ze swoimi kosztami" te wpisy stoją na wspólnym wydruku razem
            // z pozycjami — tutaj nie mają czego robić drugi raz.
            const pokaz = billSplitMode(billData) === 'even' && costs.length > 0;
            if (section) section.classList.toggle('hidden', !pokaz);
            if (!pokaz) {
                list.className = '';
                if (tear) tear.classList.add('hidden');
                if (tearTop) tearTop.classList.add('hidden');
                list.innerHTML = '';
                return;
            }

            if (header) {
                header.innerHTML = `
                    <div class="mb-3">
                        <h3 class="font-display text-xl font-extrabold tracking-tight">Pozycje dla wszystkich (${costs.length})</h3>
                        <p class="text-sm text-ink-2 mt-1">Ten rachunek dzieli się po równo, więc te kwoty i tak rozłożyłyby się tak samo, gdyby siedziały w kwocie rachunku. Zostały z wcześniejszej wersji aplikacji — możesz je tu usunąć i doliczyć do kwoty wyżej.</p>
                    </div>`;
            }

            if (tear) tear.classList.remove('hidden');
            if (tearTop) tearTop.classList.remove('hidden');
            list.className = 'receipt card overflow-hidden';
            const heads = activeHeadCount();
            list.innerHTML = costs.map((gc) => forAllLineHtml(gc, {
                heads,
                cur,
                akcja: `<button class="remove-global-cost-btn w-11 h-11 rounded-full flex items-center justify-center text-ink-3 flex-shrink-0" data-cost-id="${gc.id}" title="Usuń pozycję" aria-label="Usuń pozycję dla wszystkich: ${escapeHtml(gc.description)}"><i class="fas fa-trash text-xs"></i></button>`,
            })).join('');
        };

        const resetItemSearch = () => {
            const box = document.getElementById('item-search-wrap');
            if (!box) return;
            const input = box.querySelector('.person-search-input');
            if (input) input.value = '';
            // Pole wraca do postaci zwiniętej: nowy rachunek zaczyna się od paragonu,
            // nie od otwartego pola szukania.
            box.classList.remove('is-open');
            const toggle = box.querySelector('.person-search-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
            applyItemFilter();
        };

        // --- Faza 7B: odczyt paragonu przez AI ---
        // Zdjęcia z rachunku lecą do Cloud Function (klucz API nigdy nie dotyka przeglądarki),
        // a odpowiedź modelu przechodzi przez sito w receipt.js, zanim pokażemy ją do akceptacji.
        let receiptDraft = null; // { items:[{...,__use}], modifiers:[{...,__use}], receiptTotal }

        const RECEIPT_MODELS = [
            { id: 'google/gemini-3.1-flash-lite', label: 'Szybki (domyślny)' },
            { id: 'google/gemini-3.5-flash', label: 'Dokładniejszy' },
            { id: 'anthropic/claude-sonnet-5', label: 'Najdokładniejszy' },
        ];
        let receiptModel = RECEIPT_MODELS[0].id;

        // Zmniejszenie przed wysyłką: mniej tokenów obrazu = taniej i szybciej, a paragon
        // pozostaje czytelny. Model i tak nie skorzysta z pełnej rozdzielczości aparatu.
        // Zdjęcie pobieramy przez fetch i wczytujemy jako blob: — inaczej obrazek ze Storage
        // nie przechodzi przez `crossOrigin` (brak nagłówka CORS na emulatorze), a bez niego
        // canvas zostaje „skażony" i toDataURL rzuca wyjątkiem. Blob jest same-origin, więc działa.
        const downscaleImage = async (url, maxSide = 1600) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Nie udało się pobrać zdjęcia.');
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            try {
                const img = await new Promise((resolve, reject) => {
                    const el = new Image();
                    el.onload = () => resolve(el);
                    el.onerror = () => reject(new Error('Nie udało się wczytać zdjęcia.'));
                    el.src = objectUrl;
                });
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.85);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };

        const renderParseReceiptButton = () => {
            const btn = document.getElementById('parse-receipt-btn');
            const note = document.getElementById('parse-receipt-note');
            if (!btn || !note) return;
            const count = (billData && billData.photos || []).length;
            btn.classList.toggle('hidden', count === 0);
            note.textContent = count === 0 ? '' : (count === 1
                ? 'Model przepisze paragon na pozycje. Zawsze możesz je poprawić przed dodaniem.'
                : `${count} zdjęcia zostaną potraktowane jako jeden paragon.`);
        };

        const runParseReceipt = async () => {
            const photos = (billData && billData.photos) || [];
            if (photos.length === 0) { showToast('Najpierw dodaj zdjęcie paragonu.', true); return; }

            const btn = document.getElementById('parse-receipt-btn');
            const label = document.getElementById('parse-receipt-label');
            btn.disabled = true;
            label.textContent = 'Czytam paragon…';
            try {
                const images = [];
                for (const p of photos.slice(0, 5)) {
                    images.push(await downscaleImage(p.url));
                }
                const call = httpsCallable(functions, 'parseReceipt', { timeout: 180000 });
                const res = await call({ images, model: receiptModel });
                const normalized = normalizeReceipt(res.data && res.data.raw);
                if (normalized.items.length === 0 && normalized.modifiers.length === 0) {
                    showToast('Nie udało się odczytać żadnej pozycji. Spróbuj wyraźniejszego zdjęcia.', true);
                    return;
                }
                receiptDraft = {
                    ...normalized,
                    items: normalized.items.map(i => ({ ...i, __use: true })),
                    modifiers: normalized.modifiers.map(m => ({ ...m, __use: true })),
                };
                renderReceiptPreview();
                document.getElementById('receipt-preview-modal').classList.add('active');
            } catch (err) {
                console.error('[Billiada] Odczyt paragonu nieudany:', err);
                showToast(err && err.message ? err.message : 'Nie udało się odczytać paragonu.', true);
            } finally {
                btn.disabled = false;
                label.textContent = 'Odczytaj paragon';
            }
        };

        // Waluta odczytana z paragonu kontra waluta rachunku. Model bywa pewny siebie,
        // więc dopuszczamy WYŁĄCZNIE waluty, które aplikacja realnie obsługuje — inaczej
        // przycisk proponowałby ustawienie czegoś, czego nie da się rozliczyć.
        const RECEIPT_CURRENCIES = ['PLN', 'EUR', 'USD'];

        const renderReceiptCurrencyNote = () => {
            const note = document.getElementById('receipt-currency-note');
            const text = document.getElementById('receipt-currency-text');
            const btn = document.getElementById('receipt-currency-apply');
            if (!note || !text || !btn) return;
            const billCur = (billData && billData.currency) || 'PLN';
            const seen = receiptDraft && receiptDraft.currency;
            const usable = seen && RECEIPT_CURRENCIES.includes(seen) && seen !== billCur;
            note.classList.toggle('hidden', !usable);
            if (!usable) return;
            text.innerHTML = `Na paragonie widać <b>${escapeHtml(seen)}</b>, a rachunek jest w <b>${escapeHtml(billCur)}</b>. Kurs zapisze się z dzisiaj.`;
            btn.textContent = `Ustaw ${seen}`;
            btn.onclick = async () => {
                btn.disabled = true;
                try {
                    const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                    await updateDoc(billDocRef, await currencyPatch(seen));
                    showToast(`Waluta rachunku: ${seen}.`);
                    note.classList.add('hidden');
                } catch (err) {
                    console.error('[Billiada] Zmiana waluty z paragonu nieudana:', err);
                    showToast('Nie udało się zmienić waluty.', true);
                } finally {
                    btn.disabled = false;
                }
            };
        };

        const renderReceiptPreview = () => {
            if (!receiptDraft) return;
            const cur = (billData && billData.currency) || 'PLN';
            renderReceiptCurrencyNote();
            const wrap = document.getElementById('receipt-preview-items');

            // OZNACZENIE IDZIE NA WIERSZ, NIE POD LISTĘ.
            //
            // Zgłoszenie z 2026-08-25: paragon na 183 EUR pokazywał sumę pozycji 210,50,
            // bo „opłata za nakrycie" 27,50 trafiła na listę dwa razy. Ostrzeżenie o
            // różnicy stało POD listą kilkunastu pozycji, więc znalezienie winnej linii
            // było zadaniem dla człowieka. Teraz podejrzany wiersz mówi o sobie sam.
            //
            // ZNACZNIK, NIE KASOWANIE: pozycja zostaje zaznaczona i nietknięta, bo dwie
            // takie same bywają czasem prawdą, a cicho usunięta linia zaniża rachunek
            // płatnikowi. Wszystkie pola są edytowalne, więc poprawka to jedno stuknięcie.
            const flags = receiptItemFlags(receiptDraft.items, receiptDraft.receiptTotal);
            const ISSUE_TEXT = {
                duplicate: 'Ta pozycja jest na liście dwa razy — zostawić obie?',
                'over-total': 'Ta pozycja jest większa niż cały paragon. Sprawdź przecinek.',
                'summary-line': 'To wygląda na linię podsumowania, nie na pozycję.',
            };

            wrap.innerHTML = receiptDraft.items.map((it, i) => {
                const issues = flags[i] || [];
                const note = issues.length
                    ? `<p class="text-xs text-owe mt-1 pl-7">${escapeHtml(ISSUE_TEXT[issues[0]] || '')}</p>`
                    : '';
                return `
                <div class="p-2 rounded-lg ${it.__use ? '' : 'opacity-50'}">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" class="rp-use w-5 h-5 flex-shrink-0 accent-ink" data-i="${i}" ${it.__use ? 'checked' : ''}>
                        <input type="text" class="rp-name field flex-grow min-w-0 p-1.5" data-i="${i}" value="${escapeHtml(it.description)}">
                        <input type="number" min="1" step="1" class="rp-qty field w-14 p-1.5 text-center" data-i="${i}" value="${it.quantity}">
                        <input type="text" inputmode="decimal" class="rp-amount field w-24 p-1.5 text-right font-semibold" data-i="${i}" value="${String(it.amount.toFixed(2)).replace('.', ',')}">
                        <span class="text-xs text-ink-3 flex-shrink-0">${cur}</span>
                    </div>
                    ${note}
                </div>`;
            }).join('');

            const modWrap = document.getElementById('receipt-preview-modifiers-wrap');
            modWrap.classList.toggle('hidden', receiptDraft.modifiers.length === 0);
            document.getElementById('receipt-preview-modifiers').innerHTML = receiptDraft.modifiers.map((m, i) => `
                <div class="flex items-center gap-2 p-2 rounded-lg ${m.__use ? '' : 'opacity-50'}">
                    <input type="checkbox" class="rp-mod-use w-5 h-5 flex-shrink-0 accent-ink" data-i="${i}" ${m.__use ? 'checked' : ''}>
                    <span class="flex-grow min-w-0 truncate">${escapeHtml(m.description)}</span>
                    <span class="amount ${Number(m.value) < 0 ? 'text-due' : 'text-ink-2'}">${m.type === 'percent' ? `${Number(m.value)}%` : fmtMoney(toGrosze(m.value), cur)}</span>
                </div>`).join('');

            renderReceiptPreviewSummaryOnly();
        };

        // Odświeża TYLKO podsumowanie i ostrzeżenie — bez ruszania pól, żeby nie wyrzucić
        // kursora z edytowanego pola przy każdym wpisanym znaku (ten sam problem, co withFocusPreserved).
        const renderReceiptPreviewSummaryOnly = () => {
            if (!receiptDraft) return;
            const cur = (billData && billData.currency) || 'PLN';
            const usedItems = receiptDraft.items.filter(i => i.__use);
            const sumG = usedItems.reduce((s, i) => s + toGrosze(i.amount), 0);
            document.getElementById('receipt-preview-summary').innerHTML =
                `Wybrano <b>${usedItems.length}</b> z ${receiptDraft.items.length} pozycji na <b>${fmtMoney(sumG, cur)}</b>`;

            const warn = document.getElementById('receipt-preview-warning');
            const ask = document.getElementById('receipt-total-ask');
            const applyBtn = document.getElementById('apply-receipt-btn');
            const totalG = receiptDraft.receiptTotal ? toGrosze(receiptDraft.receiptTotal) : 0;
            // Modyfikatory procentowe liczą się od sumy pozycji — bez tego serwis „10%" wyglądałby
            // jak brakująca linia i wywoływał fałszywy alarm (a fałszywe alarmy uczą ignorować ostrzeżenia).
            const modsG = receiptDraft.modifiers
                .filter(m => m.__use)
                .reduce((s, m) => s + (m.type === 'percent' ? Math.round(sumG * m.value / 100) : toGrosze(m.value)), 0);

            const check = receiptCheck(sumG, modsG, totalG);
            if (ask) ask.classList.toggle('hidden', check.status !== 'no-total');

            if (check.status === 'diff') {
                // ZNAK RÓŻNICY ROZSTRZYGA, CZEGO SZUKAĆ, więc musi być w treści.
                // Stało tu jedno zdanie na oba kierunki — „sprawdź, czy któraś linia nie
                // umknęła" — czyli rada, żeby szukać BRAKUJĄCEJ pozycji. Przy duplikacie
                // (zgłoszenie z 2026-08-25) kierowała dokładnie w przeciwną stronę:
                // człowiek szukał czegoś, czego nie było, i zatwierdził odczyt.
                const nadmiar = check.diffG > 0;
                warn.className = 'mb-3 text-sm rounded-block p-3 text-owe bg-owe/10';
                warn.innerHTML = `<i class="fas fa-triangle-exclamation mr-1" aria-hidden="true"></i>${
                    nadmiar
                        ? `Pozycje przewyższają sumę z paragonu o <b>${fmtMoney(Math.abs(check.diffG), cur)}</b>. Poszukaj linii wpisanej dwa razy.`
                        : `Pozycjom brakuje <b>${fmtMoney(Math.abs(check.diffG), cur)}</b> do sumy z paragonu. Sprawdź, czy któraś linia nie umknęła.`
                } Razem wychodzi ${fmtMoney(check.sumG, cur)}, a paragon mówi ${fmtMoney(totalG, cur)}.`;
            } else if (check.status === 'ok') {
                // Zgodność też jest informacją — i to tą, po której wolno klikać bez czytania.
                warn.className = 'mb-3 text-sm rounded-block p-3 text-due bg-due/10';
                warn.innerHTML = `<i class="fas fa-circle-check mr-1" aria-hidden="true"></i>Zgadza się z sumą z paragonu co do grosza.`;
            } else {
                warn.className = 'hidden mb-3 text-sm rounded-block p-3';
            }

            // PRZYCISK NAZYWA, CO ROBI. Nie blokujemy zatwierdzenia — różnica bywa prawdziwa
            // i człowiek o tym wie — ale zgoda na rozjazd ma być świadoma, a nie odruchowa.
            if (applyBtn) {
                applyBtn.textContent = check.status === 'diff'
                    ? `Dodaj mimo różnicy ${fmtMoney(Math.abs(check.diffG), cur)}`
                    : 'Dodaj do rachunku';
            }
        };

        const applyReceiptDraft = async () => {
            if (!receiptDraft || !billData) return;
            const items = receiptDraft.items.filter(i => i.__use);
            const mods = receiptDraft.modifiers.filter(m => m.__use);
            if (items.length === 0 && mods.length === 0) { showToast('Nie wybrano żadnej pozycji.', true); return; }

            // Dopisanie odczytu z paragonu też idzie transakcją: ktoś mógł w tym czasie
            // dodać pozycję ręcznie albo stuknąć kafelek, a zapis z lokalnej kopii by to skasował.
            const newItems = receiptItemsToSharedCosts(items, generateId);
            const newMods = receiptModifiersToGlobalCosts(mods, generateId);
            const billRef = itemsDocRef();
            const buildUpdates = (data) => {
                const updates = {};
                if (newItems.length) updates.sharedCosts = [...(data.sharedCosts || []), ...newItems];
                if (newMods.length) updates.globalCosts = [...(data.globalCosts || []), ...newMods];
                return updates;
            };
            try {
                await runTransaction(db, async (tx) => {
                    const snap = await tx.get(billRef);
                    if (!snap.exists()) return;
                    tx.update(billRef, buildUpdates(snap.data()));
                });
            } catch (err) {
                console.warn('[Billiada] Transakcja paragonu nieudana — zapis awaryjny:', err);
                await updateDoc(billRef, buildUpdates(billData));
            }
            document.getElementById('receipt-preview-modal').classList.remove('active');
            receiptDraft = null;
            showToast(`Dodano ${items.length} pozycji z paragonu.`);
        };

        // Edytor pozycji — ten sam modal dodaje i edytuje (editingItemId = null → dodawanie).
        let editingItemId = null;
        // Czy edytowana pozycja jest „dla wszystkich" (dawny koszt wspólny) i — przy takiej —
        // czy jej wartość jest kwotą, czy procentem kwoty rachunku. Stan arkusza, nie danych:
        // do bazy trafia dopiero przy zapisie, do właściwej tablicy.
        let editingItemForAll = false;
        let editingItemValueMode = 'amount';

        // Przełącznik „Dla wszystkich" przestawia CAŁY arkusz, bo pozycja dla wszystkich
        // odpowiada na inne pytania: nie „kto to wziął" (nikt nie musi stukać) i nie „ile
        // sztuk" (napiwek nie ma sztuk), za to na „kwota czy procent rachunku".
        const syncItemForAllUi = () => {
            const toggle = document.getElementById('item-for-all');
            if (toggle) toggle.setAttribute('aria-pressed', String(editingItemForAll));
            const ludzie = document.getElementById('item-people-block');
            if (ludzie) ludzie.classList.toggle('hidden', editingItemForAll);
            const ilosc = document.getElementById('item-quantity-wrap');
            if (ilosc) ilosc.classList.toggle('hidden', editingItemForAll);
            const trybWrap = document.getElementById('item-value-mode-wrap');
            if (trybWrap) trybWrap.classList.toggle('hidden', !editingItemForAll);
            document.querySelectorAll('.item-value-mode-btn').forEach((b) => {
                b.setAttribute('aria-pressed', String(b.dataset.valueMode === editingItemValueMode));
            });
            const procent = editingItemForAll && editingItemValueMode === 'percent';
            const etykieta = document.getElementById('item-amount-label');
            if (etykieta) etykieta.textContent = procent
                ? 'Ile procent kwoty rachunku'
                : (editingItemForAll ? 'Kwota do podziału po równo' : 'Cena łączna, jak na paragonie');
            const jednostka = document.getElementById('item-amount-currency');
            if (jednostka) jednostka.textContent = procent ? '%' : (billData ? (billData.currency || 'PLN') : 'PLN');
            const pole = document.getElementById('shared-cost-amount');
            if (pole) pole.placeholder = procent ? 'np. 10' : '0,00';
        };

        const openItemModal = (itemId) => {
            if (!billData) return;
            editingItemId = itemId || null;
            let item = itemId ? (billData.sharedCosts || []).find(i => i.id === itemId) : null;
            // Ołówek przy linii „dla wszystkich" niesie ten sam identyfikator, co przy
            // pozycji imiennej — szukamy więc w obu tablicach i z miejsca znalezienia
            // bierzemy tryb arkusza.
            const forAllItem = (!item && itemId) ? (billData.globalCosts || []).find(g => g.id === itemId) : null;
            editingItemForAll = !!forAllItem;
            editingItemValueMode = (forAllItem && forAllItem.type === 'percent') ? 'percent' : 'amount';

            document.getElementById('item-modal-title').textContent = (item || forAllItem) ? 'Edytuj pozycję' : 'Dodaj pozycję';
            document.getElementById('shared-cost-desc').value = (item || forAllItem)
                ? ((item || forAllItem).description || '')
                : '';
            document.getElementById('item-quantity').value = item ? itemQuantity(item) : 1;
            document.getElementById('shared-cost-amount').value = forAllItem
                ? String(forAllItem.value ?? '').replace('.', ',')
                : (item ? String(item.amount ?? '').replace('.', ',') : '');
            syncItemForAllUi();

            const picked = item ? itemPickers(item) : [];
            const wrap = document.getElementById('shared-cost-participants');
            wrap.innerHTML = Object.values(billData.participants || {})
                .filter(p => p.status !== 'not_applicable')
                .map(p => personRowHtml({ id: p.id, name: p.name, selected: picked.includes(p.id) }))
                .join('');
            // PASEK „WSZYSCY / NIKT" TAKŻE TUTAJ (zgłoszenie właściciela 2026-08-26).
            // Mechanizm istniał od 2026-08-18, ale zapalał go WYŁĄCZNIE licznik przy
            // wyszukiwarce nowego rachunku — więc przy dodawaniu pozycji dwudziestoosobowa
            // ekipa znaczyła dwadzieścia stuknięć, choć kod na to gotowy już był.
            // Domyślnie nikt nie jest zaznaczony i to zostaje: pozycję bierze ten, kto ją zjadł.
            const itemPeopleWrap = wrap.closest('.sheet-body') || wrap.parentElement;
            wrap.onclick = (e) => {
                const row = e.target.closest('.person-row');
                if (!row) return;
                row.setAttribute('aria-pressed', row.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
                syncPersonSearchCount(itemPeopleWrap);
            };
            syncPersonSearchCount(itemPeopleWrap);

            // Rozbicie na sztuki ma sens tylko dla istniejącej pozycji IMIENNEJ o ilości > 1.
            const splitBtn = document.getElementById('item-split-btn');
            splitBtn.classList.toggle('hidden', !(item && itemQuantity(item) > 1));

            // Kasowanie pokazujemy wyłącznie przy pozycji, która już istnieje — przy
            // dodawaniu nowej nie ma czego usuwać, a przycisk „Usuń" obok pustego
            // formularza tylko rozprasza.
            const deleteBtn = document.getElementById('item-delete-btn');
            const istnieje = item || forAllItem;
            deleteBtn.classList.toggle('hidden', !istnieje);
            deleteBtn.dataset.costId = istnieje ? istnieje.id : '';
            deleteBtn.onclick = async () => {
                if (!editingItemId) return;
                // Strażnik także tutaj: arkusz bywa otwarty minutę, a w tym czasie płatnik
                // po drugiej stronie może podzielić resztę. Kasowanie pozycji na zamrożonym
                // rachunku przesunęłoby kwoty, na podstawie których ktoś zrobił już przelew.
                if (refuseFrozen()) return;
                const id = editingItemId;
                const zDlaWszystkich = editingItemForAll;
                const removed = zDlaWszystkich
                    ? (billData.globalCosts || []).find(x => x.id === id)
                    : (billData.sharedCosts || []).find(x => x.id === id);
                document.getElementById('shared-cost-modal').classList.remove('active');
                if (zDlaWszystkich) {
                    await mutateBillItems(({ globalCosts }) => ({ globalCosts: globalCosts.filter(g => g.id !== id) }));
                } else {
                    await mutateItems((items) => items.filter(sc => sc.id !== id));
                }
                showToast('Pozycja usunięta.');
                logEvent({
                    type: 'item-remove',
                    billId: currentBillId,
                    label: `usunął/ęła pozycję „${removed ? removed.description : 'bez nazwy'}"`,
                });
            };

            document.getElementById('shared-cost-modal').classList.add('active');
        };

        const saveItemFromModal = async () => {
            // Strażnik także TUTAJ, nie tylko przy otwarciu arkusza: między stuknięciem
            // „Dodaj pozycję" a stuknięciem „Zapisz" płatnik po drugiej stronie mógł zdążyć
            // podzielić resztę, a wtedy rachunek jest zamrożony i ten zapis by go rozjechał.
            if (refuseFrozen()) return;
            const description = document.getElementById('shared-cost-desc').value.trim();
            const amount = parseLocalFloat(document.getElementById('shared-cost-amount').value);
            const quantity = Math.max(1, Math.trunc(parseLocalFloat(document.getElementById('item-quantity').value)) || 1);
            const sharedBy = selectedPersonIds('shared-cost-participants');
            if (!description) { showToast('Podaj nazwę pozycji.', true); return; }

            // POZYCJA DLA WSZYSTKICH IDZIE DO INNEJ TABLICY, bo liczy się inaczej: dzieli się
            // po równo na AKTUALNY skład (a nie na migawkę listy chętnych), nigdy nie zostaje
            // bez właściciela i umie być procentem. Tablicę `globalCosts` zostawiamy bez zmian
            // — to jest przebudowa POJĘCIA w interfejsie, nie migracja danych: matematyka
            // rachunków (functions/calc.js) i wszystkie jej testy zostają nietknięte.
            if (editingItemForAll) {
                const procent = editingItemValueMode === 'percent';
                if (!(amount > 0)) { showToast(procent ? 'Podaj procent.' : 'Podaj kwotę pozycji.', true); return; }
                if (procent && amount > 100) { showToast('Procent musi być w przedziale 0–100.', true); return; }
                const wpis = { id: editingItemId || generateId(), description, type: procent ? 'percent' : 'amount', value: amount };
                // JEDNA TRANSAKCJA NA OBIE TABLICE. Ta sama pozycja mogła przed chwilą być
                // imienna — przełącznik przenosi ją wtedy z `sharedCosts` do `globalCosts`,
                // a to musi być JEDEN zapis: w przerwie między dwoma pozycja istniałaby dwa
                // razy albo wcale. Do tego tablice biorą się ze ŚWIEŻEGO odczytu, więc
                // zapis nie kasuje stuknięć, które ekipa zrobiła w międzyczasie.
                await mutateBillItems(({ sharedCosts, globalCosts }) => {
                    const przeniesiona = !!editingItemId && sharedCosts.some(x => x.id === editingItemId);
                    return {
                        globalCosts: globalCosts.some(g => g.id === wpis.id)
                            ? globalCosts.map(g => (g.id === wpis.id ? wpis : g))
                            : [...globalCosts, wpis],
                        ...(przeniesiona ? { sharedCosts: sharedCosts.filter(x => x.id !== editingItemId) } : {}),
                    };
                });
                document.getElementById('shared-cost-modal').classList.remove('active');
                showToast(editingItemId ? 'Zapisano pozycję.' : 'Dodano pozycję.');
                logEvent({
                    type: editingItemId ? 'item-edit' : 'item-add',
                    billId: currentBillId,
                    label: `${editingItemId ? 'poprawił/a' : 'dodał/a'} pozycję dla wszystkich „${description}" (${procent ? `${amount}%` : fmtMoney(toGrosze(amount), billData.currency)})`,
                });
                editingItemId = null;
                return;
            }

            if (!(amount > 0)) { showToast('Podaj cenę pozycji.', true); return; }

            // Droga powrotna: pozycja przestała być „dla wszystkich". Też jedną transakcją,
            // z tego samego powodu, co wyżej — inaczej między wyjęciem ze starej tablicy
            // a wstawieniem do nowej rachunek na chwilę gubi tę kwotę, a przy zerwanej
            // sieci gubi ją na stałe.
            const newId = generateId();
            const wracaZDlaWszystkich = !!editingItemId
                && (billData.globalCosts || []).some(g => g.id === editingItemId);
            if (wracaZDlaWszystkich) {
                await mutateBillItems(({ sharedCosts, globalCosts }) => ({
                    globalCosts: globalCosts.filter(g => g.id !== editingItemId),
                    sharedCosts: [...sharedCosts, { id: newId, description, amount, quantity, sharedBy }],
                }));
                editingItemId = null;
            } else {
                await mutateItems((fresh) => {
                    const items = [...fresh];
                    if (editingItemId) {
                        const i = items.findIndex(x => x.id === editingItemId);
                        // Pozycja mogła w międzyczasie zniknąć (ktoś ją skasował) — nie wskrzeszamy jej.
                        if (i === -1) return items;
                        items[i] = { ...items[i], description, amount, quantity, sharedBy };
                    } else {
                        // Nowa pozycja bez wskazanych osób jest dozwolona — kafelek pokaże „nikt nie wybrał",
                        // a każdy dopisze się sam jednym stuknięciem. To główny przepływ przy paragonie.
                        items.push({ id: newId, description, amount, quantity, sharedBy });
                    }
                    return items;
                });
            }
            document.getElementById('shared-cost-modal').classList.remove('active');
            showToast(editingItemId ? 'Zapisano pozycję.' : 'Dodano pozycję.');
            logEvent({
                type: editingItemId ? 'item-edit' : 'item-add',
                billId: currentBillId,
                label: `${editingItemId ? 'poprawił/a' : 'dodał/a'} pozycję „${description}" (${fmtMoney(toGrosze(amount), billData.currency)})`,
            });
            editingItemId = null;
        };

        const splitEditedItem = async () => {
            const local = (billData.sharedCosts || []).find(x => x.id === editingItemId);
            if (!local) return;
            const partCount = itemQuantity(local);
            await mutateItems((fresh) => {
                const item = fresh.find(x => x.id === editingItemId);
                if (!item) return fresh;
                const parts = splitItemByUnits(item, generateId);
                return fresh.flatMap(x => (x.id === item.id ? parts : [x]));
            });
            document.getElementById('shared-cost-modal').classList.remove('active');
            showToast(`Rozbito na ${partCount} sztuk.`);
            editingItemId = null;
        };

        // ===================================================
        // ===== EKRAN RACHUNKU ZAAWANSOWANEGO (bill-screen) =====
        // ===================================================
        // Rozpiska udziału jednej osoby. U siebie pomijamy wiersz „koszt własny" — stoi
        // wyżej jako pole do wpisania i powtórzony niżej tylko myli. ŁĄCZNIE dostaje
        // nominał, bo to jedyna liczba z tej rozpiski, którą ktoś realnie czyta.
        // MOJA CZĘŚĆ — jedna liczba na wierzchu, rozpiska pod zwinięciem.
        //
        // Karta stoi teraz NAD paragonem (decyzja właściciela 2026-08-15), a to zmienia
        // zasadę: suma nad rzeczami, które ją tworzą, jest w porządku, ale ROZPISANA suma
        // nad nimi już nie — czytałoby się „Pozycje 96,00", zanim pozycje w ogóle będą
        // na ekranie. Dlatego na wierzchu zostaje wyłącznie odpowiedź („Twój udział"),
        // a skąd się wzięła, mówi zwijany wiersz dla tych, którzy pytają.
        // KWOTA NIEROZPISANA W ROZPISCE UDZIAŁU (zgłoszenie właściciela 2026-08-20).
        // „Twój udział 40,00" nad rozpiską „Pozycje 0,00 / Koszty wspólne 0,00" był liczbą,
        // której NIE DA SIĘ wyprowadzić z tego, co widać. Rozpiska obiecuje w podpisie, że
        // powie, z czego składa się kwota, i tej obietnicy nie dotrzymywała — a to jedyny
        // powód, dla którego ktoś przestaje ufać rozliczeniu. Brakującym składnikiem jest
        // udział w kwocie, której nikt nie wziął na siebie, czyli `pt.restAmount`.
        //
        // Podpis zależy od ŹRÓDŁA reszty, bo to dwie różne wiadomości:
        //   pozycje bez chętnego      -> „Nikt nie wziął", da się naprawić stuknięciem,
        //   różnica do kwoty rachunku -> „Reszta rachunku", nic nie jest zepsute.
        const restInfo = (calc) => {
            const kwota = calc.unallocated || 0;
            if (kwota <= 0.004) return null;
            const cur = (billData && billData.currency) || 'PLN';

            // KWOTA NICZYJA NIE JEST NICZYIM UDZIAŁEM (zgłoszenie właściciela 2026-08-26).
            //
            // Stało tu „na razie po równo" — pozostałość po założeniu, że reszta dzieli się
            // od pierwszej sekundy. Zdanie było mylące przy pieniądzach: człowiek, który nie
            // wybrał ani jednej pozycji, widział przy swoim imieniu kilkaset złotych i nie
            // wiedział, czy to jego dług, czy przypuszczenie aplikacji.
            //
            // Teraz przy własnym udziale NIE MA ŻADNEGO ZDANIA, dopóki nic się do niego nie
            // dolicza (decyzja właściciela 2026-08-26). Kwota jest po prostu prawdziwa:
            // płacisz za to, co stuknąłeś. Tłumaczenie należy się WYŁĄCZNIE wtedy, gdy do
            // udziału faktycznie coś doszło — i wtedy mówi, skąd to się wzięło.
            if (!calc.restDecided && (calc.restToIds || []).length === 0) return null;

            // Decyzja płatnika już zapadła — podpis ma to mówić, bo od niej wzięła się liczba.
            if (billData && billData.settleOpen === true) {
                return calc.restToEveryone
                    ? {
                        caption: 'Po równo (decyzja płatnika)',
                        note: `W tej kwocie jest ${fmtMoney(toGrosze(calc.perPersonUnallocated || 0), cur)} z pozycji, których nikt nie wziął — płatnik podzielił je po równo na całą ekipę.`,
                    }
                    : { caption: 'Przypisane Tobie', note: '' };
            }

            const sierot = calc.orphanCount || 0;
            // Pół grosza tolerancji: obie liczby idą przez złotówki, więc porównanie na
            // sztywną równość potrafiłoby pęknąć na groszu z kosztu procentowego.
            const tylkoSieroty = sierot > 0 && Math.abs((calc.orphanAmount || 0) - kwota) < 0.005;
            let note = '';
            if (sierot > 0) {
                note = `Na razie po równo: ${sierot} ${plural(sierot, 'pozycja', 'pozycje', 'pozycji')} bez właściciela. Zaznacz na paragonie, co jadłeś, a kwota się przeliczy.`;
            } else if ((calc.itemCount || 0) > 0) {
                note = 'Na razie po równo: pozycje nie spinają się z kwotą rachunku, więc różnica idzie na wszystkich.';
            }
            // Bez zdania, gdy nie ma ani jednej pozycji. Wtedy podział po równo jest CAŁĄ
            // treścią rachunku, a nie stanem przejściowym, i „na razie" siałoby niepokój
            // na każdym zwykłym rachunku dzielonym po równo.
            return { caption: tylkoSieroty ? 'Nikt nie wziął (po równo)' : 'Reszta rachunku (po równo)', note };
        };

        // Wiersze zerowe nie wchodzą do rozpiski. „Pozycje z paragonu 0,00" nie niesie nic
        // poza szumem, a na rachunku bez pozycji zostawiało trzy zera nad jedyną liczbą,
        // która coś znaczy. Reszta idzie na koniec, bo czyta się jak dopowiedzenie do tego,
        // co ktoś wybrał sam.
        // `zwinPojedynczy` tylko dla WŁASNEJ karty. Gdy zostaje jeden składnik, jest on co
        // do grosza tą samą liczbą, która stoi wyżej jako „Twój udział", a czym ta liczba
        // jest, mówi już zdanie nad rozwinięciem — powtarzanie jej w rozpisce niczego nie
        // tłumaczy. Na CUDZEJ karcie tego zdania nie ma (jest poleceniem, a nie opisem),
        // więc pojedynczy wiersz zostaje: bez niego kwota znów byłaby bez podpisu, czyli
        // dokładnie tym, co naprawiamy.
        const breakdownRows = (row, wiersze, rest, restAmount, zwinPojedynczy = false) => {
            const wszystkie = rest ? [...wiersze, [rest.caption, restAmount]] : wiersze;
            const niezerowe = wszystkie.filter(([, v]) => Math.abs(v || 0) >= 0.005);
            if (zwinPojedynczy && niezerowe.length < 2) return '';
            return niezerowe.map(([c, v]) => row(c, v)).join('');
        };

        // `settleHtml` — rozliczenie TEGO rachunku, na dole limonkowej karty (decyzja
        // właściciela 2026-08-26). Stało wcześniej osobną kartą pod spodem i przyciskiem
        // na liście rachunków; oba miejsca mówiły o tej samej kwocie, co widnieje wyżej
        // jako „Twój udział". Teraz kwota, to co z niej zostało i przycisk stoją razem,
        // w jednym bloku, na który człowiek i tak patrzy.
        // KTO DOSTAŁ RESZTĘ WSKAZANY PALCEM, MA PRAWO WIEDZIEĆ SKĄD TO SIĘ WZIĘŁO.
        //
        // Blok pokazuje się WYŁĄCZNIE osobie, której płatnik przypisał kwotę nierozpisaną
        // przy zamykaniu rachunku — i nigdy przy podziale po równo, gdzie nikt nie jest
        // wskazany, a ciężar niesie cała ekipa. Przycisk bez zdania nad nim byłby zaczepką;
        // ze zdaniem jest odpowiedzią na pytanie, które ta osoba i tak zadaje.
        const restClaimHtml = (bill, calculations, pt) => {
            if (!bill || bill.settleOpen !== true) return '';
            if (calculations.restToEveryone !== false) return '';
            if (!(calculations.restToIds || []).includes(pt.participant.id)) return '';
            if ((pt.restAmount || 0) <= 0.004) return '';
            const my = myMemberNow();
            if (!my || my.id !== pt.participant.id) return '';
            const ktoHtml = escapeHtml(memberName(bill.closedBy || bill.payerId));
            const sam = (bill.closedBy || bill.payerId) === my.id;
            return `<div class="mt-3 pt-3 border-t border-ink/10">
                <p class="text-sm text-ink-2"><b class="text-ink">${fmtMoney(toGrosze(pt.restAmount), bill.currency || 'PLN')}</b> z tej kwoty to nierozpisane pozycje, które ${sam ? 'przypisałeś/aś sobie przy zamykaniu rachunku' : `<strong>${ktoHtml}</strong> przypisał/a Tobie przy zamykaniu rachunku`}.</p>
                ${sam ? '' : `<button id="rest-dispute-btn" class="btn btn-quiet w-full mt-2">To nie moje</button>`}
            </div>`;
        };

        const myShareHtml = (pt, paymentInfo = '', rest = null, settleHtml = '', claimHtml = '') => {
            const cur = billData.currency;
            const row = (caption, amount) =>
                `<div class="flex justify-between gap-2 py-0.5"><span class="text-ink-2">${caption}</span><span class="font-semibold">${amount.toFixed(2).replace('.', ',')}</span></div>`;
            const conversion = getPlnConversionHtml(pt.total, cur, billData.exchangeRatePLN);
            const rows = breakdownRows(row, [
                ['Pozycje z paragonu', pt.sharedAmount],
                ['Dla wszystkich', pt.globalCostsAmount],
                ['Koszt tylko Twój', pt.individualAmount],
            ], rest, pt.restAmount, true);
            // ZNACZNIK „WSTĘPNIE" PRZY SAMEJ KWOCIE (zgłoszenie kolegi właściciela
            // 2026-08-25: „przy tego typu rachunku pokazuje, ile jest do zapłaty, jeszcze
            // przed zaznaczeniem pozycji, co może wprowadzić w błąd").
            //
            // Zdanie wyjaśniające stoi tu od 2026-08-20 i jest dobre — ale stoi POD kwotą,
            // a człowiek patrzy NA kwotę. Liczba wygląda przez to na ostateczną, choć jest
            // stanem przejściowym. Sama matematyka jest poprawna i celowa: kwota nierozpisana
            // dzieli się po równo, żeby reszta nie spadła po cichu na płatnika.
            // ZNACZNIK PRZY KWOCIE ZNIKNĄŁ (decyzja właściciela 2026-08-26).
            //
            // „Wstępnie" miało sens, gdy reszta doliczała się do udziału od pierwszej sekundy
            // — liczba była wtedy zgadywana. Od chwili, gdy kwota niczyja nie dolicza się
            // nikomu, ta liczba jest PRAWDZIWA: płacisz za to, co stuknąłeś. Ostrzeżenie przy
            // prawdziwej kwocie tylko siało niepokój u kogoś, kto zrobił wszystko dobrze.
            const wstepnie = '';
            return `<div class="mt-4 pt-3 border-t border-ink/10">
                <div class="flex items-baseline justify-between gap-3">
                    <span class="font-bold flex items-baseline gap-2 min-w-0">Twój udział ${wstepnie}</span>
                    <span class="text-2xl">${amountHtml(toGrosze(pt.total), cur, 'text-ink')}</span>
                </div>
                ${conversion ? `<p class="text-right text-xs text-ink-2 mt-0.5">${conversion}</p>` : ''}
                ${rest && rest.note ? `<p class="text-sm text-ink-2 mt-1">${rest.note}</p>` : ''}
                ${rows ? `<details class="mt-2">
                    <summary class="settle-others-summary">
                        <span>Z czego się składa</span>
                        <i class="fas fa-chevron-down settle-others-chevron ml-auto" aria-hidden="true"></i>
                    </summary>
                    <div class="mt-2 text-sm">${rows}</div>
                </details>` : ''}
                ${paymentInfo}
                ${claimHtml}
                ${settleHtml}
            </div>`;
        };

        // ROZLICZENIE TEGO RACHUNKU, OCZAMI DŁUŻNIKA — blok na dole limonkowej karty.
        //
        // Czerwony przycisk NA LIMONCE jest tu wyjątkiem od zasady „na limonce nie ma
        // czerwieni ani zieleni". Zasada dotyczy KOLORU TEKSTU, który na limonkowym tle
        // traci czytelność; pełna czerwona pigułka z białym napisem ma z limonką kontrast
        // wyższy niż z białą kartą. A czerwień znaczy w tej aplikacji jedno: pieniądze
        // wychodzą od Ciebie — więc przycisk musi ją nosić tak samo jak wszędzie indziej.
        //
        // POKAZUJE SIĘ TYLKO W TRYBIE RACHUNKOWYM. W planie minimalnym przelew za
        // pojedynczy rachunek rozjeżdża się z planem, którym gra reszta ekipy, i tworzy
        // dokładnie te wpłaty bez przypisania, które trzeba potem tłumaczyć osobnym blokiem.
        const myBillSettleHtml = (mine) => {
            // BRAMA IDZIE PRZED WSZYSTKIM INNYM — także przed `!mine`.
            // Rachunek, który się jeszcze uzupełnia, nie wchodzi do księgi długów
            // (`ledgerBills`), więc `mine` jest wtedy puste i bez tego warunku ekran
            // milczałby: ani kwoty, ani przycisku, ani powodu. Cisza w miejscu, gdzie
            // przed chwilą był przycisk, czyta się jak usterka.
            if (billData && !canSettleBill(billData) && billData.payerId !== (myMemberNow() || {}).id) {
                // Przycisk NIE jest `disabled`: wyłączony nie przyjmuje stuknięcia, więc nie
                // miałby jak powiedzieć, czemu nie działa. Wygląda na wyłączony, a stuknięcie
                // otwiera okno z powodem.
                return `<div class="mt-4 pt-3 border-t border-ink/10">
                    <button id="settle-locked-btn" class="btn btn-danger w-full opacity-50">Ureguluj</button>
                </div>`;
            }
            if (!mine) return '';
            if (mine.openG <= 0) {
                // Domknięcie pętli: kto oddał, ma to zobaczyć na rachunku, a nie domyślać
                // się z tego, że przycisk zniknął.
                return `<div class="mt-4 pt-3 border-t border-ink/10 flex items-center gap-2">
                    <i class="fas fa-check"></i>
                    <span class="text-sm font-bold">Za ten rachunek już oddałeś/aś.</span>
                </div>`;
            }
            if (groupSettlementMode() !== 'perBill') return '';
            // WIERSZ „ZOSTAJE DO ODDANIA" WCHODZI DOPIERO PO CZĘŚCIOWEJ WPŁACIE. Dopóki
            // nikt nic nie wpłacił, jest co do grosza tą samą liczbą, co „Twój udział"
            // dwa wiersze wyżej — a ta sama kwota podana dwa razy pod rząd każe szukać
            // różnicy, której nie ma. Sam przycisk wystarczy: kwota stoi tuż nad nim.
            const zostaje = mine.paidG > 0
                ? `<div class="flex items-baseline justify-between gap-3">
                        <span class="font-bold">Zostaje do oddania</span>
                        <span class="text-2xl">${amountHtml(mine.openG, mine.currency, 'text-ink')}</span>
                    </div>
                    <p class="text-sm text-ink-2 mt-1">Wpłacono już ${fmtMoney(mine.paidG, mine.currency)} z ${fmtMoney(mine.shareG, mine.currency)}.</p>`
                : '';
            return `<div class="mt-4 pt-3 border-t border-ink/10">
                ${zostaje}
                <button id="bill-settle-btn" class="btn btn-danger w-full ${zostaje ? 'mt-3' : ''}">Ureguluj</button>
            </div>`;
        };

        // Zdanie „na razie" zostaje wyłącznie na własnej karcie: jest poleceniem („zaznacz
        // na paragonie"), a na cudzej karcie nie ma go kto wykonać. Sam wiersz reszty wchodzi
        // tu tak samo, bo cudza kwota musi się dać wytłumaczyć tak samo jak własna.
        const participantBreakdownHtml = (pt, isMe, paymentInfo = '', rest = null) => {
            const cur = billData.currency;
            // `caption`, nie `label`: strażnik escapowania traktuje `label` jako daną z bazy
            // (bo w profilu metod płatności nią jest), a tu wchodzą wyłącznie napisy z kodu.
            const row = (caption, amount) =>
                `<div class="flex justify-between gap-2"><span class="text-ink-3">${caption}</span><span class="text-ink-2">${amount.toFixed(2).replace('.', ',')}</span></div>`;
            const rows = breakdownRows(row, [
                ...(isMe ? [] : [['Koszty własne', pt.individualAmount]]),
                ['Pozycje', pt.sharedAmount],
                ['Dla wszystkich', pt.globalCostsAmount],
            ], rest, pt.restAmount);
            return `<div class="mt-3 pt-3 border-t border-ink/10 text-sm space-y-0.5">
                ${rows}
                <div class="flex items-baseline justify-between gap-2 pt-2">
                    <span class="text-sm font-bold text-ink-3">Łącznie</span>
                    <span class="text-2xl">${amountHtml(toGrosze(pt.total), cur, 'text-ink')}</span>
                </div>
                <div class="text-right text-xs text-ink-3">${getPlnConversionHtml(pt.total, cur, billData.exchangeRatePLN)}</div>
                ${paymentInfo}
            </div>`;
        };

        // CZY TA OSOBA ODDAŁA ZA TEN RACHUNEK — znacznik do wiersza „Ekipy".
        //
        // Stała tu do 2026-08-26 osobna sekcja „Kto już oddał", czyli DRUGA lista tych
        // samych ludzi, dwa ekrany pod pierwszą. Zgłoszenie właściciela: niepotrzebna,
        // te statusy mają siedzieć przy osobach, w zwijanej „Ekipie" — tam, gdzie i tak
        // stoją wszystkie szczegóły uczestnika.
        //
        // WYŁĄCZNIE W TRYBIE RACHUNKOWYM. W planie minimalnym wpłaty idą trasami, których
        // żaden rachunek nie stworzył, więc zdanie „oddał za TEN rachunek" nie ma się
        // z czego wziąć — dokładnie z tego powodu w tym trybie nie ma też statusu na
        // liście rachunków ani filtra „Do oddania". Jedna reguła, trzy miejsca.
        const billSettledMarkHtml = (rozliczeni, participantId) => {
            if (groupSettlementMode() !== 'perBill') return '';
            const x = (rozliczeni || []).find((r) => r.debtor === participantId);
            if (!x) return ''; // płatnik albo rachunek jeszcze bez długów

            // CZWARTY STAN CHIPA (2026-08-29). Do tej pory niepotwierdzona wpłata pokazywała
            // przy osobie „Oddał/a" — nie do odróżnienia od potwierdzonej. Chip mówił więc
            // o pieniądzach rzecz, której nikt jeszcze nie potwierdził, i to w miejscu,
            // które ma odpowiadać na pytanie „kto już oddał".
            const moje = latestSettlements.filter((s) => {
                if (!s || s.from !== participantId || s.to !== billData.payerId) return false;
                const ids = Array.isArray(s.billIds) ? s.billIds : (s.billId ? [s.billId] : []);
                return ids.includes(currentBillId);
            });
            const sporna = moje.find((s) => [SETTLE_DISPUTED, SETTLE_INSISTED, SETTLE_STALLED].includes(settlementState(s)));
            if (sporna) return `<span class="chip flex-shrink-0"><i class="fas fa-eye"></i>Do wyjaśnienia</span>`;
            const czeka = moje.find((s) => settlementState(s) === SETTLE_PENDING);
            if (czeka && x.settled) return `<span class="chip text-info flex-shrink-0"><i class="fas fa-hourglass-half"></i>Czeka na Ciebie</span>`;

            return x.settled
                ? `<span class="chip text-due flex-shrink-0"><i class="fas fa-check"></i>Oddał/a</span>`
                : `<span class="chip text-owe flex-shrink-0"><i class="fas fa-circle-exclamation"></i>Zostaje ${fmtMoney(x.openG, x.currency)}</span>`;
        };

        // STOSY SPRAW NA EKRANIE RACHUNKU — ten sam wzorzec, co w Rozliczeniach, tylko
        // zawężony do tego jednego rachunku. Znajomi właściciela lubią rozliczać się
        // rachunek po rachunku, więc to musi być tam tak samo czytelne.
        //
        // DWA STOSY ZAMIAST TRZECH: nie ma „Czekasz na przelew". Powód stoi w komentarzu
        // przy dzwonku i jest starszy niż ta funkcja — przypomnienie idzie DO OSOBY, na całą
        // jej zaległość, a nie do rachunku. Kto nie oddał za trzy kolacje, ma dostać jedno
        // przypomnienie na sumę, a nie trzy pod rząd. Ci ludzie są tu widoczni tam, gdzie
        // już są: jako chip przy imieniu w „Ekipie".
        const renderBillStacks = (myId) => {
            const wrap = document.getElementById('bill-stacks');
            if (!wrap) return;
            // Wpłata „należy" do rachunku, jeśli go wskazuje. W planie minimalnym przelew
            // nie należy do żadnego, więc tam ten blok z definicji milczy.
            const tegoRachunku = (s) => {
                const ids = Array.isArray(s.billIds) ? s.billIds : (s.billId ? [s.billId] : []);
                return ids.includes(currentBillId);
            };
            const doPotwierdzenia = settlementsAwaitingMe(myId).filter(tegoRachunku);
            // Udział tej osoby w TYM rachunku — bierzemy go z księgi, żeby liczba zgadzała
            // się co do grosza z tym, co ta osoba widzi u siebie na rachunku.
            const wiersze = billSettledBy(perBillNow(), currentBillId);
            const billCtxFor = (x) => {
                const w = wiersze.find((r) => r.debtor === x.from);
                return w ? { udzialG: w.shareG, currency: w.currency } : null;
            };
            const spory = [...disputesAsPayee(myId).filter(tegoRachunku), ...disputesAsDebtor(myId).filter(tegoRachunku)];

            // CZEKASZ NA PRZELEW — TEN SAM STOS, CO W ROZLICZENIACH, ale zawężony do tego
            // jednego rachunku (na wniosek właściciela 2026-08-29: „wszystko, co da się
            // zrobić w Rozliczeniach, powinno być widoczne w Rachunkach i możliwe do
            // realizacji" — bo część ekipy rozlicza się rachunek po rachunku i do zakładki
            // Rozliczeń praktycznie nie zagląda).
            //
            // Brakowało tu dokładnie jednej rzeczy: przypomnienia. Dłużnik miał na rachunku
            // limonkową kartę „Twój udział" z przyciskiem „Ureguluj", a płatnik widział
            // wyłącznie zwinięty spis „Ekipa: 14 osób · oddało 2 z 14" — czyli wiedział,
            // kto nie oddał, i nie mógł z tym zrobić nic bez wyjścia na inną zakładkę.
            //
            // WYŁĄCZNIE W TRYBIE RACHUNKOWYM. W planie „Najmniej przelewów" pieniądze idą
            // trasami, których ten rachunek nie stworzył, więc „czekasz na przelew ZA TEN
            // rachunek" byłoby zdaniem, którego nie da się uczciwie obronić — a „Oddał/a mi
            // już" zapisałoby wpłatę, która niczego tam nie gasi.
            const per = perBillNow();
            const czekamNa = groupSettlementMode() === 'perBill'
                ? (per.rows || []).filter((r) => r.billId === currentBillId && r.payer === myId && r.openG > 0)
                : [];
            const kartyCzekam = czekamNa.map((r) => personCard(
                { other: r.debtor, currency: r.currency, sumaG: r.openG, rachunki: [r] },
                { kierunek: 'due', sporneG: sporneWobec(disputesAsPayee(myId).filter(tegoRachunku), r.debtor, r.currency) },
            ));

            const html = [
                doPotwierdzenia.length
                    ? stackHtml({ name: `bill-confirm-${currentBillId}`, title: 'Do potwierdzenia', tone: 'is-info', items: doPotwierdzenia.map((x) => payeeCard(x, billCtxFor(x))) })
                    : '',
                spory.length
                    ? `<div class="mt-4">${stackHtml({
                        name: `bill-disputes-${currentBillId}`, title: 'Do wyjaśnienia',
                        items: spory.map((s) => (s.to === myId ? payeeCard(s) : debtorDisputeCard(s))),
                    })}</div>`
                    : '',
                kartyCzekam.length
                    ? `<div class="mt-4">${stackHtml({
                        name: `bill-waiting-${currentBillId}`, title: 'Czekasz na przelew', tone: 'is-due',
                        items: kartyCzekam,
                    })}</div>`
                    : '',
            ].filter(Boolean).join('');

            wrap.innerHTML = html;
            wrap.classList.toggle('hidden', !html);
            applyStackMorph();
        };

        const renderBillScreen = async () => {
            if (!billData || !groupData) return;
            
            if (!exchangeRates || exchangeRates.base !== billData.currency) {
                await fetchExchangeRates(billData.currency);
            }

            const myGroupMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const isCurrentUserThePayer = myGroupMember && billData.payerId === myGroupMember.id;
            const isPayerConfirmed = billData.payerConfirmed === true;
            
            // FIX: Allow payer to edit main fields even after confirmation.
            const canEditMainFields = !isPayerConfirmed || isCurrentUserThePayer;
            // KTO może zmieniać główne pola, a CZY TERAZ WOLNO, to dwa różne pytania.
            // Na zamkniętym rachunku kwota, waluta i tryb podziału są zamrożone tak samo jak
            // pozycje (`billFrozen`): każde z tych pól przelicza cudze udziały, a ludzie mogli
            // już na ich podstawie zrobić przelew. Droga jest jedna — otworzyć rachunek.
            const billIsFrozen = billFrozen(billData);
            const canEditNow = canEditMainFields && !billIsFrozen;
            const canConfirm = isCurrentUserThePayer && !isPayerConfirmed;

            // PYTANIE DO WSKAZANEGO PŁATNIKA, zadane raz przy wejściu na rachunek.
            // Baner na górze ekranu zostaje jako przypomnienie, ale to okno jest tym,
            // czego nie da się przewinąć obok. Bez potwierdzenia rachunek nie wchodzi
            // do rozliczeń, więc pytanie musi być trudniejsze do przeoczenia niż sam
            // rachunek. Pytamy RAZ na wejście: przy każdym przerysowaniu (a te lecą
            // po każdym cudzym stuknięciu w paragon) okno wracałoby jak czkawka.
            if (canConfirm && payerClaimAskedFor !== currentBillId) {
                payerClaimAskedFor = currentBillId;
                openPayerClaim();
            }

            // NAZWA. Przy otwartym polu nagłówka NIE ruszamy: ten ekran przerysowuje się
            // po każdym cudzym stuknięciu w paragon, więc zabierałby litery w trakcie pisania.
            // Gdy pole straciło ognisko inaczej niż przez `blur` (wyjście z ekranu), stan
            // sam wraca do normy — inaczej nagłówek następnego rachunku zostałby stary.
            if (billNameEditing && document.activeElement !== billNameInputEl()) billNameEditing = false;
            if (!billNameEditing) {
                document.getElementById('bill-name').textContent = billData.billName;
                showBillNameEditor(false);
            }
            
            const currencySelect = document.getElementById('currency-select');
            currencySelect.dataset.value = billData.currency;
            document.getElementById('currency-select-label').textContent = billData.currency;
            currencySelect.disabled = !canEditNow;
            
            const totalAmountInput = document.getElementById('total-bill-amount');
            if (document.activeElement !== totalAmountInput) {
                // Przecinek, nie kropka — ta sama notacja, co we wszystkich kwotach obok.
                totalAmountInput.value = billData.totalAmount > 0
                    ? billData.totalAmount.toFixed(2).replace('.', ',')
                    : '';
            }
            totalAmountInput.disabled = !canEditNow;
            
            const payerSelect = document.getElementById('payer-select');
            // „Nikt" brzmiało jak stwierdzenie faktu („nikt nie zapłacił"), a to jest
            // pole do wypełnienia. Zachęta mówi, co zrobić.
            const currentPayer = billData.payerId ? (billData.participants || {})[billData.payerId] : null;
            payerSelect.dataset.value = billData.payerId || '';
            const payerLabel = document.getElementById('payer-select-label');
            // TWARZ, NIE SAMO IMIĘ (zgłoszenie właściciela 2026-08-29). Znak z kolorem
            // rozpoznaje się szybciej niż napis, a w całej reszcie aplikacji — na liście
            // rachunków, przy pozycjach paragonu, w rozliczeniach — ta sama osoba ma przy
            // sobie tę samą twarz. Pole „Kto wyłożył pieniądze" było jedynym miejscem,
            // gdzie zostawało samo imię, więc czytało się jak coś innego niż wszędzie indziej.
            if (currentPayer) {
                payerLabel.innerHTML = `<span class="flex items-center min-w-0">${avatarHtml(currentPayer.name, billData.payerId, 'w-7 h-7 text-xs mr-2')}<span class="truncate">${escapeHtml(currentPayer.name)}</span></span>`;
            } else {
                payerLabel.textContent = 'Wskaż osobę…';
            }
            payerLabel.classList.toggle('text-ink-3', !currentPayer);
            // Payer selection should be locked after confirmation to avoid confusion.
            payerSelect.disabled = isPayerConfirmed;

            const confirmationBanner = document.getElementById('payer-confirmation-banner-advanced');
            // Wyjście awaryjne płatnika, doklejane do banera „Można się rozliczać" (niżej).
            let cofnijZamkniecieHtml = '';
            // BANER MÓWI, CO BLOKUJE ROZLICZENIE — także wtedy, gdy piłka jest po cudzej
            // stronie (poprawka 2026-08-17 po uwadze właściciela o nowym użytkowniku).
            //
            // Rachunek bez POTWIERDZONEGO płatnika nie tworzy ani jednego długu
            // (`computeBillDebts` zwraca wtedy pustą listę), więc nie wchodzi do Bilansu
            // ani do zakładki „Rozliczenia". Do tej pory ekran mówił o tym tylko płatnikowi.
            // Wszyscy pozostali widzieli PUSTY baner: rachunek stał, kwota się zgadzała,
            // a rozliczenia go nie widziały i nic nie tłumaczyło dlaczego. Dla kogoś, kto
            // widzi aplikację pierwszy raz, wygląda to jak usterka.
            if (canConfirm) {
                // Ta gałąź była JEDYNĄ bez znaczka stanu, więc jej tekst startował w innym
                // miejscu niż w czterech pozostałych — i to ona najbardziej psuła wrażenie
                // przypadkowości. Dostaje znaczek „Twój ruch": mówi to samo, co błękit
                // `action` w `billStatus`, czyli że czekamy dokładnie na tę osobę.
                confirmationBanner.innerHTML = billBannerHtml({
                    chipClass: 'chip text-info',
                    chip: 'Twój ruch',
                    title: 'Ten rachunek nie wchodzi jeszcze do rozliczeń.',
                    body: 'Potwierdź, że to Ty wyłożyłeś/aś pieniądze — dopiero wtedy ekipa zobaczy, ile Ci oddać.',
                    actions: '<button id="confirm-payer-btn" class="btn btn-primary w-full">Potwierdzam</button>',
                });
                document.getElementById('confirm-payer-btn').onclick = async () => {
                     await updateDoc(doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId), { payerConfirmed: true });
                };
            } else if (isPayerConfirmed && (billData.totalAmount > 0) && !billSettleGate(billData).open) {
                // BRAMA ROZLICZEŃ — zajmuje TEN SAM baner, co reszta rzeczy blokujących
                // rozliczenie, bo odpowiada na dokładnie to samo pytanie: „czemu jeszcze nie
                // da się tego oddać". Osobna karta byłaby siódmą sekcją na ekranie, który
                // i tak jest zapchany, a mówiłaby to, co ten baner mówi już w czterech
                // innych sytuacjach.
                confirmationBanner.innerHTML = gateBannerHtml(billData, myGroupMember && myGroupMember.id);
                wireGateBanner();
            } else if (isPayerConfirmed) {
                const payerName = billData.participants[billData.payerId]?.name || '...';
                const gate = billSettleGate(billData);
                // Po otwarciu bramy baner wraca do swojej starej roli, ale niesie jeszcze
                // jedno słowo: że rozliczanie ruszyło. Bez tego moment odblokowania byłby
                // niewidoczny — a to jest moment, na który czeka cała ekipa.
                // Zdanie „można się rozliczać" było dotąd DOKLEJANE na koniec akapitu jako
                // pogrubiony ogon — czyli najważniejsza wiadomość na tym ekranie stała
                // w miejscu, do którego oko dociera ostatnie. W szkielecie kafelka
                // najważniejsze zdanie jest z definicji tytułem, więc awansuje.
                const gotowy = gate.reason === 'closed' || gate.reason === 'exact';
                const tytulPlatnika = gotowy
                    ? 'Rachunek gotowy — można się rozliczać.'
                    : (isCurrentUserThePayer
                        ? 'Wyłożyłeś/aś pieniądze za ten rachunek.'
                        : `Główne pola rachunku zablokował/a ${escapeHtml(payerName)}.`);
                const trescPlatnika = isCurrentUserThePayer
                    ? `${gotowy ? 'Wyłożyłeś/aś pieniądze za ten rachunek. ' : ''}${billFrozen(billData)
                        ? `${(billData.restSettledG || 0) > 0 ? 'Reszta jest podzielona, więc kwoty i pozycje są zamrożone — cofnij podział' : 'Rachunek jest domknięty, więc kwoty i pozycje są zamrożone — cofnij domknięcie'}, żeby coś poprawić.`
                        : 'Kwotę wciąż możesz poprawić.'}`
                    : (gotowy ? `Główne pola rachunku zablokował/a <strong>${escapeHtml(payerName)}</strong>.` : '');
                // DROGA POWROTNA DLA PŁATNIKA. Bez niej jedynym sposobem na otwarcie
                // zamkniętego rachunku była cudza prośba „To nie moje" — czyli człowiek,
                // który sam się przed chwilą pomylił, nie miał czym tego naprawić.
                // Cicho i bez koloru: to jest wyjście awaryjne, nie zaproszenie.
                cofnijZamkniecieHtml = (gate.reason === 'closed' && canCloseBill(billData, myGroupMember && myGroupMember.id))
                    ? `<button id="reopen-bill-btn" class="tap min-h-tap w-full text-sm font-bold text-ink-3">${(billData.restSettledG || 0) > 0 ? 'Cofnij podział reszty' : 'Cofnij domknięcie'}</button>`
                    : '';
                // Stempel foliowy znaczy „potwierdzone" — tu potwierdzone jest, kto wyłożył pieniądze.
                confirmationBanner.innerHTML = billBannerHtml({
                    chipClass: 'chip text-due',
                    chip: 'Płatnik',
                    title: tytulPlatnika,
                    body: trescPlatnika,
                    actions: cofnijZamkniecieHtml,
                });
                const reopenBtn = document.getElementById('reopen-bill-btn');
                if (reopenBtn) reopenBtn.onclick = () => reopenBillWithConfirm();
            } else if (billData.payerId) {
                // Płatnik wskazany, ale to nie ja i jeszcze nie potwierdził.
                const payerName = (billData.participants[billData.payerId] || {}).name || 'Płatnik';
                confirmationBanner.innerHTML = billBannerHtml({
                    chipClass: 'chip text-info',
                    chip: 'Czeka',
                    title: 'Ten rachunek nie wchodzi jeszcze do rozliczeń.',
                    body: `Czekamy, aż <strong>${escapeHtml(payerName)}</strong> potwierdzi, że wyłożył/a pieniądze. Do tego czasu nikomu nie nalicza się tu dług.`,
                });
            } else {
                // Płatnika w ogóle nie ma. To też blokuje rozliczenie, a pole wyżej mówi
                // tylko „Wskaż osobę…" — bez słowa o tym, co się bez tego nie stanie.
                confirmationBanner.innerHTML = billBannerHtml({
                    chipClass: 'chip text-info',
                    chip: 'Czeka',
                    title: 'Ten rachunek nie wchodzi jeszcze do rozliczeń.',
                    body: 'Wskaż wyżej, kto wyłożył pieniądze — bez tego nie ma komu oddawać.',
                });
            }

            // TRYB PODZIAŁU. Jedna decyzja o kształcie rachunku, podejmowana wtedy, gdy
            // paragon już leży na stole. Zastąpiła ręczny status uczestnika — historia
            // i uzasadnienie przy `billSplitMode`.
            const mode = billSplitMode(billData);
            const activeParticipants = Object.values(billData.participants || {})
                .filter((p) => p.status !== PARTICIPANT_OUT);
            document.querySelectorAll('.bill-mode-btn').forEach((btn) => {
                btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
                // TRYB PODZIAŁU IDZIE ZA TĄ SAMĄ REGUŁĄ, CO KWOTA I WALUTA.
                // Po potwierdzeniu płatnika główne pola rachunku są zamknięte dla
                // wszystkich poza nim (`canEditMainFields`), a kształt podziału jest
                // takim samym polem: przestawienie go zmienia każdemu udział w cudzych
                // pieniądzach. Do 2026-08-15 przełącznik zostawał otwarty dla całej
                // ekipy nawet na zablokowanym rachunku.
                btn.disabled = !canEditNow;
            });
            const modeHint = document.getElementById('bill-mode-hint');
            const modeNote = document.getElementById('bill-mode-note');
            if (modeHint) {
                // ZOSTAJE SAM POWÓD BLOKADY. Opis obu sposobów mieszka pod znakiem
                // zapytania obok nagłówka (patrz uwaga w index.html) — tam wolno mu być
                // pełniejszy, a tutaj nie zabiera trzech wierszy przy każdym wejściu.
                if (billIsFrozen) {
                    // Wyłączony przełącznik bez wyjaśnienia czyta się jak usterka — a tu
                    // powód jest inny niż „to nie Twój rachunek".
                    modeHint.textContent = 'Reszta jest już podzielona, więc sposobu podziału nie da się teraz zmienić — najpierw trzeba cofnąć podział.';
                } else if (!canEditMainFields) {
                    const payerName = billData.payerId ? memberName(billData.payerId) : 'płatnik';
                    modeHint.textContent = `Sposób podziału może zmienić tylko ${payerName}, bo to on wyłożył pieniądze.`;
                } else {
                    modeHint.textContent = '';
                }
                modeHint.classList.toggle('hidden', !modeHint.textContent);
            }

            // W trybie „po równo" cała maszyneria rozpisywania schodzi z ekranu. Nie chodzi
            // o oszczędność miejsca, tylko o prawdę: jeśli rachunek dzieli się po równo,
            // to lista pozycji i odczyt paragonu nie mają czego zmienić, a stojąc na ekranie
            // sugerowałyby, że jednak mają. Wejście w rozpisywanie jest JEDNO: przełącznik.
            const itemsSection = document.getElementById('items-section');
            if (itemsSection) itemsSection.classList.toggle('hidden', mode === 'even');
            const receiptSection = document.getElementById('receipt-photos-section');
            if (receiptSection) receiptSection.classList.toggle('hidden', mode === 'even');

            // Powrót do „po równo" jest możliwy tylko wtedy, gdy nie ma czego zgubić.
            // Przy rozpisanych pozycjach przełączenie kasowałoby czyjś wybór bez pytania,
            // więc zamiast tego mówimy wprost, co stoi na przeszkodzie.
            // Pozycje dla wszystkich liczą się tu tak samo, jak imienne: powrót do „po równo"
            // zepchnąłby je do sekcji starych wpisów, czyli po cichu wytworzyłby stan, który
            // ta sekcja ma tylko sprzątać po dawnej wersji aplikacji.
            const hasItems = (((billData.sharedCosts) || []).length + ((billData.globalCosts) || []).length) > 0;
            const hasOwn = activeParticipants.some((p) => Number(p.individualAmount) > 0);
            const evenBtn = document.getElementById('bill-mode-even');
            if (evenBtn) {
                const locked = mode === 'own' && (hasItems || hasOwn);
                // `||`, nie przypisanie: zamknięcie rachunku przez płatnika obowiązuje
                // niezależnie od tego, czy są rozpisane pozycje. Bez tego ta linia
                // odblokowywałaby przycisk, który dwadzieścia linii wyżej został
                // świadomie wyłączony dla wszystkich poza płatnikiem.
                evenBtn.disabled = locked || !canEditNow;
                evenBtn.classList.toggle('opacity-40', locked);
                evenBtn.title = locked
                    ? 'Rachunek ma już rozpisane pozycje albo koszty własne. Usuń je, żeby wrócić do podziału po równo.'
                    : 'Cała kwota po równo na uczestników';
            }
            if (modeNote) {
                const people = activeParticipants.length;
                if (mode === 'even' && people > 0 && billData.totalAmount > 0) {
                    modeNote.textContent = `${fmtMoney(Math.ceil(toGrosze(billData.totalAmount) / people), billData.currency)} na osobę`;
                } else if (mode === 'own') {
                    const pending = activeParticipants.filter((p) => !participantReady(billData, p.id)).length;
                    modeNote.textContent = pending === 0
                        ? 'wszyscy uzupełnili'
                        : `${pending} ${plural(pending, 'osoba', 'osoby', 'osób')} do uzupełnienia`;
                } else {
                    modeNote.textContent = '';
                }
            }

            const calculations = calculateAll(billData);

            const controlSumEl = document.getElementById('control-sum');
            const controlStatusEl = document.getElementById('control-status');
            const control = calculations.control;
            // Suma pozycji zmienia się po każdym dopisaniu i po każdym cudzym ruchu,
            // więc to ona jest miejscem, w którym potwierdzenie ma sens.
            const previousSum = controlSumEl.textContent;
            controlSumEl.textContent = `${control.enteredSubtotal.toFixed(2).replace('.', ',')} ${billData.currency}`;
            if (previousSum && previousSum !== controlSumEl.textContent) flashValue(controlSumEl);
            controlSumEl.className = "font-bold text-lg text-right ";
            // Wyjaśnienie stanu jest zdaniem pomocniczym, nie alarmem: zwykły stopień
            // i spokojny kolor. Pogrubione czerwone dwie linie krzyczały o czymś, co
            // w większości wypadków jest normalnym stanem rachunku.
            if (controlStatusEl) controlStatusEl.className = "text-sm mt-1 text-ink-2 ";

            const diffText = (d) => `${d.toFixed(2).replace('.', ',')} ${billData.currency}`;
            // NIEDOBÓR NIE JEST BŁĘDEM. Po wprowadzeniu reguły „jeden rachunek, który rośnie"
            // kwota nierozpisana dzieli się po równo, więc komunikat ma powiedzieć, ile to
            // wyjdzie na osobę — a nie straszyć, że ktoś czegoś nie wpisał.
            // O kwocie nierozpisanej mówimy ZAWSZE, gdy jest większa od zera — także wtedy,
            // gdy kontrola sumy wychodzi na „ok". Taki stan powstaje, kiedy pozycje spinają
            // się z kwotą rachunku, ale nikt jeszcze nie wybrał, co jadł (typowo zaraz po
            // odczycie paragonu). Sam zielony napis „rozpisane co do grosza" przemilczałby
            // wtedy, że cała kwota idzie po równo.
            // ROZPISANE DZIAŁANIE ZAMIAST DOMYSŁU O PRZYCZYNIE.
            //
            // Stało tu „Nadwyżka X. Ktoś przeliczył albo pozycja jest podwójna" — zdanie,
            // które ZGADUJE przyczynę i pomija trzeci składnik sumy. Suma kontrolna liczy
            // koszty własne, pozycje ORAZ koszty ogólne, więc przy doliczonym serwisie
            // podpowiedź kierowała na fałszywy trop („szukaj podwójnej pozycji", a winny
            // był napiwek dopisany po wpisaniu kwoty rachunku).
            const breakdown = document.getElementById('control-breakdown');
            const breakdownRows = document.getElementById('control-breakdown-rows');
            const fixTotalBtn = document.getElementById('control-fix-total');
            if (breakdown) breakdown.classList.toggle('hidden', control.status !== 'over');

            if (control.status === 'over') {
                controlSumEl.classList.add('control-sum-bad');
                if (controlStatusEl) {
                    controlStatusEl.classList.add('control-sum-bad');
                    controlStatusEl.textContent = `Pozycje przewyższają kwotę rachunku o ${diffText(control.diff)}.`;
                }
                if (breakdownRows) {
                    const e = calculations.entered || { individual: 0, shared: 0, global: 0 };
                    // `kwota`, a nie `value`: strażnik escapowania (`render.safety.test.js`)
                    // słusznie traktuje nazwę `value` jako dane z bazy. Tu jest to liczba
                    // z `calculateAll`, ale rozszerzanie listy wyjątków w teście po to,
                    // żeby przepuścić jedną linię, rozluźniałoby sieć asekuracyjną dla
                    // wszystkich następnych. Taniej i uczciwiej jest nazwać zmienną tak,
                    // żeby nie udawała czegoś, czym nie jest.
                    const row = (opis, kwota, strong = false) => `
                        <div class="flex items-baseline justify-between gap-3 ${strong ? 'font-bold text-ink' : ''}">
                            <span class="min-w-0 truncate">${escapeHtml(opis)}</span>
                            <span class="amount flex-shrink-0">${diffText(kwota)}</span>
                        </div>`;
                    // Składniki zerowe nie wchodzą — pusty wiersz „0,00" tylko rozmywa obraz.
                    breakdownRows.innerHTML = [
                        e.shared > 0 ? row('Pozycje', e.shared) : '',
                        e.individual > 0 ? row('Koszty własne', e.individual) : '',
                        e.global !== 0 ? row('Dla wszystkich', e.global) : '',
                        row('Razem', control.enteredSubtotal, true),
                        row('Kwota rachunku', control.expectedTotal),
                    ].join('');
                }
                // WYJAŚNIENIE, A NIE SAMA ARYTMETYKA.
                //
                // Rozpiska mówi, ŻE się nie zgadza. Nie mówi, CZEGO szukać — a bez tego
                // człowiek patrzy na trzy liczby i dalej nie wie, co zrobić. Poprzednia
                // wersja próbowała to załatwić jednym zdaniem („ktoś przeliczył albo
                // pozycja jest podwójna”), które zgadywało przyczynę i pomijało koszty
                // ogólne. Zamiast zgadywać: jeden przypadek rozpoznajemy PEWNIE, a przy
                // reszcie wypisujemy dwie realne możliwości zwykłymi słowami.
                const whyEl = document.getElementById('control-breakdown-why');
                if (whyEl) {
                    const e = calculations.entered || { individual: 0, shared: 0, global: 0 };
                    // Różnica równa co do grosza kosztom ogólnym to nie przypuszczenie,
                    // tylko arytmetyka: kwota rachunku została wpisana przed ich dodaniem.
                    const toKosztyOgolne = e.global > 0 && Math.abs(e.global - control.diff) < 0.005;
                    whyEl.innerHTML = toKosztyOgolne
                        ? `Różnica to dokładnie tyle, ile wynoszą pozycje dla wszystkich. Wygląda na to, że kwota rachunku (${diffText(control.expectedTotal)}) została wpisana, zanim ktoś je dopisał — wtedy wystarczy ją podnieść.`
                        : `Najczęściej znaczy to jedno z dwóch:<br>• ta sama pozycja została wpisana dwa razy,<br>• albo kwota rachunku nie obejmuje jeszcze czegoś, co zostało dopisane (napiwek, serwis, opłata za nakrycie).`;
                }

                if (fixTotalBtn) {
                    // JEDNO STUKNIĘCIE NA NAJCZĘSTSZY PRZYPADEK: kwota rachunku wpisana,
                    // zanim doszedł koszt ogólny. Nie robimy tego sami — to są cudze
                    // pieniądze i decyzja należy do człowieka.
                    // Krótko, bo pełne „Ustaw kwotę rachunku na 210,50 PLN" łamie się na
                    // wąskim telefonie na dwie linie. Czego dotyczy kwota, mówi rozpiska
                    // stojąca bezpośrednio nad przyciskiem.
                    fixTotalBtn.textContent = `Ustaw kwotę na ${diffText(control.enteredSubtotal)}`;
                    fixTotalBtn.onclick = () => {
                        fireWrite(
                            updateDoc(itemsDocRef(), { totalAmount: control.enteredSubtotal }),
                            'Nie udało się zmienić kwoty rachunku.',
                        );
                        showToast('Kwota rachunku zaktualizowana.');
                    };
                }
            } else if (calculations.unallocated > 0) {
                if (controlStatusEl) {
                    // „Po X na osobę" wolno powiedzieć WYŁĄCZNIE wtedy, gdy ta kwota naprawdę
                    // komuś się dolicza. Dopóki nikt o niej nie zdecydował, jest niczyja —
                    // a zdanie o podziale sugerowałoby dług, którego nie ma.
                    const niczyjaG = toGrosze(calculations.restUndecided || 0);
                    if (niczyjaG > 0) {
                        controlStatusEl.textContent = `Nierozpisane ${diffText(fromGrosze(niczyjaG))} — nikt tego jeszcze nie wziął.`;
                    } else if (billSplitMode(billData) === 'even') {
                        // W TRYBIE „PO RÓWNO" TA LINIJKA MILCZY (zgłoszenie właściciela
                        // 2026-08-29). „Nierozpisane 400,00, czyli po 100,00 na osobę" opisuje
                        // tam DOKŁADNIE TO, CO MÓWI NAZWA TRYBU dwa centymetry niżej — i robi
                        // to słowem „nierozpisane", które brzmi jak zaległość do załatwienia,
                        // choć w tym trybie nie ma czego rozpisywać. Zdanie zostaje wyłącznie
                        // tam, gdzie niesie wiadomość: w trybie ze swoimi kosztami.
                        controlStatusEl.textContent = '';
                    } else {
                        controlStatusEl.textContent = calculations.perPersonUnallocated > 0
                            ? `Nierozpisane ${diffText(calculations.unallocated)}, czyli po ${diffText(calculations.perPersonUnallocated)} na osobę.`
                            : `Nierozpisane ${diffText(calculations.unallocated)}.`;
                    }
                }
            } else if (control.status === 'ok') {
                controlSumEl.classList.add('control-sum-ok');
                if (controlStatusEl) { controlStatusEl.classList.add('control-sum-ok'); controlStatusEl.textContent = 'Rozpisane co do grosza'; }
            } else if (controlStatusEl) { // empty (kwota nie wpisana)
                controlStatusEl.textContent = '';
            }
            
            const plnDisplay = document.getElementById('pln-conversion-display');
            const advRate = plnRateFor(billData.currency, billData.exchangeRatePLN);
            if (billData.currency !== 'PLN' && advRate) {
                const plnTotal = calculations.controlSum * advRate;
                const label = (typeof billData.exchangeRatePLN === 'number' && billData.exchangeRatePLN > 0) ? 'kurs z dnia dodania' : 'kurs bieżący';
                plnDisplay.textContent = `≈ ${plnTotal.toFixed(2)} PLN (${label}: ${advRate.toFixed(4)})`;
            } else {
                plnDisplay.textContent = '';
            }
            
            renderReceiptPhotos(billData.photos);
            renderParseReceiptButton();

            document.getElementById('my-participant-card').innerHTML = '';
            document.getElementById('participants-list').innerHTML = '';

            const payer = billData.participants[billData.payerId];

            const sortedParticipants = [...calculations.participantTotals].sort((a, b) => {
                if (a.participant.id === myGroupMember.id) return -1;
                if (b.participant.id === myGroupMember.id) return 1;
                return memberName(a.participant.id).localeCompare(memberName(b.participant.id));
            });

            // Raz na przerysowanie, nie raz na osobę: przy ekipie piętnastoosobowej to
            // piętnaście przebiegów po tych samych polach dla identycznego wyniku.
            const reszta = restInfo(calculations);
            // Rozliczenie tego rachunku liczone RAZ na przerysowanie: własna kwota na dół
            // limonkowej karty i znaczniki przy wszystkich pozostałych osobach w „Ekipie".
            // Przy piętnastu osobach liczenie tego w pętli byłoby piętnastoma przebiegami
            // po tych samych danych.
            const rozliczeniRachunku = billSettledBy(perBillNow(), currentBillId);
            const mojWiersz = rozliczeniRachunku.find((x) => x.debtor === myGroupMember.id);
            const mojeRozliczenie = myBillSettleHtml(mojWiersz);

            sortedParticipants.forEach(pt => {
                const p = pt.participant;
                const isMe = p.id === myGroupMember.id;
                const isPayer = p.id === billData.payerId;
                const isDisabled = p.status === 'not_applicable';

                // Model wpłat: rachunek nie pokazuje należności/opłat — to jest w „Rozliczeniach".
                // Zostaje sam udział (linia ŁĄCZNIE niżej). Płatnikowi pokazujemy tylko info że wyłożył całość.
                let paymentInfo = '';
                if (payer && isPayerConfirmed && isPayer) {
                    paymentInfo = `<p class="text-sm text-ink-3">Wyłożył/a całość: ${Number(billData.totalAmount || 0).toFixed(2).replace('.', ',')} ${billData.currency}</p>`;
                }

                const statusDisplayHtml = getStatusHtml(isMe, isPayer, p.id);

                let participantHTML;
                if (isMe) {
                    const isCalculatorActive = p.calculatorActive === true;
                    
                    const yourSumContainerHTML = `
                        <div id="your-sum-container-${p.id}" class="flex items-center gap-2 w-full ${isCalculatorActive ? 'hidden' : ''}">
                            <button class="calculator-toggle-btn tap w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-surface-2 text-ink-2" title="Rozbij na kilka kwot" ${isDisabled ? 'disabled' : ''}>
                                <i class="fas fa-calculator"></i>
                            </button>
                            <label for="your-sum-input-${p.id}" class="sr-only">Twój koszt własny</label>
                            <input type="text" inputmode="decimal" id="your-sum-input-${p.id}"
                                class="field min-h-tap flex-grow min-w-0 p-2 text-right font-semibold"
                                value="${p.individualAmount > 0 ? p.individualAmount.toFixed(2).replace('.',',') : ''}"
                                placeholder="0,00"
                                ${isDisabled ? 'disabled' : ''}>
                            <span class="font-semibold text-ink-3 flex-shrink-0">${billData.currency}</span>
                        </div>
                    `;

                    const calculatorTotalContainerHTML = `
                        <div id="calculator-total-container-${p.id}" class="flex items-center gap-2 w-full ${isCalculatorActive ? '' : 'hidden'}">
                            <button class="calculator-toggle-btn tap w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-ink text-surface active" title="Zwiń do jednej kwoty" ${isDisabled ? 'disabled' : ''}>
                                <i class="fas fa-compress"></i>
                            </button>
                            <input type="text" aria-label="Suma kosztów własnych"
                                class="field min-h-tap flex-grow min-w-0 p-2 text-right font-semibold"
                                value="${p.individualAmount > 0 ? p.individualAmount.toFixed(2).replace('.',',') : '0,00'}"
                                disabled>
                            <span class="font-semibold text-ink-3 flex-shrink-0">${billData.currency}</span>
                        </div>
                    `;

                    // TWÓJ UDZIAŁ NA LIMONCE. Zgłoszenie właściciela: na rachunku wszystko
                    // ma podobny kolor i zlewa się mój udział z kwotą rachunku i pozycjami.
                    // Limonka znaczy w tym świecie „to jest twoje" i dokładnie tak działa
                    // już na twojej linii paragonu — więc to nie nowy język, tylko ten sam
                    // kolor w tej samej roli, o piętro wyżej.
                    participantHTML = `
                    <div class="card-mine p-4" data-participant-id="${p.id}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center min-w-0">
                                ${avatarHtml(p.name, p.id)}
                                <div class="flex flex-col min-w-0">
                                    <span class="text-lg font-semibold truncate">${escapeHtml(p.name)}</span>
                                    ${statusDisplayHtml}
                                </div>
                            </div>
                            <span class="chip flex-shrink-0">Ty</span>
                        </div>

                        <div class="mt-3 ${mode === 'even' ? 'hidden' : ''}">
                            <p class="text-sm font-bold text-ink-3 mb-1.5">Koszt tylko Twój</p>
                            ${yourSumContainerHTML}
                            ${calculatorTotalContainerHTML}
                            <div id="calculator-inputs-container-${p.id}" class="flex flex-col gap-2 mt-2 w-full ${isCalculatorActive ? '' : 'hidden'}">
                                ${(p.individualAmounts && p.individualAmounts.length > 0) ? p.individualAmounts.map((amount, index) => `
                                    <div class="flex items-center gap-2 w-full">
                                        <input type="text" inputmode="decimal" class="individual-amount-component field min-h-tap flex-grow min-w-0 p-2 text-right font-semibold" value="${amount > 0 ? String(amount.toFixed(2)).replace('.',',') : ''}" placeholder="0,00" data-index="${index}" id="individual-amount-component-${p.id}-${index}" ${isDisabled ? 'disabled' : ''}>
                                        <span class="font-semibold text-ink-3 flex-shrink-0">${billData.currency}</span>
                                        <div class="w-11 h-11 flex items-center justify-center flex-shrink-0">
                                        ${index === p.individualAmounts.length - 1 ? `
                                            <button class="add-amount-btn tap w-11 h-11 rounded-lg flex items-center justify-center bg-surface-2 text-ink-2" title="Dodaj kolejną kwotę" ${isDisabled ? 'disabled' : ''}>
                                                <i class="fas fa-plus"></i>
                                            </button>
                                        ` : ''}
                                        </div>
                                    </div>
                                `).join('') : ''}
                            </div>
                        </div>

                        ${myShareHtml(pt, paymentInfo, reszta, mojeRozliczenie, restClaimHtml(billData, calculations, pt))}
                    </div>`;
                } else { // Other participants view
                    // Znacznik rozliczenia stoi PRZY OSOBIE, w rzędzie z jej imieniem —
                    // nie w osobnej sekcji dwa ekrany niżej. `items-start`, bo znacznik
                    // ma trafić na wysokość imienia, a nie na środek dwuwierszowej kolumny.
                    participantHTML = `
                    <div class="card p-4">
                        <div class="flex items-start min-w-0 gap-2">
                            ${avatarHtml(p.name, p.id)}
                            <div class="flex flex-col min-w-0 flex-grow">
                                <span class="text-lg font-semibold truncate">${escapeHtml(p.name)}</span>
                                ${statusDisplayHtml}
                            </div>
                            ${billSettledMarkHtml(rozliczeniRachunku, p.id)}
                        </div>
                        ${participantBreakdownHtml(pt, false, paymentInfo, reszta)}
                    </div>`;
                }
                
                if (isMe) {
                    document.getElementById('my-participant-card').innerHTML = participantHTML;
                } else {
                    document.getElementById('participants-list').innerHTML += participantHTML;
                }
            });

            // Podpis zwiniętej sekcji niesie to, co bez niej trzeba by rozwijać:
            // ilu jest uczestników i ilu ma jeszcze coś do uzupełnienia.
            // PODPIS ZWINIĘTEJ „EKIPY" NIESIE TO, PO CO SIĘ JĄ ROZWIJA.
            //
            // W trybie rachunkowym pytanie brzmi „kto już oddał", więc licznik rozliczonych
            // wypiera z podpisu licznik uzupełnień — inaczej trzeba by rozwinąć sekcję,
            // żeby dowiedzieć się rzeczy, dla której się ją rozwija. Uzupełnianie wraca do
            // podpisu, gdy nie ma jeszcze czego rozliczać (rachunek bez potwierdzonego
            // płatnika albo bez kwoty) i w planie minimalnym, gdzie statusu nie ma wcale.
            const participantsLabel = document.getElementById('participants-summary-label');
            if (participantsLabel) {
                const others = calculations.participantTotals.filter(pt => pt.participant.id !== myGroupMember.id);
                const pending = others.filter(pt => !participantReady(billData, pt.participant.id)).length;
                const people = `${others.length} ${plural(others.length, 'osoba', 'osoby', 'osób')}`;
                const doRozliczenia = groupSettlementMode() === 'perBill' ? rozliczeniRachunku : [];
                if (doRozliczenia.length) {
                    const oddalo = doRozliczenia.filter((x) => x.settled).length;
                    participantsLabel.textContent = `Ekipa: ${people} · oddało ${oddalo} z ${doRozliczenia.length}`;
                } else {
                    participantsLabel.textContent = pending > 0
                        ? `Ekipa: ${people} · ${pending} do uzupełnienia`
                        : `Ekipa: ${people} · wszystko uzupełnione`;
                }
            }

            renderBillStacks(myGroupMember.id);

            // Przycisk siedzi w limonkowej karcie („Twój udział"), więc nasłuch dopinamy
            // po jej wstawieniu — karta powstaje w pętli wyżej, razem z resztą uczestników.
            const settleBtn = document.getElementById('bill-settle-btn');
            if (settleBtn && mojWiersz) {
                settleBtn.onclick = () => openSettleModal(billData.payerId, mojWiersz.openG, mojWiersz.currency, 'send', currentBillId);
            }
            const disputeBtn = document.getElementById('rest-dispute-btn');
            if (disputeBtn) disputeBtn.onclick = () => requestBillReopen();
            const lockedBtn = document.getElementById('settle-locked-btn');
            if (lockedBtn) lockedBtn.onclick = () => showSettleBlockedInfo(billData);
            renderItemTiles();
            renderBillHistory();

            renderGlobalCosts();

            document.getElementById('add-shared-cost-btn').disabled = false;
            // FIX: The variable to check if the delete button should be shown is now `isCurrentUserThePayer`
            document.getElementById('delete-bill-btn-advanced').style.display = isCurrentUserThePayer ? 'inline-block' : 'none';

            addAdvancedBillEventListeners();
        };

        const addAdvancedBillEventListeners = () => {
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            // (Usunięta lokalna kopia `parseLocalFloat` — istnieje wersja modułowa. Dublet już raz
            // wywołał cichy ReferenceError, gdy jedna z kopii zniknęła przy refaktorze.)


            document.getElementById('back-to-dashboard-btn').onclick = () => leaveBillScreen();
            // Stuknięcie w samą nazwę otwiera pole — o to prosił właściciel. Ołówek obok
            // istnieje po to, żeby dało się to ODKRYĆ: nagłówek, który po cichu reaguje na
            // stuknięcie, jest funkcją, o której wie wyłącznie ten, kto ją zamówił.
            // NAZWĘ OTWIERA WYŁĄCZNIE OŁÓWEK (decyzja właściciela 2026-08-27).
            //
            // Nagłówek też był klikalny, ale to jest największy przedmiot na tym ekranie
            // i leży dokładnie tam, gdzie kciuk ląduje przy przewijaniu — więc pole do wpisu
            // otwierało się przez przypadek. Ołówek jest mały, stoi obok i nie robi nic,
            // czego ktoś nie chciał. Nagłówek zostaje nagłówkiem, także dla czytnika ekranu.
            // WYJAŚNIENIE OBU SPOSOBÓW PODZIAŁU — jedno miejsce, jedna treść, oba tryby
            // opisane naraz. Do 2026-08-29 na karcie stał opis WYBRANEGO sposobu, więc
            // żeby dowiedzieć się, czym jest ten drugi, trzeba było go włączyć.
            const modeHelpBtn = document.getElementById('bill-mode-help');
            if (modeHelpBtn) modeHelpBtn.onclick = () => showInfo('Jak dzielimy rachunek', `
                <p><b>Po równo.</b> Cała kwota rachunku dzieli się na uczestników i nikt niczego nie uzupełnia. Rachunek jest gotowy od razu, a pozycje z paragonu w ogóle nie są potrzebne.</p>
                <p><b>Ze swoimi kosztami.</b> Każdy stuka na paragonie to, co jadł, i wpisuje swoje koszty własne. Cena pozycji dzieli się po równo między wszystkich, którzy ją stuknęli.</p>
                <ul class="list-disc pl-5 space-y-1">
                    <li><b>Pozycja dla wszystkich</b> (napiwek, serwis) dzieli się po równo i nikt nie musi jej stukać. Zaznaczasz to w arkuszu pozycji; kwotę można podać też jako procent rachunku. W trybie „po równo" nie jest potrzebna: tam cała kwota i tak rozkłada się tak samo.</li>
                    <li>O tym, czego nikt nie weźmie imiennie, decyduje na końcu <b>płatnik</b>: dzieli resztę po równo albo wrzuca ją tym, którzy nie stuknęli swojego.</li>
                    <li>Grosze zaokrąglają się w górę, żeby płatnik nigdy nie był stratny.</li>
                </ul>
                <p>Sposób podziału zmienia <b>płatnik</b>, i tylko dopóki reszta nie została podzielona. Powrót do „Po równo" jest możliwy, dopóki nikt niczego nie rozpisał — inaczej przełączenie skasowałoby czyjś wybór.</p>`);

            const olowekNazwy = document.getElementById('bill-name-edit-btn');
            if (olowekNazwy) olowekNazwy.onclick = () => startBillNameEdit();
            const poleNazwy = document.getElementById('bill-name-input');
            if (poleNazwy) {
                // Zapis na wyjściu z pola, nie na każdym znaku: nazwa jedzie do wszystkich
                // telefonów w pokoju, więc zapis na literę byłby zapisem na literę u każdego.
                poleNazwy.onblur = () => finishBillNameEdit(true);
                poleNazwy.onkeydown = (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); poleNazwy.blur(); }
                    if (e.key === 'Escape') { e.preventDefault(); showBillNameEditor(false); poleNazwy.blur(); }
                };
            }
            document.getElementById('total-bill-amount').onchange = async (e) => {
                const before = billData.totalAmount || 0;
                const after = parseLocalFloat(e.target.value);
                if (after === before) return;
                if (refuseFrozen()) { e.target.value = before > 0 ? before.toFixed(2).replace('.', ',') : ''; return; }
                await updateDoc(billDocRef, { totalAmount: after });
                // Zmiana kwoty rachunku dotyczy cudzych pieniędzy — to pierwszy wpis,
                // którego ktokolwiek szuka w dzienniku.
                logEvent({
                    type: 'bill-amount',
                    billId: currentBillId,
                    label: `zmienił/a kwotę rachunku „${billData.billName}" z ${fmtMoney(toGrosze(before), billData.currency)} na ${fmtMoney(toGrosze(after), billData.currency)}`,
                });
            };
            document.getElementById('currency-select').onclick = () => {
                openChoiceSheet({
                    title: 'Waluta rachunku',
                    current: billData.currency,
                    options: [
                        { value: 'PLN', label: 'PLN', hint: 'złoty polski' },
                        { value: 'EUR', label: 'EUR', hint: 'euro' },
                        { value: 'USD', label: 'USD', hint: 'dolar amerykański' },
                    ],
                    onPick: async (value) => {
                        if (refuseFrozen()) return;
                        await updateDoc(billDocRef, await currencyPatch(value));
                    },
                });
            };

            document.getElementById('payer-select').onclick = () => {
                openChoiceSheet({
                    title: 'Kto wyłożył pieniądze',
                    current: billData.payerId || '',
                    search: { label: 'Szukaj osoby', placeholder: 'Szukaj imienia', empty: 'Nikt taki nie jest w tym rachunku.' },
                    options: [
                        { value: '', label: 'Nikt jeszcze', hint: 'wskażesz później' },
                        ...Object.values(billData.participants || {}).map((p) => ({
                            value: p.id,
                            label: p.name,
                            avatarHtml: avatarHtml(p.name, p.id),
                        })),
                    ],
                    onPick: (value) => askBeforeSettingPayer(value || null),
                });
            };

            // WSKAZANIE PŁATNIKA JEST DECYZJĄ O CUDZYCH PIENIĄDZACH, więc nie wchodzi
            // w życie samym stuknięciem w listę. Pytamy raz, wprost i z imieniem.
            const askBeforeSettingPayer = (newPayerId) => {
                if (newPayerId === billData.payerId) return;
                const me = myMemberNow();
                const isMe = !!me && newPayerId === me.id;

                if (!newPayerId) {
                    openConfirm({
                        title: 'Usunąć płatnika?',
                        body: `Rachunek „${billData.billName}" zostanie bez wskazanego płatnika i wypadnie z rozliczeń, dopóki ktoś nie zostanie wskazany ponownie.`,
                        confirmLabel: 'Usuń płatnika',
                        onConfirm: () => setBillPayer(null, false),
                    });
                    return;
                }

                openConfirm({
                    title: isMe ? 'To Ty wyłożyłeś pieniądze?' : `Płatnikiem jest ${memberName(newPayerId)}?`,
                    body: isMe
                        ? `Zapiszemy, że za rachunek „${billData.billName}" zapłaciłeś Ty. Od tej chwili ekipa zobaczy, ile ma Ci oddać.`
                        : `${memberName(newPayerId)} dostanie pytanie o potwierdzenie przy wejściu na ten rachunek. Do tego czasu rachunek nie wchodzi do rozliczeń.`,
                    confirmLabel: 'Potwierdzam',
                    // Wskazanie płatnika da się cofnąć jednym stuknięciem, więc przycisk
                    // nie nosi czerwieni długu — ta znaczy tu wyłącznie „stąd nie ma powrotu".
                    tone: 'brand',
                    // Wskazując SIEBIE, potwierdzam to w tej samej chwili: dwa pytania
                    // o tę samą rzecz pod rząd to jedno pytanie za dużo. Wskazując kogoś
                    // innego, zostawiam potwierdzenie jemu, bo to on wie, czy zapłacił.
                    onConfirm: () => setBillPayer(newPayerId, isMe),
                });
            };

            const setBillPayer = async (newPayerId, confirmed = false) => {
                if (newPayerId === billData.payerId) return;

                // Sam wybór płatnika nie rusza już żadnego statusu: status liczy się
                // z zawartości rachunku (`participantReady`), a wskazanie, kto wyłożył
                // pieniądze, nie zmienia tego, co kto zjadł.
                await updateDoc(billDocRef, { payerId: newPayerId, payerConfirmed: !!confirmed });
                logEvent({
                    type: 'bill-payer',
                    billId: currentBillId,
                    label: newPayerId
                        ? `wskazał/a płatnika rachunku „${billData.billName}": ${memberName(newPayerId)}`
                        : `usunął/ęła płatnika z rachunku „${billData.billName}"`,
                });
            };

            // Przełącznik trybu podziału. Zapisujemy go w dokumencie rachunku, bo to
            // decyzja o rachunku, a nie ustawienie tego telefonu — cała ekipa musi
            // widzieć ten sam kształt.
            document.querySelectorAll('.bill-mode-btn').forEach((btn) => {
                // PRZESTAWIENIE TRYBU NA OPŁACONYM RACHUNKU PYTA, TAK JAK OTWARCIE.
                //
                // Ta sama czynność co `reopenBill` — kasuje decyzję o reszcie i przelicza
                // wszystkim udziały — a pytała tylko w jednym z dwóch miejsc. Rachunek „po
                // równo" nie ma bramy do zamknięcia, więc `settleOpen` jest na nim zawsze
                // false i zamrożenie go nie łapie: jedno stuknięcie w „Ze swoimi kosztami"
                // przestawiało cały rachunek na kwoty wstępne, choć ludzie już za niego
                // zapłacili. Sonda audytowa 2026-08-26: rachunek 300 zł po równo, Ania oddaje
                // swoje 100, płatnik przestawia tryb — i księga mówi, że to PŁATNIK jest winien
                // Ani 100, a dług Kuby znika. Pytanie nazywa to, co się stanie, po imieniu.
                const applyBillMode = async (next) => {
                    // ZMIANA TRYBU UNIEWAŻNIA DECYZJĘ O RESZCIE (audyt 2026-08-26).
                    // Tryb przestawia kształt CAŁEGO rachunku, więc odpowiedź na pytanie
                    // „co z kwotą, której nikt nie wziął" przestaje pasować do pytania.
                    // Zostawienie jej znaczyło, że rachunek podpisany „po równo" oddaje
                    // całość jednej wskazanej osobie. `functions/calc.js` broni się przed tym
                    // sam, ale stan w bazie ma być prawdziwy, a nie tylko nieszkodliwy.
                    await updateDoc(billDocRef, {
                        splitMode: next,
                        settleOpen: false,
                        restTo: null,
                        restSettledG: 0,
                    });
                    logEvent({
                        type: 'bill-mode',
                        billId: currentBillId,
                        label: next === 'even'
                            ? `przestawił/a rachunek „${billData.billName}" na podział po równo`
                            : `przestawił/a rachunek „${billData.billName}" na własne koszty`,
                    });
                };

                btn.onclick = () => {
                    const next = btn.dataset.mode;
                    if (next === billSplitMode(billData)) return;
                    if (refuseFrozen()) return;
                    const zaplacili = billSettledBy(perBillNow(), currentBillId).filter((x) => x.paidG > 0).length;
                    if (zaplacili === 0) { applyBillMode(next); return; }
                    openConfirm({
                        title: 'Przestawić sposób podziału?',
                        body: `Kwoty na tym rachunku policzą się od nowa, a podział kwoty nierozpisanej zostanie cofnięty. ${zaplacili} ${plural(zaplacili, 'osoba już zapłaciła', 'osoby już zapłaciły', 'osób już zapłaciło')} — różnica pojawi się w rozliczeniach.`,
                        confirmLabel: 'Przestaw',
                        tone: 'brand',
                        onConfirm: () => applyBillMode(next),
                    });
                };
            });

            document.getElementById('delete-bill-btn-advanced').onclick = () => deleteBillWithUndo();

            const myCard = document.getElementById('my-participant-card');
            if (myCard) {
                myCard.onclick = async (e) => {
                    const participantId = myCard.firstElementChild.dataset.participantId;
                    const participant = billData.participants[participantId];
                    if (!participant) return;
                    // Kalkulator kosztów własnych kończy się zapisem kwoty, a ta zmniejsza
                    // kwotę nierozpisaną — czyli udział pozostałych. Odmawiamy przy wejściu,
                    // żeby nikt nie wypełniał pól, których i tak nie da się zapisać.
                    if (refuseFrozen()) return;

                    const calcBtn = e.target.closest('.calculator-toggle-btn');
                    const addBtn = e.target.closest('.add-amount-btn');

                    if (calcBtn) {
                        const newCalculatorState = !participant.calculatorActive;
                        let updatePayload = { [`participants.${participantId}.calculatorActive`]: newCalculatorState };

                        if (newCalculatorState === true) {
                            if (!participant.individualAmounts || participant.individualAmounts.length < 2) {
                                let amounts = [participant.individualAmount, 0].filter(v => v > 0);
                                while (amounts.length < 2) {
                                    amounts.push(0);
                                }
                                updatePayload[`participants.${participantId}.individualAmounts`] = amounts;
                            }
                        }
                        await updateDoc(billDocRef, updatePayload);
                    }

                    if (addBtn) {
                        const container = document.getElementById(`calculator-inputs-container-${participantId}`);
                        const allComponentInputs = container.querySelectorAll('.individual-amount-component');
                        const lastInput = allComponentInputs[allComponentInputs.length - 1];

                        if (lastInput && parseLocalFloat(lastInput.value) <= 0) {
                            showToast("Uzupełnij ostatnie pole, aby dodać nowe.", true);
                            lastInput.focus();
                            return;
                        }
                        
                        const currentAmounts = Array.from(allComponentInputs).map(input => parseLocalFloat(input.value));
                        const newAmounts = [...currentAmounts, 0];

                        await updateDoc(billDocRef, { [`participants.${participantId}.individualAmounts`]: newAmounts });
                    }
                };

                myCard.onchange = async (e) => {
                    const target = e.target;
                    const participantId = myCard.firstElementChild.dataset.participantId;
                    const participant = billData.participants[participantId];
                    if (!participant) return;
                    // Wpisana kwota zostaje w polu do najbliższej migawki, a tej nie będzie,
                    // skoro nic nie zapisujemy — więc przerysowujemy ekran ręcznie. Bez
                    // `withFocusPreserved`: ono ODTWARZA wpisaną wartość, a tu chodzi
                    // dokładnie o to, żeby pole wróciło do kwoty zapisanej w rachunku.
                    if (refuseFrozen()) { target.blur(); renderBillScreen(); return; }

                    const updates = {};
                    let newTotal = participant.individualAmount;

                    if (target.id.startsWith('your-sum-input-')) {
                        newTotal = parseLocalFloat(target.value);
                    } else if (target.classList.contains('individual-amount-component')) {
                        const container = document.getElementById(`calculator-inputs-container-${participantId}`);
                        const newAmounts = Array.from(container.querySelectorAll('.individual-amount-component')).map(input => parseLocalFloat(input.value)).filter(val => val > 0);
                        while (newAmounts.length < 2) newAmounts.push(0);
                        updates[`participants.${participantId}.individualAmounts`] = newAmounts;
                        newTotal = newAmounts.reduce((sum, val) => sum + val, 0);
                    } else {
                        return;
                    }

                    updates[`participants.${participantId}.individualAmount`] = newTotal;
                    // Statusu już nie zapisujemy. Wcześniej ta sama zmiana kwoty własnej
                    // przestawiała pole `status` na trzy różne sposoby zależnie od tego,
                    // czy jestem płatnikiem — i to była główna przyczyna, dla której
                    // status na ekranie mówił co innego niż stan rachunku. Teraz liczy
                    // go `participantReady` z tego, co realnie stoi w rachunku.
                    await updateDoc(billDocRef, updates);
                };
            }

            // Linia paragonu: stuknięcie dopisuje/wypisuje MNIE z pozycji (klik w ołówek/kosz
            // nie liczy się jako wybór).
            document.querySelectorAll('.receipt-line').forEach(tile => {
                tile.onclick = async (e) => {
                    if (e.target.closest('.item-edit-btn') || e.target.closest('.remove-shared-cost-btn')) return;
                    // Pozycji dla wszystkich się nie stuka: dotyczy każdego z definicji.
                    // Odkąd stoi na tym samym wydruku, łapie ten sam nasłuch (2026-08-30).
                    if (!tile.dataset.itemId) return;
                    const my = myMemberNow();
                    if (!my) { showToast('Najpierw dołącz do grupy.', true); return; }
                    if (!billData.participants[my.id] || billData.participants[my.id].status === 'not_applicable') {
                        showToast('Nie jesteś uczestnikiem tego rachunku.', true); return;
                    }
                    // NA ZAMKNIĘTYM RACHUNKU NIKT JUŻ NIE KLIKA — patrz `billFrozen`.
                    // Kwoty przestały być wstępne: ktoś mógł na ich podstawie zrobić przelew.
                    // Droga jest jedna i jawna: prośba o otwarcie do tego, kto zamykał.
                    if (refuseFrozen()) return;
                    const before = (billData.sharedCosts || []).find(x => x.id === tile.dataset.itemId);
                    const wasMine = before ? isPicked(before, my.id) : false;
                    await mutateItems((items) => toggleItemPicker(items, tile.dataset.itemId, my.id));
                    // Odklikanie pozycji to poziom 3 progu: żadnego sygnału, ale ślad
                    // w dzienniku zostaje — to jest odpowiedź na „kto wziął tę porcję".
                    logEvent({
                        type: 'item-pick',
                        billId: currentBillId,
                        label: `${wasMine ? 'zdjął/ęła się z pozycji' : 'odkliknął/ęła pozycję'} „${before ? before.description : 'bez nazwy'}"`,
                    });
                };
            });
            document.querySelectorAll('.item-edit-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    // Poprawienie KWOTY pozycji przesuwa cudze udziały mocniej niż stuknięcie
                    // w linię, a brama tego nie widzi: pieniądze nie zawisły bez właściciela,
                    // tylko zmieniły właściciela. Patrz `billFrozen`.
                    if (refuseFrozen()) return;
                    openItemModal(e.currentTarget.dataset.itemId);
                };
            });

            document.querySelectorAll('.remove-shared-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    // Usuwamy PO IDENTYFIKATORZE, nie przez arrayRemove(obiekt): arrayRemove
                    // wymaga dokładnej zgodności całego obiektu, więc czyjeś stuknięcie w kafelek
                    // (zmiana `sharedBy`) sprawiało, że kasowanie po cichu nic nie robiło.
                    if (refuseFrozen()) return;
                    const costId = e.currentTarget.dataset.costId;
                    await mutateItems((items) => items.filter(sc => sc.id !== costId));
                };
            });
            document.querySelectorAll('.remove-global-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    // Koszt wspólny dzieli się po równo na wszystkich, więc jego zdjęcie albo
                    // dołożenie rusza KAŻDEMU udział — i robi to bez ruszania bramy.
                    if (refuseFrozen()) return;
                    const costId = e.currentTarget.dataset.costId;
                    const costToRemove = (billData.globalCosts || []).find(gc => gc.id === costId);
                    if (costToRemove) await updateDoc(billDocRef, { globalCosts: arrayRemove(costToRemove) });
                };
            });
            // Modal pozycji obsługujemy ręcznie (nie przez setupModal): zamknięcie musi zależeć od
            // walidacji, a przycisk otwarcia potrzebuje trybu „dodaj" vs „edytuj".
            document.getElementById('add-shared-cost-btn').onclick = () => { if (!refuseFrozen()) openItemModal(null); };
            document.getElementById('cancel-shared-cost').onclick = () => {
                document.getElementById('shared-cost-modal').classList.remove('active');
                editingItemId = null;
            };
            document.getElementById('save-shared-cost').onclick = saveItemFromModal;
            document.getElementById('item-split-btn').onclick = splitEditedItem;
            // „Dla wszystkich" i wybór kwota/procent. `onclick`, nie `addEventListener`:
            // ta funkcja biegnie przy KAŻDYM przerysowaniu rachunku, więc nasłuch dokładany
            // za każdym razem narastałby i po dziesiątej zmianie kwoty jedno stuknięcie
            // wywoływałoby dziesięć reakcji.
            document.getElementById('item-for-all').onclick = () => {
                editingItemForAll = !editingItemForAll;
                if (!editingItemForAll) editingItemValueMode = 'amount';
                syncItemForAllUi();
            };
            document.querySelectorAll('.item-value-mode-btn').forEach((btn) => {
                btn.onclick = () => { editingItemValueMode = btn.dataset.valueMode; syncItemForAllUi(); };
            });

            // Odczyt paragonu przez AI
            document.getElementById('parse-receipt-btn').onclick = runParseReceipt;
            document.getElementById('close-receipt-preview').onclick = () => {
                document.getElementById('receipt-preview-modal').classList.remove('active');
                receiptDraft = null;
            };
            document.getElementById('apply-receipt-btn').onclick = () => { if (!refuseFrozen()) applyReceiptDraft(); };

            // SUMA Z PARAGONU WPISANA RĘCZNIE. Model nie zawsze ją odczyta — bywa ucięta
            // na zdjęciu, rozmazana albo po prostu nie ma jej na wydruku. Do 2026-08-25
            // znaczyło to, że kontrola milknie w całości i arkusz wygląda na sprawdzony.
            // Jedna liczba od człowieka przywraca pełne sprawdzenie: różnicę, kierunek
            // różnicy i oznaczenie pozycji większej niż cały paragon.
            const totalApply = document.getElementById('receipt-total-apply');
            const totalInput = document.getElementById('receipt-total-input');
            if (totalApply && totalInput) {
                totalApply.onclick = () => {
                    if (!receiptDraft) return;
                    const value = parseLocalFloat(totalInput.value);
                    if (!(value > 0)) { showToast('Podaj sumę z paragonu.', true); return; }
                    receiptDraft.receiptTotal = value;
                    totalInput.value = '';
                    renderReceiptPreview(); // pełne przerysowanie: dochodzą oznaczenia na wierszach
                };
                totalInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); totalApply.click(); } };
            }

            // Edycja w podglądzie: każde pole od razu wraca do szkicu, żeby podsumowanie
            // i ostrzeżenie o różnicy liczyły się na tym, co użytkownik faktycznie widzi.
            const preview = document.getElementById('receipt-preview-items');
            preview.oninput = (e) => {
                const t = e.target;
                const i = Number(t.dataset.i);
                if (!receiptDraft || !receiptDraft.items[i]) return;
                if (t.classList.contains('rp-name')) receiptDraft.items[i].description = t.value;
                else if (t.classList.contains('rp-qty')) receiptDraft.items[i].quantity = Math.max(1, Math.trunc(Number(t.value)) || 1);
                else if (t.classList.contains('rp-amount')) receiptDraft.items[i].amount = parseLocalFloat(t.value);
                else return;
                if (!t.classList.contains('rp-name')) renderReceiptPreviewSummaryOnly();
            };
            preview.onchange = (e) => {
                const t = e.target;
                if (!receiptDraft) return;
                if (t.classList.contains('rp-use')) {
                    receiptDraft.items[Number(t.dataset.i)].__use = t.checked;
                    renderReceiptPreview();
                    return;
                }
                // Nazwa albo kwota po WYJŚCIU z pola: przeliczamy oznaczenia usterek.
                // Nie robimy tego przy każdym znaku (`oninput`), bo pełne przerysowanie
                // wyrzuca kursor z edytowanego pola — ale po poprawieniu duplikatu
                // znacznik musi zniknąć, inaczej ostrzega o czymś, czego już nie ma.
                if (t.classList.contains('rp-name') || t.classList.contains('rp-amount')) {
                    renderReceiptPreview();
                }
            };
            document.getElementById('receipt-preview-modifiers').onchange = (e) => {
                const t = e.target;
                if (!t.classList.contains('rp-mod-use') || !receiptDraft) return;
                receiptDraft.modifiers[Number(t.dataset.i)].__use = t.checked;
                renderReceiptPreview();
            };
            // ARKUSZ „Dodaj koszt wspólny" ZNIKNĄŁ 2026-08-30 razem z całym pojęciem.
            // Napiwek, serwis i wino na stół dodaje się dziś tym samym arkuszem, co każdą
            // inną pozycję — przełącznikiem „Dla wszystkich" (patrz `openItemModal`).
            // Uzasadnienie stoi przy tym przełączniku w index.html.
        };

        
        
        // ===================================================
        // ===== SETUP LISTENERS =====
        // ===================================================

        // Faza 6.1: rejestracja service workera (offline + kryterium instalowalności + push).
        // Tylko w PROD — w dev Vite HMR nie współpracuje z SW (cache modułów).
        let swRegistration = null;
        // NOWA WERSJA MUSI SIĘ ZGŁOSIĆ SAMA.
        //
        // Od 2026-08-26 powłoka idzie z pamięci natychmiast (patrz `public/sw.js`), więc
        // po wdrożeniu człowiek pracuje na POPRZEDNIEJ wersji aż do odświeżenia. Bez tego
        // paska zamienilibyśmy trzy sekundy czekania na cichą starą wersję — problem
        // gorszy od naprawianego, bo niewidoczny.
        //
        // Nowy service worker czeka (nie ma już `skipWaiting` w `install`), a sterowanie
        // przejmuje dopiero na wyraźne stuknięcie. Wtedy i tak cały kod ładuje się od nowa,
        // więc nie ma ryzyka, że nowy worker poda nowe pliki staremu kodowi.
        const showUpdateBanner = (worker) => {
            const banner = document.getElementById('update-banner');
            const button = document.getElementById('update-reload-btn');
            if (!banner || !button || !worker) return;
            banner.classList.remove('hidden');
            button.onclick = () => {
                button.disabled = true;
                button.textContent = 'Odświeżam…';
                worker.postMessage({ type: 'skip-waiting' });
            };
        };

        const watchForUpdate = (registration) => {
            if (!registration) return;
            // Worker mógł skończyć instalację, zanim strona zdążyła się podpiąć.
            if (registration.waiting && navigator.serviceWorker.controller) {
                showUpdateBanner(registration.waiting);
            }
            registration.addEventListener('updatefound', () => {
                const nowy = registration.installing;
                if (!nowy) return;
                nowy.addEventListener('statechange', () => {
                    // `controller` odróżnia AKTUALIZACJĘ od pierwszej instalacji w życiu.
                    // Przy pierwszej nie ma o czym informować — nie ma poprzedniej wersji.
                    if (nowy.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner(nowy);
                    }
                });
            });
            // Przejęcie sterów przez nowego workera to jedyny moment, w którym wolno
            // przeładować stronę: od tej chwili wszystkie zasoby idą już z nowego wydania.
            let przeladowano = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (przeladowano) return;
                przeladowano = true;
                window.location.reload();
            });
        };

        const registerServiceWorker = () => {
            if (!('serviceWorker' in navigator)) return;
            if (!import.meta.env.PROD) return;
            window.addEventListener('load', async () => {
                try {
                    swRegistration = await navigator.serviceWorker.register('/sw.js');
                    watchForUpdate(swRegistration);
                    await navigator.serviceWorker.ready;
                    warmOfflineCache();
                    setupPush();
                } catch (err) {
                    console.warn('[Billiada] Rejestracja service workera nieudana:', err);
                }
            });
        };

        // Service worker przy instalacji wyczytuje listę zasobów z `index.html` i z arkusza
        // stylów, więc nie wie o kawałkach doładowywanych leniwie (`heic2any` przy zdjęciu
        // z iPhone'a). Strona wie — pyta przeglądarkę, co naprawdę pobrała, i podaje listę.
        // Service worker i tak odsiewa wszystko spoza `/assets/` i `/icons/`, więc ruch
        // do Firebase nie ma jak tu wejść.
        const warmOfflineCache = () => {
            const target = swRegistration && (swRegistration.active || navigator.serviceWorker.controller);
            if (!target || typeof performance === 'undefined' || !performance.getEntriesByType) return;
            try {
                const urls = performance.getEntriesByType('resource')
                    .map((e) => e.name)
                    .filter((u) => u.startsWith(window.location.origin));
                if (urls.length) target.postMessage({ type: 'warm-cache', urls });
            } catch (err) {
                console.warn('[Billiada] Dogrzanie pamięci offline nieudane:', err);
            }
        };

        // --- Faza 6.4: powiadomienia push (FCM) ---
        // Token trzymamy w members.{id}.fcmTokens (tablica — jedna osoba może mieć telefon + laptop).
        // Wysyłką zajmie się backend (docelowo trigger na nudges/{id}); klient tylko rejestruje token.
        const VAPID_KEY = env.VITE_FCM_VAPID_KEY || '';
        let pushToken = null;
        // Rejestracja w toku. Bez tego stanu przełącznik nie umiał odróżnić „zgoda jest,
        // trwa zapisywanie urządzenia" od „zgody nie ma" — a to są dwie różne rzeczy.
        let pushRegistering = false;
        // TOKEN NALEŻY ZAPISAĆ W KAŻDYM POKOJU, NIE W JEDNYM.
        // Tokeny mieszkają w `members.{id}.fcmTokens` WEWNĄTRZ dokumentu grupy, a wysyłka
        // (`sendNudgePush`) szuka ich w grupie, z której poszło przypomnienie. Stała tu
        // kiedyś jedna flaga „już zapisane", więc token trafiał wyłącznie do pokoju
        // otwartego w chwili włączania powiadomień. Kto należał do dwóch pokoi, dostawał
        // push tylko z jednego — a z drugiego funkcja widziała pustą listę urządzeń
        // i po cichu odpuszczała.
        //
        // ZBIÓR, nie pojedynczy klucz (scalenie dwóch napraw, 2026-08-17). Ten sam błąd
        // naprawiono niezależnie w dwóch liniach pracy: jedna zbiorem pokoi, druga kluczem
        // `pokój:osoba:token`. Klucz jest mądrzejszy — łapie też zmianę tokenu i zmianę
        // tożsamości — ale pamiętał tylko OSTATNI zapis, więc chodzenie tam i z powrotem
        // między dwoma pokojami pisało do bazy przy każdym wejściu. Zbiór takich kluczy
        // bierze zaletę obu: pamięta wszystkie pokoje i nadal reaguje na nowy token.
        const pushTokenSavedFor = new Set();

        // Na iPhonie Push API istnieje WYŁĄCZNIE w aplikacji dodanej do ekranu początkowego.
        // W zwykłej karcie Safari `Notification` bywa zdefiniowane, więc sam jego widok
        // niczego nie dowodzi — bez `PushManager` zgoda i tak donikąd nie prowadzi.
        const isStandaloneApp = () => window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
        const isIosDevice = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const pushNeedsInstall = () => isIosDevice() && !isStandaloneApp();

        const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator
            && 'PushManager' in window && !!VAPID_KEY;

        // POWÓD, DLA KTÓREGO PRZYPOMNIENIA „ZADZIAŁAŁY RAZ, A POTEM PRZESTAŁY".
        //
        // Token FCM zmienia się — na iPhonie potrafi się zmienić po każdym zamknięciu
        // aplikacji dodanej do ekranu początkowego. `setupPush()` pobiera przy starcie
        // świeży token i próbuje go zapisać, ale w tej chwili pokój NIE JEST jeszcze
        // wczytany (`groupData` puste), więc zapis kończył się cichym `return` — i nikt
        // nigdy nie próbował ponownie. Do bazy nie trafiał żaden nowy token, a stary
        // funkcja wysyłkowa usuwała jako martwy przy pierwszej nieudanej próbie.
        // Efekt z punktu widzenia człowieka: raz przyszło, potem cisza bez powodu.
        //
        // Teraz zapis jest PONAWIANY po każdym wczytaniu pokoju, a klucz pilnuje, żeby
        // nie pisać w kółko tego samego.
        const savePushToken = async () => {
            if (!pushToken || !currentGroupId || !groupData) return;
            const my = myMemberNow();
            if (!my) return;
            const key = `${currentGroupId}:${my.id}:${pushToken}`;
            if (pushTokenSavedFor.has(key)) return;
            try {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), {
                    [`members.${my.id}.fcmTokens`]: arrayUnion(pushToken),
                });
                pushTokenSavedFor.add(key);
            } catch (err) {
                // Bez rzucania dalej: brak zapisu tokenu nie ma prawa wywalić ekranu.
                // Następne wejście do pokoju spróbuje jeszcze raz.
                console.warn('[Billiada] Nie udało się zapisać tokenu powiadomień:', err);
            }
        };

        const renderPushToggle = () => {
            const btn = document.getElementById('push-toggle-btn');
            const label = document.getElementById('push-toggle-label');
            const note = document.getElementById('push-toggle-note');
            if (!btn || !label || !note) return;
            // Na iPhonie mówimy WPROST, czego brakuje, zamiast dawać przełącznik, który
            // i tak nie zadziała: w karcie Safari powiadomień po prostu nie ma, są dopiero
            // w skrócie z ekranu początkowego. Wcześniej ta różnica ginęła w jednym zdaniu
            // o „przeglądarce, która nie obsługuje".
            if (pushNeedsInstall()) {
                label.textContent = 'Najpierw dodaj do ekranu początkowego';
                note.textContent = 'iPhone wysyła powiadomienia tylko do aplikacji dodanej do ekranu początkowego — w karcie Safari nie zadziałają.';
                btn.disabled = true;
                btn.classList.add('opacity-60');
                return;
            }
            if (!pushSupported()) {
                label.textContent = 'Powiadomienia niedostępne';
                note.textContent = 'Ta przeglądarka ich nie obsługuje.';
                btn.disabled = true;
                btn.classList.add('opacity-60');
                return;
            }
            // PIĘĆ STANÓW, NIE TRZY.
            //
            // Zgłoszenie z 2026-08-25: „jak włączyłem notifications, wyskoczył alert, że się
            // nie powiodło, ale potem jak klikam na tę opcję, to pisze, że są włączone".
            //
            // Rzeczywistość ma dwa NIEZALEŻNE stany, a interfejs zlepiał je w jeden:
            //   ZGODA        — systemowa odpowiedź `Notification.permission`
            //   REJESTRACJA  — token FCM, który potrafi się nie udać przy słabej sieci
            // Zgoda przyznana bez tokenu renderowała się jako „Włącz powiadomienia", czyli
            // jako BRAK ZGODY — nieprawda. Chwilę później `setupPush` po cichu dobierał token
            // i przełącznik mówił „włączone". Stąd dokładnie ta sprzeczność.
            const perm = Notification.permission;
            if (perm === 'denied') {
                label.textContent = 'Powiadomienia zablokowane';
                note.textContent = 'Odblokuj je w ustawieniach przeglądarki dla tej strony.';
            } else if (perm === 'granted' && pushToken) {
                label.textContent = 'Powiadomienia włączone';
                note.textContent = 'Dostaniesz przypomnienie o zaległości nawet przy zamkniętej apce.';
            } else if (perm === 'granted' && pushRegistering) {
                label.textContent = 'Kończę rejestrację…';
                note.textContent = 'Zgoda jest. Zapisuję to urządzenie — przy słabej sieci chwilę to trwa.';
            } else if (perm === 'granted') {
                label.textContent = 'Zgoda jest, urządzenie niezapisane';
                note.textContent = 'Spróbuję ponownie, gdy wróci sieć. Możesz też stuknąć tutaj.';
            } else {
                label.textContent = 'Włącz powiadomienia';
                note.textContent = 'Przypomnienia o zaległościach trafią na to urządzenie.';
            }
        };

        // `getToken` potrafi wisieć bez końca przy sieci, która jest, ale nie odpowiada —
        // a wtedy przełącznik stoi w „Kończę rejestrację…" w nieskończoność. Limit czasu
        // zamienia to w porażkę, którą da się ponowić.
        const PUSH_TOKEN_TIMEOUT_MS = 8000;
        // Pierwsze podejście od razu, dwa kolejne z rosnącą przerwą. Trzy próby zamykają
        // się w kilkunastu sekundach, czyli w czasie, w którym człowiek jeszcze patrzy.
        const PUSH_RETRY_DELAYS_MS = [0, 2000, 6000];

        const withTimeout = (promise, ms, label) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: przekroczono ${ms} ms`)), ms)),
        ]);

        let messagingPromise = null;
        const loadMessaging = () => {
            if (!messagingPromise) messagingPromise = import('firebase/messaging');
            return messagingPromise;
        };

        const acquirePushToken = async () => {
            const { getMessaging, getToken } = await loadMessaging();
            const messaging = getMessaging(app);
            pushToken = await withTimeout(getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: swRegistration || undefined,
            }), PUSH_TOKEN_TIMEOUT_MS, 'getToken');
            // Nie ma tu czyszczenia pamięci zapisanych tokenów i nie jest potrzebne:
            // Safari unieważnia subskrypcję po cichu, więc token po restarcie bywa NOWY —
            // ale wtedy zmienia się też klucz `pokój:osoba:token`, którego szuka
            // `savePushToken`, i zapis wykona się sam. Zerowanie pamięci kasowałoby przy
            // okazji wiedzę o pozostałych pokojach.
            //
            // Log zostaje celowo: to jedyna droga, żeby wyjąć token z urządzenia i wysłać
            // na nie próbny dymek przez `scripts/send-test-push.mjs`. Token nie daje dostępu
            // do niczego poza wysłaniem powiadomienia na to jedno urządzenie.
            // Log tylko w trybie deweloperskim: to jedyna droga, żeby wyjąć token
            // z urządzenia i wysłać na nie próbny dymek przez `scripts/send-test-push.mjs`.
            // W wydaniu dla ludzi nie ma powodu, żeby leżał w konsoli produkcyjnej.
            if (env.DEV) console.info('[Billiada] Token FCM tego urządzenia:', pushToken);
            await savePushToken();
            return pushToken;
        };

        // Rejestracja z ponowieniem. Zwraca `true`, gdy token jest.
        const acquirePushTokenWithRetry = async () => {
            if (pushRegistering) return Boolean(pushToken);
            pushRegistering = true;
            renderPushToggle();
            try {
                for (let i = 0; i < PUSH_RETRY_DELAYS_MS.length; i += 1) {
                    if (PUSH_RETRY_DELAYS_MS[i]) {
                        await new Promise((r) => setTimeout(r, PUSH_RETRY_DELAYS_MS[i]));
                    }
                    try {
                        await acquirePushToken();
                        return true;
                    } catch (err) {
                        console.warn(`[Billiada] Push — próba ${i + 1} nieudana:`, err);
                    }
                }
                return false;
            } finally {
                pushRegistering = false;
                renderPushToggle();
            }
        };

        const enablePush = async () => {
            if (!pushSupported()) { showToast('Ta przeglądarka nie obsługuje powiadomień.', true); return; }

            // ZGODA I REJESTRACJA TO DWIE OSOBNE RZECZY i komunikaty muszą je rozróżniać.
            // Dotąd nieudane pobranie tokenu dawało czerwone „Nie udało się włączyć
            // powiadomień." — zdanie nieprawdziwe, bo zgoda BYŁA przyznana, a brakowało
            // tylko zapisu urządzenia. Chwilę później token dochodził sam i przełącznik
            // mówił „włączone", czyli aplikacja przeczyła własnemu alertowi sprzed minuty.
            let perm;
            try {
                perm = await Notification.requestPermission();
            } catch (err) {
                console.warn('[Billiada] Push — pytanie o zgodę nieudane:', err);
                showToast('Nie udało się zapytać o zgodę na powiadomienia.', true);
                renderPushToggle();
                return;
            }

            if (perm !== 'granted') {
                showToast('Nie przyznano zgody na powiadomienia.', true);
                renderPushToggle();
                return;
            }

            showToast('Zgoda przyznana. Kończę rejestrację…');
            const ok = await acquirePushTokenWithRetry();
            showToast(
                ok
                    ? 'Powiadomienia włączone.'
                    : 'Zgoda jest, ale nie udało się zapisać tego urządzenia. Spróbuję ponownie, gdy wróci sieć.',
                !ok,
            );
        };

        // Wołane po rejestracji service workera. Nie prosi o zgodę — tylko odświeża token,
        // jeśli użytkownik już wcześniej ją dał (tokeny FCM potrafią się zmienić).
        const setupPush = async () => {
            try {
                if (!pushSupported()) { renderPushToggle(); return; }
                const { getMessaging, onMessage, isSupported: isMessagingSupported } = await loadMessaging();
                if (!(await isMessagingSupported())) { renderPushToggle(); return; }
                const messaging = getMessaging(app);
                // Wiadomość przy otwartej apce: przeglądarka nie pokaże systemowego dymka — pokazujemy toast.
                onMessage(messaging, (payload) => {
                    const d = (payload && payload.data) || {};
                    showToast(d.body || d.title || 'Nowe przypomnienie.');
                    if (currentGroupId) updateNudgeBadge();
                });
                if (Notification.permission === 'granted') await acquirePushTokenWithRetry();
                renderPushToggle();

                // DRUGA SZANSA PO POWROCIE SIECI. Zgoda bez tokenu to stan przejściowy,
                // który sam się nie naprawi — a powstaje dokładnie tam, gdzie ta aplikacja
                // pracuje: przy zasięgu na jedną kreskę. Bez tego nasłuchu człowiek zostaje
                // z przełącznikiem mówiącym „urządzenie niezapisane" aż do restartu aplikacji.
                window.addEventListener('online', () => {
                    if (Notification.permission === 'granted' && !pushToken) acquirePushTokenWithRetry();
                });
            } catch (err) {
                console.warn('[Billiada] Push — inicjalizacja nieudana:', err);
            }
        };

        const setupPwaInstallButton = () => {
            const installButton = document.getElementById('install-pwa-btn');
            const modal = document.getElementById('install-modal');

            // Czy apka już działa jako zainstalowana (standalone)?
            const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
            // iOS Safari nie odpala `beforeinstallprompt` — zostają kroki ręczne.
            const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

            // Arkusz mówi najpierw PO CO instalować, a dopiero potem JAK. Wcześniej
            // instrukcja wisiała na ekranie profilu na stałe i podawała same kroki,
            // więc czytało się to jak polecenie bez powodu.
            const showInstallSheet = () => {
                if (!modal) return;
                const paths = {
                    'install-steps-ios': isIos && !isStandalone(),
                    'install-steps-prompt': !isIos && !isStandalone() && !!deferredInstallPrompt,
                    'install-steps-none': !isIos && !isStandalone() && !deferredInstallPrompt,
                    'install-steps-done': isStandalone(),
                };
                Object.entries(paths).forEach(([id, visible]) => {
                    const el = document.getElementById(id);
                    if (el) el.classList.toggle('hidden', !visible);
                });
                // Kod pokoju w kroku po instalacji: skrót z ekranu początkowego otwiera
                // aplikację bez adresu grupy, więc bez kodu użytkownik ląduje w pustce.
                const serial = document.getElementById('install-room-serial');
                if (serial) serial.textContent = currentGroupId ? formatSerial(currentGroupId) : 'brak';
                // Poza pokojem nie ma czego kopiować: przycisk przestaje udawać, że ma.
                const serialBtn = document.getElementById('install-room-serial-btn');
                if (serialBtn) {
                    serialBtn.disabled = !currentGroupId;
                    serialBtn.classList.toggle('opacity-60', !currentGroupId);
                    const icon = serialBtn.querySelector('i');
                    if (icon) icon.classList.toggle('hidden', !currentGroupId);
                }
                modal.classList.add('active');
            };

            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredInstallPrompt = e;
            });

            if (installButton) installButton.addEventListener('click', showInstallSheet);

            // Ten sam komunikat co przy numerze w nagłówku pokoju — kopiuje się kod, nie link.
            const installSerialBtn = document.getElementById('install-room-serial-btn');
            if (installSerialBtn) installSerialBtn.onclick = () => copyText(currentGroupId, 'Kod pokoju skopiowany.');

            const confirmBtn = document.getElementById('install-pwa-confirm');
            if (confirmBtn) confirmBtn.onclick = async () => {
                if (!deferredInstallPrompt) return;
                if (modal) modal.classList.remove('active');
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                console.log(`Akcja użytkownika (instalacja): ${outcome}`);
                deferredInstallPrompt = null;
            };

            const closeBtn = document.getElementById('close-install-modal');
            if (closeBtn) closeBtn.onclick = () => modal && modal.classList.remove('active');

            window.addEventListener('appinstalled', () => {
                deferredInstallPrompt = null;
                showToast('Aplikacja została zainstalowana!');
            });
        };

        const setupStartScreenListeners = () => {
            // „Moje pokoje" — delegacja (kontener przerendrowuje innerHTML).
            const roomsContainer = document.getElementById('my-rooms');
            if (roomsContainer) roomsContainer.addEventListener('click', (e) => {
                const enter = e.target.closest('.enter-room-btn');
                if (enter) {
                    const id = enter.dataset.roomId;
                    history.pushState(null, '', `?group=${id}`);
                    handleGroupJoin(id);
                }
                // Kasowanie obsługuje `wireRoomSwipe` przy konkretnym wierszu — tam,
                // gdzie żyje stan odsłonięcia kosza.
            });

            // WEJŚCIE KODEM. Kod czyta się z cudzego telefonu albo z kartki, więc
            // przyjmujemy go tak, jak człowiek go przepisze: ze spacjami, małymi
            // literami, myślnikami. Sprawdzamy, czy pokój istnieje, ZANIM przełączymy
            // ekran — inaczej literówka kończy się pustym ekranem bez wyjaśnienia.
            const joinInput = document.getElementById('join-code-input');
            const joinBtn = document.getElementById('join-code-btn');
            const joinError = document.getElementById('join-code-error');
            const showJoinError = (message) => {
                if (!joinError) return;
                joinError.textContent = message;
                joinError.classList.toggle('hidden', !message);
            };
            const enterByCode = async () => {
                const raw = (joinInput.value || '').trim();
                const stripped = raw.replace(/[\s-]/g, '');
                if (!stripped) { showJoinError('Wpisz kod pokoju.'); joinInput.focus(); return; }
                // Identyfikator pokoju powstaje z `Math.random().toString(36)`, więc jest
                // MAŁYMI literami — a `formatSerial` pokazuje go wielkimi, bo tak czyta się
                // numer z cudzego telefonu. Kod przepisany z ekranu trzeba więc sprowadzić
                // do małych liter, inaczej wyszukanie zawsze pudłuje. Wariant „jak wpisano"
                // zostaje jako druga próba, gdyby kiedyś doszedł inny sposób nadawania kodów.
                const candidates = [...new Set([stripped.toLowerCase(), stripped])];
                showJoinError('');
                joinBtn.disabled = true;
                try {
                    let found = null;
                    for (const code of candidates) {
                        const snap = await getDoc(doc(db, `artifacts/${appId}/public/data/groups`, code));
                        if (snap.exists()) { found = code; break; }
                    }
                    if (!found) {
                        showJoinError('Nie ma pokoju o takim kodzie. Sprawdź, czy nie wkradła się literówka.');
                        return;
                    }
                    history.pushState(null, '', `?group=${found}`);
                    handleGroupJoin(found);
                } catch (e) {
                    console.error(e);
                    showJoinError('Nie udało się sprawdzić kodu. Sprawdź połączenie i spróbuj ponownie.');
                } finally {
                    joinBtn.disabled = false;
                }
            };
            if (joinBtn) joinBtn.onclick = enterByCode;
            if (joinInput) joinInput.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); enterByCode(); }
            };

            // --- Skład grupy jako żetony ---
            // Imiona dodaje się pojedynczo i widać je od razu. Ukryte pole `member-names`
            // zostaje źródłem prawdy przy zapisie, żeby jedna lista miała jednego właściciela.
            const nameInput = document.getElementById('member-name-input');
            const addBtn = document.getElementById('add-member-btn');
            const chipsEl = document.getElementById('member-chips');
            const hintEl = document.getElementById('member-hint');
            const hiddenNames = document.getElementById('member-names');
            const groupNameInput = document.getElementById('group-name');
            const createBtn = document.getElementById('create-group-btn');
            let draftMembers = [];

            const syncDraft = () => {
                hiddenNames.value = draftMembers.join(',');
                chipsEl.innerHTML = draftMembers.map((name, i) => {
                    // TEN SAM WZÓR CO PRZY ZAKŁADANIU GRUPY (audyt 2026-08-16).
                    // Wcześniej kolor liczył się tu skrótem z roboczego napisu zawierającego
                    // numer pozycji, podczas gdy grupa przydziela je przez `(index * 7) % 16`.
                    // Dwa różne wzory na tę samą rzecz znaczyły, że KAŻDY znak zmieniał kolor
                    // w chwili założenia pokoju: dodawałeś zielonego Boba, a po wejściu
                    // zastawałeś różowego. W aplikacji, w której znak i jego kolor są
                    // tożsamością człowieka, to podważa całą tę tożsamość.
                    const color = IDENTITY_COLORS[(i * 7) % IDENTITY_COLORS.length];
                    // Kasownik żetonu miał 24×18 px — poniżej progu trafienia kciukiem.
                    // Teraz jest kołem 32 px w żetonie o wysokości 44 px.
                    return `<span class="chip pl-1 pr-1 py-1 gap-2 h-11">
                        <span class="w-8 h-8 rounded-full inline-flex items-center justify-center text-xs font-bold flex-shrink-0" style="background-color:${escapeHtml(color)};color:${readableInk(color)}">${escapeHtml(initials(name))}</span>
                        <span class="text-sm font-bold text-ink">${escapeHtml(name)}</span>
                        <button class="draft-member-remove hit-44 w-8 h-8 rounded-full flex items-center justify-center text-ink-3 text-lg leading-none flex-shrink-0" data-index="${i}" title="Usuń ${escapeHtml(name)} z grupy" aria-label="Usuń ${escapeHtml(name)}">&times;</button>
                    </span>`;
                }).join('');
                hintEl.textContent = draftMembers.length === 0
                    ? 'Zacznij od siebie. Resztę możesz dopisać teraz albo później.'
                    : (draftMembers.length === 1
                        ? 'Dopisz resztę ekipy albo zaproś ich linkiem po założeniu grupy.'
                        : `${draftMembers.length} osoby w grupie.`);
                if (createBtn && !createBtn.disabled) {
                    createBtn.textContent = draftMembers.length === 0 ? 'Dodaj choć jedną osobę' : 'Załóż grupę';
                }
            };

            const addDraftMember = () => {
                const name = nameInput.value.trim();
                if (!name) return;
                // Dwie osoby o tym samym imieniu w grupie to gwarantowana pomyłka przy
                // przypisywaniu pozycji — lepiej powiedzieć to teraz niż przy rachunku.
                if (draftMembers.some(n => n.toLowerCase() === name.toLowerCase())) {
                    showToast('Taka osoba już jest na liście. Dodaj rozróżnienie, np. nazwisko.', true);
                    return;
                }
                draftMembers.push(name);
                nameInput.value = '';
                nameInput.focus();
                syncDraft();
            };

            if (addBtn) addBtn.addEventListener('click', addDraftMember);
            if (nameInput) nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addDraftMember(); }
            });
            if (chipsEl) chipsEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.draft-member-remove');
                if (!btn) return;
                draftMembers.splice(Number(btn.dataset.index), 1);
                syncDraft();
            });
            if (groupNameInput) groupNameInput.addEventListener('input', syncDraft);
            syncDraft();

            document.getElementById('create-group-btn').addEventListener('click', async () => {
                const groupName = document.getElementById('group-name').value.trim();
                const memberNames = document.getElementById('member-names').value.trim()
                    .split(',').map(name => name.trim()).filter(name => name.length > 0);

                // Komunikat mówi, CZEGO brakuje — „wypełnij wszystkie pola" zostawiało
                // szukanie na użytkowniku.
                if (!groupName) { showToast('Nazwij grupę, po niej znajdziesz ją później.', true); return; }
                if (memberNames.length === 0) { showToast('Dodaj choć jedną osobę do grupy.', true); return; }
                const newGroupId = generateId();
                const membersMap = {};
                const memberOrder = []; // Array to store the order of members

                memberNames.forEach((name, index) => {
                    const id = generateId();
                    // Kolory rozrzucamy PO PALECIE, a nie po kolei. Paleta jest ułożona
                    // wzdłuż koła barw, więc branie kolejnych pozycji dawało małej grupie
                    // same barwy sąsiadujące: przy czterech osobach wychodziły cztery
                    // odcienie tego samego rejonu. Krok 7 jest względnie pierwszy z 16,
                    // więc obchodzi całą paletę bez powtórki, a kolejni ludzie dostają
                    // kolory z przeciwnych stron koła.
                    membersMap[id] = { id, name, claimedBy: null, color: PROFILE_COLORS[(index * 7) % PROFILE_COLORS.length] };
                    memberOrder.push(id); // Add member ID to the order array
                });

                await setDoc(doc(db, `artifacts/${appId}/public/data/groups`, newGroupId), {
                    groupName,
                    adminId: currentUser.uid,
                    totalStorageUsed: 0,
                    expenseSummary: {},
                    userGrossSpend: {},
                    groupGrossSpend: {},
                    members: membersMap,
                    memberOrder: memberOrder // Save the member order
                });
                history.pushState(null, '', `?group=${newGroupId}`);
                handleGroupJoin(newGroupId);
            });
        };

        // --- Faza 4: usuwanie rachunku z opcją „Cofnij" (undo) zamiast modala potwierdzenia ---
        let pendingBillDeletion = null; // { groupId, billId, data, photos, size, finalizeTimer, toast }

        // Domknięcie usunięcia PO oknie undo: dopiero teraz kasujemy zdjęcia ze Storage.
        const finalizeBillDeletion = async (pending) => {
            if (!pending) return;
            clearTimeout(pending.finalizeTimer);
            if (pending.toast) pending.toast.remove();
            if (pendingBillDeletion === pending) pendingBillDeletion = null;
            const photos = pending.photos || [];
            if (photos.length === 0) return;
            await Promise.all(photos.map(p => (p && p.url)
                ? deleteObject(ref(storage, p.url)).catch(err => console.error("Błąd usuwania zdjęcia ze storage:", err))
                : Promise.resolve()));
            if (pending.size > 0) {
                const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, pending.groupId);
                await updateDoc(groupDocRef, { totalStorageUsed: increment(-pending.size) }).catch(err => console.error(err));
            }
        };

        // Cofnięcie: odtwarzamy rachunek z ORYGINALNYM id (zdjęcia nietknięte, URL-e nadal ważne, storage bez zmian).
        const undoBillDeletion = async (pending) => {
            if (!pending) return;
            clearTimeout(pending.finalizeTimer);
            if (pendingBillDeletion === pending) pendingBillDeletion = null;
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${pending.groupId}/bills`, pending.billId);
            try {
                await setDoc(billDocRef, pending.data);
                showToast("Przywrócono rachunek.");
            } catch (err) {
                console.error("Błąd przywracania rachunku:", err);
                showToast("Nie udało się przywrócić rachunku.", true);
            }
        };

        // PASEK „COFNIJ" CHOWA SIĘ SAM (zgłoszenie właściciela 2026-08-27).
        //
        // Nie miał własnego licznika. Przepływ usuwania rachunku sprzątał go po swojemu
        // (`finalizeBillDeletion` po sześciu sekundach), więc tam znikał — ale ukrycie
        // i przywrócenie rachunku wołają go bez żadnego sprzątania, a wtedy pasek zostawał
        // na ekranie do końca sesji i zasłaniał dolną nawigację.
        //
        // Sześć sekund, nie 3,6 jak zwykły toast: to jest okno na COFNIĘCIE, a nie sam
        // komunikat, więc musi trwać tyle, ile trwa możliwość cofnięcia (tyle samo, co
        // termin domknięcia kasowania rachunku).
        const UNDO_TOAST_MS = 6000;
        const showUndoToast = (message, onUndo) => {
            const toastId = 'toast-notification';
            const existing = document.getElementById(toastId);
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = toastId;
            toast.className = 'toast-in toast-dock toast-bar px-4 py-3 rounded-block flex items-center gap-4';
            const span = document.createElement('span');
            span.textContent = message;
            const btn = document.createElement('button');
            btn.textContent = 'Cofnij';
            btn.className = 'toast-undo tap min-h-tap px-3 rounded-full font-bold underline whitespace-nowrap flex-shrink-0';
            btn.onclick = () => { toast.remove(); onUndo(); };
            toast.append(span, btn);
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 400);
            }, UNDO_TOAST_MS);
            return toast;
        };

        const deleteBillWithUndo = async () => {
            if (!currentGroupId || !currentBillId || !billData) return;
            const myGroupMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            // Tylko potwierdzony płatnik może usunąć (spójne z regułami).
            if (!myGroupMember || !billData.payerId || billData.payerId !== myGroupMember.id || !billData.payerConfirmed) {
                showToast("Tylko potwierdzony płatnik może usunąć rachunek.", true);
                return;
            }
            // Jeśli inne usunięcie wciąż czeka na domknięcie — domknij je najpierw.
            if (pendingBillDeletion) await finalizeBillDeletion(pendingBillDeletion);

            const groupId = currentGroupId;
            const billId = currentBillId;
            const savedData = billData; // żywa referencja — zachowuje typy Firestore (np. Timestamp createdAt → kolejność listy).
            const photos = (billData.photos || []).slice();
            const size = photos.reduce((s, p) => s + (p && typeof p.size === 'number' ? p.size : 0), 0);

            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${groupId}/bills`, billId);
            try {
                if (unsubscribeBill) unsubscribeBill();
                await deleteDoc(billDocRef);
            } catch (error) {
                console.error("Błąd podczas usuwania rachunku:", error);
                showToast("Nie udało się usunąć rachunku.", true);
                return;
            }

            const pending = { groupId, billId, data: savedData, photos, size, finalizeTimer: null, toast: null };
            pending.finalizeTimer = setTimeout(() => finalizeBillDeletion(pending), 6000);
            pending.toast = showUndoToast("Rachunek usunięty.", () => undoBillDeletion(pending));
            pendingBillDeletion = pending;

            navigateToGroup(groupId);
        };

        const setupGlobalModalListeners = () => {
            // --- ZAMYKANIE OKNA: jedna zasada dla wszystkich ---
            //
            // Wcześniej tylko pięć z trzynastu okien reagowało na kliknięcie w tło, więc
            // z reszty dało się wyjść wyłącznie znajdując właściwy przycisk. Na telefonie
            // to jest pułapka: arkusz zajmuje ekran, a droga powrotna zależy od tego,
            // które okno akurat trafiło.
            //
            // Wyjątkiem są okna potwierdzeń nieodwracalnych: tam przypadkowe muśnięcie
            // tła nie może uchodzić za odpowiedź, więc trzeba wskazać wprost.
            const CONFIRM_MODALS = new Set([
                'delete-confirm-modal',
                'delete-photo-confirm-modal',
                'confirm-modal',
                'takeover-name-modal',
                // Pytanie „czy to Ty zapłaciłeś" ma dwie prawidłowe odpowiedzi i żadna
                // z nich nie brzmi „muśnięcie ekranu". Bez potwierdzenia rachunek nie
                // wchodzi do rozliczeń, więc wyjście bokiem tylnym byłoby cichym „nie wiem".
                'payer-claim-modal',
            ]);
            const openModals = () => [...document.querySelectorAll('.modal.active')];
            // Zamykamy przez `closeModal`, nie przez zdjęcie klasy: okno nowego rachunku
            // ma własną drogę wyjścia (odwrotna animacja plus obrót koła [+] z powrotem
            // w plus). Zdjęcie samej klasy zostawiłoby krzyżyk w pasku przy zamkniętym
            // oknie — przycisk kłamałby o swoim stanie.
            const closeTopModal = () => {
                const top = openModals().pop();
                if (top && !CONFIRM_MODALS.has(top.id)) closeModal(top);
            };

            document.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                // Kliknięcie MUSI trafić w samo tło — kliknięcie w arkusz nie zamyka okna.
                if (modal && e.target === modal && !CONFIRM_MODALS.has(modal.id)) {
                    closeModal(modal);
                }
            });

            // Klawisz Escape robi to samo. Na komputerze to odruch, a aplikacja działa
            // też tam — poza tym daje drogę wyjścia obsłudze z klawiatury.
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && openModals().length) closeTopModal();
            });

            // Kontekstowy help „?" — jeden przycisk w nagłówku każdego ekranu, który
            // ma treść pomocy. Delegacja, bo przycisków jest kilka i żyją w różnych
            // nagłówkach, a wszystkie robią to samo.
            document.addEventListener('click', (e) => {
                if (e.target.closest('.help-btn')) showHelp();
            });

            const closeBillModal = document.getElementById('close-bill-modal');
            document.getElementById('close-close-bill-modal').onclick = () => closeModal(closeBillModal);
            const helpModal = document.getElementById('help-modal');
            document.getElementById('close-help-modal').onclick = () => helpModal.classList.remove('active');
            helpModal.onclick = (e) => { if (e.target === helpModal) helpModal.classList.remove('active'); };

            // Metody płatności (modal edytora)
            const pmModal = document.getElementById('payment-methods-modal');
            document.getElementById('close-payment-methods-modal').onclick = () => pmModal.classList.remove('active');
            pmModal.onclick = (e) => { if (e.target === pmModal) pmModal.classList.remove('active'); };
            const pmTypeBtn = document.getElementById('pm-add-type');
            const pmLabelInput = document.getElementById('pm-add-label');
            const pmValueInput = document.getElementById('pm-add-value');
            pmTypeBtn.onclick = () => {
                openChoiceSheet({
                    title: 'Rodzaj sposobu płatności',
                    current: pmTypeBtn.dataset.value || 'account',
                    options: Object.entries(PAYMENT_TYPES).map(([value, t]) => ({ value, label: t.label, hint: t.placeholder })),
                    onPick: (value) => setPaymentAddType(value),
                });
            };
            document.getElementById('pm-add-btn').onclick = async () => {
                const type = pmTypeBtn.dataset.value || 'account';
                const value = pmValueInput.value.trim();
                const label = pmLabelInput.value.trim();
                if (!value) { showToast('Podaj numer / adres.', true); return; }
                if (type === 'other' && !label) { showToast('Nazwij metodę „Inne".', true); return; }
                const method = { type, value };
                if (type === 'other') method.label = label;
                paymentEditMethods.push(method);
                await savePaymentMethods();
                pmValueInput.value = '';
                pmLabelInput.value = '';
                renderPaymentEditor();
                showToast('Dodano metodę płatności.');
            };
            const pmList = document.getElementById('payment-methods-list');
            pmList.addEventListener('change', async (e) => {
                const inp = e.target.closest('.pm-value-edit');
                if (!inp) return;
                const i = Number(inp.dataset.index);
                if (paymentEditMethods[i]) { paymentEditMethods[i].value = inp.value.trim(); await savePaymentMethods(); showToast('Zapisano.'); }
            });
            pmList.addEventListener('click', async (e) => {
                const rem = e.target.closest('.pm-remove-btn');
                if (!rem) return;
                const i = Number(rem.dataset.index);
                paymentEditMethods.splice(i, 1);
                await savePaymentMethods();
                renderPaymentEditor();
                showToast('Usunięto metodę.');
            });

            // ARKUSZ „ZA CO PŁACISZ" — wybór rachunków pokrywanych jednym przelewem.
            const pickBillsModal = document.getElementById('pick-bills-modal');
            document.getElementById('close-pick-bills').onclick = () => pickBillsModal.classList.remove('active');
            document.getElementById('pick-bills-confirm').onclick = () => {
                if (!pickBillsState) return;
                const wybrane = pickBillsState.rachunki.filter((r) => pickBillsState.wybrane.has(r.billId));
                if (!wybrane.length) return;
                const sumaG = wybrane.reduce((s, r) => s + r.openG, 0);
                pickBillsModal.classList.remove('active');
                openSettleModal(pickBillsState.other, sumaG, pickBillsState.currency, 'send', wybrane.map((r) => r.billId));
            };

            // TE SAME SPRAWY, TEN SAM ZESTAW PRZYCISKÓW — na ekranie rachunku.
            // Osobny nasłuch, bo przerysowanie idzie tam inną drogą, ale akcje są dokładnie
            // te same funkcje: gdyby rachunek miał własną kopię, ta sama czynność zaczęłaby
            // się zachowywać inaczej zależnie od tego, gdzie ją stukniesz.
            const billStacks = document.getElementById('bill-stacks');
            if (billStacks) billStacks.addEventListener('click', (e) => {
                const st = e.target.closest('.stack-toggle');
                if (st) {
                    noteStackHeight(st.dataset.stack);
                    setStackOpen(st.dataset.stack, st.dataset.open !== '1');
                    const my = myMemberNow();
                    if (my) renderBillStacks(my.id);
                    return;
                }
                const yes = e.target.closest('.settle-yes-btn');
                if (yes) { confirmSettlement(yes.dataset.id); return; }
                const no = e.target.closest('.settle-no-btn');
                if (no) { openNoTransferSheet(no.dataset.id); return; }
                const ins = e.target.closest('.settle-insist-btn');
                if (ins) { insistSettlement(ins.dataset.id); return; }
                const oops = e.target.closest('.settle-oops-btn');
                if (oops) { withdrawSettlement(oops.dataset.id); return; }
                const nb = e.target.closest('.nudge-btn');
                if (nb) { openNudgeCompose(nb.dataset.nudgeTo, Number(nb.dataset.amountG), nb.dataset.currency); return; }
                // „Oddał/a mi już" — rzadka droga boczna dla gotówki przy stole. Musi
                // działać także tutaj, bo od 2026-08-29 stos „Czekasz na przelew" stoi
                // również na ekranie rachunku, a ta sama karta bez tego nasłuchu miałaby
                // tam martwy odnośnik.
                const rb = e.target.closest('.receive-btn');
                // Wpłata zapisana TUTAJ dotyczy TEGO rachunku i musi to nieść w danych —
                // inaczej gotówka wzięta przy stole zgasiłaby dług „gdzieś", a rachunek
                // dalej stałby jako nieopłacony.
                if (rb) { openSettleModal(rb.dataset.from, Number(rb.dataset.amountG), rb.dataset.currency, 'receive', currentBillId); return; }
            });

            // GEST PRZESUNIĘCIA MIĘDZY STRONAMI — TREŚĆ IDZIE ZA PALCEM.
            //
            // Do 2026-08-29 gest był zwykłym „machnięciem": aplikacja mierzyła odległość
            // dopiero po oderwaniu palca i podmieniała stronę skokiem. Nie było więc widać
            // ANI ŻE gest istnieje, ANI że właśnie działa — a machnięcie, które nie odpowiada
            // w trakcie, czyta się jak przypadek, nie jak sterowanie (zgłoszenie właściciela).
            //
            // Teraz taśma jedzie w czasie rzeczywistym, razem z pigułką w przełączniku, bo
            // obie biorą położenie z tej samej liczby `--settle-p`. Po oderwaniu palca strona
            // dojeżdża do najbliższej krawędzi — z uwzględnieniem prędkości, więc szybki,
            // krótki ruch też przełącza.
            //
            // OŚ WYBIERA SIĘ RAZ, na pierwszych pikselach ruchu, i nie zmienia do końca gestu.
            // Bez tego gest ukośny raz przewijałby listę, raz przesuwał stronę.
            //
            // GEST ŁAPIE CAŁY EKRAN, NIE SAM KAFELEK (zgłoszenie właściciela 2026-08-30).
            //
            // Nasłuchy wisiały na `#settlements-list`, czyli na elemencie wysokim DOKŁADNIE
            // tyle, ile mierzy treść. Przy jednej sprawie na stronie to pasek na jedną trzecią
            // ekranu, a wszystko pod nim — czyli większość tego, co widać — było martwe.
            // Palec przesuwał się po pustym tle i aplikacja nie odpowiadała, więc gest wyglądał
            // na zepsuty; a gestu, który działa „czasem", ludzie przestają próbować.
            //
            // Słucha więc `#app-scroll` — pojemnika, który JEST oknem (`position: fixed;
            // inset: 0`, patrz src/tailwind.css). Pokrywa całą widoczną powierzchnię niezależnie
            // od tego, ile jest treści, a pasek nawigacji, arkusze i okna leżą POZA nim, więc
            // nie da się przypadkiem złapać przesunięcia wewnątrz otwartego arkusza.
            // Wysokości niczego nie ustawiamy na sztywno: liczba w rodzaju `100dvh - 14rem`
            // musiałaby zgadywać wysokość nagłówka pokoju i bezpiecznych marginesów telefonu,
            // a pomyłka w jedną stronę zostawia martwy pas, w drugą — pasek przewijania donikąd.
            //
            // Widoczność sprawdzamy przez SZEROKOŚĆ taśmy: element w ukrytej zakładce ma zero,
            // więc `box.offsetWidth` jest zarazem testem „czy rozliczenia są na wierzchu"
            // i liczbą, której gest i tak potrzebuje do przeliczenia postępu.
            // Postęp `--settle-p` dalej zapisujemy na `#settlements-list`, bo to jego
            // potomkowie (taśma i pigułka) go czytają.
            const settlementsList = document.getElementById('settlements-list');
            const settleGestureBox = document.getElementById('app-scroll') || settlementsList;
            let swipeX = null, swipeY = null, swipeT = 0, swipeOs = null, swipeW = 1, swipeOd = 0;

            const settleBox = () => document.getElementById('settle-panes');
            const settleProgress = (p) => settlementsList.style.setProperty('--settle-p', String(p));

            settleGestureBox.addEventListener('touchstart', (e) => {
                const box = settleBox();
                if (e.touches.length !== 1 || !box || !box.offsetWidth) { swipeX = null; return; }
                swipeX = e.touches[0].clientX;
                swipeY = e.touches[0].clientY;
                swipeT = Date.now();
                swipeOs = null;
                swipeW = box.offsetWidth || 1;
                swipeOd = settleSide === 'due' ? 1 : 0;
            }, { passive: true });

            settleGestureBox.addEventListener('touchmove', (e) => {
                if (swipeX === null || !e.touches.length) return;
                const dx = e.touches[0].clientX - swipeX;
                const dy = e.touches[0].clientY - swipeY;
                if (swipeOs === null) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    swipeOs = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
                    if (swipeOs === 'x') {
                        const box = settleBox();
                        if (box) {
                            box.classList.remove('is-animated');
                            // NA CZAS GESTU OKNO JEST WYSOKOŚCI DŁUŻSZEJ ZE STRON.
                            // Bez tego strona wjeżdżająca zza krawędzi była przycinana
                            // do wysokości tej, z której się wychodzi — przy jednej sprawie
                            // po lewej i sześciu po prawej wyglądało to jak wjeżdżanie
                            // treści do szpary. Po oderwaniu palca `settlePanesSync`
                            // dojeżdża do wysokości strony, na której naprawdę stanęliśmy.
                            const wysokosci = [...box.querySelectorAll('.settle-pane')].map((p) => p.offsetHeight);
                            if (wysokosci.length) box.style.height = `${Math.max(...wysokosci)}px`;
                        }
                    }
                }
                if (swipeOs !== 'x') return;
                // OPÓR NA KRAWĘDZIACH. Ciągnięcie poza pierwszą i ostatnią stronę zwalnia
                // do jednej trzeciej — palec dostaje odpowiedź „dalej nic nie ma", zamiast
                // trafiać w ścianę bez reakcji.
                let p = swipeOd - dx / swipeW;
                if (p < 0) p = p / 3;
                if (p > 1) p = 1 + (p - 1) / 3;
                settleProgress(p);
            }, { passive: true });

            const settleSwipeEnd = (e) => {
                if (swipeX === null) return;
                const os = swipeOs;
                const start = swipeX;
                const czas = Date.now() - swipeT;
                swipeX = null;
                swipeOs = null;
                if (os !== 'x' || !e.changedTouches.length) { if (os === 'x') settlePanesSync(); return; }
                const dx = e.changedTouches[0].clientX - start;
                // Próg jest podwójny: ćwierć szerokości ekranu ALBO szybki rzut (ponad
                // 0,4 piksela na milisekundę) na co najmniej 40 px. Sam próg odległości
                // kazałby przeciągać stronę do połowy ekranu przy każdym przełączeniu.
                const rzut = czas > 0 && Math.abs(dx) / czas > 0.4 && Math.abs(dx) > 40;
                const przejdz = rzut || Math.abs(dx) > swipeW * 0.25;
                const nowa = przejdz ? (dx < 0 ? 'due' : 'owe') : settleSide;
                settleSideChosen = true;
                settleSide = nowa;
                settlePanesSync();
            };
            settleGestureBox.addEventListener('touchend', settleSwipeEnd, { passive: true });
            settleGestureBox.addEventListener('touchcancel', settleSwipeEnd, { passive: true });

            settlementsList.addEventListener('click', async (e) => {
                const settleRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`, id);

                // Zwinięcie i rozwinięcie stosu. Wybór zapamiętujemy NA URZĄDZENIU, osobno
                // dla każdego stosu — to sprawa tego telefonu i tego, jak ktoś lubi patrzeć,
                // a nie fakt o pokoju.
                const st = e.target.closest('.stack-toggle');
                if (st) {
                    noteStackHeight(st.dataset.stack);
                    setStackOpen(st.dataset.stack, st.dataset.open !== '1');
                    renderSettlements();
                    return;
                }

                const side = e.target.closest('.settle-side-btn');
                if (side) { setSettleSide(side.dataset.side); return; }

                const yes = e.target.closest('.settle-yes-btn');
                if (yes) { confirmSettlement(yes.dataset.id); return; }

                const no = e.target.closest('.settle-no-btn');
                if (no) { openNoTransferSheet(no.dataset.id); return; }

                const ins = e.target.closest('.settle-insist-btn');
                if (ins) { insistSettlement(ins.dataset.id); return; }

                const oops = e.target.closest('.settle-oops-btn');
                if (oops) { withdrawSettlement(oops.dataset.id); return; }

                const nb = e.target.closest('.nudge-btn');
                if (nb) { openNudgeCompose(nb.dataset.nudgeTo, Number(nb.dataset.amountG), nb.dataset.currency); return; }

                const pb = e.target.closest('.pick-bills-btn');
                if (pb) { openPickBills(pb.dataset.other, pb.dataset.currency); return; }

                const b = e.target.closest('.settle-btn');
                if (b) { openSettleModal(b.dataset.to, Number(b.dataset.amountG), b.dataset.currency, 'send'); return; }

                // „ODDAŁ/A MI JUŻ" ROBI TERAZ JEDNĄ RZECZ.
                //
                // Do 2026-08-29 ten przycisk („Mam wpłatę") robił DWIE różne rzeczy pod tym
                // samym napisem: jeśli dłużnik zgłosił wpłatę, po cichu ją potwierdzał,
                // a jeśli nie — otwierał arkusz. Ten sam napis, dwa różne skutki.
                //
                // Zgłoszone przelewy mają dziś własny stos z pytaniem i dwiema odpowiedziami,
                // więc ta rola stąd znika. Zostaje sytuacja, której nie obsługuje nic innego:
                // ktoś dał gotówkę przy stole i nie otworzy aplikacji, żeby to odklikać.
                // Wtedy odnotowuje to odbiorca, u siebie — i taka wpłata jest potwierdzona
                // od razu, bo potwierdza ją osoba, która trzyma pieniądze.
                //
                // I dlatego TU pole kwoty zostaje: gotówka nie przychodzi w kwotach równych
                // rachunkom, a aplikacja nie ma skąd znać tej liczby.
                const rb = e.target.closest('.receive-btn');
                if (rb) {
                    openSettleModal(rb.dataset.from, Number(rb.dataset.amountG), rb.dataset.currency, 'receive');
                    return;
                }

            });

            // REJESTR WPŁAT — osobne miejsce. Potwierdzanie i kasowanie mieszka tutaj,
            // bo tutaj widać pełny wiersz wpłaty: kto, komu, ile, kiedy i czy potwierdzona.
            const logModal = document.getElementById('settlements-log-modal');
            const openLogBtn = document.getElementById('open-settlements-log');
            if (openLogBtn) openLogBtn.onclick = openSettlementsLog;
            document.getElementById('close-settlements-log').onclick = () => logModal.classList.remove('active');
            document.querySelectorAll('.log-mode-btn').forEach((btn) => {
                btn.onclick = () => { logMode = btn.dataset.log; renderSettlementsLog(); };
            });
            document.querySelectorAll('.log-filter-btn').forEach((btn) => {
                btn.onclick = () => { logFilter = btn.dataset.logFilter; renderSettlementsLog(); };
            });
            const logSearch = document.getElementById('log-search');
            const logSearchClear = document.getElementById('log-search-clear');
            if (logSearch) logSearch.oninput = () => {
                logQuery = logSearch.value;
                if (logSearchClear) logSearchClear.classList.toggle('hidden', !logQuery);
                renderSettlementsLog();
            };
            if (logSearchClear) logSearchClear.onclick = () => {
                logQuery = '';
                logSearch.value = '';
                logSearchClear.classList.add('hidden');
                logSearch.focus();
                renderSettlementsLog();
            };
            document.getElementById('settlements-log-list').addEventListener('click', async (e) => {
                const settleRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`, id);

                const conf = e.target.closest('.confirm-settle-btn');
                if (conf) { confirmSettlement(conf.dataset.id); return; }

                const del = e.target.closest('.settle-delete-btn');
                if (del) {
                    const id = del.dataset.id;
                    const rec = latestSettlements.find((s) => s.id === id);
                    openConfirm({
                        title: 'Usunąć wpis o wpłacie?',
                        body: `Wpłata ${rec ? fmtMoney(toGrosze(rec.amount || 0), rec.currency || 'PLN') : ''} zniknie z rejestru, a dług wróci do poprzedniej wysokości. Zrób to tylko wtedy, gdy zapisałeś ją przez pomyłkę.`,
                        confirmLabel: 'Usuń wpis',
                        onConfirm: () => {
                            fireWrite(deleteDoc(settleRef(id)), 'Nie udało się usunąć wpisu.');
                            showToast('Usunięto wpis z rejestru.');
                        },
                    });
                }
            });
            // ARKUSZ TRZECH PRZYCZYN. Droga główna to „Jeszcze sprawdzę" — dlatego ma
            // limonkę, a odpowiedź przecząca sam obrys.
            const noTransferModal = document.getElementById('no-transfer-modal');
            const zamknijNoTransfer = () => { noTransferModal.classList.remove('active'); pendingDisputeId = null; };
            document.getElementById('close-no-transfer').onclick = zamknijNoTransfer;
            document.getElementById('no-transfer-cancel').onclick = zamknijNoTransfer;
            document.getElementById('no-transfer-confirm').onclick = () => {
                const id = pendingDisputeId;
                zamknijNoTransfer();
                if (id) disputeSettlement(id);
            };

            const settleModal = document.getElementById('settle-modal');
            document.getElementById('close-settle-modal').onclick = () => settleModal.classList.remove('active');
            settleModal.onclick = (e) => { if (e.target === settleModal) settleModal.classList.remove('active'); };

            // Przypomnienia (nudge-windykator): dzwonek + inbox
            const nudgesBell = document.getElementById('nudges-bell');
            if (nudgesBell) nudgesBell.onclick = openNudgesModal;
            const nudgesModal = document.getElementById('nudges-modal');
            document.getElementById('close-nudges-modal').onclick = () => nudgesModal.classList.remove('active');
            nudgesModal.onclick = (e) => { if (e.target === nudgesModal) nudgesModal.classList.remove('active'); };
            document.getElementById('nudges-readall-btn').onclick = async () => {
                const my = myMemberNow();
                const uid = currentUser && currentUser.uid;
                if (!my) return;
                const toMark = latestNudges.filter(x => x.to === my.id && !(Array.isArray(x.readBy) && x.readBy.includes(uid)));
                if (!toMark.length) return;
                await Promise.all(toMark.map(x => updateDoc(nudgeRef(x.id), { readBy: arrayUnion(uid) })));
                showToast('Oznaczono jako przeczytane.');
            };
            // Wiersze spraw żyją w DWÓCH miejscach: w skrzynce spod dzwonka i w sekcji
            // „Czeka na Ciebie" na Bilansie. Obsługa jest jedna — inaczej ta sama sprawa
            // reagowałaby inaczej zależnie od tego, gdzie ją zobaczysz.
            const wireInboxActions = (container) => {
                if (!container) return;
                container.addEventListener('click', async (e) => {
                    const s = e.target.closest('.nudge-settle-btn');
                    if (s) {
                        nudgesModal.classList.remove('active');
                        openSettleModal(s.dataset.to, Number(s.dataset.amountG), s.dataset.currency, 'send');
                        return;
                    }
                    // „Otwórz rachunek" z prośby o uzupełnienie — prosto do pozycji.
                    const ob = e.target.closest('.nudge-open-bill-btn');
                    if (ob) {
                        nudgesModal.classList.remove('active');
                        joinBill(currentGroupId, ob.dataset.bill);
                        return;
                    }
                    // Zgoda na otwarcie rachunku po „To nie moje". Przypomnienie od razu
                    // znika ze skrzynki: sprawa jest załatwiona, a nie tylko przeczytana.
                    const rb = e.target.closest('.nudge-reopen-btn');
                    if (rb) {
                        reopenBill(rb.dataset.bill);
                        fireWrite(updateDoc(nudgeRef(rb.dataset.id), { readBy: arrayUnion(currentUser.uid) }));
                        return;
                    }
                    const r = e.target.closest('.nudge-read-btn');
                    if (r) {
                        // `fireWrite`, nie `await`: przy braku sieci obietnica z `updateDoc`
                        // nie rozwiązuje się nigdy, a kopia w pamięci wie swoje od razu.
                        fireWrite(
                            updateDoc(nudgeRef(r.dataset.id), { readBy: arrayUnion(currentUser.uid) }),
                            'Nie udało się oznaczyć jako przeczytane.',
                        );
                        return;
                    }
                    // Potwierdzenie cudzej wpłaty prosto z wiersza — bez wędrówki na
                    // zakładkę rozliczeń i szukania właściwego miejsca w liście.
                    // Drogowskaz z Bilansu prowadzi PROSTO na właściwą stronę Rozliczeń —
                    // inaczej wiersz mówiłby, że coś czeka, i zostawiał szukanie gdzie.
                    const go = e.target.closest('.balance-go-btn');
                    if (go) {
                        settleSide = go.dataset.side || 'due';
                        settleSideChosen = true;
                        showDeckView(DECK_NAV_VIEWS['nav-settle']);
                        renderSettlements();
                        return;
                    }
                    const nm = e.target.closest('.inbox-nomoney-btn');
                    if (nm) { nudgesModal.classList.remove('active'); openNoTransferSheet(nm.dataset.id); return; }
                    const ins2 = e.target.closest('.inbox-insist-btn');
                    if (ins2) { insistSettlement(ins2.dataset.id); return; }
                    const oops2 = e.target.closest('.inbox-oops-btn');
                    if (oops2) { nudgesModal.classList.remove('active'); withdrawSettlement(oops2.dataset.id); return; }

                    // JEDNA DROGA POTWIERDZENIA NA CAŁĄ APLIKACJĘ. Skrzynka miała własny
                    // zapis, więc potwierdzenie stąd nie gasiło sporu i nie dawało paska
                    // „Cofnij" — ta sama czynność zachowywała się inaczej zależnie od tego,
                    // gdzie ją stuknąłeś.
                    const c = e.target.closest('.inbox-confirm-btn');
                    if (c) { confirmSettlement(c.dataset.id); return; }
                    const b = e.target.closest('.inbox-bill-btn');
                    if (b) {
                        nudgesModal.classList.remove('active');
                        joinBill(currentGroupId, b.dataset.id);
                        return;
                    }
                });
            };
            wireInboxActions(document.getElementById('nudges-list'));
            wireInboxActions(document.getElementById('balance-waiting-list'));

            document.querySelectorAll('.inbox-mode-btn').forEach((btn) => {
                btn.onclick = () => { inboxMode = btn.dataset.inbox; renderNudges(); };
            });

            // Kompozytor przypomnienia
            const nudgeComposeModal = document.getElementById('nudge-compose-modal');
            const nudgeCancel = document.getElementById('nudge-compose-cancel');
            if (nudgeCancel) nudgeCancel.onclick = () => nudgeComposeModal.classList.remove('active');
            const nudgeSend = document.getElementById('nudge-compose-send');
            if (nudgeSend) nudgeSend.onclick = async () => {
                if (!nudgeDraft) return;
                const message = document.getElementById('nudge-message').value;
                const { lista, currency, kind, billId, billName } = nudgeDraft;
                const dodatki = { kind, billId, billName };

                const wyslij = async () => {
                    nudgeComposeModal.classList.remove('active');
                    // Rachunek adresata (jeśli go niesie) wygrywa z rachunkiem całej wysyłki:
                    // przy zbiorczym przypomnieniu z Bilansu każdy zalega gdzie indziej.
                    const dlaOsoby = (a) => (a.billId
                        ? { ...dodatki, billId: a.billId, billName: a.billName || '' }
                        : dodatki);
                    if (lista.length === 1) {
                        await sendNudge(lista[0].toId, lista[0].amountG, currency, message, dlaOsoby(lista[0]));
                    } else {
                        // Bramka anty-spamowa działa PER OSOBA, więc ktoś, kto dostał
                        // przypomnienie przed chwilą, po prostu wypada z tej wysyłki.
                        // Raport mówi wprost, do ilu poszło — inaczej „wysłano" przy
                        // pominięciu połowy listy byłoby nieprawdą.
                        let poszlo = 0;
                        for (const a of lista) {
                            if (await sendNudge(a.toId, a.amountG, currency, message, { ...dlaOsoby(a), cicho: true })) poszlo += 1;
                        }
                        const pominieto = lista.length - poszlo;
                        showToast(pominieto === 0
                            ? `Przypomnienie poszło do ${poszlo} ${plural(poszlo, 'osoby', 'osób', 'osób')}.`
                            : `Poszło do ${poszlo} z ${lista.length}. Reszta dostała przypomnienie przed chwilą.`);
                    }
                    nudgeDraft = null;
                };

                if (lista.length === 1) { await wyslij(); return; }
                // Kilkanaście powiadomień na cudze telefony to nie jest ruch do zrobienia
                // przypadkiem. Okno wypisuje imiona, żeby było widać, kogo to obudzi.
                const imiona = lista.map((a) => memberName(a.toId)).join(', ');
                openConfirm({
                    title: `Przypomnieć ${lista.length} ${plural(lista.length, 'osobie', 'osobom', 'osobom')}?`,
                    body: kind === 'fill'
                        ? `Każda dostanie tę samą wiadomość i odnośnik prosto do rachunku: ${imiona}.`
                        : `Każda dostanie tę samą wiadomość i kwotę swojej zaległości: ${imiona}.`,
                    confirmLabel: 'Wyślij',
                    tone: 'brand',
                    onConfirm: wyslij,
                });
            };
            const nudgeSaveTpl = document.getElementById('nudge-save-template');
            if (nudgeSaveTpl) nudgeSaveTpl.onclick = () => {
                const kind = (nudgeDraft && nudgeDraft.kind) || 'debt';
                const text = document.getElementById('nudge-message').value.trim();
                if (!text || text === nudgeDefaultMessage(kind)) { showToast('Wpisz własną treść, żeby ją zapisać.', true); return; }
                const list = readNudgeTemplates(kind).filter((t) => t !== text);
                writeNudgeTemplates([text, ...list], kind);
                renderNudgeTemplates();
                showToast('Szablon zapisany na tym urządzeniu.');
            };

            // Edycja członków rachunku
            const bmBtnA = document.getElementById('edit-members-btn-advanced');
            if (bmBtnA) bmBtnA.onclick = openBillMembersModal;
            const bmModal = document.getElementById('bill-members-modal');
            document.getElementById('close-bill-members-modal').onclick = () => bmModal.classList.remove('active');
            bmModal.onclick = (e) => { if (e.target === bmModal) bmModal.classList.remove('active'); };
            document.getElementById('bill-members-list').addEventListener('click', async (e) => {
                const row = e.target.closest('.person-row');
                if (!row || row.disabled) return;
                const include = row.getAttribute('aria-pressed') !== 'true';
                // Zaznaczenie przestawiamy od razu: zapis do bazy wraca własną drogą
                // i przerysowuje listę, ale wiersz ma odpowiedzieć na palec natychmiast.
                row.setAttribute('aria-pressed', include ? 'true' : 'false');
                await toggleBillMember(row.dataset.id, include);
            });

            // Ekran „Profil" — jedno wejście, zakładka „Ty" w pasku (patrz setupDeckNav).
            // Awatar w nagłówku pokoju był drugim wejściem do tego samego miejsca i już
            // nie jest klikalny; strzałka „wróć" zniknęła razem z nim.
            const pushBtn = document.getElementById('push-toggle-btn');
            if (pushBtn) pushBtn.onclick = enablePush;
            // Znak: stuknięcie w awatar otwiera arkusz „Twój znak", a z niego prowadzą
            // dwie drogi — własne zdjęcie albo kolor.
            const markBtn = document.getElementById('profile-mark-btn');
            if (markBtn) markBtn.onclick = () => document.getElementById('mark-modal').classList.add('active');
            const closeMarkBtn = document.getElementById('close-mark-modal');
            if (closeMarkBtn) closeMarkBtn.onclick = () => document.getElementById('mark-modal').classList.remove('active');
            const colorBtn = document.getElementById('profile-color-btn');
            if (colorBtn) colorBtn.onclick = () => {
                document.getElementById('mark-modal').classList.remove('active');
                openColorPicker();
            };
            setupColorPicker();
            const closeColorBtn = document.getElementById('close-color-picker-btn');
            if (closeColorBtn) closeColorBtn.onclick = () => document.getElementById('color-picker-modal').classList.remove('active');
            const closeChoiceBtn = document.getElementById('close-choice-modal');
            if (closeChoiceBtn) closeChoiceBtn.onclick = () => document.getElementById('choice-modal').classList.remove('active');
            // Zdjęcie profilowe
            const photoBtn = document.getElementById('profile-photo-btn');
            const photoInput = document.getElementById('profile-photo-input');
            const photoRemove = document.getElementById('profile-photo-remove-btn');
            // Arkusz „Twój znak" schodzi z drogi, gdy odpalamy systemowe okno pliku —
            // inaczej wraca się z wyboru zdjęcia na wciąż otwarty arkusz.
            if (photoBtn && photoInput) photoBtn.onclick = () => {
                document.getElementById('mark-modal').classList.remove('active');
                photoInput.click();
            };
            if (photoInput) photoInput.onchange = async (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) await uploadProfilePhoto(file); };
            if (photoRemove) photoRemove.onclick = () => {
                document.getElementById('mark-modal').classList.remove('active');
                removeProfilePhoto();
            };
            // kopiuj-kwotę bierze aktualną wartość z pola
            document.getElementById('settle-amount-input').oninput = (e) => {
                const v = parseLocalFloat(e.target.value);
                document.getElementById('settle-copy-amount').dataset.account = (v > 0 ? v : 0).toFixed(2);
            };
            // zapis wpłaty do rejestru
            document.getElementById('settle-record-btn').onclick = async () => {
                if (!settleContext) return;
                // W trybie „send" kwota NIE pochodzi z pola — pola tam nie ma. Bierzemy ją
                // z kontekstu (suma zaznaczonych rachunków albo kwota z planu), żeby każde
                // zgłoszenie odpowiadało dokładnie jakiemuś zbiorowi rachunków.
                const amount = settleContext.mode === 'receive'
                    ? parseLocalFloat(document.getElementById('settle-amount-input').value)
                    : fromGrosze(Number(settleContext.amountG) || 0);
                if (!(amount > 0)) { showToast('Podaj kwotę wpłaty.', true); return; }
                const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
                if (!myMember) { showToast('Najpierw dołącz do grupy.', true); return; }
                const receive = settleContext.mode === 'receive';
                const rec = {
                    from: receive ? settleContext.other : myMember.id,
                    to: receive ? myMember.id : settleContext.other,
                    amount,
                    currency: settleContext.currency || 'PLN',
                    createdAt: serverTimestamp(),
                    createdBy: currentUser.uid,
                    confirmed: receive, // otrzymana przeze mnie = od razu potwierdzona; wysłana = do potwierdzenia
                };
                if (receive) { rec.confirmedBy = currentUser.uid; rec.confirmedAt = serverTimestamp(); }
                // Pole DOKŁADAMY TYLKO WTEDY, GDY JEST. Pusta tablica na każdej wpłacie
                // udawałaby, że pytanie „za co" zostało zadane i odpowiedź brzmi „za nic",
                // a brak pola znaczy coś innego: wpłata powstała poza trybem rachunkowym.
                if (settleContext.billIds && settleContext.billIds.length) rec.billIds = settleContext.billIds;
                // Arkusz zamyka się OD RAZU, nie po odpowiedzi serwera. Wpłata jest już
                // zapisana lokalnie i widać ją w rejestrze; czekanie na potwierdzenie
                // z sieci trzymało otwarty arkusz w nieskończoność przy słabym zasięgu —
                // czyli dokładnie tam, gdzie ludzie tej aplikacji używają.
                fireWrite(
                    addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), rec),
                    'Nie udało się zapisać wpłaty.',
                );
                settleModal.classList.remove('active');
                showToast(receive ? 'Zapisano otrzymaną wpłatę.' : 'Zapisano wpłatę.');
            };

            document.getElementById('cancel-delete-bill').onclick = () => document.getElementById('delete-confirm-modal').classList.remove('active');
            // Modal potwierdzenia zastąpiony flow „Cofnij"; gdyby był kiedyś pokazany, kieruje w to samo miejsce.
            document.getElementById('confirm-delete-bill').onclick = () => {
                document.getElementById('delete-confirm-modal').classList.remove('active');
                deleteBillWithUndo();
            };

            document.getElementById('cancel-takeover-name').onclick = () => {
                document.getElementById('takeover-name-modal').classList.remove('active');
                memberIdToTakeover = null;
            };
            document.getElementById('confirm-takeover-name').onclick = () => {
                if (memberIdToTakeover) {
                    claimName(memberIdToTakeover);
                    memberIdToTakeover = null;
                }
                document.getElementById('takeover-name-modal').classList.remove('active');
            };
        };
        
        const addNewBillModalListeners = () => {
            const modal = document.getElementById('new-bill-modal');
            const nameInput = document.getElementById('new-bill-name');
            const createBtn = document.getElementById('confirm-create-bill-btn');
            const cancelBtn = document.getElementById('cancel-new-bill');
            const editParticipantsBtn = document.getElementById('edit-participants-btn-modal');
            const participantsChecklist = document.getElementById('participants-checklist-modal');

            // Do założenia rachunku wystarczy nazwa — typ przestał istnieć jako decyzja.
            const checkCreateButtonState = () => {
                createBtn.disabled = newBillState.name.trim() === '';
            };
            
            const addBtn = document.getElementById('create-new-bill-btn');
            const peopleWrap = document.getElementById('new-bill-people');

            const updateParticipantsButton = () => {
                const allMemberIds = Object.keys(groupData.members || {});
                const areAllSelected = allMemberIds.length === newBillState.participantIds.length && allMemberIds.every(id => newBillState.participantIds.includes(id));
                editParticipantsBtn.textContent = areAllSelected ? 'wszystkich' : `wybranych (${newBillState.participantIds.length})`;
            };

            // WYBÓR OSÓB TYM SAMYM WIERSZEM, CO WSZĘDZIE INDZIEJ.
            // Do 2026-08-15 stały tu systemowe kwadraciki z samym imieniem, a przy pozycji
            // paragonu — wiersz ze zdjęciem i okrągłym znacznikiem. To samo pytanie „kto?"
            // miało w aplikacji dwie twarze, i to ta gorsza stała w miejscu, przez które
            // przechodzi każdy nowy rachunek.
            const renderNewBillPeople = () => {
                const order = groupData.memberOrder || Object.keys(groupData.members || {});
                participantsChecklist.innerHTML = order.map((id) => {
                    const m = (groupData.members || {})[id];
                    if (!m) return '';
                    return personRowHtml({ id, name: m.name, selected: newBillState.participantIds.includes(id) });
                }).join('');
                syncPersonSearchCount(peopleWrap);
            };

            participantsChecklist.onclick = (e) => {
                const row = e.target.closest('.person-row');
                if (!row) return;
                const selected = row.getAttribute('aria-pressed') !== 'true';
                row.setAttribute('aria-pressed', selected ? 'true' : 'false');
                newBillState.participantIds = selectedPersonIds('participants-checklist-modal');
                updateParticipantsButton();
                syncPersonSearchCount(peopleWrap);
            };

            // ZAMYKANIE MA WŁASNĄ ANIMACJĘ, więc nie może być zwykłym zdjęciem klasy:
            // `.modal` bez `.active` dostaje `display: none` w tej samej klatce i arkusz
            // znika, zanim cokolwiek zdąży się wydarzyć. Dlatego najpierw `is-closing`
            // (odwrotna animacja), a `active` schodzi dopiero po niej.
            //
            // `closeToken` chroni przed wyścigiem: gdy ktoś wciśnie [+] w trakcie
            // zamykania, sprzątanie z poprzedniego przebiegu nie ma prawa zgasić
            // świeżo otwartego arkusza.
            let closeToken = 0;
            let closeTimer = null;

            const finishClose = () => {
                modal.classList.remove('is-closing', 'active');
            };

            const openNewBillSheet = () => {
                if (!groupData) return;
                // Przerywamy trwające zamykanie: arkusz ma się otworzyć od razu,
                // a nie po dojechaniu poprzedniej animacji.
                closeToken++;
                clearTimeout(closeTimer);
                modal.classList.remove('is-closing');
                newBillState = { name: '', type: 'advanced', participantIds: Object.keys(groupData.members || {}) };
                nameInput.value = '';
                renderNewBillPeople();
                updateParticipantsButton();
                peopleWrap.classList.add('hidden');
                resetPersonSearch(peopleWrap);
                checkCreateButtonState();
                modal.classList.add('active');
                // Koło [+] jest teraz przyciskiem zamknięcia i mówi to obrotem w krzyżyk.
                addBtn.setAttribute('aria-expanded', 'true');
                addBtn.setAttribute('aria-label', 'Zamknij okno nowego rachunku');
            };

            closeNewBillSheet = () => {
                if (!modal.classList.contains('active') || modal.classList.contains('is-closing')) return;
                // Koło [+] wraca z krzyżyka w plus OD RAZU, równolegle z arkuszem:
                // to jeden ruch w dwóch miejscach, a nie dwa zdarzenia po kolei.
                addBtn.setAttribute('aria-expanded', 'false');
                addBtn.setAttribute('aria-label', 'Nowy rachunek');

                if (prefersReducedMotion()) { finishClose(); return; }

                const sheet = modal.querySelector('.sheet');
                const token = ++closeToken;
                modal.classList.add('is-closing');

                const done = () => {
                    // Przerwane zamykanie (ktoś w międzyczasie otworzył okno na nowo)
                    // nie ma prawa zgasić tego, co stoi teraz na ekranie.
                    if (token !== closeToken) return;
                    clearTimeout(closeTimer);
                    finishClose();
                };
                if (sheet) sheet.addEventListener('animationend', done, { once: true });
                // Zapas na wypadek, gdyby zdarzenie nie doszło: karta w tle, przerwana
                // animacja, przeglądarka bez `animationend` na `clip-path`. Bez tego
                // okno zostałoby otwarte na zawsze, a to gorsze niż brak animacji.
                closeTimer = setTimeout(done, 600);
            };

            // Jeden przycisk, dwa stany. Otwiera i zamyka to samo okno, więc nie ma
            // sytuacji, w której arkusz stoi otwarty, a [+] dalej wygląda jak „dodaj".
            //
            // Arkusz W TRAKCIE ZAMYKANIA liczy się jako ZAMKNIĘTY. Sama klasa `active`
            // wisi jeszcze przez czas animacji, więc bez tego rozróżnienia stuknięcie
            // w [+] w tych 280 ms trafiało w gałąź „zamknij", ta wychodziła od razu
            // (bo już się zamyka) i przycisk przez chwilę wyglądał na martwy.
            addBtn.onclick = () => {
                const otwarty = modal.classList.contains('active') && !modal.classList.contains('is-closing');
                if (otwarty) closeNewBillSheet();
                else openNewBillSheet();
            };

            nameInput.addEventListener('input', (e) => {
                newBillState.name = e.target.value;
                checkCreateButtonState();
            });

            editParticipantsBtn.addEventListener('click', () => {
                const willShow = peopleWrap.classList.contains('hidden');
                peopleWrap.classList.toggle('hidden', !willShow);
                if (willShow) renderNewBillPeople();
                else resetPersonSearch(peopleWrap);
            });

            cancelBtn.onclick = () => closeNewBillSheet();
            // Kliknięcie w tło obsługuje globalny strażnik w `setupGlobalModalListeners`:
            // przechodzi przez `closeModal`, a ten dla tego okna woła `closeNewBillSheet`.
            // Osobny nasłuch był tu potrzebny, dopóki strażnik zdejmował klasę wprost.

            createBtn.onclick = async () => {
                if (newBillState.participantIds.length === 0) {
                    showToast("Musisz wybrać przynajmniej jednego uczestnika.", true);
                    return;
                }
                
                const allMembersMap = groupData.members || {};
                const participantsMap = {};

                // Każdy rachunek powstaje w jednym kształcie i rośnie w miarę potrzeb.
                // Pole `status` niesie już tylko członkostwo: „in" albo „not_applicable".
                // To drugie jest jedyną wartością, którą czyta matma w functions/calc.js.
                Object.values(allMembersMap).forEach(m => {
                    const isIncluded = newBillState.participantIds.includes(m.id);
                    participantsMap[m.id] = { id: m.id, name: m.name, individualAmount: 0, individualAmounts: [], calculatorActive: false, status: isIncluded ? PARTICIPANT_IN : PARTICIPANT_OUT };
                });

                const baseBill = {
                    billName: newBillState.name,
                    // Pole `type` zostaje w dokumencie dla zgodności ze starymi rachunkami
                    // w bazie, ale nie rozgałęzia już ani obliczeń, ani ekranów.
                    type: 'advanced',
                    // Nowy rachunek startuje podziałem po równo: to jest przypadek,
                    // który zdarza się najczęściej i wymaga zero pracy od ekipy.
                    // Rozpisywanie włącza się przełącznikiem, gdy okaże się potrzebne.
                    splitMode: 'even',
                    // BRAMA ROZLICZEŃ DOTYCZY WYŁĄCZNIE RACHUNKÓW ZAŁOŻONYCH OD TERAZ.
                    // Rachunki, które już żyją w pokojach ekipy, nie mają tego pola i mają
                    // działać dokładnie jak dotąd. Objęcie ich bramą zamroziłoby ludziom
                    // przelewy na rachunkach rozliczanych od tygodni — czyli aktualizacja
                    // zabrałaby im działającą funkcję za to, że korzystali z aplikacji wcześniej.
                    gated: true,
                    settleOpen: false,
                    everOpened: false,
                    restTo: null,
                    restSettledG: 0,
                    createdAt: serverTimestamp(),
                    // Waluta domyślna pokoju (ustawienia pokoju). Rachunek i tak można
                    // przestawić osobno — kurs zapisuje się w dniu dodania.
                    currency: (groupData && groupData.defaultCurrency) || 'PLN',
                    totalAmount: 0,
                    payerId: null,
                    payerConfirmed: false,
                    participants: participantsMap,
                    globalCosts: [],
                    sharedCosts: [],
                    photos: [],
                };

                const newBillRef = await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), baseBill);
                closeNewBillSheet();
                joinBill(currentGroupId, newBillRef.id);
            };
        };

        function setupModal(modalId, openBtnId, cancelBtnId, saveBtnId, saveCallback) {
            const modal = document.getElementById(modalId);
            if (openBtnId) document.getElementById(openBtnId).onclick = () => {
                if(document.getElementById(openBtnId).disabled) {
                    showToast("Ta opcja jest obecnie zablokowana.", true);
                    return;
                }
                modal.classList.add('active');
            }
            if (cancelBtnId) document.getElementById(cancelBtnId).onclick = () => modal.classList.remove('active');
            if (saveBtnId) document.getElementById(saveBtnId).onclick = () => {
                saveCallback();
                modal.classList.remove('active');
            };
        }

        // ===================================================
        // ===== NOWE FUNKCJE OBSŁUGI ZDJĘĆ =====
        // ===================================================
        
        function renderReceiptPhotos(photos = []) {
            const thumbnailsContainer = document.getElementById('receipt-thumbnails-container');
            const dropzone = document.getElementById('photo-dropzone');
            
            thumbnailsContainer.innerHTML = '';
            let validPhotoCount = 0;

            photos.forEach(photo => {
                if (!photo || !photo.url) {
                    console.warn("Wykryto zdjęcie bez URL w bazie danych, pomijam:", photo);
                    return;
                }
                validPhotoCount++;

                const thumbContainer = document.createElement('div');
                thumbContainer.className = 'thumbnail-container';

                const img = document.createElement('img');
                img.src = photo.url;
                img.className = 'w-24 h-24 object-cover rounded-lg cursor-pointer border border-ink/15';
                img.onclick = () => showLightbox(photo.url);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-photo-btn';
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
                
                deleteBtn.disabled = false; 

                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    showDeletePhotoConfirmation(photo);
                };

                thumbContainer.appendChild(img);
                thumbContainer.appendChild(deleteBtn);
                thumbnailsContainer.appendChild(thumbContainer);
            });
            
            dropzone.classList.toggle('hidden', validPhotoCount >= 5);
        }
        
        function setupPhotoUploadListeners() {
            const dropzone = document.getElementById('photo-dropzone');
            const fileInput = document.getElementById('photo-file-input');

            dropzone.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) handlePhotoUpload(e.target.files);
            });

            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
            dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-over');
                handlePhotoUpload(e.dataTransfer.files);
            });

            const lightbox = document.getElementById('photo-lightbox-modal');
            lightbox.addEventListener('click', () => lightbox.classList.remove('active'));
            document.getElementById('close-lightbox-btn').onclick = () => lightbox.classList.remove('active');
            document.getElementById('cancel-delete-photo').onclick = () => document.getElementById('delete-photo-confirm-modal').classList.remove('active');
            document.getElementById('confirm-delete-photo').onclick = handleDeletePhoto;
        }

        async function handlePhotoUpload(files) {
            if (!currentGroupId || !currentBillId) return;
            
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;

            const currentPhotos = billData.photos || [];
            if (currentPhotos.length >= 5) {
                showToast("Można dodać maksymalnie 5 zdjęć.", true);
                return;
            }

            let filesToUpload = Array.from(files).slice(0, 5 - currentPhotos.length);
            if (filesToUpload.length === 0) return;

            const dropzoneIdle = document.getElementById('dropzone-idle');
            const dropzoneLoading = document.getElementById('dropzone-loading');
            const fileInput = document.getElementById('photo-file-input');

            dropzoneIdle.classList.add('hidden');
            dropzoneLoading.classList.remove('hidden');

            for (const file of filesToUpload) {
                let fileToProcess = file;
                let fileName = file.name;

                if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
                    try {
                        showToast("Konwertowanie zdjęcia HEIC...");
                        const conversionResult = await (await loadHeic2Any())({ blob: file, toType: "image/jpeg", quality: 0.8 });
                        fileToProcess = conversionResult;
                        fileName = fileName.replace(/\.[^/.]+$/, "") + ".jpg";
                    } catch (error) {
                        console.error("Błąd konwersji HEIC:", error);
                        showToast("Nie udało się przekonwertować zdjęcia HEIC.", true);
                        continue;
                    }
                }
                
                const canUpload = await checkStorageAndCleanup(fileToProcess.size);
                if (!canUpload) {
                    showToast("Brak miejsca w chmurze. Nie można dodać zdjęcia.", true);
                    break; 
                }

                const storageRef = ref(storage, `groups/${currentGroupId}/bills/${currentBillId}/${Date.now()}-${fileName}`);
                try {
                    const snapshot = await uploadBytes(storageRef, fileToProcess);
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    
                    const newPhotoData = {
                        url: downloadURL,
                        name: fileName,
                        size: fileToProcess.size,
                        createdAt: new Date(),
                        uploaderId: myMember.id
                    };

                    const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
                    const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                    
                    await runTransaction(db, async (transaction) => {
                        transaction.update(billDocRef, { photos: arrayUnion(newPhotoData) });
                        transaction.update(groupDocRef, { totalStorageUsed: increment(fileToProcess.size) });
                    });

                } catch (error) {
                    console.error("Błąd przesyłania zdjęcia:", error);
                    showToast("Nie udało się przesłać zdjęcia.", true);
                }
            }
            fileInput.value = '';
            dropzoneIdle.classList.remove('hidden');
            dropzoneLoading.classList.add('hidden');
        }

        function showDeletePhotoConfirmation(photo) {
            photoToDelete = photo;
            document.getElementById('delete-photo-confirm-modal').classList.add('active');
        }

        async function handleDeletePhoto() {
            if (!photoToDelete || !currentGroupId || !currentBillId) return;

            document.getElementById('delete-photo-confirm-modal').classList.remove('active');

            if (!photoToDelete.url) {
                console.error("Próba usunięcia zdjęcia bez URL:", photoToDelete);
                showToast("Usuwanie błędnego wpisu zdjęcia z bazy danych...", false);
                try {
                    const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                    await updateDoc(billDocRef, { photos: arrayRemove(photoToDelete) });
                    showToast("Błędny wpis zdjęcia został usunięty.", false);
                } catch (dbError) {
                    console.error("Nie udało się usunąć błędnego wpisu z bazy danych:", dbError);
                    showToast("Nie udało się usunąć błędnego wpisu.", true);
                } finally {
                    photoToDelete = null;
                }
                return;
            }

            try {
                const photoRef = ref(storage, photoToDelete.url);
                await deleteObject(photoRef);
                
                const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
                const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                
                const photoSize = typeof photoToDelete.size === 'number' ? photoToDelete.size : 0;

                await runTransaction(db, async (transaction) => {
                    transaction.update(billDocRef, { photos: arrayRemove(photoToDelete) });
                    if (photoSize > 0) {
                        transaction.update(groupDocRef, { totalStorageUsed: increment(-photoSize) });
                    }
                });
                
                showToast("Zdjęcie zostało usunięte.");
            } catch (error) {
                console.error("Błąd podczas usuwania zdjęcia:", error);
                if (error.code === 'storage/object-not-found') {
                    showToast("Plik zdjęcia nie istnieje w magazynie, usuwam wpis...", true);
                    const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                    await updateDoc(billDocRef, { photos: arrayRemove(photoToDelete) });
                } else {
                    showToast("Nie udało się usunąć zdjęcia.", true);
                }
            } finally {
                photoToDelete = null;
            }
        }

        // DECYZJA USERA 2026-07-28 (audyt): automatyczne kasowanie NAJSTARSZYCH zdjęć po
        // przekroczeniu limitu ZOSTAJE. Uzasadnienie: apka jest dla znajomych, a stare rachunki
        // są już rozliczone — utrata starego paragonu nikogo nie kosztuje, za to blokada wgrywania
        // popsułaby wieczór przy stole.
        // ⚠️ PRZED MONETYZACJĄ TO MUSI ZNIKNĄĆ: płacący klient traci wtedy cudzy dowód zakupu bez
        // pytania i bez możliwości cofnięcia. Wtedy: odmówić wgrania i poprosić o zwolnienie miejsca.
        async function checkStorageAndCleanup(newFileSize) {
            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            const groupSnap = await getDoc(groupDocRef);
            if (!groupSnap.exists()) return false;

            let currentSize = groupSnap.data().totalStorageUsed || 0;
            if (currentSize + newFileSize <= STORAGE_LIMIT_BYTES) {
                return true;
            }
            
            showToast("Przekroczono limit miejsca. Usuwam najstarsze zdjęcia...", false);

            const billsCollectionRef = collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`);
            const q = query(billsCollectionRef, orderBy('createdAt', 'asc'));
            const billsSnapshot = await getDocs(q);

            let allPhotos = [];
            billsSnapshot.forEach(billDoc => {
                const bill = billDoc.data();
                if (bill.photos && bill.photos.length > 0) {
                    bill.photos.forEach(p => {
                        const createdAt = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(0);
                        allPhotos.push({ ...p, billId: billDoc.id, createdAt });
                    });
                }
            });

            allPhotos.sort((a, b) => a.createdAt - b.createdAt);

            let spaceFreed = 0;
            for (const photo of allPhotos) {
                if (currentSize - spaceFreed + newFileSize <= STORAGE_LIMIT_BYTES) {
                    break; 
                }
                
                if (photo && photo.url) {
                    try {
                        const photoRef = ref(storage, photo.url);
                        await deleteObject(photoRef);

                        const billToUpdateRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, photo.billId);
                        const billToUpdateSnap = await getDoc(billToUpdateRef);
                        
                        if (billToUpdateSnap.exists()) {
                            const billToUpdateData = billToUpdateSnap.data();
                            const photoObjectToRemove = billToUpdateData.photos.find(p => p.url === photo.url);

                            if (photoObjectToRemove) {
                                 await updateDoc(billToUpdateRef, { photos: arrayRemove(photoObjectToRemove) });
                                 const photoSize = typeof photo.size === 'number' ? photo.size : 0;
                                 spaceFreed += photoSize;
                            }
                        }
                    } catch (error) {
                        console.error("Błąd podczas automatycznego usuwania starego zdjęcia:", error);
                    }
                }
            }
            
            if (spaceFreed > 0) {
                await updateDoc(groupDocRef, { totalStorageUsed: increment(-spaceFreed) });
                showToast(`Usunięto najstarsze zdjęcia, aby zwolnić miejsce.`, false);
            }
            
            const finalGroupSnap = await getDoc(groupDocRef);
            const finalSize = finalGroupSnap.data().totalStorageUsed || 0;
            return finalSize + newFileSize <= STORAGE_LIMIT_BYTES;
        }

        function showLightbox(url) {
            document.getElementById('lightbox-image').src = url;
            document.getElementById('photo-lightbox-modal').classList.add('active');
        }
        
        init();

