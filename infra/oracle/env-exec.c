/* Read one protected dotenv file in-process, then exec. Never echo values. */
#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef IR35_ENV_PREFIX
#define IR35_ENV_PREFIX "/opt/ir35/.env."
#endif

static void fail(void) {
    fputs("IR35 protected environment launcher refused input; no values logged\n", stderr);
    _exit(111);
}

static int safe_key(const char *key) {
    if (!*key || !(*key == '_' || (*key >= 'A' && *key <= 'Z'))) return 0;
    for (const char *p = key; *p; p++)
        if (!(*p == '_' || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9'))) return 0;
    const char *reserved[] = {"PATH", "IFS", "ENV", "BASH_ENV", "SHELLOPTS", "HOME", "SHELL", NULL};
    for (int i = 0; reserved[i]; i++) if (!strcmp(key, reserved[i])) return 0;
    return strncmp(key, "LD_", 3) && strncmp(key, "DYLD_", 5);
}

int main(int argc, char **argv) {
    if (argc < 3 || strncmp(argv[1], IR35_ENV_PREFIX, strlen(IR35_ENV_PREFIX))) fail();
    const char *suffix = argv[1] + strlen(IR35_ENV_PREFIX);
    if (!*suffix || strspn(suffix, "abcdefghijklmnopqrstuvwxyz0123456789-") != strlen(suffix)) fail();
    int descriptor = open(argv[1], O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (descriptor < 0) fail();
    struct stat metadata;
    if (fstat(descriptor, &metadata) || !S_ISREG(metadata.st_mode) || metadata.st_nlink != 1 ||
        (metadata.st_mode & 0777) != 0600 || metadata.st_size > 65536 ||
        metadata.st_uid != (geteuid() == 0 ? 1002 : geteuid())) fail();
    char *buffer = calloc(65537, 1);
    if (!buffer) fail();
    size_t length = 0;
    for (;;) {
        ssize_t count = read(descriptor, buffer + length, 65536 - length);
        if (count < 0) { if (errno == EINTR) continue; fail(); }
        if (!count) break;
        length += (size_t)count;
        if (length >= 65536) fail();
    }
    close(descriptor);
    if (memchr(buffer, '\0', length) || memchr(buffer, '\r', length)) fail();
    char *save = NULL;
    char *keys[256];
    size_t total = 0;
    for (char *line = strtok_r(buffer, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
        char *equals = strchr(line, '=');
        if (!equals || equals[1] != '\'') fail();
        *equals = '\0';
        if (!safe_key(line) || total >= 256) fail();
        for (size_t i = 0; i < total; i++) if (!strcmp(keys[i], line)) fail();
        keys[total++] = line;
        char *value = equals + 2;
        size_t size = strlen(value);
        if (!size || value[size - 1] != '\'' || size > 16384) fail();
        value[size - 1] = '\0';
        if (strchr(value, '\'') || setenv(line, value, 1)) fail();
    }
    explicit_bzero(buffer, 65537);
    free(buffer);
    execvp(argv[2], argv + 2);
    fail();
}
