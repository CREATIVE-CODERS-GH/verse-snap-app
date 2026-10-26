/** Device voices: listing them and resolving the one the person picked. No React, no side effects. */

export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

export interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
}

/** English voices first (Scripture is read in English), then everything else, each A to Z. */
export function listVoices(voices: readonly VoiceLike[]): VoiceOption[] {
  const english = (voice: VoiceLike) => voice.lang.toLowerCase().startsWith("en");
  return [...voices]
    .sort((a, b) => {
      const rank = Number(!english(a)) - Number(!english(b));
      return rank || a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang);
    })
    .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang }));
}

/**
 * The saved voice, if this device still has it. An empty or unknown value means "Automatic", so a
 * voice that disappeared (a different phone, an uninstalled voice) never breaks reading aloud.
 */
export function resolveVoice<T extends VoiceLike>(
  voices: readonly T[],
  voiceURI: string,
): T | null {
  if (!voiceURI) return null;
  return voices.find((voice) => voice.voiceURI === voiceURI) ?? null;
}

/** "Samantha (en-US)": what the picker shows for one voice. */
export function voiceLabel(option: VoiceOption): string {
  return `${option.name} (${option.lang})`;
}
