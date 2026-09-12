"""Verify a reviewed GitHub artifact ZIP before bounded extraction; never execute its contents."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile
import re


def extract(archive, digest, destination, reviewed_tree_digest=None):
    archive, destination = Path(archive), Path(destination)
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("Expected the exact GitHub sha256 digest")
    if reviewed_tree_digest is not None and not re.fullmatch(r"sha256:[a-f0-9]{64}", reviewed_tree_digest):
        raise ValueError("Expected an explicit reviewed file-tree digest")
    if archive.stat().st_size > 250_000_000:
        raise ValueError("Compressed artifact exceeds the byte budget")
    with archive.open("rb") as stream:
        actual = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest and reviewed_tree_digest is None:
        raise ValueError("Downloaded artifact bytes differ from the reviewed digest")
    if destination.exists():
        raise ValueError("Extraction destination must not already exist")
    temporary = Path(tempfile.mkdtemp(prefix="pages-archive-", dir=destination.parent))
    inventory = []
    try:
        with zipfile.ZipFile(archive) as package:
            entries = package.infolist()
            if not entries or len(entries) > 250_000 or sum(row.file_size for row in entries) > 250_000_000:
                raise ValueError("Extracted artifact exceeds count or byte limits")
            seen = set()
            for entry in entries:
                name = entry.filename.rstrip("/")
                parts = name.split("/")
                if (not name or name in seen or "\\" in name or ":" in name
                        or any(part in ("", ".", "..") for part in parts)
                        or any(ord(char) < 32 or ord(char) == 127 for char in name)
                        or PurePosixPath(name).is_absolute()):
                    raise ValueError("Unsafe or duplicate archive path")
                seen.add(name)
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if mode not in (0, stat.S_IFREG, stat.S_IFDIR) or bool(entry.flag_bits & 1):
                    raise ValueError("Links, devices and encrypted entries are not accepted")
                output = temporary.joinpath(*parts)
                if entry.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                    continue
                if mode == stat.S_IFDIR:
                    raise ValueError("File has directory metadata")
                output.parent.mkdir(parents=True, exist_ok=True)
                with package.open(entry) as source, output.open("xb") as target:
                    copied = 0
                    content_hash = hashlib.sha256()
                    while chunk := source.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > entry.file_size:
                            raise ValueError("Archive content exceeds declared size")
                        target.write(chunk)
                        content_hash.update(chunk)
                    if copied != entry.file_size:
                        raise ValueError("Truncated archive content")
                os.chmod(output, 0o644)
                inventory.append({"path": name, "bytes": copied, "sha256": content_hash.hexdigest()})
        inventory.sort(key=lambda item: item["path"].encode("utf-8"))
        canonical = json.dumps({"version": 1, "files": inventory}, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
        tree_digest = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if reviewed_tree_digest is not None and tree_digest != reviewed_tree_digest:
            raise ValueError("Every extracted path and byte must match the explicitly reviewed file-tree digest")
        temporary.rename(destination)
        return {"github_artifact_digest": digest, "downloaded_archive_digest": actual,
                "archive_digest_matches_metadata": actual == digest, "file_tree_sha256": tree_digest,
                "acceptance_policy": "reviewed-file-tree-v1" if reviewed_tree_digest else "exact-archive-v1",
                "files": len(inventory), "bytes": sum(item["bytes"] for item in inventory)}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        raise SystemExit("Usage: python3 verify-artifact.py candidate.zip sha256:<metadata-digest> output-directory [sha256:<explicit-reviewed-file-tree-digest>]")
    print(json.dumps(extract(*sys.argv[1:]), sort_keys=True))
