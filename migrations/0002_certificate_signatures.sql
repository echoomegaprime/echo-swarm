create table if not exists echo_certificate_signatures (
  certificate_digest text primary key,
  certificate_id text not null,
  release_sha text not null,
  signer_name text not null,
  signer_role text not null check (signer_role = 'Commander'),
  github_login text not null,
  github_id bigint not null,
  statement jsonb not null,
  public_key_jwk jsonb not null,
  signature_b64 text not null,
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists echo_certificate_signatures_release_sha_idx
  on echo_certificate_signatures (release_sha);

