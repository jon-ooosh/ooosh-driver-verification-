// File: functions/send-verification-code.js
// Ooosh Tours Driver Verification - Send Email Verification Code
// Production-ready version with rate limiting and security hardening

// 🔒 RATE LIMITING: In-memory store for send attempts
const sendAttempts = new Map();

// Cleanup old attempts every 5 minutes to prevent memory bloat
setInterval(() => {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  
  for (const [email, attempts] of sendAttempts.entries()) {
    const recent = attempts.filter(time => time > oneHourAgo);
    if (recent.length === 0) {
      sendAttempts.delete(email);
    } else {
      sendAttempts.set(email, recent);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if email has exceeded rate limit
 * @param {string} email - Email address to check
 * @returns {boolean} - True if within limit, false if exceeded
 */
function checkRateLimit(email) {
  const now = Date.now();
  const attempts = sendAttempts.get(email) || [];
  
  // Remove attempts older than 1 hour
  const recent = attempts.filter(time => now - time < 60 * 60 * 1000);
  
  // Max 10 codes per hour per email
  if (recent.length >= 10) {
    return false;
  }
  
  // Record this attempt
  sendAttempts.set(email, [...recent, now]);
  return true;
}

/**
 * Validate email format using RFC 5322 compliant regex
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  // Basic email regex - checks for user@domain.tld format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Additional checks
  return (
    emailRegex.test(email) &&
    email.length <= 254 && // RFC 5321 max length
    email.length >= 6 &&    // Minimum realistic email
    !email.includes('..') && // No consecutive dots
    !email.startsWith('.') && // No leading dot
    !email.endsWith('.')      // No trailing dot
  );
}

/**
 * Sanitize email input to prevent injection attacks
 * @param {string} email - Email to sanitize
 * @returns {string} - Sanitized email
 */
function sanitizeEmail(email) {
  return email.trim().toLowerCase();
}

exports.handler = async (event) => {
  // 🔒 SECURITY: CORS headers - Allow both domains for future migration
  const headers = {
    'Access-Control-Allow-Origin': 
      event.headers.origin === 'https://www.oooshtours.co.uk' || 
      event.headers.origin === 'https://oooshtours.co.uk'
        ? event.headers.origin
        : 'https://ooosh-driver-verification.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Validate request body exists
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    // Parse and validate request data
    let email, jobId;
    try {
      const parsed = JSON.parse(event.body);
      email = parsed.email;
      jobId = parsed.jobId;
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    // Validate required fields
    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Sanitize and validate email
    email = sanitizeEmail(email);
    
    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    // 🔒 SECURITY: Check rate limit
    if (!checkRateLimit(email)) {
      console.log(`⚠️ Rate limit exceeded for email: ${email}`);
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: 'Too many verification requests. Please try again in an hour.',
          retryAfter: 3600
        })
      };
    }

    // 🔒 SECURITY: Ensure Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.error('❌ GOOGLE_APPS_SCRIPT_URL not configured');
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ 
          error: 'Email verification service temporarily unavailable' 
        })
      };
    }

    // Call Google Apps Script to send verification email
    console.log('✅ Sending verification code');
    
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'send-verification-code',
        email: email,
        jobId: jobId
      })
    });

    // Handle Apps Script response
    if (!response.ok) {
      console.error('❌ Apps Script error:', response.status);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to send verification email' 
        })
      };
    }

    const result = await response.json();

    // Verify Apps Script succeeded
    if (!result.success) {
      console.error('❌ Apps Script returned failure');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: result.error || 'Failed to send verification email' 
        })
      };
    }

    // Success
    console.log('✅ Verification email sent successfully');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Verification code sent successfully'
      })
    };

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'An unexpected error occurred. Please try again.' 
      })
    };
  }
};
