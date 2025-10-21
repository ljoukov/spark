import os

dotenv = os.environ["DOTENV"]
print(f"DOTENV is None: {dotenv is None}")
file_name = "web/.env.local"
print(f"Writing {file_name}: len={len(dotenv)}")
with open(file_name, "w") as f:
    f.write(dotenv)
