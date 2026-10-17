const API = "https://www.ir35careers.com/api/applications/browser-handoff";
const CACHE = new Map();

function key(tabId) {
  return `application:${tabId}`;
}

async function state(tabId) {
  const stored = await chrome.storage.session.get(key(tabId));
  return stored[key(tabId)] || null;
}

async function save(tabId, value) {
  await chrome.storage.session.set({ [key(tabId)]: value });
}

async function clear(tabId) {
  CACHE.delete(tabId);
  await chrome.storage.session.remove(key(tabId));
}

async function clearToken(token) {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.entries(stored)
    .filter(([name, value]) => name.startsWith("application:") && value?.token === token)
    .map(([name]) => name);
  keys.forEach((name) => CACHE.delete(Number(name.split(":")[1])));
  if (keys.length) await chrome.storage.session.remove(keys);
}

async function api(path, token, init) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-IR35-Handoff": token,
      ...(init && init.headers ? init.headers : {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({ error: "IR35Careers returned an unreadable response." }));
  if (!response.ok) throw new Error(body.error || `IR35Careers returned ${response.status}.`);
  return body;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ error: "This action must run in an employer tab." });
    return false;
  }

  (async () => {
    if (message.type === "START") {
      await save(tabId, { token: message.token, steps: 0, startedAt: Date.now(), status: "Connecting to IR35Careers" });
      CACHE.delete(tabId);
      return { ok: true };
    }
    const current = await state(tabId);
    if (!current) return { active: false };
    if (message.type === "PACKET") {
      if (!CACHE.has(tabId)) CACHE.set(tabId, await api("?kind=packet", current.token));
      return { active: true, packet: CACHE.get(tabId), steps: current.steps || 0 };
    }
    if (message.type === "ADVANCE") {
      const next = { ...current, steps: (current.steps || 0) + 1, status: message.status || current.status };
      await save(tabId, next);
      return { active: true, steps: next.steps };
    }
    if (message.type === "STATUS") {
      await save(tabId, { ...current, status: message.status || current.status });
      return { active: true };
    }
    if (message.type === "VERIFICATION") {
      return await api("?kind=verification", current.token);
    }
    if (message.type === "RESULT") {
      const result = await api("", current.token, {
        method: "POST",
        body: JSON.stringify({ action: "result", token: current.token, ...message.result }),
      });
      if (message.result.status === "submitted") await clearToken(current.token);
      else await save(tabId, { ...current, status: message.result.message || message.result.status });
      return result;
    }
    if (message.type === "CLEAR") {
      await clear(tabId);
      return { ok: true };
    }
    if (message.type === "CURRENT") return { active: true, ...current };
    return { error: "Unsupported assistant action." };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clear(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId)) return;
  void state(tab.openerTabId).then(async (current) => {
    if (!current) return;
    await save(tab.id, { ...current, status: "Continuing in employer tab" });
    CACHE.delete(tab.id);
  });
});
