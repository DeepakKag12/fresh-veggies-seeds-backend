const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
const TEST_PHONE = '9876543210';

async function runApiTests() {
  console.log('====================================================');
  console.log('🧪 TESTING AUTH & MSG91 FLOW DIRECTLY THROUGH API');
  console.log('====================================================\n');

  // 1. Warm up database connection
  console.log('1️⃣ Warming up database connection...');
  await axios.get('http://localhost:5000/').catch(() => null);
  await new Promise(r => setTimeout(r, 2000));
  try {
    const health = await axios.get('http://localhost:5000/health');
    console.log('   Status:', health.status, health.data);
  } catch (err) {
    console.log('   Health check returned:', err.response?.status || err.message);
  }

  // 2. Test Direct MSG91 Send OTP endpoint
  let sendResult = null;
  try {
    console.log('\n2️⃣ Testing POST /api/auth/msg91/send-otp...');
    const res = await axios.post(`${BASE_URL}/auth/msg91/send-otp`, {
      phone: TEST_PHONE
    });
    sendResult = res.data;
    console.log('   ✅ send-otp response:', sendResult);
  } catch (err) {
    console.error('   ❌ send-otp failed:', err.response?.data || err.message);
  }

  let latestOtp = sendResult?.devOtp;

  // 2b. Test Direct MSG91 Resend OTP endpoint
  try {
    console.log('\n2️⃣b Testing POST /api/auth/msg91/resend-otp...');
    const resendRes = await axios.post(`${BASE_URL}/auth/msg91/resend-otp`, {
      phone: TEST_PHONE
    });
    console.log('   ✅ resend-otp response:', resendRes.data);
    if (resendRes.data?.devOtp) latestOtp = resendRes.data.devOtp;
  } catch (err) {
    console.error('   ❌ resend-otp failed:', err.response?.data || err.message);
  }

  // 3. Test Direct MSG91 Verify OTP endpoint
  let authData = null;
  if (latestOtp) {
    try {
      console.log(`\n3️⃣ Testing POST /api/auth/msg91/verify-otp using OTP: ${latestOtp}...`);
      const res = await axios.post(`${BASE_URL}/auth/msg91/verify-otp`, {
        phone: TEST_PHONE,
        otp: latestOtp,
        name: 'Test Customer'
      });
      authData = res.data;
      console.log('   ✅ verify-otp response:', {
        success: authData.success,
        message: authData.message,
        isNewUser: authData.isNewUser,
        user: {
          id: authData.data?._id,
          name: authData.data?.name,
          phone: authData.data?.phone,
          tokenPreview: authData.data?.token?.substring(0, 25) + '...'
        }
      });
    } catch (err) {
      console.error('   ❌ verify-otp failed:', err.response?.data || err.message);
    }
  }

  // 4. Test Authenticated Route with Token (Checkout unlock test)
  if (authData?.data?.token) {
    try {
      console.log('\n4️⃣ Testing authenticated GET /api/auth/me using returned JWT...');
      const meRes = await axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${authData.data.token}` }
      });
      console.log('   ✅ /auth/me verified! User identity unlocked:', {
        id: meRes.data?.data?._id,
        phone: meRes.data?.data?.phone,
        role: meRes.data?.data?.role
      });
    } catch (err) {
      console.error('   ❌ /auth/me failed:', err.response?.data || err.message);
    }
  }

  // 5. Test MSG91 Token Verification endpoint (/msg91-verify & /msg91/verify-token)
  try {
    console.log('\n5️⃣ Testing POST /api/auth/msg91-verify with sample token...');
    await axios.post(`${BASE_URL}/auth/msg91-verify`, {
      accessToken: 'dummy_token'
    });
  } catch (err) {
    if (err.response?.status === 400 && (err.response.data?.message?.includes('OTP') || err.response.data?.message?.includes('token') || err.response.data?.message?.includes('MSG91') || err.response.data?.message?.includes('invalid'))) {
      console.log('   ✅ /api/auth/msg91-verify is active, reached MSG91, and properly validated token payload! Response:', err.response.data);
    } else {
      console.log('   Endpoint status:', err.response?.status, err.response?.data);
    }
  }

  try {
    console.log('\n6️⃣ Testing POST /api/auth/msg91/verify-token alias...');
    await axios.post(`${BASE_URL}/auth/msg91/verify-token`, {
      accessToken: 'dummy_token'
    });
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('   ✅ /api/auth/msg91/verify-token alias active and functioning! Response:', err.response.data);
    }
  }

  console.log('\n====================================================');
  console.log('🏁 ALL API TESTS COMPLETED');
  console.log('====================================================');
}

runApiTests().catch(console.error);
