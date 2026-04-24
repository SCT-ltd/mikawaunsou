const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL: seed-admin.cjs should NOT be run in production.');
    console.error('Use a secure admin management tool to create initial users.');
    process.exit(1);
  }

  const username = 'admin';
  const password = 'password123'; // Initial password
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);

  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    if (res.rows.length > 0) {
      console.log('Admin user already exists.');
    } else {
      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [username, hash, 'admin']
      );
      console.log(`Admin user created. Username: ${username}, Password: ${password}`);
    }
  } catch (err) {
    console.error('Error seeding admin user:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
