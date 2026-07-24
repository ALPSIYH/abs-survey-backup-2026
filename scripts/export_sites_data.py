from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

import duckdb


COUNTRIES = {
    1: "Japan",
    2: "Hong Kong",
    3: "South Korea",
    4: "Mainland China",
    5: "Mongolia",
    6: "Philippines",
    7: "Taiwan",
    8: "Thailand",
    9: "Indonesia",
    10: "Singapore",
    11: "Vietnam",
    12: "Cambodia",
    13: "Malaysia",
    14: "Myanmar",
    15: "Australia",
    18: "India",
    19: "New Zealand",
    20: "Timor-Leste",
}

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
    number = int(variable_id.removeprefix("q").split(".", 1)[0])
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


def export(database: Path, output: Path) -> None:
    connection = duckdb.connect(str(database.resolve(strict=True)), read_only=True)
    manifest = connection.execute(
        """
        SELECT source_rows, question_columns, builder_version
        FROM source.dataset_manifest
        """
    ).fetchone()
    if manifest is None:
        raise RuntimeError("Merged-only manifest is missing")

    question_rows = connection.execute(
        """
        SELECT
            q.variable_id,
            v.source_position,
            COALESCE(v.canonical_label, q.variable_id),
            q.selection_mode,
            q.response_set_id,
            q.member_order,
            c.category_available,
            c.ordinal_available,
            c.continuous_available
        FROM semantic.question_settings AS q
        JOIN metadata.variables AS v USING (variable_id)
        JOIN semantic.question_capabilities AS c USING (variable_id)
        ORDER BY v.source_position
        """
    ).fetchall()
    waves_by_question: dict[str, list[int]] = defaultdict(list)
    for variable_id, wave in connection.execute(
        """
        SELECT variable_id, wave
        FROM metadata.variable_wave
        WHERE is_present
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

    cells: dict[str, list[list[object]]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT variable_id, country_code, wave, raw_value, unweighted_n
        FROM analytics.question_value_summary
        ORDER BY variable_id, country_code, wave, raw_value NULLS LAST
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
                "exportedAt": datetime.now(UTC).isoformat(),
                "dataMode": "aggregate-only",
            },
            "countries": [
                {"code": code, "name": name} for code, name in COUNTRIES.items()
            ],
            "waves": [1, 2, 3, 4, 5, 6],
            "topics": topics,
            "questions": questions,
            "responseSets": response_sets,
        },
    )

    question_dir = output / "questions"
    for question in questions:
        variable_id = str(question["id"])
        write_json(
            question_dir / f"{variable_id}.json",
            {
                "id": variable_id,
                "scale": scales[variable_id],
                "cells": cells[variable_id],
            },
        )

    response_set_dir = output / "response-sets"
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
        scope_bases: dict[str, Counter[tuple[int, int]]] = defaultdict(Counter)
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
                scope_bases["any"][context] += 1
                for raw_value in set(valid_values):
                    scope_counts["any"][(country_code, wave, raw_value)] += 1
            for member, value in zip(members, values, strict=True):
                if value not in allowed:
                    continue
                scope = str(member["memberOrder"])
                context = (country_code, wave)
                scope_bases[scope][context] += 1
                scope_counts[scope][(country_code, wave, value)] += 1

        scopes: dict[str, object] = {}
        for scope in ["any", *[str(member["memberOrder"]) for member in members]]:
            bases = scope_bases[scope]
            counts = scope_counts[scope]
            scopes[scope] = {
                "contexts": [
                    [country_code, wave, int(base_n)]
                    for (country_code, wave), base_n in sorted(bases.items())
                ],
                "rows": [
                    [
                        country_code,
                        wave,
                        clean_number(raw_value),
                        int(bases[(country_code, wave)]),
                        int(count),
                    ]
                    for (country_code, wave, raw_value), count in sorted(counts.items())
                ],
            }
        write_json(
            response_set_dir / f"{response_set_id}.json",
            {
                "id": response_set_id,
                "label": response_set["label"],
                "topicId": response_set["topicId"],
                "members": members,
                "options": options,
                "scopes": scopes,
            },
        )

    write_json(
        output / "manifest.json",
        {
            "questionFiles": len(questions),
            "responseSetFiles": len(response_sets),
            "aggregateCells": sum(len(rows) for rows in cells.values()),
            "generatedAt": datetime.now(UTC).isoformat(),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    export(args.database, args.output)


if __name__ == "__main__":
    main()
