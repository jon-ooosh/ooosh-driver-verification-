// File: functions/monday-integration.js
// COMPLETE VERSION with fixed file upload and better error logging

const fetch = require('node-fetch');

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
    console.error('Monday.com integration error:', error);
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

  console.log('Calling Monday.com API...');
  
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
    console.error('Monday.com API error:', response.status, result);
    throw new Error(`Monday.com API error: ${response.status}`);
  }

  if (result.errors) {
    console.error('Monday.com GraphQL errors:', result.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

// Escape JSON for GraphQL mutations
function escapeJson(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ========================================
// INTERNAL HELPER FUNCTIONS (return data directly)
// ========================================

// INTERNAL: Find driver by email (returns driver object or null)
async function findDriverInternal(email) {
  console.log('🔍 Internal: Finding driver for email:', email);
  
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
      console.log('✅ Internal: Driver found:', driver.id);
      return driver;
    } else {
      console.log('❌ Internal: Driver not found');
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
  console.log('🔄 Creating/updating driver in Board A');
  
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

    // Prepare column values for Board A
    const columnValues = formatBoardAColumnValues(completeDriverData);

    // DEBUGGING: Log what we're sending to Monday.com
    console.log('📧 Creating driver with email:', email);
    console.log('📋 Column values:', JSON.stringify(columnValues, null, 2));

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
    console.error('Create driver Board A error:', error);
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
  console.log('🔄 Updating driver in Board A');
  
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

    // Format updates for Board A columns
    const columnValues = formatBoardAColumnValues(completeUpdates);

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
    console.error('Update driver Board A error:', error);
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
  console.log('🔍 Finding driver in Board A');
  
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
    console.error('Find driver Board A error:', error);
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

// FIXED: Upload file to Board A with better error logging
async function uploadFileBoardA(data) {
  console.log('📁 Uploading file to Board A');
  
  try {
    const { email, fileType, fileData, filename } = data;
    
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

    console.log(`📊 Using column ID: ${columnId} for ${fileType}`);

    // Create FormData for file upload
    const FormData = require('form-data');
    const formData = new FormData();

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');
    console.log(`📦 File buffer size: ${buffer.length} bytes`);
    
    const mutation = `
      mutation($file: File!) {
        add_file_to_column(
          item_id: ${driverId}, 
          column_id: "${columnId}",
          file: $file
        ) {
          id
        }
      }
    `;

    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    formData.append('map', JSON.stringify({ "0": ["variables.file"] }));
    formData.append('0', buffer, { 
      filename: filename || `${fileType}_${Date.now()}.jpg`, 
      contentType: 'image/jpeg' 
    });

    const token = process.env.MONDAY_API_TOKEN;
    console.log('📤 Sending file to Monday.com API...');
    
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const result = await response.json();
    console.log('📥 Monday API response:', JSON.stringify(result));
    
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
    }
    
    if (result.data?.add_file_to_column?.id) {
      console.log('✅ File uploaded to Board A');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fileId: result.data.add_file_to_column.id,
          message: 'File uploaded to Board A'
        })
      };
    } else {
      console.error('❌ No file ID returned from Monday.com');
      throw new Error('Failed to upload file to Board A - no ID returned');
    }

  } catch (error) {
    console.error('Upload file Board A error:', error);
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
// BOARD B (DRIVER ASSIGNMENTS) FUNCTIONS
// ========================================

// Find driver in Board B
async function findDriverBoardB(data) {
  console.log('🔍 Finding driver in Board B');
  
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
    console.error('Find driver Board B error:', error);
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

    console.log('📋 Found driver in Board A, copying to Board B');

    // Map Board A data to Board B columns (14 essential fields)
    const boardBData = {
      driverName: driverA.driverName,
      email: driverA.email,
      phoneNumber: driverA.phoneNumber,
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
      signatureDate: new Date().toISOString().split('T')[0]
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
          message: 'Driver copied from Board A to Board B'
        })
      };
    } else {
      throw new Error('Failed to copy driver to Board B');
    }

  } catch (error) {
    console.error('Copy A to B error:', error);
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
  const columnValues = {};

  // CRITICAL: Always include email field
  if (data.email) {
    columnValues.email_mktrgzj = { 
      email: data.email, 
      text: data.email 
    };
    console.log('✅ Email field added to column values:', data.email);
  } else {
    console.error('❌ CRITICAL: Email missing from driver data!');
  }

  // Identity & Contact
  if (data.driverName) columnValues.text_mktry2je = data.driverName;
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

  // Document Expiry Dates
  if (data.poa1ValidUntil) columnValues.date_mktr1keg = { date: data.poa1ValidUntil };
  if (data.poa2ValidUntil) columnValues.date_mktra1a6 = { date: data.poa2ValidUntil };
  if (data.dvlaValidUntil) columnValues.date_mktrmjfr = { date: data.dvlaValidUntil };
  if (data.licenseNextCheckDue) columnValues.date_mktsbgpy = { date: data.licenseNextCheckDue };

  // Insurance Questions (Yes/No status columns)
  if (data.hasDisability !== undefined) columnValues.status = { label: data.hasDisability ? 'Yes' : 'No' };
  if (data.hasConvictions !== undefined) columnValues.color_mktr4w0 = { label: data.hasConvictions ? 'Yes' : 'No' };
  if (data.hasProsecution !== undefined) columnValues.color_mktrbt3x = { label: data.hasProsecution ? 'Yes' : 'No' };
  if (data.hasAccidents !== undefined) columnValues.color_mktraeas = { label: data.hasAccidents ? 'Yes' : 'No' };
  if (data.hasInsuranceIssues !== undefined) columnValues.color_mktrpe6q = { label: data.hasInsuranceIssues ? 'Yes' : 'No' };
  if (data.hasDrivingBan !== undefined) columnValues.color_mktr2t8a = { label: data.hasDrivingBan ? 'Yes' : 'No' };

  // Additional details and status
  if (data.additionalDetails) columnValues.long_text_mktr1a66 = data.additionalDetails;
  if (data.overallStatus) columnValues.color_mktrwatg = { label: data.overallStatus };
  if (data.lastUpdated) columnValues.date_mktrk8kv = { date: data.lastUpdated };

  // DEBUGGING: Log final column values
  console.log('📋 Final column values for Monday.com:', Object.keys(columnValues));

  return columnValues;
}

// Format driver data for Board B columns
function formatBoardBColumnValues(driverData) {
  const columnValues = {};
  
  // Essential fields for Board B (14 fields)
  if (driverData.driverName) columnValues.text8 = driverData.driverName;
  if (driverData.email) columnValues.email = { email: driverData.email, text: driverData.email };
  if (driverData.phoneNumber) columnValues.text9__1 = driverData.phoneNumber;
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
    email: '',
    phoneNumber: '',
    phoneCountry: '',
    dateOfBirth: '',
    nationality: '',
    licenseNumber: '',
    licenseIssuedBy: '',
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
    licenseNextCheckDue: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'text_mktry2je': // Driver Name
        driver.driverName = col.text || '';
        break;
      case 'email_mktrgzj': // Email Address
        driver.email = value?.email || col.text || '';
        break;
      case 'text_mktrfqe2': // Phone Number
        driver.phoneNumber = col.text || '';
        break;
      case 'text_mkty5hzk': // Phone Country
        driver.phoneCountry = col.text || '';
        break;
      case 'date_mktr2x01': // Date of Birth
        driver.dateOfBirth = value?.date || '';
        break;
      case 'text_mktrdh72': // Nationality
        driver.nationality = col.text || '';
        break;
      case 'text_mktrrv38': // License Number
        driver.licenseNumber = col.text || '';
        break;
      case 'text_mktrz69': // License Issued By
        driver.licenseIssuedBy = col.text || '';
        break;
      case 'date_mktrwk94': // License Valid To
        driver.licenseValidTo = value?.date || '';
        break;
      case 'text_mktr8kvs': // License Ending
        driver.licenseEnding = col.text || '';
        break;
      case 'long_text_mktr2jhb': // Home Address
        driver.homeAddress = col.text || '';
        break;
      case 'long_text_mktrs5a0': // License Address
        driver.licenseAddress = col.text || '';
        break;
      case 'date_mktr1keg': // POA1 Valid Until
        driver.poa1ValidUntil = value?.date || '';
        break;
      case 'date_mktra1a6': // POA2 Valid Until
        driver.poa2ValidUntil = value?.date || '';
        break;
      case 'date_mktrmjfr': // DVLA Valid Until
        driver.dvlaValidUntil = value?.date || '';
        break;
      case 'date_mktsbgpy': // License Next Check Due
        driver.licenseNextCheckDue = value?.date || '';
        break;
      // Parse insurance questions with detailed logging
      case 'status': // Has Disability
        console.log('Disability column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasDisability = value?.label === 'Yes' || col.text === 'Yes';
        break;
      case 'color_mktr4w0': // Has Convictions
        console.log('Convictions column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasConvictions = value?.label === 'Yes' || col.text === 'Yes';
        break;
      case 'color_mktrbt3x': // Has Prosecution
        console.log('Prosecution column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasProsecution = value?.label === 'Yes' || 
                                col.text === 'Yes' || 
                                value?.index === 1;
        break;
      case 'color_mktraeas': // Has Accidents  
        console.log('Accidents column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasAccidents = value?.label === 'Yes' || 
                             col.text === 'Yes' || 
                             value?.index === 1;
        break;
      case 'color_mktrpe6q': // Has Insurance Issues
        console.log('Insurance Issues column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasInsuranceIssues = value?.label === 'Yes' || 
                                    col.text === 'Yes' || 
                                    value?.index === 1;
        break;
      case 'color_mktr2t8a': // Has Driving Ban
        console.log('Driving Ban column - value:', JSON.stringify(value), 'text:', col.text);
        driver.hasDrivingBan = value?.label === 'Yes' || 
                              col.text === 'Yes' || 
                              value?.index === 1;
        break;
      case 'long_text_mktr1a66': // Additional Details
        driver.additionalDetails = col.text || '';
        break;
      case 'date_mktrk8kv': // Last Updated
        driver.lastUpdated = value?.date || '';
        break;
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
    signatureDate: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'email':
        assignment.email = value?.email || col.text || '';
        break;
      case 'text86': // Job Number
        assignment.jobNumber = col.text || '';
        break;
      case 'date4': // Signature Date
        assignment.signatureDate = value?.date || '';
        break;
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
    console.error('Connection test error:', error);
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
    console.error('Two-board system test error:', error);
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
  console.log('📄 Saving Idenfy documents to Monday.com');
  
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
