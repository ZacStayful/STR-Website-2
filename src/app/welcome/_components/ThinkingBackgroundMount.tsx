"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";

/**
 * Batch 22, Part D2: the thinking background, loaded after the first question
 * has rendered (never on the server) and inside an error boundary, so if it
 * fails the quiz is exactly what it was.
 */
const ThinkingBackground = dynamic(() => import("./ThinkingBackground"), { ssr: false, loading: () => null });

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[welcome] thinking background off:", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ThinkingBackgroundMount({ strength = 1 }: { strength?: number }) {
  return (
    <Quiet>
      <ThinkingBackground strength={strength} />
    </Quiet>
  );
}
