# Collection Cash Flow Examples

This directory contains code examples demonstrating how **cash in**, **cash out**, and **balance** work with collections, both **with autopay** and **without autopay**, using User1 (Collector) and User2 (Receiver) scenarios.

## Files

- `collectionCashFlowHelper.js` - Utility functions for calculating cash flow
- `collectionCashFlowExamples.js` - Code examples with detailed explanations
- `collectionCashFlowTable.js` - Table view generators showing step-by-step wallet changes

## Quick Start

```javascript
const { runAllTableExamples } = require('./collectionCashFlowTable');

// Replace with actual user IDs
const user1Id = 'user1_object_id';
const user2Id = 'user2_object_id';

// Run all examples
runAllTableExamples(user1Id, user2Id, 1000);
```

## Table View Examples

### Scenario 1: Collection WITH Autopay (₹1000)

**Setup:**
- User1 = Collector
- User2 = Original Assigned Receiver (from Payment Mode)
- Payment Mode: AutoPay = true

**Cash Flow Table:**

| Step | Entry | User | Role | Action | Cash In | Cash Out | Balance | Notes |
|------|-------|------|------|--------|---------|----------|---------|-------|
| Initial | - | User1 (Collector) | Collector | Initial State | ₹0 | ₹0 | ₹0 | Before collection |
| Initial | - | User2 (Receiver) | Original Assigned Receiver | Initial State | ₹0 | ₹0 | ₹0 | Before collection |
| Step 1 | Entry 1 | User1 (Collector) | Collector | Creates Collection | ₹0 | ₹0 | ₹0 | Collection created, Status: Pending → Approved, Wallet NOT updated |
| Step 2 | Entry 2 | User2 (Original Assigned Receiver) | Original Assigned Receiver | System Collection Created | ₹1000 | ₹0 | ₹1000 | System collection, User2 wallet updated (+₹1000) |
| Step 2 | Entry 2 | User1 (Collector) | Collector | No Wallet Update | ₹0 | ₹0 | ₹0 | Collector wallet NOT updated (collector just collects, doesn't keep money) |

**Key Points:**
1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)
2. Entry 2: System creates collection → User2 wallet updated (+₹1000)
3. User1 wallet: NO change (collector just collects, doesn't keep money)
4. User2 wallet: Cash In +₹1000, Balance +₹1000
5. Cash In calculation: Only counts Entry 2 where user is original assigned receiver

---

### Scenario 2: Collection WITHOUT Autopay (₹1000)

**Setup:**
- User1 = Collector
- User2 = Assigned Receiver
- Payment Mode: AutoPay = false

**Cash Flow Table:**

| Step | Entry | User | Role | Action | Cash In | Cash Out | Balance | Notes |
|------|-------|------|------|--------|---------|----------|---------|-------|
| Initial | - | User1 (Collector) | Collector | Initial State | ₹0 | ₹0 | ₹0 | Before collection |
| Initial | - | User2 (Receiver) | Assigned Receiver | Initial State | ₹0 | ₹0 | ₹0 | Before collection |
| Step 1 | Entry 1 | User1 (Collector) | Collector | Creates Collection | ₹0 | ₹0 | ₹0 | Collection created, Status: Pending → Approved, Wallet NOT updated |
| Step 2 | Entry 2 | User2 (Assigned Receiver) | Assigned Receiver | System Collection Created | ₹1000 | ₹0 | ₹1000 | System collection, User2 wallet updated (+₹1000) |
| Step 2 | Entry 2 | User1 (Collector) | Collector | No Wallet Update | ₹0 | ₹0 | ₹0 | Collector wallet NOT updated (money goes to assigned receiver) |

**Key Points:**
1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)
2. Entry 2: System creates collection → User2 wallet updated (+₹1000)
3. User1 wallet: NO change (money goes to assigned receiver)
4. User2 wallet: Cash In +₹1000, Balance +₹1000
5. Cash In calculation: Only counts Entry 2 where user is receiver

---

### Scenario 3: Collection WITHOUT Autopay (Collector = Receiver)

**Setup:**
- User1 = Collector (also Receiver)
- No Assigned Receiver
- Payment Mode: AutoPay = false

**Cash Flow Table:**

| Step | Entry | User | Role | Action | Cash In | Cash Out | Balance | Notes |
|------|-------|------|------|--------|---------|----------|---------|-------|
| Initial | - | User1 (Collector & Receiver) | Collector & Receiver | Initial State | ₹0 | ₹0 | ₹0 | Before collection |
| Step 1 | Entry 1 | User1 (Collector & Receiver) | Collector & Receiver | Creates Collection | ₹0 | ₹0 | ₹0 | Collection created, Status: Pending → Approved, Wallet NOT updated |
| Step 2 | Entry 2 | User1 (Collector & Receiver) | Collector & Receiver | System Collection Created | ₹1000 | ₹0 | ₹1000 | System collection, User1 wallet updated (+₹1000) |

**Key Points:**
1. Entry 1: User1 creates collection → Status: Approved (wallet NOT updated)
2. Entry 2: System creates collection → User1 wallet updated (+₹1000)
3. User1 wallet: Cash In +₹1000, Balance +₹1000 (collector is also receiver)
4. When no assigned receiver, collector receives the money

---

## Comparison Table

| Feature | WITH Autopay | WITHOUT Autopay |
|---------|--------------|----------------|
| Entry 1 Status | Approved | Approved |
| Entry 1 Wallet Update | NO | NO |
| Entry 2 Created By | System | System |
| Entry 2 Wallet Update | YES (User2 only) | YES (Receiver) |
| Collector Wallet Updated | NO | NO (unless collector=receiver) |
| Receiver | Original Assigned Receiver | Assigned Receiver or Collector |
| Cash In Counts | Entry 2 (User2) | Entry 2 (Receiver) |
| Cash Out | 0 | 0 |
| Balance Change (User1) | 0 | 0 (or +₹1000 if receiver) |
| Balance Change (User2) | +₹1000 | +₹1000 (if receiver) |

## Key Differences

1. **WITH Autopay**: Money ALWAYS goes to Original Assigned Receiver from Payment Mode
2. **WITHOUT Autopay**: Money goes to Assigned Receiver (or Collector if none)
3. **Collector wallet**: NEVER updated in both cases (unless collector = receiver)
4. **Entry 1 vs Entry 2**: Only Entry 2 (system collection) updates wallet, Entry 1 is just a record

## Usage Examples

### Example 1: Calculate Cash In for a User

```javascript
const { calculateCollectionCashIn } = require('../utils/collectionCashFlowHelper');
const Collection = require('../models/collectionModel');

// Get all collections for a user
const collections = await Collection.find({
  $or: [
    { collectedBy: userId },
    { assignedReceiver: userId }
  ]
}).populate('paymentModeId');

// Calculate cash in
const cashIn = calculateCollectionCashIn(userId, collections);
console.log(`Cash In from collections: ₹${cashIn}`);
```

### Example 2: Process Collection with Autopay

```javascript
const { processCollectionWithAutopay } = require('../utils/collectionCashFlowHelper');

const collection = await Collection.findById(collectionId).populate('paymentModeId');
const paymentMode = collection.paymentModeId;

const result = processCollectionWithAutopay(collection, paymentMode);

if (result.autopay) {
  console.log(`Money goes to: ${result.receiver}`);
  console.log(`Collector wallet updated: ${result.walletUpdated}`);
}
```

### Example 3: Generate Cash Flow Table

```javascript
const { generateCashFlowTable, formatTableAsMarkdown } = require('../utils/collectionCashFlowHelper');

const table = await generateCashFlowTable(user1Id, user2Id, collection, paymentMode, true);
console.log(formatTableAsMarkdown(table));
```

## Important Notes

1. **Entry 1 vs Entry 2**: 
   - Entry 1: Created by collector, status changes to Approved, but wallet is NOT updated
   - Entry 2: Created by system, status is Approved, wallet IS updated

2. **Cash In Calculation**:
   - Only counts Entry 2 (system collections) where user is receiver
   - Entry 1 is never counted for cash in

3. **Autopay Logic**:
   - When autopay is enabled: Money goes to Original Assigned Receiver from Payment Mode
   - When autopay is disabled: Money goes to Assigned Receiver (or Collector if none)

4. **Collector Wallet**:
   - Collector wallet is typically NOT updated (collector just collects money)
   - Exception: When collector is also the receiver (no assigned receiver)

## Running the Examples

```bash
# Run all examples
node examples/collectionCashFlowExamples.js

# Run table examples
node examples/collectionCashFlowTable.js
```

Make sure to replace the mock user IDs with actual user IDs from your database.
