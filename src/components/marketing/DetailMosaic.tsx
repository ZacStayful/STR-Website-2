import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { IMG, hasImage, type Img } from "@/lib/images";

// B8 — Architectural close-ups, scattered between sections.
// Six quiet square photographs in a deliberately offset grid. Acts as
// section break / visual pause without making product claims.
type Tile = { image: Img; offsetY: number; rotate: number };

const TILES: Tile[] = [
  { image: IMG.details.coffee, offsetY: 0, rotate: -1.5 },
  { image: IMG.details.keys, offsetY: 24, rotate: 1.0 },
  { image: IMG.details.plant, offsetY: -16, rotate: -0.8 },
  { image: IMG.details.stairwell, offsetY: 40, rotate: 1.5 },
  { image: IMG.details.vinyl, offsetY: 12, rotate: -1.2 },
  { image: IMG.details.aga, offsetY: -8, rotate: 0.6 },
];

const LABELS = ["Coffee · windowsill", "Keys", "Plant on a shelf", "Stairwell", "Vinyl & player", "Country kitchen"];

export function DetailMosaic() {
  return (
    <div className="sf-mosaic">
      {TILES.map((tile, i) => (
        <div
          key={i}
          className="sf-mosaic__tile"
          style={{
            transform: `translateY(${tile.offsetY}px) rotate(${tile.rotate}deg)`,
          }}
        >
          {hasImage(tile.image) ? (
            <Image
              src={tile.image.src}
              alt={tile.image.alt}
              width={tile.image.width}
              height={tile.image.height}
              sizes="(max-width: 720px) 50vw, 16vw"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <Placeholder width={tile.image.width} height={tile.image.height} label={LABELS[i]} />
          )}
        </div>
      ))}
    </div>
  );
}
