// SmartWathiqa API Client
// Replaces the local Data SDK with API calls to the backend

const API_BASE_URL = 'http://localhost:3001/api';

class SmartWathiqaAPI {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

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
      user_id: 1 // Default user for now
    };

    return this.request('/documents', {
      method: 'POST',
      body: JSON.stringify(apiData)
    });
  }

  async updateDocument(id, docData) {
    // Transform frontend data to API format
    const apiData = {
      name: docData.name,
      category: docData.category,
      description: docData.description,
      user_id: 1 // Default user for now
    };

    return this.request(`/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(apiData)
    });
  }

  async deleteDocument(id, userId = 1) {
    return this.request(`/documents/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ user_id: userId })
    });
  }

  async toggleFavorite(id, favorite, userId = 1) {
    return this.request(`/documents/${id}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, favorite })
    });
  }

  // Categories
  async getCategories(userId = 1) {
    return this.request(`/categories?user_id=${userId}`);
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
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
    return smartWathiqaAPI.getAllDocuments(filters);
  },

  toggleFavorite: async (id, favorite) => {
    return smartWathiqaAPI.toggleFavorite(id, favorite);
  },

  getCategories: async () => {
    return smartWathiqaAPI.getCategories();
  }
};

console.log('🚀 SmartWathiqa API Client loaded');