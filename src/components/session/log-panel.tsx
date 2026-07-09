"use client";

import { useEffect, useRef } from "react";
import { useSpokStore } from "@/lib/store";

export function LogPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (session?.config.autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [session?.rawLog.length, session?.config.autoScroll]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-phosphor-green crt-glow">
          Raw Log
        </h2>
      </div>
      <div className="flex-1 overflow-auto bg-black/50 p-3 font-mono text-[11px] leading-relaxed">
        {!session || session.rawLog.length === 0 ? (
          <div className="text-phosphor-green/35">No log output captured</div>
        ) : (
          session.rawLog.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all text-phosphor-green/75">
              <span className="mr-2 select-none text-phosphor-green/25">
                {String(i + 1).padStart(4, " ")}
              </span>
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
