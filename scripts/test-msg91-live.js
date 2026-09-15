const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testMsg91() {
  console.log('─── Testing Live MSG91 Configuration ───');
  
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    console.error('❌ MSG91_AUTH_KEY is not set in environment variables');
    process.exit(1);
  }

  const url = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';

  console.log(`\n1. Testing MSG91 server connectivity to: ${url}...`);

  try {
    const response = await axios.post(
      url,
      {
        authkey: authKey,
        'access-token': 'sample_test_token_12345'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          authkey: authKey
        },
        timeout: 10000
      }
    );

    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
  } catch (err) {
    if (err.response) {
      console.log('MSG91 Server responded with HTTP status:', err.response.status);
      console.log('MSG91 Server response data:', err.response.data);
      if (err.response.status === 401 && err.response.data?.message?.toLowerCase().includes('authkey')) {
        console.log('⚠️ AuthKey was rejected by MSG91. Check MSG91 dashboard Auth Key.');
      } else if (err.response.data?.message?.toLowerCase().includes('token') || err.response.data?.type === 'error') {
        console.log('✅ MSG91 API endpoint is reachable and authenticated! (Expectedly rejected dummy test token).');
      }
    } else {
      console.error('❌ Connection error to MSG91:', err.message);
    }
  }
}

testMsg91().catch(err => {
  console.error('Fatal error:', err);
});
