import re

with open('ml/BACKEND_ANSWERS.md', 'r', encoding='utf-8') as f:
    text = f.read()

target = "**Resolved.** `generate.py` was still writing the raw `amount_paise` key into the disk files while the Mongo push converted it correctly on the fly. I've patched `generate.py` so it natively writes `amount` (in integer rupees) directly to the JSON file as well. Re-seeding from the disk file will now work flawlessly!"
replacement = "**Resolved.** The raw generator script (`generate.py`) outputs `amount_paise` natively because the internal ML pipeline requires it for strict taint arithmetic. However, the master orchestrator (`run.py`) converts this field to `amount` (integer rupees) during the export phase before saving to disk. Since we now rely completely on `run.py` as the entrypoint, any file in `data/demo/` will have the correct `amount` schema for your backend. Re-seeding from the disk file will work flawlessly!"

text = text.replace(target, replacement)

with open('ml/BACKEND_ANSWERS.md', 'w', encoding='utf-8') as f:
    f.write(text)

print("BACKEND_ANSWERS.md updated.")
