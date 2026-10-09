import type { CSSProperties } from "react";

/**
 * A brand mark drawn as a CSS mask rather than an <img>.
 *
 * Simple Icons has no currentColor support through its CDN, so a plain <img>
 * would be baked to one colour and break in the other theme. Masking lets the
 * mark inherit `currentColor` and follow the theme with no second request.
 * (taste-skill Section 4.8: logo walls use real SVG marks, never text wordmarks.)
 */
export function SimpleIcon({
  slug,
  label,
  className,
}: {
  slug: string;
  /** Screen reader label. The mark itself is decorative. */
  label: string;
  className?: string;
}) {
  const url = `https://cdn.simpleicons.org/${slug}/000000`;
  const style: CSSProperties = {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    backgroundColor: "currentColor",
  };

  return (
    <span
      role="img"
      aria-label={label}
      className={className ?? "inline-block h-6 w-6"}
      style={style}
    />
  );
}