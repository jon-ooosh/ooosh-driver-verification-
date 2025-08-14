// File: functions/monday-integration.js
// OOOSH Driver Verification - Complete Monday.com Integration
// FIXED: Internal function calls for update operations

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

// FIXED: Create or update driver in Board A
async function createDriverBoardA(data) {
  console.log('🔄 Creating/updating driver in Board A');
  
  try {
    const { email, driverData } = data;
    
    if (!email) {
      throw new Error('Email is required');
    }

    // FIXED: Check if driver already exists using internal helper
    const existingDriver = await findDriverBoardAInternal(email);
    
    if (existingDriver) {
      console.log('✅ Driver exists, updating record');
      return await updateDriverBoardA({ email, updates: driverData });
    }

    console.log('👤 Creating new driver in Board A');

    // Prepare column values for Board A
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

// FIXED: Update existing driver in Board A
async function updateDriverBoardA(data) {
  console.log('🔄 Updating driver in Board A');
  
  try {
    const { email, updates } = data;
    
    if (!email || !updates) {
      throw new Error('Email and updates are required');
    }

    // FIXED: Find the driver using internal helper function (not HTTP endpoint)
    const existingDriver = await findDriverBoardAInternal(email);
    
    if (!existingDriver || !existingDriver.id) {
      throw new Error('Driver not found in Board A');
    }

    const driverId = existingDriver.id;
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

// NEW: Internal helper function for finding driver (returns driver object directly)
async function findDriverBoardAInternal(email) {
  console.log('🔍 Internal: Finding driver in Board A for:', email);
  
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
    
    if (response.data?.items_page?.items?.length > 0) {
      const item = response.data.items_page.items[0];
      const driver = parseBoardADriver(item);
      console.log('✅ Internal: Driver found:', driver.id);
      return driver; // Return driver object directly, not HTTP response
    } else {
      console.log('❌ Internal: Driver not found');
      return null; // Return null if not found
    }

  } catch (error) {
    console.error('❌ Internal find driver error:', error);
    return null; // Return null on error
  }
}

// EXISTING: Find driver in Board A (HTTP endpoint version)
async function findDriverBoardA(data) {
  console.log('🔍 Finding driver in Board A');
  
  try {
    const { email } = data;
    const driver = await findDriverBoardAInternal(email);
    
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
          error: 'Driver not found in Board A'
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
    const { email, fileType, fileData, fileName } = data;
    
    if (!email || !fileType || !fileData) {
      throw new Error('Email, file type, and file data are required');
    }

    // Find the driver first
    const driver = await findDriverBoardAInternal(email);
    
    if (!driver) {
      throw new Error('Driver not found in Board A');
    }

    // Map file types to Board A column IDs
    const fileColumnMap = {
      'license-front': 'file_mktrwq0c',
      'license-back': 'file_mktrfp1c', 
      'passport': 'file_mktr2am4',
      'poa1': 'file_mktrftkh',
      'poa2': 'file_mktrvagt',
      'dvla-check': 'file_mktrs8hd',
      'signature': 'files1'
    };

    const columnId = fileColumnMap[fileType];
    if (!columnId) {
      throw new Error(`Unknown file type: ${fileType}`);
    }

    // Prepare file upload mutation
    const mutation = `
      mutation ($file: File!) {
        add_file_to_column (
          item_id: ${driver.id},
          column_id: "${columnId}",
          file: $file
        ) {
          id
        }
      }
    `;

    // Create form data for file upload
    const FormData = require('form-data');
    const form = new FormData();
    
    const fileBuffer = Buffer.from(fileData, 'base64');
    form.append('query', mutation);
    form.append('variables', JSON.stringify({ file: null }));
    form.append('map', JSON.stringify({ "0": ["variables.file"] }));
    form.append('0', fileBuffer, { filename: fileName || `${fileType}.png` });

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        ...form.getHeaders()
      },
      body: form
    });

    const result = await response.json();
    
    if (result.data?.add_file_to_column?.id) {
      console.log('✅ File uploaded to Board A');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fileId: result.data.add_file_to_column.id,
          message: `${fileType} uploaded successfully`
        })
      };
    } else {
      throw new Error('Failed to upload file to Board A');
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
              column_id: "email_mktrtl5i",
              column_values: ["${email}"]
            }
          ],
          limit: 5
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
    
    if (response.data?.items_page?.items?.length > 0) {
      const assignments = response.data.items_page.items.map(item => parseBoardBDriver(item));
      console.log('✅ Driver assignments found in Board B');
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
          error: 'No driver assignments found in Board B'
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
    const driverA = await findDriverBoardAInternal(email);
    
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
// DATA FORMATTING FUNCTIONS
// ========================================

// Format driver data for Board A columns
function formatBoardAColumnValues(driverData) {
  const columnValues = {};
  
  // Text fields
  if (driverData.driverName) columnValues['text_mktry2je'] = driverData.driverName;
  if (driverData.email) columnValues['email_mktrgzj'] = { email: driverData.email, text: driverData.email };
  if (driverData.phoneNumber) columnValues['text_mktrfqe2'] = driverData.phoneNumber;
  if (driverData.nationality) columnValues['text_mktrdh72'] = driverData.nationality;
  if (driverData.licenseNumber) columnValues['text_mktrrv38'] = driverData.licenseNumber;
  if (driverData.licenseIssuedBy) columnValues['text_mktrz69'] = driverData.licenseIssuedBy;
  if (driverData.licenseEnding) columnValues['text_mktr8kvs'] = driverData.licenseEnding;
  if (driverData.homeAddress) columnValues['long_text_mktr2jhb'] = driverData.homeAddress;
  if (driverData.licenseAddress) columnValues['long_text_mktrs5a0'] = driverData.licenseAddress;
  if (driverData.additionalDetails) columnValues['long_text_mktr1a66'] = driverData.additionalDetails;
  
  // Date fields
  if (driverData.dateOfBirth) columnValues['date_mktr2x01'] = { date: driverData.dateOfBirth };
  if (driverData.datePassedTest) columnValues['date_mktr93jq'] = { date: driverData.datePassedTest };
  if (driverData.licenseValidFrom) columnValues['date_mktrmdx5'] = { date: driverData.licenseValidFrom };
  if (driverData.licenseValidTo) columnValues['date_mktrwk94'] = { date: driverData.licenseValidTo };
  if (driverData.poa1ValidUntil) columnValues['date_mktr1keg'] = { date: driverData.poa1ValidUntil };
  if (driverData.poa2ValidUntil) columnValues['date_mktra1a6'] = { date: driverData.poa2ValidUntil };
  if (driverData.dvlaValidUntil) columnValues['date_mktsnj4'] = { date: driverData.dvlaValidUntil };
  if (driverData.licenseNextCheckDue) columnValues['date_mktsbgpy'] = { date: driverData.licenseNextCheckDue };
  if (driverData.lastUpdated) columnValues['date_mktrk8kv'] = { date: driverData.lastUpdated };
  
  // Status fields (Yes/No)
  if (driverData.hasDisability !== undefined) {
    columnValues['color_mktrx02'] = { label: driverData.hasDisability ? 'Yes' : 'No' };
  }
  if (driverData.hasConvictions !== undefined) {
    columnValues['color_mktr4r5'] = { label: driverData.hasConvictions ? 'Yes' : 'No' };
  }
  if (driverData.hasProsecution !== undefined) {
    columnValues['color_mktr51z'] = { label: driverData.hasProsecution ? 'Yes' : 'No' };
  }
  if (driverData.hasAccidents !== undefined) {
    columnValues['color_mktraeas'] = { label: driverData.hasAccidents ? 'Yes' : 'No' };
  }
  if (driverData.hasInsuranceIssues !== undefined) {
    columnValues['color_mktrpe6q'] = { label: driverData.hasInsuranceIssues ? 'Yes' : 'No' };
  }
  if (driverData.hasDrivingBan !== undefined) {
    columnValues['color_mktr2t8a'] = { label: driverData.hasDrivingBan ? 'Yes' : 'No' };
  }
  
  // Overall status
  if (driverData.overallStatus) {
    columnValues['color_mktrwatg'] = { label: driverData.overallStatus };
  }
  
  return columnValues;
}

// Format driver data for Board B columns
function formatBoardBColumnValues(driverData) {
  const columnValues = {};
  
  // Essential fields for Board B (14 fields)
  if (driverData.driverName) columnValues['text_mktrps13'] = driverData.driverName;
  if (driverData.email) columnValues['email_mktrtl5i'] = { email: driverData.email, text: driverData.email };
  if (driverData.phoneNumber) columnValues['text_mktr0qql'] = driverData.phoneNumber;
  if (driverData.dateOfBirth) columnValues['date_mktr7l3'] = { date: driverData.dateOfBirth };
  if (driverData.nationality) columnValues['text_mktr6uj9'] = driverData.nationality;
  if (driverData.licenseNumber) columnValues['text_mktr6u73'] = driverData.licenseNumber;
  if (driverData.licenseIssuedBy) columnValues['text_mktrn4f'] = driverData.licenseIssuedBy;
  if (driverData.licenseValidFrom) columnValues['date_mktr4q3'] = { date: driverData.licenseValidFrom };
  if (driverData.licenseValidTo) columnValues['date_mktr7d8'] = { date: driverData.licenseValidTo };
  if (driverData.datePassedTest) columnValues['date_mktr7nk'] = { date: driverData.datePassedTest };
  if (driverData.homeAddress) columnValues['long_text_mktrx0x8'] = driverData.homeAddress;
  if (driverData.licenseAddress) columnValues['long_text_mktr7j36'] = driverData.licenseAddress;
  if (driverData.jobNumber) columnValues['text_mktr8m4'] = driverData.jobNumber;
  if (driverData.signatureDate) columnValues['date4'] = { date: driverData.signatureDate };
  
  return columnValues;
}

// Parse Board A driver data from Monday.com response
function parseBoardADriver(item) {
  const driver = {
    id: item.id,
    name: item.name,
    driverName: '',
    email: '',
    phoneNumber: '',
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
    lastUpdated: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'text_mktry2je': driver.driverName = col.text; break;
      case 'email_mktrgzj': driver.email = value?.email || col.text; break;
      case 'text_mktrfqe2': driver.phoneNumber = col.text; break;
      case 'date_mktr2x01': driver.dateOfBirth = value?.date; break;
      case 'text_mktrdh72': driver.nationality = col.text; break;
      case 'text_mktrrv38': driver.licenseNumber = col.text; break;
      case 'text_mktrz69': driver.licenseIssuedBy = col.text; break;
      case 'date_mktrwk94': driver.licenseValidTo = value?.date; break;
      case 'text_mktr8kvs': driver.licenseEnding = col.text; break;
      case 'long_text_mktr2jhb': driver.homeAddress = col.text; break;
      case 'long_text_mktrs5a0': driver.licenseAddress = col.text; break;
      case 'color_mktrx02': driver.hasDisability = value?.label === 'Yes'; break;
      case 'color_mktr4r5': driver.hasConvictions = value?.label === 'Yes'; break;
      case 'color_mktr51z': driver.hasProsecution = value?.label === 'Yes'; break;
      case 'color_mktraeas': driver.hasAccidents = value?.label === 'Yes'; break;
      case 'color_mktrpe6q': driver.hasInsuranceIssues = value?.label === 'Yes'; break;
      case 'color_mktr2t8a': driver.hasDrivingBan = value?.label === 'Yes'; break;
      case 'long_text_mktr1a66': driver.additionalDetails = col.text; break;
      case 'date_mktrk8kv': driver.lastUpdated = value?.date; break;
    }
  });

  return driver;
}

// Parse Board B driver data from Monday.com response
function parseBoardBDriver(item) {
  const assignment = {
    id: item.id,
    name: item.name,
    driverName: '',
    email: '',
    jobNumber: '',
    signatureDate: ''
  };

  item.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'text_mktrps13': assignment.driverName = col.text; break;
      case 'email_mktrtl5i': assignment.email = value?.email || col.text; break;
      case 'text_mktr8m4': assignment.jobNumber = col.text; break;
      case 'date4': assignment.signatureDate = value?.date; break;
    }
  });

  return assignment;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Call Monday.com API
async function callMondayAPI(query, variables = {}) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`
    },
    body: JSON.stringify({
      query: query,
      variables: variables
    })
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`Monday.com GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

// Escape JSON for GraphQL
function escapeJson(jsonString) {
  return jsonString.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

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

    if (!createResult.statusCode || createResult.statusCode !== 200) {
      throw new Error(`Board A creation failed: ${createResult.error || 'Unknown error'}`);
    }

    // Test 2: Find driver in Board A
    console.log('🔍 Test 2: Finding driver in Board A...');
    const findResult = await findDriverBoardA({ email: testEmail });
    
    if (!findResult.statusCode || findResult.statusCode !== 200) {
      throw new Error(`Board A lookup failed: ${findResult.error || 'Unknown error'}`);
    }

    // Test 3: Copy A→B
    console.log('🔄 Test 3: Copying A→B...');
    const copyResult = await copyAToB({ email: testEmail, jobId: testJobId });
    
    if (!copyResult.statusCode || copyResult.statusCode !== 200) {
      throw new Error(`A→B copy failed: ${copyResult.error || 'Unknown error'}`);
    }

    console.log('✅ Two-board system test completed successfully');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        results: {
          boardACreation: 'Success',
          boardALookup: 'Success', 
          aToBCopy: 'Success'
        },
        message: 'Two-board system working perfectly'
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
