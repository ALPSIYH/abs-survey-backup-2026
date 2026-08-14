from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

from export_sites_data import authenticated_active_source, export, sha256_file


def canonical_payload(path: Path) -> Any:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if path.name == "catalog.json":
        payload = dict(payload)
        dataset = dict(payload["dataset"])
        dataset.pop("exportedAt", None)
        payload["dataset"] = dataset
    return payload


def content_sha256(files: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for relative_path, file_digest in sorted(files.items()):
        digest.update(f"{relative_path}\0{file_digest}\n".encode("utf-8"))
    return digest.hexdigest()


def verify(project_root: Path, data_dir: Path) -> dict[str, Any]:
    database, release = authenticated_active_source(project_root)
    root = data_dir.resolve(strict=True)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != "sites-static-data-manifest.v2":
        raise RuntimeError("static data manifest schema is invalid")
    if manifest.get("release") != release:
        raise RuntimeError("static data is not bound to the current authenticated ACTIVE release")

    declared_files = manifest.get("files")
    if not isinstance(declared_files, dict) or not declared_files:
        raise RuntimeError("static data file hashes are missing")
    actual_files = {
        path.relative_to(root).as_posix(): sha256_file(path)
        for path in sorted(root.rglob("*.json"))
        if path.name != "manifest.json"
    }
    if actual_files != declared_files:
        raise RuntimeError("static data files do not match their release manifest")
    if manifest.get("contentSha256") != content_sha256(actual_files):
        raise RuntimeError("static data content fingerprint is invalid")

    question_files = [name for name in actual_files if name.startswith("questions/")]
    response_set_files = [
        name for name in actual_files if name.startswith("response-sets/")
    ]
    if len(question_files) != int(manifest.get("questionFiles", -1)):
        raise RuntimeError("question file count is invalid")
    if len(response_set_files) != int(manifest.get("responseSetFiles", -1)):
        raise RuntimeError("response-set file count is invalid")
    if set(actual_files) != {
        "catalog.json",
        *question_files,
        *response_set_files,
    }:
        raise RuntimeError("unexpected public data files are present")

    with tempfile.TemporaryDirectory(prefix="sites-active-parity-") as temporary:
        reference = Path(temporary) / "data"
        export(database, reference, release)
        reference_files = {
            path.relative_to(reference).as_posix(): path
            for path in sorted(reference.rglob("*.json"))
            if path.name != "manifest.json"
        }
        if set(reference_files) != set(actual_files):
            raise RuntimeError("public data file set differs from a fresh ACTIVE export")
        for relative_path, reference_path in reference_files.items():
            published_path = root / relative_path
            if canonical_payload(reference_path) != canonical_payload(published_path):
                raise RuntimeError(
                    f"public data differs from the authenticated ACTIVE release: {relative_path}"
                )

    catalog = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
    countries = {int(item["code"]): str(item["name"]) for item in catalog["countries"]}
    if countries.get(19) != "Bangladesh" or countries.get(20) != "Sri Lanka":
        raise RuntimeError("country identities 19 and 20 are invalid")

    return {
        "status": "PASS",
        "transactionId": release["transactionId"],
        "correctionVersion": release["correctionVersion"],
        "sourceDatabaseSha256": release["sourceDatabase"]["sha256"],
        "contentSha256": manifest["contentSha256"],
        "questionFiles": len(question_files),
        "responseSetFiles": len(response_set_files),
        "countries19And20": [countries[19], countries[20]],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    args = parser.parse_args()
    print(json.dumps(verify(args.project_root, args.data_dir), indent=2))


if __name__ == "__main__":
    main()
