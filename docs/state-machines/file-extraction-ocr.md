# State Machine: File Extraction / OCR Workflow

A file is downloaded, text is extracted using the appropriate method, and LLM analysis is only attempted when sufficient text is proven.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `received` | Cloudflare | File reference received; record row created |
| `download_attempted` | Trigger | Download request sent |
| `downloaded` | Trigger | File bytes confirmed; `download_proof = true` |
| `download_failed` | Trigger | Download failed; record status = error |
| `extraction_attempted` | Trigger | Extraction started; method determined from MIME |
| `extraction_success` | Trigger | Text extracted; char count above threshold |
| `extraction_degraded` | Trigger | Text below threshold; `analysis_eligible = false` |
| `ocr_required` | Trigger | Text PDF but no text layer; OCR needed |
| `ocr_attempted` | Trigger | OCR job triggered |
| `ocr_success` | Trigger | OCR text above threshold; `analysis_eligible = true` |
| `ocr_failed` | Trigger | OCR returned no useful text; status = degraded |
| `analysis_eligible` | Trigger | Gate: char count >= MIN_USEFUL_CHARS |
| `analysis_running` | Trigger | LLM analysis in progress |
| `analysis_done` | Trigger | LLM result committed to Supabase |
| `degraded` | Trigger | Honest degraded result stored; user notified |
| `error` | Trigger | Unrecoverable failure |

---

## Transitions

```
received → download_attempted

download_attempted
  → [bytes received] → downloaded
  → [network/auth failure] → download_failed → error

downloaded → extraction_attempted

extraction_attempted
  [mimeType = docx/txt/csv/html]
  → [text extracted] → check char_count
    → [>= MIN_USEFUL_CHARS] → extraction_success → analysis_eligible → analysis_running
    → [< MIN_USEFUL_CHARS]  → extraction_degraded → degraded

  [mimeType = text PDF]
  → [text layer present, chars extracted]
    → check char_count → (as above)
  → [no text layer]
    → ocr_required → ocr_attempted
      → [OCR text >= MIN_USEFUL_CHARS] → ocr_success → analysis_eligible → analysis_running
      → [OCR text < MIN_USEFUL_CHARS]  → ocr_failed → degraded

  [mimeType = image]
  → [vision path available] → extraction_attempted (vision)
  → [vision unavailable]    → degraded

analysis_running
  → [LLM result received] → analysis_done → FINAL
degraded → FINAL (honest, no LLM called)
```

---

## Final State Proof

A file extraction workflow is **done** only when ALL of the following are true:

- [ ] File record has a terminal status: `analysis_done` OR `degraded` OR `error`
- [ ] `download_proof = true` OR `download_failed` explicitly recorded
- [ ] `extraction_status` is set and matches what actually happened
- [ ] `extraction_method` is recorded (never null on completion)
- [ ] `char_count` is recorded
- [ ] IF `char_count < MIN_USEFUL_CHARS`: `analysis_eligible = false`, no LLM row created
- [ ] IF degraded: `degraded_reason` is set and human-readable
- [ ] User received honest outcome message (success OR degraded — never silent)
- [ ] `debug_events` row with correct `outcome` and `trace_id`

**MUST NOT:** Create an LLM analysis row if `analysis_eligible = false`.

---

## Extraction Method Decision Table

| File Type | Has Text Layer | OCR Available | Method | Analysis Eligible |
|-----------|---------------|---------------|--------|-------------------|
| DOCX | — | — | `docx` | if chars >= threshold |
| TXT / CSV / HTML | — | — | `direct_text` | if chars >= threshold |
| Text PDF | Yes | — | `text_pdf` | if chars >= threshold |
| Scanned PDF | No | Yes | `ocr_pdf` | if OCR chars >= threshold |
| Scanned PDF | No | No | `degraded` | false |
| Image | — | Yes (vision) | `vision` | if chars >= threshold |
| Image | — | No | `degraded` | false |

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| Download URL expired | `download_failed` | Re-fetch URL and retry download |
| DOCX parse error | `error` | Log; mark file as error |
| OCR service timeout | `ocr_failed` | Mark degraded; do NOT retry silently |
| LLM timeout | `analysis_running` (stuck) | Retry with same idempotency key; no re-extraction |
| File too large | `error` | Reject at Cloudflare; do not enqueue |
