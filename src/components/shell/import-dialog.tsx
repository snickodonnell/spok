"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSpokStore } from "@/lib/store";
import { parseBulkText } from "@/lib/parser";
import { parseUnifiedDiff } from "@/lib/diff-utils";
import { playEvents } from "@/lib/playback";
import { SAMPLES } from "@/lib/samples";
import type { ExportPayload, Session } from "@/lib/types";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export function ImportDialog() {
  const open = useSpokStore((s) => s.importOpen);
  const setOpen = useSpokStore((s) => s.setImportOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const importSession = useSpokStore((s) => s.importSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const applyStreamEvents = useSpokStore((s) => s.applyStreamEvents);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);
  const upsertFileDiff = useSpokStore((s) => s.upsertFileDiff);

  const [paste, setPaste] = useState("");
  const [diffPaste, setDiffPaste] = useState("");
  const [livePlayback, setLivePlayback] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFromPaste = () => {
    if (!paste.trim()) {
      toast.error("Paste some trace text or NDJSON first");
      return;
    }
    const events = parseBulkText(paste);
    if (events.length === 0) {
      toast.error("Could not parse any events");
      return;
    }
    const id = createSession({
      name: `Import ${new Date().toLocaleTimeString()}`,
      source: "paste",
      status: livePlayback ? "running" : "completed",
    });
    setOpen(false);
    if (livePlayback) {
      playEvents(
        events,
        (ev) => {
          applyStreamEvent(id, ev);
          if (ev.content) appendRawLog(id, ev.content.slice(0, 300));
        },
        {
          speed: 2,
          onComplete: () => {
            updateSession(id, { status: "completed" });
            toast.success(`Imported ${events.length} events`);
          },
        }
      );
    } else {
      applyStreamEvents(id, events);
      for (const ev of events) {
        if (ev.content) appendRawLog(id, ev.content.slice(0, 300));
      }
      updateSession(id, { status: "completed" });
      toast.success(`Imported ${events.length} events`);
    }
  };

  const loadDiff = () => {
    if (!diffPaste.trim()) {
      toast.error("Paste a unified diff first");
      return;
    }
    const files = parseUnifiedDiff(diffPaste);
    if (files.length === 0) {
      toast.error("No file diffs parsed");
      return;
    }
    const id = createSession({
      name: `Diff import ${new Date().toLocaleTimeString()}`,
      source: "import",
      status: "completed",
    });
    for (const f of files) {
      upsertFileDiff(id, f);
      applyStreamEvent(id, {
        type: "file_change",
        timestamp: Date.now(),
        path: f.path,
        title: `File: ${f.path}`,
        content: `${f.status} ${f.path}`,
        oldContent: f.oldContent,
        newContent: f.newContent,
        diffStatus: f.status,
        status: "success",
      });
    }
    setOpen(false);
    toast.success(`Imported ${files.length} file diffs`);
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    try {
      const json = JSON.parse(text) as ExportPayload | Session | { events: unknown[] };
      if ("session" in json && json.session) {
        importSession(json.session as Session);
        toast.success("Session JSON imported");
        setOpen(false);
        return;
      }
      if ("nodes" in json && "files" in json) {
        importSession(json as Session);
        toast.success("Session imported");
        setOpen(false);
        return;
      }
      if ("events" in json && Array.isArray(json.events)) {
        const id = createSession({
          name: file.name,
          source: "import",
          status: "completed",
        });
        applyStreamEvents(id, json.events as never[]);
        updateSession(id, { status: "completed" });
        toast.success("Events imported");
        setOpen(false);
        return;
      }
    } catch {
      // treat as text
    }
    setPaste(text);
    toast.message("Loaded file into paste area — click Import");
  };

  const runSample = (sampleId: string) => {
    const sample = SAMPLES.find((s) => s.meta.id === sampleId);
    if (!sample) return;
    const id = createSession({
      name: sample.meta.name,
      source: "sample",
      status: "running",
    });
    setOpen(false);
    playEvents(
      sample.events,
      (ev) => {
        applyStreamEvent(id, ev);
        if (ev.content) appendRawLog(id, `[${ev.type}] ${ev.content.slice(0, 200)}`);
      },
      {
        speed: 1.5,
        onComplete: () => {
          updateSession(id, { status: "completed" });
          toast.success("Sample complete");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import & Samples</DialogTitle>
          <DialogDescription>
            Load structured JSON, paste agent output, import git diffs, or play a sample session.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="samples">
          <TabsList className="w-full">
            <TabsTrigger value="samples" className="flex-1">
              Samples
            </TabsTrigger>
            <TabsTrigger value="paste" className="flex-1">
              Paste
            </TabsTrigger>
            <TabsTrigger value="diff" className="flex-1">
              Diff
            </TabsTrigger>
            <TabsTrigger value="file" className="flex-1">
              File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="samples" className="space-y-2 pt-2">
            {SAMPLES.map((s) => (
              <button
                key={s.meta.id}
                type="button"
                onClick={() => runSample(s.meta.id)}
                className="flex w-full items-start gap-3 rounded-lg border border-phosphor-green/20 bg-black/40 p-3 text-left transition hover:border-phosphor-green/40 hover:bg-phosphor-green/5"
              >
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-phosphor-amber" />
                <div>
                  <div className="font-mono text-sm text-phosphor-green">
                    {s.meta.name}
                  </div>
                  <div className="mt-0.5 text-xs text-phosphor-green/50">
                    {s.meta.description}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-phosphor-cyan/70">
                    <span>{s.meta.duration}</span>
                    <span>{s.meta.filesChanged} files</span>
                    <span>{s.meta.toolCalls} tools</span>
                    {s.meta.tags.map((t) => (
                      <span key={t} className="text-phosphor-green/40">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </TabsContent>

          <TabsContent value="paste" className="space-y-2 pt-2">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste NDJSON stream events or free-form Grok Build output…"
              className="h-48 w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 p-3 font-mono text-xs text-phosphor-green outline-none focus:border-phosphor-green/50 focus:ring-1 focus:ring-phosphor-green/40"
            />
            <label className="flex items-center gap-2 text-xs text-phosphor-green/60">
              <input
                type="checkbox"
                checked={livePlayback}
                onChange={(e) => setLivePlayback(e.target.checked)}
                className="accent-emerald-500"
              />
              Replay as live stream
            </label>
            <DialogFooter>
              <Button onClick={loadFromPaste}>Import paste</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="diff" className="space-y-2 pt-2">
            <textarea
              value={diffPaste}
              onChange={(e) => setDiffPaste(e.target.value)}
              placeholder="Paste unified diff (git diff output)…"
              className="h-48 w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 p-3 font-mono text-xs text-phosphor-green outline-none focus:border-phosphor-green/50"
            />
            <DialogFooter>
              <Button onClick={loadDiff}>Import diff</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="file" className="space-y-3 pt-2">
            <p className="text-xs text-phosphor-green/50">
              Import a Spok session export JSON, events array, or raw log file.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt,.log,.ndjson"
              className="block w-full text-xs text-phosphor-green/70 file:mr-3 file:rounded file:border file:border-phosphor-green/30 file:bg-phosphor-green/10 file:px-3 file:py-1.5 file:text-phosphor-green"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
