// File: functions/queue-manager.js
// Production Queue System for handling Claude 529 errors
// Implements background processing and retry logic

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Queue Manager called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { action, ...params } = JSON.parse(event.body);
    
    switch (action) {
      case 'add-to-queue':
        return await addToQueue(params);
      case 'process-queue':
        return await processQueue();
      case 'get-queue-status':
        return await getQueueStatus(params.email, params.jobId);
      case 'retry-failed':
        return await retryFailedJobs();
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }

  } catch (error) {
    console.error('Queue manager error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Queue manager failed',
        details: error.message 
      })
    };
  }
};

// Add a job to the processing queue
async function addToQueue({ email, jobId, documentType, documentData, priority = 'normal' }) {
  try {
    console.log(`Adding to queue: ${email}, ${jobId}, ${documentType}`);
    
    const queueItem = {
      id: generateQueueId(),
      email,
      jobId,
      documentType, // 'poa' or 'dvla'
      documentData,
      priority,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      lastAttempt: null,
      error: null,
      result: null
    };

    // Save to Google Sheets queue
    await saveToQueue(queueItem);
    
    // Try immediate processing (if Claude is available)
    const immediateResult = await attemptImmediateProcessing(queueItem);
    
    if (immediateResult.success) {
      console.log('✅ Immediate processing successful');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          immediate: true,
          result: immediateResult.data,
          message: 'Document processed immediately'
        })
      };
    } else {
      console.log('⏳ Added to background queue for processing');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          immediate: false,
          queueId: queueItem.id,
          message: 'Document added to processing queue',
          expectedProcessing: 'Within 1 hour during off-peak hours'
        })
      };
    }

  } catch (error) {
    console.error('Add to queue error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to add to queue',
        details: error.message 
      })
    };
  }
}

// Process the queue (called by scheduled function)
async function processQueue() {
  try {
    console.log('🔄 Processing queue...');
    
    // Get all queued items
    const queueItems = await getQueueItems();
    console.log(`Found ${queueItems.length} items in queue`);
    
    if (queueItems.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          processed: 0,
          message: 'Queue is empty'
        })
      };
    }

    // Process items in priority order
    const priorityOrder = ['urgent', 'high', 'normal', 'low'];
    queueItems.sort((a, b) => {
      const aPriority = priorityOrder.indexOf(a.priority);
      const bPriority = priorityOrder.indexOf(b.priority);
      return aPriority - bPriority;
    });

    let processed = 0;
    let failed = 0;
    
    for (const item of queueItems) {
      try {
        console.log(`Processing queue item: ${item.id}`);
        
        const result = await processQueueItem(item);
        
        if (result.success) {
          processed++;
          console.log(`✅ Successfully processed item ${item.id}`);
          
          // Send completion notification
          await sendCompletionNotification(item, result.data);
        } else {
          failed++;
          console.log(`❌ Failed to process item ${item.id}: ${result.error}`);
        }
        
        // Small delay to avoid overwhelming Claude API
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error processing item ${item.id}:`, error);
        failed++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed,
        failed,
        total: queueItems.length,
        message: `Processed ${processed}/${queueItems.length} queue items`
      })
    };

  } catch (error) {
    console.error('Process queue error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process queue',
        details: error.message 
      })
    };
  }
}

// Get queue status for a specific job
async function getQueueStatus(email, jobId) {
  try {
    const queueItems = await getQueueItems();
    const userItems = queueItems.filter(item => 
      item.email === email && item.jobId === jobId
    );

    const status = {
      totalItems: userItems.length,
      queued: userItems.filter(item => item.status === 'queued').length,
      processing: userItems.filter(item => item.status === 'processing').length,
      completed: userItems.filter(item => item.status === 'completed').length,
      failed: userItems.filter(item => item.status === 'failed').length,
      items: userItems
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        status,
        message: 'Queue status retrieved'
      })
    };

  } catch (error) {
    console.error('Get queue status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get queue status',
        details: error.message 
      })
    };
  }
}

// Attempt immediate processing
async function attemptImmediateProcessing(queueItem) {
  try {
    console.log(`Attempting immediate processing for ${queueItem.id}`);
    
    // Update status to processing
    await updateQueueItem(queueItem.id, {
      status: 'processing',
      lastAttempt: new Date().toISOString(),
      attempts: queueItem.attempts + 1
    });

    // Call the appropriate processing function
    let result;
    if (queueItem.documentType === 'poa') {
      result = await processPoaDocument(queueItem.documentData);
    } else if (queueItem.documentType === 'dvla') {
      result = await processDvlaDocument(queueItem.documentData);
    } else {
      throw new Error(`Unknown document type: ${queueItem.documentType}`);
    }

    // Update with successful result
    await updateQueueItem(queueItem.id, {
      status: 'completed',
      result: result,
      error: null
    });

    return { success: true, data: result };

  } catch (error) {
    console.error('Immediate processing failed:', error);
    
    // Check if it's a 529 error (Claude overloaded)
    if (error.message.includes('529') || error.message.includes('overloaded')) {
      console.log('Claude overloaded - leaving in queue for background processing');
      
      await updateQueueItem(queueItem.id, {
        status: 'queued',
        error: 'Claude API overloaded - queued for background processing'
      });
      
      return { success: false, error: 'Claude overloaded', queued: true };
    } else {
      // Other error - mark as failed
      await updateQueueItem(queueItem.id, {
        status: 'failed',
        error: error.message
      });
      
      return { success: false, error: error.message, queued: false };
    }
  }
}

// Process a single queue item
async function processQueueItem(item) {
  try {
    console.log(`Processing item ${item.id}: ${item.documentType}`);
    
    // Check if already processed
    if (item.status === 'completed') {
      console.log(`Item ${item.id} already completed`);
      return { success: true, data: item.result };
    }

    // Check attempt limits
    if (item.attempts >= item.maxAttempts) {
      console.log(`Item ${item.id} exceeded max attempts`);
      await updateQueueItem(item.id, {
        status: 'failed',
        error: 'Maximum attempts exceeded'
      });
      return { success: false, error: 'Maximum attempts exceeded' };
    }

    // Update status
    await updateQueueItem(item.id, {
      status: 'processing',
      lastAttempt: new Date().toISOString(),
      attempts: item.attempts + 1
    });

    // Process the document
    let result;
    if (item.documentType === 'poa') {
      result = await processPoaDocument(item.documentData);
    } else if (item.documentType === 'dvla') {
      result = await processDvlaDocument(item.documentData);
    } else {
      throw new Error(`Unknown document type: ${item.documentType}`);
    }

    // Update with success
    await updateQueueItem(item.id, {
      status: 'completed',
      result: result,
      error: null
    });

    return { success: true, data: result };

  } catch (error) {
    console.error(`Processing item ${item.id} failed:`, error);
    
    // Update with failure
    await updateQueueItem(item.id, {
      status: 'failed',
      error: error.message
    });

    return { success: false, error: error.message };
  }
}

// Process POA document (calls existing function)
async function processPoaDocument(documentData) {
  console.log('Processing POA document via queue');
  
  // Call our existing test-claude-ocr function
  const response = await fetch(`${process.env.URL}/.netlify/functions/test-claude-ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      testType: 'poa',
      imageData: documentData.imageData,
      licenseAddress: documentData.licenseAddress,
      fileType: documentData.fileType || 'image'
    })
  });

  if (!response.ok) {
    throw new Error(`POA processing failed: ${response.status}`);
  }

  const result = await response.json();
  return result.result;
}

// Process DVLA document (calls existing function)
async function processDvlaDocument(documentData) {
  console.log('Processing DVLA document via queue');
  
  // Call our existing test-claude-ocr function
  const response = await fetch(`${process.env.URL}/.netlify/functions/test-claude-ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      testType: 'dvla',
      imageData: documentData.imageData,
      fileType: documentData.fileType || 'image'
    })
  });

  if (!response.ok) {
    throw new Error(`DVLA processing failed: ${response.status}`);
  }

  const result = await response.json();
  return result.result;
}

// Save queue item to Google Sheets
async function saveToQueue(queueItem) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return;
    }

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'save-queue-item',
        queueItem: queueItem
      })
    });

    if (response.ok) {
      console.log('Queue item saved to Google Sheets');
    } else {
      console.error('Failed to save queue item');
    }

  } catch (error) {
    console.error('Error saving queue item:', error);
  }
}

// Get queue items from Google Sheets
async function getQueueItems() {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return [];
    }

    const response = await fetch(`${process.env.GOOGLE_APPS_SCRIPT_URL}?action=get-queue-items`);
    
    if (response.ok) {
      const result = await response.json();
      return result.items || [];
    } else {
      console.error('Failed to get queue items');
      return [];
    }

  } catch (error) {
    console.error('Error getting queue items:', error);
    return [];
  }
}

// Update queue item status
async function updateQueueItem(queueId, updates) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return;
    }

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update-queue-item',
        queueId: queueId,
        updates: updates
      })
    });

    if (response.ok) {
      console.log(`Queue item ${queueId} updated`);
    } else {
      console.error(`Failed to update queue item ${queueId}`);
    }

  } catch (error) {
    console.error('Error updating queue item:', error);
  }
}

// Send completion notification
async function sendCompletionNotification(queueItem, result) {
  try {
    console.log(`Sending completion notification for ${queueItem.email}`);
    
    // For now, just log the notification
    // In production, you'd send an actual email
    console.log('📧 EMAIL NOTIFICATION:');
    console.log(`To: ${queueItem.email}`);
    console.log(`Subject: Document Processing Complete - Job ${queueItem.jobId}`);
    console.log(`Document: ${queueItem.documentType.toUpperCase()}`);
    console.log(`Status: ${result.isValid ? 'APPROVED' : 'REQUIRES ATTENTION'}`);
    console.log(`Processing Time: ${new Date().toISOString()}`);
    
    // TODO: Implement actual email sending
    // await sendEmail(queueItem.email, 'Document Processing Complete', emailContent);

  } catch (error) {
    console.error('Error sending completion notification:', error);
  }
}

// Helper functions
function generateQueueId() {
  return 'QUE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Retry failed jobs
async function retryFailedJobs() {
  try {
    const queueItems = await getQueueItems();
    const failedItems = queueItems.filter(item => item.status === 'failed');
    
    console.log(`Found ${failedItems.length} failed items to retry`);
    
    for (const item of failedItems) {
      // Reset for retry
      await updateQueueItem(item.id, {
        status: 'queued',
        error: null,
        attempts: 0
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        retriedCount: failedItems.length,
        message: `Reset ${failedItems.length} failed jobs for retry`
      })
    };

  } catch (error) {
    console.error('Retry failed jobs error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to retry jobs',
        details: error.message 
      })
    };
  }
}
