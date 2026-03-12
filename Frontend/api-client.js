// SmartWathiqa API Client
// Replaces the local Data SDK with API calls to the backend

const API_BASE_URL = (() => {
  // Allow manual override when needed.
  try {
    const q = new URLSearchParams(window.location.search);
    const fromQuery = q.get('apiBase');
    if (fromQuery) return fromQuery.replace(/\/$/, '');
    const fromStorage = localStorage.getItem('SMARTWATHIQA_API_BASE');
    if (fromStorage) return fromStorage.replace(/\/$/, '');
  } catch (_) {}

  // Auto-map devtunnels frontend (7777) to backend (3001).
  try {
    const host = window.location.host || '';
    if (host.includes('devtunnels.ms') && host.includes('-7777.')) {
      return `https://${host.replace('-7777.', '-3001.')}/api`;
    }
  } catch (_) {}

  return 'http://localhost:3001/api';
})();

class SmartWathiqaAPI {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  getCurrentUser() {
    try {
      const raw = localStorage.getItem('currentUser');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  getCurrentUserId() {
    const user = this.getCurrentUser();
    return user && Number.isFinite(Number(user.id)) ? Number(user.id) : 1;
  }

  getCurrentUserRole() {
    const user = this.getCurrentUser();
    return (user && user.role) ? String(user.role) : 'employer';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const isFormData = (typeof FormData !== 'undefined') && (options.body instanceof FormData);
    const config = {
      headers: {
        'x-user-role': this.getCurrentUserRole(),
        'x-user-id': String(this.getCurrentUserId()),
        ...options.headers
      },
      ...options
    };
    if (!isFormData) {
      config.headers['Content-Type'] = config.headers['Content-Type'] || 'application/json';
    } else {
      delete config.headers['Content-Type'];
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      return { isOk: true, data: data.data || data };
    } catch (error) {
      console.error('API request failed:', error);
      return { isOk: false, error: error.message };
    }
  }

  // Documents
  async getAllDocuments(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    return this.request(`/documents?${params}`);
  }

  async getDocument(id, userId = null) {
    const uid = (userId === null || userId === undefined) ? this.getCurrentUserId() : userId;
    return this.request(`/documents/${id}?user_id=${uid}`);
  }

  getFileUrl(filePath) {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
    return `${this.baseURL.replace('/api', '')}${filePath}`;
  }

  async createDocument(docData) {
    // Transform frontend data to API format
    const apiData = {
      name: docData.name,
      fileName: docData.fileName,
      filePath: docData.filePath || null,
      fileSize: docData.size,
      fileType: docData.type,
      category: docData.category,
      description: docData.description,
      user_id: this.getCurrentUserId()
    };

    return this.request('/documents', {
      method: 'POST',
      body: JSON.stringify(apiData)
    });
  }

  async updateDocument(id, docData) {
    if (docData && docData.file) {
      const formData = new FormData();
      formData.append('name', docData.name || '');
      formData.append('category', docData.category || '');
      formData.append('description', docData.description || '');
      formData.append('file', docData.file);
      formData.append('user_id', String(this.getCurrentUserId()));
      return this.request(`/documents/${id}`, {
        method: 'PUT',
        body: formData
      });
    }

    const apiData = {
      name: docData.name,
      category: docData.category,
      description: docData.description,
      user_id: this.getCurrentUserId()
    };
    return this.request(`/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(apiData)
    });
  }

  async deleteDocument(id, userId = this.getCurrentUserId()) {
    return this.request(`/documents/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ user_id: userId })
    });
  }

  async toggleFavorite(id, favorite, userId = this.getCurrentUserId()) {
    return this.request(`/documents/${id}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, favorite })
    });
  }

  // Categories
  async getCategories(userId = this.getCurrentUserId()) {
    return this.request(`/categories?user_id=${userId}`);
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
  }

  // Dashboard Statistics
  async getDashboardStats(filters = {}) {
    const params = new URLSearchParams();
    const merged = { user_id: this.getCurrentUserId(), ...filters };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    return this.request(`/dashboard/stats?${params}`);
  }

  // Recent Documents for Dashboard
  async getRecentDocuments(filters = {}) {
    const params = new URLSearchParams();
    const merged = { user_id: this.getCurrentUserId(), ...filters };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    return this.request(`/dashboard/recent?${params}`);
  }

  // Recent Activity for Dashboard
  async getRecentActivity(filters = {}) {
    const params = new URLSearchParams();
    const merged = { user_id: this.getCurrentUserId(), ...filters };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    return this.request(`/dashboard/activity?${params}`);
  }
}

// Initialize the API client
const smartWathiqaAPI = new SmartWathiqaAPI();

// Data SDK replacement
window.dataSdk = {
  init: async (handler) => {
    try {
      // Test connection
      const health = await smartWathiqaAPI.healthCheck();
      if (health.isOk) {
        console.log('✅ Connected to SmartWathiqa API');
        return { isOk: true };
      } else {
        console.error('❌ API connection failed');
        return { isOk: false, error: 'API connection failed' };
      }
    } catch (error) {
      console.error('❌ API initialization failed:', error);
      return { isOk: false, error: error.message };
    }
  },

  create: async (docData) => {
    return smartWathiqaAPI.createDocument(docData);
  },

  update: async (docData) => {
    return smartWathiqaAPI.updateDocument(docData.id, docData);
  },

  delete: async (docData) => {
    return smartWathiqaAPI.deleteDocument(docData.id);
  },

  getAll: async (filters = {}) => {
    return smartWathiqaAPI.getAllDocuments({
      user_id: smartWathiqaAPI.getCurrentUserId(),
      ...filters
    });
  },

  toggleFavorite: async (id, favorite) => {
    return smartWathiqaAPI.toggleFavorite(id, favorite);
  },

  getCategories: async () => {
    return smartWathiqaAPI.getCategories();
  }
};

console.log('🚀 SmartWathiqa API Client loaded');
