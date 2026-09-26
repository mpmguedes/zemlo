import type { RecordKind } from '@zemlo/shared';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import {
  REPETIR_ULTIMO,
  readLastKind,
  registerMenuItem,
  registerMenuSections,
} from '../lib/registerMenu';

/**
 * Menu de entrada do registo (decisões 46–50).
 *
 * ## O que muda
 *
 * Hoje, tocar em «Registar» abre **o formulário de despesa**. Isso obriga quem quer um
 * abastecimento a abrir uma despesa, fechar, e procurar o sítio certo — três passos para
 * chegar a um formulário que existe. Este menu é o passo que faltava: pergunta **que tipo**,
 * e só depois abre o formulário desse tipo.
 *
 * ## Porque é que isto é uma folha e não uma página
 *
 * Porque é uma pergunta de um só toque e não um destino. Uma página obrigaria a uma rota, a um
 * `PageHeader`, a um caminho de regresso e a um item de navegação — quatro coisas a manter
 * para uma escolha que se faz em dois segundos. A `Sheet` existente já resolve foco preso,
 * `Escape`, clique fora, `aria-modal` e restauração de foco; reutilizá-la é o que faz este
 * menu ter o mesmo comportamento do resto do produto sem o reimplementar.
 *
 * ## Fluxo contextual (decisão 48)
 *
 * Os cinco tipos do contrato abrem todos **o formulário dentro da folha** — não há aqui
 * nenhum caso «complexo» que exija página própria. Isso não é uma omissão: é a leitura do que
 * já existe. O registo rápido foi desenhado de raiz para caber numa folha (§43/§44: «três
 * campos à vista, o resto atrás de *Adicionar detalhes*»), e os cinco tipos partilham essa
 * forma: 2 a 4 campos essenciais, com o enriquecimento escondido. A decisão 48 é, por isso,
 * um **limite** — «não empurrar para dentro da folha um formulário que não caiba lá» — e não
 * uma instrução para inventar ecrãs novos. Fica fixado por teste: nenhum tipo do menu abre
 * uma rota em vez da folha. Ver `lib/registerMenu.ts` para os tipos que ficaram de fora e
 * porquê.
 *
 * ## Repetir último (decisão 50)
 *
 * A ação é **discreta** (uma linha, no topo, em texto e não em botão sólido) e só aparece
 * quando há um tipo gravado anteriormente. Repete **o tipo** — nunca os valores: os campos
 * abrem com os mesmos valores por omissão seguros que abririam de qualquer outra forma
 * (veículo, data), porque copiar um valor anterior para um registo novo é exatamente o que a
 * decisão 50 proíbe fazer sem confirmação. Quem quiser o mesmo valor volta a escrevê-lo, ou
 * confirma-o no formulário — que é onde ele é visível antes de gravar.
 */
export interface RegisterMenuProps {
  /** Tipo escolhido. Abre o formulário desse tipo na folha de registo. */
  onSelect: (kind: RecordKind) => void;
  onClose: () => void;
}

export function RegisterMenu({ onSelect, onClose }: RegisterMenuProps) {
  const sections = registerMenuSections();
  const ultimo = readLastKind();
  const ultimoItem = ultimo === null ? null : registerMenuItem(ultimo);

  return (
    <Sheet open onClose={onClose} title="Registar">
      {ultimoItem ? (
        <button
          type="button"
          className="z-register-menu__repeat"
          onClick={() => onSelect(ultimoItem.kind)}
        >
          <Icon name="repeat" size={18} />
          <span>{REPETIR_ULTIMO}</span>
          <span className="z-register-menu__repeat-kind">{ultimoItem.label}</span>
        </button>
      ) : null}

      {sections.map((section) => (
        <section key={section.title} className="z-register-menu__section">
          <h3 className="z-register-menu__title">{section.title}</h3>
          {/*
            Grelha adaptativa (decisão 46): duas colunas por omissão, uma só quando a largura
            não dá para dois cartões confortáveis. O número de linhas segue o número de
            opções — não há célula vazia a fingir um tipo que não existe.
          */}
          <div className="z-register-menu__grid">
            {section.items.map((item) => (
              <button
                key={item.kind}
                type="button"
                className="z-register-card"
                onClick={() => onSelect(item.kind)}
              >
                {/*
                  A área em petróleo é pequena e é do ícone — o cartão fica claro (decisão 47).
                  O ícone herda `currentColor`, que aqui é a tinta de acento; é isso que o faz
                  acompanhar o tema claro e o escuro sem uma segunda regra.
                */}
                {item.icon ? (
                  <span className="z-register-card__icon">
                    <Icon name={item.icon} size={20} />
                  </span>
                ) : null}
                <span className="z-register-card__label">{item.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}
