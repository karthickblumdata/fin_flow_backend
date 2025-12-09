/**
 * Collection Cash Flow Table View Generator
 * Generates detailed table views showing User1 and User2 wallet changes
 * for collections with and without autopay
 */

const { generateCashFlowTable, formatTableAsMarkdown } = require('../utils/collectionCashFlowHelper');

/**
 * Generate and display table for Collection WITH Autopay
 */
async function showTableWithAutopay(user1Id, user2Id, amount = 1000) {
  console.log('\n' + '═'.repeat(100));
  console.log('📊 COLLECTION WITH AUTOPAY - CASH FLOW TABLE');
  console.log('═'.repeat(100));
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Company UPI',
    autoPay: true,
    assignedReceiver: user2Id
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-AUTO-001',
    collectedBy: user1Id,
    assignedReceiver: user1Id, // In Entry 1, assignedReceiver = collector (due to autopay)
    amount: amount,
    mode: 'UPI',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false,
    parentCollectionId: null
  };
  
  console.log('\n📋 Scenario:');
  console.log(`   • User1 (Collector) collects ₹${amount} from customer`);
  console.log(`   • Payment Mode: AutoPay ENABLED`);
  console.log(`   • Original Assigned Receiver: User2`);
  console.log(`   • Result: User2 receives money, User1 wallet unchanged`);
  
  const table = await generateCashFlowTable(user1Id, user2Id, collection, paymentMode, true);
  
  console.log('\n' + formatTableAsMarkdown(table));
  
  console.log('\n📝 Summary:');
  console.log('   ┌─────────────────────────────────────────────────────────────┐');
  console.log('   │ Entry 1: User1 creates → Status: Approved (wallet NOT updated) │');
  console.log('   │ Entry 2: System creates → User2 wallet updated (+₹' + amount + ')    │');
  console.log('   │ User1: Wallet unchanged (collector just collects)            │');
  console.log('   │ User2: Cash In +₹' + amount + ', Balance +₹' + amount + '                        │');
  console.log('   └─────────────────────────────────────────────────────────────┘');
  
  return table;
}

/**
 * Generate and display table for Collection WITHOUT Autopay
 */
async function showTableWithoutAutopay(user1Id, user2Id, amount = 1000) {
  console.log('\n' + '═'.repeat(100));
  console.log('📊 COLLECTION WITHOUT AUTOPAY - CASH FLOW TABLE');
  console.log('═'.repeat(100));
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Company UPI',
    autoPay: false,
    assignedReceiver: null
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-NORMAL-001',
    collectedBy: user1Id,
    assignedReceiver: user2Id, // User2 is assigned receiver
    amount: amount,
    mode: 'UPI',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false,
    parentCollectionId: null
  };
  
  console.log('\n📋 Scenario:');
  console.log(`   • User1 (Collector) collects ₹${amount} from customer`);
  console.log(`   • Payment Mode: AutoPay DISABLED`);
  console.log(`   • Assigned Receiver: User2`);
  console.log(`   • Result: User2 receives money, User1 wallet unchanged`);
  
  const table = await generateCashFlowTable(user1Id, user2Id, collection, paymentMode, false);
  
  console.log('\n' + formatTableAsMarkdown(table));
  
  console.log('\n📝 Summary:');
  console.log('   ┌─────────────────────────────────────────────────────────────┐');
  console.log('   │ Entry 1: User1 creates → Status: Approved (wallet NOT updated) │');
  console.log('   │ Entry 2: System creates → User2 wallet updated (+₹' + amount + ')    │');
  console.log('   │ User1: Wallet unchanged (money goes to assigned receiver)   │');
  console.log('   │ User2: Cash In +₹' + amount + ', Balance +₹' + amount + '                        │');
  console.log('   └─────────────────────────────────────────────────────────────┘');
  
  return table;
}

/**
 * Generate and display table for Collection WITHOUT Autopay (Collector = Receiver)
 */
async function showTableWithoutAutopayCollectorReceiver(user1Id, amount = 1000) {
  console.log('\n' + '═'.repeat(100));
  console.log('📊 COLLECTION WITHOUT AUTOPAY (Collector = Receiver) - CASH FLOW TABLE');
  console.log('═'.repeat(100));
  
  const paymentMode = {
    _id: 'payment_mode_id',
    modeName: 'Cash',
    autoPay: false,
    assignedReceiver: null
  };
  
  const collection = {
    _id: 'collection_id',
    voucherNumber: 'COL-SELF-001',
    collectedBy: user1Id,
    assignedReceiver: null, // No assigned receiver
    amount: amount,
    mode: 'Cash',
    paymentModeId: paymentMode._id,
    status: 'Approved',
    isSystemCollection: false,
    parentCollectionId: null
  };
  
  console.log('\n📋 Scenario:');
  console.log(`   • User1 (Collector) collects ₹${amount} from customer`);
  console.log(`   • Payment Mode: AutoPay DISABLED`);
  console.log(`   • Assigned Receiver: None (falls back to collector)`);
  console.log(`   • Result: User1 receives money (collector is also receiver)`);
  
  const table = await generateCashFlowTable(user1Id, user1Id, collection, paymentMode, false);
  
  console.log('\n' + formatTableAsMarkdown(table));
  
  console.log('\n📝 Summary:');
  console.log('   ┌─────────────────────────────────────────────────────────────┐');
  console.log('   │ Entry 1: User1 creates → Status: Approved (wallet NOT updated) │');
  console.log('   │ Entry 2: System creates → User1 wallet updated (+₹' + amount + ')    │');
  console.log('   │ User1: Cash In +₹' + amount + ', Balance +₹' + amount + ' (collector is receiver)    │');
  console.log('   │ When no assigned receiver, collector receives the money      │');
  console.log('   └─────────────────────────────────────────────────────────────┘');
  
  return table;
}

/**
 * Generate comprehensive comparison table
 */
async function showComparisonTable(user1Id, user2Id, amount = 1000) {
  console.log('\n' + '═'.repeat(100));
  console.log('📊 COMPARISON: WITH AUTOPAY vs WITHOUT AUTOPAY');
  console.log('═'.repeat(100));
  
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Feature                    │ WITH Autopay              │ WITHOUT Autopay              │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Entry 1 Status             │ Approved                  │ Approved                     │');
  console.log('│ Entry 1 Wallet Update     │ NO                        │ NO                           │');
  console.log('│ Entry 2 Created By        │ System                    │ System                       │');
  console.log('│ Entry 2 Wallet Update     │ YES (User2 only)          │ YES (Receiver)               │');
  console.log('│ Collector Wallet Updated  │ NO                        │ NO (unless collector=receiver)│');
  console.log('│ Receiver                  │ Original Assigned Receiver│ Assigned Receiver or Collector│');
  console.log('│ Cash In Counts            │ Entry 2 (User2)           │ Entry 2 (Receiver)           │');
  console.log('│ Cash Out                  │ 0                         │ 0                            │');
  console.log('│ Balance Change (User1)   │ 0                         │ 0 (or +₹' + amount + ' if receiver)  │');
  console.log('│ Balance Change (User2)    │ +₹' + amount + '                      │ +₹' + amount + ' (if receiver)      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n💡 Key Differences:');
  console.log('   1. WITH Autopay: Money ALWAYS goes to Original Assigned Receiver from Payment Mode');
  console.log('   2. WITHOUT Autopay: Money goes to Assigned Receiver (or Collector if none)');
  console.log('   3. Collector wallet is NEVER updated in both cases (unless collector = receiver)');
  console.log('   4. Only Entry 2 (system collection) updates wallet, Entry 1 is just a record');
}

/**
 * Run all table examples
 */
async function runAllTableExamples(user1Id = 'user1_id', user2Id = 'user2_id', amount = 1000) {
  try {
    await showTableWithAutopay(user1Id, user2Id, amount);
    await showTableWithoutAutopay(user1Id, user2Id, amount);
    await showTableWithoutAutopayCollectorReceiver(user1Id, amount);
    await showComparisonTable(user1Id, user2Id, amount);
    
    console.log('\n' + '═'.repeat(100));
    console.log('✅ All table examples completed!');
    console.log('═'.repeat(100) + '\n');
  } catch (error) {
    console.error('❌ Error running table examples:', error);
  }
}

module.exports = {
  showTableWithAutopay,
  showTableWithoutAutopay,
  showTableWithoutAutopayCollectorReceiver,
  showComparisonTable,
  runAllTableExamples
};

// Run examples if executed directly
if (require.main === module) {
  // Replace with actual user IDs for testing
  const user1Id = 'user1_id_here';
  const user2Id = 'user2_id_here';
  runAllTableExamples(user1Id, user2Id, 1000);
}
