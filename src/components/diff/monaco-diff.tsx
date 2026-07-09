"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FileDiff } from "@/lib/types";
import { cn } from "@/lib/utils";

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
      "editor.foreground": "#33ff66",
      "editor.lineHighlightBackground": "#0e1a12",
      "editor.selectionBackground": "#33ff6633",
      "editorLineNumber.foreground": "#1a9940",
      "editorLineNumber.activeForeground": "#33ff66",
      "editorDiff.insertedLineBackground": "#33ff6618",
      "editorDiff.insertedTextBackground": "#33ff6630",
      "editorDiff.removedLineBackground": "#ff445518",
      "editorDiff.removedTextBackground": "#ff445530",
      "diffEditor.insertedTextBackground": "#33ff6622",
      "diffEditor.removedTextBackground": "#ff445522",
      "diffEditor.insertedLineBackground": "#33ff6614",
      "diffEditor.removedLineBackground": "#ff445514",
      "scrollbarSlider.background": "#33ff6622",
      "scrollbarSlider.hoverBackground": "#33ff6644",
      "editorGutter.background": "#080c09",
    },
  });
}

export function MonacoDiff({
  file,
  className,
}: {
  file: FileDiff | null;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

  useEffect(() => {
    setReady(true);
  }, []);

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
        <p className="font-mono uppercase tracking-widest text-[10px]">Secret path</p>
        <p className="max-w-sm text-phosphor-green/45">
          This path matches Spok&apos;s secret deny list. Content is never loaded into the
          diff viewer or export payload.
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
        <p className="font-mono uppercase tracking-widest text-[10px]">Binary file</p>
        <p className="max-w-sm text-phosphor-green/45">
          Binary or oversized content is not previewed. You can still stage or discard it from
          the Git panel.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("h-full monaco-diff-host", className)}>
      {ready && (
        <DiffEditor
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
          options={{
            readOnly: true,
            renderSideBySide: true,
            enableSplitViewResizing: true,
            renderOverviewRuler: true,
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
            padding: { top: 8 },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      )}
    </div>
  );
}
