#!/usr/bin/env bash
#
# Entrypoint wrapper around the official postgres `docker-entrypoint.sh`.
#
# On a fresh VPS the `postgres-data` volume is empty, so the stock entrypoint
# would `initdb` a blank cluster and we would lose everything the previous VPS
# held. Instead, when WAL-G archiving is configured (production) AND the data
# directory is empty AND a base backup exists in R2, we restore the latest base
# backup into PGDATA and drop a `recovery.signal` so postgres replays every
# archived WAL segment on start (PITR to the end of the archive) before opening
# for writes. The role passwords come back with the physical restore and match
# because POSTGRES_PASSWORD is a persisted, non-rotating GitHub env secret.
#
# For any command other than `postgres` (e.g. the base-backup loop sidecar that
# shares this image) the wrapper does nothing and just hands off.
set -Eeuo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

# WAL-G is "enabled" iff its storage prefix is configured. Absent in dev, where
# we run no archiving and no restore at all.
walg_enabled() { [ -n "${WALG_S3_PREFIX:-}" ]; }

# PG_VERSION exists iff an initialized cluster is already present in PGDATA.
datadir_empty() { [ ! -s "${PGDATA}/PG_VERSION" ]; }

# A base backup exists iff `wal-g backup-list` returns at least one row beyond
# its header. On the very first deploy there is none, so we fall through to a
# normal initdb.
backup_exists() {
	local list
	if ! list="$(wal-g backup-list 2>/dev/null)"; then
		return 1
	fi
	# Header line + >=1 backup row => more than one line.
	[ "$(printf '%s\n' "${list}" | grep -c .)" -gt 1 ]
}

maybe_restore() {
	walg_enabled || return 0
	datadir_empty || return 0

	echo "wal-g: empty data dir + archiving enabled; looking for a base backup in R2..."
	if ! backup_exists; then
		echo "wal-g: no base backup found - starting a fresh cluster (initdb)."
		return 0
	fi

	echo "wal-g: restoring the latest base backup into ${PGDATA} ..."
	mkdir -p "${PGDATA}"
	wal-g backup-fetch "${PGDATA}" LATEST

	# Enter archive recovery: with no recovery target, postgres replays all
	# archived WAL to the end and then promotes. restore_command is supplied on
	# the postgres command line (-c restore_command='wal-g wal-fetch %f %p').
	touch "${PGDATA}/recovery.signal"
	chown -R postgres:postgres "${PGDATA}"
	chmod 0700 "${PGDATA}"
	echo "wal-g: base backup restored - postgres will now replay archived WAL."
}

# Only the database server boot should trigger a restore. Utility invocations
# (postgres --version, psql, the backup loop, ...) pass straight through.
if [ "${1:-}" = "postgres" ]; then
	maybe_restore
fi

exec docker-entrypoint.sh "$@"
