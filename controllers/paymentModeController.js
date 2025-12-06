const PaymentMode = require('../models/paymentModeModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create payment mode
// @route   POST /api/payment-modes
// @access  Private (Admin, SuperAdmin)
exports.createPaymentMode = async (req, res) => {
  try {
    const { modeName, description, autoPay, assignedReceiver, display } = req.body;

    // modeName is always required
    if (!modeName || modeName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide modeName'
      });
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
    console.log('[Create Payment Mode] Received display field:', display, 'Type:', typeof display, 'Is Array:', Array.isArray(display));
    if (display && Array.isArray(display) && display.length > 0) {
      // Validate display values
      const validDisplayValues = ['Collection', 'Expenses', 'Transaction'];
      displayArray = display.filter(d => validDisplayValues.includes(d));
      console.log('[Create Payment Mode] Filtered display array:', displayArray);
      if (displayArray.length === 0) {
        displayArray = ['Collection']; // Fallback to default if all invalid
        console.log('[Create Payment Mode] All display values invalid, using default:', displayArray);
      }
    } else {
      console.log('[Create Payment Mode] No display field or empty, using default:', displayArray);
    }

    const paymentMode = await PaymentMode.create({
      modeName: modeName.trim(),
      description: description ? description.trim() : undefined,
      autoPay: isAutoPay,
      assignedReceiver: assignedReceiver && assignedReceiver.trim() !== '' ? assignedReceiver : undefined,
      display: displayArray,
      createdBy: req.user._id
    });

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
    
    // Build filter query
    const filter = { isActive: true };
    
    // Filter by display type if provided
    if (displayType) {
      // Map frontend display types to backend values
      let displayValue = displayType;
      if (displayType === 'Expense') {
        displayValue = 'Expenses'; // Frontend uses 'Expense', backend uses 'Expenses'
      }
      
      // Only show payment modes that have this display type in their display array
      filter.display = { $in: [displayValue] };
      console.log(`Filtering payment modes by display type: ${displayValue}`);
    }
    
    // Fetch only active payment modes for dropdowns and selections
    // Filter by isActive: true and display type if provided
    let paymentModes;
    try {
      paymentModes = await PaymentMode.find(filter)
        .sort({ createdAt: -1 })
        .lean();
      
      console.log(`Found ${paymentModes.length} active payment modes (before populate)`);
      
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

      console.log(`Successfully processed ${modesWithPopulatedReceiver.length} active payment modes`);

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
    const paymentMode = await PaymentMode.findById(req.params.id);

    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    const previousValue = paymentMode.toObject();
    const { description, autoPay, assignedReceiver, isActive, display } = req.body;

    if (description !== undefined) paymentMode.description = description;
    if (autoPay !== undefined) paymentMode.autoPay = autoPay;
    if (assignedReceiver !== undefined) paymentMode.assignedReceiver = assignedReceiver;
    if (isActive !== undefined) paymentMode.isActive = isActive;
    
    // Update display array if provided
    console.log('[Update Payment Mode] Received display field:', display, 'Type:', typeof display, 'Is Array:', Array.isArray(display));
    if (display !== undefined && Array.isArray(display)) {
      // Validate display values
      const validDisplayValues = ['Collection', 'Expenses', 'Transaction'];
      const displayArray = display.filter(d => validDisplayValues.includes(d));
      console.log('[Update Payment Mode] Filtered display array:', displayArray);
      if (displayArray.length > 0) {
        paymentMode.display = displayArray;
        console.log('[Update Payment Mode] Setting display to:', paymentMode.display);
      } else {
        // If all invalid, keep existing or set to default
        paymentMode.display = paymentMode.display && paymentMode.display.length > 0 
          ? paymentMode.display 
          : ['Collection'];
        console.log('[Update Payment Mode] All display values invalid, keeping existing or default:', paymentMode.display);
      }
    } else if (display !== undefined) {
      console.log('[Update Payment Mode] Display field provided but not an array, ignoring');
    } else {
      console.log('[Update Payment Mode] No display field provided, keeping existing:', paymentMode.display);
    }

    await paymentMode.save();

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
