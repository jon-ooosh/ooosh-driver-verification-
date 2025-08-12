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

    // Test 5: Cleanup Test Items
    console.log('🧹 Cleaning up test items...');
    const cleanupResults = await cleanupTestItems(testItemAId, testResults.copyTest.itemId);
    testResults.cleanup = cleanupResults;

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

    // Expected Board B columns for A→B copy (11 essential fields)
    const expectedColumns = {
      'text8': 'Driver Name',
      'email': 'Email Address',
      'text9__1': 'Phone Number', 
      'date45': 'Date of Birth',
      'long_text6': 'Home Address',
      'long_text8': 'License Address',
      'text6': 'License Number',
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

// Create test item in Board A
async function createTestItemBoardA() {
  try {
    const boardId = '9798399405';
    const testEmail = `test.driver.${Date.now()}@oooshtest.com`;
    
    const mutation = `
      mutation {
        create_item(
          board_id: ${boardId},
          item_name: "TEST DRIVER - ${testEmail}"
        ) {
          id
        }
      }
    `;

    const response = await mondayApiCall(mutation);
    
    if (response.data && response.data.create_item) {
      const itemId = response.data.create_item.id;
      
      // Update with test data
      const updateMutation = `
        mutation {
          change_multiple_column_values(
            item_id: ${itemId},
            board_id: ${boardId},
            column_values: ${JSON.stringify(JSON.stringify({
              text_mktry2je: "Test Driver Name",
              email_mktrgzj: { email: testEmail, text: testEmail },
              text_mktrfqe2: "07123456789",
              date_mktr2x01: { date: "1990-01-01" },
              text_mktrdh72: "British",
              text_mktrrv38: "TEST123456789AB",
              text_mktr8kvs: "89AB",
              color_mktrwatg: { label: "Working on it" }
            }))}
          ) {
            id
          }
        }
      `;
      
      await mondayApiCall(updateMutation);
      
      return { success: true, itemId: itemId, email: testEmail };
    } else {
      return { success: false, error: 'Failed to create item in Board A' };
    }

  } catch (error) {
    console.error('Board A item creation error:', error);
    return { success: false, error: error.message };
  }
}

// Test A→B copy mechanism
async function testABCopy(itemAId) {
  try {
    if (!itemAId) {
      return { success: false, error: 'No Board A item ID provided' };
    }

    // Get data from Board A item
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

    // Map Board A → Board B (11 essential fields)
    const boardBData = {};
    
    // Text mappings
    if (columnsA['text_mktry2je']) boardBData['text8'] = JSON.parse(columnsA['text_mktry2je'] || '""');
    if (columnsA['email_mktrgzj']) {
      const emailData = JSON.parse(columnsA['email_mktrgzj'] || '{}');
      boardBData['email'] = { email: emailData.email || '', text: emailData.text || '' };
    }
    if (columnsA['text_mktrfqe2']) boardBData['text9__1'] = JSON.parse(columnsA['text_mktrfqe2'] || '""');
    if (columnsA['text_mktrrv38']) boardBData['text6'] = JSON.parse(columnsA['text_mktrrv38'] || '""');
    
    // Date mappings  
    if (columnsA['date_mktr2x01']) boardBData['date45'] = JSON.parse(columnsA['date_mktr2x01'] || '{}');
    if (columnsA['date_mktrwk94']) boardBData['driver_licence_valid_to'] = JSON.parse(columnsA['date_mktrwk94'] || '{}');
    if (columnsA['date_mktr93jq']) boardBData['date2'] = JSON.parse(columnsA['date_mktr93jq'] || '{}');
    
    // Long text mappings
    if (columnsA['long_text_mktr2jhb']) boardBData['long_text6'] = JSON.parse(columnsA['long_text_mktr2jhb'] || '""');
    if (columnsA['long_text_mktrs5a0']) boardBData['long_text8'] = JSON.parse(columnsA['long_text_mktrs5a0'] || '""');

    // Set signature date as current date
    boardBData['date4'] = { date: new Date().toISOString().split('T')[0] };

    // Create item in Board B
    const boardBId = '841453886';
    const createMutation = `
      mutation {
        create_item(
          board_id: ${boardBId},
          item_name: "${itemA.name} (COPIED)"
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

    // Update Board B item with mapped data
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

    return { 
      success: true, 
      itemId: itemBId,
      mappedFields: Object.keys(boardBData).length,
      details: {
        sourceItem: itemAId,
        targetItem: itemBId,
        mappedData: boardBData
      }
    };

  } catch (error) {
    console.error('A→B copy test error:', error);
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
