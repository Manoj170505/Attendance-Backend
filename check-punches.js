import prisma from './src/config/prisma.js';

async function checkPunches() {
  try {
    const logs = await prisma.attendanceLog.findMany({
      where: { deviceSerial: 'TFEE261200765' },
      orderBy: { timestamp: 'desc' },
      take: 10,
      include: {
        company: true,
        employee: true
      }
    });

    console.log(`Punches count from TFEE261200765: ${logs.length}`);
    console.log(JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkPunches();
