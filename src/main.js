        // Importy Firebase (npm) + moduł obliczeń
        import { calculateAll, calculateAllForBill } from './calc.js';
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
        let isAuthReady = false;
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
            unsubscribeGroup = null;
            unsubscribeBill = null;

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
        };

        const showScreen = (screenName) => {
            ['loading', 'start', 'join', 'group-dashboard', 'bill', 'simple-bill'].forEach(s => {
                const screenEl = document.getElementById(`${s}-screen`);
                if (screenEl) screenEl.classList.add('hidden');
            });
            const targetScreen = document.getElementById(`${screenName}-screen`);
            if (targetScreen) targetScreen.classList.remove('hidden');
        };

        const handleGroupJoin = async (groupId) => {
            const urlParams = new URLSearchParams(window.location.search);
            currentBillId = urlParams.get('bill');
            currentGroupId = groupId;

            const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, groupId);
            const groupDoc = await getDoc(groupDocRef);
            if (!groupDoc.exists()) {
                showToast("Taka grupa nie istnieje!", true);
                history.pushState(null, '', window.location.pathname);
                showScreen('start');
                return;
            }
            groupData = groupDoc.data();
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
                button.textContent = m.name;
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
        
        const renderGroupDashboard = () => {
            if (unsubscribeGroup) unsubscribeGroup();
            
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
                }
            });
            
            const billsQuery = query(collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`), orderBy('createdAt', 'desc'));
            unsubscribeGroup = onSnapshot(billsQuery, (snapshot) => {
                const billsList = document.getElementById('bills-history-list');
                billsList.innerHTML = '';
                if (snapshot.empty) {
                    billsList.innerHTML = '<p class="text-gray-500">Brak rachunków. Dodaj pierwszy!</p>';
                } else {
                    snapshot.forEach(doc => {
                        const bill = doc.data();
                        const myMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                        if (!myMember) return;
                        const myParticipant = bill.participants ? bill.participants[myMember.id] : null;
                        
                        const billEl = document.createElement('div');
                        billEl.className = "bg-gray-100 p-4 rounded-lg flex flex-col sm:flex-row justify-between sm:items-center cursor-pointer hover:bg-gray-200";
                        
                        const summaryHtml = getBillSummaryHtml(bill, myMember, myParticipant);

                        billEl.innerHTML = `
                            <div class="w-full">
                                <p class="font-semibold text-lg flex items-center">${bill.billName}</p>
                                <p class="text-xs text-gray-500">Utworzono: ${new Date(bill.createdAt?.toDate()).toLocaleString('pl-PL')}</p>
                                <div class="mt-2">${summaryHtml}</div>
                            </div>
                            <i class="fas fa-chevron-right text-gray-400 mt-2 sm:mt-0 self-end sm:self-center"></i>
                        `;
                        billEl.onclick = () => joinBill(currentGroupId, doc.id);
                        billsList.appendChild(billEl);
                    });
                }
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
                        renderSimpleBillScreen();
                        showScreen('simple-bill');
                    } else { 
                        renderBillScreen();
                        showScreen('bill');
                    }
                }
            });
        };
        
        const getPlnConversionHtml = (amount, currency) => {
            if (currency !== 'PLN' && exchangeRates && exchangeRates.rates.PLN && amount > 0) {
                const plnAmount = amount * exchangeRates.rates.PLN;
                return `(≈ ${plnAmount.toFixed(2)} PLN)`;
            }
            return '';
        };

        const getStatusHtml = (status, isMe, isPayer, participantId = null, billType = 'advanced') => {
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

            return `<span class="font-semibold ${current.color} flex items-center"><i class="fas ${current.icon} mr-2"></i>${current.text}</span>`;
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
            controlSumEl.textContent = `${calculations.controlSum.toFixed(2)} ${billData.currency}`;
            controlSumEl.className = "mt-1 text-2xl font-bold ";

            const totalAmount = billData.totalAmount || 0;
            const controlSum = calculations.controlSum;
            const tolerance = 0.015;

            if (totalAmount > 0) {
                const onePercentOver = totalAmount * 1.01;
                if (controlSum < totalAmount - tolerance) {
                    controlSumEl.classList.add('control-sum-bad'); 
                } 
                else if (controlSum >= totalAmount - tolerance && controlSum <= onePercentOver + tolerance) {
                    controlSumEl.classList.add('control-sum-ok');
                } 
                else { 
                    controlSumEl.classList.add('control-sum-bad');
                }
            } else {
                 if (Math.abs(controlSum) > tolerance) {
                    controlSumEl.classList.add('control-sum-bad');
                 } else {
                    controlSumEl.classList.add('control-sum-ok');
                 }
            }
            
            const plnDisplay = document.getElementById('pln-conversion-display');
            if (billData.currency !== 'PLN' && exchangeRates && exchangeRates.rates.PLN) {
                const plnTotal = calculations.controlSum * exchangeRates.rates.PLN;
                plnDisplay.textContent = `≈ ${plnTotal.toFixed(2)} PLN (kurs: ${exchangeRates.rates.PLN.toFixed(4)})`;
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
                                paymentInfo = `<p class="text-sm text-green-600 font-semibold">Otrzymasz: ${amountToReceive.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(amountToReceive, billData.currency)}</p>`;
                            }
                        }
                    } else if (pt.total > 0) {
                         if (p.status !== 'paid') {
                            paymentInfo = `<p class="text-sm text-red-600 font-semibold">Należność dla ${payer.name}: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency)}</p>`;
                        }
                    }
                }
                
                const statusDisplayHtml = getStatusHtml(p.status, isMe, isPayer, p.id, 'advanced');

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
                                <i class="fas fa-user-circle text-2xl text-blue-600 mr-3"></i>
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
                                                 <input type="text" inputmode="decimal" class="individual-amount-component w-32 text-right font-semibold p-1 border-b-2 rounded-none bg-transparent border-gray-400 focus:border-blue-500 outline-none" value="${amount > 0 ? String(amount.toFixed(2)).replace('.',',') : ''}" placeholder="0,00" data-index="${index}" ${isDisabled ? 'disabled' : ''}>
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
                                <p class="text-base font-bold">ŁĄCZNIE: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency)}</p>
                                ${paymentInfo}
                            </div>
                        </div>
                    </div>`;
                } else { // Other participants view
                    participantHTML = `
                    <div class="p-4 rounded-lg bg-gray-50 border border-gray-200">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center">
                            <div class="flex items-center">
                                <i class="fas fa-user-circle text-2xl text-gray-400 mr-3"></i>
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
                                <p class="text-base font-bold">ŁĄCZNIE: ${pt.total.toFixed(2)} ${billData.currency} ${getPlnConversionHtml(pt.total, billData.currency)}</p>
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
                await updateDoc(billDocRef, { currency: e.target.value });
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

            document.getElementById('delete-bill-btn-advanced').onclick = () => document.getElementById('delete-confirm-modal').classList.add('active');

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
                        const shouldClearAmounts = newStatus === 'not_applicable';
                        updates[`participants.${participantId}.status`] = newStatus;
                        if (shouldClearAmounts) {
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
            const amountPerPerson = participantCount > 0 ? billData.totalAmount / participantCount : 0;

            document.getElementById('simple-bill-participant-count').textContent = participantCount === Object.keys(groupData.members).length ? 'wszystkich' : `${participantCount}`;
            document.getElementById('simple-bill-amount-per-person').textContent = `${amountPerPerson.toFixed(2)} ${billData.currency}`;
            document.getElementById('simple-pln-conversion-display').innerHTML = getPlnConversionHtml(amountPerPerson, billData.currency);

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
                        const amountToReceive = billData.totalAmount - amountPerPerson;
                        if (amountToReceive > 0.01) {
                            paymentInfo = `<p class="text-sm text-green-600 font-semibold">Otrzymasz: ${amountToReceive.toFixed(2)} ${billData.currency}</p>`;
                        }
                    } else {
                        if (amountPerPerson > 0 && p.status !== 'paid') {
                           paymentInfo = `<p class="text-sm text-red-600 font-semibold">Należność dla ${payer.name}: ${amountPerPerson.toFixed(2)} ${billData.currency}</p>`;
                        }
                    }
                }

                const statusHtml = getStatusHtml(p.status, isMe, isPayer, p.id, 'simple');

                const participantHTML = `
                    <div class="p-4 rounded-lg ${isMe ? 'bg-blue-50 border-2 border-blue-200' : 'bg-gray-50 border border-gray-200'}">
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center">
                            <div class="flex items-center">
                                <i class="fas fa-user-circle text-2xl ${isMe ? 'text-blue-600' : 'text-gray-400'} mr-3"></i>
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
                await updateDoc(billDocRef, { currency: e.target.value });
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
                    const newStatus = e.target.value;
                    await updateDoc(billDocRef, { [`participants.${participantId}.status`]: newStatus });
                };
            });
            document.getElementById('delete-bill-btn-simple').onclick = () => document.getElementById('delete-confirm-modal').classList.add('active');
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

                memberNames.forEach(name => {
                    const id = generateId();
                    membersMap[id] = { id, name, claimedBy: null };
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

        const setupGlobalModalListeners = () => {
            document.getElementById('cancel-delete-bill').onclick = () => document.getElementById('delete-confirm-modal').classList.remove('active');
            document.getElementById('confirm-delete-bill').onclick = async () => {
                if (!currentGroupId || !currentBillId) return;

                const myGroupMember = Object.values(groupData.members || {}).find(m => m.claimedBy === currentUser.uid);
                // FIX: This client-side check ensures only the confirmed payer can delete.
                if (!myGroupMember || !billData.payerId || billData.payerId !== myGroupMember.id || !billData.payerConfirmed) {
                    showToast("Tylko potwierdzony płatnik może usunąć rachunek.", true);
                    return;
                }

                if (billData && billData.photos && billData.photos.length > 0) {
                    const groupDocRef = doc(db, `artifacts/${appId}/public/data/groups`, currentGroupId);
                    let totalSizeToDelete = 0;

                    const deletePromises = billData.photos.map(photo => {
                        if (photo && photo.url) {
                            totalSizeToDelete += (typeof photo.size === 'number' ? photo.size : 0);
                            const photoRef = ref(storage, photo.url);
                            return deleteObject(photoRef).catch(err => console.error("Błąd usuwania zdjęcia ze storage:", err));
                        }
                        return Promise.resolve();
                    });
                    
                    await Promise.all(deletePromises);
                    if (totalSizeToDelete > 0) {
                        await updateDoc(groupDocRef, { totalStorageUsed: increment(-totalSizeToDelete) });
                    }
                }

                const billDocRef = doc(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/bills`, currentBillId);
                try {
                    if(unsubscribeBill) unsubscribeBill();
                    await deleteDoc(billDocRef);
                    showToast("Rachunek został usunięty.");
                    document.getElementById('delete-confirm-modal').classList.remove('active');
                    navigateToGroup(currentGroupId);
                } catch (error) {
                    console.error("Błąd podczas usuwania rachunku:", error);
                    showToast("Nie udało się usunąć rachunku.", true);
                }
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

