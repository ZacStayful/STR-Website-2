"use client";

import { useSyncExternalStore } from "react";
import { currentTouchValue, subscribeTracking } from "@/lib/tracking/runtime";

const none = () => "";

/**
 * Sign-up attribution (Batch 19): the ad or link that brought this visitor
 * here, read from the landing address and held in page memory, carried to
 * the sign-up action in one hidden field. Nothing is stored on the device.
 */
export function AttributionFields() {
  const value = useSyncExternalStore(subscribeTracking, currentTouchValue, none);
  return value ? <input type="hidden" name="attr" value={value} /> : null;
}
