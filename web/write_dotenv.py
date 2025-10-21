import os

dotenv = os.environ["DOTENV"]
print(f"DOTENV is None: {dotenv is None}")
print(f"Writing .env: len={len(dotenv)}")
with open(".env", "w") as f:
    f.write(dotenv)
