const AuditLog = require('../models/auditLogModel');
const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');
const Wallet = require('../models/walletModel');

// @desc    Get audit logs
// @route   GET /api/audit-logs
// @access  Private (SuperAdmin, Admin)
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      actionType,
      entityType,
      userId,
      startDate,
      endDate,
      search
    } = req.query;

    const query = {};

    // Filter by action type
    if (actionType) {
      query.actionType = actionType;
    }

    // Filter by entity type
    if (entityType) {
      query.entityType = entityType;
    }

    // Filter by user
    if (userId) {
      query.userId = userId;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Search in action field
    if (search) {
      query.action = { $regex: search, $options: 'i' };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const auditLogs = await AuditLog.find(query)
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      auditLogs,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get recent activity (consolidated view)
// @route   GET /api/audit-logs/recent
// @access  Private (SuperAdmin, Admin)
exports.getRecentActivity = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Get recent audit logs
    const auditLogs = await AuditLog.find()
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Format for display
    const activities = auditLogs.map(log => ({
      id: log._id,
      type: log.entityType,
      action: log.actionType,
      user: log.userId ? {
        id: log.userId._id,
        name: log.userId.name,
        email: log.userId.email,
        role: log.userId.role
      } : null,
      entityId: log.entityId,
      entityType: log.entityType,
      timestamp: log.createdAt,
      notes: log.notes,
      ipAddress: log.ipAddress,
      previousValue: log.previousValue,
      newValue: log.newValue
    }));

    res.status(200).json({
      success: true,
      activities,
      count: activities.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user activity summary
// @route   GET /api/audit-logs/user/:userId
// @access  Private (SuperAdmin, Admin)
exports.getUserActivity = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    // Get user's audit logs
    const auditLogs = await AuditLog.find({ userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Get user's transactions
    const transactions = await Transaction.find({
      $or: [
        { sender: userId },
        { receiver: userId },
        { initiatedBy: userId }
      ]
    })
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .populate('initiatedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);

    // Get user's collections
    const collections = await Collection.find({
      $or: [
        { collectedBy: userId },
        { assignedReceiver: userId }
      ]
    })
      .populate('collectedBy', 'name email')
      .populate('assignedReceiver', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);

    // Get user's expenses
    const expenses = await Expense.find({ userId })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);

    // Get user's wallet
    const wallet = await Wallet.findOne({ userId });

    // Get user info
    const user = await User.findById(userId);

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      },
      wallet: wallet || null,
      auditLogs,
      transactions,
      collections,
      expenses,
      summary: {
        totalTransactions: transactions.length,
        totalCollections: collections.length,
        totalExpenses: expenses.length,
        totalAuditLogs: auditLogs.length,
        walletBalance: wallet ? wallet.totalBalance : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

