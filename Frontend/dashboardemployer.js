// Dashboard Employer JavaScript

// State
let documents = [];
let editingDoc = null;
let deletingDoc = null;
let currentRecordCount = 0;

// Default config
const defaultConfig = {
  app_title: 'Gestion des Documents',
  welcome_message: 'Organisez et gérez vos fichiers',
  background_color: '#0f172a',
  surface_color: '#1e293b',
  text_color: '#f1f5f9',
  primary_action_color: '#6366f1',
  secondary_action_color: '#94a3b8',
  font_family: 'DM Sans',
  font_size: 16
};

// Data Handler
const dataHandler = {
  onDataChanged(data) {
    documents = data;
    currentRecordCount = data.length;
    renderDocuments();
    updateStats();
  }
};

// Load documents from API
async function loadDocumentsFromAPI() {
  console.log('Loading dashboard data from database...');

  try {
    // Fetch dashboard statistics from API
    const statsResponse = await smartWathiqaAPI.getDashboardStats();

    if (statsResponse.isOk) {
      const stats = statsResponse.data;
      console.log('Dashboard stats loaded:', stats);

      // Update the statistics display
      document.getElementById('total-docs').textContent = stats.total;
      document.getElementById('pdf-count').textContent = stats.pdf;
      document.getElementById('image-count').textContent = stats.images;
      document.getElementById('other-count').textContent = stats.other;

      // Update chart bars if they exist
      updateChartBars(stats);
    } else {
      console.error('Failed to load dashboard stats:', statsResponse.error);
      showToast('Erreur lors du chargement des statistiques', 'error');
    }

    // Fetch recent documents from API
    const recentResponse = await smartWathiqaAPI.getRecentDocuments({ limit: 5 });

    if (recentResponse.isOk) {
      const recentDocs = recentResponse.data;
      console.log('Recent documents loaded:', recentDocs);

      // Store recent documents globally for rendering
      window.recentDocuments = recentDocs;

      // Render recent documents
      renderRecentDocumentsFromAPI(recentDocs);

      showToast('Données du tableau de bord mises à jour', 'success');
    } else {
      console.error('Failed to load recent documents:', recentResponse.error);
      showToast('Erreur lors du chargement des documents récents', 'error');
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    showToast('Erreur de connexion à la base de données', 'error');
  }
}

// Element SDK Handler
async function onConfigChange(config) {
  const appTitle = document.getElementById('app-title');
  const welcomeMsg = document.getElementById('welcome-message');

  if (appTitle) appTitle.textContent = config.app_title || defaultConfig.app_title;
  if (welcomeMsg) welcomeMsg.textContent = config.welcome_message || defaultConfig.welcome_message;

  // Apply colors
  const bgColor = config.background_color || defaultConfig.background_color;
  const surfaceColor = config.surface_color || defaultConfig.surface_color;
  const textColor = config.text_color || defaultConfig.text_color;
  const primaryColor = config.primary_action_color || defaultConfig.primary_action_color;
  const secondaryColor = config.secondary_action_color || defaultConfig.secondary_action_color;
  const fontFamily = config.font_family || defaultConfig.font_family;
  const fontSize = config.font_size || defaultConfig.font_size;

  document.body.style.fontFamily = `${fontFamily}, sans-serif`;

  const app = document.getElementById('app');
  if (app) app.style.background = `linear-gradient(135deg, ${bgColor} 0%, ${surfaceColor} 50%, #334155 100%)`;

  // Update text colors
  document.querySelectorAll('[style*="color: #f1f5f9"]').forEach(el => {
    el.style.color = textColor;
  });

  // Update primary action colors (buttons)
  document.querySelectorAll('[style*="background: linear-gradient(135deg, #6366f1"]').forEach(el => {
    el.style.background = `linear-gradient(135deg, ${primaryColor} 0%, ${lightenColor(primaryColor, 20)} 100%)`;
  });
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

function mapToCapabilities(config) {
  return {
    recolorables: [
      {
        get: () => config.background_color || defaultConfig.background_color,
        set: (value) => { config.background_color = value; window.elementSdk.setConfig({ background_color: value }); }
      },
      {
        get: () => config.surface_color || defaultConfig.surface_color,
        set: (value) => { config.surface_color = value; window.elementSdk.setConfig({ surface_color: value }); }
      },
      {
        get: () => config.text_color || defaultConfig.text_color,
        set: (value) => { config.text_color = value; window.elementSdk.setConfig({ text_color: value }); }
      },
      {
        get: () => config.primary_action_color || defaultConfig.primary_action_color,
        set: (value) => { config.primary_action_color = value; window.elementSdk.setConfig({ primary_action_color: value }); }
      },
      {
        get: () => config.secondary_action_color || defaultConfig.secondary_action_color,
        set: (value) => { config.secondary_action_color = value; window.elementSdk.setConfig({ secondary_action_color: value }); }
      }
    ],
    borderables: [],
    fontEditable: {
      get: () => config.font_family || defaultConfig.font_family,
      set: (value) => { config.font_family = value; window.elementSdk.setConfig({ font_family: value }); }
    },
    fontSizeable: {
      get: () => config.font_size || defaultConfig.font_size,
      set: (value) => { config.font_size = value; window.elementSdk.setConfig({ font_size: value }); }
    }
  };
}

function mapToEditPanelValues(config) {
  return new Map([
    ['app_title', config.app_title || defaultConfig.app_title],
    ['welcome_message', config.welcome_message || defaultConfig.welcome_message]
  ]);
}

// Initialize SDKs
async function init() {
  if (window.elementSdk) {
    window.elementSdk.init({
      defaultConfig,
      onConfigChange,
      mapToCapabilities,
      mapToEditPanelValues
    });
  }

  if (window.dataSdk) {
    const result = await window.dataSdk.init(dataHandler);
    if (result.isOk) {
      // Load documents from API after successful initialization
      await loadDocumentsFromAPI();
    } else {
      showToast('Erreur de connexion', 'error');
    }
  } else {
    // Load sample documents directly if no dataSdk
    await loadDocumentsFromAPI();
  }

  setupEventListeners();
}

// Get document type icon
function getTypeIcon(type) {
  const icons = {
    'PDF': `<svg class="w-6 h-6" style="color: #ef4444;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>`,
    'Word': `<svg class="w-6 h-6" style="color: #3b82f6;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
    'Excel': `<svg class="w-6 h-6" style="color: #22c55e;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>`,
    'Image': `<svg class="w-6 h-6" style="color: #a855f7;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`,
    'Autre': `<svg class="w-6 h-6" style="color: #f59e0b;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`
  };
  return icons[type] || icons['Autre'];
}

// Get category color
function getCategoryColor(category) {
  const colors = {
    'Travail': { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
    'Personnel': { bg: 'rgba(168, 85, 247, 0.2)', text: '#c084fc' },
    'Finance': { bg: 'rgba(34, 197, 94, 0.2)', text: '#4ade80' },
    'Juridique': { bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171' },
    'Autre': { bg: 'rgba(249, 115, 22, 0.2)', text: '#fb923c' }
  };
  return colors[category] || colors['Autre'];
}

// Format date
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Render documents
function renderRecentDocuments() {
  // Legacy function - now calls the API-based rendering
  if (window.recentDocuments) {
    renderRecentDocumentsFromAPI(window.recentDocuments);
  } else {
    // Fallback to empty state
    const list = document.getElementById('recent-documents-list');
    if (list) {
      list.innerHTML = '<p class="text-sm text-center py-4" style="color: #64748b;">Chargement...</p>';
    }
  }
}

// Render recent documents from API data
function renderRecentDocumentsFromAPI(recentDocs) {
  const list = document.getElementById('recent-documents-list');
  if (!list) return;

  list.innerHTML = '';

  if (!recentDocs || recentDocs.length === 0) {
    list.innerHTML = '<p class="text-sm text-center py-4" style="color: #64748b;">Aucun document récent</p>';
    return;
  }

  recentDocs.forEach(doc => {
    // Normalize file type for icon display
    const normalizedType = normalizeFileType(doc.file_type);
    const catColor = getCategoryColor(doc.category_name || 'Autre');
    const item = document.createElement('div');
    item.className = 'flex items-center gap-4 p-3 rounded-lg transition-colors hover:bg-gray-50 cursor-pointer';
    item.style.cssText = 'background: #ffffff; border: 1px solid #f1f5f9;';
    item.onclick = () => viewDocument(doc.id);
    item.innerHTML = `
      <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background: rgba(99, 102, 241, 0.1);">
        ${getTypeIcon(normalizedType)}
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="text-sm font-medium truncate" style="color: #1e293b;">${doc.name}</h4>
        <div class="flex items-center gap-2 mt-1">
          <span class="category-pill px-2 py-0.5 rounded text-xs font-medium" style="background: ${catColor.bg}; color: ${catColor.text};">${doc.category_name || 'Autre'}</span>
          <span class="text-xs" style="color: #64748b;">${formatDate(doc.created_at)}</span>
        </div>
      </div>
      <div class="text-xs text-right" style="color: #64748b;">
        <div>${doc.file_size || '-'}</div>
      </div>
    `;
    list.appendChild(item);
  });
}

// Normalize file type from database to display format
function normalizeFileType(fileType) {
  if (!fileType) return 'Autre';

  const type = fileType.toLowerCase();
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('doc') || type.includes('word')) return 'Word';
  if (type.includes('xls') || type.includes('excel')) return 'Excel';
  if (type.includes('jpg') || type.includes('jpeg') || type.includes('png') || type.includes('gif') || type.includes('bmp') || type.includes('tiff')) return 'Image';
  return 'Autre';
}

function renderDocuments() {
  // For dashboard, we don't need the full grid anymore since we have the recent documents list
  // This function is kept for compatibility but now just updates the recent documents
  renderRecentDocuments();
}

// Show limit warning if needed
const limitWarning = document.getElementById('limit-warning');
if (currentRecordCount >= 999) {
  limitWarning.classList.remove('hidden');
} else {
  limitWarning.classList.add('hidden');
}

// Update chart bars based on statistics
function updateChartBars(stats) {
  const total = stats.total;
  if (total > 0) {
    const pdfPercent = Math.round((stats.pdf / total) * 100);
    const imagePercent = Math.round((stats.images / total) * 100);
    const otherPercent = Math.round((stats.other / total) * 100);

    // Update chart bars if they exist in the DOM
    const pdfBar = document.getElementById('pdf-bar');
    const imageBar = document.getElementById('image-bar');
    const otherBar = document.getElementById('other-bar');

    if (pdfBar) pdfBar.style.width = `${pdfPercent}%`;
    if (imageBar) imageBar.style.width = `${imagePercent}%`;
    if (otherBar) otherBar.style.width = `${otherPercent}%`;

    // Update percentages if they exist
    const pdfPercentEl = document.getElementById('pdf-percent');
    const imagePercentEl = document.getElementById('image-percent');
    const otherPercentEl = document.getElementById('other-percent');

    if (pdfPercentEl) pdfPercentEl.textContent = `${pdfPercent}%`;
    if (imagePercentEl) imagePercentEl.textContent = `${imagePercent}%`;
    if (otherPercentEl) otherPercentEl.textContent = `${otherPercent}%`;
  }
}

// Update statistics (legacy function - now stats are updated directly from API)
function updateStats() {
  // Statistics are now updated directly in loadDocumentsFromAPI()
  // This function is kept for backward compatibility
  console.log('updateStats called - stats are managed by loadDocumentsFromAPI()');
}

// Quick action functions
function showRecentActivity() {
  showToast('Affichage de l\'activité récente', 'info');
  // Could expand this to show a detailed activity modal
}

function showStorageUsage() {
  const totalSize = documents.reduce((sum, doc) => {
    const size = doc.size || '0 MB';
    const numSize = parseFloat(size.replace(/[^\d.]/g, '')) || 0;
    return sum + numSize;
  }, 0);

  showToast(`Espace utilisé: ${totalSize.toFixed(1)} MB sur 100 MB`, 'info');
  // Could expand this to show a detailed storage modal
}

function viewDocument(id) {
  // For database documents, show a toast and could expand to show document preview
  showToast(`Ouverture du document ID: ${id}`, 'info');
  // Could expand this to fetch document details and show preview modal
  // For now, just show the document ID
}

// Modal functions
function openModal(doc = null) {
  editingDoc = doc;
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const submitText = document.getElementById('submit-text');
  const form = document.getElementById('doc-form');
  const fileInput = document.getElementById('doc-file');

  if (doc) {
    title.textContent = 'Modifier le document';
    submitText.textContent = 'Enregistrer';
    document.getElementById('doc-name').value = doc.name;
    document.getElementById('doc-type').value = doc.type;
    document.getElementById('doc-category').value = doc.category;
    document.getElementById('doc-size').value = doc.size || '';
    document.getElementById('doc-description').value = doc.description || '';
    fileInput.required = false;
  } else {
    title.textContent = 'Nouveau Document';
    submitText.textContent = 'Ajouter le document';
    form.reset();
    fileInput.required = true;
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editingDoc = null;
}

function editDocument(id) {
  const doc = documents.find(d => d.__backendId === id);
  if (doc) openModal(doc);
}

function confirmDelete(id) {
  deletingDoc = documents.find(d => d.__backendId === id);
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  deletingDoc = null;
}

// Toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  toastMessage.textContent = message;

  if (type === 'success') {
    toastIcon.style.background = 'rgba(34, 197, 94, 0.2)';
    toastIcon.innerHTML = `<svg class="w-5 h-5" style="color: #4ade80;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
  } else {
    toastIcon.style.background = 'rgba(239, 68, 68, 0.2)';
    toastIcon.innerHTML = `<svg class="w-5 h-5" style="color: #f87171;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
  }

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Setup event listeners
function setupEventListeners() {
  // Add document buttons
  document.getElementById('add-doc-btn').addEventListener('click', () => {
    if (currentRecordCount >= 999) {
      showToast('Limite de 999 documents atteinte', 'error');
      return;
    }
    openModal();
  });

  document.getElementById('add-first-doc').addEventListener('click', () => {
    if (currentRecordCount >= 999) {
      showToast('Limite de 999 documents atteinte', 'error');
      return;
    }
    openModal();
  });

  // Form submission
  document.getElementById('doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submit-btn');
    const submitText = document.getElementById('submit-text');
    const submitSpinner = document.getElementById('submit-spinner');
    const fileInput = document.getElementById('doc-file');
    const file = fileInput.files[0];

    if (!editingDoc && !file) {
      showToast('Veuillez sélectionner un fichier', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitSpinner.classList.remove('hidden');

    const docData = {
      name: document.getElementById('doc-name').value.trim(),
      type: document.getElementById('doc-type').value,
      category: document.getElementById('doc-category').value,
      size: file ? (file.size / (1024 * 1024)).toFixed(2) + ' MB' : document.getElementById('doc-size').value.trim(),
      description: document.getElementById('doc-description').value.trim(),
      createdAt: editingDoc ? editingDoc.createdAt : new Date().toISOString(),
      fileName: file ? file.name : undefined
    };

    try {
      let result;
      if (editingDoc) {
        result = await window.dataSdk.update({ ...editingDoc, ...docData });
      } else {
        if (currentRecordCount >= 999) {
          showToast('Limite de 999 documents atteinte', 'error');
          return;
        }
        result = await window.dataSdk.create(docData);
      }

      if (result.isOk) {
        showToast(editingDoc ? 'Document modifié' : 'Document ajouté avec succès');
        closeModal();
        // Reload documents from API
        await loadDocumentsFromAPI();
      } else {
        showToast('Une erreur est survenue', 'error');
      }
    } catch (err) {
      showToast('Une erreur est survenue', 'error');
    } finally {
      submitBtn.disabled = false;
      submitText.classList.remove('hidden');
      submitSpinner.classList.add('hidden');
    }
  });

  // Delete confirmation
  document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
    if (!deletingDoc) return;

    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Suppression...';

    try {
      const result = await window.dataSdk.delete(deletingDoc);
      if (result.isOk) {
        showToast('Document supprimé');
        closeDeleteModal();
        // Reload documents from API
        await loadDocumentsFromAPI();
      } else {
        showToast('Erreur lors de la suppression', 'error');
      }
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Supprimer';
    }
  });

  // Search and filter
  document.getElementById('search-input').addEventListener('input', renderDocuments);
  document.getElementById('category-filter').addEventListener('change', renderDocuments);
  document.getElementById('date-filter').addEventListener('change', renderDocuments);
}

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

// Initialize app
init();