const fs = require('fs');
const path = require('path');
const pool = require('./connection');

async function setupDatabase() {
  try {
    console.log('Setting up SmartWathiqa database...');

    // Read the schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the entire schema as one query
    await pool.query(schema);

    console.log('Database setup completed successfully!');

    // Test the setup by querying one of the tables
    const result = await pool.query('SELECT COUNT(*) FROM users');
    console.log(`Database initialized with ${result.rows[0].count} users`);

  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupDatabase();
}

module.exports = setupDatabase;