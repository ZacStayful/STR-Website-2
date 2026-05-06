import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { IMG, hasImage } from "@/lib/images";

// A2 — Comparables map embed.
// Renders the stylised aerial sage-toned map showing the central property
// pin + surrounding comparable listings. Used on the homepage and on
// /income-calculator to make the "live nearby comparables" claim visual.
export function ComparablesMap({ caption }: { caption?: string }) {
  const img = IMG.comparablesMap;
  return (
    <div className="sf-mapblock">
      <div className="sf-mapblock__photo">
        {hasImage(img) ? (
          <Image
            src={img.src}
            alt={img.alt}
            width={img.width}
            height={img.height}
            sizes="(max-width: 1100px) 100vw, 880px"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <Placeholder width={img.width} height={img.height} label="Comparables · map view" />
        )}
        <span className="sf-mapblock__badge">8 listings · 0.5 mi radius</span>
      </div>
      {caption ? <p className="sf-mapblock__caption">{caption}</p> : null}
    </div>
  );
}
