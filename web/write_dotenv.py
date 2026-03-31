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


dotenv = os.getenv("DOTENV")
if dotenv is None:
    print(
        "ERROR: DOTENV environment variable is not set. Did Secret Manager mount it?",
        file=sys.stderr,
    )
    sys.exit(1)

file_name = "web/.env.local"
print(f"Writing {file_name} (len={len(dotenv)})")
for key, value in parse_env_entries(dotenv):
    print(f"ENV {key} len={len(value)}")
os.makedirs(os.path.dirname(file_name), exist_ok=True)
with open(file_name, "w") as f:
    f.write(dotenv)
print("Done.")
