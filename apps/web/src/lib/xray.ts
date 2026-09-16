import type { ParsedDicom } from "@/lib/dicom";

export type ScanMode = "single_image" | "dicom";

export type IntakeState = {
  age: string;
  gender: string;
  clinicalNotes: string;
  file: File | null;
  attachment: File | null;
  mode: ScanMode;
  dicom: ParsedDicom | null;
};

export type Report = {
  scan_type: "xray";
  view: string;
  patient_age: number;
  date: string;
  status: "complete" | "indeterminate" | "insufficient_image";
  image_reference: "active-session-raster";
  simplified_explanation: string;
  clinical_summary: string;
  clinical_summary_plain_note: string;
  findings: Array<{
    id: string;
    clinical_text: string;
    plain_text: string;
    confidence: number;
    uncertain: boolean;
  }>;
  impression: Array<{
    rank: number;
    clinical_text: string;
    plain_text: string;
    confidence_order: "high" | "moderate" | "low" | "indeterminate";
  }>;
  impression_plain_note: string;
  recommendations: Array<{
    id: string;
    clinical_text: string;
    plain_text: string;
  }>;
  confidence: number;
  uncertainty_note: string;
  model_id: string;
  disclaimer: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ApiInput = {
  age: number;
  gender?: string;
  clinical_notes?: string;
  scan_mode: ScanMode;
  file_name: string;
  file_size: number;
  media_type: string;
  image_base64: string;
  view: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function apiRequest<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "detail" in payload
      ? String(payload.detail)
      : "The request could not be completed.";
    throw new Error(detail);
  }
  return payload as T;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function imageToBase64(canvas: HTMLCanvasElement): Promise<string> {
  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Could not prepare the image for analysis.");
  return dataUrl.slice(comma + 1);
}
