/**
 * Collection Cash Flow Examples
 * Demonstrates how cash in, cash out, and balance work with collections
 * using User1 (Collector) and User2 (Receiver) scenarios
 */

const Collection = require('../models/collectionModel');
const PaymentMode = require('../models/paymentModeModel');
const {
  generateCashFlowTable,
  formatTableAsMarkdown,
  processCollectionWithAutopay,
  processCollectionWithoutAutopay,
  calculateCollectionCashIn,
  getCollectionBalance
} = require('../utils/collectionCashFlowHelper');

/**
 * Example 1: Collection WITH Autopay
 * 
 * Scenario:
 * - User1 (Collector) collects ₹1000 from customer
 * - Payment Mode: AutoPay enabled, Original Assigned Receiver = User2
 * - Result: User2's wallet updated, User1's wallet unchanged
 */
async function exampleWithAutopay() {
  console.log('\n' + '='.repeat(80));
  console.log('EXAMPLE 1: Collection WITH Autopay');
  console.log('='.repeat(80));
  
  // Mock data
  const user1Id = 'user1_id_here'; // Collector
  const user2Id = 'user2_id_here'; // Original Assigned Receiver
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Company UPI',
    autoPay: true,
    assignedReceiver: user2Id // Original Assigned Receiver
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-001',
    collectedBy: user1Id, // User1 is collector
    assignedReceiver: user1Id, // In Entry 1, assignedReceiver = collector (due to autopay)
    amount: 1000,
    mode: 'UPI',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false, // Entry 1
    parentCollectionId: null
  };
  
  // Process with autopay
  const autopayResult = processCollectionWithAutopay(collection, paymentMode);
  
  console.log('\n📋 Collection Details:');
  console.log(`   Voucher: ${collection.voucherNumber}`);
  console.log(`   Amount: ₹${collection.amount}`);
  console.log(`   Mode: ${collection.mode}`);
  console.log(`   Collector: User1`);
  console.log(`   Original Assigned Receiver: User2`);
  console.log(`   AutoPay: Enabled`);
  
  console.log('\n📊 Processing Result:');
  console.log(`   Entry 1: ${autopayResult.entry1.note}`);
  console.log(`   Entry 2: ${autopayResult.entry2.note}`);
  console.log(`   Money Receiver: User2 (Original Assigned Receiver)`);
  console.log(`   Collector Wallet Updated: NO`);
  console.log(`   Receiver Wallet Updated: YES`);
  
  // Generate table view
  const table = await generateCashFlowTable(user1Id, user2Id, collection, paymentMode, true);
  
  console.log('\n📈 Cash Flow Table:');
  console.log(formatTableAsMarkdown(table));
  
  console.log('\n💡 Key Points:');
  console.log('   1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)');
  console.log('   2. Entry 2: System creates collection → User2 wallet updated (+₹1000)');
  console.log('   3. User1 wallet: NO change (collector just collects, doesn\'t keep money)');
  console.log('   4. User2 wallet: Cash In +₹1000, Balance +₹1000');
  console.log('   5. Cash In calculation: Only counts Entry 2 where user is original assigned receiver');
  
  return { collection, paymentMode, autopayResult, table };
}

/**
 * Example 2: Collection WITHOUT Autopay
 * 
 * Scenario:
 * - User1 (Collector) collects ₹1000 from customer
 * - Payment Mode: AutoPay disabled, Assigned Receiver = User2
 * - Result: User2's wallet updated, User1's wallet unchanged
 */
async function exampleWithoutAutopay() {
  console.log('\n' + '='.repeat(80));
  console.log('EXAMPLE 2: Collection WITHOUT Autopay');
  console.log('='.repeat(80));
  
  // Mock data
  const user1Id = 'user1_id_here'; // Collector
  const user2Id = 'user2_id_here'; // Assigned Receiver
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Company UPI',
    autoPay: false, // AutoPay disabled
    assignedReceiver: null // No original assigned receiver
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-002',
    collectedBy: user1Id, // User1 is collector
    assignedReceiver: user2Id, // User2 is assigned receiver
    amount: 1000,
    mode: 'UPI',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false, // Entry 1
    parentCollectionId: null
  };
  
  // Process without autopay
  const normalResult = processCollectionWithoutAutopay(collection);
  
  console.log('\n📋 Collection Details:');
  console.log(`   Voucher: ${collection.voucherNumber}`);
  console.log(`   Amount: ₹${collection.amount}`);
  console.log(`   Mode: ${collection.mode}`);
  console.log(`   Collector: User1`);
  console.log(`   Assigned Receiver: User2`);
  console.log(`   AutoPay: Disabled`);
  
  console.log('\n📊 Processing Result:');
  console.log(`   Entry 1: ${normalResult.entry1.note}`);
  console.log(`   Entry 2: ${normalResult.entry2.note}`);
  console.log(`   Money Receiver: User2 (Assigned Receiver)`);
  console.log(`   Collector Wallet Updated: NO`);
  console.log(`   Receiver Wallet Updated: YES`);
  
  // Generate table view
  const table = await generateCashFlowTable(user1Id, user2Id, collection, paymentMode, false);
  
  console.log('\n📈 Cash Flow Table:');
  console.log(formatTableAsMarkdown(table));
  
  console.log('\n💡 Key Points:');
  console.log('   1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)');
  console.log('   2. Entry 2: System creates collection → User2 wallet updated (+₹1000)');
  console.log('   3. User1 wallet: NO change (money goes to assigned receiver)');
  console.log('   4. User2 wallet: Cash In +₹1000, Balance +₹1000');
  console.log('   5. Cash In calculation: Only counts Entry 2 where user is receiver');
  
  return { collection, paymentMode, normalResult, table };
}

/**
 * Example 3: Collection WITHOUT Autopay (Collector is Receiver)
 * 
 * Scenario:
 * - User1 (Collector) collects ₹1000 from customer
 * - Payment Mode: AutoPay disabled, No Assigned Receiver
 * - Result: User1's wallet updated (collector is also receiver)
 */
async function exampleWithoutAutopayCollectorReceiver() {
  console.log('\n' + '='.repeat(80));
  console.log('EXAMPLE 3: Collection WITHOUT Autopay (Collector = Receiver)');
  console.log('='.repeat(80));
  
  // Mock data
  const user1Id = 'user1_id_here'; // Collector (also receiver)
  const user2Id = 'user2_id_here'; // Not used in this scenario
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Cash',
    autoPay: false,
    assignedReceiver: null
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-003',
    collectedBy: user1Id, // User1 is collector
    assignedReceiver: null, // No assigned receiver
    amount: 1000,
    mode: 'Cash',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false, // Entry 1
    parentCollectionId: null
  };
  
  // Process without autopay
  const normalResult = processCollectionWithoutAutopay(collection);
  
  console.log('\n📋 Collection Details:');
  console.log(`   Voucher: ${collection.voucherNumber}`);
  console.log(`   Amount: ₹${collection.amount}`);
  console.log(`   Mode: ${collection.mode}`);
  console.log(`   Collector: User1`);
  console.log(`   Assigned Receiver: None (falls back to collector)`);
  console.log(`   AutoPay: Disabled`);
  
  console.log('\n📊 Processing Result:');
  console.log(`   Entry 1: ${normalResult.entry1.note}`);
  console.log(`   Entry 2: ${normalResult.entry2.note}`);
  console.log(`   Money Receiver: User1 (Collector, as fallback)`);
  console.log(`   Collector Wallet Updated: YES`);
  
  // Generate table view (User1 is both collector and receiver)
  const table = await generateCashFlowTable(user1Id, user1Id, collection, paymentMode, false);
  
  console.log('\n📈 Cash Flow Table:');
  console.log(formatTableAsMarkdown(table));
  
  console.log('\n💡 Key Points:');
  console.log('   1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)');
  console.log('   2. Entry 2: System creates collection → User1 wallet updated (+₹1000)');
  console.log('   3. User1 wallet: Cash In +₹1000, Balance +₹1000 (collector is also receiver)');
  console.log('   4. When no assigned receiver, collector receives the money');
  
  return { collection, paymentMode, normalResult, table };
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await exampleWithAutopay();
    await exampleWithoutAutopay();
    await exampleWithoutAutopayCollectorReceiver();
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ All examples completed!');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Export functions
module.exports = {
  exampleWithAutopay,
  exampleWithoutAutopay,
  exampleWithoutAutopayCollectorReceiver,
  runAllExamples
};

// Run examples if executed directly
if (require.main === module) {
  runAllExamples();
}
