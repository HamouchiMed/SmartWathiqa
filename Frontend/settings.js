// Settings Page JavaScript

const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

function parseSizeToBytes(sizeValue) {
  if (sizeValue === null || sizeValue === undefined) return 0;

  if (typeof sizeValue === 'number' && Number.isFinite(sizeValue)) {
    return sizeValue;
  }

  const str = String(sizeValue).trim();
  if (!str) return 0;

  // Numeric bytes string
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
  if (t.includes('image') || /(jpg|jpeg|png|gif|bmp|tiff|webp|svg)/.test(t)) {
    return 'images';
  }
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

// Logout function
function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    // Clear any stored session data
    localStorage.clear();
    sessionStorage.clear();

    // Show logout message
    alert('Vous avez été déconnecté avec succès.');

    // Redirect to login page
    window.location.href = 'firstscreen.html';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStorageFromDB().catch(() => {});
});
