const analyseButton = document.getElementById("analyse");
const status = document.getElementById("status");

analyseButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && typeof tab.url === "string" ? tab.url : "";
  if (!url.startsWith("https://")) {
    status.textContent = "Open a public HTTPS job page first.";
    analyseButton.disabled = true;
    return;
  }
  const destination = `https://www.ir35careers.com/analyse-job?url=${encodeURIComponent(url)}`;
  await chrome.tabs.create({ url: destination });
  window.close();
});
