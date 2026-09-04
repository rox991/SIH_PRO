import { mapTerminology, searchTerminology } from './api.js';

// These overrides keep presentation in the existing page but route domain work through Express.
window.initFirebase = function initFirebase() {
  // Firebase Auth may remain a client concern during migration. RTDB is intentionally not initialized here.
  if (!window.firebase?.auth) return;
  firebase.auth().onAuthStateChanged((user) => {
    state.currentUser = user
      ? { name: user.email.split('@')[0], email: user.email, role: 'user', uid: user.uid, isDemo: false }
      : { name: 'Guest Practitioner', email: 'guest@ayurfhir-demo.gov.in', role: 'user', isDemo: true };
    updateUserUI();
  });
};

window.handleSignUp = async function handleSignUp(event) {
  event.preventDefault();
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  try {
    await firebase.auth().createUserWithEmailAndPassword(email, password);
    state.currentUser = { name, email, role: 'user', isDemo: false };
    updateUserUI(); closeModal('modal-auth');
    alert('Account created. All self-registered accounts have practitioner access; admin approval is server-managed.');
  } catch (error) { alert(`Sign Up Error: ${error.message}`); }
};

window.performTerminologySearch = async function performTerminologySearch() {
  const query = document.getElementById('term-search-input')?.value || '';
  const stream = document.getElementById('filter-stream')?.value || 'ALL';
  const container = document.getElementById('results-container');
  try {
    const { concepts } = await searchTerminology(query, stream);
    document.getElementById('search-count-badge').innerText = concepts.length;
    container.innerHTML = concepts.map((item) => `<div class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold text-slate-900 text-lg">${item.termEnglish}</h3><p class="text-xs text-slate-600 mt-2">${item.description}</p><p class="text-xs font-mono text-teal-700 mt-2">${item.namasteCode} → ${item.icd11Tm2Code}</p><span class="text-[10px] text-amber-700">Demo terminology data</span></div>`).join('') || '<p class="text-slate-500">No demo concepts match this search.</p>';
  } catch (error) { container.innerHTML = `<p class="text-red-600">${error.message}</p>`; }
};

window.sendMappingRequest = async function sendMappingRequest(payload) { return mapTerminology(payload); };
window.executeApiSandbox = async function executeApiSandbox() {
  try {
    const response = await mapTerminology(JSON.parse(document.getElementById('api-sandbox-input').value));
    document.getElementById('api-sandbox-output').innerText = JSON.stringify(response, null, 2);
  } catch (error) { document.getElementById('api-sandbox-output').innerText = `// Error: ${error.message}`; }
};
