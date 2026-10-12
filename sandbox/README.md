# ACM Practice execution sandbox

All generated programs and contestant submissions run in the local Docker
image `acm-practice-sandbox:1`. There is deliberately no native fallback.

Build it once after installing and starting Docker Desktop:

```powershell
npm run sandbox:build
```

Every execution uses a new container with networking disabled, a read-only
root filesystem, all Linux capabilities removed, `no-new-privileges`, a
non-root user and explicit CPU, memory, process, file-size, time and output
limits. Problem sources are mounted read-only. Compiler outputs and generated
test data go into an isolated temporary directory and only expected verifier
artifacts are copied back after the container exits.

Set `SANDBOX_IMAGE` only when you intentionally maintain a compatible custom
image. If Docker or the image is unavailable, judging and verification fail
closed rather than executing code on the host.
