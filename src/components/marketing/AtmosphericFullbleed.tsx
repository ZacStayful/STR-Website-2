import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { hasImage, type Img } from "@/lib/images";
import type { ReactNode } from "react";

// B7 — Atmospheric full-bleed photo section.
// Breaks out of the container with width: 100vw and renders a cinematic
// ultra-wide photograph behind centred copy. Used above final CTAs.
export function AtmosphericFullbleed({
  image,
  children,
}: {
  image: Img;
  children: ReactNode;
}) {
  return (
    <section className="sf-atmosphere">
      <div className="sf-atmosphere__photo">
        {hasImage(image) ? (
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes="100vw"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <Placeholder
            width={image.width}
            height={image.height}
            label="Atmospheric full-bleed · UK property at golden hour"
            rounded={false}
          />
        )}
        <span className="sf-atmosphere__veil" aria-hidden />
      </div>
      <div className="sf-atmosphere__copy">{children}</div>
    </section>
  );
}
