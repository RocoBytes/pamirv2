import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFileDownload, describeFileDownloadError } from './file-download'
import { ApiError } from './api'

describe('startFileDownload', () => {
  let assign: ReturnType<typeof vi.fn>
  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assign = vi.fn()
    open = vi.fn()
    vi.stubGlobal('window', { location: { assign }, open })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigates in place to a signed GCS URL instead of opening a new tab', () => {
    startFileDownload({
      url: 'https://storage.googleapis.com/pamirv2-files-dev/orgs/x/gpx/abc.gpx?sig=1',
      expiresInSeconds: 600,
    })
    expect(assign).toHaveBeenCalledWith(
      'https://storage.googleapis.com/pamirv2-files-dev/orgs/x/gpx/abc.gpx?sig=1',
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a legacy viewer link in a new tab and strips window.opener', () => {
    const fakeWindow: { opener: unknown } = { opener: 'x' }
    open.mockReturnValue(fakeWindow)

    startFileDownload({ url: 'https://legacy-viewer.example.com/file/abc/view', expiresInSeconds: null })

    expect(open).toHaveBeenCalledWith('https://legacy-viewer.example.com/file/abc/view', '_blank')
    expect(fakeWindow.opener).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('falls back to same-tab navigation when the popup blocker returns null', () => {
    open.mockReturnValue(null)

    startFileDownload({ url: 'https://legacy-viewer.example.com/file/abc/view', expiresInSeconds: null })

    expect(open).toHaveBeenCalledWith('https://legacy-viewer.example.com/file/abc/view', '_blank')
    expect(assign).toHaveBeenCalledWith('https://legacy-viewer.example.com/file/abc/view')
  })

  it('rejects a non-https URL without navigating anywhere', () => {
    expect(() =>
      startFileDownload({ url: 'javascript:alert(1)', expiresInSeconds: 600 }),
    ).toThrow('https')
    expect(assign).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a memory:-style fake URL', () => {
    expect(() =>
      startFileDownload({ url: 'memory://local/fake.gpx', expiresInSeconds: 600 }),
    ).toThrow('https')
  })
})

describe('describeFileDownloadError', () => {
  it('returns a fixed message for 404, regardless of the server text', () => {
    expect(describeFileDownloadError(new ApiError('Salida no encontrada', 404))).toBe(
      'El archivo ya no está disponible.',
    )
  })

  it('passes through the server message for 403 when present (it names the club)', () => {
    expect(
      describeFileDownloadError(
        new ApiError('No eres socio de Andino Club Pamir', 403),
      ),
    ).toBe('No eres socio de Andino Club Pamir')
  })

  it('falls back to a generic 403 message when the server sent none', () => {
    expect(describeFileDownloadError(new ApiError('HTTP 403', 403))).toBe(
      'No tienes permiso para descargar este archivo.',
    )
  })

  it('returns a generic retry message for any other status', () => {
    expect(describeFileDownloadError(new ApiError('HTTP 500', 500))).toBe(
      'No se pudo preparar la descarga. Inténtalo de nuevo.',
    )
  })

  it('returns a generic retry message for a non-ApiError', () => {
    expect(describeFileDownloadError(new Error('network down'))).toBe(
      'No se pudo preparar la descarga. Inténtalo de nuevo.',
    )
  })
})
