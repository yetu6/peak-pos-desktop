# Native print attempt journal (W5)

`get_print_attempt({scope, jobId})` probes without building paper. `print_job_once({scope, jobId, attempt, confirmedBackendClaim:true, paper})` owns reservation, dispatch and acceptance under the existing LocalStoreRuntime mutex. Scope is `{propertyId,outletId,terminalId}`. Paper is `{kind:'thermal',target,bytes:number[]}` or `{kind:'system',title,text}`. Result is `{jobId,attempt,state,message,routeHash,payloadHash}`; probe returns null when absent.

The server owns authentication, authorization and the backend claim. The boolean assertion is not server authorization. Native printing requires the encrypted store, but does not require an offline PIN lease, active staff session or offline terminal authority.

The migration from schema 4 applies 5 (order context) and 6 (native print attempts) atomically. No financial table or offline print_jobs row is written. Each journal write is a separate FULL-synchronous WAL commit before the next action.

- RESERVED: no transport has begun; a matching replay can dispatch.
- UNKNOWN: committed before transport begins. Errors after any write attempt, or a crash before acceptance is committed, require manual checking. No automatic resend and no backend failed acknowledgement.
- ACCEPTED: transport/spooler accepted; this does not prove paper emerged. Retry only the backend printed acknowledgement. Probe and print-once return this even when today's route/paper differs.
- NOT_SENT: DNS/target/connect or other proven pre-write failure. A matching higher backend attempt can reserve again; the same attempt returns not_sent. A changed route/payload is refused. A deliberate copy needs its own backend job identity and COPY document.

Scope is immutable for the job identity. SHA-256 binds the serialized target (or selected system printer) and exact bytes (or title/text). Existing port, host and all-resolved-address local-network guards remain in force. OS transport failures are conservatively unknown unless no system print path exists before starting. No payload cache is retained. Payload limit is 4 MiB; identifiers 256 bytes; stored error 512 characters.

## Retention and operational limit

The named `MAX_JOURNAL_ATTEMPTS` limit is 100,000 total attempts (including failed attempts), not a rolling cache. Capacity exhaustion refuses new dispatches with LIMIT_EXCEEDED; probes and accepted/unknown replay still work. Do not delete rows or recreate the store to free capacity: that erases duplicate protection. There is no automatic archival policy in W5. Before long-running rollout reaches this limit, define an archival protocol that preserves an encrypted durable tombstone for each accepted/unknown job, binds device/scope identity, and proves that retired backend identities can never become printable again. Raising capacity requires an explicit resource/retention decision, not eviction.

## Evidence

Native tests use the real encrypted LocalStore and a TCP stand-in at 127.0.0.1:9100; no production writes or physical printer claims. Guard-removal evidence and test results are recorded by the implementing agent in its handoff. Windows spooler hardware acceptance remains a platform/live check.
