import Image from "next/image";
import type { Img } from "@/lib/images";
import type { ReactNode } from "react";

// SoftwareScreenshot — wraps a real screenshot of the Stayful analyser
// in a polished window-chrome frame. Used to show actual product UI on
// marketing pages instead of stylised mockups.
export function SoftwareScreenshot({
  image,
  caption,
  label,
  priority = false,
}: {
  image: Img;
  caption?: ReactNode;
  label?: string;
  priority?: boolean;
}) {
  return (
    <figure className="sf-shot">
      <div className="sf-shot__frame">
        <div className="sf-shot__chrome" aria-hidden>
          <span className="sf-shot__dots">
            <i /> <i /> <i />
          </span>
          <span className="sf-shot__url">stayful.co.uk · live analyser</span>
          {label ? <span className="sf-shot__tag">{label}</span> : null}
        </div>
        <div className="sf-shot__body">
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes="(max-width: 1100px) 100vw, 1024px"
            preload={priority || undefined}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </div>
      {caption ? <figcaption className="sf-shot__caption">{caption}</figcaption> : null}
    </figure>
  );
}
