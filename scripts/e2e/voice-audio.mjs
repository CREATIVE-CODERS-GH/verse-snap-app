// Voice & Audio, end to end in the browser, with a STUB speech engine: nothing is really spoken
// and no account, network write or paid service is involved.
//   npm run test:e2e:voice-audio        (with the app running; see lib.mjs for settings)
// It checks that every Voice & Audio setting reaches the speech engine: device voice, narrator
// pitch and pace, playback speed, microphone sensitivity and the speech language.
import { openBrowser } from "./lib.mjs";

// Runs before every page: a fake speechSynthesis (records each utterance; finishes it a moment later)
// and a fake SpeechRecognition (records the settings it was given).
const STUB = `
(() => {
  window.__spoken = [];
  window.__cancels = 0;
  window.__recognitions = [];
  const voices = [
    { voiceURI: "fr-1", name: "Amelie", lang: "fr-CA", localService: true, default: false },
    { voiceURI: "us-1", name: "Alex", lang: "en-US", localService: true, default: true },
    { voiceURI: "gb-1", name: "Daniel", lang: "en-GB", localService: true, default: false },
  ];
  const listeners = {};
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.rate = 1; this.pitch = 1; this.lang = ""; this.voice = null; }
  };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => voices,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    speak(u) {
      window.__spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, lang: u.lang, voice: u.voice && u.voice.voiceURI });
      const token = window.__spoken.length;
      setTimeout(() => { if (window.__spoken.length === token) u.onend && u.onend(); }, 60000);
    },
    cancel() { window.__cancels += 1; },
    pause() {}, resume() {},
  } });
  const Recognition = class {
    start() { window.__recognitions.push({ lang: this.lang, maxAlternatives: this.maxAlternatives }); }
    stop() {} abort() {}
  };
  window.SpeechRecognition = Recognition;
  window.webkitSpeechRecognition = Recognition;
})();
`;

const b = await openBrowser({ init: STUB });
const { ev, go: load, viewport, waitFor, check, sleep } = b;
// The page is rendered on the server first; give the browser a moment to attach its handlers.
const go = async (path, ready) => {
  await load(path, ready);
  await sleep(1500);
};

const prefs = () => ev(`JSON.parse(localStorage.getItem("versesnap.preferences") || "{}")`);
const setPrefs = (patch) =>
  ev(
    `localStorage.setItem("versesnap.preferences", JSON.stringify({ ...JSON.parse(localStorage.getItem("versesnap.preferences") || "{}"), ...${JSON.stringify(patch)} }))`,
  );
const clickButton = (label, scope = "document") =>
  ev(
    `(() => { const el = [...${scope}.querySelectorAll('button, [role="radio"]')].find((e) => e.innerText.replace(/\\s+/g, " ").trim().includes(${JSON.stringify(label)})); if (!el) return false; el.click(); return true; })()`,
  );
const spoken = () => ev("window.__spoken");
const pageText = () => ev("document.body.innerText");

await viewport(390, 844);

// ---------- 1. The settings screen: honest narrator wording, device voice picker ----------
await go("/settings/voice-audio", `document.body.innerText.includes("Device voice")`);
let text = await pageText();
check(
  "narrator cards no longer promise a male, female or soundscape voice",
  !/Male|Female|Soundscape|Peaceful Ambient/.test(text) &&
    /Deeper/.test(text) &&
    /Brighter/.test(text),
);
check("device voice row starts on Automatic", /Device voice[\s\S]*Automatic/.test(text));
check(
  "speech language wording matches what it does",
  /dictation and the read-aloud accent/.test(text),
);
check("microphone sensitivity explains its effect", /Balanced for most places/.test(text));

await clickButton("Device voice");
await waitFor(`!!document.querySelector('input[name="device-voice"]')`, 5000);
const options = await ev(
  `[...document.querySelectorAll('input[name="device-voice"]')].map((i) => i.closest("label").innerText.trim())`,
);
check(
  "the picker lists Automatic and the device's voices, English first",
  JSON.stringify(options) ===
    JSON.stringify(["Automatic", "Alex (en-US)", "Daniel (en-GB)", "Amelie (fr-CA)"]),
  JSON.stringify(options).slice(0, 200),
);
await ev(`document.querySelector('input[name="device-voice"][value="gb-1"]').click()`);
await sleep(400);
check("choosing a voice is saved", (await prefs()).voiceURI === "gb-1");

// ---------- 2. The voice, narrator and speed reach the sample preview ----------
await clickButton("Play Voice Sample");
await sleep(300);
let first = (await spoken())[0];
check(
  "sample reads with the chosen voice, the Classic pitch and normal speed",
  !!first &&
    first.voice === "gb-1" &&
    first.lang === "en-GB" &&
    first.pitch === 0.9 &&
    first.rate === 1,
  JSON.stringify(first),
);
check(
  "sample text starts with the passage",
  !!first && /^Psalm 23, verse 1\./.test(first.text),
  first?.text,
);

await clickButton("Stop Sample");
await clickButton("Gentle Reading");
await clickButton("1.5x");
await sleep(300);
await ev("window.__spoken.length = 0");
await clickButton("Play Voice Sample");
await sleep(300);
first = (await spoken())[0];
check(
  "narrator and speed change what is spoken (Gentle at 1.5x)",
  !!first && first.pitch === 1.1 && Math.abs(first.rate - 1.5 * 0.95) < 0.001,
  JSON.stringify(first),
);
const stops = await ev("window.__cancels");
await clickButton("Stop Sample");
check("stopping cancels the speech", (await ev("window.__cancels")) > stops);

// ---------- 3. Reload keeps everything ----------
await go("/settings/voice-audio", `document.body.innerText.includes("Device voice")`);
const saved = await prefs();
text = await pageText();
check(
  "settings survive a reload",
  saved.voiceURI === "gb-1" &&
    saved.narrator === "gentle" &&
    saved.playbackSpeed === "1.5x" &&
    /Daniel/.test(text),
  JSON.stringify(saved),
);

// A saved voice that this device no longer has falls back to Automatic.
await setPrefs({ voiceURI: "gone-voice" });
await go("/settings/voice-audio", `document.body.innerText.includes("Device voice")`);
await ev("window.__spoken.length = 0");
await clickButton("Play Voice Sample");
await sleep(300);
first = (await spoken())[0];
check(
  "a missing saved voice falls back to Automatic",
  !!first && first.voice === null,
  JSON.stringify(first),
);
await clickButton("Stop Sample");

// ---------- 4. The single-verse page uses the same engine and settings ----------
await setPrefs({ voiceURI: "us-1", narrator: "peaceful", playbackSpeed: "1x" });
await go("/verse/KJAV/john/3/16", `document.body.innerText.includes("God so loved")`);
await ev("window.__spoken.length = 0");
await clickButton("Listen");
await sleep(300);
first = (await spoken())[0];
check(
  "the verse page reads aloud with the saved voice and narrator",
  !!first &&
    /^John 3:16\./.test(first.text) &&
    first.voice === "us-1" &&
    first.pitch === 1 &&
    Math.abs(first.rate - 0.85) < 0.001,
  JSON.stringify(first),
);
const count = (await spoken()).length;
await clickButton("Stop");
await sleep(200);
check(
  "Stop on the verse page cancels the speech",
  (await spoken()).length === count && (await ev("window.__cancels")) > 0,
);

// ---------- 5. Say a Verse and dictation use the speech settings ----------
await setPrefs({ micSensitivity: "open", speechLanguage: "en-GB", autoListen: true });
await go("/voice", `document.body.innerText.length > 50`);
await sleep(800);
let recognitions = await ev("window.__recognitions");
check(
  "Say a Verse uses the language and the open-air sensitivity (5 alternatives)",
  recognitions.length > 0 &&
    recognitions[0].lang === "en-GB" &&
    recognitions[0].maxAlternatives === 5,
  JSON.stringify(recognitions),
);

await setPrefs({ micSensitivity: "quiet" });
await go("/voice", `document.body.innerText.length > 50`);
await sleep(800);
recognitions = await ev("window.__recognitions");
check(
  "quiet sensitivity considers one alternative",
  recognitions.length > 0 && recognitions[0].maxAlternatives === 1,
  JSON.stringify(recognitions),
);

await setPrefs({ speechLanguage: "en-NG" });
await go("/books", `document.body.innerText.includes("Testament")`);
const micFound = await ev(
  `(() => { const el = document.querySelector('button[aria-label*="oice" i], button[aria-label*="icrophone" i], button[aria-label*="ictate" i]'); if (!el) return false; el.click(); return true; })()`,
);
await sleep(500);
recognitions = await ev("window.__recognitions");
check(
  "dictation uses the speech language too",
  micFound && recognitions.length > 0 && recognitions[recognitions.length - 1].lang === "en-NG",
  JSON.stringify({ micFound, recognitions }),
);

b.summary();
