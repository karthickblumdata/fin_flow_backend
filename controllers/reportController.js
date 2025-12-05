const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');
const Wallet = require('../models/walletModel');
const User = require('../models/userModel');
const Report = require('../models/reportModel');
const { buildQueryFromFilters, calculateReportSummary, validateReportFilters, generateReportName } = require('../utils/reportHelper');
const { getExpenseReport, getExpenseSummary } = require('../utils/expenseReportHelper');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Get reports
// @route   GET /api/reports
// @access  Private (Admin, SuperAdmin)
exports.getReports = async (req, res) => {
  try {
    const { startDate, endDate, mode, status, category } = req.query;
    const userRole = req.user.role;
    const userId = req.user._id;
    
    // Build base query
    const baseQuery = {};
    if (startDate || endDate) {
      baseQuery.createdAt = {};
      if (startDate) baseQuery.createdAt.$gte = new Date(startDate);
      if (endDate) baseQuery.createdAt.$lte = new Date(endDate);
    }
    if (mode) baseQuery.mode = mode;
    if (status) baseQuery.status = status;

    // Build separate queries for each type
    const transactionQuery = { ...baseQuery };
    const collectionQuery = { ...baseQuery };
    const expenseQuery = { ...baseQuery };
    
    // Add category filter for expenses if provided
    if (category) {
      expenseQuery.category = category;
    }

    // User-specific filtering: Non-SuperAdmin users see only their own expenses
    // SuperAdmin can see all expenses
    if (userRole !== 'SuperAdmin') {
      // Filter expenses - only show expenses for the logged-in user
      expenseQuery.userId = userId;
      
      // Filter transactions - show transactions where user is sender or receiver
      transactionQuery.$or = [
        { sender: userId },
        { receiver: userId }
      ];
      
      // Filter collections - show collections where user is collector or assigned receiver
      collectionQuery.$or = [
        { collectedBy: userId },
        { assignedReceiver: userId }
      ];
    }

    const [transactions, collections, expenses] = await Promise.all([
      Transaction.find(transactionQuery)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .sort({ createdAt: -1 }),
      Collection.find(collectionQuery)
        .populate('collectedBy', 'name email')
        .populate('assignedReceiver', 'name email')
        .sort({ createdAt: -1 }),
      Expense.find(expenseQuery)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
    ]);

    // Calculate totals
    const totalTransactions = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCollections = collections.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Calculate cash in/out balances
    let cashIn = 0;
    let cashOut = 0;
    
    // Collections = Cash In (only approved/verified)
    collections.forEach(col => {
      if (col.status === 'Verified' || col.status === 'Approved') {
        cashIn += col.amount || 0;
      }
    });
    
    // Expenses = Cash Out (only approved/completed)
    expenses.forEach(exp => {
      if (exp.status === 'Approved' || exp.status === 'Completed') {
        cashOut += exp.amount || 0;
      }
    });
    
    // Transactions = depends on direction (for now, treat as cash out)
    transactions.forEach(tx => {
      // Transactions typically represent transfers, which are cash out
      if (tx.status === 'Approved' || tx.status === 'Completed') {
        cashOut += tx.amount || 0;
      }
    });
    
    const balance = cashIn - cashOut;
    const netFlow = totalCollections - totalExpenses;

    res.status(200).json({
      success: true,
      report: {
        transactions: {
          count: transactions.length,
          total: totalTransactions,
          data: transactions
        },
        collections: {
          count: collections.length,
          total: totalCollections,
          data: collections
        },
        expenses: {
          count: expenses.length,
          total: totalExpenses,
          data: expenses
        },
        summary: {
          cashIn,
          cashOut,
          balance,
          netFlow,
          totalExpenses,
          totalCollections,
          totalTransactions
        },
        netFlow
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get person-wise reports
// @route   GET /api/reports/person-wise
// @access  Private (Admin, SuperAdmin)
exports.getPersonWiseReports = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateQuery = {};

    if (startDate || endDate) {
      dateQuery.createdAt = {};
      if (startDate) dateQuery.createdAt.$gte = new Date(startDate);
      if (endDate) dateQuery.createdAt.$lte = new Date(endDate);
    }

    const users = await User.find();
    const personWiseData = [];

    for (const user of users) {
      const wallet = await Wallet.findOne({ userId: user._id });
      const sentTransactions = await Transaction.find({
        sender: user._id,
        ...dateQuery
      });
      const receivedTransactions = await Transaction.find({
        receiver: user._id,
        ...dateQuery
      });
      const collections = await Collection.find({
        collectedBy: user._id,
        ...dateQuery
      });
      const expenses = await Expense.find({
        userId: user._id,
        ...dateQuery
      });

      personWiseData.push({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        walletBalance: wallet ? wallet.totalBalance : 0,
        totalSent: sentTransactions.reduce((sum, t) => sum + t.amount, 0),
        totalReceived: receivedTransactions.reduce((sum, t) => sum + t.amount, 0),
        totalCollections: collections.reduce((sum, c) => sum + c.amount, 0),
        totalExpenses: expenses.reduce((sum, e) => sum + e.amount, 0),
        transactionCount: sentTransactions.length + receivedTransactions.length,
        collectionCount: collections.length,
        expenseCount: expenses.length
      });
    }

    res.status(200).json({
      success: true,
      count: personWiseData.length,
      personWiseReports: personWiseData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Save expense report
// @route   POST /api/reports/save
// @access  Private (SuperAdmin)
exports.saveReport = async (req, res) => {
  try {
    const { reportName, filters, includeFullData, isTemplate, tags, notes } = req.body;

    // Validate required fields
    if (!reportName || reportName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Report name is required'
      });
    }

    // Validate filters
    const validation = validateReportFilters(filters || {});
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    // Build query from filters
    const query = buildQueryFromFilters(filters || {});

    // Fetch current data
    const [expenses, transactions, collections] = await Promise.all([
      Expense.find(query).select('_id').lean(),
      Transaction.find(query).select('_id').lean(),
      Collection.find(query).select('_id').lean()
    ]);

    // Calculate summary
    const summary = await calculateReportSummary(query);

    // Prepare report data
    const reportData = {
      reportName: reportName.trim(),
      reportType: 'combined',
      createdBy: req.user._id,
      filters: filters || {},
      summary,
      snapshot: {
        expenses: expenses.map(e => e._id),
        transactions: transactions.map(t => t._id),
        collections: collections.map(c => c._id)
      },
      includeFullData: includeFullData || false,
      isTemplate: isTemplate || false,
      tags: tags || [],
      notes: notes || '',
      generatedAt: new Date()
    };

    // Optionally include full data
    if (includeFullData) {
      const [fullExpenses, fullTransactions, fullCollections] = await Promise.all([
        Expense.find(query).populate('userId', 'name email').lean(),
        Transaction.find(query).populate('sender receiver', 'name email').lean(),
        Collection.find(query).populate('collectedBy', 'name email').populate('from', 'name email').populate('assignedReceiver', 'name email').lean()
      ]);

      reportData.fullData = {
        expenses: fullExpenses,
        transactions: fullTransactions,
        collections: fullCollections
      };
    }

    // Save to database
    const savedReport = await Report.create(reportData);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Saved report: ${reportName}`,
      'Create',
      'Report',
      savedReport._id,
      null,
      { reportName, reportType: reportData.reportType },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Report saved successfully',
      report: savedReport
    });
  } catch (error) {
    console.error('Error saving report:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all saved reports
// @route   GET /api/reports/saved
// @access  Private (SuperAdmin)
exports.getSavedReports = async (req, res) => {
  try {
    const { type, template } = req.query;
    const query = { createdBy: req.user._id };

    if (type) {
      query.reportType = type;
    }

    if (template !== undefined) {
      query.isTemplate = template === 'true';
    }

    const reports = await Report.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: reports.length,
      reports
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get specific saved report
// @route   GET /api/reports/saved/:id
// @access  Private (SuperAdmin)
exports.getSavedReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check access (user can only access their own reports or be SuperAdmin)
    if (report.createdBy._id.toString() !== req.user._id.toString() && 
        req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // If full data not included, fetch current data from snapshot IDs
    let reportData = { ...report };

    if (!report.includeFullData || !report.fullData) {
      // Fetch current data from snapshot IDs
      const [expenses, transactions, collections] = await Promise.all([
        Expense.find({ _id: { $in: report.snapshot.expenses } })
          .populate('userId', 'name email')
          .sort({ createdAt: -1 })
          .lean(),
        Transaction.find({ _id: { $in: report.snapshot.transactions } })
          .populate('sender receiver', 'name email')
          .sort({ createdAt: -1 })
          .lean(),
        Collection.find({ _id: { $in: report.snapshot.collections } })
          .populate('collectedBy assignedReceiver', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      ]);

      reportData.fullData = {
        expenses,
        transactions,
        collections
      };
    }

    res.status(200).json({
      success: true,
      report: reportData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update saved report
// @route   PUT /api/reports/saved/:id
// @access  Private (SuperAdmin)
exports.updateSavedReport = async (req, res) => {
  try {
    const { reportName, filters, notes, tags } = req.body;

    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check access
    if (report.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update fields
    if (reportName) report.reportName = reportName.trim();
    if (filters) {
      const validation = validateReportFilters(filters);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.error
        });
      }
      report.filters = filters;
    }
    if (notes !== undefined) report.notes = notes;
    if (tags !== undefined) report.tags = tags;

    await report.save();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated report: ${report.reportName}`,
      'Update',
      'Report',
      report._id,
      null,
      { reportName: report.reportName },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Report updated successfully',
      report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete saved report
// @route   DELETE /api/reports/saved/:id
// @access  Private (SuperAdmin)
exports.deleteSavedReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check access
    if (report.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const reportName = report.reportName;
    await report.deleteOne();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Deleted report: ${reportName}`,
      'Delete',
      'Report',
      report._id,
      { reportName },
      null,
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Duplicate saved report
// @route   POST /api/reports/saved/:id/duplicate
// @access  Private (SuperAdmin)
exports.duplicateSavedReport = async (req, res) => {
  try {
    const originalReport = await Report.findById(req.params.id);

    if (!originalReport) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check access
    if (originalReport.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Create duplicate
    const duplicateData = originalReport.toObject();
    delete duplicateData._id;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    duplicateData.reportName = `${originalReport.reportName} (Copy)`;
    duplicateData.createdBy = req.user._id;
    duplicateData.generatedAt = new Date();

    const duplicatedReport = await Report.create(duplicateData);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Duplicated report: ${originalReport.reportName}`,
      'Create',
      'Report',
      duplicatedReport._id,
      null,
      { reportName: duplicatedReport.reportName },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Report duplicated successfully',
      report: duplicatedReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get report templates
// @route   GET /api/reports/templates
// @access  Private (SuperAdmin)
exports.getReportTemplates = async (req, res) => {
  try {
    const templates = await Report.find({ isTemplate: true })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: templates.length,
      templates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get expense report with filters and aggregations
// @route   GET /api/expenses/report
// @access  Private
exports.getExpenseReport = async (req, res) => {
  try {
    const { from, to, status, category } = req.query;

    const filters = {};
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (status) filters.status = status;
    if (category) filters.category = category;

    const report = await getExpenseReport(filters);

    res.status(200).json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Error getting expense report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expense report'
    });
  }
};

// @desc    Get expense summary for dashboard
// @route   GET /api/expenses/summary
// @access  Private
exports.getExpenseSummary = async (req, res) => {
  try {
    const summary = await getExpenseSummary();

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Error getting expense summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expense summary'
    });
  }
};
