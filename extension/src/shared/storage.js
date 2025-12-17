/**
 * Storage manager for VerifyAI extension
 * Handles settings (sync) and cache (local) storage
 */

import { DEFAULT_SETTINGS } from './constants.js';
import {
  storageSyncGet,
  storageSyncSet,
  storageLocalGet,
  storageLocalSet,
  storageLocalRemove,
} from './browser-apis.js';

const STORAGE_KEYS = {
  SETTINGS: 'verifyai_settings',
  CACHE: 'verifyai_cache',
  ACTIVE_JOBS: 'verifyai_active_jobs',
};

/**
 * Get extension settings from sync storage
 * @returns {Promise<Object>} Settings object with defaults applied
 */
export async function getSettings() {
  const result = await storageSyncGet(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/**
 * Save settings to sync storage
 * @param {Object} settings - Settings to save (merged with existing)
 */
export async function saveSettings(settings) {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await storageSyncSet({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings() {
  await storageSyncSet({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

/**
 * Get cached results from local storage
 * @returns {Promise<Object>} Cache object (url -> cached entry)
 */
export async function getCache() {
  const result = await storageLocalGet(STORAGE_KEYS.CACHE);
  return result[STORAGE_KEYS.CACHE] || {};
}

/**
 * Cache a job result
 * @param {string} url - Video URL (will be normalized)
 * @param {Object} job - Job object with report
 */
export async function cacheResult(url, job) {
  const settings = await getSettings();
  if (!settings.enableLocalCache) return;

  const cache = await getCache();
  const normalizedUrl = normalizeUrl(url);
  const expiryMs = settings.cacheExpiryDays * 24 * 60 * 60 * 1000;

  cache[normalizedUrl] = {
    job,
    timestamp: Date.now(),
    expiresAt: Date.now() + expiryMs,
  };

  await storageLocalSet({ [STORAGE_KEYS.CACHE]: cache });
}

/**
 * Get cached result for a URL
 * @param {string} url - Video URL
 * @returns {Promise<Object|null>} Cached job or null if not found/expired
 */
export async function getCachedResult(url) {
  const cache = await getCache();
  const normalizedUrl = normalizeUrl(url);
  const entry = cache[normalizedUrl];

  if (!entry) return null;

  // Check expiry
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    // Remove expired entry
    delete cache[normalizedUrl];
    await storageLocalSet({ [STORAGE_KEYS.CACHE]: cache });
    return null;
  }

  return entry.job;
}

/**
 * Clear all cached results
 */
export async function clearCache() {
  await storageLocalRemove(STORAGE_KEYS.CACHE);
}

/**
 * Get cache size in bytes (approximate)
 * @returns {Promise<{count: number, sizeBytes: number, sizeFormatted: string}>}
 */
export async function getCacheStats() {
  const cache = await getCache();
  const count = Object.keys(cache).length;
  const sizeBytes = new Blob([JSON.stringify(cache)]).size;

  return {
    count,
    sizeBytes,
    sizeFormatted: formatBytes(sizeBytes),
  };
}

/**
 * Track active job for a tab
 * @param {number} tabId - Tab ID
 * @param {string} jobId - Job ID
 * @param {string} url - Video URL
 */
export async function setActiveJob(tabId, jobId, url) {
  const result = await storageLocalGet(STORAGE_KEYS.ACTIVE_JOBS);
  const activeJobs = result[STORAGE_KEYS.ACTIVE_JOBS] || {};

  activeJobs[tabId] = { jobId, url, startedAt: Date.now() };

  await storageLocalSet({ [STORAGE_KEYS.ACTIVE_JOBS]: activeJobs });
}

/**
 * Get active job for a tab
 * @param {number} tabId - Tab ID
 * @returns {Promise<{jobId: string, url: string}|null>}
 */
export async function getActiveJob(tabId) {
  const result = await storageLocalGet(STORAGE_KEYS.ACTIVE_JOBS);
  const activeJobs = result[STORAGE_KEYS.ACTIVE_JOBS] || {};
  return activeJobs[tabId] || null;
}

/**
 * Remove active job for a tab
 * @param {number} tabId - Tab ID
 */
export async function removeActiveJob(tabId) {
  const result = await storageLocalGet(STORAGE_KEYS.ACTIVE_JOBS);
  const activeJobs = result[STORAGE_KEYS.ACTIVE_JOBS] || {};

  delete activeJobs[tabId];

  await storageLocalSet({ [STORAGE_KEYS.ACTIVE_JOBS]: activeJobs });
}

/**
 * Get all active jobs
 * @returns {Promise<Object>} Map of tabId -> job info
 */
export async function getAllActiveJobs() {
  const result = await storageLocalGet(STORAGE_KEYS.ACTIVE_JOBS);
  return result[STORAGE_KEYS.ACTIVE_JOBS] || {};
}

/**
 * Normalize URL for cache keys (strip tracking params, lowercase domain)
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);

    // Remove tracking parameters
    const stripParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'igshid', 'ref', 'ref_src', 'ref_url',
    ];
    stripParams.forEach(p => parsed.searchParams.delete(p));

    // Remove hash
    parsed.hash = '';

    // Lowercase protocol and host
    const normalized = parsed.toString().toLowerCase();

    // Remove trailing slash
    return normalized.replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Listen for storage changes
 * @param {function} callback - Called with (changes, areaName)
 * @returns {function} Unsubscribe function
 */
export function onStorageChange(callback) {
  const listener = (changes, areaName) => {
    callback(changes, areaName);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
