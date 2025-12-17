/**
 * Platform adapter index
 * Automatically detects and returns the appropriate adapter for the current page
 */

import { YouTubeAdapter } from './youtube.js';
import { InstagramAdapter } from './instagram.js';
import { TikTokAdapter } from './tiktok.js';
import { TwitterAdapter } from './twitter.js';
import { FacebookAdapter } from './facebook.js';

// All available adapters
const adapters = [
  YouTubeAdapter,
  InstagramAdapter,
  TikTokAdapter,
  TwitterAdapter,
  FacebookAdapter,
];

/**
 * Detect which platform adapter to use for the current page
 * @returns {Object|null} Platform adapter or null if not supported
 */
export function detectPlatform() {
  for (const adapter of adapters) {
    if (adapter.isVideoPage()) {
      return adapter;
    }
  }
  return null;
}

/**
 * Get adapter by platform ID
 * @param {string} platformId - Platform ID (e.g., 'youtube', 'instagram')
 * @returns {Object|null} Platform adapter or null if not found
 */
export function getAdapterById(platformId) {
  return adapters.find(a => a.id === platformId) || null;
}

/**
 * Get all available adapters
 * @returns {Array} Array of all adapters
 */
export function getAllAdapters() {
  return adapters;
}

export {
  YouTubeAdapter,
  InstagramAdapter,
  TikTokAdapter,
  TwitterAdapter,
  FacebookAdapter,
};
