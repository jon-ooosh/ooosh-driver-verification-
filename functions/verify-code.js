// Netlify Function: Verify Email Code
const mysql = require('mysql2/promise');

// Database connection
const createConnection = async () => {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
};

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, code, jobId } = JSON.parse(event.body);

    // Validate inputs
    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
      };
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid code format' })
      };
    }

    const connection = await createConnection();

    // Check verification code
    const [codeRows] = await connection.execute(
      `SELECT id, expires_at, verified 
       FROM email_verifications 
       WHERE email = ? AND code = ? AND job_id = ? 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [email, code, jobId]
    );

    if (codeRows.length === 0) {
      await connection.end();
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid verification code' })
      };
    }

    const verification = codeRows[0];

    // Check if already verified
    if (verification.verified) {
      await connection.end();
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Code already used' })
      };
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(verification.expires_at);
    
    if (now > expiresAt) {
      await connection.end();
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Verification code expired' })
      };
    }

    // Mark code as verified
    await connection.execute(
      'UPDATE email_verifications SET verified = TRUE WHERE id = ?',
      [verification.id]
    );

    // Create or update driver record
    let driverId;
    
    // Check if driver already exists
    const [driverRows] = await connection.execute(
      'SELECT id FROM drivers WHERE email = ?',
      [email]
    );

    if (driverRows.length > 0) {
      driverId = driverRows[0].id;
    } else {
      // Create new driver
      const [insertResult] = await connection.execute(
        'INSERT INTO drivers (email) VALUES (?)',
        [email]
      );
      driverId = insertResult.insertId;
    }

    await connection.end();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ 
        success: true,
        message: 'Email verified successfully',
        driverId: driverId
      })
    };

  } catch (error) {
    console.error('Code verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
