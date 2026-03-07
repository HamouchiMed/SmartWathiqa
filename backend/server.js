const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const pool = require('../database/connection');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

async function tableExists(tableName) {
  const result = await pool.query('SHOW TABLES LIKE $1', [tableName]);
  return result.rows.length > 0;
}

function bytesToMB(bytes) {
  return Math.round((Number(bytes || 0) / (1024 * 1024)) * 100) / 100;
}

function getDirectorySizeBytes(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return size;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += getDirectorySizeBytes(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

// Routes

// Simple login (email + password)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = String(user.password_hash || '') === String(password);

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Get all documents
app.get('/api/documents', async (req, res) => {
  try {
    const { user_id = 1, category, search, date_filter } = req.query;

    let query = `
      SELECT
        d.*,
        c.name as category_name,
        c.color as category_color,
        CASE WHEN f.document_id IS NULL THEN 0 ELSE 1 END as is_favorite
      FROM documents d
      LEFT JOIN categories c ON d.category_id = c.id
      LEFT JOIN favorites f ON f.document_id = d.id AND f.user_id = d.user_id
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
      query += ` AND (d.name LIKE $${paramIndex} OR d.description LIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add date filter
    if (date_filter) {
      const now = new Date();
      let dateCondition = '';

      switch (date_filter) {
        case 'today':
          dateCondition = `d.created_at >= CURDATE() AND d.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`;
          break;
        case 'week':
          dateCondition = `d.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
          break;
        case 'month':
          dateCondition = `d.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`;
          break;
        case 'year':
          dateCondition = `d.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)`;
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

// Admin: Get all documents for all users (employe, directeur, etc.)
app.get('/api/admin/documents', async (req, res) => {
  try {
    const { category, search, role } = req.query;

    let query = `
      SELECT
        d.*,
        c.name AS category_name,
        c.color AS category_color,
        u.email AS owner_email,
        u.name AS owner_name,
        u.role AS owner_role
      FROM documents d
      LEFT JOIN categories c ON d.category_id = c.id
      LEFT JOIN users u ON d.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (category && category !== 'all') {
      query += ` AND d.category_name = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (role && role !== 'all') {
      query += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        d.name LIKE $${paramIndex}
        OR d.description LIKE $${paramIndex}
        OR d.file_name LIKE $${paramIndex}
        OR u.email LIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY d.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching admin documents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch admin documents' });
  }
});

// Admin: overview cards + alerts
app.get('/api/admin/overview', async (req, res) => {
  try {
    const totalDocsResult = await pool.query('SELECT COUNT(*) AS total FROM documents');
    const totalUsersResult = await pool.query('SELECT COUNT(*) AS total FROM users');
    const docsTodayResult = await pool.query(
      'SELECT COUNT(*) AS total FROM documents WHERE DATE(created_at) = CURDATE()'
    );

    let failedLogins = 0;
    if (await tableExists('login_attempts')) {
      const failedResult = await pool.query(
        'SELECT COUNT(*) AS total FROM login_attempts WHERE success = 0 AND DATE(created_at) = CURDATE()'
      );
      failedLogins = Number(failedResult.rows[0]?.total || 0);
    }

    const pendingResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE u.role IN ('employer', 'directeur')
      AND d.id NOT IN (
        SELECT document_id FROM document_history WHERE action = 'approved'
      )
    `);
    const pendingApprovals = Number(pendingResult.rows[0]?.total || 0);

    const uploadsBytes = getDirectorySizeBytes(uploadsDir);
    const uploadsMb = bytesToMB(uploadsBytes);
    const storageCapMb = 500;
    const storagePercent = Math.min(100, Math.round((uploadsMb / storageCapMb) * 100));

    const alerts = [];
    if (pendingApprovals > 0) {
      alerts.push({
        level: 'warning',
        code: 'pending_approvals',
        message: `${pendingApprovals} document(s) en attente de validation.`
      });
    }
    if (storagePercent >= 80) {
      alerts.push({
        level: 'warning',
        code: 'storage_high',
        message: `Stockage élevé: ${storagePercent}% utilisé.`
      });
    }
    if (failedLogins >= 5) {
      alerts.push({
        level: 'danger',
        code: 'failed_logins',
        message: `${failedLogins} tentatives de connexion échouées aujourd'hui.`
      });
    }

    res.json({
      success: true,
      data: {
        total_documents: Number(totalDocsResult.rows[0]?.total || 0),
        total_users: Number(totalUsersResult.rows[0]?.total || 0),
        documents_today: Number(docsTodayResult.rows[0]?.total || 0),
        failed_logins: failedLogins,
        pending_approvals: pendingApprovals,
        alerts
      }
    });
  } catch (error) {
    console.error('Error fetching admin overview:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch admin overview' });
  }
});

// Admin: pending approvals queue
app.get('/api/admin/pending-approvals', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const result = await pool.query(`
      SELECT
        d.id,
        d.name,
        d.file_type,
        d.category_name,
        d.created_at,
        u.name AS owner_name,
        u.email AS owner_email,
        u.role AS owner_role
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE u.role IN ('employer', 'directeur')
      AND d.id NOT IN (
        SELECT document_id FROM document_history WHERE action = 'approved'
      )
      ORDER BY d.created_at DESC
      LIMIT $1
    `, [Number(limit)]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending approvals' });
  }
});

// Admin: approve one document
app.post('/api/admin/pending-approvals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id, user_id, name FROM documents WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const doc = existing.rows[0];
    await pool.query(
      'INSERT INTO document_history (document_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [id, doc.user_id, 'approved', `Document "${doc.name}" approved by admin`]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error approving document:', error);
    res.status(500).json({ success: false, error: 'Failed to approve document' });
  }
});

// Admin: user management
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        (
          SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id
        ) AS documents_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { name, email, password, role = 'employer' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'name, email and password are required' });
    }

    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name, email, password, role]
    );

    const created = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE email = $1 LIMIT 1', [email]);
    res.json({ success: true, data: created.rows[0] || null });
  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ success: false, error: 'newPassword is required' });
    }
    await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newPassword, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }

    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Ensure related rows are removed even if FK cascade is not configured.
    await pool.query('DELETE FROM favorites WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM document_history WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM documents WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// Fallback route (in case DELETE is blocked by some clients)
app.post('/api/admin/users/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Ensure related rows are removed even if FK cascade is not configured.
    await pool.query('DELETE FROM favorites WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM document_history WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM documents WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user (fallback route):', error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// Admin: audit log
app.get('/api/admin/audit', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const result = await pool.query(`
      SELECT
        h.id,
        h.action,
        h.details,
        h.created_at,
        COALESCE(d.name, '') AS document_name,
        u.name AS actor_name,
        u.email AS actor_email
      FROM document_history h
      LEFT JOIN documents d ON d.id = h.document_id
      LEFT JOIN users u ON u.id = h.user_id
      ORDER BY h.created_at DESC
      LIMIT $1
    `, [Number(limit)]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching admin audit log:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch audit log' });
  }
});

// Admin: system health
app.get('/api/admin/system-health', async (req, res) => {
  try {
    let dbStatus = 'ok';
    let dbSizeMb = 0;
    try {
      await pool.query('SELECT 1 AS ok');
      const dbSize = await pool.query(`
        SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
      `);
      dbSizeMb = Number(dbSize.rows[0]?.size_mb || 0);
    } catch (err) {
      dbStatus = 'down';
    }

    const uploadsMb = bytesToMB(getDirectorySizeBytes(uploadsDir));
    const uptimeSeconds = Math.floor(process.uptime());

    res.json({
      success: true,
      data: {
        db_status: dbStatus,
        db_size_mb: dbSizeMb,
        uploads_size_mb: uploadsMb,
        api_uptime_seconds: uptimeSeconds,
        node_version: process.version
      }
    });
  } catch (error) {
    console.error('Error fetching admin system health:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch system health' });
  }
});

// Admin: export documents CSV
app.get('/api/admin/export/documents.csv', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id,
        d.name,
        d.file_type,
        d.category_name,
        d.created_at,
        u.email AS owner_email,
        u.role AS owner_role
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
    `);

    const headers = ['id', 'name', 'file_type', 'category_name', 'created_at', 'owner_email', 'owner_role'];
    const lines = [headers.join(',')];
    for (const row of result.rows) {
      const vals = headers.map((h) => {
        const value = row[h] == null ? '' : String(row[h]).replace(/"/g, '""');
        return `"${value}"`;
      });
      lines.push(vals.join(','));
    }
    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="documents_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting admin documents:', error);
    res.status(500).json({ success: false, error: 'Failed to export documents' });
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
      const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const targetPath = path.join(uploadsDir, safeName);
      await file.mv(targetPath);
      docData.fileName = file.name;
      docData.filePath = `/uploads/${safeName}`;
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

    const insertResult = await pool.query(`
      INSERT INTO documents (
        user_id, name, file_name, file_path, file_size, file_type,
        category_id, category_name, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      user_id, name, fileName, filePath, fileSize, fileType,
      categoryId, category, description
    ]);
    const lastIdResult = await pool.query('SELECT LAST_INSERT_ID() AS id');
    const createdResult = await pool.query('SELECT * FROM documents WHERE id = $1', [lastIdResult.rows[0].id]);
    const createdDocument = createdResult.rows[0];

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [createdDocument.id, user_id, 'created', `Document "${name}" created`]);

    res.json({ success: true, data: createdDocument, message: 'Document created successfully' });
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

    const updateResult = await pool.query(`
      UPDATE documents
      SET name = $1, category_id = $2, category_name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND user_id = $6
    `, [name, categoryId, category, description, id, user_id]);

    const result = await pool.query('SELECT * FROM documents WHERE id = $1 AND user_id = $2', [id, user_id]);
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

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [id, user_id, 'deleted', `Document "${docName}" deleted`]);

    // Delete the document
    await pool.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [id, user_id]);

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
        ON DUPLICATE KEY UPDATE user_id = user_id
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

    // Get detailed document type breakdown
    const typeRows = await pool.query(`
      SELECT file_type, COUNT(*) as count
      FROM documents
      WHERE user_id = $1
      GROUP BY file_type
    `, [user_id]);

    const typeBreakdown = {
      'PDF': 0,
      'Word': 0,
      'Excel': 0,
      'PowerPoint': 0,
      'Image': 0,
      'Vidéo': 0,
      'Audio': 0,
      'CSV': 0,
      'Archive (ZIP/RAR)': 0,
      'Texte': 0,
      'Autre': 0
    };

    function normalizeType(rawType = '') {
      const t = String(rawType).trim().toLowerCase();
      if (!t) return 'Autre';
      if (t.includes('pdf')) return 'PDF';
      if (t === 'word' || t.includes('msword') || t.includes('wordprocessingml') || t.endsWith('.doc') || t.endsWith('.docx')) return 'Word';
      if (t === 'excel' || t.includes('spreadsheetml') || t.includes('ms-excel') || t.endsWith('.xls') || t.endsWith('.xlsx')) return 'Excel';
      if (t === 'powerpoint' || t.includes('presentationml') || t.includes('ms-powerpoint') || t.endsWith('.ppt') || t.endsWith('.pptx')) return 'PowerPoint';
      if (t === 'image' || t.startsWith('image/') || /(jpg|jpeg|png|gif|bmp|tiff|webp|svg)/.test(t)) return 'Image';
      if (t === 'vidéo' || t === 'video' || t.startsWith('video/') || /(mp4|mov|avi|mkv|webm)/.test(t)) return 'Vidéo';
      if (t === 'audio' || t.startsWith('audio/') || /(mp3|wav|ogg|aac|flac|m4a)/.test(t)) return 'Audio';
      if (t === 'csv' || t.includes('text/csv') || t.endsWith('.csv')) return 'CSV';
      if (t === 'archive (zip/rar)' || t.includes('zip') || t.includes('rar') || t.includes('7z') || t.includes('tar') || t.includes('gzip')) return 'Archive (ZIP/RAR)';
      if (t === 'texte' || t === 'text' || t.startsWith('text/')) return 'Texte';
      return 'Autre';
    }

    typeRows.rows.forEach((row) => {
      const normalized = normalizeType(row.file_type);
      typeBreakdown[normalized] += Number(row.count || 0);
    });

    const stats = {
      total: parseInt(totalResult.rows[0].total),
      pdf: typeBreakdown['PDF'],
      images: typeBreakdown['Image'],
      other: typeBreakdown['Autre'],
      type_breakdown: typeBreakdown
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

// Get one document
app.get('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id = 1 } = req.query;

    const result = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch document' });
  }
});

// Get recent activity for dashboard
app.get('/api/dashboard/activity', async (req, res) => {
  try {
    const { user_id = 1, limit = 5 } = req.query;

    const result = await pool.query(`
      SELECT
        h.id,
        h.action,
        h.details,
        h.created_at,
        COALESCE(d.name, '') AS document_name
      FROM document_history h
      LEFT JOIN documents d ON d.id = h.document_id
      WHERE h.user_id = $1
      ORDER BY h.created_at DESC
      LIMIT $2
    `, [user_id, parseInt(limit)]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching dashboard activity:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard activity' });
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
  console.log(`ðŸš€ SmartWathiqa API server running on port ${PORT}`);
  console.log(`ðŸ“Š Connected to local MySQL database`);
});

module.exports = app;
