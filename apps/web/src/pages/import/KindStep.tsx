import { Banner, Button, Card, Chip } from '../../ui/primitives';
import type { KindInference, RecordKind } from '../../api/queries';
import type { KindOption } from './kinds';

/**
 * A escolha do tipo de registo (§10.5).
 *
 * ## Porque é que isto é uma pergunta de uma linha
 *
 * A §10.5 termina com "o utilizador escolhe — é uma pergunta de uma linha, não um ecrã de
 * configuração". O tipo de registo é a única decisão que o utilizador **tem** de tomar para
 * que a importação seja sequer possível: sem ele não há campos obrigatórios, não há validação
 * e não há plano. Mas é também uma decisão que o servidor consegue quase sempre evitar, pelo
 * que este passo só aparece quando a inferência falhou.
 *
 * ## As duas razões de falha são diferentes e são ditas de forma diferente
 *
 *  - `ambiguo` — o ficheiro serve para mais do que um tipo. O servidor diz **quais** e com que
 *    pontuação; a interface apresenta os candidatos primeiro, com a razão que os distingue.
 *  - `insuficiente` — o ficheiro tem colunas a menos. Aqui não há candidatos a destacar: há
 *    um pedido honesto de ajuda, e a lista completa como resposta.
 *
 * Confundir as duas produziria o pior dos dois mundos: uma lista de onze tipos para quem só
 * tem de escolher entre dois, ou dois candidatos para quem precisa de ver tudo.
 */
export function KindStep({
  inference,
  options,
  selected,
  busy,
  onChoose,
}: {
  inference: KindInference;
  options: KindOption[];
  selected: RecordKind | null;
  busy: boolean;
  onChoose: (kind: RecordKind) => void;
}) {
  const ambiguous = inference.state === 'ambiguo' && inference.alternatives.length > 1;

  /*
   * Quando a inferência é ambígua, só se mostram as alternativas identificadas: oferecer os
   * onze tipos seria dizer ao utilizador que a sua resposta pode ser outra coisa qualquer,
   * quando o servidor já sabe que são duas ou três.
   */
  const shown: KindOption[] = ambiguous
    ? inference.alternatives
        .map((alternative) => options.find((option) => option.kind === alternative.kind))
        .filter((option): option is KindOption => option !== undefined)
    : options;

  const lead = shown.filter((option) => option.group === 'uso');
  const rest = shown.filter((option) => option.group === 'documento');

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">
            {ambiguous ? 'Este ficheiro pode ser mais do que uma coisa' : 'Que tipo de registos é este ficheiro?'}
          </div>
          <div className="z-card__subtitle">
            {ambiguous
              ? 'Escolhe o que corresponde ao que tens aqui.'
              : 'Não consegui perceber pelas colunas. Uma escolha decide tudo o resto.'}
          </div>
        </div>
        <Chip tone="warn">Precisa de resposta</Chip>
      </div>

      {/*
        A razão do servidor é mostrada tal como veio. É texto escrito para ser lido — a §11.3
        proíbe conceitos técnicos, e esta frase é a que explica porque é que o Zemlo não
        conseguiu decidir, que é informação útil e não uma desculpa.
      */}
      <Banner tone="info">
        <p className="z-small">{inference.reason}</p>
      </Banner>

      {lead.length > 0 ? (
        <div className="z-stack z-stack--tight">
          {lead.map((option) => (
            <KindChoice
              key={option.kind}
              option={option}
              selected={selected === option.kind}
              busy={busy}
              onChoose={onChoose}
            />
          ))}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <>
          {lead.length > 0 ? (
            <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
              {ambiguous ? 'Ou um documento:' : 'Ou um documento com validade:'}
            </p>
          ) : null}
          <div className="z-stack z-stack--tight">
            {rest.map((option) => (
              <KindChoice
                key={option.kind}
                option={option}
                selected={selected === option.kind}
                busy={busy}
                onChoose={onChoose}
              />
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Uma opção da lista de tipos.
 *
 * O alvo de toque é a linha inteira e não o botão, e o texto é o rótulo em português com uma
 * dica do que o distingue. A dica existe porque "Despesas" e "Manutenções" parecem
 * intercambiáveis a quem tem um ficheiro com uma coluna «Total»: a diferença está nas
 * **outras** colunas, e é isso que a dica nomeia.
 */
function KindChoice({
  option,
  selected,
  busy,
  onChoose,
}: {
  option: KindOption;
  selected: boolean;
  busy: boolean;
  onChoose: (kind: RecordKind) => void;
}) {
  return (
    <Button
      variant={selected ? 'primary' : 'secondary'}
      block
      loading={busy && selected}
      disabled={busy && !selected}
      onClick={() => onChoose(option.kind)}
      className="z-import__kind"
    >
      <span className="z-import__kind-label">{option.label}</span>
      <span className="z-import__kind-hint">{option.hint}</span>
    </Button>
  );
}
