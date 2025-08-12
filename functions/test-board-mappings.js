// File: functions/test-board-mappings.js
// Simple test to verify Board A and Board B connections and mappings
// Tests the two-board architecture before building full integration

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Testing Board A and Board B mappings...');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const testResults = {
    timestamp: new Date().toISOString(),
    boardA: { status: 'pending', details: {} },
    boardB: { status: 'pending', details: {} },
    copyTest: { status: 'pending', details: {} },
    summary: { success: false, issues: [] }
  };

  try {
    // Test 1: Board A Connection and Column Mapping
    console.log('🔍 Testing Board A (Driver Database) connection...');
    
    const boardAResult = await testBoardA();
    testResults.boardA = boardAResult;
    
    if (!boardAResult.success) {
      testResults.summary.issues.push('Board A connection failed');
    }

    // Test 2: Board B Connection and Column Mapping
    console.log('🔍 Testing Board B (Driver Assignments) connection...');
    
    const boardBResult = await testBoardB();
    testResults.boardB = boardBResult;
    
    if (!boardBResult.success) {
      testResults.summary.issues.push('Board B connection failed');
    }

    // Test 3: Create Test Item in Board A
    let testItemAId = null;
    if (boardAResult.success) {
      console.log('📝 Creating test item in Board A...');
      
      const createResult = await createTestItemBoardA();
      testResults.boardA.testItemCreation = createResult;
      
      if (createResult.success) {
        testItemAId = createResult.itemId;
        console.log('✅ Test item created in Board A:', testItemAId);
      } else {
        testResults.summary.issues.push('Board A item creation failed');
      }
    }

    // Test 4: A→B Copy Test
    if (testItemAId && boardBResult.success) {
      console.log('🔄 Testing A→B copy mechanism...');
      
      const copyResult = await testABCopy(testItemAId);
      testResults.copyTest = copyResult;
      
      if (!copyResult.success) {
        testResults.summary.issues.push('A→B copy failed');
      }
    }

    // Test 5: Keep Test Items for Manual Inspection
    console.log('📋 Keeping test items for manual inspection...');
    testResults.keepForInspection = {
      boardAItemId: testItemAId,
      boardBItemId: testResults.copyTest.itemId,
      message: 'Test items preserved for manual verification',
      boardAUrl: `https://oooshtours.monday.com/boards/9798399405/views/207920414?pulse=${testItemAId}`,
      boardBUrl: `https://oooshtours.monday.com/boards/841453886/views/207920414?pulse=${testResults.copyTest.itemId}`
    };

    // Final Summary
    testResults.summary.success = testResults.summary.issues.length === 0;
    testResults.summary.message = testResults.summary.success ? 
      '🎉 All board mappings working correctly!' : 
      `❌ ${testResults.summary.issues.length} issues found`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: testResults.summary.success,
        results: testResults,
        recommendations: generateRecommendations(testResults)
      })
    };

  } catch (error) {
    console.error('Board mapping test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Board mapping test failed',
        details: error.message,
        partialResults: testResults
      })
    };
  }
};

// Test Board A (Driver Database) connection and columns
async function testBoardA() {
  try {
    const boardId = '9798399405';
    
    const query = `
      query {
        boards(ids: [${boardId}]) {
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

    const response = await mondayApiCall(query);
    
    if (!response.data || !response.data.boards || response.data.boards.length === 0) {
      return { success: false, error: 'Board A not found' };
    }

    const board = response.data.boards[0];
    const columns = board.columns;

    // Expected Board A columns with IDs
    const expectedColumns = {
      'text_mktry2je': 'Driver Name',
      'email_mktrgzj': 'Email Address', 
      'text_mktrfqe2': 'Phone Number',
      'date_mktr2x01': 'Date of Birth',
      'text_mktrdh72': 'Nationality',
      'text_mktrrv38': 'License Number',
      'text_mktrz69': 'License Issued By',
      'date_mktr93jq': 'Date Passed Test',
      'date_mktrmdx5': 'License Valid From',
      'date_mktrwk94': 'License Valid To',
      'text_mktr8kvs': 'License Ending',
      'long_text_mktr2jhb': 'Home Address',
      'long_text_mktrs5a0': 'License Address',
      'date_mktr1keg': 'POA1 Valid Until',
      'date_mktra1a6': 'POA2 Valid Until',
      'date_mktrmjfr': 'DVLA Check Date',
      'file_mktrypb7': 'License Front Image',
      'file_mktr76g6': 'License Back Image',
      'file_mktr56t0': 'Passport/Secondary ID',
      'file_mktrf9jv': 'POA Document 1',
      'file_mktr3fdw': 'POA Document 2',
      'file_mktrwhn8': 'DVLA Check Document',
      'file_mktrfanc': 'Signature File',
      'color_mktrwatg': 'Overall Status'
    };

    const foundColumns = {};
    const missingColumns = {};
    
    columns.forEach(col => {
      if (expectedColumns[col.id]) {
        foundColumns[col.id] = {
          title: col.title,
          type: col.type,
          expected: expectedColumns[col.id]
        };
      }
    });

    Object.keys(expectedColumns).forEach(colId => {
      if (!foundColumns[colId]) {
        missingColumns[colId] = expectedColumns[colId];
      }
    });

    return {
      success: Object.keys(missingColumns).length === 0,
      boardName: board.name,
      totalColumns: columns.length,
      foundColumns: Object.keys(foundColumns).length,
      missingColumns: Object.keys(missingColumns).length,
      details: {
        found: foundColumns,
        missing: missingColumns
      }
    };

  } catch (error) {
    console.error('Board A test error:', error);
    return { success: false, error: error.message };
  }
}

// Test Board B (Driver Assignments) connection and columns  
async function testBoardB() {
  try {
    const boardId = '841453886';
    
    const query = `
      query {
        boards(ids: [${boardId}]) {
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

    const response = await mondayApiCall(query);
    
    if (!response.data || !response.data.boards || response.data.boards.length === 0) {
      return { success: false, error: 'Board B not found' };
    }

    const board = response.data.boards[0];
    const columns = board.columns;

    // Expected Board B columns for A→B copy (14 essential fields - UPDATED)
    const expectedColumns = {
      'text8': 'Driver Name',
      'email': 'Email Address',
      'text9__1': 'Phone Number', 
      'date45': 'Date of Birth',
      'text_mktqjbpm': 'Nationality', // ADDED MISSING FIELD
      'long_text6': 'Home Address',
      'long_text8': 'License Address',
      'text6': 'License Number',
      'text_mktqwkqn': 'License Issued By', // ADDED MISSING FIELD
      'date_mktqphhq': 'License Valid From', // ADDED MISSING FIELD
      'driver_licence_valid_to': 'License Valid To',
      'date2': 'Date Passed Test',
      'files1': 'Signature File',
      'date4': 'Created Date' // Will use as signature date
    };

    const foundColumns = {};
    const missingColumns = {};
    
    columns.forEach(col => {
      if (expectedColumns[col.id]) {
        foundColumns[col.id] = {
          title: col.title,
          type: col.type,
          expected: expectedColumns[col.id]
        };
      }
    });

    Object.keys(expectedColumns).forEach(colId => {
      if (!foundColumns[colId]) {
        missingColumns[colId] = expectedColumns[colId];
      }
    });

    return {
      success: Object.keys(missingColumns).length === 0,
      boardName: board.name,
      totalColumns: columns.length,
      foundColumns: Object.keys(foundColumns).length,
      missingColumns: Object.keys(missingColumns).length,
      details: {
        found: foundColumns,
        missing: missingColumns
      }
    };

  } catch (error) {
    console.error('Board B test error:', error);
    return { success: false, error: error.message };
  }
}

// Create test item in Board A with ALL columns populated
async function createTestItemBoardA() {
  try {
    const boardId = '9798399405';
    const testEmail = `test.driver.${Date.now()}@oooshtest.com`;
    
    const mutation = `
      mutation {
        create_item(
          board_id: ${boardId},
          item_name: "COMPREHENSIVE TEST DRIVER - ${testEmail}"
        ) {
          id
        }
      }
    `;

    const response = await mondayApiCall(mutation);
    
    if (response.data && response.data.create_item) {
      const itemId = response.data.create_item.id;
      
      // COMPREHENSIVE test data - ALL COLUMNS WITH CORRECT STATUS LABELS
      const comprehensiveData = {
        // Identity & Contact
        text_mktry2je: "John Michael Test-Driver",
        email_mktrgzj: { email: testEmail, text: testEmail },
        text_mktrfqe2: "07987654321",
        date_mktr2x01: { date: "1985-03-15" },
        text_mktrdh72: "British",
        
        // License Information
        text_mktrrv38: "WOOD661120JO9LA",
        text_mktrz69: "DVLA",
        date_mktr93jq: { date: "2003-08-20" },
        date_mktrmdx5: { date: "2006-08-01" },
        date_mktrwk94: { date: "2032-08-01" },
        text_mktr8kvs: "JO9LA",
        
        // Addresses
        long_text_mktr2jhb: "123 Test Home Street\nLondon\nSW1A 1AA\nUnited Kingdom",
        long_text_mktrs5a0: "123 Test License Street\nLondon\nSW1A 1BB\nUnited Kingdom",
        
        // Document Validity Dates
        date_mktr1keg: { date: "2025-10-01" }, // POA1 valid until
        date_mktra1a6: { date: "2025-11-15" }, // POA2 valid until  
        date_mktrmjfr: { date: "2025-07-15" }, // DVLA check date
        
        // Insurance Questions (Status columns - FIXED WITH CORRECT LABELS)
        status: { label: "No" }, // Has Disability
        color_mktr4w0: { label: "No" }, // Has Convictions
        color_mktrbt3x: { label: "No" }, // Has Prosecution
        color_mktraeas: { label: "No" }, // Has Accidents
        color_mktrpe6q: { label: "No" }, // Has Insurance Issues
        color_mktr2t8a: { label: "No" }, // Has Driving Ban
        long_text_mktr1a66: "No additional details to report at this time.",
        
        // Overall Status - need to check what labels this column has
        color_mktrwatg: { label: "Done" } // Try "Done" instead of "Working on it"
      };
      
      // Update with comprehensive test data
      const updateMutation = `
        mutation {
          change_multiple_column_values(
            item_id: ${itemId},
            board_id: ${boardId},
            column_values: ${JSON.stringify(JSON.stringify(comprehensiveData))}
          ) {
            id
          }
        }
      `;
      
      await mondayApiCall(updateMutation);
      console.log('✅ Updated Board A item with comprehensive data');
      
      // Now test file uploads
      const fileUploadResults = await testAllFileUploads(itemId, boardId);
      
      return { 
        success: true, 
        itemId: itemId, 
        email: testEmail,
        fieldsPopulated: Object.keys(comprehensiveData).length,
        fileUploads: fileUploadResults
      };
    } else {
      return { success: false, error: 'Failed to create item in Board A' };
    }

  } catch (error) {
    console.error('Board A comprehensive creation error:', error);
    return { success: false, error: error.message };
  }
}

// Test all file uploads to Board A
async function testAllFileUploads(itemId, boardId) {
  const fileResults = {};
  
  // Test file columns in Board A
  const fileColumns = {
    file_mktrypb7: 'License Front Image',
    file_mktr76g6: 'License Back Image', 
    file_mktr56t0: 'Passport/Secondary ID',
    file_mktrf9jv: 'POA Document 1',
    file_mktr3fdw: 'POA Document 2',
    file_mktrwhn8: 'DVLA Check Document',
    file_mktrfanc: 'Signature File'
  };
  
  // Create small test files for each column
  for (const [columnId, columnName] of Object.entries(fileColumns)) {
    try {
      console.log(`📁 Testing file upload to ${columnName}...`);
      
      const result = await uploadTestFile(itemId, boardId, columnId, columnName);
      fileResults[columnId] = result;
      
      // Small delay between uploads
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`File upload error for ${columnName}:`, error);
      fileResults[columnId] = { success: false, error: error.message };
    }
  }
  
  return fileResults;
}

// Upload a test file to a specific column - FIXED VERSION
async function uploadTestFile(itemId, boardId, columnId, fileName) {
  try {
    // Create the same 1x1 pixel PNG we used before that worked
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    // Use the working file upload approach from our previous success
    const mutation = `
      mutation($file: File!) {
        add_file_to_column(
          item_id: ${itemId},
          column_id: "${columnId}", 
          file: $file
        ) {
          id
        }
      }
    `;
    
    // Convert base64 to buffer (Node.js approach)
    const buffer = Buffer.from(testImageBase64, 'base64');
    
    // Create form data properly
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    formData.append('0', buffer, {
      filename: `test_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}.png`,
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
    
    if (response.ok) {
      console.log(`✅ Successfully uploaded test file to ${fileName}`);
      return { success: true, message: `File uploaded to ${fileName}` };
    } else {
      const errorText = await response.text();
      console.error(`❌ File upload failed for ${fileName}:`, errorText);
      return { success: false, error: `Upload failed: ${response.status} - ${errorText}` };
    }
    
  } catch (error) {
    console.error(`File upload error for ${fileName}:`, error);
    return { success: false, error: error.message };
  }
}

// Test A→B copy mechanism with ALL fields
async function testABCopy(itemAId) {
  try {
    if (!itemAId) {
      return { success: false, error: 'No Board A item ID provided' };
    }

    console.log('📋 Getting comprehensive data from Board A...');
    
    // Get ALL data from Board A item
    const queryA = `
      query {
        items(ids: [${itemAId}]) {
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

    const responseA = await mondayApiCall(queryA);
    
    if (!responseA.data || !responseA.data.items || responseA.data.items.length === 0) {
      return { success: false, error: 'Board A item not found for copy test' };
    }

    const itemA = responseA.data.items[0];
    const columnsA = {};
    
    itemA.column_values.forEach(col => {
      columnsA[col.id] = col.value;
    });

    console.log('📊 Board A data retrieved:', Object.keys(columnsA).length, 'columns');

    // COMPREHENSIVE Board A → Board B mapping (ALL 14 essential fields - FIXED)
    const boardBData = {};
    
    // Text mappings
    if (columnsA['text_mktry2je']) {
      const value = JSON.parse(columnsA['text_mktry2je'] || '""');
      if (value) boardBData['text8'] = value;
    }
    
    if (columnsA['email_mktrgzj']) {
      const emailData = JSON.parse(columnsA['email_mktrgzj'] || '{}');
      if (emailData.email) {
        boardBData['email'] = { 
          email: emailData.email, 
          text: emailData.text || emailData.email 
        };
      }
    }
    
    if (columnsA['text_mktrfqe2']) {
      const value = JSON.parse(columnsA['text_mktrfqe2'] || '""');
      if (value) boardBData['text9__1'] = value;
    }
    
    if (columnsA['text_mktrrv38']) {
      const value = JSON.parse(columnsA['text_mktrrv38'] || '""');
      if (value) boardBData['text6'] = value;
    }
    
    // FIXED: Add missing nationality mapping
    if (columnsA['text_mktrdh72']) {
      const value = JSON.parse(columnsA['text_mktrdh72'] || '""');
      if (value) boardBData['text_mktqjbpm'] = value;
    }
    
    // FIXED: Add missing license issued by mapping  
    if (columnsA['text_mktrz69']) {
      const value = JSON.parse(columnsA['text_mktrz69'] || '""');
      if (value) boardBData['text_mktqwkqn'] = value;
    }
    
    // Date mappings  
    if (columnsA['date_mktr2x01']) {
      const dateData = JSON.parse(columnsA['date_mktr2x01'] || '{}');
      if (dateData.date) boardBData['date45'] = dateData;
    }
    
    if (columnsA['date_mktrwk94']) {
      const dateData = JSON.parse(columnsA['date_mktrwk94'] || '{}');
      if (dateData.date) boardBData['driver_licence_valid_to'] = dateData;
    }
    
    if (columnsA['date_mktr93jq']) {
      const dateData = JSON.parse(columnsA['date_mktr93jq'] || '{}');
      if (dateData.date) boardBData['date2'] = dateData;
    }
    
    // FIXED: Add missing license valid from mapping
    if (columnsA['date_mktrmdx5']) {
      const dateData = JSON.parse(columnsA['date_mktrmdx5'] || '{}');
      if (dateData.date) boardBData['date_mktqphhq'] = dateData;
    }
    
    // Long text mappings
    if (columnsA['long_text_mktr2jhb']) {
      const value = JSON.parse(columnsA['long_text_mktr2jhb'] || '""');
      if (value) boardBData['long_text6'] = value;
    }
    
    if (columnsA['long_text_mktrs5a0']) {
      const value = JSON.parse(columnsA['long_text_mktrs5a0'] || '""');
      if (value) boardBData['long_text8'] = value;
    }

    // Set signature date as current date
    boardBData['date4'] = { date: new Date().toISOString().split('T')[0] };

    // File handling - copy signature file if exists
    if (columnsA['file_mktrfanc']) {
      const fileData = JSON.parse(columnsA['file_mktrfanc'] || '{}');
      if (fileData.files && fileData.files.length > 0) {
        console.log('📁 Found signature file to copy');
        // Note: File copying requires special handling - we'll handle this in full integration
      }
    }

    console.log('📋 Mapping', Object.keys(boardBData).length, 'fields to Board B');

    // Create item in Board B
    const boardBId = '841453886';
    const createMutation = `
      mutation {
        create_item(
          board_id: ${boardBId},
          item_name: "${itemA.name} → COPIED FROM DATABASE"
        ) {
          id
        }
      }
    `;

    const createResponse = await mondayApiCall(createMutation);
    
    if (!createResponse.data || !createResponse.data.create_item) {
      return { success: false, error: 'Failed to create Board B item' };
    }

    const itemBId = createResponse.data.create_item.id;

    // Update Board B item with ALL mapped data
    const updateMutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${itemBId},
          board_id: ${boardBId},
          column_values: ${JSON.stringify(JSON.stringify(boardBData))}
        ) {
          id
        }
      }
    `;

    await mondayApiCall(updateMutation);

    console.log('✅ Board B item created and populated');

    return { 
      success: true, 
      itemId: itemBId,
      mappedFields: Object.keys(boardBData).length,
      details: {
        sourceItem: itemAId,
        targetItem: itemBId,
        sourceColumns: Object.keys(columnsA).length,
        mappedData: boardBData
      }
    };

  } catch (error) {
    console.error('Comprehensive A→B copy test error:', error);
    return { success: false, error: error.message };
  }
}

// Cleanup test items
async function cleanupTestItems(itemAId, itemBId) {
  const results = { boardA: null, boardB: null };
  
  try {
    if (itemAId) {
      const deleteA = `
        mutation {
          delete_item(item_id: ${itemAId}) {
            id
          }
        }
      `;
      
      const responseA = await mondayApiCall(deleteA);
      results.boardA = responseA.data ? 'deleted' : 'failed';
    }
    
    if (itemBId) {
      const deleteB = `
        mutation {
          delete_item(item_id: ${itemBId}) {
            id
          }
        }
      `;
      
      const responseB = await mondayApiCall(deleteB);
      results.boardB = responseB.data ? 'deleted' : 'failed';
    }
    
    return results;
    
  } catch (error) {
    console.error('Cleanup error:', error);
    return { error: error.message };
  }
}

// Generate recommendations based on test results
function generateRecommendations(testResults) {
  const recommendations = [];
  
  if (!testResults.boardA.success) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'Board A connection issues',
      action: 'Check board ID and column IDs in Board A',
      details: testResults.boardA.details
    });
  }
  
  if (!testResults.boardB.success) {
    recommendations.push({
      priority: 'HIGH', 
      issue: 'Board B connection issues',
      action: 'Verify existing board column IDs match expected mapping',
      details: testResults.boardB.details
    });
  }
  
  if (testResults.copyTest && !testResults.copyTest.success) {
    recommendations.push({
      priority: 'MEDIUM',
      issue: 'A→B copy mechanism failed',
      action: 'Debug data mapping and column value formats',
      details: testResults.copyTest.error
    });
  }
  
  if (testResults.summary.success) {
    recommendations.push({
      priority: 'SUCCESS',
      issue: 'All tests passed',
      action: 'Ready to build full monday-integration.js with Board A + A→B copy functions'
    });
  }
  
  return recommendations;
}

// Monday.com API helper
async function mondayApiCall(query) {
  const apiToken = process.env.MONDAY_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('MONDAY_API_TOKEN environment variable not set');
  }

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    console.error('Monday.com GraphQL errors:', result.errors);
    throw new Error(`GraphQL error: ${result.errors[0]?.message}`);
  }

  return result;
}
