# Custom datasets

Forge treats training data as a versioned product resource instead of a process-wide
environment variable. Developers can link a public Hugging Face dataset or upload a
UTF-8 JSONL, NDJSON, JSON, or CSV file from **Data** in the dashboard, inspect the
result, correct the adapter when inference is ambiguous, and select any ready dataset
when creating a run.

## Runtime flow

1. The FastAPI control plane inspects at most 100 rows and records source metadata,
   detected columns, a bounded preview, adapter configuration, row counts when known,
   and basic quality signals.
2. Uploaded files are stored in the private Supabase `datasets` bucket under
   `<user-id>/<dataset-id>/<filename>`. The API never returns the object URI or a
   service credential to the browser.
3. Every session and run pins a `datasetId`. Existing sessions without one retain the
   legacy fallback so old state remains readable.
4. At training time, the API creates a one-hour signed URL for an upload. The URL and
   adapter—not Supabase credentials—are passed to Modal.
5. The Modal worker streams Hugging Face or uploaded records, caps the working set,
   applies the saved adapter, and uses the base model tokenizer's chat template when
   one exists.

## Canonical adapter

All adapters target `forge-chat-v1` and one of three record shapes:

- `text`: one source column becomes causal-language-model text.
- `prompt_response`: prompt and response columns become user/assistant messages; an
  optional input column is appended to the user message.
- `messages`: a list column is mapped through configurable role and content keys.
  OpenAI-style `role`/`content` and ShareGPT-style `from`/`value` are detected.

Automatic detection covers `messages`, `conversations`, `instruction`/`output`,
`prompt`/`response`, `question`/`answer`, and common single-text columns. Other schemas
remain `needs_mapping` until a developer explicitly maps their columns.

## API

- `GET /v1/datasets`
- `POST /v1/datasets/huggingface`
- `POST /v1/datasets/upload`
- `POST /v1/datasets/{dataset_id}/adapter`
- `DELETE /v1/datasets/{dataset_id}`

Hugging Face creation accepts `dataset` (URL or `owner/name`), optional `config`,
`split`, `revision`, `name`, and an optional adapter. Upload creation is multipart with
`file` and an optional `name`.

Uploaded files are limited to 6 MiB because Supabase recommends standard upload for
small files. Large datasets should be linked from Hugging Face, where the worker can
stream without materializing the full dataset in Render memory. Private and gated Hub
datasets are intentionally rejected until Forge has a per-user Hugging Face token
vault and revocation flow.

## Validation and safety

- Only fixed Hugging Face endpoints are called; arbitrary URLs are rejected to avoid
  server-side request forgery.
- Upload extensions, size, UTF-8 encoding, and top-level row types are validated.
- Previews are row-count and value-length bounded and remain in tenant-private state.
- Training never receives Supabase service credentials.
- The Storage bucket is private and has owner-folder RLS policies for select, insert,
  update, and delete.
- Datasets referenced by a session cannot be deleted.
- Quality checks report valid, invalid, and duplicate sampled rows plus average
  canonical record length. They are diagnostics, not a claim of semantic quality.

## Research and platform decisions

- Hugging Face's Dataset Viewer exposes bounded `splits`, `first-rows`, and `size`
  endpoints, while the Datasets library supports streaming, revisions, configs, and
  schema features. Forge uses the viewer for fast control-plane inspection and the
  library in Modal for training:
  <https://huggingface.co/docs/dataset-viewer/first_rows>,
  <https://huggingface.co/docs/datasets/main/package_reference/loading_methods>.
- Hugging Face chat templates are model-specific; preserving the tokenizer's training
  format avoids control-token mismatches:
  <https://huggingface.co/docs/transformers/chat_templating>.
- Together accepts JSONL or pre-tokenized Parquet and validates the file before a job;
  Fireworks standardizes SFT on OpenAI-compatible chat records. Forge adopts the same
  inspect-before-train and portable-chat-schema boundary:
  <https://docs.together.ai/docs/fine-tuning/data-preparation>,
  <https://docs.fireworks.ai/fine-tuning/fine-tuning-models>.
- Stanford SALT highlights current work on optimizing pretraining data mixtures with
  estimated utility, and Marin programmatically records data and experiment lineage.
  This supports keeping source, revision, split, adapter, and quality metadata as
  first-class reproducibility inputs:
  <https://saltlab.stanford.edu/publication/>,
  <https://marin.community/>.
- Berkeley coauthored GREATS, which selects useful batches online and improves
  convergence/generalization. Forge does not pretend its inexpensive preview checks
  reproduce GREATS; the registry and immutable adapter metadata provide the boundary
  where a future quality-aware sampler can be added:
  <https://proceedings.neurips.cc/paper_files/paper/2024/hash/ed165f2ff227cf36c7e3ef88957dadd9-Abstract-Conference.html>.
- LESS shows that a targeted 5% selection can outperform full-data tuning. The practical
  implication is to expose data diagnostics and keep selection pluggable instead of
  assuming every uploaded row should always be trained:
  <https://proceedings.mlr.press/v235/xia24c.html>.

## Operations

The committed migration creates the private bucket and its policies. `render.yaml`
sets `DATASET_BUCKET=datasets` and `FORGE_TRAINING_MAX_ROWS=256`. The former
hard-coded dataset Render variables are no longer part of the production Blueprint;
settings retain them only as a compatibility fallback for old sessions.
