# Native print attempt journal (W5)

`get_print_attempt({scope, jobId})` probes without building paper. `print_job_once({scope, jobId, attempt, confirmedBackendClaim:true, paper})` owns reservation, dispatch and acceptance under the existing LocalStoreRuntime mutex. Scope is `{propertyId,outletId,terminalId}`. Paper is `{kind:'thermal',target,bytes:number[]}` or `{kind:'system',title,text}`. Result is `{jobId,attempt,state,message,routeHash,payloadHash}`; probe returns null when absent.

The server owns authentication, authorization and the backend claim. The boolean assertion is not server authorization. Native printing requires the encrypted store, but does not require an offline PIN lease, active staff session or offline terminal authority.

The migration from schema 4 applies 5 (order context) and 6 (native print attempts) atomically. No financial table or offline print_jobs row is written. Each journal write is a separate FULL-synchronous WAL commit before the next action.

- RESERVED: no transport has begun; a replay with the same backend attempt number and hashes can dispatch. A stale or different attempt cannot borrow that reservation.
- UNKNOWN: committed before transport begins. Errors after any write attempt, or a crash before acceptance is committed, require manual checking. The queue offers the explicit “I checked: paper printed” action to the same claiming terminal: this calls the backend printed acknowledgement only. The native UNKNOWN tombstone remains unchanged, so no transport is retried. There is no automatic resend or backend failed acknowledgement.
- ACCEPTED: transport/spooler accepted; this does not prove paper emerged. Retry only the backend printed acknowledgement. Probe and print-once return this even when today's route/paper differs.
- NOT_SENT: DNS/target/connect or other proven pre-write failure. A higher backend attempt can reserve again with a corrected route/payload, so a manager can fix the printer address or paper width after a proven connection failure. The command returns the saved not_sent outcome for the same attempt before inspecting today's paper, so a lost failed acknowledgement can be retried after settings change. This neither changes the old hashes nor transports anything; the reservation method itself refuses changed hashes within that attempt. RESERVED attempts cannot change route/payload. Ordinary explicit reprint jobs have separate backend identities and COPY documents; this journal does not add an unknown-job copy command.

Scope is immutable for the job identity. SHA-256 binds the serialized target (or selected system printer) and exact bytes (or title/text) within each attempt. Only a higher attempt after NOT_SENT may change them; earlier attempt evidence remains intact. Existing port, host and all-resolved-address local-network guards remain in force. OS transport failures are conservatively unknown unless no system print path exists before starting. No payload cache is retained. Payload limit is 4 MiB; identifiers 256 bytes; stored error 512 characters.

## Retention and operational limit

The named `MAX_JOURNAL_ATTEMPTS` limit is 100,000 total attempts (including failed attempts), not a rolling cache. Capacity exhaustion refuses new dispatches with LIMIT_EXCEEDED; probes and accepted/unknown replay still work. Do not delete rows or recreate the store to free capacity: that erases duplicate protection. There is no automatic archival policy in W5. Before long-running rollout reaches this limit, define an archival protocol that preserves an encrypted durable tombstone for each accepted/unknown job, binds device/scope identity, and proves that retired backend identities can never become printable again. Raising capacity requires an explicit resource/retention decision, not eviction.

## Evidence

Native tests use the real encrypted LocalStore and a TCP stand-in at 127.0.0.1:9100; no production writes or physical printer claims. Guard-removal evidence and test results are recorded by the implementing agent in its handoff. Windows spooler hardware acceptance remains a platform/live check.

### Guard-removal run, 22 Oct 2026

Sixteen fault variants produced behavioral test failures (not just compilation errors), with the native files restored between variants and byte-compared to their backups afterwards:

- `reserved_attempt_binding`: removing the attempt-number check lets a stale claim borrow a newer reservation.
- `corrected_retry`: restoring unconditional hash rejection blocks the corrected-route NOT_SENT retry.
- `scope`, `route`, `payload`: removing each identity binding permits the corresponding mismatch.
- `transition`: removing the transition whitelist permits acceptance without dispatch.
- `capacity`: removing the cap permits the 100,001st journal row.
- `backend_claim`: removing the assertion permits an unconfirmed send.
- `accepted_probe`, `unknown_probe`: bypassing saved evidence loses acknowledgement-only/manual-check recovery when settings change.
- `durable_dispatch`: removing the pre-transport UNKNOWN commit breaks dispatch/acceptance recovery.
- `same_attempt_retry`: removing the saved NOT_SENT reservation return breaks failed-ack recovery; tested directly at the reservation boundary.
- `failed_ack_probe`: removing the command's same-attempt NOT_SENT return breaks acknowledgement recovery after settings change.
- `journal_ports`, `journal_addresses`: removing each transport guard connects to a disallowed stand-in target.
- `partial_write`: treating a write error as NOT_SENT allows retry after the stand-in has received a prefix.

Proof logs are local `/tmp/till-w5-final-mutant-<name>.log`. The final partial-write proof was retried after a compilation timeout and then failed behaviorally as expected. The transport test sends real bytes to 127.0.0.1:9100, verifies byte equality, reopens the encrypted store after transport without marking acceptance, and confirms UNKNOWN never reconnects. It separately checks same-attempt failed-ack recovery, a higher claimed retry, accepted evidence after changed settings, and a receiver closing after taking a byte.

The new encrypted-upgrade integration test creates an actual keyed schema-4 file, opens it through LocalStore, checks schema 6, both order-context columns and the journal, refuses unkeyed schema access, and reopens again. The corrected-route unit test preserves the original attempt's route/payload while reserving attempt 2 with new hashes.

Final restored-source run: `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` passed **102 tests**: 86 library, 8 encrypted-store, 2 SQLCipher provenance, 6 terminal-authority; no ignored/failed tests. Environment: `CARGO_BUILD_JOBS=2`, `CARGO_TARGET_DIR=/home/mwombeki/Desktop/PEAK/.worktrees/till-native-target`, `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `TEST_DEBUG=0`. Full log: `/tmp/till-w5-native-final-all.log`.

Changed native files pass `rustfmt --check` and `git diff --check`. Global `cargo fmt --all -- --check` still reports pre-existing formatting in unchanged `local_store/catalog.rs`, `local_store/sync.rs`, and `yetu_http.rs`; those files were left outside this task. No JS/UI edits, commits, rebase, production writes, deploys or release actions were performed by this native work pass.
