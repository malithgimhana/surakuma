"""Verify ZIP CRCs, required files, manifest hashes and private-data exclusions."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import zipfile

root=Path(__file__).resolve().parents[1]
archive=root/"output/Surakuma-assessment-package.zip"
required={"prototype/Surakuma-source.zip","report/Surakuma-technical-report.pdf","report/Surakuma-technical-report.docx","demonstration/Surakuma-walkthrough.webm","demonstration/index.html","review/translation-review.csv","README.md","PACKAGE-MANIFEST.txt"}
secrets=[]
settings=root/"backend/data/development-settings.json"
if settings.is_file():
    private=json.loads(settings.read_text(encoding="utf-8-sig"))
    secrets=[str(value).encode() for value in [private.get("Seed",{}).get("Password"),private.get("Jwt",{}).get("Key")] if value]
def scan(name,data):
    if any(secret in data for secret in secrets): raise SystemExit(f"Private value detected in {name}; no value is printed.")
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None,"Combined archive CRC failure"
    assert required.issubset(set(package.namelist())),"Required deliverable missing"
    manifest=package.read("PACKAGE-MANIFEST.txt").decode("utf-8-sig")
    for line in manifest.splitlines():
        if len(line)>66 and line[64:66]=="  ":
            digest,name=line[:64],line[66:]
            assert hashlib.sha256(package.read(name)).hexdigest().upper()==digest,f"Hash mismatch: {name}"
    for item in package.infolist(): scan(item.filename,package.read(item))
    with zipfile.ZipFile(BytesIO(package.read("prototype/Surakuma-source.zip"))) as source:
        assert source.testzip() is None,"Nested source CRC failure"
        forbidden={"node_modules","bin","obj","data","tmp","test-results","dist",".git"}
        for item in source.infolist():
            assert not forbidden.intersection(Path(item.filename).parts),f"Runtime path in source archive: {item.filename}"
            assert not item.filename.endswith("development-settings.json"),"Private settings included"
            scan(item.filename,source.read(item))
        assert "docs/testing/results.md" in source.namelist()
        assert "docs/diagrams/rendered/classes.svg" in source.namelist()
    with zipfile.ZipFile(BytesIO(package.read("report/Surakuma-technical-report.docx"))) as document:
        for item in document.infolist(): scan(item.filename,document.read(item))
print(f"Verified {archive.name}: CRCs, nested source, required materials, hashes and private-data exclusions.")
