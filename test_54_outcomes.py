import json

with open('evidence/signals/signal-evidence.jsonl', 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        d = json.loads(line)
        if d.get('metadata', {}).get('timestamp', 0) >= 1791700000000:
            for k in ['runtime', 'decision', 'grade', 'model', 'metadata']:
                print(f"--- {k} ---")
                print(json.dumps(d.get(k), indent=2))
            break
