# YETU production launch checklist

Use this checklist for a named launch cohort and release. A checked CI run or a
green deployment is not proof that a real user journey works; record observable
evidence for each gate. See the backend repository's
`../fbc-peak/docs/qa/00-master-test-plan.md` and `../fbc-peak/docs/qa/journeys/`
for the journey execution steps.

## Release record

- Release / commit: ______________________________
- Environment and launch cohort: __________________
- Release owner: __________________________________
- Operations contact / escalation route: ___________
- Review date: ____________________________________
- Decision: [ ] Go  [ ] Conditional go  [ ] No-go
- Accepted risks and approver: _____________________

## 1. Release and environment integrity

- [ ] Confirm each application repository is on the intended production branch
      and record the exact deployed commit/image digest.
- [ ] Confirm DNS, TLS certificates, public URLs, CORS, cookie settings, and
      redirect URIs match the production domains for app, API, platform, POS,
      and YETU auth.
- [ ] Confirm production secrets are supplied through the approved secret
      mechanism; no development/test credentials or placeholder values are in
      use.
- [ ] Confirm the ZITADEL client, issuer, callback/logout URLs, service
      credentials, and user-facing sign-in flows work against production.
- [ ] Confirm support staff have least-privilege access and a documented,
      tested emergency access and account-recovery procedure.
- [ ] Confirm external providers (including SMS) are configured, funded, and
      monitored; prove delivery to a real test device without exposing personal
      data in the evidence.

Evidence / owner: _________________________________________________

## 2. Data protection and recovery — launch gate

- [ ] Verify the application PostgreSQL backup is off-host, encrypted, recent,
      and reporting healthy; record the latest successful backup time.
- [ ] Configure and verify a separate backup for the ZITADEL PostgreSQL data
      volume. The app-database backup service does not cover this volume.
- [ ] Store and test recovery custody for backup encryption keys and provider
      credentials, separately from the production host.
- [ ] Restore both application and identity databases into an isolated
      environment. Record duration, recovered point, integrity checks, and
      operator; a successful backup without a restore drill is insufficient.
- [ ] Agree the business recovery point (RPO) and recovery time (RTO), and
      document who declares an incident and performs restoration.
- [ ] Confirm migration deployment is blocked when its required restore point
      is unhealthy; document the approved exception process.

Evidence / owner: _________________________________________________

## 3. Security and privacy

- [ ] Review production container privileges, read-only filesystems, secrets,
      network exposure, and image versions; resolve the documented ZITADEL
      hardening exception or record a time-bound security-approved exception.
- [ ] Ensure administrative consoles and database interfaces are not exposed
      publicly. Restrict infrastructure and database access to approved
      operators and protected network paths.
- [ ] Verify tenant isolation and role/permission boundaries with at least two
      separate test tenants and non-admin user roles.
- [ ] Verify rate limits and abuse controls for sign-in, OTP/SMS, and other
      public endpoints; alert on unusual failure or traffic spikes.
- [ ] Confirm logs, traces, backups, and support evidence avoid passwords,
      access tokens, OTPs, payment details, and unnecessary personal data.
- [ ] Confirm security updates, dependency/image scanning, incident contacts,
      and credential rotation procedures have named owners.

Evidence / owner: _________________________________________________

## 4. Product scope and user journeys — launch gate

- [ ] Name the launch segment (for example, lodging-only, online POS, or both)
      and list the features explicitly included and excluded.
- [ ] Run the applicable production-like journeys from `journeys/` with real
      user roles and approved fixtures; record who performed each step and
      evidence that data persisted correctly.
- [ ] Verify sign-in, sign-out, session expiry, OTP/recovery, staff invitation,
      and permission-denied cases for the launch roles.
- [ ] Verify the target property can complete its day-one booking/check-in,
      service, billing, and close-of-day workflow without operator workarounds
      that have not been accepted and documented.
- [ ] Verify POS device registration, catalog sync, sales, refunds, shift close,
      and reconciliation for any POS cohort.
- [ ] State clearly that third-party payment rails are not integrated: payments
      are recorded, not captured. Do not promise automated card/mobile-money
      capture or settlement unless separately implemented and tested.
- [ ] State clearly that offline POS selling is unavailable until terminal
      catalog certification is complete; do not enroll a cohort that depends on
      offline trading.
- [ ] Review known journey gaps before launch, including period closing and
      company-bill splitting, POS-only property certification, and the staff
      invitation reissue limitation. Resolve or obtain explicit approval from
      the affected business owner for each relevant gap.
- [ ] Record accepted deviations in the QA evidence record and update the
      affected requirement statuses; do not mark unexecuted scenarios verified.

Evidence / owner: _________________________________________________

## 5. Operations, monitoring, and capacity

- [ ] Monitor externally reachable sign-in, API readiness, and customer-facing
      web journeys from outside the production host; alert an on-call contact
      when they fail.
- [ ] Centralize application and infrastructure logs with access control,
      retention, search, and alerts for crashes, repeated authentication
      failures, queue/worker failures, database pressure, and backup failure.
- [ ] Define service-level indicators and alert thresholds for availability,
      latency, error rate, SMS delivery, and critical workflow failures; test
      that alerts reach the person on call.
- [ ] Confirm health checks cover dependencies and distinguish readiness from
      liveness; document the operator steps for unhealthy containers.
- [ ] Load-test expected pilot and near-term peak usage; record limits and
      resource headroom for the API, database, identity provider, search, and
      workers.
- [ ] Document the current single-host failure domain, maintenance window,
      restoration procedure, and user communication plan. Do not claim high
      availability without tested redundancy and failover.
- [ ] Rehearse an application rollback and a database recovery scenario with
      the release operator; define who may authorize a migration exception.

Evidence / owner: _________________________________________________

## 6. Support and business readiness

- [ ] Name customer support and engineering escalation owners, hours of
      coverage, and the route for reporting urgent incidents.
- [ ] Prepare short user guidance for account access, common failures,
      payment-recording limitations, POS connectivity, and data correction.
- [ ] Train the pilot users and confirm their devices, browsers, network, and
      staff roles are supported.
- [ ] Define how customer data is exported, corrected, retained, and deleted;
      confirm applicable privacy and contractual obligations with the owner.
- [ ] Agree launch success measures, feedback collection, incident severity,
      pause criteria, and the person authorized to stop enrollment.

Evidence / owner: _________________________________________________

## Go / no-go decision

**Go** only when all launch-gate items (Sections 2 and 4) are complete or have
explicit written business/security approval, critical alerts reach an owner,
and applicable user journeys have evidence. A conditional go must name the
limited cohort, accepted risks, owner, and expiry/review date. Otherwise, record
**No-go**, the blocking items, and the next review date.

- Decision and rationale: __________________________________________
- Approved cohort / limits: ________________________________________
- Risk approver(s): ________________________________________________
- Follow-up owner(s) and due date(s): ______________________________
- Evidence record location: ________________________________________

## Observability and admin-tool choices

These are options, not launch requirements by product name. The requirement is
to detect user-impacting failures, retain enough evidence to investigate them,
and alert a responsible person.

| Tool | Needed now? | Guidance for this deployment |
|---|---|---|
| Metrics and alerting (Prometheus + Grafana, or managed equivalent) | Yes, the capability; no, not necessarily these products. | Establish host/container, API, database, backup, and external-uptime metrics with tested alerts. Given the current single-host deployment, a managed/external monitor avoids making the monitor depend entirely on the host it monitors. If self-hosting, keep dashboards and scrape endpoints private and back up configuration. |
| Central logs | Yes, the capability. | Current Docker JSON logs are bounded local logs; they are useful for immediate debugging but are not a substitute for durable, searchable, access-controlled logs and alerts. Choose a managed service or a maintained private log stack, with retention and redaction policies. |
| Distributed tracing (OpenTelemetry + Jaeger or a hosted trace backend) | Not a launch blocker for a small pilot; valuable as complexity/traffic grows. | Add instrumentation first, then choose a trace backend. Sampling, trace context propagation across Go APIs, workers, and web clients, and redaction matter more than deploying Jaeger specifically. Avoid collecting secrets or sensitive user data. |
| Portainer | No. | It is a convenience UI, not an operational requirement. Docker/SSH workflows already exist. If adopted, treat it as privileged infrastructure: private access only, MFA/SSO where supported, least privilege, patching, audit trail, and no public exposure. |
| Adminer | No. | It is not a backup, monitoring, or recovery solution. Prefer documented, audited database operations through restricted operator access. If a web DB client is temporarily necessary, isolate it, require strong access controls, expose it only through a private path, and remove it afterward. |

For this deployment, prioritize **external uptime checks + centralized logs +
actionable alerts + tested backups**. Add metrics and tracing incrementally;
avoid installing several dashboards/admin consoles before ownership, security,
retention, and alert response are defined.
