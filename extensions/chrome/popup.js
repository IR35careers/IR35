const continueButton = document.getElementById("continue");
const status = document.getElementById("status");

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const current = await chrome.tabs.sendMessage(tab.id, { type: "CURRENT" }).catch(() => null);
  if (current?.active) {
    status.textContent = current.status || "Your IR35Careers application is active on this employer page.";
    continueButton.disabled = false;
    return;
  }
  status.textContent = "Open an approved application in IR35Careers and select Continue securely.";
  continueButton.disabled = true;
}

continueButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "RUN" }).catch(() => null);
  window.close();
});

void refresh();
