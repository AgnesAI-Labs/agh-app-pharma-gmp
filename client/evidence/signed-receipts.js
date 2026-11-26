import React from 'react'
import { confirmationLabel, meaning as releaseMeaning, words } from '../locale.js'

const h = React.createElement
const slot = 'tool.view.cordis'
const packageId = '@agnes-showcase/pharma-gmp'
const receiptFormat = `${packageId}/signed-receipt@1`
// Host's catalog owner for ext:@agnes-showcase/pharma-gmp/main (pluginRowSource).
const mainSource = 'plugin/a01595609b6a0413'
const nonempty = (value) => typeof value === 'string' && value.length > 0
// pharma_record submits the same two localized meanings for review, investigate and advance.
const recordMeanings = ['I attest to this synthetic quality record.', '我确认本合成质量记录。']
const releaseMeanings = [words.en.localizedMeaning, words['zh-CN'].localizedMeaning]

function signedReceipt(name, toolUseId, { call, result }) {
  if (
    call?.name !== name || call.toolUseId !== toolUseId || result?.toolUseId !== toolUseId ||
    result.isError !== false || result.code || result.partial || result.cancelledBy || result.interrupted ||
    result.transformedBy
  ) return
  const output = result.structured
  if (output?.receiptFormat !== receiptFormat) return
  const { batch, dossier, revision, signature } = output
  if (
    !nonempty(batch) || batch !== call.args?.batch || batch !== dossier?.batch ||
    !Number.isSafeInteger(revision) || revision !== dossier.revision ||
    signature?.purpose !== 'business.confirm' || !nonempty(signature.decisionId) ||
    !nonempty(signature.signer) || !nonempty(signature.signedAt) ||
    (signature.confirmationMode !== undefined && typeof signature.confirmationMode !== 'string') ||
    !Number.isSafeInteger(signature.reviewedRevision) || signature.reviewedRevision < 0 ||
    signature.reviewedRevision !== call.args.expectedRevision || revision !== signature.reviewedRevision + 1
  ) return

  const meanings = name === 'pharma_release' ? releaseMeanings : recordMeanings
  if (!meanings.includes(signature.meaning)) return
  const action = name === 'pharma_release' ? 'release' : call.args.action
  const approvals = dossier.evidence?.recordApprovals
  const entry = Array.isArray(approvals) ? approvals.at(-1) : undefined
  if (
    !entry || entry.action !== action || entry.approvalId !== signature.decisionId ||
    entry.recordedBy !== signature.signer || entry.reviewedRevision !== signature.reviewedRevision ||
    entry.confirmationMode !== signature.confirmationMode
  ) return
  if (name === 'pharma_release') {
    const certificate = dossier.certificate
    if (
      call.args.meaning !== releaseMeaning || dossier.signatureMeaning !== releaseMeaning || !nonempty(certificate?.id) ||
      certificate.batch !== batch || certificate.approvalId !== signature.decisionId ||
      certificate.signer !== signature.signer || certificate.dossierRevision !== signature.reviewedRevision ||
      certificate.meaning !== signature.meaning ||
      certificate.confirmationMode !== signature.confirmationMode
    ) return
  } else if (!['review', 'investigate', 'advance'].includes(action) || dossier.certificate !== null) return

  return { batch, revision, signature }
}

export function applySignedReceipts(ctx) {
  const offSlot = ctx.slots.inject(slot, () => {
    const remove = ['pharma_record', 'pharma_release'].map((name) => ctx.slots.register(
      { name: slot, key: name, id: `${name}-signed-receipt` },
      function ReceiptCard({ owner }) {
        const locale = React.useSyncExternalStore(ctx.locale.subscribe, () => ctx.locale.locale)
        const readiness = React.useSyncExternalStore(ctx.session.readiness.subscribe, ctx.session.readiness.getSnapshot)
        const binding = React.useSyncExternalStore(ctx.availability.subscribe, ctx.availability.getSnapshot)
        const [resolved, setResolved] = React.useState()
        const { name: toolName, seq, resultSeq, status, toolUseId } = owner?.block ?? {}
        const eligible =
          binding?.lifetime === 'profile' && binding.availability === 'active' &&
          binding.packageId === packageId && binding.integrity === ctx.module.revision &&
          (readiness.status === 'ready' || readiness.status === 'history-only') && nonempty(readiness.sessionId) &&
          toolName === name && status === 'completed' && nonempty(toolUseId) &&
          Number.isSafeInteger(seq) && Number.isSafeInteger(resultSeq) && seq > 0 && resultSeq > seq

        React.useEffect(() => {
          if (!eligible) return
          const stop = new AbortController()
          const current = () => !stop.signal.aborted &&
            ctx.session.readiness.getSnapshot() === readiness && ctx.availability.getSnapshot() === binding
          async function load() {
            try {
              const session = ctx.agnes.sessions.get(readiness.sessionId)
              if (!session) return
              // Look up provenance for this receipt only. Later tool visibility does not rewrite a durable result.
              const recorded = await session.tools()
              const pin = recorded.capabilities?.codePin
              if (
                !current() || recorded.sessionId !== readiness.sessionId || pin?.legacy !== false ||
                !nonempty(pin.generationId) ||
                !pin.packages.some((row) => row.id === packageId && row.integrity === binding.integrity) ||
                !recorded.tools.some((row) => row.name === name && row.source === mainSource)
              ) return
              const detail = await session.readToolDetail(seq, resultSeq, { signal: stop.signal })
              if (!current()) return
              const receipt = signedReceipt(name, toolUseId, detail)
              if (!receipt) return
              setResolved({ readiness, binding, seq, resultSeq, toolUseId, receipt })
            } catch {
              // If either owner-authorized read fails, leave the Host's original tool result alone.
            }
          }
          void load()
          return () => stop.abort()
        }, [eligible, readiness, binding, seq, resultSeq, toolUseId])

        if (
          !eligible || resolved?.readiness !== readiness || resolved.binding !== binding ||
          resolved.seq !== seq || resolved.resultSeq !== resultSeq || resolved.toolUseId !== toolUseId
        ) return null
        const { batch, revision, signature } = resolved.receipt
        const zh = locale === 'zh-CN'
        const title = name === 'pharma_release'
          ? (zh ? 'QA 放行回执' : 'QA release receipt')
          : (zh ? '质量记录回执' : 'Quality record receipt')
        return h('section', { className: 'ph-evidence-card', 'aria-label': title, 'data-testid': 'pharma-signed-receipt' },
          h('strong', null, `${title} · ${batch}`),
          h('p', { 'data-business-confirmation': true }, confirmationLabel(signature.confirmationMode, signature.signer, locale)),
          h('p', null, `${zh ? '审阅版本' : 'Reviewed revision'}: r${signature.reviewedRevision} · ${zh ? '记录版本' : 'Recorded revision'}: r${revision}`),
          h('p', null, signature.meaning),
          h('small', null, zh ? '完整回执见宿主工具记录。' : 'Open the Host tool record for the full receipt.'),
        )
      },
    ))
    return () => remove.forEach((off) => off())
  })
  ctx.effect(() => offSlot)
}
