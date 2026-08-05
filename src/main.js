        // Style: Tailwind kompilowany w buildzie (dawniej skrypt z cdn.tailwindcss.com).
        import './tailwind.css';
        // Importy Firebase (npm) + moduł obliczeń
        import { calculateAll, calculateAllForBill, calculateSimple, buildLedger, simplifyDebts, fromGrosze, toGrosze } from './calc.js';
        import { unreadNudgeCount, hasRecentNudge } from './nudges.js';
        import { itemQuantity, itemPickers, itemPickerCount, isPicked, unassignedItems, toggleItemPicker, splitItemByUnits } from './items.js';
        import { identityColor, initials, IDENTITY_COLORS } from './identity.js';
        import { initializeApp } from "firebase/app";
        import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "firebase/auth";
        import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, serverTimestamp, deleteDoc, deleteField, writeBatch, getDocs, runTransaction, increment } from "firebase/firestore";
        import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, connectStorageEmulator } from "firebase/storage";
        import { getMessaging, getToken, onMessage, isSupported as isMessagingSupported } from "firebase/messaging";
        import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
        import { normalizeReceipt, receiptItemsToSharedCosts, receiptModifiersToGlobalCosts } from './receipt.js';

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
            console.info('[BillSplitter] Emulator Firebase (127.0.0.1) — żywe dane nietknięte.');
            if (!env.DEV) console.warn('[BillSplitter] UWAGA: build produkcyjny podpięty do EMULATORA (VITE_USE_EMULATOR=true). To build testowy, nie do wdrożenia.');
        }

        // Globalne zmienne stanu
        let currentUser = null;
        let currentGroupId = null;
        let currentBillId = null;
        let groupData = null;
        let billData = null;
        let exchangeRates = null;
        let unsubscribeGroup = null;
        let unsubscribeBill = null;
        let unsubscribeSettlements = null;
        let unsubscribeNudges = null;
        let isAuthReady = false;
        let currentScreenName = null;
        let settlementMode = 'net'; // 'net' = kto komu ile | 'min' = najmniej przelewów
        let settleContext = null; // { to, currency } — kontekst modala „Ureguluj"
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

        // --- MOTYW: banknot w dzień, ten sam banknot pod lampą UV w nocy ---
        // Scena użycia to lokal wieczorem, więc ciemny nie jest fanaberią: jasny ekran
        // w półmroku oślepia i wymusza przymykanie oczu przy kwotach. Domyślnie idziemy
        // za ustawieniem systemu; ręczny wybór zapamiętujemy na urządzeniu.
        const THEME_KEY = 'billsplitter_theme';
        const prefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
        const activeTheme = () => storedTheme() || (prefersDark() ? 'dark' : 'light');
        const applyTheme = (theme) => {
            document.documentElement.dataset.theme = theme;
            const icon = document.getElementById('theme-toggle-icon');
            if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        };
        const toggleTheme = () => {
            const next = activeTheme() === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
            applyTheme(next);
        };

        // Motyw stosujemy od razu przy starcie, jeszcze zanim odpowie Firebase — inaczej
        // pierwsze sekundy w półmroku to biały ekran w twarz. Dopóki nikt nie wybrał ręcznie,
        // idziemy za systemem NA ŻYWO: telefon przełącza się o zmierzchu w trakcie kolacji.
        const setupTheme = () => {
            applyTheme(activeTheme());
            const btn = document.getElementById('theme-toggle-btn');
            if (btn) btn.onclick = toggleTheme;
            const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
            if (mq && mq.addEventListener) {
                mq.addEventListener('change', () => { if (!storedTheme()) applyTheme(activeTheme()); });
            }
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
            toast.className = `toast-in fixed bottom-24 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm px-4 py-3 rounded-block z-50 font-semibold shadow-lift transition-opacity duration-300 ${isError ? 'bg-owe text-white' : 'bg-ink text-surface'}`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 400);
            }, 3600);
        }

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

        const generateId = () => Math.random().toString(36).substring(2, 10);
        // Parsuje kwotę z przecinkiem/kropką (zasięg modułu — używane m.in. w „Ureguluj").
        const parseLocalFloat = (val) => parseFloat(String(val).replace(',', '.')) || 0;

        const formatSummary = (summaryObject) => {
            if (!summaryObject || Object.keys(summaryObject).length === 0) {
                return '0.00 PLN';
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
                .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
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
            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeBill) unsubscribeBill();
            if (unsubscribeSettlements) unsubscribeSettlements();
            unsubscribeGroup = null;
            unsubscribeBill = null;
            unsubscribeSettlements = null;

            const urlParams = new URLSearchParams(window.location.search);
            const groupId = urlParams.get('group');
            
            currentGroupId = groupId;

            if (groupId) {
                handleGroupJoin(groupId);
            } else {
                showScreen('start');
                groupData = null;
                billData = null;
            }
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

        const init = () => {
            setupTheme();
            showScreen('loading');
            
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
            registerServiceWorker();

            // Faza 5: wskaźnik offline (Firestore persistentLocalCache i tak kolejkuje zmiany).
            const updateOnlineStatus = () => {
                const banner = document.getElementById('offline-banner');
                if (banner) banner.classList.toggle('hidden', navigator.onLine);
            };
            window.addEventListener('online', updateOnlineStatus);
            window.addEventListener('offline', updateOnlineStatus);
            updateOnlineStatus();

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

        const renderMyRooms = () => {
            const container = document.getElementById('my-rooms');
            if (!container) return;
            const rooms = getMyRooms().sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
            if (rooms.length === 0) { container.innerHTML = ''; return; }
            container.innerHTML = `
                <h3 class="font-display text-2xl font-bold mb-3 text-left">Twoje pokoje</h3>
                <div class="space-y-2">
                    ${rooms.map(r => `
                        <div class="flex items-center gap-2">
                            <button class="enter-room-btn card tap flex-grow flex items-center justify-between gap-2 p-3 min-h-tap text-left" data-room-id="${r.id}">
                                <span class="font-semibold truncate">${escapeHtml(r.name)}</span>
                                <i class="fas fa-arrow-right text-ink-3 flex-shrink-0"></i>
                            </button>
                            <button class="forget-room-btn tap w-11 h-11 rounded-lg flex items-center justify-center text-ink-3 flex-shrink-0" data-room-id="${r.id}" title="Usuń z listy (nie kasuje pokoju)"><i class="fas fa-times"></i></button>
                        </div>
                    `).join('')}
                </div>
                <div class="flex items-center my-6"><div class="flex-grow border-t border-ink/15"></div><span class="px-3 text-xs font-bold text-ink-3">albo nowy pokój</span><div class="flex-grow border-t border-ink/15"></div></div>
            `;
        };

        // --- Faza 4: kontekstowy tutorial „?" per ekran ---
        const HELP_CONTENT = {
            'start': {
                title: 'Jak zacząć',
                html: `<p>BillSplitter dzieli rachunki w grupie znajomych i liczy, kto komu ile jest winien.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li>Podaj nazwę grupy i imiona osób (po przecinku).</li>
                        <li>Dostaniesz link — wyślij go znajomym. Każdy wybiera swoje imię z listy.</li>
                        <li>Dodajecie rachunki, a apka sama liczy podział (grosze zawsze na korzyść płatnika).</li>
                    </ul>
                    <p>Twoje pokoje zapiszą się na tym urządzeniu — wrócisz do nich z ekranu głównego.</p>`
            },
            'join': {
                title: 'Dołączanie do grupy',
                html: `<ul class="list-disc pl-5 space-y-1">
                        <li>Wybierz swoje imię z listy, aby dołączyć.</li>
                        <li>Szare imię = już zajęte. Jeśli to Ty na innym urządzeniu — możesz przejąć sesję.</li>
                        <li>Po wejściu ustawisz swój kolor profilu i numer konta.</li>
                    </ul>`
            },
            'group-dashboard': {
                title: 'Twoja grupa',
                html: `<ul class="list-disc pl-5 space-y-1">
                        <li><b>Udostępnij link</b>, aby zaprosić znajomych.</li>
                        <li><b>Nowy rachunek</b> — prosty (kwota po równo) lub zaawansowany (różne pozycje).</li>
                        <li><b>Rozliczenia</b> pokazują, kto komu ile jest winien. „Ureguluj" zapisuje wpłatę, a odbiorca ją potwierdza — rachunki zostają zapisem tego, kto co skonsumował.</li>
                        <li><b>Filtry</b>: Wszystkie / Ukryte.</li>
                        <li><b>Kolor profilu</b> i <b>sposoby płatności</b> (konto, telefon, Revolut, PayPal, własne) — znajomi zobaczą je przy Twoich należnościach.</li>
                        <li><b>Podsumowanie</b> pokazuje Twoje udziały i sumę całej grupy.</li>
                    </ul>`
            },
            'bill': {
                title: 'Rachunek',
                html: `<p><b>Jeden rachunek, który rośnie.</b> Zacznij od samej kwoty — reszta jest opcjonalna i dopisujesz ją wtedy, gdy jest potrzebna.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Kwota nierozpisana dzieli się po równo</b> między uczestników. Sam wpis kwoty wystarcza, żeby rachunek był kompletny.</li>
                        <li><b>Pozycje z paragonu</b> — zrób zdjęcie i odczytaj je, a potem <b>stuknij linie, które jadłeś</b>. Cena pozycji dzieli się po równo między wszystkich, którzy ją stuknęli, a ich zdjęcia pojawiają się na linii.</li>
                        <li>Pozycję o ilości większej niż 1 możesz <b>podzielić na sztuki</b> (ołówek → „Podziel na sztuki"), gdy każdą sztukę wziął kto inny.</li>
                        <li><b>Koszty wspólne</b> — np. napiwek albo serwis, doliczane do całości i dzielone.</li>
                        <li><b>Koszty własne</b> — to, co ktoś zamówił wyłącznie dla siebie.</li>
                        <li><b>Suma pozycji</b> pilnuje, żeby wpisy nie przekroczyły kwoty rachunku. Niedobór nie jest błędem — to właśnie kwota, która idzie po równo.</li>
                        <li>Grosze zaokrąglane w górę, żeby płatnik nigdy nie był stratny.</li>
                        <li>Wybierz płatnika i potwierdź płatność.</li>
                    </ul>`
            }
        };

        const showHelp = () => {
            const content = HELP_CONTENT[currentScreenName];
            if (!content) return;
            document.getElementById('help-modal-title').textContent = content.title;
            document.getElementById('help-modal-body').innerHTML = content.html;
            document.getElementById('help-modal').classList.add('active');
        };

        // --- DOLNA NAWIGACJA — kciuk pracuje w dolnej trzeciej ekranu ---
        // Pulpit jest JEDNĄ przewijaną stroną, więc nawigacja nie przełącza widoków, tylko
        // przewija do sekcji. Podświetlenie idzie za tym, co realnie widać: gdyby zostawało
        // tam, gdzie ktoś ostatnio stuknął, kłamałoby po każdym ręcznym przewinięciu.
        const DECK_NAV_TARGETS = {
            'nav-room': 'balance-panel',
            'nav-settle': 'settlements-section',
            'nav-bills': 'bills-section',
        };

        // Po ręcznym stuknięciu w zakładkę obserwator przewijania musi na chwilę zamilknąć.
        // Bez tego przy krótkiej treści (pusty pokój, jeden rachunek) strona nie ma dokąd
        // się przewinąć, obserwator natychmiast przywraca poprzednią zakładkę i stuknięcie
        // wygląda na nieskuteczne — przycisk sprawia wrażenie martwego.
        let deckNavLockedUntil = 0;

        const setDeckNavCurrent = (btnId) => {
            document.querySelectorAll('#deck-nav .deck-btn').forEach(btn => {
                if (btn.id === btnId) btn.setAttribute('aria-current', 'page');
                else btn.removeAttribute('aria-current');
            });
        };

        const setupDeckNav = () => {
            Object.entries(DECK_NAV_TARGETS).forEach(([btnId, targetId]) => {
                const btn = document.getElementById(btnId);
                if (!btn) return;
                btn.onclick = () => {
                    if (currentScreenName !== 'group-dashboard') showScreen('group-dashboard');
                    deckNavLockedUntil = Date.now() + 900;
                    setDeckNavCurrent(btnId);
                    const target = document.getElementById(targetId);
                    if (!target) return;
                    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                    catch (_) { target.scrollIntoView(); }
                };
            });
            const meBtn = document.getElementById('nav-me');
            if (meBtn) meBtn.onclick = () => { renderProfile(); renderPushToggle(); showScreen('profile'); };

            if (!('IntersectionObserver' in window)) return;
            // Pas obserwacji w górnej części ekranu: sekcja staje się „bieżąca", gdy jej
            // początek wchodzi tam, gdzie czyta się nagłówki, a nie gdy ledwo wystaje z dołu.
            const observer = new IntersectionObserver((entries) => {
                if (currentScreenName !== 'group-dashboard') return;
                if (Date.now() < deckNavLockedUntil) return;
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const btnId = Object.keys(DECK_NAV_TARGETS).find(k => DECK_NAV_TARGETS[k] === entry.target.id);
                    if (btnId) setDeckNavCurrent(btnId);
                });
            }, { rootMargin: '-30% 0px -60% 0px' });
            Object.values(DECK_NAV_TARGETS).forEach(id => {
                const el = document.getElementById(id);
                if (el) observer.observe(el);
            });
        };

        const showScreen = (screenName) => {
            ['loading', 'start', 'join', 'group-dashboard', 'bill', 'profile'].forEach(s => {
                const screenEl = document.getElementById(`${s}-screen`);
                if (screenEl) screenEl.classList.add('hidden');
            });
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
            // Kontekstowy przycisk pomocy „?" — widoczny tylko na ekranach z treścią.
            const fab = document.getElementById('help-fab');
            if (fab) fab.classList.toggle('hidden', !HELP_CONTENT[screenName]);
            // Dolna nawigacja żyje tylko tam, gdzie jest po co nawigować. Na ekranie rachunku
            // schodzi z drogi: liczy się jedna czynność i wolne miejsce pod kciukiem.
            const deck = document.getElementById('deck-nav');
            if (deck) {
                const onDeck = screenName === 'group-dashboard' || screenName === 'profile';
                deck.classList.toggle('hidden', !onDeck);
                if (screenName === 'profile') setDeckNavCurrent('nav-me');
                else if (screenName === 'group-dashboard') setDeckNavCurrent('nav-room');
            }
            if (screenName === 'start') renderMyRooms();
        };

        const handleGroupJoin = async (groupId) => {
            const urlParams = new URLSearchParams(window.location.search);
            currentBillId = urlParams.get('bill');
            currentGroupId = groupId;

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, groupId);
            const groupDoc = await getDoc(groupDocRef);
            if (!groupDoc.exists()) {
                showToast("Taka grupa nie istnieje!", true);
                forgetRoom(groupId); // usuń martwy skrót z „Moich pokoi"
                history.pushState(null, '', window.location.pathname);
                showScreen('start');
                return;
            }
            groupData = groupDoc.data();
            rememberRoom(groupId, groupData.groupName); // zapamiętaj pokój lokalnie (łatwy powrót)
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);

            if (myMember) {
                 if (currentBillId) {
                    joinBill(groupId, currentBillId);
                } else {
                    navigateToGroup(groupId, false);
                }
            } else {
                showScreen('join');
                document.getElementById('join-group-name').textContent = groupData.groupName;
                renderJoinScreen();
            }
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
        
        const claimName = async (memberId) => {
            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            await updateDoc(groupDocRef, {
                [`members.${memberId}.claimedBy`]: currentUser.uid
            });
            navigateToGroup(currentGroupId, false);
        };

        const navigateToGroup = (groupId, pushState = true) => {
            currentGroupId = groupId;
            currentBillId = null;
            if (pushState) {
                history.pushState(null, '', `?group=${groupId}`);
            }
            renderGroupDashboard();
        };
        
        // --- Faza 3: filtry i ukrywanie rachunków ---
        let latestBills = [];
        let latestSettlements = []; // rejestr wpłat (model wpłat)
        let latestNudges = []; // przypomnienia (nudge-windykator)
        let currentBillFilter = 'all';

        const renderGroupDashboard = () => {
            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeSettlements) unsubscribeSettlements();
            if (unsubscribeNudges) unsubscribeNudges();

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            
            onSnapshot(groupDocRef, (docSnap) => {
                if (!docSnap.exists()) return;
                groupData = docSnap.data();
                const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                document.getElementById('dashboard-group-name').textContent = groupData.groupName;
                const userNameEl = document.getElementById('dashboard-user-name');
                userNameEl.textContent = myMember ? myMember.name : '...';
                const nameDisplay = document.getElementById('dashboard-user-name-display');
                if (nameDisplay) nameDisplay.textContent = myMember ? myMember.name : '...';
                // Numer seryjny pokoju stoi w nagłówku na stałe: to jedyna droga do pokoju,
                // gdy skrót z ekranu początkowego iPhone'a otworzy aplikację bez adresu grupy.
                const serialEl = document.getElementById('room-serial');
                if (serialEl) serialEl.textContent = formatSerial(currentGroupId);
                // Znak w prawym górnym rogu to TWOJA rozeta, nie ogólna ikonka ludzika —
                // ten sam znak, którym jesteś podpisany przy każdej pozycji rachunku.
                const markEl = document.getElementById('dashboard-user-mark');
                if (markEl) markEl.innerHTML = myMember ? avatarHtml(myMember.name, myMember.id, 'w-8 h-8 text-lg') : '';
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

                    const picker = document.getElementById('dashboard-color-picker');
                    if (picker) {
                        const current = colorForMember(myMember.id, myMember.name);
                        // Próbka pokazuje dokładnie to, co ekipa zobaczy przy Twoim imieniu:
                        // pełne koło w danym kolorze z Twoją literą. Wybrany dostaje pierścień.
                        const myMark = escapeHtml(initials(myMember.name));
                        picker.innerHTML = PROFILE_COLORS.map(c =>
                            `<button class="profile-color-swatch tap w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm" data-color="${c}" title="Ustaw swój kolor" style="background-color:${c};box-shadow:${c === current ? '0 0 0 3px rgb(var(--surface)), 0 0 0 5px rgb(var(--ink))' : 'none'}">${myMark}</button>`
                        ).join('');
                        picker.querySelectorAll('.profile-color-swatch').forEach(sw => {
                            sw.onclick = async () => {
                                await updateDoc(groupDocRef, { [`members.${myMember.id}.color`]: sw.dataset.color });
                                showToast('Zmieniono kolor profilu.');
                            };
                        });
                    }
                }
                // Numery kont / metody / imiona / zdjęcia mogły się zmienić — odśwież widoki.
                renderBillsList();
                renderSettlements();
                renderBalancePanel();
                updateNudgeBadge();
                savePushToken(); // token mógł powstać zanim wiedzieliśmy, kim jest użytkownik
                if (currentScreenName === 'profile') renderProfile();
            });

            const billsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), orderBy('createdAt', 'desc'));
            unsubscribeGroup = onSnapshot(billsQuery, (snapshot) => {
                latestBills = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
                renderBillsList();
                renderSettlements();
                renderBalancePanel();
            });

            const settlementsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), orderBy('createdAt', 'desc'));
            unsubscribeSettlements = onSnapshot(settlementsQuery, (snapshot) => {
                latestSettlements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderSettlements();
                renderBalancePanel();
            });

            const nudgesQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`), orderBy('createdAt', 'desc'));
            unsubscribeNudges = onSnapshot(nudgesQuery, (snapshot) => {
                latestNudges = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                updateNudgeBadge();
                const modal = document.getElementById('nudges-modal');
                if (modal && modal.classList.contains('active')) renderNudges();
            });

            document.getElementById('copy-group-link-btn').onclick = () => {
                copyText(document.getElementById('group-share-link').value, 'Link do grupy skopiowany!');
            };
            // Stuknięcie w numer seryjny kopiuje sam kod pokoju — to jest to, co podaje się
            // przy stole i przepisuje z cudzego telefonu. Link mieszka niżej, w stopce pokoju.
            const serialBtn = document.getElementById('room-serial-btn');
            if (serialBtn) serialBtn.onclick = () => copyText(currentGroupId, 'Kod pokoju skopiowany.');
            document.getElementById('toggle-summary-btn').onclick = () => {
                document.getElementById('summary-content').classList.toggle('hidden');
                document.getElementById('summary-arrow-icon').classList.toggle('rotated');
            };

            document.querySelectorAll('.bill-filter-btn').forEach(btn => {
                btn.onclick = () => { currentBillFilter = btn.dataset.filter; renderBillsList(); };
            });

            showScreen('group-dashboard');
        };
        
        const getBillSummaryHtml = (bill, myMember, myParticipant) => {
            if (!myParticipant || myParticipant.status === 'not_applicable') {
                return `<p class="text-ink-3">Nie dotyczy Cię</p>`;
            }

            if (!bill.payerId) {
                return `<p class="text-info font-semibold">Wskaż, kto płacił</p>`;
            }
            if (bill.payerId && !bill.payerConfirmed) {
                const payerName = bill.participants[bill.payerId]?.name || 'Płatnik';
                const text = myMember.id === bill.payerId ? "Potwierdź, że zapłaciłeś/aś" : `Czeka na potwierdzenie: ${escapeHtml(payerName)}`;
                return `<p class="text-info font-semibold">${text}</p>`;
            }
            if (!bill.totalAmount || bill.totalAmount <= 0) {
                return `<p class="text-info font-semibold">Uzupełnij kwotę</p>`;
            }

            if (bill.type === 'advanced' && myParticipant.status === 'incomplete') {
                return `<p class="text-info font-semibold">Uzupełnij swoje koszty</p>`;
            }

            const calculations = calculateAllForBill(bill);
            const myCalc = calculations.participantTotals.find(pt => pt.participant.id === myMember.id);
            const myTotal = myCalc ? myCalc.total : 0;
            const payer = bill.participants[bill.payerId];

            // Model wpłat: lista pokazuje KONSUMPCJĘ (udział), nie rozliczenie. Rozliczenie → sekcja „Rozliczenia".
            if (payer && payer.id === myParticipant.id) {
                return `<p class="text-sm text-ink-2">Wyłożyłeś/aś ${calculations.controlSum.toFixed(2).replace('.', ',')} ${bill.currency} · Twój udział: ${myTotal.toFixed(2).replace('.', ',')}</p>`;
            }
            return `<p class="text-sm text-ink-2">Twój udział: ${myTotal.toFixed(2).replace('.', ',')} ${bill.currency}${payer ? ` · płaci ${escapeHtml(memberName(bill.payerId))}` : ''}</p>`;
        };

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
            if (!bill.payerId) return make('action', 'Wskaż, kto płacił');
            if (!bill.payerConfirmed) {
                return myMember.id === bill.payerId
                    ? make('action', 'Potwierdź, że zapłaciłeś/aś')
                    : make('wait', `Czeka na ${escapeHtml(memberName(bill.payerId))}`);
            }
            if (!bill.totalAmount || bill.totalAmount <= 0) return make('action', 'Uzupełnij kwotę');
            if (bill.type === 'advanced' && myParticipant.status === 'incomplete') return make('action', 'Uzupełnij swoje koszty');

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
            return make('owe', `Płaci ${escapeHtml(memberName(bill.payerId))}`, money(myTotal));
        };

        // --- Tożsamość uczestnika: zdjęcie, a bez zdjęcia kolor z literą ---
        // Zdjęcie ma pierwszeństwo zawsze: to twarze robią z tego ekranu ludzi, a nie
        // księgowość. Bez zdjęcia zostaje pełne koło w nasyconym kolorze osoby z białą
        // literą — czytelne przy dwudziestu ośmiu pikselach i przy dwudziestu pięciu osobach.
        const PROFILE_COLORS = IDENTITY_COLORS;
        const colorForMember = (memberId, name) => {
            const explicit = ((groupData && groupData.members && groupData.members[memberId]) || {}).color;
            // Kolory zapisane w poprzednich wersjach pochodzą z innych palet. Honorujemy je
            // tylko wtedy, gdy należą do obecnej — inaczej jeden odcień rozbija cały ekran.
            if (explicit && IDENTITY_COLORS.includes(explicit)) return explicit;
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
            return `<span class="rounded-full flex-shrink-0 inline-flex items-center justify-center font-bold text-white ${sizeClass}" style="background-color:${escapeHtml(color)}">
                <span style="font-size:0.72em">${mark}</span>
            </span>`;
        };

        // --- Faza 4/5-bridge: metody płatności per osoba (wiele: konto, telefon, Revolut, PayPal, własne) ---
        const PAYMENT_TYPES = {
            account: { label: 'Konto / IBAN', icon: 'fa-university', placeholder: 'Numer konta / IBAN' },
            phone:   { label: 'Telefon (BLIK/Revolut)', icon: 'fa-mobile-screen-button', placeholder: 'Numer telefonu' },
            revolut: { label: 'Revolut @tag / link', icon: 'fa-at', placeholder: '@nick lub revolut.me/...' },
            paypal:  { label: 'PayPal', icon: 'fa-paypal', brand: true, placeholder: 'paypal.me/... lub email' },
            other:   { label: 'Inne (własna nazwa)', icon: 'fa-money-bill-wave', placeholder: 'Numer / adres / uchwyt' },
        };
        const paymentIconClass = (type) => { const t = PAYMENT_TYPES[type] || PAYMENT_TYPES.other; return `${t.brand ? 'fab' : 'fas'} ${t.icon}`; };
        const paymentLabel = (m) => (m && m.type === 'other' && m.label) ? m.label : (PAYMENT_TYPES[(m && m.type)] || PAYMENT_TYPES.other).label;
        // Backward-compat: stare pojedyncze accountNumber czytane jako jedna metoda „konto".
        const getPaymentMethods = (member) => {
            if (!member) return [];
            if (Array.isArray(member.paymentMethods)) return member.paymentMethods.filter(m => m && m.value);
            if (member.accountNumber) return [{ type: 'account', value: member.accountNumber }];
            return [];
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
                    <button class="pm-remove-btn tap w-9 h-9 rounded-lg flex items-center justify-center text-ink-3 flex-shrink-0" data-index="${i}" title="Usuń"><i class="fas fa-trash text-sm"></i></button>
                </div>
            `).join('');
        };
        const openPaymentModal = () => {
            const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;
            paymentEditMemberId = myMember.id;
            paymentEditMethods = getPaymentMethods(myMember).map(m => ({ ...m }));
            renderPaymentEditor();
            const typeSel = document.getElementById('pm-add-type');
            typeSel.value = 'account';
            document.getElementById('pm-add-label').value = '';
            document.getElementById('pm-add-label').classList.add('hidden');
            const valInput = document.getElementById('pm-add-value');
            valInput.value = '';
            valInput.placeholder = PAYMENT_TYPES.account.placeholder;
            document.getElementById('payment-methods-modal').classList.add('active');
        };

        // --- Faza 5: widok „Rozliczenia" (ledger kto komu ile / min. przelewów) + „Ureguluj" ---
        const CURRENCY_ORDER = ['PLN', 'EUR', 'USD'];
        const memberName = (id) => ((groupData && groupData.members && groupData.members[id]) || {}).name || 'Ktoś';
        const fmtMoney = (amountG, currency) => `${fromGrosze(amountG).toFixed(2).replace('.', ',')} ${currency}`;

        // Nominał: złotówki niosą wagę, grosze schodzą o klasę niżej. Chwyt podpatrzony
        // w referencjach — przy kolumnie kwot różnica w czytelności jest natychmiastowa.
        // `withCurrency` wyłączamy tam, gdzie waluta jest już powiedziana raz na całą listę
        // (kafelki pozycji, rozpiska udziałów) — dwadzieścia razy „PLN" to szum, nie informacja.
        const denominationHtml = (amountG, currency, toneClass, { withCurrency = true } = {}) => {
            const sign = amountG < 0 ? '−' : '';
            const abs = Math.abs(Number(amountG) || 0);
            const whole = Math.floor(abs / 100).toLocaleString('pl-PL');
            const fraction = String(abs % 100).padStart(2, '0');
            const cur = withCurrency ? `<span class="denomination-currency">${escapeHtml(currency)}</span>` : '';
            return `<span class="denomination denomination-relief ${toneClass}">${sign}${whole}<span class="denomination-fraction">,${fraction}</span>${cur}</span>`;
        };

        // Moje należności i zobowiązania w jednym miejscu — to jest liczba, po którą
        // ludzie otwierają aplikację, więc liczymy ją raz i podajemy wszystkim widokom.
        const myLedgerRows = () => {
            const my = myMemberNow();
            if (!my) return { rows: [], myId: null };
            const bills = latestBills.map(({ id, data }) => ({ ...data, id }));
            const ledger = buildLedger(bills, latestSettlements);
            const rows = [];
            Object.keys(ledger).forEach((cur) => {
                ledger[cur].net.forEach((t) => {
                    if (t.from === my.id) rows.push({ currency: cur, other: t.to, amountG: t.amountG, dir: 'owe' });
                    else if (t.to === my.id) rows.push({ currency: cur, other: t.from, amountG: t.amountG, dir: 'due' });
                });
            });
            return { rows, myId: my.id };
        };

        const renderBalancePanel = () => {
            const amountsEl = document.getElementById('balance-amounts');
            const captionEl = document.getElementById('balance-caption');
            const actionsEl = document.getElementById('balance-actions');
            if (!amountsEl || !captionEl || !actionsEl) return;

            const { rows } = myLedgerRows();
            const byCurrency = {};
            rows.forEach((r) => {
                const bucket = byCurrency[r.currency] || (byCurrency[r.currency] = { owe: 0, due: 0 });
                bucket[r.dir] += r.amountG;
            });
            const currencies = Object.keys(byCurrency).sort((a, b) => {
                const ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
            });

            if (currencies.length === 0) {
                // Stan pusty jest tu stanem SUKCESU, nie brakiem danych — i tak ma wyglądać.
                amountsEl.innerHTML = `<p class="amount text-5xl">0,00</p>`;
                captionEl.textContent = 'Wszystko rozliczone. Nikt nikomu nic nie jest winien.';
                actionsEl.innerHTML = '';
                return;
            }

            // Kwota w bloku marki jest CZARNA, a kierunek niesie podpis pod nią. Czerwień
            // i zieleń na limonce byłyby nieczytelne, a kolor marki nie może znaczyć
            // „winien" ani „dostajesz" — od tego są wiersze ludzi na białych kartach.
            amountsEl.innerHTML = currencies.map((cur) => {
                const net = byCurrency[cur].due - byCurrency[cur].owe;
                return `<p class="text-6xl md:text-7xl">${denominationHtml(net, cur, 'text-brand-ink')}</p>`;
            }).join('');

            const oweRows = rows.filter((r) => r.dir === 'owe');
            const dueRows = rows.filter((r) => r.dir === 'due');
            const people = (n) => (n === 1 ? '1 osobie' : `${n} osobom`);
            const peopleFrom = (n) => (n === 1 ? '1 osoby' : `${n} osób`);
            const parts = [];
            if (oweRows.length) parts.push(`winien jesteś ${people(oweRows.length)}`);
            if (dueRows.length) parts.push(`dostajesz od ${peopleFrom(dueRows.length)}`);
            captionEl.textContent = parts.join(' · ');

            // Akcja pierwszorzędna celuje w największą pozycję — to ona blokuje rozliczenie.
            const biggestOwe = oweRows.sort((a, b) => b.amountG - a.amountG)[0];
            const biggestDue = dueRows.sort((a, b) => b.amountG - a.amountG)[0];
            const buttons = [];
            if (biggestOwe) {
                buttons.push(`<button class="balance-settle-btn btn btn-dark" data-to="${escapeHtml(biggestOwe.other)}" data-amount-g="${biggestOwe.amountG}" data-currency="${escapeHtml(biggestOwe.currency)}">Ureguluj ${fmtMoney(biggestOwe.amountG, biggestOwe.currency)}</button>`);
            }
            if (biggestDue) {
                buttons.push(`<button class="balance-nudge-btn btn btn-quiet" data-nudge-to="${escapeHtml(biggestDue.other)}" data-amount-g="${biggestDue.amountG}" data-currency="${escapeHtml(biggestDue.currency)}">Przypomnij: ${escapeHtml(memberName(biggestDue.other))}</button>`);
            }
            actionsEl.innerHTML = buttons.join('');

            actionsEl.querySelectorAll('.balance-settle-btn').forEach((btn) => {
                btn.onclick = () => openSettleModal(btn.dataset.to, Number(btn.dataset.amountG), btn.dataset.currency, 'send');
            });
            actionsEl.querySelectorAll('.balance-nudge-btn').forEach((btn) => {
                btn.onclick = () => sendNudge(btn.dataset.nudgeTo, Number(btn.dataset.amountG), btn.dataset.currency);
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
                <div class="mt-3 flex items-center gap-2">${actionsHtml}</div>
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
                return `<div class="flex justify-between gap-2 text-xs py-0.5"><span class="truncate text-ink-3">${escapeHtml(label)}</span><span class="flex-shrink-0 ${neg ? 'text-due' : 'text-ink-3'}">${neg ? '−' : ''}${fmtMoney(c.amountG, cur)}</span></div>`;
            };
            return `<details class="mt-1.5"><summary class="text-xs text-ink-2 cursor-pointer select-none">Za co</summary>
                <div class="mt-1 pl-2 border-l border-ink/15">${fwd.map(c => line(c, false)).join('')}${rev.map(c => line(c, true)).join('')}</div></details>`;
        };

        const renderSettlements = () => {
            const container = document.getElementById('settlements-list');
            if (!container || !groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const myId = myMember ? myMember.id : null;

            // Stan bieżący niesie `aria-pressed`, nie podmiana klas: przełącznik jest
            // pigułką, którą maluje arkusz, a czytnik ekranu dostaje informację o stanie.
            document.querySelectorAll('.settle-mode-btn').forEach(btn => {
                btn.setAttribute('aria-pressed', String(btn.dataset.mode === settlementMode));
            });

            const bills = latestBills.map(({ id, data }) => ({ ...data, id }));
            const ledger = buildLedger(bills, latestSettlements);
            const currencies = Object.keys(ledger).sort((a, b) => {
                const ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
            });

            // Stan pusty jest tu stanem SUKCESU, nie brakiem danych — i tak ma wyglądać.
            const nothing = `<div class="card p-5 flex items-center gap-3">
                <span class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-due/12 text-due"><i class="fas fa-check text-lg"></i></span>
                <span><span class="block font-bold">Wszystko rozliczone</span><span class="block text-sm text-ink-2">Nikt nikomu nic nie jest winien.</span></span>
            </div>`;
            if (currencies.length === 0) { container.innerHTML = nothing; return; }

            let html = '';
            if (settlementMode === 'min') {
                html += `<p class="block-quiet p-4 text-sm text-ink-2 mb-3">Plan „najmniej przelewów" zmieni się, gdy dojdą nowe rachunki. Do bieżących spłat pewniejsze jest netto.</p>`;
            }
            currencies.forEach(cur => {
                const transfers = settlementMode === 'min' ? simplifyDebts(ledger[cur].directed) : ledger[cur].net;
                if (transfers.length === 0) return;
                const mineOwe = transfers.filter(t => t.from === myId);
                const mineGet = transfers.filter(t => t.to === myId);
                const others = transfers.filter(t => t.from !== myId && t.to !== myId);
                // Detal (które rachunki) tylko w trybie netto — „min" to zoptymalizowane przelewy bez mapowania 1:1 na rachunki.
                const detailOf = (t) => settlementMode === 'net' ? debtDetailHtml(ledger[cur].directed, t.from, t.to, cur) : '';

                html += `<div>`;
                if (currencies.length > 1) html += `<p class="chip mb-2">${cur}</p>`;

                if (mineOwe.length) {
                    html += `<p class="text-sm font-bold text-owe mb-2">Płacisz</p><div class="space-y-2 mb-5">`;
                    mineOwe.forEach(t => {
                        html += settleRowHtml(memberName(t.to), t.to,
                            `<span class="amount text-2xl text-owe">${fmtMoney(t.amountG, cur)}</span>`,
                            `<button class="settle-btn btn btn-danger flex-grow" data-to="${t.to}" data-amount-g="${t.amountG}" data-currency="${cur}">Ureguluj</button>`,
                            detailOf(t));
                    });
                    html += `</div>`;
                }
                if (mineGet.length) {
                    html += `<p class="text-sm font-bold text-due mb-2">Dostajesz</p><div class="space-y-2 mb-5">`;
                    mineGet.forEach(t => {
                        html += settleRowHtml(memberName(t.from), t.from,
                            `<span class="amount text-2xl text-due">${fmtMoney(t.amountG, cur)}</span>`,
                            `<button class="receive-btn btn btn-primary flex-grow" data-from="${t.from}" data-amount-g="${t.amountG}" data-currency="${cur}">Mam wpłatę</button>
                             <button class="nudge-btn btn btn-quiet flex-shrink-0" data-nudge-to="${t.from}" data-amount-g="${t.amountG}" data-currency="${cur}" title="Przypomnij o długu"><i class="fas fa-bell"></i></button>`,
                            detailOf(t));
                    });
                    html += `</div>`;
                }
                if (others.length) {
                    // Cudze długi to informacja, nie zadanie: bez akcji, bez koloru roli,
                    // mniejszy stopień. Ekran nie może sugerować, że masz tu coś do zrobienia.
                    html += `<p class="text-sm font-bold text-ink-3 mb-2">Pozostali w grupie</p><div class="space-y-2">`;
                    others.forEach(t => {
                        html += `<div class="block-quiet p-3.5">
                            <div class="flex items-center justify-between gap-3">
                                <span class="flex items-center min-w-0 gap-1.5 text-sm">
                                    ${avatarHtml(memberName(t.from), t.from, 'w-7 h-7 text-xs')}<span class="truncate font-semibold">${escapeHtml(memberName(t.from))}</span>
                                    <i class="fas fa-arrow-right text-ink-3 text-xs mx-0.5"></i>
                                    ${avatarHtml(memberName(t.to), t.to, 'w-7 h-7 text-xs')}<span class="truncate font-semibold">${escapeHtml(memberName(t.to))}</span>
                                </span>
                                <span class="font-bold text-ink-2 flex-shrink-0">${fmtMoney(t.amountG, cur)}</span>
                            </div>
                            ${detailOf(t)}
                        </div>`;
                    });
                    html += `</div>`;
                }
                html += `</div>`;
            });

            // Historia wpłat (transparentność + undo własnej pomyłki)
            let historyHtml = '';
            if (latestSettlements.length) {
                historyHtml = `<details class="mt-4"><summary class="text-sm text-ink-2 cursor-pointer select-none min-h-tap flex items-center">Rejestr wpłat (${latestSettlements.length})</summary><div class="mt-2 space-y-1.5">`
                    + latestSettlements.map(s => {
                        const canDelete = s.createdBy === currentUser.uid;
                        const canConfirm = !s.confirmed && s.to === myId;
                        const when = (s.createdAt && s.createdAt.toDate) ? s.createdAt.toDate().toLocaleDateString('pl-PL') : '';
                        // Potwierdzenie to jedyny mechanizm zaufania w rozliczeniach, więc dostaje
                        // stempel foliowy — najmocniejszy znak, jakim dysponuje ten świat.
                        const badge = s.confirmed
                            ? `<span class="chip text-due px-1.5 py-0.5 text-[0.6rem] font-bold whitespace-nowrap">Potwierdzona</span>`
                            : `<span class="text-[0.65rem] text-ink-3 whitespace-nowrap uppercase tracking-wider">Czeka</span>`;
                        return `<div class="flex items-center justify-between gap-2 text-sm p-3 card">
                            <span class="min-w-0 truncate"><b>${escapeHtml(memberName(s.from))}</b> → ${escapeHtml(memberName(s.to))} · ${fmtMoney(toGrosze(s.amount || 0), s.currency || 'PLN')}${when ? ` · <span class="text-ink-3">${when}</span>` : ''} · ${badge}</span>
                            <span class="flex items-center gap-2 flex-shrink-0">
                                ${canConfirm ? `<button class="confirm-settle-btn tap min-h-tap px-2 text-info text-xs font-semibold" data-id="${s.id}">Potwierdź</button>` : ''}
                                ${canDelete ? `<button class="settle-delete-btn tap min-h-tap min-w-tap text-ink-3" data-id="${s.id}" title="Usuń wpłatę"><i class="fas fa-trash"></i></button>` : ''}
                            </span>
                        </div>`;
                    }).join('')
                    + `</div></details>`;
            }
            container.innerHTML = (html || nothing) + historyHtml;
        };

        // mode: 'send' = ja płacę (Ureguluj, do potwierdzenia) | 'receive' = ja otrzymałem (od razu potwierdzone)
        const openSettleModal = (otherId, amountG, currency, mode = 'send') => {
            settleContext = { mode, other: otherId, currency };
            const amountStr = fromGrosze(Number(amountG) || 0).toFixed(2);
            const input = document.getElementById('settle-amount-input');
            input.value = amountStr.replace('.', ',');
            document.getElementById('settle-currency').textContent = currency;
            document.getElementById('settle-copy-amount').dataset.account = amountStr;
            document.getElementById('settle-name').textContent = memberName(otherId);
            document.getElementById('settle-name-label').textContent = mode === 'receive' ? 'Otrzymano od' : 'Wpłata do';
            document.getElementById('settle-record-btn').innerHTML = mode === 'receive'
                ? '<i class="fas fa-check mr-2"></i>Zapisz otrzymaną wpłatę'
                : '<i class="fas fa-check mr-2"></i>Zapisz wpłatę';
            document.getElementById('settle-record-note').textContent = mode === 'receive'
                ? 'Potwierdzasz, że otrzymałeś tę kwotę.'
                : 'Zapisuje, że przelałeś tę kwotę — odbiorca potwierdzi.';
            // Metody płatności pokazujemy tylko gdy JA płacę (send).
            const methodsWrap = document.getElementById('settle-methods-wrap');
            if (mode === 'receive') {
                methodsWrap.classList.add('hidden');
            } else {
                methodsWrap.classList.remove('hidden');
                const methods = getPaymentMethods((groupData && groupData.members && groupData.members[otherId]) || null);
                document.getElementById('settle-methods').innerHTML = methods.length === 0
                    ? `<p class="text-sm text-ink-3">Odbiorca nie zapisał metod płatności.</p>`
                    : methods.map(m => `
                        <div class="card flex items-center gap-2 p-2">
                            <i class="${paymentIconClass(m.type)} text-ink-3 w-4 text-center"></i>
                            <div class="flex-grow min-w-0">
                                <p class="text-sm font-bold text-ink-3">${escapeHtml(paymentLabel(m))}</p>
                                <p class="text-sm credential">${escapeHtml(m.value)}</p>
                            </div>
                            <button class="copy-account-btn tap min-h-tap px-3 rounded-lg text-sm font-semibold text-ink flex-shrink-0" data-account="${escapeHtml(m.value)}">Kopiuj</button>
                        </div>`).join('');
            }
            document.getElementById('settle-modal').classList.add('active');
        };

        // --- Faza 6.3: przypomnienia (nudge-windykator) ---
        const myMemberNow = () => Object.values((groupData && groupData.members) || {})
            .find(m => m.claimedBy === (currentUser && currentUser.uid)) || null;

        const updateNudgeBadge = () => {
            const badge = document.getElementById('nudges-badge');
            const bell = document.getElementById('nudges-bell');
            if (!badge || !bell) return;
            const my = myMemberNow();
            bell.classList.toggle('hidden', !my);
            const count = my ? unreadNudgeCount(latestNudges, my.id, currentUser && currentUser.uid) : 0;
            if (count > 0) {
                badge.textContent = count > 9 ? '9+' : String(count);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        };

        // Wierzyciel przypomina dłużnikowi (toId). Anty-spam: max raz na 6h do tej samej osoby.
        const sendNudge = async (toId, amountG, currency) => {
            const my = myMemberNow();
            if (!my) { showToast('Najpierw dołącz do grupy.', true); return; }
            if (!toId || toId === my.id) return;
            const withMs = latestNudges.map(x => ({
                from: x.from, to: x.to,
                createdAtMs: (x.createdAt && x.createdAt.toMillis) ? x.createdAt.toMillis() : undefined,
            }));
            if (hasRecentNudge(withMs, my.id, toId, Date.now(), 6 * 3600 * 1000)) {
                showToast('Już przypomniałeś tej osobie w ostatnich godzinach.');
                return;
            }
            await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`), {
                from: my.id,
                to: toId,
                amountG: Number(amountG) || 0,
                currency: currency || 'PLN',
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                readBy: [],
            });
            showToast('Wysłano przypomnienie.');
        };

        const nudgeRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/nudges`, id);

        // Inbox dłużnika: przypomnienia skierowane do mnie, z deep-linkiem „Ureguluj".
        const renderNudges = () => {
            const container = document.getElementById('nudges-list');
            if (!container) return;
            const my = myMemberNow();
            const uid = currentUser && currentUser.uid;
            const mine = my ? latestNudges.filter(x => x.to === my.id) : [];
            const unread = my ? unreadNudgeCount(latestNudges, my.id, uid) : 0;
            const readAllBtn = document.getElementById('nudges-readall-btn');
            if (readAllBtn) readAllBtn.classList.toggle('hidden', unread === 0);
            if (mine.length === 0) {
                container.innerHTML = `<p class="text-ink-3 text-sm py-6 text-center">Brak przypomnień.</p>`;
                return;
            }
            container.innerHTML = mine.map(x => {
                const isRead = Array.isArray(x.readBy) && x.readBy.includes(uid);
                const when = (x.createdAt && x.createdAt.toDate) ? x.createdAt.toDate().toLocaleDateString('pl-PL') : '';
                const amt = x.amountG ? fmtMoney(Number(x.amountG), x.currency || 'PLN') : '';
                // Przypomnienie jest sprawą dwóch osób i mówi o MOIM długu — stąd kolor
                // „winien jesteś" przy nieprzeczytanym, i nic więcej. Treść zostaje rzeczowa.
                return `<div class="card p-3 ${isRead ? '' : 'border-owe/40'}">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-sm"><b>${escapeHtml(memberName(x.from))}</b> przypomina o zaległości${amt ? ` <b>${amt}</b>` : ''}.</p>
                            <p class="text-xs text-ink-3 mt-0.5">Już zapłaciłeś? Zapisz wpłatę, żeby dług zniknął.${when ? ` · ${when}` : ''}</p>
                        </div>
                        ${isRead ? '' : '<span class="w-2 h-2 rounded-full bg-owe flex-shrink-0 mt-1.5"></span>'}
                    </div>
                    <div class="flex items-center gap-2 mt-2">
                        <button class="nudge-settle-btn btn btn-danger" data-to="${x.from}" data-amount-g="${x.amountG || 0}" data-currency="${x.currency || 'PLN'}">Ureguluj</button>
                        ${isRead ? '' : `<button class="nudge-read-btn tap min-h-tap px-3 rounded-lg text-ink-2 text-sm font-semibold" data-id="${x.id}">Oznacz przeczytane</button>`}
                    </div>
                </div>`;
            }).join('');
        };

        const openNudgesModal = () => {
            renderNudges();
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
                return `<label class="tap flex items-center gap-2 p-2 min-h-tap rounded-lg ${isPayer ? 'bg-surface-2' : 'cursor-pointer'}">
                    <input type="checkbox" class="bill-member-cb w-5 h-5 accent-ink" data-id="${id}" ${inBill ? 'checked' : ''} ${isPayer ? 'disabled' : ''}>
                    ${avatarHtml(m.name, id)}
                    <span class="flex-grow truncate font-medium">${escapeHtml(m.name)}${isPayer ? ' <span class="text-xs text-ink-3">(płatnik)</span>' : ''}</span>
                </label>`;
            }).join('');
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
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            if (include) {
                const activeStatus = billData.type === 'advanced' ? 'incomplete' : 'unpaid';
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
        };

        // --- Krok 5: ekran „Profil" — personalizacja (przeniesiona) + „ile kto wydał" ---
        // onSelf = suma udziałów (co skonsumował); fronted = ile wyłożył jako płatnik. Per waluta, w groszach.
        const computeSpending = (bills) => {
            const res = {};
            const ensure = (id) => res[id] || (res[id] = { onSelf: {}, fronted: {} });
            (bills || []).forEach(b => {
                const cur = b.currency || 'PLN';
                if (b.payerId && b.payerConfirmed && toGrosze(b.totalAmount || 0) > 0) {
                    const f = ensure(b.payerId).fronted; f[cur] = (f[cur] || 0) + toGrosze(b.totalAmount || 0);
                }
                calculateAllForBill(b).participantTotals.forEach(pt => {
                    const g = toGrosze(pt.total); if (g <= 0) return;
                    const s = ensure(pt.participant.id).onSelf; s[cur] = (s[cur] || 0) + g;
                });
            });
            return res;
        };
        const renderProfile = () => {
            if (!groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const av = document.getElementById('profile-avatar-preview');
            if (av && myMember) {
                if (myMember.photoURL) {
                    av.innerHTML = `<img src="${escapeHtml(myMember.photoURL)}" class="w-16 h-16 rounded-full object-cover" alt="">`;
                } else {
                    // Ten sam znak, co wszędzie indziej, tylko w pełnym rozmiarze: dopiero
                    // tutaj widać gęstość rozety, po której ekipa rozpoznaje człowieka.
                    av.innerHTML = avatarHtml(myMember.name, myMember.id, 'w-16 h-16 text-4xl');
                }
            }
            const removeBtn = document.getElementById('profile-photo-remove-btn');
            if (removeBtn) removeBtn.classList.toggle('hidden', !(myMember && myMember.photoURL));
            const bills = latestBills.map(({ id, data }) => ({ ...data, id }));
            const sp = computeSpending(bills);
            const order = groupData.memberOrder || Object.keys(groupData.members || {});
            const fmtMap = (m) => Object.keys(m).length ? Object.entries(m).map(([c, g]) => fmtMoney(g, c)).join(', ') : '—';
            document.getElementById('profile-spending').innerHTML = order.map(id => {
                const mm = groupData.members[id]; if (!mm) return '';
                const s = sp[id] || { onSelf: {}, fronted: {} };
                return `<div class="card flex items-center justify-between gap-2 p-3">
                    <span class="flex items-center min-w-0">${avatarHtml(mm.name, id)}<span class="truncate font-medium">${escapeHtml(mm.name)}</span></span>
                    <span class="text-sm text-right flex-shrink-0"><span class="block text-ink-2">na siebie: <b>${fmtMap(s.onSelf)}</b></span><span class="block text-ink-3 text-xs">wyłożył/a: ${fmtMap(s.fronted)}</span></span>
                </div>`;
            }).join('');
        };

        // Zdjęcie profilowe (reużycie maszynerii zdjęć paragonów: heic2any + Storage).
        const uploadProfilePhoto = async (file) => {
            const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember || !file) return;
            let f = file, name = file.name || 'photo.jpg';
            if (file.type === 'image/heic' || name.toLowerCase().endsWith('.heic')) {
                try { showToast('Konwertowanie zdjęcia HEIC...'); f = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 }); name = name.replace(/\.[^/.]+$/, '') + '.jpg'; }
                catch (e) { console.error(e); showToast('Nie udało się przekonwertować HEIC.', true); return; }
            }
            if (!f.type || !f.type.startsWith('image/')) { showToast('Wybierz obraz.', true); return; }
            if (f.size > 20 * 1024 * 1024) { showToast('Zdjęcie za duże (max 20 MB).', true); return; }
            showToast('Wgrywanie zdjęcia...');
            try {
                const oldURL = myMember.photoURL;
                const storageRef = ref(storage, `groups/${currentGroupId}/profile-photos/${myMember.id}/${Date.now()}-${name}`);
                const snap = await uploadBytes(storageRef, f);
                const url = await getDownloadURL(snap.ref);
                await updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), { [`members.${myMember.id}.photoURL`]: url });
                if (oldURL) { try { await deleteObject(ref(storage, oldURL)); } catch (e) {} }
                showToast('Zapisano zdjęcie profilowe.');
            } catch (e) { console.error(e); showToast('Nie udało się wgrać zdjęcia.', true); }
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
        const getBillUserState = (bill, myMember) => {
            const myP = bill.participants ? bill.participants[myMember.id] : null;
            if (!myP || myP.status === 'not_applicable' || (bill.hiddenBy || []).includes(myMember.id)) return 'hidden';
            return 'visible';
        };

        const renderBillsList = () => {
            const billsList = document.getElementById('bills-history-list');
            if (!billsList || !groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;

            document.querySelectorAll('.bill-filter-btn').forEach(btn => {
                btn.setAttribute('aria-pressed', String(btn.dataset.filter === currentBillFilter));
            });

            const visible = latestBills.filter(({ data }) => {
                const state = getBillUserState(data, myMember);
                return currentBillFilter === 'all' ? state !== 'hidden' : state === currentBillFilter;
            });

            billsList.innerHTML = '';
            if (visible.length === 0) {
                billsList.innerHTML = latestBills.length === 0
                    ? '<p class="block-quiet p-5 text-sm text-ink-2">Pusty pokój. Pierwszy rachunek dodasz przyciskiem na dole ekranu.</p>'
                    : '<p class="block-quiet p-5 text-sm text-ink-2">Nic w tym widoku.</p>';
                return;
            }

            visible.forEach(({ id, data: bill }) => {
                const myParticipant = bill.participants ? bill.participants[myMember.id] : null;
                const isHidden = (bill.hiddenBy || []).includes(myMember.id);
                const canToggleHide = myParticipant && myParticipant.status !== 'not_applicable';
                const summaryHtml = getBillSummaryHtml(bill, myMember, myParticipant);
                const hideBtn = canToggleHide
                    ? `<button class="hide-bill-btn tap min-h-tap min-w-tap text-ink-3" title="${isHidden ? 'Przywróć' : 'Ukryj'}"><i class="fas ${isHidden ? 'fa-eye' : 'fa-eye-slash'}"></i></button>`
                    : '';

                // Data rachunku idzie mikrodrukiem: jest potrzebna do odróżnienia dwóch kolacji
                // w tym samym miejscu, ale nie konkuruje z nazwą ani z kwotą.
                const created = bill.createdAt && bill.createdAt.toDate
                    ? bill.createdAt.toDate().toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
                    : '';

                // KOLOR NIESIE STATUS, nie tożsamość. Kolorowanie kafelka kolorem płatnika
                // zamieniało listę w tęczę, w której nic nie znaczyło nic. Tu odcień pojawia
                // się WYŁĄCZNIE tam, gdzie jest coś do wiedzenia: co czeka na twój ruch,
                // ile jesteś winien, co już domknięte. Biały kafelek to stan spokojny.
                const status = billStatus(bill, myMember, myParticipant);
                const billEl = document.createElement('div');
                billEl.className = "card tap p-4 flex items-center gap-3 cursor-pointer";
                // Tło barwi się tylko przy zadaniu do wykonania — reszta listy zostaje biała,
                // więc oko trafia w to jedno miejsce bez szukania.
                if (status.tone === 'action') billEl.style.backgroundColor = 'rgb(var(--info) / 0.09)';
                billEl.innerHTML = `
                    ${bill.payerId ? avatarHtml(memberName(bill.payerId), bill.payerId, 'w-11 h-11 text-base') : ''}
                    <div class="min-w-0 flex-grow">
                        <p class="font-bold text-lg truncate leading-tight">${escapeHtml(bill.billName)}</p>
                        <div class="mt-1 flex items-center gap-2 flex-wrap">
                            <span class="${status.chipClass}">${status.labelHtml}</span>
                            <span class="text-sm text-ink-3">${created}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="${status.amountClass}">${status.amount}</span>
                        ${hideBtn}
                    </div>
                `;
                billEl.onclick = (e) => {
                    if (e.target.closest('button')) return;
                    joinBill(currentGroupId, id);
                };
                const hb = billEl.querySelector('.hide-bill-btn');
                if (hb) {
                    hb.onclick = async (e) => {
                        e.stopPropagation();
                        const billRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, id);
                        await updateDoc(billRef, { hiddenBy: isHidden ? arrayRemove(myMember.id) : arrayUnion(myMember.id) });
                    };
                }
                billsList.appendChild(billEl);
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

        const joinBill = async (groupId, billId) => {
            currentGroupId = groupId;
            currentBillId = billId;
            history.pushState(null, '', `?group=${groupId}&bill=${billId}`);
            if (unsubscribeBill) unsubscribeBill();
            // Wchodzimy na gotowy paragon, więc nic nie ma prawa animować przy otwarciu —
            // ruch tłumaczy ZMIANĘ, a pierwszy render żadnej zmiany nie pokazuje.
            lastPickersByItem = new Map();
            
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
        const getStatusHtml = (status, isMe, isPayer, participantId = null, billType = 'advanced') => {
            // Status mówi o UDZIALE w rachunku, nie o pieniądzach — dlatego chodzi tonami
            // atramentu, a jedyny kolor („informacja") dostaje stan, który czegoś od
            // człowieka chce. Czerwień i zieleń zostają zarezerwowane dla długu i należności.
            const statuses = {
                incomplete: { text: "Nieuzupełnione", icon: "fa-question-circle", color: "text-info", bg: "bg-surface-2" },
                completed: { text: "Uzupełnione", icon: "fa-user-check", color: "text-ink-2", bg: "bg-surface-2" },
                not_applicable: { text: "Nie dotyczy", icon: "fa-ban", color: "text-ink-3", bg: "bg-surface-2" },
            };
            const active = { text: "W rachunku", icon: "fa-user", color: "text-ink-2", bg: "bg-surface-2" };
            const current = statuses[status] || active; // legacy unpaid/paid → „w rachunku"
            const isPayerConfirmed = billData.payerConfirmed === true;

            if (isPayer) {
                if (isPayerConfirmed) {
                    return `<span class="text-sm font-semibold text-due">Płatnik · potwierdzony</span>`;
                }
                return `<span class="text-sm font-semibold text-ink-2">Płatnik</span>`;
            }

            if (isMe) {
                const options = `<option value="incomplete" ${status === 'incomplete' ? 'selected' : ''}>Nieuzupełnione</option>
                       <option value="completed" ${status === 'completed' ? 'selected' : ''}>Uzupełnione</option>
                       <option value="not_applicable" ${status === 'not_applicable' ? 'selected' : ''}>Mnie nie dotyczy</option>`;
                return `
                    <div class="status-select-wrapper ${current.bg}">
                        <i class="fas ${current.icon} ${current.color} mr-2"></i>
                        <select class="status-select font-semibold ${current.color}" data-participant-id="${participantId}">${options}</select>
                    </div>`;
            }

            return `<span class="font-semibold ${current.color} flex items-center"><i class="fas ${current.icon} mr-2"></i>${current.text}</span>`;
        };

        // Model wpłat: status rachunku to tylko członkostwo/uzupełnienie (bez opłacone/paidAmount/śladu).
        const buildStatusUpdate = (bill, participantId, newStatus) => ({ [`participants.${participantId}.status`]: newStatus });

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
                console.warn('[BillSplitter] Transakcja pozycji nieudana — zapis awaryjny:', err);
                await updateDoc(billRef, { sharedCosts: mutate(billData.sharedCosts || []) });
            }
        };

        const renderItemTiles = () => {
            const list = document.getElementById('shared-costs-list');
            if (!list || !billData) return;
            const items = billData.sharedCosts || [];
            const cur = billData.currency || 'PLN';
            const me = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === (currentUser && currentUser.uid));
            const myId = me ? me.id : null;

            const header = document.getElementById('items-section-header');
            if (header) {
                const missing = unassignedItems(billData).length;
                // Licznik „bez wyboru" jest jedyną czerwienią w tej sekcji: to realny brak
                // w rozliczeniu, a nie ozdoba. Same kafelki znaczą brak przerywaną krawędzią.
                header.innerHTML = items.length === 0 ? '' :
                    `<div class="flex items-center justify-between gap-2 mb-3">
                        <h3 class="font-display text-xl font-extrabold tracking-tight">Pozycje (${items.length})</h3>
                        ${missing > 0 ? `<p class="chip text-owe">${missing} bez wyboru</p>` : ''}
                    </div>`;
            }

            if (items.length === 0) {
                list.className = '';
                list.innerHTML = `<p class="block-quiet p-5 text-sm text-ink-2">Brak pozycji. Dodaj zdjęcie paragonu niżej i odczytaj je — albo dopisz pozycję ręcznie. Potem każdy stuknie to, co jadł.</p>`;
                return;
            }

            // ŻYWY PARAGON — znak tej aplikacji.
            //
            // Pozycje stoją w KOLUMNIE jak na paragonie, nie w siatce kafelków: paragon czyta
            // się z góry na dół, a przy trzydziestu pozycjach siatka zmusza oko do skakania.
            // Po prawej każdej linii stoi stos twarzy tych, którzy ją wzięli — i to jest ta
            // rzecz, której nie ma konkurencja: gdy piętnaście osób odklikuje równocześnie,
            // widzisz cudze zdjęcia lądujące na liniach na własnym ekranie, w czasie
            // rzeczywistym. Współbieżność przestaje być obietnicą w opisie i staje się obrazem.
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
                    <span class="flex-grow min-w-0">
                        <span class="block font-bold leading-tight truncate">${escapeHtml(it.description || 'Pozycja')}${qty > 1 ? ` <span class="text-ink-3 font-semibold">×${qty}</span>` : ''}</span>
                        <span class="mt-1.5 flex items-center gap-2 min-h-[1.75rem]">
                            ${count > 0
                                ? `<span class="face-stack">${faces}</span>${count > 5 ? `<span class="text-xs font-bold text-ink-3">+${count - 5}</span>` : ''}
                                   <span class="text-xs ${mine ? 'font-bold text-ink' : 'text-ink-3'}">${fmtMoney(perPersonG, cur)}/os.</span>`
                                : `<span class="chip text-ink-3">Stuknij, jeśli to Twoje</span>`}
                        </span>
                    </span>
                    <span class="flex items-center gap-2 flex-shrink-0">
                        <span class="amount text-xl">${denominationHtml(amountG, cur, 'text-ink', { withCurrency: false })}</span>
                        <button class="item-edit-btn w-11 h-11 rounded-full flex items-center justify-center text-ink-3 flex-shrink-0" data-item-id="${it.id}" title="Edytuj pozycję" aria-label="Edytuj pozycję"><i class="fas fa-pen text-xs"></i></button>
                    </span>
                </div>`;
            }).join('');

            // Zapamiętujemy stan PO wyrenderowaniu, żeby następny zapis z bazy wiedział,
            // które twarze są nowe. Przy pierwszym wejściu na rachunek mapa jest pusta,
            // więc nic nie animuje — wchodzisz na gotowy paragon, a nie na fajerwerki.
            items.forEach(it => {
                lastPickersByItem.set(it.id, new Set(itemPickers(it)));
            });
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
                ? 'AI przepisze paragon na pozycje — zawsze możesz je poprawić.'
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
                console.error('[BillSplitter] Odczyt paragonu nieudany:', err);
                showToast(err && err.message ? err.message : 'Nie udało się odczytać paragonu.', true);
            } finally {
                btn.disabled = false;
                label.textContent = 'Odczytaj paragon';
            }
        };

        const renderReceiptPreview = () => {
            if (!receiptDraft) return;
            const cur = (billData && billData.currency) || 'PLN';
            const wrap = document.getElementById('receipt-preview-items');

            wrap.innerHTML = receiptDraft.items.map((it, i) => `
                <div class="flex items-center gap-2 p-2 rounded-lg ${it.__use ? '' : 'opacity-50'}">
                    <input type="checkbox" class="rp-use w-5 h-5 flex-shrink-0 accent-ink" data-i="${i}" ${it.__use ? 'checked' : ''}>
                    <input type="text" class="rp-name field flex-grow min-w-0 p-1.5" data-i="${i}" value="${escapeHtml(it.description)}">
                    <input type="number" min="1" step="1" class="rp-qty field w-14 p-1.5 text-center" data-i="${i}" value="${it.quantity}">
                    <input type="text" inputmode="decimal" class="rp-amount field w-24 p-1.5 text-right font-semibold" data-i="${i}" value="${String(it.amount.toFixed(2)).replace('.', ',')}">
                    <span class="text-xs text-ink-3 flex-shrink-0">${cur}</span>
                </div>`).join('');

            const modWrap = document.getElementById('receipt-preview-modifiers-wrap');
            modWrap.classList.toggle('hidden', receiptDraft.modifiers.length === 0);
            document.getElementById('receipt-preview-modifiers').innerHTML = receiptDraft.modifiers.map((m, i) => `
                <div class="flex items-center gap-2 p-2 rounded-lg ${m.__use ? '' : 'opacity-50'}">
                    <input type="checkbox" class="rp-mod-use w-5 h-5 flex-shrink-0 accent-ink" data-i="${i}" ${m.__use ? 'checked' : ''}>
                    <span class="flex-grow min-w-0 truncate">${escapeHtml(m.description)}</span>
                    <span class="font-semibold ${Number(m.value) < 0 ? 'text-due' : 'text-ink-2'}">${m.type === 'percent' ? `${Number(m.value)}%` : fmtMoney(toGrosze(m.value), cur)}</span>
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

            // Rozjazd z sumą paragonu to najczęstszy objaw przeoczonej linii — mówimy o tym wprost.
            const warn = document.getElementById('receipt-preview-warning');
            const totalG = receiptDraft.receiptTotal ? toGrosze(receiptDraft.receiptTotal) : 0;
            // Modyfikatory procentowe liczą się od sumy pozycji — bez tego serwis „10%" wyglądałby
            // jak brakująca linia i wywoływał fałszywy alarm (a fałszywe alarmy uczą ignorować ostrzeżenia).
            const modsG = receiptDraft.modifiers
                .filter(m => m.__use)
                .reduce((s, m) => s + (m.type === 'percent' ? Math.round(sumG * m.value / 100) : toGrosze(m.value)), 0);
            const diffG = totalG > 0 ? (sumG + modsG) - totalG : 0;
            if (totalG > 0 && Math.abs(diffG) > 1) {
                warn.classList.remove('hidden');
                warn.innerHTML = `<i class="fas fa-triangle-exclamation mr-1"></i>Suma wybranych pozycji (${fmtMoney(sumG + modsG, cur)}) różni się od sumy z paragonu (${fmtMoney(totalG, cur)}) o <b>${fmtMoney(Math.abs(diffG), cur)}</b>. Sprawdź, czy któraś linia nie umknęła.`;
            } else {
                warn.classList.add('hidden');
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
                console.warn('[BillSplitter] Transakcja paragonu nieudana — zapis awaryjny:', err);
                await updateDoc(billRef, buildUpdates(billData));
            }
            document.getElementById('receipt-preview-modal').classList.remove('active');
            receiptDraft = null;
            showToast(`Dodano ${items.length} pozycji z paragonu.`);
        };

        // Edytor pozycji — ten sam modal dodaje i edytuje (editingItemId = null → dodawanie).
        let editingItemId = null;

        const openItemModal = (itemId) => {
            if (!billData) return;
            editingItemId = itemId || null;
            const item = itemId ? (billData.sharedCosts || []).find(i => i.id === itemId) : null;

            document.getElementById('item-modal-title').textContent = item ? 'Edytuj pozycję' : 'Dodaj pozycję';
            document.getElementById('shared-cost-desc').value = item ? (item.description || '') : '';
            document.getElementById('item-quantity').value = item ? itemQuantity(item) : 1;
            document.getElementById('shared-cost-amount').value = item ? String(item.amount ?? '').replace('.', ',') : '';
            document.getElementById('item-amount-currency').textContent = billData.currency || 'PLN';

            const picked = item ? itemPickers(item) : [];
            const wrap = document.getElementById('shared-cost-participants');
            wrap.innerHTML = Object.values(billData.participants || {})
                .filter(p => p.status !== 'not_applicable')
                .map(p => `<label class="tap flex items-center gap-2 p-2 min-h-tap rounded-lg cursor-pointer">
                    <input type="checkbox" class="shared-participant-checkbox w-5 h-5 accent-ink" value="${p.id}" ${picked.includes(p.id) ? 'checked' : ''}>
                    ${avatarHtml(p.name, p.id, 'w-7 h-7 text-sm mr-1')}<span class="truncate">${escapeHtml(p.name)}</span>
                </label>`).join('');

            // Rozbicie na sztuki ma sens tylko dla istniejącej pozycji o ilości > 1.
            const splitBtn = document.getElementById('item-split-btn');
            splitBtn.classList.toggle('hidden', !(item && itemQuantity(item) > 1));

            // Kasowanie pokazujemy wyłącznie przy pozycji, która już istnieje — przy
            // dodawaniu nowej nie ma czego usuwać, a przycisk „Usuń" obok pustego
            // formularza tylko rozprasza.
            const deleteBtn = document.getElementById('item-delete-btn');
            deleteBtn.classList.toggle('hidden', !item);
            deleteBtn.dataset.costId = item ? item.id : '';
            deleteBtn.onclick = async () => {
                if (!editingItemId) return;
                const id = editingItemId;
                document.getElementById('shared-cost-modal').classList.remove('active');
                await mutateItems((items) => items.filter(sc => sc.id !== id));
                showToast('Pozycja usunięta.');
            };

            document.getElementById('shared-cost-modal').classList.add('active');
        };

        const saveItemFromModal = async () => {
            const description = document.getElementById('shared-cost-desc').value.trim();
            const amount = parseLocalFloat(document.getElementById('shared-cost-amount').value);
            const quantity = Math.max(1, Math.trunc(parseLocalFloat(document.getElementById('item-quantity').value)) || 1);
            const sharedBy = Array.from(document.querySelectorAll('.shared-participant-checkbox:checked')).map(cb => cb.value);
            if (!description) { showToast('Podaj nazwę pozycji.', true); return; }
            if (!(amount > 0)) { showToast('Podaj cenę pozycji.', true); return; }

            const newId = generateId();
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
            document.getElementById('shared-cost-modal').classList.remove('active');
            showToast(editingItemId ? 'Zapisano pozycję.' : 'Dodano pozycję.');
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
        const participantBreakdownHtml = (pt, isMe, paymentInfo = '') => {
            const cur = billData.currency;
            // `caption`, nie `label`: strażnik escapowania traktuje `label` jako daną z bazy
            // (bo w profilu metod płatności nią jest), a tu wchodzą wyłącznie napisy z kodu.
            const row = (caption, amount) =>
                `<div class="flex justify-between gap-2"><span class="text-ink-3">${caption}</span><span class="text-ink-2">${amount.toFixed(2).replace('.', ',')}</span></div>`;
            return `<div class="mt-3 pt-3 border-t border-ink/10 text-sm space-y-0.5">
                ${isMe ? '' : row('Koszty własne', pt.individualAmount)}
                ${row('Pozycje', pt.sharedAmount)}
                ${row('Koszty wspólne', pt.globalCostsAmount)}
                <div class="flex items-baseline justify-between gap-2 pt-2">
                    <span class="text-sm font-bold text-ink-3">Łącznie</span>
                    <span class="text-2xl">${denominationHtml(toGrosze(pt.total), cur, 'text-ink')}</span>
                </div>
                <div class="text-right text-xs text-ink-3">${getPlnConversionHtml(pt.total, cur, billData.exchangeRatePLN)}</div>
                ${paymentInfo}
            </div>`;
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
            const canConfirm = isCurrentUserThePayer && !isPayerConfirmed;

            document.getElementById('bill-name').textContent = billData.billName;
            
            const currencySelect = document.getElementById('currency-select');
            currencySelect.value = billData.currency;
            currencySelect.disabled = !canEditMainFields;
            
            const totalAmountInput = document.getElementById('total-bill-amount');
            if (document.activeElement !== totalAmountInput) {
                totalAmountInput.value = billData.totalAmount > 0 ? billData.totalAmount.toFixed(2) : '';
            }
            totalAmountInput.disabled = !canEditMainFields;
            
            const payerSelect = document.getElementById('payer-select');
            // „Nikt" brzmiało jak stwierdzenie faktu („nikt nie zapłacił"), a to jest
            // pole do wypełnienia. Zachęta mówi, co zrobić.
            payerSelect.innerHTML = '<option value="">Wskaż osobę…</option>';
            Object.values(billData.participants || {}).forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                if (billData.payerId === p.id) option.selected = true;
                payerSelect.appendChild(option);
            });
            // Payer selection should be locked after confirmation to avoid confusion.
            payerSelect.disabled = isPayerConfirmed;

            const confirmationBanner = document.getElementById('payer-confirmation-banner-advanced');
            if (canConfirm) {
                confirmationBanner.innerHTML = `
                    <div class="card p-4 flex flex-wrap justify-between items-center gap-3">
                        <span class="text-sm text-ink-2">To Ty wyłożyłeś/aś pieniądze za ten rachunek. Potwierdź, żeby zablokować wybór płatnika.</span>
                        <button id="confirm-payer-btn" class="btn btn-dark flex-shrink-0">Potwierdzam</button>
                    </div>`;
                document.getElementById('confirm-payer-btn').onclick = async () => {
                     await updateDoc(doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId), { payerConfirmed: true });
                };
            } else if (isPayerConfirmed) {
                const payerName = billData.participants[billData.payerId]?.name || '...';
                const bannerText = isCurrentUserThePayer
                    ? `Wyłożyłeś/aś pieniądze za ten rachunek — kwotę wciąż możesz poprawić.`
                    : `Główne pola rachunku zablokował/a <strong>${escapeHtml(payerName)}</strong>.`;
                // Stempel foliowy znaczy „potwierdzone" — tu potwierdzone jest, kto wyłożył pieniądze.
                confirmationBanner.innerHTML = `
                    <div class="card p-4 flex items-center gap-3">
                        <span class="chip text-due text-[0.6rem] font-bold px-2 py-1 flex-shrink-0">Płatnik</span>
                        <span class="text-sm text-ink-2">${bannerText}</span>
                    </div>`;
            } else {
                confirmationBanner.innerHTML = '';
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
            if (control.status === 'over') {
                controlSumEl.classList.add('control-sum-bad');
                if (controlStatusEl) { controlStatusEl.classList.add('control-sum-bad'); controlStatusEl.textContent = `Nadwyżka ${diffText(control.diff)} — ktoś przeliczył albo pozycja jest podwójna`; }
            } else if (control.status === 'under') {
                if (controlStatusEl) {
                    controlStatusEl.textContent = calculations.perPersonUnallocated > 0
                        ? `Nierozpisane ${diffText(calculations.unallocated)}, czyli po ${diffText(calculations.perPersonUnallocated)} na osobę.`
                        : `Nierozpisane ${diffText(calculations.unallocated)}.`;
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

                const statusDisplayHtml = getStatusHtml(p.status, isMe, isPayer, p.id, 'advanced');

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

                    participantHTML = `
                    <div class="card p-4" data-participant-id="${p.id}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center min-w-0">
                                ${avatarHtml(p.name, p.id)}
                                <div class="flex flex-col min-w-0">
                                    <span class="text-lg font-semibold truncate">${escapeHtml(p.name)}</span>
                                    ${statusDisplayHtml}
                                </div>
                            </div>
                            <span class="chip text-due text-[0.55rem] font-bold px-2 py-1 flex-shrink-0">Ty</span>
                        </div>

                        <div class="mt-3">
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

                        ${participantBreakdownHtml(pt, true, paymentInfo)}
                    </div>`;
                } else { // Other participants view
                    participantHTML = `
                    <div class="card p-4">
                        <div class="flex items-center min-w-0">
                            ${avatarHtml(p.name, p.id)}
                            <div class="flex flex-col min-w-0">
                                <span class="text-lg font-semibold truncate">${escapeHtml(p.name)}</span>
                                ${statusDisplayHtml}
                            </div>
                        </div>
                        ${participantBreakdownHtml(pt, false, paymentInfo)}
                    </div>`;
                }
                
                if (isMe) {
                    document.getElementById('my-participant-card').innerHTML = participantHTML;
                } else {
                    document.getElementById('participants-list').innerHTML += participantHTML;
                }
            });
            
            renderItemTiles();

            document.getElementById('global-costs-list').innerHTML = (billData.globalCosts || []).map(gc => {
                // Number() zamiast .toFixed() wprost: koszt wspólny wpisany z konsoli jako tekst
                // wywalał cały render listy (a z nim ekran rachunku).
                const gcValue = Number(gc.value) || 0;
                const valueText = gc.type === 'percent' ? `${gcValue}%` : `${gcValue.toFixed(2).replace('.', ',')} ${escapeHtml(billData.currency)}`;
                // Koszt ogólny dotyczy wszystkich, więc czyta się jak dopisek na banknocie:
                // pasek mikrodruku po lewej, kwota po prawej, bez własnego koloru.
                return `
                    <div class="card p-3 flex justify-between items-center gap-2">
                        <p class="font-semibold truncate">${escapeHtml(gc.description)}</p>
                        <span class="flex items-center gap-3 flex-shrink-0">
                            <span class="font-semibold text-ink-2">${valueText}</span>
                            <button class="remove-global-cost-btn tap w-9 h-9 rounded-lg flex items-center justify-center text-ink-3" data-cost-id="${gc.id}" title="Usuń koszt wspólny"><i class="fas fa-trash text-sm"></i></button>
                        </span>
                    </div>`;
            }).join('');
            
            document.getElementById('add-shared-cost-btn').disabled = false;
            document.getElementById('add-global-cost-btn').disabled = false;
            // FIX: The variable to check if the delete button should be shown is now `isCurrentUserThePayer`
            document.getElementById('delete-bill-btn-advanced').style.display = isCurrentUserThePayer ? 'inline-block' : 'none';

            addAdvancedBillEventListeners();
        };

        const addAdvancedBillEventListeners = () => {
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            // (Usunięta lokalna kopia `parseLocalFloat` — istnieje wersja modułowa. Dublet już raz
            // wywołał cichy ReferenceError, gdy jedna z kopii zniknęła przy refaktorze.)

            document.getElementById('back-to-dashboard-btn').onclick = () => {
                if (unsubscribeBill) unsubscribeBill();
                navigateToGroup(currentGroupId);
            };
            document.getElementById('total-bill-amount').onchange = async (e) => {
                await updateDoc(billDocRef, { totalAmount: parseLocalFloat(e.target.value) });
            };
            document.getElementById('currency-select').onchange = async (e) => {
                await updateDoc(billDocRef, await currencyPatch(e.target.value));
            };
            
            document.getElementById('payer-select').onchange = async (e) => {
                const newPayerId = e.target.value || null;
                const oldPayerId = billData.payerId;

                if (newPayerId === oldPayerId) return;
                
                const updates = { 
                    payerId: newPayerId,
                    payerConfirmed: false
                };

                if (newPayerId) {
                    const newPayer = billData.participants[newPayerId];
                    if (newPayer) {
                        const newStatus = newPayer.individualAmount > 0 ? 'completed' : 'incomplete';
                        updates[`participants.${newPayerId}.status`] = newStatus;
                    }
                }
                if (oldPayerId) {
                    const oldPayer = billData.participants[oldPayerId];
                    if (oldPayer && (oldPayer.status === 'completed' || oldPayer.status === 'incomplete')) {
                        updates[`participants.${oldPayerId}.status`] = 'unpaid';
                    }
                }

                await updateDoc(billDocRef, updates);
            };

            document.getElementById('delete-bill-btn-advanced').onclick = () => deleteBillWithUndo();

            const myCard = document.getElementById('my-participant-card');
            if (myCard) {
                myCard.onclick = async (e) => {
                    const participantId = myCard.firstElementChild.dataset.participantId;
                    const participant = billData.participants[participantId];
                    if (!participant) return;

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

                    const updates = {};
                    let statusShouldChange = false;
                    let newTotal = participant.individualAmount;
                    
                    if (target.classList.contains('status-select')) {
                        const newStatus = e.target.value;
                        Object.assign(updates, buildStatusUpdate(billData, participantId, newStatus));
                        if (newStatus === 'not_applicable') {
                            updates[`participants.${participantId}.individualAmount`] = 0;
                            updates[`participants.${participantId}.individualAmounts`] = [];
                            updates[`participants.${participantId}.calculatorActive`] = false;
                        }
                        await updateDoc(billDocRef, updates);
                        return;
                    }
                    
                    if (target.id.startsWith('your-sum-input-')) {
                        newTotal = parseLocalFloat(target.value);
                        statusShouldChange = true;
                    } else if (target.classList.contains('individual-amount-component')) {
                        const container = document.getElementById(`calculator-inputs-container-${participantId}`);
                        const newAmounts = Array.from(container.querySelectorAll('.individual-amount-component')).map(input => parseLocalFloat(input.value)).filter(val => val > 0);
                        while (newAmounts.length < 2) newAmounts.push(0);
                        updates[`participants.${participantId}.individualAmounts`] = newAmounts;
                        newTotal = newAmounts.reduce((sum, val) => sum + val, 0);
                        statusShouldChange = true;
                    } else {
                        return;
                    }
                    
                    updates[`participants.${participantId}.individualAmount`] = newTotal;

                    if (statusShouldChange) {
                        const isPayer = participant.id === billData.payerId;
                        if (isPayer) {
                            updates[`participants.${participantId}.status`] = newTotal > 0 ? 'completed' : 'incomplete';
                        } else if (participant.status === 'incomplete' || participant.status === 'completed') {
                            updates[`participants.${participantId}.status`] = 'unpaid';
                        }
                    }
                    
                    await updateDoc(billDocRef, updates);
                };
            }

            // Linia paragonu: stuknięcie dopisuje/wypisuje MNIE z pozycji (klik w ołówek/kosz
            // nie liczy się jako wybór).
            document.querySelectorAll('.receipt-line').forEach(tile => {
                tile.onclick = async (e) => {
                    if (e.target.closest('.item-edit-btn') || e.target.closest('.remove-shared-cost-btn')) return;
                    const my = myMemberNow();
                    if (!my) { showToast('Najpierw dołącz do grupy.', true); return; }
                    if (!billData.participants[my.id] || billData.participants[my.id].status === 'not_applicable') {
                        showToast('Nie jesteś uczestnikiem tego rachunku.', true); return;
                    }
                    await mutateItems((items) => toggleItemPicker(items, tile.dataset.itemId, my.id));
                };
            });
            document.querySelectorAll('.item-edit-btn').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); openItemModal(e.currentTarget.dataset.itemId); };
            });

            document.querySelectorAll('.remove-shared-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    // Usuwamy PO IDENTYFIKATORZE, nie przez arrayRemove(obiekt): arrayRemove
                    // wymaga dokładnej zgodności całego obiektu, więc czyjeś stuknięcie w kafelek
                    // (zmiana `sharedBy`) sprawiało, że kasowanie po cichu nic nie robiło.
                    const costId = e.currentTarget.dataset.costId;
                    await mutateItems((items) => items.filter(sc => sc.id !== costId));
                };
            });
            document.querySelectorAll('.remove-global-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    const costId = e.currentTarget.dataset.costId;
                    const costToRemove = (billData.globalCosts || []).find(gc => gc.id === costId);
                    if (costToRemove) await updateDoc(billDocRef, { globalCosts: arrayRemove(costToRemove) });
                };
            });
            // Modal pozycji obsługujemy ręcznie (nie przez setupModal): zamknięcie musi zależeć od
            // walidacji, a przycisk otwarcia potrzebuje trybu „dodaj" vs „edytuj".
            document.getElementById('add-shared-cost-btn').onclick = () => openItemModal(null);
            document.getElementById('cancel-shared-cost').onclick = () => {
                document.getElementById('shared-cost-modal').classList.remove('active');
                editingItemId = null;
            };
            document.getElementById('save-shared-cost').onclick = saveItemFromModal;
            document.getElementById('item-split-btn').onclick = splitEditedItem;

            // Odczyt paragonu przez AI
            document.getElementById('parse-receipt-btn').onclick = runParseReceipt;
            document.getElementById('close-receipt-preview').onclick = () => {
                document.getElementById('receipt-preview-modal').classList.remove('active');
                receiptDraft = null;
            };
            document.getElementById('apply-receipt-btn').onclick = applyReceiptDraft;
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
                if (!t.classList.contains('rp-use') || !receiptDraft) return;
                receiptDraft.items[Number(t.dataset.i)].__use = t.checked;
                renderReceiptPreview();
            };
            document.getElementById('receipt-preview-modifiers').onchange = (e) => {
                const t = e.target;
                if (!t.classList.contains('rp-mod-use') || !receiptDraft) return;
                receiptDraft.modifiers[Number(t.dataset.i)].__use = t.checked;
                renderReceiptPreview();
            };
            document.getElementById('global-cost-type-select').addEventListener('change', (e) => {
                document.getElementById('global-cost-desc-other').classList.toggle('hidden', e.target.value !== 'Inne');
            });
            setupModal('global-cost-modal', 'add-global-cost-btn', 'cancel-global-cost', 'save-global-cost', async () => {
                let description = document.getElementById('global-cost-type-select').value;
                if (description === 'Inne') description = document.getElementById('global-cost-desc-other').value.trim();
                const type = document.querySelector('input[name="global-cost-format"]:checked').value;
                const value = parseLocalFloat(document.getElementById('global-cost-value').value);
                if (type === 'percent' && (value < 0 || value > 100)) {
                    showToast("Procent musi być w przedziale 0-100.", true); return;
                }
                if (!description || isNaN(value) || value <= 0) { showToast("Wypełnij wszystkie pola poprawnie.", true); return; }
                await updateDoc(billDocRef, { globalCosts: arrayUnion({ id: generateId(), description, type, value }) });
                document.getElementById('global-cost-type-select').value = 'Napiwek';
                document.getElementById('global-cost-desc-other').value = '';
                document.getElementById('global-cost-desc-other').classList.add('hidden');
                document.getElementById('global-cost-value').value = '';
            });
        };

        
        
        // ===================================================
        // ===== SETUP LISTENERS =====
        // ===================================================

        // Faza 6.1: rejestracja service workera (offline + kryterium instalowalności + push).
        // Tylko w PROD — w dev Vite HMR nie współpracuje z SW (cache modułów).
        let swRegistration = null;
        const registerServiceWorker = () => {
            if (!('serviceWorker' in navigator)) return;
            if (!import.meta.env.PROD) return;
            window.addEventListener('load', async () => {
                try {
                    swRegistration = await navigator.serviceWorker.register('/sw.js');
                    await navigator.serviceWorker.ready;
                    setupPush();
                } catch (err) {
                    console.warn('[BillSplitter] Rejestracja service workera nieudana:', err);
                }
            });
        };

        // --- Faza 6.4: powiadomienia push (FCM) ---
        // Token trzymamy w members.{id}.fcmTokens (tablica — jedna osoba może mieć telefon + laptop).
        // Wysyłką zajmie się backend (docelowo trigger na nudges/{id}); klient tylko rejestruje token.
        const VAPID_KEY = env.VITE_FCM_VAPID_KEY || '';
        let pushToken = null;
        let pushTokenSaved = false;

        const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && !!VAPID_KEY;

        const savePushToken = async () => {
            if (!pushToken || pushTokenSaved || !currentGroupId || !groupData) return;
            const my = myMemberNow();
            if (!my) return;
            await updateDoc(doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId), {
                [`members.${my.id}.fcmTokens`]: arrayUnion(pushToken),
            });
            pushTokenSaved = true;
        };

        const renderPushToggle = () => {
            const btn = document.getElementById('push-toggle-btn');
            const label = document.getElementById('push-toggle-label');
            const note = document.getElementById('push-toggle-note');
            if (!btn || !label || !note) return;
            if (!pushSupported()) {
                label.textContent = 'Powiadomienia niedostępne';
                note.textContent = 'Ta przeglądarka ich nie obsługuje (na iPhonie dodaj apkę do ekranu początkowego).';
                btn.disabled = true;
                btn.classList.add('opacity-60');
                return;
            }
            const perm = Notification.permission;
            if (perm === 'granted' && pushToken) {
                label.textContent = 'Powiadomienia włączone';
                note.textContent = 'Dostaniesz przypomnienie o zaległości nawet przy zamkniętej apce.';
            } else if (perm === 'denied') {
                label.textContent = 'Powiadomienia zablokowane';
                note.textContent = 'Odblokuj je w ustawieniach przeglądarki dla tej strony.';
            } else {
                label.textContent = 'Włącz powiadomienia';
                note.textContent = 'Przypomnienia o zaległościach trafią na to urządzenie.';
            }
        };

        const acquirePushToken = async () => {
            const messaging = getMessaging(app);
            pushToken = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: swRegistration || undefined,
            });
            pushTokenSaved = false;
            console.info('[BillSplitter] Token FCM tego urządzenia:', pushToken);
            await savePushToken();
            return pushToken;
        };

        const enablePush = async () => {
            if (!pushSupported()) { showToast('Ta przeglądarka nie obsługuje powiadomień.', true); return; }
            try {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') { showToast('Nie przyznano zgody na powiadomienia.', true); renderPushToggle(); return; }
                await acquirePushToken();
                showToast('Powiadomienia włączone.');
            } catch (err) {
                console.warn('[BillSplitter] Push — nie udało się pobrać tokenu:', err);
                showToast('Nie udało się włączyć powiadomień.', true);
            }
            renderPushToggle();
        };

        // Wołane po rejestracji service workera. Nie prosi o zgodę — tylko odświeża token,
        // jeśli użytkownik już wcześniej ją dał (tokeny FCM potrafią się zmienić).
        const setupPush = async () => {
            try {
                if (!pushSupported()) { renderPushToggle(); return; }
                if (!(await isMessagingSupported())) { renderPushToggle(); return; }
                const messaging = getMessaging(app);
                // Wiadomość przy otwartej apce: przeglądarka nie pokaże systemowego dymka — pokazujemy toast.
                onMessage(messaging, (payload) => {
                    const d = (payload && payload.data) || {};
                    showToast(d.body || d.title || 'Nowe przypomnienie.');
                    if (currentGroupId) updateNudgeBadge();
                });
                if (Notification.permission === 'granted') await acquirePushToken();
                renderPushToggle();
            } catch (err) {
                console.warn('[BillSplitter] Push — inicjalizacja nieudana:', err);
            }
        };

        const setupPwaInstallButton = () => {
            const installButton = document.getElementById('install-pwa-btn');
            const iosHint = document.getElementById('ios-install-hint');

            // Czy apka już działa jako zainstalowana (standalone)? Wtedy nic nie pokazujemy.
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
            // iOS Safari nie odpala `beforeinstallprompt` — trzeba pokazać ręczną instrukcję.
            const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos && !isStandalone && iosHint) iosHint.classList.remove('hidden');

            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredInstallPrompt = e;
                if (installButton) installButton.classList.remove('hidden');
            });

            if (installButton) installButton.addEventListener('click', async () => {
                if (!deferredInstallPrompt) return;
                installButton.classList.add('hidden');
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                console.log(`Akcja użytkownika (instalacja): ${outcome}`);
                deferredInstallPrompt = null;
            });

            window.addEventListener('appinstalled', () => {
                if (installButton) installButton.classList.add('hidden');
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
                    return;
                }
                const forget = e.target.closest('.forget-room-btn');
                if (forget) { forgetRoom(forget.dataset.roomId); renderMyRooms(); }
            });

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
                    const color = identityColor(`draft-${i}`, name);
                    // Kasownik żetonu miał 24×18 px — poniżej progu trafienia kciukiem.
                    // Teraz jest kołem 32 px w żetonie o wysokości 44 px.
                    return `<span class="chip pl-1 pr-1 py-1 gap-2 h-11">
                        <span class="w-8 h-8 rounded-full inline-flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style="background-color:${escapeHtml(color)}">${escapeHtml(initials(name))}</span>
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
                if (!groupName) { showToast('Nazwij grupę — po niej znajdziesz ją później.', true); return; }
                if (memberNames.length === 0) { showToast('Dodaj choć jedną osobę do grupy.', true); return; }
                const newGroupId = generateId();
                const membersMap = {};
                const memberOrder = []; // Array to store the order of members

                memberNames.forEach((name, index) => {
                    const id = generateId();
                    membersMap[id] = { id, name, claimedBy: null, color: PROFILE_COLORS[index % PROFILE_COLORS.length] };
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

        const showUndoToast = (message, onUndo) => {
            const toastId = 'toast-notification';
            const existing = document.getElementById(toastId);
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = toastId;
            toast.className = 'fixed bottom-24 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm p-3 rounded-lg z-50 bg-ink text-surface flex items-center gap-4';
            const span = document.createElement('span');
            span.textContent = message;
            const btn = document.createElement('button');
            btn.textContent = 'Cofnij';
            btn.className = 'tap min-h-tap px-3 rounded-lg font-semibold underline whitespace-nowrap flex-shrink-0';
            btn.onclick = () => { toast.remove(); onUndo(); };
            toast.append(span, btn);
            document.body.appendChild(toast);
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
            const CONFIRM_MODALS = new Set(['delete-confirm-modal', 'delete-photo-confirm-modal']);
            const openModals = () => [...document.querySelectorAll('.modal.active')];
            const closeTopModal = () => {
                const top = openModals().pop();
                if (top && !CONFIRM_MODALS.has(top.id)) top.classList.remove('active');
            };

            document.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                // Kliknięcie MUSI trafić w samo tło — kliknięcie w arkusz nie zamyka okna.
                if (modal && e.target === modal && !CONFIRM_MODALS.has(modal.id)) {
                    modal.classList.remove('active');
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
            const helpModal = document.getElementById('help-modal');
            document.getElementById('close-help-modal').onclick = () => helpModal.classList.remove('active');
            helpModal.onclick = (e) => { if (e.target === helpModal) helpModal.classList.remove('active'); };

            // Metody płatności (modal edytora)
            const pmModal = document.getElementById('payment-methods-modal');
            document.getElementById('close-payment-methods-modal').onclick = () => pmModal.classList.remove('active');
            pmModal.onclick = (e) => { if (e.target === pmModal) pmModal.classList.remove('active'); };
            const pmTypeSel = document.getElementById('pm-add-type');
            pmTypeSel.innerHTML = Object.entries(PAYMENT_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
            const pmLabelInput = document.getElementById('pm-add-label');
            const pmValueInput = document.getElementById('pm-add-value');
            pmTypeSel.onchange = () => {
                const t = PAYMENT_TYPES[pmTypeSel.value] || PAYMENT_TYPES.other;
                pmLabelInput.classList.toggle('hidden', pmTypeSel.value !== 'other');
                pmValueInput.placeholder = t.placeholder;
            };
            document.getElementById('pm-add-btn').onclick = async () => {
                const type = pmTypeSel.value;
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

            // Rozliczenia: zwijanie, przełącznik trybu, „Ureguluj", modal
            document.getElementById('toggle-settlements-btn').onclick = () => {
                document.getElementById('settlements-content').classList.toggle('hidden');
                document.getElementById('settlements-arrow-icon').classList.toggle('rotated');
            };
            document.querySelectorAll('.settle-mode-btn').forEach(btn => {
                btn.onclick = () => { settlementMode = btn.dataset.mode; renderSettlements(); };
            });
            document.getElementById('settlements-list').addEventListener('click', async (e) => {
                const settleRef = (id) => doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`, id);

                const nb = e.target.closest('.nudge-btn');
                if (nb) { await sendNudge(nb.dataset.nudgeTo, Number(nb.dataset.amountG), nb.dataset.currency); return; }

                const b = e.target.closest('.settle-btn');
                if (b) { openSettleModal(b.dataset.to, Number(b.dataset.amountG), b.dataset.currency, 'send'); return; }

                const rb = e.target.closest('.receive-btn');
                if (rb) {
                    const myMember = Object.values((groupData && groupData.members) || {}).find(m => m.claimedBy === currentUser.uid);
                    if (!myMember) return;
                    const debtorId = rb.dataset.from;
                    // jeśli dłużnik już zgłosił niepotwierdzoną wpłatę do mnie — POTWIERDŹ ją (zamiast tworzyć duplikat)
                    const pending = latestSettlements.filter(s => s.from === debtorId && s.to === myMember.id && !s.confirmed);
                    if (pending.length) {
                        await Promise.all(pending.map(s => updateDoc(settleRef(s.id), { confirmed: true, confirmedBy: currentUser.uid, confirmedAt: serverTimestamp() })));
                        showToast(pending.length === 1 ? 'Potwierdzono wpłatę.' : 'Potwierdzono wpłaty.');
                    } else {
                        openSettleModal(debtorId, Number(rb.dataset.amountG), rb.dataset.currency, 'receive');
                    }
                    return;
                }

                const conf = e.target.closest('.confirm-settle-btn');
                if (conf) {
                    await updateDoc(settleRef(conf.dataset.id), { confirmed: true, confirmedBy: currentUser.uid, confirmedAt: serverTimestamp() });
                    showToast('Potwierdzono wpłatę.');
                    return;
                }

                const del = e.target.closest('.settle-delete-btn');
                if (del) {
                    await deleteDoc(settleRef(del.dataset.id));
                    showToast('Usunięto wpłatę.');
                }
            });
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
            document.getElementById('nudges-list').addEventListener('click', async (e) => {
                const s = e.target.closest('.nudge-settle-btn');
                if (s) {
                    nudgesModal.classList.remove('active');
                    openSettleModal(s.dataset.to, Number(s.dataset.amountG), s.dataset.currency, 'send');
                    return;
                }
                const r = e.target.closest('.nudge-read-btn');
                if (r) {
                    await updateDoc(nudgeRef(r.dataset.id), { readBy: arrayUnion(currentUser.uid) });
                    return;
                }
            });

            // Edycja członków rachunku
            const bmBtnA = document.getElementById('edit-members-btn-advanced');
            if (bmBtnA) bmBtnA.onclick = openBillMembersModal;
            const bmModal = document.getElementById('bill-members-modal');
            document.getElementById('close-bill-members-modal').onclick = () => bmModal.classList.remove('active');
            bmModal.onclick = (e) => { if (e.target === bmModal) bmModal.classList.remove('active'); };
            document.getElementById('bill-members-list').addEventListener('change', async (e) => {
                const cb = e.target.closest('.bill-member-cb');
                if (!cb) return;
                await toggleBillMember(cb.dataset.id, cb.checked);
            });

            // Ekran „Profil"
            const openProfileBtn = document.getElementById('open-profile-btn');
            if (openProfileBtn) openProfileBtn.onclick = () => { renderProfile(); renderPushToggle(); showScreen('profile'); };
            const pushBtn = document.getElementById('push-toggle-btn');
            if (pushBtn) pushBtn.onclick = enablePush;
            const backProfileBtn = document.getElementById('back-to-dashboard-from-profile-btn');
            if (backProfileBtn) backProfileBtn.onclick = () => showScreen('group-dashboard');
            // Zdjęcie profilowe
            const photoBtn = document.getElementById('profile-photo-btn');
            const photoInput = document.getElementById('profile-photo-input');
            const photoRemove = document.getElementById('profile-photo-remove-btn');
            if (photoBtn && photoInput) photoBtn.onclick = () => photoInput.click();
            if (photoInput) photoInput.onchange = async (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) await uploadProfilePhoto(file); };
            if (photoRemove) photoRemove.onclick = removeProfilePhoto;
            // kopiuj-kwotę bierze aktualną wartość z pola
            document.getElementById('settle-amount-input').oninput = (e) => {
                const v = parseLocalFloat(e.target.value);
                document.getElementById('settle-copy-amount').dataset.account = (v > 0 ? v : 0).toFixed(2);
            };
            // zapis wpłaty do rejestru
            document.getElementById('settle-record-btn').onclick = async () => {
                if (!settleContext) return;
                const amount = parseLocalFloat(document.getElementById('settle-amount-input').value);
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
                await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), rec);
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
            
            const updateParticipantsButton = () => {
                const allMemberIds = Object.keys(groupData.members || {});
                const areAllSelected = allMemberIds.length === newBillState.participantIds.length && allMemberIds.every(id => newBillState.participantIds.includes(id));
                editParticipantsBtn.textContent = areAllSelected ? 'wszystkich' : `wybranych (${newBillState.participantIds.length})`;
            };

            document.getElementById('create-new-bill-btn').onclick = () => {
                if (!groupData) return;
                newBillState = { name: '', type: 'advanced', participantIds: Object.keys(groupData.members || {}) };
                nameInput.value = '';

                participantsChecklist.innerHTML = '';
                Object.values(groupData.members || {}).forEach(member => {
                    const label = document.createElement('label');
                    label.className = "tap flex items-center gap-2 p-2 min-h-tap rounded-lg cursor-pointer";
                    label.innerHTML = `<input type="checkbox" class="modal-participant-checkbox w-5 h-5 accent-ink" value="${escapeHtml(member.id)}" checked><span class="truncate">${escapeHtml(member.name)}</span>`;
                    participantsChecklist.appendChild(label);
                });
                
                participantsChecklist.onchange = (e) => {
                    if (e.target.classList.contains('modal-participant-checkbox')) {
                        newBillState.participantIds = Array.from(document.querySelectorAll('.modal-participant-checkbox:checked')).map(cb => cb.value);
                        updateParticipantsButton();
                    }
                };

                updateParticipantsButton();
                participantsChecklist.classList.add('hidden');
                checkCreateButtonState();
                modal.classList.add('active');
            };

            nameInput.addEventListener('input', (e) => {
                newBillState.name = e.target.value;
                checkCreateButtonState();
            });

            editParticipantsBtn.addEventListener('click', () => {
                participantsChecklist.classList.toggle('hidden');
            });

            cancelBtn.onclick = () => modal.classList.remove('active');

            createBtn.onclick = async () => {
                if (newBillState.participantIds.length === 0) {
                    showToast("Musisz wybrać przynajmniej jednego uczestnika.", true);
                    return;
                }
                
                const allMembersMap = groupData.members || {};
                const participantsMap = {};

                // Każdy rachunek powstaje w jednym kształcie i rośnie w miarę potrzeb.
                // Status 'incomplete' znaczy „nie rozpisano jeszcze wszystkiego", a nie
                // „rachunek zepsuty": kwota nierozpisana i tak dzieli się po równo.
                Object.values(allMembersMap).forEach(m => {
                    const isIncluded = newBillState.participantIds.includes(m.id);
                    participantsMap[m.id] = { id: m.id, name: m.name, individualAmount: 0, individualAmounts: [], calculatorActive: false, status: isIncluded ? 'incomplete' : 'not_applicable' };
                });

                const baseBill = {
                    billName: newBillState.name,
                    // Pole `type` zostaje w dokumencie dla zgodności ze starymi rachunkami
                    // w bazie, ale nie rozgałęzia już ani obliczeń, ani ekranów.
                    type: 'advanced',
                    createdAt: serverTimestamp(),
                    currency: 'PLN',
                    totalAmount: 0,
                    payerId: null,
                    payerConfirmed: false,
                    participants: participantsMap,
                    globalCosts: [],
                    sharedCosts: [],
                    photos: [],
                };

                const newBillRef = await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), baseBill);
                modal.classList.remove('active');
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
                        const conversionResult = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
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

