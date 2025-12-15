const PaymentMode = require('../models/paymentModeModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create payment mode
// @route   POST /api/payment-modes
// @access  Private (Admin, SuperAdmin)
exports.createPaymentMode = async (req, res) => {
  try {
    // Log user information
    const User = require('../models/userModel');
    const user = await User.findById(req.user._id).select('name email role').lean();
    const userName = user?.name || user?.email || 'Unknown';
    const userId = req.user._id.toString();
    
    console.log('\n📝 ===== CREATE PAYMENT MODE REQUEST =====');
    console.log(`   User ID: ${userId}`);
    console.log(`   User Name: ${userName}`);
    console.log(`   User Email: ${user?.email || 'N/A'}`);
    console.log(`   User Role: ${user?.role || 'N/A'}`);
    console.log('==========================================\n');
    
    const { modeName, description, autoPay, assignedReceiver, display } = req.body;

    // modeName is always required
    if (!modeName || modeName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide modeName'
      });
    }

    // Automatically set mode to Cash in description if not provided
    let finalDescription = description ? description.trim() : '';
    if (!finalDescription.includes('mode:')) {
      // Add mode:Cash to description
      if (finalDescription) {
        finalDescription = `${finalDescription}|mode:Cash`;
      } else {
        finalDescription = 'mode:Cash';
      }
      console.log(`   ✅ Auto-added mode:Cash to description: ${finalDescription}`);
    } else {
      console.log(`   ℹ️  Description already contains mode, keeping as is`);
    }

    // assignedReceiver is only required if autoPay is true
    const isAutoPay = autoPay === true || autoPay === 'true' || autoPay === true;
    if (isAutoPay && (!assignedReceiver || (typeof assignedReceiver === 'string' && assignedReceiver.trim() === ''))) {
      return res.status(400).json({
        success: false,
        message: 'Please provide assignedReceiver (user ID) when autoPay is enabled'
      });
    }

    // Validate and set display array
    let displayArray = ['Collection']; // Default
    console.log(`\n[Create Payment Mode] User: ${userName} (ID: ${userId})`);
    console.log(`   Received display field:`, display, `Type:`, typeof display, `Is Array:`, Array.isArray(display));
    
    // Check for "Add Amount" in original display array (before filtering)
    const originalDisplayArray = display && Array.isArray(display) ? display : [];
    const hasAddAmountInDisplay = originalDisplayArray.includes('Add Amount');
    console.log(`   Original display array:`, originalDisplayArray);
    console.log(`   Has "Add Amount" in display:`, hasAddAmountInDisplay);
    
    if (display && Array.isArray(display) && display.length > 0) {
      // Validate display values
      const validDisplayValues = ['Collection', 'Expenses', 'Transaction'];
      displayArray = display.filter(d => validDisplayValues.includes(d));
      console.log(`   Filtered display array:`, displayArray);
      if (displayArray.length === 0) {
        displayArray = ['Collection']; // Fallback to default if all invalid
        console.log(`   ⚠️  All display values invalid, using default:`, displayArray);
      }
    } else {
      console.log(`   No display field or empty, using default:`, displayArray);
    }

    // Check if this is the first Payment Mode (index 0) and has "Add Amount" in display
    const paymentModeCount = await PaymentMode.countDocuments();
    const isFirstPaymentMode = paymentModeCount === 0;
    
    // Determine isActive value
    let finalIsActive;
    if (isFirstPaymentMode && hasAddAmountInDisplay) {
      // First Payment Mode (index 0) with "Add Amount" in display → automatically set isActive = true
      finalIsActive = true;
      console.log(`   ✅ First Payment Mode (index 0) with "Add Amount" in display → Auto-setting isActive = true`);
    } else {
      // Use provided isActive value or default to false
      finalIsActive = req.body.isActive !== undefined ? req.body.isActive : false;
      if (isFirstPaymentMode) {
        console.log(`   ℹ️  First Payment Mode but no "Add Amount" in display → isActive = ${finalIsActive}`);
      } else {
        console.log(`   ℹ️  Not first Payment Mode (count: ${paymentModeCount}) → isActive = ${finalIsActive}`);
      }
    }

    const paymentMode = await PaymentMode.create({
      modeName: modeName.trim(),
      description: finalDescription || undefined,
      autoPay: isAutoPay,
      assignedReceiver: assignedReceiver && assignedReceiver.trim() !== '' ? assignedReceiver : undefined,
      display: displayArray,
      isActive: finalIsActive,
      createdBy: req.user._id
    });

    console.log(`\n✅ [Create Payment Mode] User: ${userName} (ID: ${userId})`);
    console.log(`   Payment Mode Created Successfully:`);
    console.log(`   - ID: ${paymentMode._id}`);
    console.log(`   - Name: ${paymentMode.modeName}`);
    console.log(`   - Display: ${JSON.stringify(paymentMode.display)}`);
    console.log(`   - AutoPay: ${paymentMode.autoPay}`);
    console.log(`   - IsActive: ${paymentMode.isActive}`);
    console.log('==========================================\n');

    await createAuditLog(
      req.user._id,
      `Created payment mode: ${modeName}`,
      'Create',
      'PaymentMode',
      paymentMode._id,
      null,
      paymentMode.toObject(),
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Payment mode created successfully',
      paymentMode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get payment modes
// @route   GET /api/payment-modes
// @access  Private
exports.getPaymentModes = async (req, res) => {
  try {
    console.log('GET /api/payment-modes - Request received');
    console.log('User:', req.user ? { id: req.user._id, email: req.user.email, role: req.user.role } : 'Not found');
    console.log('Query params:', req.query);
    
    // Get displayType filter from query (Collection, Expenses, Transaction)
    const { displayType } = req.query;
    
    // Build filter query - Show ALL Payment Modes (both active and inactive)
    const filter = {};
    
    // Filter by display type if provided
    if (displayType) {
      // Map frontend display types to backend values
      let displayValue = displayType;
      if (displayType === 'Expense') {
        displayValue = 'Expenses'; // Frontend uses 'Expense', backend uses 'Expenses'
      }
      
      // Only show payment modes that have this display type in their display array
      filter.display = { $in: [displayValue] };
      console.log(`\n🔍 [Payment Mode Filter] Filtering by display type: "${displayValue}"`);
      console.log(`   Filter query:`, JSON.stringify(filter, null, 2));
    } else {
      console.log(`\n🔍 [Payment Mode Filter] No displayType filter - returning all payment modes (active and inactive)`);
    }
    
    // Fetch ALL payment modes (both active and inactive) for display
    // Filter by display type if provided, but include both active and inactive
    let paymentModes;
    try {
      paymentModes = await PaymentMode.find(filter)
        .sort({ createdAt: -1 })
        .lean();
      
      console.log(`   Found ${paymentModes.length} payment modes (active and inactive, before populate)`);
      if (displayType) {
        console.log(`   ✅ Filtered payment modes by display type: "${displayType}"`);
        paymentModes.forEach((mode, index) => {
          console.log(`   [${index + 1}] ${mode.modeName}: isActive = ${mode.isActive}, display = ${JSON.stringify(mode.display)}`);
        });
      }
      
      // Now populate assignedReceiver for each mode separately to handle errors gracefully
      const User = require('../models/userModel');
      const modesWithPopulatedReceiver = await Promise.all(
        paymentModes.map(async (mode) => {
          if (mode.assignedReceiver) {
            try {
              const user = await User.findById(mode.assignedReceiver)
                .select('name email')
                .lean();
              return {
                ...mode,
                assignedReceiver: user || null
              };
            } catch (err) {
              console.warn(`Failed to populate assignedReceiver for mode ${mode._id}:`, err.message);
              return {
                ...mode,
                assignedReceiver: null
              };
            }
          }
          return {
            ...mode,
            assignedReceiver: null
          };
        })
      );

      console.log(`Successfully processed ${modesWithPopulatedReceiver.length} payment modes (active and inactive)`);

      res.status(200).json({
        success: true,
        count: modesWithPopulatedReceiver.length,
        paymentModes: modesWithPopulatedReceiver
      });
    } catch (dbError) {
      console.error('Database query error:', dbError);
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching payment modes:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Return 500 instead of letting it propagate as 400
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payment modes',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Update payment mode
// @route   PUT /api/payment-modes/:id
// @access  Private (Admin, SuperAdmin)
exports.updatePaymentMode = async (req, res) => {
  try {
    // Log user information
    const User = require('../models/userModel');
    const user = await User.findById(req.user._id).select('name email role').lean();
    const userName = user?.name || user?.email || 'Unknown';
    const userId = req.user._id.toString();
    
    console.log('\n📝 ===== UPDATE PAYMENT MODE REQUEST =====');
    console.log(`   User ID: ${userId}`);
    console.log(`   User Name: ${userName}`);
    console.log(`   User Email: ${user?.email || 'N/A'}`);
    console.log(`   User Role: ${user?.role || 'N/A'}`);
    console.log(`   Payment Mode ID: ${req.params.id}`);
    console.log('==========================================\n');
    
    const paymentMode = await PaymentMode.findById(req.params.id);

    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    const previousValue = paymentMode.toObject();
    const { modeName, description, autoPay, assignedReceiver, isActive, display } = req.body;
    
    console.log(`[Update Payment Mode] User: ${userName} (ID: ${userId})`);
    console.log(`   Payment Mode: ${paymentMode.modeName} (ID: ${paymentMode._id})`);
    console.log(`   Previous Display: ${JSON.stringify(paymentMode.display || [])}`);

    if (modeName !== undefined) paymentMode.modeName = modeName;
    if (description !== undefined) paymentMode.description = description;
    if (autoPay !== undefined) paymentMode.autoPay = autoPay;
    if (assignedReceiver !== undefined) paymentMode.assignedReceiver = assignedReceiver;
    if (isActive !== undefined) paymentMode.isActive = isActive;
    
    // Update display array if provided
    console.log(`\n📝 [Update Payment Mode] Processing display field`);
    console.log(`   Received display field:`, display, `Type:`, typeof display, `Is Array:`, Array.isArray(display));
    console.log(`   Previous display value:`, JSON.stringify(paymentMode.display || []));
    
    if (display !== undefined && Array.isArray(display)) {
      // Validate display values
      const validDisplayValues = ['Collection', 'Expenses', 'Transaction'];
      const displayArray = display.filter(d => validDisplayValues.includes(d));
      console.log(`   Valid display values:`, validDisplayValues);
      console.log(`   Received display array:`, display);
      console.log(`   Filtered display array:`, displayArray);
      
      if (displayArray.length > 0) {
        paymentMode.display = displayArray;
        console.log(`   ✅ Setting display to:`, JSON.stringify(paymentMode.display));
      } else {
        // If all invalid, keep existing or set to default
        paymentMode.display = paymentMode.display && paymentMode.display.length > 0 
          ? paymentMode.display 
          : ['Collection'];
        console.log(`   ⚠️  All display values invalid, keeping existing or default:`, JSON.stringify(paymentMode.display));
      }
    } else if (display !== undefined) {
      console.log(`   ⚠️  Display field provided but not an array, ignoring`);
    } else {
      console.log(`   No display field provided, keeping existing:`, JSON.stringify(paymentMode.display || []));
    }

    await paymentMode.save();
    
    console.log(`\n✅ [Update Payment Mode] User: ${userName} (ID: ${userId})`);
    console.log(`   Payment Mode Updated Successfully:`);
    console.log(`   - ID: ${paymentMode._id}`);
    console.log(`   - Name: ${paymentMode.modeName}`);
    console.log(`   - Display: ${JSON.stringify(paymentMode.display)}`);
    console.log(`   - AutoPay: ${paymentMode.autoPay}`);
    console.log(`   - IsActive: ${paymentMode.isActive}`);
    console.log('==========================================\n');

    await createAuditLog(
      req.user._id,
      `Updated payment mode: ${paymentMode.modeName}`,
      'Update',
      'PaymentMode',
      paymentMode._id,
      previousValue,
      paymentMode.toObject(),
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Payment mode updated successfully',
      paymentMode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete payment mode
// @route   DELETE /api/payment-modes/:id
// @access  Private (Admin, SuperAdmin)
exports.deletePaymentMode = async (req, res) => {
  try {
    const paymentMode = await PaymentMode.findById(req.params.id);

    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    paymentMode.isActive = false;
    await paymentMode.save();

    await createAuditLog(
      req.user._id,
      `Deleted payment mode: ${paymentMode.modeName}`,
      'Delete',
      'PaymentMode',
      paymentMode._id,
      paymentMode.toObject(),
      { isActive: false },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Payment mode deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
