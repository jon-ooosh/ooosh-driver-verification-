exports.handler = async (event) => {
  const { to, subject, message } = JSON.parse(event.body);
  
  console.log('📧 Email notification requested:');
  console.log(`   To: ${to}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Message: ${message}`);
  
  // For now, just log it - you can add actual email service later
  // Options: SendGrid, Mailgun, AWS SES, or Monday.com automation
  
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, logged: true })
  };
};
