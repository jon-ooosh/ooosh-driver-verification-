// File: functions/monday-integration.js
// OOOSH Driver Verification - Complete Monday.com Integration
// UPDATED: Consistent expiry date strategy + new license check column

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

    // First check if driver already exists
    const existingDriver = await findDriverBoardA({ email });
    
    if (existingDriver.success && existingDriver.driver) {
      console.log('✅ Driver exists, updating record');
      return await updateDriverBoardA({ email, updates: driverData });
    }

    console.log('👤 Creating new driver in Board A');

    // Prepare column values for Board A with UPDATED DATE STRATEGY
    const columnValues = formatBoardAColumnValues(driverData);

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
      throw new Error('Failed to create driver in Board A');
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

    // Find the driver first
    const existingDriver = await findDriverBoardA({ email });
    
    if (!existingDriver.success || !existingDriver.driver) {
      throw new Error('Driver not found in Board A');
    }

    const driverId = existingDriver.driver.id;
    console.log('📝 Updating driver ID:', driverId);

    // Format updates for Board A columns
    const columnValues = formatBoardAColumnValues(updates);

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

// Find driver in Board A
async function findDriverBoardA(data) {
  console.log('🔍 Finding driver in Board A');
  
  try {
    const { email } = data;
    
    if (!email) {
      throw new Error('Email is required');
    }

    console.log('🔍 Searching for email:', email);

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
      console.log('✅ Driver found in Board A:', item.id);
      
      // Parse the driver data
      const driver = parseBoardAData(item);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          driver: driver,
          boardAId: item.id
        })
      };
    } else {
      console.log('❌ Driver not found in Board A');
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

// Upload file to Board A
async function uploadFileBoardA(data) {
  console.log('📁 Uploading file to Board A');
  
  try {
    const { email, fileType, fileData, filename } = data;
    
    if (!email || !fileType || !fileData) {
      throw new Error('Email, fileType, and fileData are required');
    }

    // Find the driver first
    const existingDriver = await findDriverBoardA({ email });
    
    if (!existingDriver.success || !existingDriver.driver) {
      throw new Error('Driver not found in Board A');
    }

    const driverId = existingDriver.driver.id;

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

    // Upload file using Monday.com file API
    const uploadResult = await uploadFileToMonday(driverId, columnId, fileData, filename);
    
    if (uploadResult.success) {
      console.log('✅ File uploaded to Board A');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fileId: uploadResult.fileId,
          message: `${fileType} uploaded to Board A`
        })
      };
    } else {
      throw new Error(uploadResult.error);
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
      console.log('✅ Driver found in Board B:', item.id);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          driver: item,
          boardBId: item.id
        })
      };
    } else {
      console.log('❌ Driver not found in Board B');
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'Driver not found in Board B'
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

    // Get driver data from Board A
    const boardAResult = await findDriverBoardA({ email });
    
    if (!boardAResult.success || !boardAResult.driver) {
      throw new Error('Driver not found in Board A');
    }

    const driverA = boardAResult.driver;
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

// Format data for Board A columns with UPDATED DATE STRATEGY
function formatBoardAColumnValues(data) {
  const columnValues = {};

  // Identity & Contact
  if (data.driverName) columnValues.text_mktry2je = data.driverName;
  if (data.email) columnValues.email_mktrgzj = { email: data.email, text: data.email };
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

  // UPDATED: Document Expiry Dates (consistent approach)
  if (data.poa1ValidUntil) columnValues.date_mktr1keg = { date: data.poa1ValidUntil };
  if (data.poa2ValidUntil) columnValues.date_mktra1a6 = { date: data.poa2ValidUntil };
  if (data.dvlaValidUntil) columnValues.date_mktrmjfr = { date: data.dvlaValidUntil }; // RENAMED from dvlaCheckDate
  if (data.licenseNextCheckDue) columnValues.date_mktsbgpy = { date: data.licenseNextCheckDue }; // NEW COLUMN

  // Insurance Questions (Yes/No status columns)
  if (data.hasDisability !== undefined) columnValues.status = { label: data.hasDisability ? 'Yes' : 'No' };
  if (data.hasConvictions !== undefined) columnValues.color_mktr4w0 = { label: data.hasConvictions ? 'Yes' : 'No' };
  if (data.hasProsecution !== undefined) columnValues.color_mktrbt3x = { label: data.hasProsecution ? 'Yes' : 'No' };
  if (data.hasAccidents !== undefined) columnValues.color_mktraeas = { label: data.hasAccidents ? 'Yes' : 'No' };
  if (data.hasInsuranceIssues !== undefined) columnValues.color_mktrpe6q = { label: data.hasInsuranceIssues ? 'Yes' : 'No' };
  if (data.hasDrivingBan !== undefined) columnValues.color_mktr2t8a = { label: data.hasDrivingBan ? 'Yes' : 'No' };
  if (data.additionalDetails) columnValues.long_text_mktr1a66 = data.additionalDetails;

  // System Fields
  if (data.overallStatus) columnValues.color_mktrwatg = { label: data.overallStatus };
  if (data.lastUpdated) columnValues.date_mktrk8kv = { date: data.lastUpdated };

  return columnValues;
}

// Format data for Board B columns (14 essential fields)
function formatBoardBColumnValues(data) {
  const columnValues = {};

  // Map Board A → Board B (14 essential fields)
  if (data.driverName) columnValues.text8 = data.driverName;
  if (data.email) columnValues.email = { email: data.email, text: data.email };
  if (data.phoneNumber) columnValues.text9__1 = data.phoneNumber;
  if (data.dateOfBirth) columnValues.date45 = { date: data.dateOfBirth };
  if (data.nationality) columnValues.text_mktqjbpm = data.nationality;
  if (data.licenseNumber) columnValues.text6 = data.licenseNumber;
  if (data.licenseIssuedBy) columnValues.text_mktqwkqn = data.licenseIssuedBy;
  if (data.licenseValidFrom) columnValues.date_mktqphhq = { date: data.licenseValidFrom };
  if (data.licenseValidTo) columnValues.driver_licence_valid_to = { date: data.licenseValidTo };
  if (data.datePassedTest) columnValues.date2 = { date: data.datePassedTest };
  if (data.homeAddress) columnValues.long_text6 = data.homeAddress;
  if (data.licenseAddress) columnValues.long_text8 = data.licenseAddress;
  if (data.jobNumber) columnValues.text86 = data.jobNumber;
  if (data.signatureDate) columnValues.date4 = { date: data.signatureDate };

  // Note: Signature file handled via mirror column lookup_mktr22y3

  return columnValues;
}

// Parse Board A data from Monday.com response
function parseBoardAData(item) {
  const driver = {
    id: item.id,
    name: item.name
  };

  // Parse column values
  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      // Identity & Contact
      case 'text_mktry2je': driver.driverName = col.text; break;
      case 'email_mktrgzj': driver.email = value?.email || col.text; break;
      case 'text_mktrfqe2': driver.phoneNumber = col.text; break;
      case 'date_mktr2x01': driver.dateOfBirth = value?.date; break;
      case 'text_mktrdh72': driver.nationality = col.text; break;
      
      // License Information
      case 'text_mktrrv38': driver.licenseNumber = col.text; break;
      case 'text_mktrz69': driver.licenseIssuedBy = col.text; break;
      case 'date_mktr93jq': driver.datePassedTest = value?.date; break;
      case 'date_mktrmdx5': driver.licenseValidFrom = value?.date; break;
      case 'date_mktrwk94': driver.licenseValidTo = value?.date; break;
      case 'text_mktr8kvs': driver.licenseEnding = col.text; break;
      
      // Addresses
      case 'long_text_mktr2jhb': driver.homeAddress = col.text; break;
      case 'long_text_mktrs5a0': driver.licenseAddress = col.text; break;
      
      // UPDATED: Document Expiry Dates
      case 'date_mktr1keg': driver.poa1ValidUntil = value?.date; break;
      case 'date_mktra1a6': driver.poa2ValidUntil = value?.date; break;
      case 'date_mktrmjfr': driver.dvlaValidUntil = value?.date; break; // RENAMED
      case 'date_mktsbgpy': driver.licenseNextCheckDue = value?.date; break; // NEW
      
      // Insurance Questions
      case 'status': driver.hasDisability = value?.label === 'Yes'; break;
      case 'color_mktr4w0': driver.hasConvictions = value?.label === 'Yes'; break;
      case 'color_mktrbt3x': driver.hasProsecution = value?.label === 'Yes'; break;
      case 'color_mktraeas': driver.hasAccidents = value?.label === 'Yes'; break;
      case 'color_mktrpe6q': driver.hasInsuranceIssues = value?.label === 'Yes'; break;
      case 'color_mktr2t8a': driver.hasDrivingBan = value?.label === 'Yes'; break;
      case 'long_text_mktr1a66': driver.additionalDetails = col.text; break;
      
      // System Fields
      case 'color_mktrwatg': driver.overallStatus = value?.label; break;
      case 'date_mktrk8kv': driver.lastUpdated = value?.date; break;
    }
  });

  return driver;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Test Monday.com connection
async function testConnection() {
  console.log('🔍 Testing Monday.com connection');
  
  try {
    const query = `
      query {
        boards (ids: [${BOARD_A_ID}, ${BOARD_B_ID}]) {
          id
          name
        }
      }
    `;

    const response = await callMondayAPI(query);
    
    if (response.data?.boards) {
      console.log('✅ Monday.com connection successful');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          boards: response.data.boards,
          message: 'Monday.com connection working'
        })
      };
    } else {
      throw new Error('No boards data received');
    }

  } catch (error) {
    console.error('Monday.com connection test failed:', error);
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

// Comprehensive two-board system test
async function testTwoBoardSystem(data) {
  console.log('🧪 Testing two-board system');
  
  try {
    const testEmail = data.testEmail || 'test@example.com';
    const testJobId = data.testJobId || 'TEST001';
    
    console.log(`🧪 Testing with email: ${testEmail}`);

    // Test 1: Create driver in Board A
    console.log('📝 Test 1: Creating driver in Board A...');
    const createResult = await createDriverBoardA({
      email: testEmail,
      driverData: {
        driverName: 'Test Driver',
        email: testEmail,
        phoneNumber: '+44 123 456 7890',
        dateOfBirth: '1990-01-01',
        nationality: 'British',
        licenseNumber: 'TEST123456789ABC',
        licenseValidTo: '2030-01-01',
        overallStatus: 'Working on it',
        lastUpdated: new Date().toISOString().split('T')[0]
      }
    });

    if (!createResult.success) {
      throw new Error(`Board A creation failed: ${createResult.error}`);
    }

    // Test 2: Find driver in Board A
    console.log('🔍 Test 2: Finding driver in Board A...');
    const findResult = await findDriverBoardA({ email: testEmail });
    
    if (!findResult.success) {
      throw new Error(`Board A lookup failed: ${findResult.error}`);
    }

    // Test 3: Copy A→B
    console.log('🔄 Test 3: Copying A→B...');
    const copyResult = await copyAToB({ email: testEmail, jobId: testJobId });
    
    if (!copyResult.success) {
      throw new Error(`A→B copy failed: ${copyResult.error}`);
    }

    console.log('✅ Two-board system test completed successfully');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        tests: {
          boardACreation: createResult.success,
          boardALookup: findResult.success,
          aBCopy: copyResult.success
        },
        message: 'Two-board system working correctly'
      })
    };

  } catch (error) {
    console.error('Two-board system test failed:', error);
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

// Call Monday.com API
async function callMondayAPI(query) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`Monday.com GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  
  return result;
}

// Upload file to Monday.com
async function uploadFileToMonday(itemId, columnId, fileData, filename) {
  try {
    console.log(`📁 Uploading file to item ${itemId}, column ${columnId}`);

    const FormData = require('form-data');
    const formData = new FormData();

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // GraphQL mutation for file upload
    const mutation = `
      mutation ($file: File!) {
        add_file_to_column (
          item_id: ${itemId},
          column_id: "${columnId}",
          file: $file
        ) {
          id
        }
      }
    `;

    // CRITICAL: FormData mapping with the "map" field
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    formData.append('map', JSON.stringify({ "0": ["variables.file"] })); // KEY FIX!
    formData.append('0', buffer, { 
      filename: filename || 'document.png', 
      contentType: 'image/png' 
    });

    const response = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`File upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (result.data?.add_file_to_column?.id) {
      console.log('✅ File uploaded successfully:', result.data.add_file_to_column.id);
      return { 
        success: true, 
        fileId: result.data.add_file_to_column.id 
      };
    } else {
      throw new Error('No file ID returned from upload');
    }

  } catch (error) {
    console.error('File upload error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Escape JSON for GraphQL
function escapeJson(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
