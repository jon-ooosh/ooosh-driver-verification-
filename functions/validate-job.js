// File: functions/validate-job.js
// OOOSH Driver Verification - Job Validation Function
// NEW: Validates job against Monday Q&H Board with +1 day grace period

const fetch = require('node-fetch');

// Monday Q&H Board ID
const QH_BOARD_ID = '2431480012';
const MONDAY_API_URL = 'https://api.monday.com/v2';

exports.handler = async (event, context) => {
  console.log('Job validation function called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const jobId = event.queryStringParameters?.jobId;
    console.log('Validating job:', jobId);

    if (!jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'jobId parameter is required' })
      };
    }

    // Validate job against Monday Q&H Board
    const jobValidation = await validateJobInQHBoard(jobId);
    
    console.log('Job validation result:', jobValidation);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(jobValidation)
    };

  } catch (error) {
    console.error('Job validation error:', error);
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

// Validate job in Monday Q&H Board
async function validateJobInQHBoard(jobId) {
  console.log('🔍 Looking up job in Q&H Board:', jobId);
  
  try {
    // Search for job by job number in text7 column
    const query = `
      query {
        items_page_by_column_values (
          board_id: ${QH_BOARD_ID},
          columns: [
            {
              column_id: "text7",
              column_values: ["${jobId}"]
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
    
    if (!response.data?.items_page_by_column_values?.items?.length) {
      console.log('❌ Job not found in Q&H Board');
      return {
        valid: false,
        reason: 'job_not_found',
        message: 'Job not found in system',
        jobId: jobId
      };
    }

    const jobItem = response.data.items_page_by_column_values.items[0];
    console.log('✅ Job found in Q&H Board:', jobItem.id);

    // Parse job data
    const jobData = parseQHJobData(jobItem);
    
    // Validate job timing with +1 day grace period
    const validationResult = validateJobTiming(jobData, jobId);
    
    return validationResult;

  } catch (error) {
    console.error('Error validating job in Q&H Board:', error);
    return {
      valid: false,
      reason: 'validation_error',
      message: 'Failed to validate job',
      jobId: jobId,
      error: error.message
    };
  }
}

// Parse Q&H Board job data
function parseQHJobData(jobItem) {
  const jobData = {
    id: jobItem.id,
    name: jobItem.name,
    jobNumber: null,
    hireEnds: null
  };

  // Parse column values
  jobItem.column_values.forEach(col => {
    const value = col.value ? JSON.parse(col.value) : null;
    
    switch (col.id) {
      case 'text7': // Job number
        jobData.jobNumber = col.text;
        break;
      case 'dup__of_hire_starts': // Hire ends date
        jobData.hireEnds = value?.date;
        break;
    }
  });

  console.log('📋 Parsed job data:', jobData);
  return jobData;
}

// Validate job timing with grace period
function validateJobTiming(jobData, requestedJobId) {
  console.log('⏰ Validating job timing...');
  
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // Check if we have the hire end date
  if (!jobData.hireEnds) {
    console.log('⚠️ No hire end date found');
    return {
      valid: false,
      reason: 'missing_end_date',
      message: 'Job end date not found',
      jobId: requestedJobId,
      jobData: jobData
    };
  }

  // Calculate grace period (hire end date + 1 day)
  const hireEndDate = new Date(jobData.hireEnds);
  const gracePeriodEnd = new Date(hireEndDate.getTime() + 24 * 60 * 60 * 1000); // +1 day
  const gracePeriodEndStr = gracePeriodEnd.toISOString().split('T')[0];
  
  console.log('📅 Job timing check:', {
    today: todayStr,
    hireEnds: jobData.hireEnds,
    gracePeriodEnd: gracePeriodEndStr,
    isValid: today <= gracePeriodEnd
  });

  // Check if job is still valid (today <= hire end + 1 day)
  if (today <= gracePeriodEnd) {
    console.log('✅ Job is valid (within grace period)');
    return {
      valid: true,
      reason: 'active',
      message: 'Job is active and accepting drivers',
      jobId: requestedJobId,
      jobData: {
        name: jobData.name,
        jobNumber: jobData.jobNumber,
        hireEnds: jobData.hireEnds,
        gracePeriodEnd: gracePeriodEndStr
      }
    };
  } else {
    console.log('❌ Job has expired (beyond grace period)');
    return {
      valid: false,
      reason: 'job_expired',
      message: 'This hire has ended and is no longer accepting drivers',
      jobId: requestedJobId,
      jobData: {
        name: jobData.name,
        jobNumber: jobData.jobNumber,
        hireEnds: jobData.hireEnds,
        gracePeriodEnd: gracePeriodEndStr,
        daysExpired: Math.ceil((today - gracePeriodEnd) / (24 * 60 * 60 * 1000))
      }
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
