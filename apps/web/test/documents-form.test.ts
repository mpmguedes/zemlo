import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * `WEB-009` · o formulário «Novo documento» tem **um só** campo «Validade».
 *
 * ## O defeito
 *
 * O formulário renderizava **dois** `DateField` com o rótulo «Validade», ambos ligados a
 * `form.values.expiresAt` e ambos com o mesmo `error={errors.expiresAt}`. O segundo ficou para
 * trás quando a validade passou para o par com a data. O utilizador via o mesmo campo duas vezes
 * e não sabia se eram dois dados diferentes.
 *
 * ## Porque é que esta verificação é ESTÁTICA, e rotulada como tal
 *
 * O critério da tarefa diz «inspeção do formulário **renderizado**». Não é alcançável aqui: o
 * formulário vive atrás de `useState(false)` — só aparece depois de um clique em «＋ Novo
 * documento» — e o projeto decidiu, por escrito, não introduzir `jsdom` (ver
 * `page-states.test.tsx`). Sem eventos, um teste de renderização veria a lista e não o formulário.
 *
 * O que se pode afirmar é o **código-fonte**: quantas vezes o rótulo «Validade» é escrito no
 * ficheiro. É uma guarda de convenção — morde quando alguém volta a acrescentar o campo — e não
 * um teste de comportamento. Segue o padrão da guarda de `role="group"` de
 * `accessibility.test.tsx`, com um teste anti-vacuidade separado.
 *
 * ## O que isto NÃO prova
 *
 * Não prova que o formulário **renderiza** um só campo — prova que só o **declara** uma vez. Um
 * `label={…}` calculado escaparia à contagem. O teste anti-vacuidade existe exatamente para que
 * uma expressão que deixasse de casar não faça a guarda passar para sempre.
 */

const FICHEIRO = fileURLToPath(new URL('../src/pages/DocumentsPage.tsx', import.meta.url));

function fonte(): string {
  return readFileSync(FICHEIRO, 'utf8');
}

const ROTULO_VALIDADE = /label="Validade"/g;

describe('WEB-009 · um só campo «Validade» no formulário', () => {
  it('declara o rótulo «Validade» exatamente uma vez', () => {
    expect([...fonte().matchAll(ROTULO_VALIDADE)]).toHaveLength(1);
  });

  it('os restantes campos do formulário mantêm-se', () => {
    const conteudo = fonte();
    for (const rotulo of ['Nome', 'Categoria', 'Veículo', 'Data do documento', 'Nome do ficheiro', 'Notas']) {
      expect(conteudo, `campo «${rotulo}»`).toContain(`label="${rotulo}"`);
    }
  });

  it('a guarda encontra o formulário e o rótulo — não passa por vacuidade', () => {
    const conteudo = fonte();
    expect(conteudo).toContain('<form');
    expect([...conteudo.matchAll(ROTULO_VALIDADE)].length).toBeGreaterThanOrEqual(1);
    // A ligação ao campo continua a existir: o defeito era a duplicação, não a remoção.
    expect(conteudo).toContain("form.setValue('expiresAt'");
  });
});
