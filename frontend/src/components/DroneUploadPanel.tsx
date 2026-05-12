"use client";

import { useState, useRef } from "react";

export interface DroneMetrics {
  orthomosaicCid: string;
  chmCid: string;
}

interface DroneUploadPanelProps {
  land: { landId: string };
  onDroneProcessed: (metrics: DroneMetrics) => void;
  onSkipDrone: () => void;
  calculating: boolean;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "selected"; ortho: File | null; chm: File | null }
  | { phase: "uploading" }
  | { phase: "done"; metrics: DroneMetrics }
  | { phase: "error"; message: string };

async function uploadToPinata(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pinataMetadata", JSON.stringify({ name: file.name }));

  const res = await fetch("/api/pinata-upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Pinata upload failed");
  }

  const data = await res.json();
  return data.cid;
}

export default function DroneUploadPanel({
  land,
  onDroneProcessed,
  onSkipDrone,
  calculating,
}: DroneUploadPanelProps) {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [expanded, setExpanded] = useState(false);
  const [showDroneWarning, setShowDroneWarning] = useState(false);
  const orthoRef = useRef<HTMLInputElement>(null);
  const chmRef = useRef<HTMLInputElement>(null);

  const handleOrthoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setState((prev) =>
      prev.phase === "selected"
        ? { ...prev, ortho: file }
        : { phase: "selected", ortho: file, chm: null }
    );
  };

  const handleChmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setState((prev) =>
      prev.phase === "selected"
        ? { ...prev, chm: file }
        : { phase: "selected", ortho: null, chm: file }
    );
  };

  const handleUpload = async () => {
    if (state.phase !== "selected") return;
    const { ortho, chm } = state;

    if (!ortho || !chm) {
      setState({ phase: "error", message: "Please select both orthomosaic and CHM files." });
      return;
    }

    setState({ phase: "uploading" });

    try {
      const [orthomosaicCid, chmCid] = await Promise.all([
        uploadToPinata(ortho),
        uploadToPinata(chm),
      ]);

      const metrics: DroneMetrics = { orthomosaicCid, chmCid };
      setState({ phase: "done", metrics });
    } catch (err: any) {
      setState({ phase: "error", message: err.message });
    }
  };

  const reset = () => {
    setState({ phase: "idle" });
    setExpanded(false);
  };

  // ── Hardcoded OFO dataset CIDs ────────────────────────────────────────────
  const HARDCODED_DRONE_METRICS: DroneMetrics = {
    orthomosaicCid: "bafybeid6cz6oblwon5ou7jhyrw4obcvhrcwnchjueed6omq736ohk4ve34",
    chmCid: "bafybeiblcfcahcqtz4vavuc2bvsh5rqrhqnkpy4yalgag7fkrz2hmymxc4",
  };

  // ── Collapsed pill ────────────────────────────────────────────────────────
  // ── Collapsed pill ────────────────────────────────────────────────────────
  if (!expanded && state.phase === "idle") {
    return (
      <div className="flex flex-col gap-2 w-full">
        {/* Drone required warning — shown when user tries to calculate without drone */}
        {showDroneWarning && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-700 text-xs font-medium px-3 py-2 rounded-lg animate-pulse">
            🚁 Please add drone data first for accurate carbon calculation
          </div>
        )}
        <div className="flex flex-col xs:flex-row gap-2 w-full">
          <button
            onClick={() => setShowDroneWarning(true)}
            disabled={calculating}
            className="flex-1 bg-gray-200 text-gray-500 font-semibold text-sm py-2.5 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm cursor-not-allowed"
          >
            {calculating ? <><span className="animate-spin">⏳</span> Calculating...</> : <>📊 Calculate Credits</>}
          </button>
          <button
            onClick={() => {
              setShowDroneWarning(false);
              setExpanded(true);
            }}
            disabled={calculating}
            className="px-4 py-2.5 text-sm font-semibold text-sky-700 bg-sky-100 border border-sky-300 rounded-lg hover:bg-sky-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm whitespace-nowrap"
            title="Upload drone imagery files"
          >
            🚁 Add Drone Data
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded upload area ──────────────────────────────────────────────────
  return (
    <div className="w-full space-y-2">

      {/* File pickers */}
      {(state.phase === "idle" || state.phase === "selected") && (
        <div className="space-y-2">
          {/* Orthomosaic */}
          <div
            className="border border-dashed border-sky-300 rounded-lg px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-sky-50 transition bg-white"
            onClick={() => orthoRef.current?.click()}
          >
            <span className="text-lg">🗺️</span>
            <div className="flex-1 min-w-0">
              {state.phase === "selected" && state.ortho ? (
                <p className="text-xs text-gray-700 truncate font-medium">
                  ✅ {state.ortho.name}
                </p>
              ) : (
                <p className="text-xs text-gray-600">
                  <span className="text-sky-600 font-semibold">Orthomosaic</span>
                  <span className="text-gray-400"> — GeoTIFF (.tif)</span>
                </p>
              )}
            </div>
            <input
              ref={orthoRef}
              type="file"
              accept=".tif,.tiff"
              className="hidden"
              onChange={handleOrthoChange}
            />
          </div>

          {/* CHM */}
          <div
            className="border border-dashed border-emerald-300 rounded-lg px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-emerald-50 transition bg-white"
            onClick={() => chmRef.current?.click()}
          >
            <span className="text-lg">🌲</span>
            <div className="flex-1 min-w-0">
              {state.phase === "selected" && state.chm ? (
                <p className="text-xs text-gray-700 truncate font-medium">
                  ✅ {state.chm.name}
                </p>
              ) : (
                <p className="text-xs text-gray-600">
                  <span className="text-emerald-600 font-semibold">CHM</span>
                  <span className="text-gray-400"> — Canopy Height Model (.tif)</span>
                </p>
              )}
            </div>
            <input
              ref={chmRef}
              type="file"
              accept=".tif,.tiff"
              className="hidden"
              onChange={handleChmChange}
            />
          </div>

          <button
            onClick={reset}
            className="text-xs text-gray-400 hover:text-gray-600 w-full text-right pr-1"
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {/* Uploading */}
      {state.phase === "uploading" && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 flex items-center gap-3">
          <span className="animate-spin text-sm">⏳</span>
          <p className="text-xs text-sky-800 font-medium">
            Uploading to IPFS…
          </p>
        </div>
      )}

      {/* Done */}
      {state.phase === "done" && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-3">
          <span>✅</span>
          <div className="flex-1 text-xs text-green-800">
            <span className="font-semibold">Files uploaded to IPFS</span>
            <p className="text-green-600 font-mono truncate">{state.metrics.orthomosaicCid}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {state.phase === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-red-700 flex-1">❌ {state.message}</span>
          <button
            onClick={() => setState({ phase: "idle" })}
            className="text-xs text-red-400 hover:text-red-600 underline"
          >
            retry
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {state.phase === "selected" && (
          <button
            onClick={handleUpload}
            disabled={
              state.phase === "selected" && (!state.ortho || !state.chm)
            }
            className="flex-1 bg-sky-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-sky-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ☁️ Upload to IPFS
          </button>
        )}
        {state.phase === "done" && (
          <button
            onClick={() => onDroneProcessed((state as any).metrics)}
            disabled={calculating}
            className="flex-1 bg-green-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-green-700 transition disabled:opacity-50 shadow-sm"
          >
            {calculating ? "⏳ Calculating…" : "📊 Calculate (with drone)"}
          </button>
        )}
        <button
          onClick={onSkipDrone}
          disabled={calculating}
          className={`${state.phase === "done" ? "px-4" : "flex-1"} bg-gray-200 text-gray-700 text-sm font-semibold py-2.5 rounded-lg hover:bg-gray-300 transition disabled:opacity-50 shadow-sm`}
        >
          {state.phase === "done" ? "Skip" : "📊 Satellite only"}
        </button>
      </div>

    </div>
  );
}