// File: functions/monday-integration.js
// OOOSH Driver Verification - Complete Two-Board Monday.com Integration
// SESSION 25 VERSION - Board A (Database) + Board B (Assignments) Architecture

const fetch = require('node-fetch');
const FormData = require('form-data');

// Board Configuration
const BOARD_A_ID = '9798399405'; // Driver Database - Complete verification records
const BOARD_B_ID = '841453886';  // Driver Assignments - Essential hire fields only

// Monday.com API Configuration
const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_FILE_URL = 'https://api.monday.com/v2/file';

exports.handler = async (event, context) => {
  console.log('Two-Board Monday.com Integration called with method:', event.httpMethod);
  
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
    let action, params;
    
    if (event.httpMethod === 'GET') {
      action = event.queryStringParameters?.action;
      params = event.queryStringParameters || {};
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      action = body.action;
      params = body;
    }

    console.log('Action:', action, 'Params:', Object.keys(params));

    switch (action) {
      // Board A Functions (Driver Database)
      case 'create-driver-board-a':
        return await createDriverInBoardA(params);
      case 'update-driver-board-a':
        return await updateDriverInBoardA(params);
      case 'find-driver-board-a':
        return await findDriverInBoardA(params.email);
      case 'upload-file-board-a':
        return await uploadFileToDriverBoardA(params);
      
      // Board B Functions (Driver Assignments)
      case 'copy-a-to-b':
        return await copyBoardAtoB(params);
      case 'find-driver-board-b':
        return await findDriverInBoardB(params.email);
      
      // Testing & Utilities
      case 'test-connection':
        return await testMondayConnection();
      case 'test-two-board-system':
        return await testTwoBoardSystem(params.testEmail);
      case 'test-file-upload':
        return await testFileUpload(params);
      
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
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
// BOARD A FUNCTIONS (Driver Database)
// ========================================

async function createDriverInBoardA(driverData) {
  console.log('Creating/updating driver in Board A (Database):', driverData.email);
  
  try {
    // STEP 1: Check if driver already exists by email
    console.log('🔍 Checking if driver already exists...');
    const findResult = await findDriverInBoardA(driverData.email);
    const findData = JSON.parse(findResult.body);
    
    if (findData.found) {
      // Driver exists - UPDATE instead of create
      console.log('📝 Driver exists, updating existing record:', findData.driverId);
      
      const updateResult = await updateDriverInBoardA({
        driverId: findData.driverId,
        ...driverData
      });
      
      // Parse the update result and return with creation-style response
      const updateData = JSON.parse(updateResult.body);
      
      if (updateData.success) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            driverId: findData.driverId,
            boardA: true,
            existing: true,
            message: 'Existing driver updated in Board A (Database)'
          })
        };
      } else {
        throw new Error('Failed to update existing driver');
      }
    }
    
    // STEP 2: Driver doesn't exist - CREATE new record
    console.log('👤 New driver, creating fresh record...');

    const query = `
      mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
          name
        }
      }
    `;

    // Build column values for Board A (24 columns)
    const columnValues = buildBoardAColumnValues(driverData);
    
    const variables = {
      boardId: BOARD_A_ID,
      itemName: `Driver Verification - ${driverData.email}`,
      columnValues: JSON.stringify(columnValues)
    };

    const response = await callMondayAPI(query, variables);
    
    if (response.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(response.errors)}`);
    }

    const driverId = response.data.create_item.id;
    console.log('✅ New driver created in Board A:', driverId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        driverId: driverId,
        boardA: true,
        existing: false,
        message: 'New driver created in Board A (Database)'
      })
    };

  } catch (error) {
    console.error('Create/update driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to create/update driver in Board A',
        details: error.message 
      })
    };
  }
}

async function updateDriverInBoardA(updateData) {
  console.log('Updating driver in Board A:', updateData.email || updateData.driverId);
  
  try {
    let driverId = updateData.driverId;
    
    // If no driverId provided, find by email
    if (!driverId && updateData.email) {
      const findResult = await findDriverInBoardA(updateData.email);
      if (findResult.statusCode !== 200) {
        throw new Error('Driver not found in Board A');
      }
      const findData = JSON.parse(findResult.body);
      driverId = findData.driverId;
    }

    if (!driverId) {
      throw new Error('Driver ID required for update');
    }

    const query = `
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values (board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
          id
          name
        }
      }
    `;

    // Build column values for update
    const columnValues = buildBoardAColumnValues(updateData);
    
    const variables = {
      boardId: BOARD_A_ID,
      itemId: driverId,
      columnValues: JSON.stringify(columnValues)
    };

    const response = await callMondayAPI(query, variables);
    
    if (response.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(response.errors)}`);
    }

    console.log('Driver updated in Board A:', driverId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        driverId: driverId,
        message: 'Driver updated in Board A'
      })
    };

  } catch (error) {
    console.error('Update driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to update driver in Board A',
        details: error.message 
      })
    };
  }
}

async function findDriverInBoardA(email) {
  console.log('Finding driver in Board A:', email);
  
  try {
    const query = `
      query ($boardIds: [ID!]!) {
        boards (ids: $boardIds) {
          items_page (limit: 50) {
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
      }
    `;

    const variables = {
      boardIds: [BOARD_A_ID]
    };

    const response = await callMondayAPI(query, variables);
    
    if (response.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(response.errors)}`);
    }

    const items = response.data.boards[0].items_page.items;
    
    // Find driver by email
    for (const item of items) {
      const emailColumn = item.column_values.find(col => col.id === 'email_mktrgzj');
      if (emailColumn && emailColumn.text === email) {
        // Parse all driver data
        const driverData = parseBoardADriverData(item);
        
        console.log('Driver found in Board A:', item.id);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            found: true,
            driverId: item.id,
            boardA: true,
            driverData: driverData
          })
        };
      }
    }

    // Driver not found
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        found: false,
        message: 'Driver not found in Board A'
      })
    };

  } catch (error) {
    console.error('Find driver Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to find driver in Board A',
        details: error.message 
      })
    };
  }
}

// ========================================
// BOARD B FUNCTIONS (Driver Assignments)
// ========================================

async function copyBoardAtoB(copyData) {
  console.log('Copying Board A to Board B:', copyData.email || copyData.driverIdA);
  
  try {
    let boardAData;
    
    // Get Board A data (either by ID or email)
    if (copyData.driverIdA) {
      // Get by Board A ID directly
      const query = `
        query ($itemIds: [ID!]!) {
          items (ids: $itemIds) {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      `;
      
      const response = await callMondayAPI(query, { itemIds: [copyData.driverIdA] });
      if (response.errors || !response.data.items[0]) {
        throw new Error('Board A driver not found');
      }
      boardAData = parseBoardADriverData(response.data.items[0]);
    } else if (copyData.email) {
      // Find by email first
      const findResult = await findDriverInBoardA(copyData.email);
      if (findResult.statusCode !== 200) {
        throw new Error('Driver not found in Board A');
      }
      const findData = JSON.parse(findResult.body);
      boardAData = findData.driverData;
    } else {
      throw new Error('Either driverIdA or email required for copy');
    }

    // Create item in Board B with mapped data
    const createQuery = `
      mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
          name
        }
      }
    `;

    // Map Board A → Board B (14 essential fields)
    const boardBColumnValues = mapBoardAtoBoardB(boardAData, copyData);
    
    const createVariables = {
      boardId: BOARD_B_ID,
      itemName: boardAData.driverName || `Driver - ${boardAData.email}`,
      columnValues: JSON.stringify(boardBColumnValues)
    };

    const createResponse = await callMondayAPI(createQuery, createVariables);
    
    if (createResponse.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(createResponse.errors)}`);
    }

    const driverIdB = createResponse.data.create_item.id;
    console.log('Driver copied to Board B:', driverIdB);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        driverIdA: boardAData.driverId,
        driverIdB: driverIdB,
        message: 'Driver copied from Board A to Board B',
        boardBId: driverIdB
      })
    };

  } catch (error) {
    console.error('Copy A to B error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to copy driver from Board A to Board B',
        details: error.message 
      })
    };
  }
}

async function findDriverInBoardB(email) {
  console.log('Finding driver in Board B:', email);
  
  try {
    const query = `
      query ($boardIds: [ID!]!) {
        boards (ids: $boardIds) {
          items_page (limit: 50) {
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
      }
    `;

    const variables = {
      boardIds: [BOARD_B_ID]
    };

    const response = await callMondayAPI(query, variables);
    
    if (response.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(response.errors)}`);
    }

    const items = response.data.boards[0].items_page.items;
    
    // Find driver by email
    for (const item of items) {
      const emailColumn = item.column_values.find(col => col.id === 'email');
      if (emailColumn && emailColumn.text === email) {
        
        console.log('Driver found in Board B:', item.id);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            found: true,
            driverId: item.id,
            boardB: true,
            driverData: { email: email, name: item.name }
          })
        };
      }
    }

    // Driver not found
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        found: false,
        message: 'Driver not found in Board B'
      })
    };

  } catch (error) {
    console.error('Find driver Board B error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to find driver in Board B',
        details: error.message 
      })
    };
  }
}

// ========================================
// FILE UPLOAD FUNCTIONS
// ========================================

async function uploadFileToDriverBoardA(uploadData) {
  console.log('Uploading file to Board A:', uploadData.columnId, uploadData.fileName);
  
  try {
    const { driverId, columnId, fileData, fileName, contentType } = uploadData;
    
    if (!driverId || !columnId || !fileData) {
      throw new Error('driverId, columnId, and fileData required');
    }

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');
    
    // Prepare GraphQL mutation
    const mutation = `
      mutation ($file: File!, $itemId: ID!, $columnId: String!) {
        add_file_to_column (file: $file, item_id: $itemId, column_id: $columnId) {
          id
        }
      }
    `;

    // Create FormData with FIXED mapping (Session 24 breakthrough!)
    const formData = new FormData();
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ 
      file: null, 
      itemId: driverId, 
      columnId: columnId 
    }));
    formData.append('map', JSON.stringify({ "0": ["variables.file"] })); // ← CRITICAL FIX
    formData.append('0', fileBuffer, { 
      filename: fileName || 'file.png',
      contentType: contentType || 'image/png'
    });

    // Upload to Monday.com
    const response = await fetch(MONDAY_FILE_URL, {
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
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    const fileId = result.data.add_file_to_column.id;
    console.log('File uploaded successfully to Board A:', fileId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        fileId: fileId,
        driverId: driverId,
        columnId: columnId,
        message: 'File uploaded to Board A'
      })
    };

  } catch (error) {
    console.error('File upload Board A error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to upload file to Board A',
        details: error.message 
      })
    };
  }
}

// ========================================
// DATA MAPPING FUNCTIONS
// ========================================

function buildBoardAColumnValues(driverData) {
  const columns = {};
  
  // FIXED: Use exact format from working test-board-mappings.js
  
  // Identity & Contact - CORRECTED FORMATTING
  if (driverData.driverName) {
    columns['text_mktry2je'] = driverData.driverName;
  }
  if (driverData.email) {
    columns['email_mktrgzj'] = { email: driverData.email, text: driverData.email };
  }
  if (driverData.phone) {
    columns['text_mktrfqe2'] = driverData.phone;
  }
  if (driverData.dateOfBirth) {
    columns['date_mktr2x01'] = { date: driverData.dateOfBirth };
  }
  if (driverData.nationality) {
    columns['text_mktrdh72'] = driverData.nationality;
  }

  // License Information - CORRECTED FORMATTING
  if (driverData.licenseNumber) {
    columns['text_mktrrv38'] = driverData.licenseNumber;
  }
  if (driverData.licenseIssuedBy) {
    columns['text_mktrz69'] = driverData.licenseIssuedBy;
  }
  if (driverData.datePassedTest) {
    columns['date_mktr93jq'] = { date: driverData.datePassedTest };
  }
  if (driverData.licenseValidFrom) {
    columns['date_mktrmdx5'] = { date: driverData.licenseValidFrom };
  }
  if (driverData.licenseValidTo) {
    columns['date_mktrwk94'] = { date: driverData.licenseValidTo };
  }
  if (driverData.licenseEnding) {
    columns['text_mktr8kvs'] = driverData.licenseEnding;
  }

  // Addresses - CORRECTED FORMATTING
  if (driverData.homeAddress) {
    columns['long_text_mktr2jhb'] = driverData.homeAddress;
  }
  if (driverData.licenseAddress) {
    columns['long_text_mktrs5a0'] = driverData.licenseAddress;
  }

  // Document Validity Dates - CORRECTED FORMATTING
  if (driverData.poa1ValidUntil) {
    columns['date_mktr1keg'] = { date: driverData.poa1ValidUntil };
  }
  if (driverData.poa2ValidUntil) {
    columns['date_mktra1a6'] = { date: driverData.poa2ValidUntil };
  }
  if (driverData.dvlaCheckDate) {
    columns['date_mktrmjfr'] = { date: driverData.dvlaCheckDate };
  }

  // Insurance Questions - EXACT FORMAT FROM WORKING VERSION
  if (driverData.hasDisability !== undefined) {
    columns['status'] = { label: driverData.hasDisability ? "Yes" : "No" };
  }
  if (driverData.hasConvictions !== undefined) {
    columns['color_mktr4w0'] = { label: driverData.hasConvictions ? "Yes" : "No" };
  }
  if (driverData.hasProsecution !== undefined) {
    columns['color_mktrbt3x'] = { label: driverData.hasProsecution ? "Yes" : "No" };
  }
  if (driverData.hasAccidents !== undefined) {
    columns['color_mktraeas'] = { label: driverData.hasAccidents ? "Yes" : "No" };
  }
  if (driverData.hasInsuranceIssues !== undefined) {
    columns['color_mktrpe6q'] = { label: driverData.hasInsuranceIssues ? "Yes" : "No" };
  }
  if (driverData.hasDrivingBan !== undefined) {
    columns['color_mktr2t8a'] = { label: driverData.hasDrivingBan ? "Yes" : "No" };
  }
  if (driverData.additionalDetails) {
    columns['long_text_mktr1a66'] = driverData.additionalDetails;
  }

  // Overall Status - STANDARD MONDAY.COM LABELS
  if (driverData.overallStatus) {
    columns['color_mktrwatg'] = { label: driverData.overallStatus };
  } else {
    // Default to "Working on it" for new drivers
    columns['color_mktrwatg'] = { label: "Working on it" };
  }

  // Update last modified date
  columns['date_mktrk8kv'] = { date: new Date().toISOString().split('T')[0] };

  return columns;
}

function mapBoardAtoBoardB(boardAData, copyData) {
  const columns = {};
  
  // FIXED: Use exact mapping logic from working test-board-mappings.js
  
  // Driver Name: text_mktry2je → text8
  if (boardAData.driverName) {
    columns['text8'] = boardAData.driverName;
  }
  
  // Email: email_mktrgzj → email
  if (boardAData.email) {
    columns['email'] = { email: boardAData.email, text: boardAData.email };
  }
  
  // Phone: text_mktrfqe2 → text9__1
  if (boardAData.phone) {
    columns['text9__1'] = boardAData.phone;
  }
  
  // Date of Birth: date_mktr2x01 → date45
  if (boardAData.dateOfBirth) {
    columns['date45'] = { date: boardAData.dateOfBirth };
  }
  
  // Nationality: text_mktrdh72 → text_mktqjbpm (FIXED - WAS MISSING)
  if (boardAData.nationality) {
    columns['text_mktqjbpm'] = boardAData.nationality;
  }
  
  // License Number: text_mktrrv38 → text6
  if (boardAData.licenseNumber) {
    columns['text6'] = boardAData.licenseNumber;
  }
  
  // License Issued By: text_mktrz69 → text_mktqwkqn (FIXED - WAS MISSING)
  if (boardAData.licenseIssuedBy) {
    columns['text_mktqwkqn'] = boardAData.licenseIssuedBy;
  }
  
  // License Valid From: date_mktrmdx5 → date_mktqphhq (FIXED - WAS MISSING)
  if (boardAData.licenseValidFrom) {
    columns['date_mktqphhq'] = { date: boardAData.licenseValidFrom };
  }
  
  // License Valid To: date_mktrwk94 → driver_licence_valid_to
  if (boardAData.licenseValidTo) {
    columns['driver_licence_valid_to'] = { date: boardAData.licenseValidTo };
  }
  
  // Date Passed Test: date_mktr93jq → date2
  if (boardAData.datePassedTest) {
    columns['date2'] = { date: boardAData.datePassedTest };
  }
  
  // Home Address: long_text_mktr2jhb → long_text6
  if (boardAData.homeAddress) {
    columns['long_text6'] = boardAData.homeAddress;
  }
  
  // License Address: long_text_mktrs5a0 → long_text8
  if (boardAData.licenseAddress) {
    columns['long_text8'] = boardAData.licenseAddress;
  }
  
  // Created Date: Always set current date for signature date
  columns['date4'] = { date: new Date().toISOString().split('T')[0] };
  
  // Add job linking data if provided
  if (copyData.jobId) {
    columns['text86'] = copyData.jobId; // Job number (5-digit HireHop)
  }
  
  // Note: Mirror column lookup_mktr22y3 will automatically show signature from Board A

  return columns;
}

function parseBoardADriverData(mondayItem) {
  const data = {
    driverId: mondayItem.id,
    driverName: mondayItem.name
  };
  
  // Parse all column values
  mondayItem.column_values.forEach(col => {
    switch (col.id) {
      case 'email_mktrgzj':
        data.email = col.text;
        break;
      case 'text_mktrfqe2':
        data.phone = col.text;
        break;
      case 'date_mktr2x01':
        data.dateOfBirth = col.text;
        break;
      case 'text_mktrdh72':
        data.nationality = col.text;
        break;
      case 'text_mktrrv38':
        data.licenseNumber = col.text;
        break;
      case 'text_mktrz69':
        data.licenseIssuedBy = col.text;
        break;
      case 'date_mktr93jq':
        data.datePassedTest = col.text;
        break;
      case 'date_mktrmdx5':
        data.licenseValidFrom = col.text;
        break;
      case 'date_mktrwk94':
        data.licenseValidTo = col.text;
        break;
      case 'text_mktr8kvs':
        data.licenseEnding = col.text;
        break;
      case 'long_text_mktr2jhb':
        data.homeAddress = col.text;
        break;
      case 'long_text_mktrs5a0':
        data.licenseAddress = col.text;
        break;
      case 'date_mktr1keg':
        data.poa1ValidUntil = col.text;
        break;
      case 'date_mktra1a6':
        data.poa2ValidUntil = col.text;
        break;
      case 'date_mktrmjfr':
        data.dvlaCheckDate = col.text;
        break;
      case 'color_mktrwatg':
        data.overallStatus = col.text;
        break;
      // Insurance questions
      case 'status':
        data.hasDisability = col.text === 'Yes';
        break;
      case 'color_mktr4w0':
        data.hasConvictions = col.text === 'Yes';
        break;
      case 'color_mktrbt3x':
        data.hasProsecution = col.text === 'Yes';
        break;
      case 'color_mktraeas':
        data.hasAccidents = col.text === 'Yes';
        break;
      case 'color_mktrpe6q':
        data.hasInsuranceIssues = col.text === 'Yes';
        break;
      case 'color_mktr2t8a':
        data.hasDrivingBan = col.text === 'Yes';
        break;
      case 'long_text_mktr1a66':
        data.additionalDetails = col.text;
        break;
    }
  });
  
  return data;
}

// ========================================
// TESTING FUNCTIONS
// ========================================

async function testMondayConnection() {
  console.log('Testing Monday.com connection...');
  
  try {
    const query = `
      query {
        me {
          name
          email
        }
      }
    `;

    const response = await callMondayAPI(query, {});
    
    if (response.errors) {
      throw new Error(`Monday.com API error: ${JSON.stringify(response.errors)}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        connection: 'Working',
        user: response.data.me,
        message: 'Monday.com API connection successful'
      })
    };

  } catch (error) {
    console.error('Monday.com connection test failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Monday.com connection failed',
        details: error.message 
      })
    };
  }
}

async function testTwoBoardSystem(testEmail = 'test-session25@example.com') {
  console.log('Testing two-board system with email:', testEmail);
  
  try {
    const results = {
      step1_createBoardA: null,
      step2_findBoardA: null,
      step3_copyAtoB: null,
      step4_findBoardB: null,
      step5_fileUpload: null
    };

    // Step 1: Create driver in Board A with COMPREHENSIVE test data
    console.log('Step 1: Creating driver in Board A with comprehensive data...');
    const createResult = await createDriverInBoardA({
      // FIXED: Add driverName (was missing)
      driverName: "John Michael Test-Driver", 
      email: testEmail,
      phone: '07987654321',
      dateOfBirth: '1985-03-15',
      nationality: 'British',
      licenseNumber: 'WOOD661120JO9LA',
      licenseIssuedBy: 'DVLA', 
      datePassedTest: '2003-08-20',
      licenseValidFrom: '2006-08-01',
      licenseValidTo: '2032-08-01',
      licenseEnding: 'JO9LA',
      homeAddress: '123 Test Home Street\nLondon\nSW1A 1AA\nUnited Kingdom',
      licenseAddress: '123 Test License Street\nLondon\nSW1A 1BB\nUnited Kingdom',
      poa1ValidUntil: '2025-10-01',
      poa2ValidUntil: '2025-11-15', 
      dvlaCheckDate: '2025-07-15',
      // FIXED: Insurance questions with proper boolean values
      hasDisability: false,
      hasConvictions: false,
      hasProsecution: false,
      hasAccidents: false,
      hasInsuranceIssues: false,
      hasDrivingBan: false,
      additionalDetails: 'No additional details to report at this time.',
      overallStatus: 'Working on it'
    });
    results.step1_createBoardA = JSON.parse(createResult.body);
    
    if (!results.step1_createBoardA.success) {
      throw new Error('Failed to create driver in Board A');
    }
    
    const driverIdA = results.step1_createBoardA.driverId;

    // Step 2: Find driver in Board A
    console.log('Step 2: Finding driver in Board A...');
    const findAResult = await findDriverInBoardA(testEmail);
    results.step2_findBoardA = JSON.parse(findAResult.body);

    // Step 3: Copy Board A to Board B
    console.log('Step 3: Copying Board A to Board B...');
    const copyResult = await copyBoardAtoB({
      driverIdA: driverIdA,
      jobId: '12345'
    });
    results.step3_copyAtoB = JSON.parse(copyResult.body);
    
    if (!results.step3_copyAtoB.success) {
      throw new Error('Failed to copy Board A to Board B');
    }

    // Step 4: Find driver in Board B
    console.log('Step 4: Finding driver in Board B...');
    const findBResult = await findDriverInBoardB(testEmail);
    results.step4_findBoardB = JSON.parse(findBResult.body);

    // Step 5: Test ALL file uploads to Board A (7 file columns)
    console.log('Step 5: Testing ALL file uploads to Board A...');
    
    const fileUploadResults = await testAllFileUploadsBoardA(driverIdA);
    results.step5_fileUpload = fileUploadResults;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        testEmail: testEmail,
        results: results,
        summary: {
          boardA_created: !!results.step1_createBoardA.success,
          boardA_found: !!results.step2_findBoardA.found,
          copy_successful: !!results.step3_copyAtoB.success,
          boardB_found: !!results.step4_findBoardB.found,
          all_files_uploaded: results.step5_fileUpload && results.step5_fileUpload.overallSuccess
        },
        message: 'Two-board system test completed',
        keepForInspection: {
          boardAItemId: driverIdA,
          boardBItemId: results.step3_copyAtoB.driverIdB,
          message: 'Test items preserved for manual verification',
          boardAUrl: `https://oooshtours.monday.com/boards/9798399405/views/207920414?pulse=${driverIdA}`,
          boardBUrl: `https://oooshtours.monday.com/boards/841453886/views/207920414?pulse=${results.step3_copyAtoB.driverIdB}`
        }
      })
    };

  } catch (error) {
    console.error('Two-board system test failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Two-board system test failed',
        details: error.message,
        partialResults: results
      })
    };
  }
}

// Test all 7 file uploads to Board A - FROM WORKING test-board-mappings.js
async function testAllFileUploadsBoardA(driverId) {
  console.log('🔄 Testing ALL 7 file uploads to Board A...');
  
  const fileResults = {};
  
  // All 7 file columns in Board A (from working version)
  const fileColumns = {
    file_mktrypb7: 'License Front Image',
    file_mktr76g6: 'License Back Image', 
    file_mktr56t0: 'Passport/Secondary ID',
    file_mktrf9jv: 'POA Document 1',
    file_mktr3fdw: 'POA Document 2',
    file_mktrwhn8: 'DVLA Check Document',
    file_mktrfanc: 'Signature File'
  };
  
  // Test file data (1x1 pixel PNG)
  const testFileData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  
  // Upload to each column
  let successful = 0;
  let failed = 0;
  
  for (const [columnId, columnName] of Object.entries(fileColumns)) {
    try {
      console.log(`📁 Testing file upload to ${columnName}...`);
      
      const uploadResult = await uploadFileToDriverBoardA({
        driverId: driverId,
        columnId: columnId,
        fileData: testFileData,
        fileName: `test_${columnName.replace(/[^a-zA-Z0-9]/g, '_')}.png`,
        contentType: 'image/png'
      });
      
      const result = JSON.parse(uploadResult.body);
      fileResults[columnId] = result;
      
      if (result.success) {
        successful++;
        console.log(`✅ ${columnName} uploaded successfully`);
      } else {
        failed++;
        console.log(`❌ ${columnName} upload failed: ${result.error}`);
      }
      
      // Small delay between uploads to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`File upload error for ${columnName}:`, error);
      fileResults[columnId] = { success: false, error: error.message };
      failed++;
    }
  }
  
  console.log(`📊 File upload summary: ${successful}/${Object.keys(fileColumns).length} successful`);
  
  return {
    overallSuccess: failed === 0,
    successful: successful,
    failed: failed,
    total: Object.keys(fileColumns).length,
    details: fileResults,
    message: `File uploads: ${successful} successful, ${failed} failed`
  };
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

async function callMondayAPI(query, variables) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Monday.com API request failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
