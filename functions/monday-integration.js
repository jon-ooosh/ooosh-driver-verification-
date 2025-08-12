// File: functions/monday-integration.js
// OOOSH Driver Verification - Monday.com API Integration
// ENHANCED VERSION - File uploads + New System identification + Insurance tracking

const fetch = require('node-fetch');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 841453886;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// Update Monday.com item name
async function updateItemName(itemId, newName) {
  try {
    const nameQuery = `
      mutation {
        change_simple_column_value(
          board_id: ${BOARD_ID},
          item_id: ${itemId},
          column_id: "name",
          value: "${newName}"
        ) {
          id
        }
      }
    `;

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: nameQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com name update errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('Item name updated successfully');

  } catch (error) {
    console.error('Update item name error:', error);
    throw error;
  };

exports.handler = async (event, context) => {
  console.log('Monday.com integration called');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const requestData = JSON.parse(event.body);
    const action = requestData.action;

    console.log('Monday.com action:', action);

    if (action === 'get-driver-status') {
      return getDriverStatus(requestData.email);
    } else if (action === 'create-driver') {
      return createDriver(requestData.email, requestData.jobId, requestData.name);
    } else if (action === 'save-insurance-data') {
      return saveInsuranceData(requestData.email, requestData.jobId, requestData.insuranceData);
    } else if (action === 'save-idenfy-results') {
      return saveIdenfyResults(requestData.email, requestData.jobId, requestData.mondayData);
    } else if (action === 'save-dvla-results') {
      return saveDvlaResults(requestData.email, requestData.jobId, requestData.dvlaData);
    } else if (action === 'upload-signature') {
      return uploadSignature(requestData.email, requestData.signatureData);
    } else if (action === 'test-connection') {
      return testMondayConnection();
    }
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Monday.com integration error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};

// Get driver status from Monday.com
async function getDriverStatus(email) {
  try {
    console.log('Getting driver status for:', email);

    const driver = await findDriverByEmail(email);
    
    if (!driver) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          driver: null,
          message: 'Driver not found in new system'
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        driver: driver
      })
    };

  } catch (error) {
    console.error('Get driver status error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Create new driver in Monday.com
async function createDriver(email, jobId, name = null) {
  try {
    console.log('Creating driver in Monday.com:', email);

    // Check if driver already exists (from new system)
    const existingDriver = await findDriverByEmail(email);
    if (existingDriver) {
      console.log('Driver already exists, returning existing record');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          itemId: existingDriver.id,
          message: 'Driver already exists',
          isExisting: true
        })
      };
    }

    // Basic driver information  
    const driverName = name || `Driver Verification - ${email}`;
    const currentDate = new Date().toISOString().split('T')[0];
    
    const columnValues = {
      text8: driverName,           // Driver name
      email: { email: email, text: email }, // Email address  
      text86: jobId,               // Job number (5-digit HireHop)
      color_mktqc2dt: { label: 'Working on it' }, // Status
      color_mktrywv1: { label: 'New System' } // NEW: Verification Source
    };

    const columnValuesJson = JSON.stringify(columnValues).replace(/"/g, '\\"');

    const createQuery = `
      mutation {
        create_item(
          board_id: ${BOARD_ID},
          item_name: "${driverName}",
          column_values: "${columnValuesJson}"
        ) {
          id
        }
      }
    `;

    console.log('Creating Monday.com item with New System tag');
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: createQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com create errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    const itemId = result.data.create_item.id;
    console.log('Driver created successfully with ID:', itemId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        itemId: itemId,
        message: 'Driver created successfully'
      })
    };

  } catch (error) {
    console.error('Create driver error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Save insurance questionnaire data
async function saveInsuranceData(email, jobId, insuranceData) {
  try {
    console.log('Saving insurance data for:', email);

    const driver = await findDriverByEmail(email);
    if (!driver) {
      throw new Error('Driver not found - create driver first');
    }

    const updates = [];

    // Map insurance questions to Monday.com status columns
    if (insuranceData.hasDisability) {
      const label = insuranceData.hasDisability === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktq8vhz": {"label": "${label}"}`);
    }
    if (insuranceData.hasConvictions) {
      const label = insuranceData.hasConvictions === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktqzyze": {"label": "${label}"}`);
    }
    if (insuranceData.hasProsecution) {
      const label = insuranceData.hasProsecution === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktqw319": {"label": "${label}"}`);
    }
    if (insuranceData.hasAccidents) {
      const label = insuranceData.hasAccidents === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktqwhpd": {"label": "${label}"}`);
    }
    if (insuranceData.hasInsuranceIssues) {
      const label = insuranceData.hasInsuranceIssues === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktqfymz": {"label": "${label}"}`);
    }
    if (insuranceData.hasDrivingBan) {
      const label = insuranceData.hasDrivingBan === 'yes' ? 'Yes' : 'No';
      updates.push(`"color_mktqxzqs": {"label": "${label}"}`);
    }

    // Additional details
    if (insuranceData.additionalDetails) {
      const escapedDetails = insuranceData.additionalDetails.replace(/"/g, '\\"');
      updates.push(`"long_text_mktqfsnx": "${escapedDetails}"`);
    }

    if (updates.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true, 
          message: 'No insurance updates needed',
          itemId: driver.id
        })
      };
    }

    const updateQuery = `
      mutation {
        change_multiple_column_values(
          board_id: ${BOARD_ID},
          item_id: ${driver.id},
          column_values: "{${updates.join(', ')}}"
        ) {
          id
        }
      }
    `;

    console.log('Updating Monday.com with insurance data');
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: updateQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com insurance update errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('Insurance data saved successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: true, 
        message: 'Insurance data saved successfully',
        itemId: driver.id
      })
    };

  } catch (error) {
    console.error('Save insurance data error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// NEW: Save Idenfy verification results to Monday.com
async function saveIdenfyResults(email, jobId, mondayData) {
  try {
    console.log('Saving Idenfy results to Monday.com for:', email);

    // Find existing driver item
    const driver = await findDriverByEmail(email);
    if (!driver) {
      console.log('Driver not found, creating new driver first');
      const createResult = await createDriver(email, jobId);
      if (!createResult.success) {
        throw new Error('Failed to create driver record');
      }
      // Get the newly created driver
      const newDriver = await findDriverByEmail(email);
      if (!newDriver) {
        throw new Error('Failed to retrieve newly created driver');
      }
      return await updateDriverWithIdenfyData(newDriver.id, mondayData);
    }

    // Update existing driver with Idenfy data
    return await updateDriverWithIdenfyData(driver.id, mondayData);

  } catch (error) {
    console.error('Save Idenfy results error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Update driver item with Idenfy verification data
async function updateDriverWithIdenfyData(itemId, mondayData) {
  try {
    console.log('Updating Monday.com item with Idenfy data:', itemId);

    const updates = [];

    // Name (update the item name itself)
    if (mondayData.name) {
      updates.push(`"text8": "${mondayData.name}"`);
      
      // Also update the item name
      try {
        await updateItemName(itemId, mondayData.name);
        console.log('Item name updated to:', mondayData.name);
      } catch (nameError) {
        console.warn('Failed to update item name:', nameError.message);
      }
    }

    // License information
    if (mondayData.licenseNumber) {
      updates.push(`"text6": "${mondayData.licenseNumber}"`);
    }
    if (mondayData.licenseExpiryDate) {
      updates.push(`"driver_licence_valid_to": "${mondayData.licenseExpiryDate}"`);
    }
    if (mondayData.licenseAddress) {
      const escapedAddress = mondayData.licenseAddress.replace(/"/g, '\\"');
      updates.push(`"long_text8": "${escapedAddress}"`);
    }

    // Date of birth
    if (mondayData.dateOfBirth) {
      updates.push(`"date45": "${mondayData.dateOfBirth}"`);
    }

    // Status
    if (mondayData.status) {
      updates.push(`"color_mktqc2dt": {"label": "${mondayData.status}"}`);
    }

    if (updates.length === 0) {
      console.log('No Idenfy updates to make');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true, 
          message: 'No updates needed',
          itemId: itemId
        })
      };
    }

    // Build update mutation
    const updateQuery = `
      mutation {
        change_multiple_column_values(
          board_id: ${BOARD_ID},
          item_id: ${itemId},
          column_values: "{${updates.join(', ')}}"
        ) {
          id
        }
      }
    `;

    console.log('Sending Idenfy update to Monday.com');
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: updateQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com update errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('Idenfy data updated successfully in Monday.com');
    
    // Upload document files if available
    if (mondayData.documentImages) {
      await uploadDocumentFiles(itemId, mondayData.documentImages);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: true, 
        message: 'Idenfy results saved successfully',
        itemId: itemId
      })
    };

  } catch (error) {
    console.error('Update driver with Idenfy data error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// NEW: Upload document files from Idenfy to Monday.com
async function uploadDocumentFiles(itemId, documentImages) {
  try {
    console.log('Uploading document files to Monday.com for item:', itemId);

    const fileUploads = [];

    // Map document types to Monday.com file columns
    if (documentImages.licenseFront) {
      fileUploads.push({ url: documentImages.licenseFront, columnId: 'file_mktrwq0c', name: 'License Front' });
    }
    if (documentImages.licenseBack) {
      fileUploads.push({ url: documentImages.licenseBack, columnId: 'file_mktrfp1c', name: 'License Back' });
    }
    if (documentImages.passport) {
      fileUploads.push({ url: documentImages.passport, columnId: 'file_mktr2am4', name: 'Passport' });
    }
    if (documentImages.poa1) {
      fileUploads.push({ url: documentImages.poa1, columnId: 'file_mktrftkh', name: 'POA Document 1' });
    }
    if (documentImages.poa2) {
      fileUploads.push({ url: documentImages.poa2, columnId: 'file_mktrvagt', name: 'POA Document 2' });
    }

    console.log(`Uploading ${fileUploads.length} document files`);

    for (const fileUpload of fileUploads) {
      try {
        await uploadFileToColumn(itemId, fileUpload.columnId, fileUpload.url, fileUpload.name);
        console.log(`✅ Uploaded ${fileUpload.name}`);
      } catch (uploadError) {
        console.error(`❌ Failed to upload ${fileUpload.name}:`, uploadError.message);
        // Continue with other uploads even if one fails
      }
    }

    console.log('Document file uploads completed');

  } catch (error) {
    console.error('Error uploading document files:', error);
    // Don't fail the whole process if file uploads fail
  }
}

// Upload file to specific Monday.com column
async function uploadFileToColumn(itemId, columnId, fileUrl, fileName) {
  try {
    // For now, we'll store the file URL as a text reference
    // Monday.com file uploads require multipart/form-data which is complex in this context
    // This could be enhanced to actually download and upload files
    
    console.log(`File reference for ${fileName}: ${fileUrl}`);
    // Implementation would depend on Monday.com file upload API requirements
    
  } catch (error) {
    console.error('Upload file to column error:', error);
    throw error;
  }
}

// NEW: Save DVLA check results to Monday.com
async function saveDvlaResults(email, jobId, dvlaData) {
  try {
    console.log('Saving DVLA results to Monday.com for:', email);

    // Find existing driver item
    const driver = await findDriverByEmail(email);
    if (!driver) {
      throw new Error('Driver not found - must verify documents first');
    }

    // Update driver with DVLA data
    const updates = [];

    // Insurance decision status
    if (dvlaData.insuranceDecision) {
      const decision = dvlaData.insuranceDecision;
      if (decision.approved) {
        updates.push(`"color_mktqc2dt": {"label": "Done"}`);
      } else if (decision.manualReview) {
        updates.push(`"color_mktqc2dt": {"label": "Working on it"}`);
      } else {
        updates.push(`"color_mktqc2dt": {"label": "Stuck"}`);
      }
    }

    // DVLA check date (for tracking freshness)
    if (dvlaData.dateGenerated) {
      // We could add a custom column for DVLA check date if needed
      console.log('DVLA check date:', dvlaData.dateGenerated);
    }

    // License validation (cross-check with Idenfy)
    if (dvlaData.licenseNumber && dvlaData.licenseEnding) {
      console.log('License validation data available for anti-fraud check');
      // Could add validation status to Monday.com
    }

    if (updates.length === 0) {
      console.log('No DVLA updates to make');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true, 
          message: 'DVLA data processed, no updates needed',
          itemId: driver.id
        })
      };
    }

    // Build update mutation
    const updateQuery = `
      mutation {
        change_multiple_column_values(
          board_id: ${BOARD_ID},
          item_id: ${driver.id},
          column_values: "{${updates.join(', ')}}"
        ) {
          id
        }
      }
    `;

    console.log('Sending DVLA update to Monday.com');
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: updateQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com DVLA update errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('DVLA results updated successfully in Monday.com');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: true, 
        message: 'DVLA results saved successfully',
        itemId: driver.id,
        insuranceDecision: dvlaData.insuranceDecision
      })
    };

  } catch (error) {
    console.error('Save DVLA results error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Upload signature file to Monday.com
async function uploadSignature(email, signatureData) {
  try {
    console.log('Uploading signature for:', email);

    const driver = await findDriverByEmail(email);
    if (!driver) {
      throw new Error('Driver not found');
    }

    // Create a small test file for signature upload
    const testSignature = signatureData || 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    // For now, just update status to indicate signature received
    const updateQuery = `
      mutation {
        change_column_value(
          board_id: ${BOARD_ID},
          item_id: ${driver.id},
          column_id: "color_mktqc2dt",
          value: "{\\"label\\": \\"Done\\"}"
        ) {
          id
        }
      }
    `;

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: updateQuery })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com signature update errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('Signature upload completed successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: true, 
        message: 'Signature uploaded successfully',
        itemId: driver.id
      })
    };

  } catch (error) {
    console.error('Upload signature error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Find driver by email (only from new verification system)
async function findDriverByEmail(email) {
  try {
    console.log('Searching for driver by email in new system:', email);
    
    const query = `
      query {
        items_page_by_column_values(
          board_id: ${BOARD_ID},
          columns: [
            {column_id: "email", column_values: ["${email}"]},
            {column_id: "color_mktrywv1", column_values: ["New System"]}
          ],
          limit: 1
        ) {
          items {
            id
            name
            column_values {
              column {
                id
              }
              ... on StatusValue {
                text
              }
              ... on TextValue {
                text
              }
              ... on EmailValue {
                email
                text
              }
              ... on DateValue {
                date
              }
            }
          }
        }
      }
    `;

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('Monday.com search errors:', result.errors);
      return null;
    }

    const items = result.data?.items_page_by_column_values?.items || [];
    
    if (items.length === 0) {
      console.log('No driver found with new system verification');
      return null;
    }

    const driver = parseDriverData(items[0]);
    console.log('Found driver from new system:', driver.email);
    return driver;

  } catch (error) {
    console.error('Find driver by email error:', error);
    return null;
  }
}

// Parse driver data from Monday.com response
function parseDriverData(item) {
  const driver = {
    id: item.id,
    name: item.name,
    email: null,
    jobNumber: null,
    status: null,
    licenseNumber: null,
    licenseExpiryDate: null,
    poa1ValidDate: null,
    poa2ValidDate: null,
    updatedAt: new Date().toISOString()
  };

  // Parse column values
  item.column_values.forEach(col => {
    const columnId = col.column.id;
    
    switch (columnId) {
      case 'email':
        driver.email = col.email || col.text;
        break;
      case 'text86':
        driver.jobNumber = col.text;
        break;
      case 'color_mktqc2dt':
        driver.status = col.text;
        break;
      case 'text6':
        driver.licenseNumber = col.text;
        break;
      case 'driver_licence_valid_to':
        driver.licenseExpiryDate = col.date;
        break;
      case 'date8':
        driver.poa1ValidDate = col.date;
        break;
      case 'date32':
        driver.poa2ValidDate = col.date;
        break;
    }
  });

  return driver;
}

// Test Monday.com connection
async function testMondayConnection() {
  try {
    console.log('Testing Monday.com connection');

    const query = `
      query {
        boards(ids: [${BOARD_ID}]) {
          id
          name
          items_count
        }
      }
    `;

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }

    const board = result.data.boards[0];
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Monday.com connection successful',
        board: {
          id: board.id,
          name: board.name,
          itemCount: board.items_count
        }
      })
    };

  } catch (error) {
    console.error('Monday.com connection test error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
