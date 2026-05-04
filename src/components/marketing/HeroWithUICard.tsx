import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { UICard } from "./UICard";
import { hasImage, type Img } from "@/lib/images";
import type { ReactNode } from "react";

// A1 — Homepage hero.
// Composes a full-width property photograph with a floating UI card on the
// top-right, plus a headline + CTA stack on the left.
export function HeroWithUICard({
  image,
  cardVariant = "peak-estimate-loading",
  children,
}: {
  image: Img;
  cardVariant?: "peak-estimate-loading" | "comparable-listings" | "seasonality-mini" | "profit-calc-mini";
  children: ReactNode;
}) {
  return (
    <section className="sf-hero">
      <div className="sf-hero__copy">{children}</div>
      <div className="sf-hero__visual" aria-hidden={false}>
        <div className="sf-hero__photo">
          {hasImage(image) ? (
            <Image
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              preload
              sizes="(max-width: 900px) 100vw, 60vw"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <Placeholder
              width={image.width}
              height={image.height}
              label="Hero · property + UI overlay"
              rounded={true}
            />
          )}
          <span className="sf-hero__photo-overlay" aria-hidden />
        </div>
        <div className="sf-hero__ui">
          <UICard variant={cardVariant} />
        </div>
      </div>
    </section>
  );
}
