"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSpokStore } from "@/lib/store";
import { Keyboard } from "lucide-react";

const GROUPS: { title: string; rows: { keys: string; action: string }[] }[] = [
  {
    title: "Global",
    rows: [
      { keys: "Ctrl+K / ⌘K", action: "Command palette" },
      { keys: "Ctrl+1…5", action: "Workspace / Trace / Diff / Overview / Log" },
      { keys: "?", action: "This keyboard help (when not typing)" },
      { keys: "Esc", action: "Close dialog / drawer / palette" },
    ],
  },
  {
    title: "Workspace",
    rows: [
      { keys: "Ctrl+Enter", action: "Submit prompt (composer focused)" },
      { keys: "↑ / ↓ history", action: "Recall previous prompts in composer" },
      { keys: "/", action: "Slash-command autocomplete in composer" },
      {
        keys: "Paperclip / drop / paste",
        action: "Attach images, PDFs, or documents to the next prompt",
      },
    ],
  },
  {
    title: "Trace",
    rows: [
      { keys: "↑ / ↓", action: "Navigate nodes" },
      { keys: "← / →", action: "Collapse / expand" },
      { keys: "Enter", action: "Open linked file change" },
    ],
  },
  {
    title: "Accessibility",
    rows: [
      { keys: "Tab / Shift+Tab", action: "Move focus" },
      { keys: "Focus rings", action: "Always visible on keyboard focus" },
      { keys: "Skip link", action: "Jump to main content (first Tab)" },
    ],
  },
];

export function KeyboardHelpDialog() {
  const open = useSpokStore((s) => s.keyboardHelpOpen);
  const setOpen = useSpokStore((s) => s.setKeyboardHelpOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
        <div className="border-b border-phosphor-green/15 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-phosphor-cyan" />
              Keyboard shortcuts
            </DialogTitle>
            <DialogDescription>
              Spok is fully operable by keyboard. Focus rings use the active
              theme&apos;s contrast tokens.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="max-h-[min(60vh,480px)] space-y-4 overflow-y-auto px-5 py-4">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-phosphor-green/45">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.rows.map((r) => (
                  <li
                    key={r.keys}
                    className="flex items-start justify-between gap-3 rounded border border-phosphor-green/10 bg-black/20 px-2.5 py-1.5"
                  >
                    <span className="text-[11px] text-phosphor-green/70">
                      {r.action}
                    </span>
                    <kbd className="shrink-0 rounded border border-phosphor-green/25 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-cyan">
                      {r.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
