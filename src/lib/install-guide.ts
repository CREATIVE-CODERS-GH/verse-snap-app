/**
 * When to show the iPhone "Add to Home Screen" guide. iOS has no install prompt, so Safari visitors
 * are shown the steps once, when they first open Verse Snap as a website. It never depends on what
 * the person has downloaded, and never appears in a native (App Store / Play Store) build.
 */
const DISMISSED_KEY = "versesnap.install-guide.ios.v1";

export interface InstallEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone (Safari's own flag) */
  standalone: boolean;
  /** matchMedia("(display-mode: standalone)").matches */
  displayModeStandalone: boolean;
  /** Running inside a native app build (see isNativeRuntime), where there is nothing to install. */
  nativeRuntime: boolean;
}

/**
 * True in a native app build. An explicit signal, not device detection: native builds are made with
 * VITE_NATIVE_APP=true, and a Capacitor shell also announces itself at run time. Either one hides
 * the guide, so the web guide can never reach an App Store or Play Store build.
 */
export function isNativeRuntime(): boolean {
  if (import.meta.env["VITE_NATIVE_APP"] === "true") return true;
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/** An iPhone, iPad or iPod (iPadOS 13+ reports itself as a Mac with a touch screen). */
export function isIosDevice({ userAgent, platform, maxTouchPoints }: InstallEnvironment): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/** Safari itself: other iOS browsers and in-app browsers name themselves in the user agent. */
export function isIosSafari(environment: InstallEnvironment): boolean {
  const { userAgent } = environment;
  if (!isIosDevice(environment)) return false;
  if (!/Safari\//.test(userAgent)) return false; // in-app web views leave Safari/ out
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\/|MicroMessenger/.test(
    userAgent,
  );
}

export function isStandalone(environment: InstallEnvironment): boolean {
  return environment.standalone || environment.displayModeStandalone;
}

export function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    /* private mode: the guide may show again next visit, which is harmless */
  }
}

export function shouldShowIosGuide(
  environment: InstallEnvironment,
  options: { dismissed: boolean },
): boolean {
  return (
    !environment.nativeRuntime &&
    !options.dismissed &&
    isIosSafari(environment) &&
    !isStandalone(environment)
  );
}

export function readInstallEnvironment(): InstallEnvironment {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    nativeRuntime: isNativeRuntime(),
  };
}
