require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const ExpenseType = require('../models/expenseTypeModel');

const DEFAULT_EXPENSE_TYPES = ['Office', 'Travel', 'Marketing', 'Maintenance', 'Misc'];

async function removeDefaultExpenseTypes() {
  try {
    await connectDB();
    console.log('\n🗑️  Removing default expense types...\n');

    let deletedCount = 0;
    
    for (const typeName of DEFAULT_EXPENSE_TYPES) {
      const result = await ExpenseType.deleteMany({
        name: { $regex: new RegExp(`^${typeName}$`, 'i') }
      });
      
      if (result.deletedCount > 0) {
        console.log(`   ✅ Deleted "${typeName}": ${result.deletedCount} type(s)`);
        deletedCount += result.deletedCount;
      } else {
        console.log(`   ℹ️  "${typeName}": Not found (already removed)`);
      }
    }

    console.log(`\n✅ Removal complete: ${deletedCount} default expense type(s) deleted`);
    console.log('\nNote: Any expenses using these categories will still reference them by name.');
    console.log('You may need to update those expenses or create new expense types.\n');
  } catch (error) {
    console.error('\n❌ Removal failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

removeDefaultExpenseTypes();

