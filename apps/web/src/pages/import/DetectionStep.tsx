import { Banner, Card, Chip, DetailList, DetailRow, Disclosure } from '../../ui/primitives';
import type { CsvDetection } from '../../api/queries';
import { detectionNeedsConfirmation, detectionSummary } from '../../lib/csvImport';

/**
 * O que se percebeu do ficheiro, antes de o interpretar (§10.2, fases 1 e 2).
 *
 * ## Porque é que este passo existe sempre
 *
 * A deteção é a única parte do processo em que o sistema fez uma **escolha** que o utilizador
 * não pediu: decidiu que a codificação é CP1252, que o separador é `;` e que a primeira linha
 * é cabeçalho. Se a escolha estiver certa, o utilizador confirma-a em dois segundos. Se
 * estiver errada, é aqui — e não no relatório final — que ele o descobre. Sem este passo, um
 * ficheiro CP1252 mal detetado produziria acentos corrompidos no ecrã seguinte, e a conclusão
 * natural seria "o Zemlo está avariado".
 *
 * ## Quando é que pede confirmação e quando é que informa
 *
 * Quando a deteção é firme (confiança alta, sem problemas, codificação não ambígua), o passo
 * é uma linha de contexto com os números do ficheiro. Quando não é, aparece um aviso que diz
 * **o que** está incerto e **o que acontece** se estiver errado — sem pedir ao utilizador para
 * verificar nada que ele não possa verificar. A codificação detetada não é um seletor: não há
 * nada de útil em perguntar "UTF-8 ou CP1252?" a quem não sabe o que isso é. O que se faz é
 * mostrar as razões e deixar seguir; se o resultado estiver corrompido, o passo da
 * pré-visualização torna isso evidente.
 */
export function DetectionStep({ detection }: { detection: CsvDetection }) {
  const uncertain = detectionNeedsConfirmation(detection);

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">{detectionSummary(detection)}</div>
          <div className="z-card__subtitle">
            {detection.hasHeader
              ? 'A primeira linha parece ser o cabeçalho.'
              : 'Não encontrei um cabeçalho — a primeira linha já tem dados.'}
          </div>
        </div>
        <Chip tone={uncertain ? 'warn' : 'ok'}>
          {uncertain ? 'Confirma, se puder' : 'Sem dúvidas'}
        </Chip>
      </div>

      {uncertain ? (
        <Banner tone="warn" title="Duas coisas que vale a pena confirmar">
          <ul className="z-stack z-stack--tight z-small">
            {detection.encodingUncertain ? (
              <li>
                <strong>Codificação.</strong> Este ficheiro não tem caracteres que permitam
                distinguir UTF-8 de CP1252, por isso assumi <span className="z-mono">UTF-8</span>.
                Se os acentos aparecerem estranhos no passo seguinte, o ficheiro é provavelmente
                do Excel antigo — nesse caso guarda-o de novo como «CSV UTF-8».
              </li>
            ) : null}
            {detection.issues.length > 0 ? (
              <li>
                <strong>Formato das linhas.</strong> {describeIssues(detection)}
              </li>
            ) : null}
            {detection.confidence < 0.8 && detection.issues.length === 0 && !detection.encodingUncertain ? (
              <li>
                <strong>Leitura em geral.</strong> Algumas linhas do ficheiro não seguem o mesmo
                padrão das restantes. Vale a pena ver como ficam antes de importar.
              </li>
            ) : null}
          </ul>
        </Banner>
      ) : null}

      <DetailList>
        <DetailRow
          label="Separador"
          value={
            <>
              <span className="z-mono">{labelForDelimiter(detection.delimiter)}</span>{' '}
              <span className="z-muted z-xs">({detection.delimiterLabel})</span>
            </>
          }
        />
        <DetailRow
          label="Codificação"
          value={
            <>
              {detection.encoding.toUpperCase()}
              {detection.encodingUncertain ? <span className="z-muted z-xs"> · assumida</span> : null}
            </>
          }
        />
        <DetailRow label="Colunas" value={detection.headers.length} />
        <DetailRow label="Linhas de dados" value={detection.rowCount} />
      </DetailList>

      {/*
        As razões do servidor são mostradas só a quem as procura. São frases corretas mas
        técnicas ("consistência de 0,98 em 12 linhas amostradas"): úteis para perceber um caso
        estranho, ruído para quem só quer importar.
      */}
      {detection.reasons.length > 0 ? (
        <Disclosure label="Porque é que cheguei a estas conclusões">
          <ul className="z-stack z-stack--tight z-xs z-muted">
            {detection.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {detection.headers.length > 0 ? (
        <Disclosure label={`Ver as ${detection.headers.length} colunas do ficheiro`}>
          <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-1)' }}>
            {detection.headers.map((header, index) => (
              <Chip key={`${header}-${index}`}>
                {header.trim() === '' ? <span className="z-muted">(sem nome)</span> : header}
              </Chip>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </Card>
  );
}

/** O separador, em texto reconhecível. Um tab não é legível como carácter. */
function labelForDelimiter(delimiter: string): string {
  if (delimiter === '\t') return '⇥';
  if (delimiter === ' ') return '␣';
  return delimiter;
}

/**
 * Descreve os problemas sintáticos em português corrente.
 *
 * Os códigos do parser (`unterminated_quote`, `ragged_row`) são estáveis e úteis para os
 * testes, mas não para aqui: o utilizador precisa de saber **quantas** linhas e **qual**, não
 * como se chama a regra que falhou.
 */
function describeIssues(detection: CsvDetection): string {
  const raggedy = detection.issues.filter((issue) => issue.code === 'ragged_row');
  const quotes = detection.issues.filter((issue) => issue.code !== 'ragged_row');

  const parts: string[] = [];

  if (raggedy.length > 0) {
    const first = raggedy[0];
    parts.push(
      raggedy.length === 1
        ? `A linha ${first?.line ?? '?'} tem um número de campos diferente do resto.`
        : `${raggedy.length} linhas têm um número de campos diferente do resto (a primeira é a ${
            first?.line ?? '?'
          }).`,
    );
  }

  if (quotes.length > 0) {
    parts.push(
      quotes.length === 1
        ? `Há uma aspas por fechar, provavelmente na linha ${quotes[0]?.line ?? '?'}.`
        : `Há ${quotes.length} aspas por fechar, o que pode juntar duas linhas numa só.`,
    );
  }

  return parts.length > 0
    ? `${parts.join(' ')} Estas linhas são ignoradas ou corrigidas automaticamente, e aparecem listadas no fim.`
    : 'Algumas linhas não seguem o padrão das restantes.';
}
