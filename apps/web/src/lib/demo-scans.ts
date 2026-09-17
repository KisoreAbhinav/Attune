export type DemoScanService = "x-ray" | "brain-mri" | "knee-mri";
export type DemoScan = {
  id: string;
  label: "Normal reference" | "Abnormal reference";
  title: string;
  path: string;
  sourceUrl: string;
};

const commons = "https://commons.wikimedia.org/wiki/";

export const demoScans: Record<DemoScanService, DemoScan[]> = {
  "x-ray": [
    ["normal-1", "Normal reference", "Healthy adult chest", "Chest_X-ray_2346.jpg"],
    ["normal-2", "Normal reference", "Chest radiograph", "Chest.PNG"],
    ["normal-3", "Normal reference", "PA chest radiograph", "Chest_Xray_PA_3-8-2010.png"],
    ["normal-4", "Normal reference", "PA chest anatomy", "Chest_X-ray.jpg"],
    ["abnormal-1", "Abnormal reference", "Pneumonia example", "Pneumonia_x_ray.jpg"],
    ["abnormal-2", "Abnormal reference", "Pneumonia example", "03-01-Infiltrat_Ausgang.png"],
    ["abnormal-3", "Abnormal reference", "Lung mass example", "LungCancer-Xray-01.jpg"],
    ["abnormal-4", "Abnormal reference", "Pneumothorax example", "05-Spontanpneumothorax.jpg"],
  ].map(([id, label, title, file]) => ({ id, label: label as DemoScan["label"], title, path: `/demo-scans/xray/${id}.${id === "normal-2" || id === "normal-3" || id === "abnormal-2" ? "png" : "jpg"}`, sourceUrl: `${commons}File:${file}` })),
  "brain-mri": [
    ["normal-1", "Normal reference", "Axial T2 brain", "MRI_T2_Brain_axial_image.jpg"],
    ["normal-2", "Normal reference", "T2 brain", "Brain_MRI_t2_142301.png"],
    ["normal-3", "Normal reference", "Sagittal brain", "Mri_brain_side_view.jpg"],
    ["normal-4", "Normal reference", "Head MRI", "MRI_head_side.jpg"],
    ["abnormal-1", "Abnormal reference", "Brain tumour example", "Brain_Tumor_MRI.jpg"],
    ["abnormal-2", "Abnormal reference", "SCA comparison", "MRI_of_the_patients_with_SCA.webp"],
    ["abnormal-3", "Abnormal reference", "Metastasis example", "Brain_MRI_131444.png"],
    ["abnormal-4", "Abnormal reference", "Metastasis example", "Brain_MRI_131666.png"],
  ].map(([id, label, title, file]) => ({ id, label: label as DemoScan["label"], title, path: `/demo-scans/brain-mri/${id}.${id === "normal-2" || id === "abnormal-3" || id === "abnormal-4" ? "png" : id === "abnormal-2" ? "webp" : "jpg"}`, sourceUrl: `${commons}File:${file}` })),
  "knee-mri": [
    ["normal-1", "Normal reference", "Sagittal T1 knee", "Knee_MRI_T1_TSE_Sagittal.jpg"],
    ["normal-2", "Normal reference", "Knee MRI", "Knee_MRI_113532.png"],
    ["normal-3", "Normal reference", "Coronal knee MRI", "Knee_MRI_121617.png"],
    ["normal-4", "Normal reference", "Knee MRI", "Knie_mr.jpg"],
    ["abnormal-1", "Abnormal reference", "Abnormal right knee", "MRI_knee_abdonrmal.jpg"],
    ["abnormal-2", "Abnormal reference", "Medial meniscal tear", "Proton_density_MRI_of_a_grade_2_medial_meniscal_tear.jpg"],
    ["abnormal-3", "Abnormal reference", "Baker cyst example", "MRT_Bakerzyste.jpg"],
    ["abnormal-4", "Abnormal reference", "Osteochondritis example", "OCD_WalterReed_MRI-Sagital-T1.jpeg"],
  ].map(([id, label, title, file]) => ({ id, label: label as DemoScan["label"], title, path: `/demo-scans/knee-mri/${id}.${id === "normal-2" || id === "normal-3" ? "png" : id === "abnormal-4" ? "jpeg" : "jpg"}`, sourceUrl: `${commons}File:${file}` })),
};
