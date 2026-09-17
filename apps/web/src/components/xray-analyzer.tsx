"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes, type PointerEvent } from "react";
import { ArrowLeft, Check, Download, FileImage, LoaderCircle, MessageCircle, Move, RefreshCw, Ruler, ScanLine, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDicom, renderDicomFrame } from "@/lib/dicom";
import { demoResults } from "@/lib/demo-results";
import { demoScans } from "@/lib/demo-scans";
import { apiRequest, fileToBase64, imageToBase64, type ApiInput, type ChatMessage, type IntakeState, type Report, type ScanMode } from "@/lib/xray";

type Point = { x: number; y: number };
type Tool = "pan" | "measure" | "annotate";
type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & { webkitdirectory?: string; directory?: string };

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

const initialState: IntakeState = {
  age: "",
  gender: "",
  clinicalNotes: "",
  file: null,
  attachment: null,
  mode: "single_image",
  dicom: null,
};

function fileError(file: File, mode: ScanMode): string | null {
  if (file.size === 0) return "This file is empty. Choose a file that contains image data.";
  if (file.size > MAX_FILE_BYTES) return "Files must be 20 MB or smaller for this prototype.";
  if (mode === "single_image" && !ACCEPTED_IMAGE_TYPES.has(file.type) && !ACCEPTED_IMAGE_EXTENSIONS.test(file.name)) {
    return "Choose a PNG, JPEG, or WebP image for Single Image mode.";
  }
  if (mode === "dicom" && !file.name.toLowerCase().endsWith(".dcm") && file.type !== "application/dicom") {
    return "Choose a DICOM file with a .dcm extension or application/dicom type.";
  }
  return null;
}

function statusCopy(status: Report["status"]): string {
  if (status === "indeterminate") return "Indeterminate model output";
  if (status === "insufficient_image") return "Image quality insufficient";
  return "Model report ready";
}

export function XrayAnalyzer() {
  const [state, setState] = useState<IntakeState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [windowCenter, setWindowCenter] = useState(40);
  const [windowWidth, setWindowWidth] = useState(400);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("pan");
  const [crosshair, setCrosshair] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [annotations, setAnnotations] = useState<Array<Point & { label: string }>>([]);
  const [annotationLabel, setAnnotationLabel] = useState("Review");
  const [sampleId, setSampleId] = useState("");
  const selectionVersion = useRef(0);
  const selectedSample = demoScans["x-ray"].find((sample) => sample.id === sampleId);
  const sampleResult = selectedSample ? demoResults["x-ray"][selectedSample.id] : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const previewUrl = useMemo(
    () => state.file && state.mode === "single_image" ? URL.createObjectURL(state.file) : null,
    [state.file, state.mode],
  );

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.dicom) return;
    renderDicomFrame(state.dicom, currentFrame, canvas, windowCenter, windowWidth);
  }, [state.dicom, currentFrame, windowCenter, windowWidth]);

  function chooseMode(mode: ScanMode) {
    selectionVersion.current += 1;
    setSampleId("");
    setState({ ...initialState, mode });
    setReport(null);
    setHistory([]);
    setError(null);
    setNotice(null);
    setMeasurePoints([]);
    setAnnotations([]);
    setCurrentFrame(0);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    selectionVersion.current += 1;
    setSampleId("");
    setHistory([]);
    const validationError = fileError(file, state.mode);
    setError(validationError);
    setNotice(null);
    setReport(null);
    if (validationError) {
      setState((current) => ({ ...current, file: null, dicom: null }));
      return;
    }
    if (state.mode === "dicom") {
      try {
        const parsed = parseDicom(await file.arrayBuffer());
        setState((current) => ({ ...current, file, dicom: parsed }));
        setCurrentFrame(0);
        setWindowCenter(parsed.metadata.windowCenter ?? 40);
        setWindowWidth(parsed.metadata.windowWidth ?? 400);
        setNotice(`Parsed ${parsed.metadata.numberOfFrames} DICOM frame${parsed.metadata.numberOfFrames === 1 ? "" : "s"} locally. The file has not been uploaded.`);
      } catch (parseError) {
        setState((current) => ({ ...current, file: null, dicom: null }));
        setError(parseError instanceof Error ? parseError.message : "This DICOM file could not be parsed.");
      }
      return;
    }
    setState((current) => ({ ...current, file, dicom: null }));
    setNotice("Image selected. It remains in this browser until you explicitly start analysis.");
  }

  async function chooseReferenceSample(id: string) {
    const sample = demoScans["x-ray"].find((item) => item.id === id);
    if (!sample) return;
    const version = ++selectionVersion.current;
    setSampleId(id);
    setState((current) => ({ ...current, file: null, dicom: null }));
    setHistory([]);
    setError(null);
    setReport(null);
    setNotice(null);
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error("The selected reference image could not be loaded.");
      const blob = await response.blob();
      const extension = sample.path.split(".").pop() ?? "jpg";
      if (version !== selectionVersion.current) return;
      const file = new File([blob], `attune-${sample.id}.${extension}`, { type: blob.type });
      const validationError = fileError(file, "single_image");
      if (validationError) throw new Error(validationError);
      setState((current) => ({ ...current, file, dicom: null }));
      setNotice(`${sample.label}: ${sample.title}. This source-labelled reference image is for testing and education only.`);
    } catch (sampleError) {
      if (version !== selectionVersion.current) return;
      setSampleId("");
      setError(sampleError instanceof Error ? sampleError.message : "The selected reference image could not be loaded.");
    }
  }

  function pointerPoint(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function handleViewerPointerDown(event: PointerEvent<HTMLDivElement>) {
    const point = pointerPoint(event);
    if (tool === "measure") {
      setMeasurePoints((current) => current.length === 2 ? [point] : [...current, point]);
      return;
    }
    if (tool === "annotate") {
      setAnnotations((current) => [...current, { ...point, label: annotationLabel || "Review" }]);
      return;
    }
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewerPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || tool !== "pan") return;
    setPan({
      x: dragRef.current.panX + (event.clientX - dragRef.current.x),
      y: dragRef.current.panY + (event.clientY - dragRef.current.y),
    });
  }

  function resetViewer() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCurrentFrame(0);
    setMeasurePoints([]);
    setAnnotations([]);
  }

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!state.file) {
      setError("Choose an image or DICOM file before analysis.");
      return;
    }
    const age = Number(state.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      setError("Age must be a whole number from 0 to 120.");
      return;
    }
    if (state.mode === "dicom" && !state.dicom) {
      setError("The DICOM file must parse successfully before analysis.");
      return;
    }
    const version = selectionVersion.current;
    setBusy(true);
    try {
      let imageBase64: string;
      if (state.mode === "dicom") {
        if (!canvasRef.current) throw new Error("DICOM canvas is unavailable.");
        imageBase64 = await imageToBase64(canvasRef.current);
      } else {
        imageBase64 = await fileToBase64(state.file);
      }
      const input: ApiInput = {
        age,
        gender: state.gender || undefined,
        clinical_notes: state.clinicalNotes || undefined,
        scan_mode: state.mode,
        file_name: state.file.name,
        file_size: state.file.size,
        media_type: state.mode === "dicom" ? "image/png" : state.file.type || "application/octet-stream",
        image_base64: imageBase64,
        scan_type: "xray",
        view: "frontal",
      };
      const result = await apiRequest<Report>("/api/scan/analyze", input);
      if (version !== selectionVersion.current) return;
      setReport(result);
      setHistory([]);
      setNotice("Processing completed for this active-session analysis. It is not a diagnosis.");
    } catch (analysisError) {
      if (version !== selectionVersion.current) return;
      setError(analysisError instanceof Error ? analysisError.message : "Analysis failed. Check the local API and model configuration.");
    } finally {
      setBusy(false);
    }
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !question.trim()) return;
    const asked = question.trim();
    setQuestion("");
    setChatBusy(true);
    setError(null);
    try {
      const response = await apiRequest<{ answer: string; confidence: string; grounded_in_report: boolean; model_id: string }>("/api/chat", {
        report,
        history,
        question: asked,
      });
      setHistory((current) => [...current, { role: "user", content: asked }, { role: "assistant", content: response.answer }]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat is unavailable. Check the local chat model.");
      setQuestion(asked);
    } finally {
      setChatBusy(false);
    }
  }

  async function exportPdf() {
    if (!report) return;
    setError(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!response.ok) throw new Error("The PDF could not be generated by the local API.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "attune-xray-report.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "PDF export failed.");
    }
  }

  const directoryInputProps: DirectoryInputProps = { webkitdirectory: "", directory: "" };
  const frameCount = state.dicom?.metadata.numberOfFrames ?? 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost"><Link href="/app"><ArrowLeft /> All services</Link></Button>
        <Badge variant="outline"><ScanLine /> Processing workflow</Badge>
      </div>
      <header className="max-w-3xl space-y-3">
        <Badge variant="secondary">X-ray Analyzer · Prototype</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Review an X-ray</h1>
        <p className="text-muted-foreground">Parse an image or DICOM study in your browser, inspect the active session, and request a structured educational review through FastAPI.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="space-y-6" aria-label="Scan intake">
          <Card>
            <CardHeader>
              <CardTitle>1. Scan intake</CardTitle>
              <CardDescription>Choose one workflow. Files and metadata stay in memory for this active browser session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Scan mode">
                {(["single_image", "dicom"] as const).map((mode) => (
                  <button key={mode} type="button" role="radio" aria-checked={state.mode === mode} onClick={() => chooseMode(mode)} className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${state.mode === mode ? "border-foreground bg-muted" : "border-border hover:bg-muted/60"}`}>
                    <span className="flex items-center gap-2 font-medium">{mode === "single_image" ? <FileImage /> : <ScanLine />}{mode === "single_image" ? "Single Image" : "DICOM File"}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{mode === "single_image" ? "PNG, JPEG, or WebP" : "Parse a local .dcm study"}</span>
                  </button>
                ))}
              </div>
              {state.mode === "single_image" && <div className="space-y-2"><label htmlFor="xray-reference" className="text-sm font-medium">Reference collection</label><Select value={sampleId} onValueChange={(value) => void chooseReferenceSample(value)}><SelectTrigger id="xray-reference" className="w-full"><SelectValue placeholder="Choose a normal or abnormal X-ray" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Normal · 4 scans</SelectLabel>{demoScans["x-ray"].filter((sample) => sample.label === "Normal reference").map((sample) => <SelectItem key={sample.id} value={sample.id}>{sample.title}</SelectItem>)}</SelectGroup><SelectGroup><SelectLabel>Abnormal · 4 scans</SelectLabel>{demoScans["x-ray"].filter((sample) => sample.label === "Abnormal reference").map((sample) => <SelectItem key={sample.id} value={sample.id}>{sample.title}</SelectItem>)}</SelectGroup></SelectContent></Select><p className="text-xs text-muted-foreground">Select a preset to view its image and instant sample report. Live analysis runs only when requested.</p></div>}
              <div className="space-y-2">
                <label htmlFor="scan-file" className="text-sm font-medium">{state.mode === "dicom" ? "DICOM file or folder" : "X-ray image"}</label>
                <input id="scan-file" type="file" accept={state.mode === "dicom" ? ".dcm,application/dicom" : "image/png,image/jpeg,image/webp"} multiple={state.mode === "dicom"} {...(state.mode === "dicom" ? directoryInputProps : {})} onChange={(event) => { setSampleId(""); void handleFile(event.target.files?.[0]); }} className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" aria-describedby="file-help" />
                <p id="file-help" className="text-xs text-muted-foreground">Maximum 20 MB. DICOM parsing is client-side; unsupported compressed transfer syntaxes are rejected.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm font-medium">Age <input required min="0" max="120" step="1" type="number" value={state.age} onChange={(event) => setState((current) => ({ ...current, age: event.target.value }))} className="mt-1 block h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" /></label>
                <label className="space-y-2 text-sm font-medium">Gender <input value={state.gender} onChange={(event) => setState((current) => ({ ...current, gender: event.target.value }))} className="mt-1 block h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" placeholder="Optional" /></label>
              </div>
              <label className="block space-y-2 text-sm font-medium">Additional clinical notes <textarea maxLength={4000} value={state.clinicalNotes} onChange={(event) => setState((current) => ({ ...current, clinicalNotes: event.target.value }))} className="mt-1 block min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Optional context for the local analysis request" /></label>
              <label className="block space-y-2 text-sm font-medium">Additional medical attachment <input type="file" accept="image/*,.pdf" onChange={(event) => setState((current) => ({ ...current, attachment: event.target.files?.[0] ?? null }))} className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" /><span className="block text-xs font-normal text-muted-foreground">Optional and held locally; it is not sent in this prototype analysis request.</span></label>
            </CardContent>
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{state.file ? `Selected: ${state.file.name}` : "No scan selected"}{state.attachment ? " · Attachment ready" : ""}</span>
              <Button type="button" onClick={() => { selectionVersion.current += 1; setSampleId(""); setState(initialState); setReport(null); setHistory([]); setError(null); setNotice(null); }} variant="ghost"><RefreshCw /> Reset</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Viewer</CardTitle>
              <CardDescription>Controls below operate on the active raster or the locally parsed DICOM frame.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2" aria-label="Viewer tools">
                <Button type="button" size="sm" variant={tool === "pan" ? "secondary" : "outline"} onClick={() => setTool("pan")}><Move /> Pan</Button>
                <Button type="button" size="sm" variant={tool === "measure" ? "secondary" : "outline"} onClick={() => { setTool("measure"); setMeasurePoints([]); }}><Ruler /> Measure</Button>
                <Button type="button" size="sm" variant={tool === "annotate" ? "secondary" : "outline"} onClick={() => setTool("annotate")}>Annotate</Button>
                <Button type="button" size="sm" variant={crosshair ? "secondary" : "outline"} onClick={() => setCrosshair((current) => !current)}>Crosshair</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setZoom((current) => Math.min(3, current + 0.25))}><ZoomIn /> Zoom</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}><ZoomOut /> Out</Button>
                <Button type="button" size="sm" variant="ghost" onClick={resetViewer}>Reset view</Button>
              </div>
              {state.dicom && <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2"><label className="text-xs font-medium">Window center <input aria-label="Window center" type="range" min="-1000" max="2000" value={windowCenter} onChange={(event) => setWindowCenter(Number(event.target.value))} className="block w-full" /><output>{windowCenter}</output></label><label className="text-xs font-medium">Window width <input aria-label="Window width" type="range" min="1" max="4000" value={windowWidth} onChange={(event) => setWindowWidth(Number(event.target.value))} className="block w-full" /><output>{windowWidth}</output></label></div>}
              {state.dicom && frameCount > 1 && <label className="block text-xs font-medium">Slice {currentFrame + 1} of {frameCount}<input aria-label="DICOM slice" type="range" min="0" max={frameCount - 1} value={currentFrame} onChange={(event) => setCurrentFrame(Number(event.target.value))} className="block w-full" /></label>}
              {tool === "annotate" && <label className="block text-xs font-medium">Annotation label<input value={annotationLabel} onChange={(event) => setAnnotationLabel(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" /></label>}
              <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border bg-black sm:min-h-[440px]" onPointerDown={handleViewerPointerDown} onPointerMove={handleViewerPointerMove} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                {!state.file && <div className="max-w-xs px-6 text-center text-sm text-zinc-400">Select a scan to open the viewer.</div>}
                {state.file && state.mode === "single_image" && previewUrl && <Image src={previewUrl} alt="Selected X-ray preview" fill unoptimized sizes="(min-width: 1024px) 55vw, 100vw" className="object-contain" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} draggable={false} />}
                {state.dicom && <div className="relative" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><canvas ref={canvasRef} className="max-h-[70vh] max-w-full object-contain" aria-label="Rendered DICOM image" /><span className="absolute left-2 top-2 text-xs font-semibold text-white">R</span><span className="absolute right-2 top-2 text-xs font-semibold text-white">L</span><span className="absolute bottom-2 left-2 text-xs font-semibold text-white">SUP</span><span className="absolute bottom-2 right-2 text-xs font-semibold text-white">INF</span>{crosshair && <><span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-cyan-300/80" /><span className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-cyan-300/80" /></>}{annotations.map((item, index) => <span key={`${item.label}-${index}`} className="absolute rounded bg-cyan-300 px-1 text-[10px] font-semibold text-black" style={{ left: `${item.x}%`, top: `${item.y}%` }}>{item.label}</span>)}{measurePoints.length === 2 && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={measurePoints[0].x} y1={measurePoints[0].y} x2={measurePoints[1].x} y2={measurePoints[1].y} stroke="#67e8f9" strokeWidth="0.7" /><text x={measurePoints[1].x} y={measurePoints[1].y} fill="#67e8f9" fontSize="4">measurement</text></svg>}</div>}
              </div>
              {state.dicom && <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span>Modality: {state.dicom.metadata.modality ?? "DICOM"}</span><span>Dimensions: {state.dicom.metadata.columns} × {state.dicom.metadata.rows}</span><span>Frames: {state.dicom.metadata.numberOfFrames}</span></div>}
              {state.dicom && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-medium">DICOM metadata</p><dl className="mt-2 grid gap-1 sm:grid-cols-2"><div><dt className="text-muted-foreground">Patient</dt><dd>{state.dicom.metadata.patientName ?? "Not provided"}</dd></div><div><dt className="text-muted-foreground">Study date</dt><dd>{state.dicom.metadata.studyDate ?? "Not provided"}</dd></div><div><dt className="text-muted-foreground">Series</dt><dd>{state.dicom.metadata.seriesDescription ?? "Not provided"}</dd></div><div><dt className="text-muted-foreground">Orientation</dt><dd>{state.dicom.metadata.orientation ?? "Not provided"}</dd></div></dl></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>3. Analyze</CardTitle><CardDescription>The selected raster is sent only after this action through the FastAPI endpoint.</CardDescription></CardHeader>
              <CardContent><form onSubmit={(event) => void runAnalysis(event)}><Button type="submit" disabled={busy || !state.file} className="w-full sm:w-auto">{busy ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" /> Processing…</> : <><ScanLine /> Analyze active scan</>}</Button></form></CardContent>
          </Card>
        </section>

        <section className="space-y-6" aria-label="Analysis report">
          {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          {notice && <div role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{notice}</div>}
          {sampleResult && selectedSample && !report && <Card data-testid="sample-report">
        <CardHeader>
          <Badge variant="secondary" className="w-fit">Sample report · instant preview</Badge>
          <CardTitle>{selectedSample.title}</CardTitle>
          <CardDescription>Prewritten educational example. No AI analysis was run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div><h3 className="font-medium">Simplified explanation</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{sampleResult.summary}</p></div>
          <div><h3 className="font-medium">Reference findings</h3><div className="mt-3 space-y-3">{sampleResult.findings.map((finding) => <div key={finding.clinical} className="rounded-lg border p-4 text-sm"><p className="font-medium">{finding.clinical}</p><p className="mt-2 leading-6 text-muted-foreground">{finding.explanation}</p></div>)}</div></div>
          <div><h3 className="font-medium">Impression</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{sampleResult.impression}</p></div>
          <div><h3 className="font-medium">Next steps</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Explore another preset or run live analysis to request a new model review. Real scans need review by a qualified clinician.</p></div>
          <a href={selectedSample.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex text-sm underline underline-offset-4">Image source and context</a>
        </CardContent>
      </Card>}
          {!report && !sampleResult && <Card><CardHeader><CardTitle>Structured report</CardTitle><CardDescription>After a successful local inference request, the report, uncertainty, chat history, and PDF payload live only in this page.</CardDescription></CardHeader><CardContent><div className="flex items-center gap-3 rounded-lg border border-dashed p-5 text-sm text-muted-foreground"><MessageCircle /> Report sections will appear here.</div></CardContent></Card>}
          {report && <>
            <Card>
              <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge variant={report.status === "complete" ? "secondary" : "destructive"}>{statusCopy(report.status)}</Badge><CardTitle className="mt-3">X-ray analysis report</CardTitle><CardDescription>{report.date} · age {report.patient_age}</CardDescription></div><Button type="button" variant="outline" onClick={() => void exportPdf()}><Download /> Export PDF</Button></div></CardHeader>
              <CardContent className="space-y-5"><div className="rounded-lg border bg-muted/30 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plain-language explanation</p><p className="mt-2 text-sm">{report.simplified_explanation}</p></div><div><h2 className="font-medium">Clinical summary</h2><p className="mt-2 text-sm text-muted-foreground">{report.clinical_summary}</p><p className="mt-2 text-sm">{report.clinical_summary_plain_note}</p></div><div><h2 className="font-medium">Findings</h2><div className="mt-2 space-y-3">{report.findings.length ? report.findings.map((finding) => <div key={finding.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{finding.clinical_text}</p><span className="text-xs text-muted-foreground">{Math.round(finding.confidence * 100)}%</span></div><p className="mt-1 text-sm text-muted-foreground">{finding.plain_text}</p></div>) : <p className="text-sm text-muted-foreground">No findings crossed the configured threshold.</p>}</div></div><div><h2 className="font-medium">Impression</h2><div className="mt-2 space-y-3">{report.impression.map((item) => <div key={item.rank} className="rounded-lg border p-3"><p className="text-sm font-medium">{item.rank}. {item.clinical_text}</p><p className="mt-1 text-sm text-muted-foreground">{item.plain_text}</p><Badge variant="outline" className="mt-2">{item.confidence_order} confidence order</Badge></div>)}</div><p className="mt-3 text-sm">{report.impression_plain_note}</p></div><div><h2 className="font-medium">Recommendations</h2><div className="mt-2 space-y-2">{report.recommendations.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm"><p>{item.clinical_text}</p><p className="mt-1 text-muted-foreground">{item.plain_text}</p></div>)}</div></div><div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><p className="font-medium">Uncertainty and safety</p><p className="mt-1">{report.uncertainty_note}</p><p className="mt-2 text-muted-foreground">{report.disclaimer}</p></div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Follow-up chat</CardTitle><CardDescription>Questions are sent with this report and the in-memory conversation. The local chat model cannot access other records.</CardDescription></CardHeader>
              <CardContent className="space-y-4"><div className="max-h-72 space-y-3 overflow-auto" aria-live="polite">{history.length === 0 && <p className="text-sm text-muted-foreground">Ask what a finding, impression, or recommendation means.</p>}{history.map((message, index) => <div key={`${message.role}-${index}`} className={`rounded-lg p-3 text-sm ${message.role === "user" ? "ml-6 bg-muted" : "mr-6 border"}`}><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{message.role}</p>{message.content}</div>)}</div><form onSubmit={(event) => void askQuestion(event)} className="flex gap-2"><label htmlFor="chat-question" className="sr-only">Ask a question about the report</label><input id="chat-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} placeholder="Ask about this report" className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm" /><Button type="submit" disabled={chatBusy || !question.trim()}>{chatBusy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Check />} Ask</Button></form></CardContent>
            </Card>
          </>}
        </section>
      </div>
    </main>
  );
}
