// File: functions/driver-status.js
// OOOSH Driver Verification - Get Driver Status Function
// UPDATED: Now returns licenseIssuedBy and passportValidUntil

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
    
    // Analyze document status with passport support
    const documentStatus = analyzeDocumentStatus(driver);
    
    // Build insurance data from driver fields
    const insuranceData = {
      datePassedTest: driver.datePassedTest || '',
      hasDisability: driver.hasDisability || false,
      hasConvictions: driver.hasConvictions || false,
      hasProsecution: driver.hasProsecution || false,
      hasAccidents: driver.hasAccidents || false,
      hasInsuranceIssues: driver.hasInsuranceIssues || false,
      hasDrivingBan: driver.hasDrivingBan || false,
      additionalDetails: driver.additionalDetails || ''
    };
    
    // UPDATED: Return complete data including licenseIssuedBy and passport dates
    return {
      status: documentStatus.overallStatus,
      email: email,
      name: driver.driverName || null,
      firstName: driver.firstName || null,  
      lastName: driver.lastName || null, 
      phoneNumber: driver.phoneNumber || null,
      phoneCountry: driver.phoneCountry || null,
      dateOfBirth: driver.dateOfBirth || null, 
      licenseNumber: driver.licenseNumber || null, 
      homeAddress: driver.homeAddress || null, 
      licenseAddress: driver.licenseAddress || null,   
      licenseIssuedBy: driver.licenseIssuedBy || null, // CRITICAL FOR UK DETECTION
      nationality: driver.nationality || null,
      documents: documentStatus.documents,
      insuranceData: insuranceData,
      boardAId: driver.id,
      lastUpdated: driver.lastUpdated || null,
      idenfyCheckDate: driver.idenfyCheckDate || null,
      idenfyScanRef: driver.idenfyScanRef || null,  
      // Include raw date fields for router
      licenseNextCheckDue: driver.licenseNextCheckDue || null,
      poa1ValidUntil: driver.poa1ValidUntil || null,
      poa2ValidUntil: driver.poa2ValidUntil || null,
      dvlaValidUntil: driver.dvlaValidUntil || null,
      passportValidUntil: driver.passportValidUntil || null,
      poa1URL: driver.poa1URL || null,
      poa2URL: driver.poa2URL || null,
      // DVLA insurance data
      dvlaPoints: driver.dvlaPoints || 0,
      dvlaEndorsements: driver.dvlaEndorsements || null,
      dvlaCalculatedExcess: driver.dvlaCalculatedExcess || null
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
    passportCheck: { valid: false },  // Added passport
    licenseCheck: { valid: true }
  };

  const today = new Date();

  // Check License Status
  if (driver.licenseValidTo) {
    const licenseExpiry = new Date(driver.licenseValidTo);
    documents.license = {
      valid: licenseExpiry > today,
      expiryDate: driver.licenseValidTo,
      type: 'Driving License',
      status: licenseExpiry > today ? 'valid' : 'expired'
    };
  }

  // Check POA1 Status
  if (driver.poa1ValidUntil) {
    const poa1Expiry = new Date(driver.poa1ValidUntil);
    documents.poa1 = {
      valid: poa1Expiry > today,
      expiryDate: driver.poa1ValidUntil,
      type: 'Proof of Address #1',
      status: poa1Expiry > today ? 'valid' : 'expired'
    };
  } else {
    documents.poa1 = {
      valid: false,
      status: 'required'
    };
  }

  // Check POA2 Status
  if (driver.poa2ValidUntil) {
    const poa2Expiry = new Date(driver.poa2ValidUntil);
    documents.poa2 = {
      valid: poa2Expiry > today,
      expiryDate: driver.poa2ValidUntil,
      type: 'Proof of Address #2',
      status: poa2Expiry > today ? 'valid' : 'expired'
    };
  } else {
    documents.poa2 = {
      valid: false,
      status: 'required'
    };
  }

  // Check DVLA Check Status (for UK drivers)
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

  // Check Passport Status (for non-UK drivers)
  if (driver.passportValidUntil) {
    const passportExpiry = new Date(driver.passportValidUntil);
    documents.passportCheck = {
      valid: passportExpiry > today,
      expiryDate: driver.passportValidUntil,
      status: passportExpiry > today ? 'valid' : 'expired',
      type: 'Passport Verification'
    };
  } else {
    documents.passportCheck = {
      valid: false,
      status: 'not_required'  // Will be determined by license issuer
    };
  }

 // Check License last checked Status
if (driver.licenseNextCheckDue && driver.licenseValidTo) {
  const licenseExpiry = new Date(driver.licenseValidTo);
  const licenseCheckDue = new Date(driver.licenseNextCheckDue);
  documents.license = {
    valid: licenseExpiry > today && licenseCheckDue > today,  // Both must be valid
    expiryDate: driver.licenseValidTo,
    type: 'Driving License',
    status: licenseExpiry > today && licenseCheckDue > today ? 'valid' : 'expired'
  };
} else {
  documents.license = { valid: false, status: 'required' };
}

  const overallStatus = determineOverallStatus(documents, driver);

  console.log('📊 Document analysis complete:', {
    overallStatus,
    licenseIssuedBy: driver.licenseIssuedBy,
    license: documents.license.valid,
    poa1: documents.poa1.valid,
    poa2: documents.poa2.valid,
    dvlaCheck: documents.dvlaCheck.valid,
    passportCheck: documents.passportCheck.valid
  });

  return { overallStatus, documents };
}

function determineOverallStatus(documents, driver) {
  const hasValidLicense = documents.license.valid;
  const hasValidPoa1 = documents.poa1.valid;
  const hasValidPoa2 = documents.poa2.valid;
  const hasValidDvla = documents.dvlaCheck.valid;
  const hasValidPassport = documents.passportCheck.valid;
  const licenseCheckCurrent = documents.licenseCheck?.valid !== false;
  
  const isUkDriver = driver.licenseIssuedBy === 'DVLA';

  const boardStatus = driver.overallStatus;

  if (boardStatus === 'Insurance Review') {
    return 'insurance_review';
  }

  if (boardStatus === 'Stuck') {
    return 'stuck';
  }

  // Check based on driver type
  if (isUkDriver) {
    // UK drivers need license, POAs, and DVLA
    if (hasValidLicense && hasValidPoa1 && hasValidPoa2 && hasValidDvla && licenseCheckCurrent) {
      return 'verified';
    }
  } else {
    // Non-UK drivers need license, POAs, and passport
    if (hasValidLicense && hasValidPoa1 && hasValidPoa2 && hasValidPassport && licenseCheckCurrent) {
      return 'verified';
    }
  }

  if (hasValidLicense) {
    if (!hasValidPoa1 || !hasValidPoa2) {
      return 'poa_expired';
    }
    if (isUkDriver && !hasValidDvla) {
      return 'dvla_expired';
    }
    if (!isUkDriver && !hasValidPassport) {
      return 'passport_expired';
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
    firstName: null, 
    lastName: null, 
    phoneNumber: null,
    phoneCountry: null,
    licenseIssuedBy: null,
    nationality: null,
    documents: {
      license: { valid: false, status: 'required' },
      poa1: { valid: false, status: 'required' },
      poa2: { valid: false, status: 'required' },
      dvlaCheck: { valid: false, status: 'required' },
      passportCheck: { valid: false, status: 'not_required' },
      licenseCheck: { valid: true, status: 'not_required' }
    },
    insuranceData: null,
    boardAId: null,
    lastUpdated: null,
    licenseNextCheckDue: null,
    poa1ValidUntil: null,
    poa2ValidUntil: null,
    dvlaValidUntil: null,
    passportValidUntil: null,
    idenfyScanRef: null
  };
}
