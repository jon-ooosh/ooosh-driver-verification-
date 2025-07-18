// File: functions/scheduled-processor.js
// Scheduled function to process the queue during off-peak hours
// This should be triggered by Netlify scheduled functions or external cron

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🕐 Scheduled queue processor started at:', new Date().toISOString());
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    // Check if we're in off-peak hours (3am-6am UK time)
    const now = new Date();
    const ukHour = now.getUTCHours() + 1; // Approximate UK time (adjust for DST)
    const isOffPeak = ukHour >= 3 && ukHour <= 6;
    
    console.log(`Current UK hour: ${ukHour}, Off-peak: ${isOffPeak}`);
    
    if (!isOffPeak) {
      console.log('⏰ Not in off-peak hours, running limited processing');
      return await processLimitedQueue();
    }
    
    console.log('🌙 Off-peak hours detected, running full queue processing');
    return await processFullQueue();
    
  } catch (error) {
    console.error('Scheduled processor error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Scheduled processing failed',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Process queue with limited concurrency (for peak hours)
async function processLimitedQueue() {
  try {
    console.log('📊 Running limited queue processing...');
    
    // Get urgent items only
    const queueItems = await getQueueItems();
    const urgentItems = queueItems.filter(item => 
      item.priority === 'urgent' && item.status === 'queued'
    );
    
    console.log(`Found ${urgentItems.length} urgent items to process`);
    
    if (urgentItems.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          processed: 0,
          message: 'No urgent items to process',
          nextRun: 'Next scheduled processing in off-peak hours'
        })
      };
    }
    
    // Process only first 3 urgent items to avoid overwhelming Claude
    const itemsToProcess = urgentItems.slice(0, 3);
    const results = await processItems(itemsToProcess, 5000); // 5 second delays
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        processed: results.processed,
        failed: results.failed,
        total: itemsToProcess.length,
        message: `Limited processing completed - ${results.processed} urgent items processed`
      })
    };
    
  } catch (error) {
    console.error('Limited queue processing error:', error);
    throw error;
  }
}

// Process full queue (for off-peak hours)
async function processFullQueue() {
  try {
    console.log('🌙 Running full queue processing...');
    
    const queueItems = await getQueueItems();
    const pendingItems = queueItems.filter(item => 
      item.status === 'queued' && item.attempts < item.maxAttempts
    );
    
    console.log(`Found ${pendingItems.length} items to process`);
    
    if (pendingItems.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          processed: 0,
          message: 'Queue is empty',
          nextRun: 'Next scheduled processing in 1 hour'
        })
      };
    }
    
    // Sort by priority
    const priorityOrder = { 'urgent': 0, 'high': 1, 'normal': 2, 'low': 3 };
    pendingItems.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 2;
      const bPriority = priorityOrder[b.priority] || 2;
      return aPriority - bPriority;
    });
    
    // Process all items with smaller delays during off-peak
    const results = await processItems(pendingItems, 2000); // 2 second delays
    
    // Send summary report
    await sendProcessingSummary(results, pendingItems.length);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        processed: results.processed,
        failed: results.failed,
        total: pendingItems.length,
        message: `Full queue processing completed - ${results.processed}/${pendingItems.length} items processed successfully`,
        summaryEmailed: true
      })
    };
    
  } catch (error) {
    console.error('Full queue processing error:', error);
    throw error;
  }
}

// Process a list of items with delays
async function processItems(items, delayMs = 2000) {
  let processed = 0;
  let failed = 0;
  
  console.log(`🔄 Processing ${items.length} items with ${delayMs}ms delays...`);
  
  for (const item of items) {
    try {
      console.log(`Processing item: ${item.id} (${item.documentType})`);
      
      const result = await processQueueItem(item);
      
      if (result.success) {
        processed++;
        console.log(`✅ Successfully processed ${item.id}`);
        
        // Send individual completion notification
        await sendCompletionNotification(item, result.data);
      } else {
        failed++;
        console.log(`❌ Failed to process ${item.id}: ${result.error}`);
      }
      
      // Delay between items to avoid overwhelming Claude
      if (items.indexOf(item) < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
    } catch (error) {
      console.error(`Error processing item ${item.id}:`, error);
      failed++;
    }
  }
  
  return { processed, failed };
}

// Process a single queue item
async function processQueueItem(item) {
  try {
    // Call the queue manager to process this item
    const response = await fetch(`${process.env.URL}/.netlify/functions/queue-manager`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'process-item',
        item: item
      })
    });
    
    if (!response.ok) {
      throw new Error(`Processing failed: ${response.status}`);
    }
    
    const result = await response.json();
    return result;
    
  } catch (error) {
    console.error(`Failed to process item ${item.id}:`, error);
    return { success: false, error: error.message };
  }
}

// Get queue items
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

// Send completion notification for individual item
async function sendCompletionNotification(item, result) {
  try {
    console.log(`📧 Sending completion notification for ${item.email}`);
    
    const emailContent = {
      to: item.email,
      subject: `Document Processing Complete - Job ${item.jobId}`,
      body: `
        Dear Driver,
        
        Your ${item.documentType.toUpperCase()} document has been processed.
        
        Status: ${result.isValid ? '✅ APPROVED' : '⚠️ REQUIRES ATTENTION'}
        Job ID: ${item.jobId}
        Processing Time: ${new Date().toISOString()}
        
        ${result.isValid ? 
          'Your document has been approved and you can proceed with the hire.' : 
          'Your document requires attention. Please check the verification system or contact support.'}
        
        ${result.issues && result.issues.length > 0 ? 
          `Issues found: ${result.issues.join(', ')}` : 
          ''}
        
        Best regards,
        OOOSH Driver Verification System
      `
    };
    
    // For now, just log the email content
    // In production, integrate with your email service
    console.log('📧 EMAIL NOTIFICATION:', emailContent);
    
    // TODO: Send actual email
    // await sendEmail(emailContent);
    
  } catch (error) {
    console.error('Error sending completion notification:', error);
  }
}

// Send processing summary report
async function sendProcessingSummary(results, totalItems) {
  try {
    console.log('📊 Sending processing summary report...');
    
    const summaryContent = {
      to: 'admin@ooosh.com', // Replace with actual admin email
      subject: `Queue Processing Summary - ${new Date().toISOString().split('T')[0]}`,
      body: `
        OOOSH Driver Verification - Queue Processing Summary
        
        Processing Time: ${new Date().toISOString()}
        Total Items: ${totalItems}
        Successfully Processed: ${results.processed}
        Failed: ${results.failed}
        Success Rate: ${Math.round((results.processed / totalItems) * 100)}%
        
        ${results.failed > 0 ? 
          `⚠️ ${results.failed} items failed processing and may require manual attention.` : 
          '✅ All items processed successfully.'}
        
        Next scheduled processing: ${new Date(Date.now() + 3600000).toISOString()}
        
        OOOSH Driver Verification System
      `
    };
    
    console.log('📧 SUMMARY EMAIL:', summaryContent);
    
    // TODO: Send actual email
    // await sendEmail(summaryContent);
    
  } catch (error) {
    console.error('Error sending processing summary:', error);
  }
}

// Manual trigger endpoint for testing
if (require.main === module) {
  // Allow manual testing
  console.log('Manual queue processor test');
  exports.handler({}, {}).then(result => {
    console.log('Result:', result);
  }).catch(error => {
    console.error('Error:', error);
  });
}
