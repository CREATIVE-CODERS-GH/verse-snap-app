import { translationAttribution } from "@/lib/bible/translations";

/**
 * The copyright and permission line a licensed edition (NIV, AMP) must show with its text, with a
 * link to the publisher. Renders nothing for every other translation.
 */
export function PublisherNotice({
  translation,
  className = "mt-6 text-xs leading-relaxed text-brand-text-muted",
}: {
  translation: string;
  className?: string;
}) {
  const attribution = translationAttribution(translation);
  if (!attribution) return null;
  return (
    <p data-testid="publisher-notice" className={className}>
      {attribution.notice}{" "}
      <a
        href={attribution.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2 hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
      >
        {attribution.linkLabel}
      </a>
    </p>
  );
}
