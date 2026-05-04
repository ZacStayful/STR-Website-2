import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { IMG, hasImage } from "@/lib/images";

// B2 — Long-let vs short-let split panel.
// Single property photograph with two ribbons across it: muted "Long-let"
// and confident green "Short-let peak". The split visualises the question
// without ever putting a number on the user's specific property.
export function LongVsShortSplit() {
  const img = IMG.propertySplit;
  return (
    <div className="sf-split">
      <div className="sf-split__photo">
        {hasImage(img) ? (
          <Image
            src={img.src}
            alt={img.alt}
            width={img.width}
            height={img.height}
            sizes="(max-width: 1100px) 100vw, 980px"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <Placeholder width={img.width} height={img.height} label="Single UK property · long-let vs short-let" />
        )}
        <span className="sf-split__overlay" aria-hidden />
      </div>

      <div className="sf-split__ribbons">
        <div className="sf-split__ribbon sf-split__ribbon--muted">
          <span className="sf-split__lede">Long-let</span>
          <span className="sf-split__num">~£X,XXX / month</span>
          <span className="sf-split__sub">Steady, lower ceiling</span>
        </div>
        <div className="sf-split__delta" aria-hidden>
          <svg viewBox="0 0 32 32" width="32" height="32">
            <path
              d="M8 16h12M14 10l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="sf-split__ribbon sf-split__ribbon--brand">
          <span className="sf-split__lede">Short-let peak</span>
          <span className="sf-split__num">See your number</span>
          <span className="sf-split__sub">Higher ceiling, more variable</span>
        </div>
      </div>
    </div>
  );
}
