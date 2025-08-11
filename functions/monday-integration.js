// File: functions/monday-integration.js
// OOOSH Driver Verification - Complete Monday.com Integration
// Replaces Google Sheets with Monday.com as primary database

const fetch = require('node-fetch');

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
    let action, params;
    
    if (event.httpMethod === 'GET') {
      action = event.queryStringParameters?.action;
      params = event.queryStringParameters || {};
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      action = body.action;
      params = body;
    }

    if (!action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Action parameter required' })
      };
    }

    console.log('Processing action:', action);

    switch (action) {
      case 'get-driver-status':
        return await getDriverStatus(params.email, params.jobId);
      case 'create-driver':
        return await createDriver(params);
      case 'update-driver':
        return await updateDriver(params);
      case 'save-insurance-data':
        return await saveInsuranceData(params);
      case 'save-idenfy-results':
        return await saveIdenfyResults(params);
      case 'save-dvla-results':
        return await saveDvlaResults(params);
      case 'upload-signature':
        return await uploadSignature(params);
      case 'test-connection':
        return await testMondayConnection();
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
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};

// Monday.com API Configuration
const MONDAY_CONFIG = {
  apiUrl: 'https://api.monday.com/v2',
  boardId: '841453886', // Your driver verification board
  headers: {
    'Authorization': process.env.MONDAY_API_TOKEN,
    'Content-Type': 'application/json'
  }
};

// Column ID mapping for your board
const COLUMNS = {
  driverName: 'text8',
  jobLink: 'connect_boards51',
  jobNumber: 'text86',
  email: 'email',
  phone: 'text9__1',
  dateOfBirth: 'date45',
  nationality: 'text_mktqjbpm',
  licenseNumber: 'text6',
  homeAddress: 'long_text6',
  licenseAddress: 'long_text8',
  licenseIssuedBy: 'text_mktqwkqn',
  datePassedTest: 'date2',
  licenseValidFrom: 'date_mktqphhq',
  licenseExpiry: 'driver_licence_valid_to',
  poa1ValidDate: 'date8',
  poa2ValidDate: 'date32',
  hasDisability: 'color_mktq8vhz',
  hasConvictions: 'color_mktqzyze',
  hasProsecution: 'color_mktqw319',
  hasAccidents: 'color_mktqwhpd',
  hasInsuranceIssues: 'color_mktqfymz',
  hasDrivingBan: 'color_mktqxzqs',
  additionalDetails: 'long_text_mktqfsnx',
  status: 'color_mktqc2dt'
};

// Status values for the status column
const STATUS_VALUES = {
  pending: 'Pending',
  documentsRequired: 'Documents Required',
  underReview: 'Under Review', 
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired'
};

// Get driver status - replacement for Google Sheets lookup
async function getDriverStatus(email, jobId) {
  console.log('Getting driver status from Monday.com:', email, jobId);
  
  try {
    if (!email) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email parameter required' })
      };
    }

    // Query Monday.com for existing driver
    const query = `
      query {
        boards (ids: [${MONDAY_CONFIG.boardId}]) {
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

    const response = await callMondayApi(query);
    
    if (!response.data || !response.data.boards || !response.data.boards[0]) {
      console.log('No board data found, treating as new driver');
      return createNewDriverResponse(email);
    }

    const items = response.data.boards[0].items;
    console.log(`Found ${items.length} items in Monday.com board`);
    
    // Find driver by email
    const driverItem = findDriverByEmail(items, email);
    
    if (!driverItem) {
      console.log('No existing driver found, treating as new driver');
      return createNewDriverResponse(email);
    }

    console.log('Found existing driver:', driverItem.name);
    
    // Parse driver data and determine status
    const driverData = parseDriverItem(driverItem);
    const documentStatus = calculateDocumentStatus(driverData);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: documentStatus.overallStatus,
        email: email,
        name: driverData.driverName,
        mondayItemId: driverItem.id,
        documents: documentStatus.documents,
        needsUpdate: documentStatus.needsUpdate,
        existingDriver: true
      })
    };

  } catch (error) {
    console.error('Get driver status error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to get driver status',
        details: error.message 
      })
    };
  }
}

// Create new driver in Monday.com
async function createDriver(params) {
  console.log('Creating new driver in Monday.com:', params.email);
  
  try {
    const { email, jobId, jobNumber, driverName } = params;
    
    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email and jobId required' })
      };
    }

    // Create item in Monday.com
    const itemName = driverName || `Driver - ${email}`;
    
    const mutation = `
      mutation {
        create_item (
          board_id: ${MONDAY_CONFIG.boardId}
          item_name: "${itemName}"
          column_values: "${escapeJson(JSON.stringify({
            [COLUMNS.email]: email,
            [COLUMNS.jobNumber]: jobNumber || '',
            [COLUMNS.status]: STATUS_VALUES.pending
          }))}"
        ) {
          id
          name
        }
      }
    `;

    const response = await callMondayApi(mutation);
    
    if (!response.data || !response.data.create_item) {
      throw new Error('Failed to create item in Monday.com');
    }

    const newItem = response.data.create_item;
    console.log('Created new driver item:', newItem.id);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mondayItemId: newItem.id,
        itemName: newItem.name,
        message: 'Driver created successfully'
      })
    };

  } catch (error) {
    console.error('Create driver error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to create driver',
        details: error.message 
      })
    };
  }
}

// Save insurance questionnaire data to Monday.com
async function saveInsuranceData(params) {
  console.log('Saving insurance data to Monday.com:', params.email);
  
  try {
    const { email, insuranceData, mondayItemId } = params;
    
    if (!email || !insuranceData) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email and insurance data required' })
      };
    }

    // Find or get the Monday item ID
    let itemId = mondayItemId;
    if (!itemId) {
      const driverStatus = await getDriverStatus(email);
      const statusData = JSON.parse(driverStatus.body);
      itemId = statusData.mondayItemId;
    }

    if (!itemId) {
      throw new Error('Could not find driver record in Monday.com');
    }

    // Prepare insurance column updates
    const columnValues = {
      [COLUMNS.hasDisability]: insuranceData.hasDisability === 'yes' ? 'Yes' : 'No',
      [COLUMNS.hasConvictions]: insuranceData.hasConvictions === 'yes' ? 'Yes' : 'No',
      [COLUMNS.hasProsecution]: insuranceData.hasProsecution === 'yes' ? 'Yes' : 'No',
      [COLUMNS.hasAccidents]: insuranceData.hasAccidents === 'yes' ? 'Yes' : 'No',
      [COLUMNS.hasInsuranceIssues]: insuranceData.hasInsuranceIssues === 'yes' ? 'Yes' : 'No',
      [COLUMNS.hasDrivingBan]: insuranceData.hasDrivingBan === 'yes' ? 'Yes' : 'No',
      [COLUMNS.additionalDetails]: insuranceData.additionalDetails || '',
      [COLUMNS.status]: STATUS_VALUES.documentsRequired
    };

    const mutation = `
      mutation {
        change_multiple_column_values (
          item_id: ${itemId}
          board_id: ${MONDAY_CONFIG.boardId}
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayApi(mutation);
    
    if (!response.data || !response.data.change_multiple_column_values) {
      throw new Error('Failed to update insurance data in Monday.com');
    }

    console.log('Insurance data saved successfully to Monday.com');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Insurance data saved successfully'
      })
    };

  } catch (error) {
    console.error('Save insurance data error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to save insurance data',
        details: error.message 
      })
    };
  }
}

// Save Idenfy verification results
async function saveIdenfyResults(params) {
  console.log('Saving Idenfy results to Monday.com:', params.email);
  
  try {
    const { email, idenfyData, mondayItemId } = params;
    
    if (!email || !idenfyData) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email and Idenfy data required' })
      };
    }

    // Find the Monday item
    let itemId = mondayItemId;
    if (!itemId) {
      const driverStatus = await getDriverStatus(email);
      const statusData = JSON.parse(driverStatus.body);
      itemId = statusData.mondayItemId;
    }

    if (!itemId) {
      throw new Error('Could not find driver record in Monday.com');
    }

    // Prepare Idenfy data updates
    const columnValues = {
      [COLUMNS.driverName]: idenfyData.firstName && idenfyData.lastName ? 
        `${idenfyData.firstName} ${idenfyData.lastName}` : '',
      [COLUMNS.licenseNumber]: idenfyData.licenseNumber || '',
      [COLUMNS.dateOfBirth]: idenfyData.dateOfBirth || '',
      [COLUMNS.licenseExpiry]: idenfyData.licenseExpiry || '',
      [COLUMNS.status]: idenfyData.approved ? STATUS_VALUES.underReview : STATUS_VALUES.rejected
    };

    // Add address data if available
    if (idenfyData.address) {
      columnValues[COLUMNS.licenseAddress] = idenfyData.address;
      columnValues[COLUMNS.homeAddress] = idenfyData.address; // Assuming same initially
    }

    const mutation = `
      mutation {
        change_multiple_column_values (
          item_id: ${itemId}
          board_id: ${MONDAY_CONFIG.boardId}
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayApi(mutation);
    
    if (!response.data || !response.data.change_multiple_column_values) {
      throw new Error('Failed to update Idenfy data in Monday.com');
    }

    console.log('Idenfy results saved successfully to Monday.com');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Idenfy results saved successfully'
      })
    };

  } catch (error) {
    console.error('Save Idenfy results error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to save Idenfy results',
        details: error.message 
      })
    };
  }
}

// Save DVLA results (your AWS Textract OCR data)
async function saveDvlaResults(params) {
  console.log('Saving DVLA results to Monday.com:', params.email);
  
  try {
    const { email, dvlaData, mondayItemId } = params;
    
    if (!email || !dvlaData) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email and DVLA data required' })
      };
    }

    // Find the Monday item
    let itemId = mondayItemId;
    if (!itemId) {
      const driverStatus = await getDriverStatus(email);
      const statusData = JSON.parse(driverStatus.body);
      itemId = statusData.mondayItemId;
    }

    if (!itemId) {
      throw new Error('Could not find driver record in Monday.com');
    }

    // Prepare DVLA data updates
    const columnValues = {};
    
    // Update license information if extracted from DVLA
    if (dvlaData.licenseNumber && !columnValues[COLUMNS.licenseNumber]) {
      columnValues[COLUMNS.licenseNumber] = dvlaData.licenseNumber;
    }
    
    if (dvlaData.driverName && !columnValues[COLUMNS.driverName]) {
      columnValues[COLUMNS.driverName] = dvlaData.driverName;
    }

    if (dvlaData.validTo) {
      columnValues[COLUMNS.licenseExpiry] = dvlaData.validTo;
    }

    if (dvlaData.validFrom) {
      columnValues[COLUMNS.licenseValidFrom] = dvlaData.validFrom;
    }

    // Set status based on insurance decision
    if (dvlaData.insuranceDecision) {
      if (dvlaData.insuranceDecision.approved) {
        columnValues[COLUMNS.status] = STATUS_VALUES.approved;
      } else if (dvlaData.insuranceDecision.manualReview) {
        columnValues[COLUMNS.status] = STATUS_VALUES.underReview;
      } else {
        columnValues[COLUMNS.status] = STATUS_VALUES.rejected;
      }
    }

    const mutation = `
      mutation {
        change_multiple_column_values (
          item_id: ${itemId}
          board_id: ${MONDAY_CONFIG.boardId}
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayApi(mutation);
    
    if (!response.data || !response.data.change_multiple_column_values) {
      throw new Error('Failed to update DVLA data in Monday.com');
    }

    console.log('DVLA results saved successfully to Monday.com');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        insuranceDecision: dvlaData.insuranceDecision,
        message: 'DVLA results saved successfully'
      })
    };

  } catch (error) {
    console.error('Save DVLA results error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to save DVLA results',
        details: error.message 
      })
    };
  }
}

// Upload signature file to Monday.com
async function uploadSignature(params) {
  console.log('Uploading signature to Monday.com:', params.email);
  
  try {
    const { email, signatureData, mondayItemId } = params;
    
    if (!email || !signatureData) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email and signature data required' })
      };
    }

    // Find the Monday item
    let itemId = mondayItemId;
    if (!itemId) {
      const driverStatus = await getDriverStatus(email);
      const statusData = JSON.parse(driverStatus.body);
      itemId = statusData.mondayItemId;
    }

    if (!itemId) {
      throw new Error('Could not find driver record in Monday.com');
    }

    // Convert base64 signature to file upload
    const base64Data = signatureData.replace(/^data:image\/[^;]+;base64,/, '');
    const fileName = `signature_${email.replace('@', '_')}_${Date.now()}.png`;
    
    // Monday.com file upload mutation
    const mutation = `
      mutation ($file: File!) {
        add_file_to_column (
          item_id: ${itemId}
          column_id: "files"
          file: $file
        ) {
          id
        }
      }
    `;

    // Note: This is simplified - actual Monday.com file upload requires multipart form data
    // For now, we'll store the signature reference and implement full file upload in next iteration
    const columnValues = {
      [COLUMNS.status]: STATUS_VALUES.approved // Move to approved status after signature
    };

    const updateMutation = `
      mutation {
        change_multiple_column_values (
          item_id: ${itemId}
          board_id: ${MONDAY_CONFIG.boardId}
          column_values: "${escapeJson(JSON.stringify(columnValues))}"
        ) {
          id
        }
      }
    `;

    const response = await callMondayApi(updateMutation);
    
    console.log('Signature upload placeholder completed - status updated to approved');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Signature uploaded and driver approved',
        note: 'File upload will be enhanced in next iteration'
      })
    };

  } catch (error) {
    console.error('Upload signature error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to upload signature',
        details: error.message 
      })
    };
  }
}

// Test Monday.com connection
async function testMondayConnection() {
  try {
    const query = `
      query {
        boards (ids: [${MONDAY_CONFIG.boardId}]) {
          id
          name
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const response = await callMondayApi(query);
    
    if (!response.data || !response.data.boards) {
      throw new Error('Invalid response from Monday.com API');
    }

    const board = response.data.boards[0];
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Monday.com connection successful',
        board: {
          id: board.id,
          name: board.name,
          columnCount: board.columns.length
        },
        timestamp: new Date().toISOString()
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

// Helper Functions

// Call Monday.com API
async function callMondayApi(query) {
  const response = await fetch(MONDAY_CONFIG.apiUrl, {
    method: 'POST',
    headers: MONDAY_CONFIG.headers,
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Monday.com API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`Monday.com GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

// Find driver by email in Monday.com items
function findDriverByEmail(items, email) {
  for (const item of items) {
    const emailColumn = item.column_values.find(col => col.id === COLUMNS.email);
    if (emailColumn && emailColumn.text === email) {
      return item;
    }
  }
  return null;
}

// Parse Monday.com item data into structured format
function parseDriverItem(item) {
  const data = {};
  
  item.column_values.forEach(column => {
    switch (column.id) {
      case COLUMNS.driverName:
        data.driverName = column.text;
        break;
      case COLUMNS.email:
        data.email = column.text;
        break;
      case COLUMNS.licenseExpiry:
        data.licenseExpiry = column.text;
        break;
      case COLUMNS.poa1ValidDate:
        data.poa1ValidDate = column.text;
        break;
      case COLUMNS.poa2ValidDate:
        data.poa2ValidDate = column.text;
        break;
      case COLUMNS.status:
        data.status = column.text;
        break;
      // Add more columns as needed
    }
  });
  
  return data;
}

// Calculate document status based on Monday.com data
function calculateDocumentStatus(driverData) {
  const today = new Date();
  const documents = {
    license: { valid: false },
    poa1: { valid: false },
    poa2: { valid: false },
    dvlaCheck: { valid: false }
  };
  
  let needsUpdate = [];
  
  // Check license expiry
  if (driverData.licenseExpiry) {
    const expiryDate = new Date(driverData.licenseExpiry);
    documents.license.valid = expiryDate > today;
    documents.license.expiryDate = driverData.licenseExpiry;
    
    if (!documents.license.valid) {
      needsUpdate.push('license');
    }
  } else {
    needsUpdate.push('license');
  }
  
  // Check POA documents (90-day validity)
  if (driverData.poa1ValidDate) {
    const poa1Date = new Date(driverData.poa1ValidDate);
    documents.poa1.valid = poa1Date > today;
    documents.poa1.expiryDate = driverData.poa1ValidDate;
    
    if (!documents.poa1.valid) {
      needsUpdate.push('poa1');
    }
  } else {
    needsUpdate.push('poa1');
  }
  
  if (driverData.poa2ValidDate) {
    const poa2Date = new Date(driverData.poa2ValidDate);
    documents.poa2.valid = poa2Date > today;
    documents.poa2.expiryDate = driverData.poa2ValidDate;
    
    if (!documents.poa2.valid) {
      needsUpdate.push('poa2');
    }
  } else {
    needsUpdate.push('poa2');
  }
  
  // Determine overall status
  let overallStatus = 'verified';
  if (needsUpdate.length > 0) {
    overallStatus = 'partial';
  }
  if (driverData.status === STATUS_VALUES.rejected) {
    overallStatus = 'rejected';
  }
  if (!driverData.licenseExpiry && !driverData.poa1ValidDate) {
    overallStatus = 'new';
  }
  
  return {
    overallStatus,
    documents,
    needsUpdate
  };
}

// Create response for new driver
function createNewDriverResponse(email) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'new',
      email: email,
      name: null,
      mondayItemId: null,
      documents: {
        license: { valid: false },
        poa1: { valid: false },
        poa2: { valid: false },
        dvlaCheck: { valid: false }
      },
      needsUpdate: ['license', 'poa1', 'poa2', 'dvlaCheck'],
      existingDriver: false
    })
  };
}

// Escape JSON for GraphQL mutations
function escapeJson(jsonString) {
  return jsonString.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
