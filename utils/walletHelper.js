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
  const wallet = await getOrCreateWallet(userId);
  const balanceField = `${mode.toLowerCase()}Balance`;
  
  // Handle reversals (reverse cashIn and cashOut)
  if (transactionType === 'transaction_reversal' || 
      transactionType === 'expense_reversal' || 
      transactionType === 'collection_reversal') {
    if (operation === 'add') {
      // Reversing transaction_out/expense: Add balance back and SUBTRACT from cashOut
      wallet[balanceField] += amount;
      wallet.cashOut = Math.max(0, (wallet.cashOut || 0) - amount);
    } else if (operation === 'subtract') {
      // Reversing transaction_in/collection/expense_reimbursement: Subtract balance and SUBTRACT from cashIn
      if (wallet[balanceField] < amount) {
        throw new Error(`Insufficient ${mode} balance`);
      }
      wallet[balanceField] -= amount;
      wallet.cashIn = Math.max(0, (wallet.cashIn || 0) - amount);
    }
  } else if (operation === 'add') {
    wallet[balanceField] += amount;
    // Update cashIn based on transaction type
    if (transactionType === 'collection' || 
        transactionType === 'add' || 
        transactionType === 'transaction_in' ||
        transactionType === 'expense_reimbursement') {
      wallet.cashIn = (wallet.cashIn || 0) + amount;
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
