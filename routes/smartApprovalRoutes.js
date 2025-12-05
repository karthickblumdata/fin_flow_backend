const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { getSmartApprovals } = require('../controllers/smartApprovalController');

// @route   GET /api/smart-approvals
// @access  Private
// @description Get pending approvals for Smart Approvals dashboard
router.get('/', protect, getSmartApprovals);

module.exports = router;

