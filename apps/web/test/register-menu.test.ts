import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { QUICK_ACTIONS, RECORD_KINDS } from '@zemlo/shared';
import {
  RECORD_ICON,
  REPETIR_ULTIMO,
  SECAO_MAIS_USADOS,
  SECAO_OUTROS,
  readLastKind,
  recordIconName,
  registerMenuItem,
  registerMenuSections,
  rememberLastKind,
} from '../src/lib/registerMenu';

/*
 * Decisões 46, 47, 49 e 50 — composição do menu «Registar».
 *
 * ## Porque é que isto é um teste de funções e não de ecrã
 *
 * O projeto decidiu, por escrito, não introduzir `jsdom` (`page-states.test.tsx`). Sem
 * eventos, um clique não é observável. O que **é** observável é a decisão pura: que secções
 * existem, que tipos lá estão, e o que acontece quando o armazenamento local tem lixo. Tudo o
 * que aqui se afirma é isso — o resto (aparência) está no teste de renderização ao lado, que
 * só pode afirmar o HTML produzido.
 *
 * ## O que estes testes mordem
 *
 *  - **decisão 49** — «Mais usados» tem exatamente as quatro ações do painel e «Outros» tem os
 *    restantes; a união é o contrato, sem tipos inventados. Morde se alguém acrescentar uma
 *    ação ao menu sem que ela exista em `RECORD_KINDS`.
 *  - **decisão 50** — «Repetir último» só existe com um tipo gravado anteriormente, e um valor
 *    de armazenamento que não corresponde a nenhum tipo do contrato vale o mesmo que a
 *    ausência. Morde se alguém aceitar o valor lido sem o validar.
 *  - **exaustividade dos ícones** — o contrato não dá uma união fechada (`RecordKind` é
 *    `string`, porque `freeze()` alarga os literais), pelo que a guarda de «todo o tipo tem
 *    ícone» tem de ser um teste. Sem ela, um tipo novo apareceria no menu sem ícone.
 */

/** Armazenamento local em memória, com a mesma forma que o browser expõe. */
function instalarArmazenamento(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (chave: string) => store.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        store.set(chave, valor);
      },
      removeItem: (chave: string) => {
        store.delete(chave);
      },
    },
  });
  return store;
}

function removerArmazenamento(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

/** Todas as etiquetas do menu, na ordem em que aparecem. */
function etiquetas(): string[] {
  return registerMenuSections().flatMap((seccao) => seccao.items.map((item) => item.label));
}

/** Todos os tipos do menu, na ordem em que aparecem. */
function tipos(): string[] {
  return registerMenuSections().flatMap((seccao) => seccao.items.map((item) => item.kind));
}

const CODIGOS_DO_CONTRATO = RECORD_KINDS.map((item) => item.code);

describe('menu de registo · secções (decisão 49)', () => {
  it('tem as duas secções, pela ordem «Mais usados» e depois «Outros»', () => {
    expect(registerMenuSections().map((seccao) => seccao.title)).toEqual([
      SECAO_MAIS_USADOS,
      SECAO_OUTROS,
    ]);
  });

  it('«Mais usados» são as quatro ações do painel, pela ordem do contrato', () => {
    const [maisUsados] = registerMenuSections();

    expect(maisUsados?.items.map((item) => item.kind)).toEqual([
      'expense',
      'fuel',
      'charging',
      'maintenance',
    ]);
  });

  it('«Outros» são os restantes tipos existentes — e nada mais', () => {
    const outros = registerMenuSections()[1];

    expect(outros?.items.map((item) => item.kind)).toEqual(['odometer']);
  });

  it('a soma das secções é exatamente o contrato: sem tipos inventados e sem repetidos', () => {
    const todos = tipos();

    expect(new Set(todos).size).toBe(todos.length);
    expect([...todos].sort()).toEqual([...CODIGOS_DO_CONTRATO].sort());
  });

  it('cada tipo do contrato aparece no menu exatamente uma vez', () => {
    for (const codigo of CODIGOS_DO_CONTRATO) {
      expect(tipos().filter((tipo) => tipo === codigo), codigo).toHaveLength(1);
    }
  });

  it('as etiquetas vêm do contrato — não há um segundo vocabulário', () => {
    const doContrato = new Map(RECORD_KINDS.map((item) => [item.code, item.label]));

    for (const seccao of registerMenuSections()) {
      for (const item of seccao.items) {
        expect(item.label, item.kind).toBe(doContrato.get(item.kind));
      }
    }
  });

  it('não desenha uma secção «Outros» vazia (decisão 46: a grelha adapta-se)', () => {
    // O contrato de hoje tem tipos fora de «Mais usados»; a asserção fixa a regra, não o
    // número: o que não pode acontecer é existir uma secção sem itens.
    for (const seccao of registerMenuSections()) {
      expect(seccao.items.length, seccao.title).toBeGreaterThan(0);
    }
  });
});

describe('menu de registo · ícones (decisão 47)', () => {
  it('todo o tipo do contrato tem ícone local', () => {
    for (const codigo of CODIGOS_DO_CONTRATO) {
      expect(RECORD_ICON[codigo], codigo).toBeTruthy();
    }
  });

  it('o ícone de cada item vem do mapa local e não do contrato', () => {
    /*
     * Esta asserção existe por causa de um **falso verde medido**: a primeira versão do teste
     * dos emoji no HTML passava mesmo depois de se repor `icon: item.icon` (o emoji do
     * contrato) na derivação. Não falhava porque o emoji, ao ser usado como **nome** de ícone
     * e não como texto, nunca aparecia no HTML — era consumido como chave de um mapa que não o
     * tinha, e o `<svg>` saía vazio. Comparar com o mapa local morde onde o outro não mordia.
     */
    for (const item of registerMenuSections().flatMap((seccao) => seccao.items)) {
      expect(item.icon, item.kind).toBe(RECORD_ICON[item.kind]);
    }
  });

  it('nenhum ícone se repete — o mapa não pode reintroduzir colisões', () => {
    const usados = CODIGOS_DO_CONTRATO.map((codigo) => RECORD_ICON[codigo]);

    expect(new Set(usados).size).toBe(usados.length);
  });

  it('nenhum ícone é emoji: são nomes de um conjunto local', () => {
    for (const [codigo, nome] of Object.entries(RECORD_ICON)) {
      // Os nomes são identificadores ASCII; um emoji colado do contrato não passaria aqui.
      expect(nome, codigo).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('`registerMenuItem` devolve o item do tipo pedido e `null` para o que não existe', () => {
    expect(registerMenuItem('fuel')?.label).toBe('Abastecimento');
    expect(registerMenuItem('insurance')).toBeNull();
  });

  /*
   * UX-01 — `recordIconName` é a **única** porta de entrada para o ícone de um tipo.
   *
   * Existe para o `Record<string, IconName>` (que o contrato obriga a deixar parcial, porque
   * `RecordKind` é `string` e não há união fechada) não levar três consumidores — `RegisterMenu`,
   * `QuickLogChooser`, `VehicleDetailPage` — a inventar três fallbacks diferentes. Três fallbacks
   * para o mesmo caso é a forma mais silenciosa de criar vocabulários paralelos: hoje coincidem,
   * amanhã um deles muda e o mesmo tipo aparece com duas caras na mesma aplicação.
   */
  it('`recordIconName` devolve o ícone do mapa para cada tipo do contrato', () => {
    for (const codigo of CODIGOS_DO_CONTRATO) {
      expect(recordIconName(codigo), codigo).toBe(RECORD_ICON[codigo]);
    }
  });

  it('`recordIconName` tem uma única rede para um tipo desconhecido, não três', () => {
    // Um tipo do contrato que a web ainda não saiba desenhar não pode desaparecer do ecrã: cai
    // num ícone da mesma família (mesma grelha, mesmo peso) em vez de uma caixa vazia. O valor
    // é fixado **aqui** para que os três consumidores não possam divergir em silêncio.
    expect(recordIconName('tipo-que-ainda-nao-existe')).toBe('receipt');
  });

  it('o fallback não é um caminho normal: os cinco tipos do contrato têm ícone próprio', () => {
    // Guarda contra o fallback a mascarar uma entrada em falta no mapa: se `RECORD_ICON`
    // perdesse um tipo, `recordIconName` continuaria a devolver `'receipt'` e o ecrã pareceria
    // bem. O que a asserção fixa é que nenhum dos cinco depende do fallback.
    for (const codigo of CODIGOS_DO_CONTRATO) {
      expect(recordIconName(codigo), codigo).not.toBeUndefined();
      expect(RECORD_ICON[codigo], codigo).toBeTruthy();
    }
    expect(Object.keys(RECORD_ICON)).toHaveLength(CODIGOS_DO_CONTRATO.length);
  });
});

describe('menu de registo · «Repetir último» (decisão 50)', () => {
  beforeEach(() => {
    instalarArmazenamento();
  });

  afterEach(() => {
    removerArmazenamento();
  });

  it('sem tipo anterior não há repetição a oferecer', () => {
    expect(readLastKind()).toBeNull();
  });

  it('guarda e devolve o último tipo gravado', () => {
    rememberLastKind('charging');

    expect(readLastKind()).toBe('charging');
  });

  it('o último tipo sobrevive à gravação de outro', () => {
    rememberLastKind('expense');
    rememberLastKind('maintenance');

    expect(readLastKind()).toBe('maintenance');
  });

  it('um valor que não é um tipo do contrato vale o mesmo que a ausência', () => {
    // O caso real: uma versão antiga gravou um tipo que já não existe, ou alguém escreveu no
    // armazenamento à mão. Oferecer «Repetir último» para um tipo inexistente abriria a folha
    // no formulário errado — o odómetro, que é o `else` do despachante.
    instalarArmazenamento().set('zemlo.ultimoTipoDeRegisto', 'insurance');

    expect(readLastKind()).toBeNull();
  });

  it('um valor corrompido vale o mesmo que a ausência', () => {
    instalarArmazenamento().set('zemlo.ultimoTipoDeRegisto', '{"kind":"fuel"}');

    expect(readLastKind()).toBeNull();
  });

  it('a etiqueta da ação é a da decisão', () => {
    expect(REPETIR_ULTIMO).toBe('Repetir último');
  });
});

describe('menu de registo · sem armazenamento disponível', () => {
  beforeEach(() => {
    removerArmazenamento();
  });

  it('ler não rebenta e não oferece repetição', () => {
    expect(readLastKind()).toBeNull();
  });

  it('gravar não rebenta — a gravação do registo não depende do atalho', () => {
    expect(() => rememberLastKind('fuel')).not.toThrow();
  });
});

describe('menu de registo · a guarda não passa por vacuidade', () => {
  it('o contrato tem os cinco tipos e as quatro ações principais que os testes acima usam', () => {
    expect(CODIGOS_DO_CONTRATO).toHaveLength(5);
    expect(QUICK_ACTIONS).toHaveLength(5);
    // Se a derivação deixasse de filtrar (por exemplo, se `QUICK_ACTIONS` perdesse o
    // odómetro), «Mais usados» passaria a ter 5 itens e os testes acima ficariam vermelhos
    // em vez de passarem por acidente.
    expect(registerMenuSections()[0]?.items).toHaveLength(4);
  });
});
