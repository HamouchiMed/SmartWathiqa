    // Application state
    let documents = [];
    let filteredDocuments = [];
    let documentToDelete = null;
    let isEditing = false;

    const defaultConfig = {
      app_title: 'Gestionnaire de Documents',
      welcome_message: 'Bienvenue dans votre espace documents',
      add_button_text: 'Nouveau Document',
      background_color: '#0f172a',
      surface_color: '#1e293b',
      text_color: '#f8fafc',
      primary_action_color: '#6366f1',
      secondary_action_color: '#64748b'
    };

    // Category styles
    const categoryStyles = {
      contrat: { icon: '', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
      facture: { icon: '', bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
      rapport: { icon: '', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
      presentation: { icon: 'ï¸', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
      autre: { icon: '', bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30' }
    };

    // File type icons
    const typeIcons = {
      pdf: '',
      doc: '',
      xls: '',
      ppt: '',
      img: 'ï¸',
      other: ''
    };

    // Initialize Element SDK
    const elementConfig = { ...defaultConfig };

    async function onConfigChange(config) {
      const title = config.app_title || defaultConfig.app_title;
      const welcome = config.welcome_message || defaultConfig.welcome_message;
      const addBtn = config.add_button_text || defaultConfig.add_button_text;

      document.getElementById('app-title').textContent = ' ' + title;
      document.getElementById('welcome-message').textContent = welcome;
      document.getElementById('add-button-text').textContent = addBtn;

      // Apply colors
      const bgColor = config.background_color || defaultConfig.background_color;
      const surfaceColor = config.surface_color || defaultConfig.surface_color;
      const textColor = config.text_color || defaultConfig.text_color;
      const primaryColor = config.primary_action_color || defaultConfig.primary_action_color;
      const secondaryColor = config.secondary_action_color || defaultConfig.secondary_action_color;

      document.body.style.backgroundColor = bgColor;

      document.querySelectorAll('.btn-primary').forEach(btn => {
        btn.style.backgroundColor = primaryColor;
      });

      document.querySelectorAll('h1, h3, .text-white').forEach(el => {
        el.style.color = textColor;
      });
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
          get: () => config.font_family || 'Outfit',
          set: (value) => { config.font_family = value; window.elementSdk.setConfig({ font_family: value }); }
        },
        fontSizeable: {
          get: () => config.font_size || 16,
          set: (value) => { config.font_size = value; window.elementSdk.setConfig({ font_size: value }); }
        }
      };
    }

    function mapToEditPanelValues(config) {
      return new Map([
        ['app_title', config.app_title || defaultConfig.app_title],
        ['welcome_message', config.welcome_message || defaultConfig.welcome_message],
        ['add_button_text', config.add_button_text || defaultConfig.add_button_text]
      ]);
    }

    // Data SDK handler
    const dataHandler = {
      onDataChanged(data) {
        documents = data;
        filterDocuments();
        updateStats();
        checkLimit();
      }
    };

    // Initialize SDKs
    async function initApp() {
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
        if (!result.isOk) {
          showToast('Erreur de connexion aux donnÃ©es', 'error');
        }
      }
    }

    // Document rendering
    function renderDocuments() {
      const grid = document.getElementById('documents-grid');
      const emptyState = document.getElementById('empty-state');
      const noResults = document.getElementById('no-results');

      if (documents.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.remove('hidden');
        noResults.classList.add('hidden');
        return;
      }

      emptyState.classList.add('hidden');

      if (filteredDocuments.length === 0) {
        grid.innerHTML = '';
        noResults.classList.remove('hidden');
        return;
      }

      noResults.classList.add('hidden');

      // Create a map of existing cards
      const existingCards = new Map(
        [...grid.children].map(el => [el.dataset.docId, el])
      );

      // Update or create cards
      filteredDocuments.forEach((doc, index) => {
        const existingCard = existingCards.get(doc.__backendId);

        if (existingCard) {
          updateDocCard(existingCard, doc);
          existingCards.delete(doc.__backendId);
        } else {
          const newCard = createDocCard(doc, index);
          grid.appendChild(newCard);
        }
      });

      // Remove deleted cards
      existingCards.forEach(card => card.remove());

      // Reorder cards
      filteredDocuments.forEach((doc, index) => {
        const card = grid.querySelector(`[data-doc-id="${doc.__backendId}"]`);
        if (card && card !== grid.children[index]) {
          grid.insertBefore(card, grid.children[index]);
        }
      });
    }

    function createDocCard(doc, index) {
      const style = categoryStyles[doc.category] || categoryStyles.autre;
      const typeIcon = typeIcons[doc.type] || typeIcons.other;
      const date = new Date(doc.createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      const card = document.createElement('div');
      card.className = `doc-card bg-slate-800/50 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 hover:border-indigo-500/50 cursor-pointer`;
      card.dataset.docId = doc.__backendId;
      card.style.animationDelay = `${index * 0.05}s`;
      card.onclick = () => openEditModal(doc);

      card.innerHTML = `
        <div class="flex items-start justify-between mb-4">
          <div class="w-12 h-12 ${style.bg} rounded-xl flex items-center justify-center text-2xl">
            ${typeIcon}
          </div>
          <span class="category-badge ${style.bg} ${style.text} ${style.border} border px-3 py-1 rounded-full text-xs font-medium">
            ${style.icon} ${doc.category}
          </span>
        </div>
        <h3 class="doc-name text-lg font-semibold text-white mb-2 line-clamp-2">${escapeHtml(doc.name)}</h3>
        <p class="doc-description text-slate-400 text-sm mb-4 line-clamp-2">${doc.description ? escapeHtml(doc.description) : 'Aucune description'}</p>
        <div class="flex items-center justify-between text-xs text-slate-500">
          <span class="doc-date">${date}</span>
          <span class="doc-size">${doc.size || 'â€”'}</span>
        </div>
        <div class="flex gap-2 mt-4 pt-4 border-t border-slate-700/50">
          <button onclick="event.stopPropagation(); openEditModal(documents.find(d => d.__backendId === '${doc.__backendId}'))"
            class="flex-1 px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-lg text-sm font-medium transition-colors">
            âœï¸ Modifier
          </button>
          <button onclick="event.stopPropagation(); openDeleteModal(documents.find(d => d.__backendId === '${doc.__backendId}'))"
            class="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors">
            ï¸
          </button>
        </div>
      `;

      return card;
    }

    function updateDocCard(card, doc) {
      const style = categoryStyles[doc.category] || categoryStyles.autre;
      const date = new Date(doc.createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      card.querySelector('.doc-name').textContent = doc.name;
      card.querySelector('.doc-description').textContent = doc.description || 'Aucune description';
      card.querySelector('.doc-date').textContent = date;
      card.querySelector('.doc-size').textContent = doc.size || 'â€”';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Filtering
    function filterDocuments() {
      const searchTerm = document.getElementById('search-input').value.toLowerCase();
      const categoryFilter = document.getElementById('category-filter').value;

      filteredDocuments = documents.filter(doc => {
        const matchesSearch = doc.name.toLowerCase().includes(searchTerm) ||
          (doc.description && doc.description.toLowerCase().includes(searchTerm));
        const matchesCategory = categoryFilter === 'all' || doc.category === categoryFilter;
        return matchesSearch && matchesCategory;
      });

      // Sort by date (newest first)
      filteredDocuments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      renderDocuments();
    }

    // Statistics
    function updateStats() {
      document.getElementById('stat-total').textContent = documents.length;
      document.getElementById('stat-contrats').textContent = documents.filter(d => d.category === 'contrat').length;
      document.getElementById('stat-factures').textContent = documents.filter(d => d.category === 'facture').length;
      document.getElementById('stat-rapports').textContent = documents.filter(d => d.category === 'rapport').length;
    }

    // Limit check
    function checkLimit() {
      const warning = document.getElementById('limit-warning');
      const addBtn = document.getElementById('add-doc-btn');

      if (documents.length >= 999) {
        warning.classList.remove('hidden');
        addBtn.disabled = true;
        addBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        warning.classList.add('hidden');
        addBtn.disabled = false;
        addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    // Modal functions
    function openAddModal() {
      if (documents.length >= 999) {
        showToast('Limite de 999 documents atteinte', 'error');
        return;
      }

      isEditing = false;
      document.getElementById('modal-title').textContent = 'Nouveau Document';
      document.getElementById('submit-text').textContent = 'Ajouter';
      document.getElementById('doc-form').reset();
      document.getElementById('doc-id').value = '';
      document.getElementById('modal').classList.remove('hidden');
    }

    function openEditModal(doc) {
      isEditing = true;
      document.getElementById('modal-title').textContent = 'Modifier le Document';
      document.getElementById('submit-text').textContent = 'Enregistrer';
      document.getElementById('doc-id').value = doc.__backendId;
      document.getElementById('doc-name').value = doc.name;
      document.getElementById('doc-category').value = doc.category;
      document.getElementById('doc-type').value = doc.type || 'pdf';
      document.getElementById('doc-size').value = doc.size || '';
      document.getElementById('doc-description').value = doc.description || '';
      document.getElementById('modal').classList.remove('hidden');
    }

    function closeModal() {
      document.getElementById('modal').classList.add('hidden');
    }

    function openDeleteModal(doc) {
      documentToDelete = doc;
      document.getElementById('delete-doc-name').textContent = `"${doc.name}" sera dÃ©finitivement supprimÃ©.`;
      document.getElementById('delete-modal').classList.remove('hidden');
    }

    function closeDeleteModal() {
      document.getElementById('delete-modal').classList.add('hidden');
      documentToDelete = null;
    }

    // Form submission
    async function handleSubmit(event) {
      event.preventDefault();

      const submitBtn = document.getElementById('submit-btn');
      const submitText = document.getElementById('submit-text');

      submitBtn.disabled = true;
      submitText.textContent = isEditing ? 'Enregistrement...' : 'Ajout...';

      const docData = {
        name: document.getElementById('doc-name').value.trim(),
        category: document.getElementById('doc-category').value,
        type: document.getElementById('doc-type').value,
        size: document.getElementById('doc-size').value.trim(),
        description: document.getElementById('doc-description').value.trim(),
        createdAt: isEditing ? undefined : new Date().toISOString()
      };

      try {
        let result;

        if (isEditing) {
          const docId = document.getElementById('doc-id').value;
          const existingDoc = documents.find(d => d.__backendId === docId);
          if (existingDoc) {
            result = await window.dataSdk.update({
              ...existingDoc,
              ...docData,
              createdAt: existingDoc.createdAt
            });
          }
        } else {
          result = await window.dataSdk.create(docData);
        }

        if (result && result.isOk) {
          showToast(isEditing ? 'Document modifiÃ©' : 'Document ajoutÃ©', 'success');
          closeModal();
        } else {
          showToast('Une erreur est survenue', 'error');
        }
      } catch (error) {
        showToast('Une erreur est survenue', 'error');
      } finally {
        submitBtn.disabled = false;
        submitText.textContent = isEditing ? 'Enregistrer' : 'Ajouter';
      }
    }

    // Delete confirmation
    async function confirmDelete() {
      if (!documentToDelete) return;

      const deleteBtn = document.getElementById('confirm-delete-btn');
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Suppression...';

      try {
        const result = await window.dataSdk.delete(documentToDelete);

        if (result.isOk) {
          showToast('Document supprimÃ©', 'success');
          closeDeleteModal();
        } else {
          showToast('Erreur lors de la suppression', 'error');
        }
      } catch (error) {
        showToast('Erreur lors de la suppression', 'error');
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Supprimer';
      }
    }

    // Toast notifications
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      const toastMessage = document.getElementById('toast-message');
      const toastIcon = document.getElementById('toast-icon');

      toastMessage.textContent = message;
      toastIcon.textContent = type === 'success' ? 'âœ…' : 'âŒ';

      toast.classList.remove('hidden');

      setTimeout(() => {
        toast.classList.add('hidden');
      }, 3000);
    }

    // Drawer toggle for mobile
    function toggleDrawer() {
      const drawer = document.querySelector(".drawer-panel");
      const backdrop = document.querySelector(".drawer-backdrop");
      const mainContent = document.querySelector(".with-drawer");
      
      if (drawer.classList.contains("open")) {
        drawer.classList.remove("open");
        backdrop.classList.remove("open");
        mainContent.classList.remove("sidebar-open");
      } else {
        drawer.classList.add("open");
        backdrop.classList.add("open");
        mainContent.classList.add("sidebar-open");
      }
    }
    
    function closeDrawer() {
      const drawer = document.querySelector(".drawer-panel");
      const backdrop = document.querySelector(".drawer-backdrop");
      const mainContent = document.querySelector(".with-drawer");
      
      drawer.classList.remove("open");
      backdrop.classList.remove("open");
      mainContent.classList.remove("sidebar-open");
    }

    // Initialize app
    initApp();
