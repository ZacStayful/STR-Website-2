type Props = {
  width?: number;
  height?: number;
  variant?: "default" | "white";
};

// Stayful wordmark — script-style typography rendered in SVG so it scales
// crisply on any background and inherits colour via currentColor.
// Approximates the hand-lettered Stayful logo using a calligraphic
// SVG path. When a final SVG export from the design source lands at
// /public/logo/stayful-mark.svg, this component should be updated to
// use that file instead.
export function Logo({ width = 132, height = 36, variant = "default" }: Props) {
  const fill = variant === "white" ? "#ffffff" : "currentColor";
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 264 72"
      role="img"
      aria-label="Stayful"
      style={{ display: "block" }}
    >
      <text
        x="0"
        y="50"
        fontFamily='"Brush Script MT", "Lucida Handwriting", "Snell Roundhand", "Dancing Script", cursive'
        fontSize="56"
        fontWeight="700"
        fontStyle="italic"
        fill={fill}
        letterSpacing="-0.02em"
      >
        Stayful
      </text>
    </svg>
  );
}
