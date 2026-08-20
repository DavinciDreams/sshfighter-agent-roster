# Security

Do not report secrets in a public issue. If a token, SSH identity, private
fingerprint, or unredacted ledger is exposed, revoke it first and contact the
repository owner privately.

Runner ledgers must be created with exclusive mode `0600`. Credentials must
never appear in command arguments other than a local identity-file path, in
Git history, in fixtures, or in PR/CI logs.
