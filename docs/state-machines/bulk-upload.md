# State Machine: Bulk Upload Workflow

A batch of files is received, each file is processed individually, and a summary is delivered to the user.

---

## States (Batch Level)

| State | Owner | Description |
|-------|-------|-------------|
| `received` | Cloudflare | Upload request received; batch row created |
| `queued` | Cloudflare | Files enqueued for processing |
| `processing` | Trigger | Per-file jobs running |
| `partial` | Trigger | Some files done, some still running or failed |
| `complete` | Trigger | All files processed (some may be degraded) |
| `summary_sent` | Trigger | Summary delivered to user |
| `error` | Trigger | Batch-level failure before any file processed |

## States (Per-File Level)

| State | Owner | Description |
|-------|-------|-------------|
| `pending` | Trigger | File queued; not yet downloaded |
| `downloaded` | Trigger | File bytes confirmed received |
| `extraction_attempted` | Trigger | Extraction started |
| `extraction_success` | Trigger | Text extracted; char count above threshold |
| `ocr_attempted` | Trigger | OCR started (for scanned PDF) |
| `ocr_success` | Trigger | OCR text extracted; char count above threshold |
| `analysis_running` | Trigger | LLM analysis in progress |
| `analysis_done` | Trigger | LLM result stored in Supabase |
| `row_created` | Trigger | Final output row committed |
| `degraded` | Trigger | Insufficient text; no LLM analysis; honest report |
| `error` | Trigger | Download or extraction failed |

---

## Transitions

```
Batch:
received → queued → processing → (partial) → complete → summary_sent

Per file (happy path):
pending → downloaded → extraction_attempted → extraction_success
        → analysis_running → analysis_done → row_created

Per file (scanned PDF):
pending → downloaded → extraction_attempted → ocr_attempted
        → ocr_success → analysis_running → analysis_done → row_created

Per file (degraded):
pending → downloaded → extraction_attempted → ocr_attempted → ocr_failed
        → degraded (NO analysis_running; honest degraded row_created)
```

---

## Final State Proof

A bulk upload is **done** only when ALL of the following are true:

- [ ] Every file has a row in `{{FILE_RECORDS_TABLE}}` with a terminal status
  - Terminal statuses: `row_created`, `degraded`, `error`
- [ ] No file is still in `pending`, `processing`, or `analysis_running`
- [ ] Count of `row_created` + `degraded` + `error` = total files uploaded
- [ ] Degraded files have `degraded_reason` set and `analysis_eligible = false`
- [ ] `batch.status = 'complete'`
- [ ] Summary message delivered to user with per-file outcome
- [ ] `debug_events` row with `outcome=ok` (or `degraded` if some files failed)

---

## Idempotency

Each file in the batch must have a unique idempotency key:
`batch_id:file_index:filename_hash`

(Never use file content or LLM-generated text in the key.)

Duplicate upload detection: same `(batch_id, file_hash)` → skip, return existing row.

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| Download fails | `error` | Mark file as error; continue batch |
| Extraction yields no text | `degraded` | Mark degraded; do NOT run LLM |
| LLM times out | `analysis_running` (stuck) | Trigger retry with same idempotency key |
| Batch job crashes mid-way | `partial` | Resume from last committed file; idempotency prevents re-processing |
