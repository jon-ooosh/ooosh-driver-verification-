// File: functions/monday-integration.js
// PRODUCTION VERSION with Status Fields and DEBUG_MODE logging controls

// 🔧 DEBUG MODE - Set DEBUG_LOGGING=true in Netlify to enable verbose logs
const DEBUG_MODE = process.env.DEBUG_LOGGING === 'true';

// Board IDs
const BOARD_A_ID = '9798399405'; // Driver Database
const BOARD_B_ID = '841453886';  // Driver Assignments

// Monday.com API endpoint
const MONDAY_API_URL = 'https://api.monday.com/v2';

exports.handler = async (event, context) => {
  console.log('Monday.com integration called with method:', event.httpMethod);
  
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
    let requestData;
    
    if (event.httpMethod === 'GET') {
      // Handle GET requests with query parameters
      const action = event.queryStringParameters?.action;
      requestData = { action, ...event.queryStringParameters };
    } else if (event.httpMethod === 'POST') {
      if (!event.body) {
        throw new Error('Request body is required for POST requests');
      }
      requestData = JSON.parse(event.body);
    } else {
      throw new Error('Method not allowed');
    }

    const { action } = requestData;

    switch (action) {
      // Board A (Driver Database) Functions
      case 'create-driver-board-a':
        return await createDriverBoardA(requestData);
      case 'update-driver-board-a':
        return await updateDriverBoardA(requestData);
      case 'find-driver-board-a':
        return await findDriverBoardA(requestData);
      case 'upload-file-board-a':
        return await uploadFileBoardA(requestData);
      case 'save-idenfy-documents':
        return await saveIdenfyDocuments(requestData);
      
      // Board B (Driver Assignments) Functions
      case 'find-driver-board-b':
        return await findDriverBoardB(requestData);
      case 'copy-a-to-b':
        return await copyAToB(requestData);
      
      // Utility Functions
      case 'test-connection':
        return await testConnection();
      case 'test-two-board-system':
        return await testTwoBoardSystem(requestData);
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    console.error('❌ Monday.com integration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Monday.com integration failed',
        details: error.message 
      })
    };
  }
};

// ========================================
// CORE API HELPER FUNCTIONS
// ========================================

// Call Monday.com API with authentication
async function callMondayAPI(query) {
  const token = process.env.MONDAY_API_TOKEN;
  
  if (!token) {
    throw new Error('MONDAY_API_TOKEN environment variable not set');
  }

  if (DEBUG_MODE) console.log('🔄 Calling Monday.com API...');
  
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query })
  });

  const result = await response.json();
  
  if (!response.ok) {
    console.error('❌ Monday.com API error:', response.status, result);
    throw new Error(`Monday.com API error: ${response.status}`);
  }

  if (result.errors) {
    console.error('❌ Monday.com GraphQL errors:', result.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

// Escape JSON for GraphQL mutations
function escapeJson(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ========================================
// STATUS CALCULATION HELPER
// ========================================

// Calculate all 5 status fields based on driver data
function calculateStatusFields(driverData) {
  const today = new Date();
  const statuses = {};

  // LICENSE STATUS
  const licenseExpiry = driverData.licenseValidTo ? new Date(driverData.licenseValidTo) : null;
  const licenseCheckDue = driverData.licenseNextCheckDue ? new Date(driverData.licenseNextCheckDue) : null;
  
  if (licenseExpiry && licenseExpiry <= today) {
    statuses.licenseStatus = 'Expired';
  } else if (licenseCheckDue && licenseCheckDue <= today) {
    statuses.licenseStatus = 'Check Due';
  } else if (licenseExpiry && licenseExpiry > today) {
    statuses.licenseStatus = 'Valid';
  } else {
    statuses.licenseStatus = 'Missing';
  }

  // POA STATUS
  const poa1Valid = driverData.poa1ValidUntil ? new Date(driverData.poa1ValidUntil) > today : false;
  const poa2Valid = driverData.poa2ValidUntil ? new Date(driverData.poa2ValidUntil) > today : false;
  const poa1Exists = !!driverData.poa1ValidUntil;
  const poa2Exists = !!driverData.poa2ValidUntil;

  if (poa1Valid && poa2Valid) {
    statuses.poaStatus = 'Valid';
  } else if (!poa1Exists || !poa2Exists) {
    statuses.poaStatus = 'Missing';
  } else {
    statuses.poaStatus = 'Expired';
  }

  // DVLA STATUS (UK drivers only)
  const isUkDriver = driverData.licenseIssuedBy === 'DVLA';
  if (isUkDriver) {
    const dvlaValid = driverData.dvlaValidUntil ? new Date(driverData.dvlaValidUntil) > today : false;
    statuses.dvlaStatus = dvlaValid ? 'Valid' : 'Expired';
  } else {
    statuses.dvlaStatus = 'Not Required';
  }

  // PASSPORT STATUS (Non-UK drivers only)
  if (!isUkDriver) {
    const passportValid = driverData.passportValidUntil ? new Date(driverData.passportValidUntil) > today : false;
    statuses.passportStatus = passportValid ? 'Valid' : 'Expired';
  } else {
    statuses.passportStatus = 'Not Required';
  }

  // INSURANCE STATUS
  const points = driverData.dvlaPoints || 0;
  const overallStatus = driverData.overallStatus || '';
  
  if (points >= 10) {
    statuses.insuranceStatus = 'Failed';
  } else if (points >= 7 || overallStatus === 'Insurance Review' || overallStatus === 'Manual Review Required') {
    statuses.insuranceStatus = 'Referral';
  } else {
    statuses.insuranceStatus = 'Approved';
  }

  if (DEBUG_MODE) {
    console.log('📊 Calculated statuses:', statuses);
  }

  return statuses;
}

// Calculate Board B overall status from Board A data
function calculateBoardBStatus(driverData) {
  const statuses = calculateStatusFields(driverData);
  
  // Check for hard fails
  if (statuses.insuranceStatus === 'Failed' || 
      statuses.poaStatus === 'Missing' ||
      driverData.overallStatus === 'Stuck') {
    return 'Not Approved';
  }
  
  // Check for any yellow flags
  if (statuses.licenseStatus === 'Expired' ||
      statuses.licenseStatus === 'Check Due' ||
      statuses.poaStatus === 'Expired' ||
      statuses.dvlaStatus === 'Expired' ||
      statuses.passportStatus === 'Expired' ||
      statuses.insuranceStatus === 'Referral') {
    return 'Action Required';
  }
  
  // All green
  return 'Approved';
}

// ========================================
// INTERNAL HELPER FUNCTIONS (return data directly)
// ========================================

// INTERNAL: Find driver by email (returns driver object or null)
async function findDriverInternal(email) {
  if (DEBUG_MODE) console.log('🔍 Internal: Finding driver for email:', email);
  
  try {
    if (!email) {
      throw new Error('Email is required');
    }

    const query = `
      query {
        items_page_by_column_values (
          board_id: ${BOARD_A_ID},
          columns: [
            {
              column_id: "email_mktrgzj",
              column_values: ["${email}"]
            }
          ],
          limit: 1
        ) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    `;

    const response = await callMondayAPI(query);
    
    if (response.data?.items_page_by_column_values?.items?.length > 0) {
      const item = response.data.items_page_by_column_values.items[0];
      const driver = parseBoardAData(item);
      if (DEBUG_MODE) console.log('✅ Internal: Driver found:', driver.id);
      return driver;
    } else {
      if (DEBUG_MODE) console.log('❌ Internal: Driver not found');
      return null;
    }

  } catch (error) {
    console.error('❌ Internal find driver error:', error);
    return null;
  }
}

// ========================================
// BOARD A (DRIVER DATABASE) FUNCTIONS
// ========================================

// Create or update driver in Board A
async function createDriverBoardA(data) {
  if (DEBUG_MODE) console.log('🔄 Creating/updating driver in Board A');
  
  try {
    const { email, driverData } = data;
    
    if (!email) {
      throw new Error('Email is required');
    }

    // Check if driver already exists using internal helper
    const existingDriver = await findDriverInternal(email);
    
    if (existingDriver) {
      console.log('✅ Driver exists, updating record');
      return await updateDriverBoardA({ email, updates: driverData });
    }

    console.log('👤 Creating new driver in Board A');

    // CRITICAL FIX: Always include email in driverData for new driver creation
    const completeDriverData = {
      ...driverData,
      email: email  // Ensure email is always included
    };

    // Calculate status fields before saving
    const statusFields = calculateStatusFields(completeDriverData);
    const driverDataWithStatuses = { ...completeDriverData, ...statusFields };

    // Prepare column values for Board A
    const columnValues = formatBoardAColumnValues(driverDataWithStatuses);

    if (DEBUG_MODE) {
      console.log('📧 Creating driver with email:', email);
      console.log('📋 Column values:', JSON.stringify(columnValues, null, 2));
    }

    const mutation = `
      mutation {
        create_item (
          board_id: ${BOARD_A_ID},
          item_name: "Driver Verification - ${email}",
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayAPI(mutation);
    
    if (response.data?.create_item?.id) {
      console.log('✅ Driver created in Board A:', response.data.create_item.id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          boardAId: response.data.create_item.id,
          message: 'Driver created in Board A'
        })
      };
    } else {
      console.error('❌ Failed to create driver. Response:', response);
      throw new Error('Failed to create driver in Board A - no ID returned');
    }

  } catch (error) {
    console.error('❌ Create driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Update existing driver in Board A
async function updateDriverBoardA(data) {
  if (DEBUG_MODE) console.log('🔄 Updating driver in Board A');
  
  try {
    const { email, updates } = data;
    
    if (!email || !updates) {
      throw new Error('Email and updates are required');
    }

    // Find the driver using internal helper (returns driver object directly)
    const existingDriver = await findDriverInternal(email);
    
    if (!existingDriver) {
      throw new Error('Driver not found in Board A');
    }

    const driverId = existingDriver.id;
    console.log('📝 Updating driver ID:', driverId);

    // CRITICAL: Ensure email is always included in updates
    const completeUpdates = {
      ...updates,
      email: email
    };

    // Calculate status fields based on updated data
    const mergedData = { ...existingDriver, ...completeUpdates };
    const statusFields = calculateStatusFields(mergedData);
    const updatesWithStatuses = { ...completeUpdates, ...statusFields };

    // Format updates for Board A columns
    const columnValues = formatBoardAColumnValues(updatesWithStatuses);

    if (DEBUG_MODE) {
      console.log('🔍 RAW columnValues being sent to Monday.com GraphQL:');
      console.log(JSON.stringify(columnValues, null, 2));
    }

    const mutation = `
      mutation {
        change_multiple_column_values (
          item_id: ${driverId},
          board_id: ${BOARD_A_ID},
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayAPI(mutation);
    
    if (response.data?.change_multiple_column_values?.id) {
      console.log('✅ Driver updated in Board A');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          boardAId: driverId,
          message: 'Driver updated in Board A'
        })
      };
    } else {
      throw new Error('Failed to update driver in Board A');
    }

  } catch (error) {
    console.error('❌ Update driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Find driver in Board A (returns HTTP response)
async function findDriverBoardA(data) {
  if (DEBUG_MODE) console.log('🔍 Finding driver in Board A');
  
  try {
    const { email } = data;
    
    // Use internal helper to get driver data
    const driver = await findDriverInternal(email);
    
    if (driver) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          driver: driver,
          boardAId: driver.id
        })
      };
    } else {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'Driver not found in Board A'
        })
      };
    }

  } catch (error) {
    console.error('❌ Find driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Upload file to Board A
async function uploadFileBoardA(data) {
  console.log('📁 Uploading file to Board A');
  
  try {
    const { email, fileType, fileData, filename, contentType } = data;
    
    if (!email || !fileType || !fileData) {
      throw new Error('Email, fileType, and fileData are required');
    }
    
    // Find the driver using internal helper
    const existingDriver = await findDriverInternal(email);
    
    if (!existingDriver) {
      throw new Error('Driver not found in Board A');
    }

    const driverId = existingDriver.id;
    console.log(`📝 Uploading ${fileType} for driver ID: ${driverId}`);

    // Map file types to Board A column IDs
    const fileColumnMap = {
      'license_front': 'file_mktrypb7',
      'license_back': 'file_mktr76g6',
      'passport': 'file_mktr56t0',
      'poa1': 'file_mktrf9jv',
      'poa2': 'file_mktr3fdw',
      'dvla': 'file_mktrwhn8',
      'signature': 'file_mktrfanc'
    };

    const columnId = fileColumnMap[fileType];
    if (!columnId) {
      throw new Error(`Unknown file type: ${fileType}`);
    }

    // CLEAR EXISTING FILE FIRST (if any)
    if (DEBUG_MODE) console.log(`🧹 Clearing existing file in column ${columnId}...`);
    const clearMutation = `
      mutation {
        change_column_value(
          item_id: ${driverId},
          board_id: ${BOARD_A_ID},
          column_id: "${columnId}",
          value: "{\\"clear_all\\": true}"
        ) {
          id
        }
      }
    `;

    try {
      await callMondayAPI(clearMutation);
      if (DEBUG_MODE) console.log('✅ Column cleared successfully');
    } catch (clearError) {
      if (DEBUG_MODE) console.warn('⚠️ Could not clear column (might be empty already)');
    }
    
    // Create FormData for file upload - using formdata-node for native fetch compatibility
    const { FormData, File } = require('formdata-node');
    const formData = new FormData();

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // Detect file type from buffer or use provided contentType
    let detectedContentType = contentType || 'image/jpeg';
    let fileExtension = 'jpg';
    
    // Check for PDF magic bytes - %PDF = 0x25 0x50 0x44 0x46
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      detectedContentType = 'application/pdf';
      fileExtension = 'pdf';
      if (DEBUG_MODE) console.log('📄 PDF detected from magic bytes');
    } 
    // Check for PNG magic bytes
    else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      detectedContentType = 'image/png';
      fileExtension = 'png';
      if (DEBUG_MODE) console.log('🖼️ PNG detected from magic bytes');
    }
    // Check for JPEG magic bytes
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      detectedContentType = 'image/jpeg';
      fileExtension = 'jpg';
      if (DEBUG_MODE) console.log('🖼️ JPEG detected from magic bytes');
    }
    
    // Use filename if provided, otherwise generate one
    const finalFilename = filename || `${fileType}_${Date.now()}.${fileExtension}`;
    console.log(`📤 Uploading: ${finalFilename} (${detectedContentType})`);

    // GraphQL mutation for file upload
    const mutation = `
      mutation($file: File!) {
        add_file_to_column(
          item_id: ${driverId}, 
          column_id: "${columnId}",
          file: $file
        ) {
          id
          name
          url
        }
      }
    `;

    // CRITICAL: Proper FormData structure with map parameter
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    formData.append('map', JSON.stringify({ "0": ["variables.file"] })); // CRITICAL FOR FILE MAPPING!
    
    // Create File object (formdata-node provides this for native fetch compatibility)
    const fileBlob = new File([buffer], finalFilename, { 
      type: detectedContentType 
    });
    
    // Append the File object (not raw buffer)
    formData.append('0', fileBlob);

    // Send to Monday.com file upload endpoint
    const response = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
      },
      body: formData
    });

    const responseText = await response.text();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response:', responseText.substring(0, 200));
      throw new Error('Invalid response from Monday.com');
    }

    // Check for GraphQL errors
    if (result.errors && result.errors.length > 0) {
      console.error(`❌ GraphQL errors:`, JSON.stringify(result.errors, null, 2));
      throw new Error(`GraphQL error: ${result.errors[0].message || JSON.stringify(result.errors)}`);
    }

    // Check for successful upload
    if (result.data?.add_file_to_column?.id) {
      console.log(`✅ File uploaded: ${result.data.add_file_to_column.name}`);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fileId: result.data.add_file_to_column.id,
          fileName: result.data.add_file_to_column.name,
          fileUrl: result.data.add_file_to_column.url,
          fileType: fileExtension.toUpperCase(),
          message: `${fileExtension.toUpperCase()} file uploaded to Board A - ${fileType}`
        })
      };
    } else {
      console.error('❌ Unexpected response structure:', JSON.stringify(result).substring(0, 500));
      throw new Error('File upload failed - no file ID returned');
    }

  } catch (error) {
    console.error('❌ Upload file error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        error: error.message,
        details: 'File upload to Board A failed'
      })
    };
  }
}

// ========================================
// BOARD B (DRIVER ASSIGNMENTS) FUNCTIONS
// ========================================

// Find driver in Board B
async function findDriverBoardB(data) {
  if (DEBUG_MODE) console.log('🔍 Finding driver in Board B');
  
  try {
    const { email } = data;
    
    if (!email) {
      throw new Error('Email is required');
    }

    const query = `
      query {
        items_page_by_column_values (
          board_id: ${BOARD_B_ID},
          columns: [
            {
              column_id: "email",
              column_values: ["${email}"]
            }
          ],
          limit: 10
        ) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    `;

    const response = await callMondayAPI(query);
    
    if (response.data?.items_page_by_column_values?.items?.length > 0) {
      const assignments = response.data.items_page_by_column_values.items.map(item => parseBoardBData(item));
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          assignments: assignments,
          count: assignments.length
        })
      };
    } else {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'No driver assignments found in Board B'
        })
      };
    }

  } catch (error) {
    console.error('❌ Find driver Board B error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Copy driver from Board A to Board B
async function copyAToB(data) {
  console.log('🔄 Copying driver from Board A to Board B');
  
  try {
    const { email, jobId } = data;
    
    if (!email) {
      throw new Error('Email is required');
    }

    // Get driver data from Board A using internal helper
    const driverA = await findDriverInternal(email);
    
    if (!driverA) {
      throw new Error('Driver not found in Board A');
    }

    console.log('📋 Found driver in Board A, preparing Board B data');

    // Calculate Board B status from Board A data
    const boardBStatus = calculateBoardBStatus(driverA);
    console.log(`✅ Board B status calculated: ${boardBStatus}`);

    // Map Board A data to Board B columns (15 fields + overall status)
    const boardBData = {
      driverName: driverA.driverName,
      email: driverA.email,
      phoneNumber: driverA.phoneNumber,
      phoneCountry: driverA.phoneCountry, 
      dateOfBirth: driverA.dateOfBirth,
      nationality: driverA.nationality,
      licenseNumber: driverA.licenseNumber,
      licenseIssuedBy: driverA.licenseIssuedBy,
      licenseValidFrom: driverA.licenseValidFrom,
      licenseValidTo: driverA.licenseValidTo,
      datePassedTest: driverA.datePassedTest,
      homeAddress: driverA.homeAddress,
      licenseAddress: driverA.licenseAddress,
      jobNumber: jobId || '',
      signatureDate: new Date().toISOString().split('T')[0],
      overallStatus: boardBStatus  // NEW: Overall status for Board B
    };

    // Format for Board B columns
    const columnValues = formatBoardBColumnValues(boardBData);

    const mutation = `
      mutation {
        create_item (
          board_id: ${BOARD_B_ID},
          item_name: "${driverA.driverName || `Driver Assignment - ${email}`}",
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayAPI(mutation);
    
    if (response.data?.create_item?.id) {
      console.log('✅ Driver copied to Board B:', response.data.create_item.id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          boardBId: response.data.create_item.id,
          overallStatus: boardBStatus,
          message: 'Driver copied from Board A to Board B'
        })
      };
    } else {
      throw new Error('Failed to copy driver to Board B');
    }

  } catch (error) {
    console.error('❌ Copy A to B error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// ========================================
// COLUMN FORMATTING FUNCTIONS
// ========================================

// Format data for Board A columns - Ensure email is always included
function formatBoardAColumnValues(data) {
  if (DEBUG_MODE) {
    console.log('🔍 formatBoardAColumnValues called with data keys:', Object.keys(data));
  }
  
  const columnValues = {};

  // CRITICAL: Always include email field
  if (data.email) {
    columnValues.email_mktrgzj = { 
      email: data.email, 
      text: data.email 
    };
    if (DEBUG_MODE) console.log('✅ Email field added to column values:', data.email);
  } else {
    console.error('❌ CRITICAL: Email missing from driver data!');
  }

  // Identity & Contact
  if (data.driverName) columnValues.text_mktry2je = data.driverName;
  if (data.firstName) columnValues.text_mkwhc7a = data.firstName; 
  if (data.lastName) columnValues.text_mkwhm2n5 = data.lastName;
  if (data.phoneCountry) columnValues.text_mkty5hzk = data.phoneCountry;
  if (data.phoneNumber) columnValues.text_mktrfqe2 = data.phoneNumber;
  if (data.dateOfBirth) columnValues.date_mktr2x01 = { date: data.dateOfBirth };
  if (data.nationality) columnValues.text_mktrdh72 = data.nationality;

  // License Information
  if (data.licenseNumber) columnValues.text_mktrrv38 = data.licenseNumber;
  if (data.licenseIssuedBy) columnValues.text_mktrz69 = data.licenseIssuedBy;
  if (data.datePassedTest) columnValues.date_mktr93jq = { date: data.datePassedTest };
  if (data.licenseValidFrom) columnValues.date_mktrmdx5 = { date: data.licenseValidFrom };
  if (data.licenseValidTo) columnValues.date_mktrwk94 = { date: data.licenseValidTo };
  if (data.licenseEnding) columnValues.text_mktr8kvs = data.licenseEnding;

  // Addresses
  if (data.homeAddress) columnValues.long_text_mktr2jhb = data.homeAddress;
  if (data.licenseAddress) columnValues.long_text_mktrs5a0 = data.licenseAddress;

  // Document Expiry Dates - INCLUDING PASSPORT
  if (data.poa1ValidUntil) columnValues.date_mktr1keg = { date: data.poa1ValidUntil };
  if (data.poa2ValidUntil) columnValues.date_mktra1a6 = { date: data.poa2ValidUntil };
  if (data.dvlaValidUntil) columnValues.date_mktrmjfr = { date: data.dvlaValidUntil };
  if (data.passportValidUntil) columnValues.date_mkvxy5t1 = { date: data.passportValidUntil };
  if (data.licenseNextCheckDue) columnValues.date_mktsbgpy = { date: data.licenseNextCheckDue };
  if (data.signatureDate) columnValues.date_mkw4apb7 = { date: data.signatureDate };

  // Insurance Questions (Yes/No status columns)
  if (data.hasDisability !== undefined) columnValues.status = { label: data.hasDisability ? 'Yes' : 'No' };
  if (data.hasConvictions !== undefined) columnValues.color_mktr4w0 = { label: data.hasConvictions ? 'Yes' : 'No' };
  if (data.hasProsecution !== undefined) columnValues.color_mktrbt3x = { label: data.hasProsecution ? 'Yes' : 'No' };
  if (data.hasAccidents !== undefined) columnValues.color_mktraeas = { label: data.hasAccidents ? 'Yes' : 'No' };
  if (data.hasInsuranceIssues !== undefined) columnValues.color_mktrpe6q = { label: data.hasInsuranceIssues ? 'Yes' : 'No' };
  if (data.hasDrivingBan !== undefined) columnValues.color_mktr2t8a = { label: data.hasDrivingBan ? 'Yes' : 'No' };

  // DVLA Insurance Data
  if (data.dvlaPoints !== undefined) columnValues.text_mkwfhvve = String(data.dvlaPoints);
  if (data.dvlaEndorsements) columnValues.text_mkwf6e1n = data.dvlaEndorsements;
  if (data.dvlaCalculatedExcess !== undefined) columnValues.text_mkwf6595 = data.dvlaCalculatedExcess;

  // Additional details and status
  if (data.additionalDetails) columnValues.long_text_mktr1a66 = data.additionalDetails;
  if (data.overallStatus) columnValues.color_mktrwatg = { label: data.overallStatus };
  if (data.lastUpdated) columnValues.date_mktrk8kv = { date: data.lastUpdated };
  if (data.idenfyCheckDate) columnValues.text_mkvv2z8p = data.idenfyCheckDate;
  if (data.poa1URL) columnValues.text_mkw34ksx = data.poa1URL;
  if (data.poa2URL) columnValues.text_mkw3d9ye = data.poa2URL;
  if (data.idenfyScanRef) columnValues.text_mkwbn8bx = data.idenfyScanRef;

  // NEW: Status Fields (5 calculated statuses)
  if (data.licenseStatus) columnValues.color_mkxvmz0a = { label: data.licenseStatus };
  if (data.poaStatus) columnValues.color_mkxvkc9h = { label: data.poaStatus };
  if (data.dvlaStatus) columnValues.color_mkxvhf62 = { label: data.dvlaStatus };
  if (data.passportStatus) columnValues.color_mkxv9218 = { label: data.passportStatus };
  if (data.insuranceStatus) columnValues.color_mkxvxskq = { label: data.insuranceStatus };

  if (DEBUG_MODE) {
    console.log('📋 Final column values for Monday.com:', Object.keys(columnValues));
  }

  return columnValues;
}

// Format driver data for Board B columns
function formatBoardBColumnValues(driverData) {
  const columnValues = {};
  
  // Essential fields for Board B (15 fields + overall status)
  if (driverData.driverName) columnValues.text8 = driverData.driverName;
  if (driverData.email) columnValues.email = { email: driverData.email, text: driverData.email };
  if (driverData.phoneNumber) columnValues.text9__1 = driverData.phoneNumber;
  if (driverData.phoneCountry) columnValues.text_mktywe58 = driverData.phoneCountry; 
  if (driverData.dateOfBirth) columnValues.date45 = { date: driverData.dateOfBirth };
  if (driverData.nationality) columnValues.text_mktqjbpm = driverData.nationality;
  if (driverData.licenseNumber) columnValues.text6 = driverData.licenseNumber;
  if (driverData.licenseIssuedBy) columnValues.text_mktqwkqn = driverData.licenseIssuedBy;
  if (driverData.licenseValidFrom) columnValues.date_mktqphhq = { date: driverData.licenseValidFrom };
  if (driverData.licenseValidTo) columnValues.driver_licence_valid_to = { date: driverData.licenseValidTo };
  if (driverData.datePassedTest) columnValues.date2 = { date: driverData.datePassedTest };
  if (driverData.homeAddress) columnValues.long_text6 = driverData.homeAddress;
  if (driverData.licenseAddress) columnValues.long_text8 = driverData.licenseAddress;
  if (driverData.jobNumber) columnValues.text86 = driverData.jobNumber;
  if (driverData.signatureDate) columnValues.date4 = { date: driverData.signatureDate };
  
  // NEW: Overall Status for Board B
  if (driverData.overallStatus) columnValues.color_mkwtaftc = { label: driverData.overallStatus };
  
  return columnValues;
}

// ========================================
// DATA PARSING FUNCTIONS
// ========================================

// Parse Board A driver data from Monday.com response
function parseBoardAData(item) {
  const driver = {
    id: item.id,
    name: item.name,
    driverName: '',
    firstName: '', 
    lastName: '', 
    email: '',
    phoneNumber: '',
    phoneCountry: '',
    dateOfBirth: '',
    nationality: '',
    licenseNumber: '',
    licenseIssuedBy: '',
    datePassedTest: '',
    licenseValidTo: '',
    licenseEnding: '',
    homeAddress: '',
    licenseAddress: '',
    hasDisability: false,
    hasConvictions: false,
    hasProsecution: false,
    hasAccidents: false,
    hasInsuranceIssues: false,
    hasDrivingBan: false,
    additionalDetails: '',
    lastUpdated: '',
    poa1ValidUntil: '',
    poa2ValidUntil: '',
    dvlaValidUntil: '',
    passportValidUntil: '', 
    licenseNextCheckDue: '',
    idenfyCheckDate: '',
    idenfyScanRef: '',
    signatureDate: '',
    dvlaPoints: 0,              
    dvlaEndorsements: '', 
    dvlaCalculatedExcess: '',
    overallStatus: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'text_mktry2je': driver.driverName = col.text || ''; break;
      case 'text_mkwhc7a': driver.firstName = col.text || ''; break;
      case 'text_mkwhm2n5': driver.lastName = col.text || ''; break;
      case 'email_mktrgzj': driver.email = value?.email || col.text || ''; break;
      case 'text_mktrfqe2': driver.phoneNumber = col.text || ''; break;
      case 'text_mkty5hzk': driver.phoneCountry = col.text || ''; break;
      case 'date_mktr2x01': driver.dateOfBirth = value?.date || ''; break;
      case 'text_mktrdh72': driver.nationality = col.text || ''; break;
      case 'text_mktrrv38': driver.licenseNumber = col.text || ''; break;
      case 'date_mktrmdx5': driver.licenseValidFrom = value?.date || ''; break;
      case 'text_mktrz69': driver.licenseIssuedBy = col.text || ''; break;
      case 'date_mktr93jq': driver.datePassedTest = value?.date || ''; break;
      case 'date_mktrwk94': driver.licenseValidTo = value?.date || ''; break;
      case 'text_mktr8kvs': driver.licenseEnding = col.text || ''; break;
      case 'long_text_mktr2jhb': driver.homeAddress = col.text || ''; break;
      case 'long_text_mktrs5a0': driver.licenseAddress = col.text || ''; break;
      case 'date_mktr1keg': driver.poa1ValidUntil = value?.date || ''; break;
      case 'date_mktra1a6': driver.poa2ValidUntil = value?.date || ''; break;
      case 'date_mktrmjfr': driver.dvlaValidUntil = value?.date || ''; break;
      case 'date_mkvxy5t1': driver.passportValidUntil = value?.date || ''; break;
      case 'date_mktsbgpy': driver.licenseNextCheckDue = value?.date || ''; break;
      case 'date_mkw4apb7': driver.signatureDate = value?.date || ''; break;
      case 'text_mkw34ksx': driver.poa1URL = col.text || ''; break;
      case 'text_mkw3d9ye': driver.poa2URL = col.text || ''; break;
      case 'status': driver.hasDisability = value?.label === 'Yes' || col.text === 'Yes'; break;
      case 'color_mktr4w0': driver.hasConvictions = value?.label === 'Yes' || col.text === 'Yes'; break;
      case 'color_mktrbt3x': driver.hasProsecution = value?.label === 'Yes' || col.text === 'Yes' || value?.index === 1; break;
      case 'color_mktraeas': driver.hasAccidents = value?.label === 'Yes' || col.text === 'Yes' || value?.index === 1; break;
      case 'color_mktrpe6q': driver.hasInsuranceIssues = value?.label === 'Yes' || col.text === 'Yes' || value?.index === 1; break;
      case 'color_mktr2t8a': driver.hasDrivingBan = value?.label === 'Yes' || col.text === 'Yes' || value?.index === 1; break;
      case 'long_text_mktr1a66': driver.additionalDetails = col.text || ''; break;
      case 'date_mktrk8kv': driver.lastUpdated = value?.date || ''; break;
      case 'text_mkvv2z8p': driver.idenfyCheckDate = col.text || ''; break;
      case 'text_mkwbn8bx': driver.idenfyScanRef = col.text || ''; break;
      case 'text_mkwfhvve': driver.dvlaPoints = col.text ? parseInt(col.text) : 0; break;
      case 'text_mkwf6e1n': driver.dvlaEndorsements = col.text || ''; break;
      case 'text_mkwf6595': driver.dvlaCalculatedExcess = col.text || ''; break;
      case 'color_mktrwatg': driver.overallStatus = value?.label || col.text || ''; break;
    }
  });

  return driver;
}

// Parse Board B assignment data from Monday.com response
function parseBoardBData(item) {
  const assignment = {
    id: item.id,
    name: item.name,
    email: '',
    jobNumber: '',
    signatureDate: '',
    overallStatus: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'email': assignment.email = value?.email || col.text || ''; break;
      case 'text86': assignment.jobNumber = col.text || ''; break;
      case 'date4': assignment.signatureDate = value?.date || ''; break;
      case 'color_mkwtaftc': assignment.overallStatus = value?.label || col.text || ''; break;
    }
  });

  return assignment;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Test Monday.com connection
async function testConnection() {
  try {
    const query = `
      query {
        me {
          name
          email
        }
      }
    `;

    const response = await callMondayAPI(query);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        user: response.data.me,
        message: 'Monday.com connection successful'
      })
    };

  } catch (error) {
    console.error('❌ Connection test error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Test two-board system
async function testTwoBoardSystem(data) {
  try {
    const testEmail = data.email || 'test@example.com';
    
    console.log('🧪 Testing two-board system with email:', testEmail);
    
    // Test 1: Create driver in Board A
    const createResult = await createDriverBoardA({
      email: testEmail,
      driverData: {
        driverName: 'Test Driver',
        phoneNumber: '+44 123 456 7890',
        phoneCountry: '+44'
      }
    });
    
    if (createResult.statusCode !== 200) {
      throw new Error('Failed to create test driver');
    }
    
    // Test 2: Find driver in Board A
    const findResult = await findDriverBoardA({ email: testEmail });
    
    if (findResult.statusCode !== 200) {
      throw new Error('Failed to find test driver');
    }
    
    // Test 3: Copy A to B
    const copyResult = await copyAToB({ 
      email: testEmail, 
      jobId: 'TEST123' 
    });
    
    if (copyResult.statusCode !== 200) {
      throw new Error('Failed to copy driver A to B');
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Two-board system test completed successfully',
        tests: {
          createBoardA: 'PASS',
          findBoardA: 'PASS',
          copyAToB: 'PASS'
        }
      })
    };

  } catch (error) {
    console.error('❌ Two-board system test error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Save Idenfy documents (placeholder for now)
async function saveIdenfyDocuments(requestData) {
  if (DEBUG_MODE) console.log('📄 Saving Idenfy documents to Monday.com');
  
  try {
    // This is a placeholder - the actual implementation is in the webhook
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Documents saved (placeholder)'
      })
    };

  } catch (error) {
    console.error('❌ Save Idenfy documents error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to save Idenfy documents',
        details: error.message 
      })
    };
  }
}
