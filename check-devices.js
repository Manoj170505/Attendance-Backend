import prisma from './src/config/prisma.js';

async function listDevices() {
  try {
    const devices = await prisma.device.findMany({
      include: {
        company: {
          select: { name: true, code: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    console.log(`TOTAL DEVICES: ${devices.length}\n`);
    devices.forEach((d, idx) => {
      console.log(`[Device #${idx + 1}]`);
      console.log(`  Serial Number:  ${d.serialNumber}`);
      console.log(`  Name:           ${d.name}`);
      console.log(`  Model:          ${d.model}`);
      console.log(`  Status:         ${d.status}`);
      console.log(`  IP Address:     ${d.ipAddress}`);
      console.log(`  Last Heartbeat: ${d.lastHeartbeat ? d.lastHeartbeat.toISOString() : 'Never'}`);
      console.log(`  Created At:     ${d.createdAt.toISOString()}`);
      console.log(`  Updated At:     ${d.updatedAt.toISOString()}`);
      console.log(`  Assigned Tenant:${d.company ? `${d.company.name} (${d.company.code})` : 'UNASSIGNED'}`);
      console.log('--------------------------------------------------');
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

listDevices();
