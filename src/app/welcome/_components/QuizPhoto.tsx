import Image from "next/image";
import { quizImage, type ImageKey } from "@/lib/profile/images";
import { QuizGraphic } from "./Graphics";

/**
 * The picture on a quiz screen or answer card: the photo from the image set
 * through next/image (sized for a phone-width column), or the built graphic.
 * Decorative: the question is the content.
 */
export function QuizPhoto({ image, priority = false, compact = false }: { image: ImageKey; priority?: boolean; compact?: boolean }) {
  const img = quizImage(image);
  if (img.kind === "graphic") return <QuizGraphic name={img.name} compact={compact} />;
  return (
    <div className={`relative w-full overflow-hidden bg-muted ${compact ? "aspect-[4/3] rounded-xl" : "aspect-[3/2] rounded-2xl"}`}>
      <Image src={img.src} alt="" fill sizes={compact ? "(max-width: 640px) 50vw, 300px" : "(max-width: 640px) 100vw, 640px"} priority={priority} className="object-cover" />
    </div>
  );
}
