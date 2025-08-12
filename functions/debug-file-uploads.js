// File: functions/debug-file-uploads.js
// Debug why files are "uploading" but not appearing in Monday.com
// Let's check the actual API responses and Board A file columns

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🔍 Debugging Monday.com file upload issues');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const debugResults = {
      timestamp: new Date().toISOString(),
      tests: {},
      fileUploadResults: {},
      recommendations: []
    };

    // Step 1: Check if we can see the existing test item files
    console.log('🔍 Step 1: Checking existing Board A test item...');
    const existingItemCheck = await checkExistingItemFiles();
    debugResults.tests.existingItemCheck = existingItemCheck;

    // Step 2: Test file upload to Board B (known working column)
    console.log('🔍 Step 2: Testing Board B file upload (known working)...');
    const boardBTest = await testBoardBFileUpload();
    debugResults.tests.boardBFileUpload = boardBTest;

    // Step 3: Test single Board A file upload with detailed logging
    console.log('🔍 Step 3: Testing single Board A file upload with debug...');
    const boardATest = await testSingleBoardAUpload();
    debugResults.tests.boardAFileUpload = boardATest;

    // Step 4: Compare API responses
    console.log('🔍 Step 4: Analyzing results...');
    debugResults.analysis = analyzeFileUploadIssues(debugResults.tests);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        debugResults,
        summary: generateDebugSummary(debugResults),
        nextActions: generateNextActions(debugResults)
      })
    };

  } catch (error) {
    console.error('Debug file upload error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Debug failed',
        details: error.message 
      })
    };
  }
};

// Check if files exist on the test item we just created
async function checkExistingItemFiles() {
  try {
    // Use the item ID from our last test: 9799375270
    const itemId = '9799375270';
    
    const query = `
      query {
        items(ids: [${itemId}]) {
          id
          name
          column_values {
            id
            text
            value
            ... on FileValue {
              files {
                id
                name
                url
                created_at
              }
            }
          }
        }
      }
    `;

    const response = await mondayApiCall(query);
    
    if (response.data && response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      const fileColumns = item.column_values.filter(col => 
        ['file_mktrypb7', 'file_mktr76g6', 'file_mktr56t0', 'file_mktrf9jv', 
         'file_mktr3fdw', 'file_mktrwhn8', 'file_mktrfanc'].includes(col.id)
      );
      
      const fileInfo = {};
      fileColumns.forEach(col => {
        const parsed = JSON.parse(col.value || '{}');
        fileInfo[col.id] = {
          hasFiles: parsed.files && parsed.files.length > 0,
          fileCount: parsed.files ? parsed.files.length : 0,
          files: parsed.files || [],
          text: col.text,
          rawValue: col.value
        };
      });
      
      return {
        success: true,
        itemId: itemId,
        fileColumns: fileInfo,
        totalFileColumns: fileColumns.length,
        message: `Found ${fileColumns.length} file columns on existing test item`
      };
    } else {
      return { success: false, error: 'Test item not found' };
    }

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Test file upload to Board B (we know this works)
async function testBoardBFileUpload() {
  try {
    console.log('📎 Testing Board B file upload to files1 column...');
    
    // Create a test item in Board B first
    const createMutation = `
      mutation {
        create_item(
          board_id: 841453886,
          item_name: "File Upload Debug Test - Board B"
        ) {
          id
        }
      }
    `;

    const createResponse = await mondayApiCall(createMutation);
    const itemId = createResponse.data.create_item.id;
    
    // Upload file to Board B files1 column (known working)
    const uploadResult = await uploadTestFileToBoardB(itemId);
    
    // Check if file appeared
    const checkResult = await checkFileAppeared(itemId, 'files1', '841453886');
    
    return {
      success: uploadResult.success && checkResult.appeared,
      itemId: itemId,
      uploadResponse: uploadResult,
      fileCheck: checkResult,
      message: uploadResult.success ? 'Board B file upload worked' : 'Board B file upload failed'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Test single Board A file upload with detailed response logging
async function testSingleBoardAUpload() {
  try {
    console.log('📎 Testing Board A file upload with detailed logging...');
    
    // Create a test item in Board A
    const createMutation = `
      mutation {
        create_item(
          board_id: 9798399405,
          item_name: "File Upload Debug Test - Board A"
        ) {
          id
        }
      }
    `;

    const createResponse = await mondayApiCall(createMutation);
    const itemId = createResponse.data.create_item.id;
    
    // Test upload to signature file column
    console.log(`🔍 Uploading to Board A signature column: file_mktrfanc`);
    const uploadResult = await uploadTestFileToBoardA(itemId, 'file_mktrfanc');
    
    // Check if file appeared
    const checkResult = await checkFileAppeared(itemId, 'file_mktrfanc', '9798399405');
    
    return {
      success: uploadResult.success && checkResult.appeared,
      itemId: itemId,
      uploadResponse: uploadResult,
      fileCheck: checkResult,
      message: `Board A upload: API says ${uploadResult.success ? 'success' : 'failed'}, File appeared: ${checkResult.appeared ? 'yes' : 'no'}`
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Upload test file to Board B (proven working method)
async function uploadTestFileToBoardB(itemId) {
  try {
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const mutation = `
      mutation($file: File!) {
        add_file_to_column(
          item_id: ${itemId},
          column_id: "files1", 
          file: $file
        ) {
          id
          name
          url
        }
      }
    `;
    
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    
    const buffer = Buffer.from(testImageBase64, 'base64');
    formData.append('0', buffer, {
      filename: 'board_b_test.png',
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

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { rawResponse: responseText };
    }

    return {
      success: response.ok,
      status: response.status,
      responseData: responseData,
      itemId: itemId
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Upload test file to Board A with same method
async function uploadTestFileToBoardA(itemId, columnId) {
  try {
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const mutation = `
      mutation($file: File!) {
        add_file_to_column(
          item_id: ${itemId},
          column_id: "${columnId}", 
          file: $file
        ) {
          id
          name
          url
        }
      }
    `;
    
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('query', mutation);
    formData.append('variables', JSON.stringify({ file: null }));
    
    const buffer = Buffer.from(testImageBase64, 'base64');
    formData.append('0', buffer, {
      filename: 'board_a_test.png',
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

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { rawResponse: responseText };
    }

    return {
      success: response.ok,
      status: response.status,
      responseData: responseData,
      itemId: itemId,
      columnId: columnId
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Check if file actually appeared in Monday.com
async function checkFileAppeared(itemId, columnId, boardId) {
  try {
    // Wait a moment for file to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const query = `
      query {
        items(ids: [${itemId}]) {
          id
          column_values(ids: ["${columnId}"]) {
            id
            text
            value
            ... on FileValue {
              files {
                id
                name
                url
                created_at
              }
            }
          }
        }
      }
    `;

    const response = await mondayApiCall(query);
    
    if (response.data && response.data.items && response.data.items.length > 0) {
      const column = response.data.items[0].column_values[0];
      const parsed = JSON.parse(column.value || '{}');
      
      return {
        appeared: parsed.files && parsed.files.length > 0,
        fileCount: parsed.files ? parsed.files.length : 0,
        files: parsed.files || [],
        columnText: column.text,
        rawValue: column.value
      };
    }
    
    return { appeared: false, error: 'Item or column not found' };

  } catch (error) {
    return { appeared: false, error: error.message };
  }
}

// Analyze the results to identify the issue
function analyzeFileUploadIssues(tests) {
  const analysis = {
    boardBWorks: tests.boardBFileUpload?.success || false,
    boardAWorks: tests.boardAFileUpload?.success || false,
    existingItemHasFiles: false,
    possibleCauses: [],
    likelyIssue: 'unknown'
  };

  // Check if existing item has any files
  if (tests.existingItemCheck?.success) {
    const fileColumns = tests.existingItemCheck.fileColumns || {};
    const hasAnyFiles = Object.values(fileColumns).some(col => col.hasFiles);
    analysis.existingItemHasFiles = hasAnyFiles;
  }

  // Determine likely issues
  if (!analysis.boardBWorks && !analysis.boardAWorks) {
    analysis.possibleCauses.push('API credentials or file upload method broken');
    analysis.likelyIssue = 'api_broken';
  } else if (analysis.boardBWorks && !analysis.boardAWorks) {
    analysis.possibleCauses.push('Board A file columns have different requirements');
    analysis.possibleCauses.push('Board A column IDs incorrect');
    analysis.likelyIssue = 'board_a_specific';
  } else if (!analysis.existingItemHasFiles) {
    analysis.possibleCauses.push('Files uploading but not being saved to items');
    analysis.possibleCauses.push('Column targeting issue');
    analysis.likelyIssue = 'column_targeting';
  }

  return analysis;
}

// Generate debug summary
function generateDebugSummary(debugResults) {
  const analysis = debugResults.analysis;
  
  return {
    overallIssue: analysis.likelyIssue,
    boardBFileUpload: debugResults.tests.boardBFileUpload?.success ? 'WORKING' : 'BROKEN',
    boardAFileUpload: debugResults.tests.boardAFileUpload?.success ? 'WORKING' : 'BROKEN',
    existingFilesFound: analysis.existingItemHasFiles ? 'YES' : 'NO',
    mainIssue: analysis.possibleCauses[0] || 'Unknown issue'
  };
}

// Generate next action recommendations
function generateNextActions(debugResults) {
  const analysis = debugResults.analysis;
  const actions = [];

  if (analysis.likelyIssue === 'board_a_specific') {
    actions.push('Check if Board A file columns require different permissions');
    actions.push('Verify Board A column IDs are exactly correct');
    actions.push('Try uploading to just one Board A column manually');
  } else if (analysis.likelyIssue === 'column_targeting') {
    actions.push('Files may be uploading but not targeting correct columns');
    actions.push('Check Monday.com board directly for orphaned files');
    actions.push('Try alternative file upload method');
  } else {
    actions.push('Debug file upload API method completely');
    actions.push('Check Monday.com API documentation for changes');
  }

  return actions;
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
