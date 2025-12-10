const mongoose = require('mongoose');
require('dotenv').config();

const PaymentMode = require('./models/paymentModeModel');

async function getActivePaymentModesBalance() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/financial_flow';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    const modes = await PaymentMode.find({ isActive: true })
      .select('modeName cashBalance upiBalance bankBalance cashIn cashOut')
      .lean()
      .sort({ createdAt: 1 });

    console.log('=== ACTIVE PAYMENT MODES WALLET BALANCES ===\n');

    if (modes.length === 0) {
      console.log('No active payment modes found.\n');
      await mongoose.disconnect();
      return;
    }

    modes.forEach((mode, index) => {
      const cashBalance = mode.cashBalance || 0;
      const upiBalance = mode.upiBalance || 0;
      const bankBalance = mode.bankBalance || 0;
      const totalBalance = cashBalance + upiBalance + bankBalance;
      const cashIn = mode.cashIn || 0;
      const cashOut = mode.cashOut || 0;

      console.log(`${index + 1}. ${mode.modeName}`);
      console.log(`   Cash Balance: ₹${cashBalance.toFixed(2)}`);
      console.log(`   UPI Balance: ₹${upiBalance.toFixed(2)}`);
      console.log(`   Bank Balance: ₹${bankBalance.toFixed(2)}`);
      console.log(`   Total Balance: ₹${totalBalance.toFixed(2)}`);
      console.log(`   Cash In: ₹${cashIn.toFixed(2)}`);
      console.log(`   Cash Out: ₹${cashOut.toFixed(2)}`);
      console.log('');
    });

    const totalCash = modes.reduce((sum, m) => sum + (m.cashBalance || 0), 0);
    const totalUPI = modes.reduce((sum, m) => sum + (m.upiBalance || 0), 0);
    const totalBank = modes.reduce((sum, m) => sum + (m.bankBalance || 0), 0);
    const grandTotal = totalCash + totalUPI + totalBank;
    const totalCashIn = modes.reduce((sum, m) => sum + (m.cashIn || 0), 0);
    const totalCashOut = modes.reduce((sum, m) => sum + (m.cashOut || 0), 0);

    console.log('=== SUMMARY ===');
    console.log(`Total Cash Balance (all active modes): ₹${totalCash.toFixed(2)}`);
    console.log(`Total UPI Balance (all active modes): ₹${totalUPI.toFixed(2)}`);
    console.log(`Total Bank Balance (all active modes): ₹${totalBank.toFixed(2)}`);
    console.log(`Grand Total Balance: ₹${grandTotal.toFixed(2)}`);
    console.log(`Total Cash In: ₹${totalCashIn.toFixed(2)}`);
    console.log(`Total Cash Out: ₹${totalCashOut.toFixed(2)}`);
    console.log(`\nTotal Active Payment Modes: ${modes.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getActivePaymentModesBalance();

