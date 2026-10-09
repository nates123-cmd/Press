/*
 * chatdb-dump: read one iMessage group chat out of ~/Library/Messages/chat.db
 * and print one JSON object per message line.
 *
 * Why a compiled binary at all: TCC grants Full Disk Access to the process
 * launchd starts, and credits every child to it. A Python script's grant would
 * live on the interpreter, which changes with each upgrade. So this binary is
 * the launchd agent's main executable, granted once and never rebuilt (a
 * rebuild changes the code signature and the grant has to be made again).
 *
 * Usage:
 *   chatdb-dump <chat_rowid> [since_message_rowid] [limit]
 *       print rows to stdout (what a shell or a test uses)
 *   chatdb-dump --launch <chat_rowid>
 *       what launchd runs: dump the whole chat to
 *       ~/Library/Application Support/press-poller/dump.jsonl, then exec
 *       /usr/bin/python3 press_poller.py --from-file <that file>.
 *       The poller filters by its own ROWID watermark, so dumping everything
 *       every time is correct and, for a group chat, cheap.
 *
 * Output per line:
 *   {"rowid":N,"date":N,"from_me":0|1,"handle":"+1...","text":"..."|null,"body_hex":"..."|null,"assoc":N}
 *
 * `date` is Apple nanoseconds since 2001-01-01. `body_hex` is the raw
 * attributedBody typedstream (macOS 26 leaves `text` NULL); the poller decodes it.
 */
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pwd.h>
#include <unistd.h>

static void json_str(FILE *out, const char *s) {
  if (!s) { fputs("null", out); return; }
  fputc('"', out);
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    switch (*p) {
      case '"': fputs("\\\"", out); break;
      case '\\': fputs("\\\\", out); break;
      case '\n': fputs("\\n", out); break;
      case '\r': fputs("\\r", out); break;
      case '\t': fputs("\\t", out); break;
      default:
        if (*p < 0x20) fprintf(out, "\\u%04x", *p); else fputc(*p, out);
    }
  }
  fputc('"', out);
}

static const char *home_dir(void) {
  const char *home = getenv("HOME");
  if (home && *home) return home;
  struct passwd *pw = getpwuid(getuid());
  return pw ? pw->pw_dir : "/";
}

static int dump(FILE *out, long long chat_id, long long since, long long limit) {
  char path[1024];
  snprintf(path, sizeof path, "file:%s/Library/Messages/chat.db?mode=ro", home_dir());

  sqlite3 *db = NULL;
  int rc = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, NULL);
  if (rc != SQLITE_OK) { fprintf(stderr, "open failed: %s\n", sqlite3_errmsg(db)); return 1; }

  const char *sql =
    "select m.ROWID, m.date, m.is_from_me, h.id, m.text, hex(m.attributedBody), "
    "       coalesce(m.associated_message_type, 0) "
    "from message m "
    "join chat_message_join j on j.message_id = m.ROWID "
    "left join handle h on h.ROWID = m.handle_id "
    "where j.chat_id = ?1 and m.ROWID > ?2 "
    "order by m.ROWID limit ?3";
  sqlite3_stmt *st = NULL;
  rc = sqlite3_prepare_v2(db, sql, -1, &st, NULL);
  if (rc != SQLITE_OK) { fprintf(stderr, "prepare failed: %s\n", sqlite3_errmsg(db)); return 1; }
  sqlite3_bind_int64(st, 1, chat_id);
  sqlite3_bind_int64(st, 2, since);
  sqlite3_bind_int64(st, 3, limit);

  while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
    fprintf(out, "{\"rowid\":%lld,\"date\":%lld,\"from_me\":%d,\"handle\":",
            sqlite3_column_int64(st, 0), sqlite3_column_int64(st, 1), sqlite3_column_int(st, 2));
    json_str(out, (const char *)sqlite3_column_text(st, 3));
    fputs(",\"text\":", out);
    json_str(out, (const char *)sqlite3_column_text(st, 4));
    fputs(",\"body_hex\":", out);
    json_str(out, (const char *)sqlite3_column_text(st, 5));
    /* associated_message_type: 0 = a real message, 2000-2005 = tapback, 3000+ = tapback removed. */
    fprintf(out, ",\"assoc\":%d}\n", sqlite3_column_int(st, 6));
  }
  if (rc != SQLITE_DONE) { fprintf(stderr, "step failed: %s\n", sqlite3_errmsg(db)); return 1; }
  sqlite3_finalize(st);
  sqlite3_close(db);
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 3 && strcmp(argv[1], "--launch") == 0) {
    char app[1024], dumpfile[1100], tmpfile[1100], script[1100];
    snprintf(app, sizeof app, "%s/Library/Application Support/press-poller", home_dir());
    snprintf(dumpfile, sizeof dumpfile, "%s/dump.jsonl", app);
    snprintf(tmpfile, sizeof tmpfile, "%s/dump.jsonl.tmp", app);
    snprintf(script, sizeof script, "%s/press_poller.py", app);
    FILE *out = fopen(tmpfile, "w");
    if (!out) { perror("open dump"); return 1; }
    int rc = dump(out, atoll(argv[2]), 0, 1000000);
    fclose(out);
    if (rc != 0) return rc;
    if (rename(tmpfile, dumpfile) != 0) { perror("rename dump"); return 1; }
    execl("/usr/bin/python3", "python3", script, "--from-file", dumpfile, (char *)NULL);
    perror("exec python3");
    return 1;
  }
  if (argc < 2) { fprintf(stderr, "usage: chatdb-dump <chat_rowid> [since_rowid] [limit] | --launch <chat_rowid>\n"); return 2; }
  long long chat_id = atoll(argv[1]);
  long long since = argc > 2 ? atoll(argv[2]) : 0;
  long long limit = argc > 3 ? atoll(argv[3]) : 5000;
  return dump(stdout, chat_id, since, limit);
}
