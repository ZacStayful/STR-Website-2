"use client";

import type { JARVISState } from "@/types/jarvis";
import { StayfulEye } from "@/components/StayfulEye";

interface JarvisEyeProps {
  state: JARVISState;
  size?: number;
}

/**
 * The analyser narrator's eye. Batch 22: the drawing is StayfulEye's (one
 * eye for the whole site); the narrator variant keeps this eye exactly as it
 * was — the full eye, its own colours per state and its 50px glow.
 */
export function JarvisEye({ state, size = 220 }: JarvisEyeProps) {
  return <StayfulEye variant="narrator" state={state} size={size} level={3} />;
}
