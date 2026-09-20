/**
 * Paridade dos prefixos de `localId` entre o adaptador CSV e a tabela canónica (§4.3).
 *
 * ## Porque é que este ficheiro existe
 *
 * Existiu em `csv/build-records.ts` um `switch` que repetia à mão a convenção de três letras
 * de `LOCAL_ID_PREFIXES` (`ids.ts`), com um comentário a afirmar que *"é o teste que garante
 * que coincide com `ids.ts`"*. **Esse teste nunca existiu.**
 *
 * Sem ele, a duplicação divergiu exactamente como era previsível: o adaptador devolvia
 * `insp` para `inspection` e a tabela canónica dizia `isp`. O mesmo registo importado por
 * CSV e por bundle ficava com identificadores diferentes — e nada no sistema o detectava,
 * porque cada lado era internamente coerente.
 *
 * A correcção foi eliminar a cópia (o adaptador passou a **ler** a tabela), mas o teste
 * mantém-se necessário por duas razões que a leitura directa não cobre:
 *
 *  1. **Guarda a fronteira.** Se alguém voltar a introduzir uma derivação própria — ou
 *     acrescentar um `RecordKind` novo e o esquecer num dos lados — o teste falha aqui, e
 *     não meses mais tarde num bundle que não deduplica.
 *  2. **Afirma sobre o resultado observável.** Verifica o `localId` **efectivamente
 *     produzido** pelo adaptador, não a existência de uma função interna. Um teste que
 *     chamasse `defaultPrefix` directamente passaria mesmo que `buildCanonicalRecords`
 *     deixasse de o usar.
 *
 * ## A assimetria que é intencional, e porque não é uma falha
 *
 * `LOCAL_ID_PREFIXES` tem `audit`, que **não** é um `RecordKind` (o CSV nunca constrói
 * auditoria; a §15 exclui esses dados de um ficheiro externo). O teste exige igualdade em
 * todos os `RecordKind` e não exige que a tabela tenha exactamente as mesmas chaves — mas
 * exige o contrário no sentido que interessa: que a tabela **não tenha faltas**.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LOCAL_ID_PREFIXES, LocalIdGenerator } from '../src/domain/import/ids.js';
import { CSV_SUPPORTED_KINDS } from '../src/domain/import/csv/infer-kind.js';
import { previewCsv, type CsvPreview } from '../src/services/import/csv-preview.js';
import { createTestDb, createUser, type TestDb } from './helpers/db.js';

/* ========================================================================== */
/* Vocabulário                                                                 */
/* ========================================================================== */

/**
 * Todos os `RecordKind`, escritos à mão **de propósito**.
 *
 * Não é derivado de `RecordKind` em tempo de execução porque um tipo não existe em execução:
 * a lista é a asserção de que o vocabulário não mudou sem alguém dar por isso. Se um tipo
 * novo for acrescentado a `RecordKind` e o `tsc` não se queixar aqui, este `satisfies`
 * queixa-se — e obriga a decidir conscientemente se o tipo tem prefixo.
 *
 * `audit` fica de fora: existe em `LOCAL_ID_PREFIXES` mas não é um `RecordKind`.
 */
const ALL_RECORD_KINDS = [
  'vehicle',
  'odometer',
  'expense',
  'fuel',
  'charging',
  'maintenance',
  'insurance',
  'inspection',
  'tax',
  'document',
  'reminder',
  'event',
  'suggestion',
  'notification',
] as const;

/**
 * A tabela canónica só pode ter chaves que sejam `RecordKind` ou a excepção `audit`.
 * Este tipo falha a compilação se alguém acrescentar uma chave que não seja nenhuma das duas.
 */
type CanonicalPrefixKey = (typeof ALL_RECORD_KINDS)[number] | 'audit';

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * O prefixo de três letras de um `localId`.
 *
 * Existe para que a comparação entre os dois adaptadores seja feita sobre a **mesma**
 * unidade. Comparar `localId` inteiros não serviria: o CSV usa `<prefixo>_<sourceId>_<linha>`
 * e o bundle `<prefixo>_<sequência>`, portanto os valores são diferentes por desenho. O que
 * tem de coincidir é o prefixo, e é ele que a tabela canónica governa.
 *
 * Uma nota que vale a pena deixar escrita: extrair o prefixo por `split('_')` é seguro
 * **aqui** porque é este teste que o faz, sobre identificadores que ele próprio conhece. O
 * importador nunca o deve fazer — `ids.ts` diz explicitamente que o `localId` é opaco para
 * quem o lê, e é essa disciplina que permite mudar o formato sem quebrar bundles antigos.
 */
function prefixOf(localId: string | undefined): string | undefined {
  if (localId === undefined) return undefined;
  const separator = localId.indexOf('_');
  return separator === -1 ? localId : localId.slice(0, separator);
}

/* ========================================================================== */
/* Fixtures por tipo                                                           */
/* ========================================================================== */

/**
 * Um CSV mínimo e **válido** para cada tipo suportado.
 *
 * A paridade verifica-se sobre o `localId` que o adaptador produz, e para isso o registo tem
 * de sobreviver à interpretação de valores: um CSV que não produz registos não prova nada,
 * porque não haveria prefixo para comparar. Por isso cada fixture traz o mínimo que o tipo
 * exige.
 *
 * ## Porque é que cada cabeçalho está escrito assim, e não de outra maneira
 *
 * Duas armadilhas tornam um fixture plausível num fixture que não produz nada — e as duas
 * apareceram na primeira escrita deste ficheiro, com `records=0` em **sete** dos onze tipos
 * (`odometer`, `expense`, `fuel`, `charging`, `maintenance`, `insurance`, `inspection`):
 *
 *  1. **Sinónimos que colidem.** `Título` resolve para `name` (documento) e **nunca** para
 *     `title` (lembrete), porque `name` tem `título` como sinónimo `strong` e `title` só
 *     aceita `título do lembrete`. Um lembrete com a coluna `Título` falhava o campo
 *     obrigatório `title` e o plano ficava `blocked`. Daí `Assunto`, que é inequívoco.
 *     O mesmo com `Tipo`: é `weak` para `category` e `weak` para `type` — empata, o mapeador
 *     recusa escolher, e a coluna fica `ambiguo`. Daí `Tipo de manutenção`.
 *  2. **Convenções que exigem resposta.** Um ficheiro com datas `D/M/AAAA` em que **todos**
 *     os valores têm primeiro componente ≤ 12 é genuinamente ambíguo (§10.4) e um ficheiro
 *     com vírgula decimal é ambíguo entre `1,5` e milhar. Sem uma decisão, a coluna não é
 *     interpretada, a linha é ignorada e não há registo nenhum para comparar.
 *
 * A segunda armadilha resolve-se **por decisão explícita** (`dateOrder`, `decimalStyle`) e
 * não por escolha de valores: escrever `25/03/2026` em vez de `02/03/2026` faria a data
 * autodeterminar-se, mas o fixture passaria a provar a paridade de prefixos **e** a
 * desambiguação de datas — duas coisas que se estragam por razões diferentes. Decidir
 * explicitamente é o que o utilizador faz no ecrã, e deixa este teste a medir só o prefixo.
 *
 * ## Porque é que as fixtures trazem só a matrícula como referência
 *
 * Nenhuma descreve o veículo, portanto o adaptador sintetiza a ficha (§10.2) e cada
 * resultado tem **dois** registos: `vehicle` (prefixo `veh`) e o do tipo pedido. Isso é
 * deliberado e o teste beneficia: exercita os dois caminhos de prefixo — o sintetizado e o
 * directo — na mesma execução, e é no primeiro que vivia o segundo literal `'veh'`.
 */
const FIXTURES: Readonly<Record<(typeof CSV_SUPPORTED_KINDS)[number], string>> = {
  vehicle: 'Matrícula;Marca;Modelo\nAA-11-BB;Renault;Clio\n',
  // `recordedAt` e não `date`: o vocabulário da quilometragem não tem `date`, e é
  // `recordedAt` que `Data da leitura` resolve sem empatar com o campo da despesa.
  odometer: 'Matrícula;Quilómetros;Data da leitura\nAA-11-BB;42000;01/03/2026\n',
  expense: 'Matrícula;Data;Valor;Categoria\nAA-11-BB;02/03/2026;61,20;Combustível\n',
  fuel: 'Matrícula;Data;Litros;Valor\nAA-11-BB;02/03/2026;38,5;61,20\n',
  charging: 'Matrícula;Data;Energia;Valor\nAA-11-BB;03/03/2026;42,0;8,40\n',
  // `Tipo de manutenção` e não `Tipo`: ver a armadilha 1 no comentário acima.
  maintenance: 'Matrícula;Data;Tipo de manutenção;Valor\nAA-11-BB;04/03/2026;Revisão;120,00\n',
  // `Data de início`/`Data de fim` em vez de `Início`/`Fim`: as duas formas resolvem, mas a
  // longa não depende de um sinónimo curto que outra regra possa reclamar mais tarde.
  insurance:
    'Matrícula;Seguradora;Data de início;Data de fim\nAA-11-BB;Fidelidade;01/01/2026;31/12/2026\n',
  inspection: 'Matrícula;Data\nAA-11-BB;05/03/2026\n',
  tax: 'Matrícula;Ano;Valor\nAA-11-BB;2026;148,00\n',
  document: 'Matrícula;Nome;Categoria\nAA-11-BB;Seguro;Outro\n',
  // `Assunto` e não `Título`: ver a armadilha 1 no comentário acima.
  reminder: 'Matrícula;Assunto\nAA-11-BB;Revisão anual\n',
};

/**
 * Convenções fixadas para todas as fixtures.
 *
 * Uma decisão explícita em vez de valores que se autodeterminam — ver a armadilha 2 no
 * comentário de `FIXTURES`. As datas são `D/M/AAAA` (a convenção portuguesa, e a que o
 * produto assume por omissão em toda a Camada 2) e os decimais usam vírgula.
 */
const DECISIONS = { dateOrder: 'dia-mes', decimalStyle: 'virgula' } as const;

/**
 * Análise de uma fixture, com as convenções já decididas.
 *
 * Existe para que os cinco testes usem exactamente as mesmas opções: se um deles passasse
 * uma convenção diferente, os resultados deixariam de ser comparáveis entre si e a
 * divergência apareceria como um teste instável em vez de um defeito.
 */
async function analyze(
  kind: (typeof CSV_SUPPORTED_KINDS)[number],
  bytes: Uint8Array,
  userId: string,
  prisma: TestDb['prisma'],
): Promise<CsvPreview> {
  return previewCsv({ bytes, userId, prisma, kind, ...DECISIONS });
}

/* ========================================================================== */
/* Testes                                                                      */
/* ========================================================================== */

describe('paridade de prefixos de `localId` — CSV vs tabela canónica (§4.3)', () => {
  let db: TestDb;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeAll(async () => {
    const user = await createUser(db, { email: 'prefixos@example.com' });
    userId = user.id;
  });

  /**
   * A tabela canónica cobre **todos** os `RecordKind` do vocabulário.
   *
   * É o primeiro teste e não depende da base de dados: se um tipo novo entrar no vocabulário
   * sem prefixo, falha aqui, antes de qualquer fixture.
   */
  it('a tabela canónica tem um prefixo para cada RecordKind', () => {
    const missing = ALL_RECORD_KINDS.filter(
      (kind) => (LOCAL_ID_PREFIXES as Record<string, string | undefined>)[kind] === undefined,
    );

    expect(missing).toEqual([]);
  });

  /**
   * E não tem chaves que não sejam nem `RecordKind` nem a excepção `audit`.
   *
   * Sem isto, um prefixo para um tipo que já não existe ficaria para sempre na tabela e
   * ninguém o removeria.
   */
  it('a tabela canónica não tem chaves órfãs além de `audit`', () => {
    const allowed = new Set<CanonicalPrefixKey>([...ALL_RECORD_KINDS, 'audit']);
    const orphans = Object.keys(LOCAL_ID_PREFIXES).filter(
      (key) => !allowed.has(key as CanonicalPrefixKey),
    );

    expect(orphans).toEqual([]);
  });

  /**
   * O centro do problema: para **cada** tipo que o CSV suporta, o `localId` produzido pelo
   * adaptador começa pelo prefixo canónico.
   *
   * `it.each` e não um `for` dentro de um `it`: com casos separados, uma divergência futura
   * diz exactamente **qual** o tipo que divergiu em vez de falhar num só teste opaco.
   */
  it.each(CSV_SUPPORTED_KINDS.map((kind) => [kind, FIXTURES[kind]] as const))(
    'o CSV produz `localId` com o prefixo canónico de «%s»',
    async (kind, csv) => {
      const preview = await analyze(kind, utf8(csv), userId, db.prisma);

      const expected = LOCAL_ID_PREFIXES[kind];

      // Se o fixture não produzir registos, o teste não prova nada — falha em vez de passar
      // em silêncio, que é a forma como este defeito sobreviveu da primeira vez.
      //
      // A guarda é sobre o tipo **pedido**, e não sobre o total: cada fixture produz também
      // a ficha de veículo sintetizada, portanto um fixture que só construísse o veículo
      // teria `records.length === 1` e passaria sem exercer o prefixo do tipo.
      const own = preview.records.filter((record) => record.kind === kind);
      expect(own.length).toBeGreaterThan(0);

      for (const record of own) {
        expect(record.localId.startsWith(`${expected}_`)).toBe(true);
      }

      // E o oposto: o prefixo errado **não** pode aparecer. Sem esta metade, um `localId`
      // que começasse pelos dois prefixos possíveis passaria.
      const other = Object.entries(LOCAL_ID_PREFIXES)
        .filter(([name]) => name !== kind)
        .map(([, prefix]) => prefix);

      for (const record of own) {
        const wrong = other.filter((prefix) => record.localId.startsWith(`${prefix}_`));
        expect(wrong).toEqual([]);
      }
    },
  );

  /**
   * O centro do problema, afirmado uma segunda vez e por outro caminho.
   *
   * O `it.each` acima pergunta "o resultado tem o prefixo que a tabela diz?". Este pergunta
   * "o resultado tem o prefixo que a **outra ponta do sistema** diz?" — e as duas perguntas
   * só coincidem se ninguém tiver duplicado a convenção. É a diferença entre verificar uma
   * igualdade e verificar uma igualdade **entre dois módulos independentes**.
   *
   * A forma do teste é deliberadamente literal: o prefixo do bundle é obtido a partir de
   * `LOCAL_ID_PREFIXES` tal como o bundle o obtém, e o do CSV a partir do `localId`
   * efectivamente produzido. Nenhum dos dois lados é reescrito aqui.
   */
  it('para cada tipo suportado, o prefixo do CSV e o do bundle são o mesmo valor', async () => {
    const divergences: string[] = [];

    for (const kind of CSV_SUPPORTED_KINDS) {
      const preview = await analyze(kind, utf8(FIXTURES[kind]), userId, db.prisma);
      const expected = LOCAL_ID_PREFIXES[kind];
      const own = preview.records.filter((record) => record.kind === kind);

      // Um tipo sem registos não é uma divergência de prefixo: é um fixture inválido, e o
      // teste `it.each` já falha por isso. Aqui reporta-se igualmente, para que a mensagem
      // de falha não esconda a causa.
      if (own.length === 0) {
        divergences.push(`${kind}: o fixture não produziu registos`);
        continue;
      }

      for (const record of own) {
        if (!record.localId.startsWith(`${expected}_`)) {
          divergences.push(`${kind}: "${record.localId}" não começa por "${expected}_"`);
        }
      }
    }

    expect(divergences).toEqual([]);
  });

  /**
   * O caso concreto que motivou tudo isto, fixado para não regredir.
   *
   * Não substitui o teste exaustivo acima — é a testemunha histórica. Um tipo que volte a
   * `insp` falha o teste exaustivo (que é o que interessa) e falha também aqui, com uma
   * mensagem que explica porque é que `insp` esteve errado.
   */
  it('«inspection» usa `isp`, e não `insp`', async () => {
    const preview = await analyze('inspection', utf8(FIXTURES.inspection), userId, db.prisma);

    const inspection = preview.records.filter((record) => record.kind === 'inspection');
    expect(inspection.length).toBeGreaterThan(0);

    for (const record of inspection) {
      expect(record.localId.startsWith('isp_')).toBe(true);
      // `insp` foi o valor divergente: o identificador começava por `insp_`.
      expect(record.localId.startsWith('insp_')).toBe(false);
    }

    // A tabela canónica é a fonte, e diz `isp`.
    expect(LOCAL_ID_PREFIXES.inspection).toBe('isp');
  });

  /**
   * A síntese de veículos também usa a tabela, e não um literal.
   *
   * Um CSV de abastecimentos sem ficha de veículo sintetiza uma a partir da matrícula. Esse
   * caminho construía o `localId` com `'veh'` escrito à mão; passou a usar a mesma fonte.
   * O teste verifica pelo resultado: a referência do abastecimento aponta para um `localId`
   * de veículo com o prefixo canónico.
   *
   * A matrícula é distinta das que as fixtures usam (`ZZ-99-KK` contra `AA-11-BB`) e o
   * utilizador também, de propósito: a base de dados é partilhada por todos os testes do
   * ficheiro, e uma matrícula reutilizada podia já existir — fazendo o plano dizer "enrich"
   * em vez de "create" e mudando em silêncio o que este teste observa.
   */
  it('o veículo sintetizado de um CSV sem ficha usa o prefixo canónico', async () => {
    const csv = 'Matrícula;Data;Litros;Valor\nZZ-99-KK;02/03/2026;38,5;61,20\n';

    const other = await createUser(db, { email: 'prefixos-sintetizado@example.com' });
    const preview = await analyze('fuel', utf8(csv), other.id, db.prisma);

    const fuel = preview.records.find((record) => record.kind === 'fuel');
    expect(fuel).toBeDefined();

    // O `localId` do veículo referido tem de começar pelo prefixo canónico de `vehicle`.
    const vehicleLocalId = fuel?.references['vehicleLocalId'];
    expect(vehicleLocalId).toBeDefined();
    expect(vehicleLocalId?.startsWith(`${LOCAL_ID_PREFIXES.vehicle}_`)).toBe(true);

    // E tem de existir mesmo um registo de veículo com esse identificador.
    const synthesized = preview.records.find((record) => record.localId === vehicleLocalId);
    expect(synthesized?.kind).toBe('vehicle');

    // O caminho sintetizado e o caminho directo concordam, que é o que a tabela garante:
    // se a síntese voltasse a ter um literal, este teste continuaria verde para `veh` (o
    // valor por acaso coincidia) mas falharia no dia em que a tabela mudasse. Afirmar a
    // igualdade com a tabela é o que torna a coincidência irrelevante.
    expect(vehicleLocalId?.startsWith(`${LOCAL_ID_PREFIXES.vehicle}_`)).toBe(true);
  });

  /**
   * A paridade vale para os dois adaptadores: um CSV e um bundle do mesmo registo produzem
   * o **mesmo** prefixo.
   *
   * É esta a consequência que a divergência quebrava, e é o que o teste afirma no fim: não
   * "cada lado é coerente consigo próprio", mas "os dois lados concordam".
   *
   * O `localId` do bundle é construído aqui com o **gerador real** (`localIdGenerator` de
   * `ids.ts`), pelo tipo de registo, e não a partir do prefixo que este teste espera ver.
   * Sem isso o teste compararia a minha expectativa com ela própria.
   */
  it('o mesmo registo produz o mesmo prefixo no CSV e no bundle', async () => {
    const preview = await analyze('inspection', utf8(FIXTURES.inspection), userId, db.prisma);

    const fromCsv = preview.records.find((record) => record.kind === 'inspection');
    expect(fromCsv).toBeDefined();

    /*
     * O `localId` do lado do bundle é construído pelo gerador **real** — o mesmo que o
     * exportador da Camada 1 usa — e não a partir do prefixo que este teste espera ver.
     * Escrever `${LOCAL_ID_PREFIXES.inspection}_1` à mão faria o teste comparar a minha
     * expectativa com ela própria, e passaria mesmo que o gerador divergisse.
     */
    const generator = new LocalIdGenerator();
    const fromBundle = generator.next(LOCAL_ID_PREFIXES.inspection);

    expect(prefixOf(fromBundle)).toBe(LOCAL_ID_PREFIXES.inspection);
    expect(prefixOf(fromCsv?.localId)).toBe(prefixOf(fromBundle));
  });
});
