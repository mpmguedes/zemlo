/**
 * Testes da validação de correio no arranque.
 *
 * O que estes testes provam é uma propriedade de operação, e não uma função: um `SMTP_FROM`
 * mal formado tem de **impedir o arranque**, em vez de aparecer mais tarde como um
 * `555 5.5.2 Syntax error` no `journalctl` da primeira pessoa que pede reposição de password.
 * Por isso o teste importa o módulo real e observa a rejeição — não chama a função de
 * validação diretamente, que já está coberta em `email-address.test.ts`.
 *
 * Não tocam na base de dados nem abrem portas: `core/config.ts` lê o ambiente e constrói um
 * objeto.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Variáveis que estes testes controlam, com valores que não deixam nada ao ambiente.
 *
 * Todas são escritas, mesmo as que o teste não usa. `apps/api/.env` existe neste repositório
 * e é carregado por `core/config.ts` com `override: false`: uma chave ausente do processo
 * seria preenchida pelo ficheiro, e o teste passaria a medir o `.env` de quem o corre em vez
 * do código. Escrever `''` também é deliberado — `readOptionalString` trata a string vazia
 * como ausente, que é o que se quer para o SMTP estar desligado por omissão.
 */
const AMBIENTE_BASE: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./dev.db',
  DATABASE_PROVIDER: 'sqlite',
  SMTP_HOST: '',
  SMTP_PORT: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: 'Zemlo <ola@appzemlo.com>',
  HOSTNAME: 'localhost',
};

let guardado: Record<string, string | undefined>;

beforeEach(() => {
  guardado = {};
  for (const chave of Object.keys(AMBIENTE_BASE)) guardado[chave] = process.env[chave];

  Object.assign(process.env, AMBIENTE_BASE);

  /*
   * Obrigatório. Um módulo que lança durante a avaliação fica com a falha em cache: sem
   * isto, a importação seguinte rejeitaria com o **mesmo** erro mesmo depois de o ambiente
   * ter sido corrigido, e cada teste mediria o anterior.
   */
  vi.resetModules();
});

afterEach(() => {
  for (const [chave, valor] of Object.entries(guardado)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }

  vi.resetModules();
});

/** Importa a configuração de fresco, com o ambiente que o teste preparou. */
async function construir(): Promise<{ from: string; user: string | null }> {
  const { config } = await import('../src/core/config.js');
  return { from: config.email.from, user: config.email.user };
}

/** Importa a configuração à espera de que ela recuse arrancar, e devolve o erro. */
async function recusaArrancar(): Promise<Error> {
  try {
    await import('../src/core/config.js');
  } catch (error) {
    return error as Error;
  }

  throw new Error('A configuração foi aceite, mas devia ter recusado o arranque.');
}

describe('validação do remetente no arranque', () => {
  it('aceita um remetente com nome de apresentação e preserva-o intacto', async () => {
    process.env.SMTP_FROM = 'Zemlo <ola@appzemlo.com>';

    // O valor guardado não é o endereço extraído: o nome de apresentação faz parte do
    // cabeçalho `From:` e é o que o destinatário vê. A extração é do envelope, e é feita
    // pelo cliente SMTP no momento do envio.
    expect((await construir()).from).toBe('Zemlo <ola@appzemlo.com>');
  });

  it('aceita um remetente sem nome de apresentação', async () => {
    process.env.SMTP_FROM = 'ola@appzemlo.com';

    expect((await construir()).from).toBe('ola@appzemlo.com');
  });

  it('recusa no arranque um remetente sem endereço utilizável', async () => {
    process.env.SMTP_FROM = 'Zemlo <>';

    const erro = await recusaArrancar();

    expect(erro.name).toBe('ConfigError');
    expect(erro.message).toMatch(/SMTP_FROM/);
  });

  it('recusa no arranque um remetente com mudança de linha', async () => {
    process.env.SMTP_FROM = 'ola@appzemlo.com\r\nBcc: outra@zemlo.test';

    const erro = await recusaArrancar();

    expect(erro.name).toBe('ConfigError');
    expect(erro.message).toMatch(/CR\/LF/);
  });

  it('recusa mesmo com a entrega desligada, para o erro não ficar à espera de acontecer', async () => {
    // `SMTP_HOST` está vazio no ambiente base: a entrega está inativa e este valor nunca
    // seria interpolado em linha nenhuma. Falha à mesma — a configuração é do operador, e um
    // valor que ele escreveu e que não serve é um erro de configuração, não um detalhe.
    process.env.SMTP_HOST = '';
    process.env.SMTP_FROM = 'Zemlo <>';

    expect((await recusaArrancar()).name).toBe('ConfigError');
  });

  it('recusa no arranque com a entrega ligada', async () => {
    // O caminho que interessa: é assim que a produção corre. Sem este caso, os testes de
    // recusa acima passariam todos com a validação amarrada ao `SMTP_HOST` — foi o que a
    // mutação M9 mostrou.
    process.env.SMTP_HOST = 'smtp.exemplo.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'Zemlo <>';

    const erro = await recusaArrancar();

    expect(erro.name).toBe('ConfigError');
    expect(erro.message).toMatch(/SMTP_FROM/);
  });

  it('aceita a forma exata que a produção usa e preserva o nome de apresentação', async () => {
    // Regressão do defeito: `Zemlo <…>` é a forma que estava no `.env` de produção. O que
    // falhava era o envelope, não o valor — por isso o valor guardado tem de continuar a ser
    // o remetente completo, com nome de apresentação.
    process.env.SMTP_HOST = 'smtp.exemplo.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'ola@appzemlo.com';
    process.env.SMTP_PASSWORD = 'segredo';
    process.env.SMTP_FROM = 'Zemlo <ola@appzemlo.com>';

    expect(await construir()).toEqual({
      from: 'Zemlo <ola@appzemlo.com>',
      user: 'ola@appzemlo.com',
    });
  });
});

describe('validação do utilizador de autenticação no arranque', () => {
  it('aceita a ausência de utilizador', async () => {
    process.env.SMTP_USER = '';

    expect((await construir()).user).toBeNull();
  });

  it('aceita um utilizador que é um endereço', async () => {
    process.env.SMTP_USER = 'ola@appzemlo.com';

    expect((await construir()).user).toBe('ola@appzemlo.com');
  });

  it('recusa no arranque um utilizador com nome de apresentação', async () => {
    // Não há cabeçalho onde um nome de apresentação caiba no `AUTH`: ou é um endereço, ou é
    // uma configuração errada.
    process.env.SMTP_USER = 'Zemlo <ola@appzemlo.com>';

    const erro = await recusaArrancar();

    expect(erro.name).toBe('ConfigError');
    expect(erro.message).toMatch(/SMTP_USER/);
  });
});

describe('validação do nome de anfitrião no arranque', () => {
  it('aceita um nome de anfitrião normal', async () => {
    process.env.HOSTNAME = 'nemo-rog';

    expect((await construir()).from).toBe('Zemlo <ola@appzemlo.com>');
  });

  it('recusa no arranque um nome de anfitrião com mudança de linha', async () => {
    process.env.HOSTNAME = 'nemo-rog\r\nMAIL FROM:<outra@zemlo.test>';

    const erro = await recusaArrancar();

    expect(erro.name).toBe('ConfigError');
    expect(erro.message).toMatch(/HOSTNAME/);
  });
});
