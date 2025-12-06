const Collection = require('../models/collectionModel');
const Transaction = require('../models/transactionModel');
const PaymentMode = require('../models/paymentModeModel');
const User = require('../models/userModel');
const { updateWalletBalance, getOrCreateWallet } = require('../utils/walletHelper');
const { createAuditLog } = require('../utils/auditLogger');
const { notifyAmountUpdate } = require('../utils/amountUpdateHelper');
const { emitDashboardSummaryUpdate } = require('../utils/socketService');
const generateVoucherNumber = require('../utils/generateVoucherNumber');

// Helper function to check if user has Smart Approvals permission for a specific action
const hasSmartApprovalsPermission = async (userId, action, itemType = 'collections') => {
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

// @desc    Create collection
// @route   POST /api/collections
// @access  Private (Staff)
exports.createCollection = async (req, res) => {
  try {
    const { customerName, amount, mode, paymentModeId, assignedReceiver, proofUrl, notes, customFields } = req.body;

    if (!customerName || !amount || !mode || !paymentModeId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customerName, amount, mode, and paymentModeId'
      });
    }

    const paymentMode = await PaymentMode.findById(paymentModeId);
    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    // If payment mode has AutoPay enabled, automatically set assignedReceiver to logged-in user
    // Otherwise, use provided assignedReceiver, paymentMode's assignedReceiver, or logged-in user as fallback
    let receiverId;
    if (paymentMode.autoPay === true && mode !== 'Cash') {
      // AutoPay enabled: automatically assign to logged-in user (collector)
      receiverId = req.user._id;
      console.log(`[Collection Creation] AutoPay enabled - assignedReceiver automatically set to logged-in user: ${req.user.email}`);
    } else {
      // Normal flow: use provided assignedReceiver, paymentMode's assignedReceiver, or logged-in user
      receiverId = assignedReceiver || paymentMode.assignedReceiver || req.user._id;
    }

    // Check if collector (logged-in user) is active
    if (!req.user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'You are inactive. Only active users can create collections.'
      });
    }

    // Get receiver user to check active status
    const receiverUser = await User.findById(receiverId);
    if (!receiverUser) {
      return res.status(404).json({
        success: false,
        message: 'Receiver user not found'
      });
    }

    // Check if receiver is active
    if (!receiverUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Receiver user is inactive. Only active users can receive collections.'
      });
    }
    
    const voucherNumber = generateVoucherNumber();
    
    // Check if payment mode has auto pay enabled (systematic entry)
    const isSystematicEntry = paymentMode.autoPay === true && mode !== 'Cash';
    // Set collectionType: 'systematic' if AutoPay enabled, otherwise 'collection'
    const collectionType = isSystematicEntry ? 'systematic' : 'collection';

    const collection = await Collection.create({
      voucherNumber,
      collectedBy: req.user._id, // Creator (collector)
      from: req.user._id, // From: Collection person name (collector) - who collected the money
      customerName,
      amount,
      mode,
      paymentModeId,
      assignedReceiver: receiverId, // To: Auto pay assigned person name (assigned receiver) - who receives the money
      proofUrl,
      notes,
      status: 'Pending',
      collectionType: collectionType,
      isSystematicEntry: isSystematicEntry,
      customFields: customFields || {}
    });

    await createAuditLog(
      req.user._id,
      `Created collection: ${voucherNumber}`,
      'Create',
      'Collection',
      collection._id,
      null,
      collection.toObject(),
      req.ip
    );

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get collections
// @route   GET /api/collections
// @access  Private
exports.getCollections = async (req, res) => {
  try {
    const { collectedBy, assignedReceiver, status, mode, startDate, endDate } = req.query;
    const query = {};

    // Check if user is admin@examples.com (protected user) - can see all collections
    const isProtectedUser = req.user.email === 'admin@examples.com';

    if (!isProtectedUser && req.user.role === 'Staff') {
      query.$or = [
        { collectedBy: req.user._id },
        { assignedReceiver: req.user._id }
      ];
    }
    // If admin@examples.com, show all collections (no filter)

    if (collectedBy) query.collectedBy = collectedBy;
    if (assignedReceiver) query.assignedReceiver = assignedReceiver;
    if (status) query.status = status;
    if (mode) query.mode = mode;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const collections = await Collection.find(query)
      .populate('collectedBy', 'name email role')
      .populate('from', 'name email role')
      .populate('assignedReceiver', 'name email role')
      .populate('approvedBy', 'name email role')
      .populate('paymentModeId', 'modeName autoPay assignedReceiver description isActive')
      .sort({ createdAt: -1 });
    
    // Fix: For system collections with null 'from', get from parent collection and update
    const collectionsToFix = collections.filter(c => c.isSystemCollection && !c.from && c.parentCollectionId);
    if (collectionsToFix.length > 0) {
      const parentIds = collectionsToFix.map(c => c.parentCollectionId._id || c.parentCollectionId);
      const parentCollections = await Collection.find({ _id: { $in: parentIds } })
        .populate('collectedBy', 'name email role')
        .populate('from', 'name email role');
      
      const parentMap = new Map();
      parentCollections.forEach(p => parentMap.set(p._id.toString(), p));
      
      for (let collection of collectionsToFix) {
        const parentId = (collection.parentCollectionId._id || collection.parentCollectionId).toString();
        const parent = parentMap.get(parentId);
        if (parent) {
          const collectorId = parent.from || parent.collectedBy;
          if (collectorId) {
            collection.from = collectorId;
            await collection.populate('from', 'name email role');
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      count: collections.length,
      collections
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Approve collection
// @route   POST /api/collections/:id/approve
// @access  Private (All authenticated users - cannot approve their own collections)
exports.approveCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy')
      .populate('assignedReceiver')
      .populate('paymentModeId');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Allow approval for both 'Pending' and 'Unaccounted' status
    // If fromAllWalletReport is true, allow approval regardless of status
    if (!fromAllWalletReport && collection.status !== 'Pending' && collection.status !== 'Unaccounted') {
      return res.status(400).json({
        success: false,
        message: `Collection is already ${collection.status}`
      });
    }

    // Safely extract user IDs with null checks
    const collectedByUserId = collection.collectedBy 
      ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
         ? collection.collectedBy._id 
         : collection.collectedBy)
      : null;
    
    const assignedReceiverUserId = collection.assignedReceiver
      ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id
         ? collection.assignedReceiver._id
         : collection.assignedReceiver)
      : null;
    
    // Validate collectedByUserId exists
    if (!collectedByUserId) {
      return res.status(400).json({
        success: false,
        message: 'Collection is missing collector information'
      });
    }
    
    // Prevent self-approval: If the logged-in person is the creator (collectedBy), they cannot approve their own collection
    // Exception: Super Admin can approve their own collections
    const isSuperAdmin = req.user.role === 'SuperAdmin';
    const isCreator = collectedByUserId.toString() === req.user._id.toString();
    
    // All users can approve collections, but cannot approve their own collections
    // Exception: Super Admin can approve their own collections
    if (!isSuperAdmin && isCreator) {
      return res.status(403).json({
        success: false,
        message: 'You cannot approve your own collection. Only other users can approve collections you created.'
      });
    }
    
    // All authenticated users can approve collections (except their own)

    // Get the approver (User 2 who is approving)
    const approverUserId = req.user._id;
    
    // Check if approver is different from collector
    const isApproverDifferentFromCollector = approverUserId.toString() !== collectedByUserId.toString();
    
    // AutoPay only works if there's an assigned receiver
    const hasAssignedReceiver = assignedReceiverUserId && 
                                 assignedReceiverUserId.toString() !== '' && 
                                 assignedReceiverUserId.toString() !== 'null';
    
    // Check AutoPay conditions
    const autoPayEnabled = collection.paymentModeId?.autoPay === true;
    const isNonCashMode = collection.mode !== 'Cash';
    const canRunAutoPay = autoPayEnabled && isNonCashMode && hasAssignedReceiver;
    
    console.log(`\n[Collection Approval] Voucher: ${collection.voucherNumber}`);
    console.log(`   Collector (User1): ${collectedByUserId}`);
    console.log(`   Approver (User2): ${approverUserId}`);
    console.log(`   Assigned Receiver: ${assignedReceiverUserId || 'None'}`);
    console.log(`   AutoPay Enabled: ${autoPayEnabled}, Mode: ${collection.mode}, Has Receiver: ${hasAssignedReceiver}`);
    console.log(`   Will Run AutoPay: ${canRunAutoPay}`);
    
    // Determine who gets the money - ALWAYS use assigned receiver (auto pay person)
    // Money should ONLY go to assigned receiver, NOT to approver
    // 1. If assigned receiver exists: use assigned receiver (auto pay person)
    // 2. Otherwise: use collector
    // NOTE: Approver can be anyone, but money always goes to assigned receiver
    let receiverUserId;
    if (assignedReceiverUserId) {
      receiverUserId = assignedReceiverUserId; // Always use assigned receiver (auto pay person)
    } else {
      receiverUserId = collectedByUserId; // Fallback to collector if no assigned receiver
    }
    
    // Check if collection is already approved (for All Wallet Report - prevent double wallet update)
    const wasAlreadyApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    const hasEntry2 = collection.isSystemCollection === false && await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
    
    // Update Entry 1 status to Approved (but wallet NOT updated - Option A)
    // Set collectionType to 'collection' for Entry 1 (as per requirement)
    collection.collectionType = 'collection';
    // Ensure 'from' field is set correctly - FROM: Collection person name (collector)
    if (!collection.from && collectedByUserId) {
      collection.from = collectedByUserId; // From: Collection person name (collector)
    }
    collection.status = 'Approved';
    collection.approvedBy = req.user._id;
    collection.approvedAt = new Date();
    await collection.save();
    
    console.log(`\n[Entry 1] Status updated to Approved (wallet NOT updated)`);
    console.log(`   Entry 1 - Created by: Collector, From: Collector, To: ${assignedReceiverUserId ? 'Assigned Receiver' : 'N/A'}, Approved by: Approver`);
    console.log(`   Was already approved: ${wasAlreadyApproved}, Has Entry 2: ${!!hasEntry2}`);
    
    // Only create Entry 2 and update wallet if not already approved and doesn't have Entry 2 (prevent double wallet update)
    let entry2Collection = null;
    
    if (!wasAlreadyApproved && !hasEntry2) {
      // Create Entry 2 (System Collection) - same from/to as Entry 1, wallet updated ONCE here
      console.log(`\n[Entry 2] Creating system collection...`);
      console.log(`   Entry 2 - Created by: System, From: Collector, To: ${assignedReceiverUserId ? 'Assigned Receiver' : 'N/A'}, Approved by: Approver`);
      
      // Entry 2: Same from/to as Entry 1 (collector → assignedReceiver)
      // FROM: Collection person name (collector) - who collected the money
      // TO: Auto pay assigned person name (assigned receiver) - who receives the money
      // This applies to BOTH AutoPay enabled and disabled cases
      const entry2CollectedBy = collectedByUserId; // Collector (same as Entry 1)
      const entry2AssignedReceiver = assignedReceiverUserId || collectedByUserId; // Assigned Receiver (auto pay person) - same as Entry 1
      
      const entry2VoucherNumber = generateVoucherNumber();
      
      // Update wallet ONCE for Entry 2 - money goes to receiver (assignedReceiver or approver)
      console.log(`\n   Step 1: Updating wallet for Entry 2 (ONLY wallet update)...`);
      console.log(`   Adding ₹${collection.amount} to ${receiverUserId === assignedReceiverUserId ? 'Assigned Receiver' : receiverUserId === approverUserId ? 'Approver' : 'Collector'}'s wallet`);
      await updateWalletBalance(receiverUserId, collection.mode, collection.amount, 'add', 'collection');
      
      const entry2Wallet = await getOrCreateWallet(receiverUserId);
      console.log(`   Wallet Updated - CashIn: ${entry2Wallet.cashIn}, CashOut: ${entry2Wallet.cashOut}, Balance: ${entry2Wallet.totalBalance} (+₹${collection.amount})`);
      
      // Create Entry 2 (System Collection) - same from/to as Entry 1, same approver
      // FROM: Collection person name (collector) - who collected the money
      // TO: Auto pay assigned person name (assigned receiver) - who receives the money
      // Works for BOTH AutoPay enabled and disabled cases
      console.log(`\n   Step 2: Creating Entry 2 (system collection)...`);
      // Entry 2 should have collectionType = 'collection' (as per requirement)
      entry2Collection = await Collection.create({
      voucherNumber: entry2VoucherNumber,
      collectedBy: null, // Created by System (null for system collections)
      from: collectedByUserId, // From: Collection person name (collector) - same as Entry 1
      customerName: collection.customerName,
      amount: collection.amount, // Same amount
      mode: collection.mode,
      paymentModeId: collection.paymentModeId,
      assignedReceiver: entry2AssignedReceiver, // To: Auto pay assigned person name (assigned receiver) - same as Entry 1
      proofUrl: collection.proofUrl,
      notes: collection.notes ? `System entry - ${collection.notes}` : 'System generated collection entry',
      status: 'Approved', // Auto-approved
      approvedBy: req.user._id, // Same approver as Entry 1
      approvedAt: new Date(),
      collectionType: 'collection', // Type is always 'collection' for Entry 2
      isSystemCollection: true,
      parentCollectionId: collection._id // Link to Entry 1
    });
    
    console.log(`     ✅ Entry 2 created: ${entry2Collection._id} (Voucher: ${entry2VoucherNumber})`);
    console.log(`     Entry 2 - From: Collector, To: ${assignedReceiverUserId ? 'Assigned Receiver' : 'Collector'}, Amount: ₹${collection.amount}, Approved by: Approver`);
    
    // Transaction entry creation removed - both AutoPay enabled and disabled work the same way
    // No separate transaction history entry needed for collection approvals
    // Entry 2 (System Collection) handles the wallet update and record keeping
    console.log(`\n   Step 3: Skipping transaction creation (No transaction entry needed for collection approvals)`);
    
    console.log(`[Collection Approval] ✅ Completed - Entry 1 (Pending→Approved, no wallet), Entry 2 (Approved, wallet updated)\n`);
    } else {
      console.log(`[Collection Approval] ⚠️  Collection was already approved - skipping wallet update to prevent double update\n`);
    }
    
    // Get wallets for notifications
    const collectedByWallet = await getOrCreateWallet(collectedByUserId);
    const assignedReceiverWallet = receiverUserId !== collectedByUserId ? await getOrCreateWallet(receiverUserId) : null;

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Approved collection: ${collection.voucherNumber}`,
      'Approve',
      'Collection',
      collection._id,
      { status: 'Pending' },
      { status: 'Approved' },
      req.ip
    );

    // Emit real-time update to super admin
    const collectedByUserObj = typeof collection.collectedBy === 'object' ? collection.collectedBy : null;
    const assignedReceiverUserObj = typeof collection.assignedReceiver === 'object' ? collection.assignedReceiver : null;
    
    await notifyAmountUpdate('collection', {
      collectionId: collection._id,
      voucherNumber: collection.voucherNumber,
      collectedBy: {
        userId: collectedByUserId,
        userName: collectedByUserObj?.name || 'Unknown'
      },
      assignedReceiver: assignedReceiverUserId ? {
        userId: assignedReceiverUserId,
        userName: assignedReceiverUserObj?.name || 'Unknown'
      } : null,
      amount: collection.amount,
      mode: collection.mode,
      customerName: collection.customerName,
      status: 'Approved',
      isAutoPay: collection.paymentModeId?.autoPay && collection.mode !== 'Cash',
      collectedByWallet: collectedByWallet ? {
        cashBalance: collectedByWallet.cashBalance,
        upiBalance: collectedByWallet.upiBalance,
        bankBalance: collectedByWallet.bankBalance,
        totalBalance: collectedByWallet.totalBalance
      } : null,
      assignedReceiverWallet: assignedReceiverWallet ? {
        cashBalance: assignedReceiverWallet.cashBalance,
        upiBalance: assignedReceiverWallet.upiBalance,
        bankBalance: assignedReceiverWallet.bankBalance,
        totalBalance: assignedReceiverWallet.totalBalance
      } : null,
      approvedBy: req.user._id
    });

    // Emit self wallet update to receiver (money added to their wallet via Entry 2)
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    const receiverWallet = entry2Wallet; // Wallet that was updated (Entry 2)
    // receiverUserId already declared above - this is who got the money
    const finalReceiverUserId = receiverUserId; // Who got the money (Entry 2)
    
    emitSelfWalletUpdate(finalReceiverUserId.toString(), {
      type: 'collection_approved',
      wallet: receiverWallet ? {
        cashBalance: receiverWallet.cashBalance,
        upiBalance: receiverWallet.upiBalance,
        bankBalance: receiverWallet.bankBalance,
        totalBalance: receiverWallet.totalBalance
      } : null,
      collection: {
        id: entry2Collection._id, // Entry 2 collection ID
        amount: collection.amount,
        mode: collection.mode,
        voucherNumber: entry2VoucherNumber, // Entry 2 voucher number
        status: 'Approved'
      },
      cashIn: collection.amount,
      operation: 'collection_received'
    });

    // Emit to collector if different from receiver
    if (collectedByUserId.toString() !== finalReceiverUserId.toString()) {
      emitSelfWalletUpdate(collectedByUserId.toString(), {
        type: 'collection_created',
        collection: {
          id: collection._id, // Entry 1 collection ID
          amount: collection.amount,
          mode: collection.mode,
          voucherNumber: collection.voucherNumber // Entry 1 voucher number
        },
        operation: 'collection_created'
      });
    }

    // Populate approvedBy before sending response
    await collection.populate('approvedBy', 'name email role');
    await entry2Collection.populate('collectedBy', 'name email role');
    await entry2Collection.populate('assignedReceiver', 'name email role');
    await entry2Collection.populate('approvedBy', 'name email role');
    
    res.status(200).json({
      success: true,
      message: 'Collection approved successfully',
      collection, // Entry 1
      systemCollection: entry2Collection // Entry 2 (system generated)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reject collection
// @route   POST /api/collections/:id/reject
// @access  Private (All authenticated users)
exports.rejectCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy')
      .populate('assignedReceiver');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // Store previous status for audit log and wallet reversal
    const previousStatus = collection.status;
    
    // Allow rejecting approved collections (with wallet reversal)
    // Only prevent rejection if already rejected
    if (collection.status === 'Rejected') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject collection that is already Rejected`
      });
    }

    // Safely extract user IDs with null checks
    const collectedByUserId = collection.collectedBy 
      ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
         ? collection.collectedBy._id 
         : collection.collectedBy)
      : null;
    
    const assignedReceiverUserId = collection.assignedReceiver
      ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id
         ? collection.assignedReceiver._id
         : collection.assignedReceiver)
      : null;
    
    // Validate collectedByUserId exists
    if (!collectedByUserId) {
      return res.status(400).json({
        success: false,
        message: 'Collection is missing collector information'
      });
    }
    
    // All authenticated users can reject collections

    // If collection was approved, reverse wallet changes before rejecting
    const wasApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    if (wasApproved) {
      // Find Entry 2 (system collection) to reverse wallet
      const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
      if (entry2) {
        // Determine receiver who got the money
        const receiverUserId = assignedReceiverUserId || collectedByUserId;
        
        if (receiverUserId) {
          // Reverse wallet: subtract the amount that was added
          await updateWalletBalance(receiverUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
          console.log(`[Collection Reject] Reversed wallet: -₹${collection.amount} from receiver`);
        }
        
        // Delete Entry 2
        await entry2.deleteOne();
        console.log(`[Collection Reject] Deleted Entry 2: ${entry2._id}`);
      }
    }

    collection.status = 'Rejected';
    // Clear approval fields when rejecting an approved collection
    if (wasApproved) {
      collection.approvedBy = undefined;
      collection.approvedAt = undefined;
    }
    await collection.save();

    await createAuditLog(
      req.user._id,
      `Rejected collection: ${collection.voucherNumber}`,
      'Reject',
      'Collection',
      collection._id,
      { status: previousStatus },
      { status: 'Rejected' },
      req.ip,
      req.body.reason
    );

    // Emit real-time update if SuperAdmin rejected collection
    if (req.user.role === 'SuperAdmin') {
      const collectedByUserObj = typeof collection.collectedBy === 'object' ? collection.collectedBy : null;
      const assignedReceiverUserObj = typeof collection.assignedReceiver === 'object' ? collection.assignedReceiver : null;
      
      await notifyAmountUpdate('collection_rejected', {
        collectionId: collection._id,
        voucherNumber: collection.voucherNumber,
        collectedBy: {
          userId: collectedByUserObj?._id || collectedByUserId,
          userName: collectedByUserObj?.name || 'Unknown'
        },
        assignedReceiver: assignedReceiverUserObj ? {
          userId: assignedReceiverUserObj._id,
          userName: assignedReceiverUserObj.name || 'Unknown'
        } : null,
        amount: collection.amount,
        mode: collection.mode,
        customerName: collection.customerName,
        status: 'Rejected',
        reason: req.body.reason,
        rejectedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Collection rejected successfully',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Flag collection
// @route   POST /api/collections/:id/flag
// @access  Private (All authenticated users)
exports.flagCollection = async (req, res) => {
  try {
    const { flagReason } = req.body;

    if (!flagReason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a flag reason'
      });
    }

    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy')
      .populate('assignedReceiver');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // All authenticated users can flag collections

    collection.status = 'Flagged';
    collection.flagReason = flagReason;
    collection.flaggedBy = req.user._id;
    collection.flaggedAt = new Date();
    await collection.save();

    // Emit dashboard summary update
    emitDashboardSummaryUpdate({ refresh: true });

    await createAuditLog(
      req.user._id,
      `Flagged collection: ${collection.voucherNumber}`,
      'Flag',
      'Collection',
      collection._id,
      { status: collection.status },
      { status: 'Flagged', flagReason },
      req.ip
    );

    // Emit real-time update if SuperAdmin flagged collection
    if (req.user.role === 'SuperAdmin') {
      const collectedByUserObj = typeof collection.collectedBy === 'object' ? collection.collectedBy : null;
      const assignedReceiverUserObj = typeof collection.assignedReceiver === 'object' ? collection.assignedReceiver : null;
      
      await notifyAmountUpdate('collection_flagged', {
        collectionId: collection._id,
        voucherNumber: collection.voucherNumber,
        collectedBy: {
          userId: collectedByUserObj?._id || collection.collectedBy,
          userName: collectedByUserObj?.name || 'Unknown'
        },
        assignedReceiver: assignedReceiverUserObj ? {
          userId: assignedReceiverUserObj._id,
          userName: assignedReceiverUserObj.name || 'Unknown'
        } : null,
        amount: collection.amount,
        mode: collection.mode,
        customerName: collection.customerName,
        status: 'Flagged',
        flagReason,
        flaggedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Collection flagged successfully',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Resubmit flagged collection
// @route   POST /api/collections/:id/resubmit
// @access  Private (All authenticated users - can resubmit their own flagged collections)
exports.resubmitCollection = async (req, res) => {
  try {
    const { response } = req.body;

    if (!response || !response.trim() || response.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a response'
      });
    }

    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy', 'name email')
      .populate('assignedReceiver', 'name email')
      .populate('flaggedBy', 'name email role');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    if (collection.status !== 'Flagged') {
      return res.status(400).json({
        success: false,
        message: 'Only flagged collections can be resubmitted'
      });
    }

    // Check authorization: User can resubmit collections they created/collected, or Admin/SuperAdmin/wallet.all.collection permission can resubmit any
    // Similar to expense: check multiple fields (collectedBy, from, assignedReceiver)
    const collectedByUserId = collection.collectedBy?._id?.toString() || collection.collectedBy?.toString();
    const fromUserId = collection.from ? (typeof collection.from === 'object' ? collection.from._id?.toString() : collection.from.toString()) : null;
    const assignedReceiverUserId = collection.assignedReceiver ? (typeof collection.assignedReceiver === 'object' ? collection.assignedReceiver._id?.toString() : collection.assignedReceiver.toString()) : null;
    
    const isCollector = collectedByUserId && collectedByUserId === req.user._id.toString();
    const isFrom = fromUserId && fromUserId === req.user._id.toString();
    const isReceiver = assignedReceiverUserId && assignedReceiverUserId === req.user._id.toString();
    const isOwner = isCollector || isFrom || isReceiver; // User can resubmit if they are collector, from, or receiver
    
    const isAdminOrSuperAdmin = req.user.role === 'Admin' || req.user.role === 'SuperAdmin';
    
    // Check if user has wallet.all.collection permission
    let hasWalletCollectionPermission = false;
    if (req.user.role && req.user.role !== 'SuperAdmin') {
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: req.user.role });
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          const allPermissions = [...(role.permissionIds || []), ...(req.user.userSpecificPermissions || [])];
          hasWalletCollectionPermission = allPermissions.some(permission => {
            return permission === 'wallet.all.collection' ||
                   permission === 'wallet.all' ||
                   permission.startsWith('wallet.all.collection.');
          });
        }
      } catch (error) {
        console.error('Error checking wallet permissions for resubmit:', error);
      }
    }

    if (!isOwner && !isAdminOrSuperAdmin && !hasWalletCollectionPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resubmit this collection'
      });
    }

    // Save response and change status back to Pending
    collection.response = response.trim();
    collection.responseDate = new Date();
    collection.status = 'Pending';
    await collection.save();

    // Emit dashboard summary update
    const { emitDashboardSummaryUpdate } = require('../utils/socketService');
    emitDashboardSummaryUpdate({ refresh: true });

    // Emit pending approvals update to refresh Smart Approvals (same as expense)
    const { emitPendingApprovalUpdate } = require('../utils/socketService');
    if (emitPendingApprovalUpdate) {
      emitPendingApprovalUpdate({ refresh: true, itemId: collection._id, type: 'Collection' });
    }

    // Emit collection update event for real-time updates (same pattern as expense)
    const { emitCollectionUpdate } = require('../utils/socketService');
    if (emitCollectionUpdate) {
      const collectionWithUser = await Collection.findById(collection._id)
        .populate('collectedBy', 'name email')
        .populate('from', 'name email')
        .populate('assignedReceiver', 'name email')
        .populate('flaggedBy', 'name email role')
        .lean();
      emitCollectionUpdate('resubmitted', collectionWithUser || collection.toObject());
    }

    console.log(`[Collection Resubmit] ✅ Collection ${collection.voucherNumber} (${collection._id}) resubmitted - Status changed to Pending, should appear in Smart Approvals`);

    await createAuditLog(
      req.user._id,
      `Resubmitted flagged collection: ${collection.voucherNumber}`,
      'Resubmit',
      'Collection',
      collection._id,
      { status: 'Flagged' },
      { status: 'Pending', response: collection.response },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Collection resubmitted successfully',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Edit collection
// @route   PUT /api/collections/:id
// @access  Private (Staff - own collections only)
exports.editCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      const collectedByUserId = typeof collection.collectedBy === 'object' ? collection.collectedBy._id : collection.collectedBy;
      if (!collectedByUserId || collectedByUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own collections'
        });
      }

      // Allow editing for 'Pending', 'Unaccounted', and 'Flagged' status
      if (collection.status !== 'Pending' && collection.status !== 'Unaccounted' && collection.status !== 'Flagged') {
        return res.status(400).json({
          success: false,
          message: `Cannot edit ${collection.status} collection. Only Pending, Unaccounted, or Flagged collections can be edited.`
        });
      }
    }
    // If fromAllWalletReport is true, allow editing regardless of status and ownership

    const previousValue = collection.toObject();
    const { customerName, amount, mode, proofUrl, notes } = req.body;

    if (customerName) collection.customerName = customerName;
    if (amount) collection.amount = amount;
    if (mode) collection.mode = mode;
    if (proofUrl !== undefined) collection.proofUrl = proofUrl;
    if (notes !== undefined) collection.notes = notes;

    await collection.save();

    await createAuditLog(
      req.user._id,
      `Edited collection: ${collection.voucherNumber}`,
      'Update',
      'Collection',
      collection._id,
      previousValue,
      collection.toObject(),
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Collection updated successfully',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Restore rejected collection
// @route   POST /api/collections/:id/restore
// @access  Private (Admin, SuperAdmin)
exports.restoreCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy')
      .populate('assignedReceiver');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    // If fromAllWalletReport is true, allow restoring regardless of status (including Approved)
    // Otherwise, only allow restoring rejected collections
    if (!fromAllWalletReport && collection.status !== 'Rejected') {
      return res.status(400).json({
        success: false,
        message: 'Can only restore rejected collections'
      });
    }

    // If collection was approved, reverse wallet changes before unapproving
    const wasApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    if (wasApproved) {
      // Find Entry 2 (system collection) to reverse wallet
      const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
      if (entry2) {
        // Determine receiver who got the money
        const assignedReceiverUserId = collection.assignedReceiver 
          ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id 
             ? collection.assignedReceiver._id 
             : collection.assignedReceiver)
          : (collection.collectedBy 
             ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
                ? collection.collectedBy._id 
                : collection.collectedBy)
             : null);
        
        if (assignedReceiverUserId) {
          // Reverse wallet: subtract the amount that was added
          await updateWalletBalance(assignedReceiverUserId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
          console.log(`[Collection Unapprove] Reversed wallet: -₹${collection.amount} from receiver`);
        }
        
        // Delete Entry 2
        await entry2.deleteOne();
        console.log(`[Collection Unapprove] Deleted Entry 2: ${entry2._id}`);
      }
    }

    collection.status = 'Pending';
    collection.approvedBy = undefined;
    collection.approvedAt = undefined;
    await collection.save();

    await createAuditLog(
      req.user._id,
      `Unapproved collection: ${collection.voucherNumber}`,
      'Unapprove',
      'Collection',
      collection._id,
      { status: wasApproved ? 'Approved' : collection.status },
      { status: 'Pending' },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Collection moved to pending (unapproved) and can be approved again',
      collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete collection
// @route   DELETE /api/collections/:id
// @access  Private (All authenticated users)
exports.deleteCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id)
      .populate('collectedBy')
      .populate('assignedReceiver');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found',
      });
    }

    // Check if request is from All Wallet Report (bypass status restrictions)
    const fromAllWalletReport = req.query.fromAllWalletReport === 'true' || req.body.fromAllWalletReport === true;
    
    if (!fromAllWalletReport) {
      // Normal restrictions for Self Wallet and other views
      if (collection.status === 'Approved') {
        return res.status(400).json({
          success: false,
          message: 'Approved collections cannot be deleted',
        });
      }
    }
    // If fromAllWalletReport is true, allow deletion regardless of status

    // All authenticated users can delete collections (except approved ones)

    // If collection was approved, reverse wallet changes before deleting
    const wasApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    if (wasApproved) {
      // Find Entry 2 (system collection) to reverse wallet
      const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
      if (entry2) {
        // Determine receiver who got the money
        const assignedReceiverUserId = collection.assignedReceiver 
          ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id 
             ? collection.assignedReceiver._id 
             : collection.assignedReceiver)
          : (collection.collectedBy 
             ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
                ? collection.collectedBy._id 
                : collection.collectedBy)
             : null);
        
        if (assignedReceiverUserId) {
          // Reverse wallet: subtract the amount that was added
          await updateWalletBalance(assignedReceiverUserId, collection.mode, collection.amount, 'subtract', 'collection_deletion');
          console.log(`[Collection Delete] Reversed wallet: -₹${collection.amount} from receiver`);
        }
        
        // Delete Entry 2
        await entry2.deleteOne();
        console.log(`[Collection Delete] Deleted Entry 2: ${entry2._id}`);
      }
    }

    const previousState = collection.toObject();
    await collection.deleteOne();

    await createAuditLog(
      req.user._id,
      `Deleted collection: ${collection.voucherNumber || collection._id}`,
      'Delete',
      'Collection',
      collection._id,
      previousState,
      null,
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Collection deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
