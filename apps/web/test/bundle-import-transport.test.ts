import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBundleImport, previewBundleImport } from '../src/api/queries';
import type { BundlePreviewResponse } from '../src/api/bundleImport';

/**
 * O contrato de transporte do *import* do bundle nativo (Camada 1, §3.1).
 *
 * ## Porque é que este teste existe
 *
 * Dois detalhes deste transporte **não** são verificados pelo compilador, e ambos falham em
 * silêncio:
 *
 *  1. **O `Content-Type`.** O `api.upload` recebe-o como `string` e envia-o tal como está. Se
 *     dissesse `text/csv`, o servidor recusaria com **415** e a mensagem que o utilizador veria
 *     ("o ficheiro tem de ser enviado como um ZIP") apontaria para o ficheiro — que está certo.
 *     A causa real estaria no cliente, e o diagnóstico não.
 *  2. **O formato do plano na *query*.** A rota do `apply` lê `?plan=<JSON>` e usa o
 *     `bundleId` para confronto. O servidor **recusa** um plano que não seja JSON, ou que não
 *     seja um objeto — mas só o faz com um 400, depois de o utilizador já ter confirmado a
 *     importação. Um cliente que codificasse o plano de outra forma quebraria o ciclo no
 *     último passo.
 *
 * É a mesma disciplina de `csv-import-transport.test.ts`: fixa-se o que sai para a rede, e
 * não o que a nossa abstração faz por dentro.
 *
 * ## Porque é que o corpo é verificado como bytes
 *
 * O bundle é binário e o `sha256` que o leitor verifica refere-se aos bytes **originais**.
 * Um cliente que reencodasse o corpo — ou que o serializasse como texto — produziria um
 * ficheiro que o servidor recusaria por integridade, com uma mensagem sobre um ficheiro
 * corrompido que na verdade nunca foi corrompido. Comparar os bytes é o que prova que a
 * camada de transporte não lhes toca.
 */

interface Captured {
  url: string;
  method: string;
  contentType: string | null;
  body: unknown;
}

let captured: Captured[] = [];

function stubFetch(payload: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured.push({
        url: String(input),
        method: init?.method ?? 'GET',
        contentType: headers.get('Content-Type'),
        body: init?.body,
      });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  captured = [];
  // As funções de transporte leem o token do armazenamento; sem ele o cabeçalho sairia
  // `Bearer undefined` e o pedido nem chegaria ao servidor. O valor não é validado aqui —
  // o que se fixa é o transporte, não a autenticação.
  const store = new Map<string, string>([['zemlo.accessToken', 'token-de-teste']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Uma resposta de preview mínima, mas com a forma que o `apply` reenvia. */
function previewPayload(): BundlePreviewResponse {
  return {
    bundleId: 'bnd_teste',
    state: 'ready',
    counts: {
      create: 2,
      exact: 0,
      probable: 0,
      quarantined: 0,
      skipped: 0,
      total: 2,
      enriching: 0,
      conflicting: 0,
      documentsMissingContent: 0,
    },
    issueSummary: { blocking: 0, recoverable: 0, info: 0, byCode: {} },
    issues: [],
    entries: [],
    files: [{ path: 'vehicles.jsonl', records: 1, bytes: 120 }],
    summary: { vehicles: 1, declaredCounts: { vehicles: 1 } },
  };
}

/** Bytes que não são UTF-8 válido, para detetar qualquer reencoding pelo caminho. */
function binaryZip(): Blob {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x01]);
  return new Blob([bytes], { type: 'application/zip' });
}

const ORIGINAL_BYTES = [0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x01];

/**
 * Lê os bytes do corpo capturado, seja qual for a forma que o `fetch` recebeu.
 *
 * O `fetch` aceita `Blob`, `ArrayBuffer`, `Uint8Array` e mais — e qual deles chega depende
 * do que o ambiente do teste implementa, não do cliente. Normalizar aqui é o que permite
 * comparar os bytes em vez de comparar a forma: sem isto, o teste falharia por uma
 * diferença de representação que não diz nada sobre o que saiu para a rede.
 */
async function bodyBytes(body: unknown): Promise<number[]> {
  if (body instanceof Blob) return [...new Uint8Array(await body.arrayBuffer())];
  if (body instanceof ArrayBuffer) return [...new Uint8Array(body)];
  if (ArrayBuffer.isView(body)) {
    return [...new Uint8Array(body.buffer, body.byteOffset, body.byteLength)];
  }
  throw new Error(`Corpo com uma forma inesperada: ${Object.prototype.toString.call(body)}`);
}

describe('POST /import/preview — o bundle', () => {
  it('bate no endereço da Camada 1', async () => {
    stubFetch(previewPayload());
    await previewBundleImport(binaryZip());

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain('/import/preview');
    expect(captured[0]!.url).not.toContain('/csv');
  });

  it('envia application/zip — não text/csv', async () => {
    stubFetch(previewPayload());
    await previewBundleImport(binaryZip());

    expect(captured[0]!.contentType).toBe('application/zip');
  });

  it('envia os bytes sem os tocar', async () => {
    stubFetch(previewPayload());
    await previewBundleImport(binaryZip());

    expect(await bodyBytes(captured[0]!.body)).toEqual(ORIGINAL_BYTES);
  });

  it('não acrescenta parâmetros à query', async () => {
    stubFetch(previewPayload());
    await previewBundleImport(binaryZip());

    const url = new URL(captured[0]!.url, 'http://localhost');
    // O bundle já traz os seus valores interpretados: não há decisões nem convenções a
    // enviar. Um parâmetro a mais seria ignorado pelo servidor, mas a sua presença diria
    // que a Camada 1 aceita opções que não tem.
    expect([...url.searchParams.keys()]).toEqual([]);
  });
});

describe('POST /import/apply — o bundle', () => {
  it('reenvia o mesmo ficheiro e o plano na query', async () => {
    stubFetch({ applied: true });
    await applyBundleImport(binaryZip(), previewPayload());

    expect(captured[0]!.url).toContain('/import/apply');
    expect(captured[0]!.contentType).toBe('application/zip');
    expect(await bodyBytes(captured[0]!.body)).toEqual(ORIGINAL_BYTES);
  });

  it('serializa o plano como JSON com o bundleId', async () => {
    stubFetch({ applied: true });
    await applyBundleImport(binaryZip(), previewPayload());

    const plan = new URL(captured[0]!.url, 'http://localhost').searchParams.get('plan');
    expect(plan).not.toBeNull();

    const parsed = JSON.parse(plan!) as { bundleId: string };
    expect(parsed.bundleId).toBe('bnd_teste');
  });

  /**
   * O plano reenviado tem de ser o que o **preview** devolveu, campo a campo.
   *
   * Se a interface o reconstruísse — escolhendo os campos que julga necessários — a
   * primeira adição ao plano no servidor deixaria de chegar ao `apply` em silêncio, e a
   * divergência apareceria como uma importação que aplica menos do que o utilizador viu.
   */
  it('reenvia o plano inteiro, sem o reduzir', async () => {
    stubFetch({ applied: true });
    const preview = previewPayload();
    await applyBundleImport(binaryZip(), preview);

    const plan = new URL(captured[0]!.url, 'http://localhost').searchParams.get('plan');
    expect(JSON.parse(plan!)).toEqual(preview);
  });
});
