import re
with open('ml/generate.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(r'\"amount\": (.*?) // 100,', r'"amount_paise": \1,', text)
text = text.replace('txn["amount"]', 'txn["amount_paise"]')

with open('ml/generate.py', 'w', encoding='utf-8') as f:
    f.write(text)
print("generate.py reverted!")
