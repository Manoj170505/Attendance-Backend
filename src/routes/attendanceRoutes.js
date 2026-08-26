import express from 'express';
import {
  getAttendanceLogs,
  getAttendanceStats
} from '../controllers/attendanceController.js';

const router = express.Router();

router.get('/logs', getAttendanceLogs);
router.get('/stats', getAttendanceStats);

export default router;
