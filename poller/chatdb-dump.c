/*
 * chatdb-dump: read one iMessage group chat out of ~/Library/Messages/chat.db
 * and print one JSON object per message line to stdout.
 *
 * Why a compiled binary at all: launchd agents get no Full Disk Access unless
 * the executable itself is granted it, and a Python script's grant lives on the
 * interpreter, which changes with every upgrade. This binary is granted once
 * and never rebuilt (a rebuild changes the code signature and re-prompts TCC).
 *
 * Usage: chatdb-dump <chat_rowid> [since_message_rowid] [limit]
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

static void json_str(const char *s) {
  if (!s) { fputs("null", stdout); return; }
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    switch (*p) {
      case '"': fputs("\\\"", stdout); break;
      case '\\': fputs("\\\\", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if (*p < 0x20) printf("\\u%04x", *p); else putchar(*p);
    }
  }
  putchar('"');
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: chatdb-dump <chat_rowid> [since_rowid] [limit]\n"); return 2; }
  long long chat_id = atoll(argv[1]);
  long long since = argc > 2 ? atoll(argv[2]) : 0;
  long long limit = argc > 3 ? atoll(argv[3]) : 5000;

  const char *home = getenv("HOME");
  if (!home || !*home) { struct passwd *pw = getpwuid(getuid()); home = pw ? pw->pw_dir : "/"; }
  char path[1024];
  snprintf(path, sizeof path, "file:%s/Library/Messages/chat.db?mode=ro", home);

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
    printf("{\"rowid\":%lld,\"date\":%lld,\"from_me\":%d,\"handle\":",
           sqlite3_column_int64(st, 0), sqlite3_column_int64(st, 1), sqlite3_column_int(st, 2));
    json_str((const char *)sqlite3_column_text(st, 3));
    fputs(",\"text\":", stdout);
    json_str((const char *)sqlite3_column_text(st, 4));
    fputs(",\"body_hex\":", stdout);
    json_str((const char *)sqlite3_column_text(st, 5));
    /* associated_message_type: 0 = a real message, 2000-2005 = tapback, 3000+ = tapback removed. */
    printf(",\"assoc\":%d}\n", sqlite3_column_int(st, 6));
  }
  if (rc != SQLITE_DONE) { fprintf(stderr, "step failed: %s\n", sqlite3_errmsg(db)); return 1; }
  sqlite3_finalize(st);
  sqlite3_close(db);
  return 0;
}
