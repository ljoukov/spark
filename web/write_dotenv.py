import os
import sys

dotenv = os.getenv("DOTENV")
if dotenv is None:
    print(
        "ERROR: DOTENV environment variable is not set. Did Secret Manager mount it?",
        file=sys.stderr,
    )
    sys.exit(1)

file_name = "web/.env.local"
print(f"Writing {file_name} (len={len(dotenv)})")
os.makedirs(os.path.dirname(file_name), exist_ok=True)
with open(file_name, "w") as f:
    f.write(dotenv)
print("Done.")
