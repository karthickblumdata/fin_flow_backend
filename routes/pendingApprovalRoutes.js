const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const {
  getPendingApprovals,
  exportPendingApprovals,
} = require('../controllers/pendingApprovalController');

router.get('/', protect, getPendingApprovals);
router.post('/export', protect, exportPendingApprovals);

module.exports = router;

