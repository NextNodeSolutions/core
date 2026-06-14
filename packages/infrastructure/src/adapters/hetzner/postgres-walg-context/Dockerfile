# syntax=docker/dockerfile:1

# NextNode postgres image with WAL-G baked in for continuous WAL archiving and
# point-in-time recovery (PITR) to Cloudflare R2. Built once per fleet, pinned,
# and consumed by reference from the deploy compose (production only) - the same
# model as the upstream backup sidecar, but supply-chain controlled by us.
#
# Why archive_command (wal-g inside this image) over a wal-receive sidecar:
#   - no replication slot  -> no unconsumed-slot disk-fill footgun on a small VPS
#   - no pg_hba changes
#   - postgres tracks archiving natively (pg_stat_archiver) -> trivial monitoring
# See images/postgres-walg/README.md and docs/notes/implementation-notes.html.

ARG POSTGRES_VERSION=18
FROM postgres:${POSTGRES_VERSION}

# Pinned WAL-G release + sha256, so the image is reproducible and the binary
# cannot be swapped under us. `wal-g-pg-22.04-amd64` is built against glibc 2.35;
# postgres:18 (bookworm, glibc 2.36) is backward compatible, so it runs unmodified.
# amd64 only for now (the Hetzner fleet is x86_64); revisit if we add arm64 nodes.
ARG WALG_VERSION=v3.0.8
ADD --chmod=0755 \
    --checksum=sha256:f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb \
    https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64 \
    /usr/local/bin/wal-g

COPY entrypoint-walg.sh /usr/local/bin/entrypoint-walg.sh
COPY walg-backup-loop.sh /usr/local/bin/walg-backup-loop.sh
RUN chmod 0755 /usr/local/bin/entrypoint-walg.sh /usr/local/bin/walg-backup-loop.sh \
    && wal-g --version

# Wrap the official entrypoint to restore an empty data dir from R2 before the
# first start (see entrypoint-walg.sh). For any non-`postgres` command (e.g. the
# backup loop sidecar) the wrapper is a transparent pass-through.
ENTRYPOINT ["entrypoint-walg.sh"]
CMD ["postgres"]
