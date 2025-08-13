// File: functions/driver-status.js
// OOOSH Driver Verification - Get Driver Status Function
// UPDATED: Now uses Board A (Driver Database - 9798399405) instead of Google Sheets

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Driver status function called with method:', event.httpMethod);
  
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const email = event.queryStringParameters?.email;
    console.log('Driver status request for email:', email);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email parameter is required' })
      };
    }

    // UPDATED: Use Board A lookup instead of Google Sheets
    const driverStatus = await getDriverStatusFromBoardA(email);
    
    console.log('Driver status retrieved:', driverStatus);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(driverStatus)
    };

  } catch (error) {
    console.error('Driver status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};

// NEW: Get driver status from Board A (Driver Database - 9798399405)
async function getDriverStatusFromBoardA(email) {
  console.log('🔍 Looking up driver in Board A:', email);
  
  try {
    // Call our monday-integration function to find the driver
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'find-driver-board-a',
        email: email
      })
    });

    if (!response.ok) {
      console.log('Driver not found in Board A, treating as new driver');
      return createNewDriverStatus(email);
    }

    const result = await response.json();
    
    if (!result.success || !result.driver) {
      console.log('No driver data returned, treating as new driver');
      return createNewDriverStatus(email);
    }

    console.log('✅ Found existing driver in Board A');
    
    // Parse the driver data from Board A
    const driver = result.driver;
    
    // Analyze document status and determine overall driver status
    const documentStatus = analyzeDocumentStatus(driver);
    
    return {
      status: documentStatus.overallStatus,
      email: email,
      name: driver.driverName || null,
      phone: driver.phoneNumber || null,
      documents: documentStatus.documents,
      boardAId: driver.id,
      lastUpdated: driver.lastUpdated || null
    };

  } catch (error) {
    console.error('Error getting driver status from Board A:', error);
    return createNewDriverStatus(email);
  }
}

// Analyze document status and expiry from Board A data
function analyzeDocumentStatus(driver) {
  console.log('📊 Analyzing document status for driver');
  
  const documents = {
    license: { valid: false },
    poa1: { valid: false },
    poa2: { valid: false },
    dvlaCheck: { valid: false }
  };

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Check License Status
  if (driver.licenseValidTo) {
    const licenseExpiry = new Date(driver.licenseValidTo);
    documents.license = {
      valid: licenseExpiry > today,
      expiryDate: driver.licenseValidTo,
      type: 'UK Driving License',
      status: licenseExpiry > today ? 'valid' : 'expired'
    };
  }

  // Check POA1 Status (90-day rule)
  if (driver.poa1ValidUntil) {
    const poa1Expiry = new Date(driver.poa1ValidUntil);
    documents.poa1 = {
      valid: poa1Expiry > today,
      expiryDate: driver.poa1ValidUntil,
      type: 'Proof of Address #1',
      status: poa1Expiry > today ? 'valid' : 'expired'
    };
  }

  // Check POA2 Status (90-day rule)
  if (driver.poa2ValidUntil) {
    const poa2Expiry = new Date(driver.poa2ValidUntil);
    documents.poa2 = {
      valid: poa2Expiry > today,
      expiryDate: driver.poa2ValidUntil,
      type: 'Proof of Address #2',
      status: poa2Expiry > today ? 'valid' : 'expired'
    };
  }

  // Check DVLA Check Status (30-day rule)
  if (driver.dvlaCheckDate) {
    const dvlaDate = new Date(driver.dvlaCheckDate);
    const dvlaValid = dvlaDate > thirtyDaysAgo;
    documents.dvlaCheck = {
      valid: dvlaValid,
      lastCheck: driver.dvlaCheckDate,
      status: dvlaValid ? 'valid' : 'expired',
      ageInDays: Math.floor((today - dvlaDate) / (24 * 60 * 60 * 1000))
    };
  }

  // Determine overall status
  const overallStatus = determineOverallStatus(documents, driver);

  console.log('📊 Document analysis complete:', {
    overallStatus,
    license: documents.license.valid,
    poa1: documents.poa1.valid,
    poa2: documents.poa2.valid,
    dvlaCheck: documents.dvlaCheck.valid
  });

  return { overallStatus, documents };
}

// Determine overall driver status based on document analysis
function determineOverallStatus(documents, driver) {
  const hasValidLicense = documents.license.valid;
  const hasValidPoa1 = documents.poa1.valid;
  const hasValidPoa2 = documents.poa2.valid;
  const hasValidDvla = documents.dvlaCheck.valid;

  // Check overall status from Board A
  const boardStatus = driver.overallStatus;

  // If Board A says "Done" and all documents valid
  if (boardStatus === 'Done' && hasValidLicense && hasValidPoa1 && hasValidPoa2 && hasValidDvla) {
    return 'verified';
  }

  // If Board A says "Done" but some documents expired
  if (boardStatus === 'Done' && hasValidLicense) {
    if (!hasValidPoa1 || !hasValidPoa2) {
      return 'poa_expired';
    }
    if (!hasValidDvla) {
      return 'dvla_expired';
    }
  }

  // If we have some documents but not complete
  if (hasValidLicense || hasValidPoa1 || hasValidPoa2) {
    return 'partial';
  }

  // If Board A exists but no documents
  if (driver.driverName) {
    return 'pending';
  }

  // Completely new driver
  return 'new';
}

// Create new driver status for drivers not found in Board A
function createNewDriverStatus(email) {
  console.log('👤 Creating new driver status for:', email);
  
  return {
    status: 'new',
    email: email,
    name: null,
    phone: null,
    documents: {
      license: { valid: false, status: 'required' },
      poa1: { valid: false, status: 'required' },
      poa2: { valid: false, status: 'required' },
      dvlaCheck: { valid: false, status: 'required' }
    },
    boardAId: null,
    lastUpdated: null
  };
}
