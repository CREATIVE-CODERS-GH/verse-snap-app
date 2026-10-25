// Shared helpers for the browser tests in scripts/e2e: a headless Chrome or Edge driven over the
// DevTools protocol (no extra dependencies; Node 22 provides fetch and WebSocket).
//
// Settings (environment variables):
//   E2E_BASE     app URL                     default http://127.0.0.1:8091 (start `npm run dev -- --port 8091`)
//   E2E_BROWSER  Chrome/Edge executable      default: detected
//   E2E_OUT      folder for screenshots      default: a temp folder (nothing is written to the repo)
//   E2E_PORT     DevTools port               default 9871
//
// The browser profile is a fresh temp folder, deleted afterwards, so runs never share storage.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BASE = (process.env.E2E_BASE ?? "http://127.0.0.1:8091").replace(/\/$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export { sleep };

function findBrowser() {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
          ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("No Chrome or Edge found. Set E2E_BROWSER to its executable.");
  return found;
}

/** Fails fast with a clear message when the app isn't running. */
export async function assertAppRunning() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(15000) });
  } catch {
    console.error(`The app isn't reachable at ${BASE}. Start it with: npm run dev -- --port 8091`);
    process.exit(2);
  }
}

/**
 * Opens a headless browser on a blank page.
 * `init` is script run before every page loads; `args` are extra browser flags.
 */
export async function openBrowser({ init = "", args = [], timeoutMs = 300000 } = {}) {
  await assertAppRunning();
  const port = Number(process.env.E2E_PORT ?? 9871);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "versesnap-e2e-profile-"));
  const out = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "versesnap-e2e-out-"));
  fs.mkdirSync(out, { recursive: true });

  const proc = spawn(
    findBrowser(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      ...args,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const finish = (code) => {
    try {
      if (process.platform === "win32")
        execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
      else proc.kill("SIGKILL");
    } catch {
      /* already closed */
    }
    setTimeout(() => {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the OS may still hold a file; it's in the temp folder */
      }
      process.exit(code);
    }, 500);
  };
  // A crash in a test still closes the browser and reports failure.
  const crash = (error) => {
    console.log(`FAIL  test stopped: ${error?.message ?? error}`);
    finish(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  const timer = setTimeout(() => {
    console.log("TIMEOUT");
    finish(2);
  }, timeoutMs);
  timer.unref?.();

  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === "page");
    } catch {
      /* browser still starting */
    }
    if (!target) await sleep(500);
  }
  if (!target) {
    console.error("The browser didn't start.");
    finish(2);
    return new Promise(() => {});
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  // dialogs: messages of confirm/alert dialogs; acceptDialogs: how the next ones are answered.
  const state = { errors: [], dialogs: [], acceptDialogs: true };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, handler) => listeners.set(method, handler);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    const params = message.params;
    if (message.method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      state.errors.push(
        "exception: " + (details.exception?.description ?? details.text).slice(0, 200),
      );
    }
    if (message.method === "Runtime.consoleAPICalled" && params.type === "error") {
      state.errors.push(
        "console.error: " +
          params.args
            .map((arg) => arg.value ?? arg.description ?? "")
            .join(" ")
            .slice(0, 240),
      );
    }
    if (message.method === "Page.javascriptDialogOpening") {
      state.dialogs.push(params.message);
      send("Page.handleJavaScriptDialog", { accept: state.acceptDialogs }).catch(() => {});
    }
    listeners.get(message.method)?.(params);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem('versesnap.onboarding.v1', 'complete'); } catch {}\n${init}`,
  });

  const ev = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    return result.result.value;
  };
  const waitFor = async (expression, ms = 25000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      try {
        if (await ev(expression)) return true;
      } catch {
        /* page navigating */
      }
      await sleep(200);
    }
    return false;
  };
  const go = async (route, ready = "document.body && document.body.innerText.length > 40") => {
    state.errors = [];
    await send("Page.navigate", { url: BASE + route });
    await sleep(300);
    await waitFor("document.readyState === 'complete'");
    await waitFor(ready);
    await sleep(700);
  };
  const viewport = (width, height) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });
  const shot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(out, name), Buffer.from(result.data, "base64"));
  };
  /** A real pointer tap at the element's centre (Radix menus open on pointer events). */
  const tap = async (selector) => {
    const point = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    if (!point) return false;
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    await sleep(300);
    return true;
  };
  /** Clicks the first button or link whose visible text matches. */
  const clickText = (pattern, scope = "body") =>
    ev(`(() => {
      const re = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)});
      const el = [...document.querySelector(${JSON.stringify(scope)})?.querySelectorAll('button, a') ?? []]
        .find((node) => re.test(node.innerText.trim()));
      if (!el) return false;
      el.click();
      return true;
    })()`);
  const toasts = () =>
    ev("[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.trim())");

  let passed = 0;
  let failed = 0;
  const check = (name, ok, detail = "") => {
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
  };
  const summary = () => {
    console.log(`\n${passed} passed, ${failed} failed  (screenshots: ${out})`);
    finish(failed ? 1 : 0);
  };

  return {
    send,
    on,
    ev,
    waitFor,
    go,
    viewport,
    shot,
    tap,
    clickText,
    toasts,
    check,
    summary,
    finish,
    state,
    sleep,
  };
}

/** Reads one public setting (never printed) from the environment or the local env files. */
export function readPublicEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const line = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .find((row) => row.startsWith(`${name}=`));
      if (line)
        return line
          .slice(name.length + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
    } catch {
      /* file absent */
    }
  }
  return undefined;
}
