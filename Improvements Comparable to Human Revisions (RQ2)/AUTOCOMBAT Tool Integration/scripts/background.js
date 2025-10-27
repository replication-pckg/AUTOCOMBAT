console.log("Background script loaded");

// Initialize extension on install or update
chrome.runtime.onInstalled.addListener(() => {
    console.log("AUTOCOMBAT extension installed and ready.");
});

// Optional: handle messages or centralize network requests in future
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ping") {
        console.log("Received ping from content script.");
        sendResponse({ status: "pong", source: "background" });
    }

    // Example: relay message to active tab (if needed for future updates)
    if (message.action === "refreshContentScripts") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    files: ["scripts/contentScript.js"]
                });
            }
        });
    }
    return true; // keep the message channel open for async responses
});
