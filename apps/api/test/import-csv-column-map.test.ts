/**
 * Mapa de colunas persistido — FASE G (§10.2 passo 9, §11.3).
 *
 * ## Porque é que esta suite existe
 *
 * A §11.3 fecha com um princípio — **"Não pedir duas vezes"** — e a §10.2 diz, no passo 9,
 * que guardar o mapa *"faz com que a segunda importação do mesmo fornecedor seja um
 * clique. É o que distingue uma funcionalidade usada de uma abandonada."*
 *
 * Uma funcionalidade de conveniência pode parecer funcionar e estar errada de três
 * maneiras que aqui se testam explicitamente:
 *
 *  1. **guardar o mapa errado** — o mapa é reaproveitado, mas aponta para campos que
 *     mudaram, e a importação seguinte escreve dados trocados sem avisar;
 *  2. **reutilizar quando não devia** — o fornecedor mudou o formato e o mapa antigo é
 *     aplicado na mesma, produzindo uma importação silenciosamente errada;
 *  3. **deixar de reutilizar quando devia** — o ficheiro é o mesmo mas bastou reordenar as
 *     colunas (ou renomear o ficheiro) para o sistema voltar a pedir tudo. É o falhanço
 *     que mata a funcionalidade na prática, porque o utilizador deixa de confiar nela.
 *
 * A suite ataca os três, mais o **isolamento por conta**, que é o único requisito de
 * segurança desta fase: *"Não existe nenhum mapa global que possa misturar utilizadores."*
 *
 * ## O que esta suite NÃO testa
 *
 * Não testa a API HTTP (FASE H) nem a UI (FASE I). Esta fase é a persistência, e é isso
 * que aqui se prova: o serviço, o esquema, o isolamento e a lógica de reaplicação.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeColumnName } from '@zemlo/shared';

import { applySavedMapToTable, resolveMapping, mapColumns } from '../src/domain/import/csv/mapping.js';
import { parseCsv } from '../src/domain/import/csv/parse.js';
import { isUsableShapeKey, shapeKey, shapeSignature } from '../src/domain/import/csv/shape.js';
import {
  countSavedMaps,
  deleteSavedMap,
  findSavedMap,
  listSavedMaps,
  saveColumnMap,
  touchColumnMap,
} from '../src/services/import/column-map.js';
import { createTestDb, createUser, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Cabeçalho típico de um exportador português (§5.4). */
const HEADERS = ['Data', 'Matrícula', 'Quilometragem', 'Litros', 'Valor'];

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db.destroy();
});

/* -------------------------------------------------------------------------- */
/* 1. A assinatura de forma                                                    */
/* -------------------------------------------------------------------------- */

describe('assinatura de forma — o que faz um mapa ser reutilizável', () => {
  it('é estável para o mesmo conjunto de cabeçalhos', () => {
    expect(shapeKey(HEADERS)).toBe(shapeKey([...HEADERS]));
  });

  /**
   * A ordem é irrelevante — e é isso que impede a reconfirmação quando o fornecedor
   * reordena as colunas, que é comum em exportações de Excel.
   */
  it('não muda quando as colunas são reordenadas', () => {
    const reordered = ['Valor', 'Litros', 'Matrícula', 'Data', 'Quilometragem'];
    expect(shapeKey(reordered)).toBe(shapeKey(HEADERS));
  });

  /**
   * Maiúsculas, acentos e pontuação são a mesma coluna. Tratar `MATRICULA` como um formato
   * diferente de `Matrícula` obrigaria a reconfirmar sem motivo nenhum.
   */
  it('trata variações de escrita do mesmo nome como a mesma coluna', () => {
    expect(shapeKey(['MATRICULA', 'DATA', 'VALOR'])).toBe(
      shapeKey(['matrícula', 'data', 'valor']),
    );
    expect(shapeKey(['Matrícula ', ' Data'])).toBe(shapeKey(['Matricula', 'Data']));
  });

  /** Acrescentar ou remover uma coluna é uma mudança de formato: o mapa tem de cair. */
  it('muda quando uma coluna é acrescentada ou removida', () => {
    const base = shapeKey(HEADERS);
    expect(shapeKey([...HEADERS, 'Notas'])).not.toBe(base);
    expect(shapeKey(HEADERS.slice(0, 4))).not.toBe(base);
  });

  /** Renomear uma coluna é a única evidência de significado que existe: muda a forma. */
  it('muda quando uma coluna é renomeada', () => {
    const renamed = ['Data', 'Matrícula', 'Quilometragem', 'Litros', 'Total'];
    expect(shapeKey(renamed)).not.toBe(shapeKey(HEADERS));
  });

  it('está vazia quando não há cabeçalhos reconhecíveis', () => {
    expect(shapeSignature([])).toBe('');
    expect(shapeKey([])).toBe('0:');
    expect(shapeKey(['', '   ', '()'])).toBe('0:');
  });

  it('recusa-se a ser usada como chave quando está vazia', () => {
    expect(isUsableShapeKey('0:')).toBe(false);
    expect(isUsableShapeKey('')).toBe(false);
    expect(isUsableShapeKey(shapeKey(HEADERS))).toBe(true);
  });

  /**
   * A contagem de colunas distingue uma coluna chamada `A B` de duas colunas `A` e `B`.
   * Sem ela, dois formatos diferentes partilhariam a assinatura `a b` e o mapa de um
   * seria aplicado ao outro.
   */
  it('distingue nomes compostos de nomes separados', () => {
    expect(shapeKey(['A B'])).not.toBe(shapeKey(['A', 'B']));
  });

  it('é determinística entre chamadas', () => {
    const first = shapeKey(HEADERS);
    for (let i = 0; i < 5; i += 1) expect(shapeKey(HEADERS)).toBe(first);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Guardar e encontrar                                                      */
/* -------------------------------------------------------------------------- */

describe('persistência do mapa', () => {
  it('guarda e volta a encontrar o mapa da mesma forma', async () => {
    const user = await createUser(db);

    const saved = await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 1, field: 'plate' },
        { index: 2, field: 'odometerKm' },
        { index: 3, field: 'litres' },
        { index: 4, field: 'amountCents' },
      ],
      delimiter: ';',
      encoding: 'utf-8',
    });

    expect(saved.id).toBeTruthy();
    expect(saved.kind).toBe('fuel');
    expect(saved.timesUsed).toBe(0);

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saved.id);
    expect(found?.decisions).toHaveLength(5);
    expect(found?.headers).toEqual(HEADERS);
  });

  it('devolve `null` quando não há mapa — e isso não é um erro', async () => {
    const user = await createUser(db);

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'expense',
      headers: ['Coluna A', 'Coluna B'],
    });

    expect(found).toBeNull();
  });

  /**
   * A chave é `(userId, kind, shapeKey)`. Confirmar o mesmo formato duas vezes tem de
   * resultar **num** mapa, não em dois — senão a leitura teria de escolher entre eles.
   */
  it('substitui em vez de duplicar quando a mesma forma é confirmada duas vezes', async () => {
    const user = await createUser(db);

    const first = await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [{ index: 0, field: 'date' }],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const second = await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 1, field: 'plate' },
      ],
      delimiter: ',',
      encoding: 'windows-1252',
    });

    expect(second.id).toBe(first.id);
    expect(await countSavedMaps(db.prisma, user.id)).toBe(1);

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    // A última confirmação ganha. Acumular decisões faria uma correção antiga sobreviver
    // a uma nova — o utilizador corrigiria o mesmo erro em cada importação.
    expect(found?.decisions).toHaveLength(2);
    expect(found?.delimiter).toBe(',');
    expect(found?.encoding).toBe('windows-1252');
  });

  /**
   * O mesmo cabeçalho pode servir dois tipos com significados diferentes. Se o `kind` não
   * fizesse parte da chave, o mapa de um contaminaria o outro.
   */
  it('não mistura mapas de tipos de registo diferentes', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [{ index: 3, field: 'litres' }],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const asExpense = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'expense',
      headers: HEADERS,
    });

    expect(asExpense).toBeNull();
  });

  /** Guardar uma forma sem cabeçalhos reconhecíveis seria guardar um mapa universal. */
  it('recusa guardar um mapa sem forma utilizável', async () => {
    const user = await createUser(db);

    await expect(
      saveColumnMap(db.prisma, {
        userId: user.id,
        kind: 'fuel',
        headers: ['', '  '],
        decisions: [],
        delimiter: ';',
        encoding: 'utf-8',
      }),
    ).rejects.toThrow();
  });

  /** As convenções da §10.4 têm de sobreviver ao ciclo de escrita e leitura. */
  it('preserva as convenções confirmadas pelo utilizador', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
      dateOrder: 'dia-mes',
      decimalStyle: 'virgula',
    });

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(found?.dateOrder).toBe('dia-mes');
    expect(found?.decimalStyle).toBe('virgula');
  });

  it('devolve `null` nas convenções quando não foram decididas', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: ['A', 'B'],
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: ['A', 'B'],
    });

    expect(found?.dateOrder).toBeNull();
    expect(found?.decimalStyle).toBeNull();
  });

  /** Uma coluna ignorada (`field: null`) é uma decisão legítima da §10.4 e tem de persistir. */
  it('preserva uma coluna declaradamente ignorada', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: [...HEADERS, 'Km/l'],
      decisions: [
        { index: 0, field: 'date' },
        { index: 5, field: null },
      ],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: [...HEADERS, 'Km/l'],
    });

    const ignored = found?.decisions.find((decision) => decision.index === 5);
    expect(ignored).toBeDefined();
    expect(ignored?.field).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Isolamento por conta (§7.3)                                              */
/* -------------------------------------------------------------------------- */

describe('isolamento por conta', () => {
  /**
   * O requisito é explícito: *"Não existe nenhum armazenamento global que possa misturar
   * mapas de utilizadores."* Duas contas com o **mesmo formato** de ficheiro não se vêem.
   */
  it('não deixa uma conta ver o mapa de outra com o mesmo formato', async () => {
    const alice = await createUser(db, { email: 'alice-map@zemlo.test' });
    const bob = await createUser(db, { email: 'bob-map@zemlo.test' });

    await saveColumnMap(db.prisma, {
      userId: alice.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [{ index: 0, field: 'date' }],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const bobsView = await findSavedMap(db.prisma, {
      userId: bob.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(bobsView).toBeNull();
  });

  it('mantém os mapas de duas contas separados no mesmo formato', async () => {
    const alice = await createUser(db, { email: 'alice-two@zemlo.test' });
    const bob = await createUser(db, { email: 'bob-two@zemlo.test' });

    await saveColumnMap(db.prisma, {
      userId: alice.id,
      kind: 'expense',
      headers: HEADERS,
      decisions: [{ index: 0, field: 'date' }],
      delimiter: ';',
      encoding: 'utf-8',
    });

    await saveColumnMap(db.prisma, {
      userId: bob.id,
      kind: 'expense',
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 4, field: 'amountCents' },
      ],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const aliceMap = await findSavedMap(db.prisma, {
      userId: alice.id,
      kind: 'expense',
      headers: HEADERS,
    });
    const bobMap = await findSavedMap(db.prisma, {
      userId: bob.id,
      kind: 'expense',
      headers: HEADERS,
    });

    expect(aliceMap?.decisions).toHaveLength(1);
    expect(bobMap?.decisions).toHaveLength(2);
    expect(aliceMap?.id).not.toBe(bobMap?.id);
  });

  /** A listagem também é por conta — o modo avançado (§11.4) não pode mostrar de outros. */
  it('lista apenas os mapas da própria conta', async () => {
    const alice = await createUser(db, { email: 'alice-list@zemlo.test' });
    const bob = await createUser(db, { email: 'bob-list@zemlo.test' });

    await saveColumnMap(db.prisma, {
      userId: alice.id,
      kind: 'fuel',
      headers: ['A', 'B'],
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });
    await saveColumnMap(db.prisma, {
      userId: alice.id,
      kind: 'fuel',
      headers: ['C', 'D'],
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });
    await saveColumnMap(db.prisma, {
      userId: bob.id,
      kind: 'fuel',
      headers: ['E', 'F'],
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const aliceMaps = await listSavedMaps(db.prisma, { userId: alice.id });
    expect(aliceMaps).toHaveLength(2);
    expect(aliceMaps.every((map) => map.headers.includes('A') || map.headers.includes('C'))).toBe(
      true,
    );
  });

  /** Apagar o mapa de uma conta não pode afetar o de outra, mesmo com a mesma forma. */
  it('não deixa uma conta apagar o mapa de outra', async () => {
    const alice = await createUser(db, { email: 'alice-del@zemlo.test' });
    const bob = await createUser(db, { email: 'bob-del@zemlo.test' });

    await saveColumnMap(db.prisma, {
      userId: alice.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });
    await saveColumnMap(db.prisma, {
      userId: bob.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const removed = await deleteSavedMap(db.prisma, {
      userId: bob.id,
      kind: 'fuel',
      headers: HEADERS,
    });
    expect(removed).toBe(true);

    const aliceStillThere = await findSavedMap(db.prisma, {
      userId: alice.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(aliceStillThere).not.toBeNull();
  });

  /**
   * O mapa desaparece com a conta. É o `onDelete: Cascade` do `userId` — o mesmo que o
   * livro de idempotência usa, e a razão pela qual não é preciso um trabalho de limpeza:
   * o que é guardado em nome de um utilizador desaparece com ele.
   */
  it('apaga os mapas quando a conta é apagada', async () => {
    const user = await createUser(db, { email: 'cascade-map@zemlo.test' });

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    expect(await countSavedMaps(db.prisma, user.id)).toBe(1);

    await db.prisma.user.delete({ where: { id: user.id } });

    expect(await countSavedMaps(db.prisma, user.id)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Contador de utilização                                                   */
/* -------------------------------------------------------------------------- */

describe('contador de utilização', () => {
  it('incrementa e regista a data da última utilização', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const before = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(await touchColumnMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS })).toBe(
      true,
    );
    expect(await touchColumnMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS })).toBe(
      true,
    );

    const after = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(after?.timesUsed).toBe(2);
    expect(after?.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before?.lastUsedAt.getTime() ?? 0);
  });

  /**
   * Reconfirmar o mapa **não** reinicia o contador: o contador é sobre utilizações, e o
   * número a descer ao corrigir uma coluna seria desconcertante.
   */
  it('não reinicia o contador quando o mapa é reconfirmado', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });
    await touchColumnMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS });

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [{ index: 0, field: 'date' }],
      delimiter: ';',
      encoding: 'utf-8',
    });

    const found = await findSavedMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
    });

    expect(found?.timesUsed).toBe(1);
    expect(found?.decisions).toHaveLength(1);
  });

  /**
   * Uma contagem que falha devolve `false` em vez de lançar: o contador é telemetria de
   * produto, e não pode impedir uma importação de acontecer.
   */
  it('devolve `false` sem lançar quando o mapa não existe', async () => {
    const user = await createUser(db);

    const touched = await touchColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: ['Nunca', 'Guardado'],
    });

    expect(touched).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Apagar                                                                   */
/* -------------------------------------------------------------------------- */

describe('apagar o mapa', () => {
  it('é idempotente — apagar o que não existe é sucesso', async () => {
    const user = await createUser(db);

    expect(
      await deleteSavedMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS }),
    ).toBe(false);
  });

  it('remove o mapa de forma efetiva', async () => {
    const user = await createUser(db);

    await saveColumnMap(db.prisma, {
      userId: user.id,
      kind: 'fuel',
      headers: HEADERS,
      decisions: [],
      delimiter: ';',
      encoding: 'utf-8',
    });

    expect(
      await deleteSavedMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS }),
    ).toBe(true);

    expect(
      await findSavedMap(db.prisma, { userId: user.id, kind: 'fuel', headers: HEADERS }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Reaplicação por nome — a parte que tem de ser exata                      */
/* -------------------------------------------------------------------------- */

describe('reaplicação do mapa guardado', () => {
  /** O caso base: as colunas estão na mesma ordem em que foram confirmadas. */
  it('traduz índices quando a ordem é a mesma', () => {
    const table = { headers: HEADERS };

    const saved = {
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 1, field: 'plate' },
        { index: 3, field: 'litres' },
      ],
    };

    const applied = applySavedMapToTable(table, saved);

    expect(applied.decisions).toEqual([
      { index: 0, field: 'date' },
      { index: 1, field: 'plate' },
      { index: 3, field: 'litres' },
    ]);
    expect(applied.uncoveredColumns).toEqual(['Quilometragem', 'Valor']);
    expect(applied.unmatchedHeaders).toEqual([]);
  });

  /**
   * **O teste que justifica a função.** As colunas foram reordenadas pelo fornecedor. Se
   * os índices fossem reaplicados diretamente, `Data` (índice 0 no mapa) passaria a apontar
   * para `Valor` no ficheiro novo, e a importação escreveria valores trocados **sem erro
   * nenhum**.
   */
  it('redireciona cada decisão para a coluna certa quando a ordem muda', () => {
    // O ficheiro novo: as mesmas colunas, por outra ordem.
    const table = { headers: ['Valor', 'Litros', 'Matrícula', 'Data', 'Quilometragem'] };

    // O mapa foi confirmado sobre a ordem antiga.
    const saved = {
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' }, // Data
        { index: 1, field: 'plate' }, // Matrícula
        { index: 3, field: 'litres' }, // Litros
        { index: 4, field: 'amountCents' }, // Valor
      ],
    };

    const applied = applySavedMapToTable(table, saved);

    const byField = new Map(applied.decisions.map((d) => [d.field, d.index]));

    // `Data` está agora no índice 3, e não no 0.
    expect(byField.get('date')).toBe(3);
    // `Matrícula` passou para o índice 2.
    expect(byField.get('plate')).toBe(2);
    // `Litros` passou para o índice 1.
    expect(byField.get('litres')).toBe(1);
    // `Valor` passou para o índice 0.
    expect(byField.get('amountCents')).toBe(0);

    // Nenhuma decisão aponta para a coluna errada — a asserção que o defeito violaria.
    expect(byField.get('date')).not.toBe(0);
  });

  it('tolera variações de escrita nos cabeçalhos novos', () => {
    const table = { headers: ['DATA', 'matricula', 'QUILOMETRAGEM', 'Litros', 'Valor'] };
    const saved = {
      headers: HEADERS,
      decisions: [{ index: 1, field: 'plate' }],
    };

    const applied = applySavedMapToTable(table, saved);
    expect(applied.decisions).toEqual([{ index: 1, field: 'plate' }]);
  });

  /** Uma coluna nova que o mapa não cobre tem de ser declarada, não silenciada. */
  it('declara as colunas que o mapa não cobre', () => {
    const table = { headers: [...HEADERS, 'Categoria'] };
    const saved = { headers: HEADERS, decisions: [{ index: 0, field: 'date' }] };

    const applied = applySavedMapToTable(table, saved);

    expect(applied.uncoveredColumns).toContain('Categoria');
  });

  /** Uma decisão que aponta para fora dos cabeçalhos guardados é um mapa corrompido. */
  it('ignora decisões que apontam para fora do mapa', () => {
    const table = { headers: HEADERS };
    const saved = {
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 99, field: 'plate' },
      ],
    };

    const applied = applySavedMapToTable(table, saved);

    expect(applied.decisions).toEqual([{ index: 0, field: 'date' }]);
  });

  /**
   * Dois cabeçalhos que normalizam para o mesmo nome tornam a tradução ambígua. A colisão
   * é **sinalizada** e não resolvida — a §10.4 proíbe escolher em silêncio.
   */
  it('sinaliza cabeçalhos que normalizam para o mesmo nome', () => {
    const table = { headers: ['Preço', 'PRECO', 'Data'] };
    const saved = {
      headers: ['Preço', 'Data'],
      decisions: [
        { index: 0, field: 'amountCents' },
        { index: 1, field: 'date' },
      ],
    };

    const applied = applySavedMapToTable(table, saved);

    expect(applied.ambiguousHeaders).toContain(normalizeColumnName('Preço'));
    // As duas decisões continuam a ser traduzidas, uma por cada ocorrência, por ordem.
    expect(applied.decisions).toHaveLength(2);
    expect(new Set(applied.decisions.map((d) => d.index)).size).toBe(2);
  });

  it('declara cabeçalhos do mapa que não encontram coluna', () => {
    const table = { headers: ['Data', 'Valor'] };
    const saved = {
      headers: HEADERS,
      decisions: [
        { index: 0, field: 'date' },
        { index: 3, field: 'litres' },
      ],
    };

    const applied = applySavedMapToTable(table, saved);

    expect(applied.unmatchedHeaders).toContain('Litros');
  });

  it('produz decisões vazias para um mapa vazio', () => {
    const applied = applySavedMapToTable({ headers: HEADERS }, { headers: HEADERS, decisions: [] });

    expect(applied.decisions).toEqual([]);
    expect(applied.uncoveredColumns).toEqual(HEADERS);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. O ciclo completo: reaplicar o mapa através do mapeador real              */
/* -------------------------------------------------------------------------- */

describe('ciclo completo com o mapeador real', () => {
  /**
   * Este teste fecha o circuito: o mapa guardado é reaplicado à tabela, as decisões
   * traduzidas entram no `resolveMapping` a sério, e o resultado é um mapa com os campos
   * certos **apesar de as colunas estarem trocadas**.
   *
   * Sem esta prova, os testes de `applySavedMapToTable` isolados não garantiriam que as
   * decisões traduzidas são aceites pelo validador de decisões — que rejeita índices
   * inexistentes e campos que não eram candidatos.
   */
  it('produz o mapeamento correto para um ficheiro com as colunas reordenadas', async () => {
    const reorderedCsv = [
      'Valor;Litros;Matrícula;Data;Quilometragem',
      '45,50;32,4;AA-00-BB;25/02/2026;125000',
    ].join('\r\n');

    const table = parseCsv(utf8(reorderedCsv));

    // O mapa foi confirmado sobre a ordem canónica.
    const savedHeaders = HEADERS;
    const savedDecisions = [
      { index: 0, field: 'date' },
      { index: 1, field: 'plate' },
      { index: 2, field: 'odometerKm' },
      { index: 3, field: 'litres' },
      { index: 4, field: 'amountCents' },
    ];

    const applied = applySavedMapToTable(table, {
      headers: savedHeaders,
      decisions: savedDecisions,
    });

    // O mapeamento automático do ficheiro novo, para obter a estrutura de colunas.
    const proposed = mapColumns(table, { kind: 'fuel' });

    // As decisões traduzidas são aplicadas pelo validador real.
    const resolved = resolveMapping(proposed, applied.decisions, 'fuel');

    // Nenhuma decisão foi rejeitada por incoerência.
    expect(resolved.invalid).toEqual([]);

    const byField = new Map(
      resolved.columns.filter((c) => c.field !== null).map((c) => [c.field, c.index]),
    );

    // `Data` está no índice 3 do ficheiro reordenado — e o mapa final aponta para lá.
    expect(byField.get('date')).toBe(3);
    expect(byField.get('plate')).toBe(2);
    expect(byField.get('litres')).toBe(1);
    expect(byField.get('amountCents')).toBe(0);
    expect(byField.get('odometerKm')).toBe(4);

    // A clara asserção do defeito: nenhum campo aponta para a coluna de outro.
    for (const [field, index] of byField) {
      const header = table.headers[index];
      expect(header).toBeDefined();
      // Nada de `date` na coluna `Valor`.
      if (field === 'date') expect(header).not.toBe('Valor');
      if (field === 'amountCents') expect(header).not.toBe('Data');
    }
  });

  /** O mesmo ciclo, mas com o ficheiro na ordem original — o caminho trivial tem de dar o mesmo. */
  it('produz o mesmo mapeamento quando a ordem se mantém', async () => {
    const csv = [HEADERS.join(';'), '25/02/2026;AA-00-BB;125000;32,4;45,50'].join('\r\n');

    const table = parseCsv(utf8(csv));

    const savedDecisions = [
      { index: 0, field: 'date' },
      { index: 1, field: 'plate' },
      { index: 2, field: 'odometerKm' },
      { index: 3, field: 'litres' },
      { index: 4, field: 'amountCents' },
    ];

    const applied = applySavedMapToTable(table, {
      headers: HEADERS,
      decisions: savedDecisions,
    });

    expect(applied.decisions).toEqual(savedDecisions);
  });
});
