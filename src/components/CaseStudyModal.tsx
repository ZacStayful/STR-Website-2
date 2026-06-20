"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";

interface CaseStudyModalProps {
  city: string | null;
  pdfUrl: string | null;
  onClose: () => void;
}

export function CaseStudyModal({ city, pdfUrl, onClose }: CaseStudyModalProps) {
  const open = city !== null && pdfUrl !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex h-[90vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-background shadow-xl transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {city} Case Study
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              title={`${city} case study PDF`}
              className="flex-1 w-full border-0"
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
