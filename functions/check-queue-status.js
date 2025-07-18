// File: functions/check-queue-status.js
// Allows users to check the status of their queued documents

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Queue status checker called');
  
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
    let email, jobId;
    
    if (event.httpMethod === 'GET') {
      // Get from query parameters
      email = event.queryStringParameters?.email;
      jobId = event.queryStringParameters?.jobId;
    } else if (event.httpMethod === 'POST') {
      // Get from POST body
      const body = JSON.parse(event.body);
      email = body.email;
      jobId = body.jobId;
    } else {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Email and jobId are required',
          usage: 'GET: ?email=user@example.com&jobId=JOB001 or POST: {"email":"user@example.com","jobId":"JOB001"}'
        })
      };
    }

    console.log(`Checking queue status for: ${email}, job: ${jobId}`);

    // Get queue status from Google Apps Script
    const queueStatus = await getQueueStatus(email, jobId);
    
    // Get driver status for context
    const driverStatus = await getDriverStatus(email);
    
    // Combine the information
    const response = {
      success: true,
      email,
      jobId,
      timestamp: new Date().toISOString(),
      queue: queueStatus,
      driver: driverStatus,
      summary: generateStatusSummary(queueStatus, driverStatus),
      nextActions: generateNextActions(queueStatus, driverStatus)
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Queue status check error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to check queue status',
        details: error.message 
      })
    };
  }
};

// Get queue status from Google Apps Script
async function getQueueStatus(email, jobId) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return {
        totalItems: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        items: [],
        message: 'Queue system not configured'
      };
    }

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'get-queue-status',
        email: email,
        jobId: jobId
      })
    });

    if (response.ok) {
      const result = await response.json();
      return result.status;
    } else {
      console.error('Failed to get queue status');
      return {
        totalItems: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        items: [],
        error: 'Failed to retrieve queue status'
      };
    }

  } catch (error) {
    console.error('Error getting queue status:', error);
    return {
      totalItems: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      items: [],
      error: error.message
    };
  }
}

// Get driver status
async function getDriverStatus(email) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return { status: 'unknown', message: 'System not configured' };
    }

    const response = await fetch(`${process.env.GOOGLE_APPS_SCRIPT_URL}?action=get-driver-status&email=${encodeURIComponent(email)}`);
    
    if (response.ok) {
      const result = await response.json();
      return result;
    } else {
      console.error('Failed to get driver status');
      return { status: 'unknown', error: 'Failed to retrieve driver status' };
    }

  } catch (error) {
    console.error('Error getting driver status:', error);
    return { status: 'unknown', error: error.message };
  }
}

// Generate status summary
function generateStatusSummary(queueStatus, driverStatus) {
  const summary = {
    overallStatus: 'unknown',
    message: '',
    urgentAction: false,
    estimatedCompletion: null
  };

  // Analyze queue status
  if (queueStatus.totalItems === 0) {
    summary.overallStatus = 'no_queue_items';
    summary.message = 'No documents currently in processing queue';
  } else if (queueStatus.failed > 0) {
    summary.overallStatus = 'attention_required';
    summary.message = `${queueStatus.failed} document(s) failed processing and require attention`;
    summary.urgentAction = true;
  } else if (queueStatus.processing > 0) {
    summary.overallStatus = 'processing';
    summary.message = `${queueStatus.processing} document(s) currently being processed`;
    summary.estimatedCompletion = 'Within 15 minutes';
  } else if (queueStatus.queued > 0) {
    summary.overallStatus = 'queued';
    summary.message = `${queueStatus.queued} document(s) queued for processing`;
    summary.estimatedCompletion = 'Within 1 hour during off-peak hours (3am-6am)';
  } else if (queueStatus.completed > 0) {
    summary.overallStatus = 'completed';
    summary.message = `${queueStatus.completed} document(s) processed successfully`;
  }

  // Consider driver status
  if (driverStatus.status === 'verified') {
    summary.overallStatus = 'verified';
    summary.message = 'Driver verification complete';
  } else if (driverStatus.status === 'rejected') {
    summary.overallStatus = 'rejected';
    summary.message = 'Driver verification rejected';
    summary.urgentAction = true;
  }

  return summary;
}

// Generate next actions
function generateNextActions(queueStatus, driverStatus) {
  const actions = [];

  if (queueStatus.failed > 0) {
    actions.push({
      action: 'contact_support',
      message: 'Contact support about failed document processing',
      priority: 'high',
      contact: '+44 123 456 7890'
    });
  }

  if (queueStatus.queued > 0) {
    actions.push({
      action: 'wait',
      message: 'Wait for automatic processing during off-peak hours',
      priority: 'normal',
      expectedTime: '3am-6am UK time'
    });
  }

  if (queueStatus.processing > 0) {
    actions.push({
      action: 'check_back',
      message: 'Check back in 15 minutes for processing results',
      priority: 'normal',
      expectedTime: '15 minutes'
    });
  }

  if (queueStatus.totalItems === 0 && driverStatus.status !== 'verified') {
    actions.push({
      action: 'upload_documents',
      message: 'Upload required documents to complete verification',
      priority: 'high',
      url: 'https://ooosh-driver-verification.netlify.app/'
    });
  }

  if (driverStatus.status === 'verified') {
    actions.push({
      action: 'ready_for_hire',
      message: 'Verification complete - ready for hire assignment',
      priority: 'normal'
    });
  }

  return actions;
}

// Export for testing
module.exports = {
  handler: exports.handler,
  getQueueStatus,
  getDriverStatus,
  generateStatusSummary,
  generateNextActions
};
