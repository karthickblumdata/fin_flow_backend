const Wallet = require('../models/walletModel');

const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      cashBalance: 0,
      upiBalance: 0,
      bankBalance: 0,
      cashIn: 0,
      cashOut: 0
    });
  }
  return wallet;
};

const updateWalletBalance = async (userId, mode, amount, operation = 'add', transactionType = null) => {
  if (!userId) {
    throw new Error('User ID is required for wallet balance update');
  }
  
  console.log(`\n   [updateWalletBalance] Starting wallet update...`);
  console.log(`     User ID: ${userId}`);
  console.log(`     Mode: ${mode}`);
  console.log(`     Amount: ₹${amount}`);
  console.log(`     Operation: ${operation}`);
  console.log(`     Transaction Type: ${transactionType}`);
  
  const wallet = await getOrCreateWallet(userId);
  const balanceField = `${mode.toLowerCase()}Balance`;
  
  console.log(`     Balance Field: ${balanceField}`);
  console.log(`     Wallet BEFORE:`);
  console.log(`       - ${balanceField}: ₹${wallet[balanceField] || 0}`);
  console.log(`       - cashIn: ₹${wallet.cashIn || 0}`);
  console.log(`       - cashOut: ₹${wallet.cashOut || 0}`);
  
  // Handle reversals (reverse cashIn and cashOut)
  if (transactionType === 'transaction_reversal' || 
      transactionType === 'expense_reversal' || 
      transactionType === 'collection_reversal' ||
      transactionType === 'collection_rejection') {
    if (operation === 'add') {
      // Reversing transaction_out/expense: Add balance back and SUBTRACT from cashOut
      wallet[balanceField] += amount;
      wallet.cashOut = Math.max(0, (wallet.cashOut || 0) - amount);
    } else if (operation === 'subtract') {
      // Reversing transaction_in/collection/expense_reimbursement: Subtract balance and SUBTRACT from cashIn
      // Special case: If this was an AutoPay collector transaction, also reverse cashOut
      const wasAutoPayCollector = wallet.cashOut >= amount && wallet.cashIn >= amount;
      if (wasAutoPayCollector && transactionType === 'collection_reversal') {
        // Reversing AutoPay collector: Subtract both cashIn and cashOut
        wallet.cashIn = Math.max(0, (wallet.cashIn || 0) - amount);
        wallet.cashOut = Math.max(0, (wallet.cashOut || 0) - amount);
        // Balance NOT changed (was unchanged originally)
        console.log(`     ✅ Reversing AutoPay collector: cashIn -₹${amount}, cashOut -₹${amount}, balance unchanged`);
      } else {
        // Normal reversal: Subtract balance and cashIn
        if (wallet[balanceField] < amount) {
          throw new Error(`Insufficient ${mode} balance`);
        }
        wallet[balanceField] -= amount;
        wallet.cashIn = Math.max(0, (wallet.cashIn || 0) - amount);
      }
    }
  } else if (operation === 'add') {
    // Special case: collection_autopay_collector - collector receives and transfers (cashIn + cashOut, balance unchanged)
    if (transactionType === 'collection_autopay_collector') {
      // Collector: cashIn increases, cashOut increases, balance unchanged
      const oldCashIn = wallet.cashIn || 0;
      const oldCashOut = wallet.cashOut || 0;
      wallet.cashIn = (wallet.cashIn || 0) + amount;
      wallet.cashOut = (wallet.cashOut || 0) + amount;
      // Balance NOT updated (cashIn - cashOut = 0 net effect)
      console.log(`     ✅ cashIn increased by ₹${amount} (${oldCashIn} → ${wallet.cashIn})`);
      console.log(`     ✅ cashOut increased by ₹${amount} (${oldCashOut} → ${wallet.cashOut})`);
      console.log(`     ⚠️  ${balanceField} NOT updated (AutoPay collector - balance unchanged)`);
    } else {
      // Normal case: balance increases
      wallet[balanceField] += amount;
      console.log(`     ✅ ${balanceField} increased by ₹${amount} → ₹${wallet[balanceField]}`);
      
      // Update cashIn based on transaction type
      if (transactionType === 'collection' || 
          transactionType === 'add' || 
          transactionType === 'transaction_in' ||
          transactionType === 'expense_reimbursement') {
        const oldCashIn = wallet.cashIn || 0;
        wallet.cashIn = (wallet.cashIn || 0) + amount;
        console.log(`     ✅ cashIn increased by ₹${amount} (${oldCashIn} → ${wallet.cashIn})`);
      } else {
        console.log(`     ⚠️  cashIn NOT updated (transactionType: ${transactionType} not in collection/add/transaction_in/expense_reimbursement)`);
      }
    }
  } else if (operation === 'subtract') {
    if (wallet[balanceField] < amount) {
      throw new Error(`Insufficient ${mode} balance`);
    }
    wallet[balanceField] -= amount;
    // Update cashOut based on transaction type
    if (transactionType === 'expense' || 
        transactionType === 'withdraw' || 
        transactionType === 'transaction_out') {
      wallet.cashOut = (wallet.cashOut || 0) + amount;
    }
  }
  
  await wallet.save();
  
  console.log(`     Wallet AFTER:`);
  console.log(`       - ${balanceField}: ₹${wallet[balanceField] || 0}`);
  console.log(`       - cashIn: ₹${wallet.cashIn || 0}`);
  console.log(`       - cashOut: ₹${wallet.cashOut || 0}`);
  console.log(`       - totalBalance: ₹${wallet.totalBalance || 0}`);
  console.log(`   [updateWalletBalance] ✅ Wallet update completed\n`);
  
  return wallet;
};

const checkBalance = async (userId, mode, amount) => {
  const wallet = await getOrCreateWallet(userId);
  const balanceField = `${mode.toLowerCase()}Balance`;
  return wallet[balanceField] >= amount;
};

module.exports = {
  getOrCreateWallet,
  updateWalletBalance,
  checkBalance
};
