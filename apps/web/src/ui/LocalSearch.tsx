import { useId } from 'react';
import { useDebounced } from '../hooks';

/*
 * Campo de pesquisa local (`WEB-007`).
 *
 * ## O que este componente garante, e porque é que insiste no aviso do âmbito
 *
 * A pesquisa é **local no cliente**: procura apenas nos registos já carregados no ecrã. Um campo
 * de pesquisa num ecrã com lista parcial parece procurar em tudo — e não procura. É por isso que
 * o aviso do âmbito (`scopeNote`) é **obrigatório**, e não opcional: quem aplicar este campo e o
 * deixar em branco está a prometer o que o produto não faz. O tipo obriga, para que a decisão de
 * omiti-lo tenha de ser escrita — e não aconteça por esquecimento.
 *
 * ## Porque é que o campo mostra a contagem
 *
 * «0 de 12» diz de imediato que o filtro agiu e que não há resultados, sem que o utilizador tenha
 * de reconciliar o vocabulário do estado vazio com o que escreveu. Sem isto, escrever no campo e
 * ver o ecrã vazio torna-se indistinguível de «ainda a carregar».
 *
 * ## O `useDebounced` ganha o primeiro consumidor
 *
 * O hook existia em `hooks/index.ts` desde o início, documentado para «os campos de pesquisa», e
 * tinha **zero consumidores** — o critério da tarefa pede que seja ele a atrasar a filtragem, em
 * vez de acrescentar uma dependência nova. Como a filtragem é local e barata (um `includes` sobre
 * uma lista já em memória), o atraso serve o mesmo propósito de sempre: não recalcular a lista a
 * cada tecla num ecrã grande.
 */

interface LocalSearchProps {
  /** Valor atual do campo (texto controlado pelo ecrã, para o poder limpar). */
  value: string;
  onChange: (value: string) => void;
  /** Rótulo visível e nome acessível do campo. */
  label?: string;
  placeholder?: string;
  /**
   * Frase que descreve **sobre o que** a pesquisa atua. Obrigatória por deliberação: é o
   * critério «a UI tem de deixar claro que a pesquisa atua sobre os resultados carregados».
   */
  scopeNote: string;
  /** Número de registos que casaram com a pesquisa. */
  matched: number;
  /** Número total de registos carregados (antes da pesquisa). */
  loaded: number;
}

export function LocalSearch({
  value,
  onChange,
  label = 'Pesquisar',
  placeholder,
  scopeNote,
  matched,
  loaded,
}: LocalSearchProps) {
  const debounced = useDebounced(value);
  const inputId = useId();
  const noteId = `${inputId}-scope`;

  /*
   * O estado visível usa o valor **atrasado**, para que o campo e a contagem contem a mesma
   * história: durante os 300 ms do atraso, o texto ainda não filtrou, e mostrar a contagem nova
   * antes de a lista mudar seria anunciar um resultado que ainda não está no ecrã.
   */
  const ativo = debounced.trim() !== '';

  return (
    <div className="z-field">
      <label className="z-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
        {/*
          `type="search"` (e não `type="text"`): dá o botão nativo de limpar nos browsers que o
          têm, anuncia-se como «campo de pesquisa» ao leitor de ecrã, e é a primeira ocorrência
          desta semântica no `src` — o produto não tinha nenhuma.
        */}
        <input
          id={inputId}
          type="search"
          className="z-input"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          aria-describedby={noteId}
          onChange={(event) => onChange(event.target.value)}
        />
        {value !== '' ? (
          <button
            type="button"
            className="z-btn z-btn--ghost z-btn--sm"
            onClick={() => onChange('')}
          >
            Limpar
          </button>
        ) : null}
      </div>
      <span className="z-field__hint" id={noteId}>
        {scopeNote}
        {ativo ? ` A mostrar ${matched} de ${loaded}.` : ''}
      </span>
    </div>
  );
}
