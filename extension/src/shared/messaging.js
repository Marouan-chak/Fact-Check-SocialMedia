/**
 * Messaging utilities for VerifyAI extension
 * Handles communication between background, content scripts, popup, and side panel
 */

import { queryTabs } from './browser-apis.js';

/**
 * Send a message to the background service worker
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 * @returns {Promise<any>} Response from background
 */
export async function sendToBackground(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Send a message to a specific tab's content script
 * @param {number} tabId - Tab ID
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 * @returns {Promise<any>} Response from content script
 */
export async function sendToTab(tabId, type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script might not be loaded yet, don't treat as error
        resolve(null);
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Send a message to all tabs with content scripts
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 */
export async function broadcastToTabs(type, data = {}) {
  const tabs = await queryTabs({});

  for (const tab of tabs) {
    if (tab.id) {
      try {
        await sendToTab(tab.id, type, data);
      } catch {
        // Ignore errors for tabs without content script
      }
    }
  }
}

/**
 * Create a message handler for the background service worker
 * @param {Object} handlers - Map of message type to handler function
 * @returns {function} Listener function
 */
export function createMessageHandler(handlers) {
  return (message, sender, sendResponse) => {
    const { type, ...data } = message;
    const handler = handlers[type];

    if (!handler) {
      console.warn(`Unknown message type: ${type}`);
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
    }

    // Handle async handlers
    const result = handler(data, sender);

    if (result instanceof Promise) {
      result
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ error: error.message }));
      return true; // Keep channel open for async response
    }

    sendResponse(result);
    return false;
  };
}

/**
 * Listen for messages
 * @param {function} handler - Handler function (message, sender) => response
 * @returns {function} Unsubscribe function
 */
export function onMessage(handler) {
  const listener = (message, sender, sendResponse) => {
    const result = handler(message, sender);

    if (result instanceof Promise) {
      result
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    if (result !== undefined) {
      sendResponse(result);
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/**
 * Create a typed message sender with predefined message types
 * Usage:
 *   const messages = createTypedMessages({
 *     startFactCheck: (url, language) => ({ type: 'START_FACT_CHECK', url, language })
 *   });
 *   await messages.startFactCheck('https://...', 'en');
 */
export function createTypedMessages(messageCreators) {
  const messages = {};

  for (const [name, creator] of Object.entries(messageCreators)) {
    messages[name] = async (...args) => {
      const message = creator(...args);
      return sendToBackground(message.type, message);
    };
  }

  return messages;
}

/**
 * Get the current active tab
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getCurrentTab() {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  return tab || null;
}

/**
 * Check if we're running in the background service worker
 * @returns {boolean}
 */
export function isServiceWorker() {
  return typeof window === 'undefined' && typeof self !== 'undefined';
}

/**
 * Check if we're running in a content script
 * @returns {boolean}
 */
export function isContentScript() {
  return typeof window !== 'undefined' && typeof chrome?.runtime?.getManifest === 'function';
}
