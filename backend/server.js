const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const pool = require('../database/connection');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

// Routes

// Get all documents
app.get('/api/documents', async (req, res) => {
  try {
    const { user_id = 1, category, search, date_filter } = req.query;

    let query = `
      SELECT d.*, c.name as category_name, c.color as category_color
      FROM documents d
      LEFT JOIN categories c ON d.category_id = c.id
      WHERE d.user_id = $1
    `;
    let params = [user_id];
    let paramIndex = 2;

    // Add category filter
    if (category && category !== 'all') {
      query += ` AND d.category_name = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    // Add search filter
    if (search) {
      query += ` AND (d.name ILIKE $${paramIndex} OR d.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add date filter
    if (date_filter) {
      const now = new Date();
      let dateCondition = '';

      switch (date_filter) {
        case 'today':
          dateCondition = `d.created_at::date = CURRENT_DATE`;
          break;
        case 'week':
          dateCondition = `d.created_at >= CURRENT_DATE - INTERVAL '7 days'`;
          break;
        case 'month':
          dateCondition = `d.created_at >= CURRENT_DATE - INTERVAL '30 days'`;
          break;
        case 'year':
          dateCondition = `d.created_at >= CURRENT_DATE - INTERVAL '1 year'`;
          break;
      }

      if (dateCondition) {
        query += ` AND ${dateCondition}`;
      }
    }

    query += ' ORDER BY d.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
});

// Create a new document
app.post('/api/documents', async (req, res) => {
  try {
    // Handle both JSON and FormData requests
    let docData = {
      name: req.body.name,
      fileName: req.body.fileName,
      filePath: req.body.filePath || null,
      fileSize: req.body.fileSize,
      fileType: req.body.fileType,
      category: req.body.category,
      description: req.body.description,
      user_id: req.body.user_id || 1
    };

    // If file is uploaded via FormData, update the file info
    if (req.files && req.files.file) {
      const file = req.files.file;
      docData.fileName = file.name;
      docData.fileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      docData.fileType = req.body.fileType || file.mimetype;
    }

    const { name, fileName, filePath, fileSize, fileType, category, description, user_id } = docData;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ success: false, error: 'Document name is required' });
    }

    // Get category ID if category name is provided
    let categoryId = null;
    if (category) {
      const categoryResult = await pool.query(
        'SELECT id FROM categories WHERE name = $1 AND user_id = $2',
        [category, user_id]
      );
      categoryId = categoryResult.rows[0]?.id;
    }

    const result = await pool.query(`
      INSERT INTO documents (
        user_id, name, file_name, file_path, file_size, file_type,
        category_id, category_name, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      user_id, name, fileName, filePath, fileSize, fileType,
      categoryId, category, description
    ]);

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [result.rows[0].id, user_id, 'created', `Document "${name}" created`]);

    res.json({ success: true, data: result.rows[0], message: 'Document created successfully' });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).json({ success: false, error: 'Failed to create document', details: error.message });
  }
});

// Update a document
app.put('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      description,
      user_id = 1
    } = req.body;

    // Get category ID if category name is provided
    let categoryId = null;
    if (category) {
      const categoryResult = await pool.query(
        'SELECT id FROM categories WHERE name = $1 AND user_id = $2',
        [category, user_id]
      );
      categoryId = categoryResult.rows[0]?.id;
    }

    const result = await pool.query(`
      UPDATE documents
      SET name = $1, category_id = $2, category_name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [name, categoryId, category, description, id, user_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [id, user_id, 'updated', `Document "${name}" updated`]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ success: false, error: 'Failed to update document' });
  }
});

// Delete a document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id = 1 } = req.body;

    // Get document name for logging
    const docResult = await pool.query(
      'SELECT name FROM documents WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const docName = docResult.rows[0].name;

    // Delete the document
    await pool.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [id, user_id]);

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [id, user_id, 'deleted', `Document "${docName}" deleted`]);

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ success: false, error: 'Failed to delete document' });
  }
});

// Get categories
app.get('/api/categories', async (req, res) => {
  try {
    const { user_id = 1 } = req.query;
    const result = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY name',
      [user_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// Toggle favorite
app.post('/api/documents/:id/favorite', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id = 1, favorite } = req.body;

    if (favorite) {
      // Add to favorites
      await pool.query(`
        INSERT INTO favorites (user_id, document_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, document_id) DO NOTHING
      `, [user_id, id]);
    } else {
      // Remove from favorites
      await pool.query(
        'DELETE FROM favorites WHERE user_id = $1 AND document_id = $2',
        [user_id, id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating favorite:', error);
    res.status(500).json({ success: false, error: 'Failed to update favorite' });
  }
});

// Get dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { user_id = 1 } = req.query;

    // Get total documents count
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM documents WHERE user_id = $1',
      [user_id]
    );

    // Get document type counts
    const typeResult = await pool.query(`
      SELECT
        COUNT(CASE WHEN LOWER(file_type) LIKE '%pdf%' THEN 1 END) as pdf_count,
        COUNT(CASE WHEN LOWER(file_type) LIKE '%jpg%' OR LOWER(file_type) LIKE '%jpeg%' OR LOWER(file_type) LIKE '%png%' OR LOWER(file_type) LIKE '%gif%' OR LOWER(file_type) LIKE '%bmp%' OR LOWER(file_type) LIKE '%tiff%' THEN 1 END) as image_count,
        COUNT(CASE WHEN LOWER(file_type) NOT LIKE '%pdf%' AND LOWER(file_type) NOT LIKE '%jpg%' AND LOWER(file_type) NOT LIKE '%jpeg%' AND LOWER(file_type) NOT LIKE '%png%' AND LOWER(file_type) NOT LIKE '%gif%' AND LOWER(file_type) NOT LIKE '%bmp%' AND LOWER(file_type) NOT LIKE '%tiff%' THEN 1 END) as other_count
      FROM documents
      WHERE user_id = $1
    `, [user_id]);

    const stats = {
      total: parseInt(totalResult.rows[0].total),
      pdf: parseInt(typeResult.rows[0].pdf_count),
      images: parseInt(typeResult.rows[0].image_count),
      other: parseInt(typeResult.rows[0].other_count)
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard statistics' });
  }
});

// Get recent documents for dashboard
app.get('/api/dashboard/recent', async (req, res) => {
  try {
    const { user_id = 1, limit = 5 } = req.query;

    const result = await pool.query(`
      SELECT d.*, c.name as category_name, c.color as category_color
      FROM documents d
      LEFT JOIN categories c ON d.category_id = c.id
      WHERE d.user_id = $1
      ORDER BY d.created_at DESC
      LIMIT $2
    `, [user_id, parseInt(limit)]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching recent documents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recent documents' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API is running', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SmartWathiqa API server running on port ${PORT}`);
  console.log(`📊 Connected to Neon PostgreSQL database`);
});

module.exports = app;