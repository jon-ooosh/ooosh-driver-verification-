// Netlify Function: Get Driver Status
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
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const email = event.queryStringParameters?.email;

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email parameter is required' })
      };
    }

    const connection = await createConnection();

    // Get driver info
    const [driverRows] = await connection.execute(
      'SELECT id, email, name, phone FROM drivers WHERE email = ?',
      [email]
    );

    if (driverRows.length === 0) {
      await connection.end();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({ 
          status: 'new',
          message: 'Driver not found in system'
        })
      };
    }

    const driver = driverRows[0];

    // Get latest verification status for this driver
    const [verificationRows] = await connection.execute(
      `SELECT 
        status,
        license_valid,
        license_expiry,
        poa1_valid,
        poa1_type,
        poa1_expiry,
        poa2_valid,
        poa2_type,
        poa2_expiry,
        dvla_check_valid,
        dvla_check_date,
        points_count,
        insurance_approved,
        created_at,
        updated_at
       FROM driver_verifications 
       WHERE driver_id = ? 
       ORDER BY updated_at DESC 
       LIMIT 1`,
      [driver.id]
    );

    await connection.end();

    // Build response
    const response = {
      id: driver.id,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      status: 'new'
    };

    if (verificationRows.length > 0) {
      const verification = verificationRows[0];
      
      // Determine overall status
      const hasValidDocs = verification.license_valid && 
                          verification.poa1_valid && 
                          verification.poa2_valid;
      
      const hasDVLA = verification.dvla_check_valid;
      
      if (hasValidDocs && hasDVLA && verification.insurance_approved) {
        response.status = 'verified';
      } else if (verification.status === 'rejected') {
        response.status = 'rejected';
      } else {
        response.status = 'partial';
      }

      // Add document details
      response.documents = {
        license: {
          valid: verification.license_valid,
          expiryDate: verification.license_expiry
        },
        poa1: {
          valid: verification.poa1_valid,
          type: verification.poa1_type,
          expiryDate: verification.poa1_expiry
        },
        poa2: {
          valid: verification.poa2_valid,
          type: verification.poa2_type,
          expiryDate: verification.poa2_expiry
        },
        dvlaCheck: {
          valid: verification.dvla_check_valid,
          lastCheck: verification.dvla_check_date
        }
      };

      // Add additional info
      response.pointsCount = verification.points_count;
      response.insuranceApproved = verification.insurance_approved;
      response.lastUpdated = verification.updated_at;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Driver status error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
