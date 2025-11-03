// Global variables for Firebase access
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, query, orderBy, deleteDoc, runTransaction, getDoc, where, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuration
setLogLevel('debug'); // Set log level for debugging

// Firebase Service Instances
let app;
let db;
let auth;
let userId = null;
let isAuthReady = false;

// Reactive Data Store
let userProfile = {
    monthlyIncome: 0,
    emergencyMonths: 6,
};
let transactions = [];
let dashboardData = {
    income: 0,
    expense: 0,
    savings: 0,
    emergencyFund: 0,
    needsExpense: 0,
    wantsExpense: 0,
    targetEmergency: 0,
    targetNeeds: 0,
    targetWants: 0,
    targetSavings: 0,
    targetInvest: 0,
    fomoRiskScore: 0, // NEW: Score untuk Anti-FOMO
};

// Chart Instances
let idealBudgetChartInstance = null;
let realizationChartInstance = null;

// Utility Functions
const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
};

const showModal = (title, message, isHtml = false) => {
    document.getElementById('modal-title').textContent = title;
    const messageEl = document.getElementById('modal-message');
    if (isHtml) {
            // Ganti elemen P menjadi DIV untuk menampung HTML
            const containerEl = document.getElementById('modal-message-container');
            messageEl.style.display = 'none'; // Sembunyikan P lama
            
            // Buat elemen baru untuk konten HTML
            let htmlContentEl = document.getElementById('modal-html-content');
            if (!htmlContentEl) {
            htmlContentEl = document.createElement('div');
            htmlContentEl.id = 'modal-html-content';
            containerEl.insertBefore(htmlContentEl, messageEl.nextSibling); // Sisipkan setelah P
            }
            htmlContentEl.innerHTML = message;
            htmlContentEl.style.display = 'block';
            
    } else {
            // Pastikan P terlihat dan bersihkan konten HTML jika ada
            const htmlContentEl = document.getElementById('modal-html-content');
            if (htmlContentEl) htmlContentEl.remove();
            messageEl.style.display = 'block';
            messageEl.textContent = message;
    }
    document.getElementById('app-modal').classList.remove('hidden');
    document.getElementById('app-modal').classList.add('flex');
};

window.closeModal = () => {
    document.getElementById('app-modal').classList.add('hidden');
    document.getElementById('app-modal').classList.remove('flex');
};

const getProfileDocRef = () => {
    if (!userId) return null;
    // Public path: /artifacts/{appId}/public/data/profiles/{userId}
    return doc(db, 'artifacts', appId, 'public/data', 'profiles', userId);
};

const getTransactionsCollectionRef = () => {
    if (!userId) return null;
    // Private path: /artifacts/{appId}/users/{userId}/transactions
    return collection(db, 'artifacts', appId, 'users', userId, 'transactions');
};

// --- CORE APPLICATION LOGIC ---

// 1. Firebase Initialization and Authentication
const initFirebase = async () => {
    try {
        // Hides loading spinner
        document.getElementById('loading-overlay').classList.remove('hidden');

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set persistence to session to maintain login across refresh
        await setPersistence(auth, browserSessionPersistence);

        // Sign in with custom token or anonymously if not available
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // Set up auth state listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('user-id-display').textContent = userId;
                isAuthReady = true;
                console.log('User signed in with UID:', userId);
                
                // Start listening to data
                setupDataListeners();
            } else {
                userId = null;
                isAuthReady = true; // Still set to true to handle unauthenticated state gracefully
                document.getElementById('user-id-display').textContent = 'Anonim';
                console.log('User signed out/anonymous.');
                
                // Clear data if needed
                resetAppData();
                updateUI();
            }
            // Hide loading spinner after auth check completes
            document.getElementById('loading-overlay').classList.add('hidden');
        });

    } catch (error) {
        console.error("Error during Firebase initialization or sign-in:", error);
        showModal('Kesalahan Fatal', `Gagal menginisialisasi Firebase: ${error.message}. Periksa koneksi Anda.`);
    }
};

// Resets local data
const resetAppData = () => {
    userProfile = { monthlyIncome: 0, emergencyMonths: 6 };
    transactions = [];
    dashboardData = {
        income: 0,
        expense: 0,
        savings: 0,
        emergencyFund: 0, // This month's contribution
        needsExpense: 0,
        wantsExpense: 0,
        investment: 0,
        targetEmergency: 0,
        targetNeeds: 0,
        targetWants: 0,
        targetSavings: 0,
        targetInvest: 0,
        fomoRiskScore: 0,
        totalEmergencyFund_AllTime: 0, // All-time total
        saldo: 0,
    };
    
    // Re-render UI in its empty state
    calculateAndRender();
};

// Helper to run main calculation and rendering logic
const calculateAndRender = () => {
    if (!isAuthReady) return; // Wait for auth
    calculateDashboardData();
    updateUI();
    renderTransactions();
};

// 2. Data Listeners Setup
const setupDataListeners = () => {
    if (!userId) {
        resetAppData();
        return;
    }

    const profileRef = getProfileDocRef();
    const transactionsRef = getTransactionsCollectionRef();

    // Listener 1: User Profile
    onSnapshot(profileRef, (docSnap) => {
        if (docSnap.exists()) {
            userProfile = docSnap.data();
        } else {
            // Create a default profile if it doesn't exist
            console.log("No profile found, creating default.");
            userProfile = { monthlyIncome: 0, emergencyMonths: 6 };
            setDoc(profileRef, userProfile);
        }
        
        // Update form fields
        document.getElementById('monthly-income').value = userProfile.monthlyIncome;
        document.getElementById('emergency-months').value = userProfile.emergencyMonths;
        
        calculateAndRender(); // Recalculate everything
    }, (error) => {
        console.error("Error listening to profile:", error);
        showModal("Error", "Gagal memuat profil: " + error.message);
    });

    // Listener 2: Transactions (This Month Only)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    
    const qMonth = query(transactionsRef, 
                        where("timestamp", ">=", startOfMonth), 
                        orderBy("timestamp", "desc"));

    onSnapshot(qMonth, (querySnapshot) => {
        transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        
        calculateAndRender(); // Recalculate and render
    }, (error) => {
        console.error("Error listening to transactions:", error);
        showModal("Error", "Gagal memuat transaksi: " + error.message);
    });
    
    // Listener 3: Total Emergency Fund (All Time)
    // This is separate because the savings view needs all-time data
    const qEmergency = query(transactionsRef, where("category", "==", "dana-darurat"));
    
    onSnapshot(qEmergency, (snapshot) => {
        let total = 0;
        snapshot.forEach(doc => total += doc.data().amount);
        dashboardData.totalEmergencyFund_AllTime = total;
        calculateAndRender(); // Re-render with new total
    }, (error) => {
        console.error("Error listening to emergency fund:", error);
    });
};

// 3. Core Data Calculation
const calculateDashboardData = () => {
    let income = 0;
    let expense = 0;
    let savings = 0;
    let emergencyFund = 0; // This month
    let needsExpense = 0;
    let wantsExpense = 0;
    let investment = 0;
    
    const incomeMonth = userProfile.monthlyIncome || 0;

    // Calculate targets based on profile income
    const targetNeeds = incomeMonth * 0.50;
    const targetWants = incomeMonth * 0.30;
    const targetSavings = incomeMonth * 0.10;
    const targetInvest = incomeMonth * 0.10;
    const targetEmergency = incomeMonth * userProfile.emergencyMonths;
    
    // Process transactions (this month's)
    transactions.forEach(tx => {
        if (tx.type === 'income') {
            income += tx.amount;
        } else if (tx.type === 'expense') {
            expense += tx.amount;
            if (tx.category === 'kebutuhan') {
                needsExpense += tx.amount;
            } else if (tx.category === 'gaya-hidup') {
                wantsExpense += tx.amount;
            }
        } else if (tx.type === 'saving') {
            if (tx.category === 'tabungan') {
                savings += tx.amount;
            } else if (tx.category === 'investasi') {
                investment += tx.amount;
            } else if (tx.category === 'dana-darurat') {
                emergencyFund += tx.amount; // This month's contribution
            }
        }
    });

    // Calculate FOMO Risk Score
    let fomoRiskScore = 0;
    if (targetWants > 0) {
        fomoRiskScore = Math.min(100, (wantsExpense / targetWants) * 100);
    } else if (wantsExpense > 0 && incomeMonth > 0) {
        fomoRiskScore = 100; // Spending on wants with 0 budget is high risk
    }

    // Save to global state
    dashboardData = {
        ...dashboardData, // Keep totalEmergencyFund_AllTime
        income,
        expense,
        saldo: income - expense,
        needsExpense,
        wantsExpense,
        savings,
        investment,
        emergencyFund, // This month's contribution
        targetEmergency,
        targetNeeds,
        targetWants,
        targetSavings,
        targetInvest,
        fomoRiskScore: Math.round(fomoRiskScore)
    };
};

// 4. UI Rendering
const updateUI = () => {
    if (!isAuthReady) return;

    const {
        income, expense, saldo, needsExpense, wantsExpense, savings, investment,
        targetNeeds, targetWants, targetSavings, targetInvest, targetEmergency,
        fomoRiskScore, totalEmergencyFund_AllTime 
    } = dashboardData;
    
    const profileIncome = userProfile.monthlyIncome;

    // 1. Dashboard - 4 Cards
    document.getElementById('total-saldo').textContent = formatRupiah(saldo);
    document.getElementById('total-pemasukan').textContent = formatRupiah(income);
    document.getElementById('total-pengeluaran').textContent = formatRupiah(expense);
    document.getElementById('total-alokasi-tabungan').textContent = formatRupiah(targetSavings + targetInvest); 

    // 2. Dashboard - Ideal Budget (based on profile income)
    document.getElementById('ideal-kebutuhan').textContent = formatRupiah(targetNeeds);
    document.getElementById('ideal-gayahidup').textContent = formatRupiah(targetWants);
    document.getElementById('ideal-tabungan').textContent = formatRupiah(targetSavings);
    document.getElementById('ideal-investasi').textContent = formatRupiah(targetInvest);
    updateIdealBudgetChart(targetNeeds, targetWants, targetSavings, targetInvest);

    // 3. Dashboard - Realization Chart
    updateRealizationChart(
        [targetNeeds, targetWants, targetSavings, targetInvest],
        [needsExpense, wantsExpense, savings, investment]
    );

    // 4. Dashboard - Anti-FOMO
    const fomoCard = document.getElementById('anti-fomo-card');
    const fomoScoreEl = document.getElementById('fomo-risk-score');
    const fomoLevelEl = document.getElementById('fomo-risk-level');
    const fomoMessageEl = document.getElementById('fomo-status-message');

    fomoCard.classList.remove('fomo-safe', 'fomo-warning', 'fomo-critical');
    fomoScoreEl.textContent = `${fomoRiskScore}%`;

    if (profileIncome === 0) {
            fomoCard.classList.add('fomo-warning');
            fomoLevelEl.textContent = "DATA KOSONG";
            fomoLevelEl.style.backgroundColor = '#f59e0b';
            fomoMessageEl.textContent = "Atur Pemasukan Bulanan di 'Anggaran & Transaksi' untuk mengaktifkan fitur ini.";
            fomoScoreEl.textContent = `--`;
    } else if (fomoRiskScore <= 60) {
        fomoCard.classList.add('fomo-safe');
        fomoLevelEl.textContent = "RISIKO: AMAN";
        fomoLevelEl.style.backgroundColor = '#10b981';
        fomoMessageEl.textContent = `Pengeluaran Gaya Hidup Anda (${formatRupiah(wantsExpense)}) masih jauh di bawah anggaran (${formatRupiah(targetWants)}). Bagus!`;
    } else if (fomoRiskScore <= 99) {
        fomoCard.classList.add('fomo-warning');
        fomoLevelEl.textContent = "RISIKO: HATI-HATI";
        fomoLevelEl.style.backgroundColor = '#f59e0b';
        fomoMessageEl.textContent = `Anda hampir mencapai batas anggaran Gaya Hidup. Pengeluaran: ${formatRupiah(wantsExpense)} dari ${formatRupiah(targetWants)}.`;
    } else { // 100+
        fomoCard.classList.add('fomo-critical');
        fomoLevelEl.textContent = "RISIKO: TINGGI (FOMO)";
        fomoLevelEl.style.backgroundColor = '#ef4444';
        fomoMessageEl.textContent = `Anda telah melebihi anggaran Gaya Hidup! (${formatRupiah(wantsExpense)} / ${formatRupiah(targetWants)}). Waspada FOMO.`;
    }
    
    // 5. Dashboard - Financial Analysis
    const analysisEl = document.getElementById('financial-analysis');
    if (income > 0 || expense > 0) {
        let analysisHtml = `<ul class="list-disc pl-5 space-y-2 text-gray-700">`;
        if (income > 0) {
            analysisHtml += `<li>Total Pemasukan bulan ini: <strong>${formatRupiah(income)}</strong>.</li>`;
        }
        if (saldo > 0) {
            analysisHtml += `<li class="text-green-700">Selamat! Arus kas Anda <strong>Positif</strong> sebesar <strong>${formatRupiah(saldo)}</strong>.</li>`;
        } else {
            analysisHtml += `<li class="text-red-700">Perhatian! Arus kas Anda <strong>Negatif</strong> sebesar <strong>${formatRupiah(saldo)}</strong>.</li>`;
        }
        if (wantsExpense > targetWants && targetWants > 0) {
                analysisHtml += `<li class="text-red-700">Pengeluaran <strong>Gaya Hidup</strong> (${formatRupiah(wantsExpense)}) telah <strong>melebihi</strong> anggaran (${formatRupiah(targetWants)}).</li>`;
        } else if (targetWants > 0) {
                analysisHtml += `<li>Pengeluaran <strong>Gaya Hidup</strong> (${formatRupiah(wantsExpense)}) masih <strong>sesuai</strong> anggaran (${formatRupiah(targetWants)}).</li>`;
        }
            analysisHtml += `</ul>`;
            analysisEl.innerHTML = analysisHtml;
    } else {
        analysisEl.textContent = "Analisis akan muncul di sini setelah Anda memasukkan data Pemasukan dan Pengeluaran.";
    }

    // 6. Dashboard - Quick Alerts
    const alertDanaDarurat = document.getElementById('alert-dana-darurat');
    const alertGayaHidup = document.getElementById('alert-gaya-hidup');
    
    let emergencyPercent = 0;
    if (targetEmergency > 0) {
        emergencyPercent = (totalEmergencyFund_AllTime / targetEmergency) * 100;
    }
    
    if (profileIncome === 0) {
            alertDanaDarurat.innerHTML = `<span class="font-semibold text-blue-700">Dana Darurat:</span> Atur Pemasukan Bulanan Anda untuk menghitung target.`;
            alertDanaDarurat.className = 'p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm';
    } else if (emergencyPercent < 50) {
        alertDanaDarurat.innerHTML = `<span class="font-semibold text-red-700">Dana Darurat (Kritis):</span> Baru <strong>${emergencyPercent.toFixed(0)}%</strong> (${formatRupiah(totalEmergencyFund_AllTime)}) dari target ${formatRupiah(targetEmergency)}. Prioritaskan!`;
        alertDanaDarurat.className = 'p-3 bg-red-50 border border-red-200 rounded-lg text-sm';
    } else if (emergencyPercent < 100) {
        alertDanaDarurat.innerHTML = `<span class="font-semibold text-yellow-700">Dana Darurat (Progres):</span> Sudah <strong>${emergencyPercent.toFixed(0)}%</strong> (${formatRupiah(totalEmergencyFund_AllTime)}) dari target ${formatRupiah(targetEmergency)}. Terus menabung!`;
        alertDanaDarurat.className = 'p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm';
    } else {
        alertDanaDarurat.innerHTML = `<span class="font-semibold text-green-700">Dana Darurat (Tercapai!):</span> <strong>${emergencyPercent.toFixed(0)}%</strong> (${formatRupiah(totalEmergencyFund_AllTime)}). Anda aman!`;
        alertDanaDarurat.className = 'p-3 bg-green-50 border border-green-200 rounded-lg text-sm';
    }
    
        if (profileIncome === 0) {
        alertGayaHidup.innerHTML = `<span class="font-semibold text-blue-700">Gaya Hidup:</span> Atur Pemasukan Bulanan Anda.`;
        alertGayaHidup.className = 'p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm';
        } else if (fomoRiskScore >= 100) {
        alertGayaHidup.innerHTML = `<span class="font-semibold text-red-700">Gaya Hidup (Boros):</span> Pengeluaran <strong>${fomoRiskScore}%</strong> dari anggaran. Anda <strong>melebihi batas</strong>! Hati-hati FOMO.`;
        alertGayaHidup.className = 'p-3 bg-red-50 border border-red-200 rounded-lg text-sm';
        } else if (fomoRiskScore > 80) {
        alertGayaHidup.innerHTML = `<span class="font-semibold text-yellow-700">Gaya Hidup (Waspada):</span> Pengeluaran <strong>${fomoRiskScore}%</strong> dari anggaran. Anda <strong>mendekati batas</strong>.`;
        alertGayaHidup.className = 'p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm';
        } else {
            alertGayaHidup.innerHTML = `<span class="font-semibold text-green-700">Gaya Hidup (Aman):</span> Pengeluaran <strong>${fomoRiskScore}%</strong> dari anggaran. Pengelolaan Anda bagus!`;
            alertGayaHidup.className = 'p-3 bg-green-50 border border-green-200 rounded-lg text-sm';
        }


    // 7. Transactions Page - Budget Summary
    document.getElementById('budget-needs').textContent = formatRupiah(targetNeeds);
    document.getElementById('budget-wants').textContent = formatRupiah(targetWants);
    document.getElementById('budget-savings').textContent = formatRupiah(targetSavings);
    document.getElementById('budget-invest').textContent = formatRupiah(targetInvest);

    // 8. Savings Page - Emergency Fund
    document.getElementById('emergency-current').textContent = formatRupiah(totalEmergencyFund_AllTime);
    document.getElementById('emergency-target').textContent = formatRupiah(targetEmergency);
    document.getElementById('emergency-months-target').textContent = userProfile.emergencyMonths;
    document.getElementById('emergency-percentage').textContent = `${emergencyPercent.toFixed(0)}%`;
    
    const ringEl = document.getElementById('emergency-ring');
    if (emergencyPercent < 50) ringEl.style.borderColor = '#fecaca'; // red-200
    else if (emergencyPercent < 100) ringEl.style.borderColor = '#fef08a'; // yellow-200
    else ringEl.style.borderColor = '#bbf7d0'; // green-200
    
    const statusEl = document.getElementById('emergency-status');
        if (profileIncome === 0) {
        statusEl.textContent = 'Atur Pemasukan Bulanan Anda di halaman "Anggaran & Transaksi" untuk memulai.';
        statusEl.className = 'mt-2 p-2 bg-blue-100 text-blue-800 rounded-lg text-sm';
    } else if (emergencyPercent >= 100) {
        statusEl.textContent = 'Selamat! Target dana darurat Anda telah terpenuhi.';
        statusEl.className = 'mt-2 p-2 bg-green-100 text-green-800 rounded-lg text-sm';
    } else {
            statusEl.textContent = 'Target belum terpenuhi. Terus tingkatkan tabungan Anda!';
            statusEl.className = 'mt-2 p-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm';
    }
};

// 5. Transaction List Rendering
const renderTransactions = () => {
    const listEl = document.getElementById('transactions-list');
    const noDataEl = document.getElementById('no-transactions-message');
    
    if (transactions.length === 0) {
        listEl.innerHTML = '';
        noDataEl.classList.remove('hidden');
        return;
    }

    noDataEl.classList.add('hidden');
    listEl.innerHTML = transactions.map(tx => {
        const date = new Date(tx.timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        let amountClass = '';
        let amountSign = '';
        
        if (tx.type === 'income') {
            amountClass = 'text-green-600';
            amountSign = '+ ';
        } else if (tx.type === 'expense') {
            amountClass = 'text-red-600';
            amountSign = '- ';
        } else { // saving
            amountClass = 'text-indigo-600';
            amountSign = '';
        }

        const categories = {
            'kebutuhan': 'Kebutuhan',
            'gaya-hidup': 'Gaya Hidup',
            'tabungan': 'Tabungan',
            'investasi': 'Investasi',
            'dana-darurat': 'Dana Darurat',
            'pemasukan': 'Pemasukan'
        };
        
        const types = {
            'expense': 'Pengeluaran',
            'income': 'Pemasukan',
            'saving': 'Tabungan'
        };

        return `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${date}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 break-all">${tx.description}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${types[tx.type] || tx.type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${categories[tx.category] || tx.category}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${amountClass}">
                    ${amountSign}${formatRupiah(tx.amount)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <button onclick="deleteTransaction('${tx.id}')" class="text-red-600 hover:text-red-900" title="Hapus">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
};

// --- ACTION FUNCTIONS (WINDOW-SCOPED) ---
// Kita tetapkan ke 'window' agar HTML (onclick) bisa memanggilnya
// Ini aman karena file ini adalah module

window.saveProfile = async () => {
    const income = parseFloat(document.getElementById('monthly-income').value) || 0;
    const months = parseInt(document.getElementById('emergency-months').value) || 6;

    if (income <= 0) {
        showModal("Input Tidak Valid", "Pemasukan bulanan harus lebih besar dari 0.");
        return;
    }
    if (months <= 0) {
        showModal("Input Tidak Valid", "Target Dana Darurat harus minimal 1 bulan.");
        return;
    }

    const newProfile = { monthlyIncome: income, emergencyMonths: months };
    
    try {
        await setDoc(getProfileDocRef(), newProfile, { merge: true });
        showModal("Sukses", "Profil dan anggaran berhasil diperbarui.");
        // onSnapshot will auto-update the UI
    } catch (error) {
        console.error("Error saving profile:", error);
        showModal("Error", "Gagal menyimpan profil: " + error.message);
    }
};

window.addTransaction = async () => {
    const type = document.getElementById('transaction-type').value;
    const category = document.getElementById('transaction-category').value;
    const amount = parseFloat(document.getElementById('transaction-amount').value) || 0;
    const description = document.getElementById('transaction-description').value.trim();

    if (amount <= 0) {
        showModal("Input Tidak Valid", "Jumlah transaksi harus lebih besar dari 0.");
        return;
    }
    if (description === "") {
        showModal("Input Tidak Valid", "Deskripsi tidak boleh kosong.");
        return;
    }

    const newTransaction = {
        type,
        category,
        amount,
        description,
        timestamp: new Date().getTime()
    };

    try {
        // Use setDoc with a unique ID (timestamp + random string)
        const newDocRef = doc(getTransactionsCollectionRef(), `${newTransaction.timestamp}-${Math.random().toString(36).substring(2, 9)}`);
        await setDoc(newDocRef, newTransaction);
        
        // Clear form
        document.getElementById('transaction-amount').value = '';
        document.getElementById('transaction-description').value = '';
    } catch (error) {
        console.error("Error adding transaction:", error);
        showModal("Error", "Gagal menambahkan transaksi: " + error.message);
    }
};

window.deleteTransaction = async (id) => {
    if (!confirm("Apakah Anda yakin ingin menghapus transaksi ini?")) return;
    
    try {
        const docRef = doc(getTransactionsCollectionRef(), id);
        await deleteDoc(docRef);
        // onSnapshot will auto-update the UI
    } catch (error) {
        console.error("Error deleting transaction:", error);
        showModal("Error", "Gagal menghapus transaksi: " + error.message);
    }
};

window.showFomoTips = () => {
    const tipsHtml = `
        <p class="mb-4">FOMO (Fear Of Missing Out) di bidang keuangan seringkali membuat kita mengambil keputusan impulsif (seperti membeli barang yang sedang tren) yang merusak anggaran. Berikut beberapa tips:</p>
        <ul class="list-disc pl-5 space-y-2 text-gray-600">
            <li><strong>Kenali Pemicu (Trigger):</strong> Apakah itu media sosial? Lingkaran pertemanan? Sadari apa yang membuat Anda merasa 'tertinggal'.</li>
            <li><strong>Terapkan Jeda 24 Jam:</strong> Sebelum membeli barang 'Gaya Hidup' yang tidak direncanakan, tunggu 24 jam. Seringkali, keinginan itu akan mereda.</li>
            <li><strong>Fokus pada Tujuan Anda (Goals):</strong> Ingatkan diri Anda pada tujuan finansial jangka panjang (Dana Darurat, liburan, dll). Apakah pembelian ini membantunya?</li>
            <li><strong>Anggarkan 'Uang Jajan':</strong> Alokasi 30% 'Gaya Hidup' Anda adalah untuk ini. Jika masih ada di anggaran, tidak apa-apa. Jika sudah habis, berarti tidak.</li>
            <li><strong>Unfollow & Mute:</strong> Jika perlu, 'unfollow' akun-akun yang memicu Anda untuk boros. Kesehatan mental dan finansial Anda lebih penting.</li>
        </ul>
    `;
    showModal('Tips Mengatasi FOMO Keuangan', tipsHtml, true);
};

// --- CHARTING FUNCTIONS ---

const chartColors = {
    kebutuhan: '#3b82f6', // Biru
    gayaHidup: '#f59e0b', // Kuning/Amber
    tabungan: '#10b981', // Hijau
    investasi: '#6366f1', // Indigo
};

const initIdealBudgetChart = () => {
    const ctx = document.getElementById('idealBudgetChart').getContext('2d');
    idealBudgetChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Kebutuhan (50%)', 'Gaya Hidup (30%)', 'Tabungan (10%)', 'Investasi (10%)'],
            datasets: [{
                data: [1, 1, 1, 1], // Initial
                backgroundColor: ['#e5e7eb', '#e5e7eb', '#e5e7eb', '#e5e7eb'],
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: {
                        callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += formatRupiah(context.parsed);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
};

const updateIdealBudgetChart = (needs, wants, savings, invest) => {
    if (!idealBudgetChartInstance) return;
    const data = [needs, wants, savings, invest];
    
    if (data.every(val => val === 0)) {
            idealBudgetChartInstance.data.datasets[0].data = [1, 1, 1, 1];
            idealBudgetChartInstance.data.datasets[0].backgroundColor = ['#e5e7eb', '#e5e7eb', '#e5e7eb', '#e5e7eb'];
    } else {
        idealBudgetChartInstance.data.datasets[0].data = data;
        idealBudgetChartInstance.data.datasets[0].backgroundColor = [
            chartColors.kebutuhan, chartColors.gayaHidup, chartColors.tabungan, chartColors.investasi
        ];
    }
    idealBudgetChartInstance.update();
};

const initRealizationChart = () => {
    const ctx = document.getElementById('realizationChart').getContext('2d');
    realizationChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Kebutuhan', 'Gaya Hidup', 'Tabungan', 'Investasi'],
            datasets: [
                {
                    label: 'Anggaran (Target)',
                    data: [0, 0, 0, 0],
                    backgroundColor: '#e0f2fe', // blue-100
                    borderColor: '#bae6fd', // blue-200
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Realisasi (Pengeluaran)',
                    data: [0, 0, 0, 0],
                    backgroundColor: [
                        chartColors.kebutuhan, chartColors.gayaHidup, chartColors.tabungan, chartColors.investasi
                    ],
                    borderWidth: 0,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => formatRupiah(value)
                    }
                }
            },
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                        callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += formatRupiah(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
};

const updateRealizationChart = (targets, realizations) => {
    if (!realizationChartInstance) return;
    realizationChartInstance.data.datasets[0].data = targets;
    realizationChartInstance.data.datasets[1].data = realizations;
    realizationChartInstance.update();
};

// --- UI HELPER FUNCTIONS ---

window.switchView = (viewId) => {
    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById(`nav-${viewId}`).classList.add('active');
    
    // Close mobile sidebar on navigation
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('translate-x-0')) {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
    }
};

// Mobile Menu Toggle
document.getElementById('menu-button').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('-translate-x-full');
    sidebar.classList.toggle('translate-x-0');
});

// Overlay click to close mobile menu
document.getElementById('main-content').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (window.innerWidth < 1024 && sidebar.classList.contains('translate-x-0')) {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
        }
});

// Dynamic Category Filter for Transaction Form
document.getElementById('transaction-type').addEventListener('change', (e) => {
    const type = e.target.value;
    const categorySelect = document.getElementById('transaction-category');
    
    const options = {
        expense: [
            { value: 'kebutuhan', text: 'Kebutuhan (50%)' },
            { value: 'gaya-hidup', text: 'Gaya Hidup (30%)' }
        ],
        income: [
            { value: 'pemasukan', text: 'Gaji/Pemasukan' }
        ],
        saving: [
            { value: 'tabungan', text: 'Tabungan (10%)' },
            { value: 'investasi', text: 'Investasi (10%)' },
            { value: 'dana-darurat', text: 'Dana Darurat' }
        ]
    };
    
    categorySelect.innerHTML = options[type].map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
});

// --- INITIALIZATION ---

// Trigger default filter on load
document.getElementById('transaction-type').dispatchEvent(new Event('change'));

// Initialize Charts
initIdealBudgetChart();
initRealizationChart();

// Start the application
initFirebase();
