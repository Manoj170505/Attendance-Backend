import express from 'express';
import {
  getAttendanceLogs,
  getAttendanceStats,
  recordPunch
} from '../controllers/attendanceController.js';

const router = express.Router();

router.get('/logs', getAttendanceLogs);
router.get('/stats', getAttendanceStats);
router.post('/punch', recordPunch);

export default router;
