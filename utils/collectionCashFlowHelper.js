const Collection = require('../models/collectionModel');
const Wallet = require('../models/walletModel');
const PaymentMode = require('../models/paymentModeModel');
const { getOrCreateWallet } = require('./walletHelper');

/**
 * Calculate cash in from collections for a user
 * @param {String} userId - User ID
 * @param {Array} collections - Array of collection documents
 * @returns {Number} Total cash in from collections
 */
const calculateCollectionCashIn = (userId, collections) => {
  let cashIn = 0;
  
  collections.forEach(collection => {
    // Only count Entry 2 (system collections) - Entry 1 doesn't update wallet
    const isEntry2 = collection.isSystemCollection === true || !!collection.parentCollectionId;
    
    if (!isEntry2) {
      return; // Skip Entry 1
    }
    
    // Check if collection is approved/verified
    if (collection.status !== 'Approved' && collection.status !== 'Verified') {
      return;
    }
    
    const userIdStr = userId.toString();
    const collectedBy = collection.collectedBy 
      ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id 
         ? collection.collectedBy._id.toString() 
         : collection.collectedBy.toString())
      : null;
    
    const assignedReceiver = collection.assignedReceiver
      ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id
         ? collection.assignedReceiver._id.toString()
         : collection.assignedReceiver.toString())
      : null;
    
    // User gets cash in if they are the assigned receiver in Entry 2
    if (assignedReceiver === userIdStr) {
      cashIn += collection.amount || 0;
    }
  });
  
  return cashIn;
};

/**
 * Calculate cash out from collections for a user
 * Collections typically don't create cash out (only expenses/transactions do)
 * @param {String} userId - User ID
 * @param {Array} collections - Array of collection documents
 * @returns {Number} Total cash out from collections (usually 0)
 */
const calculateCollectionCashOut = (userId, collections) => {
  // Collections don't create cash out - they only create cash in
  // Cash out comes from expenses, transactions sent, withdrawals
  return 0;
};

/**
 * Get collection balance impact for a user
 * @param {String} userId - User ID
 * @param {Array} collections - Array of collection documents
 * @returns {Object} Balance impact { cashIn, cashOut, netBalance }
 */
const getCollectionBalance = (userId, collections) => {
  const cashIn = calculateCollectionCashIn(userId, collections);
  const cashOut = calculateCollectionCashOut(userId, collections);
  
  return {
    cashIn,
    cashOut,
    netBalance: cashIn - cashOut
  };
};

/**
 * Process collection with autopay logic
 * @param {Object} collection - Collection document
 * @param {Object} paymentMode - Payment mode document
 * @returns {Object} Processing result with wallet update info
 */
const processCollectionWithAutopay = (collection, paymentMode) => {
  const autoPayEnabled = paymentMode?.autoPay === true;
  const isNonCashMode = collection.mode !== 'Cash';
  const originalAssignedReceiverId = paymentMode?.assignedReceiver
    ? (typeof paymentMode.assignedReceiver === 'object' && paymentMode.assignedReceiver._id
       ? paymentMode.assignedReceiver._id
       : paymentMode.assignedReceiver)
    : null;
  
  const canRunAutoPay = autoPayEnabled && isNonCashMode && originalAssignedReceiverId;
  
  if (!canRunAutoPay) {
    return {
      autopay: false,
      receiver: null,
      collector: null,
      walletUpdated: false
    };
  }
  
  const collectedBy = collection.collectedBy
    ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id
       ? collection.collectedBy._id
       : collection.collectedBy)
    : null;
  
  return {
    autopay: true,
    receiver: originalAssignedReceiverId, // Money goes to original assigned receiver
    collector: collectedBy, // Collector doesn't get money
    walletUpdated: true,
    entry1: {
      status: 'Approved',
      walletUpdated: false,
      note: 'Entry 1: Collector creates, status Approved, wallet NOT updated'
    },
    entry2: {
      status: 'Approved',
      walletUpdated: true,
      receiver: originalAssignedReceiverId,
      note: 'Entry 2: System collection, only Original Assigned Receiver wallet updated'
    }
  };
};

/**
 * Process collection without autopay logic
 * @param {Object} collection - Collection document
 * @returns {Object} Processing result with wallet update info
 */
const processCollectionWithoutAutopay = (collection) => {
  const collectedBy = collection.collectedBy
    ? (typeof collection.collectedBy === 'object' && collection.collectedBy._id
       ? collection.collectedBy._id
       : collection.collectedBy)
    : null;
  
  const assignedReceiver = collection.assignedReceiver
    ? (typeof collection.assignedReceiver === 'object' && collection.assignedReceiver._id
       ? collection.assignedReceiver._id
       : collection.assignedReceiver)
    : null;
  
  // Receiver is assignedReceiver if exists, otherwise collector
  const receiver = assignedReceiver || collectedBy;
  
  return {
    autopay: false,
    receiver: receiver,
    collector: collectedBy,
    walletUpdated: true,
    entry1: {
      status: 'Approved',
      walletUpdated: false,
      note: 'Entry 1: Collector creates, status Approved, wallet NOT updated'
    },
    entry2: {
      status: 'Approved',
      walletUpdated: true,
      receiver: receiver,
      note: 'Entry 2: System collection, receiver wallet updated (assignedReceiver or collector)'
    }
  };
};

/**
 * Generate cash flow table for User1 and User2
 * @param {String} user1Id - User1 ID (Collector)
 * @param {String} user2Id - User2 ID (Receiver)
 * @param {Object} collection - Collection document
 * @param {Object} paymentMode - Payment mode document
 * @param {Boolean} withAutopay - Whether autopay is enabled
 * @returns {Array} Table rows showing cash flow
 */
const generateCashFlowTable = async (user1Id, user2Id, collection, paymentMode, withAutopay = false) => {
  const amount = collection.amount || 0;
  const table = [];
  
  // Get initial wallet states
  const user1Wallet = await getOrCreateWallet(user1Id);
  const user2Wallet = await getOrCreateWallet(user2Id);
  
  const initialUser1Balance = (user1Wallet.cashBalance || 0) + (user1Wallet.upiBalance || 0) + (user1Wallet.bankBalance || 0);
  const initialUser1CashIn = user1Wallet.cashIn || 0;
  const initialUser1CashOut = user1Wallet.cashOut || 0;
  
  const initialUser2Balance = (user2Wallet.cashBalance || 0) + (user2Wallet.upiBalance || 0) + (user2Wallet.bankBalance || 0);
  const initialUser2CashIn = user2Wallet.cashIn || 0;
  const initialUser2CashOut = user2Wallet.cashOut || 0;
  
  // Initial state
  table.push({
    step: 'Initial',
    entry: '-',
    user: 'User1 (Collector)',
    role: 'Collector',
    action: 'Initial State',
    cashIn: initialUser1CashIn,
    cashOut: initialUser1CashOut,
    balance: initialUser1Balance,
    notes: 'Before collection'
  });
  
  table.push({
    step: 'Initial',
    entry: '-',
    user: 'User2 (Receiver)',
    role: withAutopay ? 'Original Assigned Receiver' : 'Assigned Receiver',
    action: 'Initial State',
    cashIn: initialUser2CashIn,
    cashOut: initialUser2CashOut,
    balance: initialUser2Balance,
    notes: 'Before collection'
  });
  
  // Entry 1: Collection created
  table.push({
    step: 'Step 1',
    entry: 'Entry 1',
    user: 'User1 (Collector)',
    role: 'Collector',
    action: 'Creates Collection',
    cashIn: initialUser1CashIn,
    cashOut: initialUser1CashOut,
    balance: initialUser1Balance,
    notes: 'Collection created, Status: Pending → Approved, Wallet NOT updated'
  });
  
  // Entry 2: System collection
  if (withAutopay) {
    // With Autopay: Only User2 gets money
    table.push({
      step: 'Step 2',
      entry: 'Entry 2',
      user: 'User2 (Original Assigned Receiver)',
      role: 'Original Assigned Receiver',
      action: 'System Collection Created',
      cashIn: initialUser2CashIn + amount,
      cashOut: initialUser2CashOut,
      balance: initialUser2Balance + amount,
      notes: 'System collection, User2 wallet updated (+₹' + amount + ')'
    });
    
    table.push({
      step: 'Step 2',
      entry: 'Entry 2',
      user: 'User1 (Collector)',
      role: 'Collector',
      action: 'No Wallet Update',
      cashIn: initialUser1CashIn,
      cashOut: initialUser1CashOut,
      balance: initialUser1Balance,
      notes: 'Collector wallet NOT updated (collector just collects, doesn\'t keep money)'
    });
  } else {
    // Without Autopay: Receiver gets money (could be User1 or User2)
    const receiverId = collection.assignedReceiver || user1Id;
    const isUser2Receiver = receiverId.toString() === user2Id.toString();
    
    if (isUser2Receiver) {
      table.push({
        step: 'Step 2',
        entry: 'Entry 2',
        user: 'User2 (Assigned Receiver)',
        role: 'Assigned Receiver',
        action: 'System Collection Created',
        cashIn: initialUser2CashIn + amount,
        cashOut: initialUser2CashOut,
        balance: initialUser2Balance + amount,
        notes: 'System collection, User2 wallet updated (+₹' + amount + ')'
      });
      
      table.push({
        step: 'Step 2',
        entry: 'Entry 2',
        user: 'User1 (Collector)',
        role: 'Collector',
        action: 'No Wallet Update',
        cashIn: initialUser1CashIn,
        cashOut: initialUser1CashOut,
        balance: initialUser1Balance,
        notes: 'Collector wallet NOT updated (money goes to assigned receiver)'
      });
    } else {
      // User1 is both collector and receiver
      table.push({
        step: 'Step 2',
        entry: 'Entry 2',
        user: 'User1 (Collector & Receiver)',
        role: 'Collector & Receiver',
        action: 'System Collection Created',
        cashIn: initialUser1CashIn + amount,
        cashOut: initialUser1CashOut,
        balance: initialUser1Balance + amount,
        notes: 'System collection, User1 wallet updated (+₹' + amount + ')'
      });
    }
  }
  
  return table;
};

/**
 * Format table as markdown
 * @param {Array} table - Table rows from generateCashFlowTable
 * @returns {String} Markdown formatted table
 */
const formatTableAsMarkdown = (table) => {
  let markdown = '| Step | Entry | User | Role | Action | Cash In | Cash Out | Balance | Notes |\n';
  markdown += '|------|-------|------|------|--------|---------|----------|---------|-------|\n';
  
  table.forEach(row => {
    markdown += `| ${row.step} | ${row.entry} | ${row.user} | ${row.role} | ${row.action} | ₹${row.cashIn} | ₹${row.cashOut} | ₹${row.balance} | ${row.notes} |\n`;
  });
  
  return markdown;
};

module.exports = {
  calculateCollectionCashIn,
  calculateCollectionCashOut,
  getCollectionBalance,
  processCollectionWithAutopay,
  processCollectionWithoutAutopay,
  generateCashFlowTable,
  formatTableAsMarkdown
};
