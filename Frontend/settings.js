// Settings Page JavaScript

const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const API_BASES = ['http://localhost:3001/api', 'http://127.0.0.1:3001/api'];

function parseSizeToBytes(sizeValue) {
  if (sizeValue === null || sizeValue === undefined) return 0;

  if (typeof sizeValue === 'number' && Number.isFinite(sizeValue)) {
    return sizeValue;
  }

  const str = String(sizeValue).trim();
  if (!str) return 0;

  if (/^\d+(\.\d+)?$/.test(str)) {
    return Number(str);
  }

  const m = str.match(/([\d.]+)\s*(bytes|kb|mb|gb|tb)/i);
  if (!m) return 0;

  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multipliers = {
    bytes: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  };

  return Number.isFinite(value) ? value * (multipliers[unit] || 1) : 0;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 GB';
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** i);
  return `${Math.round(value * 10) / 10} ${units[i]}`;
}

function getStorageBucket(fileType) {
  const t = String(fileType || '').toLowerCase();
  if (t.includes('image') || /(jpg|jpeg|png|gif|bmp|tiff|webp|svg)/.test(t)) return 'images';

  if (
    t.includes('pdf') ||
    t.includes('word') ||
    t.includes('excel') ||
    t.includes('powerpoint') ||
    t.includes('csv') ||
    t.includes('text') ||
    t.includes('texte') ||
    t.includes('archive') ||
    t.includes('zip') ||
    t.includes('rar')
  ) {
    return 'documents';
  }
  return 'others';
}

async function apiRequest(path, options = {}) {
  let lastError = 'Serveur indisponible';

  for (const base of API_BASES) {
    try {
      const response = await fetch(base + path, options);
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }

      if (!json) {
        lastError = `Réponse serveur invalide (HTTP ${response.status})`;
        continue;
      }

      if (!response.ok || !json.success) {
        lastError = json.error || `HTTP ${response.status}`;
        continue;
      }

      return json.data;
    } catch (error) {
      lastError = error.message;
    }
  }

  throw new Error(lastError);
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('currentUser');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setCurrentUser(user) {
  try {
    localStorage.setItem('currentUser', JSON.stringify(user));
  } catch (_) {}
}

function loadProfileUI() {
  const user = getCurrentUser();
  if (!user) return;

  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const phoneEl = document.getElementById('profile-phone');
  const drawerNameEl = document.getElementById('drawer-account-name');
  const drawerEmailEl = document.getElementById('drawer-account-email');

  if (nameEl) nameEl.value = user.name || '';
  if (emailEl) emailEl.value = user.email || '';
  if (phoneEl) phoneEl.value = localStorage.getItem(`profilePhone:${user.id}`) || '';

  if (drawerNameEl) drawerNameEl.textContent = user.name || 'Mon Compte';
  if (drawerEmailEl) drawerEmailEl.textContent = user.email || 'utilisateur@example.com';
}

async function saveProfile() {
  const user = getCurrentUser();
  if (!user || !user.id) {
    alert('Utilisateur non connecté.');
    return;
  }

  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const phoneEl = document.getElementById('profile-phone');
  const msgEl = document.getElementById('profile-save-msg');
  const saveBtn = document.getElementById('save-profile-btn');

  const name = (nameEl?.value || '').trim();
  const email = (emailEl?.value || '').trim();
  const phone = (phoneEl?.value || '').trim();

  if (!name || !email) {
    alert('Nom et email sont obligatoires.');
    return;
  }

  try {
    if (saveBtn) saveBtn.disabled = true;

    const updated = await apiRequest(`/users/${user.id}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });

    localStorage.setItem(`profilePhone:${user.id}`, phone);

    const merged = {
      ...user,
      ...updated,
      id: user.id,
      name,
      email
    };

    setCurrentUser(merged);
    loadProfileUI();

    if (msgEl) {
      msgEl.textContent = 'Profil mis à jour.';
      setTimeout(() => {
        msgEl.textContent = '';
      }, 2200);
    }
  } catch (error) {
    alert(`Erreur profil: ${error.message}`);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function loadStorageFromDB() {
  if (!window.dataSdk || typeof window.dataSdk.getAll !== 'function') return;

  const result = await window.dataSdk.getAll();
  if (!result.isOk || !Array.isArray(result.data)) return;

  let documentsBytes = 0;
  let imagesBytes = 0;
  let othersBytes = 0;

  result.data.forEach((doc) => {
    const bytes = parseSizeToBytes(doc.file_size);
    const bucket = getStorageBucket(doc.file_type);
    if (bucket === 'documents') documentsBytes += bytes;
    else if (bucket === 'images') imagesBytes += bytes;
    else othersBytes += bytes;
  });

  const totalBytes = documentsBytes + imagesBytes + othersBytes;
  const usedPercent = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_BYTES) * 100));

  const usedText = document.getElementById('storage-used-text');
  const usedBar = document.getElementById('storage-used-bar');
  const docsText = document.getElementById('storage-documents');
  const imagesText = document.getElementById('storage-images');
  const othersText = document.getElementById('storage-others');

  if (usedText) usedText.textContent = `${formatBytes(totalBytes)} sur 10 GB`;
  if (usedBar) usedBar.style.width = `${usedPercent}%`;
  if (docsText) docsText.textContent = formatBytes(documentsBytes);
  if (imagesText) imagesText.textContent = formatBytes(imagesBytes);
  if (othersText) othersText.textContent = formatBytes(othersBytes);
}

// Close drawer when clicking outside on mobile
document.addEventListener('click', (e) => {
  const drawer = document.getElementById('drawer');
  if (window.innerWidth < 1024 && drawer && !drawer.contains(e.target)) {
    drawer.classList.add('-translate-x-full');
  }
});

function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    localStorage.clear();
    sessionStorage.clear();
    alert('Vous avez été déconnecté avec succès.');
    window.location.href = 'firstscreen.html';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadProfileUI();

  const saveBtn = document.getElementById('save-profile-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveProfile);

  loadStorageFromDB().catch(() => {});
});
