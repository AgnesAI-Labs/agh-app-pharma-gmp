import type { UiSurface } from '@agnes/protocol'
import type { Static } from '@sinclair/typebox'
import { confirmationLabel, type L } from './model.js'
import type { dossierSchema, investigationSchema } from './schemas.js'

type Investigation = Static<typeof investigationSchema>
type Dossier = Static<typeof dossierSchema>

const hostDetails = 'Open the Host tool details for the original evidence record. 请打开宿主工具详情查看原始证据记录。'
const bilingual = (text: L) => `${text.en} / ${text['zh-CN']}`
const revision = (value: number) => `r${value}`
const noEvidence = 'No evidence reference recorded / 未记录证据引用'
const limitRows = 16
const tableBudget = 5500

function clip(value: string): string {
  return value.length <= 420 ? value : `${value.slice(0, 419)}…`
}

function card(id: string, title: string, summary: string) {
  const surface: UiSurface = {
    id,
    revision: 1,
    title,
    summary,
    placement: { inline: true, workbench: true, preferred: 'inline' },
    components: [],
    data: {},
    actions: [],
  }
  function text(id: string, title: string, value: string) {
    surface.components.push({ id, title, kind: 'text', dataKey: id })
    surface.data[id] = value
  }
  function detail(id: string, title: string, entries: [string, string][]) {
    const fields = entries.map(([label], index) => ({ key: `f${index}`, label }))
    surface.components.push({ id, title, kind: 'detail-card', dataKey: id, fields })
    surface.data[id] = Object.fromEntries(entries.map(([, value], index) => [`f${index}`, clip(value)]))
  }
  function table<T>(
    id: string,
    title: string,
    labels: string[],
    items: readonly T[],
    row: (item: T) => string[],
    empty: string,
  ) {
    if (!items.length) return text(id, title, empty)
    const columns = labels.map((label, index) => ({ key: `c${index}`, label }))
    const rows: Record<string, string>[] = []
    let bytes = 0
    for (const item of items) {
      if (rows.length === limitRows) break
      const value = Object.fromEntries(row(item).map((cell, index) => [`c${index}`, clip(cell)]))
      value.id = String(rows.length)
      bytes += Buffer.byteLength(JSON.stringify(value)) + 1
      if (bytes > tableBudget) break
      rows.push(value)
    }
    if (!rows.length) return text(id, title, hostDetails)
    surface.components.push({
      id,
      title: rows.length === items.length ? title : `${title} (${rows.length}/${items.length} shown / 已显示)`,
      kind: 'table',
      dataKey: id,
      rowKey: 'id',
      selection: 'none',
      columns,
    })
    surface.data[id] = rows
  }
  function findings(items: Investigation['findings'], title: string) {
    table('findings', title, ['Code / 代码', 'Severity / 严重度', 'Finding / 发现', 'Source / 来源'], items,
      (finding) => [
        finding.code,
        finding.severity === 'major' ? 'major / 主要' : finding.severity,
        bilingual(finding.text),
        finding.source,
      ], 'No findings recorded / 无记录的发现')
  }
  function finish() {
    text('source', 'Original evidence / 原始证据', hostDetails)
    return surface
  }
  return { text, detail, table, findings, finish }
}

export function inspectionCard(output: Investigation, id: string): UiSurface {
  const view = card(`gmp-inspect-${id}`, `Batch inspection / 批次检查 · ${output.batch}`, `${output.batch} · ${revision(output.revision)}`)
  view.detail('summary', 'Inspection snapshot / 检查快照', [
    ['Batch / 批次', output.batch],
    ['Inspected revision / 检查版本', revision(output.revision)],
  ])
  view.findings(output.findings, 'Inspection findings / 检查发现')
  view.table('em', 'Environmental monitoring excursions / 环境监测超限', [
    'Sample, room and time / 样本、房间与时间',
    'Viable count / 活菌数',
    'Room alert limit / 房间警戒限',
    'Room action limit / 房间行动限',
    'Disposition and evidence / 处置与证据',
  ], output.em, (sample) => {
    const room = output.rooms.find(({ id }) => id === sample.room)
    const missingLimit = 'Not in receipt / 回执未记录'
    return [
      `${sample.id} · ${sample.room} · ${sample.at}`,
      `${sample.viable} CFU/m³`,
      room ? `${room.viableAlert} CFU/m³` : missingLimit,
      room ? `${room.viableAction} CFU/m³` : missingLimit,
      `${sample.disposition === 'assessed' ? 'assessed / 已评估' : 'pending / 待处置'} · ${sample.evidence || noEvidence}`,
    ]
  }, 'No linked environmental excursions recorded / 无关联环境超限记录')
  view.text('related-batches', 'Related batches / 关联批次', output.relatedBatches.length
    ? clip(output.relatedBatches.join(' · '))
    : 'No related batches identified / 未识别出关联批次')
  view.text(
    'hypothesis',
    'B-2410-017 scenario hypothesis, not a verified root cause / B-2410-017 场景假设，非已验证根因',
    bilingual(output.hypothesis),
  )
  view.table('equipment', 'Equipment references / 设备引用', [
    'Equipment / 设备', 'Qualification / 确认状态', 'Last calibration / 上次校准', 'Calibration due / 校准到期',
    'Evidence references / 证据引用',
  ], output.equipment, (item) => [
    `${item.id} · ${bilingual(item.name)}`,
    item.qualification === 'qualified' ? 'qualified / 已确认' : 'suspended / 已暂停',
    item.calibrated,
    item.due,
    item.evidence.join(' · ') || noEvidence,
  ], 'No linked equipment recorded / 无关联设备记录')
  return view.finish()
}

function recordedConfirmation(mode: string | undefined, principal: string) {
  return `${confirmationLabel(mode, principal, 'en')} / ${confirmationLabel(mode, principal, 'zh-CN')}`
}

export function dossierCard(output: Dossier, id: string): UiSurface {
  const current = revision(output.revision)
  const ready = output.ready ? 'Checks passed / 检查全部通过' : 'Blocked / 有阻断项'
  const certificate = output.certificate
  const seeded = certificate?.subjectRevision === 'seed'
  const view = card(`gmp-dossier-${id}`, `Release dossier / 放行档案 · ${output.batch}`, `${output.batch} · ${current} · ${ready}`)
  view.detail('summary', 'Current checklist and release evidence / 当前清单与放行证据', [
    ['Batch / 批次', output.batch],
    ['Current checked revision / 当前检查版本', current],
    ['Scenario date / 场景日期', output.asOf],
    ['Checklist readiness / 清单就绪状态', ready],
    ['Current blockers / 当前阻断项', output.blockers.join(', ') || 'None / 无'],
    ['Final QA release / QA 最终放行', !certificate
      ? 'No final QA release certificate on record / 未记录 QA 最终放行证书'
      : seeded ? 'Synthetic certificate on record / 已记录合成样例证书' : 'Certificate on record / 已有放行证书'],
  ])
  view.text('interpretation', 'How to read this dossier / 如何阅读本档案',
    'Passing checks does not release a batch. Failed checklist rows are current blockers; historical findings are not necessarily current blockers. No approval or release is made by this check. ' +
    '清单通过不等于放行。未通过的检查项才是当前阻断项，历史发现不一定仍构成阻断。本次检查不作批准或放行。')
  view.table('checks', 'Release checklist / 放行清单', ['Key / 键', 'Check / 检查项', 'Result / 结果'], output.rows,
    (row) => [row.key, bilingual(row.title), row.pass ? 'Pass / 通过' : 'Block / 阻断'],
    'No checklist entries recorded / 无检查项记录')
  view.findings(output.findings, 'Historical findings / 历史发现')
  view.table('record-approvals', 'Recorded quality approvals / 已记录质量批准', [
    'Action / 操作', 'Approval reference / 批准引用', 'Recorded by / 记录人',
    'Confirmation mode / 确认方式', 'Reviewed revision / 审阅版本', 'Recorded at / 记录时间',
  ], output.evidence.recordApprovals, (entry) => [
    entry.action,
    entry.approvalId,
    entry.recordedBy,
    recordedConfirmation(entry.confirmationMode, entry.recordedBy),
    revision(entry.reviewedRevision),
    entry.recordedAt,
  ], 'No quality approvals recorded in this dossier / 本档案未记录质量批准')
  const certificateTitle = 'Recorded final QA release certificate / 已记录的 QA 最终放行证书'
  if (certificate) {
    view.detail('certificate', certificateTitle, [
      ['Certificate / 证书', certificate.id],
      ['Signer / 签署人', certificate.signer],
      ['Confirmation mode / 确认方式', recordedConfirmation(certificate.confirmationMode, certificate.signer)],
      ['Reviewed pre-signature revision / 签署前审阅版本', revision(certificate.dossierRevision)],
      ['Approval reference / 批准引用', certificate.approvalId],
      ['Signed at / 签署时间', certificate.at],
      ['Signature meaning / 签名含义', certificate.meaning],
      [seeded ? 'Synthetic placeholder, not a signature digest / 合成占位值，非签名摘要'
        : 'Signed subject digest / 签署绑定摘要', certificate.subjectRevision],
    ])
  } else {
    view.text('certificate', certificateTitle, 'No final QA release certificate recorded / 无 QA 最终放行证书记录')
  }
  return view.finish()
}
