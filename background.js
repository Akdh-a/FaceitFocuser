chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ revealCount: 0, revealUntil: 0 }, () => {
    if (chrome.runtime.lastError) {
      console.error('FACEIT Focus: failed to reset session reveal limit', chrome.runtime.lastError);
    }
  });
});
