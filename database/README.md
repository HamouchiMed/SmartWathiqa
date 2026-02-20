# SmartWathiqa Database Setup

This directory contains the database setup for the SmartWathiqa document management system.

## Files

- `schema.sql` - PostgreSQL database schema with all tables, indexes, and sample data
- `connection.js` - Node.js database connection configuration
- `setup.js` - Database initialization script
- `package.json` - Node.js dependencies

## Database Schema

The database includes the following tables:

- **users** - User accounts and authentication
- **categories** - Document categories with colors
- **documents** - Main document storage table
- **document_history** - Audit trail for document actions
- **shared_documents** - Document sharing between users
- **favorites** - User's favorite documents
- **tags** - Document tags
- **document_tags** - Many-to-many relationship between documents and tags

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Initialize Database**
   ```bash
   npm run setup
   ```

3. **Test Connection** (optional)
   ```bash
   npm run test-connection
   ```

## Database Connection

The database uses Neon PostgreSQL with the following connection string:
```
postgresql://neondb_owner:npg_i7uBOMJlUqD0@ep-patient-shape-ai8367hr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

## Features

- Automatic timestamp updates via triggers
- Comprehensive indexing for performance
- Sample data for testing
- Foreign key constraints for data integrity
- Support for document sharing and favorites
- Tag-based document organization

## Usage in Application

Import the connection pool in your Node.js application:

```javascript
const pool = require('./database/connection');

// Example query
pool.query('SELECT * FROM documents WHERE user_id = $1', [userId], (err, result) => {
  if (err) {
    console.error('Error executing query', err);
  } else {
    console.log('Documents:', result.rows);
  }
});
```

## Security Notes

- Passwords should be properly hashed before storage
- Use prepared statements to prevent SQL injection
- The SSL connection is configured for security
- Consider implementing connection pooling limits for production