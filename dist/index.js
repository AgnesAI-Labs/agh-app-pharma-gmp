// src/index.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { toolPolicyKind } from "@agnes/extension-api";
import { defineAgnesPlugin, defineTool, toolError } from "@agnes/plugin-runtime";
import { Type as Type2 } from "@sinclair/typebox";

// src/model.ts
var label = (zh, en) => ({ en, "zh-CN": zh });
var out = (m) => m.value < m.min || m.value > m.max;
var DEMO_DATE = "2024-10-20";
var SIGNATURE_MEANINGS = {
  en: "I approve this batch for release after reviewing the complete quality dossier.",
  "zh-CN": "\u6211\u5DF2\u5BA1\u6838\u5B8C\u6574\u8D28\u91CF\u6863\u6848\uFF0C\u6279\u51C6\u672C\u6279\u653E\u884C\u3002"
};
var SIGNATURE_MEANING = `${SIGNATURE_MEANINGS.en} / ${SIGNATURE_MEANINGS["zh-CN"]}`;
function confirmationLabel(mode, principal, locale) {
  const zh = locale === "zh-CN";
  if (mode === "auto-confirmed under full access")
    return zh ? `\u5B8C\u5168\u8BBF\u95EE\u4E0B\u81EA\u52A8\u786E\u8BA4\uFF08\u4E3B\u4F53 ${principal}\uFF09` : `Auto-confirmed under full access (principal ${principal})`;
  if (mode === "manual") return zh ? `\u5DF2\u7531\u771F\u4EBA\u7B7E\u7F72: ${principal}` : `Signed by ${principal}`;
  return zh ? `\u786E\u8BA4\u65B9\u5F0F\u672A\u8BB0\u5F55\uFF08\u4E3B\u4F53 ${principal}\uFF09` : `Confirmation mode not recorded (principal ${principal})`;
}

// src/policy.ts
import { defaultToolPolicy } from "@agnes/extension-api";
var qualityPolicy = {
  id: "sableleaf-quality",
  version: "1.0.0",
  decide(input, signal, ports) {
    signal.throwIfAborted();
    const args = input.call.args;
    if (input.call.name === "pharma_report" && input.policy.requiresApproval === "never" && !input.policy.isDestructive && args && typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === 2 && args.kind === "em" && (args.locale === "zh-CN" || args.locale === "en"))
      return {
        effect: "allow",
        reason: "Synthetic EM export only: reads quality state and creates new owned report files"
      };
    return defaultToolPolicy.decide(input, signal, ports);
  }
};

// src/quality.ts
function batchOf(p, id2) {
  const b = p.batches.find((b2) => b2.id === id2);
  if (!b) throw new Error("Batch not found / \u6279\u6B21\u4E0D\u5B58\u5728");
  return b;
}
function emStatus(p, sample2) {
  const room2 = p.rooms.find((r) => r.id === sample2.room);
  if (sample2.viable > room2.viableAction || sample2.particles > room2.particleAction) return "action";
  if (sample2.viable > room2.viableAlert || sample2.particles > room2.particleAlert) return "alert";
  return "control";
}
function findings(p, id2) {
  const b = batchOf(p, id2);
  return b.steps.flatMap((s) => [
    ...s.cpp.filter(out).map((m) => ({
      severity: "major",
      code: "CPP",
      text: label(
        `${m.name["zh-CN"]} ${m.value} ${m.unit}\uFF0C\u9650\u5EA6 ${m.min}\u2013${m.max}\uFF1B\u539F\u59CB\u7ED3\u679C\u4FDD\u7559`,
        `${m.name.en} ${m.value} ${m.unit}, limit ${m.min}\u2013${m.max}; original retained`
      ),
      source: m.source
    })),
    ...!s.verifier || s.verifier.actor === s.operator.actor || s.verifier.at < s.at ? [
      {
        severity: "major",
        code: "ALCOA",
        text: label(
          "\u72EC\u7ACB\u590D\u6838\u7B7E\u540D\u7F3A\u5931\u6216\u65F6\u5E8F\u5F02\u5E38",
          "Missing independent verification or inconsistent timestamps"
        ),
        source: s.id
      }
    ] : [],
    ...p.equipment.filter((e) => e.id === s.equipment && (e.due < s.at.slice(0, 10) || e.qualification !== "qualified")).map((e) => ({
      severity: "major",
      code: "EQUIPMENT",
      text: label(`${e.id} \u6821\u51C6\u6216\u786E\u8BA4\u4E0D\u5408\u683C`, `${e.id} calibration/qualification issue`),
      source: e.id
    }))
  ]);
}
function dossier(p, id2) {
  const b = batchOf(p, id2), deviations = p.deviations.filter((d) => d.batch === id2 || d.impact.includes(id2));
  const originalsResolved = b.steps.flatMap((s) => s.cpp.filter(out)).every(
    (m) => b.retests.some((r) => r.id === `RETEST-${m.id}` && !out(r)) && deviations.some((d) => d.stage === "closed")
  );
  const rows = [
    {
      key: "bpr",
      title: label("\u6279\u8BB0\u5F55\u53CA ALCOA+ \u590D\u6838", "BPR and ALCOA+ review"),
      pass: b.review === "accepted" && b.steps.every((s) => s.verifier && s.verifier.actor !== s.operator.actor && s.verifier.at >= s.at) && originalsResolved
    },
    {
      key: "deviations",
      title: label("\u504F\u5DEE\u7ED3\u6848 / \u5173\u8054\u6279\u6B21\u5F71\u54CD\u5DF2\u8BC4\u4F30", "Deviations closed / linked-batch impact assessed"),
      pass: deviations.every((d) => d.stage === "closed")
    },
    {
      key: "em",
      title: label("\u73AF\u5883\u4E8B\u4EF6\u98CE\u9669\u8BC4\u4F30\u4E0E\u5904\u7F6E\u8BC1\u636E", "EM risk assessment and disposition evidence"),
      pass: b.steps.every((step2) => p.samples.some((s) => s.batch === id2 && s.room === step2.room)) && p.samples.filter((s) => s.batch === id2 && emStatus(p, s) !== "control").every((s) => s.disposition === "assessed" && Boolean(s.evidence))
    },
    {
      key: "qc",
      title: label("QC \u542B\u91CF / \u6742\u8D28 / \u6EB6\u51FA / \u5FAE\u751F\u7269", "QC assay / impurities / dissolution / micro"),
      pass: b.qc.length === 4 && b.qc.every((m) => !out(m))
    },
    {
      key: "equipment",
      title: label("\u8BBE\u5907\u786E\u8BA4\u53CA\u4F7F\u7528\u65F6\u6821\u51C6\u8FFD\u6EAF", "Equipment qualification and use-time calibration"),
      pass: b.steps.every((s) => {
        const e = p.equipment.find((e2) => e2.id === s.equipment);
        return e && e.qualification === "qualified" && e.due >= DEMO_DATE && (e.calibrated <= s.at.slice(0, 10) || e.evidence.some((x) => x.startsWith("RETROSPECTIVE:") && x.includes(id2)));
      })
    },
    { key: "production", title: label("\u751F\u4EA7\u5B8C\u6210", "Production complete"), pass: b.status !== "production" }
  ];
  return {
    batch: id2,
    revision: p.revision,
    asOf: DEMO_DATE,
    signatureMeaning: SIGNATURE_MEANING,
    ready: rows.every((r) => r.pass),
    rows,
    blockers: rows.filter((r) => !r.pass).map((r) => r.key),
    findings: findings(p, id2),
    evidence: {
      recordApprovals: p.audit.filter((entry) => entry.record === id2 && entry.approval).map((entry) => ({
        action: entry.action,
        approvalId: entry.approval,
        recordedBy: entry.actor,
        ...entry.confirmationMode ? { confirmationMode: entry.confirmationMode } : {},
        recordedAt: entry.at,
        reviewedRevision: entry.fromRevision
      })),
      deviations,
      retests: b.retests,
      equipment: p.equipment.filter((e) => b.steps.some((s) => s.equipment === e.id)),
      em: p.samples.filter((s) => s.batch === id2 && emStatus(p, s) !== "control"),
      interpretation: label(
        "findings \u4FDD\u7559\u539F\u59CB\u5386\u53F2\u53D1\u73B0\uFF1B\u5F53\u524D\u963B\u65AD\u4EE5 blockers \u548C rows.pass \u4E3A\u51C6\uFF0C\u987B\u7ED3\u5408\u504F\u5DEE\u7ED3\u6848\u53CA\u6279\u51C6\u8FD4\u5DE5\u590D\u9A8C\u4F9D\u636E\u5BA1\u9605\u3002revision \u662F\u5F53\u524D\u72B6\u6001\u7248\u672C\uFF1B\u8BC1\u4E66 dossierRevision \u662F\u7B7E\u7F72\u524D\u88AB\u5BA1\u9605\u7684\u7248\u672C\uFF0C\u7B7E\u7F72\u672C\u8EAB\u4F7F\u72B6\u6001\u7248\u672C\u52A0\u4E00\u3002asOf \u662F\u5408\u6210\u4E1A\u52A1\u573A\u666F\u65E5\u671F\uFF0CCAPA \u5230\u671F\u6309\u8BE5\u65E5\u671F\u8BC4\u4F30\uFF1B\u5BA1\u8BA1 recordedAt \u662F\u5F53\u524D\u771F\u5B9E\u8BB0\u5F55\u65F6\u95F4\u3002certificate \u4EC5\u7528\u4E8E\u6700\u7EC8 QA \u653E\u884C\uFF1Bnull \u4E0D\u4EE3\u8868\u524D\u9762\u7684\u8D28\u91CF\u8BB0\u5F55\u672A\u7B7E\u540D\uFF0CrecordApprovals \u5F15\u7528\u5404\u6B21\u7B7E\u7F72\u51B3\u7B56\u5E76\u4FDD\u7559\u786E\u8BA4\u65B9\u5F0F\u3002assessed \u662F\u8B66\u6212\u98CE\u9669\u8BC4\u4F30\uFF0C\u4E0D\u7B49\u540C\u4E8E\u884C\u52A8\u9650\u4E8B\u4EF6\u81EA\u52A8\u5173\u95ED\u3002017 \u653E\u884C\u4E0D\u4EE3\u8868\u5173\u8054\u6279\u6B21 016/018 \u653E\u884C\uFF0C\u5B83\u4EEC\u4ECD\u7531\u5404\u81EA\u6863\u6848\u51B3\u5B9A\u5904\u7F6E\u3002",
        "findings retain original historical observations. Current blockers are the failed checklist rows; review deviation closure and approved reprocessing/retest evidence. revision is current state; certificate.dossierRevision identifies the pre-signature dossier reviewed. Signing itself increments state revision by one. asOf is synthetic business time and the basis for CAPA due-date assessment; audit recordedAt is actual recording time. certificate is only the final QA release certificate: null does not mean earlier records were unsigned; recordApprovals reference their signature decisions and confirmation mode. assessed means an alert risk assessment, not automatic closure of an action excursion. Release of 017 does not release linked batches 016/018; each retains its own dossier and disposition requirements."
      )
    },
    certificate: b.certificate
  };
}
function investigation(p, id2) {
  const b = batchOf(p, id2), equipment2 = p.equipment.filter((e) => b.steps.some((s) => s.equipment === e.id));
  const em = p.samples.filter((s) => s.batch === id2 && emStatus(p, s) !== "control");
  const suspect = equipment2.filter((e) => e.due < DEMO_DATE || e.qualification !== "qualified");
  return {
    batch: id2,
    revision: p.revision,
    findings: findings(p, id2),
    em,
    rooms: p.rooms.filter((room2) => b.steps.some((step2) => step2.room === room2.id)),
    equipment: equipment2,
    relatedBatches: p.batches.filter((x) => x.id !== id2 && x.steps.some((s) => suspect.some((e) => e.id === s.equipment))).map((b2) => b2.id),
    hypothesis: label(
      "\u63A2\u5934\u6F02\u79FB\u53EF\u80FD\u5BFC\u81F4\u5E72\u71E5\u7EC8\u70B9\u8BEF\u5224\uFF1BEM \u8B66\u6212\u4EC5\u65F6\u95F4\u7A7A\u95F4\u76F8\u5173\uFF0C\u4E0D\u80FD\u8BC1\u660E\u540C\u4E00\u6839\u56E0\u3002\u9700\u6821\u51C6\u524D\u540E\u6570\u636E\u548C\u6E05\u6D01\u8C03\u67E5\u9A8C\u8BC1\u3002",
      "Probe drift may cause an incorrect drying endpoint. EM is temporally/spatially correlated, not proof of a shared cause. Verify with as-found/as-left calibration and cleaning investigation."
    )
  };
}
function dashboard(p) {
  const open = p.deviations.filter((d) => d.stage !== "closed");
  return {
    batches: p.batches.length,
    production: p.batches.filter((b) => b.status === "production").length,
    awaiting: p.batches.filter((b) => b.status === "review").length,
    released: p.batches.filter((b) => b.status === "released").length,
    rft: Math.round(
      100 * p.batches.filter(
        (b) => !p.deviations.some((d) => d.batch === b.id) && !findings(p, b.id).length && !p.equipment.some(
          (equipment2) => equipment2.evidence.some((evidence) => evidence.startsWith(`RETROSPECTIVE:${b.id}:`))
        )
      ).length / p.batches.length
    ),
    deviations: Object.fromEntries(
      ["minor", "major", "critical"].map((c) => [c, open.filter((d) => d.severity === c).length])
    ),
    overdue: open.flatMap((d) => d.actions).filter((a) => !a.effective && a.due < DEMO_DATE).length,
    excursions: p.samples.filter((s) => emStatus(p, s) !== "control" && s.disposition === "pending").length
  };
}

// src/seed.ts
var at = (day, hour = 9) => `2024-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
var measure = (id2, zh, en, value, unit, min, max, time) => ({
  id: id2,
  name: label(zh, en),
  value: Number(value.toFixed(3)),
  unit,
  min,
  max,
  at: time,
  source: `LIMS-${id2}`
});
var operations = [
  [
    "dispensing",
    "\u79F0\u91CF",
    "Dispensing",
    "BAL-01",
    "D-101",
    "\u79F0\u91CF\u504F\u5DEE",
    "Dispensing variance",
    0.1,
    "%",
    -0.5,
    0.5
  ],
  [
    "granulation",
    "\u5236\u7C92",
    "Granulation",
    "GR-01",
    "C-201",
    "\u8FDB\u98CE\u6E29\u5EA6",
    "Inlet air temperature",
    62,
    "\xB0C",
    55,
    70
  ],
  ["drying", "\u5E72\u71E5", "Drying", "DR-02", "C-201", "\u5E72\u71E5\u5931\u91CD", "Loss on drying", 1.8, "%", 1, 2.5],
  [
    "blending",
    "\u6DF7\u5408",
    "Blending",
    "BL-01",
    "D-202",
    "\u6DF7\u5408\u5747\u5300\u5EA6 RSD",
    "Blend uniformity RSD",
    2.1,
    "%",
    0,
    5
  ],
  [
    "compression",
    "\u538B\u7247 / \u80F6\u56CA\u586B\u5145",
    "Compression / capsule filling",
    "PR-01",
    "D-203",
    "\u88C5\u91CF\u504F\u5DEE",
    "Unit weight variance",
    1.2,
    "%",
    -5,
    5
  ],
  ["coating", "\u5305\u8863", "Coating", "CT-01", "D-204", "\u5305\u8863\u589E\u91CD", "Coating weight gain", 3, "%", 2.5, 3.5],
  ["packaging", "\u5305\u88C5", "Packaging", "PK-01", "D-301", "\u5728\u7EBF\u5254\u9664\u7387", "Online reject rate", 0.2, "%", 0, 1]
];
function seed() {
  const batches = Array.from({ length: 36 }, (_, i) => {
    const n = i + 1, day = n <= 20 ? n : n - 16, shift = n > 20 ? 7 : 0, incident = n === 17;
    const form = n % 5 === 0 ? "capsule" : "tablet";
    const steps = operations.filter((s) => form === "tablet" || s[0] !== "coating").map((op, index) => {
      const [id2, zh, en, equipment2, room2, mzh, men, v, unit, min, max] = op;
      const equipmentId = id2 === "compression" && form === "capsule" ? "CF-01" : equipment2 === "DR-02" && ![16, 17, 18].includes(n) ? "DR-01" : equipment2;
      const time = at(day, 7 + index + shift);
      const cpp = [
        measure(
          `${n}-${id2}`,
          mzh,
          men,
          incident && id2 === "drying" ? 3.4 : v + n % 3 * (id2 === "granulation" ? 1 : 0.01),
          unit,
          min,
          max,
          time
        )
      ];
      if (id2 === "compression" && form === "tablet")
        cpp.push(
          measure(`${n}-hardness`, "\u786C\u5EA6", "Hardness", 75 + n % 8, "N", 60, 100, time),
          measure(`${n}-friability`, "\u8106\u788E\u5EA6", "Friability", 0.22, "%", 0, 1, time)
        );
      cpp.forEach((m) => {
        m.source = `EBR:${equipmentId}:${m.id}`;
      });
      return {
        id: id2,
        name: id2 === "compression" ? label(
          form === "tablet" ? "\u538B\u7247" : "\u80F6\u56CA\u586B\u5145",
          form === "tablet" ? "Compression" : "Capsule filling"
        ) : label(zh, en),
        equipment: equipmentId,
        room: room2,
        at: time,
        cpp,
        operator: {
          actor: "demo.operator.lin",
          at: time,
          meaning: label("\u64CD\u4F5C\u5B8C\u6210", "Operation completed")
        },
        verifier: n > 26 && index > 3 ? null : {
          actor: "demo.verifier.wen",
          at: at(day, 8 + index + shift),
          meaning: label("\u72EC\u7ACB\u590D\u6838", "Independent verification")
        }
      };
    });
    return {
      id: `B-2410-${String(n).padStart(3, "0")}`,
      product: label(
        form === "tablet" ? "\u793A\u4F8B\u7247\u5242 250 mg" : "\u793A\u4F8B\u80F6\u56CA 100 mg",
        form === "tablet" ? "Reference tablets 250 mg" : "Reference capsules 100 mg"
      ),
      form,
      size: 12e4 + n * 1e3,
      date: at(day),
      status: n < 12 ? "released" : n > 26 ? "production" : "review",
      review: n < 12 ? "accepted" : "pending",
      steps,
      qc: n > 26 ? [] : [
        measure(
          `${n}-assay`,
          "\u542B\u91CF",
          "Assay",
          99.1 + n % 3 * 0.3,
          "% label",
          95,
          105,
          at(day, shift ? 23 : 16)
        ),
        measure(
          `${n}-impurity`,
          "\u603B\u6742\u8D28",
          "Total impurities",
          0.18,
          "%",
          0,
          0.5,
          at(day, shift ? 23 : 16)
        ),
        measure(
          `${n}-dissolution`,
          "\u6EB6\u51FA\u5EA6\uFF08S1\uFF0C6 \u5355\u4F4D\u6700\u4F4E\u503C\uFF09",
          "Dissolution (S1 minimum of 6 units)",
          88,
          "%",
          85,
          100,
          at(day, shift ? 23 : 16)
        ),
        measure(`${n}-micro`, "\u9700\u6C27\u83CC\u603B\u6570", "TAMC", 12, "CFU/g", 0, 1e3, at(day, shift ? 23 : 16))
      ],
      deviationIds: incident ? ["DEV-2410-017"] : [],
      retests: [],
      certificate: n < 12 ? {
        id: `REL-SEED-${n}`,
        batch: `B-2410-${String(n).padStart(3, "0")}`,
        at: at(day, 18),
        signer: "demo.qa.su",
        meaning: "Synthetic historical release / \u5408\u6210\u5386\u53F2\u653E\u884C",
        approvalId: "synthetic-seed",
        subjectRevision: "seed",
        dossierRevision: 0
      } : null
    };
  });
  const deviationBatches = [11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24].map((i) => batches[i]);
  return {
    version: 1,
    revision: 0,
    batches,
    equipment: [
      ...[
        ["BAL-01", "\u79F0\u91CF\u5929\u5E73", "Dispensing balance"],
        ["GR-01", "\u6D41\u5316\u5E8A\u5236\u7C92\u673A", "Fluid-bed granulator"],
        ["DR-01", "\u6D41\u5316\u5E8A\u5E72\u71E5\u673A T01", "Fluid-bed dryer T01"],
        ["BL-01", "\u6599\u6597\u6DF7\u5408\u673A", "Bin blender"],
        ["PR-01", "\u65CB\u8F6C\u538B\u7247\u673A", "Rotary tablet press"],
        ["CF-01", "\u80F6\u56CA\u586B\u5145\u673A", "Capsule filler"],
        ["CT-01", "\u5305\u8863\u673A", "Tablet coater"],
        ["PK-01", "\u6CE1\u7F69\u5305\u88C5\u7EBF", "Blister packaging line"]
      ].map(([id2, zh, en]) => ({
        id: id2,
        name: label(zh, en),
        due: "2025-02-01",
        qualification: "qualified",
        calibrated: "2024-08-01",
        evidence: ["CAL-SEED-PASS"]
      })),
      {
        id: "DR-02",
        name: label("\u6D41\u5316\u5E8A\u5E72\u71E5\u673A \xB7 \u63A2\u5934 T02", "Fluid-bed dryer \xB7 probe T02"),
        due: "2024-10-16",
        qualification: "suspended",
        calibrated: "2024-04-16",
        evidence: []
      }
    ],
    rooms: [
      {
        id: "A-001",
        grade: "A",
        name: label("\u53C2\u8003\uFF1A\u65E0\u83CC\u5173\u952E\u533A\uFF08\u672A\u7528\u4E8E\u672C\u4EA7\u7EBF\uFF09", "Reference: sterile critical zone (unused)"),
        viableAlert: 0,
        viableAction: 0,
        particleAlert: 2500,
        particleAction: 3520
      },
      {
        id: "B-001",
        grade: "B",
        name: label("\u53C2\u8003\uFF1A\u80CC\u666F\u533A\uFF08\u672A\u7528\u4E8E\u672C\u4EA7\u7EBF\uFF09", "Reference: background zone (unused)"),
        viableAlert: 5,
        viableAction: 10,
        particleAlert: 25e4,
        particleAction: 352e3
      },
      {
        id: "C-201",
        grade: "C",
        name: label("\u5236\u7C92 / \u5E72\u71E5\u95F4", "Granulation / drying"),
        viableAlert: 50,
        viableAction: 100,
        particleAlert: 25e5,
        particleAction: 352e4
      },
      ...["D-101", "D-202", "D-203", "D-204", "D-301"].map((id2) => ({
        id: id2,
        grade: "D",
        name: label("\u56FA\u4F53\u5236\u5242\u751F\u4EA7\u533A", "OSD production"),
        viableAlert: 100,
        viableAction: 200,
        particleAlert: 3e6,
        particleAction: 5e6
      }))
    ],
    samples: Array.from({ length: 240 }, (_, i) => {
      const day = i % 20 + 1, room2 = ["C-201", "D-101", "D-202", "D-203", "D-204", "D-301"][Math.floor(i / 20) % 6];
      const incident = room2 === "C-201" && day === 17, action = room2 === "C-201" && day === 19;
      return {
        id: `EM-${String(i + 1).padStart(4, "0")}`,
        room: room2,
        batch: `B-2410-${String(day).padStart(3, "0")}`,
        at: at(day, i < 120 ? 10 : 14),
        viable: action ? 121 : incident ? 72 : 8 + i * 7 % 35,
        particles: 3e5 + i * 137 % 3e5,
        disposition: incident || action ? "pending" : "assessed",
        evidence: incident || action ? "" : "EM-SEED-REVIEW"
      };
    }),
    deviations: [
      {
        id: "DEV-2410-017",
        batch: "B-2410-017",
        severity: "major",
        title: label("\u5E72\u71E5 LOD \u8D85\u9650\u4E0E\u540C\u5BA4 EM \u8B66\u6212", "Drying LOD excursion and same-room EM alert"),
        stage: "open",
        opened: at(17, 12),
        cause: "",
        impact: [],
        why: [],
        actions: []
      },
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `DEV-2410-${String(40 + i).padStart(3, "0")}`,
        batch: deviationBatches[i].id,
        severity: i === 0 ? "critical" : i % 3 === 0 ? "major" : "minor",
        title: label(
          i === 0 ? "\u5305\u88C5\u6DF7\u6DC6\u9669\u60C5\uFF08\u9694\u79BB\u4E2D\uFF09" : "\u751F\u4EA7\u8BB0\u5F55\u590D\u6838\u9879",
          i === 0 ? "Packaging mix-up near miss (quarantined)" : "Production documentation finding"
        ),
        stage: ["investigation", "capa", "effectiveness", "closed"][i % 4],
        opened: at(Number(deviationBatches[i].date.slice(8, 10)), 17),
        cause: "Synthetic investigation / \u5408\u6210\u8C03\u67E5",
        impact: [deviationBatches[i].id],
        why: [],
        actions: [
          {
            id: `CAPA-${40 + i}`,
            text: label("\u57F9\u8BAD\u548C\u72EC\u7ACB\u590D\u6838", "Training and independent verification"),
            owner: "demo.qa.rao",
            due: new Date(Date.parse(deviationBatches[i].date) + 2 * 864e5).toISOString().slice(0, 10),
            evidence: i % 4 === 3 ? "EV-SEED" : "",
            effective: i % 4 === 3
          }
        ]
      }))
    ],
    audit: [
      {
        id: "AUD-0000",
        at: at(20),
        actor: "synthetic.seed",
        action: "seed",
        record: "plant",
        fromRevision: 0,
        toRevision: 0,
        reason: "Fixed synthetic scenario / \u56FA\u5B9A\u5408\u6210\u573A\u666F",
        session: null,
        approval: null
      }
    ]
  };
}

// src/records.ts
function read(store) {
  if (!store) throw new Error("Owner store unavailable / \u4E1A\u52A1\u5B58\u50A8\u4E0D\u53EF\u7528");
  const value = store.get("plant.header");
  if (value === void 0) return seed();
  const state = value;
  if (state.version !== 1) throw new Error("Unsupported plant state / \u4E0D\u652F\u6301\u7684\u6570\u636E\u7248\u672C");
  function rows(family) {
    const result2 = [];
    let cursor;
    do {
      const page = store.scan({ prefix: `plant.${family}.`, limit: 256, ...cursor ? { cursor } : {} });
      for (const row of page.rows) result2.push(...row.value);
      cursor = page.nextCursor;
    } while (cursor);
    return result2;
  }
  return {
    ...state,
    batches: rows("batches"),
    equipment: rows("equipment"),
    rooms: rows("rooms"),
    samples: rows("samples"),
    deviations: rows("deviations"),
    audit: rows("audit")
  };
}
function persist(store, p) {
  store.set("plant.header", { version: p.version, revision: p.revision });
  for (const family of ["batches", "equipment", "rooms", "samples", "deviations", "audit"]) {
    const rows = p[family];
    for (let i = 0; i < rows.length; i += 4)
      store.set(
        `plant.${family}.${String(i).padStart(6, "0")}`,
        JSON.parse(JSON.stringify(rows.slice(i, i + 4)))
      );
  }
}
function write(store, revision2, identity, action, record2, reason, mutate) {
  if (!store) throw new Error("Owner store unavailable / \u4E1A\u52A1\u5B58\u50A8\u4E0D\u53EF\u7528");
  return store.transaction(() => {
    const p = read(store);
    if (p.revision !== revision2) throw new Error("Stale dossier; refresh and review / \u6863\u6848\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u590D\u6838");
    if (p.audit.length >= 2e3) throw new Error("Demo audit capacity reached / \u6F14\u793A\u5BA1\u8BA1\u5BB9\u91CF\u5DF2\u6EE1");
    mutate(p);
    p.revision++;
    p.audit.push({
      id: `AUD-${String(p.revision).padStart(4, "0")}`,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      actor: identity.approval?.answeredBy.id ?? identity.actor,
      action,
      record: record2,
      fromRevision: revision2,
      toRevision: p.revision,
      reason,
      session: identity.session,
      approval: identity.approval?.requestId ?? null,
      ...identity.approval ? { confirmationMode: identity.approval.confirmationMode ?? "manual" } : {},
      ...identity.approval?.signedMeaning ? { signatureMeaning: identity.approval.signedMeaning } : {}
    });
    persist(store, p);
    return p;
  }, identity.approval?.admission);
}
function change(store, input, who2) {
  if (!who2.approval || ["agent", "system"].includes(who2.approval.answeredBy.role) || who2.approval.confirmationMode === "auto-confirmed under full access" && !who2.approval.admission)
    throw new Error("Human Host approval proof required / \u9700\u8981\u5BBF\u4E3B\u4EBA\u5DE5\u6279\u51C6\u51ED\u8BC1");
  return write(
    store,
    input.expectedRevision,
    who2,
    input.action,
    input.batch,
    input.evidence ?? "Quality review / \u8D28\u91CF\u590D\u6838",
    (p) => {
      const b = batchOf(p, input.batch);
      if (b.status === "released") throw new Error("Released record is locked / \u5DF2\u653E\u884C\u8BB0\u5F55\u9501\u5B9A");
      const dev = p.deviations.find((d) => d.batch === b.id && d.stage !== "closed");
      if (input.action === "investigate") {
        if (!dev || dev.stage !== "open") throw new Error("Deviation must be open / \u504F\u5DEE\u987B\u5904\u4E8E\u5F85\u8C03\u67E5");
        const correlation = investigation(p, b.id);
        dev.stage = "investigation";
        dev.impact = [b.id, ...correlation.relatedBatches];
        dev.cause = "Hypothesis: dryer probe drift; EM co-occurrence needs independent investigation / \u5047\u8BBE\uFF1A\u5E72\u71E5\u63A2\u5934\u6F02\u79FB\uFF1BEM \u540C\u671F\u8B66\u6212\u9700\u72EC\u7ACB\u8C03\u67E5";
        dev.why = [
          "LOD high / LOD \u504F\u9AD8",
          "Endpoint indicated too early / \u7EC8\u70B9\u63D0\u524D\u6307\u793A",
          "Probe T02 drift suspected / \u6000\u7591 T02 \u6F02\u79FB",
          "Calibration interval exceeded / \u6821\u51C6\u903E\u671F",
          "Escalation not enforced / \u903E\u671F\u5347\u7EA7\u672A\u843D\u5B9E"
        ];
        dev.actions = [
          {
            id: "CAPA-017-1",
            text: label("\u66F4\u6362\u63A2\u5934\u5E76\u6821\u51C6\uFF1B\u8FFD\u6EAF\u53D7\u5F71\u54CD\u6279\u6B21", "Replace/calibrate probe; assess affected batches"),
            owner: "demo.engineer.qiu",
            due: "2024-10-21",
            evidence: "",
            effective: false
          },
          {
            id: "CAPA-017-2",
            text: label(
              "\u6279\u51C6\u8FD4\u5DE5\u65B9\u6848\u3001\u72EC\u7ACB\u590D\u9A8C\u548C\u8FDE\u7EED\u4E09\u6279\u786E\u8BA4",
              "Approve reprocessing protocol, independent retest and three-batch verification"
            ),
            owner: "demo.qa.su",
            due: "2024-10-23",
            evidence: "",
            effective: false
          },
          {
            id: "CAPA-017-3",
            text: label("EM \u83CC\u79CD\u9274\u5B9A\u3001\u6E05\u6D01\u548C\u590D\u91C7\u6837", "EM identification, cleaning and resampling"),
            owner: "demo.micro.yao",
            due: "2024-10-22",
            evidence: "",
            effective: false
          }
        ];
      } else if (input.action === "advance") {
        if (b.id !== "B-2410-017" || !dev || !["investigation", "capa", "effectiveness"].includes(dev.stage))
          throw new Error("No scenario transition / \u65E0\u53EF\u7528\u573A\u666F\u6D41\u8F6C");
        if (!input.evidence?.trim() || input.evidence.trim().length < 12)
          throw new Error("Evidence reference and rationale required / \u8BF7\u8F93\u5165\u8BC1\u636E\u7F16\u53F7\u53CA\u4F9D\u636E");
        if (dev.stage === "investigation") {
          dev.stage = "capa";
          dev.cause = `Confirmed in synthetic evidence: T02 as-found +4.1 \xB0C drift; independent EM assessment remains pending / \u5408\u6210\u8BC1\u636E\u786E\u8BA4 T02 \u6F02\u79FB +4.1 \xB0C\uFF1BEM \u72EC\u7ACB\u8BC4\u4F30\u4ECD\u5F85\u5B8C\u6210\u3002 Calibration evidence / \u6821\u51C6\u8BC1\u636E: CAPA-017-1`;
          dev.why = dev.why.map(
            (step2) => step2.includes("drift suspected") ? `Probe T02 drift confirmed by synthetic as-found evidence / \u5408\u6210 as-found \u8BC1\u636E\u786E\u8BA4 T02 \u6F02\u79FB: ${input.evidence}` : step2
          );
          const calibration = dev.actions.find((action) => action.id === "CAPA-017-1");
          if (calibration)
            calibration.evidence = `CALIBRATION-ASFOUND [historical r${input.expectedRevision}\u2192r${input.expectedRevision + 1}; EM status then only / \u5F53\u65F6 EM \u72B6\u6001]:${input.evidence}`;
        } else if (dev.stage === "capa") {
          dev.stage = "effectiveness";
          dev.cause = dev.cause.replace("independent EM assessment remains pending /", "independent EM assessment completed /").replace("EM \u72EC\u7ACB\u8BC4\u4F30\u4ECD\u5F85\u5B8C\u6210\u3002", "EM \u9274\u522B\u3001\u6E05\u6D01\u4E0E\u590D\u91C7\u6837\u98CE\u9669\u8BC4\u4F30\u5DF2\u5B8C\u6210\u3002");
          const e = p.equipment.find((e2) => e2.id === "DR-02");
          e.calibrated = "2024-10-20";
          e.due = "2025-04-20";
          e.qualification = "qualified";
          e.evidence.push(
            `CAL-ASLEFT-PASS:${dev.actions[0]?.evidence ?? input.evidence}`,
            `SUBSEQUENT-EM-ASSESSMENT [r${input.expectedRevision + 1}]:${input.evidence}`,
            ...dev.impact.map((id2) => `RETROSPECTIVE:${id2}:${dev.actions[0]?.evidence ?? input.evidence}`)
          );
          for (const action of dev.actions.filter((item) => ["CAPA-017-2", "CAPA-017-3"].includes(item.id)))
            action.evidence = `${action.id === "CAPA-017-2" ? "REPROCESS-RETEST" : "EM-ASSESSMENT"}:${input.evidence}`;
          const original = b.steps.find((s) => s.id === "drying").cpp[0];
          b.retests.push({
            ...original,
            id: `RETEST-${original.id}`,
            value: 1.9,
            at: `${DEMO_DATE}T12:00:00Z`,
            source: `REPROCESS-PROTOCOL-017:${input.evidence}`
          });
          p.samples.filter((s) => s.batch === b.id).forEach((s) => {
            s.disposition = "assessed";
            s.evidence = input.evidence;
          });
        } else {
          dev.actions.forEach((a) => {
            a.effective = true;
            a.evidence += `; EFFECTIVENESS:${input.evidence}`;
          });
          dev.stage = "closed";
        }
      } else {
        b.review = "accepted";
        const check = dossier(p, b.id);
        if (!check.ready) b.review = "findings";
      }
    }
  );
}
function release(store, input, who2) {
  if (!who2.approval || ["agent", "system"].includes(who2.approval.answeredBy.role) || who2.approval.confirmationMode === "auto-confirmed under full access" && !who2.approval.admission)
    throw new Error("Human Host approval proof required / \u9700\u8981\u5BBF\u4E3B\u4EBA\u5DE5\u6279\u51C6\u51ED\u8BC1");
  if (input.meaning !== SIGNATURE_MEANING)
    throw new Error("Exact signature meaning required / \u7B7E\u540D\u542B\u4E49\u4E0D\u5339\u914D");
  return write(store, input.expectedRevision, who2, "release", input.batch, input.meaning, (p) => {
    const b = batchOf(p, input.batch), check = dossier(p, b.id);
    if (b.certificate || !check.ready)
      throw new Error("Release blocked by quality checklist / \u8D28\u91CF\u6E05\u5355\u963B\u6B62\u653E\u884C");
    b.status = "released";
    b.certificate = {
      id: `REL-${b.id}-${p.revision}`,
      batch: b.id,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      signer: who2.approval.answeredBy.id,
      confirmationMode: who2.approval.confirmationMode ?? "manual",
      meaning: who2.approval.signedMeaning ?? input.meaning,
      approvalId: who2.approval.requestId,
      subjectRevision: who2.approval.subjectRevision,
      dossierRevision: p.revision
    };
  });
}

// src/print-report.ts
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function printReport(lines) {
  const blocks = [];
  let list2 = false;
  const closeList = () => {
    if (list2) blocks.push("</ul>");
    list2 = false;
  };
  const cells = (line) => line.trim().slice(1, -1).split("|").map((cell) => escapeHtml(cell.trim()));
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[-:| ]+\|$/)) {
      closeList();
      blocks.push(
        `<table><thead><tr>${cells(line).map((cell) => `<th scope="col">${cell}</th>`).join("")}</tr></thead><tbody>`
      );
      i++;
      while (lines[i + 1]?.startsWith("|"))
        blocks.push(
          `<tr>${cells(lines[++i] ?? "").map((cell) => `<td>${cell}</td>`).join("")}</tr>`
        );
      blocks.push("</tbody></table>");
    } else if (/^#{2,3} /.test(line)) {
      closeList();
      const level = line.startsWith("### ") ? 3 : 2;
      blocks.push(`<h${level}>${escapeHtml(line.slice(level + 1))}</h${level}>`);
    } else if (line.startsWith("- ")) {
      if (!list2) {
        blocks.push("<ul>");
        list2 = true;
      }
      blocks.push(
        `<li>${escapeHtml(line.slice(2)).replace(/^\[x\]/, "\u2713").replace(/^\[ \]/, "\u25CB")}</li>`
      );
    } else {
      closeList();
      blocks.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return blocks.join("\n");
}

// src/report-sections.ts
function dossierSections(p, id2, locale) {
  const b = batchOf(p, id2), zh = locale === "zh-CN", t = (cn, en) => zh ? cn : en;
  return [
    "",
    `## ${t("\u539F\u59CB\u6279\u8BB0\u5F55 / IPC", "Original BPR / IPC")}`,
    t(
      "| \u5DE5\u5E8F | \u8BBE\u5907 / \u623F\u95F4 | CPP / IPC | \u7ED3\u679C | \u9650\u5EA6 | \u64CD\u4F5C\u4EBA / \u590D\u6838\u4EBA |",
      "| Step | Equipment / room | CPP / IPC | Result | Limit | Operator / verifier |"
    ),
    "|---|---|---|---|---|---|",
    ...b.steps.flatMap(
      (s) => s.cpp.map(
        (m) => `| ${s.name[locale]} | ${s.equipment} / ${s.room} | ${m.id}: ${m.name[locale]} | ${m.value} ${m.unit}${out(m) ? " OOS" : ""} | ${m.min}\u2013${m.max} | ${s.operator.actor} @ ${s.operator.at}; ${s.verifier?.actor ?? "MISSING"} @ ${s.verifier?.at ?? "\u2014"} |`
      )
    ),
    "",
    `## ${t("QC \u4E0E\u72EC\u7ACB\u590D\u9A8C", "QC and independent retest")}`,
    ...[...b.qc, ...b.retests].map(
      (m) => `- ${m.id}: ${m.name[locale]} = ${m.value} ${m.unit}; ${m.min}\u2013${m.max}; ${m.source}; ${m.at}`
    ),
    "",
    `## ${t("\u504F\u5DEE\u3001\u6839\u56E0\u3001\u8DE8\u6279\u5F71\u54CD\u548C CAPA", "Deviation, root cause, batch impact and CAPA")}`,
    ...p.deviations.filter((d) => d.batch === id2 || d.impact.includes(id2)).flatMap((d) => [
      `### ${d.id} \xB7 ${d.severity} \xB7 ${d.stage}`,
      d.cause || t("\u6839\u56E0\u672A\u786E\u8BA4", "Root cause unconfirmed"),
      `${t("\u5F71\u54CD\u6279\u6B21", "Impact")}: ${d.impact.join(", ")}`,
      ...d.actions.map(
        (a) => `- ${a.id}: ${a.text[locale]}; ${a.owner}; ${t("\u5230\u671F", "due")}=${a.due}; ${t("\u6709\u6548\u6027", "effectiveness")}=${a.effective ? t("\u5DF2\u786E\u8BA4", "confirmed") : t("\u5F85\u786E\u8BA4", "pending")}; ${t("\u8BC1\u636E", "evidence")}=${a.evidence || "MISSING"}`
      )
    ]),
    "",
    `## ${t("\u73AF\u5883\u76D1\u6D4B\u4E0E\u8BBE\u5907\u8FFD\u6EAF", "EM and equipment traceability")}`,
    ...p.samples.filter((s) => s.batch === id2 && emStatus(p, s) !== "control").map(
      (s) => `- ${s.id} / ${s.room} @ ${s.at}: ${s.viable} CFU/m\xB3, ${s.particles} particles/m\xB3; ${emStatus(p, s)}; ${s.disposition}; ${s.evidence || "MISSING"}`
    ),
    ...p.equipment.filter((e) => b.steps.some((s) => s.equipment === e.id)).map(
      (e) => `- ${e.id}: ${e.qualification}; ${t("\u6821\u51C6\u65E5\u671F", "calibrated")}=${e.calibrated}; ${t("\u5230\u671F\u65E5\u671F", "due")}=${e.due}; ${e.evidence.join("; ")}`
    ),
    "",
    `## ${t("\u5BA1\u8BA1\u7D22\u5F15", "Audit index")}`,
    ...p.audit.filter((a) => a.record === id2).map(
      (a) => `- ${a.id} ${a.at} ${a.actor}: ${a.action}; r${a.fromRevision}\u2192r${a.toRevision}; approval=${a.approval ?? "\u2014"}; session=${a.session ?? "\u2014"}; ${a.approval ? confirmationLabel(a.confirmationMode, a.actor, locale) : "\u2014"}`
    )
  ];
}
function reviewSections(p, locale) {
  const zh = locale === "zh-CN", t = (cn, en) => zh ? cn : en;
  const lod = p.batches.flatMap((b) => b.steps.filter((s) => s.id === "drying").flatMap((s) => s.cpp)).map((m) => m.value);
  return [
    "",
    `## ${t("\u4EA7\u54C1\u548C\u8FC7\u7A0B\u56DE\u987E", "Product and process review")}`,
    ...["tablet", "capsule"].map((form) => {
      const batches = p.batches.filter((b) => b.form === form), assay = batches.flatMap((b) => b.qc.filter((m) => m.id.endsWith("-assay")));
      return `- ${form}: n=${batches.length}; units=${batches.reduce((n, b) => n + b.size, 0)}; assay n=${assay.length}, range=${Math.min(...assay.map((m) => m.value))}\u2013${Math.max(...assay.map((m) => m.value))}% label; OOS=${assay.filter(out).length}`;
    }),
    `- LOD: n=${lod.length}; min=${Math.min(...lod)}%; max=${Math.max(...lod)}%; mean=${(lod.reduce((a, b) => a + b, 0) / lod.length).toFixed(2)}%. ${t("\u5305\u542B\u539F\u59CB OOS\uFF1B\u72EC\u7ACB\u590D\u9A8C\u4E0D\u66FF\u6362\u539F\u59CB\u503C\u3002", "Includes original OOS; independent retests do not replace originals.")}`,
    "",
    `## ${t("\u504F\u5DEE\u5468\u8D8B\u52BF\uFF08\u6837\u672C\u8BA1\u6570\uFF0C\u4E0D\u63A8\u65AD\u53D1\u751F\u7387\uFF09", "Weekly deviation trend (counts, not inferred incidence)")}`,
    t("| \u671F\u95F4 | \u6B21\u8981 | \u4E3B\u8981 | \u5173\u952E | \u5408\u8BA1 |", "| Period | Minor | Major | Critical | Total |"),
    "|---|---:|---:|---:|---:|",
    ...[
      [1, 7],
      [8, 14],
      [15, 20]
    ].map(([start, end]) => {
      const records = p.deviations.filter((d) => {
        const day = Number(d.opened.slice(8, 10));
        return day >= start && day <= end;
      });
      return `| 10/${start}\u201310/${end} | ${records.filter((d) => d.severity === "minor").length} | ${records.filter((d) => d.severity === "major").length} | ${records.filter((d) => d.severity === "critical").length} | ${records.length} |`;
    }),
    "",
    `## ${t("\u6709\u6548\u6027\u4E0E\u7BA1\u7406\u8BC4\u5BA1\u5173\u6CE8\u70B9", "Effectiveness and management review")}`,
    ...p.deviations.filter((d) => d.stage !== "closed").map(
      (d) => `- ${d.id}: ${d.stage}; ${d.actions.filter((a) => a.effective).length}/${d.actions.length} CAPA effective`
    ),
    t(
      "\u5EFA\u8BAE\uFF1A\u9A8C\u8BC1\u903E\u671F\u5347\u7EA7\u673A\u5236\u3001\u590D\u6838\u91C7\u6837\u8986\u76D6\u548C CAPA \u6709\u6548\u6027\uFF1B\u672C\u6837\u672C\u4E0D\u8DB3\u4EE5\u8BC1\u660E\u957F\u671F\u8FC7\u7A0B\u80FD\u529B\u6216\u5168\u5E74\u6539\u8FDB\u3002",
      "Review overdue escalation, sampling coverage and CAPA effectiveness. This sample does not establish long-term process capability or full-year improvement."
    )
  ];
}

// src/reports.ts
function report(p, kind, batch2, locale) {
  const zh = locale === "zh-CN", t = (cn, en) => zh ? cn : en;
  const title = t("\u6C99\u53F6\u8D28\u91CF\u4E2D\u67A2 \xB7 ", "Sableleaf Quality Hub \xB7 ") + {
    dossier: t("\u6279\u6B21\u653E\u884C\u6863\u6848", "Batch release dossier"),
    apqr: t("\u5E74\u5EA6\u4EA7\u54C1\u8D28\u91CF\u56DE\u987E\uFF08\u8282\u9009\uFF09", "APQR section"),
    deviations: t("\u504F\u5DEE\u8D8B\u52BF", "Deviation trend"),
    em: t("\u591C\u95F4\u73AF\u5883\u8D8B\u52BF", "Nightly EM trend")
  }[kind];
  const lines = [
    `# ${title}`,
    "",
    t(
      "\u5408\u6210\u6F14\u793A\u6570\u636E\uFF1B\u573A\u666F\u65E5\u671F 2024-10-20\uFF1B\u975E\u76D1\u7BA1\u63D0\u4EA4\u6587\u4EF6\u3002",
      "Synthetic demo; scenario date 2024-10-20; not a regulatory submission."
    ),
    `${t("\u6863\u6848\u4FEE\u8BA2", "Revision")}: ${p.revision}`,
    ""
  ];
  if (kind === "dossier") {
    const check = dossier(p, batch2);
    lines.push(
      `## ${batch2}`,
      ...check.rows.map((r) => `- [${r.pass ? "x" : " "}] ${r.title[locale]}`),
      "",
      ...check.certificate ? [
        `### ${t("\u653E\u884C\u8BC1\u4E66", "Release certificate")}`,
        ...Object.entries({
          [t("\u8BC1\u4E66\u7F16\u53F7", "Certificate")]: check.certificate.id,
          [t("\u7B7E\u7F72\u4EBA", "Signer")]: check.certificate.signer,
          [t("\u786E\u8BA4\u65B9\u5F0F", "Confirmation mode")]: confirmationLabel(
            check.certificate.confirmationMode,
            check.certificate.signer,
            locale
          ),
          [t("\u7B7E\u540D\u65F6\u95F4", "Signed at")]: check.certificate.at,
          [t("\u7B7E\u540D\u542B\u4E49", "Signature meaning")]: check.certificate.meaning,
          [t("\u5BA1\u9605\u7248\u672C", "Reviewed revision")]: check.certificate.dossierRevision,
          [t("\u6279\u51C6\u56DE\u6267", "Approval receipt")]: check.certificate.approvalId,
          [t("\u7B7E\u7F72\u7ED1\u5B9A\u6458\u8981", "Signed subject digest")]: check.certificate.subjectRevision
        }).map(([label2, value]) => `- ${label2}: ${value}`)
      ] : [t("\u72B6\u6001\uFF1A\u963B\u6B62\u653E\u884C", "Status: release blocked")],
      ...dossierSections(p, batch2, locale)
    );
  } else if (kind === "em") {
    lines.push(t("## 20 \u5929\u8D8B\u52BF\uFF1B\u4E0D\u662F\u5168\u5E74\u5916\u63A8", "## 20-day trend; no annual extrapolation"));
    for (const r of p.rooms) {
      const samples = p.samples.filter((s) => s.room === r.id);
      lines.push(
        `- ${r.id} (${r.grade}): n=${samples.length}; ${t("\u8B66\u6212", "alert")}=${samples.filter((s) => emStatus(p, s) === "alert").length}; ${t("\u884C\u52A8\u9650\u8D85\u9650", "action")}=${samples.filter((s) => emStatus(p, s) === "action").length}; CFU/m\xB3 ${t("\u8B66\u6212\u9650 / \u884C\u52A8\u9650", "alert/action")}=${r.viableAlert}/${r.viableAction}`
      );
    }
    lines.push(
      "",
      t(
        "## C-201 \u65E5\u8D8B\u52BF\uFF08\u6BCF\u65E5\u4E24\u6B21\u4E3B\u52A8\u7A7A\u6C14\u91C7\u6837\u7684\u6700\u5927\u503C\uFF09",
        "## C-201 daily trend (maximum of two active-air samples)"
      ),
      t("| \u65E5\u671F | \u91C7\u6837\u6570 | CFU/m\xB3 \u6700\u5927\u503C | \u8B66\u6212\u9650 | \u884C\u52A8\u9650 |", "| Day | n | CFU/m\xB3 max | Alert | Action |"),
      "|---|---:|---:|---:|---:|",
      ...Array.from({ length: 20 }, (_, i) => {
        const samples = p.samples.filter((s) => s.room === "C-201" && Number(s.at.slice(8, 10)) === i + 1);
        return `| 10/${i + 1} | ${samples.length} | ${samples.length ? Math.max(...samples.map((s) => s.viable)) : "NO SAMPLE"} | 50 | 100 |`;
      })
    );
    lines.push(
      t(
        "\u8B66\u6212\uFF1A\u590D\u6838\u3001\u589E\u52A0\u91C7\u6837\u5E76\u8BC4\u4F30\u8D8B\u52BF\uFF1B\u884C\u52A8\uFF1A\u9694\u79BB\u53D7\u5F71\u54CD\u6279\u6B21\u5E76\u542F\u52A8\u8C03\u67E5\u3002\u76F8\u5173\u4E0D\u7B49\u4E8E\u56E0\u679C\u3002",
        "Alert: review, increase sampling and assess trends. Action: quarantine affected batches and investigate. Correlation is not causation."
      )
    );
  } else {
    const k = dashboard(p);
    lines.push(
      t("## 2024 \u5E74\u56DE\u987E\u8282\u9009\uFF1A\u4EC5 10 \u6708 1\u201320 \u65E5\u6837\u672C", "## 2024 review section: October 1\u201320 sample only"),
      `${t("\u6279\u6B21", "Batches")}: ${k.batches}; ${t("\u5DF2\u653E\u884C", "released")}: ${k.released}; RFT: ${k.rft}%`,
      t(
        "RFT \u5206\u6BCD\u4E3A\u5168\u90E8 36 \u6279\uFF1B\u672A\u5B8C\u6210\u6279\u6B21\u4F7F\u8BE5\u6F14\u793A\u6307\u6807\u4EC5\u4F9B\u8FD0\u8425\u53C2\u8003\u3002",
        "RFT denominator includes all 36 batches; unfinished batches make this an operational demo indicator."
      ),
      "",
      t("| \u504F\u5DEE | \u7EA7\u522B | \u9636\u6BB5 | \u6279\u6B21 | CAPA |", "| Deviation | Class | Stage | Batch | CAPA |"),
      "|---|---|---|---|---|",
      ...p.deviations.map(
        (d) => `| ${d.id} | ${d.severity} | ${d.stage} | ${d.batch} | ${d.actions.filter((a) => a.effective).length}/${d.actions.length} |`
      ),
      "",
      t(
        "## \u5EFA\u8BAE\uFF1A\u6821\u51C6\u5230\u671F\u524D 7 \u5929\u9884\u8B66\uFF1B\u9700\u4EBA\u5DE5\u5BA1\u9605\u5019\u9009\u89C4\u5219\u540E\u542F\u7528\u3002",
        "## Recommendation: flag calibration expiry within 7 days; enable only after candidate review."
      )
    );
  }
  if (kind === "apqr" || kind === "deviations") lines.push(...reviewSections(p, locale));
  lines.push(
    "",
    t(
      "\u6846\u67B6\u53C2\u8003\uFF08\u8F6C\u8FF0\uFF09\uFF1AEU GMP Annex 1 \xA79\uFF1BAnnex 11 \xA7\xA79\u300114\u300115\uFF1B21 CFR Part 11 \xA7\xA711.10(e)\u300111.50\u300111.70\uFF1BICH Q9(R1) \xA74\uFF1BICH Q10 \xA73.2\uFF1BALCOA+\u3002",
      "Framework references (paraphrased): EU GMP Annex 1 \xA79; Annex 11 \xA7\xA79,14,15; 21 CFR Part 11 \xA7\xA711.10(e),11.50,11.70; ICH Q9(R1) \xA74; ICH Q10 \xA73.2; ALCOA+."
    )
  );
  const markdown = lines.join("\n");
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:40px auto;padding:24px;color:#172e34}p,li,td{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c8d8d8;padding:8px;text-align:left}th{background:#eff6f5}h2{font-size:20px;margin-top:28px}h3{font-size:16px}tr{break-inside:avoid}h1{border-bottom:3px solid #087d7d;padding-bottom:16px}@media print{body{margin:0;padding:0;font-size:11pt}h1,h2,h3{break-after:avoid}table{font-size:9pt}}</style><h1>${escapeHtml(title)}</h1>${printReport(lines)}</html>`;
  return { title, markdown, html };
}

// src/schemas.ts
import { Type } from "@sinclair/typebox";
var text = Type.String({ maxLength: 12e3 });
var id = Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_.:-]+$" });
var revision = Type.Integer({ minimum: 0 });
var obj = (fields) => Type.Object(fields, { additionalProperties: false });
var list = (schema) => Type.Array(schema, { maxItems: 2048 });
var localized = obj({ en: text, "zh-CN": text });
var measurement = obj({
  id,
  name: localized,
  value: Type.Number(),
  unit: text,
  min: Type.Number(),
  max: Type.Number(),
  at: text,
  source: text
});
var signature = obj({ actor: text, at: text, meaning: localized });
var certificate = obj({
  id,
  batch: id,
  at: text,
  signer: text,
  confirmationMode: Type.Optional(text),
  meaning: text,
  approvalId: text,
  subjectRevision: text,
  dossierRevision: revision
});
var step = obj({
  id,
  name: localized,
  equipment: id,
  room: id,
  at: text,
  cpp: list(measurement),
  operator: signature,
  verifier: Type.Union([signature, Type.Null()])
});
var batch = obj({
  id,
  product: localized,
  form: Type.Union([Type.Literal("tablet"), Type.Literal("capsule")]),
  size: revision,
  date: text,
  status: Type.Union(["production", "review", "released"].map((x) => Type.Literal(x))),
  review: Type.Union(["pending", "findings", "accepted"].map((x) => Type.Literal(x))),
  steps: list(step),
  qc: list(measurement),
  deviationIds: list(id),
  retests: list(measurement),
  certificate: Type.Union([certificate, Type.Null()])
});
var equipment = obj({
  id,
  name: localized,
  due: text,
  qualification: Type.Union([Type.Literal("qualified"), Type.Literal("suspended")]),
  calibrated: text,
  evidence: list(text)
});
var room = obj({
  id,
  grade: Type.Union(["A", "B", "C", "D"].map((x) => Type.Literal(x))),
  name: localized,
  viableAlert: Type.Number(),
  viableAction: Type.Number(),
  particleAlert: Type.Number(),
  particleAction: Type.Number()
});
var sample = obj({
  id,
  room: id,
  batch: id,
  at: text,
  viable: Type.Number(),
  particles: Type.Number(),
  disposition: Type.Union([Type.Literal("pending"), Type.Literal("assessed")]),
  evidence: text
});
var deviation = obj({
  id,
  batch: id,
  severity: Type.Union(["minor", "major", "critical"].map((x) => Type.Literal(x))),
  title: localized,
  stage: Type.Union(["open", "investigation", "capa", "effectiveness", "closed"].map((x) => Type.Literal(x))),
  opened: text,
  cause: text,
  impact: list(id),
  why: list(text),
  actions: list(
    obj({ id, text: localized, owner: text, due: text, evidence: text, effective: Type.Boolean() })
  )
});
var audit = obj({
  signatureMeaning: Type.Optional(text),
  confirmationMode: Type.Optional(text),
  id,
  at: text,
  actor: text,
  action: text,
  record: text,
  fromRevision: revision,
  toRevision: revision,
  reason: text,
  session: Type.Union([text, Type.Null()]),
  approval: Type.Union([text, Type.Null()])
});
var plantSchema = obj({
  version: Type.Literal(1),
  revision,
  batches: list(batch),
  equipment: list(equipment),
  rooms: list(room),
  samples: list(sample),
  deviations: list(deviation),
  audit: list(audit)
});
var empty = obj({});
var batchInput = obj({ batch: id });
var changeInput = obj({
  action: Type.Union([Type.Literal("review"), Type.Literal("investigate"), Type.Literal("advance")]),
  batch: id,
  expectedRevision: revision,
  evidence: Type.Optional(Type.String({ minLength: 12, maxLength: 2e3 }))
});
var releaseInput = obj({
  batch: id,
  expectedRevision: revision,
  meaning: Type.String({ minLength: 1, maxLength: 500 })
});
var findingSchema = obj({ severity: text, code: text, text: localized, source: text });
var dossierSchema = obj({
  batch: id,
  revision,
  asOf: text,
  signatureMeaning: text,
  ready: Type.Boolean(),
  rows: list(obj({ key: text, title: localized, pass: Type.Boolean() })),
  blockers: list(text),
  findings: list(findingSchema),
  evidence: obj({
    recordApprovals: list(
      obj({
        action: text,
        approvalId: text,
        recordedBy: text,
        recordedAt: text,
        reviewedRevision: revision,
        confirmationMode: Type.Optional(text)
      })
    ),
    deviations: list(deviation),
    retests: list(measurement),
    equipment: list(equipment),
    em: list(sample),
    interpretation: localized
  }),
  certificate: Type.Union([certificate, Type.Null()])
});
var investigationSchema = obj({
  batch: id,
  revision,
  rooms: list(room),
  findings: list(findingSchema),
  em: list(sample),
  equipment: list(equipment),
  relatedBatches: list(id),
  hypothesis: localized
});
var snapshotSchema = obj({
  plant: plantSchema,
  dossiers: list(dossierSchema),
  kpi: obj({
    batches: revision,
    production: revision,
    awaiting: revision,
    released: revision,
    rft: revision,
    deviations: Type.Record(Type.String(), revision),
    overdue: revision,
    excursions: revision
  })
});
var receiptSchema = obj({
  revision,
  batch: id,
  dossier: dossierSchema,
  signature: Type.Optional(
    obj({
      decisionId: text,
      signer: text,
      confirmationMode: Type.Optional(text),
      signedAt: text,
      reviewedRevision: revision,
      purpose: Type.Literal("business.confirm"),
      meaning: text
    })
  )
});
var plain = (schema) => JSON.parse(JSON.stringify(schema));

// src/signature.ts
import { createHash } from "node:crypto";
async function sign(ctx, input, meanings, target) {
  ctx.signal.throwIfAborted();
  const subjectRevision = createHash("sha256").update(JSON.stringify({ input, meanings })).digest("hex");
  const presentation = Object.fromEntries(
    ["en", "zh-CN"].map((locale) => {
      const zh = locale === "zh-CN";
      return [
        locale,
        {
          title: zh ? "\u4EBA\u5DE5\u8D28\u91CF\u7B7E\u7F72" : "Human quality signature",
          fields: [
            { label: zh ? "\u4E1A\u52A1\u5BF9\u8C61" : "Object", value: target },
            { label: zh ? "\u5BA1\u9605\u7248\u672C" : "Reviewed revision", value: String(input.expectedRevision) },
            { label: zh ? "\u7B7E\u540D\u542B\u4E49" : "Signature meaning", value: meanings[locale] },
            {
              label: zh ? "\u5173\u8054\u8BC1\u636E" : "Evidence",
              value: zh ? "\u67E5\u770B\u672C\u6B21\u8C03\u67E5\u4E0E\u8D28\u91CF\u6863\u6848" : "Review the investigation and quality dossier",
              href: `/?session=${encodeURIComponent(ctx.session.key)}`
            }
          ],
          responseValue: meanings[locale]
        }
      ];
    })
  );
  const handle = await ctx.decisions.request({
    key: `signature:${ctx.session.toolUseId}`,
    purpose: "business.confirm",
    subject: { action: ctx.session.toolUseId, input: JSON.stringify(input), meanings, subjectRevision },
    prompt: `Human quality signature: ${target}, revision ${input.expectedRevision}. ${meanings.en}`,
    presentation,
    options: ["allowed-once", "rejected"],
    responseSchema: { type: "string", enum: Object.values(meanings) }
  });
  const answer = await ctx.decisions.wait(handle, { signal: ctx.signal });
  ctx.signal.throwIfAborted();
  if (answer.status !== "resolved" || answer.snapshot.invalidation)
    throw new Error("Signature unavailable / \u7B7E\u540D\u4E0D\u53EF\u7528");
  const result2 = answer.snapshot.result;
  if (result2?.reason !== "answered" || result2.response.option !== "allowed-once" || ["system", "agent"].includes(result2.answeredBy.role) || typeof result2.response.value !== "string" || !Object.values(meanings).includes(result2.response.value) || result2.code === "full-access" && result2.answeredBy.attrs.confirmationMode !== "auto-confirmed under full access")
    throw new Error("Human quality signature required / \u9700\u8981\u4EBA\u5DE5\u8D28\u91CF\u7B7E\u540D");
  if (result2.code === "full-access" && !ctx.decisions.admit)
    throw new Error("Host signature admission unavailable");
  const admission = await ctx.decisions.admit?.(handle);
  if (result2.code === "full-access" && !admission) throw new Error("Host signature admission unavailable");
  await admission?.verify();
  return {
    ...admission ? { admission } : {},
    confirmationMode: result2.code === "full-access" ? "auto-confirmed under full access" : "manual",
    signedMeaning: result2.response.value,
    requestId: handle.id,
    subjectRevision,
    answeredBy: result2.answeredBy,
    signedAt: result2.at
  };
}

// src/index.ts
var who = (ctx) => ({
  actor: ctx.actor.id,
  session: ctx.session.key,
  ...ctx.approval ? { approval: ctx.approval } : {}
});
var serviceWho = (ctx) => ({
  actor: ctx.actor.id,
  session: ctx.session?.key ?? null,
  ...ctx.admission?.approval ? { approval: ctx.admission.approval } : {}
});
var meta = (write2 = false, approve = false) => ({
  isReadOnly: !write2,
  isDestructive: approve,
  isConcurrencySafe: !write2,
  isOpenWorld: false,
  replay: write2 ? "never" : "safe",
  requiresApproval: approve ? "always" : "never",
  deferLoading: false
});
var signatureReceipt = (approval, reviewedRevision) => ({
  decisionId: approval.requestId,
  meaning: approval.signedMeaning,
  signer: approval.answeredBy.id,
  confirmationMode: approval.confirmationMode,
  signedAt: approval.signedAt,
  reviewedRevision,
  purpose: "business.confirm"
});
var result = (output) => ({
  content: [{ type: "text", text: JSON.stringify(output) }],
  structured: output
});
var failure = (error, ctx) => {
  ctx.signal.throwIfAborted();
  return toolError(error instanceof Error ? error.message : String(error));
};
var inspect = defineTool({
  name: "pharma_inspect",
  description: "Inspect a batch, CPP/ALCOA+ findings, linked EM/equipment and affected batches. Read-only. / \u8BFB\u53D6\u6279\u6B21\u3001\u9650\u5EA6\u3001\u7B7E\u540D\u3001EM\u3001\u8BBE\u5907\u53CA\u5F71\u54CD\u8303\u56F4\u3002",
  parameters: batchInput,
  result: investigationSchema,
  meta: meta(),
  async execute(input, ctx) {
    ctx.signal.throwIfAborted();
    try {
      return result(investigation(read(ctx.store), input.batch));
    } catch (e) {
      return failure(e, ctx);
    }
  }
});
var checklist = defineTool({
  name: "pharma_dossier",
  description: "Build release checklist at an exact revision; explain every blocker. / \u6309\u5F53\u524D\u7248\u672C\u6784\u5EFA\u653E\u884C\u6E05\u5355\u5E76\u89E3\u91CA\u963B\u65AD\u9879\u3002",
  parameters: batchInput,
  result: dossierSchema,
  meta: meta(),
  async execute(input, ctx) {
    ctx.signal.throwIfAborted();
    try {
      return result(dossier(read(ctx.store), input.batch));
    } catch (e) {
      return failure(e, ctx);
    }
  }
});
var record = defineTool({
  name: "pharma_record",
  description: "On an explicit user request, invoke this tool directly: it requests Host business consent before writing (manual, or explicitly recorded automatic confirmation for the human under full access); do not substitute ask_user_question or ui_render. action=review records the independent BPR review (resolving the bpr checklist item); it is not final release and does not require bpr to pass beforehand. Investigate deviation, or advance the explicitly synthetic evidence scenario (investigation \u2192 CAPA \u2192 effectiveness \u2192 closed). Read latest revision first. Never invent real evidence. / \u4EBA\u5DE5\u5BA1\u6838\u540E\u590D\u6838\u6279\u8BB0\u5F55\u3001\u8C03\u67E5\u504F\u5DEE\u6216\u5F55\u5165\u660E\u786E\u7684\u5408\u6210\u573A\u666F\u8BC1\u636E\u3002",
  parameters: changeInput,
  result: receiptSchema,
  meta: { ...meta(true, true), isDestructive: false },
  async execute(input, ctx) {
    ctx.signal.throwIfAborted();
    try {
      const approval = await sign(
        ctx,
        { ...input, currentDossier: dossier(read(ctx.store), input.batch) },
        { en: "I attest to this synthetic quality record.", "zh-CN": "\u6211\u786E\u8BA4\u672C\u5408\u6210\u8D28\u91CF\u8BB0\u5F55\u3002" },
        input.batch
      );
      const p = change(ctx.store, input, { ...who(ctx), approval });
      return result({
        revision: p.revision,
        batch: input.batch,
        dossier: dossier(p, input.batch),
        signature: signatureReceipt(approval, input.expectedRevision)
      });
    } catch (e) {
      return failure(e, ctx);
    }
  }
});
var releaseTool = defineTool({
  name: "pharma_release",
  description: "Consequential QA batch release. Use dossier.signatureMeaning exactly. Requires exact dossier revision, signature meaning and Host business consent (manual, or recorded for the human under full access) requested inside this tool; invoke directly on an explicit release request, never substitute a question or self-authorize. / QA \u6279\u6B21\u653E\u884C\uFF1A\u987B\u7CBE\u786E\u7248\u672C\u3001\u7B7E\u540D\u542B\u4E49\u548C\u72EC\u7ACB\u7684\u4EBA\u5DE5\u4E1A\u52A1\u7B7E\u540D\u3002",
  parameters: releaseInput,
  result: receiptSchema,
  meta: meta(true, true),
  async execute(input, ctx) {
    ctx.signal.throwIfAborted();
    try {
      const check = dossier(read(ctx.store), input.batch);
      if (check.certificate || !check.ready || check.revision !== input.expectedRevision || input.meaning !== SIGNATURE_MEANING)
        throw new Error("Release prerequisites or signature meaning not satisfied / \u653E\u884C\u6761\u4EF6\u6216\u7B7E\u540D\u542B\u4E49\u4E0D\u6EE1\u8DB3");
      const approval = await sign(ctx, { ...input, dossier: check }, SIGNATURE_MEANINGS, input.batch);
      const p = release(ctx.store, input, { ...who(ctx), approval });
      return result({
        revision: p.revision,
        batch: input.batch,
        dossier: dossier(p, input.batch),
        signature: signatureReceipt(approval, input.expectedRevision)
      });
    } catch (e) {
      return failure(e, ctx);
    }
  }
});
var reports = defineTool({
  name: "pharma_report",
  description: "Generate Markdown + print HTML dossier, APQR section, deviation trend or nightly EM report, and internally present the generated files. Do not guess file names or call present before this tool returns. / \u751F\u6210 Markdown \u4E0E\u53EF\u6253\u5370 HTML \u6863\u6848\u3001APQR \u8282\u9009\u3001\u504F\u5DEE\u6216\u591C\u95F4 EM \u8D8B\u52BF\u5E76\u5C55\u793A\u3002",
  parameters: Type2.Object(
    {
      kind: Type2.Union([
        Type2.Literal("dossier"),
        Type2.Literal("apqr"),
        Type2.Literal("deviations"),
        Type2.Literal("em")
      ]),
      batch: Type2.Optional(Type2.String({ pattern: "^B-[0-9]{4}-[0-9]{3}$" })),
      locale: Type2.Union([Type2.Literal("zh-CN"), Type2.Literal("en")])
    },
    { additionalProperties: false }
  ),
  result: Type2.Object(
    {
      title: Type2.String(),
      revision: Type2.Integer(),
      files: Type2.Array(Type2.String(), { minItems: 2, maxItems: 2 })
    },
    { additionalProperties: false }
  ),
  meta: { ...meta(true), attestsHistory: true },
  async execute(input, ctx) {
    ctx.signal.throwIfAborted();
    try {
      const p = read(ctx.store), document = report(p, input.kind, input.batch ?? "B-2410-017", input.locale);
      const stem = `pharma-output/${input.kind}-${input.batch ?? "plant"}-r${p.revision}-${input.locale}-${randomUUID()}`;
      const files = [`${stem}.md`, `${stem}.html`];
      await ctx.fs.write(files[0], document.markdown);
      ctx.signal.throwIfAborted();
      await ctx.fs.write(files[1], document.html);
      ctx.signal.throwIfAborted();
      const presented = await ctx.tools.invoke(
        "present",
        { files: files.map((path) => ({ path })) },
        { signal: ctx.signal }
      );
      if (presented.isError) return toolError("Deliverable presentation failed / \u4EA4\u4ED8\u7269\u5C55\u793A\u5931\u8D25");
      return result({ title: document.title, revision: p.revision, files });
    } catch (e) {
      return failure(e, ctx);
    }
  }
});
var main = defineAgnesPlugin({
  inject: ["tools", "services", "skills", "providers"],
  apply(ctx) {
    ctx.providers.register(toolPolicyKind, {
      ...qualityPolicy,
      async decide(input, signal, ports) {
        const base = await ctx.providers.resolve(toolPolicyKind, "default").decide(input, signal, ports);
        if (base.effect === "deny") return base;
        return ["pharma_release", "pharma_record", "pharma_report"].includes(input.call.name) ? qualityPolicy.decide(input, signal, ports) : base;
      }
    });
    for (const tool of [inspect, checklist, record, releaseTool, reports]) ctx.tools.register(tool);
    ctx.skills.register({
      name: "gmp-review",
      description: "GMP batch review, risk investigation and release playbook / GMP \u6279\u8BB0\u5F55\u3001\u98CE\u9669\u8C03\u67E5\u4E0E\u653E\u884C\u89C4\u7A0B",
      body: readFileSync(new URL("../skills/gmp-review/SKILL.md", import.meta.url), "utf8")
    });
    const common = { scope: "profile", timeoutMs: 1e4, maxResultBytes: 1048576 };
    ctx.services.register({
      ...common,
      name: "pharma.snapshot",
      kind: "query",
      inputSchema: plain(empty),
      outputSchema: plain(snapshotSchema),
      async handler(_input, context) {
        context.signal.throwIfAborted();
        const plant = read(context.store);
        return JSON.parse(
          JSON.stringify({
            plant,
            kpi: dashboard(plant),
            dossiers: plant.batches.map((b) => dossier(plant, b.id))
          })
        );
      }
    });
    ctx.services.register({
      ...common,
      name: "pharma.change",
      kind: "effect",
      inputSchema: plain(changeInput),
      outputSchema: plain(receiptSchema),
      effectPolicy: {
        isDestructive: false,
        isOpenWorld: false,
        replay: "never",
        requiresApproval: "always",
        approvalScopes: []
      },
      async handler(value, context) {
        context.signal.throwIfAborted();
        const p = change(context.store, value, serviceWho(context));
        const batch2 = value.batch;
        return JSON.parse(JSON.stringify({ revision: p.revision, batch: batch2, dossier: dossier(p, batch2) }));
      }
    });
    ctx.services.register({
      ...common,
      name: "pharma.release",
      kind: "effect",
      inputSchema: plain(releaseInput),
      outputSchema: plain(receiptSchema),
      effectPolicy: {
        isDestructive: true,
        isOpenWorld: false,
        replay: "never",
        requiresApproval: "always",
        approvalScopes: []
      },
      async prepare(value, context) {
        const input = value;
        const check = dossier(read(context.store), input.batch);
        if (input.expectedRevision !== check.revision) throw new Error("Stale dossier / \u6863\u6848\u5DF2\u53D8\u5316");
        if (!check.ready || input.meaning !== SIGNATURE_MEANING)
          throw new Error(
            "Release prerequisites or signature meaning not satisfied / \u653E\u884C\u6761\u4EF6\u6216\u7B7E\u540D\u542B\u4E49\u4E0D\u6EE1\u8DB3"
          );
        return {
          input: value,
          presentation: JSON.parse(JSON.stringify({ meaning: input.meaning, checklist: check })),
          resourceRevision: String(check.revision)
        };
      },
      async handler(value, context) {
        context.signal.throwIfAborted();
        const input = value;
        const p = release(context.store, input, serviceWho(context));
        return JSON.parse(
          JSON.stringify({ revision: p.revision, batch: input.batch, dossier: dossier(p, input.batch) })
        );
      }
    });
  }
});
var cards = defineAgnesPlugin({ apply() {
} });
export {
  cards,
  checklist,
  inspect,
  main,
  record,
  releaseTool,
  reports
};
