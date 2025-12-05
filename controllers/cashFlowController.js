const CashFlow = require('../models/cashFlowModel');
const { createAuditLog } = require('../utils/auditLogger');
const { emitDashboardUpdate, emitDashboardTotalsUpdate } = require('../utils/socketService');

// @desc    Create cash flow entry
// @route   POST /api/cashflow
// @access  Private
exports.createCashFlow = async (req, res) => {
  try {
    const { type, amount, description } = req.body;

    // Validation
    if (!type || !['in', 'out'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Type must be either "in" or "out"'
      });
    }

    if (!amount || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required and must be positive'
      });
    }

    // Create cash flow entry
    const cashFlowData = {
      type,
      amount,
      description: description || ''
    };

    const cashFlow = await CashFlow.create(cashFlowData);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Created cash flow entry: ${type} ${amount}`,
      'Create',
      'CashFlow',
      cashFlow._id,
      null,
      cashFlow.toObject(),
      req.ip
    );

    // Emit real-time update for dashboard totals
    const totals = await calculateDashboardTotals();
    emitDashboardUpdate({ totals });
    emitDashboardTotalsUpdate(totals);

    res.status(201).json({
      success: true,
      message: 'Cash flow entry created successfully',
      cashFlow
    });
  } catch (error) {
    console.error('Error creating cash flow:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create cash flow entry'
    });
  }
};

// @desc    Get all cash flow entries
// @route   GET /api/cashflow
// @access  Private
exports.getCashFlow = async (req, res) => {
  try {
    const { type, from, to } = req.query;
    const query = {};

    if (type && ['in', 'out'].includes(type)) {
      query.type = type;
    }

    if (from || to) {
      query.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);
        query.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    const cashFlows = await CashFlow.find(query)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: cashFlows.length,
      cashFlows
    });
  } catch (error) {
    console.error('Error getting cash flow:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get cash flow entries'
    });
  }
};

// @desc    Update cash flow entry
// @route   PUT /api/cashflow/:id
// @access  Private
exports.updateCashFlow = async (req, res) => {
  try {
    const { type, amount, description } = req.body;
    const cashFlow = await CashFlow.findById(req.params.id);

    if (!cashFlow) {
      return res.status(404).json({
        success: false,
        message: 'Cash flow entry not found'
      });
    }

    const oldValues = cashFlow.toObject();

    if (type && ['in', 'out'].includes(type)) {
      cashFlow.type = type;
    }

    if (amount !== undefined) {
      if (amount < 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be positive'
        });
      }
      cashFlow.amount = amount;
    }

    if (description !== undefined) {
      cashFlow.description = description || '';
    }

    await cashFlow.save();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated cash flow entry: ${cashFlow._id}`,
      'Update',
      'CashFlow',
      cashFlow._id,
      oldValues,
      cashFlow.toObject(),
      req.ip
    );

    // Emit real-time update
    const totals = await calculateDashboardTotals();
    emitDashboardUpdate({ totals });
    emitDashboardTotalsUpdate(totals);

    res.status(200).json({
      success: true,
      message: 'Cash flow entry updated successfully',
      cashFlow
    });
  } catch (error) {
    console.error('Error updating cash flow:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update cash flow entry'
    });
  }
};

// @desc    Delete cash flow entry
// @route   DELETE /api/cashflow/:id
// @access  Private
exports.deleteCashFlow = async (req, res) => {
  try {
    const cashFlow = await CashFlow.findById(req.params.id);

    if (!cashFlow) {
      return res.status(404).json({
        success: false,
        message: 'Cash flow entry not found'
      });
    }

    const previousState = cashFlow.toObject();
    await cashFlow.deleteOne();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Deleted cash flow entry: ${cashFlow._id}`,
      'Delete',
      'CashFlow',
      cashFlow._id,
      previousState,
      null,
      req.ip
    );

    // Emit real-time update
    const totals = await calculateDashboardTotals();
    emitDashboardUpdate({ totals });
    emitDashboardTotalsUpdate(totals);

    res.status(200).json({
      success: true,
      message: 'Cash flow entry deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting cash flow:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete cash flow entry'
    });
  }
};

/**
 * Calculate dashboard totals (cash in, cash out, balance)
 * @returns {Promise<Object>} - Totals object
 */
const calculateDashboardTotals = async () => {
  const CashFlow = require('../models/cashFlowModel');
  const Expense = require('../models/expenseModel');

  // Get cash flow totals
  const cashFlowIn = await CashFlow.aggregate([
    { $match: { type: 'in' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const cashFlowOut = await CashFlow.aggregate([
    { $match: { type: 'out' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  // Get approved expenses (cash out)
  const approvedExpenses = await Expense.aggregate([
    { $match: { status: { $in: ['Approved', 'Completed'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const cashIn = cashFlowIn[0]?.total || 0;
  const cashFlowOutTotal = cashFlowOut[0]?.total || 0;
  const expensesOut = approvedExpenses[0]?.total || 0;
  const cashOut = cashFlowOutTotal + expensesOut;
  const balance = cashIn - cashOut;

  return {
    cashIn,
    cashOut,
    balance
  };
};

module.exports.calculateDashboardTotals = calculateDashboardTotals;

