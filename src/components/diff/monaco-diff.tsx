"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FileDiff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Columns2, Rows2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-phosphor-green/40">
        Loading Monaco…
      </div>
    ),
  }
);

const PHOSPHOR_THEME = "spok-phosphor";

export type DiffLayout = "unified" | "split";

function defineTheme(monaco: typeof import("monaco-editor")) {
  monaco.editor.defineTheme(PHOSPHOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "1a9940", fontStyle: "italic" },
      { token: "keyword", foreground: "33e0ff" },
      { token: "string", foreground: "ffb000" },
      { token: "number", foreground: "ff33aa" },
      { token: "type", foreground: "33ff66" },
      { token: "delimiter", foreground: "33ff66" },
    ],
    colors: {
      "editor.background": "#080c09",
      "editor.foreground": "#c8f5d4",
      "editor.lineHighlightBackground": "#0e1a12",
      "editor.selectionBackground": "#33ff6633",
      "editorLineNumber.foreground": "#1a9940",
      "editorLineNumber.activeForeground": "#33ff66",
      // Combined (inline) + split decorations — richer greens/reds that read as one stream
      "editorDiff.insertedLineBackground": "#33ff6620",
      "editorDiff.insertedTextBackground": "#33ff6640",
      "editorDiff.removedLineBackground": "#ff445520",
      "editorDiff.removedTextBackground": "#ff445540",
      "diffEditor.insertedTextBackground": "#33ff6635",
      "diffEditor.removedTextBackground": "#ff445535",
      "diffEditor.insertedLineBackground": "#33ff6618",
      "diffEditor.removedLineBackground": "#ff445518",
      "diffEditor.diagonalFill": "#0a120c",
      "diffEditorGutter.insertedLineBackground": "#33ff6628",
      "diffEditorGutter.removedLineBackground": "#ff445528",
      "diffEditorOverview.insertedForeground": "#33ff66aa",
      "diffEditorOverview.removedForeground": "#ff4455aa",
      "scrollbarSlider.background": "#33ff6622",
      "scrollbarSlider.hoverBackground": "#33ff6644",
      "editorGutter.background": "#080c09",
      "editorWidget.background": "#0a100c",
      "editorWidget.border": "#1a994055",
    },
  });
}

export function MonacoDiff({
  file,
  className,
  layout = "unified",
  onLayoutChange,
  showLayoutToggle = true,
  /** 0-based hunk index to reveal in the modified editor. */
  revealHunkIndex,
}: {
  file: FileDiff | null;
  className?: string;
  /** unified = interleaved +/− in one stream (default). split = side-by-side. */
  layout?: DiffLayout;
  onLayoutChange?: (layout: DiffLayout) => void;
  showLayoutToggle?: boolean;
  revealHunkIndex?: number;
}) {
  const [ready, setReady] = useState(false);
  const [internalLayout, setInternalLayout] = useState<DiffLayout>(layout);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneDiffEditor | null>(
    null
  );

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    setInternalLayout(layout);
  }, [layout]);

  const view = onLayoutChange ? layout : internalLayout;
  const setView = (next: DiffLayout) => {
    if (onLayoutChange) onLayoutChange(next);
    else setInternalLayout(next);
  };

  // When layout flips, Monaco needs options updated on the live editor
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.updateOptions({
      renderSideBySide: view === "split",
    });
  }, [view]);

  // Keyboard / hunk-nav: scroll modified pane to the selected hunk
  useEffect(() => {
    if (revealHunkIndex == null || !file) return;
    const hunk = file.hunks[revealHunkIndex];
    if (!hunk) return;
    const ed = editorRef.current;
    if (!ed) return;
    const modified = ed.getModifiedEditor();
    const line = Math.max(1, hunk.newStart || 1);
    modified.revealLineInCenter(line);
    modified.setPosition({ lineNumber: line, column: 1 });
  }, [revealHunkIndex, file]);

  if (!file) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-xs text-phosphor-green/35",
          className
        )}
      >
        Select a file to view the live diff
      </div>
    );
  }

  if (file.isSecret) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-red-400/90",
          className
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-widest">
          Secret path
        </p>
        <p className="max-w-sm text-phosphor-green/45">
          This path matches Spok&apos;s secret deny list. Content is never loaded
          into the diff viewer or export payload.
        </p>
      </div>
    );
  }

  if (file.isBinary) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-phosphor-amber",
          className
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-widest">
          Binary file
        </p>
        <p className="max-w-sm text-phosphor-green/45">
          Binary or oversized content is not previewed. You can still stage or
          discard it from the Git panel.
        </p>
      </div>
    );
  }

  const empty =
    !(file.oldContent || file.newContent) &&
    file.additions === 0 &&
    file.deletions === 0;

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {showLayoutToggle && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-phosphor-green/20 bg-black/75 p-0.5 shadow-[0_0_16px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7",
                  view === "unified" &&
                    "bg-phosphor-green/15 text-phosphor-green"
                )}
                onClick={() => setView("unified")}
                aria-pressed={view === "unified"}
                aria-label="Unified diff"
              >
                <Rows2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Unified — additions and removals in one stream
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7",
                  view === "split" && "bg-phosphor-green/15 text-phosphor-green"
                )}
                onClick={() => setView("split")}
                aria-pressed={view === "split"}
                aria-label="Split diff"
              >
                <Columns2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Split — original left, modified right
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-phosphor-green/40">
            No line content
          </p>
          <p className="max-w-sm text-[11px] text-phosphor-green/35">
            Status is known but full file content was not reconstructed (binary,
            secret, or empty change). Use Git panel for stage/discard.
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "monaco-diff-host min-h-0 flex-1",
            view === "unified" && "monaco-diff-unified"
          )}
        >
          {ready && (
            <DiffEditor
              key={`${file.id}:${file.path}`}
              original={file.oldContent ?? ""}
              modified={file.newContent ?? ""}
              language={file.language}
              theme={PHOSPHOR_THEME}
              loading={
                <div className="flex h-full items-center justify-center text-xs text-phosphor-green/40">
                  Loading editor…
                </div>
              }
              beforeMount={(monaco) => {
                monacoRef.current = monaco;
                defineTheme(monaco);
              }}
              onMount={(editor) => {
                editorRef.current = editor;
                editor.updateOptions({
                  renderSideBySide: view === "split",
                });
              }}
              options={{
                readOnly: true,
                // Unified by default: +/− interleaved in one pane
                renderSideBySide: view === "split",
                enableSplitViewResizing: view === "split",
                renderOverviewRuler: true,
                renderIndicators: true,
                renderMarginRevertIcon: false,
                ignoreTrimWhitespace: false,
                // Collapse long unchanged runs so change hunks stay together
                hideUnchangedRegions: {
                  enabled: true,
                  contextLineCount: 3,
                  minimumLineCount: 6,
                  revealLineCount: 20,
                },
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                lineNumbers: "on",
                glyphMargin: false,
                folding: true,
                automaticLayout: true,
                wordWrap: "off",
                diffWordWrap: "off",
                padding: { top: 12, bottom: 12 },
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                  useShadows: false,
                },
                overviewRulerLanes: 2,
                overviewRulerBorder: false,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Compact +N −M chip for headers / tree rows. */
export function DiffStatChip({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (!additions && !deletions) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border border-phosphor-green/15 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-green/35",
          className
        )}
      >
        ·
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-phosphor-green/20 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow-[inset_0_0_12px_rgba(51,255,102,0.04)]",
        className
      )}
      title={`${additions} addition${additions === 1 ? "" : "s"}, ${deletions} deletion${deletions === 1 ? "" : "s"}`}
    >
      {additions > 0 && (
        <span className="text-phosphor-green">+{additions}</span>
      )}
      {additions > 0 && deletions > 0 && (
        <span className="text-phosphor-green/25" aria-hidden>
          /
        </span>
      )}
      {deletions > 0 && (
        <span className="text-phosphor-red">−{deletions}</span>
      )}
    </span>
  );
}
