const Expense = require('../models/expenseModel');
const ExpenseType = require('../models/expenseTypeModel');
const WalletTransaction = require('../models/walletTransactionModel');
const { updateWalletBalance, getOrCreateWallet, updatePaymentModeWalletBalance, getOrCreatePaymentModeWallet } = require('../utils/walletHelper');
const { createAuditLog } = require('../utils/auditLogger');
const { notifyAmountUpdate } = require('../utils/amountUpdateHelper');
const { emitExpenseReportStatsUpdate } = require('../utils/reportUpdateHelper');
const User = require('../models/userModel'); // Added for SuperAdmin notification

// Helper function to create wallet transaction entry
const createWalletTransaction = async (wallet, type, mode, amount, operation, performedBy, options = {}) => {
  try {
    const transaction = await WalletTransaction.create({
      userId: wallet.userId,
      walletId: wallet._id,
      type,
      mode,
      amount,
      operation,
      fromMode: options.fromMode || null,
      toMode: options.toMode || null,
      fromUserId: options.fromUserId || null,
      toUserId: options.toUserId || null,
      relatedId: options.relatedId || null,
      relatedModel: options.relatedModel || null,
      balanceAfter: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: options.notes || '',
      performedBy,
      status: 'completed'
    });

    return transaction;
  } catch (error) {
    console.error('Error creating wallet transaction:', error);
    // Don't throw error, just log it - transaction creation shouldn't break the main operation
    return null;
  }
};

// Helper function to check if user has Smart Approvals permission for a specific action
const hasSmartApprovalsPermission = async (userId, action, itemType = 'expenses') => {
  try {
    // Get fresh user data with permissions
    const freshUser = await User.findById(userId);
    if (!freshUser) {
      return false;
    }
    
    let allPermissions = [];
    
    // Get role-based permissions
    if (freshUser.role && freshUser.role !== 'SuperAdmin') {
      const Role = require('../models/roleModel');
      const role = await Role.findOne({ roleName: freshUser.role });
      if (role && role.permissionIds && role.permissionIds.length > 0) {
        allPermissions = [...role.permissionIds];
      }
    }
    
    // Get user-specific permissions
    const userSpecificPermissions = freshUser.userSpecificPermissions || [];
    allPermissions = [...new Set([...allPermissions, ...userSpecificPermissions])];
    
    // Check if user has smart_approvals permission (parent or child)
    return allPermissions.some(permission => {
      // Check exact match for specific action
      if (permission === `smart_approvals.${itemType}.${action}` ||
          permission === `smart_approvals.${itemType}` ||
          permission === 'smart_approvals') {
        return true;
      }
      
      // Check wildcard
      if (permission === '*') {
        return true;
      }
      
      // Check if user has parent permission that grants access
      if (permission.startsWith(`smart_approvals.${itemType}.${action}`) ||
          permission.startsWith(`smart_approvals.${itemType}.`) ||
          permission.startsWith('smart_approvals.')) {
        return true;
      }
      
      return false;
    });
  } catch (error) {
    console.error('Error checking Smart Approvals permission:', error);
    return false;
  }
};

// @desc    Upload expense proof image
// @route   POST /api/expenses/upload-image
// @access  Private
exports.uploadExpenseProofImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Construct the image URL
    const baseUrl = req.protocol + '://' + req.get('host');
    const imageUrl = `${baseUrl}/uploads/expenses/${req.file.filename}`;

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: imageUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload image'
    });
  }
};

// @desc    Create expense
// @route   POST /api/expenses
// @access  Private
// Helper function to extract mode from payment mode description
const extractModeFromPaymentMode = (paymentMode) => {
  let mode = 'Cash'; // Default
  
  // Extract mode from description
  // Description format: "text|mode:Cash" or "text|mode:UPI" or "text|mode:Bank"
  if (paymentMode.description) {
    const parts = paymentMode.description.split('|');
    for (const part of parts) {
      if (part.includes('mode:')) {
        const modeValue = part.split('mode:')[1]?.trim();
        if (modeValue && ['Cash', 'UPI', 'Bank'].includes(modeValue)) {
          mode = modeValue;
          break;
        }
      }
    }
  }
  
  // Fallback: try to infer from modeName if description doesn't have mode
  if (mode === 'Cash' && paymentMode.modeName) {
    const modeName = paymentMode.modeName.toLowerCase();
    if (modeName.includes('upi')) {
      mode = 'UPI';
    } else if (modeName.includes('bank')) {
      mode = 'Bank';
    }
  }
  
  return mode;
};

exports.createExpense = async (req, res) => {
  try {
    const { userId, category, amount, mode, paymentModeId, description, proofUrl } = req.body;

    // Log user info for debugging
    console.log('\n💰 ===== CREATE EXPENSE REQUEST =====');
    console.log('   User ID:', req.user._id);
    console.log('   User Email:', req.user.email);
    console.log('   User Role:', req.user.role);
    console.log('   Request Body:', {
      userId: userId || 'not provided',
      category: category || 'not provided',
      amount: amount || 'not provided',
      mode: mode || 'not provided',
      description: description ? `${description.length} chars` : 'not provided',
      proofUrl: proofUrl ? 'provided' : 'not provided'
    });
    console.log('=====================================\n');

    // Basic required fields
    if (!category || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide category and amount'
      });
    }

    // Extract mode from paymentMode if not provided, default to Cash
    let finalMode = mode;
    if (!finalMode && paymentModeId) {
      const PaymentMode = require('../models/paymentModeModel');
      const paymentMode = await PaymentMode.findById(paymentModeId);
      if (paymentMode) {
        finalMode = extractModeFromPaymentMode(paymentMode);
      } else {
        finalMode = 'Cash'; // Default to Cash if paymentMode not found
      }
    } else if (!finalMode) {
      finalMode = 'Cash'; // Default to Cash if no paymentModeId provided
    }

    // Validate category name
    const categoryName = category.trim();
    if (!categoryName || categoryName.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Category name cannot be empty'
      });
    }

    if (categoryName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Category name cannot exceed 100 characters'
      });
    }

    // Check if category exists (case-insensitive using regex)
    const categoryNameLower = categoryName.toLowerCase();
    let expenseType = await ExpenseType.findOne({ 
      name: { $regex: new RegExp(`^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    // If category doesn't exist or is inactive, handle it
    if (!expenseType) {
      // Normalize category name (first letter uppercase, rest lowercase)
      const normalizedCategoryName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1).toLowerCase();
      
      try {
        // Create new expense type automatically (minimal fields only)
        expenseType = await ExpenseType.create({
          name: normalizedCategoryName,
          isActive: true,
          createdBy: req.user._id
        });

        // Emit real-time update for expense type creation
        const { emitExpenseTypeUpdate } = require('../utils/socketService');
        emitExpenseTypeUpdate('created', expenseType.toObject());

        console.log(`✅ Auto-created expense type: ${normalizedCategoryName}`);
      } catch (error) {
        console.error(`❌ Error creating expense type: ${normalizedCategoryName}`, error);
        
        // Handle duplicate key error (race condition - category created by another request)
        if (error.code === 11000) {
          // Try to find the category again (race condition - category created by another request)
          expenseType = await ExpenseType.findOne({ 
            name: { $regex: new RegExp(`^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });
          
          if (!expenseType) {
            console.error(`❌ Failed to find expense type after duplicate key error: ${normalizedCategoryName}`);
            return res.status(500).json({
              success: false,
              message: 'Failed to create expense type. Please try again.'
            });
          }
        } else {
          // For any other error, return proper error response
          console.error(`❌ Unexpected error creating expense type: ${error.message}`);
          return res.status(500).json({
            success: false,
            message: `Failed to create expense type: ${error.message || 'Unknown error'}. Please try again.`
          });
        }
      }
    } else if (!expenseType.isActive) {
      // Reactivate inactive category
      try {
        expenseType.isActive = true;
        // Update name to match provided case if different
        if (expenseType.name.toLowerCase() !== categoryNameLower) {
          expenseType.name = categoryName.charAt(0).toUpperCase() + categoryName.slice(1).toLowerCase();
        }
        await expenseType.save();

        // Emit real-time update for expense type update
        const { emitExpenseTypeUpdate } = require('../utils/socketService');
        emitExpenseTypeUpdate('updated', expenseType.toObject());

        console.log(`✅ Reactivated expense type: ${expenseType.name}`);
      } catch (error) {
        console.error(`❌ Error reactivating expense type: ${expenseType.name}`, error);
        return res.status(500).json({
          success: false,
          message: `Failed to reactivate expense type: ${error.message || 'Unknown error'}. Please try again.`
        });
      }
    }

    // Validate expenseType exists before proceeding (safety check)
    if (!expenseType || !expenseType.name) {
      console.error(`❌ Expense type is null or invalid after processing: ${categoryName}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to process expense type. Please try again.'
      });
    }

    // Use the category name from expense type (normalized)
    const finalCategoryName = expenseType.name;

    // Description is optional for all users (can be empty)
    // All authenticated users can create expenses without description

    // Determine the target user ID
    // Admin/SuperAdmin can specify userId to create expense for other users
    // Staff can only create expenses for themselves
    let targetUserId = req.user._id;
    
    if (userId && (req.user.role === 'Admin' || req.user.role === 'SuperAdmin')) {
      targetUserId = userId;
    } else if (userId && req.user.role === 'Staff') {
      return res.status(403).json({
        success: false,
        message: 'Staff can only create expenses for themselves'
      });
    }

    // Get target user to check active status
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Check if target user is active
    if (!targetUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'User is inactive. Only active users can have expenses created for them.'
      });
    }

    // Prepare expense data (use normalized category name)
    const expenseData = {
      userId: targetUserId,
      category: finalCategoryName,
      amount,
      mode: finalMode,
      paymentModeId: paymentModeId || null,
      createdBy: req.user._id,
      status: 'Pending'
    };

    // Handle description - optional for all users (can be empty)
    if (description && description.trim() !== '') {
      expenseData.description = description.trim();
    } else {
      // All users can have empty description
      expenseData.description = '';
    }

    // Handle proofUrl - optional for all
    if (proofUrl && proofUrl.trim() !== '') {
      expenseData.proofUrl = proofUrl.trim();
    } else {
      expenseData.proofUrl = null;
    }

    // Create expense with proper error handling
    let expense;
    try {
      expense = await Expense.create(expenseData);
      
      // Validate expense was created successfully
      if (!expense || !expense._id) {
        console.error(`❌ Expense creation failed - expense object is invalid`);
        return res.status(500).json({
          success: false,
          message: 'Failed to create expense. Please try again.'
        });
      }
      
      console.log(`✅ Expense created successfully: ${expense._id} for user ${targetUserId}`);
    } catch (error) {
      console.error(`❌ Error creating expense:`, error);
      return res.status(500).json({
        success: false,
        message: `Failed to create expense: ${error.message || 'Unknown error'}. Please try again.`
      });
    }

    // Create audit log with error handling
    try {
      await createAuditLog(
        req.user._id,
        `Created expense: ${amount} ${mode} for ${finalCategoryName}`,
        'Create',
        'Expense',
        expense._id,
        null,
        expense.toObject(),
        req.ip
      );
    } catch (auditError) {
      // Log audit error but don't fail the request
      console.error(`⚠️ Error creating audit log for expense ${expense._id}:`, auditError);
    }

    // Emit real-time update for expense creation (to all connected clients)
    // Wrap in try-catch to prevent socket errors from failing the request
    try {
      const expenseUser = await User.findById(targetUserId);
      await notifyAmountUpdate('expense_created', {
        expenseId: expense._id,
        userId: targetUserId,
        userName: expenseUser?.name || 'Unknown',
        amount,
        mode,
        category: finalCategoryName,
        description,
        status: 'Pending',
        createdBy: req.user._id
      });
    } catch (socketError) {
      console.error(`⚠️ Error emitting expense_created notification:`, socketError);
      // Continue - don't fail the request for socket errors
    }
    
    // Also emit specific expense event for real-time updates (for expense report)
    try {
      const { emitExpenseUpdate } = require('../utils/socketService');
      const expenseWithUser = await Expense.findById(expense._id).populate('userId createdBy');
      emitExpenseUpdate('created', expenseWithUser?.toObject() || expense.toObject());
    } catch (socketError) {
      console.error(`⚠️ Error emitting expense update:`, socketError);
      // Continue - don't fail the request for socket errors
    }

    // Emit expense report stats update for real-time report updates
    try {
      await emitExpenseReportStatsUpdate();
    } catch (socketError) {
      console.error(`⚠️ Error emitting expense report stats update:`, socketError);
      // Continue - don't fail the request for socket errors
    }

    // Emit dashboard summary update
    try {
      const { emitDashboardSummaryUpdate } = require('../utils/socketService');
      emitDashboardSummaryUpdate({ refresh: true });
    } catch (socketError) {
      console.error(`⚠️ Error emitting dashboard summary update:`, socketError);
      // Continue - don't fail the request for socket errors
    }

    // Final validation - ensure expense exists before sending response
    if (!expense || !expense._id) {
      console.error(`❌ Expense validation failed before sending response`);
      return res.status(500).json({
        success: false,
        message: 'Expense was not created properly. Please try again.'
      });
    }

    // Send success response
    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      expense
    });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create expense. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Get expenses
// @route   GET /api/expenses
// @access  Private
exports.getExpenses = async (req, res) => {
  try {
    const { userId, status, category, mode } = req.query;
    const query = {};

    // Check if user is admin@examples.com (protected user) - can see all expenses
    const isProtectedUser = req.user.email === 'admin@examples.com';

    // Authorization: Staff users can ONLY see their own expenses
    if (!isProtectedUser && req.user.role === 'Staff') {
      query.userId = req.user._id;
      // Ignore userId from query params - Staff can only view their own expenses
    } else if (userId && !isProtectedUser) {
      // For non-Staff, non-SuperAdmin users (like Admin), validate they can only view their own
      if (req.user.role !== 'SuperAdmin' && userId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only view your own expenses'
        });
      }
      query.userId = userId;
    } else if (userId && req.user.role === 'SuperAdmin') {
      // SuperAdmin can view any user's expenses
      query.userId = userId;
    }
    // If admin@examples.com (protected user), show all expenses (no userId filter unless explicitly requested)
    // If SuperAdmin with no userId, show all expenses

    if (status) query.status = status;
    if (category) query.category = category;
    if (mode) query.mode = mode;

    const expenses = await Expense.find(query)
      .populate('userId', 'name email role')
      .populate('createdBy', 'name email role')
      .populate('approvedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: expenses.length,
      expenses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Approve expense
// @route   POST /api/expenses/:id/approve
// @access  Private (Admin, SuperAdmin)
exports.approveExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Allow approving Pending or Flagged expenses
    // If fromAllWalletReport is true, allow approval regardless of status
    if (!fromAllWalletReport && expense.status !== 'Pending' && expense.status !== 'Flagged') {
      return res.status(400).json({
        success: false,
        message: `Expense is already ${expense.status}. Only Pending or Flagged expenses can be approved.`
      });
    }

    // Prevent self-approval: If the logged-in person is the creator or expense owner, they cannot approve their own expense
    // Exception: Super Admin can approve their own expenses
    const isAdminOrSuperAdmin = req.user.role === 'Admin' || req.user.role === 'SuperAdmin';
    const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id : expense.userId;
    const createdByUserId = expense.createdBy ? expense.createdBy.toString() : null;
    const approverUserId = req.user._id.toString();
    
    const isSelfOwner = expenseUserId && expenseUserId.toString() === approverUserId;
    const isSelfCreator = createdByUserId && createdByUserId === approverUserId;
    
    if (!isAdminOrSuperAdmin && (isSelfOwner || isSelfCreator)) {
      return res.status(403).json({
        success: false,
        message: 'You cannot approve your own expense. Only other users can approve expenses you created.'
      });
    }

    // Authorization: ALL authenticated users can approve expenses (except self-approval which is already handled above)
    // No additional permission check needed - any user can approve any expense (except their own)

    const userId = expenseUserId;
    const previousStatus = expense.status;
    
    // Check if expense is already approved (for All Wallet Report - prevent double wallet update)
    const wasAlreadyApproved = expense.status === 'Approved';
    
    // ============================================================================
    // EXPENSE APPROVAL WALLET LOGIC: Payment Mode Account pays Expense Owner (reimbursement)
    // ============================================================================
    // When approver approves expense owner's expense:
    // 1. Subtract from Payment Mode's wallet (account pays for the expense)
    // 2. Add to expense owner's wallet (expense owner receives reimbursement)
    // 
    // Example:
    // - User 2 creates expense for ₹10 with Payment Mode "Cash Mode" (Active, Collection)
    // - Payment Mode has balance: ₹1000
    // - User 1 approves
    // - Payment Mode wallet: Cash Out -₹10 (₹1000 → ₹990)
    // - User 2 wallet: Cash In +₹10 (reimbursement)
    // - User 1 wallet: No change (Approver not affected)
    // ============================================================================
    
    // Always use Payment Mode index 0 (first ACTIVE Payment Mode created) for expense approval
    const PaymentMode = require('../models/paymentModeModel');
    
    // Get the first ACTIVE Payment Mode (index 0) sorted by createdAt ascending
    const firstPaymentMode = await PaymentMode.findOne({ isActive: true }).sort({ createdAt: 1 });
    
    console.log(`[Expense Approval] 🔍 Looking for Payment Mode index 0 (first active)...`);
    if (firstPaymentMode) {
      console.log(`   ✅ Found Payment Mode index 0: ${firstPaymentMode.modeName} (ID: ${firstPaymentMode._id})`);
      console.log(`   - isActive: ${firstPaymentMode.isActive}`);
      console.log(`   - Display: ${JSON.stringify(firstPaymentMode.display)}`);
      console.log(`   - Created At: ${firstPaymentMode.createdAt}`);
    } else {
      console.log(`   ❌ No active Payment Mode found`);
    }
    
    // Only update wallet if not already approved (prevent double wallet update)
    if (!wasAlreadyApproved) {
      if (!firstPaymentMode) {
        return res.status(404).json({
          success: false,
          message: 'No active Payment Mode found. Please create and activate a Payment Mode first.'
        });
      }
      
      // Explicitly check if Payment Mode is active (defensive check)
      if (!firstPaymentMode.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Payment Mode is not active. Please activate the Payment Mode before approving expenses.'
        });
      }
      
      // Check if Payment Mode has Collection in display (required for expense payments)
      const hasCollectionDisplay = firstPaymentMode.display && firstPaymentMode.display.includes('Collection');
      if (!hasCollectionDisplay) {
        return res.status(400).json({
          success: false,
          message: 'First Payment Mode must have Collection display enabled to pay for expenses.'
        });
      }
      
      // Extract mode from first Payment Mode's description (default to 'Cash' if not found)
      let expenseMode = 'Cash';
      if (firstPaymentMode.description) {
        const modeMatch = firstPaymentMode.description.match(/mode:(\w+)/i);
        if (modeMatch && modeMatch[1]) {
          expenseMode = modeMatch[1];
        }
      }
      
      // 1. Subtract from Payment Mode index 0's wallet (account pays for the expense)
      await updatePaymentModeWalletBalance(firstPaymentMode._id, expenseMode, expense.amount, 'subtract', 'expense');
      console.log(`[Expense Approval] ✅ Deducted ₹${expense.amount} from Payment Mode index 0 wallet (${firstPaymentMode.modeName})`);
      
      // 2. Add to expense owner's wallet (expense owner receives reimbursement)
      await updateWalletBalance(userId, expenseMode, expense.amount, 'add', 'expense_reimbursement');
      console.log(`[Expense Approval] ✅ Added ₹${expense.amount} to expense owner wallet (${userId})`);
    } else {
      console.log(`[Expense Approval] ⚠️  Expense was already approved - skipping wallet update to prevent double update`);
    }

    // Get updated wallets for notification
    let paymentModeWallet = null;
    if (firstPaymentMode) {
      paymentModeWallet = await getOrCreatePaymentModeWallet(firstPaymentMode._id);
    }
    const userWallet = await getOrCreateWallet(userId);

    expense.status = 'Approved';
    expense.approvedBy = req.user._id;
    expense.approvedAt = new Date();
    await expense.save();

    // Create WalletTransaction entries with accountId in notes
    // Build notes with accountId from Payment Mode index 0
    let approverNotes = `Expense approved: ${expense.category || 'Expense'}`;
    let ownerNotes = `Expense reimbursement: ${expense.category || 'Expense'}`;
    
    if (firstPaymentMode) {
      const accountIdStr = firstPaymentMode._id.toString();
      approverNotes = `${approverNotes} - account ${accountIdStr}`;
      ownerNotes = `${ownerNotes} - account ${accountIdStr}`;
    }

    // Note: Payment Mode wallet transactions are tracked in Payment Mode model itself
    // No separate WalletTransaction entry needed for Payment Mode (it's not a user wallet)

    // Create WalletTransaction entry for expense owner (money added)
    await createWalletTransaction(
      userWallet,
      'expense',
      expense.mode,
      expense.amount,
      'add',
      req.user._id,
      {
        relatedId: expense._id,
        relatedModel: 'Expense',
        notes: ownerNotes
      }
    );

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Approved expense: ${expense._id} (Admin paid ${expense.amount} ${expense.mode} to user)`,
      'Approve',
      'Expense',
      expense._id,
      { status: previousStatus },
      { status: 'Approved' },
      req.ip
    );

    // Emit real-time update to super admin
    const expenseUserObj = typeof expense.userId === 'object' ? expense.userId : null;
    const adminUserObj = await User.findById(req.user._id);
    
    await notifyAmountUpdate('expense', {
      expenseId: expense._id,
      userId,
      userName: expenseUserObj?.name || 'Unknown',
      amount: expense.amount,
      mode: expense.mode,
      category: expense.category,
      description: expense.description,
      status: 'Approved',
      wallet: {
        cashBalance: userWallet.cashBalance,
        upiBalance: userWallet.upiBalance,
        bankBalance: userWallet.bankBalance,
        totalBalance: userWallet.totalBalance
      },
      adminWallet: {
        cashBalance: adminWallet.cashBalance,
        upiBalance: adminWallet.upiBalance,
        bankBalance: adminWallet.bankBalance,
        totalBalance: adminWallet.totalBalance
      },
      approvedBy: req.user._id,
      adminName: adminUserObj?.name || 'Unknown'
    });

    // Emit self wallet update to expense owner
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(userId.toString(), {
      type: 'expense_approved',
      wallet: {
        cashBalance: userWallet.cashBalance,
        upiBalance: userWallet.upiBalance,
        bankBalance: userWallet.bankBalance,
        totalBalance: userWallet.totalBalance
      },
    });

    // Emit expense update event for real-time updates
    const { emitExpenseUpdate } = require('../utils/socketService');
    const expenseWithUser = await Expense.findById(expense._id)
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .lean();
    emitExpenseUpdate('approved', expenseWithUser || expense.toObject());

    // Update saved reports with this approved expense
    const { updateSavedReportsForExpense } = require('../utils/reportHelper');
    await updateSavedReportsForExpense(expenseWithUser || expense.toObject());

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense approved successfully',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reject expense
// @route   POST /api/expenses/:id/reject
// @access  Private (Admin, SuperAdmin)
exports.rejectExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Store previous status for audit log and wallet reversal
    const previousStatus = expense.status;
    
    // Allow rejecting approved expenses (with wallet reversal)
    // Only prevent rejection if already rejected
    if (expense.status === 'Rejected') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject expense that is already Rejected`
      });
    }

    // Get creator info
    const creator = await User.findById(expense.createdBy);
    const isCreatedBySuperAdmin = creator?.role === 'SuperAdmin';
    
    // Check authorization: Admin/SuperAdmin can always reject, or receiver (userId) can reject if created by Super Admin
    const isAdminOrSuperAdmin = req.user.role === 'Admin' || req.user.role === 'SuperAdmin';
    const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id : expense.userId;
    const isReceiver = expenseUserId.toString() === req.user._id.toString();
    
    // Check if user has Smart Approvals permission to reject expenses
    const hasSmartApprovalsPerm = !isAdminOrSuperAdmin 
      ? await hasSmartApprovalsPermission(req.user._id, 'reject', 'expenses')
      : false;
    
    if (!isAdminOrSuperAdmin && !hasSmartApprovalsPerm && !(isCreatedBySuperAdmin && isReceiver)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject this expense. Only Admin/SuperAdmin, users with Smart Approvals permission, or the receiver (for expenses created by Super Admin) can reject expenses.'
      });
    }

    // If expense was approved, reverse wallet changes before rejecting
    const wasApproved = expense.status === 'Approved' || expense.status === 'Completed';
    if (wasApproved) {
      // Reverse Payment Mode wallet (add back the amount that was deducted) - use Payment Mode index 0
      const PaymentMode = require('../models/paymentModeModel');
      const firstPaymentMode = await PaymentMode.findOne({ isActive: true }).sort({ createdAt: 1 });
      if (firstPaymentMode) {
        const hasCollectionDisplay = firstPaymentMode.display && firstPaymentMode.display.includes('Collection');
        if (hasCollectionDisplay) {
          // Extract mode from first Payment Mode's description (default to 'Cash' if not found)
          let expenseMode = 'Cash';
          if (firstPaymentMode.description) {
            const modeMatch = firstPaymentMode.description.match(/mode:(\w+)/i);
            if (modeMatch && modeMatch[1]) {
              expenseMode = modeMatch[1];
            }
          }
          await updatePaymentModeWalletBalance(firstPaymentMode._id, expenseMode, expense.amount, 'add', 'expense_rejection');
          console.log(`[Expense Reject] Reversed Payment Mode wallet: +₹${expense.amount} to Payment Mode index 0 (${firstPaymentMode.modeName})`);
        }
      }
      
      // Reverse expense owner wallet (subtract the reimbursement that was added)
      await updateWalletBalance(expenseUserId, expense.mode, expense.amount, 'subtract', 'expense_rejection');
      console.log(`[Expense Reject] Reversed expense owner wallet: -₹${expense.amount} from expense owner (${expenseUserId})`);
    }

    expense.status = 'Rejected';
    // Clear approval fields when rejecting an approved expense
    if (wasApproved) {
      expense.approvedBy = undefined;
      expense.approvedAt = undefined;
    }
    await expense.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Rejected expense: ${expense._id}`,
      'Reject',
      'Expense',
      expense._id,
      { status: previousStatus },
      { status: 'Rejected' },
      req.ip,
      req.body.reason
    );

    // Emit real-time update if SuperAdmin rejected expense
    if (req.user.role === 'SuperAdmin') {
      const expenseUserObj = typeof expense.userId === 'object' ? expense.userId : null;
      
      await notifyAmountUpdate('expense_rejected', {
        expenseId: expense._id,
        userId: expenseUserObj?._id || expense.userId,
        userName: expenseUserObj?.name || 'Unknown',
        amount: expense.amount,
        mode: expense.mode,
        category: expense.category,
        description: expense.description,
        status: 'Rejected',
        reason: req.body.reason,
        rejectedBy: req.user._id
      });
    }

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense rejected successfully',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Unapprove expense
// @route   POST /api/expenses/:id/unapprove
// @access  Private (Admin, SuperAdmin)
exports.unapproveExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Only allow unapproving approved expenses
    if (!fromAllWalletReport && expense.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: `Expense is ${expense.status}. Only Approved expenses can be unapproved.`
      });
    }

    // Check if expense was approved
    const wasApproved = expense.status === 'Approved';
    if (!wasApproved) {
      return res.status(400).json({
        success: false,
        message: 'Expense is not approved. Only approved expenses can be unapproved.'
      });
    }

    const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id : expense.userId;
    const previousStatus = expense.status;
    
    // Reverse Payment Mode wallet (add back the amount that was deducted) - use Payment Mode index 0
    let paymentModeWallet = null;
    const PaymentMode = require('../models/paymentModeModel');
    const firstPaymentMode = await PaymentMode.findOne({ isActive: true }).sort({ createdAt: 1 });
    if (firstPaymentMode && firstPaymentMode.isActive) {
      const hasCollectionDisplay = firstPaymentMode.display && firstPaymentMode.display.includes('Collection');
      if (hasCollectionDisplay) {
        // Extract mode from first Payment Mode's description (default to 'Cash' if not found)
        let expenseMode = 'Cash';
        if (firstPaymentMode.description) {
          const modeMatch = firstPaymentMode.description.match(/mode:(\w+)/i);
          if (modeMatch && modeMatch[1]) {
            expenseMode = modeMatch[1];
          }
        }
        paymentModeWallet = await updatePaymentModeWalletBalance(firstPaymentMode._id, expenseMode, expense.amount, 'add', 'expense_reversal');
        console.log(`[Expense Unapprove] Reversed Payment Mode wallet: +₹${expense.amount} to Payment Mode index 0 (${firstPaymentMode.modeName})`);
      }
    }
    
    // Reverse expense owner wallet (subtract the reimbursement that was added)
    await updateWalletBalance(expenseUserId, expense.mode, expense.amount, 'subtract', 'expense_reversal');
    console.log(`[Expense Unapprove] Reversed expense owner wallet: -₹${expense.amount} from expense owner (${expenseUserId})`);

    // Get updated wallets for notification
    const userWallet = await getOrCreateWallet(expenseUserId);

    // Update expense status to Pending
    expense.status = 'Pending';
    expense.approvedBy = undefined;
    expense.approvedAt = undefined;
    await expense.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Unapproved expense: ${expense._id} (Reversed wallet: +₹${expense.amount} to Payment Mode, -₹${expense.amount} from expense owner)`,
      'Unapprove',
      'Expense',
      expense._id,
      { status: previousStatus },
      { status: 'Pending' },
      req.ip
    );

    // Emit real-time update
    const expenseUserObj = typeof expense.userId === 'object' ? expense.userId : null;
    const adminUserObj = await User.findById(req.user._id);
    
    await notifyAmountUpdate('expense_unapproved', {
      expenseId: expense._id,
      userId: expenseUserId,
      userName: expenseUserObj?.name || 'Unknown',
      amount: expense.amount,
      mode: expense.mode,
      category: expense.category,
      description: expense.description,
      status: 'Pending',
      wallet: {
        cashBalance: userWallet.cashBalance,
        upiBalance: userWallet.upiBalance,
        bankBalance: userWallet.bankBalance,
        totalBalance: userWallet.totalBalance
      },
      paymentModeWallet: paymentModeWallet ? {
        cashBalance: paymentModeWallet.cashBalance,
        upiBalance: paymentModeWallet.upiBalance,
        bankBalance: paymentModeWallet.bankBalance,
        totalBalance: paymentModeWallet.totalBalance,
        cashIn: paymentModeWallet.cashIn,
        cashOut: paymentModeWallet.cashOut
      } : null,
      unapprovedBy: req.user._id,
      adminName: adminUserObj?.name || 'Unknown'
    });

    // Emit self wallet update to expense owner
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(expenseUserId.toString(), {
      type: 'expense_unapproved',
      wallet: {
        cashBalance: userWallet.cashBalance,
        upiBalance: userWallet.upiBalance,
        bankBalance: userWallet.bankBalance,
        totalBalance: userWallet.totalBalance
      },
    });

    // Emit expense update event for real-time updates
    const { emitExpenseUpdate } = require('../utils/socketService');
    const expenseWithUser = await Expense.findById(expense._id)
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .lean();
    emitExpenseUpdate('unapproved', expenseWithUser || expense.toObject());

    // Update saved reports with this unapproved expense
    const { updateSavedReportsForExpense } = require('../utils/reportHelper');
    await updateSavedReportsForExpense(expenseWithUser || expense.toObject());

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense unapproved successfully. Wallet reversed for both approver and expense owner.',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Flag expense
// @route   POST /api/expenses/:id/flag
// @access  Private (Admin, SuperAdmin)
exports.flagExpense = async (req, res) => {
  try {
    const { flagReason } = req.body;

    if (!flagReason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a flag reason'
      });
    }

    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    expense.status = 'Flagged';
    expense.flagReason = flagReason;
    expense.flaggedBy = req.user._id;
    expense.flaggedAt = new Date();
    await expense.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Flagged expense: ${expense._id}`,
      'Flag',
      'Expense',
      expense._id,
      { status: expense.status },
      { status: 'Flagged', flagReason },
      req.ip
    );

    // Emit real-time update if SuperAdmin flagged expense
    if (req.user.role === 'SuperAdmin') {
      const expenseUserObj = typeof expense.userId === 'object' ? expense.userId : null;
      
      await notifyAmountUpdate('expense_flagged', {
        expenseId: expense._id,
        userId: expenseUserObj?._id || expense.userId,
        userName: expenseUserObj?.name || 'Unknown',
        amount: expense.amount,
        mode: expense.mode,
        category: expense.category,
        description: expense.description,
        status: 'Flagged',
        flagReason,
        flaggedBy: req.user._id
      });
    }

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense flagged successfully',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Resubmit flagged expense
// @route   POST /api/expenses/:id/resubmit
// @access  Private (All authenticated users - can resubmit their own flagged expenses)
exports.resubmitExpense = async (req, res) => {
  try {
    const { response } = req.body;

    if (!response || !response.trim() || response.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a response'
      });
    }

    const expense = await Expense.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .populate('flaggedBy', 'name email role');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    if (expense.status !== 'Flagged') {
      return res.status(400).json({
        success: false,
        message: 'Only flagged expenses can be resubmitted'
      });
    }

    // Check authorization: User can resubmit their own expenses, or Admin/SuperAdmin/wallet.all.expenses permission can resubmit any
    const isOwner = expense.userId._id.toString() === req.user._id.toString() ||
                     expense.createdBy._id.toString() === req.user._id.toString();
    const isAdminOrSuperAdmin = req.user.role === 'Admin' || req.user.role === 'SuperAdmin';
    
    // Check if user has wallet.all.expenses permission
    let hasWalletExpensePermission = false;
    if (req.user.role && req.user.role !== 'SuperAdmin') {
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: req.user.role });
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          const allPermissions = [...(role.permissionIds || []), ...(req.user.userSpecificPermissions || [])];
          hasWalletExpensePermission = allPermissions.some(permission => {
            return permission === 'wallet.all.expenses' ||
                   permission === 'wallet.all' ||
                   permission.startsWith('wallet.all.expenses.');
          });
        }
      } catch (error) {
        console.error('Error checking wallet permissions for resubmit:', error);
      }
    }

    if (!isOwner && !isAdminOrSuperAdmin && !hasWalletExpensePermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resubmit this expense'
      });
    }

    // Save response and change status back to Pending
    expense.response = response.trim();
    expense.responseDate = new Date();
    expense.status = 'Pending';
    await expense.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Resubmitted flagged expense: ${expense._id}`,
      'Resubmit',
      'Expense',
      expense._id,
      { status: 'Flagged' },
      { status: 'Pending', response: expense.response },
      req.ip
    );

    // Emit expense update event for real-time updates
    const { emitExpenseUpdate } = require('../utils/socketService');
    const expenseWithUser = await Expense.findById(expense._id)
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .populate('flaggedBy', 'name email role')
      .lean();
    emitExpenseUpdate('resubmitted', expenseWithUser || expense.toObject());

    res.status(200).json({
      success: true,
      message: 'Expense resubmitted successfully',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update expense
// @route   PUT /api/expenses/:id
// @access  Private (Admin, SuperAdmin)
exports.updateExpense = async (req, res) => {
  try {
    // Validate expense ID
    if (!req.params.id || req.params.id === 'null' || req.params.id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense ID. Expense ID is required to update an expense.'
      });
    }

    const { category, amount, mode, description, proofUrl, status } = req.body;
    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      // Only allow editing if expense is Pending, Rejected, or Flagged
      if (expense.status !== 'Pending' && expense.status !== 'Rejected' && expense.status !== 'Flagged') {
        return res.status(400).json({
          success: false,
          message: `Cannot edit expense with status: ${expense.status}. Only Pending, Rejected, or Flagged expenses can be edited.`
        });
      }
    }
    // If fromAllWalletReport is true, allow editing regardless of status

    // Authorization is handled by route middleware (authorizeByAnyPermission)
    // Users with 'expenses.manage' or 'wallet.all.expenses.edit' permission, or Admin/SuperAdmin roles can edit

    // Store old values for audit log
    const oldValues = {
      category: expense.category,
      amount: expense.amount,
      mode: expense.mode,
      description: expense.description,
      proofUrl: expense.proofUrl
    };

    // Update fields if provided
    if (category) {
      // Validate that the category exists in ExpenseType
      const expenseType = await ExpenseType.findOne({ 
        name: category.trim(),
        isActive: true 
      });

      if (!expenseType) {
        return res.status(400).json({
          success: false,
          message: `Invalid expense category. The category "${category}" does not exist or is not active. Please select a valid expense type.`
        });
      }
      expense.category = category.trim();
    }
    if (amount !== undefined && amount !== null) expense.amount = amount;
    if (mode) expense.mode = mode;
    if (description !== undefined) {
      // Allow empty description for SuperAdmin
      if (req.user.role === 'SuperAdmin') {
        expense.description = description || '';
      } else if (description && description.trim() !== '') {
        expense.description = description.trim();
      }
    }
    if (proofUrl !== undefined) {
      expense.proofUrl = proofUrl && proofUrl.trim() !== '' ? proofUrl.trim() : null;
    }
    
    // Handle status update (for unapprove and other status changes)
    // Only allow status updates if fromAllWalletReport is true
    if (status !== undefined && fromAllWalletReport) {
      const validStatuses = ['Pending', 'Approved', 'Rejected', 'Flagged', 'Unapproved'];
      if (validStatuses.includes(status)) {
        const wasApproved = expense.status === 'Approved';
        const isUnapproving = (status === 'Unapproved' || status === 'Pending') && wasApproved;
        
        // If unapproving an approved expense, reverse wallet changes
        if (isUnapproving) {
          const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id : expense.userId;
          
          // Reverse Payment Mode wallet (add back the amount that was deducted) - use Payment Mode index 0
          const PaymentMode = require('../models/paymentModeModel');
          const firstPaymentMode = await PaymentMode.findOne({ isActive: true }).sort({ createdAt: 1 });
          if (firstPaymentMode && firstPaymentMode.isActive) {
            const hasCollectionDisplay = firstPaymentMode.display && firstPaymentMode.display.includes('Collection');
            if (hasCollectionDisplay) {
              // Extract mode from first Payment Mode's description (default to 'Cash' if not found)
              let expenseMode = 'Cash';
              if (firstPaymentMode.description) {
                const modeMatch = firstPaymentMode.description.match(/mode:(\w+)/i);
                if (modeMatch && modeMatch[1]) {
                  expenseMode = modeMatch[1];
                }
              }
              await updatePaymentModeWalletBalance(firstPaymentMode._id, expenseMode, expense.amount, 'add', 'expense_reversal');
              console.log(`[Expense Unapprove] Reversed Payment Mode wallet: +₹${expense.amount} to Payment Mode index 0 (${firstPaymentMode.modeName})`);
            }
          }
          
          // Reverse expense owner wallet (subtract the reimbursement that was added)
          await updateWalletBalance(expenseUserId, expense.mode, expense.amount, 'subtract', 'expense_reversal');
          console.log(`[Expense Unapprove] Reversed expense owner wallet: -₹${expense.amount} from expense owner (${expenseUserId})`);
        }
        
        expense.status = status;
        // Clear approval fields if unapproving
        if (status === 'Unapproved' || status === 'Pending') {
          expense.approvedBy = undefined;
          expense.approvedAt = undefined;
        }
      }
    }

    await expense.save();

    await createAuditLog(
      req.user._id,
      `Updated expense: ${expense._id}`,
      'Update',
      'Expense',
      expense._id,
      oldValues,
      {
        category: expense.category,
        amount: expense.amount,
        mode: expense.mode,
        description: expense.description,
        proofUrl: expense.proofUrl
      },
      req.ip
    );

    // Emit real-time update
    const expenseUserObj = typeof expense.userId === 'object' ? expense.userId : null;
    
    // Emit expense updated event for real-time expense report updates
    const { emitExpenseUpdate } = require('../utils/socketService');
    const expenseWithUser = await Expense.findById(expense._id).populate('userId createdBy');
    emitExpenseUpdate('updated', expenseWithUser?.toObject() || expense.toObject());
    
    await notifyAmountUpdate('expense_updated', {
      expenseId: expense._id,
      userId: expenseUserObj?._id || expense.userId,
      userName: expenseUserObj?.name || 'Unknown',
      amount: expense.amount,
      mode: expense.mode,
      category: expense.category,
      description: expense.description,
      status: expense.status,
      updatedBy: req.user._id
    });

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private (Admin, SuperAdmin)
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).populate('userId');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      const deletableStatuses = ['Pending', 'Rejected', 'Flagged'];
      if (!deletableStatuses.includes(expense.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete expense with status: ${expense.status}`,
        });
      }
    }
    // If fromAllWalletReport is true, allow deletion regardless of status

    // If expense was approved, reverse wallet changes before deleting
    const wasApproved = expense.status === 'Approved';
    if (wasApproved) {
      const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id : expense.userId;
      
      // Reverse Payment Mode wallet (add back the amount that was deducted) - use Payment Mode index 0
      const PaymentMode = require('../models/paymentModeModel');
      const firstPaymentMode = await PaymentMode.findOne({ isActive: true }).sort({ createdAt: 1 });
      if (firstPaymentMode) {
        const hasCollectionDisplay = firstPaymentMode.display && firstPaymentMode.display.includes('Collection');
        if (hasCollectionDisplay) {
          // Extract mode from first Payment Mode's description (default to 'Cash' if not found)
          let expenseMode = 'Cash';
          if (firstPaymentMode.description) {
            const modeMatch = firstPaymentMode.description.match(/mode:(\w+)/i);
            if (modeMatch && modeMatch[1]) {
              expenseMode = modeMatch[1];
            }
          }
          await updatePaymentModeWalletBalance(firstPaymentMode._id, expenseMode, expense.amount, 'add', 'expense_deletion');
          console.log(`[Expense Delete] Reversed Payment Mode wallet: +₹${expense.amount} to Payment Mode index 0 (${firstPaymentMode.modeName})`);
        }
      }
      
      // Reverse expense owner wallet (subtract the reimbursement that was added)
      await updateWalletBalance(expenseUserId, expense.mode, expense.amount, 'subtract', 'expense_deletion');
      console.log(`[Expense Delete] Reversed expense owner wallet: -₹${expense.amount} from expense owner (${expenseUserId})`);
    }

    const previousState = expense.toObject();
    await expense.deleteOne();

    await createAuditLog(
      req.user._id,
      `Deleted expense: ${expense._id}`,
      'Delete',
      'Expense',
      expense._id,
      previousState,
      null,
      req.ip
    );

    // Emit expense deleted event for real-time updates
    const { emitExpenseUpdate } = require('../utils/socketService');
    emitExpenseUpdate('deleted', previousState);

    // Emit expense report stats update for real-time report updates
    await emitExpenseReportStatsUpdate();

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
