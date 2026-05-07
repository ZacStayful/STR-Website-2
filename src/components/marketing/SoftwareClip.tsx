import type { ReactNode } from "react";

type Clip = { src: string; poster: string; label: string };

// SoftwareClip — short, muted, looping MP4 clips of the live Stayful
// analyser in motion. Used where motion teaches more than a still
// (e.g. the address-to-result reveal, customising profit calculator,
// the forecast revealing month-by-month).
export function SoftwareClip({
  clip,
  caption,
}: {
  clip: Clip;
  caption?: ReactNode;
}) {
  return (
    <figure className="sf-clip">
      <div className="sf-clip__frame">
        <div className="sf-shot__chrome" aria-hidden>
          <span className="sf-shot__dots">
            <i /> <i /> <i />
          </span>
          <span className="sf-shot__url">{clip.label}</span>
        </div>
        <video
          className="sf-clip__video"
          src={clip.src}
          poster={clip.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
      </div>
      {caption ? <figcaption className="sf-shot__caption">{caption}</figcaption> : null}
    </figure>
  );
}
