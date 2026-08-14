import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, Excalidraw, restore } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import "./viewer.css";

import { compileAsync } from "../src/pipeline.ts";
import { synchronizeEndpointLabels } from "../src/routing/labels.ts";
import { resolveAssets } from "../src/io/assets.ts";
import { parseSource } from "../src/language/parser.ts";

const browserFilesystem = {
  async readBinary(path: string) {
    throw new Error(`browser acceptance cannot read local asset: ${path}`);
  },
};

function Viewer() {
  const source = new URLSearchParams(location.search).get("source") ?? 'a: card "XDraw"';
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ready, setReady] = useState(false);
  const [scene, setScene] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    resolveAssets(parseSource(source), browserFilesystem)
      .then(async (document) => {
        if (!active) return;
        const compiled = (await compileAsync(document)).toJSON();
        if (!active) return;
        (window as typeof window & { __xdrawCompiled?: unknown }).__xdrawCompiled = structuredClone(compiled);
        setScene(restore({
          elements: compiled.elements as any,
          appState: compiled.appState as any,
          files: compiled.files as any,
        }, null, null, { refreshDimensions: false, repairBindings: true }));
      })
      .catch((caught) => { if (active) setError((caught as Error).message); });
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    if (!api || !scene) return;
    const timer = window.setTimeout(() => {
      api.scrollToContent(scene.elements, {
        fitToViewport: true,
        viewportZoomFactor: 0.92,
        canvasOffsets: { top: 80, right: 20, bottom: 24, left: 20 },
      });
      window.setTimeout(() => setReady(true), 350);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [api, scene]);

  const download = () => {
    if (!api) return;
    const payload = {
      type: "excalidraw",
      version: 2,
      source: "xdraw",
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "acceptance.excalidraw";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <main>
    <header><strong>XDraw</strong><span>{ready ? "Editable diagram" : "Rendering diagram"}</span><button onClick={download}>Download</button></header>
    {error && <div className="error">{error}</div>}
    <section className="canvas">
      {scene && <Excalidraw
        excalidrawAPI={setApi}
        initialData={scene}
        onChange={(elements) => {
          if (!api) return;
          const synchronized = synchronizeEndpointLabels([...elements]);
          if (synchronized.changed) {
            api.updateScene({
              elements: synchronized.elements as any,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }}
        zenModeEnabled
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Viewer />);
