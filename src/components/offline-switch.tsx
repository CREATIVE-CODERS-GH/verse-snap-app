import { PILL_OUTLINE } from "@/components/search-states";
import { canDownloadOffline } from "@/lib/bible/offline-download";
import { useOfflineDownloads } from "@/lib/bible/use-offline-downloads";

/**
 * Shown under a "Connection problem" when the selected translation can't be read offline but another
 * one has been downloaded: says so, and offers to read the same passage in the downloaded one.
 * Renders nothing when no other translation is downloaded.
 */
export function OfflineSwitch({
  current,
  onSwitch,
}: {
  current: string;
  onSwitch: (code: string) => void;
}) {
  const offline = useOfflineDownloads();
  const others = offline.downloaded.filter((code) => code !== current);
  if (others.length === 0) return null;
  return (
    <div
      className="mt-4 flex w-full max-w-[260px] flex-col items-stretch gap-2"
      role="group"
      aria-label="Read offline"
    >
      <p className="text-center text-[13px] leading-relaxed text-brand-text-muted">
        {canDownloadOffline(current)
          ? `${current} isn’t downloaded on this device.`
          : `${current} isn’t available offline.`}{" "}
        {others.join(" and ")} {others.length === 1 ? "is" : "are"} downloaded and can be read
        without a connection.
      </p>
      {others.map((code) => (
        <button key={code} type="button" className={PILL_OUTLINE} onClick={() => onSwitch(code)}>
          Read in {code}
        </button>
      ))}
    </div>
  );
}
