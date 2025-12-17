/**
 * VerifyAI Options Page
 */

import {
  getSettings,
  saveSettings,
  resetSettings,
  clearCache,
  getCacheStats,
} from '../shared/storage.js';
import { DEFAULT_SETTINGS } from '../shared/constants.js';

// Simple API client for testing connection
async function testBackendConnection(url) {
  const response = await fetch(`${url}/api/health`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// DOM elements
const els = {
  backendMode: document.getElementById('backendMode'),
  backendUrl: document.getElementById('backendUrl'),
  testConnection: document.getElementById('testConnection'),
  connectionStatus: document.getElementById('connectionStatus'),
  selfHostedSettings: document.getElementById('selfHostedSettings'),

  defaultLanguage: document.getElementById('defaultLanguage'),

  showThoughts: document.getElementById('showThoughts'),
  autoOpenPanel: document.getElementById('autoOpenPanel'),

  enableLocalCache: document.getElementById('enableLocalCache'),
  cacheExpiry: document.getElementById('cacheExpiry'),
  cacheStats: document.getElementById('cacheStats'),
  clearCache: document.getElementById('clearCache'),

  resetDefaults: document.getElementById('resetDefaults'),
  saveSettings: document.getElementById('saveSettings'),
  toast: document.getElementById('toast'),
};

// Current settings
let currentSettings = {};

/**
 * Initialize options page
 */
async function initialize() {
  // Load current settings
  currentSettings = await getSettings();

  // Populate form
  populateForm(currentSettings);

  // Update cache stats
  await updateCacheStats();

  // Set up event listeners
  setupEventListeners();
}

/**
 * Populate form with settings
 */
function populateForm(settings) {
  els.backendMode.value = settings.backendMode || 'self-hosted';
  els.backendUrl.value = settings.backendUrl || DEFAULT_SETTINGS.backendUrl;
  els.defaultLanguage.value = settings.language || 'en';
  els.showThoughts.checked = settings.showThoughts !== false;
  els.autoOpenPanel.checked = settings.autoOpenPanel === true;
  els.enableLocalCache.checked = settings.enableLocalCache !== false;
  els.cacheExpiry.value = settings.cacheExpiryDays || 7;

  // Show/hide self-hosted settings
  updateBackendModeUI();
}

/**
 * Update UI based on backend mode
 */
function updateBackendModeUI() {
  const isSelfHosted = els.backendMode.value === 'self-hosted';
  els.selfHostedSettings.style.display = isSelfHosted ? 'block' : 'none';
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  els.backendMode.addEventListener('change', updateBackendModeUI);
  els.testConnection.addEventListener('click', handleTestConnection);
  els.clearCache.addEventListener('click', handleClearCache);
  els.resetDefaults.addEventListener('click', handleResetDefaults);
  els.saveSettings.addEventListener('click', handleSaveSettings);

  // Auto-save on change for checkboxes
  els.showThoughts.addEventListener('change', () => markUnsaved());
  els.autoOpenPanel.addEventListener('change', () => markUnsaved());
  els.enableLocalCache.addEventListener('change', () => markUnsaved());
}

/**
 * Handle test connection
 */
async function handleTestConnection() {
  const url = els.backendUrl.value.trim();

  if (!url) {
    showConnectionStatus('error', 'Please enter a URL');
    return;
  }

  els.testConnection.disabled = true;
  els.testConnection.textContent = 'Testing...';
  showConnectionStatus('pending', 'Connecting...');

  try {
    const health = await testBackendConnection(url);

    showConnectionStatus(
      'success',
      `Connected! Version: ${health.version}`
    );
  } catch (error) {
    showConnectionStatus(
      'error',
      `Failed: ${error.message}`
    );
  } finally {
    els.testConnection.disabled = false;
    els.testConnection.textContent = 'Test';
  }
}

/**
 * Show connection status
 */
function showConnectionStatus(type, message) {
  els.connectionStatus.className = `connection-status status-${type}`;
  els.connectionStatus.textContent = message;
}

/**
 * Update cache stats display
 */
async function updateCacheStats() {
  const stats = await getCacheStats();
  els.cacheStats.textContent = `${stats.count} items (${stats.sizeFormatted})`;
}

/**
 * Handle clear cache
 */
async function handleClearCache() {
  if (!confirm('Are you sure you want to clear all cached results?')) {
    return;
  }

  await clearCache();
  await updateCacheStats();
  showToast('Cache cleared');
}

/**
 * Handle reset defaults
 */
async function handleResetDefaults() {
  if (!confirm('Are you sure you want to reset all settings to defaults?')) {
    return;
  }

  currentSettings = await resetSettings();
  populateForm(currentSettings);
  showToast('Settings reset to defaults');
}

/**
 * Handle save settings
 */
async function handleSaveSettings() {
  const newSettings = {
    backendMode: els.backendMode.value,
    backendUrl: els.backendUrl.value.trim() || DEFAULT_SETTINGS.backendUrl,
    language: els.defaultLanguage.value,
    showThoughts: els.showThoughts.checked,
    autoOpenPanel: els.autoOpenPanel.checked,
    enableLocalCache: els.enableLocalCache.checked,
    cacheExpiryDays: parseInt(els.cacheExpiry.value) || 7,
  };

  currentSettings = await saveSettings(newSettings);

  showToast('Settings saved');
  els.saveSettings.classList.remove('unsaved');
}

/**
 * Mark save button as having unsaved changes
 */
function markUnsaved() {
  els.saveSettings.classList.add('unsaved');
}

/**
 * Show toast notification
 */
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');

  setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 3000);
}

// Initialize on load
initialize();
