import sys
import json

data = json.load(sys.stdin)
for r in data:
    req = r.get("requirement_key") or r.get("requirement_id") or "?"
    status = r.get("automated_status") or "?"
    conf = r.get("confidence", 0)
    mf = r.get("matched_files") or []
    if isinstance(mf, str):
        try:
            mf = json.loads(mf)
        except:
            pass
    meta_info = ""
    if isinstance(mf, list):
        for f in mf:
            meta = f.get("_meta") or f.get("meta") or ""
            if meta:
                meta_str = str(meta)[:100]
                meta_info = f" [meta: {meta_str}]"
                break
    print(f"{req:30s} {status:12s} conf={conf}{meta_info}")
