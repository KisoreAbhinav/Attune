"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Brain, Bone, FileImage, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { demoScans, type DemoScanService } from "@/lib/demo-scans";
import { apiRequest, fileToBase64, type Report } from "@/lib/xray";

type Props = { service: Extract<DemoScanService, "brain-mri" | "knee-mri"> };

export function MriDemo({ service }: Props) {
  const isBrain = service === "brain-mri";
  const Icon = isBrain ? Brain : Bone;
  const serviceName = isBrain ? "Brain MRI" : "Knee MRI";
  const [sampleId, setSampleId] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [age, setAge] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const uploadUrl = useMemo(() => upload ? URL.createObjectURL(upload) : null, [upload]);
  const samples = demoScans[service];
  const selected = samples.find((sample) => sample.id === sampleId);

  useEffect(() => () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); }, [uploadUrl]);

  const preview = uploadUrl ?? selected?.path;

  async function runTest() {
    setError(null);
    const patientAge = Number(age);
    if (!Number.isInteger(patientAge) || patientAge < 0 || patientAge > 120) { setError("Enter an age from 0 to 120."); return; }
    try {
      setBusy(true);
      let file = upload;
      if (!file && selected) {
        const response = await fetch(selected.path);
        const blob = await response.blob();
        file = new File([blob], selected.path.split("/").pop() ?? "reference-scan", { type: blob.type });
      }
      if (!file) { setError("Choose a reference scan or upload an image first."); return; }
      const scanType = isBrain ? "brain_mri" : "knee_mri";
      const result = await apiRequest<Report>("/api/scan/analyze", { age: patientAge, scan_mode: "single_image", file_name: file.name, file_size: file.size, media_type: file.type, image_base64: await fileToBase64(file), scan_type: scanType, view: "unspecified" });
      setReport(result);
    } catch (runError) { setError(runError instanceof Error ? runError.message : "Processing failed."); } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost"><Link href="/app"><ArrowLeft /> All services</Link></Button>
        <Badge variant="outline"><Icon /> {serviceName}</Badge>
      </div>
      <header className="max-w-3xl space-y-3">
        <Badge variant="secondary">Reference scan picker</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Try a {serviceName} scan</h1>
        <p className="text-muted-foreground">Pick one of eight locally bundled reference images—four normal and four abnormal—or upload your own image for review.</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader><CardTitle>Choose a scan</CardTitle><CardDescription>Reference labels come from the linked source and are for interface testing and education only.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2"><label htmlFor="reference-scan" className="text-sm font-medium">Reference collection</label><Select value={sampleId} onValueChange={(value) => { setSampleId(value); setUpload(null); }}><SelectTrigger id="reference-scan" className="w-full"><SelectValue placeholder="Select a reference image" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Normal · 4 scans</SelectLabel>{samples.filter((sample) => sample.label === "Normal reference").map((sample) => <SelectItem key={sample.id} value={sample.id}>{sample.title}</SelectItem>)}</SelectGroup><SelectGroup><SelectLabel>Abnormal · 4 scans</SelectLabel>{samples.filter((sample) => sample.label === "Abnormal reference").map((sample) => <SelectItem key={sample.id} value={sample.id}>{sample.title}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
            <div className="space-y-2"><label htmlFor="mri-upload" className="text-sm font-medium">Or upload an image</label><input id="mri-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setUpload(event.target.files?.[0] ?? null); setSampleId(""); }} className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP up to 20 MB. The upload stays in this browser.</p></div>
            <label className="block space-y-2 text-sm font-medium">Age<input required min="0" max="120" type="number" value={age} onChange={(event) => setAge(event.target.value)} className="block h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" /></label>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><p className="font-medium">Image processing test</p><p className="mt-1 text-muted-foreground">The image is sent only when you run the test. Results are not a diagnosis and require clinician review.</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Preview</CardTitle><CardDescription>{selected ? `${selected.label} · ${selected.title}` : upload ? upload.name : "Select a reference scan or upload an image."}</CardDescription></CardHeader>
          <CardContent>{preview ? <div className="relative h-[430px] overflow-hidden rounded-xl border bg-black"><Image src={preview} alt={selected ? `${selected.title} reference scan` : "Uploaded MRI preview"} fill unoptimized sizes="(min-width: 1024px) 55vw, 100vw" className="object-contain" /></div> : <div className="flex h-[430px] flex-col items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground"><FileImage className="mb-3 size-8" />No scan selected</div>}{selected && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-muted-foreground underline underline-offset-4">View image source and licence</a>}</CardContent>
        </Card>
      </div>
      <Button onClick={() => void runTest()} disabled={busy || !preview}><Upload /> {busy ? "Processing…" : "Run live test"}</Button>
      {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {report && <Card><CardHeader><CardTitle>Processing result</CardTitle><CardDescription>Educational review · not a diagnosis</CardDescription></CardHeader><CardContent className="space-y-4"><p>{report.simplified_explanation}</p><div><p className="font-medium">Possible patterns</p>{report.findings.length ? <ul className="mt-2 space-y-2 text-sm text-muted-foreground">{report.findings.map((finding) => <li key={finding.id}>{finding.plain_text}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No pattern was returned for review.</p>}</div><p className="text-sm text-muted-foreground">{report.uncertainty_note}</p></CardContent></Card>}
    </main>
  );
}
