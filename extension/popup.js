const { DEFAULT, format, fromEvent, load } = globalThis.PRDexShortcut;
const $ = sel => document.querySelector(sel);

const recordBtn = $("#record");
const hint = $("#recordHint");
let current = DEFAULT;
let recording = false;

function show(sc) {
  current = sc;
  recordBtn.textContent = format(sc);
  $("#warn").hidden = sc.ctrl || sc.alt || sc.meta;
}

function stopRecording() {
  recording = false;
  recordBtn.classList.remove("recording");
  hint.textContent = "Click, then press the key or combo you want.";
  show(current);
}

recordBtn.addEventListener("click", () => {
  if (recording) return stopRecording();
  recording = true;
  recordBtn.classList.add("recording");
  recordBtn.textContent = "Press a key…";
  hint.textContent = "Esc to cancel.";
});

document.addEventListener("keydown", e => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stopRecording();
  const sc = fromEvent(e);
  if (!sc) {
    // Only modifiers so far: preview them.
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
    recordBtn.textContent = `${mods.join(" + ")} + …`;
    return;
  }
  current = sc;
  chrome.storage.sync.set({ shortcut: sc });
  stopRecording();
});

$("#reset").addEventListener("click", () => {
  chrome.storage.sync.remove("shortcut");
  current = DEFAULT;
  stopRecording();
});

show(await load());

// Ask the active tab's content script whether we're on the game (it only exists on pokerogue.net,
// so no "tabs" permission is needed to check the URL).
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const state = await chrome.tabs.sendMessage(tab.id, { type: "prdex:ping" }).catch(() => null);
$("#onGame").hidden = !state;
$("#offGame").hidden = !!state;
if (state) {
  $("#toggle").textContent = state.open ? "Close the dex" : "Open the dex";
  $("#toggle").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tab.id, { type: "prdex:toggle" }).catch(() => null);
    window.close();
  });
}
