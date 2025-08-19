// File: functions/driver-status.js
// OOOSH Driver Verification - Get Driver Status Function
// FIXED: Now returns insuranceData, phoneCountry, and proper document dates

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Driver status function called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

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

async function getDriverStatusFromBoardA(email) {
  console.log('🔍 Looking up driver in Board A:', email);
  
  try {
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
    
    const driver = result.driver;
    
    // Analyze document status
    const documentStatus = analyzeDocumentStatus(driver);
    
    // FIXED: Build insurance data from driver fields
    const insuranceData = {
      hasDisability: driver.hasDisability || false,
      hasConvictions: driver.hasConvictions || false,
      hasProsecution: driver.hasProsecution || false,
      hasAccidents: driver.hasAccidents || false,
      hasInsuranceIssues: driver.hasInsuranceIssues || false,
      hasDrivingBan: driver.hasDrivingBan || false,
      additionalDetails: driver.additionalDetails || ''
    };
    
    // FIXED: Return complete data structure
    return {
      status: documentStatus.overallStatus,
      email: email,
      name: driver.driverName || null,
      phoneNumber: driver.phoneNumber || null,
      phoneCountry: driver.phoneCountry || null, // FIXED: Added phone country
      documents: documentStatus.documents,
      insuranceData: insuranceData, // FIXED: Added insurance data
      boardAId: driver.id,
      lastUpdated: driver.lastUpdated || null
    };

  } catch (error) {
    console.error('Error getting driver status from Board A:', error);
    return createNewDriverStatus(email);
  }
}

function analyzeDocumentStatus(driver) {
  console.log('📊 Analyzing document status for driver');
  
  const documents = {
    license: { valid: false },
    poa1: { valid: false },
    poa2: { valid: false },
    dvlaCheck: { valid: false },
    licenseCheck: { valid: true }
  };

  const today = new Date();

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

  // FIXED: Always include expiryDate even if expired
  if (driver.poa1ValidUntil) {
    const poa1Expiry = new Date(driver.poa1ValidUntil);
    documents.poa1 = {
      valid: poa1Expiry > today,
      expiryDate: driver.poa1ValidUntil, // ALWAYS include date
      type: 'Proof of Address #1',
      status: poa1Expiry > today ? 'valid' : 'expired'
    };
  } else {
    // Even if no date, provide structure
    documents.poa1 = {
      valid: false,
      status: 'required'
    };
  }

  // FIXED: Always include expiryDate even if expired
  if (driver.poa2ValidUntil) {
    const poa2Expiry = new Date(driver.poa2ValidUntil);
    documents.poa2 = {
      valid: poa2Expiry > today,
      expiryDate: driver.poa2ValidUntil, // ALWAYS include date
      type: 'Proof of Address #2',
      status: poa2Expiry > today ? 'valid' : 'expired'
    };
  } else {
    // Even if no date, provide structure
    documents.poa2 = {
      valid: false,
      status: 'required'
    };
  }

  // Check DVLA Check Status
  if (driver.dvlaValidUntil) {
    const dvlaExpiry = new Date(driver.dvlaValidUntil);
    documents.dvlaCheck = {
      valid: dvlaExpiry > today,
      expiryDate: driver.dvlaValidUntil,
      status: dvlaExpiry > today ? 'valid' : 'expired',
      type: 'DVLA Check'
    };
  } else {
    documents.dvlaCheck = {
      valid: false,
      status: 'required'
    };
  }

  // Check License Last Checked Status
  if (driver.licenseNextCheckDue) {
    const licenseCheckDue = new Date(driver.licenseNextCheckDue);
    documents.licenseCheck = {
      valid: licenseCheckDue > today,
      nextCheckDue: driver.licenseNextCheckDue,
      status: licenseCheckDue > today ? 'valid' : 'due',
      type: 'License Verification'
    };
  }

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

function determineOverallStatus(documents, driver) {
  const hasValidLicense = documents.license.valid;
  const hasValidPoa1 = documents.poa1.valid;
  const hasValidPoa2 = documents.poa2.valid;
  const hasValidDvla = documents.dvlaCheck.valid;
  const licenseCheckCurrent = documents.licenseCheck?.valid !== false;

  const boardStatus = driver.overallStatus;

  if (boardStatus === 'Insurance Review') {
    return 'insurance_review';
  }

  if (boardStatus === 'Stuck') {
    return 'stuck';
  }

  if (hasValidLicense && hasValidPoa1 && hasValidPoa2 && hasValidDvla && licenseCheckCurrent) {
    return 'verified';
  }

  if (hasValidLicense) {
    if (!hasValidPoa1 || !hasValidPoa2) {
      return 'poa_expired';
    }
    if (!hasValidDvla) {
      return 'dvla_expired';
    }
    if (!licenseCheckCurrent) {
      return 'license_check_due';
    }
  }

  if (hasValidLicense || hasValidPoa1 || hasValidPoa2) {
    return 'partial';
  }

  if (driver.driverName) {
    return 'pending';
  }

  return 'new';
}

function createNewDriverStatus(email) {
  console.log('👤 Creating new driver status for:', email);
  
  return {
    status: 'new',
    email: email,
    name: null,
    phoneNumber: null,
    phoneCountry: null,
    documents: {
      license: { valid: false, status: 'required' },
      poa1: { valid: false, status: 'required' },
      poa2: { valid: false, status: 'required' },
      dvlaCheck: { valid: false, status: 'required' },
      licenseCheck: { valid: true, status: 'not_required' }
    },
    insuranceData: null,
    boardAId: null,
    lastUpdated: null
  };
}
