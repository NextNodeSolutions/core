#!/usr/bin/env bash
#
# Base-backup loop for the WAL-G sidecar. WAL archiving (archive_command on the
# postgres server) covers the continuous WAL stream; this loop adds the periodic
# full base backups that anchor the WAL chain so PITR has a starting point and
# old WAL can be pruned. It runs from the SAME image as the server (so wal-g and
# libpq are present), shares the `postgres-data` volume read-only for file
# access, and connects to the server over the network (PGHOST=postgres) for the
# non-exclusive pg_backup_start/stop handshake.
#
# Policy (interval, retention) is injected by core via env so it stays the
# single source of truth and a change does not require an image rebuild.
set -Eeuo pipefail

: "${PGDATA:=/var/lib/postgresql/data}"
: "${WALG_BACKUP_INTERVAL:=86400}"   # seconds between base backups (default 1d)
: "${WALG_RETAIN_COUNT:=7}"          # full base backups to keep (delete retain)
: "${WALG_BACKUP_FIRST_DELAY:=120}"  # let the server finish recovery/startup

echo "wal-g backup loop: first backup in ${WALG_BACKUP_FIRST_DELAY}s, then every ${WALG_BACKUP_INTERVAL}s, keeping ${WALG_RETAIN_COUNT} full backups."
sleep "${WALG_BACKUP_FIRST_DELAY}"

while true; do
	echo "wal-g: starting base backup (backup-push)..."
	if wal-g backup-push "${PGDATA}"; then
		echo "wal-g: base backup complete; pruning to last ${WALG_RETAIN_COUNT} full backups."
		# `delete retain FULL N` keeps the N most recent full backups and every
		# WAL segment still needed to recover from the oldest kept one.
		wal-g delete retain FULL "${WALG_RETAIN_COUNT}" --confirm \
			|| echo "wal-g: retention prune failed (non-fatal, retried next cycle)."
	else
		echo "wal-g: backup-push FAILED; retrying next cycle."
	fi
	sleep "${WALG_BACKUP_INTERVAL}"
done
