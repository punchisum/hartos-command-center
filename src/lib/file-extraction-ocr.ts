/**
 * File Extraction / OCR Template
 *
 * Rules (from Ops Agent v2 production lessons):
 *   1. Always prove download before attempting extraction.
 *   2. Always record extractionStatus and extractionMethod honestly.
 *   3. If useful text < MIN_USEFUL_CHARS, mark degraded — do NOT run LLM analysis.
 *   4. OCR attempted/success/failure must be individually recorded.
 *   5. Degraded reason must be human-readable and communicated to the user.
 *   6. Do not claim analysis was done if no useful text was extracted.
 *
 * Ops Agent v2 lesson:
 *   DOCX/TXT/CSV/HTML/text PDF → extract directly.
 *   Scanned/image PDF → attempt OCR → degrade honestly if OCR fails.
 *   Image → vision path → degrade if vision unavailable.
 */

export type ExtractionMethod =
  | "direct_text"
  | "docx"
  | "csv"
  | "html"
  | "text_pdf"
  | "ocr_pdf"
  | "vision"
  | "degraded";

export type ExtractionStatus =
  | "pending"
  | "downloaded"
  | "extraction_attempted"
  | "extraction_success"
  | "ocr_attempted"
  | "ocr_success"
  | "ocr_failed"
  | "degraded"
  | "error";

export interface ExtractionResult {
  /** Proves the file was retrieved before extraction was attempted. */
  downloadProof: boolean;
  /** Proves an extraction attempt was made. */
  extractionProof: boolean;
  status: ExtractionStatus;
  method: ExtractionMethod;
  text: string | null;
  charCount: number;
  ocrAttempted: boolean;
  ocrSuccess: boolean;
  /** Null when analysis is eligible. Set to a human-readable reason when degraded. */
  degradedReason: string | null;
  /** True only when charCount >= MIN_USEFUL_CHARS. LLM analysis is blocked if false. */
  analysisEligible: boolean;
}

/** Minimum character count to qualify for LLM analysis. */
export const MIN_USEFUL_CHARS = 100;

/**
 * Build an honest ExtractionResult from raw extraction inputs.
 * This is the single function that enforces all OCR/degraded rules.
 */
export function buildExtractionResult(params: {
  downloaded: boolean;
  mimeType: string;
  rawText: string | null;
  ocrAttempted: boolean;
  ocrSuccess: boolean;
  ocrText: string | null;
}): ExtractionResult {
  if (!params.downloaded) {
    return {
      downloadProof: false,
      extractionProof: false,
      status: "error",
      method: "degraded",
      text: null,
      charCount: 0,
      ocrAttempted: false,
      ocrSuccess: false,
      degradedReason: "File download failed. Cannot proceed with extraction.",
      analysisEligible: false,
    };
  }

  const effectiveText =
    params.ocrSuccess && params.ocrText ? params.ocrText : params.rawText;
  const charCount = effectiveText?.length ?? 0;

  if (charCount < MIN_USEFUL_CHARS) {
    const reason = buildDegradedReason(charCount, params.ocrAttempted, params.ocrSuccess);
    return {
      downloadProof: true,
      extractionProof: true,
      status: "degraded",
      method: resolveMethod(params.mimeType, params.ocrAttempted, params.ocrSuccess),
      text: effectiveText,
      charCount,
      ocrAttempted: params.ocrAttempted,
      ocrSuccess: params.ocrSuccess,
      degradedReason: reason,
      analysisEligible: false,
    };
  }

  const method = resolveMethod(params.mimeType, params.ocrAttempted, params.ocrSuccess);
  const status = resolveStatus(params.ocrAttempted, params.ocrSuccess);

  return {
    downloadProof: true,
    extractionProof: true,
    status,
    method,
    text: effectiveText,
    charCount,
    ocrAttempted: params.ocrAttempted,
    ocrSuccess: params.ocrSuccess,
    degradedReason: null,
    analysisEligible: true,
  };
}

function resolveStatus(ocrAttempted: boolean, ocrSuccess: boolean): ExtractionStatus {
  if (!ocrAttempted) return "extraction_success";
  return ocrSuccess ? "ocr_success" : "ocr_failed";
}

function resolveMethod(
  mimeType: string,
  ocrAttempted: boolean,
  ocrSuccess: boolean
): ExtractionMethod {
  if (ocrAttempted) return ocrSuccess ? "ocr_pdf" : "degraded";
  if (mimeType.includes("wordprocessingml") || mimeType.includes("docx")) return "docx";
  if (mimeType.includes("csv")) return "csv";
  if (mimeType.includes("html")) return "html";
  if (mimeType.includes("pdf")) return "text_pdf";
  return "direct_text";
}

function buildDegradedReason(
  charCount: number,
  ocrAttempted: boolean,
  ocrSuccess: boolean
): string {
  if (charCount === 0) {
    if (ocrAttempted && !ocrSuccess) {
      return "OCR attempted but failed. No text could be extracted. File may be an image PDF without legible content.";
    }
    return "No text extracted. File may be a scanned image or contain only images.";
  }
  return (
    `Only ${charCount} characters extracted — below the ${MIN_USEFUL_CHARS} character threshold for analysis. ` +
    (ocrAttempted ? "OCR was attempted." : "Direct extraction was used.")
  );
}

/**
 * Summarize extraction result for storage in Supabase or a debug event.
 */
export function extractionSummary(result: ExtractionResult): Record<string, unknown> {
  return {
    download_proof: result.downloadProof,
    extraction_proof: result.extractionProof,
    extraction_status: result.status,
    extraction_method: result.method,
    char_count: result.charCount,
    ocr_attempted: result.ocrAttempted,
    ocr_success: result.ocrSuccess,
    degraded_reason: result.degradedReason,
    analysis_eligible: result.analysisEligible,
  };
}
