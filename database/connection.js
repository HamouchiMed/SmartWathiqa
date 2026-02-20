const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  connectionString: 'postgresql://neondb_owner:npg_i7uBOMJlUqD0@ep-patient-shape-ai8367hr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
};

// Create connection pool
const pool = new Pool(dbConfig);

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Export pool for use in other modules
module.exports = pool;