/**
 * Cross-browser helpers for Chrome/Firefox extension APIs.
 * Provides Promise-based wrappers that fall back to callbacks when needed.
 */

const browserApi = typeof globalThis !== 'undefined' && typeof globalThis.browser !== 'undefined'
  ? globalThis.browser
  : null;

const chromeApi = typeof globalThis !== 'undefined' && typeof globalThis.chrome !== 'undefined'
  ? globalThis.chrome
  : null;

export const extensionApi = browserApi || chromeApi;

function promisifyChromeCall(fn, ctx, ...args) {
  if (!fn || !ctx) {
    return Promise.reject(new Error('Extension APIs are not available in this context'));
  }

  return new Promise((resolve, reject) => {
    try {
      fn.call(ctx, ...args, (result) => {
        const error = chromeApi?.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(result);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function queryTabs(queryInfo = {}) {
  if (browserApi?.tabs?.query) {
    return browserApi.tabs.query(queryInfo);
  }
  return promisifyChromeCall(chromeApi?.tabs?.query, chromeApi?.tabs, queryInfo);
}

export async function getTab(tabId) {
  if (browserApi?.tabs?.get) {
    return browserApi.tabs.get(tabId);
  }
  return promisifyChromeCall(chromeApi?.tabs?.get, chromeApi?.tabs, tabId);
}

function getStorageArea(area) {
  if (browserApi?.storage?.[area]) {
    return { api: browserApi.storage[area], type: 'browser' };
  }
  if (chromeApi?.storage?.[area]) {
    return { api: chromeApi.storage[area], type: 'chrome' };
  }
  return null;
}

async function storageFallback(area, method, payload) {
  const areaInfo = getStorageArea(area);
  if (areaInfo?.type === 'browser') {
    return areaInfo.api[method](payload);
  }
  if (areaInfo?.type === 'chrome') {
    return promisifyChromeCall(areaInfo.api[method], areaInfo.api, payload);
  }
  return Promise.reject(new Error(`Storage area "${area}" is not available`));
}

export async function storageSyncGet(keys) {
  try {
    return await storageFallback('sync', 'get', keys);
  } catch (error) {
    // Firefox might not have sync yet; fall back to local
    return storageFallback('local', 'get', keys);
  }
}

export async function storageSyncSet(data) {
  try {
    return await storageFallback('sync', 'set', data);
  } catch (error) {
    return storageFallback('local', 'set', data);
  }
}

export async function storageLocalGet(keys) {
  return storageFallback('local', 'get', keys);
}

export async function storageLocalSet(data) {
  return storageFallback('local', 'set', data);
}

export async function storageLocalRemove(keys) {
  return storageFallback('local', 'remove', keys);
}
