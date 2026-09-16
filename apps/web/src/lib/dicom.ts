export type DicomMetadata = {
  patientName?: string;
  patientId?: string;
  studyDate?: string;
  modality?: string;
  seriesDescription?: string;
  orientation?: string;
  pixelSpacing?: string;
  numberOfFrames: number;
  rows: number;
  columns: number;
  bitsAllocated: number;
  pixelRepresentation: number;
  photometricInterpretation: string;
  windowCenter?: number;
  windowWidth?: number;
  rescaleSlope: number;
  rescaleIntercept: number;
};

export type ParsedDicom = {
  metadata: DicomMetadata;
  pixelBytes: Uint8Array;
  littleEndian: boolean;
  frameLength: number;
};

type ElementValue = { tag: string; vr: string; value: Uint8Array; length: number };

const LONG_VALUE_VRS = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"]);

function text(value: Uint8Array): string {
  return new TextDecoder("ascii").decode(value).replace(/\0/g, "").trim();
}

function numberValue(value: Uint8Array, littleEndian: boolean): number | undefined {
  const parsed = Number.parseFloat(text(value).split("\\")[0]);
  if (Number.isFinite(parsed)) return parsed;
  if (value.byteLength >= 2) return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(0, littleEndian);
  return undefined;
}

function tag(group: number, element: number): string {
  return `${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
}

function readElement(bytes: Uint8Array, offset: number, explicitVr: boolean, littleEndian: boolean): ElementValue & { nextOffset: number } {
  if (offset + 8 > bytes.byteLength) throw new Error("DICOM element header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const group = view.getUint16(offset, littleEndian);
  const element = view.getUint16(offset + 2, littleEndian);
  let vr = "UN";
  let lengthOffset = offset + 4;
  let lengthSize = 4;
  if (explicitVr) {
    vr = text(bytes.slice(offset + 4, offset + 6));
    if (!/^[A-Z]{2}$/.test(vr)) throw new Error("DICOM value representation is invalid");
    if (LONG_VALUE_VRS.has(vr)) {
      lengthOffset = offset + 8;
      lengthSize = 6;
    } else {
      lengthOffset = offset + 6;
      lengthSize = 2;
    }
  }
  const length = lengthSize === 6 ? view.getUint32(offset + 8, littleEndian) : view.getUint16(lengthOffset, littleEndian);
  if (length === 0xffffffff) throw new Error("DICOM sequences and undefined-length values are not supported");
  const valueOffset = lengthSize === 6 ? offset + 12 : offset + lengthOffset - offset + lengthSize;
  const end = valueOffset + length;
  if (end > bytes.byteLength) throw new Error("DICOM element value is truncated");
  return { tag: tag(group, element), vr, value: bytes.slice(valueOffset, end), length, nextOffset: end };
}

export function parseDicom(buffer: ArrayBuffer): ParsedDicom {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 132 || text(bytes.slice(128, 132)) !== "DICM") {
    throw new Error("This file does not contain a supported DICOM preamble");
  }
  let offset = 132;
  let transferSyntax = "1.2.840.10008.1.2.1";
  while (offset < bytes.byteLength) {
    const element = readElement(bytes, offset, true, true);
    offset = element.nextOffset;
    if (element.tag === "00020010") transferSyntax = text(element.value);
    if (!element.tag.startsWith("0002")) {
      offset -= element.length + (element.vr && LONG_VALUE_VRS.has(element.vr) ? 12 : 8);
      break;
    }
  }
  const littleEndian = transferSyntax !== "1.2.840.10008.1.2.2";
  const explicitVr = transferSyntax !== "1.2.840.10008.1.2";
  if (!["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"].includes(transferSyntax)) {
    throw new Error("This DICOM transfer syntax is compressed or unsupported");
  }
  const values = new Map<string, ElementValue>();
  let pixelBytes: Uint8Array | undefined;
  while (offset < bytes.byteLength) {
    const element = readElement(bytes, offset, explicitVr, littleEndian);
    offset = element.nextOffset;
    if (element.tag === "7fe00010") {
      pixelBytes = element.value;
      break;
    }
    values.set(element.tag, element);
  }
  if (!pixelBytes) throw new Error("DICOM pixel data is missing");
  const getText = (name: string) => values.get(name) ? text(values.get(name)!.value) : undefined;
  const rows = numberValue(values.get("00280010")?.value ?? new Uint8Array(), littleEndian);
  const columns = numberValue(values.get("00280011")?.value ?? new Uint8Array(), littleEndian);
  const bitsAllocated = numberValue(values.get("00280100")?.value ?? new Uint8Array(), littleEndian);
  if (!rows || !columns || !bitsAllocated || ![8, 16].includes(bitsAllocated)) throw new Error("DICOM dimensions or bit depth are unsupported");
  const samplesPerPixel = numberValue(values.get("00280002")?.value ?? new Uint8Array(), littleEndian) ?? 1;
  if (samplesPerPixel !== 1) throw new Error("Only monochrome DICOM images are supported");
  const numberOfFrames = numberValue(values.get("00280008")?.value ?? new Uint8Array(), littleEndian) ?? 1;
  const pixelRepresentation = numberValue(values.get("00280103")?.value ?? new Uint8Array(), littleEndian) ?? 0;
  const metadata: DicomMetadata = {
    patientName: getText("00100010"),
    patientId: getText("00100020"),
    studyDate: getText("00080020"),
    modality: getText("00080060"),
    seriesDescription: getText("0008103e"),
    orientation: getText("00200037"),
    pixelSpacing: getText("00280030"),
    numberOfFrames,
    rows,
    columns,
    bitsAllocated,
    pixelRepresentation,
    photometricInterpretation: getText("00280004") ?? "MONOCHROME2",
    windowCenter: numberValue(values.get("00281050")?.value ?? new Uint8Array(), littleEndian),
    windowWidth: numberValue(values.get("00281051")?.value ?? new Uint8Array(), littleEndian),
    rescaleSlope: numberValue(values.get("00281053")?.value ?? new Uint8Array(), littleEndian) ?? 1,
    rescaleIntercept: numberValue(values.get("00281052")?.value ?? new Uint8Array(), littleEndian) ?? 0,
  };
  const frameLength = rows * columns * (bitsAllocated / 8);
  if (pixelBytes.byteLength < frameLength * numberOfFrames) throw new Error("DICOM pixel data is incomplete");
  return { metadata, pixelBytes, littleEndian, frameLength };
}

export function renderDicomFrame(parsed: ParsedDicom, frameIndex: number, canvas: HTMLCanvasElement, center: number, width: number): void {
  const { metadata, pixelBytes, littleEndian, frameLength } = parsed;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  canvas.width = metadata.columns;
  canvas.height = metadata.rows;
  const image = ctx.createImageData(metadata.columns, metadata.rows);
  const view = new DataView(pixelBytes.buffer, pixelBytes.byteOffset + frameIndex * frameLength, frameLength);
  const low = center - width / 2;
  const high = center + width / 2;
  for (let index = 0; index < metadata.rows * metadata.columns; index += 1) {
    const raw = metadata.bitsAllocated === 8
      ? view.getUint8(index)
      : metadata.pixelRepresentation === 1
        ? view.getInt16(index * 2, littleEndian)
        : view.getUint16(index * 2, littleEndian);
    const value = raw * metadata.rescaleSlope + metadata.rescaleIntercept;
    let intensity = Math.round(((value - low) / Math.max(1, high - low)) * 255);
    intensity = Math.max(0, Math.min(255, intensity));
    if (metadata.photometricInterpretation === "MONOCHROME1") intensity = 255 - intensity;
    const output = index * 4;
    image.data[output] = intensity;
    image.data[output + 1] = intensity;
    image.data[output + 2] = intensity;
    image.data[output + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
