const Transaction = require('../models/transactionModel');
const { checkBalance, updateWalletBalance, getOrCreateWallet } = require('../utils/walletHelper');
const { createAuditLog } = require('../utils/auditLogger');
const { notifyAmountUpdate } = require('../utils/amountUpdateHelper');
const User = require('../models/userModel');
const WalletTransaction = require('../models/walletTransactionModel');
const Wallet = require('../models/walletModel');

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

// @desc    Create transaction
// @route   POST /api/transactions
// @access  Private
exports.createTransaction = async (req, res) => {
  try {
    const { sender, receiver, amount, mode, paymentModeId, purpose, proofUrl } = req.body;

    // Log incoming request for debugging
    console.log('\n📝 ===== CREATE TRANSACTION REQUEST =====');
    console.log('   Request Body:', {
      sender: sender || 'MISSING',
      receiver: receiver || 'MISSING',
      amount: amount !== undefined ? amount : 'MISSING',
      mode: mode || 'MISSING',
      purpose: purpose || 'not provided',
      proofUrl: proofUrl || 'not provided'
    });
    console.log('   Sender Type:', typeof sender);
    console.log('   Receiver Type:', typeof receiver);
    console.log('   Amount Type:', typeof amount);
    console.log('   Mode Type:', typeof mode);
    console.log('==========================================\n');

    // Validate required fields with better error messages
    if (!sender || (typeof sender === 'string' && sender.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Sender is required. Please provide a valid sender user ID.'
      });
    }

    if (!receiver || (typeof receiver === 'string' && receiver.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Receiver is required. Please provide a valid receiver user ID.'
      });
    }

    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({
        success: false,
        message: 'Amount is required. Please provide a valid amount.'
      });
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive number greater than 0.'
      });
    }

    // Helper function to extract mode from payment mode description
    const extractModeFromPaymentMode = (paymentMode) => {
      let extractedMode = 'Cash'; // Default
      
      // Extract mode from description
      // Description format: "text|mode:Cash" or "text|mode:UPI" or "text|mode:Bank"
      if (paymentMode.description) {
        const parts = paymentMode.description.split('|');
        for (const part of parts) {
          if (part.includes('mode:')) {
            const modeValue = part.split('mode:')[1]?.trim();
            if (modeValue && ['Cash', 'UPI', 'Bank'].includes(modeValue)) {
              extractedMode = modeValue;
              break;
            }
          }
        }
      }
      
      // Fallback: try to infer from modeName if description doesn't have mode
      if (extractedMode === 'Cash' && paymentMode.modeName) {
        const modeName = paymentMode.modeName.toLowerCase();
        if (modeName.includes('upi')) {
          extractedMode = 'UPI';
        } else if (modeName.includes('bank')) {
          extractedMode = 'Bank';
        }
      }
      
      return extractedMode;
    };

    // Extract mode from paymentMode if not provided, default to Cash
    let finalMode = mode;
    if (!finalMode || (typeof finalMode === 'string' && finalMode.trim() === '')) {
      if (paymentModeId) {
        const PaymentMode = require('../models/paymentModeModel');
        const paymentMode = await PaymentMode.findById(paymentModeId);
        if (paymentMode) {
          finalMode = extractModeFromPaymentMode(paymentMode);
        } else {
          finalMode = 'Cash'; // Default to Cash if paymentMode not found
        }
      } else {
        finalMode = 'Cash'; // Default to Cash if no paymentModeId provided
      }
    }

    // Validate mode is one of the allowed values
    const validModes = ['Cash', 'UPI', 'Bank'];
    if (!validModes.includes(finalMode.trim())) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment mode: ${finalMode}. Must be one of: ${validModes.join(', ')}`
      });
    }

    if (sender === receiver) {
      return res.status(400).json({
        success: false,
        message: 'Sender and receiver cannot be the same'
      });
    }

    // Get receiver user to check role for auto-approval
    const receiverUser = await User.findById(receiver);
    const senderUser = await User.findById(sender);
    
    // Validate users exist
    if (!receiverUser) {
      return res.status(404).json({
        success: false,
        message: `Receiver user not found. User ID: ${receiver}`
      });
    }

    if (!senderUser) {
      return res.status(404).json({
        success: false,
        message: `Sender user not found. User ID: ${sender}`
      });
    }

    // Check if sender is active
    if (!senderUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Sender user is inactive. Only active users can create transactions.'
      });
    }

    // Check if receiver is active
    if (!receiverUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Receiver user is inactive. Only active users can receive transactions.'
      });
    }

    // Check if sender has wallet (non-wallet users cannot send transactions)
    const senderWallet = await Wallet.findOne({ userId: sender });
    if (!senderWallet) {
      return res.status(403).json({
        success: false,
        message: 'Sender user does not have a wallet. Non-wallet users cannot create transactions.'
      });
    }

    // Check if receiver has wallet (non-wallet users cannot receive transactions)
    const receiverWallet = await Wallet.findOne({ userId: receiver });
    if (!receiverWallet) {
      return res.status(403).json({
        success: false,
        message: 'Receiver user does not have a wallet. Non-wallet users cannot receive transactions.'
      });
    }

    // Use parsed amount for all operations
    const transactionAmount = parsedAmount;
    const transactionMode = finalMode.trim();

    // Check balance after validating users and wallets exist
    const hasBalance = await checkBalance(sender, transactionMode, transactionAmount);
    if (!hasBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${transactionMode} balance`
      });
    }
    
    // ALL transactions start as "Pending" - NO auto-approval for anyone
    // Only receiver can approve, which will update wallets
    // Create transaction as Pending - wallet will be updated only when receiver approves
    transaction = await Transaction.create({
      initiatedBy: req.user._id,
      sender,
      receiver,
      amount: transactionAmount,
      mode: transactionMode,
      paymentModeId: paymentModeId || null,
      purpose,
      proofUrl,
      status: 'Pending'
    });

    await createAuditLog(
      req.user._id,
      `Created transaction: ${transactionAmount} ${transactionMode} from ${sender} to ${receiver}`,
      'Create',
      'Transaction',
      transaction._id,
      null,
      transaction.toObject(),
      req.ip
    );

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully. Waiting for receiver approval.',
      transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get transactions
// @route   GET /api/transactions
// @access  Private
exports.getTransactions = async (req, res) => {
  try {
    const { sender, receiver, status, mode } = req.query;
    const query = {};

    // Check if user is admin@examples.com (protected user) - can see all transactions
    const isProtectedUser = req.user.email === 'admin@examples.com';

    // Non-SuperAdmin users can only see their own transactions
    // Exception: admin@examples.com can see all transactions
    if (!isProtectedUser && req.user.role !== 'SuperAdmin') {
      query.$or = [
        { sender: req.user._id },
        { receiver: req.user._id },
        { initiatedBy: req.user._id }
      ];
    }
    // If admin@examples.com or SuperAdmin, show all transactions (no filter)

    if (sender) query.sender = sender;
    if (receiver) query.receiver = receiver;
    if (status) query.status = status;
    if (mode) query.mode = mode;

    const transactions = await Transaction.find(query)
      .populate('sender', 'name email role')
      .populate('receiver', 'name email role')
      .populate('initiatedBy', 'name email role')
      .populate('approvedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Approve transaction
// @route   POST /api/transactions/:id/approve
// @access  Private (All authenticated users - cannot approve their own transactions)
exports.approveTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('sender')
      .populate('receiver');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // If fromAllWalletReport is true, allow approval regardless of status
    if (!fromAllWalletReport && transaction.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction is already ${transaction.status}`
      });
    }

    // Only the receiver can approve the transaction
    const receiverUserId = transaction.receiver._id.toString();
    const approverUserId = req.user._id.toString();
    
    // Check if the approver is the receiver
    const isReceiver = receiverUserId === approverUserId;
    
    if (!isReceiver) {
      return res.status(403).json({
        success: false,
        message: 'Only the receiver can approve this transaction. You must be the receiver to approve it.'
      });
    }

    // Check if transaction is already completed (for All Wallet Report - prevent double wallet update)
    const wasAlreadyCompleted = transaction.status === 'Completed';
    
    // Only update wallet if not already completed (prevent double wallet update)
    if (!wasAlreadyCompleted) {
      const hasBalance = await checkBalance(transaction.sender._id, transaction.mode, transaction.amount);
      if (!hasBalance) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${transaction.mode} balance`
        });
      }

      await updateWalletBalance(transaction.sender._id, transaction.mode, transaction.amount, 'subtract', 'transaction_out');
      await updateWalletBalance(transaction.receiver._id, transaction.mode, transaction.amount, 'add', 'transaction_in');
    } else {
      console.log(`[Transaction Approval] ⚠️  Transaction was already completed - skipping wallet update to prevent double update`);
    }

    // Get updated wallets for notification
    const senderWallet = await getOrCreateWallet(transaction.sender._id);
    const receiverWallet = await getOrCreateWallet(transaction.receiver._id);

    transaction.status = 'Completed';
    transaction.approvedBy = req.user._id;
    transaction.approvedAt = new Date();
    await transaction.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    // Build notes with accountId if paymentModeId is available
    let senderNotes = transaction.purpose || `Transaction to ${transaction.receiver.name || transaction.receiver.email || transaction.receiver._id}`;
    let receiverNotes = transaction.purpose || `Transaction from ${transaction.sender.name || transaction.sender.email || transaction.sender._id}`;
    
    if (transaction.paymentModeId) {
      const accountIdStr = transaction.paymentModeId.toString();
      senderNotes = `${senderNotes} - account ${accountIdStr}`;
      receiverNotes = `${receiverNotes} - account ${accountIdStr}`;
    }

    // Create WalletTransaction entry for sender (money deducted)
    await createWalletTransaction(
      senderWallet,
      'transaction',
      transaction.mode,
      transaction.amount,
      'subtract',
      req.user._id,
      {
        fromUserId: transaction.sender._id,
        toUserId: transaction.receiver._id,
        relatedId: transaction._id,
        relatedModel: 'Transaction',
        notes: senderNotes
      }
    );

    // Create WalletTransaction entry for receiver (money added)
    await createWalletTransaction(
      receiverWallet,
      'transaction',
      transaction.mode,
      transaction.amount,
      'add',
      req.user._id,
      {
        fromUserId: transaction.sender._id,
        toUserId: transaction.receiver._id,
        relatedId: transaction._id,
        relatedModel: 'Transaction',
        notes: receiverNotes
      }
    );

    await createAuditLog(
      req.user._id,
      `Approved transaction: ${transaction._id}`,
      'Approve',
      'Transaction',
      transaction._id,
      { status: 'Pending' },
      { status: 'Completed' },
      req.ip
    );

    // Emit real-time update to super admin
    await notifyAmountUpdate('transaction', {
      transactionId: transaction._id,
      sender: {
        userId: transaction.sender._id,
        userName: transaction.sender.name || 'Unknown'
      },
      receiver: {
        userId: transaction.receiver._id,
        userName: transaction.receiver.name || 'Unknown'
      },
      amount: transaction.amount,
      mode: transaction.mode,
      purpose: transaction.purpose,
      status: 'Completed',
      senderWallet: {
        cashBalance: senderWallet.cashBalance,
        upiBalance: senderWallet.upiBalance,
        bankBalance: senderWallet.bankBalance,
        totalBalance: senderWallet.totalBalance
      },
      receiverWallet: {
        cashBalance: receiverWallet.cashBalance,
        upiBalance: receiverWallet.upiBalance,
        bankBalance: receiverWallet.bankBalance,
        totalBalance: receiverWallet.totalBalance
      },
      approvedBy: req.user._id
    });

    // Emit self wallet update to sender (money deducted)
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(transaction.sender._id.toString(), {
      type: 'transaction_approved',
      wallet: {
        cashBalance: senderWallet.cashBalance,
        upiBalance: senderWallet.upiBalance,
        bankBalance: senderWallet.bankBalance,
        totalBalance: senderWallet.totalBalance
      },
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        mode: transaction.mode,
        role: 'sender',
        status: 'Completed'
      },
      cashOut: transaction.amount,
      operation: 'transaction_sent'
    });

    // Emit self wallet update to receiver (money added)
    emitSelfWalletUpdate(transaction.receiver._id.toString(), {
      type: 'transaction_approved',
      wallet: {
        cashBalance: receiverWallet.cashBalance,
        upiBalance: receiverWallet.upiBalance,
        bankBalance: receiverWallet.bankBalance,
        totalBalance: receiverWallet.totalBalance
      },
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        mode: transaction.mode,
        role: 'receiver',
        status: 'Completed'
      },
      cashIn: transaction.amount,
      operation: 'transaction_received'
    });

    res.status(200).json({
      success: true,
      message: 'Transaction approved successfully',
      transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reject transaction
// @route   POST /api/transactions/:id/reject
// @access  Private (SuperAdmin only)
exports.rejectTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('sender')
      .populate('receiver');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Store previous status for audit log and wallet reversal
    const previousStatus = transaction.status;
    
    // Allow rejecting completed transactions (with wallet reversal)
    // Only prevent rejection if already rejected or cancelled
    if (transaction.status === 'Rejected' || transaction.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject transaction that is already ${transaction.status}`
      });
    }

    // Get creator info
    const creator = await User.findById(transaction.initiatedBy);
    const isCreatedBySuperAdmin = creator?.role === 'SuperAdmin';
    
    // Check authorization: SuperAdmin, sender, or receiver can reject
    const isSuperAdmin = req.user.role === 'SuperAdmin';
    const isReceiver = transaction.receiver._id.toString() === req.user._id.toString();
    const isSender = transaction.sender._id.toString() === req.user._id.toString();
    const isCreator = transaction.initiatedBy && transaction.initiatedBy.toString() === req.user._id.toString();
    
    if (!isSuperAdmin && !isSender && !isCreator && !(isCreatedBySuperAdmin && isReceiver)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject this transaction. Only SuperAdmin, sender, creator, or the receiver (for transactions created by SuperAdmin) can reject transactions.'
      });
    }

    // If transaction was completed, reverse wallet changes before rejecting
    const wasCompleted = transaction.status === 'Completed';
    if (wasCompleted) {
      // Reverse wallet: add back to sender, subtract from receiver
      await updateWalletBalance(transaction.sender._id, transaction.mode, transaction.amount, 'add', 'transaction_rejection');
      await updateWalletBalance(transaction.receiver._id, transaction.mode, transaction.amount, 'subtract', 'transaction_rejection');
      console.log(`[Transaction Reject] Reversed wallet: +₹${transaction.amount} to sender, -₹${transaction.amount} from receiver`);
    }

    transaction.status = 'Rejected';
    // Clear approval fields when rejecting (especially important if rejecting a completed transaction)
    // This ensures that rejecting a completed transaction properly clears who approved it
    if (wasCompleted) {
      transaction.approvedBy = undefined;
      transaction.approvedAt = undefined;
    }
    await transaction.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Rejected transaction: ${transaction._id}`,
      'Reject',
      'Transaction',
      transaction._id,
      { status: previousStatus },
      { status: 'Rejected' },
      req.ip,
      req.body.reason
    );

    // Emit real-time update if SuperAdmin rejected transaction
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('transaction_rejected', {
        transactionId: transaction._id,
        sender: {
          userId: transaction.sender._id,
          userName: transaction.sender.name || 'Unknown'
        },
        receiver: {
          userId: transaction.receiver._id,
          userName: transaction.receiver.name || 'Unknown'
        },
        amount: transaction.amount,
        mode: transaction.mode,
        purpose: transaction.purpose,
        status: 'Rejected',
        reason: req.body.reason,
        rejectedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Transaction rejected successfully',
      transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel transaction (moves to Pending status so it can be approved again)
// @route   POST /api/transactions/:id/cancel
// @access  Private
exports.cancelTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('sender')
      .populate('receiver');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Store previous status for audit log
    const previousStatus = transaction.status;
    
    // IMPORTANT: Allow canceling from any status except already Cancelled
    // This allows unapproved transactions (Pending, Flagged, Rejected) to be moved back to Pending
    // and completed transactions to be unapproved and moved back to Pending
    if (!fromAllWalletReport && transaction.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Transaction is already cancelled'
      });
    }

    // Only sender can cancel (unless from All Wallet Report)
    if (!fromAllWalletReport && transaction.initiatedBy.toString() !== req.user._id.toString() && 
        transaction.sender._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only sender can cancel transaction'
      });
    }

    // IMPORTANT: Reverse wallet changes if transaction was approved/completed
    // Check for both 'Approved' and 'Completed' status to handle all approved states
    const wasApproved = transaction.status === 'Approved' || transaction.status === 'Completed';
    if (wasApproved) {
      // Populate sender and receiver if not already populated (check if they're objects or just IDs)
      const senderIsObject = transaction.sender && typeof transaction.sender === 'object' && transaction.sender._id;
      const receiverIsObject = transaction.receiver && typeof transaction.receiver === 'object' && transaction.receiver._id;
      
      if (!senderIsObject || !receiverIsObject) {
        await transaction.populate('sender receiver');
      }
      
      // Get sender and receiver IDs (handle both populated objects and direct IDs)
      const senderId = senderIsObject ? transaction.sender._id : transaction.sender;
      const receiverId = receiverIsObject ? transaction.receiver._id : transaction.receiver;
      
      // Reverse wallet: add back to sender, subtract from receiver
      // This reverses Cash Out for sender and Cash In for receiver
      // Sender: +₹amount (Cash Out reversed, balance increases)
      // Receiver: -₹amount (Cash In reversed, balance decreases)
      await updateWalletBalance(senderId, transaction.mode, transaction.amount, 'add', 'transaction_reversal');
      await updateWalletBalance(receiverId, transaction.mode, transaction.amount, 'subtract', 'transaction_reversal');
      console.log(`[Transaction Cancel/Unapprove] Reversed wallet: +₹${transaction.amount} to sender (Cash Out reversed), -₹${transaction.amount} from receiver (Cash In reversed)`);
    }

    // IMPORTANT: Move transaction to 'Pending' status (not 'Cancelled')
    // This allows the transaction to be approved again
    transaction.status = 'Pending';
    
    // Clear approval fields when moving to Pending (important for approved/completed transactions)
    if (wasApproved) {
      transaction.approvedBy = undefined;
      transaction.approvedAt = undefined;
    }
    
    await transaction.save();

    await createAuditLog(
      req.user._id,
      `Cancelled transaction: ${transaction._id} (moved to Pending)`,
      'Cancel',
      'Transaction',
      transaction._id,
      { status: previousStatus },
      { status: 'Pending' },
      req.ip
    );

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    // Emit pending approvals update to refresh Smart Approvals
    const { emitPendingApprovalUpdate } = require('../utils/socketService');
    if (emitPendingApprovalUpdate) {
      emitPendingApprovalUpdate({ refresh: true, itemId: transaction._id, type: 'Transaction' });
    }

    // Emit real-time update if SuperAdmin cancelled transaction
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('transaction_cancelled', {
        transactionId: transaction._id,
        sender: {
          userId: transaction.sender._id,
          userName: transaction.sender.name || 'Unknown'
        },
        receiver: {
          userId: transaction.receiver._id,
          userName: transaction.receiver.name || 'Unknown'
        },
        amount: transaction.amount,
        mode: transaction.mode,
        purpose: transaction.purpose,
        status: 'Pending', // Changed from 'Cancelled' to 'Pending'
        cancelledBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Transaction cancelled successfully. Transaction moved to Pending status and can be approved again.',
      transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Flag transaction
// @route   POST /api/transactions/:id/flag
// @access  Private (SuperAdmin only)
exports.flagTransaction = async (req, res) => {
  try {
    const { flagReason } = req.body;

    if (!flagReason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a flag reason'
      });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('sender')
      .populate('receiver');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    transaction.status = 'Flagged';
    transaction.flagReason = flagReason;
    transaction.flaggedBy = req.user._id;
    transaction.flaggedAt = new Date();
    await transaction.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Flagged transaction: ${transaction._id}`,
      'Flag',
      'Transaction',
      transaction._id,
      { status: transaction.status },
      { status: 'Flagged', flagReason },
      req.ip
    );

    // Emit real-time update if SuperAdmin flagged transaction
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('transaction_flagged', {
        transactionId: transaction._id,
        sender: {
          userId: transaction.sender._id,
          userName: transaction.sender.name || 'Unknown'
        },
        receiver: {
          userId: transaction.receiver._id,
          userName: transaction.receiver.name || 'Unknown'
        },
        amount: transaction.amount,
        mode: transaction.mode,
        purpose: transaction.purpose,
        status: 'Flagged',
        flagReason,
        flaggedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Transaction flagged successfully',
      transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Resubmit flagged transaction
// @route   POST /api/transactions/:id/resubmit
// @access  Private (All authenticated users - can resubmit their own flagged transactions)
exports.resubmitTransaction = async (req, res) => {
  try {
    console.log('\n🔄 ===== TRANSACTION RESUBMIT REQUEST =====');
    console.log(`[Transaction Resubmit] Transaction ID: ${req.params.id}`);
    console.log(`[Transaction Resubmit] User: ${req.user.email} (${req.user.role})`);
    console.log(`[Transaction Resubmit] Request Body:`, req.body);
    console.log('==========================================\n');
    
    const { response } = req.body;

    if (!response || !response.trim() || response.trim().length === 0) {
      console.log(`[Transaction Resubmit] ❌ Missing response field`);
      return res.status(400).json({
        success: false,
        message: 'Please provide a response'
      });
    }

    // Reload transaction from database to ensure we have the latest status
    // This is important because the transaction might have been updated just before resubmit
    let transaction = await Transaction.findById(req.params.id)
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .populate('initiatedBy', 'name email')
      .populate('flaggedBy', 'name email role');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if transaction is flagged (same simple check as expenses)
    if (transaction.status !== 'Flagged') {
      return res.status(400).json({
        success: false,
        message: 'Only flagged transactions can be resubmitted'
      });
    }

    // Check authorization: User can resubmit transactions they initiated/sent/received, or Admin/SuperAdmin/wallet.all.transaction permission can resubmit any
    // Similar to expense: check multiple fields (initiatedBy, sender, receiver)
    const userObjectId = req.user._id.toString();
    
    // Handle both populated objects and direct IDs
    const initiatedByUserId = transaction.initiatedBy?._id?.toString() || transaction.initiatedBy?.toString() || null;
    const senderUserId = transaction.sender?._id?.toString() || transaction.sender?.toString() || null;
    const receiverUserId = transaction.receiver?._id?.toString() || transaction.receiver?.toString() || null;
    
    console.log(`[Transaction Resubmit] Authorization check:`);
    console.log(`   User ID: ${userObjectId}`);
    console.log(`   Initiated By: ${initiatedByUserId}`);
    console.log(`   Sender: ${senderUserId}`);
    console.log(`   Receiver: ${receiverUserId}`);
    
    const isInitiator = initiatedByUserId && initiatedByUserId === userObjectId;
    const isSender = senderUserId && senderUserId === userObjectId;
    const isReceiver = receiverUserId && receiverUserId === userObjectId;
    const isOwner = isInitiator || isSender || isReceiver; // User can resubmit if they are initiator, sender, or receiver
    
    console.log(`   isInitiator: ${isInitiator}, isSender: ${isSender}, isReceiver: ${isReceiver}, isOwner: ${isOwner}`);
    
    const isAdminOrSuperAdmin = req.user.role === 'Admin' || req.user.role === 'SuperAdmin';
    console.log(`   isAdminOrSuperAdmin: ${isAdminOrSuperAdmin}, role: ${req.user.role}`);
    
    // Check if user has wallet.all.transaction permission
    let hasWalletTransactionPermission = false;
    if (req.user.role && req.user.role !== 'SuperAdmin') {
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: req.user.role });
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          const allPermissions = [...(role.permissionIds || []), ...(req.user.userSpecificPermissions || [])];
          hasWalletTransactionPermission = allPermissions.some(permission => {
            return permission === 'wallet.all.transaction' ||
                   permission === 'wallet.all' ||
                   permission.startsWith('wallet.all.transaction.');
          });
        }
      } catch (error) {
        console.error('Error checking wallet permissions for resubmit:', error);
      }
    }
    
    console.log(`   hasWalletTransactionPermission: ${hasWalletTransactionPermission}`);
    console.log(`   Final authorization: ${isOwner || isAdminOrSuperAdmin || hasWalletTransactionPermission ? 'ALLOWED' : 'DENIED'}`);

    if (!isOwner && !isAdminOrSuperAdmin && !hasWalletTransactionPermission) {
      console.log(`[Transaction Resubmit] ❌ Authorization denied`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resubmit this transaction'
      });
    }

    console.log(`[Transaction Resubmit] ✅ Authorization granted`);
    
    // Save response and change status back to Pending (same simple pattern as expenses)
    transaction.response = response.trim();
    transaction.responseDate = new Date();
    transaction.status = 'Pending';
    await transaction.save();
    
    // Reload transaction to verify status was saved correctly
    const reloadedTransaction = await Transaction.findById(transaction._id);
    console.log(`[Transaction Resubmit] ✅ Status saved - Current status: ${reloadedTransaction?.status}`);
    console.log(`[Transaction Resubmit] ✅ Transaction ID: ${transaction._id}`);
    console.log(`[Transaction Resubmit] ✅ Transaction should now appear in Smart Approvals with status: ${reloadedTransaction?.status}`);

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    // Emit pending approvals update to refresh Smart Approvals (same as collection)
    const { emitPendingApprovalUpdate } = require('../utils/socketService');
    if (emitPendingApprovalUpdate) {
      console.log(`[Transaction Resubmit] ✅ Emitting pending approval update for transaction: ${transaction._id}`);
      emitPendingApprovalUpdate({ refresh: true, itemId: transaction._id, type: 'Transaction' });
    } else {
      console.log(`[Transaction Resubmit] ⚠️ emitPendingApprovalUpdate function not available`);
    }

    await createAuditLog(
      req.user._id,
      `Resubmitted flagged transaction: ${transaction._id}`,
      'Resubmit',
      'Transaction',
      transaction._id,
      { status: 'Flagged' },
      { status: 'Pending', response: transaction.response },
      req.ip
    );

    // Emit transaction update event for real-time updates (same pattern as expense)
    const { emitTransactionUpdate } = require('../utils/socketService');
    if (emitTransactionUpdate) {
    const transactionWithPopulated = await Transaction.findById(transaction._id)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('initiatedBy', 'name email')
        .populate('flaggedBy', 'name email role')
        .lean();
      emitTransactionUpdate('resubmitted', transactionWithPopulated || transaction.toObject());
    }

    // Reload transaction with populated fields for response to ensure we return the latest status
    const finalTransaction = await Transaction.findById(transaction._id)
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .populate('initiatedBy', 'name email')
      .populate('flaggedBy', 'name email role');
    
    console.log(`[Transaction Resubmit] ✅ Final transaction status in response: ${finalTransaction.status}`);
    console.log(`[Transaction Resubmit] ✅ Transaction should appear in Smart Approvals with ID: ${finalTransaction._id}`);

    res.status(200).json({
      success: true,
      message: 'Transaction resubmitted successfully',
      transaction: finalTransaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update transaction details
// @route   PUT /api/transactions/:id
// @access  Private (SuperAdmin only)
exports.updateTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      if (transaction.status === 'Completed') {
        return res.status(400).json({
          success: false,
          message: 'Completed transactions cannot be edited',
        });
      }

      const editableStatuses = ['Pending', 'Flagged', 'Rejected', 'Cancelled'];
      if (!editableStatuses.includes(transaction.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot edit transaction with status: ${transaction.status}`,
        });
      }
    }
    // If fromAllWalletReport is true, allow editing regardless of status

    const { amount, mode, purpose, proofUrl, status } = req.body;

    // Store old values for audit log (same pattern as expense)
    const oldValues = {
      amount: transaction.amount,
      mode: transaction.mode,
      purpose: transaction.purpose,
      proofUrl: transaction.proofUrl,
      status: transaction.status,
    };

    // IMPORTANT: Handle status change from APPROVED/COMPLETED to UNAPPROVED/PENDING
    // When changing from Approved/Completed to Pending/Unapproved, reverse wallet for BOTH users
    // This subtracts Cash In from receiver and Cash Out from sender
    const previousStatus = transaction.status;
    const wasApproved = previousStatus === 'Approved' || previousStatus === 'Completed';
    const isUnapproving = status !== undefined && 
                          (status === 'Pending' || status === 'Unapproved') && 
                          wasApproved;
    
    if (isUnapproving && fromAllWalletReport) {
      // Populate sender and receiver for wallet reversal if not already populated
      if (!transaction.sender || typeof transaction.sender === 'string' || 
          !transaction.receiver || typeof transaction.receiver === 'string') {
      await transaction.populate('sender receiver');
      }
      
      // Reverse wallet: add back to sender, subtract from receiver
      // This reverses Cash Out for sender and Cash In for receiver
      // Sender: +₹amount (Cash Out reversed, balance increases)
      // Receiver: -₹amount (Cash In reversed, balance decreases)
      await updateWalletBalance(transaction.sender._id, transaction.mode, transaction.amount, 'add', 'transaction_reversal');
      await updateWalletBalance(transaction.receiver._id, transaction.mode, transaction.amount, 'subtract', 'transaction_reversal');
      console.log(`[Transaction Unapprove] Reversed wallet: +₹${transaction.amount} to sender (Cash Out reversed), -₹${transaction.amount} from receiver (Cash In reversed)`);
    }

    // Update fields if provided (same pattern as expense - no status preservation needed)
    // Mongoose will automatically preserve status if not explicitly changed
    if (amount !== undefined) {
      const parsedAmount = Number(amount);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a positive number',
        });
      }
      transaction.amount = parsedAmount;
    }

    if (mode !== undefined) {
      if (typeof mode !== 'string' || !mode.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Mode must be provided',
        });
      }
      transaction.mode = mode.trim();
    }

    if (purpose !== undefined) {
      transaction.purpose =
        typeof purpose === 'string' ? purpose.trim() : transaction.purpose;
    }

    if (proofUrl !== undefined) {
      if (typeof proofUrl === 'string' && proofUrl.trim()) {
        transaction.proofUrl = proofUrl.trim();
      } else {
        transaction.proofUrl = null;
      }
    }

    // Handle status update (only if fromAllWalletReport is true)
    if (status !== undefined && fromAllWalletReport) {
      const validStatuses = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed', 'Flagged', 'Unapproved'];
      if (validStatuses.includes(status)) {
        transaction.status = status;
        
        // Clear approval fields if unapproving
        if (status === 'Pending' || status === 'Unapproved') {
          transaction.approvedBy = undefined;
          transaction.approvedAt = undefined;
        }
      }
    }

    await transaction.save();

    await createAuditLog(
      req.user._id,
      `Updated transaction: ${transaction._id}`,
      'Update',
      'Transaction',
      transaction._id,
      oldValues,
      {
        amount: transaction.amount,
        mode: transaction.mode,
        purpose: transaction.purpose,
        proofUrl: transaction.proofUrl,
        status: transaction.status,
      },
      req.ip
    );

    // Emit dashboard summary update if status changed (especially if unapproved)
    if (isUnapproving) {
      const { emitDashboardSummaryUpdate } = require('../utils/socketService');
      emitDashboardSummaryUpdate({ refresh: true });
      
      // Emit pending approvals update to refresh Smart Approvals
      const { emitPendingApprovalUpdate } = require('../utils/socketService');
      if (emitPendingApprovalUpdate) {
        emitPendingApprovalUpdate({ refresh: true, itemId: transaction._id, type: 'Transaction' });
      }
    }

    res.status(200).json({
      success: true,
      message: isUnapproving 
        ? 'Transaction unapproved successfully. Cash In and Cash Out reversed for both users.'
        : 'Transaction updated successfully',
      transaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete transaction
// @route   DELETE /api/transactions/:id
// @access  Private (SuperAdmin only)
exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      const deletableStatuses = ['Pending', 'Flagged', 'Rejected', 'Cancelled'];
      if (!deletableStatuses.includes(transaction.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete transaction with status: ${transaction.status}`,
        });
      }
    }
    // If fromAllWalletReport is true, allow deletion regardless of status

    // If transaction was completed, reverse wallet changes before deleting
    const wasCompleted = transaction.status === 'Completed';
    if (wasCompleted) {
      await transaction.populate('sender receiver');
      // Reverse wallet: add back to sender, subtract from receiver
      await updateWalletBalance(transaction.sender._id, transaction.mode, transaction.amount, 'add', 'transaction_deletion');
      await updateWalletBalance(transaction.receiver._id, transaction.mode, transaction.amount, 'subtract', 'transaction_deletion');
      console.log(`[Transaction Delete] Reversed wallet: +₹${transaction.amount} to sender, -₹${transaction.amount} from receiver`);
    }

    const previousState = transaction.toObject();
    await transaction.deleteOne();

    await createAuditLog(
      req.user._id,
      `Deleted transaction: ${transaction._id}`,
      'Delete',
      'Transaction',
      transaction._id,
      previousState,
      null,
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};