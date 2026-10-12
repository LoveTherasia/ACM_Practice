FROM mcr.microsoft.com/powershell:7.4-debian-12

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /work \
    && chown 65534:65534 /work

USER 65534:65534
WORKDIR /work

