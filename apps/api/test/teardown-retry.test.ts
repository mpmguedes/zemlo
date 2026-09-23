/**
 * O teardown não pode marcar a suíte como falhada por causa do sistema de ficheiros (`PC-26`).
 *
 * ## Porque é que este teste existe, e porque é que injecta o erro
 *
 * Medido: a suíte terminou com **todos os testes verdes** e **exit code 1**, porque o `rmSync` do
 * directório temporário colidiu com o handle do SQLite que o Windows ainda não tinha libertado.
 * Num CI isso é um semáforo vermelho **ao acaso** — e um CI que fica vermelho ao acaso é um CI que
 * alguém desliga.
 *
 * A correcção (`removeTree`, com repetição limitada) **não se pode provar provocando a corrida a
 * sério**: uma tentativa de a reproduzir com um descritor aberto passou sem falhar, e um teste que
 * dependesse disso seria ele próprio intermitente — exactamente o defeito. Por isso o erro
 * transitório é **injectado** sobre o `node:fs` verdadeiro (`importOriginal`), e o que se exercita
 * é a função **real** do helper, não uma cópia dela (`AUD-004`).
 *
 * ## O que é provado
 *
 *  - recupera de um bloqueio transitório e o directório desaparece mesmo;
 *  - **relança** quando as tentativas se esgotam (não engole a falha: um bloqueio persistente
 *    continua a ser uma falha);
 *  - **não repete** um erro que não é de bloqueio (`EACCES`): falha logo, para a repetição não
 *    mascarar um problema real;
 *  - o caminho normal (sem bloqueio) continua a apagar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* `vi.hoisted`: a fábrica do `vi.mock` é elevada para o topo do ficheiro, logo não pode fechar
 * sobre variáveis declaradas abaixo — tem de receber o estado por aqui. */
const estado = vi.hoisted(() => ({
  falhasRestantes: 0,
  codigo: 'EBUSY',
  chamadas: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    rmSync: (caminho: string, opcoes?: unknown) => {
      estado.chamadas += 1;
      if (estado.falhasRestantes > 0) {
        estado.falhasRestantes -= 1;
        const erro = new Error(
          `${estado.codigo}: resource busy or locked, unlink '${caminho}\\test.db'`,
        ) as NodeJS.ErrnoException;
        erro.code = estado.codigo;
        throw erro;
      }
      return (real.rmSync as unknown as (c: string, o?: unknown) => void)(caminho, opcoes);
    },
  };
});

const { removeTree } = await import('./helpers/db.js');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zemlo-retry-'));
  writeFileSync(join(dir, 'test.db'), 'x');
  estado.falhasRestantes = 0;
  estado.codigo = 'EBUSY';
  estado.chamadas = 0;
});

afterEach(() => {
  // Limpeza directa: zera o bloqueio injectado para que o `rmSync` (o mock) delegue no real.
  estado.falhasRestantes = 0;
  rmSync(dir, { recursive: true, force: true });
});

describe('teardown: repetição sobre bloqueio de ficheiro (PC-26)', () => {
  it('recupera de um bloqueio transitório e o directório desaparece', async () => {
    estado.falhasRestantes = 2;

    await removeTree(dir);

    expect(existsSync(dir), 'O directório devia ter sido apagado.').toBe(false);
    expect(estado.chamadas, 'Devia ter tentado mais do que uma vez.').toBeGreaterThanOrEqual(3);
  });

  it('relança quando as tentativas se esgotam — um bloqueio persistente é uma falha', async () => {
    estado.falhasRestantes = 99;

    await expect(removeTree(dir, 3)).rejects.toThrow(/EBUSY/);

    expect(estado.chamadas, 'Devia ter parado no limite de tentativas.').toBe(3);
  });

  it('não repete um erro que não é de bloqueio', async () => {
    estado.codigo = 'EACCES';
    estado.falhasRestantes = 99;

    await expect(removeTree(dir)).rejects.toThrow(/EACCES/);

    expect(estado.chamadas, 'Um erro não transitório devia falhar à primeira.').toBe(1);
  });

  it('o caminho normal continua a apagar, à primeira', async () => {
    await removeTree(dir);

    expect(existsSync(dir)).toBe(false);
    expect(estado.chamadas).toBe(1);
  });
});
