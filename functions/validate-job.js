// File: functions/validate-job.js
// FIXED VERSION - Corrected data structure to match frontend expectations
// Added hire start date extraction from Q&H Board

const fetch = require('node-fetch');

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
    
    if (!jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'jobId parameter is required',
          usage: 'GET: ?jobId=99999'
        })
      };
    }

    console.log('Validating job:', jobId);

    // Step 1: Look up job in Monday.com Q&H Board
    const jobLookup = await lookupJobInQHBoard(jobId);
    
    if (!jobLookup.found) {
      console.log('❌ Job not found in Q&H Board');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isValid: false,
          reason: 'Job not found in system',
          message: 'This job number does not exist in our system',
          jobId: jobId
        })
      };
    }

    console.log('✅ Job found in Q&H Board:', jobLookup.job.id);
    console.log('📋 Parsed job data:', jobLookup.job);

    // Step 2: Validate job timing (hire end date + 1 day grace period)
    const timingValidation = validateJobTiming(jobLookup.job.hireEnds, jobLookup.job.hireStarts);
    
    console.log('⏰ Validating job timing...');
    console.log('📅 Job timing check:', timingValidation);

    if (!timingValidation.isValid) {
      console.log('❌ Job has expired');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isValid: false,
          reason: 'Job has expired and is no longer accepting drivers',
          message: `This hire ended on ${jobLookup.job.hireEnds} and is no longer accepting drivers`,
          jobId: jobId,
          job: jobLookup.job
        })
      };
    }

    console.log('✅ Job is valid (within grace period)');

    // Step 3: Return success with proper data structure for frontend
    const response = {
      success: true,
      isValid: true,
      isActive: timingValidation.isActive,
      isWithinGracePeriod: timingValidation.isWithinGracePeriod,
      gracePeriodEnd: timingValidation.gracePeriodEnd,
      reason: timingValidation.isActive ? 'active' : 'grace_period',
      message: timingValidation.isActive ? 
        'Job is active and accepting drivers' : 
        'Job recently ended but still accepting drivers',
      jobId: jobId,
      // FIXED: Frontend expects 'job' not 'jobData'
      job: {
        jobName: jobLookup.job.name,
        summary: jobLookup.job.name,
        contact: jobLookup.job.contact || 'OOOSH Client',
        hireStarts: jobLookup.job.hireStarts,  // ADDED: Hire start date
        hireEnds: jobLookup.job.hireEnds,
        jobNumber: jobLookup.job.jobNumber,
        mondayItemId: jobLookup.job.id
      }
    };

    console.log('Job validation result:', response);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Job validation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Job validation failed',
        details: error.message 
      })
    };
  }
};

// Look up job in Monday.com Q&H Board
async function lookupJobInQHBoard(jobNumber) {
  try {
    console.log('🔍 Looking up job in Q&H Board:', jobNumber);
    
    if (!process.env.MONDAY_API_TOKEN) {
      console.log('⚠️ Monday.com API token not configured');
      return { found: false, error: 'Monday.com API not configured' };
    }

    // Query Monday.com Q&H Board (Board ID: 2431480012)
    const query = `
      query {
        items_page(
          board_ids: [2431480012]
          limit: 50
          query_params: {
            rules: [{
              column_id: "text7"
              compare_value: ["${jobNumber}"]
              operator: any_of
            }]
          }
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

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`Monday.com API error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`Monday.com GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    const items = result.data?.items_page?.items || [];
    
    if (items.length === 0) {
      return { found: false };
    }

    // Parse the first matching item
    const item = items[0];
    const columnValues = item.column_values || [];
    
    // Extract job data from Monday.com columns
    const jobData = {
      id: item.id,
      name: item.name,
      jobNumber: jobNumber
    };

    // Extract column data
    columnValues.forEach(col => {
      switch(col.id) {
        case 'text7': // Job number
          jobData.jobNumber = col.text || jobNumber;
          break;
        case 'date': // ADDED: Hire start date
          if (col.text) {
            jobData.hireStarts = col.text;
          }
          break;
        case 'dup__of_hire_starts': // Hire end date
          if (col.text) {
            jobData.hireEnds = col.text;
          }
          break;
        case 'text0': // Contact/Client name
          if (col.text) {
            jobData.contact = col.text;
          }
          break;
      }
    });

    console.log('📋 Extracted job data:', jobData);

    return {
      found: true,
      job: jobData
    };

  } catch (error) {
    console.error('Error looking up job in Q&H Board:', error);
    return { found: false, error: error.message };
  }
}

// Validate job timing with grace period
function validateJobTiming(hireEndsStr, hireStartsStr) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Parse hire end date
    const hireEnds = new Date(hireEndsStr + 'T23:59:59'); // End of hire day
    
    // Grace period: hire end date + 1 day
    const gracePeriod = new Date(hireEnds);
    gracePeriod.setDate(gracePeriod.getDate() + 1);
    const gracePeriodEnd = gracePeriod.toISOString().split('T')[0];
    
    // Check if job is still active (hire hasn't ended yet)
    const isActive = today <= hireEnds;
    
    // Check if within grace period (hire ended but within 1 day)
    const isWithinGracePeriod = today <= gracePeriod;
    
    return {
      today: todayStr,
      hireStarts: hireStartsStr,
      hireEnds: hireEndsStr,
      gracePeriodEnd: gracePeriodEnd,
      isActive: isActive,
      isWithinGracePeriod: isWithinGracePeriod,
      isValid: isWithinGracePeriod // Overall validity
    };
    
  } catch (error) {
    console.error('Error validating job timing:', error);
    return {
      isActive: false,
      isWithinGracePeriod: false,
      isValid: false,
      error: error.message
    };
  }
}
