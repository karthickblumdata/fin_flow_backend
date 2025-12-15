const Collection = require('../models/collectionModel');
const Transaction = require('../models/transactionModel');
const PaymentMode = require('../models/paymentModeModel');
const User = require('../models/userModel');
const { updateWalletBalance, getOrCreateWallet, updatePaymentModeWalletBalance, getOrCreatePaymentModeWallet } = require('../utils/walletHelper');
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
// Helper function to extract mode from payment mode description (same as walletController)
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

exports.createCollection = async (req, res) => {
  try {
    const { customerName, amount, mode, paymentModeId, assignedReceiver, proofUrl, notes, customFields } = req.body;

    if (!customerName || !amount || !paymentModeId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customerName, amount, and paymentModeId'
      });
    }

    const paymentMode = await PaymentMode.findById(paymentModeId);
    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    // Extract mode from paymentMode if not provided, default to Cash
    let finalMode = mode;
    if (!finalMode) {
      finalMode = extractModeFromPaymentMode(paymentMode);
    }

    // If payment mode has AutoPay enabled, use payment mode's assignedReceiver (assigned user)
    // Otherwise, use provided assignedReceiver, paymentMode's assignedReceiver, or logged-in user as fallback
    // NOTE: AutoPay now works with ALL modes including Cash (default mode)
    let receiverId;
    if (paymentMode.autoPay === true) {
      // AutoPay enabled: use payment mode's assignedReceiver (assigned user) if exists, otherwise fallback to collector
      // Extract assignedReceiver from payment mode (handle both ObjectId and populated object)
      const paymentModeAssignedReceiver = paymentMode.assignedReceiver
        ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
           ? paymentMode.assignedReceiver._id
           : paymentMode.assignedReceiver)
        : null;
      receiverId = paymentModeAssignedReceiver || req.user._id; // Use assigned user from payment mode, fallback to collector
      console.log(`[Collection Creation] AutoPay enabled - assignedReceiver set to payment mode's assigned user (works with ALL modes including Cash)`);
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
    // If receiver doesn't exist, fallback to collector (logged-in user) instead of showing error
    let receiverUser = await User.findById(receiverId);
    if (!receiverUser) {
      // Receiver not found - fallback to collector (logged-in user)
      console.log(`[Collection Creation] Receiver user not found (ID: ${receiverId}), falling back to collector: ${req.user.email}`);
      receiverId = req.user._id;
      receiverUser = req.user; // Use logged-in user as receiver
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
    // NOTE: AutoPay now works with ALL modes including Cash (default mode)
    const isSystematicEntry = paymentMode.autoPay === true;
    // Set collectionType: 'systematic' if AutoPay enabled, otherwise 'collection'
    const collectionType = isSystematicEntry ? 'systematic' : 'collection';

    const collection = await Collection.create({
      voucherNumber,
      collectedBy: req.user._id, // Creator (collector)
      from: req.user._id, // From: Collection person name (collector) - who collected the money
      customerName,
      amount,
      mode: finalMode,
      paymentModeId,
      assignedReceiver: receiverId, // To: Auto pay assigned person name (assigned receiver) - who receives the money
      proofUrl,
      notes,
      status: 'Pending',
      collectionType: collectionType,
      isSystematicEntry: isSystematicEntry,
      customFields: customFields || {}
    });

    // Entry 1 (Creation): Update wallet based on AutoPay status
    // If AutoPay enabled: Collector gets cashIn + balance (money collected)
    // If AutoPay disabled: No wallet update (will be updated on approval)
    let collectorWallet = null;
    // CRITICAL: Only update wallet if AutoPay is explicitly enabled AND has assigned receiver
    // NOTE: AutoPay now works with ALL modes including Cash (default mode)
    const autoPayEnabled = paymentMode.autoPay === true;
    // Check if assignedReceiver exists in payment mode
    // When paymentMode is fetched without populate, assignedReceiver is an ObjectId (or null)
    // When populated, it's an object with _id property
    const assignedReceiverValue = paymentMode.assignedReceiver;
    
    // Enhanced check: Handle both ObjectId and populated object cases
    let hasAssignedReceiver = false;
    if (assignedReceiverValue) {
      if (typeof assignedReceiverValue === 'object') {
        // Check if it's a populated object with _id
        if (assignedReceiverValue._id) {
          const receiverIdStr = assignedReceiverValue._id.toString();
          hasAssignedReceiver = receiverIdStr && receiverIdStr !== '' && receiverIdStr !== 'null' && receiverIdStr.length > 0;
        } else if (assignedReceiverValue.toString) {
          // It's an ObjectId (not populated) - check toString
          const receiverIdStr = assignedReceiverValue.toString();
          hasAssignedReceiver = receiverIdStr && receiverIdStr !== '' && receiverIdStr !== 'null' && receiverIdStr.length > 0;
        }
      } else if (typeof assignedReceiverValue === 'string') {
        // String ID
        hasAssignedReceiver = assignedReceiverValue !== '' && assignedReceiverValue !== 'null';
      }
    }
    
    // AutoPay now works with ALL modes (Cash, UPI, Bank) - removed isNonCashMode restriction
    const shouldUpdateWalletAtCreation = autoPayEnabled && hasAssignedReceiver;
    
    // Enhanced debug logging
    console.log(`\n[Collection Creation] Wallet Update Check:`);
    console.log(`   AutoPay Enabled: ${autoPayEnabled}`);
    console.log(`   Payment Mode ID: ${paymentMode._id}`);
    console.log(`   Payment Mode Name: ${paymentMode.modeName}`);
    console.log(`   Assigned Receiver Value: ${assignedReceiverValue} (type: ${typeof assignedReceiverValue})`);
    if (assignedReceiverValue) {
      if (typeof assignedReceiverValue === 'object' && assignedReceiverValue._id) {
        console.log(`   Assigned Receiver ID (populated): ${assignedReceiverValue._id.toString()}`);
      } else if (typeof assignedReceiverValue === 'object' && assignedReceiverValue.toString) {
        console.log(`   Assigned Receiver ID (ObjectId): ${assignedReceiverValue.toString()}`);
      } else {
        console.log(`   Assigned Receiver ID (string): ${assignedReceiverValue}`);
      }
    } else {
      console.log(`   ⚠️  Assigned Receiver is NULL or UNDEFINED`);
    }
    console.log(`   Has Assigned Receiver: ${hasAssignedReceiver}`);
    console.log(`   Mode: ${finalMode} (AutoPay works with ALL modes including Cash)`);
    console.log(`   Should Update Wallet: ${shouldUpdateWalletAtCreation}`);
    console.log(`   Condition Breakdown: autoPayEnabled=${autoPayEnabled}, hasAssignedReceiver=${hasAssignedReceiver}`);
    
    if (shouldUpdateWalletAtCreation) {
      // AutoPay enabled: Update collector wallet (cashIn + balance)
      console.log(`\n[Collection Creation] Entry 1 created - AutoPay enabled, updating collector wallet...`);
      console.log(`   Collector (User ${req.user._id}) wallet update...`);
      console.log(`     - cashIn: +₹${amount}`);
      console.log(`     - Balance: +₹${amount}`);
      collectorWallet = await updateWalletBalance(
        req.user._id,
        finalMode,
        amount,
        'add',
        'collection' // transactionType 'collection' with 'add' operation: adds cashIn and balance
      );
      console.log(`   ✅ Collector Wallet Updated - CashIn: ₹${collectorWallet.cashIn}, CashOut: ₹${collectorWallet.cashOut}, Balance: ₹${collectorWallet.totalBalance} (+₹${amount})`);
      console.log(`   Note: On approval, money will be transferred to original assigned receiver`);
    } else {
      // AutoPay disabled OR no assigned receiver: No wallet update
      console.log(`\n[Collection Creation] Entry 1 created - Wallet NOT updated at creation`);
      if (!autoPayEnabled) {
        console.log(`   Reason: AutoPay is disabled`);
      } else if (!hasAssignedReceiver) {
        console.log(`   Reason: No assigned receiver in payment mode`);
      }
      console.log(`   Collection created with status: Pending`);
      console.log(`   Wallet will be updated only when collection is approved (Entry 2)`);
    }

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
    
    // Emit self wallet update to collector (use updated wallet if AutoPay enabled, otherwise get current wallet)
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    const walletToEmit = collectorWallet || await getOrCreateWallet(req.user._id);
    emitSelfWalletUpdate(req.user._id.toString(), {
      type: 'collection_created',
      wallet: {
        cashBalance: walletToEmit.cashBalance,
        upiBalance: walletToEmit.upiBalance,
        bankBalance: walletToEmit.bankBalance,
        totalBalance: walletToEmit.totalBalance,
        cashIn: walletToEmit.cashIn,
        cashOut: walletToEmit.cashOut
      }
    });

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
    
    // Fix: For system collections, ensure collectedBy is explicitly null (not undefined)
    // This ensures frontend can correctly detect system collections
    collections.forEach(collection => {
      if (collection.isSystemCollection && collection.collectedBy === undefined) {
        collection.collectedBy = null;
      }
    });
    
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
    
    // Allow approval for 'Pending', 'Unaccounted', and 'Rejected' status
    // If fromAllWalletReport is true, allow approval regardless of status
    if (!fromAllWalletReport && collection.status !== 'Pending' && collection.status !== 'Unaccounted' && collection.status !== 'Rejected') {
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
    
    // Get ORIGINAL assigned receiver from payment mode (not from collection)
    // When AutoPay is enabled, collection.assignedReceiver = collector, but we need the original assigned user
    const paymentMode = collection.paymentModeId;
    const originalAssignedReceiverId = paymentMode?.assignedReceiver
      ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
         ? paymentMode.assignedReceiver._id
         : paymentMode.assignedReceiver)
      : null;
    
    // Check AutoPay conditions
    const autoPayEnabled = paymentMode?.autoPay === true;
    // AutoPay now works with ALL modes (Cash, UPI, Bank) - removed isNonCashMode restriction
    const hasOriginalAssignedReceiver = originalAssignedReceiverId && 
                                        originalAssignedReceiverId.toString() !== '' && 
                                        originalAssignedReceiverId.toString() !== 'null';
    const canRunAutoPay = autoPayEnabled && hasOriginalAssignedReceiver;
    
    console.log(`\n[Collection Approval] Voucher: ${collection.voucherNumber}`);
    console.log(`   Collector (User1): ${collectedByUserId}`);
    console.log(`   Approver (User2): ${approverUserId}`);
    console.log(`   Collection Assigned Receiver: ${assignedReceiverUserId || 'None'}`);
    console.log(`   Original Assigned Receiver (from Payment Mode): ${originalAssignedReceiverId || 'None'}`);
    console.log(`   AutoPay Enabled: ${autoPayEnabled}, Mode: ${collection.mode}, Has Original Receiver: ${hasOriginalAssignedReceiver}`);
    console.log(`   Will Run AutoPay: ${canRunAutoPay}`);
    
    // Determine who gets the money
    // IMPORTANT: When AutoPay is enabled, money goes to original assigned receiver from payment mode
    // When AutoPay is disabled, money goes to assignedReceiver (if exists and different from collector) or collector
    // NOTE: Approver can be anyone, but money goes based on AutoPay status
    let receiverUserId;
    if (autoPayEnabled && hasOriginalAssignedReceiver) {
      // AutoPay enabled: Money goes to original assigned receiver from payment mode (works with ALL modes including Cash)
      receiverUserId = originalAssignedReceiverId || collectedByUserId;
      console.log(`   ✅ AutoPay Enabled: Money will go to ORIGINAL ASSIGNED RECEIVER (${receiverUserId})`);
    } else if (assignedReceiverUserId && assignedReceiverUserId.toString() !== collectedByUserId.toString()) {
      // AutoPay disabled: Money goes to assigned receiver (only if different from collector)
      receiverUserId = assignedReceiverUserId;
      console.log(`   ✅ AutoPay Disabled: Money will go to ASSIGNED RECEIVER (${assignedReceiverUserId})`);
    } else {
      // Fallback: Money goes to collector if no assigned receiver OR assigned receiver is same as collector
      receiverUserId = collectedByUserId;
      console.log(`   ✅ No Assigned Receiver (or same as collector): Money will go to COLLECTOR (${collectedByUserId})`);
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
      
      // Entry 2: FROM collector TO receiver (based on AutoPay status)
      // FROM: Collection person name (collector) - who collected the money
      // TO: When AutoPay enabled → original assigned receiver, When AutoPay disabled → assignedReceiver (if different) or collector
      const entry2CollectedBy = collectedByUserId; // Collector (same as Entry 1)
      // Entry 2's assignedReceiver: When AutoPay enabled, it's the original assigned receiver (who receives money)
      // When AutoPay disabled, it's the assignedReceiver (only if different from collector) or collector
      const entry2AssignedReceiver = (autoPayEnabled && hasOriginalAssignedReceiver)
        ? originalAssignedReceiverId  // AutoPay: use original assigned receiver from payment mode (works with ALL modes including Cash)
        : ((assignedReceiverUserId && assignedReceiverUserId.toString() !== collectedByUserId.toString()) 
           ? assignedReceiverUserId  // Use assignedReceiver only if different from collector
           : collectedByUserId); // Otherwise use collector (same as receiverUserId logic)
      
      const entry2VoucherNumber = generateVoucherNumber();
      
      // Update Payment Mode wallet first (if collection has paymentModeId and it's active with Collection display)
      let paymentModeWallet = null;
      if (collection.paymentModeId) {
        const paymentMode = await PaymentMode.findById(collection.paymentModeId);
        if (paymentMode && paymentMode.isActive) {
          const hasCollectionDisplay = paymentMode.display && paymentMode.display.includes('Collection');
          if (hasCollectionDisplay) {
            console.log(`\n   Step 0: Updating Payment Mode wallet (${paymentMode.modeName})...`);
            paymentModeWallet = await updatePaymentModeWalletBalance(
              collection.paymentModeId,
              collection.mode,
              collection.amount,
              'add',
              'collection'
            );
            console.log(`   ✅ Payment Mode Wallet Updated - CashIn: ₹${paymentModeWallet.cashIn}, CashOut: ₹${paymentModeWallet.cashOut}, Balance: ₹${paymentModeWallet.totalBalance} (+₹${collection.amount})`);
          }
        }
      }
      
      // Update wallets based on AutoPay status (Option B: Money Transferred from Collector to Receiver)
      // Step 1: Transfer money FROM Collector (CashOut + Balance decrease)
      // Step 2: Transfer money TO Receiver (CashIn + Balance increase)
      // SPECIAL CASE: If Collector = Receiver, skip transfer logic and only add cashIn (no cashOut)
      let entry2Wallet;
      let collectorWalletAfterTransfer = null;
      
      // Check if collector and receiver are the same person
      const isCollectorSameAsReceiver = collectedByUserId.toString() === receiverUserId.toString();
      
      if (isCollectorSameAsReceiver) {
        // Collector = Receiver: No transfer needed, just add cashIn and balance directly
        // IMPORTANT: cashIn added ONLY ONCE, cashOut NOT increased (no transfer)
        console.log(`\n   ⚠️  Collector and Receiver are the same person - Skipping transfer logic`);
        console.log(`   Adding ₹${collection.amount} directly to Collector/Receiver wallet (User ID: ${collectedByUserId})`);
        console.log(`     - cashIn: +₹${collection.amount} (ONLY ONCE)`);
        console.log(`     - Balance: +₹${collection.amount}`);
        console.log(`     - cashOut: NO CHANGE (no transfer needed, will NOT increase)`);
        entry2Wallet = await updateWalletBalance(
          collectedByUserId,
          collection.mode,
          collection.amount,
          'add',
          'collection' // transactionType 'collection' with 'add' operation: adds cashIn only, does NOT add cashOut
        );
        collectorWalletAfterTransfer = entry2Wallet; // Same wallet for both
        console.log(`   ✅ Collector/Receiver Wallet Updated - CashIn: ₹${entry2Wallet.cashIn}, CashOut: ₹${entry2Wallet.cashOut}, Balance: ₹${entry2Wallet.totalBalance} (+₹${collection.amount})`);
        console.log(`   ✅ VERIFIED: cashIn added once, cashOut unchanged`);
      } else {
        // Collector ≠ Receiver: Normal transfer logic
        // Step 1: Subtract from Collector wallet (money transferred out)
        // When AutoPay enabled: Collector already has cashIn + balance from creation
        // On approval: Subtract balance and add cashOut (so cashIn=5, cashOut=5, balance=0)
        // When AutoPay disabled: Collector doesn't have balance yet, so subtract balance and add cashOut
        console.log(`\n   Step 1: Transferring money FROM Collector wallet...`);
        console.log(`   Collector (User ${collectedByUserId}) wallet update...`);
        if (autoPayEnabled && hasOriginalAssignedReceiver) {
          console.log(`   AutoPay Enabled: Collector already has cashIn + balance from creation (works with ALL modes including Cash)`);
          console.log(`     - cashOut: +₹${collection.amount} (transferring out)`);
          console.log(`     - Balance: -₹${collection.amount} (transferring out)`);
        } else {
          console.log(`   AutoPay Disabled: Collector wallet update`);
          console.log(`     - cashOut: +₹${collection.amount}`);
          console.log(`     - Balance: -₹${collection.amount}`);
        }
        collectorWalletAfterTransfer = await updateWalletBalance(
          collectedByUserId,
          collection.mode,
          collection.amount,
          'subtract',
          'collection_transfer'
        );
        console.log(`   ✅ Collector Wallet Updated - CashIn: ₹${collectorWalletAfterTransfer.cashIn}, CashOut: ₹${collectorWalletAfterTransfer.cashOut}, Balance: ₹${collectorWalletAfterTransfer.totalBalance} (-₹${collection.amount})`);
        
        // Step 2: Add to Receiver wallet (money transferred in)
        if (autoPayEnabled && hasOriginalAssignedReceiver) {
          // AutoPay enabled: Money goes to Original Assigned Receiver (works with ALL modes including Cash)
          console.log(`\n   Step 2: AutoPay Enabled - Transferring money TO Original Assigned Receiver...`);
          console.log(`   Updating ORIGINAL ASSIGNED RECEIVER (User ${originalAssignedReceiverId}) wallet...`);
          console.log(`     - cashIn: +₹${collection.amount}`);
          console.log(`     - Balance: +₹${collection.amount}`);
          entry2Wallet = await updateWalletBalance(
            originalAssignedReceiverId, 
            collection.mode, 
            collection.amount, 
            'add', 
            'collection'
          );
          console.log(`     ✅ Original Assigned Receiver Wallet Updated - CashIn: ₹${entry2Wallet.cashIn}, CashOut: ₹${entry2Wallet.cashOut}, Balance: ₹${entry2Wallet.totalBalance} (+₹${collection.amount})`);
        } else {
          // AutoPay disabled: Money goes to Assigned Receiver or Collector (if same person)
          console.log(`\n   Step 2: AutoPay Disabled - Transferring money TO Receiver...`);
          const receiverType = (receiverUserId === assignedReceiverUserId ? 'Assigned Receiver' : 'Collector');
          console.log(`   Adding ₹${collection.amount} to ${receiverType}'s wallet (User ID: ${receiverUserId})`);
          console.log(`   Transaction Type: 'collection' (should update cashIn)`);
          entry2Wallet = await updateWalletBalance(receiverUserId, collection.mode, collection.amount, 'add', 'collection');
          console.log(`   Wallet Updated - CashIn: ₹${entry2Wallet.cashIn}, CashOut: ₹${entry2Wallet.cashOut}, Balance: ₹${entry2Wallet.totalBalance} (+₹${collection.amount})`);
        }
      }
      
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
    // Use original assigned receiver for notifications (when AutoPay enabled) or collection assignedReceiver (when disabled)
    const finalAssignedReceiverId = (autoPayEnabled && hasOriginalAssignedReceiver) 
      ? originalAssignedReceiverId 
      : assignedReceiverUserId;
    const assignedReceiverUserObj = finalAssignedReceiverId 
      ? (typeof collection.assignedReceiver === 'object' ? collection.assignedReceiver : null)
      : null;
    // If AutoPay enabled, get original assigned receiver user object
    let originalAssignedReceiverUserObj = null;
    if (autoPayEnabled && hasOriginalAssignedReceiver) {
      const originalUser = await User.findById(originalAssignedReceiverId);
      originalAssignedReceiverUserObj = originalUser ? { name: originalUser.name, email: originalUser.email } : null;
    }
    
    await notifyAmountUpdate('collection', {
      collectionId: collection._id,
      voucherNumber: collection.voucherNumber,
      collectedBy: {
        userId: collectedByUserId,
        userName: collectedByUserObj?.name || 'Unknown'
      },
      assignedReceiver: finalAssignedReceiverId ? {
        userId: finalAssignedReceiverId,
        userName: (autoPayEnabled && hasOriginalAssignedReceiver && originalAssignedReceiverUserObj) 
          ? (originalAssignedReceiverUserObj.name || 'Unknown')
          : (assignedReceiverUserObj?.name || 'Unknown')
      } : null,
      amount: collection.amount,
      mode: collection.mode,
      customerName: collection.customerName,
      status: 'Approved',
      isAutoPay: collection.paymentModeId?.autoPay, // AutoPay now works with ALL modes including Cash
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
    // When AutoPay enabled, receiver is original assigned receiver. Otherwise, use receiverUserId
    const finalReceiverUserId = (autoPayEnabled && hasOriginalAssignedReceiver) 
      ? originalAssignedReceiverId 
      : receiverUserId;
    const receiverWallet = entry2Wallet; // Wallet that was updated (Entry 2)
    
    // Emit to original assigned receiver (when AutoPay enabled) or normal receiver
    if (finalReceiverUserId && entry2Wallet) {
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
    }
    
    // Collector wallet NOT updated when AutoPay enabled (collector just collects, doesn't keep money)
    // No socket notification needed for collector

    // Emit to collector if different from receiver (for normal flow, not AutoPay)
    if (!autoPayEnabled && collectedByUserId.toString() !== finalReceiverUserId.toString()) {
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
    await entry2Collection.populate('from', 'name email role'); // Populate 'from' field (collector) for system collections
    await entry2Collection.populate('assignedReceiver', 'name email role');
    await entry2Collection.populate('approvedBy', 'name email role');
    
    // Fix: Ensure collectedBy is explicitly null (not undefined) for system collections
    // This ensures frontend can correctly detect system collections
    if (entry2Collection && entry2Collection.isSystemCollection && entry2Collection.collectedBy === undefined) {
      entry2Collection.collectedBy = null;
    }
    
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

    // Reverse wallet changes based on collection status
    const wasApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    const wasPending = collection.status === 'Pending';
    
    // Get payment mode to check AutoPay status
    const paymentMode = await PaymentMode.findById(collection.paymentModeId);
    const autoPayWasEnabled = paymentMode?.autoPay === true; // AutoPay now works with ALL modes including Cash
    
    // If collection was Pending (created but not approved), check if AutoPay was enabled
    // If AutoPay enabled: Collector got cashIn + balance at creation, need to reverse it
    // If AutoPay disabled: No wallet update at creation, nothing to reverse
    if (wasPending) {
      if (autoPayWasEnabled && paymentMode?.assignedReceiver) {
        // AutoPay was enabled: Collector got cashIn + balance at creation, need to reverse
        console.log(`[Collection Reject] Collection was Pending - AutoPay was enabled, reversing collector wallet...`);
        console.log(`   Reversing Collector (User ${collectedByUserId}) wallet...`);
        console.log(`     - cashIn: -₹${collection.amount}`);
        console.log(`     - Balance: -₹${collection.amount}`);
        await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
        console.log(`   ✅ Collector wallet reversed`);
      } else {
        // AutoPay was disabled: No wallet update at creation, nothing to reverse
        console.log(`[Collection Reject] Collection was Pending - AutoPay disabled, no wallet reversal needed`);
        console.log(`   Entry 1 (creation) does NOT update wallet, so nothing to reverse`);
      }
    }
    
    // If collection was approved, reverse approval wallet changes
    if (wasApproved) {
      // Get original assigned receiver from payment mode
      const paymentMode = await PaymentMode.findById(collection.paymentModeId);
      const originalAssignedReceiverId = paymentMode?.assignedReceiver
        ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
           ? paymentMode.assignedReceiver._id
           : paymentMode.assignedReceiver)
        : null;
      
      // Check if AutoPay was enabled (works with ALL modes including Cash)
      const autoPayWasEnabled = paymentMode?.autoPay === true;
      
      // Step 1: Reverse Collector wallet (money transfer out was done during approval)
      console.log(`[Collection Reject] Collection was Approved - Reversing approval wallet changes...`);
      
      // Determine receiver who got the money during approval
      let approvalReceiverId = null;
      if (autoPayWasEnabled && originalAssignedReceiverId) {
        approvalReceiverId = originalAssignedReceiverId;
      } else {
        // AutoPay was disabled: Check Entry 2 to find receiver
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          approvalReceiverId = entry2.assignedReceiver 
            ? (typeof entry2.assignedReceiver === 'object' && entry2.assignedReceiver._id 
               ? entry2.assignedReceiver._id 
               : entry2.assignedReceiver)
            : (assignedReceiverUserId || collectedByUserId); // Fallback to original logic
        } else {
          approvalReceiverId = assignedReceiverUserId || collectedByUserId;
        }
      }
      
      // Check if collector and receiver are the same person
      const wasCollectorSameAsReceiver = collectedByUserId.toString() === (approvalReceiverId?.toString() || '');
      
      if (wasCollectorSameAsReceiver) {
        // Collector = Receiver: Only reverse cashIn (no transfer reversal needed)
        console.log(`   ⚠️  Collector and Receiver were the same person - Reversing cashIn only (no transfer reversal)`);
        console.log(`   Reversing Collector/Receiver (User ${collectedByUserId}) wallet...`);
        console.log(`     - cashIn: -₹${collection.amount}`);
        console.log(`     - Balance: -₹${collection.amount}`);
        console.log(`     - cashOut: NO CHANGE (no transfer was done)`);
        await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
        console.log(`   ✅ Collector/Receiver wallet reversed`);
        
        // Delete Entry 2 if it exists
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          await entry2.deleteOne();
          console.log(`[Collection Reject] Deleted Entry 2: ${entry2._id}`);
        }
      } else {
        // Collector ≠ Receiver: Normal transfer reversal
        console.log(`   Step 1: Reversing Collector wallet (transfer out reversal)...`);
        console.log(`     - cashOut: -₹${collection.amount}`);
        console.log(`     - Balance: +₹${collection.amount}`);
        await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'add', 'collection_reversal');
        console.log(`   ✅ Collector wallet transfer reversed`);
        
        // Step 2: Reverse Receiver wallet (money transfer in was done during approval)
        if (autoPayWasEnabled && originalAssignedReceiverId) {
          // AutoPay was enabled: Reverse receiver wallet
          console.log(`   Step 2: AutoPay was enabled - Reversing Original Assigned Receiver wallet...`);
          console.log(`   Reversing ORIGINAL ASSIGNED RECEIVER (User ${originalAssignedReceiverId}) wallet...`);
          await updateWalletBalance(originalAssignedReceiverId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
          console.log(`   ✅ Original Assigned Receiver wallet reversed`);
        } else {
          // AutoPay was disabled: Reverse receiver wallet
          const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
          let entry2ReceiverId = null;
          
          if (entry2) {
            // Determine receiver who got the money - use Entry 2's assignedReceiver
            entry2ReceiverId = entry2.assignedReceiver 
              ? (typeof entry2.assignedReceiver === 'object' && entry2.assignedReceiver._id 
                 ? entry2.assignedReceiver._id 
                 : entry2.assignedReceiver)
              : (assignedReceiverUserId || collectedByUserId); // Fallback to original logic
            
            // Delete Entry 2
            await entry2.deleteOne();
            console.log(`[Collection Reject] Deleted Entry 2: ${entry2._id}`);
          } else {
            // Entry 2 doesn't exist - use collection's assignedReceiver or collector as fallback
            entry2ReceiverId = assignedReceiverUserId || collectedByUserId;
            console.log(`[Collection Reject] Entry 2 not found - Using fallback receiver: ${entry2ReceiverId}`);
          }
          
          if (entry2ReceiverId) {
            console.log(`   Step 2: AutoPay was disabled - Reversing Receiver wallet...`);
            // Reverse wallet: subtract the amount that was added
            await updateWalletBalance(entry2ReceiverId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
            console.log(`[Collection Reject] Reversed wallet: -₹${collection.amount} from receiver (${entry2ReceiverId})`);
          }
        }
      }
      
      // Step 3: Reverse Payment Mode wallet if it was updated during approval
      if (collection.paymentModeId) {
        const paymentModeForReversal = await PaymentMode.findById(collection.paymentModeId);
        if (paymentModeForReversal && paymentModeForReversal.isActive) {
          const hasCollectionDisplay = paymentModeForReversal.display && paymentModeForReversal.display.includes('Collection');
          if (hasCollectionDisplay) {
            console.log(`   Step 3: Reversing Payment Mode wallet...`);
            await updatePaymentModeWalletBalance(collection.paymentModeId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
            console.log(`[Collection Reject] ✅ Payment Mode wallet reversed`);
          }
        }
      }
      
      // Step 4: If AutoPay was enabled, also reverse the creation wallet update
      // When AutoPay enabled: Collector got cashIn + balance at creation, need to reverse it
      if (autoPayWasEnabled && originalAssignedReceiverId && !wasCollectorSameAsReceiver) {
        console.log(`   Step 4: AutoPay was enabled - Reversing creation wallet update for collector...`);
        console.log(`   Reversing Collector (User ${collectedByUserId}) creation wallet update...`);
        console.log(`     - cashIn: -₹${collection.amount} (from creation)`);
        console.log(`     - Balance: -₹${collection.amount} (from creation)`);
        await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
        console.log(`   ✅ Collector creation wallet update reversed`);
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
      // Get original assigned receiver from payment mode
      const paymentMode = collection.paymentModeId;
      const originalAssignedReceiverId = paymentMode?.assignedReceiver
        ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
           ? paymentMode.assignedReceiver._id
           : paymentMode.assignedReceiver)
        : null;
      
      // Check if AutoPay was enabled (only reverse receiver wallet, collector wallet not updated)
      const autoPayWasEnabled = paymentMode?.autoPay === true && collection.mode !== 'Cash';
      
      if (autoPayWasEnabled && originalAssignedReceiverId) {
        // AutoPay was enabled: Reverse approval changes (both collector and receiver wallets)
        // Collector: reverse cashOut and balance (from approval transfer)
        // Receiver: reverse cashIn and balance (from approval)
        // Note: Collector still keeps cashIn from creation (since it's moving back to Pending, not deleted)
        console.log(`[Collection Unapprove] AutoPay was enabled - Reversing approval wallet changes...`);
        
        // Step 1: Reverse Collector wallet (cashOut and balance from approval transfer)
        const collectedByUserId = collection.collectedBy?._id || collection.collectedBy;
        if (collectedByUserId) {
          console.log(`   Step 1: Reversing Collector (User ${collectedByUserId}) approval wallet changes...`);
          console.log(`     - cashOut: -₹${collection.amount} (from approval transfer)`);
          console.log(`     - Balance: +₹${collection.amount} (from approval transfer)`);
          await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'add', 'collection_reversal');
          console.log(`   ✅ Collector approval wallet changes reversed`);
          console.log(`   Note: Collector still has cashIn from creation (will remain when moved to Pending)`);
        }
        
        // Step 2: Reverse Original Assigned Receiver's wallet (cashIn - amount, balance - amount)
        console.log(`   Step 2: Reversing ORIGINAL ASSIGNED RECEIVER (User ${originalAssignedReceiverId}) wallet...`);
        await updateWalletBalance(originalAssignedReceiverId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
        console.log(`   ✅ Original Assigned Receiver wallet reversed`);
        
        // Delete Entry 2 if exists
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          await entry2.deleteOne();
          console.log(`[Collection Unapprove] Deleted Entry 2: ${entry2._id}`);
        }
      } else {
        // AutoPay was disabled: Reverse single wallet (normal flow)
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          // Determine receiver who got the money - use Entry 2's assignedReceiver
          const entry2ReceiverId = entry2.assignedReceiver 
            ? (typeof entry2.assignedReceiver === 'object' && entry2.assignedReceiver._id 
               ? entry2.assignedReceiver._id 
               : entry2.assignedReceiver)
            : (collection.assignedReceiver 
               ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id 
                  ? collection.assignedReceiver._id 
                  : collection.assignedReceiver)
               : (collection.collectedBy 
                  ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
                     ? collection.collectedBy._id 
                     : collection.collectedBy)
                  : null));
          
          if (entry2ReceiverId) {
            // Reverse wallet: subtract the amount that was added
            await updateWalletBalance(entry2ReceiverId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
            console.log(`[Collection Unapprove] Reversed wallet: -₹${collection.amount} from receiver (${entry2ReceiverId})`);
          }
          
          // Delete Entry 2
          await entry2.deleteOne();
          console.log(`[Collection Unapprove] Deleted Entry 2: ${entry2._id}`);
        }
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
      .populate('assignedReceiver')
      .populate('paymentModeId');

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

    // Get payment mode to check AutoPay status
    const paymentMode = collection.paymentModeId;
    const autoPayWasEnabled = paymentMode?.autoPay === true && collection.mode !== 'Cash';
    const originalAssignedReceiverId = paymentMode?.assignedReceiver
      ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
         ? paymentMode.assignedReceiver._id
         : paymentMode.assignedReceiver)
      : null;
    
    // If collection was Pending and AutoPay was enabled, reverse creation wallet update
    const wasPending = collection.status === 'Pending';
    if (wasPending && autoPayWasEnabled && originalAssignedReceiverId) {
      // AutoPay was enabled: Collector got cashIn + balance at creation, need to reverse it
      console.log(`[Collection Delete] Collection was Pending - AutoPay was enabled, reversing collector creation wallet...`);
      const collectedByUserId = collection.collectedBy?._id || collection.collectedBy;
      if (collectedByUserId) {
        console.log(`   Reversing Collector (User ${collectedByUserId}) creation wallet...`);
        console.log(`     - cashIn: -₹${collection.amount} (from creation)`);
        console.log(`     - Balance: -₹${collection.amount} (from creation)`);
        await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
        console.log(`   ✅ Collector creation wallet reversed`);
      }
    }
    
    // If collection was approved, reverse wallet changes before deleting
    const wasApproved = collection.status === 'Approved' || collection.status === 'Accounted';
    if (wasApproved) {
      if (autoPayWasEnabled && originalAssignedReceiverId) {
        // AutoPay was enabled: Reverse both wallets (creation + approval changes)
        console.log(`[Collection Delete] AutoPay was enabled - Reversing TWO wallets (creation + approval)...`);
        
        const collectedByUserId = collection.collectedBy?._id || collection.collectedBy;
        if (collectedByUserId) {
          // Step 1: Reverse Collector's approval changes (cashOut and balance from transfer)
          console.log(`   Step 1: Reversing Collector (User ${collectedByUserId}) approval wallet changes...`);
          console.log(`     - cashOut: -₹${collection.amount} (from approval transfer)`);
          console.log(`     - Balance: +₹${collection.amount} (from approval transfer)`);
          await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'add', 'collection_reversal');
          console.log(`   ✅ Collector approval wallet changes reversed`);
          
          // Step 2: Reverse Collector's creation changes (cashIn and balance from creation)
          console.log(`   Step 2: Reversing Collector (User ${collectedByUserId}) creation wallet changes...`);
          console.log(`     - cashIn: -₹${collection.amount} (from creation)`);
          console.log(`     - Balance: -₹${collection.amount} (from creation)`);
          await updateWalletBalance(collectedByUserId, collection.mode, collection.amount, 'subtract', 'collection_rejection');
          console.log(`   ✅ Collector creation wallet changes reversed`);
        }
        
        // Step 3: Reverse Original Assigned Receiver's wallet (cashIn - amount, balance - amount)
        console.log(`   Step 3: Reversing ORIGINAL ASSIGNED RECEIVER (User ${originalAssignedReceiverId}) wallet...`);
        await updateWalletBalance(originalAssignedReceiverId, collection.mode, collection.amount, 'subtract', 'collection_reversal');
        console.log(`   ✅ Original Assigned Receiver wallet reversed`);
        
        // Delete Entry 2 if exists
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          await entry2.deleteOne();
          console.log(`[Collection Delete] Deleted Entry 2: ${entry2._id}`);
        }
      } else {
        // AutoPay was disabled: Reverse single wallet (normal flow)
        const entry2 = await Collection.findOne({ parentCollectionId: collection._id, isSystemCollection: true });
        if (entry2) {
          // Determine receiver who got the money - use Entry 2's assignedReceiver
          const entry2ReceiverId = entry2.assignedReceiver 
            ? (typeof entry2.assignedReceiver === 'object' && entry2.assignedReceiver._id 
               ? entry2.assignedReceiver._id 
               : entry2.assignedReceiver)
            : (collection.assignedReceiver 
               ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id 
                  ? collection.assignedReceiver._id 
                  : collection.assignedReceiver)
               : (collection.collectedBy 
                  ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
                     ? collection.collectedBy._id 
                     : collection.collectedBy)
                  : null));
          
          if (entry2ReceiverId) {
            // Reverse wallet: subtract the amount that was added
            await updateWalletBalance(entry2ReceiverId, collection.mode, collection.amount, 'subtract', 'collection_deletion');
            console.log(`[Collection Delete] Reversed wallet: -₹${collection.amount} from receiver (${entry2ReceiverId})`);
          }
          
          // Delete Entry 2
          await entry2.deleteOne();
          console.log(`[Collection Delete] Deleted Entry 2: ${entry2._id}`);
        }
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
