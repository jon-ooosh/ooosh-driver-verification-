// Netlify Function: Send Email Verification Code
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

// Generate 6-digit code
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send email (placeholder - integrate with your preferred service)
const sendEmail = async (email, code, jobName) => {
  // TODO: Integrate with SendGrid, Mailgun, or your email service
  console.log(`Sending code ${code} to ${email} for job ${jobName}`);
  
  // For development, we'll just log it
  // In production, replace with actual email service
  return true;
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
    const { email, jobId } = JSON.parse(event.body);

    // Validate inputs
    if (!email || !jobId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    const connection = await createConnection();

    // Check if job exists and is active
    const [jobRows] = await connection.execute(
      'SELECT job_name, start_date, end_date, status FROM jobs WHERE id = ?',
      [jobId]
    );

    if (jobRows.length === 0) {
      await connection.end();
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    const job = jobRows[0];
    
    // Check if job is still active and hasn't ended
    const now = new Date();
    const endDate = new Date(job.end_date);
    
    if (job.status !== 'active' || endDate < now) {
      await connection.end();
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This job is no longer accepting verifications' })
      };
    }

    // Generate verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Delete any existing unverified codes for this email/job combo
    await connection.execute(
      'DELETE FROM email_verifications WHERE email = ? AND job_id = ? AND verified = FALSE',
      [email, jobId]
    );

    // Insert new verification code
    await connection.execute(
      'INSERT INTO email_verifications (email, code, job_id, expires_at) VALUES (?, ?, ?, ?)',
      [email, code, jobId, expiresAt]
    );

    // Send email (in development, this just logs)
    const emailSent = await sendEmail(email, code, job.job_name);

    await connection.end();

    if (!emailSent) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send verification email' })
      };
    }

    // Return success (don't include the actual code in production)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ 
        success: true, 
        message: 'Verification code sent',
        // For development only - remove in production
        debugCode: process.env.NODE_ENV === 'development' ? code : undefined
      })
    };

  } catch (error) {
    console.error('Email verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
