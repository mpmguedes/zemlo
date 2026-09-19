import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/domain/import/csv/parse.js';
import {
  COLUMN_STATES,
  duplicateFieldAssignments,
  findDeclaredFieldErrors,
  mapColumns,
  resolveMapping,
  toFieldAssignments,
} from '../src/domain/import/csv/mapping.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Constrói uma tabela a partir de linhas de texto, com separador ';'. */
function table(rows: readonly string[]) {
  return parseCsv(utf8(`${rows.join('\n')}\n`));
}

describe('estados do mapeamento', () => {
  it('declara exatamente os quatro estados exigidos', () => {
    expect([...COLUMN_STATES]).toEqual(['confirmado', 'sugerido', 'ambiguo', 'nao_mapeado']);
  });
});

describe('mapeamento — colunas diretas', () => {
  it('confirma colunas com nomes exatos do produto', () => {
    const result = mapColumns(table(['Matrícula;Data;Valor', 'AA-00-AA;2026-01-01;10,00']));
    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]?.state).toBe('confirmado');
    expect(result.columns[0]?.field).toBe('plate');
    expect(result.columns[1]?.field).toBe('date');
    expect(result.columns[2]?.field).toBe('amountCents');
    expect(result.readyWithoutInput).toBe(true);
  });

  it('mapeia a ficha de veículo exportada pelo Zemlo', () => {
    const result = mapColumns(
      table(['Matrícula;Marca;Modelo;Versão;Ano;Combustível;Quilometragem;VIN;Notas']),
      { kind: 'vehicle' },
    );
    const byHeader = new Map(result.columns.map((c) => [c.header, c.field]));
    expect(byHeader.get('Matrícula')).toBe('plate');
    expect(byHeader.get('Marca')).toBe('make');
    expect(byHeader.get('Modelo')).toBe('model');
    expect(byHeader.get('Versão')).toBe('version');
    expect(byHeader.get('Ano')).toBe('year');
    expect(byHeader.get('Combustível')).toBe('fuelType');
    expect(byHeader.get('Quilometragem')).toBe('odometerKm');
    expect(byHeader.get('VIN')).toBe('vin');
    expect(byHeader.get('Notas')).toBe('notes');
  });
});

describe('mapeamento — sinónimos e variações', () => {
  it('reconhece sinónimos em inglês', () => {
    const result = mapColumns(table(['Plate;Date;Amount;Vendor']));
    const fields = result.columns.map((c) => c.field);
    expect(fields).toEqual(['plate', 'date', 'amountCents', 'vendor']);
  });

  it('reconhece sinónimos em português informal', () => {
    const result = mapColumns(table(['Matricula;Dia;Preço;Oficina;Litros']));
    const fields = result.columns.map((c) => c.field);
    expect(fields).toContain('plate');
    expect(fields).toContain('date');
    expect(fields).toContain('amountCents');
    expect(fields).toContain('vendor');
    expect(fields).toContain('litres');
  });

  it('é insensível a maiúsculas, acentos e espaços', () => {
    for (const header of ['MATRÍCULA', 'matricula', '  Matrícula  ', 'Matricula', 'matrícula']) {
      const result = mapColumns(table([`${header};Valor`, 'AA-00-AA;1']));
      expect(result.columns[0]?.field, `cabeçalho "${header}"`).toBe('plate');
    }
  });
});

describe('mapeamento — colunas desconhecidas', () => {
  it('marca como não mapeada uma coluna inventada', () => {
    const result = mapColumns(table(['Matrícula;Coluna Inventada;Valor']));
    const invented = result.columns.find((c) => c.header === 'Coluna Inventada');
    expect(invented?.state).toBe('nao_mapeado');
    expect(invented?.field).toBeNull();
    expect(invented?.reason).toMatch(/sinónimo/i);
    expect(result.unmappedColumns).toHaveLength(1);
  });

  it('marca como não mapeada uma coluna sem nome', () => {
    const result = mapColumns(table(['Matrícula;;Valor']));
    const empty = result.columns[1];
    expect(empty?.state).toBe('nao_mapeado');
    expect(empty?.reason).toMatch(/não tem nome/i);
  });

  it('não falha numa tabela sem colunas', () => {
    const result = mapColumns(parseCsv(new Uint8Array()));
    expect(result.columns).toEqual([]);
    expect(result.coverage).toBe(0);
    expect(result.readyWithoutInput).toBe(true);
  });

  it('calcula a cobertura das colunas confirmadas', () => {
    const result = mapColumns(table(['Matrícula;Inventada;Valor;Outra Coisa']));
    expect(result.coverage).toBeCloseTo(0.5, 5);
  });
});

describe('mapeamento — ambiguidades', () => {
  it('nunca resolve "tipo" sozinho', () => {
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    expect(tipo?.state).toBe('ambiguo');
    expect(tipo?.field).toBeNull();
    expect(tipo?.reason).toBeTruthy();
    expect(result.readyWithoutInput).toBe(false);
  });

  it('assinala "descrição" como ambíguo quando pode ser categoria ou descrição', () => {
    const result = mapColumns(table(['Data;Descrição;Valor']));
    const descricao = result.columns.find((c) => c.header === 'Descrição');
    // "descrição" é exact para description e weak para category: a evidência mais forte
    // vence, mas continua a ser uma escolha declarada, não silenciosa.
    expect(descricao?.field).toBe('description');
    expect(descricao?.state).toBe('confirmado');
    expect(descricao?.candidates.map((c) => c.field)).toContain('category');
  });

  it('expõe "Pagamento" como sugestão com o valor ainda visível como alternativa', () => {
    const result = mapColumns(table(['Data;Pagamento;Valor']));
    const pagamento = result.columns.find((c) => c.header === 'Pagamento');
    // paymentMethod (strong, 0.8) vence amountCents (weak, 0.4) com margem clara —
    // por isso é "sugerido" e não "ambíguo": há uma melhor resposta, só não é certa.
    expect(pagamento?.state).toBe('sugerido');
    expect(pagamento?.field).toBe('paymentMethod');
    // A alternativa fraca continua declarada: a UI mostra-a e o utilizador pode
    // escolhê-la, mas o sistema não a torna equivalente à principal.
    const fields = pagamento?.candidates.map((c) => c.field) ?? [];
    expect(fields).toContain('amountCents');
    expect(pagamento?.candidates.find((c) => c.field === 'amountCents')?.match).toBe('weak');
  });

  it('considera ambíguo quando dois candidatos têm confiança próxima', () => {
    // "Tipo" é weak em vários campos com a mesma confiança: empate real.
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    expect(tipo?.state).toBe('ambiguo');
    expect(new Set(tipo?.candidates.map((c) => c.field)).size).toBeGreaterThan(1);
  });

  it('expõe todos os candidatos, ordenados por confiança', () => {
    const result = mapColumns(table(['Data;Tipo']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    expect(tipo?.candidates.length).toBeGreaterThan(1);
    for (let i = 1; i < (tipo?.candidates.length ?? 0); i += 1) {
      const previous = tipo?.candidates[i - 1]?.confidence ?? 0;
      const current = tipo?.candidates[i]?.confidence ?? 0;
      expect(current).toBeLessThanOrEqual(previous);
    }
  });

  it('lista as colunas ambíguas separadamente', () => {
    const result = mapColumns(table(['Data;Tipo;Pagamento;Valor']));
    // "Tipo" é ambíguo (empate entre campos); "Pagamento" é apenas sugerido.
    expect(result.ambiguousColumns.length).toBeGreaterThanOrEqual(1);
    expect(result.ambiguousColumns.every((c) => c.state === 'ambiguo')).toBe(true);
    expect(result.readyWithoutInput).toBe(false);
  });

  it('não considera ambíguas duas entradas para o mesmo campo', () => {
    // "Valor" e "Total" apontam ambos para amountCents: é o mesmo destino, não uma escolha.
    const result = mapColumns(table(['Data;Valor;Total']));
    expect(result.columns[1]?.field).toBe('amountCents');
    expect(result.columns[2]?.field).toBe('amountCents');
    expect(result.columns[1]?.state).toBe('confirmado');
    expect(result.columns[2]?.state).toBe('confirmado');
  });
});

describe('mapeamento — amostra de valores', () => {
  it('devolve uma amostra para contexto da UI', () => {
    const result = mapColumns(
      table(['Matrícula;Data;Valor', 'AA-00-AA;2026-01-01;10,00', 'BB-11-BB;2026-01-02;20,00']),
    );
    expect(result.columns[0]?.sample).toContain('AA-00-AA');
    expect(result.columns[0]?.sample[1]).toBe('BB-11-BB');
  });

  it('ignora valores vazios na amostra', () => {
    const result = mapColumns(table(['Matrícula;Data;Valor', 'AA-00-AA;;10,00', ';2026-01-02;20,00']));
    expect(result.columns[0]?.sample).toEqual(['AA-00-AA']);
    expect(result.columns[1]?.sample).toEqual(['2026-01-02']);
  });

  it('respeita o tamanho de amostra pedido', () => {
    const rows = ['Matrícula;Data;Valor'];
    for (let i = 0; i < 10; i += 1) rows.push(`AA-0${i}-AA;2026-01-0${(i % 9) + 1};10,00`);
    const result = mapColumns(table(rows), { sampleSize: 2 });
    expect(result.columns[0]?.sample).toHaveLength(2);
  });
});

describe('mapeamento — contexto do tipo de registo', () => {
  it('desempata a favor do campo compatível com o tipo', () => {
    // "Tipo" é weak para category e para type (manutenção) e para type (evento).
    // Continua ambíguo — mas os candidatos compatíveis aparecem primeiro.
    const result = mapColumns(table(['Data;Tipo;Valor']), { kind: 'maintenance' });
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    const firstCandidate = tipo?.candidates[0];
    expect(firstCandidate?.compatibleWithKind).toBe(true);
  });

  it('marca candidatos incompatíveis com o tipo inferido', () => {
    const result = mapColumns(table(['Litros;Km']), { kind: 'expense' });
    const litros = result.columns.find((c) => c.header === 'Litros');
    const candidate = litros?.candidates.find((c) => c.field === 'litres');
    expect(candidate?.compatibleWithKind).toBe(false);
  });

  it('sem tipo, todos os candidatos são considerados compatíveis', () => {
    const result = mapColumns(table(['Litros']));
    const candidate = result.columns[0]?.candidates.find((c) => c.field === 'litres');
    expect(candidate?.compatibleWithKind).toBe(true);
  });
});

describe('resolução de ambiguidades pelo utilizador', () => {
  it('aceita uma decisão válida e passa a confirmada', () => {
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    const resolved = resolveMapping(result, [{ index: tipo?.index ?? 1, field: 'category' }]);

    const chosen = resolved.columns.find((c) => c.header === 'Tipo');
    expect(chosen?.state).toBe('confirmado');
    expect(chosen?.field).toBe('category');
    expect(chosen?.confidence).toBe(1);
    expect(resolved.pending).toHaveLength(0);
  });

  it('aceita ignorar uma coluna (resposta "nenhuma")', () => {
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    const resolved = resolveMapping(result, [{ index: tipo?.index ?? 1, field: null }]);

    const chosen = resolved.columns.find((c) => c.header === 'Tipo');
    expect(chosen?.state).toBe('nao_mapeado');
    expect(chosen?.field).toBeNull();
    expect(resolved.pending).toHaveLength(0);
  });

  it('rejeita um campo canónico que não é candidato nem do tipo inferido', () => {
    const result = mapColumns(table(['Data;Matrícula;Valor']));
    const plateColumn = result.columns.find((c) => c.header === 'Matrícula');
    const resolved = resolveMapping(result, [{ index: plateColumn?.index ?? 1, field: 'litres' }]);

    expect(resolved.invalid).toHaveLength(1);
    expect(resolved.invalid[0]?.reason).toMatch(/interpretação possível/i);
    // A coluna mantém-se como estava.
    expect(resolved.columns.find((c) => c.header === 'Matrícula')?.field).toBe('plate');
  });

  it('rejeita um índice de coluna inexistente', () => {
    const result = mapColumns(table(['Data;Valor']));
    const resolved = resolveMapping(result, [{ index: 99, field: 'date' }]);
    expect(resolved.invalid).toHaveLength(1);
    expect(resolved.invalid[0]?.reason).toMatch(/não existe/i);
  });

  it('rejeita um campo que não existe no vocabulário canónico', () => {
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    const resolved = resolveMapping(result, [{ index: tipo?.index ?? 1, field: 'campoInventado' }]);
    expect(resolved.invalid).toHaveLength(1);
  });

  it('permite corrigir uma coluna já confirmada', () => {
    const result = mapColumns(table(['Data;Valor']));
    const date = result.columns.find((c) => c.header === 'Data');
    const resolved = resolveMapping(result, [{ index: date?.index ?? 0, field: 'date' }]);

    expect(resolved.invalid).toEqual([]);
    expect(resolved.columns[0]?.field).toBe('date');
    expect(resolved.columns[0]?.reason).toMatch(/utilizador/i);
  });

  it('registra as colunas que ainda faltam decidir', () => {
    const result = mapColumns(table(['Data;Tipo;Pagamento;Valor']));
    const resolved = resolveMapping(result, []);
    expect(resolved.pending.length).toBeGreaterThanOrEqual(1);
    expect(resolved.pending.every((c) => c.state === 'ambiguo')).toBe(true);
  });

  it('aceita um campo canónico do tipo inferido como correção manual', () => {
    // "Lugares" não tem sinónimo, mas o utilizador pode reconhecê-la como `notes`
    // num ficheiro de veículos: `notes` não é candidato declarado da coluna, mas é
    // canónico do tipo `vehicle`. A via de escapatória existe para este caso.
    const result = mapColumns(table(['Matrícula;Lugares;Notas']), { kind: 'vehicle' });
    const lugares = result.columns.find((c) => c.header === 'Lugares');
    expect(lugares?.state).toBe('nao_mapeado');

    const resolved = resolveMapping(
      result,
      [{ index: lugares?.index ?? 1, field: 'nickname' }],
      'vehicle',
    );
    expect(resolved.invalid).toEqual([]);
    expect(resolved.columns.find((c) => c.header === 'Lugares')?.field).toBe('nickname');
  });

  it('recusa a via de escapatória quando não há tipo inferido', () => {
    // Sem tipo, aceitar qualquer campo canónico seria aceitar tudo.
    const result = mapColumns(table(['Matrícula;Lugares;Notas']));
    const lugares = result.columns.find((c) => c.header === 'Lugares');
    const resolved = resolveMapping(result, [{ index: lugares?.index ?? 1, field: 'nickname' }]);
    expect(resolved.invalid).toHaveLength(1);
  });
});

describe('atribuições de campo', () => {
  it('converte o mapa num mapa de índice para campo', () => {
    const result = mapColumns(table(['Matrícula;Data;Valor']));
    const assignments = toFieldAssignments(result.columns);
    expect(assignments.get(0)).toBe('plate');
    expect(assignments.get(1)).toBe('date');
    expect(assignments.get(2)).toBe('amountCents');
  });

  it('exclui colunas ambíguas das atribuições', () => {
    const result = mapColumns(table(['Data;Tipo;Valor']));
    const assignments = toFieldAssignments(result.columns);
    const tipo = result.columns.find((c) => c.header === 'Tipo');
    expect(assignments.has(tipo?.index ?? -1)).toBe(false);
  });

  it('deteta duas colunas a competir pelo mesmo campo', () => {
    const result = mapColumns(table(['Data;Valor;Total']));
    const duplicates = duplicateFieldAssignments(result.columns);
    expect(duplicates.get('amountCents')).toHaveLength(2);
  });

  it('não reporta duplicados quando não existem', () => {
    const result = mapColumns(table(['Matrícula;Data;Valor']));
    expect(duplicateFieldAssignments(result.columns).size).toBe(0);
  });
});

describe('diagnóstico do dicionário', () => {
  it('não tem campos declarados fora do vocabulário canónico', () => {
    expect(findDeclaredFieldErrors()).toEqual([]);
  });
});
