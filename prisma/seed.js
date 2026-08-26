import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting MongoDB Database Seeding for Multi-Tenant Attendance...');

  // Clean existing data for clean seed
  await prisma.attendanceLog.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.company.deleteMany({});

  console.log('🧹 Cleaned up existing collections.');

  // 1. Create Tenant Companies
  const acme = await prisma.company.create({
    data: {
      name: 'Acme Global Industries',
      code: 'ACME-CORP',
      description: 'Manufacturing & Distribution headquarters'
    }
  });

  const technova = await prisma.company.create({
    data: {
      name: 'TechNova Software Labs',
      code: 'TECH-NOVA',
      description: 'Cloud and AI engineering team'
    }
  });

  console.log('🏢 Created 2 Tenant Companies: Acme Global & TechNova Labs');

  // 2. Create Devices
  const deviceAcme1 = await prisma.device.create({
    data: {
      serialNumber: 'BMX-10928374',
      name: 'Acme HQ - Main Reception Device',
      companyId: acme.id,
      model: 'BioMax N-BM2000 Pro',
      status: 'ONLINE',
      ipAddress: '192.168.1.105',
      lastHeartbeat: new Date()
    }
  });

  const deviceAcme2 = await prisma.device.create({
    data: {
      serialNumber: 'BMX-99887766',
      name: 'Acme Warehouse - Gate 2',
      companyId: acme.id,
      model: 'BioMax SpeedFace-V5L',
      status: 'ONLINE',
      ipAddress: '192.168.2.50',
      lastHeartbeat: new Date(Date.now() - 5 * 60 * 1000)
    }
  });

  const deviceTechNova = await prisma.device.create({
    data: {
      serialNumber: 'ESSL-55443322',
      name: 'TechNova - 5th Floor Entry',
      companyId: technova.id,
      model: 'eSSL Identix K30',
      status: 'ONLINE',
      ipAddress: '10.0.4.12',
      lastHeartbeat: new Date()
    }
  });

  const unassignedDevice = await prisma.device.create({
    data: {
      serialNumber: 'BMX-00001111',
      name: 'New Unassigned Device (Warehouse Demo)',
      companyId: null,
      model: 'BioMax Bio-101',
      status: 'OFFLINE',
      ipAddress: '192.168.1.200'
    }
  });

  console.log('📱 Created 4 Biometric Devices (3 assigned, 1 unassigned)');

  // 3. Create Employees
  const empAcme1 = await prisma.employee.create({
    data: {
      companyId: acme.id,
      employeeId: '101',
      name: 'Rahul Sharma',
      department: 'Production',
      designation: 'Senior Plant Supervisor'
    }
  });

  const empAcme2 = await prisma.employee.create({
    data: {
      companyId: acme.id,
      employeeId: '102',
      name: 'Priya Patel',
      department: 'Quality Assurance',
      designation: 'QA Lead'
    }
  });

  const empAcme3 = await prisma.employee.create({
    data: {
      companyId: acme.id,
      employeeId: '103',
      name: 'Vikram Singh',
      department: 'Logistics',
      designation: 'Dispatch Officer'
    }
  });

  const empTech1 = await prisma.employee.create({
    data: {
      companyId: technova.id,
      employeeId: '201',
      name: 'Ananya Iyer',
      department: 'Engineering',
      designation: 'Full Stack Architect'
    }
  });

  const empTech2 = await prisma.employee.create({
    data: {
      companyId: technova.id,
      employeeId: '202',
      name: 'Karthik Nair',
      department: 'Product',
      designation: 'Product Manager'
    }
  });

  console.log('👥 Created 5 Employees across 2 companies');

  // 4. Create Sample Punch Attendance Logs
  const now = new Date();
  const todayMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5, 23);
  const todayLunch = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 10, 15);
  const todayReturn = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 55, 40);

  const punches = [
    {
      companyId: acme.id,
      employeeId: '101',
      deviceSerial: deviceAcme1.serialNumber,
      deviceId: deviceAcme1.id,
      employeeDbId: empAcme1.id,
      timestamp: todayMorning,
      state: 'CHECK_IN',
      punchType: 'FINGERPRINT',
      rawData: `101\t${todayMorning.toISOString().replace('T', ' ').substring(0, 19)}\t0\t1\t0\t0\t0`
    },
    {
      companyId: acme.id,
      employeeId: '102',
      deviceSerial: deviceAcme1.serialNumber,
      deviceId: deviceAcme1.id,
      employeeDbId: empAcme2.id,
      timestamp: new Date(todayMorning.getTime() + 12 * 60 * 1000),
      state: 'CHECK_IN',
      punchType: 'FACE_RECOGNITION',
      rawData: `102\t${todayMorning.toISOString().replace('T', ' ').substring(0, 19)}\t0\t15\t0\t0\t0`
    },
    {
      companyId: acme.id,
      employeeId: '103',
      deviceSerial: deviceAcme2.serialNumber,
      deviceId: deviceAcme2.id,
      employeeDbId: empAcme3.id,
      timestamp: new Date(todayMorning.getTime() + 25 * 60 * 1000),
      state: 'CHECK_IN',
      punchType: 'CARD_RFID',
      rawData: `103\t${todayMorning.toISOString().replace('T', ' ').substring(0, 19)}\t0\t3\t0\t0\t0`
    },
    {
      companyId: acme.id,
      employeeId: '101',
      deviceSerial: deviceAcme1.serialNumber,
      deviceId: deviceAcme1.id,
      employeeDbId: empAcme1.id,
      timestamp: todayLunch,
      state: 'BREAK_OUT',
      punchType: 'FINGERPRINT',
      rawData: `101\t${todayLunch.toISOString().replace('T', ' ').substring(0, 19)}\t2\t1\t0\t0\t0`
    },
    {
      companyId: acme.id,
      employeeId: '101',
      deviceSerial: deviceAcme1.serialNumber,
      deviceId: deviceAcme1.id,
      employeeDbId: empAcme1.id,
      timestamp: todayReturn,
      state: 'BREAK_IN',
      punchType: 'FINGERPRINT',
      rawData: `101\t${todayReturn.toISOString().replace('T', ' ').substring(0, 19)}\t3\t1\t0\t0\t0`
    },
    {
      companyId: technova.id,
      employeeId: '201',
      deviceSerial: deviceTechNova.serialNumber,
      deviceId: deviceTechNova.id,
      employeeDbId: empTech1.id,
      timestamp: new Date(todayMorning.getTime() + 18 * 60 * 1000),
      state: 'CHECK_IN',
      punchType: 'FACE_RECOGNITION',
      rawData: `201\t${todayMorning.toISOString().replace('T', ' ').substring(0, 19)}\t0\t15\t0\t0\t0`
    },
    {
      companyId: technova.id,
      employeeId: '202',
      deviceSerial: deviceTechNova.serialNumber,
      deviceId: deviceTechNova.id,
      employeeDbId: empTech2.id,
      timestamp: new Date(todayMorning.getTime() + 30 * 60 * 1000),
      state: 'CHECK_IN',
      punchType: 'FINGERPRINT',
      rawData: `202\t${todayMorning.toISOString().replace('T', ' ').substring(0, 19)}\t0\t1\t0\t0\t0`
    }
  ];

  for (const p of punches) {
    await prisma.attendanceLog.create({ data: p });
  }

  console.log(`✅ Database successfully seeded with ${punches.length} sample attendance punch logs!`);
}

main()
  .catch((e) => {
    console.error('❌ Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
