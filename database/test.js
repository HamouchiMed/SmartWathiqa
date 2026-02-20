const pool = require('./connection');

async function testDatabase() {
  try {
    console.log('Testing SmartWathiqa database connection and operations...\n');

    // Test 1: Check users table
    console.log('1. Testing users table...');
    const users = await pool.query('SELECT id, name, email, role FROM users ORDER BY id');
    console.log(`   Found ${users.rows.length} users:`);
    users.rows.forEach(user => {
      console.log(`   - ${user.name} (${user.email}) - ${user.role}`);
    });

    // Test 2: Check categories table
    console.log('\n2. Testing categories table...');
    const categories = await pool.query('SELECT name, color FROM categories WHERE user_id = 1');
    console.log(`   Found ${categories.rows.length} categories for admin user:`);
    categories.rows.forEach(cat => {
      console.log(`   - ${cat.name} (${cat.color})`);
    });

    // Test 3: Insert a test document
    console.log('\n3. Testing document insertion...');
    const insertDoc = await pool.query(`
      INSERT INTO documents (user_id, name, file_name, file_type, category_name, description)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, created_at
    `, [1, 'Test Document', 'test.pdf', 'application/pdf', 'Travail', 'This is a test document']);
    console.log(`   Inserted document: ${insertDoc.rows[0].name} (ID: ${insertDoc.rows[0].id})`);

    // Test 4: Query documents
    console.log('\n4. Testing document retrieval...');
    const documents = await pool.query(`
      SELECT d.id, d.name, d.file_type, c.name as category, d.created_at
      FROM documents d
      LEFT JOIN categories c ON d.category_id = c.id
      WHERE d.user_id = $1
      ORDER BY d.created_at DESC
    `, [1]);
    console.log(`   Found ${documents.rows.length} documents:`);
    documents.rows.forEach(doc => {
      console.log(`   - ${doc.name} (${doc.file_type}) - Category: ${doc.category || 'None'}`);
    });

    // Test 5: Test favorites functionality
    console.log('\n5. Testing favorites functionality...');
    await pool.query('INSERT INTO favorites (user_id, document_id) VALUES ($1, $2)', [1, insertDoc.rows[0].id]);
    const favorites = await pool.query(`
      SELECT d.name, f.created_at
      FROM favorites f
      JOIN documents d ON f.document_id = d.id
      WHERE f.user_id = $1
    `, [1]);
    console.log(`   User has ${favorites.rows.length} favorite(s):`);
    favorites.rows.forEach(fav => {
      console.log(`   - ${fav.name}`);
    });

    // Clean up test data
    console.log('\n6. Cleaning up test data...');
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND document_id = $2', [1, insertDoc.rows[0].id]);
    await pool.query('DELETE FROM documents WHERE id = $1', [insertDoc.rows[0].id]);
    console.log('   Test data cleaned up successfully');

    console.log('\n✅ All database tests passed successfully!');

  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testDatabase();
}

module.exports = testDatabase;