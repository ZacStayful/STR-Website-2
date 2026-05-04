import Image from "next/image";
import { Placeholder } from "./Placeholder";
import { IMG, hasImage, type Img } from "@/lib/images";

// B1 — Property typology grid.
// 6 portrait-oriented photos representing the full UK property mix. Each tile
// is captioned with the property type so the grid reads "we cover anything".
type Tile = { image: Img; type: string; caption: string };

const TILES: Tile[] = [
  {
    image: IMG.property.cityFlat,
    type: "City flat",
    caption: "Manchester · 2 bed",
  },
  {
    image: IMG.property.terraced,
    type: "Terraced house",
    caption: "Yorkshire · 3 bed",
  },
  {
    image: IMG.property.semi,
    type: "Semi-detached",
    caption: "Suburban · 4 bed",
  },
  {
    image: IMG.property.cottage,
    type: "Country cottage",
    caption: "Cotswolds · 2 bed",
  },
  {
    image: IMG.property.coastal,
    type: "Coastal stay",
    caption: "Cornwall · 3 bed",
  },
  {
    image: IMG.property.period,
    type: "Period flat",
    caption: "Edinburgh · 1 bed",
  },
];

export function PropertyTypeGrid() {
  return (
    <div className="sf-typegrid">
      {TILES.map((tile) => (
        <article key={tile.type} className="sf-typegrid__tile">
          <div className="sf-typegrid__photo">
            {hasImage(tile.image) ? (
              <Image
                src={tile.image.src}
                alt={tile.image.alt}
                width={tile.image.width}
                height={tile.image.height}
                sizes="(max-width: 720px) 50vw, (max-width: 1100px) 33vw, 220px"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <Placeholder width={tile.image.width} height={tile.image.height} label={tile.type} />
            )}
          </div>
          <div className="sf-typegrid__meta">
            <strong>{tile.type}</strong>
            <span>{tile.caption}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
