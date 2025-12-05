const { ActionButtonSetting, BUTTON_KEYS } = require('../models/actionButtonSettingModel');
const { createAuditLog } = require('../utils/auditLogger');

const DEFAULT_SETTINGS = {
  approve: { showButton: true, enablePopup: true },
  reject: { showButton: true, enablePopup: true },
  unapprove: { showButton: true, enablePopup: false },
  delete: { showButton: true, enablePopup: true },
  edit: { showButton: true, enablePopup: false },
  flag: { showButton: true, enablePopup: true }
};

const buildSnapshot = (docs) => {
  const snapshot = {};
  BUTTON_KEYS.forEach((key) => {
    const doc = docs.find((item) => item.key === key);
    if (doc) {
      snapshot[key] = {
        showButton: doc.showButton,
        enablePopup: doc.enablePopup
      };
    } else {
      snapshot[key] = { ...DEFAULT_SETTINGS[key] };
    }
  });
  return snapshot;
};

const ensureDefaults = async () => {
  const docs = await ActionButtonSetting.find({}).select('key');
  const existingKeys = new Set(docs.map((doc) => doc.key));
  const missingKeys = BUTTON_KEYS.filter((key) => !existingKeys.has(key));

  if (missingKeys.length > 0) {
    try {
      await ActionButtonSetting.insertMany(
        missingKeys.map((key) => ({
          key,
          showButton: DEFAULT_SETTINGS[key].showButton,
          enablePopup: DEFAULT_SETTINGS[key].enablePopup
        })),
        { ordered: false }
      );
    } catch (error) {
      if (!error || error.code !== 11000) {
        throw error;
      }
      // Ignore duplicate key errors caused by race conditions
    }
  }
};

exports.getActionButtonSettings = async (req, res) => {
  try {
    await ensureDefaults();
    const docs = await ActionButtonSetting.find({}).sort('key');

    return res.status(200).json({
      success: true,
      settings: docs.map((doc) => ({
        key: doc.key,
        showButton: doc.showButton,
        enablePopup: doc.enablePopup
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.updateActionButtonSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings) || settings.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Settings payload must be a non-empty array'
      });
    }

    await ensureDefaults();

    const existingDocs = await ActionButtonSetting.find({}).sort('key');
    const previousSnapshot = buildSnapshot(existingDocs);

    const updates = settings.map((item) => {
      const key = typeof item.key === 'string' ? item.key.trim() : '';
      if (!BUTTON_KEYS.includes(key)) {
        throw new Error(`Invalid button key provided: ${item.key}`);
      }

      if (typeof item.showButton !== 'boolean' || typeof item.enablePopup !== 'boolean') {
        throw new Error(`Invalid showButton/enablePopup type for key: ${key}`);
      }

      return { key, showButton: item.showButton, enablePopup: item.enablePopup };
    });

    const operations = updates.map((update) =>
      ActionButtonSetting.findOneAndUpdate(
        { key: update.key },
        {
          showButton: update.showButton,
          enablePopup: update.enablePopup,
          updatedBy: req.user?._id || null
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );

    await Promise.all(operations);
    const refreshedDocs = await ActionButtonSetting.find({}).sort('key');
    const updatedSnapshot = buildSnapshot(refreshedDocs);

    await createAuditLog(
      req.user?._id,
      'Updated action button settings',
      'Update',
      'ActionButtonSettings',
      null,
      previousSnapshot,
      updatedSnapshot,
      req.ip
    );

    return res.status(200).json({
      success: true,
      message: 'Action button settings updated successfully',
      settings: refreshedDocs.map((doc) => ({
        key: doc.key,
        showButton: doc.showButton,
        enablePopup: doc.enablePopup
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.resetActionButtonSettings = async (req, res) => {
  try {
    await ensureDefaults();

    const previousDocs = await ActionButtonSetting.find({}).sort('key');
    const previousSnapshot = buildSnapshot(previousDocs);

    const operations = BUTTON_KEYS.map((key) =>
      ActionButtonSetting.findOneAndUpdate(
        { key },
        {
          showButton: DEFAULT_SETTINGS[key].showButton,
          enablePopup: DEFAULT_SETTINGS[key].enablePopup,
          updatedBy: req.user?._id || null
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );

    await Promise.all(operations);
    const refreshedDocs = await ActionButtonSetting.find({}).sort('key');
    const updatedSnapshot = buildSnapshot(refreshedDocs);

    await createAuditLog(
      req.user?._id,
      'Reset action button settings to defaults',
      'Update',
      'ActionButtonSettings',
      null,
      previousSnapshot,
      updatedSnapshot,
      req.ip
    );

    return res.status(200).json({
      success: true,
      message: 'Action button settings reset to defaults',
      settings: refreshedDocs.map((doc) => ({
        key: doc.key,
        showButton: doc.showButton,
        enablePopup: doc.enablePopup
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


