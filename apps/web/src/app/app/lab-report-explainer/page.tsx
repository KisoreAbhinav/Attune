import type { Metadata } from "next";
import LabReportExplainer from "./lab-report-explainer";

export const metadata: Metadata = {
  title: "Lab Report Explainer | Attune",
  description: "Understand lab-reported flags in plain language without storing your report.",
};

export default function LabReportExplainerPage() {
  return <LabReportExplainer />;
}
