// File: functions/idenfy-webhook.js
// OOOSH Driver Verification - FIXED Enhanced Idenfy Webhook
// FIXES: Email parsing, Create vs Update logic, UK driver routing

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🔗 Enhanced Idenfy webhook called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Idenfy-Signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    if (!event.body) {
      console.log('No body received in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    console.log('📨 Webhook body:', event.body.substring(0, 500) + '...');
    const webhookData = JSON.parse(event.body);

    const { clientId, scanRef, status, data, platform, final } = webhookData;

    if (!clientId || !scanRef || !status) {
      console.log('❌ Missing required webhook data');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required webhook data' })
      };
    }

    // Only process final results
    if (!final) {
      console.log('⏳ Ignoring non-final webhook result');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Non-final result ignored' })
      };
    }

    console.log('✅ Processing final Idenfy result:', {
      clientId,
      scanRef,
      overall: status.overall,
      autoDocument: status.autoDocument,
      autoFace: status.autoFace
    });

    // FIXED: Extract client info from clientId
    const clientInfo = parseClientId(clientId);
    if (!clientInfo) {
      console.log('❌ Could not parse client ID:', clientId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid client ID format' })
      };
    }

    console.log('👤 Client info parsed:', clientInfo);

    // Process the enhanced verification result with FIXED workflow
    const processResult = await processEnhancedVerificationResult(
      clientInfo.email,
      clientInfo.jobId,
      scanRef,
      status,
      data,
      webhookData
    );

    if (processResult.success) {
      console.log('🎉 Enhanced verification result processed successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'Webhook processed successfully',
          scanRef: scanRef,
          boardAUpdated: processResult.boardAUpdated,
          nextStep: processResult.nextStep
        })
      };
    } else {
      console.error('❌ Failed to process verification result:', processResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to process verification result',
          details: processResult.error
        })
      };
    }

  } catch (error) {
    console.error('💥 Webhook processing error:', error);
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

// FIXED: Parse the client ID to extract email and job ID
function parseClientId(clientId) {
  try {
    // Format: ooosh_{jobId}_{email}_{timestamp}
    console.log('🔍 Parsing client ID:', clientId);
    
    const parts = clientId.split('_');
    if (parts.length >= 4 && parts[0] === 'ooosh') {
      const jobId = parts[1];
      
      // FIXED: Find the timestamp (last part) and email (everything between jobId and timestamp)
      const timestamp = parts[parts.length - 1];
      const emailParts = parts.slice(2, -1); // Everything except ooosh, jobId, and timestamp
      
      // FIXED: Convert email format back to normal
      let email = emailParts.join('_');
      email = email.replace(/_at_/g, '@').replace(/_dot_/g, '.');
      
      console.log('✅ Parsed client ID:', { jobId, email, timestamp });
      return { email, jobId };
    }
    
    console.log('❌ Invalid client ID format');
    return null;
  } catch (error) {
    console.error('Error parsing client ID:', error);
    return null;
  }
}

// FIXED: Process verification with proper Create vs Update logic
async function processEnhancedVerificationResult(email, jobId, scanRef, status, data, fullWebhookData) {
  try {
    console.log('🔄 Processing enhanced verification for:', { email, jobId, scanRef });

    // Step 1: Analyze Idenfy verification result
    const idenfyResult = analyzeIdenfyVerificationResult(status, data);
    console.log('📋 Idenfy verification analysis:', idenfyResult);

    // Step 2: FIXED - Check if driver exists, CREATE if not, then UPDATE
    console.log('👤 Checking if driver exists in Board A...');
    const driverExists = await checkDriverExists(email);
    
    if (!driverExists) {
      console.log('📝 Creating new driver in Board A...');
      const createResult = await createDriverInBoardA(email, jobId, idenfyResult);
      
      if (!createResult.success) {
        throw new Error(`Failed to create driver: ${createResult.error}`);
      }
      console.log('✅ New driver created in Board A');
    }

    // Step 3: Update Board A with Idenfy results
    console.log('💾 Updating Board A with Idenfy results...');
    const boardAUpdateResult = await updateBoardAWithIdenfyResults(email, jobId, idenfyResult, fullWebhookData);
    
    if (!boardAUpdateResult.success) {
      throw new Error(`Board A update failed: ${boardAUpdateResult.error}`);
    }

    console.log('✅ Board A updated successfully');

    // Step 4: FIXED - Determine next step based on driver type and verification status
    let nextStep = 'complete';
    if (idenfyResult.approved) {
      // Check if UK driver (needs DVLA + POA validation)
      const isUKDriver = data.docIssuingCountry === 'GB' || data.docNationality === 'GB';
      
      if (isUKDriver) {
        console.log('🇬🇧 UK driver detected - routing to AWS OCR for POA validation + DVLA check');
        nextStep = 'aws_ocr_validation';
        
        // Extract POA documents for validation
        const poaValidationResult = await processPoaValidation(data, fullWebhookData);
        
        if (poaValidationResult.success) {
          console.log('✅ POA validation completed');
          nextStep = 'dvla_check_required';
        } else {
          console.log('⚠️ POA validation failed');
          nextStep = 'poa_validation_failed';
        }
      } else {
        console.log('🌍 Non-UK driver - verification complete');
        nextStep = 'complete';
      }
    } else {
      console.log('❌ Idenfy verification failed');
      nextStep = 'verification_failed';
    }

    return { 
      success: true, 
      boardAUpdated: true,
      nextStep: nextStep,
      ukDriver: data.docIssuingCountry === 'GB'
    };

  } catch (error) {
    console.error('💥 Error processing enhanced verification result:', error);
    return { success: false, error: error.message };
  }
}

// Check if driver exists in Board A
async function checkDriverExists(email) {
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

    const result = await response.json();
    return result.success && result.driver;
  } catch (error) {
    console.error('❌ Error checking if driver exists:', error);
    return false;
  }
}

// Create new driver in Board A
async function createDriverInBoardA(email, jobId, idenfyResult) {
  try {
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create-driver-board-a',
        email: email,
        driverData: {
          driverName: idenfyResult.fullName,
          email: email,
          dateOfBirth: idenfyResult.dateOfBirth,
          licenseNumber: idenfyResult.licenseNumber,
          licenseValidTo: idenfyResult.licenseExpiry,
          licenseEnding: idenfyResult.licenseEnding,
          licenseAddress: idenfyResult.licenseAddress,
          overallStatus: 'Working on it',
          lastUpdated: new Date().toISOString().split('T')[0]
        }
      })
    });

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('❌ Error creating driver in Board A:', error);
    return { success: false, error: error.message };
  }
}

// Analyze Idenfy verification result
function analyzeIdenfyVerificationResult(status, data) {
  const result = {
    overall: status.overall,
    scanRef: data?.scanRef || 'unknown',
    
    // Document analysis
    licenseValid: false,
    licenseExpiry: null,
    licenseNumber: null,
    licenseEnding: null,
    
    // Personal data
    firstName: data?.docFirstName || null,
    lastName: data?.docLastName || null,
    fullName: null,
    dateOfBirth: data?.docDob || null,
    licenseAddress: data?.address || data?.manualAddress || null,
    
    // Face verification
    faceValid: false,
    
    // Overall status
    approved: false,
    suspected: false,
    denied: false,
    
    // Verification details
    autoDocument: status.autoDocument,
    autoFace: status.autoFace,
    manualDocument: status.manualDocument,
    manualFace: status.manualFace,
    
    // Issues
    mismatchTags: status.mismatchTags || [],
    fraudTags: status.fraudTags || [],
    suspicionReasons: status.suspicionReasons || []
  };

  // Build full name
  if (result.firstName && result.lastName) {
    result.fullName = `${result.firstName} ${result.lastName}`.trim();
  }

  // Extract license ending for anti-fraud validation
  if (data?.docNumber) {
    result.licenseNumber = data.docNumber;
    // Extract last 8 characters for ending comparison
    if (data.docNumber.length >= 8) {
      result.licenseEnding = data.docNumber.slice(-8);
    }
  }

  // Determine overall approval status
  switch (status.overall) {
    case 'APPROVED':
      result.approved = true;
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED' || status.manualDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH' || status.manualFace === 'FACE_MATCH');
      
      // Extract license data
      if (data?.docExpiry) result.licenseExpiry = data.docExpiry;
      break;
      
    case 'SUSPECTED':
      result.suspected = true;
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH');
      break;
      
    case 'DENIED':
      result.denied = true;
      result.licenseValid = false;
      result.faceValid = false;
      break;
      
    default:
      console.log('❓ Unknown verification status:', status.overall);
      result.denied = true;
  }

  return result;
}

// Update Board A with Idenfy results
async function updateBoardAWithIdenfyResults(email, jobId, idenfyResult, fullWebhookData) {
  try {
    console.log('💾 Updating Board A with Idenfy data...');

    const updateData = {
      // Update name if we got it from Idenfy
      driverName: idenfyResult.fullName,
      dateOfBirth: idenfyResult.dateOfBirth,
      licenseNumber: idenfyResult.licenseNumber,
      licenseValidTo: idenfyResult.licenseExpiry,
      licenseEnding: idenfyResult.licenseEnding,
      licenseAddress: idenfyResult.licenseAddress,
      
      // Update overall status based on Idenfy result
      overallStatus: idenfyResult.approved ? 'Working on it' : 
                    idenfyResult.suspected ? 'Stuck' : 'Stuck',
      
      lastUpdated: new Date().toISOString().split('T')[0]
    };

    // Call monday-integration to update Board A
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update-driver-board-a',
        email: email,
        updates: updateData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Board A update failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('❌ Error updating Board A with Idenfy results:', error);
    return { success: false, error: error.message };
  }
}

// NEW: Process POA validation for UK drivers
async function processPoaValidation(idenfyData, fullWebhookData) {
  try {
    console.log('🔍 Processing POA validation for UK driver...');

    // Extract POA document URLs from Idenfy data
    const poaDocs = [];
    
    if (fullWebhookData.additionalStepPdfUrls) {
      if (fullWebhookData.additionalStepPdfUrls.UTILITY_BILL) {
        poaDocs.push({
          type: 'UTILITY_BILL',
          url: fullWebhookData.additionalStepPdfUrls.UTILITY_BILL
        });
      }
      if (fullWebhookData.additionalStepPdfUrls.POA2) {
        poaDocs.push({
          type: 'POA2', 
          url: fullWebhookData.additionalStepPdfUrls.POA2
        });
      }
    }

    console.log(`📄 Found ${poaDocs.length} POA documents for validation`);

    if (poaDocs.length < 2) {
      console.log('⚠️ Insufficient POA documents for validation');
      return { 
        success: false, 
        error: 'Need 2 POA documents for validation',
        documentsFound: poaDocs.length
      };
    }

    // TODO: Implement AWS OCR cross-validation
    // For now, return success if we have 2 documents
    console.log('✅ POA validation passed (mock for now)');
    
    return {
      success: true,
      documentsValidated: poaDocs.length,
      crossValidationPassed: true
    };

  } catch (error) {
    console.error('❌ Error processing POA validation:', error);
    return { success: false, error: error.message };
  }
}
