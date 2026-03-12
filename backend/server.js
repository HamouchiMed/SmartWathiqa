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

const defaultPlatformSettings = {
  validation_policy: {
    default_sla_days: 3,
    default_priority: 'medium',
    auto_escalation_days: 2
  },
  workflow_rules: {
    require_comment_on_reject_or_correction: true,
    required_metadata: {
      category: true,
      description: true,
      file_type: true
    }
  },
  notifications: {
    pending_over_sla: true,
    assignment_alert: true,
    correction_requested: true,
    recipients: {
      directeur: true,
      admin: true,
      employer: true
    }
  },
  team_access: {
    directeur: { validate: true, assign: true, view: true },
    admin: { validate: true, assign: true, view: true },
    employer: { validate: false, assign: false, view: true }
  },
  compliance: {
    mandatory_categories: ['Travail', 'Finance', 'Juridique'],
    mandatory_types: ['PDF', 'Word', 'Excel'],
    retention_months: 24,
    auto_archive_days: 90
  },
  security: {
    session_timeout_minutes: 60,
    force_password_change_days: 90,
    restrict_exports: false
  },
  templates: {
    reject_reasons: ['Document incomplet', 'Pièce illisible', 'Informations incohérentes'],
    correction_reasons: ['Ajouter une description', 'Corriger la catégorie', 'Mettre à jour le fichier']
  },
  integrations: {
    backup_schedule: 'daily',
    last_backup_at: null
  }
};

async function ensureDirectorTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      reviewer_user_id INT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      decision_comment TEXT NULL,
      assigned_to_user_id INT NULL,
      due_date DATETIME NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_document_review (document_id),
      INDEX idx_document_reviews_status (status),
      INDEX idx_document_reviews_assigned_to (assigned_to_user_id),
      CONSTRAINT fk_document_reviews_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_document_reviews_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_document_reviews_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}

ensureDirectorTables().catch((error) => {
  console.error('Failed to ensure director tables:', error);
});

async function ensureSettingsTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(120) NOT NULL UNIQUE,
      setting_value LONGTEXT NULL,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

ensureSettingsTables().catch((error) => {
  console.error('Failed to ensure settings tables:', error);
});

async function ensureWorkflowColumns() {
  const alterStatements = [
    `ALTER TABLE documents ADD COLUMN workflow_status VARCHAR(30) NOT NULL DEFAULT 'draft'`,
    `ALTER TABLE documents ADD COLUMN assigned_to_user_id INT NULL`,
    `ALTER TABLE documents ADD COLUMN due_date DATETIME NULL`,
    `ALTER TABLE documents ADD COLUMN submitted_at DATETIME NULL`,
    `ALTER TABLE documents ADD COLUMN reviewed_at DATETIME NULL`,
    `ALTER TABLE documents ADD COLUMN reviewed_by_user_id INT NULL`,
    `ALTER TABLE documents ADD COLUMN approved_by_user_id INT NULL`,
    `ALTER TABLE documents ADD COLUMN rejected_by_user_id INT NULL`,
    `ALTER TABLE documents ADD COLUMN last_action_by_user_id INT NULL`,
    `ALTER TABLE documents ADD COLUMN last_action_at DATETIME NULL`
  ];

  for (const sql of alterStatements) {
    try {
      await pool.query(sql);
    } catch (_) {
      // Column likely already exists.
    }
  }
}

async function ensureSyncTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      user_id INT NOT NULL,
      comment_text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_document_comments_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_document_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      notif_type VARCHAR(80) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      payload_json LONGTEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

Promise.all([
  ensureWorkflowColumns(),
  ensureSyncTables()
]).catch((error) => {
  console.error('Failed to ensure workflow/sync schema:', error);
});

function getRequestUserId(req, fallback = 1) {
  const fromHeader = Number(req.headers['x-user-id']);
  const fromBody = Number(req.body?.user_id);
  const fromQuery = Number(req.query?.user_id);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery;
  return fallback;
}

function getRequestRole(req, fallback = 'employer') {
  const fromHeader = req.headers['x-user-role'];
  const fromBody = req.body?.user_role;
  const fromQuery = req.query?.user_role;
  return String(fromHeader || fromBody || fromQuery || fallback).toLowerCase();
}

function requireAnyRole(roles) {
  return (req, res, next) => {
    const role = getRequestRole(req);
    if (!roles.includes(role)) {
      return res.status(403).json({ success: false, error: 'Forbidden for this role' });
    }
    next();
  };
}

async function createNotification(userId, notifType, title, message, payload = null) {
  try {
    await pool.query(`
      INSERT INTO notifications (user_id, notif_type, title, message, payload_json)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, notifType, title, message, payload ? JSON.stringify(payload) : null]);
  } catch (error) {
    console.error('Failed to create notification:', error.message);
  }
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

// User profile update
app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(id);
    const { name, email } = req.body;

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'name and email are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await pool.query(
      'UPDATE users SET name = $1, email = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name, email, userId]
    );

    const updated = await pool.query(
      'SELECT id, name, email, role, updated_at FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );

    res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// Get all documents
app.get('/api/documents', async (req, res) => {
  try {
    const { category, search, date_filter } = req.query;
    const user_id = getRequestUserId(req, 1);

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
app.get('/api/admin/documents', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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
app.get('/api/admin/overview', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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
app.get('/api/admin/pending-approvals', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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
app.post('/api/admin/pending-approvals/:id/approve', requireAnyRole(['admin', 'directeur']), async (req, res) => {
  try {
    const { id } = req.params;
    const actorUserId = getRequestUserId(req, 1);
    const actorRole = getRequestRole(req, 'admin');
    const existing = await pool.query('SELECT id, user_id, name FROM documents WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const doc = existing.rows[0];
    await pool.query(
      'INSERT INTO document_history (document_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [id, actorUserId, 'approved', `Document "${doc.name}" approved by ${actorRole}`]
    );

    await createNotification(
      doc.user_id,
      'review_decision',
      'Document validé',
      `Votre document "${doc.name}" a été validé par l'administration.`,
      { document_id: id, decision: 'approved', actor_user_id: actorUserId, actor_role: actorRole }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error approving document:', error);
    res.status(500).json({ success: false, error: 'Failed to approve document' });
  }
});

// Admin: user management
app.get('/api/admin/users', requireAnyRole(['admin']), async (req, res) => {
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

app.post('/api/admin/users', requireAnyRole(['admin']), async (req, res) => {
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

app.post('/api/admin/users/:id/reset-password', requireAnyRole(['admin']), async (req, res) => {
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

app.delete('/api/admin/users/:id', requireAnyRole(['admin']), async (req, res) => {
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
app.post('/api/admin/users/:id/delete', requireAnyRole(['admin']), async (req, res) => {
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
app.get('/api/admin/audit', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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
app.get('/api/admin/system-health', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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
app.get('/api/admin/export/documents.csv', requireAnyRole(['admin', 'directeur']), async (req, res) => {
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

// Admin/Directeur platform settings
app.get('/api/admin/settings', requireAnyRole(['admin', 'directeur']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = $1 LIMIT 1',
      ['platform_settings']
    );

    let saved = {};
    if (result.rows.length > 0 && result.rows[0].setting_value) {
      try {
        saved = JSON.parse(result.rows[0].setting_value);
      } catch (_) {
        saved = {};
      }
    }

    res.json({
      success: true,
      data: {
        ...defaultPlatformSettings,
        ...saved
      }
    });
  } catch (error) {
    console.error('Error fetching platform settings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

app.put('/api/admin/settings', requireAnyRole(['admin', 'directeur']), async (req, res) => {
  try {
    const { user_id = null, settings = {} } = req.body;
    const merged = {
      ...defaultPlatformSettings,
      ...settings
    };

    await pool.query(`
      INSERT INTO app_settings (setting_key, setting_value, updated_by_user_id)
      VALUES ($1, $2, $3)
      ON DUPLICATE KEY UPDATE
        setting_value = VALUES(setting_value),
        updated_by_user_id = VALUES(updated_by_user_id),
        updated_at = CURRENT_TIMESTAMP
    `, ['platform_settings', JSON.stringify(merged), user_id]);

    res.json({ success: true, data: merged });
  } catch (error) {
    console.error('Error updating platform settings:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

app.post('/api/admin/settings/backup', requireAnyRole(['admin']), async (req, res) => {
  try {
    const backupsDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const [users, documents, reviews, history, settings] = await Promise.all([
      pool.query('SELECT id, email, name, role, created_at, updated_at FROM users'),
      pool.query('SELECT * FROM documents'),
      pool.query('SELECT * FROM document_reviews'),
      pool.query('SELECT * FROM document_history ORDER BY created_at DESC LIMIT 1000'),
      pool.query('SELECT setting_key, setting_value, updated_at FROM app_settings')
    ]);

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${ts}.json`;
    const filePath = path.join(backupsDir, fileName);

    const payload = {
      generated_at: now.toISOString(),
      users: users.rows,
      documents: documents.rows,
      reviews: reviews.rows,
      history: history.rows,
      settings: settings.rows
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    // Update last backup timestamp in settings
    let currentSettings = defaultPlatformSettings;
    const saved = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = $1 LIMIT 1', ['platform_settings']);
    if (saved.rows.length > 0 && saved.rows[0].setting_value) {
      try {
        currentSettings = { ...defaultPlatformSettings, ...JSON.parse(saved.rows[0].setting_value) };
      } catch (_) {}
    }
    currentSettings.integrations = currentSettings.integrations || {};
    currentSettings.integrations.last_backup_at = now.toISOString();

    await pool.query(`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ($1, $2)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP
    `, ['platform_settings', JSON.stringify(currentSettings)]);

    res.json({
      success: true,
      data: {
        file_name: fileName,
        file_path: `backups/${fileName}`,
        generated_at: now.toISOString()
      }
    });
  } catch (error) {
    console.error('Error generating backup:', error);
    res.status(500).json({ success: false, error: 'Failed to generate backup' });
  }
});

// Director: summary cards
app.get('/api/director/summary', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const baseWhere = `1=1`;

    const pendingResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN document_reviews r ON r.document_id = d.id
      WHERE ${baseWhere}
      AND (r.status IS NULL OR r.status = 'pending')
    `);

    const approvedTodayResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${baseWhere}
      AND r.status = 'approved'
      AND DATE(r.updated_at) = CURDATE()
    `);

    const rejectedResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${baseWhere}
      AND r.status IN ('rejected', 'needs_correction')
    `);

    const overdueResult = await pool.query(`
      SELECT COUNT(*) AS total
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${baseWhere}
      AND r.status = 'pending'
      AND r.due_date IS NOT NULL
      AND r.due_date < NOW()
    `);

    const speedResult = await pool.query(`
      SELECT AVG(TIMESTAMPDIFF(HOUR, d.created_at, r.updated_at)) AS avg_hours
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${baseWhere}
      AND r.status = 'approved'
    `);

    const rateResult = await pool.query(`
      SELECT
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN r.status IN ('approved', 'rejected', 'needs_correction') THEN 1 ELSE 0 END) AS decided_count
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${baseWhere}
    `);

    const approvedCount = Number(rateResult.rows[0]?.approved_count || 0);
    const decidedCount = Number(rateResult.rows[0]?.decided_count || 0);
    const approvalRate = decidedCount > 0 ? Math.round((approvedCount / decidedCount) * 100) : 0;

    res.json({
      success: true,
      data: {
        pending: Number(pendingResult.rows[0]?.total || 0),
        approved_today: Number(approvedTodayResult.rows[0]?.total || 0),
        rejected_total: Number(rejectedResult.rows[0]?.total || 0),
        overdue: Number(overdueResult.rows[0]?.total || 0),
        avg_validation_hours: Math.round(Number(speedResult.rows[0]?.avg_hours || 0)),
        approval_rate: approvalRate
      }
    });
  } catch (error) {
    console.error('Error fetching director summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch director summary' });
  }
});

// Director: queue with filters
app.get('/api/director/queue', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const { status = 'pending', limit = 20 } = req.query;
    const statusClause = status === 'all'
      ? `1=1`
      : (status === 'pending'
        ? `(r.status IS NULL OR r.status = 'pending')`
        : `r.status = $1`);

    const params = [];
    let limitParam = Number(limit);
    if (!Number.isFinite(limitParam) || limitParam <= 0) limitParam = 20;

    if (status !== 'all' && status !== 'pending') {
      params.push(status);
    }
    params.push(limitParam);
    const limitIndex = params.length;

    const result = await pool.query(`
      SELECT
        d.id,
        d.name,
        d.file_name,
        d.file_path,
        d.file_type,
        d.category_name,
        d.created_at,
        u.id AS owner_id,
        u.name AS owner_name,
        u.email AS owner_email,
        COALESCE(r.status, 'pending') AS review_status,
        COALESCE(r.priority, 'medium') AS priority,
        r.decision_comment,
        r.due_date,
        r.assigned_to_user_id
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN document_reviews r ON r.document_id = d.id
      WHERE 1=1
      AND ${statusClause}
      ORDER BY
        CASE COALESCE(r.priority, 'medium')
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        d.created_at DESC
      LIMIT $${limitIndex}
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching director queue:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch director queue' });
  }
});

// Director: approve/reject/request correction
app.post('/api/director/decision/:documentId', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const { reviewer_user_id = null, decision, comment = '' } = req.body;
    const actorUserId = getRequestUserId(req, Number(reviewer_user_id) || 1);
    const actorRole = getRequestRole(req, 'directeur');
    const allowed = ['approved', 'rejected', 'needs_correction'];

    if (!allowed.includes(decision)) {
      return res.status(400).json({ success: false, error: 'Invalid decision' });
    }

    const docResult = await pool.query('SELECT id, user_id, name FROM documents WHERE id = $1 LIMIT 1', [documentId]);
    if (docResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    await pool.query(`
      INSERT INTO document_reviews (document_id, reviewer_user_id, status, decision_comment)
      VALUES ($1, $2, $3, $4)
      ON DUPLICATE KEY UPDATE
        reviewer_user_id = VALUES(reviewer_user_id),
        status = VALUES(status),
        decision_comment = VALUES(decision_comment),
        updated_at = CURRENT_TIMESTAMP
    `, [documentId, reviewer_user_id, decision, comment]);

    const workflowStatusMap = {
      approved: 'approved',
      rejected: 'rejected',
      needs_correction: 'needs_correction'
    };
    const wf = workflowStatusMap[decision] || 'in_review';
    if (wf === 'approved') {
      await pool.query(`
        UPDATE documents
        SET
          workflow_status = $1,
          reviewed_at = NOW(),
          reviewed_by_user_id = $2,
          last_action_by_user_id = $3,
          last_action_at = NOW(),
          approved_by_user_id = $4
        WHERE id = $5
      `, [wf, actorUserId, actorUserId, actorUserId, documentId]);
    } else {
      await pool.query(`
        UPDATE documents
        SET
          workflow_status = $1,
          reviewed_at = NOW(),
          reviewed_by_user_id = $2,
          last_action_by_user_id = $3,
          last_action_at = NOW(),
          rejected_by_user_id = $4
        WHERE id = $5
      `, [wf, actorUserId, actorUserId, actorUserId, documentId]);
    }

    const doc = docResult.rows[0];
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [documentId, actorUserId, decision, `Decision ${actorRole}: ${decision}${comment ? ` - ${comment}` : ''}`]);

    await createNotification(
      doc.user_id,
      'review_decision',
      'Décision sur document',
      `Votre document "${doc.name}" est marqué: ${decision}.`,
      { document_id: documentId, decision, comment, actor_user_id: actorUserId, actor_role: actorRole }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving director decision:', error);
    res.status(500).json({ success: false, error: 'Failed to save decision' });
  }
});

// Director: delegation / assignment
app.post('/api/director/assign/:documentId', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const {
      reviewer_user_id = null,
      assigned_to_user_id = null,
      due_date = null,
      priority = 'medium',
      comment = ''
    } = req.body;

    await pool.query(`
      INSERT INTO document_reviews (
        document_id, reviewer_user_id, status, decision_comment, assigned_to_user_id, due_date, priority
      )
      VALUES ($1, $2, 'pending', $3, $4, $5, $6)
      ON DUPLICATE KEY UPDATE
        reviewer_user_id = VALUES(reviewer_user_id),
        decision_comment = VALUES(decision_comment),
        assigned_to_user_id = VALUES(assigned_to_user_id),
        due_date = VALUES(due_date),
        priority = VALUES(priority),
        status = 'pending',
        updated_at = CURRENT_TIMESTAMP
    `, [documentId, reviewer_user_id, comment, assigned_to_user_id, due_date, priority]);

    await pool.query(`
      UPDATE documents
      SET
        workflow_status = 'in_review',
        assigned_to_user_id = $2,
        due_date = $3,
        last_action_by_user_id = $4,
        last_action_at = NOW()
      WHERE id = $1
    `, [documentId, assigned_to_user_id, due_date, reviewer_user_id]);

    if (assigned_to_user_id) {
      await createNotification(
        assigned_to_user_id,
        'review_assigned',
        'Document assigné',
        `Un document vous a été assigné pour suivi.`,
        { document_id: documentId, due_date, priority }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error assigning document review:', error);
    res.status(500).json({ success: false, error: 'Failed to assign review' });
  }
});

// Director: team supervision
app.get('/api/director/team-overview', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        COUNT(DISTINCT d.id) AS total_docs,
        SUM(CASE WHEN r.status IS NULL OR r.status = 'pending' THEN 1 ELSE 0 END) AS pending_docs,
        MAX(h.created_at) AS last_activity_at
      FROM users u
      LEFT JOIN documents d ON d.user_id = u.id
      LEFT JOIN document_reviews r ON r.document_id = d.id
      LEFT JOIN document_history h ON h.user_id = u.id
      WHERE 1=1
      GROUP BY u.id, u.name, u.email, u.role
      ORDER BY pending_docs DESC, total_docs DESC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching director team overview:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch team overview' });
  }
});

// Director: compliance / risk alerts
app.get('/api/director/risk-alerts', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const alerts = [];

    const missingMeta = await pool.query(`
      SELECT COUNT(*) AS total
      FROM documents d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE 1=1
      AND (d.category_name IS NULL OR d.category_name = '' OR d.description IS NULL OR d.description = '')
    `);
    const overdue = await pool.query(`
      SELECT COUNT(*) AS total
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE 1=1
      AND r.status = 'pending'
      AND r.due_date IS NOT NULL
      AND r.due_date < NOW()
    `);

    const missingMetaCount = Number(missingMeta.rows[0]?.total || 0);
    const overdueCount = Number(overdue.rows[0]?.total || 0);

    if (missingMetaCount > 0) {
      alerts.push({ level: 'warning', message: `${missingMetaCount} document(s) incomplets (catégorie/description).` });
    }
    if (overdueCount > 0) {
      alerts.push({ level: 'danger', message: `${overdueCount} document(s) dépassent la date limite.` });
    }
    if (alerts.length === 0) {
      alerts.push({ level: 'ok', message: 'Aucun risque critique détecté.' });
    }

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Error fetching director risk alerts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch risk alerts' });
  }
});

// Director: analytics (approval trend + reasons)
app.get('/api/director/analytics', requireAnyRole(['directeur', 'admin']), async (req, res) => {
  try {
    const trend = await pool.query(`
      SELECT
        DATE(r.updated_at) AS day,
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN r.status IN ('rejected', 'needs_correction') THEN 1 ELSE 0 END) AS rejected_count
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE 1=1
      AND r.updated_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(r.updated_at)
      ORDER BY day ASC
    `);

    const reasons = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(r.decision_comment), ''), 'Sans commentaire') AS reason,
        COUNT(*) AS count
      FROM document_reviews r
      LEFT JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = d.user_id
      WHERE 1=1
      AND r.status IN ('rejected', 'needs_correction')
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 5
    `);

    res.json({ success: true, data: { trend: trend.rows, reasons: reasons.rows } });
  } catch (error) {
    console.error('Error fetching director analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
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
      user_id: getRequestUserId(req, 1)
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
        category_id, category_name, description, workflow_status, last_action_by_user_id, last_action_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', $10, NOW())
    `, [
      user_id, name, fileName, filePath, fileSize, fileType,
      categoryId, category, description, user_id
    ]);
    const lastIdResult = await pool.query('SELECT LAST_INSERT_ID() AS id');
    const createdResult = await pool.query('SELECT * FROM documents WHERE id = $1', [lastIdResult.rows[0].id]);
    const createdDocument = createdResult.rows[0];

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [createdDocument.id, user_id, 'created', `Document "${name}" created`]);

    await createNotification(
      user_id,
      'document_created',
      'Document soumis',
      `Votre document "${name}" a été soumis.`,
      { document_id: createdDocument.id }
    );

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
    const user_id = getRequestUserId(req, 1);
    const name = req.body?.name;
    const category = req.body?.category;
    const description = req.body?.description;

    const currentDocResult = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );
    if (currentDocResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const currentDoc = currentDocResult.rows[0];

    // Get category ID if category name is provided
    let categoryId = null;
    if (category) {
      const categoryResult = await pool.query(
        'SELECT id FROM categories WHERE name = $1 AND user_id = $2',
        [category, user_id]
      );
      categoryId = categoryResult.rows[0]?.id;
    }

    let nextFileName = currentDoc.file_name;
    let nextFilePath = currentDoc.file_path;
    let nextFileSize = currentDoc.file_size;
    let nextFileType = currentDoc.file_type;

    if (req.files && req.files.file) {
      const file = req.files.file;
      const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const targetPath = path.join(uploadsDir, safeName);
      await file.mv(targetPath);

      nextFileName = file.name;
      nextFilePath = `/uploads/${safeName}`;
      nextFileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      nextFileType = file.mimetype || currentDoc.file_type;

      if (currentDoc.file_path && String(currentDoc.file_path).startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, currentDoc.file_path.replace('/uploads/', 'uploads/'));
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
      }
    }

    const updateResult = await pool.query(`
      UPDATE documents
      SET
        name = $1,
        file_name = $2,
        file_path = $3,
        file_size = $4,
        file_type = $5,
        category_id = $6,
        category_name = $7,
        description = $8,
        updated_at = CURRENT_TIMESTAMP,
        workflow_status = 'submitted',
        last_action_by_user_id = $10,
        last_action_at = NOW()
      WHERE id = $9 AND user_id = $10
    `, [
      name || currentDoc.name,
      nextFileName,
      nextFilePath,
      nextFileSize,
      nextFileType,
      categoryId,
      category || currentDoc.category_name,
      description ?? currentDoc.description,
      id,
      user_id
    ]);

    const result = await pool.query('SELECT * FROM documents WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Log the action
    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [id, user_id, 'updated', `Document "${name || currentDoc.name}" updated`]);

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
    const user_id = getRequestUserId(req, 1);

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

// Submit or resubmit a document into review workflow
app.post('/api/documents/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = getRequestUserId(req, 1);

    const existing = await pool.query(
      'SELECT id, user_id, name FROM documents WHERE id = $1 LIMIT 1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const doc = existing.rows[0];
    if (Number(doc.user_id) !== Number(user_id)) {
      return res.status(403).json({ success: false, error: 'Only owner can submit this document' });
    }

    await pool.query(`
      UPDATE documents
      SET workflow_status = 'submitted', submitted_at = NOW(), last_action_by_user_id = $2, last_action_at = NOW()
      WHERE id = $1
    `, [id, user_id]);

    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, 'submitted', $3)
    `, [id, user_id, `Document "${doc.name}" submitted for review`]);

    await createNotification(
      user_id,
      'document_submitted',
      'Document soumis',
      `Votre document "${doc.name}" est en attente de validation.`,
      { document_id: id }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting document:', error);
    res.status(500).json({ success: false, error: 'Failed to submit document' });
  }
});

// Document comments thread
app.get('/api/documents/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const comments = await pool.query(`
      SELECT c.id, c.document_id, c.user_id, c.comment_text, c.created_at, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM document_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.document_id = $1
      ORDER BY c.created_at ASC
    `, [id]);
    res.json({ success: true, data: comments.rows });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch comments' });
  }
});

app.post('/api/documents/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = getRequestUserId(req, 1);
    const { comment_text = '' } = req.body;
    const text = String(comment_text).trim();
    if (!text) {
      return res.status(400).json({ success: false, error: 'comment_text is required' });
    }

    const docResult = await pool.query('SELECT id, user_id, name FROM documents WHERE id = $1 LIMIT 1', [id]);
    if (docResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const doc = docResult.rows[0];

    await pool.query(`
      INSERT INTO document_comments (document_id, user_id, comment_text)
      VALUES ($1, $2, $3)
    `, [id, user_id, text]);

    await pool.query(`
      INSERT INTO document_history (document_id, user_id, action, details)
      VALUES ($1, $2, 'commented', $3)
    `, [id, user_id, text]);

    if (Number(doc.user_id) !== Number(user_id)) {
      const actorResult = await pool.query(
        'SELECT id, name, role FROM users WHERE id = $1 LIMIT 1',
        [user_id]
      );
      const actor = actorResult.rows[0] || {};
      const actorRole = actor.role || getRequestRole(req, 'employer');
      const actorName = actor.name || 'Un utilisateur';
      const commentPreview = text.length > 120 ? `${text.slice(0, 117)}...` : text;
      await createNotification(
        doc.user_id,
        'document_comment',
        'Nouveau commentaire',
        `${actorName} (${actorRole}) a commenté "${doc.name}": ${commentPreview}`,
        { document_id: id, actor_user_id: user_id, actor_role: actorRole, comment: text }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ success: false, error: 'Failed to create comment' });
  }
});

// User notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const user_id = getRequestUserId(req, 1);
    const { limit = 30 } = req.query;
    const result = await pool.query(`
      SELECT id, user_id, notif_type, title, message, payload_json, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [user_id, Number(limit) || 30]);

    let data = result.rows;

    // Fallback for older actions: derive notifications from history if needed.
    if (!data || data.length === 0) {
      const fallback = await pool.query(`
        SELECT
          h.id,
          h.action,
          h.details,
          h.created_at,
          COALESCE(d.name, '') AS document_name,
          h.user_id AS actor_user_id,
          u.role AS actor_role
        FROM document_history h
        LEFT JOIN documents d ON d.id = h.document_id
        LEFT JOIN users u ON u.id = h.user_id
        WHERE d.user_id = $1
          AND h.action IN ('approved', 'rejected', 'needs_correction', 'commented')
          AND h.user_id <> $1
        ORDER BY h.created_at DESC
        LIMIT $2
      `, [user_id, Number(limit) || 30]);

      data = fallback.rows.map((row, idx) => {
        const action = String(row.action || '').toLowerCase();
        const titleMap = {
          approved: 'Document validé',
          rejected: 'Document rejeté',
          needs_correction: 'Correction demandée',
          commented: 'Nouveau commentaire'
        };
        const actorRole = row.actor_role ? ` (${row.actor_role})` : '';
        return {
          id: -1 * (idx + 1),
          user_id,
          notif_type: 'review_decision',
          title: titleMap[action] || 'Décision document',
          message: row.details || `Mise à jour${actorRole} sur "${row.document_name}"`,
          payload_json: null,
          is_read: 0,
          created_at: row.created_at
        };
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const user_id = getRequestUserId(req, 1);
    const { id } = req.params;
    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, error: 'Failed to mark as read' });
  }
});

// Get recent activity for dashboard
app.get('/api/dashboard/activity', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 5);
    const user_id = getRequestUserId(req, 1);

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
    `, [user_id, limit]);

    // Fallback: if no explicit history exists yet, derive activity from user documents.
    if (!result.rows.length) {
      const docsFallback = await pool.query(`
        SELECT id, name AS document_name, created_at
        FROM documents
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `, [user_id, limit]);

      const synthetic = docsFallback.rows.map((d, idx) => ({
        id: -1 * (idx + 1),
        action: 'created',
        details: `Document "${d.document_name}" created`,
        created_at: d.created_at,
        document_name: d.document_name
      }));

      return res.json({ success: true, data: synthetic });
    }

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
