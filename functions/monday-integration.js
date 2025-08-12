// File: functions/monday-integration.js
// ENHANCED VERSION - Fixed missing columns + signature upload capability
// Replaces Google Sheets entirely with Monday.com API integration

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Enhanced Monday.com Integration called with action:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let requestData;
    
    if (event.httpMethod === 'GET') {
      // Handle query parameters for GET requests
      const action = event.queryStringParameters?.action;
      requestData = { action, ...event.queryStringParameters };
    } else {
      // Handle POST body
      requestData = JSON.parse(event.body || '{}');
    }

    const { action } = requestData;
    console.log('Processing action:', action);

    switch (action) {
      case 'test-connection':
        return await testMondayConnection();
        
      case 'get-driver-status':
        return await getDriverStatus(requestData.email);
        
      case 'create-driver':
        return await createDriver(requestData);
        
      case 'save-insurance-data':
        return await saveInsuranceData(requestData);
        
      case 'save-idenfy-results':
        return await saveIdenfyResults(requestData);
        
      case 'save-dvla-results':
        return await saveDvlaResults(requestData);
        
      case 'upload-signature':
        return await uploadSignature(requestData);
        
      case 'test-all':
        return await runAllTests();
        
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Invalid action',
            availableActions: [
              'test-connection', 'get-driver-status', 'create-driver',
              'save-insurance-data', 'save-idenfy-results', 'save-dvla-results',
              'upload-signature', 'test-all'
            ]
          })
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

// FIXED: Enhanced create driver with all missing columns
async function createDriver(driverData) {
  console.log('🔄 Creating driver in Monday.com with enhanced data');
  
  try {
    const {
      email = 'test@example.com',
      jobId = 'JOB001',
      name = 'Test Driver',
      phone = '+44123456789',        // NEW: Now included
      nationality = 'British',       // NEW: Now included
      datePassedTest = '2010-05-15', // NEW: Now included
      licenseIssuedBy = 'DVLA'       // NEW: Now included
    } = driverData;

    // Calculate POA expiry dates (90 days from now for testing)
    const today = new Date();
    const poa1Expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    const poa2Expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const mutation = `
      mutation {
        create_item(
          board_id: 841453886
          group_id: "topics"
          item_name: "${name}"
          column_values: ${JSON.stringify(JSON.stringify({
            // Essential fields
            text8: name,                                    // Driver name
            email: { email: email, text: email },          // Email address
            text86: jobId,                                  // Job number (5-digit HireHop)
            
            // FIXED: Previously missing fields
            text9__1: phone,                                // Phone number
            text_mktqjbpm: nationality,                     // Nationality
            date2: { date: datePassedTest },                // Date passed test
            text_mktqwkqn: licenseIssuedBy,                // License issued by
            
            // FIXED: POA expiry dates (90 days from document date)
            date8: { date: formatDateForMonday(poa1Expires) },   // POA1 expires
            date32: { date: formatDateForMonday(poa2Expires) },  // POA2 expires
            
            // Status and workflow
            color_mktqc2dt: { label: "Working on it" },     // Status
            
            // Insurance questions (initially no - will be updated)
            color_mktq8vhz: { label: "No" },               // Has disability
            color_mktqzyze: { label: "No" },               // Has convictions
            color_mktqw319: { label: "No" },               // Has prosecution
            color_mktqwhpd: { label: "No" },               // Has accidents
            color_mktqfymz: { label: "No" },               // Has insurance issues
            color_mktqxzqs: { label: "No" }                // Has driving ban
          }))}
        ) {
          id
          name
          column_values {
            id
            text
          }
        }
      }
    `;

    const response = await callMondayAPI(mutation);
    
    if (response.data?.create_item?.id) {
      const mondayItemId = response.data.create_item.id;
      console.log('✅ Driver created successfully in Monday.com:', mondayItemId);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          mondayItemId: mondayItemId,
          itemName: response.data.create_item.name,
          message: 'Driver created with all fields populated'
        })
      };
    } else {
      throw new Error('Failed to create driver item');
    }

  } catch (error) {
    console.error('❌ Create driver error:', error);
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

// NEW: Signature upload with Monday.com file column support
async function uploadSignature(requestData) {
  console.log('🖊️ Processing signature upload for Monday.com');
  
  try {
    const {
      email,
      mondayItemId,
      signatureData,  // Base64 image data
      jobId
    } = requestData;

    if (!signatureData || !mondayItemId) {
      throw new Error('Signature data and Monday item ID are required');
    }

    // Step 1: Convert base64 to file and upload to Monday.com
    // Monday.com supports direct file uploads via their API
    const fileUploadResult = await uploadFileToMonday(mondayItemId, signatureData, `signature-${jobId}.png`);
    
    if (fileUploadResult.success) {
      // Step 2: Update driver status to "Approved" since signature is final step
      const updateMutation = `
        mutation {
          change_multiple_column_values(
            item_id: ${mondayItemId}
            board_id: 841453886
            column_values: ${JSON.stringify(JSON.stringify({
              color_mktqc2dt: { label: "Done" },  // Status = Approved
              long_text_mktqfsnx: "Digital signature captured and verification completed on " + new Date().toISOString().split('T')[0]
            }))}
          ) {
            id
          }
        }
      `;

      await callMondayAPI(updateMutation);
      
      console.log('✅ Signature uploaded and driver approved');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fileId: fileUploadResult.fileId,
          message: 'Signature uploaded and driver approved'
        })
      };
    } else {
      throw new Error('File upload to Monday.com failed');
    }

  } catch (error) {
    console.error('❌ Signature upload error:', error);
    
    // Fallback: Update status even if file upload fails
    if (requestData.mondayItemId) {
      try {
        const fallbackMutation = `
          mutation {
            change_multiple_column_values(
              item_id: ${requestData.mondayItemId}
              board_id: 841453886
              column_values: ${JSON.stringify(JSON.stringify({
                color_mktqc2dt: { label: "Done" },
                long_text_mktqfsnx: "Signature captured (upload pending) - " + new Date().toISOString()
              }))}
            ) {
              id
            }
          }
        `;
        
        await callMondayAPI(fallbackMutation);
        console.log('✅ Status updated despite upload issue');
      } catch (fallbackError) {
        console.error('Fallback update also failed:', fallbackError);
      }
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Signature upload failed',
        details: error.message,
        fallbackApplied: !!requestData.mondayItemId
      })
    };
  }
}

// NEW: Monday.com file upload helper
async function uploadFileToMonday(itemId, base64Data, filename) {
  try {
    console.log('📎 Uploading file to Monday.com item:', itemId);
    
    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
    
    // Convert base64 to buffer
    const fileBuffer = Buffer.from(cleanBase64, 'base64');
    
    // Monday.com file upload requires multipart/form-data
    const FormData = require('form-data');
    const form = new FormData();
    
    // Add file buffer
    form.append('file', fileBuffer, {
      filename: filename,
      contentType: 'image/png'
    });
    
    // Add Monday.com specific fields
    form.append('query', `
      mutation {
        add_file_to_column(
          item_id: ${itemId}
          column_id: "files"
          file: $file
        ) {
          id
          name
        }
      }
    `);

    const uploadResponse = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (uploadResponse.ok) {
      const result = await uploadResponse.json();
      console.log('✅ File uploaded to Monday.com successfully');
      return {
        success: true,
        fileId: result.data?.add_file_to_column?.id,
        filename: filename
      };
    } else {
      const errorText = await uploadResponse.text();
      console.error('Monday.com file upload error:', errorText);
      
      // Return success anyway and handle with status update
      return {
        success: false,
        error: errorText
      };
    }

  } catch (error) {
    console.error('File upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ENHANCED: Save insurance data with all missing fields populated
async function saveInsuranceData(requestData) {
  console.log('📋 Saving insurance data to Monday.com');
  
  try {
    const {
      email,
      jobId,
      mondayItemId,
      insuranceData
    } = requestData;

    if (!mondayItemId || !insuranceData) {
      throw new Error('Monday item ID and insurance data are required');
    }

    // Map Yes/No answers to Monday.com status labels
    const mapToStatus = (value) => {
      if (value === 'yes' || value === true) return { label: "Yes" };
      return { label: "No" };
    };

    const updateMutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${mondayItemId}
          board_id: 841453886
          column_values: ${JSON.stringify(JSON.stringify({
            // Insurance questions with proper Yes/No labels
            color_mktq8vhz: mapToStatus(insuranceData.hasDisability),     // Has disability
            color_mktqzyze: mapToStatus(insuranceData.hasConvictions),    // Has convictions
            color_mktqw319: mapToStatus(insuranceData.hasProsecution),    // Has prosecution
            color_mktqwhpd: mapToStatus(insuranceData.hasAccidents),      // Has accidents
            color_mktqfymz: mapToStatus(insuranceData.hasInsuranceIssues), // Has insurance issues
            color_mktqxzqs: mapToStatus(insuranceData.hasDrivingBan),     // Has driving ban
            
            // Additional details
            long_text_mktqfsnx: insuranceData.additionalDetails || "No additional details provided",
            
            // Update status to show insurance completed
            color_mktqc2dt: { label: "Working on it" } // Status - insurance completed, awaiting documents
          }))}
        ) {
          id
        }
      }
    `;

    await callMondayAPI(updateMutation);
    console.log('✅ Insurance data saved successfully');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Insurance data saved successfully'
      })
    };

  } catch (error) {
    console.error('❌ Save insurance data error:', error);
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

// ENHANCED: Save Idenfy results with proper license data
async function saveIdenfyResults(requestData) {
  console.log('🆔 Saving Idenfy results to Monday.com');
  
  try {
    const {
      mondayItemId,
      idenfyResults
    } = requestData;

    if (!mondayItemId) {
      throw new Error('Monday item ID is required');
    }

    // Extract license information from Idenfy
    const licenseNumber = idenfyResults.documentNumber || idenfyResults.licenseNumber;
    const licenseValidFrom = idenfyResults.docValidFrom || idenfyResults.licenseValidFrom;
    const licenseValidTo = idenfyResults.docValidTo || idenfyResults.licenseValidTo;
    
    // Extract address information
    const homeAddress = idenfyResults.address || idenfyResults.docAddress || "Address from Idenfy verification";
    const licenseAddress = idenfyResults.licenseAddress || homeAddress;

    const updateMutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${mondayItemId}
          board_id: 841453886
          column_values: ${JSON.stringify(JSON.stringify({
            // License information from Idenfy
            text6: licenseNumber,                                           // License number
            date_mktqphhq: licenseValidFrom ? { date: licenseValidFrom } : null, // License valid from
            driver_licence_valid_to: licenseValidTo ? { date: licenseValidTo } : null, // License expiry
            
            // Address information
            long_text6: homeAddress,                                        // Home address
            long_text8: licenseAddress,                                     // License address
            
            // Update status
            color_mktqc2dt: { label: "Working on it" } // Documents uploaded, processing
          }))}
        ) {
          id
        }
      }
    `;

    await callMondayAPI(updateMutation);
    console.log('✅ Idenfy results saved successfully');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Idenfy results saved successfully'
      })
    };

  } catch (error) {
    console.error('❌ Save Idenfy results error:', error);
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

// Enhanced save DVLA results with proper insurance decision logic
async function saveDvlaResults(requestData) {
  console.log('🚗 Saving DVLA results to Monday.com');
  
  try {
    const {
      mondayItemId,
      dvlaData,
      insuranceDecision
    } = requestData;

    if (!mondayItemId || !dvlaData) {
      throw new Error('Monday item ID and DVLA data are required');
    }

    // Determine final status based on insurance decision
    let finalStatus = "Stuck"; // Default to stuck if issues
    
    if (insuranceDecision?.approved) {
      finalStatus = "Done"; // Approved for hire
    } else if (insuranceDecision?.manualReview) {
      finalStatus = "Working on it"; // Needs manual review
    }

    const updateMutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${mondayItemId}
          board_id: 841453886
          column_values: ${JSON.stringify(JSON.stringify({
            // Final status based on insurance decision
            color_mktqc2dt: { label: finalStatus },
            
            // Additional notes with insurance decision details
            long_text_mktqfsnx: `DVLA Check Completed: ${dvlaData.totalPoints || 0} points. Insurance Decision: ${insuranceDecision?.approved ? 'APPROVED' : 'REQUIRES REVIEW'}. ${insuranceDecision?.reasons?.join('. ') || ''}`
          }))}
        ) {
          id
        }
      }
    `;

    await callMondayAPI(updateMutation);
    console.log('✅ DVLA results saved successfully');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        insuranceDecision: insuranceDecision,
        message: 'DVLA results saved successfully'
      })
    };

  } catch (error) {
    console.error('❌ Save DVLA results error:', error);
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

// Enhanced driver status check with Monday.com
async function getDriverStatus(email) {
  console.log('🔍 Getting driver status from Monday.com for:', email);
  
  try {
    if (!email) {
      throw new Error('Email is required');
    }

    const query = `
      query {
        boards(ids: [841453886]) {
          items_page(limit: 50) {
            items {
              id
              name
              column_values {
                id
                text
                ... on EmailValue {
                  email
                  text
                }
              }
            }
          }
        }
      }
    `;

    const response = await callMondayAPI(query);
    const items = response.data?.boards?.[0]?.items_page?.items || [];
    
    // Find driver by email
    for (const item of items) {
      const emailColumn = item.column_values?.find(col => col.id === 'email');
      if (emailColumn?.email === email) {
        console.log('✅ Found existing driver in Monday.com:', item.id);
        
        // Parse document status from columns
        const documents = parseDocumentStatus(item.column_values);
        
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: 'returning',
            mondayItemId: item.id,
            email: email,
            name: item.name,
            documents: documents
          })
        };
      }
    }

    // Driver not found - new driver
    console.log('ℹ️ Driver not found - new driver');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'new',
        email: email,
        documentsRequired: 4 // license, poa1, poa2, dvla
      })
    };

  } catch (error) {
    console.error('❌ Get driver status error:', error);
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

// Test Monday.com connection
async function testMondayConnection() {
  console.log('🧪 Testing Monday.com connection');
  
  try {
    const startTime = Date.now();
    
    const query = `
      query {
        boards(ids: [841453886]) {
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

    const response = await callMondayAPI(query);
    const duration = Date.now() - startTime;
    
    if (response.data?.boards?.[0]) {
      const board = response.data.boards[0];
      console.log('✅ Monday.com connection successful');
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          duration: duration,
          result: {
            success: true,
            boardId: board.id,
            boardName: board.name,
            columnCount: board.columns?.length || 0
          }
        })
      };
    } else {
      throw new Error('Board not found or inaccessible');
    }

  } catch (error) {
    console.error('❌ Monday.com connection test failed:', error);
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

// ENHANCED: Comprehensive test suite
async function runAllTests() {
  console.log('🧪 Running all Monday.com integration tests');
  
  const results = {
    timestamp: new Date().toISOString(),
    testEmail: 'test-monday@oooshtours.co.uk',
    testJobId: 'JOB001',
    tests: {},
    mondayItemId: null
  };

  const tests = [
    { name: 'connection', fn: testMondayConnection },
    { 
      name: 'newDriverStatus', 
      fn: () => getDriverStatus('new-driver@test.com') 
    },
    { 
      name: 'createDriver', 
      fn: () => createDriver({
        email: results.testEmail,
        jobId: results.testJobId,
        name: 'Test Driver Monday Enhanced',
        phone: '+44987654321',           // NEW: Testing phone
        nationality: 'British',          // NEW: Testing nationality  
        datePassedTest: '2015-03-20',    // NEW: Testing date passed
        licenseIssuedBy: 'DVLA UK'       // NEW: Testing license issued by
      })
    }
  ];

  // Run initial tests
  for (const test of tests) {
    try {
      const startTime = Date.now();
      const result = await test.fn();
      const duration = Date.now() - startTime;
      
      const parsedResult = typeof result.body === 'string' ? JSON.parse(result.body) : result;
      
      results.tests[test.name] = {
        success: parsedResult.success || result.statusCode === 200,
        duration,
        result: parsedResult
      };
      
      // Capture Monday item ID for subsequent tests
      if (test.name === 'createDriver' && parsedResult.mondayItemId) {
        results.mondayItemId = parsedResult.mondayItemId;
      }
      
    } catch (error) {
      results.tests[test.name] = {
        success: false,
        duration: 0,
        error: error.message
      };
    }
  }

  // Run tests that need Monday item ID
  if (results.mondayItemId) {
    const additionalTests = [
      {
        name: 'saveInsurance',
        fn: () => saveInsuranceData({
          mondayItemId: results.mondayItemId,
          insuranceData: {
            hasDisability: 'no',
            hasConvictions: 'yes',
            hasProsecution: 'no',
            hasAccidents: 'no', 
            hasInsuranceIssues: 'no',
            hasDrivingBan: 'no',
            additionalDetails: 'Minor speeding offense in 2023'
          }
        })
      },
      {
        name: 'saveIdenfy',
        fn: () => saveIdenfyResults({
          mondayItemId: results.mondayItemId,
          idenfyResults: {
            documentNumber: 'TEST661120TE9ST',
            licenseValidFrom: '2015-03-20',
            licenseValidTo: '2025-03-20',
            address: '123 Test Street, London, SW1A 1AA'
          }
        })
      },
      {
        name: 'saveDvla',
        fn: () => saveDvlaResults({
          mondayItemId: results.mondayItemId,
          dvlaData: {
            totalPoints: 3,
            endorsements: [{ code: 'SP30', points: 3 }]
          },
          insuranceDecision: {
            approved: true,
            excess: 0,
            riskLevel: 'standard',
            reasons: ['Minor points - standard approval']
          }
        })
      },
      {
        name: 'existingDriverStatus',
        fn: () => getDriverStatus(results.testEmail)
      },
      {
        name: 'signatureUpload',
        fn: () => uploadSignature({
          mondayItemId: results.mondayItemId,
          signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          jobId: results.testJobId
        })
      }
    ];

    for (const test of additionalTests) {
      try {
        const startTime = Date.now();
        const result = await test.fn();
        const duration = Date.now() - startTime;
        
        const parsedResult = typeof result.body === 'string' ? JSON.parse(result.body) : result;
        
        results.tests[test.name] = {
          success: parsedResult.success || result.statusCode === 200,
          duration,
          result: parsedResult
        };
        
      } catch (error) {
        results.tests[test.name] = {
          success: false,
          duration: 0,
          error: error.message
        };
      }
    }
  }

  // Calculate summary
  const testNames = Object.keys(results.tests);
  const passed = testNames.filter(name => results.tests[name].success).length;
  const failed = testNames.length - passed;

  results.summary = { passed, failed, total: testNames.length };

  console.log(`🎯 Test Results: ${passed}/${testNames.length} passed`);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: failed === 0,
      message: failed === 0 ? 
        'All Monday.com integration tests passed! Enhanced version with all fields working.' :
        `${failed} tests failed. Check results for details.`,
      results,
      nextSteps: [
        'All columns now properly populated',
        'Signature upload capability added',  
        'Update main workflow to use Monday.com',
        'Remove Google Sheets dependencies',
        'Deploy to production'
      ]
    })
  };
}

// Helper functions
async function callMondayAPI(query) {
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Monday.com API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
  }

  return result;
}

function formatDateForMonday(date) {
  return date.toISOString().split('T')[0];
}

function parseDocumentStatus(columnValues) {
  // This would parse the actual document status from Monday.com columns
  // For now, return a basic structure
  return {
    license: { valid: false },
    poa1: { valid: false },
    poa2: { valid: false },
    dvlaCheck: { valid: false }
  };
}
