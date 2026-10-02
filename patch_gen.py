import re
with open('ml/generate.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace amount_paise with amount in generate.py
text = re.sub(r'\"amount_paise\":\s*(.*?)\,', r'"amount": \1 // 100,', text)

with open('ml/generate.py', 'w', encoding='utf-8') as f:
    f.write(text)
print("generate.py patched!")

# Also patch pipeline.py risk_v2 >= 50
with open('ml/pipeline.py', 'r', encoding='utf-8') as f:
    pipe = f.read()

pipe = pipe.replace('risk_v2"] >= 50', 'risk_v2"] >= 0.50')

with open('ml/pipeline.py', 'w', encoding='utf-8') as f:
    f.write(pipe)
print("pipeline.py patched!")

