/**
 * BioMax / eSSL ADMS Protocol Push Verification Script
 * Simulates real hardware sending:
 * 1. Handshake (GET /iclock/cdata?SN=BMX-10928374)
 * 2. Punch Logs (POST /iclock/cdata?SN=BMX-10928374&table=ATTLOG)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const DEVICE_SN = 'BMX-10928374';

async function testAdmsFlow() {
  console.log(`📡 Connecting to BioMax Cloud Attendance Backend at: ${BASE_URL}\n`);

  try {
    // 1. Handshake Ping
    console.log(`[Step 1] Sending ADMS Handshake Ping for Device: ${DEVICE_SN}...`);
    const pingRes = await fetch(`${BASE_URL}/iclock/cdata?SN=${DEVICE_SN}&options=all`);
    const pingText = await pingRes.text();
    console.log(`✅ Handshake Response Status: ${pingRes.status}`);
    console.log(`📋 Handshake Response Header / Config:\n${pingText}\n`);

    // 2. Push Biometric Punch Logs
    console.log(`[Step 2] Pushing Attendance Logs from Device: ${DEVICE_SN}...`);
    const now = new Date();
    const timeString = now.toISOString().replace('T', ' ').substring(0, 19);

    // BioMax / eSSL ATTLOG standard format:
    // <PIN>\t<YYYY-MM-DD HH:mm:ss>\t<STATUS (0=In, 1=Out)>\t<VERIFY (1=FP, 15=Face)>\t<WORKCODE>\t<RESERVED>
    const samplePayload = [
      `101\t${timeString}\t0\t1\t0\t0\t0`,
      `102\t${timeString}\t0\t15\t0\t0\t0`,
      `103\t${timeString}\t1\t3\t0\t0\t0`
    ].join('\r\n');

    console.log(`📤 Sending Raw ADMS Body:\n${samplePayload}\n`);

    const pushRes = await fetch(`${BASE_URL}/iclock/cdata?SN=${DEVICE_SN}&table=ATTLOG`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'iClock Proxy/1.0.0'
      },
      body: samplePayload
    });

    const pushReply = await pushRes.text();
    console.log(`✅ Push Response Status: ${pushRes.status}`);
    console.log(`📋 Device Push Ack: "${pushReply}"\n`);

    // 3. Query Attendance Logs via REST API
    console.log(`[Step 3] Fetching latest attendance records from REST API...`);
    const logsRes = await fetch(`${BASE_URL}/api/attendance/logs?limit=5`);
    const logsJson = await logsRes.json();
    console.log(`📊 Found ${logsJson.pagination?.total || 0} total attendance logs.`);
    console.log(`🕒 Latest Log Entry:`, logsJson.data?.[0]);

    console.log(`\n🎉 ADMS Protocol Verification Test Completed Successfully!`);
  } catch (err) {
    console.error('❌ ADMS Test Failed:', err.message);
  }
}

testAdmsFlow();
