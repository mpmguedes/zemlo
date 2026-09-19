import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCsvImport, previewCsvImport } from '../src/api/queries';

/**
 * O contrato de transporte do *import* de CSV.
 *
 * ## Porque é que este teste existe
 *
 * O formato das decisões na *query string* é um contrato com o servidor que **não** é
 * verificado pelo compilador: ambos os lados o descrevem como `ColumnDecision[]`, mas do lado
 * do servidor isso chega como texto e é analisado por `parseCsvOptions`. Uma divergência não
 * dá erro de tipos — dá um 400 em produção, ou pior, decisões silenciosamente ignoradas.
 *
 * Aconteceu exatamente isso durante a implementação: o cliente codificava as decisões como
 * `índice:campo` e o servidor esperava JSON. Nenhum teste de unidade de cada lado o apanharia,
 * porque cada lado estava internamente coerente. Este teste fixa o **formato transmitido**.
 *
 * ## Porque é que se intercepta o `fetch` e não o `api`
 *
 * Interceptar o `fetch` é o que põe este teste no único ponto onde a divergência pode
 * existir: o texto que sai para a rede. Simular o cliente HTTP testaria a nossa própria
 * abstração, que é precisamente o que não está em causa.
 */

interface Captured {
  url: string;
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

/** A *query string* do último pedido, já descodificada. */
function lastQuery(): URLSearchParams {
  const entry = captured.at(-1);
  if (!entry) throw new Error('Nenhum pedido capturado.');
  return new URL(entry.url, 'http://localhost').searchParams;
}

/** O menor corpo de resposta que satisfaz o tipo de retorno. */
const PREVIEW_BODY = {
  identity: { key: 'csv_u_hash', contentHash: 'hash' },
  detection: {
    encoding: 'utf-8',
    encodingConfidence: 1,
    encodingUncertain: false,
    delimiter: ';',
    delimiterLabel: 'ponto e vírgula',
    delimiterConfidence: 1,
    hasHeader: true,
    headers: ['Data'],
    rowCount: 1,
    physicalLineCount: 2,
    confidence: 1,
    issues: [],
    reasons: [],
  },
  mapping: {
    columns: [],
    ambiguousColumns: [],
    unmappedColumns: [],
    coverage: 1,
    readyWithoutInput: true,
    requiredFields: [],
  },
  inference: { state: 'inferido', kind: 'fuel', confidence: 0.9, alternatives: [], reason: '' },
  kind: 'fuel',
  preview: [],
  skipped: [],
  valueIssues: [],
  emptyReason: null,
  savedMap: null,
  plan: {
    state: 'ready',
    counts: {
      create: 0,
      exact: 0,
      probable: 0,
      quarantined: 0,
      skipped: 0,
      total: 0,
      enriching: 0,
      conflicting: 0,
      documentsMissingContent: 0,
    },
    issueSummary: { blocking: 0, recoverable: 0, info: 0, byCode: {} },
    issues: [],
    entries: [],
  },
};

const APPLY_BODY = {
  bundleId: 'csv_u_hash_fuel',
  applied: true,
  headline: 'Importei 1 registo',
  summary: {},
  created: [],
  enriched: [],
  skipped: [],
  batches: 1,
  issues: [],
  csv: '',
  savedMap: null,
};

const file = (): Blob => new Blob(['Data;Litros\n2026-04-03;45,6\n'], { type: 'text/csv' });

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Transporte dos bytes                                                        */
/* -------------------------------------------------------------------------- */

describe('transporte do ficheiro', () => {
  it('envia os bytes como corpo e declara-o como CSV', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), {});

    const sent = captured.at(-1);
    expect(sent?.contentType).toBe('text/csv');
    /*
     * O corpo é o `Blob` original, não uma serialização. É isto que garante que o `sha256`
     * calculado pelo servidor no `preview` e no `apply` é o mesmo — e é o que faz a segunda
     * importação do mesmo ficheiro ser reconhecida como idempotente.
     */
    expect(sent?.body).toBeInstanceOf(Blob);
  });

  it('não põe o `charset` no `Content-Type`', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), {});

    // Declarar a codificação seria uma afirmação do browser a competir com a deteção por
    // bytes. Um ficheiro CP1252 anunciado como UTF-8 produziria uma deteção a contradizer o
    // cabeçalho, e a regra «a codificação é detetada pelo conteúdo» deixaria de valer.
    expect(captured.at(-1)?.contentType).not.toContain('charset');
  });

  it('usa o mesmo transporte no `apply`', async () => {
    stubFetch(APPLY_BODY);
    await applyCsvImport(file(), {});
    expect(captured.at(-1)?.contentType).toBe('text/csv');
    expect(captured.at(-1)?.body).toBeInstanceOf(Blob);
  });

  it('dirige-se aos dois endereços separados', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), {});
    expect(captured.at(-1)?.url).toContain('/import/csv/preview');

    stubFetch(APPLY_BODY);
    await applyCsvImport(file(), {});
    expect(captured.at(-1)?.url).toContain('/import/csv/apply');
  });
});

/* -------------------------------------------------------------------------- */
/* Decisões de coluna                                                          */
/* -------------------------------------------------------------------------- */

describe('codificação das decisões', () => {
  it('envia as decisões em JSON, como o servidor as analisa', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), {
      kind: 'fuel',
      decisions: [
        { index: 0, field: 'date' },
        { index: 3, field: 'litres' },
      ],
    });

    const raw = lastQuery().get('decisions');
    expect(raw).not.toBeNull();
    /*
     * O valor tem de sobreviver a um `JSON.parse` — é literalmente o que `parseCsvOptions`
     * faz com ele. Fixar o array descodificado, e não a cadeia exata, deixa o teste passar
     * independentemente de a codificação de URL escapar as aspas ou não.
     */
    expect(JSON.parse(raw as string)).toEqual([
      { index: 0, field: 'date' },
      { index: 3, field: 'litres' },
    ]);
  });

  it('preserva o `null` de uma coluna ignorada', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { kind: 'fuel', decisions: [{ index: 1, field: null }] });

    const decoded = JSON.parse(lastQuery().get('decisions') as string);
    /*
     * A distinção entre `null` e ausente é validada pelo servidor (§10.4): `null` é «ignora
     * esta coluna», ausente é «ainda não decidi». Converter o `null` em `''` ou omiti-lo
     * transformaria uma resposta numa não-resposta, e a coluna voltaria a ser perguntada.
     */
    expect(decoded).toEqual([{ index: 1, field: null }]);
    expect(decoded[0]).toHaveProperty('field', null);
  });

  it('não envia o parâmetro quando não há decisões', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { kind: 'fuel', decisions: [] });

    // Ausente, o campo não é tocado. Um `decisions=[]` seria analisado como uma lista válida
    // e vazia, e substituiria um mapa guardado que o utilizador esperava reutilizar.
    expect(lastQuery().has('decisions')).toBe(false);
  });

  it('envia um índice zero sem o perder', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { decisions: [{ index: 0, field: 'date' }] });

    /*
     * Um índice `0` é válido e é a primeira coluna. Uma verificação de veracidade
     * (`if (decision.index)`) descartá-la-ia em silêncio, e a coluna mais à esquerda de
     * todos os ficheiros deixaria de ser mapeável.
     */
    expect(JSON.parse(lastQuery().get('decisions') as string)).toEqual([{ index: 0, field: 'date' }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Convenções e identidade                                                     */
/* -------------------------------------------------------------------------- */

describe('convenções e identidade', () => {
  it('transmite as convenções com os identificadores do domínio', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { dateOrder: 'dia-mes', decimalStyle: 'virgula' });

    expect(lastQuery().get('dateOrder')).toBe('dia-mes');
    expect(lastQuery().get('decimalStyle')).toBe('virgula');
  });

  it('usa o identificador «mes-dia» e não uma variante', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { dateOrder: 'mes-dia' });
    expect(lastQuery().get('dateOrder')).toBe('mes-dia');
  });

  it('transmite o tipo de registo escolhido', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { kind: 'maintenance' });
    expect(lastQuery().get('kind')).toBe('maintenance');
  });

  it('transmite a identidade do ficheiro no `apply`', async () => {
    stubFetch(APPLY_BODY);
    await applyCsvImport(file(), { kind: 'fuel', identity: 'csv_u_hash_fuel' });

    // É o valor que o servidor confronta com o `sha256` dos bytes que recebeu. Sem ele, a
    // defesa contra «o plano não é deste ficheiro» deixaria de atuar (o servidor trata a
    // ausência como «nada a confrontar»).
    expect(lastQuery().get('identity')).toBe('csv_u_hash_fuel');
  });

  it('não envia uma identidade vazia', async () => {
    stubFetch(APPLY_BODY);
    await applyCsvImport(file(), { kind: 'fuel', identity: '' });

    /*
     * Uma cadeia vazia é diferente de ausente: `parseIdentityParam` só a ignora quando o
     * parâmetro não existe ou é vazio — e enviá-la produziria um identificador que nunca
     * corresponde ao `identity.key`, recusando sempre com 409.
     */
    expect(lastQuery().has('identity')).toBe(false);
  });

  it('não polui a *query* com parâmetros por omissão', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), {});

    const query = lastQuery();
    expect(query.toString()).toBe('');
  });

  it('não envia a política de conflito quando não foi escolhida', async () => {
    stubFetch(PREVIEW_BODY);
    await previewCsvImport(file(), { kind: 'fuel' });

    // O servidor decide o valor por omissão (`fill-empty`, decisão 8). Enviá-lo daqui
    // fixaria a política no cliente, e uma alteração ao valor por omissão do domínio
    // deixaria de chegar à interface.
    expect(lastQuery().has('conflictPolicy')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Erros                                                                       */
/* -------------------------------------------------------------------------- */

describe('erros', () => {
  it('traduz o envelope de erro da API', async () => {
    stubFetch(
      {
        error: {
          code: 'validation_error',
          message: 'Não foi possível perceber que tipo de registos este ficheiro contém.',
          requestId: 'req-1',
        },
      },
      422,
    );

    await expect(previewCsvImport(file(), {})).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      message: /tipo de registos/,
    });
  });

  it('recusa um 415 com a mensagem do servidor', async () => {
    // Um 415 acontece quando o `Content-Type` não é aceite. É o erro que um cliente que
    // enviasse `multipart/form-data` receberia, e a mensagem tem de chegar ao ecrã.
    stubFetch({ error: { code: 'validation_error', message: 'Tipo de ficheiro não aceite.' } }, 415);

    await expect(previewCsvImport(file(), {})).rejects.toMatchObject({ status: 415 });
  });
});
