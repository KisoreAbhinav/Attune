import type { DemoScanService } from "./demo-scans";

export type DemoResult = {
  summary: string;
  findings: { clinical: string; explanation: string }[];
  impression: string;
};

// Authored educational examples, not saved model output or clinical readings.
// Keys match the bundled image catalogue; no patient details or confidence
// scores are invented. Each view links the corresponding image source.
const normal = (region: string): DemoResult => ({
  summary: `This ${region} image is included in the normal-reference collection. The example demonstrates how a report explains a reference scan; it does not establish that every structure is normal.`,
  findings: [
    { clinical: "Catalogue classification: normal reference.", explanation: "This is the collection label, not a new AI finding." },
    { clinical: "Single reference image; no complete study or clinical history supplied.", explanation: "One image cannot exclude every condition or replace review of the full scan." },
  ],
  impression: "Normal-reference teaching example. No patient-specific diagnostic conclusion is provided.",
});

const example = (topic: string, explanation: string, limitation: string): DemoResult => ({
  summary: `This preset introduces ${topic.toLowerCase()}. ${explanation}`,
  findings: [
    { clinical: `Reference topic: ${topic}.`, explanation },
    { clinical: "Extent and severity are not assessed in this sample report.", explanation: limitation },
  ],
  impression: `${topic} teaching example, based on the preset's catalogue description. This is a written example, not a fresh interpretation of the image.`,
});

export const demoResults: Record<DemoScanService, Record<string, DemoResult>> = {
  "x-ray": {
    "normal-1": normal("chest X-ray"),
    "normal-2": normal("chest X-ray"),
    "normal-3": normal("PA chest X-ray"),
    "normal-4": normal("chest anatomy"),
    "abnormal-1": example("Pneumonia", "A pneumonia report discusses lung opacity in the context of possible infection.", "The location, cause, and severity of an opacity require image review and clinical context."),
    "abnormal-2": example("Pulmonary infiltrate", "An infiltrate describes an area of increased lung opacity. The term alone does not establish its cause.", "This preset is catalogued as a pneumonia example; no new infection diagnosis is made here."),
    "abnormal-3": example("Lung mass", "A report about a lung mass describes an abnormal focal area and explains what remains uncertain.", "An X-ray example cannot establish the tissue type or confirm cancer."),
    "abnormal-4": example("Pneumothorax", "Pneumothorax means air in the space between the lung and chest wall.", "The amount of air, effects on the lung, and clinical urgency are not assessed by this example."),
  },
  "brain-mri": {
    "normal-1": normal("axial T2 brain MRI"),
    "normal-2": normal("T2 brain MRI"),
    "normal-3": normal("sagittal brain MRI"),
    "normal-4": normal("head MRI"),
    "abnormal-1": example("Brain tumour", "A brain tumour report discusses a lesion and its relationship to surrounding structures.", "Tumour type, size, and effects on nearby tissue cannot be inferred from this preset label."),
    "abnormal-2": example("SCA comparison", "This catalogue entry presents an MRI comparison associated with spinocerebellar ataxia.", "The comparison is educational; it does not establish a diagnosis or subtype in a new patient."),
    "abnormal-3": example("Brain metastasis", "Metastasis refers to cancer that has spread from another site. This is the topic assigned to the reference image.", "Lesion number, origin, and extent require the full study and clinical history."),
    "abnormal-4": example("Brain metastasis", "This second metastasis reference illustrates another image in the same teaching category.", "These presets are not a before-and-after comparison and do not show treatment response."),
  },
  "knee-mri": {
    "normal-1": normal("sagittal T1 knee MRI"),
    "normal-2": normal("knee MRI"),
    "normal-3": normal("coronal knee MRI"),
    "normal-4": normal("knee MRI"),
    "abnormal-1": example("Abnormal right knee", "The catalogue identifies this as an abnormal knee reference without assigning a specific finding.", "A specific ligament, cartilage, or meniscal diagnosis is intentionally not invented for this entry."),
    "abnormal-2": example("Medial meniscal tear", "The medial meniscus is cartilage on the inner side of the knee. This preset is labelled as a tear example.", "Tear grade, stability, and treatment implications are not assessed by this sample."),
    "abnormal-3": example("Baker cyst", "A Baker cyst is a fluid-filled swelling behind the knee.", "The size, associated joint findings, and cause require review of the complete study."),
    "abnormal-4": example("Osteochondritis dissecans", "This reference concerns a condition involving bone beneath joint cartilage and the overlying cartilage.", "Lesion stability and extent are not determined by this sample report."),
  },
};
