import { readFile } from 'node:fs/promises'
import { pluginRowSource } from '@agnes/host'
import {
  type ClientContext,
  type ModuleIdentity,
  SlotOutlet,
  SlotsProvider,
} from '@agnes/web-client'
import { createClientPanelTestHost } from '@agnes/web-client/testkit'
import { renderRegion, unmountRegion } from '@agnes/web-ui'
import { createElement } from 'react'
import { expect, it, vi } from 'vitest'
import { apply } from '../client/index.js'

const { client } = JSON.parse(await readFile(new URL('../client/agnes.client.json', import.meta.url), 'utf8'))
const packageId = '@agnes-showcase/pharma-gmp'
const backendRow = `ext:${packageId}/main`
const rowId = `web:${packageId}/pharma-quality`
const integrity = `sha256-${'a'.repeat(64)}`
const slot = 'tool.view.cordis'
const batch = 'B-2410-017'
const sessionId = 'signed-fixture'
const toolUseId = 'exact-call'
const decisionId = 'fixture-decided'
const signer = 'fixture-human.qa'
const signatureMeaning =
  'I approve this batch for release after reviewing the complete quality dossier. / 我已审核完整质量档案，批准本批放行。'
const receiptFormat = '@agnes-showcase/pharma-gmp/signed-receipt@1'
const identity: ModuleIdentity = {
  packageId,
  rowId,
  revision: integrity,
  allowedSlots: client.slots,
  slotCatalogVersion: client.slotCatalogVersion,
  services: client.services,
  homeEntries: client.homeEntries,
  binding: { owner: rowId, packageId, integrity, lifetime: 'profile', profileId: 'test', activationId: 'test', availability: 'active' },
}

type SignedTool = 'pharma_record' | 'pharma_release'
function receipt(name: SignedTool, confirmationMode?: string) {
  const released = name === 'pharma_release'
  const action = released ? 'release' : 'investigate'
  const reviewedRevision = released ? 5 : 0
  const revision = reviewedRevision + 1
  const meaning = released ? '我已审核完整质量档案，批准本批放行。' : 'I attest to this synthetic quality record.'
  const mode = confirmationMode === undefined ? {} : { confirmationMode }
  const signature = { decisionId, signer, ...mode, reviewedRevision, meaning, signedAt: '2026-10-20T00:00:00Z', purpose: 'business.confirm' }
  const dossier = {
    batch,
    revision,
    signatureMeaning,
    evidence: {
      recordApprovals: [{ action, approvalId: decisionId, recordedBy: signer, reviewedRevision, ...mode }],
    },
    certificate: released
      ? { id: 'REL-B-2410-017-5', batch, approvalId: decisionId, signer, dossierRevision: reviewedRevision, ...mode, meaning }
      : null,
  }
  return {
    call: { name, toolUseId, args: { batch, expectedRevision: reviewedRevision, ...(released ? { meaning: signatureMeaning } : { action }) } },
    result: { toolUseId, isError: false, structured: { receiptFormat, batch, revision, signature, dossier } },
  }
}

it('restores only the exact finalized signed result under the verified adopted row', async () => {
  const captured: { ctx?: ClientContext } = {}
  let displayed = receipt('pharma_record', 'manual')
  let source = pluginRowSource(backendRow)
  let pinnedIntegrity: string | undefined = integrity
  let readDenied = false
  let resultSeq = 8
  const readToolDetail = vi.fn(async () => {
    if (readDenied) throw new Error('CAPABILITY_DENIED')
    return displayed
  })
  const tools = vi.fn(async () => ({
    sessionId,
    capabilities: { codePin: { legacy: false, generationId: 'gmp-fixture-generation', packages: [{ id: packageId, integrity: pinnedIntegrity }] } },
    tools: ['pharma_record', 'pharma_release'].map((name) => ({ name, source })),
  }))
  const host = await createClientPanelTestHost({
    apply(context, config) {
      captured.ctx = context
      const handle = { id: sessionId, listeners: new Set(), readToolDetail, tools }
      Object.assign(context.agnes.sessions, { get: (id: string) => id === sessionId ? handle : undefined })
      context.session.setSession(sessionId, 'ready')
      context.slots.declare(slot, { kind: 'keyed', scope: 'session' }, 'fixture-native')
      apply(context, config)
    },
  }, identity, async () => { throw new Error('receipt rendering must not call business services') })
  const panel = host.window.document.createElement('div') as unknown as HTMLElement
  try {
    const context = captured.ctx
    if (!context) throw new Error('adopted presenter was not mounted')
    const render = async (name: SignedTool, status = 'completed', hasResult = true) => {
      const block = {
        name, status, toolUseId, seq: 7,
        ...(hasResult ? { resultSeq: ++resultSeq } : {}),
        resultPreview: JSON.stringify(receipt(name, 'manual').result.structured),
      }
      await host.act(async () => renderRegion(panel,
        createElement(SlotsProvider, { registry: context.slots },
          createElement('p', { id: 'native-result' }, 'Host tool result'),
          createElement(SlotOutlet, { name: slot, entryKey: name, props: { owner: { block } } }),
        ),
      ))
      expect(panel.querySelector('#native-result')?.textContent).toBe('Host tool result')
      const card = panel.querySelector('[data-testid="pharma-signed-receipt"]')
      expect(card?.querySelector('button, input, form, a, select, textarea') ?? null).toBeNull()
      return card?.textContent ?? ''
    }

    expect(await render('pharma_record')).toContain(`Signed by ${signer}`)
    expect(panel.textContent).toContain('Reviewed revision: r0')
    expect(panel.textContent).toContain('Recorded revision: r1')
    expect(readToolDetail).toHaveBeenLastCalledWith(7, resultSeq, expect.objectContaining({ signal: expect.anything() }))

    displayed = receipt('pharma_release', 'auto-confirmed under full access')
    const release = await render('pharma_release')
    expect(release).toContain(`Auto-confirmed under full access (principal ${signer})`)
    expect(release).toContain('Reviewed revision: r5')
    expect(release).toContain('Recorded revision: r6')
    expect(release).toContain('我已审核完整质量档案，批准本批放行。')
    expect(release).not.toContain('Signed by')
    const releaseResult = displayed.result
    const releaseOutput = releaseResult.structured
    const { dossier: releaseDossier, signature: releaseSignature } = releaseOutput
    const certificate = releaseDossier.certificate
    if (!certificate) throw new Error('Missing synthetic certificate')
    const illegitimateMeaning = 'I approve this batch without reviewing the quality dossier.'
    for (const structured of [
      { ...releaseOutput, dossier: { ...releaseDossier, certificate: { ...certificate, signer: 'different-human' } } },
      { ...releaseOutput, signature: { ...releaseSignature, meaning: illegitimateMeaning }, dossier: { ...releaseDossier, certificate: { ...certificate, meaning: illegitimateMeaning } } },
    ]) {
      displayed = { ...displayed, result: { ...releaseResult, structured } }
      expect(await render('pharma_release')).toBe('')
    }

    displayed = receipt('pharma_release', 'manual')
    displayed.call.args.meaning = illegitimateMeaning
    displayed.result.structured.dossier.signatureMeaning = illegitimateMeaning
    expect(await render('pharma_release')).toBe('')

    displayed = receipt('pharma_release')
    displayed.result.structured.dossier.certificate = { ...certificate, confirmationMode: 'manual' }
    expect(await render('pharma_release')).toBe('')

    displayed = receipt('pharma_record', 'manual')
    displayed.result.structured.signature.meaning = '我已审核完整质量档案，批准本批放行。'
    expect(await render('pharma_record')).toBe('')

    displayed = receipt('pharma_record')
    await host.act(async () => context.session.setReadiness('history-only', sessionId))
    expect(await render('pharma_record')).toContain(`Confirmation mode not recorded (principal ${signer})`)
    displayed = receipt('pharma_record')
    const [auditEntry] = displayed.result.structured.dossier.evidence.recordApprovals
    if (!auditEntry) throw new Error('Missing synthetic audit entry')
    auditEntry.confirmationMode = 'manual'
    expect(await render('pharma_record')).toBe('')

    const successful = receipt('pharma_record', 'manual')
    readToolDetail.mockClear()
    for (const status of ['planned', 'awaiting_approval', 'running'])
      expect(await render('pharma_record', status, false)).toBe('')
    for (const status of ['failed', 'cancelled'])
      expect(await render('pharma_record', status)).toBe('')
    expect(readToolDetail).not.toHaveBeenCalled()
    for (const result of [
      { ...successful.result, isError: true },
      { ...successful.result, partial: true },
      { ...successful.result, interrupted: true },
      { ...successful.result, cancelledBy: 'user' },
      { ...successful.result, transformedBy: 'other-extension' },
      { ...successful.result, code: 'CANCELLED' },
      { ...successful.result, toolUseId: 'another-call' },
      { ...successful.result, structured: { ...successful.result.structured, receiptFormat: undefined } },
      { ...successful.result, structured: { ...successful.result.structured, receiptFormat: 'legacy' } },
      { ...successful.result, structured: { ...successful.result.structured, revision: 0 } },
      { ...successful.result, structured: { ...successful.result.structured, signature: { ...successful.result.structured.signature, reviewedRevision: 1 } } },
      { ...successful.result, structured: { ...successful.result.structured, dossier: { ...successful.result.structured.dossier, evidence: { recordApprovals: [] } } } },
    ]) {
      displayed = { ...successful, result }
      expect(await render('pharma_record')).toBe('')
    }
    displayed = successful
    readDenied = true
    expect(await render('pharma_record')).toBe('')
    readDenied = false
    expect(await render('pharma_record')).toContain(`Signed by ${signer}`)
    readToolDetail.mockClear()
    source = 'different-tool-owner'
    // New rows need fresh provenance even though the app's readiness has not changed.
    expect(await render('pharma_record')).toBe('')
    source = pluginRowSource(backendRow)
    pinnedIntegrity = 'different-pinned-package'
    expect(await render('pharma_record')).toBe('')
    pinnedIntegrity = undefined
    expect(await render('pharma_record')).toBe('')
    expect(readToolDetail).not.toHaveBeenCalled()
    pinnedIntegrity = integrity
    expect(await render('pharma_record')).toContain(`Signed by ${signer}`)

    tools.mockRejectedValueOnce(new Error('Catalog temporarily unavailable'))
    await host.act(async () => context.session.setReadiness('ready', sessionId))
    expect(panel.querySelector('[data-testid="pharma-signed-receipt"]')).toBeNull()
    expect(await render('pharma_record')).toContain(`Signed by ${signer}`)

    const pending = Promise.withResolvers<typeof successful>()
    readToolDetail.mockReturnValueOnce(pending.promise)
    expect(await render('pharma_record')).toBe('')
    await host.act(async () => context.session.setSession('other-session', 'ready'))
    await host.act(async () => pending.resolve(successful))
    expect(panel.querySelector('[data-testid="pharma-signed-receipt"]')).toBeNull()
  } finally {
    await host.act(async () => unmountRegion(panel))
    await host.dispose()
  }
})
