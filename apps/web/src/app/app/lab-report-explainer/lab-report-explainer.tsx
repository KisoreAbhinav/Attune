"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 10;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

type Explanation = { summary: string; common_reasons: string[] };
type LabTest = {
  name: string;
  value?: string;
  unit?: string;
  reference_range?: string;
  flag?: string;
  confidence: "high" | "medium" | "low";
  warning?: string;
  source_page?: number;
  explanation?: Explanation;
};
type Analysis = {
  tests: LabTest[];
  warnings: string[];
  questions_for_clinician: string[];
  disclaimer: string;
};

export function validateFile(file: File, pageCount?: number) {
  if (!ACCEPTED_TYPES.has(file.type)) return "Choose a JPG, PNG, or PDF report.";
  if (file.size > MAX_BYTES) return "Report must be 10 MB or smaller.";
  if (pageCount && pageCount > MAX_PAGES) return `PDFs may contain at most ${MAX_PAGES} pages.`;
  return null;
}

async function pdfPageCount(file: File) {
  const source = new TextDecoder("latin1").decode(await file.arrayBuffer());
  // ponytail: common PDFs expose page objects; add pdfjs-dist if compressed PDFs become common.
  return source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function Detail({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <dt className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default function LabReportExplainer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [analysis, setAnalysis] = useState<Analysis>();
  const [status, setStatus] = useState<"idle" | "validating" | "analyzing">("idle");
  const [dragging, setDragging] = useState(false);

  async function chooseFile(next?: File) {
    setError(undefined);
    setAnalysis(undefined);
    if (!next) return setFile(undefined);
    setStatus("validating");
    const pages = next.type === "application/pdf" ? await pdfPageCount(next) : undefined;
    const validationError = validateFile(next, pages);
    setStatus("idle");
    if (validationError) {
      setFile(undefined);
      setError(validationError);
      return;
    }
    setFile(next);
  }

  async function analyze() {
    if (!file) return;
    setStatus("analyzing");
    setError(undefined);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/lab-reports/analyze`,
        { method: "POST", body: form },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail?.message ?? "Report could not be analyzed. Try again.");
      setAnalysis(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Report could not be analyzed. Try again.");
    } finally {
      setStatus("idle");
    }
  }

  function reset() {
    setFile(undefined);
    setAnalysis(undefined);
    setError(undefined);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void chooseFile(event.dataTransfer.files[0]);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-5 py-8 sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top,rgba(120,119,198,0.13),transparent_58%)]" />
      <div className="relative mx-auto max-w-6xl">
        <Button asChild variant="ghost" className="-ml-3 mb-10 text-muted-foreground hover:text-foreground">
          <Link href="/app"><ArrowLeft /> All services</Link>
        </Button>

        <header className="max-w-3xl space-y-5">
          <Badge variant="outline" className="border-violet-400/20 bg-violet-400/10 text-violet-200">
            <Sparkles /> AI-assisted explanation
          </Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Your lab report, in clearer language.</h1>
          <p className="max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Upload a common lab report. Attune extracts visible results and explains flags printed by your lab—without diagnosing you.
          </p>
        </header>

        {!analysis ? (
          <section className="mt-10 grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
            <Card className="border-white/10 bg-card/70 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <CardHeader>
                <CardTitle>Upload report</CardTitle>
                <CardDescription>JPG, PNG, or PDF · 10 MB maximum · up to 10 pages</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`group flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors ${dragging ? "border-violet-400 bg-violet-400/10" : "border-white/15 bg-black/10 hover:border-white/30 hover:bg-white/[0.03]"}`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    className="sr-only"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => void chooseFile(event.target.files?.[0])}
                  />
                  <span className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/5 shadow-inner">
                    {status === "validating" ? <LoaderCircle className="animate-spin text-violet-300" /> : <UploadCloud className="text-violet-300" />}
                  </span>
                  <p className="mt-5 font-medium">Drop your report here</p>
                  <p className="mt-1 text-sm text-muted-foreground">or click to choose a file</p>
                </div>

                {file && (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                    <FileText className="size-5 shrink-0 text-violet-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <CheckCircle2 className="size-5 text-emerald-400" />
                  </div>
                )}

                {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-red-200">{error}</p>}

                {status === "analyzing" && (
                  <div className="space-y-2" aria-live="polite">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 animate-pulse rounded-full bg-violet-400" /></div>
                    <p className="text-center text-sm text-muted-foreground">Reading values and explaining printed flags…</p>
                  </div>
                )}

                <Button className="w-full" size="lg" disabled={!file || status !== "idle"} onClick={analyze}>
                  {status === "analyzing" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                  {status === "analyzing" ? "Analyzing report" : "Explain my report"}
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="border-white/10 bg-card/50">
                <CardHeader><LockKeyhole className="size-5 text-emerald-400" /><CardTitle className="text-base">Private by design</CardTitle></CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">Your document is processed for this request only. Attune does not retain the file or results.</CardContent>
              </Card>
              <Card className="border-white/10 bg-card/50">
                <CardHeader><ShieldCheck className="size-5 text-sky-400" /><CardTitle className="text-base">Educational, not diagnostic</CardTitle></CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">Explanations use only values, ranges, and flags visible on your report. They do not replace clinical advice.</CardContent>
              </Card>
            </div>
          </section>
        ) : (
          <Results analysis={analysis} reset={reset} />
        )}
      </div>
    </main>
  );
}

function Results({ analysis, reset }: { analysis: Analysis; reset: () => void }) {
  const explained = analysis.tests.filter((test) => test.explanation);
  const critical = analysis.tests.some((test) => /critical/i.test(test.flag ?? ""));
  return (
    <section className="mt-10 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><Badge className="bg-emerald-400/15 text-emerald-300">Analysis ready</Badge><h2 className="mt-3 text-3xl font-semibold tracking-tight">Report overview</h2></div>
        <Button variant="outline" onClick={reset}><RefreshCw /> Analyze another</Button>
      </div>

      {(critical || analysis.warnings.length > 0) && (
        <div className={`rounded-xl border p-4 text-sm ${critical ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-amber-400/20 bg-amber-400/10 text-amber-100"}`}>
          {critical ? "This report contains a lab-printed critical flag. Follow prominent instructions on the report and contact a qualified clinician promptly." : analysis.warnings.join(" ")}
        </div>
      )}

      <Card className="overflow-hidden border-white/10 bg-card/70">
        <CardHeader><CardTitle>Extracted results</CardTitle><CardDescription>Check these values against your original report.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {analysis.tests.map((test, index) => (
            <div key={`${test.name}-${index}`} className="rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3"><h3 className="font-medium">{test.name}</h3>{test.flag && <Badge variant="outline">{test.flag}</Badge>}</div>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Detail label="Value" value={[test.value, test.unit].filter(Boolean).join(" ")} />
                <Detail label="Lab range" value={test.reference_range} />
                <Detail label="Confidence" value={test.confidence} />
                <Detail label="Source" value={test.source_page ? `Page ${test.source_page}` : undefined} />
              </dl>
              {test.warning && <p className="mt-3 text-xs leading-5 text-amber-200">{test.warning}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      {explained.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{explained.map((test, index) => (
        <Card key={`${test.name}-explanation-${index}`} className="border-white/10 bg-card/60">
          <CardHeader><div className="flex items-center gap-2"><Badge variant="secondary">{test.flag}</Badge><CardTitle className="text-lg">{test.name}</CardTitle></div><CardDescription>{test.explanation!.summary}</CardDescription></CardHeader>
          {test.explanation!.common_reasons.length > 0 && <CardContent><p className="mb-2 text-sm font-medium">Common, non-exclusive reasons it may vary</p><ul className="space-y-2 text-sm leading-6 text-muted-foreground">{test.explanation!.common_reasons.map((reason) => <li key={reason} className="flex gap-2"><span aria-hidden>·</span>{reason}</li>)}</ul></CardContent>}
        </Card>
      ))}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {analysis.questions_for_clinician.length > 0 && <Card className="border-white/10"><CardHeader><CardTitle className="text-lg">Questions for your clinician</CardTitle></CardHeader><CardContent><ul className="space-y-3 text-sm leading-6 text-muted-foreground">{analysis.questions_for_clinician.map((question) => <li key={question} className="flex gap-3"><span className="text-violet-300">—</span>{question}</li>)}</ul></CardContent></Card>}
        <Card className="border-white/10"><CardHeader><CardTitle className="text-lg">Important limits</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-muted-foreground">{analysis.disclaimer} Confirm extracted values with your original document and discuss concerns with a qualified clinician.</CardContent></Card>
      </div>
    </section>
  );
}
