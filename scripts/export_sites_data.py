from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb


TOPICS = (
    ("economic_conditions", "Economic and household conditions", "經濟與家庭狀況", 1, 6),
    ("institutional_trust", "Institutional and media trust", "制度與媒體信任", 7, 19),
    ("social_capital", "Social trust and networks", "社會信任與人際網絡", 20, 35),
    ("elections_services", "Elections and public services", "選舉與公共服務", 36, 46),
    ("political_information", "Political information and parties", "政治資訊與政黨", 47, 55),
    ("social_values", "Social values and authority", "社會價值與權威", 56, 69),
    ("political_participation", "Political participation", "政治參與", 70, 81),
    ("regime_support", "Regime preferences and support", "政體偏好與制度支持", 82, 90),
    ("democracy_evaluation", "Democratic perceptions and evaluation", "民主認知與評價", 91, 100),
    ("governance", "Governance and accountability", "政府治理與課責", 101, 126),
    ("country_democracy", "Democracy ratings of countries", "各國民主程度評價", 127, 130),
    ("democratic_values", "Democratic values and attitudes", "民主價值與政治態度", 131, 155),
    ("globalization_identity", "Globalization, fairness and identity", "全球化、公平與國家認同", 156, 171),
    ("international_relations", "International relations and regional influence", "國際關係與區域影響", 172, 182),
)

RESPONSE_SET_LABELS = {
    "important_national_problems": "Important national problems (up to three answers)",
    "organization_membership": "Organization membership (up to three answers)",
}


def topic_for(variable_id: str) -> str:
    match = re.match(r"^q(\d+)", variable_id)
    if match is None:
        raise ValueError(f"Invalid question identifier: {variable_id}")
    number = int(match.group(1))
    for topic_id, _, _, first, last in TOPICS:
        if first <= number <= last:
            return topic_id
    raise ValueError(f"No topic configured for {variable_id}")


def clean_number(value: object) -> float | int | None:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def authenticated_active_source(project_root: Path) -> tuple[Path, dict[str, Any]]:
    root = project_root.resolve(strict=True)
    validator_path = root / "cloud_app/analysis_v4/active_release.py"
    spec = importlib.util.spec_from_file_location("active_release_validator", validator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("ACTIVE release validator could not be loaded")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)

    active_path = root / "data/releases/ACTIVE.json"
    active = validator.validate_active_release(root)
    artifact = active["artifacts"]["cloud_database"]
    database = (root / str(artifact["path"])).resolve(strict=True)
    return database, {
        "schemaVersion": "sites-static-release.v1",
        "transactionId": str(active["transaction_id"]),
        "correctionVersion": str(active["correction_version"]),
        "activeManifestSha256": sha256_file(active_path),
        "promotionReceiptSha256": str(active["receipt"]["sha256"]),
        "sourceDatabase": {
            "path": str(artifact["path"]),
            "bytes": int(artifact["bytes"]),
            "sha256": str(artifact["sha256"]),
        },
    }


def export(database: Path, output: Path, release: dict[str, Any]) -> None:
    generated_at = datetime.now(UTC).isoformat()
    connection = duckdb.connect(str(database.resolve(strict=True)), read_only=True)
    manifest = connection.execute(
        """
        SELECT source_rows, question_columns, builder_version
        FROM source.dataset_manifest
        """
    ).fetchone()
    if manifest is None:
        raise RuntimeError("Merged-only manifest is missing")

    countries = {
        int(row[0]): str(row[1])
        for row in connection.execute(
            """
            SELECT CAST(raw_value AS INTEGER), category_label
            FROM semantic.role_value_settings
            WHERE variable_id = 'country'
              AND category_status = 'included'
              AND observed
            ORDER BY raw_value
            """
        ).fetchall()
    }

    question_rows = connection.execute(
        """
        SELECT
            variable_id,
            source_position,
            canonical_label,
            selection_mode,
            response_set_id,
            member_order,
            category_available,
            ordinal_available,
            continuous_available,
            is_construct
        FROM semantic.analysis_question_catalog
        WHERE dashboard_visible
        ORDER BY source_position, display_order, variable_id
        """
    ).fetchall()
    waves_by_question: dict[str, list[int]] = defaultdict(list)
    for variable_id, wave in connection.execute(
        """
        SELECT c.variable_id, vw.wave
        FROM semantic.analysis_question_catalog AS c
        JOIN metadata.variable_wave AS vw
          ON vw.variable_id = c.physical_variable_id
         AND vw.is_present
        WHERE c.dashboard_visible
          AND NOT c.is_construct
        UNION
        SELECT c.variable_id, cc.wave
        FROM semantic.analysis_question_catalog AS c
        JOIN semantic.question_construct_contexts AS cc
          ON cc.construct_id = c.variable_id
        WHERE c.dashboard_visible
          AND c.is_construct
        ORDER BY variable_id, wave
        """
    ).fetchall():
        waves_by_question[str(variable_id)].append(int(wave))

    questions: list[dict[str, object]] = []
    response_set_members: dict[str, list[dict[str, object]]] = defaultdict(list)
    topic_counts: Counter[str] = Counter()
    for row in question_rows:
        variable_id = str(row[0])
        topic_id = topic_for(variable_id)
        topic_counts[topic_id] += 1
        modes = [
            mode
            for mode, available in (
                ("category", row[6]),
                ("order", row[7]),
                ("continuous", row[8]),
            )
            if bool(available)
        ]
        questions.append(
            {
                "id": variable_id,
                "position": int(row[1]),
                "text": str(row[2]),
                "selectionMode": str(row[3]),
                "responseSetId": None if row[4] is None else str(row[4]),
                "memberOrder": None if row[5] is None else int(row[5]),
                "topicId": topic_id,
                "modes": modes,
                "waves": waves_by_question[variable_id],
            }
        )
        if row[4] is not None:
            response_set_members[str(row[4])].append(
                {
                    "variableId": variable_id,
                    "memberOrder": int(row[5]),
                    "questionText": str(row[2]),
                }
            )

    topics = [
        {
            "id": topic_id,
            "labelEn": label_en,
            "labelZh": label_zh,
            "questionCount": topic_counts[topic_id],
        }
        for topic_id, label_en, label_zh, _, _ in TOPICS
        if topic_counts[topic_id]
    ]
    topic_by_id = {str(question["id"]): str(question["topicId"]) for question in questions}
    response_sets = [
        {
            "id": response_set_id,
            "label": RESPONSE_SET_LABELS.get(
                response_set_id,
                response_set_id.replace("_", " ").title(),
            ),
            "memberCount": len(members),
            "topicId": topic_by_id[str(members[0]["variableId"])],
        }
        for response_set_id, members in sorted(response_set_members.items())
    ]

    scales: dict[str, list[list[object]]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT
            variable_id,
            raw_value,
            raw_value_key,
            category_label,
            category_status,
            order_position,
            order_status,
            continuous_score,
            continuous_status
        FROM semantic.value_settings
        ORDER BY
            variable_id,
            CASE WHEN order_position IS NULL THEN 1 ELSE 0 END,
            order_position,
            raw_value NULLS LAST
        """
    ).fetchall():
        scales[str(row[0])].append(
            [
                clean_number(row[1]),
                str(row[2]),
                str(row[3]),
                str(row[4]),
                None if row[5] is None else int(row[5]),
                str(row[6]),
                clean_number(row[7]),
                str(row[8]),
            ]
        )

    for row in connection.execute(
        """
        SELECT
            construct_id,
            raw_value,
            raw_value_key,
            category_label,
            category_status,
            order_position,
            order_status,
            continuous_score,
            continuous_status
        FROM semantic.construct_value_settings
        ORDER BY
            construct_id,
            CASE WHEN order_position IS NULL THEN 1 ELSE 0 END,
            order_position,
            raw_value NULLS LAST
        """
    ).fetchall():
        scales[str(row[0])].append(
            [
                clean_number(row[1]),
                str(row[2]),
                str(row[3]),
                str(row[4]),
                None if row[5] is None else int(row[5]),
                str(row[6]),
                clean_number(row[7]),
                str(row[8]),
            ]
        )

    cells: dict[str, list[list[object]]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT
            c.variable_id,
            q.country_code,
            q.wave,
            q.raw_value,
            q.unweighted_n
        FROM analytics.question_value_summary AS q
        JOIN semantic.analysis_question_catalog AS c
          ON c.physical_variable_id = q.variable_id
         AND c.dashboard_visible
         AND NOT c.is_construct
        JOIN metadata.variable_wave AS vw
          ON vw.variable_id = c.physical_variable_id
         AND vw.wave = q.wave
         AND vw.is_present
        ORDER BY c.variable_id, q.country_code, q.wave, q.raw_value NULLS LAST
        """
    ).fetchall():
        cells[str(row[0])].append(
            [
                int(float(row[1])),
                int(row[2]),
                clean_number(row[3]),
                int(row[4]),
            ]
        )

    for row in connection.execute(
        """
        SELECT
            c.variable_id,
            q.country_code,
            q.wave,
            q.raw_value,
            q.unweighted_n
        FROM analytics.construct_value_summary AS q
        JOIN semantic.analysis_question_catalog AS c
          ON c.variable_id = q.variable_id
         AND c.dashboard_visible
         AND c.is_construct
        JOIN semantic.question_construct_contexts AS cc
          ON cc.construct_id = c.variable_id
         AND cc.country_code = q.country_code
         AND cc.wave = q.wave
        ORDER BY c.variable_id, q.country_code, q.wave, q.raw_value NULLS LAST
        """
    ).fetchall():
        cells[str(row[0])].append(
            [
                int(float(row[1])),
                int(row[2]),
                clean_number(row[3]),
                int(row[4]),
            ]
        )

    write_json(
        output / "catalog.json",
        {
            "dataset": {
                "sourceRows": int(manifest[0]),
                "questionCount": len(questions),
                "builderVersion": str(manifest[2]),
                "exportedAt": generated_at,
                "dataMode": "aggregate-only",
                "release": release,
            },
            "countries": [
                {"code": code, "name": name} for code, name in countries.items()
            ],
            "waves": [1, 2, 3, 4, 5, 6],
            "topics": topics,
            "questions": questions,
            "responseSets": response_sets,
        },
    )

    question_dir = output / "questions"
    question_bundle: dict[str, object] = {}
    for question in questions:
        variable_id = str(question["id"])
        payload = {
            "id": variable_id,
            "scale": scales[variable_id],
            "cells": cells[variable_id],
        }
        question_bundle[variable_id] = payload
        write_json(
            question_dir / f"{variable_id}.json",
            payload,
        )

    response_set_dir = output / "response-sets"
    response_set_bundle: dict[str, object] = {}
    for response_set in response_sets:
        response_set_id = str(response_set["id"])
        members = sorted(
            response_set_members[response_set_id],
            key=lambda member: int(member["memberOrder"]),
        )
        member_ids = [str(member["variableId"]) for member in members]
        option_rows = connection.execute(
            """
            SELECT raw_value, option_label, display_order
            FROM semantic.response_set_options
            WHERE response_set_id = ?
            ORDER BY display_order
            """,
            [response_set_id],
        ).fetchall()
        options = [
            [clean_number(raw_value), str(label), int(display_order)]
            for raw_value, label, display_order in option_rows
        ]
        allowed = {float(raw_value) for raw_value, _, _ in option_rows}
        raw_rows = connection.execute(
            f"""
            SELECT
                CAST(country AS INTEGER),
                CAST(wave AS INTEGER),
                {", ".join(f'"{member_id}"' for member_id in member_ids)}
            FROM source.responses
            ORDER BY country, wave
            """
        ).fetchall()
        # Availability and analytical eligibility are intentionally different
        # for a specific member slot.  A slot is selectable only where that
        # slot has at least one valid response, while the canonical analysis
        # denominator is every respondent with a valid answer in any slot.
        # Keeping these concepts separate prevents empty slot contexts from
        # appearing in the UI without reverting to the old, too-small slot
        # denominator.
        any_bases: Counter[tuple[int, int]] = Counter()
        scope_contexts: dict[str, set[tuple[int, int]]] = defaultdict(set)
        scope_counts: dict[
            str,
            Counter[tuple[int, int, float]],
        ] = defaultdict(Counter)
        for raw_row in raw_rows:
            country_code = int(raw_row[0])
            wave = int(raw_row[1])
            values = [
                None if value is None else float(value)
                for value in raw_row[2:]
            ]
            valid_values = [value for value in values if value in allowed]
            if valid_values:
                context = (country_code, wave)
                any_bases[context] += 1
                scope_contexts["any"].add(context)
                for raw_value in set(valid_values):
                    scope_counts["any"][(country_code, wave, raw_value)] += 1
            for member, value in zip(members, values, strict=True):
                scope = str(member["memberOrder"])
                context = (country_code, wave)
                if value in allowed:
                    scope_contexts[scope].add(context)
                    scope_counts[scope][(country_code, wave, value)] += 1

        scopes: dict[str, object] = {}
        for scope in ["any", *[str(member["memberOrder"]) for member in members]]:
            contexts = scope_contexts[scope]
            counts = scope_counts[scope]
            scopes[scope] = {
                "contexts": [
                    [country_code, wave, int(any_bases[(country_code, wave)])]
                    for country_code, wave in sorted(contexts)
                ],
                "rows": [
                    [
                        country_code,
                        wave,
                        clean_number(raw_value),
                        int(any_bases[(country_code, wave)]),
                        int(count),
                    ]
                    for (country_code, wave, raw_value), count in sorted(counts.items())
                ],
            }
        payload = {
            "id": response_set_id,
            "label": response_set["label"],
            "topicId": response_set["topicId"],
            "members": members,
            "options": options,
            "scopes": scopes,
        }
        response_set_bundle[response_set_id] = payload
        write_json(response_set_dir / f"{response_set_id}.json", payload)

    write_json(
        output / "bundle.json",
        {
            "questions": question_bundle,
            "responseSets": response_set_bundle,
        },
    )

    connection.close()
    file_hashes = {
        path.relative_to(output).as_posix(): sha256_file(path)
        for path in sorted(output.rglob("*.json"))
        if path.name != "manifest.json"
    }
    content_digest = hashlib.sha256()
    for relative_path, digest in file_hashes.items():
        content_digest.update(f"{relative_path}\0{digest}\n".encode("utf-8"))
    write_json(
        output / "manifest.json",
        {
            "schemaVersion": "sites-static-data-manifest.v2",
            "release": release,
            "questionFiles": len(questions),
            "responseSetFiles": len(response_sets),
            "aggregateCells": sum(
                len(cells[str(question["id"])]) for question in questions
            ),
            "generatedAt": generated_at,
            "contentSha256": content_digest.hexdigest(),
            "files": file_hashes,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Workspace containing the authenticated data/releases/ACTIVE.json",
    )
    args = parser.parse_args()
    database, release = authenticated_active_source(args.project_root)
    export(database, args.output, release)


if __name__ == "__main__":
    main()
