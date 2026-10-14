FROM mcr.microsoft.com/powershell:7.4-debian-12

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /work \
    && chown 65534:65534 /work

# powershell-yaml for the Hydro zip export (export-hydrozip.ps1). Installed
# into the all-users module path so the nobody user can import it.
RUN pwsh -NoProfile -Command "Install-Module powershell-yaml -Scope AllUsers -Force -Repository PSGallery"

USER 65534:65534
WORKDIR /work

