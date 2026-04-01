import os
import sys


def parse_env_entries(content: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].lstrip()
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in {'"', "'"}
        ):
            value = value[1:-1]
        entries.append((key, value))
    return entries


def write_text_file(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        file.write(content)


def render_cloud_run_env_yaml(entries: list[tuple[str, str]]) -> str:
    lines: list[str] = []
    for key, value in entries:
        escaped = value.replace("'", "''")
        lines.append(f"{key}: '{escaped}'")
    return "\n".join(lines) + "\n"


dotenv = os.getenv("DOTENV")
if dotenv is None:
    print(
        "ERROR: DOTENV environment variable is not set. Did Secret Manager mount it?",
        file=sys.stderr,
    )
    sys.exit(1)

entries = parse_env_entries(dotenv)

dotenv_file_name = "web/.env.local"
cloud_run_env_file_name = "web/cloud-run-env.yaml"

print(f"Writing {dotenv_file_name} (len={len(dotenv)})")
for key, value in entries:
    print(f"ENV {key} len={len(value)}")
write_text_file(dotenv_file_name, dotenv)
cloud_run_env_yaml = render_cloud_run_env_yaml(entries)
print(
    f"Writing {cloud_run_env_file_name} (entries={len(entries)})"
)
write_text_file(cloud_run_env_file_name, cloud_run_env_yaml)
print("Done.")
