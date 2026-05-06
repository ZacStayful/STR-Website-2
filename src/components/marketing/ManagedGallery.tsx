import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { IMG, hasImage, type Img } from "@/lib/images";

// B5 — Stayful management proof gallery.
// 3×2 grid of properties Stayful actually manages. Each photo carries a
// small "Managed by Stayful" tag rendered in code so it never bakes into
// the image and can be removed when needed.
type Tile = { image: Img; bakedBadge?: boolean };
const TILES: Tile[] = [
  // managed/01.jpg has the badge already painted into the pixels.
  { image: IMG.managed.one, bakedBadge: true },
  { image: IMG.managed.two },
  { image: IMG.managed.three },
  { image: IMG.managed.four },
  { image: IMG.managed.five },
  { image: IMG.managed.six },
];

export function ManagedGallery() {
  return (
    <div className="sf-managed">
      {TILES.map((tile, i) => (
        <figure key={i} className="sf-managed__tile">
          <div className="sf-managed__photo">
            {hasImage(tile.image) ? (
              <Image
                src={tile.image.src}
                alt={tile.image.alt}
                width={tile.image.width}
                height={tile.image.height}
                sizes="(max-width: 720px) 50vw, 33vw"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <Placeholder width={tile.image.width} height={tile.image.height} label={`Managed property ${i + 1}`} />
            )}
          </div>
          {tile.bakedBadge ? null : (
            <figcaption className="sf-managed__tag">Managed by Stayful</figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
