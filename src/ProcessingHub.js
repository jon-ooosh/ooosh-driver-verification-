// ProcessingHub that ACTUALLY WAITS for the webhook
// Key change: It waits for a webhook from THIS session, not just any data

const ProcessingHub = ({ driverEmail, jobId, sessionType }) => {
  console.log('🔍 ProcessingHub props received:', { driverEmail, jobId, sessionType });
  
  const [status, setStatus] = useState('waiting');
  const [attempts, setAttempts] = useState(0);
  const [driverData, setDriverData] = useState(null);
  const [message, setMessage] = useState('Processing your verification...');
  const [sessionStartTime] = useState(new Date()); // Track when this session started
  
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL = 2000;

  // Route to next step based on driver data
  const routeToNextStep = useCallback((data) => {
    console.log('🧭 Routing based on fresh webhook data:', data);
    
    // Don't route if no data
    if (!data) {
      console.log('❌ No data to route with');
      return;
    }
    
    // Check if POA validation needed
    if (!data.poa1ValidUntil || !data.poa2ValidUntil) {
      console.log('→ Routing to POA validation');
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // Check if UK driver needs DVLA
    const isUKDriver = data.nationality === 'GB' || 
                      data.licenseIssuedBy === 'DVLA' ||
                      data.licenseIssuedBy?.includes('UK');
    
    if (isUKDriver && (!data.dvlaCheckComplete || data.dvlaCheckStatus !== 'valid')) {
      console.log('→ UK driver - routing to DVLA check');
      window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // Non-UK driver needs passport?
    if (!isUKDriver && !data.passportVerified) {
      console.log('→ Non-UK driver - routing to passport upload');
      window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // All complete - signature
    console.log('→ All checks complete - routing to signature');
    window.location.href = `/?step=signature&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

  // Check for webhook - ONLY accept RECENT updates
  const checkWebhookProcessed = useCallback(async () => {
    try {
      console.log(`🔄 Checking for webhook (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
      
      // IMPORTANT: We're waiting for a NEW webhook, not checking existing data
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (!response.ok) {
        console.log(`📊 Driver lookup returned ${response.status}`);
        
        // Driver might not exist yet or there's an error
        // Keep waiting regardless
        if (attempts < MAX_ATTEMPTS - 1) {
          setAttempts(prev => prev + 1);
          setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
          return;
        } else {
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
          return;
        }
      }
      
      const data = await response.json();
      console.log('📊 Driver data check:', {
        hasData: !!data,
        lastUpdated: data?.lastUpdated,
        hasDocUrls: !!(data?.licenseFrontUrl || data?.poa1Url)
      });
      
      // CRITICAL: Only accept webhook if it's VERY recent
      let webhookReceived = false;
      
      // Method 1: Check if lastUpdated is after session started
      if (data?.lastUpdated) {
        const lastUpdateTime = new Date(data.lastUpdated);
        
        // If lastUpdated is after when ProcessingHub loaded, it's new
        if (lastUpdateTime > sessionStartTime) {
          console.log('✅ New webhook detected - lastUpdated is after session start');
          webhookReceived = true;
        } else {
          const ageInSeconds = (sessionStartTime - lastUpdateTime) / 1000;
          console.log(`⏳ Data is from before this session (${ageInSeconds.toFixed(0)}s old) - waiting for new webhook`);
        }
      }
      
      // Method 2: For full session, check for document URLs that webhook uploads
      if (!webhookReceived && sessionType === 'full') {
        // Only accept if we have fresh document URLs
        // These are only set by the webhook after Idenfy completes
        if (data?.licenseFrontUrl && data?.poa1Url && data?.lastUpdated) {
          const lastUpdateTime = new Date(data.lastUpdated);
          const secondsAgo = (new Date() - lastUpdateTime) / 1000;
          
          // Only if updated in last 60 seconds
          if (secondsAgo < 60) {
            console.log(`✅ Fresh document URLs detected (${secondsAgo.toFixed(1)}s ago)`);
            webhookReceived = true;
          }
        }
      }
      
      // Method 3: Check for session-specific markers
      if (!webhookReceived && sessionType === 'poa_reupload') {
        if (data?.poaRevalidationDate === new Date().toISOString().split('T')[0]) {
          console.log('✅ POA revalidation webhook detected (today)');
          webhookReceived = true;
        }
      }
      
      if (webhookReceived) {
        console.log('🎉 Fresh webhook received! Processing routing...');
        setDriverData(data);
        setStatus('success');
        setMessage('Verification complete! Determining next step...');
        
        // Brief pause then route
        setTimeout(() => {
          routeToNextStep(data);
        }, 1500);
        
      } else {
        // No webhook yet - keep polling
        if (attempts < MAX_ATTEMPTS - 1) {
          setAttempts(prev => prev + 1);
          
          // Update message
          if (attempts === 0) {
            setMessage('Waiting for verification to complete...');
          } else if (attempts > 5) {
            setMessage('Processing your documents...');
          } else if (attempts > 10) {
            setMessage('This is taking a bit longer than usual...');
          } else if (attempts > 15) {
            setMessage('Almost there, please wait...');
          }
          
          // Continue polling
          setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
          
        } else {
          // Timeout after 40 seconds
          console.log('⏱️ Timeout - webhook never arrived');
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
        }
      }
      
    } catch (error) {
      console.error('❌ Error checking for webhook:', error);
      
      // On error, keep trying unless we're out of attempts
      if (attempts < MAX_ATTEMPTS - 1) {
        setAttempts(prev => prev + 1);
        setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
      } else {
        setStatus('error');
        setMessage('An error occurred while processing');
      }
    }
  }, [attempts, driverEmail, sessionType, routeToNextStep, sessionStartTime, MAX_ATTEMPTS, POLL_INTERVAL]);
