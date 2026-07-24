        // Importy Firebase (npm) + moduł obliczeń
        import { calculateAll, calculateAllForBill, calculateSimple, buildLedger, simplifyDebts, fromGrosze, toGrosze } from './calc.js';
        import { initializeApp } from "firebase/app";
        import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "firebase/auth";
        import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, serverTimestamp, deleteDoc, writeBatch, getDocs, runTransaction, increment } from "firebase/firestore";
        import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, connectStorageEmulator } from "firebase/storage";

        const firebaseConfig = {
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

        // --- DEV: podłączenie do Firebase Emulator Suite (pełna izolacja od produkcji) ---
        if (import.meta.env.DEV) {
            connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            connectFirestoreEmulator(db, '127.0.0.1', 8770);
            connectStorageEmulator(storage, '127.0.0.1', 9199);
            console.info('[BillSplitter] Tryb DEV — podłączono do emulatora Firebase (127.0.0.1). Żywe dane nietknięte.');
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
        
        const STORAGE_LIMIT_BYTES = 4.5 * 1024 * 1024 * 1024; // 4.5 GB

        // --- GŁÓWNA LOGIKA APLIKACJI ---
        function showToast(message, isError = false) {
            const toastId = 'toast-notification';
            let existingToast = document.getElementById(toastId);
            if (existingToast) existingToast.remove();
            const toast = document.createElement('div');
            toast.id = toastId;
            toast.textContent = message;
            toast.className = `fixed bottom-5 right-5 p-4 rounded-lg shadow-lg text-white z-50 transition-opacity duration-300 ${isError ? 'bg-red-600' : 'bg-blue-600'}`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 4000); 
            }, 4000);
        }

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
            document.getElementById('create-group-btn').disabled = false;
            document.getElementById('create-group-btn').innerHTML = `<i class="fas fa-users mr-2"></i>Stwórz grupę`;
            
            handleUrlChange();
        };

        const init = () => {
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
                const acc = copyBtn.dataset.account || '';
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(acc).then(() => showToast('Skopiowano!')).catch(() => showToast('Do skopiowania: ' + acc));
                } else {
                    showToast('Do skopiowania: ' + acc);
                }
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
                <h3 class="text-lg font-semibold text-gray-700 mb-3 text-left">Twoje pokoje</h3>
                <div class="space-y-2">
                    ${rooms.map(r => `
                        <div class="flex items-center gap-2">
                            <button class="enter-room-btn flex-grow flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-left" data-room-id="${r.id}">
                                <span class="font-semibold text-gray-800">${escapeHtml(r.name)}</span>
                                <i class="fas fa-arrow-right text-gray-400"></i>
                            </button>
                            <button class="forget-room-btn p-3 text-gray-400 hover:text-red-500" data-room-id="${r.id}" title="Usuń z listy (nie kasuje pokoju)"><i class="fas fa-times"></i></button>
                        </div>
                    `).join('')}
                </div>
                <div class="flex items-center my-6"><div class="flex-grow border-t border-gray-200"></div><span class="px-3 text-sm text-gray-400">lub stwórz nowy pokój</span><div class="flex-grow border-t border-gray-200"></div></div>
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
                        <li><b>Filtry</b>: Wszystkie / Nieopłacone / Opłacone / Ukryte.</li>
                        <li><b>Kolor profilu</b> i <b>sposoby płatności</b> (konto, telefon, Revolut, PayPal, własne) — znajomi zobaczą je przy Twoich należnościach.</li>
                        <li><b>Podsumowanie</b> pokazuje Twoje udziały i sumę całej grupy.</li>
                    </ul>`
            },
            'simple-bill': {
                title: 'Rachunek prosty',
                html: `<ul class="list-disc pl-5 space-y-1">
                        <li>Cała kwota dzieli się po równo między uczestników.</li>
                        <li>Wpisz kwotę i wybierz, kto zapłacił.</li>
                        <li>Płatnik potwierdza płatność — to blokuje zmianę płatnika.</li>
                        <li>Grosze zaokrąglane w górę, żeby płatnik nigdy nie był stratny.</li>
                        <li>Płatnik może usunąć rachunek — masz kilka sekund na „Cofnij".</li>
                    </ul>`
            },
            'bill': {
                title: 'Rachunek zaawansowany',
                html: `<p>Dla rachunków z różnymi pozycjami (np. restauracja):</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li><b>Koszty dzielone</b> — wspólne pozycje, dzielone po równo między uczestników.</li>
                        <li><b>Koszty ogólne</b> — np. napiwek/serwis, doliczane do całości i dzielone.</li>
                        <li><b>Koszty indywidualne</b> — każdy wpisuje to, co zamówił dla siebie.</li>
                        <li><b>Suma kontrolna</b> sprawdza, czy pozycje zgadzają się z kwotą rachunku (✓ / za dużo / za mało).</li>
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

        const showScreen = (screenName) => {
            ['loading', 'start', 'join', 'group-dashboard', 'bill', 'simple-bill'].forEach(s => {
                const screenEl = document.getElementById(`${s}-screen`);
                if (screenEl) screenEl.classList.add('hidden');
            });
            const targetScreen = document.getElementById(`${screenName}-screen`);
            if (targetScreen) targetScreen.classList.remove('hidden');
            currentScreenName = screenName;
            // Kontekstowy przycisk pomocy „?" — widoczny tylko na ekranach z treścią.
            const fab = document.getElementById('help-fab');
            if (fab) fab.classList.toggle('hidden', !HELP_CONTENT[screenName]);
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
                button.innerHTML = `<span class="flex items-center justify-center">${avatarHtml(m.name, m.id)}<span>${m.name}</span></span>`;
                button.className = "w-full p-3 rounded-lg transition";
                if (m.claimedBy) {
                    button.className += " bg-gray-300 text-gray-500 cursor-pointer hover:bg-gray-400";
                    button.onclick = () => {
                        memberIdToTakeover = m.id;
                        document.getElementById('takeover-name-modal').classList.add('active');
                    };
                } else {
                    button.className += " bg-blue-500 text-white hover:bg-blue-600";
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
        let currentBillFilter = 'all';

        const renderGroupDashboard = () => {
            if (unsubscribeGroup) unsubscribeGroup();
            if (unsubscribeSettlements) unsubscribeSettlements();

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
            
            onSnapshot(groupDocRef, (docSnap) => {
                if (!docSnap.exists()) return;
                groupData = docSnap.data();
                const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                document.getElementById('dashboard-group-name').textContent = groupData.groupName;
                const userNameEl = document.getElementById('dashboard-user-name');
                userNameEl.textContent = myMember ? myMember.name : '...';
                userNameEl.onclick = async () => {
                    if (!myMember) return;
                    await updateDoc(groupDocRef, {
                        [`members.${myMember.id}.claimedBy`]: null
                    });
                    handleGroupJoin(currentGroupId);
                };

                document.getElementById('group-share-link').value = window.location.origin + window.location.pathname + `?group=${currentGroupId}`;
                
                const usageInGB = ((groupData.totalStorageUsed || 0) / (1024 * 1024 * 1024)).toFixed(2);
                document.getElementById('storage-usage').textContent = `${usageInGB} GB / 5.00 GB`;

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
                        picker.innerHTML = PROFILE_COLORS.map(c =>
                            `<button class="profile-color-swatch w-6 h-6 rounded-full border-2 ${c === current ? 'border-gray-800 scale-110' : 'border-transparent'} transition" style="background-color:${c}" data-color="${c}" title="Ustaw kolor profilu"></button>`
                        ).join('');
                        picker.querySelectorAll('.profile-color-swatch').forEach(sw => {
                            sw.onclick = async () => {
                                await updateDoc(groupDocRef, { [`members.${myMember.id}.color`]: sw.dataset.color });
                                showToast('Zmieniono kolor profilu.');
                            };
                        });
                    }
                }
                // Numery kont / metody / imiona mogły się zmienić — odśwież listę i rozliczenia.
                renderBillsList();
                renderSettlements();
            });

            const billsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), orderBy('createdAt', 'desc'));
            unsubscribeGroup = onSnapshot(billsQuery, (snapshot) => {
                latestBills = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
                renderBillsList();
                renderSettlements();
            });

            const settlementsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), orderBy('createdAt', 'desc'));
            unsubscribeSettlements = onSnapshot(settlementsQuery, (snapshot) => {
                latestSettlements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderSettlements();
            });

            document.getElementById('copy-group-link-btn').onclick = () => {
                document.getElementById('group-share-link').select();
                document.execCommand('copy');
                showToast('Link do grupy skopiowany!');
            };
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
                return `<p class="text-sm text-gray-600 font-semibold flex items-center"><i class="fas fa-ban mr-2"></i>Ten rachunek Cię nie dotyczy</p>`;
            }
            
            if (!bill.payerId) {
                return `<p class="text-sm text-gray-500 font-semibold"><i class="fas fa-user-tag mr-2"></i>Wybierz osobę płacącą</p>`;
            }
            if (bill.payerId && !bill.payerConfirmed) {
                const payerName = bill.participants[bill.payerId]?.name || 'Płatnik';
                const text = myMember.id === bill.payerId ? "Potwierdź, że zapłaciłeś/aś" : `Oczekiwanie na potwierdzenie od ${payerName}`;
                return `<p class="text-sm text-yellow-600 font-semibold"><i class="fas fa-hourglass-half mr-2"></i>${text}</p>`;
            }
            if (!bill.totalAmount || bill.totalAmount <= 0) {
                return `<p class="text-sm text-gray-500 font-semibold"><i class="fas fa-calculator mr-2"></i>Uzupełnij kwotę rachunku</p>`;
            }

            if (bill.type === 'advanced' && myParticipant.status === 'incomplete') {
                return `<p class="text-sm text-orange-500 font-semibold"><i class="fas fa-question-circle mr-2"></i>Uzupełnij swoje koszty</p>`;
            }

            const calculations = calculateAllForBill(bill);
            const myCalc = calculations.participantTotals.find(pt => pt.participant.id === myMember.id);
            const myTotal = myCalc ? myCalc.total : 0;
            const payer = bill.participants[bill.payerId];

            if (payer && payer.id === myParticipant.id) {
                const amountToReceive = calculations.controlSum - myTotal;
                if (amountToReceive > 0.01) {
                    return `<p class="text-sm text-green-600 font-semibold"><i class="fas fa-hand-holding-usd mr-2"></i>Otrzymasz: ${amountToReceive.toFixed(2)} ${bill.currency}</p>`;
                } else {
                    return `<p class="text-sm text-gray-500"><i class="fas fa-check-circle mr-2"></i>Wszystko uregulowane</p>`;
                }
            }
            
            if (payer) {
                if (myParticipant.status === 'paid') {
                    return `<p class="text-sm text-green-600 font-semibold"><i class="fas fa-check-circle mr-2"></i>Przelałeś: ${myTotal.toFixed(2)} ${bill.currency} do ${payer.name}</p>`;
                }
                if (myTotal > 0.01) {
                    return `<p class="text-sm text-red-600 font-semibold"><i class="fas fa-exclamation-circle mr-2"></i>Do zapłaty: ${myTotal.toFixed(2)} ${bill.currency} dla ${payer.name}</p>`;
                }
            }

            return `<p class="text-sm text-gray-500"><i class="fas fa-check-circle mr-2"></i>Wszystko uregulowane</p>`;
        };

        // --- Faza 4: personalizacja profilu (kolor + awatar z inicjałem) ---
        const PROFILE_COLORS = ['#ef4444','#f97316','#f59e0b','#eab308','#22c55e','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#d946ef','#ec4899'];
        const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return Math.abs(h); };
        const colorForMember = (memberId, name) => {
            const explicit = ((groupData && groupData.members && groupData.members[memberId]) || {}).color;
            if (explicit) return explicit;
            return PROFILE_COLORS[hashStr(memberId || name || '?') % PROFILE_COLORS.length];
        };
        const avatarHtml = (name, memberId, extraClass = '') => {
            const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
            return `<div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-lg mr-3 flex-shrink-0 ${extraClass}" style="background-color:${colorForMember(memberId, name)}">${initial}</div>`;
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
        // Zwięzła lista metod odbiorcy z przyciskami kopiuj (przy „Należność dla X"). Pełne „Ureguluj" → Faza 5.
        const getPaymentMethodsHtml = (payerId) => {
            const methods = getPaymentMethods((groupData && groupData.members && groupData.members[payerId]) || null);
            if (methods.length === 0) return '';
            return `<div class="mt-1 space-y-0.5">` + methods.map(m =>
                `<span class="flex items-center text-xs text-gray-500"><i class="${paymentIconClass(m.type)} mr-1 w-3.5 text-center"></i><span class="font-medium mr-1">${escapeHtml(paymentLabel(m))}:</span>${escapeHtml(m.value)} <button class="copy-account-btn text-blue-600 hover:underline ml-1" data-account="${escapeHtml(m.value)}">kopiuj</button></span>`
            ).join('') + `</div>`;
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
                list.innerHTML = `<p class="text-sm text-gray-400 italic">Brak metod. Dodaj pierwszą poniżej.</p>`;
                return;
            }
            list.innerHTML = paymentEditMethods.map((m, i) => `
                <div class="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
                    <i class="${paymentIconClass(m.type)} text-gray-400 w-4 text-center"></i>
                    <div class="flex-grow min-w-0">
                        <p class="text-xs text-gray-500">${escapeHtml(paymentLabel(m))}</p>
                        <input class="pm-value-edit w-full text-sm p-1 border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none" value="${escapeHtml(m.value)}" data-index="${i}" placeholder="wartość">
                    </div>
                    <button class="pm-remove-btn text-gray-400 hover:text-red-500 px-1" data-index="${i}" title="Usuń"><i class="fas fa-trash"></i></button>
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

        const settleRowHtml = (name, id, rightHtml, detailHtml = '') =>
            `<div class="p-2 bg-white rounded-lg border border-gray-200">
                <div class="flex items-center justify-between gap-2">
                    <span class="flex items-center min-w-0">${avatarHtml(name, id)}<span class="truncate font-medium">${escapeHtml(name)}</span></span>
                    <span class="flex items-center gap-2 flex-shrink-0">${rightHtml}</span>
                </div>
                ${detailHtml}
            </div>`;

        // Rozkład długu netto na rachunki (do „z detalem"): wkłady w stronę from→to (+) i offset to→from (−).
        const debtDetailHtml = (directed, from, to, cur) => {
            const fwd = ((directed.find(d => d.from === from && d.to === to) || {}).contributions) || [];
            const rev = ((directed.find(d => d.from === to && d.to === from) || {}).contributions) || [];
            if (fwd.length === 0 && rev.length === 0) return '';
            const line = (c, neg) =>
                `<div class="flex justify-between gap-2 text-xs py-0.5"><span class="truncate text-gray-500">${escapeHtml(c.billName || 'Rachunek')}</span><span class="flex-shrink-0 ${neg ? 'text-green-600' : 'text-gray-500'}">${neg ? '−' : ''}${fmtMoney(c.amountG, cur)}</span></div>`;
            return `<details class="mt-1.5"><summary class="text-xs text-blue-600 cursor-pointer select-none">szczegóły</summary>
                <div class="mt-1 pl-2 border-l-2 border-gray-100">${fwd.map(c => line(c, false)).join('')}${rev.map(c => line(c, true)).join('')}</div></details>`;
        };

        const renderSettlements = () => {
            const container = document.getElementById('settlements-list');
            if (!container || !groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            const myId = myMember ? myMember.id : null;

            document.querySelectorAll('.settle-mode-btn').forEach(btn => {
                const active = btn.dataset.mode === settlementMode;
                btn.className = `settle-mode-btn px-3 py-1 rounded-full text-sm font-semibold ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`;
            });

            const bills = latestBills.map(({ id, data }) => ({ ...data, id }));
            const ledger = buildLedger(bills, latestSettlements);
            const currencies = Object.keys(ledger).sort((a, b) => {
                const ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
            });

            const nothing = `<p class="text-gray-500 text-sm"><i class="fas fa-check-circle mr-2 text-green-600"></i>Brak długów — wszystko rozliczone.</p>`;
            if (currencies.length === 0) { container.innerHTML = nothing; return; }

            let html = '';
            currencies.forEach(cur => {
                const transfers = settlementMode === 'min' ? simplifyDebts(ledger[cur].directed) : ledger[cur].net;
                if (transfers.length === 0) return;
                const mineOwe = transfers.filter(t => t.from === myId);
                const mineGet = transfers.filter(t => t.to === myId);
                const others = transfers.filter(t => t.from !== myId && t.to !== myId);
                // Detal (które rachunki) tylko w trybie netto — „min" to zoptymalizowane przelewy bez mapowania 1:1 na rachunki.
                const detailOf = (t) => settlementMode === 'net' ? debtDetailHtml(ledger[cur].directed, t.from, t.to, cur) : '';

                html += `<div>`;
                if (currencies.length > 1) html += `<p class="text-xs font-bold text-gray-400 uppercase mb-2">${cur}</p>`;

                if (mineOwe.length) {
                    html += `<p class="text-sm font-semibold text-red-600 mb-1">Płacisz:</p><div class="space-y-1.5 mb-3">`;
                    mineOwe.forEach(t => {
                        html += settleRowHtml(memberName(t.to), t.to,
                            `<span class="font-bold text-red-600">${fmtMoney(t.amountG, cur)}</span>
                             <button class="settle-btn bg-green-600 text-white text-sm font-semibold px-3 py-1 rounded-lg hover:bg-green-700" data-to="${t.to}" data-amount-g="${t.amountG}" data-currency="${cur}">Ureguluj</button>`,
                            detailOf(t));
                    });
                    html += `</div>`;
                }
                if (mineGet.length) {
                    html += `<p class="text-sm font-semibold text-green-600 mb-1">Dostajesz:</p><div class="space-y-1.5 mb-3">`;
                    mineGet.forEach(t => {
                        html += settleRowHtml(memberName(t.from), t.from, `<span class="font-bold text-green-600">${fmtMoney(t.amountG, cur)}</span>`, detailOf(t));
                    });
                    html += `</div>`;
                }
                if (others.length) {
                    html += `<p class="text-sm font-semibold text-gray-500 mb-1">Pozostałe w grupie:</p><div class="space-y-1.5">`;
                    others.forEach(t => {
                        const rightHtml = `<span class="font-semibold text-gray-600">${fmtMoney(t.amountG, cur)}</span>`;
                        const nameHtml = `<span class="flex items-center min-w-0 text-sm text-gray-600"><span class="truncate">${escapeHtml(memberName(t.from))}</span><i class="fas fa-arrow-right mx-2 text-gray-400"></i><span class="truncate">${escapeHtml(memberName(t.to))}</span></span>`;
                        html += `<div class="p-2 bg-white rounded-lg border border-gray-200">
                            <div class="flex items-center justify-between gap-2">${nameHtml}${rightHtml}</div>
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
                historyHtml = `<details class="mt-3"><summary class="text-sm text-blue-600 cursor-pointer select-none">Historia wpłat (${latestSettlements.length})</summary><div class="mt-2 space-y-1">`
                    + latestSettlements.map(s => {
                        const canDelete = s.createdBy === currentUser.uid;
                        const when = (s.createdAt && s.createdAt.toDate) ? s.createdAt.toDate().toLocaleDateString('pl-PL') : '';
                        return `<div class="flex items-center justify-between gap-2 text-sm p-2 bg-gray-50 rounded">
                            <span class="min-w-0 truncate"><b>${escapeHtml(memberName(s.from))}</b> → ${escapeHtml(memberName(s.to))} · ${fmtMoney(toGrosze(s.amount || 0), s.currency || 'PLN')}${when ? ` · <span class="text-gray-400">${when}</span>` : ''}</span>
                            ${canDelete ? `<button class="settle-delete-btn text-gray-400 hover:text-red-500 flex-shrink-0" data-id="${s.id}" title="Usuń wpłatę"><i class="fas fa-trash"></i></button>` : ''}
                        </div>`;
                    }).join('')
                    + `</div></details>`;
            }
            container.innerHTML = (html || nothing) + historyHtml;
        };

        const openSettleModal = (creditorId, amountG, currency) => {
            settleContext = { to: creditorId, currency };
            document.getElementById('settle-name').textContent = memberName(creditorId);
            const amountStr = fromGrosze(Number(amountG) || 0).toFixed(2);
            const input = document.getElementById('settle-amount-input');
            input.value = amountStr.replace('.', ',');
            document.getElementById('settle-currency').textContent = currency;
            document.getElementById('settle-copy-amount').dataset.account = amountStr;
            const methods = getPaymentMethods((groupData && groupData.members && groupData.members[creditorId]) || null);
            document.getElementById('settle-methods').innerHTML = methods.length === 0
                ? `<p class="text-sm text-gray-400 italic">Odbiorca nie zapisał metod płatności.</p>`
                : methods.map(m => `
                    <div class="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
                        <i class="${paymentIconClass(m.type)} text-gray-400 w-4 text-center"></i>
                        <div class="flex-grow min-w-0">
                            <p class="text-xs text-gray-500">${escapeHtml(paymentLabel(m))}</p>
                            <p class="text-sm break-all">${escapeHtml(m.value)}</p>
                        </div>
                        <button class="copy-account-btn text-blue-600 hover:underline text-sm flex-shrink-0" data-account="${escapeHtml(m.value)}">kopiuj</button>
                    </div>`).join('');
            document.getElementById('settle-modal').classList.add('active');
        };

        // --- Faza 3: stan rachunku dla filtrów, linia z numerem konta, render z filtrem/ukrywaniem ---
        const getBillUserState = (bill, myMember) => {
            const myP = bill.participants ? bill.participants[myMember.id] : null;
            if (!myP || myP.status === 'not_applicable' || (bill.hiddenBy || []).includes(myMember.id)) return 'hidden';
            if (bill.payerId === myMember.id) {
                const debtors = Object.values(bill.participants || {}).filter(p => p.id !== myMember.id && p.status !== 'not_applicable');
                return debtors.every(p => p.status === 'paid') ? 'paid' : 'unpaid';
            }
            if (myP.status === 'paid') return 'paid';
            const myCalc = calculateAllForBill(bill).participantTotals.find(pt => pt.participant.id === myMember.id);
            return (!myCalc || myCalc.total <= 0.01) ? 'paid' : 'unpaid';
        };

        const renderBillsList = () => {
            const billsList = document.getElementById('bills-history-list');
            if (!billsList || !groupData) return;
            const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
            if (!myMember) return;

            document.querySelectorAll('.bill-filter-btn').forEach(btn => {
                const active = btn.dataset.filter === currentBillFilter;
                btn.className = `bill-filter-btn px-3 py-1 rounded-full text-sm font-semibold ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`;
            });

            const visible = latestBills.filter(({ data }) => {
                const state = getBillUserState(data, myMember);
                return currentBillFilter === 'all' ? state !== 'hidden' : state === currentBillFilter;
            });

            billsList.innerHTML = '';
            if (visible.length === 0) {
                billsList.innerHTML = latestBills.length === 0
                    ? '<p class="text-gray-500">Brak rachunków. Dodaj pierwszy!</p>'
                    : '<p class="text-gray-500">Brak rachunków w tym widoku.</p>';
                return;
            }

            visible.forEach(({ id, data: bill }) => {
                const myParticipant = bill.participants ? bill.participants[myMember.id] : null;
                const isHidden = (bill.hiddenBy || []).includes(myMember.id);
                const canToggleHide = myParticipant && myParticipant.status !== 'not_applicable';
                const summaryHtml = getBillSummaryHtml(bill, myMember, myParticipant);
                const hideBtn = canToggleHide
                    ? `<button class="hide-bill-btn text-gray-400 hover:text-gray-700 p-2" title="${isHidden ? 'Przywróć' : 'Ukryj'}"><i class="fas ${isHidden ? 'fa-eye' : 'fa-eye-slash'}"></i></button>`
                    : '';

                const billEl = document.createElement('div');
                billEl.className = "bg-gray-100 p-4 rounded-lg flex flex-col sm:flex-row justify-between sm:items-center cursor-pointer hover:bg-gray-200";
                billEl.innerHTML = `
                    <div class="w-full">
                        <p class="font-semibold text-lg flex items-center">${bill.billName}</p>
                        <p class="text-xs text-gray-500">Utworzono: ${new Date(bill.createdAt?.toDate()).toLocaleString('pl-PL')}</p>
                        <div class="mt-2">${summaryHtml}</div>
                    </div>
                    <div class="flex items-center self-end sm:self-center mt-2 sm:mt-0">
                        ${hideBtn}
                        <i class="fas fa-chevron-right text-gray-400 ml-1"></i>
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
                    billData.photos = billData.photos || [];
                    if (billData.type === 'simple') {
                        withFocusPreserved(renderSimpleBillScreen);
                        showScreen('simple-bill');
                    } else {
                        withFocusPreserved(renderBillScreen);
                        showScreen('bill');
                    }
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

        const getStatusHtml = (status, isMe, isPayer, participantId = null, billType = 'advanced', isCurrentUserThePayer = false) => {
            const statuses = {
                incomplete: { text: "Nieuzupełnione", icon: "fa-question-circle", color: "text-orange-500", bg: "bg-orange-100" },
                completed: { text: "Uzupełnione", icon: "fa-user-check", color: "text-blue-600", bg: "bg-blue-100" },
                not_applicable: { text: "Nie dotyczy", icon: "fa-ban", color: "text-gray-600", bg: "bg-gray-200" },
                unpaid: { text: "Nieopłacone", icon: "fa-exclamation-circle", color: "text-red-600", bg: "bg-red-100" },
                paid: { text: "Opłacone", icon: "fa-check-circle", color: "text-green-500", bg: "bg-green-100" }
            };
            const current = statuses[status] || statuses.unpaid;
            const isPayerConfirmed = billData.payerConfirmed === true;

            if (isPayer) {
                 if (billType === 'simple') {
                    if(isPayerConfirmed) {
                       return `<span class="font-semibold text-gray-600 flex items-center"><i class="fas fa-user-check text-green-500 mr-2"></i>Płatnik (potwierdzony)</span>`;
                    }
                    return `<span class="font-semibold text-gray-600 flex items-center"><i class="fas fa-user-tag mr-2"></i>Płatnik</span>`;
                 }
                 if(isPayerConfirmed) {
                    return `<span class="font-semibold text-green-500 flex items-center"><i class="fas fa-user-check mr-2"></i>Płatnik (potwierdzony)</span>`;
                 }
                 return `<span class="font-semibold ${current.color} flex items-center"><i class="fas ${current.icon} mr-2"></i>${current.text}</span>`;
            }

            if (isMe) {
                const selectClass = billType === 'simple' ? 'simple-status-select' : 'status-select';
                
                let options = '';
                if (billType === 'simple') {
                    options = `
                        <option value="not_applicable" ${status === 'not_applicable' ? 'selected' : ''}>Mnie nie dotyczy</option>
                        <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Nieopłacone</option>
                        <option value="paid" ${status === 'paid' ? 'selected' : ''}>Opłacone</option>
                    `;
                } else { 
                     options = `
                        <option value="incomplete" ${status === 'incomplete' ? 'selected' : ''}>Nieuzupełnione</option>
                        <option value="not_applicable" ${status === 'not_applicable' ? 'selected' : ''}>Mnie nie dotyczy</option>
                        <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Nieopłacone</option>
                        <option value="paid" ${status === 'paid' ? 'selected' : ''}>Opłacone</option>
                    `;
                }
               
                return `
                    <div class="status-select-wrapper ${current.bg}">
                        <i class="fas ${current.icon} ${current.color} mr-2"></i>
                        <select class="${selectClass} font-semibold ${current.color}" data-participant-id="${participantId}">
                            ${options}
                        </select>
                    </div>
                `;
            }

            if (isCurrentUserThePayer && isPayerConfirmed && (status === 'unpaid' || status === 'paid')) {
                return `
                    <div class="status-select-wrapper ${current.bg}">
                        <i class="fas ${current.icon} ${current.color} mr-2"></i>
                        <select class="payer-status-select font-semibold ${current.color}" data-participant-id="${participantId}">
                            <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Nieopłacone</option>
                            <option value="paid" ${status === 'paid' ? 'selected' : ''}>Opłacone</option>
                        </select>
                    </div>
                `;
            }

            return `<span class="font-semibold ${current.color} flex items-center"><i class="fas ${current.icon} mr-2"></i>${current.text}</span>`;
        };

        // --- Faza 2: zamrożenie kwoty po zapłacie + ślad kto/kiedy zmienił status ---
        const getParticipantTotal = (bill, pid) => {
            const found = calculateAllForBill(bill).participantTotals.find(x => x.participant.id === pid);
            return found ? found.total : 0;
        };

        const buildStatusUpdate = (bill, participantId, newStatus, changedByName) => {
            const base = `participants.${participantId}`;
            const updates = { [`${base}.status`]: newStatus };
            // Zamrożenie kwoty w chwili "opłacone" — późniejsza zmiana rachunku ujawni się jako różnica.
            updates[`${base}.paidAmount`] = newStatus === 'paid' ? getParticipantTotal(bill, participantId) : null;
            if (newStatus === 'paid' || newStatus === 'unpaid') {
                updates[`${base}.statusChangedBy`] = changedByName || null;
                updates[`${base}.statusChangedAt`] = Date.now();
            } else {
                updates[`${base}.statusChangedBy`] = null;
                updates[`${base}.statusChangedAt`] = null;
            }
            return updates;
        };

        const getPaidDeltaHtml = (p, currentTotal, currency) => {
            if (p.status !== 'paid' || typeof p.paidAmount !== 'number') return '';
            const diff = currentTotal - p.paidAmount;
            if (diff > 0.01) {
                return `<p class="text-sm text-orange-600 font-semibold"><i class="fas fa-exclamation-triangle mr-1"></i>Kwota wzrosła po zapłacie — dopłać ${diff.toFixed(2)} ${currency}</p>`;
            }
            if (diff < -0.01) {
                return `<p class="text-sm text-blue-600 font-semibold"><i class="fas fa-undo mr-1"></i>Nadpłata — do zwrotu ${(-diff).toFixed(2)} ${currency}</p>`;
            }
            return '';
        };

        const getStatusAuditHtml = (p) => {
            if (!p.statusChangedBy) return '';
            const when = typeof p.statusChangedAt === 'number' ? ` (${new Date(p.statusChangedAt).toLocaleString('pl-PL')})` : '';
            return `<p class="text-xs text-gray-400">Status zmieniony przez ${p.statusChangedBy}${when}</p>`;
        };
        
        // ===================================================
        // ===== EKRAN RACHUNKU ZAAWANSOWANEGO (bill-screen) =====
        // ===================================================
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
            payerSelect.innerHTML = '<option value="">Nikt</option>';
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
                    <div class="p-4 mb-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 flex justify-between items-center">
                        <span><i class="fas fa-exclamation-triangle mr-2"></i>Jesteś wybrany/a jako płatnik. Potwierdź, aby zablokować wybór płatnika.</span>
                        <button id="confirm-payer-btn" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Potwierdzam</button>
                    </div>`;
                document.getElementById('confirm-payer-btn').onclick = async () => {
                     await updateDoc(doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId), { payerConfirmed: true });
                };
            } else if (isPayerConfirmed) {
                const payerName = billData.participants[billData.payerId]?.name || '...';
                const bannerText = isCurrentUserThePayer 
                    ? `Jako płatnik, wciąż możesz edytować kwotę rachunku.`
                    : `Główne pola rachunku zostały zablokowane przez <strong>${payerName}</strong>.`;
                confirmationBanner.innerHTML = `
                    <div class="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50">
                        <span><i class="fas fa-lock mr-2"></i>${bannerText}</span>
                    </div>`;
            } else {
                confirmationBanner.innerHTML = '';
            }

            const calculations = calculateAll(billData);
            
            const controlSumEl = document.getElementById('control-sum');
            const controlStatusEl = document.getElementById('control-status');
            const control = calculations.control;
            controlSumEl.textContent = `${control.enteredSubtotal.toFixed(2)} ${billData.currency}`;
            controlSumEl.className = "mt-1 text-2xl font-bold ";
            if (controlStatusEl) controlStatusEl.className = "text-sm font-semibold h-5 ";

            if (control.status === 'ok') {
                controlSumEl.classList.add('control-sum-ok');
                if (controlStatusEl) { controlStatusEl.classList.add('control-sum-ok'); controlStatusEl.textContent = '✓ zgadza się z kwotą rachunku'; }
            } else if (control.status === 'over') {
                controlSumEl.classList.add('control-sum-bad');
                if (controlStatusEl) { controlStatusEl.classList.add('control-sum-bad'); controlStatusEl.textContent = `⚠ Nadwyżka ${control.diff.toFixed(2)} ${billData.currency} — ktoś przeliczył lub podwójna pozycja`; }
            } else if (control.status === 'under') {
                controlSumEl.classList.add('control-sum-bad');
                if (controlStatusEl) { controlStatusEl.classList.add('control-sum-bad'); controlStatusEl.textContent = `⚠ Brakuje ${control.diff.toFixed(2)} ${billData.currency} — ktoś nie wpisał pozycji`; }
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

            document.getElementById('my-participant-card').innerHTML = '';
            document.getElementById('participants-list').innerHTML = '';

            const payer = billData.participants[billData.payerId];

            const sortedParticipants = [...calculations.participantTotals].sort((a, b) => {
                if (a.participant.id === myGroupMember.id) return -1;
                if (b.participant.id === myGroupMember.id) return 1;
                return a.participant.name.localeCompare(b.participant.name);
            });

            sortedParticipants.forEach(pt => {
                const p = pt.participant;
                const isMe = p.id === myGroupMember.id;
                const isPayer = p.id === billData.payerId;
                const isDisabled = p.status === 'not_applicable';

                let paymentInfo = '';
                if (payer && isPayerConfirmed) {
                    if (isPayer) {
                        if (p.status === 'completed' || p.status === 'incomplete') {
                            const amountToReceive = calculations.controlSum - pt.total;
                            if (amountToReceive > 0.01) {
                                paymentInfo = `<p class="text-sm text-green-600 font-semibold">Otrzymasz: ${amountToReceive.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(amountToReceive, billData.currency, billData.exchangeRatePLN)}</p>`;
                            }
                        }
                    } else if (pt.total > 0) {
                         if (p.status !== 'paid') {
                            paymentInfo = `<p class="text-sm text-red-600 font-semibold">Należność dla ${payer.name}: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency, billData.exchangeRatePLN)}</p>${getPaymentMethodsHtml(billData.payerId)}`;
                        }
                    }
                }
                paymentInfo += getPaidDeltaHtml(p, pt.total, billData.currency);
                paymentInfo += getStatusAuditHtml(p);

                const statusDisplayHtml = getStatusHtml(p.status, isMe, isPayer, p.id, 'advanced', isCurrentUserThePayer);

                let participantHTML;
                if (isMe) {
                    const isCalculatorActive = p.calculatorActive === true;
                    
                    const yourSumContainerHTML = `
                        <div id="your-sum-container-${p.id}" class="flex items-center justify-end w-full space-x-2 ${isCalculatorActive ? 'hidden' : ''}">
                            <button class="calculator-toggle-btn text-blue-600 bg-gray-200 hover:bg-gray-300 transition p-2 rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0" ${isDisabled ? 'disabled' : ''}>
                                <i class="fas fa-calculator"></i>
                            </button>
                            <label for="your-sum-input-${p.id}" class="text-gray-600 whitespace-nowrap">Koszt:</label>
                            <input type="text" inputmode="decimal" id="your-sum-input-${p.id}"
                                class="flex-grow w-full text-right font-semibold p-1 border-b-2 rounded-none bg-transparent border-gray-400 focus:border-blue-500 outline-none"
                                value="${p.individualAmount > 0 ? p.individualAmount.toFixed(2).replace('.',',') : ''}"
                                placeholder="0,00"
                                ${isDisabled ? 'disabled' : ''}>
                            <span class="font-semibold">${billData.currency}</span>
                        </div>
                    `;

                    const calculatorTotalContainerHTML = `
                        <div id="calculator-total-container-${p.id}" class="flex items-center justify-end w-full space-x-2 ${isCalculatorActive ? '' : 'hidden'}">
                             <button class="calculator-toggle-btn text-blue-600 bg-blue-100 hover:bg-blue-200 transition p-2 rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0 active" ${isDisabled ? 'disabled' : ''}>
                                <i class="fas fa-compress"></i>
                            </button>
                            <label class="text-gray-600 whitespace-nowrap">Koszt:</label>
                            <input type="text"
                                class="flex-grow w-full text-right font-semibold p-1 bg-transparent text-gray-700 cursor-default border-none outline-none"
                                value="${p.individualAmount > 0 ? p.individualAmount.toFixed(2).replace('.',',') : '00,00'}"
                                disabled>
                            <span class="font-semibold">${billData.currency}</span>
                        </div>
                    `;

                    participantHTML = `
                    <div class="p-4 rounded-lg bg-blue-50 border-2 border-blue-200" data-participant-id="${p.id}">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center">
                            <div class="flex items-center">
                                ${avatarHtml(p.name, p.id)}
                                <div class="flex flex-col">
                                    <div class="flex items-center">
                                        <span class="text-xl font-semibold">${p.name}</span>
                                    </div>
                                    ${statusDisplayHtml}
                                </div>
                            </div>
                            <div class="mt-4 md:mt-0 w-full md:w-auto">
                                <div class="flex flex-col items-end">
                                    ${yourSumContainerHTML}
                                    ${calculatorTotalContainerHTML}
                                    <div id="calculator-inputs-container-${p.id}" class="flex flex-col items-end space-y-2 mt-2 w-full ${isCalculatorActive ? '' : 'hidden'}">
                                        ${(p.individualAmounts && p.individualAmounts.length > 0) ? p.individualAmounts.map((amount, index) => `
                                            <div class="flex items-center w-full justify-end">
                                                 <input type="text" inputmode="decimal" class="individual-amount-component w-32 text-right font-semibold p-1 border-b-2 rounded-none bg-transparent border-gray-400 focus:border-blue-500 outline-none" value="${amount > 0 ? String(amount.toFixed(2)).replace('.',',') : ''}" placeholder="0,00" data-index="${index}" id="individual-amount-component-${p.id}-${index}" ${isDisabled ? 'disabled' : ''}>
                                                 <span class="ml-2 mr-2 font-semibold text-gray-400">${billData.currency}</span>
                                                 <div class="w-7 h-7 flex items-center justify-center">
                                                 ${index === p.individualAmounts.length - 1 ? `
                                                    <button class="add-amount-btn p-1 bg-gray-200 rounded-full w-7 h-7 flex items-center justify-center hover:bg-gray-300 transition" ${isDisabled ? 'disabled' : ''}>
                                                        <i class="fas fa-plus text-sm"></i>
                                                    </button>
                                                 ` : ''}
                                                 </div>
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="mt-3 pl-10 text-sm text-gray-600">
                            <p>Koszty dzielone: <span class="font-medium">${pt.sharedAmount.toFixed(2)} ${billData.currency}</span></p>
                            <p>Koszty ogólne: <span class="font-medium">${pt.globalCostsAmount.toFixed(2)} ${billData.currency}</span></p>
                            <div class="mt-2 pt-2 border-t">
                                <p class="text-base font-bold">ŁĄCZNIE: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency, billData.exchangeRatePLN)}</p>
                                ${paymentInfo}
                            </div>
                        </div>
                    </div>`;
                } else { // Other participants view
                    participantHTML = `
                    <div class="p-4 rounded-lg bg-gray-50 border border-gray-200">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center">
                            <div class="flex items-center">
                                ${avatarHtml(p.name, p.id)}
                                <div class="flex flex-col">
                                    <div class="flex items-center">
                                        <span class="text-xl font-semibold">${p.name}</span>
                                    </div>
                                    ${statusDisplayHtml}
                                </div>
                            </div>
                        </div>
                         <div class="mt-3 pl-10 text-sm text-gray-600">
                            <p>Koszty indywidualne: <span class="font-medium">${pt.individualAmount.toFixed(2)} ${billData.currency}</span></p>
                            <p>Koszty dzielone: <span class="font-medium">${pt.sharedAmount.toFixed(2)} ${billData.currency}</span></p>
                            <p>Koszty ogólne: <span class="font-medium">${pt.globalCostsAmount.toFixed(2)} ${billData.currency}</span></p>
                            <div class="mt-2 pt-2 border-t">
                                <p class="text-base font-bold">ŁĄCZNIE: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency, billData.exchangeRatePLN)}</p>
                                ${paymentInfo}
                            </div>
                        </div>
                    </div>`;
                }
                
                if (isMe) {
                    document.getElementById('my-participant-card').innerHTML = participantHTML;
                } else {
                    document.getElementById('participants-list').innerHTML += participantHTML;
                }
            });
            
            document.getElementById('shared-costs-list').innerHTML = (billData.sharedCosts || []).map(sc => {
                const sharedByNames = sc.sharedBy.map(pid => billData.participants[pid]?.name || '...').join(', ');
                return `
                    <div class="bg-yellow-100 p-3 rounded-lg flex justify-between items-center">
                        <div>
                            <p class="font-semibold">${sc.description}: ${sc.amount.toFixed(2)} ${billData.currency}</p>
                            <p class="text-xs text-gray-500">Dzielone przez: ${sharedByNames}</p>
                        </div>
                        <button class="remove-shared-cost-btn text-red-500 hover:text-red-700" data-cost-id="${sc.id}"><i class="fas fa-trash"></i></button>
                    </div>`;
            }).join('');

            document.getElementById('global-costs-list').innerHTML = (billData.globalCosts || []).map(gc => {
                const valueText = gc.type === 'percent' ? `${gc.value}%` : `${gc.value.toFixed(2)} ${billData.currency}`;
                return `
                    <div class="bg-orange-100 p-3 rounded-lg flex justify-between items-center">
                        <div><p class="font-semibold">${gc.description}: ${valueText}</p></div>
                        <button class="remove-global-cost-btn text-red-500 hover:text-red-700" data-cost-id="${gc.id}"><i class="fas fa-trash"></i></button>
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
            const parseLocalFloat = (val) => parseFloat(String(val).replace(',', '.')) || 0;

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
                        Object.assign(updates, buildStatusUpdate(billData, participantId, newStatus, participant.name));
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

            // Płatnik może zmieniać status opłacenia innych (ze śladem kto/kiedy).
            document.querySelectorAll('.payer-status-select').forEach(select => {
                select.onchange = async (e) => {
                    const pid = e.target.dataset.participantId;
                    const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                    const changedBy = myMember ? myMember.name : 'Płatnik';
                    await updateDoc(billDocRef, buildStatusUpdate(billData, pid, e.target.value, changedBy));
                };
            });

            document.querySelectorAll('.remove-shared-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    const costId = e.currentTarget.dataset.costId;
                    const costToRemove = (billData.sharedCosts || []).find(sc => sc.id === costId);
                    if (costToRemove) await updateDoc(billDocRef, { sharedCosts: arrayRemove(costToRemove) });
                };
            });
            document.querySelectorAll('.remove-global-cost-btn').forEach(button => {
                button.onclick = async (e) => {
                    const costId = e.currentTarget.dataset.costId;
                    const costToRemove = (billData.globalCosts || []).find(gc => gc.id === costId);
                    if (costToRemove) await updateDoc(billDocRef, { globalCosts: arrayRemove(costToRemove) });
                };
            });
            setupModal('shared-cost-modal', 'add-shared-cost-btn', 'cancel-shared-cost', 'save-shared-cost', async () => {
                const description = document.getElementById('shared-cost-desc').value.trim();
                const amount = parseLocalFloat(document.getElementById('shared-cost-amount').value);
                const selectedParticipants = Array.from(document.querySelectorAll('.shared-participant-checkbox:checked')).map(cb => cb.value);
                if (!description || !amount || selectedParticipants.length === 0) { showToast("Wypełnij wszystkie pola i wybierz uczestników.", true); return; }
                await updateDoc(billDocRef, { sharedCosts: arrayUnion({ id: generateId(), description, amount, sharedBy: selectedParticipants }) });
                document.getElementById('shared-cost-desc').value = '';
                document.getElementById('shared-cost-amount').value = '';
            });
            document.getElementById('add-shared-cost-btn').addEventListener('click', () => {
                const participantsDiv = document.getElementById('shared-cost-participants');
                participantsDiv.innerHTML = '';
                Object.values(billData.participants || {}).filter(p => p.status !== 'not_applicable').forEach(p => {
                    participantsDiv.innerHTML += `<label class="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 cursor-pointer"><input type="checkbox" class="shared-participant-checkbox" value="${p.id}"><span>${p.name}</span></label>`;
                });
            });
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
        // ===== EKRAN RACHUNKU PROSTEGO (simple-bill-screen) =====
        // ===================================================
        const renderSimpleBillScreen = async () => {
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

            document.getElementById('simple-bill-name').textContent = billData.billName;

            const totalAmountInput = document.getElementById('simple-bill-total-amount');
            if (document.activeElement !== totalAmountInput) {
                totalAmountInput.value = billData.totalAmount > 0 ? billData.totalAmount.toFixed(2) : '';
            }
            totalAmountInput.disabled = !canEditMainFields;

            const currencySelect = document.getElementById('simple-bill-currency-select');
            currencySelect.value = billData.currency;
            currencySelect.disabled = !canEditMainFields;
            
            const payerSelect = document.getElementById('simple-bill-payer-select');
            payerSelect.innerHTML = '<option value="">Nikt</option>';
            Object.values(groupData.members || {}).forEach(m => {
                const option = document.createElement('option');
                option.value = m.id;
                option.textContent = m.name;
                if (billData.payerId === m.id) option.selected = true;
                payerSelect.appendChild(option);
            });
            payerSelect.disabled = isPayerConfirmed;

            const confirmationBanner = document.getElementById('payer-confirmation-banner-simple');
            if (canConfirm) {
                confirmationBanner.innerHTML = `
                    <div class="p-4 mb-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 flex justify-between items-center">
                        <span><i class="fas fa-exclamation-triangle mr-2"></i>Jesteś wybrany/a jako płatnik. Potwierdź, aby zablokować wybór płatnika.</span>
                        <button id="confirm-payer-btn-simple" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Potwierdzam</button>
                    </div>`;
                document.getElementById('confirm-payer-btn-simple').onclick = async () => {
                     await updateDoc(doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId), { payerConfirmed: true });
                };
            } else if (isPayerConfirmed) {
                const payerName = billData.participants[billData.payerId]?.name || '...';
                const bannerText = isCurrentUserThePayer 
                    ? `Jako płatnik, wciąż możesz edytować kwotę rachunku.`
                    : `Główne pola rachunku zostały zablokowane przez <strong>${payerName}</strong>.`;
                confirmationBanner.innerHTML = `
                    <div class="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50">
                        <span><i class="fas fa-lock mr-2"></i>${bannerText}</span>
                    </div>`;
            } else {
                confirmationBanner.innerHTML = '';
            }

            const includedParticipants = Object.values(billData.participants || {}).filter(p => p.status !== 'not_applicable');
            const participantCount = includedParticipants.length;
            const simpleCalc = calculateSimple(billData);
            const amountPerPerson = simpleCalc.amountPerPerson; // zaokrąglone W GÓRĘ (płatnik nie stratny)

            document.getElementById('simple-bill-participant-count').textContent = participantCount === Object.keys(groupData.members).length ? 'wszystkich' : `${participantCount}`;
            document.getElementById('simple-bill-amount-per-person').textContent = `${amountPerPerson.toFixed(2)} ${billData.currency}`;
            document.getElementById('simple-pln-conversion-display').innerHTML = getPlnConversionHtml(amountPerPerson, billData.currency, billData.exchangeRatePLN);

            const participantsList = document.getElementById('simple-bill-participants-list');
            participantsList.innerHTML = '';
            const payer = billData.participants[billData.payerId];

            const sortedParticipants = Object.values(billData.participants || {}).sort((a, b) => {
                if (a.id === myGroupMember.id) return -1;
                if (b.id === myGroupMember.id) return 1;
                return a.name.localeCompare(b.name);
            });

            sortedParticipants.forEach(p => {
                const isMe = p.id === myGroupMember.id;
                const isPayer = p.id === billData.payerId;

                let paymentInfo = '';
                if (payer && isPayerConfirmed && p.status !== 'not_applicable') {
                    if (isPayer) {
                        const amountToReceive = simpleCalc.controlSum - amountPerPerson;
                        if (amountToReceive > 0.01) {
                            paymentInfo = `<p class="text-sm text-green-600 font-semibold">Otrzymasz: ${amountToReceive.toFixed(2)} ${billData.currency}</p>`;
                        }
                    } else {
                        if (amountPerPerson > 0 && p.status !== 'paid') {
                           paymentInfo = `<p class="text-sm text-red-600 font-semibold">Należność dla ${payer.name}: ${amountPerPerson.toFixed(2)} ${billData.currency}</p>${getPaymentMethodsHtml(billData.payerId)}`;
                        }
                    }
                }
                paymentInfo += getPaidDeltaHtml(p, amountPerPerson, billData.currency);
                paymentInfo += getStatusAuditHtml(p);

                const statusHtml = getStatusHtml(p.status, isMe, isPayer, p.id, 'simple', isCurrentUserThePayer);

                const participantHTML = `
                    <div class="p-4 rounded-lg ${isMe ? 'bg-blue-50 border-2 border-blue-200' : 'bg-gray-50 border border-gray-200'}">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center">
                            <div class="flex items-center">
                                ${avatarHtml(p.name, p.id)}
                                <div class="flex flex-col">
                                    <div class="flex items-center">
                                        <span class="text-xl font-semibold">${p.name}</span>
                                    </div>
                                    ${paymentInfo || ''}
                                </div>
                            </div>
                            <div class="mt-2 md:mt-0">
                                 ${statusHtml}
                            </div>
                        </div>
                    </div>`;
                participantsList.innerHTML += participantHTML;
            });
            
            // FIX: The variable to check if the delete button should be shown is now `isCurrentUserThePayer`
            document.getElementById('delete-bill-btn-simple').style.display = isCurrentUserThePayer ? 'inline-block' : 'none';

            addSimpleBillEventListeners();
        };

        const addSimpleBillEventListeners = () => {
            const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
            document.getElementById('back-to-dashboard-from-simple-btn').onclick = () => {
                if (unsubscribeBill) unsubscribeBill();
                navigateToGroup(currentGroupId);
            };
            document.getElementById('simple-bill-total-amount').onchange = async (e) => {
                const newTotal = parseFloat(e.target.value.replace(',','.')) || 0;
                await updateDoc(billDocRef, { totalAmount: newTotal });
            };
            document.getElementById('simple-bill-currency-select').onchange = async (e) => {
                await updateDoc(billDocRef, await currencyPatch(e.target.value));
            };
            document.getElementById('simple-bill-payer-select').onchange = async (e) => {
                await updateDoc(billDocRef, { 
                    payerId: e.target.value || null,
                    payerConfirmed: false
                });
            };
            document.querySelectorAll('.simple-status-select').forEach(select => {
                select.onchange = async (e) => {
                    const participantId = e.target.dataset.participantId;
                    const changedBy = billData.participants[participantId]?.name;
                    await updateDoc(billDocRef, buildStatusUpdate(billData, participantId, e.target.value, changedBy));
                };
            });
            // Płatnik może zmieniać status opłacenia innych (ze śladem kto/kiedy).
            document.querySelectorAll('.payer-status-select').forEach(select => {
                select.onchange = async (e) => {
                    const pid = e.target.dataset.participantId;
                    const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                    const changedBy = myMember ? myMember.name : 'Płatnik';
                    await updateDoc(billDocRef, buildStatusUpdate(billData, pid, e.target.value, changedBy));
                };
            });
            document.getElementById('delete-bill-btn-simple').onclick = () => deleteBillWithUndo();
        };
        
        
        // ===================================================
        // ===== SETUP LISTENERS =====
        // ===================================================

        const setupPwaInstallButton = () => {
            const installButton = document.getElementById('install-pwa-btn');

            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredInstallPrompt = e;
                installButton.classList.remove('hidden');
            });

            installButton.addEventListener('click', async () => {
                installButton.classList.add('hidden');
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                console.log(`Akcja użytkownika (instalacja): ${outcome}`);
                deferredInstallPrompt = null;
            });

            window.addEventListener('appinstalled', () => {
                installButton.classList.add('hidden');
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

            document.getElementById('create-group-btn').addEventListener('click', async () => {
                const groupName = document.getElementById('group-name').value.trim();
                const memberNames = document.getElementById('member-names').value.trim()
                    .split(',').map(name => name.trim()).filter(name => name.length > 0);

                if (!groupName || memberNames.length === 0) {
                    showToast("Wypełnij wszystkie pola.", true);
                    return;
                }
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
            toast.className = 'fixed bottom-5 right-5 p-4 rounded-lg shadow-lg text-white z-50 bg-gray-800 flex items-center gap-4';
            const span = document.createElement('span');
            span.textContent = message;
            const btn = document.createElement('button');
            btn.textContent = 'Cofnij';
            btn.className = 'font-bold underline text-blue-300 hover:text-blue-200 whitespace-nowrap';
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
            // Kontekstowy help „?"
            const helpFab = document.getElementById('help-fab');
            if (helpFab) helpFab.onclick = showHelp;
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
                const b = e.target.closest('.settle-btn');
                if (b) { openSettleModal(b.dataset.to, Number(b.dataset.amountG), b.dataset.currency); return; }
                const del = e.target.closest('.settle-delete-btn');
                if (del) {
                    await deleteDoc(doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`, del.dataset.id));
                    showToast('Usunięto wpłatę.');
                }
            });
            const settleModal = document.getElementById('settle-modal');
            document.getElementById('close-settle-modal').onclick = () => settleModal.classList.remove('active');
            settleModal.onclick = (e) => { if (e.target === settleModal) settleModal.classList.remove('active'); };
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
                await addDoc(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/settlements`), {
                    from: myMember.id,
                    to: settleContext.to,
                    amount,
                    currency: settleContext.currency || 'PLN',
                    createdAt: serverTimestamp(),
                    createdBy: currentUser.uid,
                });
                settleModal.classList.remove('active');
                showToast('Zapisano wpłatę.');
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
            const typeButtons = document.querySelectorAll('.bill-type-btn');
            const createBtn = document.getElementById('confirm-create-bill-btn');
            const cancelBtn = document.getElementById('cancel-new-bill');
            const editParticipantsBtn = document.getElementById('edit-participants-btn-modal');
            const participantsChecklist = document.getElementById('participants-checklist-modal');

            const checkCreateButtonState = () => {
                createBtn.disabled = !(newBillState.name.trim() !== '' && newBillState.type);
            };
            
            const updateParticipantsButton = () => {
                const allMemberIds = Object.keys(groupData.members || {});
                const areAllSelected = allMemberIds.length === newBillState.participantIds.length && allMemberIds.every(id => newBillState.participantIds.includes(id));
                editParticipantsBtn.textContent = areAllSelected ? 'wszystkich' : `wybranych (${newBillState.participantIds.length})`;
            };

            document.getElementById('create-new-bill-btn').onclick = () => {
                if (!groupData) return;
                newBillState = { name: '', type: null, participantIds: Object.keys(groupData.members || {}) };
                nameInput.value = '';
                typeButtons.forEach(btn => btn.classList.remove('selected'));
                
                participantsChecklist.innerHTML = '';
                Object.values(groupData.members || {}).forEach(member => {
                    const label = document.createElement('label');
                    label.className = "flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 cursor-pointer";
                    label.innerHTML = `<input type="checkbox" class="modal-participant-checkbox" value="${member.id}" checked><span>${member.name}</span>`;
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

            typeButtons.forEach(button => {
                button.addEventListener('click', () => {
                    typeButtons.forEach(btn => btn.classList.remove('selected'));
                    button.classList.add('selected');
                    newBillState.type = button.dataset.billType;
                    checkCreateButtonState();
                });
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

                Object.values(allMembersMap).forEach(m => {
                    const isIncluded = newBillState.participantIds.includes(m.id);
                    if (newBillState.type === 'simple') {
                        participantsMap[m.id] = { id: m.id, name: m.name, status: isIncluded ? 'unpaid' : 'not_applicable' };
                    } else { // advanced
                        participantsMap[m.id] = { id: m.id, name: m.name, individualAmount: 0, individualAmounts: [], calculatorActive: false, status: isIncluded ? 'incomplete' : 'not_applicable' };
                    }
                });

                const baseBill = { 
                    billName: newBillState.name, 
                    type: newBillState.type, 
                    createdAt: serverTimestamp(), 
                    currency: 'PLN', 
                    totalAmount: 0, 
                    payerId: null, 
                    payerConfirmed: false,
                    participants: participantsMap
                };

                if (newBillState.type === 'advanced') {
                    baseBill.globalCosts = [];
                    baseBill.sharedCosts = [];
                    baseBill.photos = [];
                }

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
                img.className = 'w-24 h-24 object-cover rounded-lg cursor-pointer border-2 border-gray-200';
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

