// File: functions/get-next-step.js
// OOOSH Driver Verification - Centralized Routing Engine
// This is the single source of truth for all routing decisions based on document expiry dates

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🎯 Centralized router called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { email, currentStep } = event.httpMethod === 'GET' 
      ? event.queryStringParameters 
      : JSON.parse(event.body);

    if (!email) {
      throw new Error('Email is required for routing decision');
    }

    console.log(`🔍 Determining next step for: ${email}`);
    console.log(`📍 Current step: ${currentStep || 'unknown'}`);

    // Get driver's current status from Board A
    const driverStatus = await getDriverStatus(email);
    
    // Calculate the next required step based on document dates
    const nextStep = calculateNextStep(driverStatus, currentStep);
    
    console.log(`✅ Next step determined: ${nextStep.step}`);
    console.log(`📋 Reason: ${nextStep.reason}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email: email,
        currentStep: currentStep,
        nextStep: nextStep.step,
        reason: nextStep.reason,
        driverData: driverStatus,
        documentStatus: analyzeDocuments(driverStatus)
      })
    };

  } catch (error) {
    console.error('❌ Router error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: error.message 
      })
    };
  }
};

// Get driver status from Board A via driver-status function
async function getDriverStatus(email) {
  console.log('📊 Fetching driver status for routing decision');
  
  try {
    const response = await fetch(
      `${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`
    );

    if (!response.ok) {
      console.log('Driver not found, treating as new driver');
      return { status: 'new', email: email };
    }

    const data = await response.json();
    console.log('✅ Driver data retrieved');
    return data;

  } catch (error) {
    console.error('Error fetching driver status:', error);
    return { status: 'new', email: email };
  }
}

// Core routing logic - calculates next step based on document expiry dates
function calculateNextStep(driverData, currentStep) {
  console.log('🧮 Calculating next step from document dates');
  
  const today = new Date();
  const analysis = analyzeDocuments(driverData);
  
  // Log what we're analyzing
  console.log('📅 Document validity:', {
    license: analysis.license.valid,
    licenseExpiry: analysis.license.expiryDate,
    poa1: analysis.poa1.valid,
    poa1Expiry: analysis.poa1.expiryDate,
    poa2: analysis.poa2.valid,
    poa2Expiry: analysis.poa2.expiryDate,
    dvlaOrPassport: analysis.dvlaOrPassport.valid,
    dvlaOrPassportExpiry: analysis.dvlaOrPassport.expiryDate,
    isUkDriver: analysis.isUkDriver
  });

  // ROUTING DECISION TREE

  // 1. If everything is valid, go to signature
  if (analysis.allValid) {
    return {
      step: 'signature',
      reason: 'All documents are valid and up to date'
    };
  }

  // 2. If coming from insurance questionnaire, determine Idenfy needs
  if (currentStep === 'insurance-complete') {
    if (analysis.license.valid && analysis.poa1.valid && analysis.poa2.valid) {
      // License and POAs are valid, check DVLA/Passport
      if (analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
        return {
          step: 'dvla-check',
          reason: 'UK driver needs DVLA check'
        };
      } else if (!analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
        return {
          step: 'passport-upload',
          reason: 'Non-UK driver needs passport verification'
        };
      }
      return {
        step: 'signature',
        reason: 'All required documents are valid'
      };
    }
    
    // Determine what needs uploading via Idenfy
    const idenfyRequirements = [];
    if (!analysis.license.valid) idenfyRequirements.push('license');
    if (!analysis.poa1.valid) idenfyRequirements.push('poa1');
    if (!analysis.poa2.valid) idenfyRequirements.push('poa2');
    
    if (idenfyRequirements.length === 3 || !driverData.idenfyCheckDate) {
      return {
        step: 'full-idenfy',
        reason: 'First time verification or all documents expired'
      };
    } else {
      return {
        step: 'selective-idenfy',
        reason: `Need to upload: ${idenfyRequirements.join(', ')}`
      };
    }
  }

  // 3. If coming from Idenfy webhook/processing hub
  if (currentStep === 'idenfy-complete' || currentStep === 'processing-hub') {
    // Check if POAs need validation
    if (!analysis.poa1.valid || !analysis.poa2.valid) {
      return {
        step: 'poa-validation',
        reason: 'POAs need validation and date extraction'
      };
    }
    
    // POAs are valid, check UK driver status
    if (analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
      return {
        step: 'dvla-check',
        reason: 'UK driver needs DVLA check'
      };
    } else if (!analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
      return {
        step: 'passport-upload',
        reason: 'Non-UK driver needs passport verification'
      };
    }
    
    return {
      step: 'signature',
      reason: 'All verifications complete'
    };
  }

  // 4. If coming from POA validation
  if (currentStep === 'poa-validation-complete') {
    if (analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
      return {
        step: 'dvla-check',
        reason: 'UK driver needs DVLA check after POA validation'
      };
    } else if (!analysis.isUkDriver && !analysis.dvlaOrPassport.valid) {
      return {
        step: 'passport-upload',
        reason: 'Non-UK driver needs passport after POA validation'
      };
    }
    
    return {
      step: 'signature',
      reason: 'POA validation complete, all documents valid'
    };
  }

  // 5. If coming from DVLA check
  if (currentStep === 'dvla-complete') {
    return {
      step: 'signature',
      reason: 'DVLA check complete, ready for signature'
    };
  }

  // 6. If coming from passport upload
  if (currentStep === 'passport-complete') {
    return {
      step: 'signature',
      reason: 'Passport verification complete, ready for signature'
    };
  }

  // 7. Default fallback - analyze what's needed
  if (!analysis.license.valid || !analysis.poa1.valid || !analysis.poa2.valid) {
    return {
      step: 'full-idenfy',
      reason: 'Documents expired or missing, need Idenfy verification'
    };
  }

  return {
    step: 'signature',
    reason: 'Default route to signature'
  };
}

// Analyze document validity from dates
function analyzeDocuments(driverData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to start of day for date comparison
  
  const analysis = {
    license: { valid: false, expiryDate: null },
    poa1: { valid: false, expiryDate: null },
    poa2: { valid: false, expiryDate: null },
    dvlaOrPassport: { valid: false, expiryDate: null, type: null },
    isUkDriver: false,
    allValid: false
  };

  // FIXED: Only check who issued the license - that's what matters
  analysis.isUkDriver = driverData.licenseIssuedBy === 'DVLA';

  console.log('🚗 License Issuer Check:', {
    licenseIssuedBy: driverData.licenseIssuedBy,
    isUkDriver: analysis.isUkDriver,
    nationality: driverData.nationality // Log for reference but don't use
  });

  // Check license validity (using licenseNextCheckDue date)
  if (driverData.licenseNextCheckDue || driverData.documents?.licenseCheck?.nextCheckDue) {
    const licenseDate = new Date(
      driverData.licenseNextCheckDue || driverData.documents.licenseCheck.nextCheckDue
    );
    analysis.license.valid = licenseDate > today;
    analysis.license.expiryDate = licenseDate.toISOString().split('T')[0];
  }

  // Check POA1 validity
  if (driverData.poa1ValidUntil || driverData.documents?.poa1?.expiryDate) {
    const poa1Date = new Date(
      driverData.poa1ValidUntil || driverData.documents.poa1.expiryDate
    );
    analysis.poa1.valid = poa1Date > today;
    analysis.poa1.expiryDate = poa1Date.toISOString().split('T')[0];
  }

  // Check POA2 validity
  if (driverData.poa2ValidUntil || driverData.documents?.poa2?.expiryDate) {
    const poa2Date = new Date(
      driverData.poa2ValidUntil || driverData.documents.poa2.expiryDate
    );
    analysis.poa2.valid = poa2Date > today;
    analysis.poa2.expiryDate = poa2Date.toISOString().split('T')[0];
  }

  // Check DVLA or Passport validity based on driver type
  if (analysis.isUkDriver) {
    // UK license holders need DVLA check
    if (driverData.dvlaValidUntil || driverData.documents?.dvlaCheck?.expiryDate) {
      const dvlaDate = new Date(
        driverData.dvlaValidUntil || driverData.documents.dvlaCheck.expiryDate
      );
      analysis.dvlaOrPassport.valid = dvlaDate > today;
      analysis.dvlaOrPassport.expiryDate = dvlaDate.toISOString().split('T')[0];
      analysis.dvlaOrPassport.type = 'dvla';
    }
  } else {
    // Non-UK license holders need passport check
    if (driverData.passportValidUntil) {
      const passportDate = new Date(driverData.passportValidUntil);
      analysis.dvlaOrPassport.valid = passportDate > today;
      analysis.dvlaOrPassport.expiryDate = passportDate.toISOString().split('T')[0];
      analysis.dvlaOrPassport.type = 'passport';
    }
  }

  // Check if all required documents are valid
  analysis.allValid = analysis.license.valid && 
                     analysis.poa1.valid && 
                     analysis.poa2.valid && 
                     analysis.dvlaOrPassport.valid;

  return analysis;
}
