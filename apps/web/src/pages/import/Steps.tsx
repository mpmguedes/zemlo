/**
 * A barra de progresso do fluxo de importação.
 *
 * ## Porque é que não é uma barra de passos numerada
 *
 * Um fluxo de nove fases mostrado como "passo 4 de 9" assusta antes de começar e mente depois:
 * um ficheiro limpo percorre quatro das nove fases sem mostrar nada. Os cinco segmentos
 * correspondem aos **ecrãs** que podem aparecer, não às fases do servidor, e um segmento já
 * passado fica marcado mesmo que o utilizador tenha recuado — porque a informação que ele
 * produziu continua a valer.
 *
 * Cinco e não nove: os segmentos são o que o utilizador vê. Uma barra com nove traços em
 * telemóvel fica com traços de 3 px, que não se distinguem.
 */

const LABELS = [
  'Escolher o ficheiro',
  'Tipo de registo',
  'Colunas',
  'Rever',
  'Relatório',
] as const;

export function Steps({ current }: { current: number }) {
  return (
    <nav aria-label="Progresso da importação">
      <ol className="z-steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {LABELS.map((label, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li
              key={label}
              className={[
                'z-steps__dot',
                state === 'done' ? 'z-steps__dot--done' : '',
                state === 'current' ? 'z-steps__dot--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              /*
               * O texto vai para leitor de ecrã e não para o ecrã: um rótulo por baixo de cada
               * traço em telemóvel seria maior do que a própria barra. Quem não vê os traços
               * ouve em que passo está, que é a informação que interessa.
               */
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="z-sr-only">
                {label}
                {state === 'done' ? ' (concluído)' : state === 'current' ? ' (passo atual)' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
