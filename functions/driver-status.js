// File: functions/driver-status.js
// OOOSH Driver Verification - Get Driver Status Function
// PRODUCTION VERSION - Uses Monday.com instead of Google Sheets

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

    // Validate email format
    if (!email.includes('@')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    // Get driver status from Monday.com
    console.log('Fetching driver status from Monday.com');
    const driverStatus = await getDriverStatusFromMonday(email);
    
    if (!driverStatus) {
      // New driver - return default status
      console.log('Driver not found in Monday.com - new driver');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'new',
          email: email,
          name: null,
          documents: {
            license: { valid: false },
            poa1: { valid: false },
            poa2: { valid: false },
            dvlaCheck: { valid: false }
          },
          insuranceStatus: 'pending',
          lastUpdated: new Date().toISOString()
        })
      };
    }

    // Analyze document status and expiry
    const documentStatus = analyzeDocumentStatus(driverStatus);
    const overallStatus = determineOverallStatus(documentStatus, driverStatus);

    console.log('Driver status analysis complete:', overallStatus);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: overallStatus,
        email: email,
        name: driverStatus.name,
        jobNumber: driverStatus.jobNumber,
        documents: documentStatus,
        insuranceStatus: driverStatus.insuranceStatus || 'pending',
        lastUpdated: driverStatus.updatedAt || new Date().toISOString(),
        mondayItemId: driverStatus.itemId
      })
    };

  } catch (error) {
    console.error('Driver status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get driver status',
        details: error.message 
      })
    };
  }
};

// Get driver status from Monday.com
async function getDriverStatusFromMonday(email) {
  try {
    console.log('Calling Monday.com integration for driver status');
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'get-driver-status',
        email: email
      })
    });

    if (!response.ok) {
      console.error('Monday.com driver status request failed:', response.status);
      return null;
    }

    const result = await response.json();
    console.log('Monday.com driver status response:', result.success);

    if (!result.success) {
      console.log('Driver not found in Monday.com:', result.error);
      return null;
    }

    return result.driver;

  } catch (error) {
    console.error('Error fetching driver status from Monday.com:', error);
    return null;
  }
}

// Analyze document status and expiry dates
function analyzeDocumentStatus(driverData) {
  const today = new Date();
  const documents = {
    license: { valid: false },
    poa1: { valid: false },
    poa2: { valid: false },
    dvlaCheck: { valid: false }
  };

  // License status
  if (driverData.licenseNumber && driverData.licenseExpiryDate) {
    const licenseExpiry = new Date(driverData.licenseExpiryDate);
    const daysUntilExpiry = Math.ceil((licenseExpiry - today) / (1000 * 60 * 60 * 24));
    
    documents.license = {
      valid: daysUntilExpiry > 0,
      expiryDate: driverData.licenseExpiryDate,
      daysUntilExpiry: daysUntilExpiry,
      expired: daysUntilExpiry <= 0,
      expiringSoon: daysUntilExpiry <= 30 && daysUntilExpiry > 0
    };
  }

  // POA1 status
  if (driverData.poa1ValidDate) {
    const poa1Expiry = new Date(driverData.poa1ValidDate);
    const daysUntilExpiry = Math.ceil((poa1Expiry - today) / (1000 * 60 * 60 * 24));
    
    documents.poa1 = {
      valid: daysUntilExpiry > 0,
      expiryDate: driverData.poa1ValidDate,
      daysUntilExpiry: daysUntilExpiry,
      expired: daysUntilExpiry <= 0,
      expiringSoon: daysUntilExpiry <= 7 && daysUntilExpiry > 0 // POA expires in 90 days, warn at 7 days
    };
  }

  // POA2 status
  if (driverData.poa2ValidDate) {
    const poa2Expiry = new Date(driverData.poa2ValidDate);
    const daysUntilExpiry = Math.ceil((poa2Expiry - today) / (1000 * 60 * 60 * 24));
    
    documents.poa2 = {
      valid: daysUntilExpiry > 0,
      expiryDate: driverData.poa2ValidDate,
      daysUntilExpiry: daysUntilExpiry,
      expired: daysUntilExpiry <= 0,
      expiringSoon: daysUntilExpiry <= 7 && daysUntilExpiry > 0
    };
  }

  // DVLA check status (needs to be within 30 days)
  if (driverData.dvlaCheckDate) {
    const dvlaDate = new Date(driverData.dvlaCheckDate);
    const daysSinceCheck = Math.ceil((today - dvlaDate) / (1000 * 60 * 60 * 24));
    
    documents.dvlaCheck = {
      valid: daysSinceCheck <= 30,
      lastCheck: driverData.dvlaCheckDate,
      daysSinceCheck: daysSinceCheck,
      expired: daysSinceCheck > 30,
      needsUpdate: daysSinceCheck > 30
    };
  }

  return documents;
}

// Determine overall driver status
function determineOverallStatus(documents, driverData) {
  // Check Monday.com status column first
  const mondayStatus = driverData.status?.toLowerCase();
  
  // If manually set to approved/rejected in Monday.com, respect that
  if (mondayStatus === 'done' || mondayStatus === 'approved') {
    return 'approved';
  }
  if (mondayStatus === 'stuck' || mondayStatus === 'rejected') {
    return 'rejected';
  }

  // Count valid/expired documents
  const validDocs = Object.values(documents).filter(doc => doc.valid).length;
  const expiredDocs = Object.values(documents).filter(doc => doc.expired).length;
  const expiringSoonDocs = Object.values(documents).filter(doc => doc.expiringSoon).length;

  // Determine status based on document state
  if (validDocs === 4) {
    // All documents valid
    if (expiringSoonDocs > 0) {
      return 'expiring_soon';
    }
    return 'verified';
  } else if (expiredDocs > 0) {
    // Some documents expired
    return 'documents_expired';
  } else if (validDocs > 0) {
    // Partial verification
    return 'partial';
  } else {
    // No valid documents
    return 'new';
  }
}

// Create mock driver status for development/testing
function createMockDriverStatus(email) {
  console.log('Creating mock driver status for:', email);
  
  return {
    status: 'new',
    email: email,
    name: null,
    documents: {
      license: { valid: false },
      poa1: { valid: false },
      poa2: { valid: false },
      dvlaCheck: { valid: false }
    },
    insuranceStatus: 'pending',
    lastUpdated: new Date().toISOString()
  };
}
