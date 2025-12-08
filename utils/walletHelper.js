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
  
  // Validate mode
  const validModes = ['Cash', 'UPI', 'Bank'];
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid payment mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
  }
  
  const wallet = await getOrCreateWallet(userId);
  const balanceField = `${mode.toLowerCase()}Balance`;
  
  // Get current balance value (handle null/undefined)
  const currentBalance = wallet[balanceField] || 0;
  
  console.log(`     Balance Field: ${balanceField}`);
  console.log(`     Current Balance Value: ${wallet[balanceField]} (normalized: ${currentBalance})`);
  console.log(`     Wallet BEFORE:`);
  console.log(`       - ${balanceField}: ₹${currentBalance}`);
  console.log(`       - cashIn: ₹${wallet.cashIn || 0}`);
  console.log(`       - cashOut: ₹${wallet.cashOut || 0}`);
  
  // Handle reversals (reverse cashIn and cashOut)
  if (transactionType === 'transaction_reversal' || 
      transactionType === 'expense_reversal' || 
      transactionType === 'expense_rejection' ||
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
        // For reversals, allow deducting from other modes if the original mode doesn't have enough
        // This handles cases where balance might have been moved to other modes via expenses/transfers
        
        // Get all balances
        const cashBalance = wallet.cashBalance || 0;
        const upiBalance = wallet.upiBalance || 0;
        const bankBalance = wallet.bankBalance || 0;
        const totalBalance = cashBalance + upiBalance + bankBalance;
        const currentModeBalance = wallet[balanceField] || 0;
        
        // Check total balance first
        if (totalBalance < amount) {
          console.log(`     ❌ Total balance check failed: ${totalBalance} < ${amount}`);
          throw new Error(`Insufficient total balance. Available: ₹${totalBalance}, Required: ₹${amount}`);
        }
        
        // Deduct from the specified mode first
        let remainingAmount = amount;
        let deductedFromMode = 0;
        
        if (currentModeBalance > 0) {
          deductedFromMode = Math.min(currentModeBalance, remainingAmount);
          wallet[balanceField] = currentModeBalance - deductedFromMode;
          remainingAmount -= deductedFromMode;
          console.log(`     ✅ Deducted ₹${deductedFromMode} from ${mode} mode (remaining: ₹${remainingAmount})`);
        }
        
        // If still need more, deduct from other modes (Cash -> UPI -> Bank priority)
        if (remainingAmount > 0 && cashBalance > 0 && balanceField !== 'cashBalance') {
          const deductFromCash = Math.min(cashBalance, remainingAmount);
          wallet.cashBalance = cashBalance - deductFromCash;
          remainingAmount -= deductFromCash;
          console.log(`     ✅ Deducted ₹${deductFromCash} from Cash mode (remaining: ₹${remainingAmount})`);
        }
        
        if (remainingAmount > 0 && upiBalance > 0 && balanceField !== 'upiBalance') {
          const deductFromUpi = Math.min(upiBalance, remainingAmount);
          wallet.upiBalance = upiBalance - deductFromUpi;
          remainingAmount -= deductFromUpi;
          console.log(`     ✅ Deducted ₹${deductFromUpi} from UPI mode (remaining: ₹${remainingAmount})`);
        }
        
        if (remainingAmount > 0 && bankBalance > 0 && balanceField !== 'bankBalance') {
          const deductFromBank = Math.min(bankBalance, remainingAmount);
          wallet.bankBalance = bankBalance - deductFromBank;
          remainingAmount -= deductFromBank;
          console.log(`     ✅ Deducted ₹${deductFromBank} from Bank mode (remaining: ₹${remainingAmount})`);
        }
        
        // Subtract from cashIn
        wallet.cashIn = Math.max(0, (wallet.cashIn || 0) - amount);
        console.log(`     ✅ cashIn decreased by ₹${amount} → ₹${wallet.cashIn}`);
        console.log(`     ✅ Total deduction: ₹${amount} completed`);
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
    // Get all balances
    const cashBalance = wallet.cashBalance || 0;
    const upiBalance = wallet.upiBalance || 0;
    const bankBalance = wallet.bankBalance || 0;
    const totalBalance = cashBalance + upiBalance + bankBalance;
    const currentModeBalance = wallet[balanceField] || 0;
    
    console.log(`     Balance Check:`);
    console.log(`       - Cash: ₹${cashBalance}`);
    console.log(`       - UPI: ₹${upiBalance}`);
    console.log(`       - Bank: ₹${bankBalance}`);
    console.log(`       - Total: ₹${totalBalance}`);
    console.log(`       - ${mode} Mode: ₹${currentModeBalance}`);
    console.log(`       - Required: ₹${amount}`);
    
    // Check total balance (allow using any mode balance)
    if (totalBalance < amount) {
      console.log(`     ❌ Total balance check failed: ${totalBalance} < ${amount}`);
      throw new Error(`Insufficient total balance. Available: ₹${totalBalance}, Required: ₹${amount}`);
    }
    
    // Deduct from the specified mode first
    let remainingAmount = amount;
    let deductedFromMode = 0;
    
    // First, deduct from the expense mode
    if (currentModeBalance > 0) {
      deductedFromMode = Math.min(currentModeBalance, remainingAmount);
      wallet[balanceField] = currentModeBalance - deductedFromMode;
      remainingAmount -= deductedFromMode;
      console.log(`     ✅ Deducted ₹${deductedFromMode} from ${mode} mode (remaining: ₹${remainingAmount})`);
    }
    
    // If still need more, deduct from other modes (Cash -> UPI -> Bank priority)
    if (remainingAmount > 0 && cashBalance > 0 && balanceField !== 'cashBalance') {
      const deductFromCash = Math.min(cashBalance, remainingAmount);
      wallet.cashBalance = cashBalance - deductFromCash;
      remainingAmount -= deductFromCash;
      console.log(`     ✅ Deducted ₹${deductFromCash} from Cash mode (remaining: ₹${remainingAmount})`);
    }
    
    if (remainingAmount > 0 && upiBalance > 0 && balanceField !== 'upiBalance') {
      const deductFromUpi = Math.min(upiBalance, remainingAmount);
      wallet.upiBalance = upiBalance - deductFromUpi;
      remainingAmount -= deductFromUpi;
      console.log(`     ✅ Deducted ₹${deductFromUpi} from UPI mode (remaining: ₹${remainingAmount})`);
    }
    
    if (remainingAmount > 0 && bankBalance > 0 && balanceField !== 'bankBalance') {
      const deductFromBank = Math.min(bankBalance, remainingAmount);
      wallet.bankBalance = bankBalance - deductFromBank;
      remainingAmount -= deductFromBank;
      console.log(`     ✅ Deducted ₹${deductFromBank} from Bank mode (remaining: ₹${remainingAmount})`);
    }
    
    // Update cashOut based on transaction type
    if (transactionType === 'expense' || 
        transactionType === 'withdraw' || 
        transactionType === 'transaction_out') {
      const oldCashOut = wallet.cashOut || 0;
      wallet.cashOut = (wallet.cashOut || 0) + amount;
      console.log(`     ✅ cashOut increased by ₹${amount} (${oldCashOut} → ${wallet.cashOut})`);
    } else {
      console.log(`     ⚠️  cashOut NOT updated (transactionType: ${transactionType} not in expense/withdraw/transaction_out)`);
    }
    
    console.log(`     ✅ Total deduction: ₹${amount} completed`);
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
  // Check total balance across all modes (allow using any mode)
  const cashBalance = wallet.cashBalance || 0;
  const upiBalance = wallet.upiBalance || 0;
  const bankBalance = wallet.bankBalance || 0;
  const totalBalance = cashBalance + upiBalance + bankBalance;
  return totalBalance >= amount;
};

module.exports = {
  getOrCreateWallet,
  updateWalletBalance,
  checkBalance
};
