// Documents Page JavaScript

// State
let documents = [];
let editingDoc = null;
let deletingDoc = null;
let currentRecordCount = 0;
let selectedDocuments = new Set();

function getStoredFavoriteIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('favoriteDocIds') || '[]').map(String));
  } catch {
    return new Set();
  }
}

function persistFavoriteIds(idsSet) {
  localStorage.setItem('favoriteDocIds', JSON.stringify([...idsSet]));
}

// Default config
const defaultConfig = {
  app_title: 'Mes Documents',
  welcome_message: 'Consultez et gérez vos documents',
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
  console.log('Loading documents from database...');
  try {
    const result = await window.dataSdk.getAll();

    if (result.isOk) {
      const storedFavorites = getStoredFavoriteIds();
      // Transform API data to frontend format
      documents = result.data.map(doc => ({
        id: doc.id,
        __backendId: doc.id.toString(),
        createdAt: doc.created_at,
        type: getFileTypeFromExtension(doc.file_name),
        size: formatFileSize(doc.file_size),
        category: doc.category_name || doc.category || 'Autre',
        name: doc.name,
        description: doc.description,
        fileName: doc.file_name,
        filePath: doc.file_path || '',
        isFavorite: Boolean(doc.is_favorite) || storedFavorites.has(String(doc.id))
      }));

      const mergedFavorites = new Set(
        documents.filter(d => d.isFavorite).map(d => String(d.id || d.__backendId))
      );
      persistFavoriteIds(mergedFavorites);

      currentRecordCount = documents.length;
      console.log('Documents loaded from database:', documents.length);
      renderDocuments();
      updateStats();
      showToast(`${documents.length} document(s) chargé(s) depuis la base de données`, 'success');
    } else {
      console.error('Failed to load documents:', result.error);
      showToast('Erreur lors du chargement des documents', 'error');
      // Fallback to sample data if API fails
      loadSampleData();
    }
  } catch (error) {
    console.error('Error loading documents:', error);
    showToast('Erreur de connexion à la base de données', 'error');
    // Fallback to sample data if API fails
    loadSampleData();
  }
}

function loadSampleData() {
  console.log('Loading sample data as fallback...');
  documents = [
    {
      __backendId: '1',
      createdAt: '2024-01-15T10:30:00Z',
      type: 'PDF',
      size: '2.5 MB',
      category: 'Travail',
      name: 'Rapport Annuel 2024',
      description: 'Rapport annuel de l\'entreprise pour l\'année 2024',
      fileName: 'rapport_annuel_2024.pdf'
    },
    {
      __backendId: '2',
      createdAt: '2024-02-20T14:15:00Z',
      type: 'Word',
      size: '1.2 MB',
      category: 'Juridique',
      name: 'Contrat de Partenariat',
      description: 'Contrat de partenariat avec l\'entreprise XYZ',
      fileName: 'contrat_partenariat_xyz.docx'
    },
    {
      __backendId: '3',
      createdAt: '2024-03-10T09:45:00Z',
      type: 'Excel',
      size: '850 KB',
      category: 'Finance',
      name: 'Budget Q1 2024',
      description: 'Budget prévisionnel pour le premier trimestre 2024',
      fileName: 'budget_q1_2024.xlsx'
    },
    {
      __backendId: '4',
      createdAt: '2024-04-05T16:20:00Z',
      type: 'Image',
      size: '3.1 MB',
      category: 'Personnel',
      name: 'Photo Équipe',
      description: 'Photo de groupe de l\'équipe lors de la réunion annuelle',
      fileName: 'photo_equipe_2024.jpg'
    },
    {
      __backendId: '5',
      createdAt: '2024-05-12T11:00:00Z',
      type: 'PDF',
      size: '1.8 MB',
      category: 'Autre',
      name: 'Guide Utilisateur',
      description: 'Guide d\'utilisation du nouveau système de gestion',
      fileName: 'guide_utilisateur_v2.pdf'
    }
  ];

  currentRecordCount = documents.length;
  renderDocuments();
  updateStats();
  showToast('Documents d\'exemple chargés', 'success');
}

function getFileTypeFromExtension(fileName) {
  if (!fileName) return 'Autre';

  const extension = fileName.split('.').pop().toLowerCase();
  const typeMap = {
    'pdf': 'PDF',
    'doc': 'Word',
    'docx': 'Word',
    'xls': 'Excel',
    'xlsx': 'Excel',
    'jpg': 'Image',
    'jpeg': 'Image',
    'png': 'Image',
    'gif': 'Image',
    'bmp': 'Image'
  };

  return typeMap[extension] || 'Autre';
}

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '-';

  // If backend already returns a formatted size like "2.34 MB", keep it.
  if (typeof bytes === 'string' && /[a-zA-Z]/.test(bytes)) {
    return bytes;
  }

  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value === 0) return '0 Bytes';

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), sizes.length - 1);
  return `${Math.round((value / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
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

function updateFavoritesModeUI() {
  const isFavoritesMode = (window.location.hash || '').toLowerCase() === '#favoris';
  const filtersPanel = document.getElementById('filters-panel');
  if (filtersPanel) {
    filtersPanel.style.display = isFavoritesMode ? 'none' : '';
  }
}

// Render documents
function renderDocuments() {
  updateFavoritesModeUI();
  const grid = document.getElementById('documents-grid');
  const emptyState = document.getElementById('empty-state');
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const categoryFilter = document.getElementById('category-filter').value;
  const typeFilter = document.getElementById('type-filter').value;
  const sortFilter = document.getElementById('sort-filter').value;
  const dateFrom = document.getElementById('date-from').value;
  const dateTo = document.getElementById('date-to').value;
  const sizeFilter = document.getElementById('size-filter').value;

  let filteredDocs = documents.filter(doc => {
    const favoritesOnly = (window.location.hash || '').toLowerCase() === '#favoris';
    const matchesSearch = doc.name.toLowerCase().includes(searchTerm) ||
                          (doc.description && doc.description.toLowerCase().includes(searchTerm));
    const matchesCategory = categoryFilter === 'all' || doc.category === categoryFilter;
    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const matchesFavorites = !favoritesOnly || doc.isFavorite;

    // Date range filter
    let matchesDateRange = true;
    if (dateFrom || dateTo) {
      const docDate = new Date(doc.createdAt);
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        matchesDateRange = matchesDateRange && docDate >= fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999); // End of day
        matchesDateRange = matchesDateRange && docDate <= toDate;
      }
    }

    // Size filter
    let matchesSize = true;
    if (sizeFilter !== 'all') {
      const maxSize = parseInt(sizeFilter);
      const docSize = parseFloat((doc.size || '0 MB').replace(/[^\d.]/g, '')) || 0;
      matchesSize = docSize <= maxSize;
    }

    return matchesSearch && matchesCategory && matchesType && matchesDateRange && matchesSize && matchesFavorites;
  });

  // Apply sorting
  filteredDocs.sort((a, b) => {
    switch (sortFilter) {
      case 'date-desc':
        return new Date(b.createdAt) - new Date(a.createdAt);
      case 'date-asc':
        return new Date(a.createdAt) - new Date(b.createdAt);
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'size-desc':
        const sizeA = parseFloat((a.size || '0 MB').replace(/[^\d.]/g, '')) || 0;
        const sizeB = parseFloat((b.size || '0 MB').replace(/[^\d.]/g, '')) || 0;
        return sizeB - sizeA;
      case 'size-asc':
        const sizeA2 = parseFloat((a.size || '0 MB').replace(/[^\d.]/g, '')) || 0;
        const sizeB2 = parseFloat((b.size || '0 MB').replace(/[^\d.]/g, '')) || 0;
        return sizeA2 - sizeB2;
      default:
        return 0;
    }
  });

  if (documents.length === 0) {
    grid.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Update existing or create new elements
  const existingCards = new Map([...grid.children].map(el => [el.dataset.id, el]));

  filteredDocs.forEach(doc => {
    const catColor = getCategoryColor(doc.category);

    if (existingCards.has(doc.__backendId)) {
      // Update existing card
      const card = existingCards.get(doc.__backendId);
      const checkbox = card.querySelector('.doc-checkbox');
      const nameEl = card.querySelector('.doc-name');
      const typeIcon = card.querySelector('.doc-type-icon');
      const categoryEl = card.querySelector('.doc-category');
      const dateEl = card.querySelector('.doc-date');
      const sizeEl = card.querySelector('.doc-size');
      const favoriteBtn = card.querySelector('.favorite-btn');

      nameEl.textContent = `${doc.isFavorite ? '⭐ ' : ''}${doc.name}`;
      typeIcon.innerHTML = getTypeIcon(doc.type);
      categoryEl.textContent = doc.category;
      categoryEl.style.background = catColor.bg;
      categoryEl.style.color = catColor.text;
      dateEl.textContent = formatDate(doc.createdAt);
      sizeEl.textContent = doc.size || '-';
      if (favoriteBtn) {
        favoriteBtn.style.color = doc.isFavorite ? '#f59e0b' : '#94a3b8';
      }

      // Reset checkbox state
      checkbox.checked = selectedDocuments.has(doc.__backendId);
      existingCards.delete(doc.__backendId);
    } else {
      // Create new card
      const card = document.createElement('div');
      card.className = 'doc-card rounded-2xl border p-5 cursor-pointer relative';
      card.style.cssText = 'background: #ffffff; border-color: #e2e8f0; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);';
      card.dataset.id = doc.__backendId;
      card.innerHTML = `
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <input type="checkbox" class="doc-checkbox w-4 h-4 rounded border-2 focus:ring-2 transition-all cursor-pointer" style="border-color: #cbd5e1; --tw-ring-color: #6366f1;" onclick="event.stopPropagation()" onchange="toggleDocumentSelection('${doc.__backendId}')">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center doc-type-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
              ${getTypeIcon(doc.type)}
            </div>
          </div>
          <div class="flex gap-1">
            <button onclick="event.stopPropagation(); toggleDocumentFavorite('${doc.__backendId}')" class="favorite-btn p-2 rounded-lg transition-colors hover:bg-amber-100" style="color: ${doc.isFavorite ? '#f59e0b' : '#94a3b8'};" aria-label="Favori">
              <svg class="w-4 h-4" fill="${doc.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81H7.03a1 1 0 00.95-.69l1.07-3.292z"/>
              </svg>
            </button>
            <button onclick="event.stopPropagation(); viewDocument('${doc.__backendId}')" class="p-2 rounded-lg transition-colors hover:bg-blue-100" style="color: #3b82f6;" aria-label="Voir">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
            </button>
          </div>
        </div>
        <h3 class="doc-name text-lg font-semibold mb-2 truncate" style="color: #1e293b;">${doc.isFavorite ? '⭐ ' : ''}${doc.name}</h3>
        <div class="flex items-center gap-2 mb-3">
          <span class="doc-category category-pill px-3 py-1 rounded-full text-xs font-medium" style="background: ${catColor.bg}; color: ${catColor.text};">${doc.category}</span>
          <span class="text-xs px-2 py-1 rounded-full" style="background: rgba(156, 163, 175, 0.1); color: #6b7280;">${doc.type}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm" style="color: #94a3b8;">
          <div>
            <span class="font-medium">Créé:</span><br>
            <span class="doc-date">${formatDate(doc.createdAt)}</span>
          </div>
          <div>
            <span class="font-medium">Taille:</span><br>
            <span class="doc-size">${doc.size || '-'}</span>
          </div>
        </div>
        ${doc.description ? `<div class="mt-3 pt-3 border-t text-sm" style="border-color: #f1f5f9; color: #64748b;"><span class="font-medium">Description:</span> ${doc.description}</div>` : ''}
      `;
      card.onclick = null;
      grid.appendChild(card);
    }
  });

  // Remove cards not in filtered list
  existingCards.forEach(card => card.remove());

  // Update bulk actions visibility
  updateBulkActionsVisibility();

  // Show limit warning if needed
  const limitWarning = document.getElementById('limit-warning');
  if (currentRecordCount >= 999) {
    limitWarning.classList.remove('hidden');
  } else {
    limitWarning.classList.add('hidden');
  }
}

// Update statistics
function updateStats() {
  // No stats on this page
}

// Bulk selection functions
function toggleDocumentSelection(docId) {
  if (selectedDocuments.has(docId)) {
    selectedDocuments.delete(docId);
  } else {
    selectedDocuments.add(docId);
  }
  updateBulkActionsVisibility();
  updateSelectAllCheckbox();
}

function updateBulkActionsVisibility() {
  const bulkActions = document.getElementById('bulk-actions');
  if (selectedDocuments.size > 0) {
    bulkActions.classList.remove('hidden');
  } else {
    bulkActions.classList.add('hidden');
  }
}

function updateSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById('select-all');
  const visibleCheckboxes = document.querySelectorAll('.doc-checkbox');
  const checkedCheckboxes = document.querySelectorAll('.doc-checkbox:checked');

  selectAllCheckbox.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.length === checkedCheckboxes.length;
  selectAllCheckbox.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < visibleCheckboxes.length;
}

function selectAllDocuments() {
  const selectAllCheckbox = document.getElementById('select-all');
  const visibleCheckboxes = document.querySelectorAll('.doc-checkbox');

  if (selectAllCheckbox.checked) {
    visibleCheckboxes.forEach(checkbox => {
      const docId = checkbox.closest('.doc-card').dataset.id;
      selectedDocuments.add(docId);
      checkbox.checked = true;
    });
  } else {
    visibleCheckboxes.forEach(checkbox => {
      const docId = checkbox.closest('.doc-card').dataset.id;
      selectedDocuments.delete(docId);
      checkbox.checked = false;
    });
  }
  updateBulkActionsVisibility();
}

// Bulk actions
async function bulkDelete() {
  if (selectedDocuments.size === 0) return;

  const count = selectedDocuments.size;
  if (confirm(`Êtes-vous sûr de vouloir supprimer ${count} document(s) ? Cette action est irréversible.`)) {
    let deleted = 0;
    let failed = 0;

    for (const docId of selectedDocuments) {
      const doc = documents.find(d => d.__backendId === docId);
      if (!doc) {
        failed++;
        continue;
      }

      const result = await window.dataSdk.delete({ id: doc.id || Number(doc.__backendId) });
      if (result.isOk) {
        deleted++;
      } else {
        failed++;
      }
    }

    selectedDocuments.clear();
    await loadDocumentsFromAPI();

    if (failed === 0) {
      showToast(`${deleted} document(s) supprimé(s)`, 'success');
    } else {
      showToast(`${deleted} supprimé(s), ${failed} échec(s)`, 'error');
    }
  }
}

function bulkTag() {
  if (selectedDocuments.size === 0) return;

  const category = prompt('Entrez la nouvelle catégorie pour les documents sélectionnés:');
  if (category && category.trim()) {
    selectedDocuments.forEach(docId => {
      const doc = documents.find(d => d.__backendId === docId);
      if (doc) {
        doc.category = category.trim();
      }
    });
    selectedDocuments.clear();
    renderDocuments();
    showToast(`${selectedDocuments.size} document(s) tagué(s)`, 'success');
  }
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('category-filter').value = 'all';
  document.getElementById('type-filter').value = 'all';
  document.getElementById('sort-filter').value = 'date-desc';
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value = '';
  document.getElementById('size-filter').value = 'all';
  renderDocuments();
}

function viewDocument(id) {
  smartWathiqaAPI.getDocument(id).then((result) => {
    if (!result.isOk || !result.data) {
      showToast('Impossible d\'ouvrir ce document', 'error');
      return;
    }

    const fileUrl = smartWathiqaAPI.getFileUrl(result.data.file_path);
    if (!fileUrl) {
      showToast('Ce document n\'a pas de fichier associé', 'error');
      return;
    }

    window.open(fileUrl, '_blank', 'noopener');
  }).catch(() => {
    showToast('Erreur lors de l\'ouverture du document', 'error');
  });
}

async function toggleDocumentFavorite(docId) {
  const doc = documents.find(d => d.__backendId === docId);
  if (!doc) return;

  const nextFavorite = !doc.isFavorite;
  const result = await window.dataSdk.toggleFavorite(doc.id || Number(doc.__backendId), nextFavorite);
  if (!result.isOk) {
    showToast('Erreur lors de la mise à jour du favori', 'error');
    return;
  }

  doc.isFavorite = nextFavorite;
  const storedFavorites = getStoredFavoriteIds();
  const key = String(doc.id || doc.__backendId);
  if (nextFavorite) {
    storedFavorites.add(key);
  } else {
    storedFavorites.delete(key);
  }
  persistFavoriteIds(storedFavorites);
  renderDocuments();
}

async function bulkFavorite() {
  if (selectedDocuments.size === 0) return;

  const storedFavorites = getStoredFavoriteIds();
  let updated = 0;
  for (const docId of selectedDocuments) {
    const doc = documents.find(d => d.__backendId === docId);
    if (!doc) continue;

    const result = await window.dataSdk.toggleFavorite(doc.id || Number(doc.__backendId), true);
    if (result.isOk) {
      doc.isFavorite = true;
      storedFavorites.add(String(doc.id || doc.__backendId));
      updated++;
    }
  }

  persistFavoriteIds(storedFavorites);
  selectedDocuments.clear();
  renderDocuments();
  showToast(`${updated} document(s) ajouté(s) aux favoris`, updated > 0 ? 'success' : 'error');
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
  const doc = documents.find(d =>
    String(d.__backendId) === String(id) || String(d.id) === String(id)
  );
  if (!doc) {
    showToast('Document introuvable', 'error');
    return;
  }
  openModal(doc);
}

function confirmDelete(id) {
  deletingDoc = documents.find(d => d.__backendId === id);
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  deletingDoc = null;
}

async function handleDeleteConfirm() {
  if (!deletingDoc) return;

  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true;
  btn.textContent = 'Suppression...';

  try {
    const result = await window.dataSdk.delete({ id: deletingDoc.id || Number(deletingDoc.__backendId) });
    if (result.isOk) {
      showToast('Document supprimé');
      closeDeleteModal();
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
  // Add document button (optional, might be hidden in UI)
  const addFirstDocBtn = document.getElementById('add-first-doc');
  if (addFirstDocBtn) {
    addFirstDocBtn.addEventListener('click', () => {
      if (currentRecordCount >= 999) {
        showToast('Limite de 999 documents atteinte', 'error');
        return;
      }
      openModal();
    });
  }

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
  document.getElementById('confirm-delete-btn').onclick = handleDeleteConfirm;

  // Bulk actions
  document.getElementById('select-all').addEventListener('change', selectAllDocuments);
  document.getElementById('bulk-delete').addEventListener('click', bulkDelete);
  document.getElementById('bulk-tag').addEventListener('click', bulkTag);
  document.getElementById('clear-filters').addEventListener('click', clearFilters);

  // Search and filters
  document.getElementById('search-input').addEventListener('input', renderDocuments);
  document.getElementById('category-filter').addEventListener('change', renderDocuments);
  document.getElementById('type-filter').addEventListener('change', renderDocuments);
  document.getElementById('sort-filter').addEventListener('change', renderDocuments);
  document.getElementById('date-from').addEventListener('change', renderDocuments);
  document.getElementById('date-to').addEventListener('change', renderDocuments);
  document.getElementById('size-filter').addEventListener('change', renderDocuments);
  window.addEventListener('hashchange', renderDocuments);
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

