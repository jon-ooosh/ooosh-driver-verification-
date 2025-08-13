// File: functions/validate-job.js
// REVERTED TO ORIGINAL WORKING VERSION - Just fixed response structure for frontend

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

    // Step 1: Look up job in Monday.com Q&H Board (ORIGINAL WORKING VERSION)
    const jobLookup = await lookupJobInQHBoard(jobId);
    
    if (!jobLookup.found) {
      console.log('❌ Job not found in Q&H Board');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isValid: false,
          reason: 'job_not_found',
          message: 'Job not found in system',
          jobId: jobId
        })
      };
    }

    console.log('✅ Job found in Q&H Board:', jobLookup.job.id);
    console.log('📋 Parsed job data:', jobLookup.job);

    // Step 2: Validate job timing (ORIGINAL WORKING VERSION)
    const today = new Date().toISOString().split('T')[0];
    const hireEnds = jobLookup.job.hireEnds;
    const gracePeriodDate = new Date(hireEnds + 'T00:00:00');
    gracePeriodDate.setDate(gracePeriodDate.getDate() + 1);
    const gracePeriodEnd = gracePeriodDate.toISOString().split('T')[0];
    
    const isActive = today <= hireEnds;
    const isWithinGracePeriod = today <= gracePeriodEnd;
    const isValid = isWithinGracePeriod;

    console.log('⏰ Validating job timing...');
    console.log('📅 Job timing check:', {
      today,
      hireEnds,
      gracePeriodEnd,
      isValid
    });

    if (!isValid) {
      console.log('❌ Job has expired');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isValid: false,
          reason: 'Job has expired and is no longer accepting drivers',
          message: `This hire ended on ${hireEnds} and is no longer accepting drivers`,
          jobId: jobId
        })
      };
    }

    console.log('✅ Job is valid (within grace period)');

    // Step 3: Return success with FIXED response structure for frontend
    const response = {
      success: true,
      isValid: true,
      isActive: isActive,
      isWithinGracePeriod: isWithinGracePeriod,
      gracePeriodEnd: gracePeriodEnd,
      reason: isActive ? 'active' : 'grace_period',
      message: isActive ? 'Job is active and accepting drivers' : 'Job recently ended but still accepting drivers',
      jobId: jobId,
      // FIXED: Frontend expects 'job' object with these fields
      job: {
        jobName: 'Driver Verification',
        summary: 'Driver Verification', 
        contact: 'OOOSH Client',
        hireStarts: jobLookup.job.hireStarts || hireEnds, // Fallback if start date missing
        hireEnds: jobLookup.job.hireEnds,
        jobNumber: jobLookup.job.jobNumber
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

// ORIGINAL WORKING VERSION - Don't change this!
async function lookupJobInQHBoard(jobNumber) {
  try {
    console.log('🔍 Looking up job in Q&H Board:', jobNumber);
    
    if (!process.env.MONDAY_API_TOKEN) {
      console.log('⚠️ Monday.com API token not configured');
      return { found: false, error: 'Monday.com API not configured' };
    }

    // Original working GraphQL query
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

    // Parse the first matching item (original working logic)
    const item = items[0];
    const columnValues = item.column_values || [];
    
    const jobData = {
      id: item.id,
      name: item.name,
      jobNumber: jobNumber
    };

    // Extract column data (original working logic)
    columnValues.forEach(col => {
      switch(col.id) {
        case 'text7':
          jobData.jobNumber = col.text || jobNumber;
          break;
        case 'date': // Hire start date
          if (col.text) {
            jobData.hireStarts = col.text;
          }
          break;
        case 'dup__of_hire_starts': // Hire end date  
          if (col.text) {
            jobData.hireEnds = col.text;
          }
          break;
        case 'text0': // Contact
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
