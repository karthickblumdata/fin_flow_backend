# Save Expense Report Details to MongoDB - Implementation Plan

## Overview
Implement functionality to save expense report details, configurations, and snapshots to MongoDB for later retrieval, history tracking, and reporting purposes.

## Current State Analysis

### ✅ What's Already Saved:
1. **Individual Expenses** - Saved in `Expense` collection ✅
2. **Transactions** - Saved in `Transaction` collection ✅
3. **Collections** - Saved in `Collection` collection ✅
4. **Audit Logs** - Actions are logged in `AuditLog` collection ✅

### ❌ What's Missing:
1. **Report Snapshots** - No saved report data
2. **Report Configurations** - No saved filter sets
3. **Report History** - No tracking of generated reports
4. **Report Metadata** - No saved report summaries/statistics

---

## Implementation Plan

### Phase 1: Create Report Model

#### 1.1 Create `reportModel.js`
**File**: `backend/models/reportModel.js`

**Schema Fields**:
```javascript
{
  reportName: String,           // User-defined name (e.g., "Monthly Expense Report - Jan 2024")
  reportType: String,           // 'expense', 'transaction', 'collection', 'combined'
  createdBy: ObjectId,          // User who created/saved the report
  filters: {
    startDate: Date,
    endDate: Date,
    mode: String,              // 'Cash', 'UPI', 'Bank', null
    status: String,             // 'Pending', 'Approved', etc., null
    userId: ObjectId,           // Specific user filter
    category: String            // Expense category filter
  },
  summary: {
    totalExpenses: Number,
    totalTransactions: Number,
    totalCollections: Number,
    netFlow: Number,
    expenseCount: Number,
    transactionCount: Number,
    collectionCount: Number
  },
  snapshot: {
    expenses: [ObjectId],       // References to expense IDs
    transactions: [ObjectId],  // References to transaction IDs
    collections: [ObjectId]     // References to collection IDs
  },
  includeFullData: Boolean,     // Whether to store full data or just references
  fullData: {                   // Optional: Full data snapshot
    expenses: Array,
    transactions: Array,
    collections: Array
  },
  isTemplate: Boolean,          // Whether this is a reusable template
  tags: [String],               // For categorization
  notes: String,                // User notes about the report
  generatedAt: Date,            // When report was generated
  expiresAt: Date               // Optional: Auto-delete after this date
}
```

**Indexes**:
- `createdBy + createdAt` (for user's reports)
- `reportType + createdAt` (for filtering by type)
- `isTemplate + createdAt` (for templates)

---

### Phase 2: Create Report Controller Functions

#### 2.1 Update `reportController.js`
**File**: `backend/controllers/reportController.js`

**New Functions**:

1. **`saveReport`** - Save current report with filters
   - Route: `POST /api/reports/save`
   - Access: Private (Admin, SuperAdmin)
   - Body: `{ reportName, filters, includeFullData, isTemplate, tags, notes }`
   - Returns: Saved report object

2. **`getSavedReports`** - Get all saved reports for user
   - Route: `GET /api/reports/saved`
   - Access: Private (Admin, SuperAdmin)
   - Query: `?type=expense&template=true`
   - Returns: List of saved reports

3. **`getSavedReport`** - Get specific saved report
   - Route: `GET /api/reports/saved/:id`
   - Access: Private (Admin, SuperAdmin)
   - Returns: Full report data

4. **`updateSavedReport`** - Update saved report
   - Route: `PUT /api/reports/saved/:id`
   - Access: Private (Admin, SuperAdmin)
   - Body: `{ reportName, filters, notes, tags }`
   - Returns: Updated report

5. **`deleteSavedReport`** - Delete saved report
   - Route: `DELETE /api/reports/saved/:id`
   - Access: Private (Admin, SuperAdmin)
   - Returns: Success message

6. **`duplicateSavedReport`** - Duplicate a saved report
   - Route: `POST /api/reports/saved/:id/duplicate`
   - Access: Private (Admin, SuperAdmin)
   - Returns: New report copy

7. **`getReportTemplates`** - Get all report templates
   - Route: `GET /api/reports/templates`
   - Access: Private (Admin, SuperAdmin)
   - Returns: List of templates

---

### Phase 3: Report Routes

#### 3.1 Update `reportRoutes.js`
**File**: `backend/routes/reportRoutes.js`

**New Routes**:
```javascript
router.post('/save', protect, authorize('SuperAdmin'), saveReport);
router.get('/saved', protect, authorize('SuperAdmin'), getSavedReports);
router.get('/saved/:id', protect, authorize('SuperAdmin'), getSavedReport);
router.put('/saved/:id', protect, authorize('SuperAdmin'), updateSavedReport);
router.delete('/saved/:id', protect, authorize('SuperAdmin'), deleteSavedReport);
router.post('/saved/:id/duplicate', protect, authorize('SuperAdmin'), duplicateSavedReport);
router.get('/templates', protect, authorize('SuperAdmin'), getReportTemplates);
```

---

### Phase 4: Implementation Details

#### 4.1 Save Report Function Logic

```javascript
exports.saveReport = async (req, res) => {
  try {
    const { reportName, filters, includeFullData, isTemplate, tags, notes } = req.body;
    
    // Validate required fields
    if (!reportName) {
      return res.status(400).json({
        success: false,
        message: 'Report name is required'
      });
    }

    // Build query from filters
    const query = buildQueryFromFilters(filters);

    // Fetch current data
    const [expenses, transactions, collections] = await Promise.all([
      Expense.find(query).select('_id').lean(),
      Transaction.find(query).select('_id').lean(),
      Collection.find(query).select('_id').lean()
    ]);

    // Calculate summary
    const summary = await calculateReportSummary(query);

    // Prepare report data
    const reportData = {
      reportName,
      reportType: 'combined', // or determine from filters
      createdBy: req.user._id,
      filters: filters || {},
      summary,
      snapshot: {
        expenses: expenses.map(e => e._id),
        transactions: transactions.map(t => t._id),
        collections: collections.map(c => c._id)
      },
      includeFullData: includeFullData || false,
      isTemplate: isTemplate || false,
      tags: tags || [],
      notes: notes || '',
      generatedAt: new Date()
    };

    // Optionally include full data
    if (includeFullData) {
      const [fullExpenses, fullTransactions, fullCollections] = await Promise.all([
        Expense.find(query).populate('userId', 'name email').lean(),
        Transaction.find(query).populate('sender receiver', 'name email').lean(),
        Collection.find(query).populate('collectedBy assignedReceiver', 'name email').lean()
      ]);

      reportData.fullData = {
        expenses: fullExpenses,
        transactions: fullTransactions,
        collections: fullCollections
      };
    }

    // Save to database
    const savedReport = await Report.create(reportData);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Saved report: ${reportName}`,
      'Create',
      'Report',
      savedReport._id,
      null,
      { reportName, reportType: reportData.reportType },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Report saved successfully',
      report: savedReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
```

#### 4.2 Get Saved Report Function Logic

```javascript
exports.getSavedReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check access (user can only access their own reports or be SuperAdmin)
    if (report.createdBy._id.toString() !== req.user._id.toString() && 
        req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // If full data not included, fetch current data from snapshot IDs
    let reportData = { ...report };

    if (!report.includeFullData || !report.fullData) {
      // Fetch current data from snapshot IDs
      const [expenses, transactions, collections] = await Promise.all([
        Expense.find({ _id: { $in: report.snapshot.expenses } })
          .populate('userId', 'name email')
          .sort({ createdAt: -1 })
          .lean(),
        Transaction.find({ _id: { $in: report.snapshot.transactions } })
          .populate('sender receiver', 'name email')
          .sort({ createdAt: -1 })
          .lean(),
        Collection.find({ _id: { $in: report.snapshot.collections } })
          .populate('collectedBy assignedReceiver', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      ]);

      reportData.fullData = {
        expenses,
        transactions,
        collections
      };
    }

    res.status(200).json({
      success: true,
      report: reportData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
```

---

### Phase 5: Helper Functions

#### 5.1 Create Report Helper
**File**: `backend/utils/reportHelper.js` (NEW)

**Functions**:
- `buildQueryFromFilters(filters)` - Convert filter object to MongoDB query
- `calculateReportSummary(query)` - Calculate totals and counts
- `validateReportFilters(filters)` - Validate filter inputs
- `generateReportName(filters)` - Auto-generate report name from filters

---

### Phase 6: Data Storage Strategy

#### Option 1: Store References Only (Recommended)
- **Pros**: Smaller storage, always current data
- **Cons**: Data may change if original records are deleted
- **Use Case**: For most reports

#### Option 2: Store Full Data Snapshot
- **Pros**: Historical accuracy, data preserved even if originals deleted
- **Cons**: Larger storage, data can become stale
- **Use Case**: For important historical reports, compliance reports

#### Option 3: Hybrid Approach (Recommended)
- Store references by default
- Allow user to choose "Include Full Data" for important reports
- Best of both worlds

---

### Phase 7: Report Expiration & Cleanup

#### 7.1 Auto-Expiration
- Add `expiresAt` field to reports
- Create scheduled job to delete expired reports
- Or mark as archived instead of deleting

#### 7.2 Manual Cleanup
- Allow users to delete old reports
- Bulk delete functionality
- Archive instead of delete (soft delete)

---

### Phase 8: Report Templates

#### 8.1 Template System
- Mark reports as templates (`isTemplate: true`)
- Templates can be used to quickly generate new reports
- Templates store only filters, not data
- Users can create custom templates

---

## API Endpoints Summary

### New Endpoints:
1. `POST /api/reports/save` - Save current report
2. `GET /api/reports/saved` - List saved reports
3. `GET /api/reports/saved/:id` - Get saved report
4. `PUT /api/reports/saved/:id` - Update saved report
5. `DELETE /api/reports/saved/:id` - Delete saved report
6. `POST /api/reports/saved/:id/duplicate` - Duplicate report
7. `GET /api/reports/templates` - Get templates

---

## Database Schema

### Report Collection Structure:
```javascript
{
  _id: ObjectId,
  reportName: "Monthly Expense Report - January 2024",
  reportType: "combined",
  createdBy: ObjectId (ref: User),
  filters: {
    startDate: ISODate("2024-01-01"),
    endDate: ISODate("2024-01-31"),
    mode: "Cash",
    status: "Approved"
  },
  summary: {
    totalExpenses: 50000,
    totalTransactions: 30000,
    totalCollections: 80000,
    netFlow: 30000,
    expenseCount: 25,
    transactionCount: 15,
    collectionCount: 20
  },
  snapshot: {
    expenses: [ObjectId, ObjectId, ...],
    transactions: [ObjectId, ObjectId, ...],
    collections: [ObjectId, ObjectId, ...]
  },
  includeFullData: false,
  fullData: { ... }, // Optional
  isTemplate: false,
  tags: ["monthly", "expenses"],
  notes: "Monthly review report",
  generatedAt: ISODate("2024-02-01T10:00:00Z"),
  expiresAt: ISODate("2025-02-01T10:00:00Z"), // Optional
  createdAt: ISODate("2024-02-01T10:00:00Z"),
  updatedAt: ISODate("2024-02-01T10:00:00Z")
}
```

---

## Implementation Steps

### Step 1: Create Report Model
- Create `backend/models/reportModel.js`
- Define schema with all fields
- Add indexes

### Step 2: Create Helper Functions
- Create `backend/utils/reportHelper.js`
- Implement filter building, summary calculation

### Step 3: Update Report Controller
- Add save, get, update, delete functions
- Implement template functionality

### Step 4: Update Routes
- Add new routes to `reportRoutes.js`
- Register in `server.js`

### Step 5: Add Audit Logging
- Log report save/delete actions
- Track report access

### Step 6: Testing
- Test save report functionality
- Test retrieval with/without full data
- Test template system
- Test expiration

---

## Benefits

1. **Historical Tracking** - Keep records of past reports
2. **Quick Access** - Reuse saved reports without recreating filters
3. **Templates** - Create reusable report configurations
4. **Compliance** - Maintain audit trail of reports
5. **Performance** - Pre-calculated summaries
6. **Flexibility** - Store references or full data based on need

---

## Considerations

1. **Storage Size** - Full data snapshots can be large
2. **Data Freshness** - Reference-based reports may show outdated data
3. **Access Control** - Users should only see their own reports (unless SuperAdmin)
4. **Cleanup** - Need strategy for old reports
5. **Performance** - Indexing for fast queries

---

## Future Enhancements

1. **Report Scheduling** - Auto-generate reports on schedule
2. **Email Reports** - Send reports via email
3. **Export Formats** - PDF, Excel export from saved reports
4. **Report Sharing** - Share reports with other users
5. **Report Analytics** - Track which reports are used most
6. **Version History** - Track changes to saved reports

---

## Files to Create/Modify

### New Files:
- `backend/models/reportModel.js`
- `backend/utils/reportHelper.js`

### Modified Files:
- `backend/controllers/reportController.js`
- `backend/routes/reportRoutes.js`
- `backend/server.js` (if needed)

---

## Success Criteria

✅ Users can save expense reports with filters
✅ Saved reports can be retrieved later
✅ Reports can be updated and deleted
✅ Template system works
✅ Access control is enforced
✅ Audit logging works
✅ Performance is acceptable

