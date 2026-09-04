import { api } from './api.js';

// The old client-side RTDB role/listener code is disabled. Admin identity must be verified server-side
// before real monitoring and user-management routes are enabled.
window.initAdminFirebase = function initAdminFirebase() {
  document.getElementById('auth-guard-modal').classList.remove('hidden');
  document.getElementById('admin-auth-forms').classList.add('hidden');
  document.getElementById('access-denied-box').classList.remove('hidden');
  document.getElementById('denied-user-email').innerText = 'Server-managed access required';
};

window.handleAdminSignUp = function handleAdminSignUp(event) { event.preventDefault(); showAdminAuthError('Self-service admin registration has been removed. Provision roles through the backend/Firebase Admin workflow.'); };
window.toggleUserRole = function toggleUserRole() { alert('Role changes must be made through an authorized backend endpoint.'); };
window.loadAdminHealth = async function loadAdminHealth() {
  try { const health = await api('/health'); document.getElementById('health-rtdb').innerText = health.status; } catch (_) {}
};
