const Expense = require('../models/expenseModel');
const { getExpenseReport, getExpensesWithCursor, getExpenseSummary, mapReportStatusToExpense } = require('../utils/expenseReportHelper');
const { emitExpenseUpdate, emitExpenseReportStatsUpdate, emitExpenseSummaryUpdate } = require('../utils/socketService');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create expense (report endpoint)
// @route   POST /api/expenses/report
// @access  Private
exports.createExpenseReport = async (req, res) => {
  try {
    const { amount, description, category, status } = req.body;

    // Validation
    if (!amount || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required and must be positive'
      });
    }

    if (!status || !['approved', 'unapproved', 'flagged'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be one of: approved, unapproved, flagged'
      });
    }

    // Map report status to expense status
    const expenseStatus = mapReportStatusToExpense(status);

    // Create expense
    const expenseData = {
      userId: req.user._id, // Use current user as default
      amount,
      description: description || '',
      category: category || 'Uncategorized',
      status: expenseStatus,
      mode: 'Cash', // Default mode
      createdBy: req.user._id
    };

    const expense = await Expense.create(expenseData);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Created expense report: ${amount} for ${category || 'Uncategorized'}`,
      'Create',
      'Expense',
      expense._id,
      null,
      expense.toObject(),
      req.ip
    );

    // Emit real-time update
    const expenseForReport = {
      _id: expense._id,
      amount: expense.amount,
      description: expense.description || '',
      category: expense.category || '',
      status: status, // Report status format
      createdAt: expense.createdAt
    };

    emitExpenseUpdate('created', expenseForReport);
    
    // Get updated summary and emit
    const summary = await getExpenseSummary();
    emitExpenseReportStatsUpdate({ summary });
    emitExpenseSummaryUpdate(summary);

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      expense: expenseForReport
    });
  } catch (error) {
    console.error('Error creating expense report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create expense'
    });
  }
};

// @desc    Update expense (report endpoint)
// @route   PUT /api/expenses/report/:id
// @access  Private
exports.updateExpenseReport = async (req, res) => {
  try {
    const { amount, description, category, status } = req.body;
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Store old values
    const oldValues = {
      amount: expense.amount,
      description: expense.description,
      category: expense.category,
      status: expense.status
    };

    // Update fields
    if (amount !== undefined) {
      if (amount < 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be positive'
        });
      }
      expense.amount = amount;
    }

    if (description !== undefined) {
      expense.description = description || '';
    }

    if (category !== undefined) {
      expense.category = category || 'Uncategorized';
    }

    if (status !== undefined) {
      if (!['approved', 'unapproved', 'flagged'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be one of: approved, unapproved, flagged'
        });
      }
      expense.status = mapReportStatusToExpense(status);
    }

    await expense.save();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated expense report: ${expense._id}`,
      'Update',
      'Expense',
      expense._id,
      oldValues,
      expense.toObject(),
      req.ip
    );

    // Emit real-time update
    const expenseForReport = {
      _id: expense._id,
      amount: expense.amount,
      description: expense.description || '',
      category: expense.category || '',
      status: status || (expense.status === 'Approved' || expense.status === 'Completed' ? 'approved' : 
                         expense.status === 'Flagged' ? 'flagged' : 'unapproved'),
      createdAt: expense.createdAt
    };

    emitExpenseUpdate('updated', expenseForReport);
    
    // Get updated summary and emit
    const summary = await getExpenseSummary();
    emitExpenseReportStatsUpdate({ summary });
    emitExpenseSummaryUpdate(summary);

    res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      expense: expenseForReport
    });
  } catch (error) {
    console.error('Error updating expense report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update expense'
    });
  }
};

// @desc    Delete expense (report endpoint)
// @route   DELETE /api/expenses/report/:id
// @access  Private
exports.deleteExpenseReport = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    const previousState = expense.toObject();
    await expense.deleteOne();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Deleted expense report: ${expense._id}`,
      'Delete',
      'Expense',
      expense._id,
      previousState,
      null,
      req.ip
    );

    // Emit real-time update
    emitExpenseUpdate('deleted', {
      _id: previousState._id,
      amount: previousState.amount,
      description: previousState.description || '',
      category: previousState.category || '',
      status: previousState.status === 'Approved' || previousState.status === 'Completed' ? 'approved' : 
              previousState.status === 'Flagged' ? 'flagged' : 'unapproved',
      createdAt: previousState.createdAt
    });
    
    // Get updated summary and emit
    const summary = await getExpenseSummary();
    emitExpenseReportStatsUpdate({ summary });
    emitExpenseSummaryUpdate(summary);

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting expense report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete expense'
    });
  }
};

// @desc    Get paginated expenses (report endpoint)
// @route   GET /api/expenses/report/list
// @access  Private
exports.getExpensesPaginated = async (req, res) => {
  try {
    const { cursor, limit, from, to, status, category } = req.query;

    const filters = {};
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (status) filters.status = status;
    if (category) filters.category = category;

    const result = await getExpensesWithCursor(filters, cursor, limit);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error getting paginated expenses:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expenses'
    });
  }
};

