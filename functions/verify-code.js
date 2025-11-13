// File: functions/verify-code.js
// Ooosh Tours Driver Verification - Verify Email Code
// Production-ready version with rate limiting and security hardening

// 🔒 RATE LIMITING: In-memory store for verify attempts
const verifyAttempts = new Map();

// Cleanup old attempts every 5 minutes to prevent memory bloat
setInterval(() => {
  const now = Date.now();
  const fifteenMinutesAgo = now - (15 * 60 * 1000);
  
  for (const [email, attempts] of verifyAttempts.entries()) {
    const recent = attempts.filter(time => time > fifteenMinutesAgo);
    if (recent.length === 0) {
      verifyAttempts.delete(email);
    } else {
      verifyAttempts.set(email, recent);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if email has exceeded rate limit for verification attempts
 * @param {string} email - Email address to check
 * @returns {boolean} - True if within limit, false if exceeded
 */
function checkRateLimit(email) {
  const now = Date.now();
  const attempts = verifyAttempts.get(email) || [];
  
  // Remove attempts older than 15 minutes
  const recent = attempts.filter(time => now - time < 15 * 60 * 1000);
  
  // Max 10 verification attempts per 15 minutes
  if (recent.length >= 10) {
    return false;
  }
  
  // Record this attempt
  verifyAttempts.set(email, [...recent, now]);
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
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  return (
    emailRegex.test(email) &&
    email.length <= 254 &&
    email.length >= 6 &&
    !email.includes('..') &&
    !email.startsWith('.') &&
    !email.endsWith('.')
  );
}

/**
 * Validate verification code format
 * @param {string} code - Code to validate
 * @returns {boolean} - True if valid format
 */
function isValidCode(code) {
  if (!code || typeof code !== 'string') {
    return false;
  }
  
  const codeStr = code.trim();
  
  // Must be exactly 6 digits
  return /^\d{6}$/.test(codeStr);
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
    let email, code, jobId;
    try {
      const parsed = JSON.parse(event.body);
      email = parsed.email;
      code = parsed.code;
      jobId = parsed.jobId;
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    // Validate required fields
    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
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

    // Validate code format
    const codeStr = String(code).trim();
    
    if (!isValidCode(codeStr)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Code must be exactly 6 digits' })
      };
    }

    // 🔒 SECURITY: Check rate limit
    if (!checkRateLimit(email)) {
      console.log('⚠️ Rate limit exceeded for verification attempts');
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: 'Too many verification attempts. Please try again in 15 minutes.',
          retryAfter: 900
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

    // Call Google Apps Script for verification
    console.log('✅ Verifying code');
    
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'verify-code',
        email: email,
        code: codeStr,
        jobId: jobId
      })
    });

    // Handle non-OK responses
    if (!response.ok) {
      console.error('❌ Apps Script error:', response.status);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ 
          error: 'Verification service error' 
        })
      };
    }

    // Parse response - handle potential JSON errors
    let result;
    try {
      const rawText = await response.text();
      result = JSON.parse(rawText);
    } catch (parseError) {
      console.error('❌ Invalid JSON response from Apps Script');
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ 
          error: 'Verification service returned invalid response' 
        })
      };
    }

    // Check if Apps Script returned an error
    if (result.error) {
      console.log('⚠️ Verification failed:', result.error);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: result.error 
        })
      };
    }

    // Check if verification was successful
    if (!result.success || !result.verified) {
      console.log('⚠️ Invalid verification code');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid verification code' 
        })
      };
    }

    // Verification successful
    console.log('✅ Verification successful');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        verified: true,
        message: 'Email verified successfully'
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
