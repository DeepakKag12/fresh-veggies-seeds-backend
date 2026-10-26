const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

let customerToken = null;
let customerUser = null;
let testProductId = null;
let testOrderId = null;
let testConversationId = null;
const uniqueTimestamp = Date.now();
const testEmail = `master_qa_${uniqueTimestamp}@example.com`;
const testPhone = `9${String(uniqueTimestamp).slice(-9)}`;

test('Master Full-Stack Integration & API Lifecycle Suite', { concurrency: false }, async (t) => {

  await t.test('1. Customer Registration & Token Generation', async () => {
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Master QA Tester',
      email: testEmail,
      phone: testPhone,
      password: 'Password@2026'
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.data.success, true);

    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      identifier: testEmail,
      password: 'Password@2026'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
    assert.ok(loginRes.data.data?.token);
    customerToken = loginRes.data.data.token;
    customerUser = loginRes.data.data;
  });

  await t.test('2. Customer Profile Fetch & Token Authorization', async () => {
    assert.ok(customerToken, 'Customer token must exist');
    const res = await axios.get(`${BASE_URL}/auth/profile`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    const profile = res.data.data || res.data.user;
    assert.strictEqual(profile.email, testEmail);
  });

  await t.test('3. Rejects Unauthenticated Requests (401)', async () => {
    try {
      await axios.get(`${BASE_URL}/auth/profile`);
      assert.fail('Should have failed with 401');
    } catch (err) {
      assert.strictEqual(err.response?.status, 401);
    }
  });

  await t.test('4. Product & Category Catalog Endpoints', async () => {
    // Categories
    const catRes = await axios.get(`${BASE_URL}/categories`);
    assert.strictEqual(catRes.status, 200);
    assert.strictEqual(catRes.data.success, true);
    assert.ok(Array.isArray(catRes.data.data));

    // Products
    const prodRes = await axios.get(`${BASE_URL}/products?limit=5&page=1`);
    assert.strictEqual(prodRes.status, 200);
    assert.strictEqual(prodRes.data.success, true);
    const products = prodRes.data.data || prodRes.data.products;
    assert.ok(Array.isArray(products));

    if (products.length > 0) {
      const candidate = products.find(p => p.price >= 100 && p.stock >= 10 && p.isActive !== false) || products[0];
      testProductId = candidate._id;
      const detailRes = await axios.get(`${BASE_URL}/products/${testProductId}`);
      assert.strictEqual(detailRes.status, 200);
      assert.strictEqual(detailRes.data.success, true);
      const prod = detailRes.data.data || detailRes.data.product;
      assert.ok(prod.name);
    }

    // Combos
    const comboRes = await axios.get(`${BASE_URL}/combos`);
    assert.strictEqual(comboRes.status, 200);
    assert.strictEqual(comboRes.data.success, true);
  });

  await t.test('5. Storefront Settings & Promotional Banners', async () => {
    const settingsRes = await axios.get(`${BASE_URL}/settings`);
    assert.strictEqual(settingsRes.status, 200);
    assert.strictEqual(settingsRes.data.success, true);

    const bannersRes = await axios.get(`${BASE_URL}/banners`);
    assert.strictEqual(bannersRes.status, 200);
    assert.strictEqual(bannersRes.data.success, true);
  });

  await t.test('6. Coupon Validation & Cart Rules', async () => {
    try {
      await axios.post(`${BASE_URL}/coupons/validate`, {
        code: 'NON_EXISTENT_COUPON_XYZ',
        cartTotal: 1000
      }, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.fail('Should reject non-existent coupon');
    } catch (err) {
      assert.ok(err.response?.status === 400 || err.response?.status === 404);
    }
  });

  await t.test('7. Order Placement & State Machine Flow', async () => {
    if (!testProductId) return;

    // Fetch product details to obtain valid package variant if present
    const prodRes = await axios.get(`${BASE_URL}/products/${testProductId}`);
    const product = prodRes.data.data || prodRes.data.product;
    const hasPackages = Array.isArray(product.packages) && product.packages.length > 0;
    const packageId = hasPackages ? product.packages[0]._id : undefined;

    const orderPayload = {
      orderItems: [
        {
          product: testProductId,
          productType: 'Product',
          packageId: packageId,
          quantity: 1
        }
      ],
      shippingAddress: {
        name: 'Rahul Sharma',
        phone: testPhone,
        street: 'Flat 402, Green Meadows, MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001'
      },
      paymentMode: 'COD'
    };

    let res;
    try {
      res = await axios.post(`${BASE_URL}/orders`, orderPayload, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
    } catch (err) {
      console.log('ORDER ERROR MSG:', JSON.stringify(err.response?.data));
      throw err;
    }

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    const order = res.data.data || res.data.order;
    assert.ok(order._id);
    testOrderId = order._id;
    assert.strictEqual(order.orderStatus, 'Pending');

    // Customer order history
    const historyRes = await axios.get(`${BASE_URL}/orders/my-orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.strictEqual(historyRes.status, 200);
    const orders = historyRes.data.data || historyRes.data.orders;
    assert.ok(Array.isArray(orders));
    assert.ok(orders.some((o) => o._id === testOrderId));

    // Order detail lookup
    const orderDetailRes = await axios.get(`${BASE_URL}/orders/${testOrderId}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.strictEqual(orderDetailRes.status, 200);
    const fetchedOrder = orderDetailRes.data.data || orderDetailRes.data.order;
    assert.strictEqual(fetchedOrder._id, testOrderId);
  });

  await t.test('8. Real-time Live Chat & Guest Support Flow', async () => {
    const guestId = `guest_master_${uniqueTimestamp}`;
    
    // Init conversation
    const initRes = await axios.post(`${BASE_URL}/chat/init`, {
      guestId,
      customerName: 'Ananya Roy',
      customerPhone: '9876543210'
    });
    assert.strictEqual(initRes.status, 200);
    assert.ok(initRes.data.conversation._id);
    testConversationId = initRes.data.conversation._id;

    // Send message
    const msgRes = await axios.post(`${BASE_URL}/chat/conversations/${testConversationId}/messages`, {
      guestId,
      customerName: 'Ananya Roy',
      customerPhone: '9876543210',
      text: 'Do you provide delivery tracking on WhatsApp?'
    });
    assert.strictEqual(msgRes.status, 201);
    assert.strictEqual(msgRes.data.message.status, 'sent');

    // Fetch messages
    const listRes = await axios.get(`${BASE_URL}/chat/conversations/${testConversationId}/messages?guestId=${guestId}`);
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data.messages));
    assert.ok(listRes.data.messages.length >= 1);

    // BOLA / IDOR Protection: Attacker guest blocked
    try {
      await axios.get(`${BASE_URL}/chat/conversations/${testConversationId}/messages?guestId=attacker_guest_999`);
      assert.fail('Attacker guest should be blocked with 403');
    } catch (err) {
      assert.strictEqual(err.response?.status, 403);
    }
  });

  await t.test('9. Customer Support Ticket Submission', async () => {
    const res = await axios.post(`${BASE_URL}/contact`, {
      name: 'Master QA Tester',
      email: `contact_${uniqueTimestamp}@example.com`,
      phone: '9876543210',
      subject: 'Wholesale Inquiry',
      message: 'Requesting wholesale catalog for bulk gardening supplies.'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
  });
});
