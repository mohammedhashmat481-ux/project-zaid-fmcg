import axios from 'axios';

async function testNotifications() {
  try {
    // 1. Login
    const loginRes = await axios.post('http://localhost:5000/api/v1/auth/login', {
      email: 'admin@sales.com',
      password: 'password123'
    }, {
      headers: { 'x-tenant-subdomain': 'sales' }
    });

    const token = loginRes.data.token;
    console.log('Login success. User ID:', loginRes.data.user?._id || loginRes.data.user?.id);

    const headers = {
      Authorization: `Bearer ${token}`,
      'x-tenant-subdomain': 'sales'
    };

    // 2. Post test notification
    const testRes = await axios.post('http://localhost:5000/api/v1/notifications/test', {
      title: 'Real-time Pipeline Alert',
      message: 'New lead "Rajesh Sharma" was assigned to your pipeline.',
      type: 'info',
      link: '/modules/leads'
    }, { headers });

    console.log('Test notification created:', testRes.data);

    // 3. Get unread count
    const unreadRes = await axios.get('http://localhost:5000/api/v1/notifications/unread-count', { headers });
    console.log('Unread count:', unreadRes.data);

    // 4. Get notifications list
    const listRes = await axios.get('http://localhost:5000/api/v1/notifications', { headers });
    console.log('Notifications list length:', listRes.data.length);
    console.log('Latest notification title:', listRes.data[0]?.title);

    // 5. Mark read
    const readRes = await axios.put(`http://localhost:5000/api/v1/notifications/${testRes.data._id}/read`, {}, { headers });
    console.log('Marked read:', readRes.data.isRead);

    console.log('ALL NOTIFICATION API TESTS PASSED SUCCESSFULLY!');
  } catch (err: any) {
    console.error('Test failed:', err.response?.status, err.response?.data || err.message);
  }
}

testNotifications();
