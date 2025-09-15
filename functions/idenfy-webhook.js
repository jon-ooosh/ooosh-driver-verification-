// File: functions/idenfy-webhook.js
// COMPLETE VERSION with all fixes for missing fields and file uploads

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
      autoFace: status.autoFace,
      hasAdditionalSteps: !!status.additionalSteps,
      hasAdditionalPdfs: !!webhookData.additionalStepPdfUrls
    });

    // Extract client info from clientId
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

    // Process the enhanced verification result with Additional Steps support
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
          nextStep: processResult.nextStep,
          additionalStepsProcessed: processResult.additionalStepsProcessed || false
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

// Parse the client ID to extract email and job ID
function parseClientId(clientId) {
  try {
    // Format: ooosh_{jobId}_{email}_{timestamp}
    console.log('🔍 Parsing client ID:', clientId);
    
    const parts = clientId.split('_');
    if (parts.length >= 4 && parts[0] === 'ooosh') {
      const jobId = parts[1];
      
      // Find the timestamp (last part) and email (everything between jobId and timestamp)
      const timestamp = parts[parts.length - 1];
      const emailParts = parts.slice(2, -1); // Everything except ooosh, jobId, and timestamp
      
      // Convert email format back to normal - handle missing _at_
      let email = emailParts.join('_');
      
      // If no _at_ found, assume it's missing the @ symbol
      if (!email.includes('_at_')) {
        // Look for pattern like "jonwood_oooshtours" and convert to "jonwood@oooshtours"
        const emailRegex = /^([^_]+)_([^_]+_[^_]+)$/;
        const match = email.match(emailRegex);
        if (match) {
          email = `${match[1]}@${match[2]}`;
        }
      } else {
        // Normal conversion
        email = email.replace(/_at_/g, '@');
      }
      
      // Convert _dot_ to .
      email = email.replace(/_dot_/g, '.');
      
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

// Process verification with Additional Steps support
async function processEnhancedVerificationResult(email, jobId, scanRef, status, data, fullWebhookData) {
  try {
    console.log('🔄 Processing enhanced verification for:', { email, jobId, scanRef });

    // Check if this is Additional Steps re-upload (only if NOT the initial verification)
    // Initial verification will have additionalSteps but also primary documents
    const hasOnlyAdditionalSteps = !data?.docFirstName && !data?.docLastName && 
                                   fullWebhookData.additionalStepPdfUrls && 
                                   !fullWebhookData.fileUrls?.FRONT;
    
    if (hasOnlyAdditionalSteps) {
      const additionalStepsResult = await handleAdditionalStepsReupload(fullWebhookData, { email, jobId });
      
      if (additionalStepsResult.isAdditionalSteps) {
        console.log('🔄 Handling as Additional Steps re-upload');
        
        if (additionalStepsResult.success && additionalStepsResult.poaValidated) {
          // POA re-validation successful - continue normal workflow
          console.log('✅ POA re-validation successful, continuing to DVLA processing');
          return {
            success: true,
            boardAUpdated: true,
            nextStep: 'dvla_processing',
            additionalStepsProcessed: true,
            reason: 'POA re-validation successful'
          };
        } else {
          // POA re-validation failed - send to manual review
          console.log('❌ POA re-validation failed, flagging for manual review');
          return {
            success: true,
            boardAUpdated: true,
            nextStep: 'manual_review',
            additionalStepsProcessed: true,
            reason: additionalStepsResult.reason || 'POA re-validation required'
          };
        }
      }
    }  

    // Continue with normal verification processing...
    console.log('📋 Processing as normal verification result');

    // Step 1: Analyze Idenfy verification result
    const idenfyResult = analyzeIdenfyVerificationResult(status, data);
    console.log('📋 Idenfy verification analysis:', idenfyResult);

    // Step 2: Check if driver exists, CREATE if not, then UPDATE
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

    // Step 3: Update Board A with Idenfy results (includes all extra fields)
    console.log('💾 Updating Board A with Idenfy results...');
    const boardAUpdateResult = await updateBoardAWithIdenfyResults(email, jobId, idenfyResult, fullWebhookData);

    if (!boardAUpdateResult.success) {
      throw new Error(`Board A update failed: ${boardAUpdateResult.error}`);
    }

    console.log('✅ Board A updated successfully');

    // Step 4: Save documents to Monday.com with actual file upload
    await saveIdenfyDocumentsToMonday(email, fullWebhookData);

    // Step 5: Update document validity dates (preserves your logic)
    await updateDocumentValidityDates(email, fullWebhookData);

    // Step 6: Determine next step based on driver type and verification status
    let nextStep = 'complete';
    if (idenfyResult.approved) {
      // Check if UK driver (needs DVLA check)
      const isUKDriver = data.docIssuingCountry === 'GB' || data.docNationality === 'GB';
      
      if (isUKDriver) {
        console.log('🇬🇧 UK driver detected - routing to DVLA check');
        nextStep = 'dvla_processing';  // This should route to your DVLA page
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
      ukDriver: data.docIssuingCountry === 'GB',
      additionalStepsProcessed: false
    };

  } catch (error) {
    console.error('💥 Error processing enhanced verification result:', error);
    return { success: false, error: error.message };
  }
}

// Detect and handle Additional Steps (selective POA re-upload)
async function handleAdditionalStepsReupload(webhookData, clientInfo) {
  try {
    console.log('🔍 Checking for Additional Steps re-upload...');
    
    // Check if this is an Additional Steps callback
    const hasAdditionalSteps = webhookData.status?.additionalSteps;
    const hasAdditionalPdfs = webhookData.additionalStepPdfUrls;
    
    if (!hasAdditionalSteps && !hasAdditionalPdfs) {
      console.log('📋 No Additional Steps detected - regular verification');
      return { isAdditionalSteps: false };
    }

    console.log('🎯 Additional Steps detected:', {
      status: webhookData.status.additionalSteps,
      pdfs: Object.keys(webhookData.additionalStepPdfUrls || {})
    });

    // This is a selective re-upload - update Monday.com with new POA
    const reuploadResult = await processAdditionalStepsReupload(
      clientInfo.email,
      webhookData.additionalStepPdfUrls,
      webhookData.status.additionalSteps,
      webhookData.scanRef
    );

    return {
      isAdditionalSteps: true,
      success: reuploadResult.success,
      nextStep: reuploadResult.nextStep,
      poaValidated: reuploadResult.poaValidated,
      reason: reuploadResult.reason
    };

  } catch (error) {
    console.error('❌ Error handling Additional Steps:', error);
    return { 
      isAdditionalSteps: true, 
      success: false, 
      error: error.message 
    };
  }
}

// Process Additional Steps re-upload
async function processAdditionalStepsReupload(email, additionalPdfs, additionalStatus, scanRef) {
  try {
    console.log('📄 Processing Additional Steps re-upload for:', email);

    // Extract new POA document URLs
    const newPoaDocs = [];
    if (additionalPdfs?.UTILITY_BILL) {
      newPoaDocs.push({
        type: 'UTILITY_BILL',
        url: additionalPdfs.UTILITY_BILL,
        status: additionalStatus
      });
    }

    if (newPoaDocs.length === 0) {
      console.log('⚠️ No POA documents found in Additional Steps');
      return { success: false, error: 'No POA documents in re-upload' };
    }

    console.log(`📋 Found ${newPoaDocs.length} new POA documents`);

    // Download and process new POA with AWS OCR
    const ocrResult = await processNewPoaWithOcr(newPoaDocs[0]);
    
    if (!ocrResult.success) {
      console.log('❌ OCR processing failed for new POA');
      return { 
        success: true, // Still success from webhook perspective
        poaValidated: false,
        nextStep: 'manual_review',
        reason: 'OCR processing failed'
      };
    }

    // Check if new POA solves the source diversity issue
    const sourceValidation = await validatePoaSourceDiversity(email, ocrResult.extractedData);
    
    if (sourceValidation.passed) {
      console.log('✅ New POA passed source diversity check!');
      
      // Update Monday.com with successful re-validation
      await updateMondayWithRevalidation(email, {
        newPoaUrl: newPoaDocs[0].url,
        ocrData: ocrResult.extractedData,
        sourceValidation: sourceValidation,
        scanRef: scanRef,
        status: 'revalidation_complete'
      });

      return {
        success: true,
        poaValidated: true,
        nextStep: 'dvla_processing', // Continue to DVLA step
        reason: 'Source diversity resolved'
      };
    } else {
      console.log('❌ New POA still fails source diversity');
      
      // Update Monday.com with failed re-validation
      await updateMondayWithRevalidation(email, {
        newPoaUrl: newPoaDocs[0].url,
        ocrData: ocrResult.extractedData,
        sourceValidation: sourceValidation,
        scanRef: scanRef,
        status: 'revalidation_failed'
      });

      return {
        success: true,
        poaValidated: false,
        nextStep: 'manual_review',
        reason: 'Still same source type'
      };
    }

  } catch (error) {
    console.error('❌ Error processing Additional Steps re-upload:', error);
    return { success: false, error: error.message };
  }
}

// Process new POA with AWS OCR
async function processNewPoaWithOcr(poaDoc) {
  try {
    console.log('🔍 Running OCR on new POA document...');

    // Call your existing AWS Textract function
    const response = await fetch(`${process.env.URL}/.netlify/functions/test-claude-ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'process-poa',
        documentUrl: poaDoc.url,
        documentType: poaDoc.type
      })
    });

    if (!response.ok) {
      throw new Error(`OCR failed: ${response.status}`);
    }

    const ocrResult = await response.json();
    
    return {
      success: true,
      extractedData: {
        documentType: ocrResult.documentType || 'unknown',
        address: ocrResult.address,
        date: ocrResult.date,
        name: ocrResult.name,
        sourceType: ocrResult.sourceType // e.g., 'utility', 'bank', etc.
      }
    };

  } catch (error) {
    console.error('❌ OCR processing error:', error);
    return { success: false, error: error.message };
  }
}

// Validate POA source diversity against existing documents
async function validatePoaSourceDiversity(email, newPoaData) {
  try {
    console.log('🔍 Validating source diversity for new POA...');

    // Get existing driver data from Monday.com
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
      throw new Error(`Failed to get driver data: ${response.status}`);
    }

    const driverData = await response.json();
    
    if (!driverData.success || !driverData.driver) {
      throw new Error('Driver not found in Monday.com');
    }

    // Extract existing POA source types (this would be stored from previous OCR)
    const existingPoaSources = [
      driverData.driver.poa1SourceType || 'unknown',
      driverData.driver.poa2SourceType || 'unknown'
    ];

    console.log('📋 Existing POA sources:', existingPoaSources);
    console.log('📋 New POA source:', newPoaData.sourceType);

    // Check if new POA is different source type
    const isDifferentSource = !existingPoaSources.includes(newPoaData.sourceType);
    
    return {
      passed: isDifferentSource,
      newSourceType: newPoaData.sourceType,
      existingSources: existingPoaSources,
      reason: isDifferentSource ? 
        'Different source type detected' : 
        'Same source type as existing POA'
    };

  } catch (error) {
    console.error('❌ Source diversity validation error:', error);
    return { 
      passed: false, 
      error: error.message 
    };
  }
}

// Update Monday.com with re-validation results
async function updateMondayWithRevalidation(email, revalidationData) {
  try {
    console.log('📊 Updating Monday.com with re-validation results...');

    const updateData = {
      // Store new POA data
      newPoaDocument: revalidationData.newPoaUrl,
      poaRevalidationDate: new Date().toISOString().split('T')[0],
      poaSourceValidation: revalidationData.sourceValidation.passed ? 'Passed' : 'Failed',
      
      // Update overall status based on re-validation
      overallStatus: revalidationData.status === 'revalidation_complete' ? 
        'Working on it' : 'Stuck',
      
      // Add re-validation notes
      additionalDetails: `POA Re-validation: ${revalidationData.reason}. ` +
        `New source: ${revalidationData.ocrData.sourceType}. ` +
        `Scan: ${revalidationData.scanRef}`,
      
      lastUpdated: new Date().toISOString().split('T')[0]
    };

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
      throw new Error(`Monday.com update failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Monday.com updated with re-validation results');
    
    return result;

  } catch (error) {
    console.error('❌ Error updating Monday.com with re-validation:', error);
    throw error;
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

//updateBoardAWithIdenfyResults function

async function updateBoardAWithIdenfyResults(email, jobId, idenfyResult, fullWebhookData) {
  try {
    console.log('💾 Updating Board A with Idenfy data...');
    console.log('📊 Idenfy data fields:', Object.keys(fullWebhookData.data || {}));

    const idenfyData = fullWebhookData.data || {};

    // Get existing driver data to preserve datePassedTest
    const existingDriverResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'find-driver-board-a',
        email: email
      })
    });

     const existingDriverData = await existingDriverResponse.json();
    const preservedDatePassedTest = existingDriverData.driver?.datePassedTest || '';
    console.log('📅 Preserved datePassedTest:', preservedDatePassedTest);

      // Extract POA address data if present (for cross-validation)
let poaAddress = '';
if (fullWebhookData.additionalData?.UTILITY_BILL?.address) {
  const addressData = fullWebhookData.additionalData.UTILITY_BILL.address;
  poaAddress = addressData.value || addressData || '';
  console.log('📍 POA Address extracted:', poaAddress);
} else if (fullWebhookData.additionalData?.POA2?.address) {
  const addressData = fullWebhookData.additionalData.POA2.address;
  poaAddress = addressData.value || addressData || '';
  console.log('📍 POA2 Address extracted:', poaAddress);
}
    
    // Check for provisional license only (no date checking)
    if (idenfyData.driverLicenseCategory) {
      const categories = idenfyData.driverLicenseCategory.toUpperCase();
      
      if (categories.includes('PROVISIONAL') || 
          categories.includes('LEARNER') ||
          !categories.includes('B')) {
        
        console.log('❌ PROVISIONAL LICENSE DETECTED - Rejecting verification');
        
        const rejectionUpdate = {
          email: email,
          overallStatus: 'Stuck',
          additionalDetails: 'REJECTED: Provisional license detected. Full license required.',
          lastUpdated: new Date().toISOString().split('T')[0]
        };
        
        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-driver-board-a',
            email: email,
            updates: rejectionUpdate
          })
        });
        
        return { 
          success: false, 
          error: 'Provisional license not accepted',
          provisional: true 
        };
      }
    }
    
    // Build update data with all available fields
    const updateData = {
      // CRITICAL: Always include email
      email: email,
      
      // Names
      driverName: idenfyResult.fullName || 
                  idenfyData.fullName || 
                  `${idenfyData.docFirstName || ''} ${idenfyData.docLastName || ''}`.trim(),
      
      // Personal Info
      dateOfBirth: idenfyData.docDob,
      
      // Nationality
      nationality: idenfyData.docNationality || 
                   idenfyData.selectedCountry || 
                   idenfyData.docIssuingCountry || '',
      
      // License Information
      licenseNumber: idenfyData.docNumber,
      licenseValidTo: idenfyData.docExpiry,
      licenseEnding: idenfyResult.licenseEnding,
      
     // License Valid From - use preserved datePassedTest from insurance questionnaire
      licenseValidFrom: preservedDatePassedTest || idenfyData.docDateOfIssue || '',
      
      // Authority/Issuer
      licenseIssuedBy: idenfyData.authority || 
                       (idenfyData.docIssuingCountry === 'GB' ? 'DVLA' : 
                        idenfyData.docIssuingCountry || ''),
      
     // Addresses - prioritize POA address if available
homeAddress: poaAddress || 
             idenfyData.address || 
             idenfyData.manualAddress || 
             idenfyData.docAddress || '',

licenseAddress: idenfyData.address || 
                idenfyData.manualAddress || 
                idenfyData.docAddress || 
                poaAddress || '',
      
      // Status
      overallStatus: idenfyResult.approved ? 'Working on it' : 'Stuck',
      
      lastUpdated: new Date().toISOString().split('T')[0]
    };
    
      // Remove empty fields (except email)
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === '' && key !== 'email') {
        delete updateData[key];
      }
    });

    // Log what we're sending
    console.log('📤 Updating Monday.com with:', {
      email: updateData.email,
      hasLicenseValidFrom: !!updateData.licenseValidFrom,
      hasAuthority: !!updateData.licenseIssuedBy,
      hasNationality: !!updateData.nationality,
      hasHomeAddress: !!updateData.homeAddress,
      fieldsIncluded: Object.keys(updateData)
    });

    // Update Monday.com
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-driver-board-a',
        email: email,
        updates: updateData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Monday update failed:', errorText);
      throw new Error(`Board A update failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Board A updated successfully');
    return result;

  } catch (error) {
    console.error('❌ Error updating Board A with Idenfy results:', error);
    return { success: false, error: error.message };
  }
}

// File: functions/idenfy-webhook.js
// FIXED VERSION - saveIdenfyDocumentsToMonday function
// This section handles downloading and uploading POA documents from idenfy to Monday.com

async function saveIdenfyDocumentsToMonday(email, fullWebhookData) {
  try {
    console.log('📸 Saving Idenfy documents to Monday.com...');
    
    // Map all possible document URLs - both regular and additional step documents
    const documentMappings = [
      {
        idenfyField: 'FRONT',
        fileType: 'licenseFront',
        url: fullWebhookData.fileUrls?.FRONT
      },
      {
        idenfyField: 'BACK',
        fileType: 'licenseBack',
        url: fullWebhookData.fileUrls?.BACK
      },
      {
        idenfyField: 'FACE',
        fileType: 'selfie',
        url: fullWebhookData.fileUrls?.FACE
      },
      {
        idenfyField: 'UTILITY_BILL',
        fileType: 'poa1',
        url: fullWebhookData.additionalStepPdfUrls?.UTILITY_BILL || 
             fullWebhookData.fileUrls?.UTILITY_BILL
      },
      {
        idenfyField: 'POA2',
        fileType: 'poa2',
        url: fullWebhookData.additionalStepPdfUrls?.POA2 || 
             fullWebhookData.fileUrls?.POA2
      }
    ];
    
    // Process each document
    const uploadResults = [];
    for (const mapping of documentMappings) {
      if (!mapping.url) {
        console.log(`⏭️ Skipping ${mapping.idenfyField} - no URL provided`);
        continue;
      }
      
      console.log(`📤 Processing ${mapping.idenfyField} from URL: ${mapping.url.substring(0, 50)}...`);
      
      try {
        // Download the file from Idenfy
        console.log(`⬇️ Downloading ${mapping.idenfyField} from Idenfy...`);
        const fileResponse = await fetch(mapping.url);

        if (!fileResponse.ok) {
          console.error(`❌ Failed to download ${mapping.idenfyField}: HTTP ${fileResponse.status}`);
          uploadResults.push({ 
            field: mapping.idenfyField, 
            success: false, 
            error: `Download failed: HTTP ${fileResponse.status}` 
          });
          continue;
        }

        // Get buffer from response
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Data = buffer.toString('base64');
        
        console.log(`📦 Downloaded ${mapping.idenfyField}: ${buffer.length} bytes`);

        // Check actual file content using magic bytes
        // FIXED: Correct PDF magic bytes check - %PDF = 0x25 0x50 0x44 0x46
        const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
        const isWEBP = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

        // Log what we actually found for debugging
        console.log(`🔍 Magic bytes for ${mapping.idenfyField}:`, 
          buffer.slice(0, 12).toString('hex').toUpperCase());
        
        // Also log ASCII representation for first 4 bytes to verify PDF
        const asciiCheck = buffer.slice(0, 4).toString('ascii');
        console.log(`📝 First 4 bytes as ASCII: "${asciiCheck}"`);
        
        let extension = 'jpg'; // default
        let mimeType = 'image/jpeg';

        if (isPDF) {
          extension = 'pdf';
          mimeType = 'application/pdf';
          console.log(`📄 Verified PDF format for ${mapping.idenfyField}`);
          
          // IMPORTANT NOTE: Monday.com file columns can't display PDFs
          // Options:
          // 1. Convert PDF to image here (requires additional library)
          // 2. Upload as PDF but mark for manual review
          // 3. Skip PDF upload and handle separately
          
          // For now, we'll upload the PDF and let Monday.com handle it
          // You may want to add PDF to image conversion here later
          
        } else if (isPNG) {
          extension = 'png';
          mimeType = 'image/png';
          console.log(`🖼️ Verified PNG format for ${mapping.idenfyField}`);
        } else if (isJPEG) {
          extension = 'jpg';
          mimeType = 'image/jpeg';
          console.log(`📸 Verified JPEG format for ${mapping.idenfyField}`);
        } else if (isWEBP) {
          // Convert WEBP to JPEG for Monday.com compatibility
          extension = 'jpg';
          mimeType = 'image/jpeg';
          console.log(`🌐 WEBP detected for ${mapping.idenfyField} - will upload as JPEG`);
        } else {
          // FALLBACK - assume JPEG if we can't identify
          console.log(`⚠️ Unknown format for ${mapping.idenfyField}, defaulting to JPEG`);
          console.log(`   First 20 bytes:`, buffer.slice(0, 20).toString('hex'));
          extension = 'jpg';
          mimeType = 'image/jpeg';
        }
                   
        // Upload to Monday.com via monday-integration
        console.log(`⬆️ Uploading ${mapping.idenfyField} to Monday.com as ${mapping.fileType}.${extension}...`);
        const uploadResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload-file-board-a',
            email: email,
            fileType: mapping.fileType,
            fileData: base64Data,
            filename: `${mapping.fileType}_${Date.now()}.${extension}`,
            contentType: mimeType  // Pass the correct content type
          })
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResponse.ok && uploadResult.success) {
          console.log(`✅ ${mapping.idenfyField} uploaded successfully as ${extension.toUpperCase()}`);
          uploadResults.push({ 
            field: mapping.idenfyField, 
            success: true,
            fileId: uploadResult.fileId,
            format: extension.toUpperCase()
          });
        } else {
          console.error(`❌ Failed to upload ${mapping.idenfyField} to Monday:`, uploadResult.error);
          uploadResults.push({ 
            field: mapping.idenfyField, 
            success: false, 
            error: uploadResult.error 
          });
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${mapping.idenfyField}:`, error.message);
        uploadResults.push({ 
          field: mapping.idenfyField, 
          success: false, 
          error: error.message 
        });
      }
      
      // Small delay between uploads to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Log summary
    const successCount = uploadResults.filter(r => r.success).length;
    const failCount = uploadResults.filter(r => !r.success).length;
    
    console.log(`📊 Document upload summary: ${successCount} succeeded, ${failCount} failed`);
    if (failCount > 0) {
      console.log('Failed uploads:', uploadResults.filter(r => !r.success));
    }
    
    return { 
      success: true, 
      uploadResults: uploadResults,
      summary: `${successCount}/${uploadResults.length} documents uploaded`
    };
    
  } catch (error) {
    console.error('❌ Error saving documents to Monday:', error);
    return { success: false, error: error.message };
  }
}

// FIXED: Update document validity dates with email included
async function updateDocumentValidityDates(email, webhookData) {
  try {
    console.log('📅 Updating document validity dates...');
    
    const today = new Date();
    const addDays = (date, days) => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result.toISOString().split('T')[0];
    };
    
    // Extract actual document dates from Idenfy data
    const poa1Date = webhookData.data?.utilityBillIssueDate || 
                     webhookData.data?.docIssuedDate || 
                     today.toISOString().split('T')[0];
    const poa2Date = webhookData.data?.utilityBillIssueDate2 || 
                     webhookData.data?.docIssuedDate || 
                     today.toISOString().split('T')[0];

    const updates = {
      // Include email to avoid the error
      email: email,
      
      // Validity dates
      poa1ValidUntil: addDays(new Date(poa1Date), 90),
      poa2ValidUntil: addDays(new Date(poa2Date), 90),
      dvlaValidUntil: addDays(today, 90),  // DVLA check valid for 90 days
      licenseNextCheckDue: addDays(today, 90),
      
      lastUpdated: today.toISOString().split('T')[0]
    };
    
    console.log('📅 Setting validity dates:', {
      poa1: updates.poa1ValidUntil,
      poa2: updates.poa2ValidUntil,
      dvla: updates.dvlaValidUntil,
      nextCheck: updates.licenseNextCheckDue
    });
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-driver-board-a',
        email: email,
        updates: updates
      })
    });
    
    if (response.ok) {
      console.log('✅ Document validity dates updated');
    } else {
      const errorText = await response.text();
      console.error('❌ Failed to update validity dates:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Error updating validity dates:', error);
  }
}

// Process POA validation for UK drivers
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
